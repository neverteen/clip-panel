import { createReadStream } from "node:fs";
import { lstat } from "node:fs/promises";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getApiViewer } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { findAccessibleSubmission } from "@/lib/submission-chat";
import { assertStoragePathHasNoSymlinks } from "@/lib/attachment-storage";
import { makeAttachmentHeaders } from "@/lib/attachment-http";

const attachmentIdSchema = z.string().cuid();
function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store, max-age=0" } });
}

export async function GET(_request: Request, { params }: RouteContext<"/api/attachments/[id]">) {
  const apiViewer = await getApiViewer();
  if (apiViewer.kind === "unauthenticated") return jsonError("Требуется вход.", 401);
  if (apiViewer.kind === "not_found") return jsonError("Вложение не найдено.", 404);
  const { id } = await params;
  if (!attachmentIdSchema.safeParse(id).success) return jsonError("Вложение не найдено.", 404);

  const attachment = await prisma.messageAttachment.findUnique({
    where: { id },
    select: {
      storageKey: true,
      mime: true,
      sizeBytes: true,
      message: { select: { submissionId: true } },
    },
  });
  if (!attachment) return jsonError("Вложение не найдено.", 404);
  const attachmentHeaders = makeAttachmentHeaders(attachment.mime, attachment.sizeBytes);
  if (!attachmentHeaders) return jsonError("Вложение не найдено.", 404);
  const submission = await findAccessibleSubmission(apiViewer.user, attachment.message.submissionId);
  if (!submission) return jsonError("Вложение не найдено.", 404);

  let filePath: string;
  try {
    filePath = await assertStoragePathHasNoSymlinks(attachment.storageKey);
    const stats = await lstat(filePath);
    if (stats.isSymbolicLink() || !stats.isFile()) return jsonError("Вложение не найдено.", 404);
    const file = createReadStream(filePath);
    file.once("error", () => console.warn("Attachment stream failed", { attachmentId: id }));
    attachmentHeaders.set("Content-Length", String(stats.size));
    return new Response(Readable.toWeb(file) as ReadableStream, { status: 200, headers: attachmentHeaders });
  } catch {
    console.warn("Attachment file missing", { attachmentId: id });
    return jsonError("Вложение не найдено.", 404);
  }
}
