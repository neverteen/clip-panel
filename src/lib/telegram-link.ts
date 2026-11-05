import { Prisma, Role } from "@prisma/client";
import { createHash } from "node:crypto";
import type { Prisma as PrismaTypes } from "@prisma/client";
import { enqueueDirectTelegramNotification } from "./telegram-notifications.ts";
import { createTelegramLinkSecret, hashTelegramLinkSecret } from "./telegram-rules.ts";

type Tx = PrismaTypes.TransactionClient;

export type TelegramLinkErrorCode = "user_not_found" | "inactive" | "wrong_role" | "daily_limit";

export class TelegramLinkError extends Error {
  readonly code: TelegramLinkErrorCode;
  constructor(code: TelegramLinkErrorCode) {
    super(code);
    this.code = code;
  }
}

export async function createTelegramLinkCode(tx: Tx, userId: string, now: Date) {
  const locked = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE
  `;
  if (locked.length === 0) throw new TelegramLinkError("user_not_found");
  const user = await tx.user.findUnique({ where: { id: userId }, select: { isActive: true, role: true } });
  if (!user?.isActive) throw new TelegramLinkError("inactive");
  if (user.role !== Role.CLIPPER && user.role !== Role.MODERATOR) throw new TelegramLinkError("wrong_role");

  const since = new Date(now.getTime() - 24 * 60 * 60_000);
  const issued = await tx.telegramLinkCode.count({ where: { userId, createdAt: { gte: since } } });
  if (issued >= 5) throw new TelegramLinkError("daily_limit");

  const secret = createTelegramLinkSecret();
  const code = await tx.telegramLinkCode.create({
    data: {
      userId,
      codeHash: hashTelegramLinkSecret(secret),
      createdAt: now,
      expiresAt: new Date(now.getTime() + 10 * 60_000),
    },
    select: { expiresAt: true },
  });
  return { secret, expiresAt: code.expiresAt };
}

export async function recordTelegramStartFailure(tx: Tx, chatId: string, now: Date) {
  const chatHash = createHash("sha256").update(chatId).digest("hex");
  const windowStartedAt = new Date(now.getTime() - 60 * 60_000);
  const rows = await tx.$queryRaw<Array<{ failedAttempts: number }>>`
    INSERT INTO "TelegramStartAttempt" ("chatHash", "failedAttempts", "windowStartedAt", "updatedAt")
    VALUES (${chatHash}, 1, ${now}, ${now})
    ON CONFLICT ("chatHash") DO UPDATE SET
      "failedAttempts" = CASE WHEN "TelegramStartAttempt"."windowStartedAt" <= ${windowStartedAt} THEN 1 ELSE "TelegramStartAttempt"."failedAttempts" + 1 END,
      "windowStartedAt" = CASE WHEN "TelegramStartAttempt"."windowStartedAt" <= ${windowStartedAt} THEN ${now} ELSE "TelegramStartAttempt"."windowStartedAt" END,
      "updatedAt" = ${now}
    RETURNING "failedAttempts"
  `;
  return (rows[0]?.failedAttempts ?? 6) <= 5;
}

export type TelegramStartResult = { response: string | null; linkedUserId?: string; silentlyIgnored?: boolean };

export async function consumeTelegramStart(
  tx: Tx,
  input: { chatId: string; secret: string; now: Date },
): Promise<TelegramStartResult> {
  const genericFailure = "Не удалось привязать Telegram. Создайте новую ссылку в профиле и попробуйте снова.";
  if (!/^\d{1,24}$/.test(input.chatId) || !/^[A-Za-z0-9_-]{16,64}$/.test(input.secret)) {
    const shouldRespond = await recordTelegramStartFailure(tx, input.chatId, input.now);
    return shouldRespond ? { response: genericFailure } : { response: null, silentlyIgnored: true };
  }

  const codeHash = hashTelegramLinkSecret(input.secret);
  const code = await tx.telegramLinkCode.findUnique({
    where: { codeHash },
    select: {
      id: true,
      userId: true,
      expiresAt: true,
      usedAt: true,
      user: { select: { telegramChatId: true, isActive: true } },
    },
  });
  if (code?.usedAt && code.user.telegramChatId === input.chatId && code.user.isActive) {
    return { response: "Telegram уже привязан.", linkedUserId: code.userId };
  }
  if (!code || code.usedAt || code.expiresAt <= input.now || !code.user.isActive) {
    const shouldRespond = await recordTelegramStartFailure(tx, input.chatId, input.now);
    return shouldRespond ? { response: genericFailure } : { response: null, silentlyIgnored: true };
  }

  const locked = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "User" WHERE "id" = ${code.userId} FOR UPDATE
  `;
  if (locked.length === 0) {
    const shouldRespond = await recordTelegramStartFailure(tx, input.chatId, input.now);
    return shouldRespond ? { response: genericFailure } : { response: null, silentlyIgnored: true };
  }
  const currentUser = await tx.user.findUnique({
    where: { id: code.userId },
    select: { id: true, isActive: true, telegramChatId: true },
  });
  if (!currentUser?.isActive) {
    const shouldRespond = await recordTelegramStartFailure(tx, input.chatId, input.now);
    return shouldRespond ? { response: genericFailure } : { response: null, silentlyIgnored: true };
  }

  const used = await tx.telegramLinkCode.updateMany({
    where: { id: code.id, usedAt: null, expiresAt: { gt: input.now } },
    data: { usedAt: input.now },
  });
  if (used.count === 0) {
    const shouldRespond = await recordTelegramStartFailure(tx, input.chatId, input.now);
    return shouldRespond ? { response: genericFailure } : { response: null, silentlyIgnored: true };
  }

  const oldChatId = currentUser.telegramChatId;
  await tx.user.update({ where: { id: currentUser.id }, data: { telegramChatId: input.chatId }, select: { id: true } });
  if (oldChatId && oldChatId !== input.chatId) {
    await enqueueDirectTelegramNotification(tx, {
      userId: currentUser.id,
      chatId: oldChatId,
      event: { kind: "TELEGRAM_UNLINKED" },
      dedupeKey: `telegram-unlinked:${currentUser.id}:${input.now.getTime()}`,
    });
  }
  await enqueueDirectTelegramNotification(tx, {
    userId: currentUser.id,
    chatId: input.chatId,
    event: { kind: "TELEGRAM_LINKED" },
    dedupeKey: `telegram-linked:${code.id}`,
  });
  return { response: null, linkedUserId: currentUser.id };
}

export async function unlinkTelegram(tx: Tx, userId: string, now: Date) {
  await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE
  `;
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: { id: true, isActive: true, role: true, telegramChatId: true },
  });
  if (!user?.isActive) throw new TelegramLinkError("inactive");
  if (user.role !== Role.CLIPPER && user.role !== Role.MODERATOR) throw new TelegramLinkError("wrong_role");
  if (!user.telegramChatId) return false;
  await tx.user.update({ where: { id: userId }, data: { telegramChatId: null }, select: { id: true } });
  await tx.telegramLinkCode.updateMany({ where: { userId, usedAt: null }, data: { usedAt: now } });
  await enqueueDirectTelegramNotification(tx, {
    userId,
    chatId: user.telegramChatId,
    event: { kind: "TELEGRAM_UNLINKED" },
    dedupeKey: `telegram-unlinked:${userId}:${now.getTime()}`,
  });
  return true;
}

export function isUniqueChatConflict(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
