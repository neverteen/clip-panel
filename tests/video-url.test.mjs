import assert from "node:assert/strict";
import test from "node:test";
import { normalizeVideoUrl } from "../src/lib/video-url.ts";

test("YouTube Shorts, watch, and short links share a case-preserving canonical URL", () => {
  const id = "AbC123xYz_9";
  assert.deepEqual(normalizeVideoUrl("YOUTUBE", `https://www.youtube.com/shorts/${id}?feature=share#x`), {
    videoUrl: `https://www.youtube.com/shorts/${id}`,
  });
  assert.deepEqual(normalizeVideoUrl("YOUTUBE", `https://youtube.com/watch?v=${id}&t=4`), {
    videoUrl: `https://www.youtube.com/shorts/${id}`,
  });
  assert.deepEqual(normalizeVideoUrl("YOUTUBE", `https://youtu.be/${id}?si=tracking`), {
    videoUrl: `https://www.youtube.com/shorts/${id}`,
  });
});

test("YouTube profile links and invalid IDs are rejected", () => {
  assert.equal("error" in normalizeVideoUrl("YOUTUBE", "https://youtube.com/@creator"), true);
  assert.equal("error" in normalizeVideoUrl("YOUTUBE", "https://youtube.com/shorts/abc"), true);
});

test("TikTok video IDs are canonicalized and only the username is lowercased", () => {
  assert.deepEqual(
    normalizeVideoUrl("TIKTOK", "https://www.tiktok.com/@Creator.Name/video/1234567890123456789?lang=en#top"),
    {
      videoUrl: "https://www.tiktok.com/video/1234567890123456789",
      tiktokUsername: "creator.name",
    },
  );
});

test("redirect TikTok links are rejected without being fetched", () => {
  const result = normalizeVideoUrl("TIKTOK", "https://vm.tiktok.com/ZMabc/");
  assert.equal("error" in result, true);
  if ("error" in result) assert.match(result.error, /полную ссылку/i);
});

test("Instagram reel and post URLs canonicalize by case-preserving shortcode", () => {
  const shortcode = "AbC_XyZ9";
  assert.deepEqual(normalizeVideoUrl("INSTAGRAM", `https://www.instagram.com/reel/${shortcode}/?igsh=x`), {
    videoUrl: `https://www.instagram.com/reel/${shortcode}`,
  });
  assert.deepEqual(normalizeVideoUrl("INSTAGRAM", `https://instagram.com/p/${shortcode}/#comment`), {
    videoUrl: `https://www.instagram.com/reel/${shortcode}`,
  });
});

test("Instagram profile URLs are rejected as video submissions", () => {
  assert.equal("error" in normalizeVideoUrl("INSTAGRAM", "https://instagram.com/creator"), true);
});
