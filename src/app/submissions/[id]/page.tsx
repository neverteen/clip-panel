import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Card, PageHeader, StatusBadge } from "@/components/ui";
import { SubmissionChat } from "@/components/submission-chat";
import { requireClipper } from "@/lib/auth-guards";
import { advanceReadState, makeSubmissionEvents, submissionIdSchema } from "@/lib/submission-chat";
import { prisma } from "@/lib/prisma";

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

export default async function ClipperSubmissionPage({ params }: PageProps<"/submissions/[id]">) {
  await connection();
  const user = await requireClipper();
  const { id } = await params;
  if (!submissionIdSchema.safeParse(id).success) notFound();
  const submission = await prisma.submission.findFirst({
    where: { id, userId: user.id },
    select: {
      id: true, videoUrl: true, publishedAt: true, weekStart: true,
      views: true, amountCents: true, status: true, rejectReason: true,
      createdAt: true, reviewedAt: true,
    },
  });
  if (!submission) notFound();

  const [latestMessages] = await Promise.all([
    prisma.message.findMany({
      where: { submissionId: id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 50,
      select: {
        id: true, text: true, createdAt: true, authorId: true, author: { select: { login: true } },
        attachments: { select: { id: true, mime: true, sizeBytes: true, width: true, height: true, createdAt: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
      },
    }),
  ]);
  const initialMessages = latestMessages.reverse();
  await advanceReadState(user.id, id, initialMessages.at(-1)?.createdAt ?? new Date());

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 space-y-6 px-6 py-10">
      <PageHeader title="Заявка и чат" description={`Профиль: ${user.login}`} />
      <Card className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Заявка</h2>
          <StatusBadge status={submission.status} />
        </div>
        <a className="block break-all text-accent-2 underline-offset-4 hover:underline underline" href={submission.videoUrl} rel="noopener noreferrer" target="_blank">
          {submission.videoUrl}
        </a>
        <p className="text-sm text-[var(--muted-foreground)]">
          Опубликован: {dateMoscow(submission.publishedAt)} МСК · Неделя с {dateMoscow(submission.weekStart)} МСК
        </p>
        <p>Просмотры: {submission.views.toLocaleString("ru-RU")} · Сумма: {amount(submission.amountCents)}</p>
        {submission.rejectReason && <p className="whitespace-pre-wrap text-sm text-danger">Причина отклонения: {submission.rejectReason}</p>}
      </Card>
      <SubmissionChat
        initialEvents={makeSubmissionEvents(submission).map((event) => ({ ...event, createdAt: event.createdAt.toISOString() }))}
        initialMessages={initialMessages.map((message) => ({
          ...message,
          createdAt: message.createdAt.toISOString(),
          attachments: message.attachments.map((attachment) => ({ ...attachment, createdAt: attachment.createdAt.toISOString() })),
        }))}
        submissionId={submission.id}
        viewerId={user.id}
      />
    </main>
  );
}
