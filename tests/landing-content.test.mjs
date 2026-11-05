import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createLandingPayoutTable } from "../src/lib/landing-payout-table.ts";
import { landingContent } from "../src/content/landing.ts";

test("landing payout table matches the channel milestones at the configured base rate", () => {
  const rows = createLandingPayoutTable(200);
  assert.deepEqual(rows.map((row) => row.views), [2_000, 10_000, 50_000, 250_000, 500_000, 1_000_000]);
  assert.deepEqual(rows.map((row) => row.amountCents / 100), [4, 20, 100, 500, 1_000, 2_000]);
});

test("landing payout table follows a changed rate instead of fixed dollar values", () => {
  assert.deepEqual(createLandingPayoutTable(300).map((row) => row.amountCents / 100), [6, 30, 150, 750, 1_500, 3_000]);
});

test("landing navigation anchors are unique and emitted by the page", async () => {
  const ids = Object.values(landingContent.anchors);
  assert.equal(new Set(ids).size, ids.length);
  const component = await readFile(new URL("../src/components/landing-page.tsx", import.meta.url), "utf8");
  for (const key of Object.keys(landingContent.anchors)) {
    assert.ok(component.includes(`id={anchors.${key}}`), `missing rendered anchor: ${key}`);
  }
  const content = await readFile(new URL("../src/content/landing.ts", import.meta.url), "utf8");
  assert.ok(!content.includes("Уточняется"));
  assert.ok(!content.toLowerCase().includes("vpn"));
});
