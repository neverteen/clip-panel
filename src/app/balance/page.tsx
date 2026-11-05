import { Card, PageHeader, StatusBadge } from "@/components/ui";
import { requireClipper } from "@/lib/auth-guards";
import { getNow } from "@/lib/now";
import { prisma } from "@/lib/prisma";
import { getWindow, WEEK_MS } from "@/lib/week";
import { computeWeekResults } from "@/lib/week-results";

export const instant = false;

function formatCents(value: number) {
  const sign = value < 0 ? "−" : "";
  const absolute = Math.abs(value);
  return `${sign}$${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, "0")}`;
}

function formatMoscow(value: Date) {
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeZone: "Europe/Moscow",
  }).format(value);
}

const ledgerTypeNames: Record<string, string> = {
  ACCRUAL: "Начисление",
  PAYOUT: "Вывод",
  ADJUSTMENT: "Корректировка",
};

export default async function BalancePage() {
  const user = await requireClipper();
  const now = getNow();
  const currentWeekStart = getWindow(now).start;

  const [ledgerBalance, weekPreviewRows, pendingCount, latestClosure, weekHistory, ledgerEntries] = await Promise.all([
    prisma.ledgerEntry.aggregate({
      where: { userId: user.id },
      _sum: { amountCents: true },
    }),
    computeWeekResults(prisma, currentWeekStart),
    prisma.submission.count({ where: { userId: user.id, weekStart: currentWeekStart, status: "PENDING" } }),
    prisma.weekClosure.findFirst({
      where: { weekStart: { lte: currentWeekStart } },
      orderBy: { weekStart: "desc" },
      select: { weekStart: true },
    }),
    prisma.weekResult.findMany({
      where: { userId: user.id },
      orderBy: { weekStart: "desc" },
      select: {
        weekStart: true, weekCents: true, carryInCents: true,
        payableCents: true, carryOutCents: true, expiredCents: true,
      },
    }),
    prisma.ledgerEntry.findMany({
      where: { userId: user.id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true, type: true, amountCents: true, weekStart: true, note: true, createdAt: true },
    }),
  ]);

  const latestCarry = latestClosure
    ? await prisma.weekResult.findUnique({
        where: { userId_weekStart: { userId: user.id, weekStart: latestClosure.weekStart } },
        select: { carryOutCents: true },
      })
    : null;
  const currentPreview = weekPreviewRows.find((row) => row.userId === user.id);
  const currentClosed = await prisma.weekClosure.findUnique({
    where: { weekStart: currentWeekStart },
    select: { id: true },
  });
  const currentFinal = currentClosed
    ? await prisma.weekResult.findUnique({
        where: { userId_weekStart: { userId: user.id, weekStart: currentWeekStart } },
        select: { weekCents: true, carryInCents: true, payableCents: true, carryOutCents: true, expiredCents: true },
      })
    : null;
  const progress = currentFinal ?? currentPreview ?? {
    views: 0, weekCents: 0, carryInCents: 0, payableCents: 0, carryOutCents: 0, expiredCents: 0,
  };
  const carryOutCents = latestCarry?.carryOutCents ?? 0;
  const carryExpiresAt = latestClosure && carryOutCents > 0
    ? new Date(latestClosure.weekStart.getTime() + WEEK_MS)
    : null;
  const availableCents = ledgerBalance._sum.amountCents ?? 0;

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 space-y-6 px-6 py-10">
      <PageHeader title="Баланс" description={`Профиль: ${user.login}`} />

      <section className="grid gap-4 sm:grid-cols-2">
        <Card>
          <p className="text-sm text-[var(--muted-foreground)]">Доступно к выводу</p>
          <p className="mt-2 text-3xl font-semibold">{formatCents(availableCents)}</p>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">Сумма записей денежного журнала</p>
        </Card>
        <Card>
          <p className="text-sm text-[var(--muted-foreground)]">Текущая копилка</p>
          <p className="mt-2 text-3xl font-semibold">{formatCents(carryOutCents)}</p>
          {carryExpiresAt ? (
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              Живёт до закрытия недели с {formatMoscow(carryExpiresAt)} МСК.
            </p>
          ) : (
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">Копилки сейчас нет.</p>
          )}
        </Card>
      </section>

      <Card className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Текущая неделя с {formatMoscow(currentWeekStart)} МСК</h2>
          <StatusBadge status={currentClosed ? "Закрыта" : "Предварительно"} />
        </div>
        <p>Одобренные просмотры: {(currentPreview?.views ?? 0).toLocaleString("ru-RU")}</p>
        <p>Сумма одобренных заявок недели: {formatCents(progress.weekCents)}</p>
        <p>Заявки на проверке: {pendingCount}</p>
        <p>Результат по правилам закрытия: к выводу {formatCents(progress.payableCents)}, в копилку {formatCents(progress.carryOutCents)}, сгорит {formatCents(progress.expiredCents)}.</p>
        {!currentClosed && (
          <p className="text-sm text-[var(--muted-foreground)]">
            Предварительный расчёт по правилам закрытия недели. Заявки должны быть обработаны до закрытия.
          </p>
        )}
        {currentClosed && <p>Итог зафиксирован: к выводу {formatCents(progress.payableCents)}, в копилку {formatCents(progress.carryOutCents)}, сгорело {formatCents(progress.expiredCents)}.</p>}
      </Card>

      <Card className="space-y-3">
        <h2 className="text-lg font-semibold">История закрытых недель</h2>
        {weekHistory.length === 0 ? (
          <p className="text-sm text-[var(--muted-foreground)]">Закрытых недель пока нет.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] border-collapse text-left text-sm">
              <thead><tr className="border-b border-[var(--border)]"><th className="p-2">Неделя</th><th className="p-2">Итог</th><th className="p-2">Копилка на входе</th><th className="p-2">К выводу</th><th className="p-2">Копилка дальше</th><th className="p-2">Сгорело</th></tr></thead>
              <tbody>
                {weekHistory.map((week) => (
                  <tr className="border-b border-[var(--border)]" key={week.weekStart.toISOString()}>
                    <td className="p-2">{formatMoscow(week.weekStart)} МСК</td>
                    <td className="p-2">{formatCents(week.weekCents)}</td>
                    <td className="p-2">{formatCents(week.carryInCents)}</td>
                    <td className="p-2">{formatCents(week.payableCents)}</td>
                    <td className="p-2">{formatCents(week.carryOutCents)}</td>
                    <td className="p-2">{formatCents(week.expiredCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="space-y-3">
        <h2 className="text-lg font-semibold">Денежный журнал</h2>
        {ledgerEntries.length === 0 ? (
          <p className="text-sm text-[var(--muted-foreground)]">Записей журнала пока нет.</p>
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {ledgerEntries.map((entry) => (
              <li className="flex flex-wrap items-center justify-between gap-2 py-3" key={entry.id}>
                <div>
                  <p className="font-medium">{ledgerTypeNames[entry.type] ?? entry.type}</p>
                  <p className="text-sm text-[var(--muted-foreground)]">
                    {formatMoscow(entry.createdAt)} МСК{entry.weekStart ? ` · Неделя с ${formatMoscow(entry.weekStart)} МСК` : ""}{entry.note ? ` · ${entry.note}` : ""}
                  </p>
                </div>
                <span className="font-medium">{formatCents(entry.amountCents)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </main>
  );
}
