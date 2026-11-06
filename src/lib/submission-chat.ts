import { Role } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { canAccessSubmissionChat } from "@/lib/chat-rules";

export const submissionIdSchema = z.string().cuid();

export async function findAccessibleSubmission(
  viewer: { id: string; role: Role },
  submissionId: string,
) {
  if (!submissionIdSchema.safeParse(submissionId).success) return null;
  const submission = await prisma.submission.findUnique({
    where: { id: submissionId },
    select: {
      id: true,
      userId: true,
      status: true,
      createdAt: true,
      reviewedAt: true,
      views: true,
      amountCents: true,
      rejectReason: true,
    },
  });
  if (!submission || !canAccessSubmissionChat(viewer.role, viewer.id, submission.userId)) return null;
  return submission;
}

export async function advanceReadState(
  userId: string,
  submissionId: string,
  lastReadAt: Date,
) {
  await prisma.$executeRaw`
    INSERT INTO "SubmissionReadState" ("userId", "submissionId", "lastReadAt")
    VALUES (${userId}, ${submissionId}, ${lastReadAt})
    ON CONFLICT ("userId", "submissionId") DO UPDATE
    SET "lastReadAt" = GREATEST("SubmissionReadState"."lastReadAt", EXCLUDED."lastReadAt")
  `;
}

export async function getUnreadCounts(viewerId: string, role: Role) {
  const rows = role === Role.MODERATOR
    ? await prisma.$queryRaw<Array<{ id: string; unread: number }>>`
        SELECT s."id", COUNT(m."id")::int AS "unread"
        FROM "Submission" s
        LEFT JOIN "SubmissionReadState" rs
          ON rs."submissionId" = s."id" AND rs."userId" = ${viewerId}
        LEFT JOIN "Message" m
          ON m."submissionId" = s."id"
          AND m."authorId" <> ${viewerId}
          AND (rs."lastReadAt" IS NULL OR m."createdAt" > rs."lastReadAt")
        GROUP BY s."id"
      `
    : await prisma.$queryRaw<Array<{ id: string; unread: number }>>`
        SELECT s."id", COUNT(m."id")::int AS "unread"
        FROM "Submission" s
        LEFT JOIN "SubmissionReadState" rs
          ON rs."submissionId" = s."id" AND rs."userId" = ${viewerId}
        LEFT JOIN "Message" m
          ON m."submissionId" = s."id"
          AND m."authorId" <> ${viewerId}
          AND (rs."lastReadAt" IS NULL OR m."createdAt" > rs."lastReadAt")
        WHERE s."userId" = ${viewerId}
        GROUP BY s."id"
      `;
  return new Map(rows.map((row) => [row.id, row.unread]));
}

export type ChatAttachment = {
  id: string;
  mime: string;
  sizeBytes: number;
  width: number;
  height: number;
  createdAt: Date;
};

export type ChatMessage = {
  id: string;
  text: string;
  createdAt: Date;
  authorId: string;
  author: { login: string };
  attachments: ChatAttachment[];
};

export type SystemChatEvent = {
  id: string;
  kind: "submitted" | "approved" | "rejected";
  createdAt: Date;
  text: string;
};

export function makeSubmissionEvents(submission: {
  createdAt: Date;
  status: string;
  reviewedAt: Date | null;
  views: number;
  amountCents: number;
  rejectReason: string | null;
}): SystemChatEvent[] {
  const events: SystemChatEvent[] = [{
    id: "system-submitted",
    kind: "submitted",
    createdAt: submission.createdAt,
    text: "Заявка подана на проверку.",
  }];
  if (submission.reviewedAt && (submission.status === "APPROVED" || submission.status === "PAID")) {
    events.push({
      id: "system-approved",
      kind: "approved",
      createdAt: submission.reviewedAt,
      text: `Заявка одобрена: ${submission.views.toLocaleString("ru-RU")} просмотров, сумма $${Math.floor(submission.amountCents / 100)}.${String(submission.amountCents % 100).padStart(2, "0")}.`,
    });
  }
  if (submission.reviewedAt && submission.status === "REJECTED") {
    events.push({
      id: "system-rejected",
      kind: "rejected",
      createdAt: submission.reviewedAt,
      text: `Заявка отклонена: ${submission.rejectReason ?? "причина не указана"}`,
    });
  }
  return events;
}
