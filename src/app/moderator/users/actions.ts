"use server";

import bcrypt from "bcryptjs";
import { Platform, Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireModerator } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { parseModeratorChannels, type ChannelLineError } from "@/lib/moderator-channels";
import { nextPasswordVersion } from "@/lib/password-version";
import { addApprovedChannelsToClipper, createClipperBundle } from "@/lib/moderator-channel-operations";

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

export type ClipChannelState = {
  login?: string;
  links?: string;
  created?: boolean;
  error?: string;
  field?: "login" | "channels";
  lineErrors?: ChannelLineError[];
};

const clipperCreateSchema = z.object({
  login: z.string().trim().toLowerCase().regex(loginPattern, "Логин: 3–32 символа, только a-z, 0-9, _, точка и дефис."),
  password: passwordSchema,
});

function isUniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

async function channelConflictReport(channels: Array<{ line: number; platform: Platform; url: string }>) {
  const issues: ChannelLineError[] = [];
  for (const channel of channels) {
    const existing = await prisma.platformAccount.findUnique({
      where: { platform_url: { platform: channel.platform, url: channel.url } },
      select: { user: { select: { login: true } } },
    });
    if (existing) issues.push({ line: channel.line, reason: `Ссылка уже занята пользователем ${existing.user.login}.` });
  }
  return issues;
}

export async function createClipperWithChannelsAction(
  _previousState: ClipChannelState,
  formData: FormData,
): Promise<ClipChannelState> {
  const moderator = await requireModerator();
  const rawLogin = formData.get("login");
  const rawPassword = formData.get("password");
  const rawLinks = formData.get("links");
  const login = typeof rawLogin === "string" ? rawLogin.trim().toLowerCase() : "";
  const links = typeof rawLinks === "string" ? rawLinks : "";
  const credentials = clipperCreateSchema.safeParse({ login: rawLogin, password: rawPassword });
  if (!credentials.success) {
    const loginIssue = credentials.error.issues.find((issue) => issue.path[0] === "login");
    return { login, links, field: loginIssue ? "login" : undefined, error: loginIssue?.message ?? credentials.error.issues[0]?.message };
  }
  if (typeof rawPassword !== "string") return { login, links, field: "login", error: "Проверьте данные пользователя." };
  const parsedChannels = parseModeratorChannels(links);
  if (parsedChannels.errors.length) return { login, links, field: "channels", lineErrors: parsedChannels.errors };

  const passwordHash = await bcrypt.hash(credentials.data.password, 12);
  try {
    await prisma.$transaction((tx) => createClipperBundle(tx, {
      login: credentials.data.login,
      passwordHash,
      addedById: moderator.id,
      channels: parsedChannels.channels,
    }));
  } catch (error) {
    if (isUniqueViolation(error)) {
      const userExists = await prisma.user.findUnique({ where: { login }, select: { id: true } });
      if (userExists) return { login, links, field: "login", error: "Пользователь с таким логином уже существует." };
      return { login, links, field: "channels", lineErrors: await channelConflictReport(parsedChannels.channels) };
    }
    throw error;
  }
  revalidatePath("/moderator/users");
  revalidatePath("/moderator/accounts");
  return { created: true, login: credentials.data.login };
}

export async function addChannelsToClipperAction(
  userId: string,
  _previousState: ClipChannelState,
  formData: FormData,
): Promise<ClipChannelState> {
  const moderator = await requireModerator();
  const rawLinks = formData.get("links");
  const links = typeof rawLinks === "string" ? rawLinks : "";
  const parsedChannels = parseModeratorChannels(links);
  if (parsedChannels.errors.length) return { links, field: "channels", lineErrors: parsedChannels.errors };

  try {
    const errors = await prisma.$transaction((tx) => addApprovedChannelsToClipper(tx, {
      userId,
      moderatorId: moderator.id,
      channels: parsedChannels.channels,
    }));
    if (errors.length) return { links, field: "channels", lineErrors: errors };
  } catch (error) {
    if (isUniqueViolation(error)) return { links, field: "channels", lineErrors: await channelConflictReport(parsedChannels.channels) };
    throw error;
  }
  revalidatePath("/moderator/users");
  revalidatePath("/moderator/accounts");
  revalidatePath("/accounts");
  return { created: true };
}

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
    const reset = await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
      if (!locked.length) return false;
      const current = await tx.user.findUnique({ where: { id: userId }, select: { login: true, passwordChangedAt: true } });
      if (!current) return false;
      await tx.user.update({
        where: { id: userId },
        data: { password: await bcrypt.hash(parsedPassword.data, 12), passwordChangedAt: nextPasswordVersion(current.passwordChangedAt) },
        select: { id: true },
      });
      await tx.loginAttempt.deleteMany({ where: { login: current.login } });
      return true;
    });
    if (!reset) return { error: "Пользователь не найден." };
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

