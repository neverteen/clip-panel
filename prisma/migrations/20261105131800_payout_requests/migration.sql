-- CreateEnum
CREATE TYPE "PayoutMethod" AS ENUM ('CRYPTO', 'SKINS');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('REQUESTED', 'PAID', 'REJECTED');

-- AlterTable
ALTER TABLE "LedgerEntry" ADD COLUMN     "payoutId" TEXT;

-- Each payout may have at most one reserve and one refund ledger entry.
CREATE UNIQUE INDEX "LedgerEntry_payoutId_type_key"
ON "LedgerEntry"("payoutId", "type") WHERE "payoutId" IS NOT NULL;

ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_payout_amounts_check"
CHECK (
  ("type" <> 'PAYOUT' OR ("amountCents" < 0 AND "payoutId" IS NOT NULL)) AND
  ("type" <> 'ACCRUAL' OR "amountCents" > 0) AND
  ("type" <> 'ADJUSTMENT' OR "payoutId" IS NULL OR "amountCents" > 0)
);

-- CreateTable
CREATE TABLE "Payout" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "method" "PayoutMethod" NOT NULL,
    "destination" TEXT NOT NULL,
    "status" "PayoutStatus" NOT NULL DEFAULT 'REQUESTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "processedById" TEXT,
    "txRef" TEXT,
    "rejectReason" TEXT,

    CONSTRAINT "Payout_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Payout" ADD CONSTRAINT "Payout_state_check" CHECK (
  "amountCents" > 0 AND
  ("status" <> 'REQUESTED' OR ("processedAt" IS NULL AND "processedById" IS NULL AND "txRef" IS NULL AND "rejectReason" IS NULL)) AND
  ("status" <> 'PAID' OR ("processedAt" IS NOT NULL AND "processedById" IS NOT NULL AND "txRef" IS NOT NULL AND "rejectReason" IS NULL)) AND
  ("status" <> 'REJECTED' OR ("processedAt" IS NOT NULL AND "processedById" IS NOT NULL AND "rejectReason" IS NOT NULL AND "txRef" IS NULL))
);

CREATE INDEX "LedgerEntry_userId_createdAt_idx" ON "LedgerEntry"("userId", "createdAt");

-- A user may have only one open payout request.
CREATE UNIQUE INDEX "Payout_one_requested_per_user_key"
ON "Payout"("userId") WHERE "status" = 'REQUESTED';

-- CreateIndex
CREATE INDEX "Payout_status_createdAt_idx" ON "Payout"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Payout_userId_createdAt_idx" ON "Payout"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "Payout"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_processedById_fkey" FOREIGN KEY ("processedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
