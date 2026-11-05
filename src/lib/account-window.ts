import { getNow } from "./now.ts";

const MOSCOW_OFFSET_MS = 3 * 60 * 60 * 1000;
const WINDOW_LENGTH_MS = 22 * 60 * 60 * 1000;
const WEEK_LENGTH_MS = 7 * 24 * 60 * 60 * 1000;
const TUESDAY = 2;

export type AccountWindow = {
  isOpen: boolean;
  opensAt: Date;
  closesAt: Date;
};

export function getAccountWindowNow(now = new Date()): Date {
  return getNow(now);
}

export function isAccountWindowOpen(now = new Date()): boolean {
  return getAccountWindow(now).isOpen;
}

export function getAccountWindow(now = new Date()): AccountWindow {
  const moscowNow = new Date(now.getTime() + MOSCOW_OFFSET_MS);
  const weekday = moscowNow.getUTCDay();
  const daysUntilTuesday = (TUESDAY - weekday + 7) % 7;
  const tuesdayMidnightMoscow = Date.UTC(
    moscowNow.getUTCFullYear(),
    moscowNow.getUTCMonth(),
    moscowNow.getUTCDate() + daysUntilTuesday,
  );
  const currentTuesdayStart = tuesdayMidnightMoscow - MOSCOW_OFFSET_MS;
  const currentTuesdayEnd = currentTuesdayStart + WINDOW_LENGTH_MS;
  const isOpen = now.getTime() >= currentTuesdayStart && now.getTime() < currentTuesdayEnd;

  if (isOpen) {
    return {
      isOpen: true,
      opensAt: new Date(currentTuesdayStart),
      closesAt: new Date(currentTuesdayEnd),
    };
  }

  const nextOpen = now.getTime() >= currentTuesdayEnd
    ? currentTuesdayStart + WEEK_LENGTH_MS
    : currentTuesdayStart;

  return {
    isOpen: false,
    opensAt: new Date(nextOpen),
    closesAt: new Date(nextOpen + WINDOW_LENGTH_MS),
  };
}
