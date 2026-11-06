import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
export { passwordVersionMatches } from "@/lib/password-version";

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MS = 10 * 60 * 1000;
type Db = PrismaClient | Prisma.TransactionClient;

export async function isLoginBlocked(login: string, db: Db = prisma, now = new Date()) {
  const attempt = await db.loginAttempt.findUnique({ where: { login }, select: { lockedUntil: true } });
  return Boolean(attempt?.lockedUntil && attempt.lockedUntil > now);
}

export async function recordFailedLogin(login: string, db: Db = prisma, now = new Date()) {
  const lockedUntil = new Date(now.getTime() + LOCK_DURATION_MS);
  await db.$executeRaw`
    INSERT INTO "LoginAttempt" ("login", "failedAttempts", "lockedUntil", "updatedAt")
    VALUES (${login}, 1, NULL, ${now})
    ON CONFLICT ("login") DO UPDATE SET
      "failedAttempts" = CASE
        WHEN "LoginAttempt"."lockedUntil" > ${now} THEN "LoginAttempt"."failedAttempts"
        WHEN "LoginAttempt"."lockedUntil" IS NOT NULL AND "LoginAttempt"."lockedUntil" <= ${now} THEN 1
        ELSE "LoginAttempt"."failedAttempts" + 1
      END,
      "lockedUntil" = CASE
        WHEN "LoginAttempt"."lockedUntil" > ${now} THEN "LoginAttempt"."lockedUntil"
        WHEN "LoginAttempt"."lockedUntil" IS NOT NULL AND "LoginAttempt"."lockedUntil" <= ${now} THEN NULL
        WHEN "LoginAttempt"."failedAttempts" + 1 >= ${MAX_FAILED_ATTEMPTS} THEN ${lockedUntil}
        ELSE "LoginAttempt"."lockedUntil"
      END,
      "updatedAt" = ${now}
  `;
}

export async function clearLoginAttempts(login: string, db: Db = prisma) {
  await db.loginAttempt.deleteMany({ where: { login } });
}

