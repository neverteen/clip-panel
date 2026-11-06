import { NotificationKind, NotificationStatus, Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { prisma } from "./prisma.ts";
import { callTelegramApi, getTelegramConfig, type TelegramApiResult } from "./telegram-api.ts";
import { consumeTelegramStart, isUniqueChatConflict, recordTelegramStartFailure } from "./telegram-link.ts";
import { deliveryFailureOutcome } from "./notification-rules.ts";
import { NOTIFICATION_POLL_MS } from "./config.ts";
import { cleanOrphanedUploads } from "./attachment-storage.ts";

const LEASE_ID = "telegram-get-updates";
const LEASE_MS = 30_000;
const HEARTBEAT_MS = 10_000;
const OUTBOX_LEASE_MS = 30_000;
const MAX_ATTEMPTS = 5;
const OUTBOX_BATCH_SIZE = 10;
const MAX_CONCURRENT_SENDS = 5;
const SENDS_PER_SECOND = 20;
const PER_CHAT_INTERVAL_MS = 1000;

type TelegramUpdate = {
  update_id: number;
  message?: {
    chat: { id: number; type: string };
    text?: string;
  };
};

type NotificationErrorCode = "HTTP_429" | "HTTP_403" | "HTTP_400" | "HTTP_5XX" | "TIMEOUT" | "NETWORK" | "BLOCKED_BY_USER" | "INVALID_CHAT";
type ClaimedNotification = {
  id: string;
  userId: string;
  kind: NotificationKind;
  text: string;
  attempts: number;
  createdAt: Date;
  recipientChatId: string | null;
};

export type TelegramWorkerOptions = {
  leaseId?: string;
  token?: string;
  username?: string;
  fetcher?: typeof fetch;
  pollMs?: number;
  signal?: AbortSignal;
  onGetUpdates?: (token: string, body: Record<string, unknown>, signal: AbortSignal) => Promise<TelegramApiResult<TelegramUpdate[]>>;
};

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(done, Math.max(0, ms));
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}

function backoffWithJitter(ms: number) {
  return Math.max(0, Math.round(ms * (0.8 + Math.random() * 0.4)));
}

function commandFrom(text: string | undefined) {
  if (!text) return null;
  const match = /^\/(start|stop|help)(?:@[A-Za-z0-9_]+)?(?:\s+([^\s]+))?\s*$/i.exec(text.trim());
  if (!match) return null;
  return { command: match[1].toLowerCase(), argument: match[2] ?? "" };
}

async function acquireLease(workerId: string, leaseId: string) {
  await prisma.telegramWorkerLease.upsert({
    where: { id: leaseId },
    create: { id: leaseId, workerId, leaseUntil: new Date(Date.now() + LEASE_MS) },
    update: {},
  });
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    UPDATE "TelegramWorkerLease"
    SET "workerId" = ${workerId}, "leaseUntil" = NOW() + INTERVAL '30 seconds', "updatedAt" = NOW()
    WHERE "id" = ${leaseId}
      AND ("workerId" = ${workerId} OR "leaseUntil" < NOW())
    RETURNING "id"
  `;
  return rows.length === 1;
}

async function extendLease(workerId: string, leaseId: string) {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    UPDATE "TelegramWorkerLease"
    SET "leaseUntil" = NOW() + INTERVAL '30 seconds', "updatedAt" = NOW()
    WHERE "id" = ${leaseId} AND "workerId" = ${workerId} AND "leaseUntil" > NOW()
    RETURNING "id"
  `;
  return rows.length === 1;
}

async function releaseLease(workerId: string, leaseId: string) {
  await prisma.$executeRaw`
    UPDATE "TelegramWorkerLease" SET "leaseUntil" = NOW(), "updatedAt" = NOW()
    WHERE "id" = ${leaseId} AND "workerId" = ${workerId}
  `;
}

async function ensureWorkerState(leaseId: string) {
  return prisma.telegramWorkerState.upsert({
    where: { id: leaseId },
    create: { id: leaseId, nextOffset: BigInt(0) },
    update: {},
    select: { nextOffset: true },
  });
}

async function sendMessage(token: string, chatId: string, text: string, signal: AbortSignal, fetcher: typeof fetch) {
  return callTelegramApi<unknown>(token, "sendMessage", { chat_id: chatId, text }, fetcher, signal, 10_000);
}

