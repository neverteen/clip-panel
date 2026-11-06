import { NextResponse } from "next/server";
import { getApiViewer } from "@/lib/auth-guards";
import { advanceReadState, findAccessibleSubmission, makeSubmissionEvents } from "@/lib/submission-chat";
import { prisma } from "@/lib/prisma";
import { AttachmentStorageError, AttachmentValidationError, prepareImage, withStoredImages, type PreparedImage } from "@/lib/attachment-storage";
import { ATTACHMENT_MAX_PER_USER_PER_DAY } from "@/lib/config";
import { makeUploadFileError, MultipartRequestError, parseMessageMultipart } from "@/lib/message-multipart";
import { createSubmissionMessage, preflightChatWrite, SubmissionMessageError } from "@/lib/submission-message";
import { canAccessSubmissionChat, getAttachmentRateLimitError } from "@/lib/chat-rules";
import { toPublicAttachment } from "@/lib/attachment-http";

let activeUploadCount = 0;
const MAX_ACTIVE_UPLOADS = 3;

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
  const apiViewer = await getApiViewer();
  if (apiViewer.kind === "unauthenticated") return response({ error: "Требуется вход." }, 401);
  if (apiViewer.kind === "not_found") return response({ error: "Заявка не найдена." }, 404);
  const viewer = apiViewer.user;
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
        select: {
          id: true, text: true, createdAt: true, authorId: true, author: { select: { login: true } },
          attachments: { select: { id: true, mime: true, sizeBytes: true, width: true, height: true, createdAt: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
        },
      })
    : (await prisma.message.findMany({
        where: { submissionId: id },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 50,
        select: {
          id: true, text: true, createdAt: true, authorId: true, author: { select: { login: true } },
          attachments: { select: { id: true, mime: true, sizeBytes: true, width: true, height: true, createdAt: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
        },
      })).reverse();

  if (selected.length > 0) {
    await advanceReadState(viewer.id, id, selected[selected.length - 1].createdAt);
  }

  return response({
    messages: selected.map((message) => ({
      ...message,
      createdAt: message.createdAt.toISOString(),
      attachments: message.attachments.map((attachment) => ({ ...toPublicAttachment(attachment), createdAt: attachment.createdAt.toISOString() })),
    })),
    events: makeSubmissionEvents(submission).map((event) => ({ ...event, createdAt: event.createdAt.toISOString() })),
  });
}

export async function POST(
  request: Request,
  { params }: RouteContext<"/api/submissions/[id]/messages">,
) {
  const apiViewer = await getApiViewer();
  if (apiViewer.kind === "unauthenticated") return response({ error: "Требуется вход." }, 401);
  if (apiViewer.kind === "not_found") return response({ error: "Заявка не найдена." }, 404);
  const viewer = apiViewer.user;
  const { id } = await params;
  const submission = await findAccessibleSubmission(viewer, id);
  if (!submission || !canAccessSubmissionChat(viewer.role, viewer.id, submission.userId, viewer.isActive)) {
    return response({ error: "Заявка не найдена." }, 404);
  }

  if (activeUploadCount >= MAX_ACTIVE_UPLOADS) return response({ error: "Сейчас обрабатываются другие загрузки. Повторите через несколько секунд." }, 429);
  activeUploadCount += 1;
  try {
    const preflightCounts = await preflightChatWrite(viewer.id);
    try {
      const multipart = await parseMessageMultipart(request);
      const attachmentRateError = getAttachmentRateLimitError(preflightCounts.attachmentCount, multipart.files.length, ATTACHMENT_MAX_PER_USER_PER_DAY);
      if (attachmentRateError) throw new SubmissionMessageError(429, attachmentRateError);
      if (!multipart.text && multipart.files.length === 0) throw new SubmissionMessageError(400, "Добавьте текст или изображение.");
      if (multipart.text.length > 2000) throw new SubmissionMessageError(400, "Текст сообщения должен быть не длиннее 2000 символов.");

      const preparedImages: PreparedImage[] = [];
      for (const file of multipart.files) {
        try {
          preparedImages.push(await prepareImage(file.bytes));
        } catch (error) {
          const reason = error instanceof AttachmentValidationError ? error.message : "Не удалось обработать изображение.";
          throw new MultipartRequestError(400, "Некоторые файлы не удалось прикрепить.", [makeUploadFileError(file.name, reason)]);
        }
      }

      let message;
      try {
        message = await withStoredImages(preparedImages, (stored) => createSubmissionMessage({
          viewer,
          submissionId: id,
          text: multipart.text,
          storedImages: stored.map(({ storageKey, image }) => ({ storageKey, image })),
        }));
      } catch (error) {
        if (error instanceof SubmissionMessageError) throw error;
        if (error instanceof AttachmentStorageError) throw new SubmissionMessageError(503, "Хранилище изображений временно недоступно. Сообщение не отправлено.");
        throw error;
      }
      return response({
        message: {
          ...message,
          createdAt: message.createdAt.toISOString(),
          attachments: message.attachments.map((attachment) => ({ ...toPublicAttachment(attachment), createdAt: attachment.createdAt.toISOString() })),
        },
      }, 201);
    } catch (error) {
      if (error instanceof MultipartRequestError) {
        return response({ error: error.message, fileErrors: error.fileErrors }, error.status);
      }
      if (error instanceof SubmissionMessageError) return response({ error: error.message }, error.status);
      console.error("Chat message upload failed", { submissionId: id });
      return response({ error: "Не удалось сохранить сообщение. Попробуйте позже." }, 500);
    }
  } catch (error) {
    if (error instanceof SubmissionMessageError) return response({ error: error.message }, error.status);
    console.error("Chat message preflight failed", { submissionId: id });
    return response({ error: "Не удалось проверить возможность отправки. Попробуйте позже." }, 500);
  } finally {
    activeUploadCount -= 1;
  }
}
