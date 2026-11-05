import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { Role } from "@prisma/client";
import { authConfig } from "./auth.config";
import { prisma } from "./src/lib/prisma";

const loginSchema = z.string().trim().toLowerCase().min(1).max(320);
const passwordSchema = z
  .string()
  .min(8)
  .refine((password) => Buffer.byteLength(password, "utf8") <= 72);

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MS = 10 * 60 * 1000;
const DUMMY_PASSWORD_HASH = bcrypt.hashSync(
  "not-a-valid-clip-panel-password",
  12,
);

async function recordFailedLogin(login: string) {
  const now = new Date();
  const lockedUntil = new Date(now.getTime() + LOCK_DURATION_MS);

  await prisma.$executeRaw`
    INSERT INTO "LoginAttempt" ("login", "failedAttempts", "lockedUntil", "updatedAt")
    VALUES (${login}, 1, NULL, ${now})
    ON CONFLICT ("login") DO UPDATE SET
      "failedAttempts" = CASE
        WHEN "LoginAttempt"."lockedUntil" > ${now}
          THEN "LoginAttempt"."failedAttempts"
        WHEN "LoginAttempt"."lockedUntil" IS NOT NULL
          AND "LoginAttempt"."lockedUntil" <= ${now}
          THEN 1
        ELSE "LoginAttempt"."failedAttempts" + 1
      END,
      "lockedUntil" = CASE
        WHEN "LoginAttempt"."lockedUntil" > ${now}
          THEN "LoginAttempt"."lockedUntil"
        WHEN "LoginAttempt"."lockedUntil" IS NOT NULL
          AND "LoginAttempt"."lockedUntil" <= ${now}
          THEN NULL
        WHEN "LoginAttempt"."failedAttempts" + 1 >= ${MAX_FAILED_ATTEMPTS}
          THEN ${lockedUntil}
        ELSE "LoginAttempt"."lockedUntil"
      END,
      "updatedAt" = ${now}
  `;
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        login: { label: "Логин", type: "text" },
        password: { label: "Пароль", type: "password" },
      },
      async authorize(input) {
        const parsedLogin = loginSchema.safeParse(input?.login);
        if (!parsedLogin.success) return null;
        const login = parsedLogin.data;

        const user = await prisma.user.findUnique({
          where: { login },
        });

        const attempt = await prisma.loginAttempt.findUnique({
          where: { login },
        });
        if (attempt?.lockedUntil && attempt.lockedUntil > new Date()) return null;

        const parsedPassword = passwordSchema.safeParse(input?.password);
        if (!parsedPassword.success || !user || !user.isActive) {
          await bcrypt.compare(
            typeof input?.password === "string" ? input.password : "",
            user?.isActive ? user.password : DUMMY_PASSWORD_HASH,
          );
          await recordFailedLogin(login);
          return null;
        }

        const passwordMatches = await bcrypt.compare(
          parsedPassword.data,
          user.password,
        );
        if (!passwordMatches) {
          await recordFailedLogin(login);
          return null;
        }

        await prisma.loginAttempt.deleteMany({ where: { login } });

        return {
          id: user.id,
          email: null,
          name: user.login,
          role: user.role ?? Role.CLIPPER,
        };
      },
    }),
  ],
});
