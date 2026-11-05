import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { callTelegramApi } from "../src/lib/telegram-api.ts";
import { deliveryFailureOutcome } from "../src/lib/notification-rules.ts";
import {
  chatNotificationDedupeKey,
  createTelegramLinkSecret,
  hashTelegramLinkSecret,
  makeTelegramDeepLink,
  parseAppBaseUrl,
  sanitizeTelegramFragment,
  shouldNotifyUnread,
} from "../src/lib/telegram-rules.ts";
import { buildNotificationText } from "../src/lib/telegram-text.ts";

test("link secrets satisfy Telegram start requirements and only their digest is persisted", () => {
  const secret = createTelegramLinkSecret();
  assert.match(secret, /^[A-Za-z0-9_-]{16,64}$/);
  assert.notEqual(hashTelegramLinkSecret(secret), secret);
  assert.equal(hashTelegramLinkSecret(secret), hashTelegramLinkSecret(secret));
  assert.equal(makeTelegramDeepLink("example_bot", secret), `https://t.me/example_bot?start=${secret}`);
  assert.equal(makeTelegramDeepLink("bad username", secret), null);
});

test("chat message notification dedupe includes submission, recipient, and five-minute window", () => {
  const first = new Date("2026-11-05T12:02:00Z");
  const sameWindow = new Date("2026-11-05T12:04:59Z");
  const nextWindow = new Date("2026-11-05T12:05:00Z");
  assert.equal(chatNotificationDedupeKey("s1", "u1", first), chatNotificationDedupeKey("s1", "u1", sameWindow));
  assert.notEqual(chatNotificationDedupeKey("s1", "u1", first), chatNotificationDedupeKey("s1", "u2", first));
  assert.notEqual(chatNotificationDedupeKey("s1", "u1", first), chatNotificationDedupeKey("s1", "u1", nextWindow));
  assert.equal(shouldNotifyUnread(null, first), true);
  assert.equal(shouldNotifyUnread(new Date(first.getTime() - 1), first), true);
  assert.equal(shouldNotifyUnread(first, first), false);
});

test("notification text strips user control characters, caps fragments, and avoids sensitive payout details", () => {
  assert.equal(sanitizeTelegramFragment(" first\nsecond\u0000 third "), "first second third");
  assert.equal(sanitizeTelegramFragment("x".repeat(250)).length, 200);
  const paid = buildNotificationText({ kind: "PAYOUT_PAID", amountCents: 3000, url: "/balance" }, "https://panel.example");
  assert.ok(paid.text.length <= 500);
  assert.match(paid.text, /\$30\.00/);
  assert.doesNotMatch(paid.text, /steamcommunity|wallet|token|0xdeadbeef/i);
  const rejected = buildNotificationText({ kind: "SUBMISSION_REJECTED", reason: "line 1\nline 2", url: "/submissions/one" }, "https://panel.example");
  assert.doesNotMatch(rejected.text, /\n|\r/);
});

test("base URL rejects invalid and insecure production URLs", () => {
  assert.equal(parseAppBaseUrl("not-a-url", false), null);
  assert.equal(parseAppBaseUrl("http://panel.example", true), null);
  assert.equal(parseAppBaseUrl(undefined, false), "http://localhost:3000");
  assert.equal(parseAppBaseUrl("https://panel.example/path", true), "https://panel.example");
});

test("outbox retries use Telegram retry_after, grow exponentially, and fail after five attempts", () => {
  assert.deepEqual(deliveryFailureOutcome(1), { status: "PENDING", delayMs: 1000 });
  assert.deepEqual(deliveryFailureOutcome(3), { status: "PENDING", delayMs: 4000 });
  assert.deepEqual(deliveryFailureOutcome(2, 12), { status: "PENDING", delayMs: 12_000 });
  assert.deepEqual(deliveryFailureOutcome(5), { status: "FAILED" });
});

test("Telegram API errors never expose the request URL or bot token", async () => {
  const syntheticToken = `test-${randomUUID()}`;
  const result = await callTelegramApi(syntheticToken, "getUpdates", {}, async (url) => {
    throw new Error(String(url));
  });
  assert.deepEqual(result, { ok: false, status: 0 });
  assert.doesNotMatch(JSON.stringify(result), new RegExp(syntheticToken));

  const rateLimited = await callTelegramApi(syntheticToken, "sendMessage", { text: "test" }, async () => new Response(
    JSON.stringify({ ok: false, error_code: 429, parameters: { retry_after: 7 } }),
    { status: 429, headers: { "content-type": "application/json" } },
  ));
  assert.deepEqual(rateLimited, { ok: false, status: 429, retryAfterSeconds: 7 });

  const delivered = await callTelegramApi(syntheticToken, "sendMessage", { text: "test" }, async () => new Response(
    JSON.stringify({ ok: true, result: { message_id: 1 } }),
    { status: 200, headers: { "content-type": "application/json" } },
  ));
  assert.deepEqual(delivered, { ok: true, result: { message_id: 1 } });
});
