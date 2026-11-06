"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  MAX_VIDEO_VIEWS,
  MIN_VIDEO_VIEWS,
} from "@/lib/config";
import { requireModerator } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { reviewSubmissionInTransaction } from "@/lib/submission-review";
import { moscowDateTimeToUtc } from "@/lib/week";

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
    const result = await prisma.$transaction((tx) => reviewSubmissionInTransaction(tx, {
      submissionId: request.data.submissionId,
      decision: request.data.decision,
      views: viewsResult?.data,
      publishedAt: publishedAt ?? undefined,
      rejectReason: rejectReason?.data,
      confirmInactive: request.data.confirmInactive === "true",
    }));

    if (result.message) {
      revalidatePath("/moderator/submissions");
      revalidatePath("/submissions");
      revalidatePath(`/moderator/submissions/${request.data.submissionId}`);
      revalidatePath(`/submissions/${request.data.submissionId}`);
    }
    return result;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return { error: "Заявка уже обработана." };
    }
    throw error;
  }
}
