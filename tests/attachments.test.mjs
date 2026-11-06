import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import {
  AttachmentValidationError,
  prepareImage,
  withStoredImages,
} from "../src/lib/attachment-storage.ts";
import { parseMessageMultipart, MultipartRequestError, makeUploadFileError } from "../src/lib/message-multipart.ts";
import { shouldSubmitChatOnEnter } from "../src/lib/chat-input-rules.ts";
import { makeAttachmentHeaders, toPublicAttachment } from "../src/lib/attachment-http.ts";
import {
  ATTACHMENT_MAX_FILES_PER_MESSAGE,
  ATTACHMENT_MAX_IMAGE_DIMENSION,
  ATTACHMENT_MAX_INPUT_BYTES,
  ATTACHMENT_MAX_REQUEST_BYTES,
  ATTACHMENT_MAX_STORED_BYTES,
} from "../src/lib/config.ts";

async function image(format, options = {}) {
  let pipeline = sharp({ create: { width: 24, height: 18, channels: 3, background: "#6622aa" } });
  if (options.exif) pipeline = pipeline.withExif({ IFD0: { Artist: "test metadata" } });
  return pipeline.toFormat(format).toBuffer();
}

function addExifGps(jpeg) {
  const tiff = Buffer.alloc(56);
  tiff.write("II", 0, "ascii");
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4);
  tiff.writeUInt16LE(2, 8);
  tiff.writeUInt16LE(0x0112, 10);
  tiff.writeUInt16LE(3, 12);
  tiff.writeUInt32LE(1, 14);
  tiff.writeUInt16LE(1, 18);
  tiff.writeUInt16LE(0x8825, 22);
  tiff.writeUInt16LE(4, 24);
  tiff.writeUInt32LE(1, 26);
  tiff.writeUInt32LE(38, 30);
  tiff.writeUInt32LE(0, 34);
  tiff.writeUInt16LE(1, 38);
  tiff.writeUInt16LE(0, 40);
  tiff.writeUInt16LE(1, 42);
  tiff.writeUInt32LE(4, 44);
  tiff.set([2, 3, 0, 0], 48);
  tiff.writeUInt32LE(0, 52);
  const exif = Buffer.concat([Buffer.from("Exif\0\0", "binary"), tiff]);
  const segment = Buffer.alloc(4 + exif.length);
  segment.set([0xff, 0xe1], 0);
  segment.writeUInt16BE(exif.length + 2, 2);
  segment.set(exif, 4);
  return Buffer.concat([jpeg.subarray(0, 2), segment, jpeg.subarray(2)]);
}

function noisyRgb(width, height) {
  const data = Buffer.alloc(width * height * 3);
  let state = 123456789;
  for (let index = 0; index < data.length; index += 1) {
    state = (1664525 * state + 1013904223) >>> 0;
    data[index] = state >>> 24;
  }
  return data;
}

function riffChunk(tag, data) {
  const header = Buffer.alloc(8);
  header.write(tag, 0, "ascii");
  header.writeUInt32LE(data.length, 4);
  return Buffer.concat([header, data, data.length % 2 ? Buffer.from([0]) : Buffer.alloc(0)]);
}

function animatedWebpFrame(imageBytes, width, height) {
  const frameParts = [];
  for (let offset = 12; offset + 8 <= imageBytes.length;) {
    const tag = imageBytes.toString("ascii", offset, offset + 4);
    const length = imageBytes.readUInt32LE(offset + 4);
    const data = imageBytes.subarray(offset + 8, offset + 8 + length);
    if (tag === "VP8 " || tag === "VP8L") frameParts.push(riffChunk(tag, data));
    offset += 8 + length + (length % 2);
  }
  const header = Buffer.alloc(16);
  header.writeUIntLE(width - 1, 6, 3);
  header.writeUIntLE(height - 1, 9, 3);
  header.writeUIntLE(100, 12, 3);
  return riffChunk("ANMF", Buffer.concat([header, ...frameParts]));
}

async function animatedWebp() {
  const width = 24;
  const height = 18;
  const red = await image("webp");
  const blue = await sharp({ create: { width, height, channels: 3, background: "#2244aa" } }).webp().toBuffer();
  const animationHeader = Buffer.alloc(10);
  animationHeader[0] = 2;
  animationHeader.writeUIntLE(width - 1, 4, 3);
  animationHeader.writeUIntLE(height - 1, 7, 3);
  const animationControl = Buffer.alloc(6);
  const body = Buffer.concat([
    Buffer.from("WEBP"),
    riffChunk("VP8X", animationHeader),
    riffChunk("ANIM", animationControl),
    animatedWebpFrame(red, width, height),
    animatedWebpFrame(blue, width, height),
  ]);
  const riffHeader = Buffer.alloc(8);
  riffHeader.write("RIFF", 0, "ascii");
  riffHeader.writeUInt32LE(body.length, 4);
  return Buffer.concat([riffHeader, body]);
}

