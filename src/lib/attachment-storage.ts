import { randomUUID } from "node:crypto";
import { open, lstat, mkdir, readdir, unlink } from "node:fs/promises";
import path from "node:path";
import sharp, { type Metadata, type Sharp } from "sharp";
import { prisma } from "./prisma.ts";
import {
  ATTACHMENT_MAX_IMAGE_DIMENSION,
  ATTACHMENT_MAX_IMAGE_PIXELS,
  ATTACHMENT_MAX_INPUT_BYTES,
  ATTACHMENT_MAX_STORED_BYTES,
} from "./config.ts";

export type StoredImageMime = "image/jpeg" | "image/png" | "image/webp";
export type StoredImageFormat = "jpeg" | "png" | "webp";

export class AttachmentValidationError extends Error {
  readonly code: "unsupported_type" | "invalid_image" | "too_large" | "dimensions" | "animated";

  constructor(message: string, code: "unsupported_type" | "invalid_image" | "too_large" | "dimensions" | "animated") {
    super(message);
    this.code = code;
  }
}

export class AttachmentStorageError extends Error {
  constructor() {
    super("upload_storage_unavailable");
  }
}

export function getUploadsDirectory() {
  return path.resolve(/* turbopackIgnore: true */ process.cwd(), process.env.UPLOADS_DIR?.trim() || "./storage/uploads");
}

function mimeForFormat(format: StoredImageFormat): StoredImageMime {
  return format === "jpeg" ? "image/jpeg" : format === "png" ? "image/png" : "image/webp";
}

function extensionForFormat(format: StoredImageFormat) {
  return format === "jpeg" ? "jpg" : format;
}

function magicFormat(buffer: Buffer): StoredImageFormat | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "jpeg";
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") return "webp";
  return null;
}

export type PreparedImage = {
  data: Buffer;
  mime: StoredImageMime;
  format: StoredImageFormat;
  sizeBytes: number;
  width: number;
  height: number;
};

export async function prepareImage(input: Buffer): Promise<PreparedImage> {
  if (input.length === 0 || input.length > ATTACHMENT_MAX_INPUT_BYTES) {
    throw new AttachmentValidationError(`Входной файл должен быть не больше ${ATTACHMENT_MAX_INPUT_BYTES / 1024 / 1024} МБ.`, "too_large");
  }
  const detected = magicFormat(input);
  if (!detected) throw new AttachmentValidationError("Разрешены только JPEG, PNG и WebP.", "unsupported_type");

  let image: Sharp;
  let metadata: Metadata;
  try {
    image = sharp(input, { limitInputPixels: ATTACHMENT_MAX_IMAGE_PIXELS, failOn: "error", animated: true, sequentialRead: true });
    metadata = await image.metadata();
  } catch {
    throw new AttachmentValidationError("Не удалось прочитать изображение.", "invalid_image");
  }

  if (metadata.format !== detected) throw new AttachmentValidationError("Сигнатура файла не соответствует формату изображения.", "unsupported_type");
  if (metadata.pages !== undefined && metadata.pages > 1) {
    throw new AttachmentValidationError("Анимированные изображения не поддерживаются.", "animated");
  }
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (width > ATTACHMENT_MAX_IMAGE_DIMENSION || height > ATTACHMENT_MAX_IMAGE_DIMENSION) {
    throw new AttachmentValidationError("Слишком большое изображение, обрежьте его.", "dimensions");
  }
  if (width <= 0 || height <= 0 || width * height > ATTACHMENT_MAX_IMAGE_PIXELS) {
    throw new AttachmentValidationError(`Изображение превышает лимит ${ATTACHMENT_MAX_IMAGE_PIXELS.toLocaleString("ru-RU")} пикселей.`, "dimensions");
  }

  try {
    const result = await image
      .rotate()
      .toFormat(detected, detected === "jpeg" ? { quality: 85 } : detected === "webp" ? { quality: 85 } : {})
      .toBuffer({ resolveWithObject: true });
    const outputFormat = result.info.format as StoredImageFormat;
    if (outputFormat !== detected) throw new Error("output_format_mismatch");
    if (result.data.length > ATTACHMENT_MAX_STORED_BYTES) throw new Error("encoded_image_too_large");
    return {
      data: result.data,
      mime: mimeForFormat(outputFormat),
      format: outputFormat,
      sizeBytes: result.data.length,
      width: result.info.width,
      height: result.info.height,
    };
  } catch (error) {
    if (error instanceof Error && error.message === "encoded_image_too_large") {
      throw new AttachmentValidationError(`После обработки изображение превышает лимит ${ATTACHMENT_MAX_STORED_BYTES / 1024 / 1024} МБ.`, "too_large");
    }
    throw new AttachmentValidationError("Не удалось безопасно перекодировать изображение.", "invalid_image");
  }
}

function isInsideRoot(root: string, candidate: string) {
  const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  const comparableRoot = process.platform === "win32" ? prefix.toLowerCase() : prefix;
  const comparableCandidate = process.platform === "win32" ? candidate.toLowerCase() : candidate;
  return comparableCandidate.startsWith(comparableRoot);
}

