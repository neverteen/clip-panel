export function passwordVersionMatches(expected: number | undefined, current: Date | null) {
  return (expected ?? 0) === (current?.getTime() ?? 0);
}

export function nextPasswordVersion(previous: Date | null, now = new Date()) {
  return new Date(Math.max(now.getTime(), (previous?.getTime() ?? 0) + 1));
}
