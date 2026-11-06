import { Prisma, SubmissionStatus } from "@prisma/client";
import { MIN_VIDEO_VIEWS } from "./config.ts";
import { calculateAmountCents } from "./payout.ts";
import { getNow } from "./now.ts";
import { getWindow } from "./week.ts";
import { enqueueUserNotification } from "./telegram-notifications.ts";
import { lockSettlementWeek } from "./settlement-week.ts";

export type ReviewDecisionInput = {
  submissionId: string;
  decision: "APPROVE" | "REJECT";
  views?: number;
  publishedAt?: Date;
  rejectReason?: string;
  confirmInactive?: boolean;
  now?: Date;
};

export type ReviewDecisionResult = { error?: string; message?: string };

export async function reviewSubmissionInTransaction(
  tx: Prisma.TransactionClient,
  input: ReviewDecisionInput,
): Promise<ReviewDecisionResult> {
  const initialSubmission = await tx.submission.findUnique({
    where: { id: input.submissionId },
    select: { id: true, weekStart: true },
  });
  if (!initialSubmission) return { error: "Заявка не найдена." };

  await lockSettlementWeek(tx, initialSubmission.weekStart);
  const submission = await tx.submission.findUnique({
    where: { id: input.submissionId },
    select: { id: true, userId: true, status: true, weekStart: true },
  });
  if (!submission) return { error: "Заявка не найдена." };
  const closure = await tx.weekClosure.findUnique({ where: { weekStart: submission.weekStart }, select: { id: true } });
  if (closure) return { error: "Эта неделя уже закрыта; решение по заявке невозможно." };
  if (submission.status !== SubmissionStatus.PENDING) return { error: "Заявка уже обработана." };

  await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "User" WHERE "id" = ${submission.userId} FOR UPDATE`;
  const clipper = await tx.user.findUnique({ where: { id: submission.userId }, select: { isActive: true } });
  if (!clipper) return { error: "Пользователь не найден." };
  if (!clipper.isActive && !input.confirmInactive) return { error: "Пользователь отключён. Подтвердите решение явно." };

  const reviewedAt = input.now ?? getNow();
  if (input.decision === "REJECT") {
    const updated = await tx.submission.updateMany({
      where: { id: submission.id, status: SubmissionStatus.PENDING },
      data: { status: SubmissionStatus.REJECTED, rejectReason: input.rejectReason, reviewedAt },
    });
    if (updated.count === 0) return { error: "Заявка уже обработана." };
    await enqueueUserNotification(tx, submission.userId, {
      kind: "SUBMISSION_REJECTED",
      reason: input.rejectReason ?? "",
      url: `/submissions/${submission.id}`,
    }, `submission-rejected:${submission.id}`);
    return { message: "Заявка отклонена." };
  }

  const publishedAt = input.publishedAt;
  const views = input.views;
  if (views === undefined || !publishedAt) return { error: "Не удалось проверить просмотры или дату публикации." };
  const submissionWindow = getWindow(publishedAt);
  if (
    submissionWindow.start.getTime() !== submission.weekStart.getTime() ||
    publishedAt.getTime() < submission.weekStart.getTime() ||
    publishedAt.getTime() >= submissionWindow.end.getTime()
  ) return { error: "Исправленная дата публикации должна оставаться внутри недели заявки." };
  if (publishedAt.getTime() > reviewedAt.getTime()) return { error: "Дата публикации не может быть в будущем." };
  if (views < MIN_VIDEO_VIEWS) return { error: `Для одобрения нужно не менее ${MIN_VIDEO_VIEWS.toLocaleString("ru-RU")} просмотров.` };

  const amountCents = calculateAmountCents(views);
  if (amountCents === null) return { error: `Для одобрения нужно не менее ${MIN_VIDEO_VIEWS.toLocaleString("ru-RU")} просмотров.` };
  const updated = await tx.submission.updateMany({
    where: { id: submission.id, status: SubmissionStatus.PENDING },
    data: { status: SubmissionStatus.APPROVED, views, publishedAt, amountCents, reviewedAt },
  });
  if (updated.count === 0) return { error: "Заявка уже обработана." };
  await enqueueUserNotification(tx, submission.userId, {
    kind: "SUBMISSION_APPROVED",
    views,
    amountCents,
    url: `/submissions/${submission.id}`,
  }, `submission-approved:${submission.id}`);
  return { message: "Заявка одобрена. Начисление в копилку не выполнялось." };
}