test("desktop Enter sends; modifiers, IME and touch input leave newline behavior", () => {
  const base = { key: "Enter", shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, isComposing: false, keyCode: 13, touchInput: false };
  assert.equal(shouldSubmitChatOnEnter(base), true);
  assert.equal(shouldSubmitChatOnEnter({ ...base, shiftKey: true }), false);
  assert.equal(shouldSubmitChatOnEnter({ ...base, ctrlKey: true }), false);
  assert.equal(shouldSubmitChatOnEnter({ ...base, isComposing: true }), false);
  assert.equal(shouldSubmitChatOnEnter({ ...base, keyCode: 229 }), false);
  assert.equal(shouldSubmitChatOnEnter({ ...base, touchInput: true }), false);
});

test("JPEG, PNG and WebP are decoded and re-encoded without EXIF metadata", async () => {
  for (const format of ["jpeg", "png", "webp"]) {
    const source = await image(format, { exif: format === "jpeg" });
    const prepared = await prepareImage(source);
    assert.equal(prepared.format, format);
    assert.equal(prepared.width, 24);
    const metadata = await sharp(prepared.data).metadata();
    assert.equal(metadata.exif, undefined);
  }
});

test("JPEG EXIF orientation and GPS metadata are stripped during re-encoding", async () => {
  const source = addExifGps(await image("jpeg"));
  const sourceMetadata = await sharp(source).metadata();
  assert.ok(sourceMetadata.exif);
  assert.ok(sourceMetadata.exif.includes(Buffer.from([0x25, 0x88])));
  const prepared = await prepareImage(source);
  assert.equal((await sharp(prepared.data).metadata()).exif, undefined);
});

test("animated WebP is rejected", async () => {
  const animated = await animatedWebp();
  assert.equal((await sharp(animated, { animated: true }).metadata()).pages, 2);
  await assert.rejects(prepareImage(animated), (error) => error instanceof AttachmentValidationError && error.code === "animated");
});

test("unsupported signatures, SVG, GIF, truncated and polyglot inputs are rejected or safely re-encoded", async () => {
  const exe = Buffer.from("MZ fake executable");
  await assert.rejects(prepareImage(exe), AttachmentValidationError);
  await assert.rejects(prepareImage(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>")), AttachmentValidationError);
  await assert.rejects(prepareImage(Buffer.from("GIF89a fake")), AttachmentValidationError);
  await assert.rejects(prepareImage(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from("broken")])), AttachmentValidationError);

  const jpeg = await image("jpeg");
  const polyglot = await prepareImage(Buffer.concat([jpeg, Buffer.from("<script>not retained</script>")]));
  assert.equal(polyglot.format, "jpeg");
  assert.equal(polyglot.data.includes(Buffer.from("not retained")), false);
  await assert.rejects(prepareImage(Buffer.alloc(ATTACHMENT_MAX_INPUT_BYTES + 1)), AttachmentValidationError);
});

test("stored PNG may exceed 5 MiB up to 8 MiB; larger output returns a named error", async () => {
  const mediumPng = await sharp(noisyRgb(1400, 1400), { raw: { width: 1400, height: 1400, channels: 3 } })
    .png({ compressionLevel: 9, adaptiveFiltering: false }).toBuffer();
  const stored = await prepareImage(mediumPng);
  assert.ok(stored.sizeBytes > ATTACHMENT_MAX_INPUT_BYTES / 2);
  assert.ok(stored.sizeBytes <= ATTACHMENT_MAX_STORED_BYTES);

  const largePng = await sharp(noisyRgb(1700, 1700), { raw: { width: 1700, height: 1700, channels: 3 } })
    .png({ compressionLevel: 9, adaptiveFiltering: false }).toBuffer();
  assert.ok(largePng.length <= ATTACHMENT_MAX_INPUT_BYTES);
  await assert.rejects(prepareImage(largePng), (error) => {
    assert.ok(error instanceof AttachmentValidationError);
    assert.match(error.message, /лимит 8 МБ/);
    const fileError = makeUploadFileError("long-noise.png", error.message);
    assert.equal(fileError.name, "long-noise.png");
    assert.match(fileError.error, /лимит 8 МБ/);
    return true;
  });
});

test("images over the dimension limit ask the user to crop them", async () => {
  const tooWide = await sharp({ create: { width: ATTACHMENT_MAX_IMAGE_DIMENSION + 1, height: 1, channels: 3, background: "#123456" } }).png().toBuffer();
  await assert.rejects(prepareImage(tooWide), (error) => {
    assert.ok(error instanceof AttachmentValidationError);
    assert.equal(error.message, "Слишком большое изображение, обрежьте его.");
    return true;
  });
});

