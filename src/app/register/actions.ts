"use server";

import bcrypt from "bcryptjs";
import { Role } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

const registrationSchema = z.object({
  email: z.string().trim().toLowerCase().email("Введите корректный email."),
  password: z.string().min(8, "Пароль должен содержать не менее 8 символов."),
});

export type RegisterState = {
  error?: string;
  success?: boolean;
};

export async function registerAction(
  _previousState: RegisterState,
  formData: FormData,
): Promise<RegisterState> {
  const parsed = registrationSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Проверьте введённые данные." };
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, 12);

  try {
    await prisma.user.create({
      data: {
        email: parsed.data.email,
        password: passwordHash,
        role: Role.CLIPPER,
      },
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return { error: "Аккаунт с такой почтой уже существует." };
    }
    throw error;
  }

  return { success: true };
}
