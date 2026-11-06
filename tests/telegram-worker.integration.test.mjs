import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { recoverExpiredNotifications, runTelegramWorker } from "../src/lib/telegram-worker.ts";

const prisma = new PrismaClient();
const createdUsers = new Set();
const createdNotifications = new Set();
const createdLeaseIds = new Set();
const login = (tag) => `${tag}_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(predicate, timeoutMs = 4500) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await predicate();
    if (value) return value;
    await wait(20);
  }
  throw new Error("integration condition timed out");
}

async function addNotification(tag, chatId, options = {}) {
  const user = await prisma.user.create({
    data: { login: login(tag), password: "integration-test-only", telegramChatId: chatId },
    select: { id: true },
  });
  createdUsers.add(user.id);
  const notification = await prisma.notification.create({
    data: {
      userId: user.id,
      kind: options.kind ?? "CHAT_MESSAGE",
      text: "integration test notification",
      createdAt: options.createdAt,
      nextAttemptAt: options.nextAttemptAt ?? new Date(Date.now() - 1000),
      status: options.status ?? "PENDING",
      attempts: options.attempts,
      leaseUntil: options.leaseUntil,
    },
    select: { id: true },
  });
  createdNotifications.add(notification.id);
  return { userId: user.id, notificationId: notification.id };
}

function longPollingMock({ failFirst = false } = {}) {
  let calls = 0;
  return {
    get calls() { return calls; },
    onGetUpdates: async (_token, _body, signal) => {
      calls += 1;
      if (failFirst && calls === 1) throw new Error("simulated getUpdates cycle exception");
      if (signal.aborted) return { ok: false, status: 0, failureCode: "NETWORK" };
      return new Promise((resolve) => {
        signal.addEventListener("abort", () => resolve({ ok: false, status: 0, failureCode: "NETWORK" }), { once: true });
      });
    },
  };
}

function telegramFetch(sendMessage) {
  return async (input, init) => {
    const url = new URL(String(input));
    assert.match(url.pathname, /\/sendMessage$/);
    const body = JSON.parse(String(init?.body));
    return sendMessage(String(body.chat_id), init?.signal);
  };
}

async function startWorker(leaseId, signal, api, fetcher, pollMs = 30) {
  createdLeaseIds.add(leaseId);
  return runTelegramWorker({
    token: "integration-test-token",
    username: "integration_test_bot",
    leaseId,
    signal,
    pollMs,
    onGetUpdates: api.onGetUpdates,
    fetcher,
  });
}

test("outbox sends while getUpdates is active, survives a cycle exception, and ignores DEV_FAKE_NOW", async () => {
  const previousFakeNow = process.env.DEV_FAKE_NOW;
  process.env.DEV_FAKE_NOW = "2000-01-01T00:00:00.000Z";
  const hungChat = `chat_hung_${randomUUID()}`;
  const fastChat = `chat_fast_${randomUUID()}`;
  const hung = await addNotification("worker_hung", hungChat);
  const fast = await addNotification("worker_fast", fastChat);
  const startedAt = Date.now();
  let fastSentAt = 0;
  const api = longPollingMock({ failFirst: true });
  const controller = new AbortController();
  const leaseId = `telegram-worker-test-${randomUUID()}`;
  const worker = startWorker(leaseId, controller.signal, api, telegramFetch((chatId, signal) => {
    if (chatId === hungChat) {
      return new Promise((_resolve, reject) => signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true }));
    }
    assert.equal(chatId, fastChat);
    fastSentAt = Date.now();
    return Response.json({ ok: true, result: {} });
  }));
  try {
    await until(async () => (await prisma.notification.findUnique({ where: { id: fast.notificationId }, select: { status: true } }))?.status === "SENT");
    assert.ok(fastSentAt - startedAt < 1000, `fast recipient waited ${fastSentAt - startedAt}ms`);
    assert.ok(api.calls >= 1, "the long-poll loop was active");
  } finally {
    controller.abort();
    await worker;
    if (previousFakeNow === undefined) delete process.env.DEV_FAKE_NOW;
    else process.env.DEV_FAKE_NOW = previousFakeNow;
    assert.ok(hung.notificationId);
  }
});

test("notifications for one chat are delivered in creation order and at most once per second", async () => {
  const chatId = `chat_order_${randomUUID()}`;
  const user = await prisma.user.create({ data: { login: login("worker_order"), password: "integration-test-only", telegramChatId: chatId }, select: { id: true } });
  createdUsers.add(user.id);
  const createdAt = new Date(Date.now() - 5000);
  const first = await prisma.notification.create({ data: { userId: user.id, kind: "CHAT_MESSAGE", text: "first", createdAt, nextAttemptAt: new Date(Date.now() - 1000) }, select: { id: true } });
  const second = await prisma.notification.create({ data: { userId: user.id, kind: "CHAT_MESSAGE", text: "second", createdAt: new Date(createdAt.getTime() + 1), nextAttemptAt: new Date(Date.now() - 1000) }, select: { id: true } });
  createdNotifications.add(first.id);
  createdNotifications.add(second.id);
  const sends = [];
  const api = longPollingMock();
  const controller = new AbortController();
  const worker = startWorker(`telegram-worker-order-${randomUUID()}`, controller.signal, api, telegramFetch(async () => {
    sends.push(Date.now());
    return Response.json({ ok: true, result: {} });
  }));
  try {
    await until(async () => (await prisma.notification.count({ where: { id: { in: [first.id, second.id] }, status: "SENT" } })) === 2);
    assert.equal(sends.length, 2);
    assert.ok(sends[1] - sends[0] >= 900, `same-chat sends were ${sends[1] - sends[0]}ms apart`);
  } finally {
    controller.abort();
    await worker;
  }
});

test("429 honors retry_after and 403 disables the linked user", async () => {
  const retryChat = `chat_retry_${randomUUID()}`;
  const blockedChat = `chat_blocked_${randomUUID()}`;
  const retry = await addNotification("worker_retry", retryChat);
  const blocked = await addNotification("worker_blocked", blockedChat);
  let firstRetryAt = 0;
  let secondRetryAt = 0;
  const controller = new AbortController();
  const api = longPollingMock();
  const worker = startWorker(`telegram-worker-retries-${randomUUID()}`, controller.signal, api, telegramFetch(async (chatId) => {
    if (chatId === blockedChat) return Response.json({ ok: false, error_code: 403, description: "bot was blocked by the user" }, { status: 403 });
    assert.equal(chatId, retryChat);
    if (!firstRetryAt) {
      firstRetryAt = Date.now();
      return Response.json({ ok: false, error_code: 429, description: "Too Many Requests", parameters: { retry_after: 1 } }, { status: 429 });
    }
    secondRetryAt = Date.now();
    return Response.json({ ok: true, result: {} });
  }));
  try {
    await until(async () => {
      const rows = await prisma.notification.findMany({ where: { id: { in: [retry.notificationId, blocked.notificationId] } }, select: { id: true, status: true, lastErrorCode: true } });
      const byId = new Map(rows.map((row) => [row.id, row]));
      return byId.get(retry.notificationId)?.status === "SENT" && byId.get(blocked.notificationId)?.status === "FAILED";
    }, 6000);
    const [retryRow, blockedRow, userRow] = await Promise.all([
      prisma.notification.findUniqueOrThrow({ where: { id: retry.notificationId }, select: { lastErrorCode: true } }),
      prisma.notification.findUniqueOrThrow({ where: { id: blocked.notificationId }, select: { lastErrorCode: true } }),
      prisma.user.findUniqueOrThrow({ where: { id: blocked.userId }, select: { telegramNotificationsEnabled: true } }),
    ]);
    assert.ok(secondRetryAt - firstRetryAt >= 900);
    assert.equal(retryRow.lastErrorCode, "HTTP_429");
    assert.equal(blockedRow.lastErrorCode, "BLOCKED_BY_USER");
    assert.equal(userRow.telegramNotificationsEnabled, false);
  } finally {
    controller.abort();
    await worker;
  }
});

test("expired SENDING records return to PENDING on recovery", async () => {
  const item = await addNotification("worker_recovery", `chat_recovery_${randomUUID()}`, {
    status: "SENDING", attempts: 1, leaseUntil: new Date(Date.now() - 1000),
  });
  await recoverExpiredNotifications();
  const recovered = await prisma.notification.findUniqueOrThrow({ where: { id: item.notificationId }, select: { status: true, leaseUntil: true, sentAt: true } });
  assert.deepEqual(recovered, { status: "PENDING", leaseUntil: null, sentAt: null });
});

test.after(async () => {
  await prisma.notification.deleteMany({ where: { id: { in: [...createdNotifications] } } });
  await prisma.user.deleteMany({ where: { id: { in: [...createdUsers] } } });
  await prisma.telegramWorkerLease.deleteMany({ where: { id: { in: [...createdLeaseIds] } } });
  await prisma.telegramWorkerState.deleteMany({ where: { id: { in: [...createdLeaseIds] } } });
  await prisma.$disconnect();
});
