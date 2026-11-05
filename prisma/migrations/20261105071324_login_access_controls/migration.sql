-- Preserve existing credentials by renaming the column in place.
ALTER TABLE "User" RENAME COLUMN "email" TO "login";
ALTER INDEX "User_email_key" RENAME TO "User_login_key";

-- Existing users remain active unless a moderator disables them.
ALTER TABLE "User" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "LoginAttempt" (
    "login" TEXT NOT NULL,
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoginAttempt_pkey" PRIMARY KEY ("login")
);
