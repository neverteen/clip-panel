"use server";

import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireModerator } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";

const loginPattern = /^[a-z0-9_.-]{3,32}$/;
const passwordSchema = z
  .string()
  .min(8, "Пароль должен содержать не менее 8 символов.")
  .refine(
    (password) => Buffer.byteLength(password, "utf8") <= 72,
    "Пароль слишком длинный: максимум 72 байта в UTF-8.",
  );

const userSchema = z.object({
  login: z.string().trim().toLowerCase().regex(
    loginPattern,
    "Логин: 3–32 символа — только a-z, 0-9, _, точка или дефис.",
  ),
  password: passwordSchema,
});

export type BatchResult = {
  line: number;
  login?: string;
  status: "created" | "error";
  reason?: string;
};

export type BatchState = {
  submitted?: boolean;
  results: BatchResult[];
  message?: string;
};

export type ActionState = {
  message?: string;
  error?: string;
};

export async function createUsersAction(
  _previousState: BatchState,
  formData: FormData,
): Promise<BatchState> {
  await requireModerator();

  const raw = formData.get("users");
  if (typeof raw !== "string") {
    return { submitted: true, results: [], message: "Вставьте список пользователей." };
  }

  const lines = raw.split(/\r?\n/);
  const pending: Array<{ line: number; value: unknown }> = [];
  const results: BatchResult[] = [];

  lines.forEach((line, index) => {
    if (line.trim() === "") return;
    const separator = line.indexOf(":");
    if (separator < 0) {
      results.push({
        line: index + 1,
        status: "error",
        reason: "Нет разделителя «:» между логином и паролем.",
      });
      return;
    }

    pending.push({
      line: index + 1,
      value: {
        login: line.slice(0, separator),
        password: line.slice(separator + 1),
      },
    });
  });

  const loginsInBatch = new Map<string, number>();
  for (const row of pending) {
    const login = (row.value as { login: string }).login.trim().toLowerCase();
    if (loginPattern.test(login)) {
      loginsInBatch.set(login, (loginsInBatch.get(login) ?? 0) + 1);
    }
  }

  const parsedRows = pending.map((row) => {
    const parsed = userSchema.safeParse(row.value);
    const rawLogin = (row.value as { login: string }).login.trim().toLowerCase();
    return { ...row, rawLogin, parsed };
  });

  const validLogins = parsedRows
    .filter((row) => row.parsed.success && loginsInBatch.get(row.rawLogin) === 1)
    .map((row) => row.rawLogin);

  const existingUsers = validLogins.length
    ? await prisma.user.findMany({
        where: { login: { in: validLogins, mode: "insensitive" } },
        select: { login: true },
      })
    : [];
  const existingLogins = new Set(existingUsers.map((user) => user.login.toLowerCase()));

  for (const row of parsedRows) {
    if (!row.parsed.success) {
      results.push({
        line: row.line,
        login: row.rawLogin || undefined,
        status: "error",
        reason: row.parsed.error.issues[0]?.message ?? "Некорректные данные.",
      });
      continue;
    }

    if ((loginsInBatch.get(row.rawLogin) ?? 0) > 1) {
      results.push({
        line: row.line,
        login: row.rawLogin,
        status: "error",
        reason: "Этот логин повторяется в текущем списке.",
      });
      continue;
    }

    if (existingLogins.has(row.rawLogin)) {
      results.push({
        line: row.line,
        login: row.rawLogin,
        status: "error",
        reason: "Пользователь с таким логином уже существует.",
      });
      continue;
    }

    const userData = row.parsed.data as z.infer<typeof userSchema>;
    try {
      const passwordHash = await bcrypt.hash(userData.password, 12);
      await prisma.$transaction((tx) =>
        tx.user.create({
          data: {
            login: userData.login,
            password: passwordHash,
            role: "CLIPPER",
          },
          select: { id: true },
        }),
      );
      existingLogins.add(row.rawLogin);
      results.push({ line: row.line, login: row.rawLogin, status: "created" });
    } catch (error) {
      const isDuplicate =
        error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
      results.push({
        line: row.line,
        login: row.rawLogin,
        status: "error",
        reason: isDuplicate
          ? "Пользователь с таким логином уже существует."
          : "Не удалось создать пользователя из-за ошибки базы данных.",
      });
    }
  }

  revalidatePath("/moderator/users");
  return {
    submitted: true,
    results: results.sort((left, right) => left.line - right.line),
    message: results.length === 0 ? "В списке нет строк для обработки." : undefined,
  };
}

export async function resetPasswordAction(
  userId: string,
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireModerator();

  const parsedPassword = passwordSchema.safeParse(formData.get("password"));
  if (!parsedPassword.success) {
    return { error: parsedPassword.error.issues[0]?.message ?? "Проверьте пароль." };
  }

  try {
    await prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id: userId },
        data: { password: await bcrypt.hash(parsedPassword.data, 12) },
        select: { login: true },
      });
      await tx.loginAttempt.deleteMany({ where: { login: user.login } });
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      return { error: "Пользователь не найден." };
    }
    throw error;
  }

  revalidatePath("/moderator/users");
  return { message: "Пароль сброшен." };
}

export async function deactivateUserAction(
  userId: string,
  _previousState: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  const moderator = await requireModerator();
  void _previousState;
  void _formData;
  if (moderator.id === userId) {
    return { error: "Нельзя отключить собственный аккаунт." };
  }

  try {
    await prisma.user.update({
      where: { id: userId },
      data: { isActive: false },
      select: { id: true },
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      return { error: "Пользователь не найден." };
    }
    throw error;
  }

  revalidatePath("/moderator/users");
  return { message: "Пользователь отключён." };
}

