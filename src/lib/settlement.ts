import {
  MIN_WEEK_VIEWS,
  PAYOUT_THRESHOLD_CENTS,
  RATE_CENTS_PER_1000,
} from "./config.ts";

export type WeekSettlement = {
  payableCents: number;
  carryOutCents: number;
  expiredCents: number;
};

const MIN_WEEK_CENTS = Math.floor(MIN_WEEK_VIEWS * RATE_CENTS_PER_1000 / 1000);

export function settleWeek(weekCents: number, carryInCents: number): WeekSettlement {
  if (!Number.isInteger(weekCents) || weekCents < 0) {
    throw new RangeError("Сумма недели должна быть неотрицательным целым числом центов.");
  }
  if (!Number.isInteger(carryInCents) || carryInCents < 0) {
    throw new RangeError("Копилка должна быть неотрицательным целым числом центов.");
  }

  // Неделя от минимального порога добирает копилку до порога выплаты.
  if (weekCents >= MIN_WEEK_CENTS && carryInCents + weekCents >= PAYOUT_THRESHOLD_CENTS) {
    return { payableCents: carryInCents + weekCents, carryOutCents: 0, expiredCents: 0 };
  }

  // При текущих значениях конфигурации эта ветка также покрывается первым условием.
  if (weekCents >= PAYOUT_THRESHOLD_CENTS) {
    return { payableCents: weekCents, carryOutCents: 0, expiredCents: carryInCents };
  }

  if (weekCents >= MIN_WEEK_CENTS) {
    return { payableCents: 0, carryOutCents: weekCents, expiredCents: carryInCents };
  }

  return { payableCents: 0, carryOutCents: 0, expiredCents: carryInCents };
}
