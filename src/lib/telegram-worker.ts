import { NotificationKind, NotificationStatus } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { prisma } from "./prisma.ts";
import { callTelegramApi, getTelegramConfig } from "./telegram-api.ts";
import { consumeTelegramStart, isUniqueChatConflict, recordTelegramStartFailure } from "./telegram-link.ts";
import { deliveryFailureOutcome } from "./notification-rules.ts";
import { NOTIFICATION_POLL_MS } from "./config.ts";

const LEASE_ID = "telegram-get-updates";
const LEASE_MS = 30_000;
const HEARTBEAT_MS = 10_000;
const OUTBOX_LEASE_MS = 60_000;
const MAX_ATTEMPTS = 5;
const OUTBOX_BATCH_SIZE = 20;

type TelegramUpdate = {
  update_id: number;
  message?: {
    chat: { id: number; type: string };
    text?: string;
  };
};

type ClaimedNotification = {
  id: string;
  userId: string;
  kind: NotificationKind;
  text: string;
  attempts: number;
  recipientChatId: string | null;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function commandFrom(text: string | undefined) {
  if (!text) return null;
  const match = /^\/(start|stop|help)(?:@[A-Za-z0-9_]+)?(?:\s+([^\s]+))?\s*$/i.exec(text.trim());
  if (!match) return null;
  return { command: match[1].toLowerCase(), argument: match[2] ?? "" };
}

async function acquireLease(workerId: string) {
  const now = new Date();
  await prisma.telegramWorkerLease.upsert({
    where: { id: LEASE_ID },
    create: { id: LEASE_ID, workerId, leaseUntil: new Date(now.getTime() + LEASE_MS) },
    update: {},
  });
  const result = await prisma.telegramWorkerLease.updateMany({
    where: { id: LEASE_ID, OR: [{ workerId }, { leaseUntil: { lt: now } }] },
    data: { workerId, leaseUntil: new Date(now.getTime() + LEASE_MS) },
  });
  return result.count === 1;
}

async function extendLease(workerId: string) {
  const now = new Date();
  const result = await prisma.telegramWorkerLease.updateMany({
    where: { id: LEASE_ID, workerId, leaseUntil: { gt: now } },
    data: { leaseUntil: new Date(now.getTime() + LEASE_MS) },
  });
  return result.count === 1;
}

async function releaseLease(workerId: string) {
  await prisma.telegramWorkerLease.updateMany({
    where: { id: LEASE_ID, workerId },
    data: { leaseUntil: new Date(0) },
  });
}

async function ensureWorkerState() {
  return prisma.telegramWorkerState.upsert({
    where: { id: LEASE_ID },
    create: { id: LEASE_ID, nextOffset: BigInt(0) },
    update: {},
    select: { nextOffset: true },
  });
}

async function sendMessage(token: string, chatId: string, text: string, signal?: AbortSignal) {
  return callTelegramApi<unknown>(token, "sendMessage", { chat_id: chatId, text }, fetch, signal);
}

async function handleStart(token: string, chatId: string, secret: string, signal: AbortSignal) {
  try {
    const result = await prisma.$transaction((tx) => consumeTelegramStart(tx, { chatId, secret, now: new Date() }));
    if (result.response) await sendMessage(token, chatId, result.response, signal);
  } catch (error) {
    if (isUniqueChatConflict(error)) {
      const response = await prisma.$transaction(async (tx) => {
        const allowed = await recordTelegramStartFailure(tx, chatId, new Date());
        return allowed ? "Не удалось привязать Telegram. Создайте новую ссылку в профиле и попробуйте снова." : null;
      });
      if (response) await sendMessage(token, chatId, response, signal);
      return;
    }
    throw error;
  }
}

async function handleCommand(token: string, update: TelegramUpdate, signal: AbortSignal) {
  const message = update.message;
  if (!message || !Number.isSafeInteger(message.chat.id)) return;
  const parsed = commandFrom(message.text);
  if (!parsed) return;
  const chatId = String(message.chat.id);

  if (parsed.command === "help") {
    if (message.chat.type === "private") {
      await sendMessage(token, chatId, "Привязка: нажмите «Привязать Telegram» в профиле и откройте ссылку. Команда /stop отключает уведомления.", signal);
    }
    return;
  }
  if (message.chat.type !== "private") {
    return;
  }

  if (parsed.command === "start") {
    await handleStart(token, chatId, parsed.argument, signal);
    return;
  }

  if (parsed.command === "stop") {
    await prisma.user.updateMany({
      where: { telegramChatId: chatId, isActive: true },
      data: { telegramNotificationsEnabled: false },
    });
    const user = await prisma.user.findFirst({ where: { telegramChatId: chatId, isActive: true }, select: { id: true } });
    if (user) await sendMessage(token, chatId, "Уведомления отключены. Включить их снова можно в профиле.", signal);
  }
}

async function processUpdates(token: string, updates: TelegramUpdate[], signal: AbortSignal) {
  for (const update of updates) {
    if (signal.aborted) return;
    try {
      await handleCommand(token, update, signal);
    } catch {
      // Do not log Telegram response bodies, user text, chat IDs, or request URLs.
      console.warn("Telegram update processing failed", { updateType: update.message?.text?.startsWith("/start") ? "start" : "command" });
    }
  }

  if (updates.length === 0) return;
  if (updates.some((update) => !Number.isSafeInteger(update.update_id) || update.update_id < 0)) {
    throw new Error("invalid_telegram_update_id");
  }
  const nextOffset = BigInt(Math.max(...updates.map((update) => update.update_id)) + 1);
  await prisma.telegramWorkerState.updateMany({
    where: { id: LEASE_ID, nextOffset: { lt: nextOffset } },
    data: { nextOffset },
  });
}

async function claimNotifications() {
  return prisma.$transaction(async (tx) => {
    const now = new Date();
    const candidates = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "Notification"
      WHERE "attempts" < ${MAX_ATTEMPTS}
        AND "status" = 'PENDING'::"NotificationStatus"
        AND "nextAttemptAt" <= ${now}
      ORDER BY "nextAttemptAt", "createdAt"
      LIMIT ${OUTBOX_BATCH_SIZE}
      FOR UPDATE SKIP LOCKED
    `;
    if (candidates.length === 0) return [];

    const ids = candidates.map(({ id }) => id);
    await tx.notification.updateMany({
      where: { id: { in: ids }, status: NotificationStatus.PENDING, attempts: { lt: MAX_ATTEMPTS } },
      data: {
        status: NotificationStatus.SENDING,
        attempts: { increment: 1 },
        leaseUntil: new Date(now.getTime() + OUTBOX_LEASE_MS),
        sentAt: null,
      },
    });
    return tx.notification.findMany({
      where: { id: { in: ids }, status: NotificationStatus.SENDING },
      select: { id: true, userId: true, kind: true, text: true, attempts: true, recipientChatId: true },
      orderBy: [{ nextAttemptAt: "asc" }, { createdAt: "asc" }],
    });
  });
}

async function recoverExpiredNotifications() {
  const now = new Date();
  await prisma.$executeRaw`
    UPDATE "Notification"
    SET "status" = CASE WHEN "attempts" >= ${MAX_ATTEMPTS}
      THEN 'FAILED'::"NotificationStatus" ELSE 'PENDING'::"NotificationStatus" END,
        "leaseUntil" = NULL,
        "sentAt" = NULL
    WHERE "status" = 'SENDING'::"NotificationStatus" AND "leaseUntil" <= ${now}
  `;
}

async function updateNotificationResult(
  notification: ClaimedNotification,
  result: { status: "SENT" | "PENDING" | "FAILED"; delayMs?: number },
) {
  await prisma.notification.updateMany({
    where: { id: notification.id, status: NotificationStatus.SENDING },
    data: {
      status: result.status,
      sentAt: result.status === "SENT" ? new Date() : null,
      nextAttemptAt: result.status === "PENDING" ? new Date(Date.now() + (result.delayMs ?? 1000)) : undefined,
      leaseUntil: null,
    },
  });
}

async function deliverNotification(token: string, notification: ClaimedNotification, signal: AbortSignal) {
  const user = await prisma.user.findUnique({
    where: { id: notification.userId },
    select: { isActive: true, telegramChatId: true, telegramNotificationsEnabled: true },
  });
  const isUnlinkNotice = notification.kind === NotificationKind.TELEGRAM_UNLINKED && Boolean(notification.recipientChatId);
  if (!user?.isActive || (!isUnlinkNotice && !user.telegramNotificationsEnabled)) {
    await updateNotificationResult(notification, { status: "FAILED" });
    return;
  }
  const chatId = notification.recipientChatId ?? user.telegramChatId;
  if (!chatId) {
    await updateNotificationResult(notification, { status: "FAILED" });
    return;
  }

  const response = await sendMessage(token, chatId, notification.text, signal);
  if (signal.aborted) return;
  if (response.ok) {
    await updateNotificationResult(notification, { status: "SENT" });
    return;
  }
  if (response.status === 403) {
    await prisma.user.updateMany({ where: { id: notification.userId }, data: { telegramNotificationsEnabled: false } });
    await updateNotificationResult(notification, { status: "FAILED" });
    console.warn("Telegram user blocked the bot", { kind: notification.kind });
    return;
  }
  if (notification.attempts >= MAX_ATTEMPTS) {
    await updateNotificationResult(notification, { status: "FAILED" });
  } else {
    await updateNotificationResult(notification, deliveryFailureOutcome(notification.attempts, response.retryAfterSeconds));
  }
  console.warn("Telegram delivery failed", { status: response.status, kind: notification.kind, attempt: notification.attempts });
}

async function cleanOldNotifications() {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60_000);
  await prisma.notification.deleteMany({ where: { status: { in: [NotificationStatus.SENT, NotificationStatus.FAILED] }, createdAt: { lt: cutoff } } });
  await prisma.telegramLinkCode.deleteMany({ where: { OR: [{ expiresAt: { lt: cutoff } }, { usedAt: { lt: cutoff } }] } });
  await prisma.telegramStartAttempt.deleteMany({ where: { updatedAt: { lt: new Date(Date.now() - 24 * 60 * 60_000) } } });
}

export async function runTelegramWorker() {
  const config = getTelegramConfig();
  if (!config) throw new Error("Telegram worker configuration is missing.");

  const workerId = randomUUID();
  const acquired = await acquireLease(workerId);
  if (!acquired) {
    console.warn("Telegram worker lease is held by another process.");
    return;
  }
  await ensureWorkerState();

  let stopping = false;
  let leaseLost = false;
  let lastCleanupAt = 0;
  let lastRecoveryAt = 0;
  const pollAbort = new AbortController();
  const loseLease = () => {
    leaseLost = true;
    pollAbort.abort();
    console.error("Telegram worker lease lost; exiting.");
  };
  let heartbeatPromise = Promise.resolve();
  const heartbeat = setInterval(() => {
    heartbeatPromise = heartbeatPromise.then(async () => {
      if (stopping || leaseLost) return;
      try {
        if (!await extendLease(workerId)) loseLease();
      } catch {
        loseLease();
        console.error("Telegram worker lease renewal failed; exiting.");
      }
    });
  }, HEARTBEAT_MS);
  const stop = () => {
    stopping = true;
    pollAbort.abort();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  const outboxLoop = async () => {
    while (!stopping && !leaseLost) {
      const nowMs = Date.now();
      if (nowMs - lastRecoveryAt >= OUTBOX_LEASE_MS) {
        try {
          await recoverExpiredNotifications();
          lastRecoveryAt = nowMs;
        } catch {
          console.warn("Telegram lease recovery failed.");
        }
      }
      if (nowMs - lastCleanupAt >= 24 * 60 * 60_000) {
        try {
          await cleanOldNotifications();
          lastCleanupAt = nowMs;
        } catch {
          console.warn("Telegram cleanup failed.");
        }
      }

      try {
        const claimed = await claimNotifications();
        if (claimed.length === 0) {
          await sleep(NOTIFICATION_POLL_MS);
          continue;
        }
        for (const notification of claimed) {
          if (stopping || leaseLost) break;
          try {
            await deliverNotification(config.token, notification, pollAbort.signal);
          } catch {
            if (!leaseLost && !stopping) {
              await updateNotificationResult(notification, deliveryFailureOutcome(notification.attempts));
              console.warn("Telegram delivery processing failed", { kind: notification.kind, attempt: notification.attempts });
            }
          }
          await sleep(50);
        }
      } catch {
        if (!stopping && !leaseLost) console.warn("Telegram outbox polling failed.");
        await sleep(NOTIFICATION_POLL_MS);
      }
    }
  };

  const updatesLoop = async () => {
    while (!stopping && !leaseLost) {
      if (!await extendLease(workerId)) {
        loseLease();
        break;
      }
      const state = await ensureWorkerState();
      const offset = Number(state.nextOffset);
      if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("invalid_telegram_offset");
      if (!await extendLease(workerId)) {
        loseLease();
        break;
      }
      let updates;
      try {
        updates = await callTelegramApi<TelegramUpdate[]>(config.token, "getUpdates", {
          offset,
          timeout: 30,
          allowed_updates: ["message"],
        }, fetch, pollAbort.signal, 35_000);
      } catch {
        if (!stopping && !leaseLost) {
          console.warn("Telegram getUpdates request failed.");
          await sleep(1000);
        }
        continue;
      }
      if (stopping || leaseLost) break;
      if (!updates.ok) {
        console.warn("Telegram getUpdates failed", { status: updates.status });
        await sleep(updates.status === 409 ? 5000 : 1000);
        continue;
      }
      try {
        await processUpdates(config.token, updates.result, pollAbort.signal);
      } catch {
        console.error("Telegram update batch failed; offset was not advanced.");
        await sleep(1000);
      }
    }
  };

  try {
    await Promise.all([updatesLoop(), outboxLoop()]);
  } finally {
    clearInterval(heartbeat);
    stop();
    await heartbeatPromise;
    await releaseLease(workerId).catch(() => undefined);
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
}
