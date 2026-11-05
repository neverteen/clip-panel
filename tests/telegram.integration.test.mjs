import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { createTelegramLinkCode, consumeTelegramStart, TelegramLinkError } from "../src/lib/telegram-link.ts";
import { enqueueUserNotification } from "../src/lib/telegram-notifications.ts";
import { createTelegramLinkSecret, hashTelegramLinkSecret } from "../src/lib/telegram-rules.ts";

const prisma = new PrismaClient();
const rollbackMarker = (error) => error?.message === "rollback_test_data";
const newLogin = (tag) => `${tag}_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
const violatesCheck = (name) => (error) => [error?.message, error?.stack, error?.cause?.message].filter(Boolean).join(" ").includes(name);

test("Telegram code creation, expiry, use, foreign chat, idempotent redelivery and transaction rollback", async () => {
  const now = new Date();
  let testUserId = "";
  await assert.rejects(prisma.$transaction(async (tx) => {
    const user = await tx.user.create({ data: { login: newLogin("tg_link"), password: "integration-test-only" }, select: { id: true } });
    testUserId = user.id;
    const issued = await createTelegramLinkCode(tx, user.id, now);
    const stored = await tx.telegramLinkCode.findUnique({ where: { codeHash: hashTelegramLinkSecret(issued.secret) } });
    assert.ok(stored);
    assert.notEqual(stored.codeHash, issued.secret);
    assert.equal(stored.expiresAt.getTime(), now.getTime() + 10 * 60_000);

    const linked = await consumeTelegramStart(tx, { chatId: "700000001", secret: issued.secret, now });
    assert.equal(linked.linkedUserId, user.id);
    assert.equal(linked.response, null);
    assert.equal((await tx.user.findUnique({ where: { id: user.id }, select: { telegramChatId: true } }))?.telegramChatId, "700000001");

    const duplicateDelivery = await consumeTelegramStart(tx, { chatId: "700000001", secret: issued.secret, now });
    assert.equal(duplicateDelivery.response, "Telegram уже привязан.");

    const foreignChat = await consumeTelegramStart(tx, { chatId: "700000002", secret: issued.secret, now });
    assert.match(foreignChat.response ?? "", /Не удалось привязать Telegram/);
    assert.equal((await tx.user.findUnique({ where: { id: user.id }, select: { telegramChatId: true } }))?.telegramChatId, "700000001");

    const expiredIssue = await createTelegramLinkCode(tx, user.id, now);
    const expired = await consumeTelegramStart(tx, {
      chatId: "700000003",
      secret: expiredIssue.secret,
      now: new Date(now.getTime() + 10 * 60_000),
    });
    assert.equal(expired.response, foreignChat.response);

    const invalidSecret = createTelegramLinkSecret();
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const invalid = await consumeTelegramStart(tx, { chatId: "700000004", secret: invalidSecret, now });
      assert.equal(invalid.response, foreignChat.response);
    }
    const silenced = await consumeTelegramStart(tx, { chatId: "700000004", secret: invalidSecret, now });
    assert.equal(silenced.response, null);
    assert.equal(silenced.silentlyIgnored, true);
    throw new Error("rollback_test_data");
  }), rollbackMarker);

  assert.equal(await prisma.user.count({ where: { login: { startsWith: "tg_link_" } } }), 0);
  assert.equal(await prisma.telegramLinkCode.count({ where: { userId: testUserId } }), 0);
  assert.equal(await prisma.notification.count({ where: { userId: testUserId } }), 0);
});

test("Telegram linking refuses a chat already owned by another user and caps code creation", async () => {
  await assert.rejects(prisma.$transaction(async (tx) => {
    const first = await tx.user.create({ data: { login: newLogin("tg_owner"), password: "integration-test-only", telegramChatId: "710000001" }, select: { id: true } });
    const second = await tx.user.create({ data: { login: newLogin("tg_guest"), password: "integration-test-only" }, select: { id: true } });
    const issue = await createTelegramLinkCode(tx, second.id, new Date());
    await tx.$executeRawUnsafe("SAVEPOINT chat_conflict_test");
    await assert.rejects(
      consumeTelegramStart(tx, { chatId: "710000001", secret: issue.secret, now: new Date() }),
      (error) => error?.code === "P2002",
    );
    await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT chat_conflict_test");
    await tx.$executeRawUnsafe("RELEASE SAVEPOINT chat_conflict_test");
    assert.equal((await tx.user.findUnique({ where: { id: first.id }, select: { telegramChatId: true } }))?.telegramChatId, "710000001");
    assert.equal((await tx.user.findUnique({ where: { id: second.id }, select: { telegramChatId: true } }))?.telegramChatId, null);

    for (let index = 1; index < 5; index += 1) await createTelegramLinkCode(tx, second.id, new Date());
    await assert.rejects(createTelegramLinkCode(tx, second.id, new Date()), (error) => error instanceof TelegramLinkError && error.code === "daily_limit");
    throw new Error("rollback_test_data");
  }), rollbackMarker);
  assert.equal(await prisma.user.count({ where: { login: { startsWith: "tg_owner_" } } }), 0);
  assert.equal(await prisma.user.count({ where: { login: { startsWith: "tg_guest_" } } }), 0);
});

test("outbox deduplicates and excludes disabled or unlinked users; aborted business transaction leaves no notification", async () => {
  const dedupeKey = `telegram-outbox-test:${randomUUID()}`;
  await assert.rejects(prisma.$transaction(async (tx) => {
    const linked = await tx.user.create({
      data: { login: newLogin("tg_notify"), password: "integration-test-only", telegramChatId: "720000001" },
      select: { id: true },
    });
    const disabled = await tx.user.create({
      data: { login: newLogin("tg_disabled"), password: "integration-test-only", telegramChatId: "720000002", telegramNotificationsEnabled: false },
      select: { id: true },
    });
    const unlinked = await tx.user.create({ data: { login: newLogin("tg_unlinked"), password: "integration-test-only" }, select: { id: true } });
    const event = { kind: "SUBMISSION_APPROVED", views: 2500, amountCents: 500, url: "/submissions/example" };
    await enqueueUserNotification(tx, linked.id, event, dedupeKey);
    await enqueueUserNotification(tx, linked.id, event, dedupeKey);
    await enqueueUserNotification(tx, disabled.id, event, `${dedupeKey}:disabled`);
    await enqueueUserNotification(tx, unlinked.id, event, `${dedupeKey}:unlinked`);
    assert.equal(await tx.notification.count({ where: { dedupeKey } }), 1);
    assert.equal(await tx.notification.count({ where: { dedupeKey: { startsWith: `${dedupeKey}:` } } }), 0);
    throw new Error("rollback_test_data");
  }), rollbackMarker);
  assert.equal(await prisma.notification.count({ where: { dedupeKey } }), 0);
});

test("notification worker states satisfy database checks and invalid state data is rejected", async () => {
  let testUserId = "";
  await assert.rejects(prisma.$transaction(async (tx) => {
    const user = await tx.user.create({ data: { login: newLogin("tg_states"), password: "integration-test-only" }, select: { id: true } });
    testUserId = user.id;
    const notification = await tx.notification.create({
      data: { userId: user.id, kind: "CHAT_MESSAGE", text: "safe test text" },
      select: { id: true },
    });
    const leaseUntil = new Date(Date.now() + 60_000);
    await tx.notification.update({ where: { id: notification.id }, data: { status: "SENDING", leaseUntil } });
    await tx.notification.update({ where: { id: notification.id }, data: { status: "PENDING", leaseUntil: null, sentAt: null } });
    await tx.notification.update({ where: { id: notification.id }, data: { status: "SENDING", leaseUntil } });
    await tx.notification.update({ where: { id: notification.id }, data: { status: "SENT", leaseUntil: null, sentAt: new Date() } });
    throw new Error("rollback_test_data");
  }), rollbackMarker);
  assert.equal(await prisma.notification.count({ where: { userId: testUserId } }), 0);
  assert.equal(await prisma.user.count({ where: { id: testUserId } }), 0);

  const invalidSending = prisma.$transaction(async (tx) => {
    const user = await tx.user.create({ data: { login: newLogin("tg_bad_send"), password: "integration-test-only" }, select: { id: true } });
    await tx.notification.create({ data: { userId: user.id, kind: "CHAT_MESSAGE", text: "test", status: "SENDING" } });
  });
  await assert.rejects(invalidSending, violatesCheck("Notification_state_check"));

  const invalidSent = prisma.$transaction(async (tx) => {
    const user = await tx.user.create({ data: { login: newLogin("tg_bad_sent"), password: "integration-test-only" }, select: { id: true } });
    await tx.notification.create({ data: { userId: user.id, kind: "CHAT_MESSAGE", text: "test", status: "SENT" } });
  });
  await assert.rejects(invalidSent, violatesCheck("Notification_state_check"));

  const invalidLinkTime = prisma.$transaction(async (tx) => {
    const user = await tx.user.create({ data: { login: newLogin("tg_bad_time"), password: "integration-test-only" }, select: { id: true } });
    const now = new Date();
    await tx.telegramLinkCode.create({ data: { userId: user.id, codeHash: randomUUID(), createdAt: now, expiresAt: now } });
  });
  await assert.rejects(invalidLinkTime, violatesCheck("TelegramLinkCode_time_check"));

  const invalidAttempts = prisma.$transaction((tx) => tx.telegramStartAttempt.create({
    data: { chatHash: randomUUID(), failedAttempts: -1, windowStartedAt: new Date() },
  }));
  await assert.rejects(invalidAttempts, violatesCheck("TelegramStartAttempt_attempts_check"));

  const invalidOffset = prisma.$transaction((tx) => tx.telegramWorkerState.create({ data: { id: randomUUID(), nextOffset: BigInt(-1) } }));
  await assert.rejects(invalidOffset, violatesCheck("TelegramWorkerState_offset_check"));

  const emptyChatId = prisma.$transaction((tx) => tx.user.create({ data: { login: newLogin("tg_empty_chat"), password: "integration-test-only", telegramChatId: "" } }));
  await assert.rejects(emptyChatId, violatesCheck("User_telegramChatId_nonempty_check"));
});

test.after(async () => {
  await prisma.$disconnect();
});
