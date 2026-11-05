import assert from "node:assert/strict";
import test from "node:test";
import { getWindow, moscowDateTimeToUtc } from "../src/lib/week.ts";

const instant = (value) => new Date(value);

test("Monday 00:59 Moscow is before the submission window", () => {
  const window = getWindow(instant("2026-11-01T21:59:00.000Z"));
  assert.equal(window.isOpen, false);
  assert.equal(window.start.toISOString(), "2026-11-01T22:00:00.000Z");
});

test("Monday 01:00 Moscow is the inclusive opening boundary", () => {
  const window = getWindow(instant("2026-11-01T22:00:00.000Z"));
  assert.equal(window.isOpen, true);
  assert.equal(window.start.toISOString(), "2026-11-01T22:00:00.000Z");
});

test("Sunday 21:59:59 Moscow is inside the submission window", () => {
  assert.equal(getWindow(instant("2026-11-08T18:59:59.000Z")).isOpen, true);
});

test("Sunday 22:00 Moscow is the exclusive closing boundary", () => {
  const window = getWindow(instant("2026-11-08T19:00:00.000Z"));
  assert.equal(window.isOpen, false);
  assert.equal(window.end.toISOString(), "2026-11-08T19:00:00.000Z");
});

test("date-time input is interpreted as Moscow time and stored as UTC", () => {
  assert.equal(
    moscowDateTimeToUtc("2026-11-02T01:00")?.toISOString(),
    "2026-11-01T22:00:00.000Z",
  );
  assert.equal(moscowDateTimeToUtc("2026-02-30T12:00"), null);
});
