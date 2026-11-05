import { AccountStatus, Platform } from "@prisma/client";
import { Button, EmptyState, PageHeader, Select, StatusBadge } from "@/components/ui";
import { requireModerator } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { AccountDecisionForm } from "./decision-form";

export const instant = false;

type Filter = "PENDING" | "APPROVED" | "REJECTED" | "HISTORY";

const platformNames: Record<Platform, string> = {
  TIKTOK: "TikTok",
  YOUTUBE: "YouTube",
  INSTAGRAM: "Instagram",
};

function isFilter(value: string | undefined): value is Filter {
  return value === "PENDING" || value === "APPROVED" || value === "REJECTED" || value === "HISTORY";
}

export default async function ModeratorAccountsPage({
  searchParams,
}: PageProps<"/moderator/accounts">) {
  await requireModerator();
  const params = await searchParams;
  const rawFilter = Array.isArray(params.filter) ? params.filter[0] : params.filter;
  const filter = isFilter(rawFilter) ? rawFilter : "PENDING";
  const accounts = await prisma.platformAccount.findMany({
    where: filter === "HISTORY"
      ? { status: { in: [AccountStatus.APPROVED, AccountStatus.REJECTED] } }
      : { status: filter as AccountStatus },
    orderBy: { id: "asc" },
    select: {
      id: true,
      platform: true,
      url: true,
      status: true,
      user: { select: { login: true } },
    },
  });

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 space-y-8 px-6 py-10">
      <header>
        <PageHeader title="Аккаунты платформ" description="Проверяйте профили и каналы нарезчиков." />
      </header>

      <form action="/moderator/accounts" className="flex flex-wrap items-end gap-3" method="get">
        <label className="space-y-1 text-sm">
          <span className="block">Список аккаунтов</span>
          <Select className="min-w-48" defaultValue={filter} name="filter">
            <option value="PENDING">Ожидают решения</option>
            <option value="HISTORY">История решений</option>
            <option value="APPROVED">Одобренные</option>
            <option value="REJECTED">Отклонённые</option>
          </Select>
        </label>
        <Button variant="secondary" type="submit">Показать</Button>
      </form>

      {accounts.length === 0 ? (
        <EmptyState title={filter === "PENDING" ? "Аккаунтов на проверке нет" : "Записей для этого фильтра нет"} />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="responsive-table w-full min-w-[850px] text-left text-sm">
            <thead className="bg-surface-2">
              <tr>
                <th className="px-4 py-3">Логин</th>
                <th className="px-4 py-3">Платформа</th>
                <th className="px-4 py-3">Профиль или канал</th>
                <th className="px-4 py-3">Статус</th>
                {filter === "PENDING" && <th className="px-4 py-3">Решение</th>}
              </tr>
            </thead>
            <tbody>
              {accounts.map((account) => (
            <tr className="border-t border-border align-top" key={account.id}>
                  <td className="px-4 py-3" data-label="Логин">{account.user.login}</td>
                  <td className="px-4 py-3" data-label="Платформа">{platformNames[account.platform]}</td>
                  <td className="max-w-sm px-4 py-3" data-label="Профиль или канал">
                    <a
                      className="break-all text-accent-2 underline-offset-4 hover:underline underline"
                      href={account.url}
                      rel="noopener noreferrer"
                      target="_blank"
                    >
                      {account.url}
                    </a>
                  </td>
                  <td className="px-4 py-3" data-label="Статус"><StatusBadge status={account.status} /></td>
                  {filter === "PENDING" && (
                    <td className="px-4 py-3" data-label="Решение">
                      <AccountDecisionForm accountId={account.id} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
