function readPositiveInteger(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;

  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} должен быть положительным целым числом.`);
  }
  return parsed;
}

export const RATE_CENTS_PER_1000 = readPositiveInteger("RATE_CENTS_PER_1000", 200);
export const MIN_VIDEO_VIEWS = readPositiveInteger("MIN_VIDEO_VIEWS", 2000);
export const MIN_WEEK_VIEWS = readPositiveInteger("MIN_WEEK_VIEWS", 5000);
export const PAYOUT_THRESHOLD_CENTS = readPositiveInteger("PAYOUT_THRESHOLD_CENTS", 3000);
export const MAX_SUBMISSIONS_PER_WEEK = readPositiveInteger("MAX_SUBMISSIONS_PER_WEEK", 100);
export const MAX_PAYOUT_REQUESTS_PER_24H = 3;

export const MAX_VIDEO_VIEWS = 1_000_000_000;
export const PRISMA_INT_MAX = 2_147_483_647;
