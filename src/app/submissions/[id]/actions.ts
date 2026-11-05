"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth-guards";
import { canAccessSubmissionChat, getMessageRateLimitError } from "@/lib/chat-rules";
import { prisma } from "@/lib/prisma";

export type SendMessageState = {
  error?: string;
  message?: {
    id: string;
    text: string;
    createdAt: string;
    authorId: string;
    author: { login: string };
  };
};

const messageInput = z.object({
  submissionId: z.string().cuid(),
  text: z.string().transform((value) =>
    value.replace(/\r\n?/g, "\n").trim().replace(/\n{3,}/g, "\n\n"),
  ).pipe(z.string().min(1, "Введите сообщение.").max(2000, "Сообщение должно быть не длиннее 2000 символов.")),
});

export async function sendMessageAction(
  _previousState: SendMessageState,
  formData: FormData,
): Promise<SendMessageState> {
  const viewer = await requireUser();
  const parsed = messageInput.safeParse({
    submissionId: formData.get("submissionId"),
    text: formData.get("text"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Проверьте текст сообщения." };

  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "User" WHERE "id" = ${viewer.id} FOR UPDATE
    `;
    const currentViewer = await tx.user.findUnique({
      where: { id: viewer.id },
      select: { id: true, login: true, role: true, isActive: true },
    });
    if (!currentViewer?.isActive) return { error: "Доступ запрещён." } as const;

    const submission = await tx.submission.findUnique({
      where: { id: parsed.data.submissionId },
      select: { id: true, userId: true },
    });
    if (!submission || !canAccessSubmissionChat(
      currentViewer.role,
      currentViewer.id,
      submission.userId,
      currentViewer.isActive,
    )) return { error: "Заявка не найдена." } as const;

    const now = new Date();
    const minuteCount = await tx.message.count({
      where: { authorId: currentViewer.id, createdAt: { gte: new Date(now.getTime() - 60_000) } },
    });
    const dayCount = await tx.message.count({
      where: { authorId: currentViewer.id, createdAt: { gte: new Date(now.getTime() - 24 * 60 * 60_000) } },
    });
    const rateError = getMessageRateLimitError(minuteCount, dayCount);
    if (rateError) return { error: rateError } as const;

    const message = await tx.message.create({
      data: {
        submissionId: submission.id,
        authorId: currentViewer.id,
        text: parsed.data.text,
      },
      select: {
        id: true,
        text: true,
        createdAt: true,
        authorId: true,
        author: { select: { login: true } },
      },
    });
    return { message: { ...message, createdAt: message.createdAt.toISOString() } } as const;
  });

  if (result.message) {
    revalidatePath(`/submissions/${parsed.data.submissionId}`);
    revalidatePath(`/moderator/submissions/${parsed.data.submissionId}`);
    revalidatePath("/submissions");
    revalidatePath("/moderator/submissions");
  }
  return result;
}
