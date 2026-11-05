-- AlterTable
ALTER TABLE "Submission" ADD COLUMN     "rejectReason" TEXT,
ADD COLUMN     "reviewedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Submission_status_weekStart_idx" ON "Submission"("status", "weekStart");

-- CreateIndex
CREATE INDEX "Submission_userId_weekStart_idx" ON "Submission"("userId", "weekStart");
