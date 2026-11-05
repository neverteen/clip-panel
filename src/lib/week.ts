const MOSCOW_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
export const WEEK_MS = 7 * DAY_MS;
const WEEK_START_HOUR = 1;
const WEEK_END_DAY_FROM_MONDAY = 6;
const WEEK_END_HOUR = 22;

export const SUBMISSION_WINDOW_MS =
  WEEK_END_DAY_FROM_MONDAY * DAY_MS + (WEEK_END_HOUR - WEEK_START_HOUR) * 60 * 60 * 1000;

export type WeekWindow = {
  start: Date;
  end: Date;
  isOpen: boolean;
};

export function getWindow(now = new Date()): WeekWindow {
  const moscowNow = new Date(now.getTime() + MOSCOW_OFFSET_MS);
  const daysSinceMonday = (moscowNow.getUTCDay() + 6) % 7;
  const mondayMidnightMoscow = Date.UTC(
    moscowNow.getUTCFullYear(),
    moscowNow.getUTCMonth(),
    moscowNow.getUTCDate() - daysSinceMonday,
  );
  const startMs = mondayMidnightMoscow + WEEK_START_HOUR * 60 * 60 * 1000 - MOSCOW_OFFSET_MS;
  const endMs = mondayMidnightMoscow + WEEK_END_DAY_FROM_MONDAY * DAY_MS +
    WEEK_END_HOUR * 60 * 60 * 1000 - MOSCOW_OFFSET_MS;

  return {
    start: new Date(startMs),
    end: new Date(endMs),
    isOpen: now.getTime() >= startMs && now.getTime() < endMs,
  };
}

export function moscowDateTimeToUtc(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(value);
  if (!match) return null;

  const [, yearText, monthText, dayText, hourText, minuteText, secondText = "0", millisecondText = "0"] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const millisecond = Number(millisecondText.padEnd(3, "0"));

  const localDate = new Date(0);
  localDate.setUTCFullYear(year, month - 1, day);
  localDate.setUTCHours(hour, minute, second, millisecond);

  if (
    localDate.getUTCFullYear() !== year ||
    localDate.getUTCMonth() !== month - 1 ||
    localDate.getUTCDate() !== day ||
    hour > 23 || minute > 59 || second > 59
  ) {
    return null;
  }

  return new Date(localDate.getTime() - MOSCOW_OFFSET_MS);
}

export function utcToMoscowDateTimeValue(value: Date): string {
  return new Date(value.getTime() + MOSCOW_OFFSET_MS).toISOString().slice(0, 16);
}
