export function getNow(now = new Date()): Date {
  if (process.env.NODE_ENV === "production") return now;

  const fakeNow = process.env.DEV_FAKE_NOW?.trim();
  if (!fakeNow || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(fakeNow)) return now;

  const parsed = new Date(fakeNow);
  return Number.isNaN(parsed.getTime()) ? now : parsed;
}
