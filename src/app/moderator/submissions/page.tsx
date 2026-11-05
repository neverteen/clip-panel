import { Platform, Prisma, SubmissionStatus } from "@prisma/client";
import { MIN_VIDEO_VIEWS } from "@/lib/config";
import { requireModerator } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { utcToMoscowDateTimeValue } from "@/lib/week";
import { ReviewForm } from "./review-form";

export const instant = false;

type StatusFilter = "PENDING" | "APPROVED" | "REJECTED" | "PAID" | "ALL";

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

function parseStatus(value: string | undefined): StatusFilter {
  if (value === "APPROVED" || value === "REJECTED" || value === "PAID" || value === "ALL") return value;
  return "PENDING";
}

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

export default async function ModeratorSubmissionsPage({
  searchParams,
}: PageProps<"/moderator/submissions">) {
  await requireModerator();
  const params = await searchParams;
  const rawStatus = Array.isArray(params.status) ? params.status[0] : params.status;
  const rawWeek = Array.isArray(params.week) ? params.week[0] : params.week;
  const status = parseStatus(rawStatus);
  const weeks = await prisma.submission.findMany({
    distinct: ["weekStart"],
    orderBy: { weekStart: "desc" },
    select: { weekStart: true },
  });
  const selectedWeek = weeks.find((item) => item.weekStart.toISOString() === rawWeek)?.weekStart;

  const where: Prisma.SubmissionWhereInput = {
    ...(status === "ALL" ? {} : { status }),
    ...(selectedWeek ? { weekStart: selectedWeek } : {}),
  };
  const submissions = await prisma.submission.findMany({
    where,
    orderBy: [{ weekStart: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      videoUrl: true,
      publishedAt: true,
      weekStart: true,
      views: true,
      amountCents: true,
      status: true,
      rejectReason: true,
      user: { select: { login: true, isActive: true } },
      account: { select: { platform: true } },
    },
  });

  return (
    <main className="mx-auto w-full max-w-7xl flex-1 space-y-8 px-6 py-10">
      <header>
        <h1 className="text-3xl font-semibold">Заявки на оплату роликов</h1>
        <p className="mt-2 text-zinc-600">
          Для одобрения проверьте ролик, дату публикации и просмотры (не менее {MIN_VIDEO_VIEWS.toLocaleString("ru-RU")}).
        </p>
        <p className="mt-1 text-sm text-zinc-600">
          Одобрение фиксирует просмотры и сумму. Начисления в копилку на этом шаге нет.
        </p>
      </header>

      <form action="/moderator/submissions" className="flex flex-wrap items-end gap-3" method="get">
        <label className="space-y-1 text-sm">
          <span className="block">Статус</span>
          <select className="rounded-md border border-zinc-300 px-3 py-2" defaultValue={status} name="status">
            <option value="PENDING">На проверке</option>
            <option value="APPROVED">Одобренные</option>
            <option value="REJECTED">Отклонённые</option>
            <option value="PAID">Оплаченные</option>
            <option value="ALL">Все статусы</option>
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="block">Неделя</span>
          <select className="min-w-64 rounded-md border border-zinc-300 px-3 py-2" defaultValue={selectedWeek?.toISOString() ?? "ALL"} name="week">
            <option value="ALL">Все недели</option>
            {weeks.map(({ weekStart }) => (
              <option key={weekStart.toISOString()} value={weekStart.toISOString()}>
                Неделя с {formatMoscow(weekStart)} МСК
              </option>
            ))}
          </select>
        </label>
        <button className="rounded-md border border-zinc-300 px-4 py-2" type="submit">
          Показать
        </button>
      </form>

      {submissions.length === 0 ? (
        <p className="rounded-lg border border-dashed border-zinc-300 p-5 text-zinc-600">
          Заявок для выбранного фильтра нет.
        </p>
      ) : (
        <div className="space-y-4">
          {submissions.map((submission) => (
            <article className="space-y-4 rounded-lg border border-zinc-200 p-5" key={submission.id}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-semibold">{submission.user.login} · {platformNames[submission.account.platform]}</h2>
                <span className="rounded-full bg-zinc-100 px-3 py-1 text-sm">
                  {statusNames[submission.status]}
                </span>
              </div>
              {!submission.user.isActive && (
                <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
                  Пользователь отключён. Решение по заявке потребует явного подтверждения.
                </p>
              )}
              <dl className="grid gap-2 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-zinc-500">Опубликован</dt>
                  <dd>{formatMoscow(submission.publishedAt)} МСК</dd>
                </div>
                <div>
                  <dt className="text-zinc-500">Неделя</dt>
                  <dd>с {formatMoscow(submission.weekStart)} МСК</dd>
                </div>
                <div>
                  <dt className="text-zinc-500">Просмотры</dt>
                  <dd>{submission.views.toLocaleString("ru-RU")}</dd>
                </div>
                <div>
                  <dt className="text-zinc-500">Сумма</dt>
                  <dd>{formatCents(submission.amountCents)}</dd>
                </div>
              </dl>
              <a
                className="block break-all text-blue-700 underline"
                href={submission.videoUrl}
                rel="noopener noreferrer"
                target="_blank"
              >
                {submission.videoUrl}
              </a>
              {submission.rejectReason && (
                <p className="text-sm text-red-800">Причина отклонения: {submission.rejectReason}</p>
              )}
              {submission.status === SubmissionStatus.PENDING && (
                <ReviewForm
                  isUserActive={submission.user.isActive}
                  publishedAt={utcToMoscowDateTimeValue(submission.publishedAt)}
                  submissionId={submission.id}
                />
              )}
            </article>
          ))}
        </div>
      )}
    </main>
  );
}