test("request MIME and filename do not determine file format", async () => {
  const form = new FormData();
  form.append("text", "test");
  form.append("files", new Blob(["MZ executable"], { type: "image/png" }), "renamed.png");
  const request = new Request("http://localhost/api", { method: "POST", body: form });
  const multipart = await parseMessageMultipart(request);
  assert.equal(multipart.files[0].name, "renamed.png");
  await assert.rejects(prepareImage(multipart.files[0].bytes), AttachmentValidationError);
});

test("multipart rejects more than configured files and accepts image-only messages", async () => {
  const fourFiles = new FormData();
  for (let index = 0; index < ATTACHMENT_MAX_FILES_PER_MESSAGE + 1; index += 1) fourFiles.append("files", new Blob(["x"]), `image-${index}.png`);
  await assert.rejects(parseMessageMultipart(new Request("http://localhost/api", { method: "POST", body: fourFiles })), MultipartRequestError);

  const onlyImage = new FormData();
  onlyImage.append("files", new Blob(["x"]), "image.png");
  const result = await parseMessageMultipart(new Request("http://localhost/api", { method: "POST", body: onlyImage }));
  assert.equal(result.text, "");
  assert.equal(result.files.length, 1);
});

test("multipart rejects over-limit input before image processing and caps streamed requests", async () => {
  const tooLargeContentLength = {
    headers: new Headers({ "content-type": "multipart/form-data; boundary=test", "content-length": String(ATTACHMENT_MAX_REQUEST_BYTES + 1) }),
    body: null,
  };
  await assert.rejects(parseMessageMultipart(tooLargeContentLength),
    (error) => error instanceof MultipartRequestError && error.status === 413);

  const oversizedFile = new FormData();
  oversizedFile.append("files", new Blob([Buffer.alloc(ATTACHMENT_MAX_INPUT_BYTES + 1)]), "large-input.png");
  await assert.rejects(parseMessageMultipart(new Request("http://localhost/api", { method: "POST", body: oversizedFile })), (error) => {
    assert.ok(error instanceof MultipartRequestError);
    assert.equal(error.status, 413);
    assert.equal(error.fileErrors[0].name, "large-input.png");
    return true;
  });

  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(Buffer.from("--limit-test\r\nContent-Disposition: form-data; name=\"text\"\r\n\r\n"));
      controller.enqueue(Buffer.alloc(ATTACHMENT_MAX_REQUEST_BYTES + 1, 65));
      controller.close();
    },
  });
  await assert.rejects(parseMessageMultipart(new Request("http://localhost/api", {
    method: "POST",
    headers: { "content-type": "multipart/form-data; boundary=limit-test" },
    body,
    duplex: "half",
  })),
    (error) => error instanceof MultipartRequestError && error.status === 413);
});

test("files written before a failed message transaction are removed", async () => {
  const original = process.env.UPLOADS_DIR;
  const temporary = await mkdtemp(path.join(os.tmpdir(), "clip-uploads-"));
  process.env.UPLOADS_DIR = temporary;
  try {
    const prepared = await prepareImage(await image("png"));
    await assert.rejects(withStoredImages([prepared], async () => { throw new Error("simulated transaction rollback"); }));
    const folders = await readdir(temporary);
    assert.equal(folders.length, 1);
    assert.deepEqual(await readdir(path.join(temporary, folders[0])), []);
  } finally {
    if (original === undefined) delete process.env.UPLOADS_DIR;
    else process.env.UPLOADS_DIR = original;
    await rm(temporary, { recursive: true, force: true });
  }
});

test("attachment responses allow only image MIME types and set private security headers", () => {
  const headers = makeAttachmentHeaders("image/webp", 1234);
  assert.ok(headers);
  assert.equal(headers.get("Content-Type"), "image/webp");
  assert.equal(headers.get("Content-Length"), "1234");
  assert.equal(headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(headers.get("Content-Security-Policy"), "default-src 'none'; sandbox");
  assert.equal(headers.get("Cross-Origin-Resource-Policy"), "same-origin");
  assert.equal(headers.get("Content-Disposition"), "inline");
  assert.equal(headers.get("Cache-Control"), "private, no-store");
  assert.equal(makeAttachmentHeaders("text/html", 1234), null);
  const publicAttachment = toPublicAttachment({
    id: "attachment-id",
    storageKey: "secret-storage-key.png",
    mime: "image/png",
    sizeBytes: 1234,
    width: 4,
    height: 4,
    createdAt: "2026-11-06T00:00:00.000Z",
  });
  assert.equal("storageKey" in publicAttachment, false);
});
