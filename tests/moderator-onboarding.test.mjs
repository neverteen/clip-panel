import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { detectAndNormalizeProfileUrl } from "../src/lib/account-url.ts";
import { parseModeratorChannels } from "../src/lib/moderator-channels.ts";
import { nextPasswordVersion, passwordVersionMatches } from "../src/lib/password-version.ts";
import { landingContent } from "../src/content/landing.ts";

test("moderator channel input canonicalizes platform URLs and detects their platform", () => {
  assert.deepEqual(detectAndNormalizeProfileUrl("https://www.tiktok.com/@Clipper?lang=en"), {
    platform: "TIKTOK",
    url: "https://tiktok.com/@clipper",
  });
  assert.deepEqual(detectAndNormalizeProfileUrl("youtube.com/channel/UCAbC123?feature=share"), {
    platform: "YOUTUBE",
    url: "https://youtube.com/channel/UCAbC123",
  });
  assert.deepEqual(detectAndNormalizeProfileUrl("instagram.com/Clipper/"), {
    platform: "INSTAGRAM",
    url: "https://instagram.com/clipper",
  });
});

test("moderator channel batches reject invalid links, canonical duplicates, and platform overflow before writes", () => {
  const invalid = parseModeratorChannels("tiktok.com/@valid\nyoutube.com/watch?v=video");
  assert.equal(invalid.channels.length, 0);
  assert.equal(invalid.errors.length, 1);

  const duplicates = parseModeratorChannels("www.tiktok.com/@same?x=1\ntiktok.com/@same");
  assert.equal(duplicates.channels.length, 0);
  assert.match(duplicates.errors[0].reason, /повторяется/i);

  const tooMany = parseModeratorChannels(Array.from({ length: 6 }, (_, i) => `tiktok.com/@user${i}`).join("\n"));
  assert.equal(tooMany.channels.length, 0);
  assert.ok(tooMany.errors.some((error) => error.line === 6));

  const overTotal = parseModeratorChannels(Array.from({ length: 16 }, (_, i) => `instagram.com/user${i}`).join("\n"));
  assert.equal(overTotal.channels.length, 0);
  assert.ok(overTotal.errors.some((error) => /15/.test(error.reason)));
});

test("password version invalidates old JWTs and preserves unchanged users", () => {
  const current = new Date("2026-11-06T12:00:00.123Z");
  assert.equal(passwordVersionMatches(current.getTime(), current), true);
  assert.equal(passwordVersionMatches(current.getTime() - 1, current), false);
  assert.equal(passwordVersionMatches(0, null), true);
  assert.equal(passwordVersionMatches(undefined, null), true);
  assert.equal(nextPasswordVersion(current, new Date(current.getTime())).getTime(), current.getTime() + 1);
});

test("moderator-only onboarding actions enforce database role guards server-side", async () => {
  const source = await readFile(new URL("../src/app/moderator/users/actions.ts", import.meta.url), "utf8");
  for (const name of ["createClipperWithChannelsAction", "addChannelsToClipperAction"]) {
    const start = source.indexOf(`export async function ${name}`);
    const next = source.indexOf("export async function ", start + 1);
    const body = source.slice(start, next < 0 ? undefined : next);
    assert.ok(body.includes("requireModerator()"), `${name} must verify moderator role on the server`);
  }
  const clipperAction = await readFile(new URL("../src/app/accounts/actions.ts", import.meta.url), "utf8");
  const addStart = clipperAction.indexOf("export async function addPlatformAccountAction");
  const addEnd = clipperAction.indexOf("export async function decidePlatformAccountAction", addStart);
  const addBody = clipperAction.slice(addStart, addEnd);
  assert.ok(addBody.includes("requireClipper()"));
  assert.ok(addBody.includes("isAccountWindowOpen"));
  assert.ok(!addBody.includes("addedById: moderator.id"));
});

test("landing no longer instructs account approval in a personal conversation", async () => {
  const content = await readFile(new URL("../src/content/landing.ts", import.meta.url), "utf8");
  assert.ok(!/Старые аккаунты|Утверждаю новые/i.test(content));
  assert.ok(!/личн.{0,15}(бесед|переписк)/i.test(content));
  const onboarding = landingContent.start.steps.join(" ");
  assert.match(onboarding, /@tapenarezki/);
  assert.match(onboarding, /ссылки на свои каналы/i);
});
