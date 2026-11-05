-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "NotificationKind" AS ENUM ('NEW_SUBMISSION', 'NEW_ACCOUNT', 'NEW_PAYOUT', 'CHAT_MESSAGE', 'ACCOUNT_APPROVED', 'ACCOUNT_REJECTED', 'SUBMISSION_APPROVED', 'SUBMISSION_REJECTED', 'WEEK_CLOSED', 'PAYOUT_PAID', 'PAYOUT_REJECTED', 'TELEGRAM_LINKED', 'TELEGRAM_UNLINKED');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "telegramNotificationsEnabled" BOOLEAN NOT NULL DEFAULT true;

CREATE UNIQUE INDEX "User_telegramChatId_key" ON "User"("telegramChatId");

-- CreateTable
CREATE TABLE "TelegramLinkCode" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),

    CONSTRAINT "TelegramLinkCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelegramStartAttempt" (
    "chatHash" TEXT NOT NULL,
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "windowStartedAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TelegramStartAttempt_pkey" PRIMARY KEY ("chatHash")
);

-- CreateTable
CREATE TABLE "TelegramWorkerLease" (
    "id" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "leaseUntil" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TelegramWorkerLease_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelegramWorkerState" (
    "id" TEXT NOT NULL,
    "nextOffset" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "TelegramWorkerState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "NotificationKind" NOT NULL,
    "text" TEXT NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "dedupeKey" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "recipientChatId" TEXT,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Notification" ADD CONSTRAINT "Notification_state_check" CHECK (
  "attempts" >= 0 AND
  char_length("text") BETWEEN 1 AND 1000 AND
  ("status" <> 'SENT' OR "sentAt" IS NOT NULL) AND
  ("status" = 'SENT' OR "sentAt" IS NULL) AND
  ("status" <> 'SENDING' OR "leaseUntil" IS NOT NULL)
);
ALTER TABLE "TelegramLinkCode" ADD CONSTRAINT "TelegramLinkCode_time_check" CHECK ("expiresAt" > "createdAt");
ALTER TABLE "TelegramStartAttempt" ADD CONSTRAINT "TelegramStartAttempt_attempts_check" CHECK ("failedAttempts" >= 0);
ALTER TABLE "TelegramWorkerState" ADD CONSTRAINT "TelegramWorkerState_offset_check" CHECK ("nextOffset" >= 0);
ALTER TABLE "User" ADD CONSTRAINT "User_telegramChatId_nonempty_check" CHECK ("telegramChatId" IS NULL OR char_length("telegramChatId") > 0);

-- CreateIndex
CREATE UNIQUE INDEX "TelegramLinkCode_codeHash_key" ON "TelegramLinkCode"("codeHash");

-- CreateIndex
CREATE INDEX "TelegramLinkCode_userId_createdAt_idx" ON "TelegramLinkCode"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "TelegramLinkCode_expiresAt_usedAt_idx" ON "TelegramLinkCode"("expiresAt", "usedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_dedupeKey_key" ON "Notification"("dedupeKey");

-- CreateIndex
CREATE INDEX "Notification_status_nextAttemptAt_createdAt_idx" ON "Notification"("status", "nextAttemptAt", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_userId_kind_createdAt_idx" ON "Notification"("userId", "kind", "createdAt");

-- AddForeignKey
ALTER TABLE "TelegramLinkCode" ADD CONSTRAINT "TelegramLinkCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
