-- AlterTable
ALTER TABLE "LedgerEntry" ADD COLUMN     "weekStart" TIMESTAMP(3);

-- Week-based accruals must always identify their week.
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_accrual_weekStart_check"
CHECK ("type" <> 'ACCRUAL' OR "weekStart" IS NOT NULL);

-- Only one weekly accrual may exist for a user and week. Other ledger types are unaffected.
CREATE UNIQUE INDEX "LedgerEntry_userId_weekStart_accrual_key"
ON "LedgerEntry"("userId", "weekStart")
WHERE "type" = 'ACCRUAL' AND "weekStart" IS NOT NULL;

-- CreateTable
CREATE TABLE "WeekClosure" (
    "id" TEXT NOT NULL,
    "weekStart" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedById" TEXT NOT NULL,

    CONSTRAINT "WeekClosure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeekResult" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "weekStart" TIMESTAMP(3) NOT NULL,
    "weekCents" INTEGER NOT NULL,
    "carryInCents" INTEGER NOT NULL,
    "payableCents" INTEGER NOT NULL,
    "carryOutCents" INTEGER NOT NULL,
    "expiredCents" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WeekResult_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "WeekResult" ADD CONSTRAINT "WeekResult_amounts_check"
CHECK ("weekCents" >= 0 AND "carryInCents" >= 0 AND "payableCents" >= 0 AND "carryOutCents" >= 0 AND "expiredCents" >= 0);

-- CreateIndex
CREATE UNIQUE INDEX "WeekClosure_weekStart_key" ON "WeekClosure"("weekStart");

-- CreateIndex
CREATE UNIQUE INDEX "WeekResult_userId_weekStart_key" ON "WeekResult"("userId", "weekStart");

CREATE INDEX "WeekResult_weekStart_idx" ON "WeekResult"("weekStart");

-- AddForeignKey
ALTER TABLE "WeekClosure" ADD CONSTRAINT "WeekClosure_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeekResult" ADD CONSTRAINT "WeekResult_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
