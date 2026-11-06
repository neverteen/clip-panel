import assert from "node:assert/strict";
import test from "node:test";
import { Role } from "@prisma/client";
import { ATTACHMENT_MAX_PER_USER_PER_DAY } from "../src/lib/config.ts";
import {
  canAccessSubmissionChat,
  countUnreadMessages,
  getAttachmentRateLimitError,
  getMessageRateLimitError,
} from "../src/lib/chat-rules.ts";

test("chat access allows owner and moderator, but not another clipper or disabled user", () => {
  assert.equal(canAccessSubmissionChat(Role.CLIPPER, "owner", "owner"), true);
  assert.equal(canAccessSubmissionChat(Role.CLIPPER, "other", "owner"), false);
  assert.equal(canAccessSubmissionChat(Role.MODERATOR, "mod", "owner"), true);
  assert.equal(canAccessSubmissionChat(Role.MODERATOR, "mod", "owner", false), false);
  assert.equal(canAccessSubmissionChat(Role.CLIPPER, "owner", "owner", false), false);
});

test("attachment daily quota allows the 40th item and rejects the 41st", () => {
  const limit = ATTACHMENT_MAX_PER_USER_PER_DAY;
  assert.equal(getAttachmentRateLimitError(limit - 1, 1, limit), null);
  assert.match(getAttachmentRateLimitError(limit, 1, limit), new RegExp(`${limit} изображений`));
});

test("message rate limit boundaries are enforced", () => {
  assert.equal(getMessageRateLimitError(9, 199), null);
  assert.match(getMessageRateLimitError(10, 10), /10 в минуту/);
  assert.match(getMessageRateLimitError(0, 200), /200 сообщений за сутки/);
});

test("unread count excludes own messages and messages at or before lastReadAt", () => {
  const lastReadAt = new Date("2026-11-05T10:00:00.000Z");
  const messages = [
    { authorId: "viewer", createdAt: new Date("2026-11-05T10:01:00.000Z") },
    { authorId: "other", createdAt: new Date("2026-11-05T09:59:00.000Z") },
    { authorId: "other", createdAt: new Date("2026-11-05T10:00:00.000Z") },
    { authorId: "other", createdAt: new Date("2026-11-05T10:01:00.000Z") },
  ];
  assert.equal(countUnreadMessages(messages, "viewer", lastReadAt), 1);
});
