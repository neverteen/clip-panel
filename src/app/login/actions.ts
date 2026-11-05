"use server";

import { AuthError } from "next-auth";
import { signIn } from "../../../auth";
import { z } from "zod";

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

  try {
    await signIn("credentials", {
      login: parsed.data.login,
      password: parsed.data.password,
      redirectTo: "/",
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
