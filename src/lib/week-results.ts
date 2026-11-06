import type { Prisma, PrismaClient } from "@prisma/client";
import { settleWeek } from "./settlement.ts";

type WeekReader = PrismaClient | Prisma.TransactionClient;

export type ComputedWeekResult = {
  userId: string;
  login: string;
  views: number;
  weekCents: number;
  carryInCents: number;
  payableCents: number;
  carryOutCents: number;
  expiredCents: number;
};

export async function computeWeekResults(db: WeekReader, weekStart: Date): Promise<ComputedWeekResult[]> {
  const previousWeekStart = new Date(weekStart.getTime() - 7 * 24 * 60 * 60 * 1000);
  const previousIsClosed = await db.weekClosure.findUnique({
    where: { weekStart: previousWeekStart },
    select: { id: true },
  });

  const [submissions, carryResults, approvedTotals] = await Promise.all([
    db.submission.findMany({
      where: { weekStart },
      distinct: ["userId"],
      select: { userId: true },
    }),
    previousIsClosed
      ? db.weekResult.findMany({
          where: { weekStart: previousWeekStart, carryOutCents: { gt: 0 } },
          select: { userId: true, carryOutCents: true },
        })
      : Promise.resolve([]),
    db.submission.groupBy({
      by: ["userId"],
      where: { weekStart, status: "APPROVED" },
      _sum: { views: true, amountCents: true },
    }),
  ]);

  const carryByUser = new Map(carryResults.map((result) => [result.userId, result.carryOutCents]));
  const totalsByUser = new Map(approvedTotals.map((result) => [result.userId, {
    views: result._sum.views ?? 0,
    weekCents: result._sum.amountCents ?? 0,
  }]));
  const participantIds = new Set([
    ...submissions.map((submission) => submission.userId),
    ...carryByUser.keys(),
  ]);
  if (participantIds.size === 0) return [];

  const users = await db.user.findMany({
    where: { id: { in: [...participantIds] } },
    select: { id: true, login: true },
  });

  return users.map((user) => {
    const totals = totalsByUser.get(user.id) ?? { views: 0, weekCents: 0 };
    const carryInCents = carryByUser.get(user.id) ?? 0;
    const result = settleWeek(totals.weekCents, carryInCents);
    return {
      userId: user.id,
      login: user.login,
      views: totals.views,
      weekCents: totals.weekCents,
      carryInCents,
      ...result,
    };
  });
}
