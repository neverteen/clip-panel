import assert from "node:assert/strict";
import test from "node:test";
import { calculateAmountCents } from "../src/lib/payout.ts";

test("linear per-video payout uses integer cents and the 2000 view minimum", () => {
  assert.equal(calculateAmountCents(1999, 200, 2000), null);
  assert.equal(calculateAmountCents(2000, 200, 2000), 400);
  assert.equal(calculateAmountCents(2999, 200, 2000), 599);
  assert.equal(calculateAmountCents(5000, 200, 2000), 1000);
});

test("invalid view counts do not produce a payout amount", () => {
  assert.equal(calculateAmountCents(-1, 200, 2000), null);
  assert.equal(calculateAmountCents(2000.5, 200, 2000), null);
  assert.equal(calculateAmountCents(1_000_000_001, 200, 2000), null);
});
