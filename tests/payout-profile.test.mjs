import assert from "node:assert/strict";
import test from "node:test";
import { maskDestination, parseSteamTradeUrl } from "../src/lib/payout-profile.ts";

test("Steam trade URL is parsed, trimmed, and accepted only for the expected HTTPS endpoint", () => {
  assert.equal(
    parseSteamTradeUrl(" https://steamcommunity.com/tradeoffer/new/?partner=123&token=abc "),
    "https://steamcommunity.com/tradeoffer/new/?partner=123&token=abc",
  );
  assert.equal(parseSteamTradeUrl("http://steamcommunity.com/tradeoffer/new/?partner=123&token=abc"), null);
  assert.equal(parseSteamTradeUrl("https://steamcommunity.com.example/tradeoffer/new/?partner=123&token=abc"), null);
  assert.equal(parseSteamTradeUrl("https://steamcommunity.com/tradeoffer/new/?partner=123"), null);
  assert.equal(parseSteamTradeUrl("https://steamcommunity.com/tradeoffer/new/?partner=1&partner=2&token=abc"), null);
  assert.equal(parseSteamTradeUrl("https://steamcommunity.com/tradeoffer/new/?partner=123&token=abc#fragment"), null);
});

test("destination masking hides the middle", () => {
  const destination = "https://steamcommunity.com/tradeoffer/new/?partner=123&token=secret-value";
  const masked = maskDestination(destination);
  assert.ok(masked.startsWith(destination.slice(0, 8)));
  assert.ok(masked.endsWith(destination.slice(-4)));
  assert.ok(!masked.includes("secret-value"));
});
