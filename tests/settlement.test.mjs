import assert from "node:assert/strict";
import test from "node:test";
import { settleWeek } from "../src/lib/settlement.ts";

const cases = [
  { week: 400, carry: 0, expected: { carryOutCents: 0, payableCents: 0, expiredCents: 0 } },
  { week: 1000, carry: 0, expected: { carryOutCents: 1000, payableCents: 0, expiredCents: 0 } },
  { week: 2999, carry: 0, expected: { carryOutCents: 2999, payableCents: 0, expiredCents: 0 } },
  { week: 3000, carry: 0, expected: { carryOutCents: 0, payableCents: 3000, expiredCents: 0 } },
  { week: 2000, carry: 1000, expected: { carryOutCents: 0, payableCents: 3000, expiredCents: 0 } },
  { week: 1000, carry: 1000, expected: { carryOutCents: 1000, payableCents: 0, expiredCents: 1000 } },
  { week: 500, carry: 2500, expected: { carryOutCents: 0, payableCents: 0, expiredCents: 2500 } },
  { week: 0, carry: 1000, expected: { carryOutCents: 0, payableCents: 0, expiredCents: 1000 } },
  { week: 1000, carry: 2500, expected: { carryOutCents: 0, payableCents: 3500, expiredCents: 0 } },
];

for (const { week, carry, expected } of cases) {
  test(`settlement for week ${week} cents and carry ${carry} cents`, () => {
    assert.deepEqual(settleWeek(week, carry), expected);
  });
}

test("settlement rejects negative and fractional inputs", () => {
  assert.throws(() => settleWeek(-1, 0), RangeError);
  assert.throws(() => settleWeek(0, -1), RangeError);
  assert.throws(() => settleWeek(1.5, 0), RangeError);
});
