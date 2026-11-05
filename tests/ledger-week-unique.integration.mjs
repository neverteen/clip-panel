import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

test("PostgreSQL rejects a second weekly ACCRUAL for the same user", async () => {
  const weekStart = new Date("2025-01-06T00:00:00.000Z");
  const login = `ledger_test_${randomUUID().replaceAll("-", "").slice(0, 12)}`;

  await assert.rejects(
    prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { login, password: "integration-test-only" },
        select: { id: true },
      });
      await tx.ledgerEntry.create({
        data: { userId: user.id, type: "ACCRUAL", amountCents: 3000, weekStart },
      });
      await tx.ledgerEntry.create({
        data: { userId: user.id, type: "ACCRUAL", amountCents: 3000, weekStart },
      });
      throw new Error("The duplicate ACCRUAL was unexpectedly accepted.");
    }),
    (error) => error?.code === "P2002",
  );
});

test.after(async () => {
  await prisma.$disconnect();
});
