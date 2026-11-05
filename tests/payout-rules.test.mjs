import assert from "node:assert/strict";
import test from "node:test";
import {
  balanceAfterRefund,
  balanceAfterReservation,
  canEditPayoutDetails,
  canProcessPayout,
  validatePayoutRequest,
} from "../src/lib/payout-rules.ts";

const defaults = {
  balanceCents: 3000,
  hasOpenRequest: false,
  requestsInLast24Hours: 0,
  thresholdCents: 3000,
  maxRequestsPer24Hours: 3,
};

test("payout threshold rejects 2999 cents and accepts 3000", () => {
  assert.equal(validatePayoutRequest({ ...defaults, balanceCents: 2999 }), "below_threshold");
  assert.equal(validatePayoutRequest(defaults), null);
});

test("an open request and three requests in the last 24 hours block another request", () => {
  assert.equal(validatePayoutRequest({ ...defaults, hasOpenRequest: true }), "open_request");
  assert.equal(validatePayoutRequest({ ...defaults, requestsInLast24Hours: 3 }), "daily_limit");
});

test("a full-balance reservation reaches zero and refuses a negative balance", () => {
  assert.equal(balanceAfterReservation(3000, 3000), 0);
  assert.equal(balanceAfterReservation(2999, 3000), null);
});

test("rejecting a payout restores its reserve exactly once", () => {
  assert.equal(balanceAfterRefund(0, 3000), 3000);
  assert.equal(canProcessPayout("REQUESTED"), true);
  assert.equal(canProcessPayout("REJECTED"), false);
  assert.equal(canProcessPayout("PAID"), false);
});

test("payout details cannot change while a request is open", () => {
  assert.equal(canEditPayoutDetails(true), false);
  assert.equal(canEditPayoutDetails(false), true);
});
