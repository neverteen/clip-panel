import { Role } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import { canAccessSubmissionChat, getAttachmentRateLimitError, getMessageRateLimitError } from "./chat-rules.ts";
import { ATTACHMENT_MAX_FILES_PER_MESSAGE, ATTACHMENT_MAX_PER_USER_PER_DAY } from "./config.ts";
import type { PreparedImage } from "./attachment-storage.ts";
import { getNow } from "./now.ts";
import { prisma } from "./prisma.ts";
import { enqueueChatMessageNotifications } from "./telegram-notifications.ts";

export type ChatAttachmentRecord = {
  id: string;
  mime: string;
  sizeBytes: number;
  width: number;
  height: number;
  createdAt: Date;
};

export type CreatedChatMessage = {
  id: string;
  submissionId: string;
  text: string;
  createdAt: Date;
  authorId: string;
  author: { login: string };
  attachments: ChatAttachmentRecord[];
};

export class SubmissionMessageError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function dayStart(now: Date) {
  return new Date(now.getTime() - 24 * 60 * 60_000);
}

async function getCounts(userId: string, since: Date) {
  const [minuteCount, dayCount, attachmentCount] = await Promise.all([
    prisma.message.count({ where: { authorId: userId, createdAt: { gte: new Date(since.getTime() - 60_000) } } }),
    prisma.message.count({ where: { authorId: userId, createdAt: { gte: dayStart(since) } } }),
    countRecentAttachments(prisma, userId, dayStart(since)),
  ]);
  return { minuteCount, dayCount, attachmentCount };
}

async function countRecentAttachments(client: Pick<Prisma.TransactionClient, "$queryRaw">, userId: string, since: Date) {
  const [row] = await client.$queryRaw<Array<{ count: number }>>`
    SELECT COUNT(a."id")::int AS "count"
    FROM "Message" m
    JOIN "MessageAttachment" a ON a."messageId" = m."id"
    WHERE m."authorId" = ${userId}
      AND m."createdAt" >= ${since}
      AND a."createdAt" >= ${since}
  `;
  return row?.count ?? 0;
}

export async function preflightChatWrite(userId: string) {
  const now = getNow();
  const counts = await getCounts(userId, now);
  const rateError = getMessageRateLimitError(counts.minuteCount, counts.dayCount);
  if (rateError) throw new SubmissionMessageError(429, rateError);
  return counts;
}

export async function createSubmissionMessage(input: {
  viewer: { id: string; role: Role };
  submissionId: string;
  text: string;
  storedImages: Array<{ storageKey: string; image: Pick<PreparedImage, "mime" | "sizeBytes" | "width" | "height"> }>;
}): Promise<CreatedChatMessage> {
  if (input.storedImages.length > ATTACHMENT_MAX_FILES_PER_MESSAGE) throw new SubmissionMessageError(400, `В одном сообщении можно прикрепить не более ${ATTACHMENT_MAX_FILES_PER_MESSAGE} изображений.`);
  if (!input.text && input.storedImages.length === 0) throw new SubmissionMessageError(400, "Добавьте текст или изображение.");
  if (input.text.length > 2000) throw new SubmissionMessageError(400, "Текст сообщения должен быть не длиннее 2000 символов.");

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "User" WHERE "id" = ${input.viewer.id} FOR UPDATE`;
    const user = await tx.user.findUnique({
      where: { id: input.viewer.id },
      select: { id: true, login: true, role: true, isActive: true },
    });
    if (!user?.isActive) throw new SubmissionMessageError(404, "Заявка не найдена.");
    const submission = await tx.submission.findUnique({ where: { id: input.submissionId }, select: { id: true, userId: true } });
    if (!submission || !canAccessSubmissionChat(user.role, user.id, submission.userId, user.isActive)) {
      throw new SubmissionMessageError(404, "Заявка не найдена.");
    }

    const now = getNow();
    const [minuteCount, dayCount, attachmentCount] = await Promise.all([
      tx.message.count({ where: { authorId: user.id, createdAt: { gte: new Date(now.getTime() - 60_000) } } }),
      tx.message.count({ where: { authorId: user.id, createdAt: { gte: dayStart(now) } } }),
      countRecentAttachments(tx, user.id, dayStart(now)),
    ]);
    const rateError = getMessageRateLimitError(minuteCount, dayCount);
    if (rateError) throw new SubmissionMessageError(429, rateError);
    const attachmentRateError = getAttachmentRateLimitError(attachmentCount, input.storedImages.length, ATTACHMENT_MAX_PER_USER_PER_DAY);
    if (attachmentRateError) throw new SubmissionMessageError(429, attachmentRateError);

    const message = await tx.message.create({
      data: { submissionId: submission.id, authorId: user.id, text: input.text },
      select: { id: true },
    });
    if (input.storedImages.length) {
      await tx.messageAttachment.createMany({
        data: input.storedImages.map(({ storageKey, image }) => ({
          messageId: message.id,
          storageKey,
          mime: image.mime,
          sizeBytes: image.sizeBytes,
          width: image.width,
          height: image.height,
        })),
      });
    }
    const saved = await tx.message.findUniqueOrThrow({
      where: { id: message.id },
      select: {
        id: true, submissionId: true, text: true, createdAt: true, authorId: true,
        author: { select: { login: true } },
        attachments: { select: { id: true, mime: true, sizeBytes: true, width: true, height: true, createdAt: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
      },
    });
    const notificationMessage = input.storedImages.length ? "прислал изображение" : input.text;
    await enqueueChatMessageNotifications(tx, {
      submissionId: submission.id,
      authorId: user.id,
      message: notificationMessage,
      createdAt: saved.createdAt,
      now,
    });
    return saved;
  });
}
