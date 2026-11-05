import {
  MIN_VIDEO_VIEWS,
  PRISMA_INT_MAX,
  RATE_CENTS_PER_1000,
} from "./config.ts";

export function calculateAmountCents(
  views: number,
  rateCentsPer1000 = RATE_CENTS_PER_1000,
  minimumViews = MIN_VIDEO_VIEWS,
): number | null {
  if (!Number.isInteger(views) || views < minimumViews) return null;
  if (views > 1_000_000_000) return null;

  const numerator = views * rateCentsPer1000;
  if (!Number.isSafeInteger(numerator)) {
    throw new RangeError("Расчёт суммы превышает безопасный предел целых чисел.");
  }
  const amount = Math.floor(numerator / 1000);
  if (amount > PRISMA_INT_MAX) {
    throw new RangeError("Сумма превышает предел хранения Int в базе данных.");
  }
  return amount;
}
