import assert from "node:assert/strict";
import test from "node:test";
import { getNow } from "../src/lib/now.ts";

test("DEV_FAKE_NOW overrides current time only outside production", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalFakeNow = process.env.DEV_FAKE_NOW;
  try {
    process.env.DEV_FAKE_NOW = "2026-11-03T18:30:00Z";
    process.env.NODE_ENV = "development";
    assert.equal(getNow(new Date("2026-11-03T00:00:00Z")).toISOString(), "2026-11-03T18:30:00.000Z");

    process.env.NODE_ENV = "production";
    assert.equal(getNow(new Date("2026-11-03T00:00:00Z")).toISOString(), "2026-11-03T00:00:00.000Z");
  } finally {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalFakeNow === undefined) delete process.env.DEV_FAKE_NOW;
    else process.env.DEV_FAKE_NOW = originalFakeNow;
  }
});
