import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Card, PageHeader, StatusBadge } from "@/components/ui";
import { SubmissionChat } from "@/components/submission-chat";
import { requireModerator } from "@/lib/auth-guards";
import { advanceReadState, makeSubmissionEvents, submissionIdSchema } from "@/lib/submission-chat";
import { prisma } from "@/lib/prisma";
import { utcToMoscowDateTimeValue } from "@/lib/week";
import { ReviewForm } from "../review-form";

export const instant = false;

function dateMoscow(value: Date) {
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Moscow",
  }).format(value);
}

function amount(amountCents: number) {
  return `$${Math.floor(amountCents / 100)}.${String(amountCents % 100).padStart(2, "0")}`;
}

export default async function ModeratorSubmissionDetailPage({ params }: PageProps<"/moderator/submissions/[id]">) {
  await connection();
  const moderator = await requireModerator();
  const { id } = await params;
  if (!submissionIdSchema.safeParse(id).success) notFound();
  const submission = await prisma.submission.findUnique({
    where: { id },
    select: {
      id: true, videoUrl: true, publishedAt: true, weekStart: true,
      views: true, amountCents: true, status: true, rejectReason: true,
      createdAt: true, reviewedAt: true,
      user: { select: { login: true, isActive: true } },
      account: { select: { platform: true } },
    },
  });
  if (!submission) notFound();

  const latestMessages = await prisma.message.findMany({
    where: { submissionId: id },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 50,
    select: { id: true, text: true, createdAt: true, authorId: true, author: { select: { login: true } } },
  });
  const initialMessages = latestMessages.reverse();
  await advanceReadState(moderator.id, id, initialMessages.at(-1)?.createdAt ?? new Date());

  const initialEvents = makeSubmissionEvents(submission)
    .map((event) => ({ ...event, createdAt: event.createdAt.toISOString() }));

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 space-y-6 px-6 py-10">
      <PageHeader title={`Заявка: ${submission.user.login}`} description={`Неделя с ${dateMoscow(submission.weekStart)} МСК · ${submission.account.platform}`} />
      <Card className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Проверка заявки</h2>
          <StatusBadge status={submission.status} />
        </div>
        <a className="block break-all text-blue-700 underline" href={submission.videoUrl} rel="noopener noreferrer" target="_blank">
          {submission.videoUrl}
        </a>
        <p className="text-sm text-[var(--muted-foreground)]">
          Опубликован: {dateMoscow(submission.publishedAt)} МСК · Просмотры: {submission.views.toLocaleString("ru-RU")} · Сумма: {amount(submission.amountCents)}
        </p>
        {submission.rejectReason && <p className="whitespace-pre-wrap text-sm text-red-800">Причина отклонения: {submission.rejectReason}</p>}
        {!submission.user.isActive && <p className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">Пользователь отключён. Для решения требуется явное подтверждение.</p>}
        {submission.status === "PENDING" && <ReviewForm isUserActive={submission.user.isActive} publishedAt={utcToMoscowDateTimeValue(submission.publishedAt)} submissionId={submission.id} />}
      </Card>
      <SubmissionChat
        initialEvents={initialEvents}
        initialMessages={initialMessages.map((message) => ({ ...message, createdAt: message.createdAt.toISOString() }))}
        submissionId={submission.id}
        viewerId={moderator.id}
      />
    </main>
  );
}
