import { AccountStatus, Platform } from "@prisma/client";
import { EmptyState, PageHeader, StatusBadge } from "@/components/ui";
import { MIN_VIDEO_VIEWS } from "@/lib/config";
import { requireClipper } from "@/lib/auth-guards";
import { getNow } from "@/lib/now";
import { prisma } from "@/lib/prisma";
import { getUnreadCounts } from "@/lib/submission-chat";
import { SubmissionForm } from "./submission-form";

export const instant = false;

const platformNames: Record<Platform, string> = {
  TIKTOK: "TikTok",
  YOUTUBE: "YouTube",
  INSTAGRAM: "Instagram",
};

function formatMoscow(value: Date) {
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Moscow",
  }).format(value);
}

function formatCents(amountCents: number) {
  return `$${Math.floor(amountCents / 100)}.${String(amountCents % 100).padStart(2, "0")}`;
}

export default async function SubmissionsPage() {
  const user = await requireClipper();
  const now = getNow();
  const [accounts, submissions, unreadCounts] = await Promise.all([
    prisma.platformAccount.findMany({
      where: { userId: user.id, status: AccountStatus.APPROVED },
      orderBy: { platform: "asc" },
      select: { id: true, platform: true, url: true },
    }),
    prisma.submission.findMany({
      where: { userId: user.id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: {
        id: true,
        account: { select: { platform: true } },
        videoUrl: true,
        publishedAt: true,
        weekStart: true,
        views: true,
        amountCents: true,
        status: true,
        rejectReason: true,
      },
    }),
    getUnreadCounts(user.id, user.role),
  ]);

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 space-y-8 px-6 py-10">
      <header>
        <p className="text-sm text-muted">Профиль: {user.login}</p>
        <div className="mt-2"><PageHeader title="Заявки на оплату роликов" description={`Минимум ${MIN_VIDEO_VIEWS.toLocaleString("ru-RU")} просмотров для одобрения.`} /></div>
      </header>

      <SubmissionForm
        accounts={accounts.map((account) => ({
          id: account.id,
          platform: platformNames[account.platform],
          url: account.url,
        }))}
        checkedAt={now.getTime()}
      />

      <section className="space-y-4">
        <h2 className="text-xl font-medium">Мои заявки</h2>
        {submissions.length === 0 ? (
          <EmptyState title="Заявок пока нет" description="Подайте первый ролик, когда появится одобренный аккаунт платформы." />
        ) : (
          <ul className="space-y-3">
            {submissions.map((submission) => (
              <li className="space-y-2 rounded-lg border border-border p-4" key={submission.id}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{platformNames[submission.account.platform]}</span>
                  <StatusBadge status={submission.status} />
                </div>
                <a
                  className="block break-all text-sm text-accent-2 underline-offset-4 hover:underline underline"
                  href={submission.videoUrl}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  {submission.videoUrl}
                </a>
                <p className="text-sm text-muted">
                  Опубликован: {formatMoscow(submission.publishedAt)} МСК · Неделя с {formatMoscow(submission.weekStart)} МСК
                </p>
                <p className="text-sm">
                  Просмотры: {submission.views.toLocaleString("ru-RU")} · Сумма: {formatCents(submission.amountCents)}
                </p>
                <a className="inline-flex items-center gap-2 text-sm font-medium text-accent-2 underline-offset-4 hover:underline underline" href={`/submissions/${submission.id}`}>
                  Открыть чат
                  {(unreadCounts.get(submission.id) ?? 0) > 0 && (
                    <span aria-label={`Непрочитанных сообщений: ${unreadCounts.get(submission.id)}`} className="rounded-full bg-danger/10 px-2 py-0.5 text-danger no-underline">
                      {unreadCounts.get(submission.id)} непрочитанных
                    </span>
                  )}
                </a>
                {submission.rejectReason && (
                  <p className="text-sm text-danger">Причина отклонения: {submission.rejectReason}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
