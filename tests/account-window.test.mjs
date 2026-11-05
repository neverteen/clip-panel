import assert from "node:assert/strict";
import test from "node:test";
import { getAccountWindow, isAccountWindowOpen } from "../src/lib/account-window.ts";

const instant = (value) => new Date(value);

test("Monday 23:59 Moscow is outside the account window", () => {
  const now = instant("2026-11-02T20:59:00.000Z");
  assert.equal(isAccountWindowOpen(now), false);
  assert.equal(getAccountWindow(now).opensAt.toISOString(), "2026-11-02T21:00:00.000Z");
});

test("Tuesday 00:00 Moscow is the inclusive opening boundary", () => {
  assert.equal(isAccountWindowOpen(instant("2026-11-02T21:00:00.000Z")), true);
});

test("Tuesday 21:59:59 Moscow is inside the account window", () => {
  assert.equal(isAccountWindowOpen(instant("2026-11-03T18:59:59.000Z")), true);
});

test("Tuesday 22:00 Moscow is the exclusive closing boundary", () => {
  const now = instant("2026-11-03T19:00:00.000Z");
  assert.equal(isAccountWindowOpen(now), false);
  assert.equal(getAccountWindow(now).opensAt.toISOString(), "2026-11-09T21:00:00.000Z");
});

test("Wednesday 00:00 Moscow is outside the account window", () => {
  const now = instant("2026-11-03T21:00:00.000Z");
  assert.equal(isAccountWindowOpen(now), false);
  assert.equal(getAccountWindow(now).opensAt.toISOString(), "2026-11-09T21:00:00.000Z");
});