async function handleStart(token: string, chatId: string, secret: string, signal: AbortSignal, fetcher: typeof fetch) {
  try {
    const result = await prisma.$transaction((tx) => consumeTelegramStart(tx, { chatId, secret, now: new Date() }));
    if (result.response) await sendMessage(token, chatId, result.response, signal, fetcher);
  } catch (error) {
    if (!isUniqueChatConflict(error)) throw error;
    const response = await prisma.$transaction(async (tx) => {
      const allowed = await recordTelegramStartFailure(tx, chatId, new Date());
      return allowed ? "Не удалось привязать Telegram. Создайте новую ссылку в профиле и попробуйте снова." : null;
    });
    if (response) await sendMessage(token, chatId, response, signal, fetcher);
  }
}

async function handleCommand(token: string, update: TelegramUpdate, signal: AbortSignal, fetcher: typeof fetch) {
  const message = update.message;
  if (!message || !Number.isSafeInteger(message.chat.id)) return;
  const parsed = commandFrom(message.text);
  if (!parsed) return;
  const chatId = String(message.chat.id);

  if (parsed.command === "help") {
    if (message.chat.type === "private") {
      await sendMessage(token, chatId, "Для привязки нажмите «Привязать Telegram» в профиле и откройте ссылку. Команда /stop отключает уведомления.", signal, fetcher);
    }
    return;
  }
  if (message.chat.type !== "private") return;
  if (parsed.command === "start") {
    await handleStart(token, chatId, parsed.argument, signal, fetcher);
    return;
  }
  if (parsed.command === "stop") {
    await prisma.user.updateMany({
      where: { telegramChatId: chatId, isActive: true },
      data: { telegramNotificationsEnabled: false },
    });
    const user = await prisma.user.findFirst({ where: { telegramChatId: chatId, isActive: true }, select: { id: true } });
    if (user) await sendMessage(token, chatId, "Уведомления отключены. Включить их снова можно в профиле.", signal, fetcher);
  }
}

async function processUpdates(token: string, updates: TelegramUpdate[], signal: AbortSignal, fetcher: typeof fetch, leaseId: string) {
  for (const update of updates) {
    if (signal.aborted) return;
    try {
      await handleCommand(token, update, signal, fetcher);
    } catch {
      console.warn("Telegram update command failed", { updateId: update.update_id, command: update.message?.text?.startsWith("/start") ? "start" : "command" });
    }
  }
  if (updates.length === 0) return;
  if (updates.some((update) => !Number.isSafeInteger(update.update_id) || update.update_id < 0)) throw new Error("invalid_telegram_update_id");
  const nextOffset = BigInt(Math.max(...updates.map((update) => update.update_id)) + 1);
  await prisma.telegramWorkerState.updateMany({
    where: { id: leaseId, nextOffset: { lt: nextOffset } },
    data: { nextOffset },
  });
}

