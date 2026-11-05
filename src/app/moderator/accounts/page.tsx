import { AccountStatus, Platform } from "@prisma/client";
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

const statusNames: Record<AccountStatus, string> = {
  PENDING: "На проверке",
  APPROVED: "Одобрен",
  REJECTED: "Отклонён",
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
        <h1 className="text-3xl font-semibold">Аккаунты платформ</h1>
        <p className="mt-2 text-zinc-600">Проверяйте профили и каналы нарезчиков.</p>
      </header>

      <form action="/moderator/accounts" className="flex flex-wrap items-end gap-3" method="get">
        <label className="space-y-1 text-sm">
          <span className="block">Список аккаунтов</span>
          <select className="rounded-md border border-zinc-300 px-3 py-2" defaultValue={filter} name="filter">
            <option value="PENDING">Ожидают решения</option>
            <option value="HISTORY">История решений</option>
            <option value="APPROVED">Одобренные</option>
            <option value="REJECTED">Отклонённые</option>
          </select>
        </label>
        <button className="rounded-md border border-zinc-300 px-4 py-2" type="submit">
          Показать
        </button>
      </form>

      {accounts.length === 0 ? (
        <p className="rounded-lg border border-dashed border-zinc-300 p-5 text-zinc-600">
          {filter === "PENDING" ? "Аккаунтов на проверке нет." : "Записей для этого фильтра нет."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200">
          <table className="w-full min-w-[850px] text-left text-sm">
            <thead className="bg-zinc-100">
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
                <tr className="border-t border-zinc-200 align-top" key={account.id}>
                  <td className="px-4 py-3">{account.user.login}</td>
                  <td className="px-4 py-3">{platformNames[account.platform]}</td>
                  <td className="max-w-sm px-4 py-3">
                    <a
                      className="break-all text-blue-700 underline"
                      href={account.url}
                      rel="noopener noreferrer"
                      target="_blank"
                    >
                      {account.url}
                    </a>
                  </td>
                  <td className="px-4 py-3">{statusNames[account.status]}</td>
                  {filter === "PENDING" && (
                    <td className="px-4 py-3">
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
