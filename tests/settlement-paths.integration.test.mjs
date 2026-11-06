import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { lockSettlementWeek } from "../src/lib/settlement-week.ts";
import { reviewSubmissionInTransaction } from "../src/lib/submission-review.ts";
import { closeWeekInTransaction } from "../src/lib/week-closure.ts";
import { getWindow, WEEK_MS } from "../src/lib/week.ts";
import { calculateAmountCents } from "../src/lib/payout.ts";

const prisma = new PrismaClient();
const rollback = () => { throw new Error("settlement_integration_rollback"); };
const wasRolledBack = (error) => error?.message === "settlement_integration_rollback";
const login = (prefix) => `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function createClipper(tx, prefix, fixedLogin) {
  return tx.user.create({
    data: { login: fixedLogin ?? login(prefix), password: "integration-test-only" },
    select: { id: true, login: true },
  });
}

test("settlement advisory lock executes and serializes another transaction for the same week", async () => {
  const weekStart = new Date("2091-04-07T22:00:00.000Z");
  let releaseFirst;
  let signalAcquired;
  const hold = new Promise((resolve) => { releaseFirst = resolve; });
  const acquired = new Promise((resolve) => { signalAcquired = resolve; });
  const first = prisma.$transaction(async (tx) => {
    await lockSettlementWeek(tx, weekStart);
    signalAcquired();
    await hold;
    rollback();
  });
  await acquired;

  let secondAcquired = false;
  const second = prisma.$transaction(async (tx) => {
    await lockSettlementWeek(tx, weekStart);
    secondAcquired = true;
  });
  try {
    await sleep(200);
    assert.equal(secondAcquired, false, "second transaction must wait for the first lock");
  } finally {
    releaseFirst();
  }
  await assert.rejects(first, wasRolledBack);
  await second;
  assert.equal(secondAcquired, true);
});

test("approval path updates a real pending submission and rolls all fixture data back", async () => {
  const testLogin = login("review_path");
  await assert.rejects(prisma.$transaction(async (tx) => {
    const user = await createClipper(tx, "review_path", testLogin);
    const account = await tx.platformAccount.create({
      data: { userId: user.id, platform: "YOUTUBE", url: `https://youtube.com/@${user.login}`, status: "APPROVED" },
      select: { id: true },
    });
    const weekStart = getWindow(new Date("2091-04-07T22:00:00.000Z")).start;
    const publishedAt = new Date(weekStart.getTime() + 60 * 60 * 1000);
    const submission = await tx.submission.create({
      data: {
        userId: user.id, accountId: account.id,
        videoUrl: `https://www.youtube.com/shorts/${randomUUID().replaceAll("-", "").slice(0, 11)}`,
        publishedAt, weekStart, status: "PENDING",
      },
      select: { id: true },
    });
    const views = 25_000;
    const result = await reviewSubmissionInTransaction(tx, {
      submissionId: submission.id, decision: "APPROVE", views, publishedAt,
      now: new Date(weekStart.getTime() + 2 * 24 * 60 * 60 * 1000),
    });
    assert.equal(result.error, undefined);
    const saved = await tx.submission.findUniqueOrThrow({ where: { id: submission.id } });
    assert.equal(saved.status, "APPROVED");
    assert.equal(saved.views, views);
    assert.equal(saved.amountCents, calculateAmountCents(views));
    assert.ok(saved.reviewedAt);
    assert.equal(await tx.ledgerEntry.count({ where: { userId: user.id } }), 0);
    rollback();
  }), wasRolledBack);
  assert.equal(await prisma.user.count({ where: { login: testLogin } }), 0);
});

test("week closure path creates results and accruals in PostgreSQL, then rolls them back", async (t) => {
  const now = new Date();
  const earliest = await prisma.submission.findFirst({ orderBy: { weekStart: "asc" }, select: { weekStart: true } });
  const closures = await prisma.weekClosure.findMany({ orderBy: { weekStart: "asc" }, select: { weekStart: true } });
  let candidate = earliest?.weekStart ?? getWindow(new Date("2020-01-06T01:00:00.000Z")).start;
  const closedStarts = new Set(closures.map((row) => row.weekStart.getTime()));

  while (closedStarts.has(candidate.getTime())) {
    candidate = new Date(candidate.getTime() + WEEK_MS);
  }
  const laterClosure = closures.find((row) => row.weekStart.getTime() > candidate.getTime());
  if (laterClosure) {
    t.skip("database has a closure after a gap, so the week chain is inconsistent");
    return;
  }

  const fixtureLogin = login("closure_path");
  await assert.rejects(prisma.$transaction(async (tx) => {
    // If the shared database has a pending row in its first open week, move it
    // only inside this transaction so the closure path can be exercised; the
    // rollback below restores it exactly, without a lasting change.
    await tx.submission.updateMany({
      where: { weekStart: candidate, status: "PENDING" },
      data: { status: "REJECTED", rejectReason: "integration test", reviewedAt: now },
    });
    const moderator = await tx.user.create({
      data: { login: login("closure_mod"), password: "integration-test-only", role: "MODERATOR" },
      select: { id: true },
    });
    const user = await tx.user.create({
      data: { login: fixtureLogin, password: "integration-test-only" },
      select: { id: true },
    });
    const account = await tx.platformAccount.create({
      data: { userId: user.id, platform: "YOUTUBE", url: `https://youtube.com/@${fixtureLogin}`, status: "APPROVED" },
      select: { id: true },
    });
    const views = 25_000;
    await tx.submission.create({
      data: {
        userId: user.id, accountId: account.id,
        videoUrl: `https://www.youtube.com/shorts/${randomUUID().replaceAll("-", "").slice(0, 11)}`,
        publishedAt: new Date(candidate.getTime() + 60 * 60 * 1000),
        views, amountCents: calculateAmountCents(views), weekStart: candidate, status: "APPROVED",
        reviewedAt: new Date(candidate.getTime() + 2 * 60 * 60 * 1000),
      },
    });
    const result = await closeWeekInTransaction(tx, {
      weekStart: candidate, moderatorId: moderator.id,
      now: new Date(candidate.getTime() + WEEK_MS + 60 * 60 * 1000),
    });
    assert.equal(result.error, undefined);
    const weekResult = await tx.weekResult.findUniqueOrThrow({ where: { userId_weekStart: { userId: user.id, weekStart: candidate } } });
    assert.equal(weekResult.weekCents, calculateAmountCents(views));
    assert.equal(weekResult.payableCents, calculateAmountCents(views));
    assert.equal(await tx.ledgerEntry.count({ where: { userId: user.id, type: "ACCRUAL", weekStart: candidate } }), 1);
    rollback();
  }), wasRolledBack);
  assert.equal(await prisma.user.count({ where: { login: fixtureLogin } }), 0);
});

test.after(async () => prisma.$disconnect());
