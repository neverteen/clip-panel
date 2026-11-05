"use server";

import { Prisma, SubmissionStatus } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  MAX_VIDEO_VIEWS,
  MIN_VIDEO_VIEWS,
} from "@/lib/config";
import { requireModerator } from "@/lib/auth-guards";
import { getNow } from "@/lib/now";
import { prisma } from "@/lib/prisma";
import { calculateAmountCents } from "@/lib/payout";
import { getWindow, moscowDateTimeToUtc } from "@/lib/week";

export type ReviewActionState = {
  error?: string;
  message?: string;
};

const requestSchema = z.object({
  submissionId: z.string().min(1),
  decision: z.enum(["APPROVE", "REJECT"]),
  views: z.string().optional(),
  publishedAt: z.string().optional(),
  rejectReason: z.string().optional(),
  confirmInactive: z.string().optional(),
});

const viewsSchema = z
  .string()
  .regex(/^\d+$/, "Количество просмотров должно быть целым числом.")
  .transform(Number)
  .pipe(z.number().int().min(0).max(MAX_VIDEO_VIEWS));

const rejectReasonSchema = z
  .string()
  .trim()
  .min(3, "Причина должна содержать не менее 3 символов.")
  .max(500, "Причина должна содержать не более 500 символов.");

export async function reviewSubmissionAction(
  _previousState: ReviewActionState,
  formData: FormData,
): Promise<ReviewActionState> {
  await requireModerator();

  const request = requestSchema.safeParse({
    submissionId: formData.get("submissionId"),
    decision: formData.get("decision"),
    views: formData.get("views") ?? undefined,
    publishedAt: formData.get("publishedAt") ?? undefined,
    rejectReason: formData.get("rejectReason") ?? undefined,
    confirmInactive: formData.get("confirmInactive") ?? undefined,
  });
  if (!request.success) return { error: "Некорректные данные решения." };

  const rejectReason = request.data.decision === "REJECT"
    ? rejectReasonSchema.safeParse(request.data.rejectReason ?? "")
    : null;
  if (rejectReason && !rejectReason.success) {
    return { error: rejectReason.error.issues[0]?.message ?? "Укажите причину отклонения." };
  }

  const viewsResult = request.data.decision === "APPROVE"
    ? viewsSchema.safeParse(request.data.views ?? "")
    : null;
  if (viewsResult && !viewsResult.success) {
    return {
      error: viewsResult.error.issues[0]?.message ??
        `Просмотры должны быть целым числом от 0 до ${MAX_VIDEO_VIEWS.toLocaleString("ru-RU")}.`,
    };
  }
  if (viewsResult && viewsResult.data < MIN_VIDEO_VIEWS) {
    return { error: `Для одобрения нужно не менее ${MIN_VIDEO_VIEWS.toLocaleString("ru-RU")} просмотров.` };
  }

  const publishedAt = request.data.decision === "APPROVE"
    ? moscowDateTimeToUtc(request.data.publishedAt ?? "")
    : null;
  if (request.data.decision === "APPROVE" && !publishedAt) {
    return { error: "Укажите корректные дату и время публикации по МСК." };
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const submission = await tx.submission.findUnique({
        where: { id: request.data.submissionId },
        select: { id: true, userId: true, status: true, weekStart: true },
      });
      if (!submission) return { error: "Заявка не найдена." };
      if (submission.status !== SubmissionStatus.PENDING) {
        return { error: "Заявка уже обработана." };
      }

      await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "User" WHERE "id" = ${submission.userId} FOR UPDATE
      `;
      const clipper = await tx.user.findUnique({
        where: { id: submission.userId },
        select: { isActive: true },
      });
      if (!clipper) return { error: "Пользователь не найден." };
      if (!clipper.isActive && request.data.confirmInactive !== "true") {
        return { error: "Пользователь отключён. Подтвердите решение явно." };
      }

      const reviewedAt = getNow();
      if (request.data.decision === "REJECT") {
        const updated = await tx.submission.updateMany({
          where: { id: submission.id, status: SubmissionStatus.PENDING },
          data: {
            status: SubmissionStatus.REJECTED,
            rejectReason: rejectReason?.data,
            reviewedAt,
          },
        });
        return updated.count === 0
          ? { error: "Заявка уже обработана." }
          : { message: "Заявка отклонена." };
      }

      const checkedViews = viewsResult?.data;
      if (checkedViews === undefined || !publishedAt) {
        return { error: "Не удалось проверить просмотры или дату публикации." };
      }
      const submissionWindow = getWindow(publishedAt);
      if (
        submissionWindow.start.getTime() !== submission.weekStart.getTime() ||
        publishedAt.getTime() < submission.weekStart.getTime() ||
        publishedAt.getTime() >= submissionWindow.end.getTime()
      ) {
        return { error: "Исправленная дата публикации должна оставаться внутри недели заявки." };
      }
      if (publishedAt.getTime() > reviewedAt.getTime()) {
        return { error: "Дата публикации не может быть в будущем." };
      }

      const amountCents = calculateAmountCents(checkedViews);
      if (amountCents === null) {
        return { error: `Для одобрения нужно не менее ${MIN_VIDEO_VIEWS.toLocaleString("ru-RU")} просмотров.` };
      }

      const updated = await tx.submission.updateMany({
        where: { id: submission.id, status: SubmissionStatus.PENDING },
        data: {
          status: SubmissionStatus.APPROVED,
          views: checkedViews,
          publishedAt,
          amountCents,
          reviewedAt,
        },
      });
      return updated.count === 0
        ? { error: "Заявка уже обработана." }
        : { message: "Заявка одобрена. Начисление в копилку не выполнялось." };
    });

    if (result.message) {
      revalidatePath("/moderator/submissions");
      revalidatePath("/submissions");
    }
    return result;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return { error: "Заявка уже обработана." };
    }
    throw error;
  }
}
