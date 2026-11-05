import { NotificationKind, NotificationStatus, Prisma, Role } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { buildNotificationText, type NotificationEvent } from "./telegram-text.ts";
import { chatNotificationDedupeKey, parseAppBaseUrl } from "./telegram-rules.ts";

type Tx = Prisma.TransactionClient;

async function safeEnqueue(
  tx: Tx,
  kind: NotificationKind,
  work: () => Promise<void>,
) {
  await tx.$executeRawUnsafe("SAVEPOINT telegram_notification_enqueue");
  try {
    await work();
    await tx.$executeRawUnsafe("RELEASE SAVEPOINT telegram_notification_enqueue");
  } catch {
    try {
      await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT telegram_notification_enqueue");
      await tx.$executeRawUnsafe("RELEASE SAVEPOINT telegram_notification_enqueue");
    } catch {
      // The core transaction decides whether it can continue if the DB itself is unavailable.
    }
    console.warn("Telegram notification enqueue failed", { kind });
  }
}

function format(event: NotificationEvent) {
  if (!("url" in event)) return buildNotificationText(event, "");
  const baseUrl = parseAppBaseUrl(process.env.APP_BASE_URL, process.env.NODE_ENV === "production");
  if (!baseUrl) throw new Error("invalid_notification_base_url");
  return buildNotificationText(event, baseUrl);
}

async function insertNotification(
  tx: Tx,
  input: {
    userId: string;
    kind: NotificationKind;
    text: string;
    dedupeKey?: string;
    recipientChatId?: string;
  },
) {
  await tx.$executeRaw`
    INSERT INTO "Notification" ("id", "userId", "kind", "text", "dedupeKey", "recipientChatId")
    VALUES (${randomUUID()}, ${input.userId}, ${input.kind}::"NotificationKind", ${input.text}, ${input.dedupeKey ?? null}, ${input.recipientChatId ?? null})
    ON CONFLICT ("dedupeKey") DO NOTHING
  `;
}

export async function enqueueUserNotification(
  tx: Tx,
  userId: string,
  event: NotificationEvent,
  dedupeKey?: string,
  recipientChatId?: string,
) {
  await safeEnqueue(tx, NotificationKind[event.kind], async () => {
    const notification = format(event);
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { id: true, isActive: true, telegramChatId: true, telegramNotificationsEnabled: true },
    });
    if (!user?.isActive || (!recipientChatId && (!user.telegramChatId || !user.telegramNotificationsEnabled))) return;
    if (recipientChatId && !user.isActive) return;
    await insertNotification(tx, {
      userId,
      kind: notification.kind,
      text: notification.text,
      dedupeKey,
      recipientChatId,
    });
  });
}

export async function enqueueDirectTelegramNotification(
  tx: Tx,
  input: { userId: string; chatId: string; event: NotificationEvent; dedupeKey: string },
) {
  await safeEnqueue(tx, NotificationKind[input.event.kind], async () => {
    const notification = format(input.event);
    const user = await tx.user.findUnique({ where: { id: input.userId }, select: { isActive: true } });
    if (!user?.isActive) return;
    await insertNotification(tx, {
      userId: input.userId,
      kind: notification.kind,
      text: notification.text,
      dedupeKey: input.dedupeKey,
      recipientChatId: input.chatId,
    });
  });
}

export async function enqueueModeratorNotifications(
  tx: Tx,
  event: NotificationEvent,
  dedupePrefix: string,
) {
  await safeEnqueue(tx, NotificationKind[event.kind], async () => {
    const notification = format(event);
    const moderators = await tx.user.findMany({
      where: {
        role: Role.MODERATOR,
        isActive: true,
        telegramChatId: { not: null },
        telegramNotificationsEnabled: true,
      },
      select: { id: true },
    });
    for (const moderator of moderators) {
      await insertNotification(tx, {
        userId: moderator.id,
        kind: notification.kind,
        text: notification.text,
        dedupeKey: `${dedupePrefix}:${moderator.id}`,
      });
    }
  });
}

export async function enqueueChatMessageNotifications(
  tx: Tx,
  input: { submissionId: string; authorId: string; message: string; createdAt: Date; now: Date },
) {
  await safeEnqueue(tx, NotificationKind.CHAT_MESSAGE, async () => {
    const submission = await tx.submission.findUnique({
      where: { id: input.submissionId },
      select: { id: true, userId: true },
    });
    const author = await tx.user.findUnique({ where: { id: input.authorId }, select: { role: true, login: true } });
    if (!submission || !author) return;
    const recipients = author.role === Role.CLIPPER
      ? await tx.user.findMany({
        where: { role: Role.MODERATOR, isActive: true, telegramChatId: { not: null }, telegramNotificationsEnabled: true },
        select: { id: true },
      })
      : await tx.user.findMany({
        where: { id: submission.userId, isActive: true, telegramChatId: { not: null }, telegramNotificationsEnabled: true },
        select: { id: true },
      });
    const notification = format({
      kind: "CHAT_MESSAGE",
      login: author.login,
      message: input.message,
      url: author.role === Role.CLIPPER
        ? `/moderator/submissions/${submission.id}`
        : `/submissions/${submission.id}`,
    });

    for (const recipient of recipients) {
      const state = await tx.submissionReadState.findUnique({
        where: { userId_submissionId: { userId: recipient.id, submissionId: submission.id } },
        select: { lastReadAt: true },
      });
      if (state && state.lastReadAt >= input.createdAt) return;
      const recent = await tx.notification.findFirst({
        where: {
          userId: recipient.id,
          kind: NotificationKind.CHAT_MESSAGE,
          status: { in: [NotificationStatus.PENDING, NotificationStatus.SENDING] },
          createdAt: { gte: new Date(input.now.getTime() - 5 * 60_000) },
          dedupeKey: { startsWith: `chat:${submission.id}:${recipient.id}:` },
        },
        select: { id: true },
      });
      if (recent) return;
      await insertNotification(tx, {
        userId: recipient.id,
        kind: notification.kind,
        text: notification.text,
        dedupeKey: chatNotificationDedupeKey(submission.id, recipient.id, input.now),
      });
    }
  });
}
