import { calculateAmountCents } from "./payout.ts";
import { RATE_CENTS_PER_1000 } from "./config.ts";

export const LANDING_PAYOUT_MILESTONES = [
  2_000,
  10_000,
  50_000,
  250_000,
  500_000,
  1_000_000,
] as const;

export type LandingPayoutRow = { views: number; amountCents: number };

export function createLandingPayoutTable(
  rateCentsPer1000 = RATE_CENTS_PER_1000,
): LandingPayoutRow[] {
  return LANDING_PAYOUT_MILESTONES.map((views) => {
    const amountCents = calculateAmountCents(views, rateCentsPer1000, 0);
    if (amountCents === null) throw new RangeError("Не удалось рассчитать сумму для таблицы выплат.");
    return { views, amountCents };
  });
}
