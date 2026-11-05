import { Platform, Prisma, SubmissionStatus } from "@prisma/client";
import { Button, EmptyState, PageHeader, Select, StatusBadge } from "@/components/ui";
import { MIN_VIDEO_VIEWS } from "@/lib/config";
import { requireModerator } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { getUnreadCounts } from "@/lib/submission-chat";
import { utcToMoscowDateTimeValue } from "@/lib/week";
import { ReviewForm } from "./review-form";

export const instant = false;

type StatusFilter = "PENDING" | "APPROVED" | "REJECTED" | "PAID" | "ALL";

const platformNames: Record<Platform, string> = {
  TIKTOK: "TikTok",
  YOUTUBE: "YouTube",
  INSTAGRAM: "Instagram",
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
  const moderator = await requireModerator();
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
  const unreadCounts = await getUnreadCounts(moderator.id, moderator.role);

  return (
    <main className="mx-auto w-full max-w-7xl flex-1 space-y-8 px-6 py-10">
      <header>
        <PageHeader title="Заявки на оплату роликов" description={`Для одобрения проверьте ролик, дату публикации и просмотры (не менее ${MIN_VIDEO_VIEWS.toLocaleString("ru-RU")}). Одобрение фиксирует просмотры и сумму без начисления в копилку на этом шаге.`} />
      </header>

      <form action="/moderator/submissions" className="flex flex-wrap items-end gap-3" method="get">
        <label className="space-y-1 text-sm">
          <span className="block">Статус</span>
          <Select defaultValue={status} name="status">
            <option value="PENDING">На проверке</option>
            <option value="APPROVED">Одобренные</option>
            <option value="REJECTED">Отклонённые</option>
            <option value="PAID">Оплаченные</option>
            <option value="ALL">Все статусы</option>
          </Select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="block">Неделя</span>
          <Select className="min-w-64" defaultValue={selectedWeek?.toISOString() ?? "ALL"} name="week">
            <option value="ALL">Все недели</option>
            {weeks.map(({ weekStart }) => (
              <option key={weekStart.toISOString()} value={weekStart.toISOString()}>
                Неделя с {formatMoscow(weekStart)} МСК
              </option>
            ))}
          </Select>
        </label>
        <Button variant="secondary" type="submit">Показать</Button>
      </form>

      {submissions.length === 0 ? (
        <EmptyState title="Заявок для выбранного фильтра нет" />
      ) : (
        <div className="space-y-4">
          {submissions.map((submission) => (
            <article className="space-y-4 rounded-lg border border-border p-5" key={submission.id}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-semibold">{submission.user.login} · {platformNames[submission.account.platform]}</h2>
                <StatusBadge status={submission.status} />
              </div>
              <a className="inline-flex items-center gap-2 text-sm font-medium text-accent-2 underline-offset-4 hover:underline underline" href={`/moderator/submissions/${submission.id}`}>
                Открыть заявку и чат
                {(unreadCounts.get(submission.id) ?? 0) > 0 && (
                  <span aria-label={`Непрочитанных сообщений: ${unreadCounts.get(submission.id)}`} className="rounded-full bg-danger/10 px-2 py-0.5 text-danger no-underline">
                    {unreadCounts.get(submission.id)} непрочитанных
                  </span>
                )}
              </a>
              {!submission.user.isActive && (
                <p className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
                  Пользователь отключён. Решение по заявке потребует явного подтверждения.
                </p>
              )}
              <dl className="grid gap-2 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-muted">Опубликован</dt>
                  <dd>{formatMoscow(submission.publishedAt)} МСК</dd>
                </div>
                <div>
                  <dt className="text-muted">Неделя</dt>
                  <dd>с {formatMoscow(submission.weekStart)} МСК</dd>
                </div>
                <div>
                  <dt className="text-muted">Просмотры</dt>
                  <dd>{submission.views.toLocaleString("ru-RU")}</dd>
                </div>
                <div>
                  <dt className="text-muted">Сумма</dt>
                  <dd>{formatCents(submission.amountCents)}</dd>
                </div>
              </dl>
              <a
                className="block break-all text-accent-2 underline-offset-4 hover:underline underline"
                href={submission.videoUrl}
                rel="noopener noreferrer"
                target="_blank"
              >
                {submission.videoUrl}
              </a>
              {submission.rejectReason && (
                <p className="text-sm text-danger">Причина отклонения: {submission.rejectReason}</p>
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
