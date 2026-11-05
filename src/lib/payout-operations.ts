import { LedgerType, PayoutMethod, PayoutStatus, Prisma, Role } from "@prisma/client";
import { PAYOUT_THRESHOLD_CENTS, MAX_PAYOUT_REQUESTS_PER_24H } from "./config.ts";
import { balanceAfterRefund, balanceAfterReservation, validatePayoutRequest } from "./payout-rules.ts";
import { parseSteamTradeUrl } from "./payout-profile.ts";
import { enqueueModeratorNotifications, enqueueUserNotification } from "./telegram-notifications.ts";

export type PayoutOperationErrorCode =
  | "user_not_found"
  | "inactive_user"
  | "wrong_role"
  | "open_request"
  | "daily_limit"
  | "below_threshold"
  | "missing_destination"
  | "invalid_destination"
  | "not_found"
  | "already_processed"
  | "inactive_confirmation_required"
  | "negative_balance";

export class PayoutOperationError extends Error {
  readonly code: PayoutOperationErrorCode;

  constructor(code: PayoutOperationErrorCode) {
    super(code);
    this.code = code;
  }
}

async function lockUser(tx: Prisma.TransactionClient, userId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE
  `;
  if (rows.length === 0) throw new PayoutOperationError("user_not_found");
}

async function readBalance(tx: Prisma.TransactionClient, userId: string) {
  const aggregate = await tx.ledgerEntry.aggregate({
    where: { userId },
    _sum: { amountCents: true },
  });
  return aggregate._sum.amountCents ?? 0;
}

export async function updatePayoutDetails(
  tx: Prisma.TransactionClient,
  userId: string,
  details: { wallet: string | null; steamTradeUrl: string | null },
) {
  await lockUser(tx, userId);
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, isActive: true },
  });
  if (!user?.isActive) throw new PayoutOperationError("inactive_user");
  if (user.role !== Role.CLIPPER) throw new PayoutOperationError("wrong_role");

  const openPayout = await tx.payout.findFirst({
    where: { userId, status: PayoutStatus.REQUESTED },
    select: { id: true },
  });
  if (openPayout) throw new PayoutOperationError("open_request");

  await tx.user.update({ where: { id: userId }, data: details, select: { id: true } });
}

export async function createPayoutReservation(
  tx: Prisma.TransactionClient,
  userId: string,
  method: PayoutMethod,
  now: Date,
) {
  await lockUser(tx, userId);
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: { id: true, login: true, role: true, isActive: true, wallet: true, steamTradeUrl: true },
  });
  if (!user?.isActive) throw new PayoutOperationError("inactive_user");
  if (user.role !== Role.CLIPPER) throw new PayoutOperationError("wrong_role");

  const [openPayout, requestsInLast24Hours, balanceCents] = await Promise.all([
    tx.payout.findFirst({ where: { userId, status: PayoutStatus.REQUESTED }, select: { id: true } }),
    tx.payout.count({ where: { userId, createdAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) } } }),
    readBalance(tx, userId),
  ]);
  const failure = validatePayoutRequest({
    balanceCents,
    hasOpenRequest: Boolean(openPayout),
    requestsInLast24Hours,
    thresholdCents: PAYOUT_THRESHOLD_CENTS,
    maxRequestsPer24Hours: MAX_PAYOUT_REQUESTS_PER_24H,
  });
  if (failure) throw new PayoutOperationError(failure);

  let destination: string | null;
  if (method === PayoutMethod.CRYPTO) {
    destination = user.wallet?.trim() || null;
    if (destination && destination.length > 200) throw new PayoutOperationError("invalid_destination");
  } else {
    destination = user.steamTradeUrl ? parseSteamTradeUrl(user.steamTradeUrl) : null;
    if (user.steamTradeUrl && !destination) throw new PayoutOperationError("invalid_destination");
  }
  if (!destination) throw new PayoutOperationError("missing_destination");

  const amountCents = balanceCents;
  const newBalance = balanceAfterReservation(balanceCents, amountCents);
  if (newBalance === null) throw new PayoutOperationError("negative_balance");

  const payout = await tx.payout.create({
    data: { userId, amountCents, method, destination },
    select: { id: true },
  });
  await tx.ledgerEntry.create({
    data: {
      userId,
      type: LedgerType.PAYOUT,
      amountCents: -amountCents,
      payoutId: payout.id,
    },
    select: { id: true },
  });

  const balanceAfter = await readBalance(tx, userId);
  if (balanceAfter < 0 || balanceAfter !== newBalance) {
    throw new PayoutOperationError("negative_balance");
  }
  await enqueueModeratorNotifications(tx, {
    kind: "NEW_PAYOUT",
    login: user.login,
    amountCents,
    url: "/moderator/payouts",
  }, `payout-created:${payout.id}`);
  return { payoutId: payout.id, amountCents, balanceAfterCents: balanceAfter };
}

export async function decidePayout(
  tx: Prisma.TransactionClient,
  input: {
    payoutId: string;
    moderatorId: string;
    decision: "PAID" | "REJECTED";
    txRef?: string;
    rejectReason?: string;
    confirmInactive: boolean;
    now: Date;
  },
) {
  const lockedOwners = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT u."id"
    FROM "User" u
    JOIN "Payout" p ON p."userId" = u."id"
    WHERE p."id" = ${input.payoutId}
    FOR UPDATE OF u
  `;
  if (lockedOwners.length === 0) throw new PayoutOperationError("not_found");

  const payout = await tx.payout.findUnique({
    where: { id: input.payoutId },
    select: { id: true, userId: true, amountCents: true, status: true },
  });
  if (!payout) throw new PayoutOperationError("not_found");
  if (payout.status !== PayoutStatus.REQUESTED) throw new PayoutOperationError("already_processed");

  const owner = await tx.user.findUnique({ where: { id: payout.userId }, select: { isActive: true, login: true } });
  if (!owner) throw new PayoutOperationError("not_found");
  if (!owner.isActive && !input.confirmInactive) {
    throw new PayoutOperationError("inactive_confirmation_required");
  }

  const updated = await tx.payout.updateMany({
    where: { id: payout.id, status: PayoutStatus.REQUESTED },
    data: {
      status: input.decision,
      processedAt: input.now,
      processedById: input.moderatorId,
      txRef: input.decision === "PAID" ? input.txRef : null,
      rejectReason: input.decision === "REJECTED" ? input.rejectReason : null,
    },
  });
  if (updated.count === 0) throw new PayoutOperationError("already_processed");

  if (input.decision === "REJECTED") {
    const beforeRefund = await readBalance(tx, payout.userId);
    const expectedBalance = balanceAfterRefund(beforeRefund, payout.amountCents);
    if (expectedBalance === null || expectedBalance < 0) {
      throw new PayoutOperationError("negative_balance");
    }
    await tx.ledgerEntry.create({
      data: {
        userId: payout.userId,
        payoutId: payout.id,
        type: LedgerType.ADJUSTMENT,
        amountCents: payout.amountCents,
        note: "возврат: отклонён вывод",
      },
      select: { id: true },
    });
    const afterRefund = await readBalance(tx, payout.userId);
    if (afterRefund !== expectedBalance) {
      throw new PayoutOperationError("negative_balance");
    }
  }

  await enqueueUserNotification(tx, payout.userId, input.decision === "PAID"
    ? {
      kind: "PAYOUT_PAID",
      amountCents: payout.amountCents,
      url: "/balance",
    }
    : {
      kind: "PAYOUT_REJECTED",
      reason: input.rejectReason ?? "Вывод отклонён.",
      amountCents: payout.amountCents,
      url: "/balance",
    }, `payout-decision:${payout.id}:${input.decision}`);
}
