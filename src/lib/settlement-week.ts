import type { Prisma } from "@prisma/client";
import { getWindow, WEEK_MS } from "@/lib/week";

export function getLastCompletedWeekStart(now: Date) {
  const current = getWindow(now);
  return current.end.getTime() <= now.getTime()
    ? current.start
    : new Date(current.start.getTime() - WEEK_MS);
}

export async function lockSettlementWeek(
  tx: Prisma.TransactionClient,
  weekStart: Date,
) {
  const lockName = `week-closure:${weekStart.toISOString()}`;
  await tx.$queryRaw<Array<{ pg_advisory_xact_lock: null }>>`
    SELECT pg_advisory_xact_lock(hashtextextended(${lockName}, 0))
  `;
}

export function getWeekStarts(firstWeek: Date, lastWeek: Date) {
  const weeks: Date[] = [];
  for (let timestamp = firstWeek.getTime(); timestamp <= lastWeek.getTime(); timestamp += WEEK_MS) {
    weeks.push(new Date(timestamp));
  }
  return weeks;
}
