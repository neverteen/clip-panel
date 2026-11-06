import { Platform } from "@prisma/client";

export type NormalizedProfileUrl = { url: string } | { error: string };
export type DetectedProfileUrl =
  | { platform: Platform; url: string }
  | { error: string };

const HOSTS: Record<Platform, string> = {
  TIKTOK: "tiktok.com",
  YOUTUBE: "youtube.com",
  INSTAGRAM: "instagram.com",
};

export function normalizeProfileUrl(platform: Platform, input: string): NormalizedProfileUrl {
  let url: URL;
  try {
    const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(input.trim())
      ? input.trim()
      : `https://${input.trim()}`;
    url = new URL(candidate);
  } catch {
    return { error: "Введите корректную ссылку на профиль или канал." };
  }

  if (
    (url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password ||
    (url.port !== "" && url.port !== "80" && url.port !== "443")
  ) return { error: "Укажите публичную ссылку на профиль или канал." };

  const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  const expectedHost = HOSTS[platform];
  if (hostname !== expectedHost) {
    if (platform === Platform.YOUTUBE && hostname === "youtu.be") {
      return { error: "Короткие ссылки на видео не подходят. Укажите ссылку на канал YouTube." };
    }
    if (platform === Platform.TIKTOK && hostname.endsWith(".tiktok.com")) {
      return { error: "Сокращённые ссылки TikTok не подходят. Укажите tiktok.com/@имя." };
    }
    return { error: `Для ${platform} укажите ссылку с домена ${expectedHost}.` };
  }

  const path = url.pathname.replace(/\/+$/, "") || "/";
  if (platform === Platform.TIKTOK) {
    if (!/^\/@[a-z\d._]+$/i.test(path)) {
      return { error: "Нужна ссылка на профиль TikTok вида tiktok.com/@имя, не на видео." };
    }
    url.pathname = path.toLowerCase();
  } else if (platform === Platform.YOUTUBE) {
    if (/^\/(watch|shorts|embed|live|playlist|v)(\/|$)/i.test(path)) {
      return { error: "Нужна ссылка на канал YouTube, не на видео." };
    }
    if (!/^\/@[a-z\d._-]+$/i.test(path) && !/^\/channel\/[a-z\d_-]+$/i.test(path)) {
      return { error: "Укажите канал YouTube в формате youtube.com/@имя или /channel/ID." };
    }
    url.pathname = path.startsWith("/@") ? path.toLowerCase() : path;
  } else {
    const username = path.slice(1);
    const reserved = new Set(["about", "accounts", "direct", "explore", "p", "reel", "reels", "stories"]);
    if (!/^\/[a-z\d._]+$/i.test(path) || reserved.has(username.toLowerCase())) {
      return { error: "Нужна ссылка на профиль Instagram, не на публикацию или reel." };
    }
    url.pathname = path.toLowerCase();
  }

  url.protocol = "https:";
  url.hostname = hostname;
  url.port = "";
  url.search = "";
  url.hash = "";
  return { url: url.toString().replace(/\/$/, "") };
}

export function detectAndNormalizeProfileUrl(input: string): DetectedProfileUrl {
  let url: URL;
  try {
    const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`;
    url = new URL(candidate);
  } catch {
    return { error: "Введите корректную ссылку на профиль или канал." };
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const platform = host === "tiktok.com" || host.endsWith(".tiktok.com")
    ? Platform.TIKTOK
    : host === "youtube.com" || host === "youtu.be"
      ? Platform.YOUTUBE
      : host === "instagram.com"
        ? Platform.INSTAGRAM
        : null;
  if (!platform) return { error: "Ссылка должна вести на профиль TikTok, YouTube или Instagram." };
  const normalized = normalizeProfileUrl(platform, input);
  return "error" in normalized ? normalized : { platform, url: normalized.url };
}
