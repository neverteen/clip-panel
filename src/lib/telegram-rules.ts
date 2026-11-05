import { createHash, randomBytes } from "node:crypto";

export function createTelegramLinkSecret() {
  return randomBytes(24).toString("base64url");
}

export function hashTelegramLinkSecret(secret: string) {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

export function sanitizeTelegramFragment(value: string) {
  return value.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
}

export function truncateTelegramText(value: string) {
  return value.slice(0, 500);
}

export function makeTelegramDeepLink(username: string, secret: string) {
  const normalizedUsername = username.trim().replace(/^@/, "");
  if (!/^[A-Za-z0-9_]{5,32}$/.test(normalizedUsername)) return null;
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(secret)) return null;
  return `https://t.me/${normalizedUsername}?start=${secret}`;
}

export function parseAppBaseUrl(value: string | undefined, isProduction: boolean) {
  const candidate = value?.trim() || (isProduction ? "" : "http://localhost:3000");
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    const localHttp = !isProduction && url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
    if ((url.protocol !== "https:" && !localHttp) || url.username || url.password || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function formatCents(cents: number) {
  const sign = cents < 0 ? "-" : "";
  const absolute = Math.abs(cents);
  return `${sign}$${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, "0")}`;
}

export function retryDelayMs(attempt: number, retryAfterSeconds?: number) {
  if (retryAfterSeconds !== undefined) return Math.max(0, retryAfterSeconds * 1000);
  return Math.min(60 * 60 * 1000, 2 ** Math.max(0, attempt - 1) * 1000);
}

export function shouldNotifyUnread(lastReadAt: Date | null, createdAt: Date) {
  return lastReadAt === null || lastReadAt.getTime() < createdAt.getTime();
}

export function chatNotificationDedupeKey(submissionId: string, userId: string, now: Date) {
  const fiveMinuteWindow = Math.floor(now.getTime() / (5 * 60 * 1000));
  return `chat:${submissionId}:${userId}:${fiveMinuteWindow}`;
}

export function getNotificationUrl(baseUrl: string, path: string) {
  const safePath = path.startsWith("/") ? path : `/${path}`;
  return new URL(safePath, `${baseUrl}/`).toString();
}
