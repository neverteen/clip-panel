"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireModerator } from "@/lib/auth-guards";
import { getNow } from "@/lib/now";
import { prisma } from "@/lib/prisma";
import { getLastCompletedWeekStart, lockSettlementWeek } from "@/lib/settlement-week";
import { WEEK_MS, getWindow } from "@/lib/week";
import { computeWeekResults } from "@/lib/week-results";

export type CloseWeekState = { error?: string; message?: string };

const inputSchema = z.object({ weekStart: z.string().datetime({ offset: true }) });

function isWeekStart(value: Date) {
  return getWindow(value).start.getTime() === value.getTime();
}

export async function closeWeekAction(
  _previousState: CloseWeekState,
  formData: FormData,
): Promise<CloseWeekState> {
  const moderator = await requireModerator();
  const parsed = inputSchema.safeParse({ weekStart: formData.get("weekStart") });
  if (!parsed.success) return { error: "Выберите корректную неделю." };
  const weekStart = new Date(parsed.data.weekStart);
  if (!isWeekStart(weekStart)) return { error: "Начало недели указано некорректно." };

  try {
    const result = await prisma.$transaction(async (tx) => {
      await lockSettlementWeek(tx, weekStart);

      const now = getNow();
      if (weekStart.getTime() > getLastCompletedWeekStart(now).getTime()) {
        return { error: "Неделя ещё не завершена по московскому времени." };
      }

      const existing = await tx.weekClosure.findUnique({ where: { weekStart }, select: { id: true } });
      if (existing) return { error: "Неделя уже закрыта." };

      const earliestSubmission = await tx.submission.findFirst({
        orderBy: { weekStart: "asc" },
        select: { weekStart: true },
      });
      if (!earliestSubmission || weekStart.getTime() < earliestSubmission.weekStart.getTime()) {
        return { error: "Нельзя закрыть неделю раньше первой недели с заявками." };
      }

      const weeksSinceFirst = Math.round(
        (weekStart.getTime() - earliestSubmission.weekStart.getTime()) / WEEK_MS,
      );
      if (weeksSinceFirst > 0) {
        const priorClosures = await tx.weekClosure.count({
          where: {
            weekStart: {
              gte: earliestSubmission.weekStart,
              lt: weekStart,
            },
          },
        });
        if (priorClosures !== weeksSinceFirst) {
          return { error: "Сначала закройте предыдущую неделю." };
        }
      }

      const pendingCount = await tx.submission.count({
        where: { weekStart, status: "PENDING" },
      });
      if (pendingCount > 0) {
        return { error: `В неделе осталось заявок на проверке: ${pendingCount}.` };
      }

      const computedResults = await computeWeekResults(tx, weekStart);
      await tx.weekClosure.create({
        data: { weekStart, closedAt: now, closedById: moderator.id },
        select: { id: true },
      });

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

        const accruals = computedResults
          .filter((row) => row.payableCents > 0)
          .map((row) => ({
            userId: row.userId,
            type: "ACCRUAL" as const,
            amountCents: row.payableCents,
            weekStart,
          }));
        if (accruals.length > 0) await tx.ledgerEntry.createMany({ data: accruals });
      }

      return { message: "Неделя закрыта. Начисления и результаты сохранены." };
    });

    if (result.message) {
      revalidatePath("/moderator/weeks");
      revalidatePath("/balance");
      revalidatePath("/moderator/submissions");
      revalidatePath("/submissions");
    }
    return result;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { error: "Неделя уже закрыта." };
    }
    throw error;
  }
}
