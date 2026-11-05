import { requireModerator } from "@/lib/auth-guards";
import { getNow } from "@/lib/now";
import { prisma } from "@/lib/prisma";
import { PAYOUT_THRESHOLD_CENTS, MIN_WEEK_VIEWS, RATE_CENTS_PER_1000 } from "@/lib/config";
import { getLastCompletedWeekStart, getWeekStarts } from "@/lib/settlement-week";
import { computeWeekResults } from "@/lib/week-results";
import { Card, PageHeader, StatusBadge } from "@/components/ui";
import { CloseWeekForm } from "./close-week-form";

export const instant = false;

function formatMoscow(value: Date) {
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeZone: "Europe/Moscow",
  }).format(value);
}

function formatCents(value: number) {
  return `$${Math.floor(value / 100)}.${String(value % 100).padStart(2, "0")}`;
}

function resultLabel(row: { weekCents: number; payableCents: number; carryOutCents: number; expiredCents: number }) {
  if (row.payableCents > 0) return "К выводу";
  if (row.expiredCents > 0 && row.carryOutCents > 0) return "Копилка сгорит; итог — в новую копилку";
  if (row.carryOutCents > 0) return "В копилку";
  if (row.expiredCents > 0) return "Копилка сгорит";
  const minWeekCents = Math.floor(MIN_WEEK_VIEWS * RATE_CENTS_PER_1000 / 1000);
  return row.weekCents < minWeekCents ? "Ниже 5000 просмотров" : "Нет суммы к выплате";
}

export default async function ModeratorWeeksPage({
  searchParams,
}: PageProps<"/moderator/weeks">) {
  await requireModerator();
  const params = await searchParams;
  const rawWeek = Array.isArray(params.week) ? params.week[0] : params.week;
  const lastCompletedWeek = getLastCompletedWeekStart(getNow());
  const earliestSubmission = await prisma.submission.findFirst({
    orderBy: { weekStart: "asc" },
    select: { weekStart: true },
  });
  const weeks = earliestSubmission && earliestSubmission.weekStart <= lastCompletedWeek
    ? getWeekStarts(earliestSubmission.weekStart, lastCompletedWeek)
    : [];
  const [closures, pendingGroups] = weeks.length > 0
    ? await Promise.all([
        prisma.weekClosure.findMany({
          where: { weekStart: { in: weeks } },
          select: { weekStart: true },
        }),
        prisma.submission.groupBy({
          by: ["weekStart"],
          where: { weekStart: { in: weeks }, status: "PENDING" },
          _count: { _all: true },
        }),
      ])
    : [[], []];
  const closureKeys = new Set(closures.map((closure) => closure.weekStart.toISOString()));
  const pendingByWeek = new Map(pendingGroups.map((group) => [group.weekStart.toISOString(), group._count._all]));
  const weekStatuses = weeks.map((weekStart, index) => {
    const key = weekStart.toISOString();
    const closed = closureKeys.has(key);
    const pendingCount = pendingByWeek.get(key) ?? 0;
    const previousClosed = index === 0 || weeks.slice(0, index).every((previous) => closureKeys.has(previous.toISOString()));
    return {
      weekStart,
      closed,
      pendingCount,
      canClose: !closed && pendingCount === 0 && previousClosed,
      label: closed
        ? "Закрыта"
        : pendingCount > 0
          ? `Нельзя закрыть: ${pendingCount} заявок на проверке`
          : !previousClosed
            ? "Нельзя: сначала закройте предыдущую неделю"
            : "Можно закрыть",
    };
  });

  const selected = weekStatuses.find((week) => week.weekStart.toISOString() === rawWeek)
    ?? weekStatuses.find((week) => !week.closed)
    ?? weekStatuses.at(-1);
  const preview = selected ? await computeWeekResults(prisma, selected.weekStart) : [];
  const weekStatus = selected;
  const weeklyPayoutThreshold = PAYOUT_THRESHOLD_CENTS;

  return (
    <main className="mx-auto w-full max-w-7xl flex-1 space-y-6 px-6 py-10">
      <PageHeader
        title="Закрытие недель"
        description={`Неделя завершается в воскресенье в 22:00 МСК. Минимум для копилки — ${formatCents(Math.floor(MIN_WEEK_VIEWS * RATE_CENTS_PER_1000 / 1000))}; порог выплаты — ${formatCents(weeklyPayoutThreshold)}.`}
      />
      <Card className="space-y-4">
        <h2 className="text-lg font-semibold">Недели от первой заявки до последней завершённой</h2>
        {weekStatuses.length === 0 ? (
          <p className="text-sm text-[var(--muted-foreground)]">Завершённых недель с заявками пока нет.</p>
        ) : (
          <ul className="space-y-2">
            {weekStatuses.map((week) => (
              <li className="flex flex-wrap items-center justify-between gap-2 rounded border border-[var(--border)] p-3" key={week.weekStart.toISOString()}>
                <a className="underline" href={`/moderator/weeks?week=${encodeURIComponent(week.weekStart.toISOString())}`}>
                  Неделя с {formatMoscow(week.weekStart)} МСК
                </a>
                <StatusBadge status={week.closed ? "Закрыта" : week.label} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      {selected && weekStatus && (
        <Card className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold">Предпросмотр: неделя с {formatMoscow(selected.weekStart)} МСК</h2>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">Суммы пересчитываются на сервере при закрытии. Данные предпросмотра не используются как вход операции.</p>
          </div>
          {preview.length === 0 ? (
            <p className="text-sm text-[var(--muted-foreground)]">Нет пользователей с заявками или копилкой. Неделя будет закрыта без результатов.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="responsive-table w-full min-w-[900px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)]">
                    <th className="p-2">Логин</th><th className="p-2">Просмотры</th><th className="p-2">Итог недели</th>
                    <th className="p-2">Копилка на входе</th><th className="p-2">Результат</th><th className="p-2">К выводу</th>
                    <th className="p-2">Новая копилка</th><th className="p-2">Сгорит</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.map((row) => (
                    <tr className="border-b border-[var(--border)]" key={row.userId}>
                      <td className="p-2" data-label="Логин">{row.login}</td>
                      <td className="p-2" data-label="Просмотры">{row.views.toLocaleString("ru-RU")}</td>
                      <td className="p-2" data-label="Итог недели">{formatCents(row.weekCents)}</td>
                      <td className="p-2" data-label="Копилка на входе">{formatCents(row.carryInCents)}</td>
                      <td className="p-2" data-label="Результат">{resultLabel(row)}</td>
                      <td className="p-2" data-label="К выводу">{formatCents(row.payableCents)}</td>
                      <td className="p-2" data-label="Новая копилка">{formatCents(row.carryOutCents)}</td>
                      <td className="p-2" data-label="Сгорит">{formatCents(row.expiredCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-sm">Статус недели: {weekStatus.label}</p>
          {weekStatus.canClose && <CloseWeekForm weekStart={selected.weekStart.toISOString()} />}
        </Card>
      )}
    </main>
  );
}
