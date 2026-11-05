import { PayoutStatus } from "@prisma/client";
import { Card, PageHeader, StatusBadge } from "@/components/ui";
import { requireModerator } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { maskDestination } from "@/lib/payout-profile";
import { PayoutDecisionForm } from "./payout-decision-form";
import { PayoutDestination } from "./payout-destination";

export const instant = false;

type Filter = "REQUESTED" | "PAID" | "REJECTED" | "ALL";

function parseFilter(value: string | undefined): Filter {
  if (value === "PAID" || value === "REJECTED" || value === "ALL") return value;
  return "REQUESTED";
}

function formatCents(value: number) {
  const sign = value < 0 ? "−" : "";
  const absolute = Math.abs(value);
  return `${sign}$${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, "0")}`;
}

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Moscow",
  }).format(value);
}

const statusLabels: Record<PayoutStatus, string> = {
  REQUESTED: "Ожидает",
  PAID: "Оплачено",
  REJECTED: "Отклонено",
};

export default async function ModeratorPayoutsPage({
  searchParams,
}: PageProps<"/moderator/payouts">) {
  await requireModerator();
  const params = await searchParams;
  const rawStatus = Array.isArray(params.status) ? params.status[0] : params.status;
  const filter = parseFilter(rawStatus);
  const payouts = await prisma.payout.findMany({
    where: filter === "ALL" ? {} : { status: filter },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    select: {
      id: true,
      amountCents: true,
      method: true,
      destination: true,
      status: true,
      createdAt: true,
      processedAt: true,
      txRef: true,
      rejectReason: true,
      user: { select: { id: true, login: true, isActive: true } },
    },
  });
  const userIds = [...new Set(payouts.map((payout) => payout.user.id))];
  const balances = userIds.length > 0
    ? await prisma.ledgerEntry.groupBy({
        by: ["userId"],
        where: { userId: { in: userIds } },
        _sum: { amountCents: true },
      })
    : [];
  const balanceByUser = new Map(balances.map((entry) => [entry.userId, entry._sum.amountCents ?? 0]));

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 space-y-6 px-6 py-10">
      <PageHeader title="Заявки на вывод" description="Реквизиты в заявке сохранены на момент её создания. Проверяйте их перед ручной выплатой." />
      <form action="/moderator/payouts" className="flex flex-wrap items-end gap-3" method="get">
        <label className="space-y-1 text-sm">
          <span className="block">Статус</span>
          <select className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2" defaultValue={filter} name="status">
            <option value="REQUESTED">Ожидают</option>
            <option value="PAID">Оплаченные</option>
            <option value="REJECTED">Отклонённые</option>
            <option value="ALL">Все</option>
          </select>
        </label>
        <button className="rounded-md border border-[var(--border)] px-4 py-2" type="submit">Показать</button>
      </form>

      {payouts.length === 0 ? (
        <Card>Заявок для выбранного фильтра нет.</Card>
      ) : (
        <div className="space-y-4">
          {payouts.map((payout) => (
            <Card className="space-y-4" key={payout.id}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-semibold">{payout.user.login} · {payout.method === "CRYPTO" ? "Криптовалюта" : "Скины CS"}</h2>
                <StatusBadge status={statusLabels[payout.status]} />
              </div>
              {!payout.user.isActive && (
                <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
                  Пользователь отключён. Обработка потребует явного подтверждения.
                </p>
              )}
              <dl className="grid gap-2 text-sm sm:grid-cols-3">
                <div><dt className="text-[var(--muted-foreground)]">Запрошено</dt><dd>{formatCents(payout.amountCents)}</dd></div>
                <div><dt className="text-[var(--muted-foreground)]">Текущий баланс</dt><dd>{formatCents(balanceByUser.get(payout.user.id) ?? 0)}</dd></div>
                <div><dt className="text-[var(--muted-foreground)]">Дата заявки</dt><dd>{formatDate(payout.createdAt)} МСК</dd></div>
              </dl>
              <div>
                <p className="mb-1 text-sm font-medium">Реквизиты (середина скрыта)</p>
                <PayoutDestination masked={maskDestination(payout.destination)} payoutId={payout.id} />
              </div>
              {payout.status === PayoutStatus.REQUESTED && (
                <PayoutDecisionForm payoutId={payout.id} userIsActive={payout.user.isActive} />
              )}
              {payout.status === PayoutStatus.PAID && (
                <p className="text-sm">Оплачено {payout.processedAt ? `${formatDate(payout.processedAt)} МСК` : ""}. Подтверждение: <span className="whitespace-pre-wrap break-words">{payout.txRef}</span></p>
              )}
              {payout.status === PayoutStatus.REJECTED && (
                <p className="whitespace-pre-wrap break-words text-sm">Отклонено {payout.processedAt ? `${formatDate(payout.processedAt)} МСК` : ""}. Причина: {payout.rejectReason}</p>
              )}
            </Card>
          ))}
        </div>
      )}
    </main>
  );
}