async function claimNotifications(limit: number): Promise<ClaimedNotification[]> {
  if (limit <= 0) return [];
  return prisma.$transaction(async (tx) => {
    const candidates = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT n."id" FROM "Notification" n
      JOIN "User" u ON u."id" = n."userId"
      WHERE n."attempts" < ${MAX_ATTEMPTS}
        AND n."status" = 'PENDING'::"NotificationStatus"
        AND n."nextAttemptAt" <= NOW()
        AND NOT EXISTS (
          SELECT 1 FROM "Notification" older
          JOIN "User" older_user ON older_user."id" = older."userId"
          WHERE COALESCE(older."recipientChatId", older_user."telegramChatId") = COALESCE(n."recipientChatId", u."telegramChatId")
            AND (older."createdAt" < n."createdAt" OR (older."createdAt" = n."createdAt" AND older."id" < n."id"))
            AND older."status" IN ('PENDING'::"NotificationStatus", 'SENDING'::"NotificationStatus")
        )
      ORDER BY n."createdAt", n."id"
      LIMIT ${limit}
      FOR UPDATE OF n SKIP LOCKED
    `;
    if (candidates.length === 0) return [];
    const ids = candidates.map(({ id }) => id);
    await tx.notification.updateMany({
      where: { id: { in: ids }, status: NotificationStatus.PENDING, attempts: { lt: MAX_ATTEMPTS } },
      data: {
        status: NotificationStatus.SENDING,
        attempts: { increment: 1 },
        leaseUntil: new Date(Date.now() + OUTBOX_LEASE_MS),
        sentAt: null,
      },
    });
    return tx.$queryRaw<ClaimedNotification[]>`
      SELECT n."id", n."userId", n."kind", n."text", n."attempts", n."createdAt",
        COALESCE(n."recipientChatId", u."telegramChatId") AS "recipientChatId"
      FROM "Notification" n JOIN "User" u ON u."id" = n."userId"
      WHERE n."id" IN (${Prisma.join(ids)}) AND n."status" = 'SENDING'::"NotificationStatus"
      ORDER BY n."createdAt", n."id"
    `;
  });
}

export async function recoverExpiredNotifications() {
  await prisma.$executeRaw`
    UPDATE "Notification"
    SET "status" = CASE WHEN "attempts" >= ${MAX_ATTEMPTS}
      THEN 'FAILED'::"NotificationStatus" ELSE 'PENDING'::"NotificationStatus" END,
        "leaseUntil" = NULL,
        "sentAt" = NULL,
        "lastErrorCode" = CASE WHEN "attempts" >= ${MAX_ATTEMPTS}
          THEN COALESCE("lastErrorCode", 'NETWORK') ELSE "lastErrorCode" END
    WHERE "status" = 'SENDING'::"NotificationStatus" AND "leaseUntil" <= NOW()
  `;
}

async function updateNotificationResult(
  notification: ClaimedNotification,
  result: { status: "SENT" | "PENDING" | "FAILED"; delayMs?: number; errorCode?: NotificationErrorCode },
) {
  await prisma.notification.updateMany({
    where: { id: notification.id, status: NotificationStatus.SENDING },
    data: {
      status: result.status,
      sentAt: result.status === "SENT" ? new Date() : null,
      nextAttemptAt: result.status === "PENDING" ? new Date(Date.now() + (result.delayMs ?? 1000)) : undefined,
      leaseUntil: null,
      lastErrorCode: result.status === "SENT" ? undefined : (result.errorCode ?? "NETWORK"),
    },
  });
}

async function deliverNotification(token: string, notification: ClaimedNotification, signal: AbortSignal, fetcher: typeof fetch) {
  const user = await prisma.user.findUnique({
    where: { id: notification.userId },
    select: { isActive: true, telegramChatId: true, telegramNotificationsEnabled: true },
  });
  const isUnlinkNotice = notification.kind === NotificationKind.TELEGRAM_UNLINKED && Boolean(notification.recipientChatId);
  if (!user?.isActive || (!isUnlinkNotice && !user.telegramNotificationsEnabled)) {
    await updateNotificationResult(notification, { status: "FAILED", errorCode: "BLOCKED_BY_USER" });
    console.info("Telegram notification skipped", { id: notification.id, kind: notification.kind, code: "BLOCKED_BY_USER" });
    return;
  }
  const chatId = notification.recipientChatId ?? user.telegramChatId;
  if (!chatId) {
    await updateNotificationResult(notification, { status: "FAILED", errorCode: "INVALID_CHAT" });
    console.info("Telegram notification skipped", { id: notification.id, kind: notification.kind, code: "INVALID_CHAT" });
    return;
  }

  const latencySeconds = Math.max(0, (Date.now() - notification.createdAt.getTime()) / 1000);
  console.info("Telegram notification attempt", { id: notification.id, kind: notification.kind, latencySeconds: Number(latencySeconds.toFixed(2)) });
  if (latencySeconds > 30) console.warn("Telegram notification delayed", { id: notification.id, kind: notification.kind, latencySeconds: Number(latencySeconds.toFixed(2)) });
  const response = await sendMessage(token, chatId, notification.text, signal, fetcher);
  if (signal.aborted) return;
  if (response.ok) {
    await updateNotificationResult(notification, { status: "SENT" });
    console.info("Telegram notification sent", { id: notification.id, kind: notification.kind, latencySeconds: Number(latencySeconds.toFixed(2)) });
    return;
  }
  if (response.failureCode === "HTTP_403") {
    await prisma.user.updateMany({ where: { id: notification.userId }, data: { telegramNotificationsEnabled: false } });
    await updateNotificationResult(notification, { status: "FAILED", errorCode: "BLOCKED_BY_USER" });
    console.warn("Telegram notification failed", { id: notification.id, kind: notification.kind, code: "BLOCKED_BY_USER", status: response.status, attempt: notification.attempts });
    return;
  }
  if (response.failureCode === "INVALID_CHAT") {
    await updateNotificationResult(notification, { status: "FAILED", errorCode: "INVALID_CHAT" });
    console.warn("Telegram notification failed", { id: notification.id, kind: notification.kind, code: "INVALID_CHAT", status: response.status, attempt: notification.attempts });
    return;
  }
  const outcome = deliveryFailureOutcome(notification.attempts, response.retryAfterSeconds);
  await updateNotificationResult(notification, { ...outcome, errorCode: response.failureCode });
  console.warn("Telegram notification failed", { id: notification.id, kind: notification.kind, code: response.failureCode, status: response.status, attempt: notification.attempts });
}

async function cleanOldNotifications() {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60_000);
  await prisma.notification.deleteMany({ where: { status: { in: [NotificationStatus.SENT, NotificationStatus.FAILED] }, createdAt: { lt: cutoff } } });
  await prisma.telegramLinkCode.deleteMany({ where: { OR: [{ expiresAt: { lt: cutoff } }, { usedAt: { lt: cutoff } }] } });
  await prisma.telegramStartAttempt.deleteMany({ where: { updatedAt: { lt: new Date(Date.now() - 24 * 60 * 60_000) } } });
  try {
    const removedUploads = await cleanOrphanedUploads(new Date());
    console.info("Orphaned chat uploads cleanup completed", { removed: removedUploads });
  } catch {
    console.warn("Orphaned chat uploads cleanup failed.");
  }
}

async function writeHeartbeat(workerId: string, leaseId: string, latencies: number[]) {
  const [counts, oldest, lease, failedLast24h] = await Promise.all([
    prisma.notification.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.notification.findFirst({ where: { status: NotificationStatus.PENDING }, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
    prisma.telegramWorkerLease.findUnique({ where: { id: leaseId }, select: { workerId: true, leaseUntil: true } }),
    prisma.notification.groupBy({ by: ["status"], where: { status: NotificationStatus.FAILED, createdAt: { gte: new Date(Date.now() - 24 * 60 * 60_000) } }, _count: { _all: true } }),
  ]);
  const count = (status: NotificationStatus) => counts.find((row) => row.status === status)?._count._all ?? 0;
  const meanLatency = latencies.length ? latencies.reduce((sum, value) => sum + value, 0) / latencies.length : null;
  console.info("Telegram worker heartbeat", {
    pending: count(NotificationStatus.PENDING),
    sending: count(NotificationStatus.SENDING),
    failed24h: failedLast24h[0]?._count._all ?? 0,
    oldestPendingAgeSeconds: oldest ? Math.max(0, Math.round((Date.now() - oldest.createdAt.getTime()) / 1000)) : null,
    averageDeliveryLatencySecondsLastMinute: meanLatency === null ? null : Number(meanLatency.toFixed(2)),
    lease: lease?.workerId === workerId && lease.leaseUntil.getTime() > Date.now() ? "held" : "not_held",
  });
}

export async function runTelegramWorker(options: TelegramWorkerOptions = {}) {
  const envConfig = getTelegramConfig();
  const token = options.token ?? envConfig?.token;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is missing; Telegram worker cannot start.");
  const config = { token, username: options.username ?? envConfig?.username ?? "" };
  const fetcher = options.fetcher ?? fetch;
  const leaseId = options.leaseId ?? LEASE_ID;
  const pollMs = options.pollMs ?? NOTIFICATION_POLL_MS;
  const getUpdatesRequest = options.onGetUpdates ?? ((requestToken, body, signal) =>
    callTelegramApi<TelegramUpdate[]>(requestToken, "getUpdates", body, fetcher, signal, 35_000));
  const workerId = randomUUID();
  if (!await acquireLease(workerId, leaseId)) throw new Error("Telegram worker lease is held by another process.");
  await ensureWorkerState(leaseId);
  await recoverExpiredNotifications();

  let stopping = false;
  let leaseLost = false;
  let lastCleanupAt = 0;
  let resolveFatal = () => {};
  const fatalPromise = new Promise<void>((resolve) => { resolveFatal = resolve; });
  const pollAbort = new AbortController();
  const stop = () => { stopping = true; pollAbort.abort(); };
  const externalStop = () => stop();
  if (options.signal?.aborted) stop();
  else options.signal?.addEventListener("abort", externalStop, { once: true });

  console.info("Telegram worker started", { version: process.env.npm_package_version ?? "dev", pollMs });
  const leaseHeartbeat = setInterval(() => {
    void extendLease(workerId, leaseId).then((extended) => {
      if (extended || stopping || leaseLost) return;
      leaseLost = true;
      console.error("Telegram worker lease lost; exiting for supervisor restart.");
      stop();
      resolveFatal();
    }).catch(() => {
      leaseLost = true;
      console.error("Telegram worker lease renewal failed; exiting for supervisor restart.");
      stop();
      resolveFatal();
    });
  }, HEARTBEAT_MS);

  const latencies: number[] = [];
  const activeDeliveries = new Map<string, Promise<void>>();
  const nextChatSendAt = new Map<string, number>();
  let nextGlobalSendAt = 0;

  const dispatch = (notification: ClaimedNotification) => {
    const chatKey = notification.recipientChatId ?? `user:${notification.userId}`;
    const now = Date.now();
    const scheduledAt = Math.max(now, nextGlobalSendAt, nextChatSendAt.get(chatKey) ?? 0);
    nextGlobalSendAt = scheduledAt + Math.ceil(1000 / SENDS_PER_SECOND);
    nextChatSendAt.set(chatKey, scheduledAt + PER_CHAT_INTERVAL_MS);
    const task = (async () => {
      await sleep(scheduledAt - Date.now(), pollAbort.signal);
      if (stopping || leaseLost) return;
      try {
        const latency = Math.max(0, (Date.now() - notification.createdAt.getTime()) / 1000);
        await deliverNotification(config.token, notification, pollAbort.signal, fetcher);
        latencies.push(latency);
      } catch {
        if (stopping || leaseLost) return;
        await updateNotificationResult(notification, { ...deliveryFailureOutcome(notification.attempts), errorCode: "NETWORK" }).catch(() => undefined);
        console.error("Telegram notification processing failed", { id: notification.id, kind: notification.kind, code: "NETWORK", attempt: notification.attempts });
      }
    })().catch(() => undefined).finally(() => { activeDeliveries.delete(notification.id); });
    activeDeliveries.set(notification.id, task);
  };

  let updateBackoffMs = 1000;
  const updateCycle = async () => {
    if (!await extendLease(workerId, leaseId)) throw new Error("telegram_lease_lost");
    const state = await ensureWorkerState(leaseId);
    const offset = Number(state.nextOffset);
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("invalid_telegram_offset");
    if (!await extendLease(workerId, leaseId)) throw new Error("telegram_lease_lost");
    const updates = await getUpdatesRequest(config.token, { offset, timeout: 30, allowed_updates: ["message"] }, pollAbort.signal);
    if (stopping || leaseLost) return;
    if (!updates.ok) {
      const code = updates.status === 409 ? "HTTP_409" : updates.status === 0 ? "NETWORK_OR_TIMEOUT" : `HTTP_${updates.status}`;
      const retryInMs = backoffWithJitter(updateBackoffMs);
      console.warn("Telegram getUpdates request failed", { code, retryInMs });
      await sleep(retryInMs, pollAbort.signal);
      updateBackoffMs = Math.min(60_000, updateBackoffMs * 2);
      return;
    }
    updateBackoffMs = 1000;
    await processUpdates(config.token, updates.result, pollAbort.signal, fetcher, leaseId);
  };

  const outboxCycle = async () => {
    await recoverExpiredNotifications();
    if (Date.now() - lastCleanupAt >= 24 * 60 * 60_000) {
      await cleanOldNotifications();
      lastCleanupAt = Date.now();
    }
    const capacity = MAX_CONCURRENT_SENDS - activeDeliveries.size;
    if (capacity > 0) {
      const claimed = await claimNotifications(Math.min(OUTBOX_BATCH_SIZE, capacity));
      for (const notification of claimed) dispatch(notification);
    }
    if (activeDeliveries.size === 0) await sleep(pollMs, pollAbort.signal);
    else if (activeDeliveries.size >= MAX_CONCURRENT_SENDS) {
      await Promise.race([sleep(pollMs, pollAbort.signal), ...activeDeliveries.values()]);
    } else {
      await sleep(pollMs, pollAbort.signal);
    }
  };

  const supervise = async (name: string, cycle: () => Promise<void>) => {
    let delayMs = 1000;
    while (!stopping && !leaseLost) {
      try {
        await cycle();
        delayMs = 1000;
      } catch {
        if (stopping || leaseLost) break;
        console.error(`Telegram ${name} cycle failed; restarting`, { retryInMs: backoffWithJitter(delayMs) });
        await sleep(backoffWithJitter(delayMs), pollAbort.signal);
        delayMs = Math.min(30_000, delayMs * 2);
      }
    }
  };

  const updatesTask = supervise("getUpdates", updateCycle);
  const outboxTask = supervise("outbox", outboxCycle);
  let heartbeatAt = Date.now();
  try {
    while (!stopping && !leaseLost) {
      await Promise.race([sleep(500, pollAbort.signal), fatalPromise]);
      if (Date.now() - heartbeatAt >= 60_000) {
        heartbeatAt = Date.now();
        await writeHeartbeat(workerId, leaseId, latencies.splice(0)).catch(() => console.warn("Telegram worker heartbeat query failed."));
      }
    }
  } finally {
    stop();
    clearInterval(leaseHeartbeat);
    await Promise.allSettled([updatesTask, outboxTask, ...activeDeliveries.values()]);
    await releaseLease(workerId, leaseId).catch(() => undefined);
    options.signal?.removeEventListener("abort", externalStop);
  }
  if (leaseLost) throw new Error("Telegram worker lease lost; restart required.");
}
