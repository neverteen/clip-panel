import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { LedgerType, PayoutMethod, PayoutStatus, PrismaClient } from "@prisma/client";
import { createPayoutReservation, decidePayout, PayoutOperationError, updatePayoutDetails } from "../src/lib/payout-operations.ts";

const prisma = new PrismaClient();
const weekStart = new Date("2025-01-06T00:00:00.000Z");
const now = new Date();
function newLogin(prefix) {
  return `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
}
function violatesCheck(name) {
  return (error) => {
    const details = [error?.message, error?.stack, error?.cause?.message, JSON.stringify(error?.meta)].filter(Boolean).join(" ");
    return error?.code === "P2004" || details.includes(name);
  };
}

test("payout lifecycle is serialized, reserves balance, refunds once, and enforces the daily request cap", async () => {
  const owner = await prisma.user.create({
    data: { login: newLogin("payout_owner"), password: "integration-test-only", wallet: "BTC test-network address" },
    select: { id: true },
  });
  const moderator = await prisma.user.create({
    data: { login: newLogin("payout_mod"), password: "integration-test-only", role: "MODERATOR" },
    select: { id: true },
  });

  try {
    await prisma.ledgerEntry.create({
      data: { userId: owner.id, type: LedgerType.ACCRUAL, amountCents: 2999, weekStart },
    });
    await assert.rejects(
      prisma.$transaction((tx) => createPayoutReservation(tx, owner.id, PayoutMethod.CRYPTO, now)),
      (error) => error instanceof PayoutOperationError && error.code === "below_threshold",
    );
    await prisma.ledgerEntry.create({ data: { userId: owner.id, type: LedgerType.ADJUSTMENT, amountCents: 1 } });
    await prisma.user.update({ where: { id: owner.id }, data: { isActive: false } });
    await assert.rejects(
      prisma.$transaction((tx) => createPayoutReservation(tx, owner.id, PayoutMethod.CRYPTO, now)),
      (error) => error instanceof PayoutOperationError && error.code === "inactive_user",
    );
    await prisma.user.update({ where: { id: owner.id }, data: { isActive: true } });

    const simultaneous = await Promise.allSettled([
      prisma.$transaction((tx) => createPayoutReservation(tx, owner.id, PayoutMethod.CRYPTO, now)),
      prisma.$transaction((tx) => createPayoutReservation(tx, owner.id, PayoutMethod.CRYPTO, now)),
    ]);
    const successful = simultaneous.filter((result) => result.status === "fulfilled");
    const failed = simultaneous.filter((result) => result.status === "rejected");
    assert.equal(successful.length, 1);
    assert.equal(failed.length, 1);
    const payoutId = successful[0].value.payoutId;

    const reservedBalance = await prisma.ledgerEntry.aggregate({ where: { userId: owner.id }, _sum: { amountCents: true } });
    assert.equal(reservedBalance._sum.amountCents, 0);
    await assert.rejects(
      prisma.$transaction((tx) => updatePayoutDetails(tx, owner.id, { wallet: "changed wallet", steamTradeUrl: null })),
      (error) => error instanceof PayoutOperationError && error.code === "open_request",
    );

    await prisma.user.update({ where: { id: owner.id }, data: { isActive: false } });
    await assert.rejects(
      prisma.$transaction((tx) => decidePayout(tx, {
        payoutId, moderatorId: moderator.id, decision: "REJECTED", rejectReason: "test refund", confirmInactive: false, now,
      })),
      (error) => error instanceof PayoutOperationError && error.code === "inactive_confirmation_required",
    );

    const decisions = await Promise.allSettled([
      prisma.$transaction((tx) => decidePayout(tx, {
        payoutId, moderatorId: moderator.id, decision: "REJECTED", rejectReason: "test refund", confirmInactive: true, now,
      })),
      prisma.$transaction((tx) => decidePayout(tx, {
        payoutId, moderatorId: moderator.id, decision: "REJECTED", rejectReason: "test refund", confirmInactive: true, now,
      })),
    ]);
    assert.equal(decisions.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(decisions.filter((result) => result.status === "rejected").length, 1);
    const restoredBalance = await prisma.ledgerEntry.aggregate({ where: { userId: owner.id }, _sum: { amountCents: true } });
    assert.equal(restoredBalance._sum.amountCents, 3000);
    assert.equal(await prisma.ledgerEntry.count({ where: { payoutId, type: LedgerType.ADJUSTMENT } }), 1);
    await prisma.user.update({ where: { id: owner.id }, data: { isActive: true } });

    const secondPayout = await prisma.$transaction((tx) => createPayoutReservation(tx, owner.id, PayoutMethod.CRYPTO, now));
    await prisma.$transaction((tx) => decidePayout(tx, {
      payoutId: secondPayout.payoutId, moderatorId: moderator.id, decision: "REJECTED", rejectReason: "test refund", confirmInactive: false, now,
    }));
    const thirdPayout = await prisma.$transaction((tx) => createPayoutReservation(tx, owner.id, PayoutMethod.CRYPTO, now));
    await prisma.$transaction((tx) => decidePayout(tx, {
      payoutId: thirdPayout.payoutId, moderatorId: moderator.id, decision: "REJECTED", rejectReason: "test refund", confirmInactive: false, now,
    }));
    await assert.rejects(
      prisma.$transaction((tx) => createPayoutReservation(tx, owner.id, PayoutMethod.CRYPTO, now)),
      (error) => error instanceof PayoutOperationError && error.code === "daily_limit",
    );
    assert.equal(await prisma.payout.count({ where: { userId: owner.id, createdAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) } } }), 3);
  } finally {
    await prisma.ledgerEntry.deleteMany({ where: { userId: owner.id } });
    await prisma.payout.deleteMany({ where: { userId: owner.id } });
    await prisma.user.deleteMany({ where: { id: { in: [owner.id, moderator.id] } } });
  }
});

test("database partial indexes and PAYOUT amount check reject duplicates and invalid sign; failed transactions roll back", async () => {
  const duplicateOpen = prisma.$transaction(async (tx) => {
    const user = await tx.user.create({ data: { login: newLogin("open_idx"), password: "integration-test-only" }, select: { id: true } });
    const payoutData = { userId: user.id, amountCents: 3000, method: PayoutMethod.CRYPTO, destination: "test destination", status: PayoutStatus.REQUESTED };
    await tx.payout.create({ data: payoutData });
    await tx.payout.create({ data: payoutData });
    throw new Error("Duplicate REQUESTED Payout unexpectedly accepted.");
  });
  await assert.rejects(duplicateOpen, (error) => error?.code === "P2002");

  for (const ledgerType of [LedgerType.PAYOUT, LedgerType.ADJUSTMENT]) {
    const duplicateLedger = prisma.$transaction(async (tx) => {
      const user = await tx.user.create({ data: { login: newLogin("ledger_idx"), password: "integration-test-only" }, select: { id: true } });
      const payout = await tx.payout.create({ data: { userId: user.id, amountCents: 3000, method: PayoutMethod.CRYPTO, destination: "test destination" }, select: { id: true } });
      const amountCents = ledgerType === LedgerType.PAYOUT ? -3000 : 3000;
      const entry = { userId: user.id, payoutId: payout.id, type: ledgerType, amountCents };
      await tx.ledgerEntry.create({ data: entry });
      await tx.ledgerEntry.create({ data: entry });
      throw new Error(`Duplicate ${ledgerType} unexpectedly accepted.`);
    });
    await assert.rejects(duplicateLedger, (error) => error?.code === "P2002");
  }

  const positivePayout = prisma.$transaction(async (tx) => {
    const user = await tx.user.create({ data: { login: newLogin("payout_check"), password: "integration-test-only" }, select: { id: true } });
    const payout = await tx.payout.create({ data: { userId: user.id, amountCents: 3000, method: PayoutMethod.CRYPTO, destination: "test destination" }, select: { id: true } });
    await tx.ledgerEntry.create({ data: { userId: user.id, payoutId: payout.id, type: LedgerType.PAYOUT, amountCents: 3000 } });
  });
  await assert.rejects(positivePayout, violatesCheck("LedgerEntry_payout_amounts_check"));

  const paidWithoutReference = prisma.$transaction(async (tx) => {
    const user = await tx.user.create({ data: { login: newLogin("paid_state"), password: "integration-test-only" }, select: { id: true } });
    await tx.payout.create({
      data: { userId: user.id, amountCents: 3000, method: PayoutMethod.CRYPTO, destination: "test destination", status: PayoutStatus.PAID },
    });
  });
  await assert.rejects(paidWithoutReference, violatesCheck("Payout_state_check"));

  const rejectedWithoutReason = prisma.$transaction(async (tx) => {
    const user = await tx.user.create({ data: { login: newLogin("rejected_state"), password: "integration-test-only" }, select: { id: true } });
    await tx.payout.create({
      data: { userId: user.id, amountCents: 3000, method: PayoutMethod.CRYPTO, destination: "test destination", status: PayoutStatus.REJECTED },
    });
  });
  await assert.rejects(rejectedWithoutReason, violatesCheck("Payout_state_check"));
});

test.after(async () => {
  await prisma.$disconnect();
});
