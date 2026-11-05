-- CreateTable
CREATE TABLE "SubmissionReadState" (
    "userId" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "lastReadAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubmissionReadState_pkey" PRIMARY KEY ("userId","submissionId")
);

-- CreateIndex
CREATE INDEX "Message_submissionId_createdAt_id_idx" ON "Message"("submissionId", "createdAt", "id");

-- AddForeignKey
ALTER TABLE "SubmissionReadState" ADD CONSTRAINT "SubmissionReadState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmissionReadState" ADD CONSTRAINT "SubmissionReadState_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
