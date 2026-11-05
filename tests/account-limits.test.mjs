import assert from "node:assert/strict";
import test from "node:test";
import { MAX_ACCOUNTS_PER_PLATFORM } from "../src/lib/config.ts";
import { isAccountPlatformLimitReached } from "../src/lib/account-limits.ts";

test("account platform limit is five and blocks only after all five slots are used", () => {
  assert.equal(MAX_ACCOUNTS_PER_PLATFORM, 5);
  assert.equal(isAccountPlatformLimitReached(4), false);
  assert.equal(isAccountPlatformLimitReached(5), true);
});
