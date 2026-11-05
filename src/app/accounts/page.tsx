import { AccountStatus, Platform } from "@prisma/client";
import { requireClipper } from "@/lib/auth-guards";
import { getAccountWindow, getAccountWindowNow } from "@/lib/account-window";
import { prisma } from "@/lib/prisma";
import { AccountsForm } from "./accounts-form";

export const instant = false;

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

export default async function AccountsPage() {
  const user = await requireClipper();
  const accounts = await prisma.platformAccount.findMany({
    where: { userId: user.id },
    orderBy: [{ platform: "asc" }, { id: "asc" }],
    select: { id: true, platform: true, url: true, status: true },
  });

  const now = getAccountWindowNow();
  const accountWindow = getAccountWindow(now);
  const usedByPlatform = {
    TIKTOK: accounts.filter(
      (account) => account.platform === Platform.TIKTOK && account.status !== AccountStatus.REJECTED,
    ).length,
    YOUTUBE: accounts.filter(
      (account) => account.platform === Platform.YOUTUBE && account.status !== AccountStatus.REJECTED,
    ).length,
    INSTAGRAM: accounts.filter(
      (account) => account.platform === Platform.INSTAGRAM && account.status !== AccountStatus.REJECTED,
    ).length,
  };

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 space-y-8 px-6 py-10">
      <header>
        <p className="text-sm text-zinc-600">Профиль: {user.login}</p>
        <h1 className="mt-2 text-3xl font-semibold">Мои аккаунты</h1>
        <p className="mt-2 text-zinc-600">
          Добавлять можно до трёх аккаунтов каждой платформы. Отклонённые аккаунты в лимит не входят.
        </p>
      </header>

      <AccountsForm
        checkedAt={now.getTime()}
        closesAt={accountWindow.closesAt.getTime()}
        opensAt={accountWindow.opensAt.getTime()}
      />

      <section className="space-y-4">
        <h2 className="text-xl font-medium">Использованный лимит</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {Object.entries(usedByPlatform).map(([platform, used]) => (
            <div className="rounded-lg border border-zinc-200 p-4" key={platform}>
              <p className="font-medium">{platformNames[platform as Platform]}</p>
              <p className="mt-1 text-sm text-zinc-600">использовано {used} из 3</p>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-medium">Аккаунты</h2>
        {accounts.length === 0 ? (
          <p className="rounded-lg border border-dashed border-zinc-300 p-5 text-zinc-600">
            Пока аккаунтов нет.
          </p>
        ) : (
          <ul className="space-y-3">
            {accounts.map((account) => (
              <li className="rounded-lg border border-zinc-200 p-4" key={account.id}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{platformNames[account.platform]}</span>
                  <span className="rounded-full bg-zinc-100 px-3 py-1 text-sm">
                    {statusNames[account.status]}
                  </span>
                </div>
                <a
                  className="mt-2 block break-all text-sm text-blue-700 underline"
                  href={account.url}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  {account.url}
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
