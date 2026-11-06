import { Platform } from "@prisma/client";
import { detectAndNormalizeProfileUrl } from "./account-url.ts";
import { MAX_ACCOUNTS_PER_PLATFORM } from "./config.ts";

export type ParsedChannelLine = { line: number; platform: Platform; url: string };
export type ChannelLineError = { line: number; reason: string };

export function parseModeratorChannels(raw: string): { channels: ParsedChannelLine[]; errors: ChannelLineError[] } {
  const channels: ParsedChannelLine[] = [];
  const errors: ChannelLineError[] = [];
  const lines = raw.split(/\r?\n/);
  const nonEmpty = lines.map((value, index) => ({ line: index + 1, value: value.trim() })).filter((row) => row.value);
  if (nonEmpty.length > 15) errors.push({ line: 0, reason: "Можно указать не более 15 ссылок." });

  const seen = new Set<string>();
  const platformCounts = new Map<Platform, number>();
  for (const row of nonEmpty) {
    const normalized = detectAndNormalizeProfileUrl(row.value);
    if ("error" in normalized) {
      errors.push({ line: row.line, reason: normalized.error });
      continue;
    }
    const key = `${normalized.platform}:${normalized.url}`;
    if (seen.has(key)) {
      errors.push({ line: row.line, reason: "Эта ссылка повторяется в списке." });
      continue;
    }
    seen.add(key);
    const count = (platformCounts.get(normalized.platform) ?? 0) + 1;
    platformCounts.set(normalized.platform, count);
    if (count > MAX_ACCOUNTS_PER_PLATFORM) {
      errors.push({ line: row.line, reason: `Не более ${MAX_ACCOUNTS_PER_PLATFORM} аккаунтов на одну платформу.` });
      continue;
    }
    channels.push({ line: row.line, platform: normalized.platform, url: normalized.url });
  }
  if (nonEmpty.length > 15) return { channels: [], errors };
  return { channels: errors.length ? [] : channels, errors };
}
