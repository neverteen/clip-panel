const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

export function toPublicAttachment(attachment: {
  id: string;
  mime: string;
  sizeBytes: number;
  width: number;
  height: number;
  createdAt: Date | string;
}) {
  return {
    id: attachment.id,
    mime: attachment.mime,
    sizeBytes: attachment.sizeBytes,
    width: attachment.width,
    height: attachment.height,
    createdAt: attachment.createdAt,
  };
}

export function makeAttachmentHeaders(mime: string, sizeBytes: number): Headers | null {
  if (!ALLOWED_MIME.has(mime) || !Number.isSafeInteger(sizeBytes) || sizeBytes < 0) return null;
  return new Headers({
    "Content-Type": mime,
    "Content-Length": String(sizeBytes),
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Content-Disposition": "inline",
    "Cache-Control": "private, no-store",
  });
}
