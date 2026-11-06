import type { Prisma } from "@prisma/client";
import { getNow } from "./now.ts";
import { getLastCompletedWeekStart, lockSettlementWeek } from "./settlement-week.ts";
import { WEEK_MS } from "./week.ts";
import { computeWeekResults } from "./week-results.ts";
import { enqueueUserNotification } from "./telegram-notifications.ts";

export type CloseWeekResult = { error?: string; message?: string };

export async function closeWeekInTransaction(
  tx: Prisma.TransactionClient,
  input: { weekStart: Date; moderatorId: string; now?: Date },
): Promise<CloseWeekResult> {
  const { weekStart, moderatorId } = input;
  await lockSettlementWeek(tx, weekStart);

  const now = input.now ?? getNow();
  if (weekStart.getTime() > getLastCompletedWeekStart(now).getTime()) {
    return { error: "Неделя ещё не завершена по московскому времени." };
  }
  const existing = await tx.weekClosure.findUnique({ where: { weekStart }, select: { id: true } });
  if (existing) return { error: "Неделя уже закрыта." };

  const earliestSubmission = await tx.submission.findFirst({ orderBy: { weekStart: "asc" }, select: { weekStart: true } });
  if (!earliestSubmission || weekStart.getTime() < earliestSubmission.weekStart.getTime()) {
    return { error: "Нельзя закрыть неделю раньше первой недели с заявками." };
  }
  const weeksSinceFirst = Math.round((weekStart.getTime() - earliestSubmission.weekStart.getTime()) / WEEK_MS);
  if (weeksSinceFirst > 0) {
    const priorClosures = await tx.weekClosure.count({ where: { weekStart: { gte: earliestSubmission.weekStart, lt: weekStart } } });
    if (priorClosures !== weeksSinceFirst) return { error: "Сначала закройте предыдущую неделю." };
  }
  const pendingCount = await tx.submission.count({ where: { weekStart, status: "PENDING" } });
  if (pendingCount > 0) return { error: `В неделе осталось заявок на проверке: ${pendingCount}.` };

  const computedResults = await computeWeekResults(tx, weekStart);
  await tx.weekClosure.create({ data: { weekStart, closedAt: now, closedById: moderatorId }, select: { id: true } });
  if (computedResults.length > 0) {
    await tx.weekResult.createMany({
      data: computedResults.map((row) => ({
        userId: row.userId,
        weekStart,
        weekCents: row.weekCents,
        carryInCents: row.carryInCents,
        payableCents: row.payableCents,
        carryOutCents: row.carryOutCents,
        expiredCents: row.expiredCents,
      })),
    });
    const accruals = computedResults.filter((row) => row.payableCents > 0).map((row) => ({
      userId: row.userId,
      type: "ACCRUAL" as const,
      amountCents: row.payableCents,
      weekStart,
    }));
    if (accruals.length > 0) await tx.ledgerEntry.createMany({ data: accruals });
    for (const row of computedResults) {
      await enqueueUserNotification(tx, row.userId, {
        kind: "WEEK_CLOSED",
        payableCents: row.payableCents,
        carryOutCents: row.carryOutCents,
        expiredCents: row.expiredCents,
        weekCents: row.weekCents,
        url: "/balance",
      }, `week-closed:${weekStart.toISOString()}:${row.userId}`);
    }
  }
  return { message: "Неделя закрыта. Начисления и результаты сохранены." };
}
