import { AccountStatus, Platform, SubmissionStatus } from "@prisma/client";
import { MIN_VIDEO_VIEWS } from "@/lib/config";
import { requireClipper } from "@/lib/auth-guards";
import { getNow } from "@/lib/now";
import { prisma } from "@/lib/prisma";
import { SubmissionForm } from "./submission-form";

export const instant = false;

const platformNames: Record<Platform, string> = {
  TIKTOK: "TikTok",
  YOUTUBE: "YouTube",
  INSTAGRAM: "Instagram",
};

const statusNames: Record<SubmissionStatus, string> = {
  PENDING: "На проверке",
  APPROVED: "Одобрена",
  REJECTED: "Отклонена",
  PAID: "Оплачена",
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
  const [accounts, submissions] = await Promise.all([
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
  ]);

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 space-y-8 px-6 py-10">
      <header>
        <p className="text-sm text-zinc-600">Профиль: {user.login}</p>
        <h1 className="mt-2 text-3xl font-semibold">Заявки на оплату роликов</h1>
        <p className="mt-2 text-zinc-600">
          Минимум {MIN_VIDEO_VIEWS.toLocaleString("ru-RU")} просмотров для одобрения.
        </p>
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
          <p className="rounded-lg border border-dashed border-zinc-300 p-5 text-zinc-600">
            Заявок пока нет.
          </p>
        ) : (
          <ul className="space-y-3">
            {submissions.map((submission) => (
              <li className="space-y-2 rounded-lg border border-zinc-200 p-4" key={submission.id}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{platformNames[submission.account.platform]}</span>
                  <span className="rounded-full bg-zinc-100 px-3 py-1 text-sm">
                    {statusNames[submission.status]}
                  </span>
                </div>
                <a
                  className="block break-all text-sm text-blue-700 underline"
                  href={submission.videoUrl}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  {submission.videoUrl}
                </a>
                <p className="text-sm text-zinc-600">
                  Опубликован: {formatMoscow(submission.publishedAt)} МСК · Неделя с {formatMoscow(submission.weekStart)} МСК
                </p>
                <p className="text-sm">
                  Просмотры: {submission.views.toLocaleString("ru-RU")} · Сумма: {formatCents(submission.amountCents)}
                </p>
                {submission.rejectReason && (
                  <p className="text-sm text-red-800">Причина отклонения: {submission.rejectReason}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
