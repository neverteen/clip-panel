import Busboy from "busboy";
import { once } from "node:events";
import { ATTACHMENT_MAX_FILES_PER_MESSAGE, ATTACHMENT_MAX_INPUT_BYTES, ATTACHMENT_MAX_REQUEST_BYTES } from "./config.ts";

const maxInputMegabytes = ATTACHMENT_MAX_INPUT_BYTES / 1024 / 1024;
const maxRequestMegabytes = ATTACHMENT_MAX_REQUEST_BYTES / 1024 / 1024;
const maxInputError = `Входной файл превышает ${maxInputMegabytes} МБ.`;
const maxRequestError = `Общий размер запроса не должен превышать ${maxRequestMegabytes} МБ.`;

export class MultipartRequestError extends Error {
  readonly status: number;
  readonly fileErrors?: Array<{ name: string; error: string }>;

  constructor(status: number, message: string, fileErrors?: Array<{ name: string; error: string }>) {
    super(message);
    this.status = status;
    this.fileErrors = fileErrors;
  }
}

export type MultipartImagePart = { name: string; bytes: Buffer };
export type ParsedMessageMultipart = { text: string; files: MultipartImagePart[] };

export function safeDisplayFilename(value: string, fallback: string) {
  const lastSegment = value.replace(/\\/g, "/").split("/").at(-1) ?? "";
  const clean = lastSegment.replace(/[\u0000-\u001f\u007f-\u009f]/g, "").trim().slice(0, 100);
  return clean || fallback;
}

export function makeUploadFileError(name: string, error: string) {
  return { name: safeDisplayFilename(name, "Изображение"), error };
}

export async function parseMessageMultipart(request: Request): Promise<ParsedMessageMultipart> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^multipart\/form-data\s*;/i.test(contentType)) {
    throw new MultipartRequestError(400, "Ожидается multipart/form-data.");
  }
  const lengthHeader = request.headers.get("content-length");
  if (lengthHeader !== null) {
    if (!/^\d+$/.test(lengthHeader)) throw new MultipartRequestError(400, "Некорректный размер запроса.");
    if (Number(lengthHeader) > ATTACHMENT_MAX_REQUEST_BYTES) {
      throw new MultipartRequestError(413, maxRequestError);
    }
  }
  if (!request.body) throw new MultipartRequestError(400, "Пустой запрос.");

  let text = "";
  let textReceived = false;
  const files: MultipartImagePart[] = [];
  let parseFailure: MultipartRequestError | null = null;
  let fileNumber = 0;
  const parser = Busboy({
    headers: { "content-type": contentType },
    preservePath: false,
    limits: { files: ATTACHMENT_MAX_FILES_PER_MESSAGE, fileSize: ATTACHMENT_MAX_INPUT_BYTES, fields: 1, fieldSize: 8000, parts: ATTACHMENT_MAX_FILES_PER_MESSAGE + 1, headerPairs: 64 },
  });
  parser.on("error", () => {
    parseFailure ??= new MultipartRequestError(400, "Не удалось разобрать загрузку.");
  });

  parser.on("field", (fieldName, value, info) => {
    if (fieldName !== "text" || textReceived) {
      parseFailure ??= new MultipartRequestError(400, "Некорректные поля сообщения.");
      return;
    }
    textReceived = true;
    if (info.nameTruncated || info.valueTruncated) {
      parseFailure ??= new MultipartRequestError(400, "Текст сообщения превышает допустимый размер.");
      return;
    }
    text = value;
  });

  parser.on("file", (fieldName, stream, info) => {
    fileNumber += 1;
    if (fieldName !== "files") {
      parseFailure ??= new MultipartRequestError(400, "Некорректное поле вложения.");
      stream.resume();
      return;
    }
    const name = safeDisplayFilename(info.filename ?? "", `Изображение ${fileNumber}`);
    const chunks: Buffer[] = [];
    let size = 0;
    let wasLimited = false;
    stream.on("data", (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size <= ATTACHMENT_MAX_INPUT_BYTES) chunks.push(buffer);
    });
    stream.once("limit", () => {
      wasLimited = true;
      parseFailure ??= new MultipartRequestError(413, maxInputError, [makeUploadFileError(name, `Файл больше ${maxInputMegabytes} МБ.`)]);
    });
    stream.once("end", () => {
      if (!wasLimited && size <= ATTACHMENT_MAX_INPUT_BYTES) files.push({ name, bytes: Buffer.concat(chunks, size) });
    });
  });

  parser.once("filesLimit", () => {
    parseFailure ??= new MultipartRequestError(400, `В одном сообщении можно прикрепить не более ${ATTACHMENT_MAX_FILES_PER_MESSAGE} изображений.`);
  });
  parser.once("fieldsLimit", () => {
    parseFailure ??= new MultipartRequestError(400, "Допускается только одно текстовое поле.");
  });
  parser.once("partsLimit", () => {
    parseFailure ??= new MultipartRequestError(400, "Слишком много частей в запросе.");
  });

  const reader = request.body.getReader();
  let requestBytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      requestBytes += value.byteLength;
      if (requestBytes > ATTACHMENT_MAX_REQUEST_BYTES) {
        throw new MultipartRequestError(413, maxRequestError);
      }
      if (!parser.write(Buffer.from(value))) await once(parser, "drain");
    }
    parser.end();
    await once(parser, "close");
  } catch (error) {
    parser.destroy();
    await reader.cancel(error).catch(() => undefined);
    if (error instanceof MultipartRequestError) throw error;
    throw parseFailure ?? new MultipartRequestError(400, "Не удалось разобрать загрузку.");
  } finally {
    reader.releaseLock();
  }
  if (parseFailure) throw parseFailure;
  if (fileNumber > ATTACHMENT_MAX_FILES_PER_MESSAGE) throw new MultipartRequestError(400, `В одном сообщении можно прикрепить не более ${ATTACHMENT_MAX_FILES_PER_MESSAGE} изображений.`);
  return { text: text.replace(/\r\n?/g, "\n").trim().replace(/\n{3,}/g, "\n\n"), files };
}
