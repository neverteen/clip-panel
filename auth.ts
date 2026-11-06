import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { Role } from "@prisma/client";
import { authConfig } from "./auth.config";
import { prisma } from "./src/lib/prisma";
import { clearLoginAttempts, isLoginBlocked, recordFailedLogin } from "./src/lib/login-attempts";

const loginSchema = z.string().trim().toLowerCase().min(1).max(320);
const passwordSchema = z
  .string()
  .min(8)
  .refine((password) => Buffer.byteLength(password, "utf8") <= 72);

const DUMMY_PASSWORD_HASH = bcrypt.hashSync(
  "not-a-valid-clip-panel-password",
  12,
);

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

        if (await isLoginBlocked(login)) return null;

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

        await clearLoginAttempts(login);

        return {
          id: user.id,
          login: user.login,
          email: null,
          name: user.login,
          role: user.role ?? Role.CLIPPER,
          passwordChangedAt: user.passwordChangedAt?.getTime() ?? 0,
        };
      },
    }),
  ],
});
