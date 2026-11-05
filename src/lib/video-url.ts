export type VideoPlatform = "YOUTUBE" | "TIKTOK" | "INSTAGRAM";

export type NormalizedVideoUrl = {
  videoUrl: string;
  tiktokUsername?: string;
};

export type VideoUrlResult = NormalizedVideoUrl | { error: string };

const SHORT_TIKTOK_HOSTS = new Set(["vm.tiktok.com", "vt.tiktok.com"]);

function invalidVideo(platform: VideoPlatform): VideoUrlResult {
  switch (platform) {
    case "YOUTUBE":
      return { error: "Укажите ссылку на видео YouTube: /shorts/ID, /watch?v=ID или youtu.be/ID." };
    case "TIKTOK":
      return { error: "Укажите полную ссылку TikTok вида tiktok.com/@user/video/ID. Короткие ссылки не принимаются." };
    case "INSTAGRAM":
      return { error: "Укажите ссылку Instagram вида /reel/CODE или /p/CODE." };
  }
}

export function normalizeVideoUrl(platform: VideoPlatform, raw: string): VideoUrlResult {
  let url: URL;
  try {
    const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(raw.trim())
      ? raw.trim()
      : `https://${raw.trim()}`;
    url = new URL(candidate);
  } catch {
    return { error: "Введите корректную ссылку на видео." };
  }

  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    url.username ||
    url.password ||
    (url.port !== "" && url.port !== "80" && url.port !== "443")
  ) {
    return { error: "Ссылка должна вести на видео выбранной платформы." };
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, "");

  if (platform === "YOUTUBE") {
    let videoId: string | undefined;
    if (host === "youtube.com") {
      if (url.pathname === "/watch") videoId = url.searchParams.get("v") ?? undefined;
      else {
        const match = /^\/(?:shorts)\/([A-Za-z0-9_-]+)\/?$/.exec(url.pathname);
        videoId = match?.[1];
      }
    } else if (host === "youtu.be") {
      videoId = /^\/([A-Za-z0-9_-]+)\/?$/.exec(url.pathname)?.[1];
    } else {
      return { error: "Для аккаунта YouTube нужна ссылка с youtube.com или youtu.be." };
    }

    if (!videoId || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) return invalidVideo(platform);
    return { videoUrl: `https://www.youtube.com/shorts/${videoId}` };
  }

  if (platform === "TIKTOK") {
    if (SHORT_TIKTOK_HOSTS.has(host) || (host !== "tiktok.com")) {
      return invalidVideo(platform);
    }
    const match = /^\/@([A-Za-z0-9._]+)\/video\/([0-9]+)\/?$/.exec(url.pathname);
    if (!match || match[2].length < 5 || match[2].length > 30) return invalidVideo(platform);
    return {
      videoUrl: `https://www.tiktok.com/video/${match[2]}`,
      tiktokUsername: match[1].toLowerCase(),
    };
  }

  if (host !== "instagram.com") {
    return { error: "Для аккаунта Instagram нужна ссылка с instagram.com." };
  }
  const instagramMatch = /^\/(?:reel|p)\/([A-Za-z0-9_-]+)\/?$/.exec(url.pathname);
  if (!instagramMatch) return invalidVideo(platform);
  return { videoUrl: `https://www.instagram.com/reel/${instagramMatch[1]}` };
}
