"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireClipper, requireUser } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { PayoutOperationError, updatePayoutDetails } from "@/lib/payout-operations";
import { parseSteamTradeUrl } from "@/lib/payout-profile";
import { createTelegramLinkCode, TelegramLinkError, unlinkTelegram } from "@/lib/telegram-link";
import { makeTelegramDeepLink } from "@/lib/telegram-rules";
import { getTelegramConfig } from "@/lib/telegram-api";
import { getNow } from "@/lib/now";
import bcrypt from "bcryptjs";
import { signOut } from "../../../auth";
import { clearLoginAttempts, isLoginBlocked, recordFailedLogin } from "@/lib/login-attempts";
import { nextPasswordVersion } from "@/lib/password-version";

export type ProfileActionState = { error?: string; message?: string };
export type TelegramLinkActionState = { error?: string; link?: string; expiresAt?: string };

const passwordSchema = z.string().min(8, "Пароль должен содержать не менее 8 символов.")
  .refine((password) => Buffer.byteLength(password, "utf8") <= 72, "Пароль слишком длинный: максимум 72 байта в UTF-8.");

const profileSchema = z.object({
  wallet: z.string().trim().max(200, "Кошелёк должен быть не длиннее 200 символов.").transform((value) => value || null),
  steamTradeUrl: z.string()
    .trim()
    .max(200, "Steam-ссылка должна быть не длиннее 200 символов.")
    .refine((value) => value === "" || parseSteamTradeUrl(value) !== null, "Укажите ссылку вида https://steamcommunity.com/tradeoffer/new/?partner=...&token=...")
    .transform((value) => value ? parseSteamTradeUrl(value) : null),
});

function operationError(code: string) {
  if (code === "open_request") return "Реквизиты нельзя менять, пока заявка на вывод ожидает обработки.";
  if (code === "inactive_user") return "Отключённый пользователь не может менять реквизиты.";
  if (code === "wrong_role") return "Доступ к профилю изменён. Войдите снова.";
  return "Не удалось сохранить реквизиты.";
}

export async function updatePayoutProfileAction(
  _previousState: ProfileActionState,
  formData: FormData,
): Promise<ProfileActionState> {
  const user = await requireClipper();
  const parsed = profileSchema.safeParse({
    wallet: formData.get("wallet"),
    steamTradeUrl: formData.get("steamTradeUrl"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Проверьте реквизиты." };

  try {
    await prisma.$transaction((tx) => updatePayoutDetails(tx, user.id, parsed.data));
  } catch (error) {
    if (error instanceof PayoutOperationError) return { error: operationError(error.code) };
    throw error;
  }
  revalidatePath("/profile");
  revalidatePath("/balance");
  return { message: "Реквизиты сохранены." };
}

export async function changePasswordAction(formData: FormData): Promise<void> {
  const user = await requireClipper();
  const currentPassword = formData.get("currentPassword");
  const parsed = z.object({
    currentPassword: z.string().min(1),
    newPassword: passwordSchema,
    confirmPassword: z.string().min(1),
  }).safeParse({
    currentPassword,
    newPassword: formData.get("newPassword"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) redirect("/profile?passwordError=invalid");
  if (parsed.data.newPassword !== parsed.data.confirmPassword) redirect("/profile?passwordError=mismatch");
  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "User" WHERE "id" = ${user.id} FOR UPDATE`;
    const current = await tx.user.findUnique({
      where: { id: user.id },
      select: { password: true, passwordChangedAt: true, isActive: true, role: true },
    });
    if (!current?.isActive || current.role !== "CLIPPER") return "account_changed" as const;
    if (await isLoginBlocked(user.login, tx)) return "locked" as const;
    if (typeof currentPassword !== "string" || !(await bcrypt.compare(currentPassword, current.password))) {
      await recordFailedLogin(user.login, tx);
      return "incorrect" as const;
    }
    if (await bcrypt.compare(parsed.data.newPassword, current.password)) return "same" as const;
    await tx.user.update({
      where: { id: user.id },
      data: {
        password: await bcrypt.hash(parsed.data.newPassword, 12),
        passwordChangedAt: nextPasswordVersion(current.passwordChangedAt),
      },
      select: { id: true },
    });
    await clearLoginAttempts(user.login, tx);
    return "changed" as const;
  });
  if (result === "locked") redirect("/profile?passwordError=locked");
  if (result === "incorrect") redirect("/profile?passwordError=incorrect");
  if (result === "same") redirect("/profile?passwordError=same");
  if (result !== "changed") redirect("/login");
  await signOut({ redirectTo: "/login?passwordChanged=1" });
}

function telegramError(code: string) {
  if (code === "daily_limit") return "За сутки можно создать не более пяти ссылок привязки.";
  if (code === "inactive") return "Отключённый пользователь не может менять настройки Telegram.";
  return "Не удалось выполнить действие Telegram.";
}

export async function createTelegramLinkAction(): Promise<TelegramLinkActionState> {
  const user = await requireUser();
  const config = getTelegramConfig();
  if (!config) return { error: "Telegram-бот пока не настроен." };

  try {
    const generated = await prisma.$transaction((tx) => createTelegramLinkCode(tx, user.id, getNow()));
    const link = makeTelegramDeepLink(config.username, generated.secret);
    if (!link) return { error: "Не удалось создать ссылку привязки." };
    return { link, expiresAt: generated.expiresAt.toISOString() };
  } catch (error) {
    if (error instanceof TelegramLinkError) return { error: telegramError(error.code) };
    throw error;
  }
}

export async function unlinkTelegramAction(): Promise<ProfileActionState> {
  const user = await requireUser();
  try {
    const wasLinked = await prisma.$transaction((tx) => unlinkTelegram(tx, user.id, getNow()));
    revalidatePath("/profile");
    return { message: wasLinked ? "Telegram отвязан." : "Telegram уже не привязан." };
  } catch (error) {
    if (error instanceof TelegramLinkError) return { error: telegramError(error.code) };
    throw error;
  }
}

export async function setTelegramNotificationsAction(formData: FormData): Promise<ProfileActionState> {
  const user = await requireUser();
  const enabled = formData.getAll("enabled").includes("true");
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "User" WHERE "id" = ${user.id} FOR UPDATE
      `;
      const current = await tx.user.findUnique({ where: { id: user.id }, select: { isActive: true, role: true } });
      if (!current?.isActive) throw new TelegramLinkError("inactive");
      if (current.role !== "CLIPPER" && current.role !== "MODERATOR") throw new TelegramLinkError("wrong_role");
      await tx.user.update({
        where: { id: user.id },
        data: { telegramNotificationsEnabled: enabled },
        select: { id: true },
      });
    });
    revalidatePath("/profile");
    return { message: enabled ? "Уведомления включены." : "Уведомления выключены." };
  } catch (error) {
    if (error instanceof TelegramLinkError) return { error: telegramError(error.code) };
    throw error;
  }
}