async function makeDirectoryWithoutSymlinks(directory: string) {
  const parsed = path.parse(directory);
  let current = parsed.root;
  for (const segment of directory.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    try {
      await mkdir(current, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const stats = await lstat(current);
    if (stats.isSymbolicLink() || !stats.isDirectory()) throw new Error("uploads_directory_not_private");
  }
  if (process.platform !== "win32") await import("node:fs/promises").then(({ chmod }) => chmod(directory, 0o700));
}

export function resolveStoragePath(storageKey: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp)$/.test(storageKey)) {
    throw new Error("invalid_storage_key");
  }
  const root = getUploadsDirectory();
  const candidate = path.resolve(/* turbopackIgnore: true */ root, storageKey.slice(0, 2), storageKey);
  if (!isInsideRoot(root, candidate)) throw new Error("invalid_storage_path");
  return candidate;
}

export async function assertStoragePathHasNoSymlinks(storageKey: string) {
  const root = getUploadsDirectory();
  const filePath = resolveStoragePath(storageKey);
  const relative = path.relative(root, filePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("invalid_storage_path");
  const parsedRoot = path.parse(root);
  let current = parsedRoot.root;
  const directories = [
    ...root.slice(parsedRoot.root.length).split(path.sep).filter(Boolean),
    ...relative.split(path.sep).slice(0, -1),
  ];
  for (const segment of directories) {
    current = path.join(current, segment);
    const stats = await lstat(current);
    if (stats.isSymbolicLink() || !stats.isDirectory()) throw new Error("symlink_in_upload_path");
  }
  const fileStats = await lstat(filePath);
  if (fileStats.isSymbolicLink() || !fileStats.isFile()) throw new Error("invalid_upload_file");
  return filePath;
}

export async function writePreparedImage(image: PreparedImage) {
  const id = randomUUID();
  const storageKey = `${id}.${extensionForFormat(image.format)}`;
  const outputPath = resolveStoragePath(storageKey);
  const directory = path.dirname(outputPath);
  await makeDirectoryWithoutSymlinks(directory);
  const file = await open(outputPath, "wx", 0o600);
  try {
    await file.writeFile(image.data);
    if (process.platform !== "win32") await file.chmod(0o600);
  } catch (error) {
    await file.close().catch(() => undefined);
    await unlink(outputPath).catch(() => undefined);
    throw error;
  } finally {
    await file.close().catch(() => undefined);
  }
  return { storageKey, outputPath };
}

export async function removeStoredImage(storageKey: string) {
  const filePath = resolveStoragePath(storageKey);
  const parent = path.dirname(filePath);
  const parentStats = await lstat(parent).catch(() => null);
  if (!parentStats || parentStats.isSymbolicLink() || !parentStats.isDirectory()) return;
  const fileStats = await lstat(filePath).catch(() => null);
  if (!fileStats || fileStats.isSymbolicLink() || !fileStats.isFile()) return;
  await unlink(filePath);
}

export async function withStoredImages<T>(images: PreparedImage[], persist: (images: Array<{ storageKey: string; image: PreparedImage }>) => Promise<T>) {
  const stored: Array<{ storageKey: string; image: PreparedImage }> = [];
  try {
    for (const image of images) {
      let file: Awaited<ReturnType<typeof writePreparedImage>>;
      try {
        file = await writePreparedImage(image);
      } catch {
        throw new AttachmentStorageError();
      }
      stored.push({ storageKey: file.storageKey, image });
    }
    return await persist(stored);
  } catch (error) {
    await Promise.allSettled(stored.map(({ storageKey }) => removeStoredImage(storageKey)));
    throw error;
  }
}

const UUID_FILE = /^([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.(jpg|png|webp)$/;

export async function cleanOrphanedUploads(now = new Date()) {
  const root = getUploadsDirectory();
  const rootStats = await lstat(root).catch(() => null);
  if (!rootStats) return 0;
  if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) throw new Error("uploads_directory_not_private");
  const cutoff = now.getTime() - 24 * 60 * 60_000;
  const candidates: Array<{ key: string; path: string }> = [];
  for (const directory of await readdir(/* turbopackIgnore: true */ root, { withFileTypes: true })) {
    if (!directory.isDirectory() || directory.isSymbolicLink() || !/^[0-9a-f]{2}$/.test(directory.name)) continue;
    const directoryPath = path.resolve(/* turbopackIgnore: true */ root, directory.name);
    if (!isInsideRoot(root, directoryPath)) continue;
    for (const entry of await readdir(/* turbopackIgnore: true */ directoryPath, { withFileTypes: true })) {
      if (!entry.isFile() || entry.isSymbolicLink()) continue;
      const match = UUID_FILE.exec(entry.name);
      if (!match || match[1].slice(0, 2) !== directory.name) continue;
      const key = entry.name;
      const candidatePath = resolveStoragePath(key);
      const stats = await lstat(candidatePath).catch(() => null);
      if (stats?.isFile() && !stats.isSymbolicLink() && stats.mtimeMs < cutoff) candidates.push({ key, path: candidatePath });
    }
  }
  let removed = 0;
  for (let offset = 0; offset < candidates.length; offset += 500) {
    const batch = candidates.slice(offset, offset + 500);
    const referenced = new Set((await prisma.messageAttachment.findMany({
      where: { storageKey: { in: batch.map((candidate) => candidate.key) } },
      select: { storageKey: true },
    })).map((row) => row.storageKey));
    for (const candidate of batch) {
      if (!referenced.has(candidate.key)) {
        await unlink(candidate.path).catch(() => undefined);
        removed += 1;
      }
    }
  }
  return removed;
}
