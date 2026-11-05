import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-guards";
import { advanceReadState, findAccessibleSubmission, makeSubmissionEvents } from "@/lib/submission-chat";
import { prisma } from "@/lib/prisma";

function response(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

function parseCursor(value: string | null) {
  if (!value) return null;
  const delimiter = value.lastIndexOf("|");
  if (delimiter <= 0) return undefined;
  const createdAt = new Date(value.slice(0, delimiter));
  const id = value.slice(delimiter + 1);
  if (!Number.isFinite(createdAt.getTime()) || !/^[a-z0-9]{8,32}$/i.test(id)) return undefined;
  return { createdAt, id };
}

export async function GET(
  request: Request,
  { params }: RouteContext<"/api/submissions/[id]/messages">,
) {
  const viewer = await requireUser();
  const { id } = await params;
  const submission = await findAccessibleSubmission(viewer, id);
  if (!submission) return response({ error: "Заявка не найдена." }, 404);

  const cursor = parseCursor(new URL(request.url).searchParams.get("after"));
  if (cursor === undefined) return response({ error: "Некорректный курсор." }, 400);

  const selected = cursor
    ? await prisma.message.findMany({
        where: {
          submissionId: id,
          OR: [
            { createdAt: { gt: cursor.createdAt } },
            { createdAt: cursor.createdAt, id: { gt: cursor.id } },
          ],
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { id: true, text: true, createdAt: true, authorId: true, author: { select: { login: true } } },
      })
    : (await prisma.message.findMany({
        where: { submissionId: id },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 50,
        select: { id: true, text: true, createdAt: true, authorId: true, author: { select: { login: true } } },
      })).reverse();

  if (selected.length > 0) {
    await advanceReadState(viewer.id, id, selected[selected.length - 1].createdAt);
  }

  return response({
    messages: selected.map((message) => ({ ...message, createdAt: message.createdAt.toISOString() })),
    events: makeSubmissionEvents(submission).map((event) => ({ ...event, createdAt: event.createdAt.toISOString() })),
  });
}
