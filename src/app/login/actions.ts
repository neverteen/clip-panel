"use server";

import { AuthError } from "next-auth";
import { signIn } from "../../../auth";
import { Role } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { roleHome, safeInternalCallback } from "@/lib/route-access";

const loginSchema = z.object({
  login: z.string().trim().toLowerCase().min(1).max(320),
  password: z.string(),
});

export type LoginState = {
  error?: string;
};

export async function loginAction(
  _previousState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    login: formData.get("login"),
    password: formData.get("password"),
  });

  if (!parsed.success) return { error: "Неверный логин или пароль." };

  const passwordTooLong = Buffer.byteLength(parsed.data.password, "utf8") > 72;
  const user = await prisma.user.findUnique({
    where: { login: parsed.data.login },
    select: { role: true },
  });
  const fallback = roleHome(user?.role === Role.MODERATOR ? "MODERATOR" : "CLIPPER");
  const callbackUrlValue = formData.get("callbackUrl");
  const callbackUrl = safeInternalCallback(typeof callbackUrlValue === "string" ? callbackUrlValue : null);

  try {
    await signIn("credentials", {
      login: parsed.data.login,
      password: parsed.data.password,
      redirectTo: callbackUrl ?? fallback,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return {
        error: passwordTooLong
          ? "Пароль слишком длинный: максимум 72 байта в UTF-8."
          : "Неверный логин или пароль.",
      };
    }
    throw error;
  }

  return {};
}
