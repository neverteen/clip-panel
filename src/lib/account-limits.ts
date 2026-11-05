import { MAX_ACCOUNTS_PER_PLATFORM } from "./config.ts";

export function isAccountPlatformLimitReached(used: number) {
  return used >= MAX_ACCOUNTS_PER_PLATFORM;
}
