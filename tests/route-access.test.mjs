import assert from "node:assert/strict";
import test from "node:test";
import { activeHomeDestination, protectedRouteRedirect, roleHome, safeInternalCallback } from "../src/lib/route-access.ts";

test("public root and login stay open while protected routes redirect by role", () => {
  assert.equal(protectedRouteRedirect("/", null), null);
  assert.equal(protectedRouteRedirect("/login", null), null);
  assert.equal(protectedRouteRedirect("/accounts", null), "/login");
  assert.equal(protectedRouteRedirect("/moderator/submissions", null), "/login");
  assert.equal(protectedRouteRedirect("/accounts", "MODERATOR"), "/moderator/submissions");
  assert.equal(protectedRouteRedirect("/moderator/users", "CLIPPER"), "/submissions");
  assert.equal(protectedRouteRedirect("/profile", "MODERATOR"), null);
  assert.equal(roleHome("CLIPPER"), "/submissions");
  assert.equal(roleHome("MODERATOR"), "/moderator/submissions");
  assert.equal(activeHomeDestination("CLIPPER", true), "/submissions");
  assert.equal(activeHomeDestination("MODERATOR", true), "/moderator/submissions");
  assert.equal(activeHomeDestination("CLIPPER", false), null);
  assert.equal(activeHomeDestination(undefined, true), null);
});

test("callback accepts only same-site absolute paths with one leading slash", () => {
  assert.equal(safeInternalCallback("/balance?tab=history"), "/balance?tab=history");
  assert.equal(safeInternalCallback("//attacker.example/path"), null);
  assert.equal(safeInternalCallback("https://attacker.example/path"), null);
  assert.equal(safeInternalCallback("/\\attacker.example"), null);
  assert.equal(safeInternalCallback(null), null);
});
