"use server";

import { AccountStatus, Platform, Prisma, Role } from "@prisma/client";
import { MAX_ACCOUNTS_PER_PLATFORM } from "@/lib/config";
import { isAccountPlatformLimitReached } from "@/lib/account-limits";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireClipper, requireModerator } from "@/lib/auth-guards";
import { getAccountWindow, getAccountWindowNow, isAccountWindowOpen } from "@/lib/account-window";
import { prisma } from "@/lib/prisma";
import { enqueueModeratorNotifications, enqueueUserNotification } from "@/lib/telegram-notifications";
import { normalizeProfileUrl } from "@/lib/account-url";

const accountInputSchema = z
  .object({
    platform: z.enum([Platform.TIKTOK, Platform.YOUTUBE, Platform.INSTAGRAM]),
    url: z.string().trim().min(1, "Введите ссылку.").max(2048, "Ссылка слишком длинная."),
  })
  .transform((input, context) => {
    const normalized = normalizeProfileUrl(input.platform, input.url);
    if ("error" in normalized) {
      context.addIssue({ code: "custom", message: normalized.error, path: ["url"] });
      return z.NEVER;
    }
    return { ...input, url: normalized.url };
  });

export type AccountActionState = {
  error?: string;
  message?: string;
};

function closedWindowMessage(now: Date) {
  const { opensAt } = getAccountWindow(now);
  const opens = new Intl.DateTimeFormat("ru-RU", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Moscow",
  }).format(opensAt);
  return `Добавлять аккаунты можно только во вторник с 00:00 до 22:00 МСК. Ближайшее открытие: ${opens} МСК.`;
}

export async function addPlatformAccountAction(
  _previousState: AccountActionState,
  formData: FormData,
): Promise<AccountActionState> {
  const owner = await requireClipper();

  let now = getAccountWindowNow();
  if (!isAccountWindowOpen(now)) return { error: closedWindowMessage(now) };

  const parsed = accountInputSchema.safeParse({
    platform: formData.get("platform"),
    url: formData.get("url"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Проверьте платформу и ссылку." };
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const lockedUsers = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "User" WHERE "id" = ${owner.id} FOR UPDATE
      `;
      if (lockedUsers.length === 0) return { error: "Пользователь не найден." };

      const currentUser = await tx.user.findUnique({
        where: { id: owner.id },
        select: { isActive: true, role: true, login: true },
      });
      if (!currentUser?.isActive || currentUser.role !== Role.CLIPPER) {
        return { error: "Доступ к аккаунту изменён. Войдите снова." };
      }

      now = getAccountWindowNow();
      if (!isAccountWindowOpen(now)) return { error: closedWindowMessage(now) };

      const existing = await tx.platformAccount.findUnique({
        where: {
          platform_url: {
            platform: parsed.data.platform,
            url: parsed.data.url,
          },
        },
        select: { id: true, userId: true, status: true },
      });
      if (existing && existing.userId !== owner.id) {
        return { error: "Эта ссылка уже используется." };
      }
      if (existing && existing.status !== AccountStatus.REJECTED) {
        return { error: "Этот аккаунт уже добавлен." };
      }

      const used = await tx.platformAccount.count({
        where: {
          userId: owner.id,
          addedById: owner.id,
          platform: parsed.data.platform,
          status: { in: [AccountStatus.PENDING, AccountStatus.APPROVED] },
        },
      });
      if (isAccountPlatformLimitReached(used)) {
        return { error: `Достигнут лимит: максимум ${MAX_ACCOUNTS_PER_PLATFORM} аккаунтов на платформу.` };
      }

      if (existing) {
        const reopened = await tx.platformAccount.updateMany({
          where: {
            id: existing.id,
            userId: owner.id,
            status: AccountStatus.REJECTED,
          },
          data: { status: AccountStatus.PENDING },
        });
        if (reopened.count === 0) return { error: "Статус аккаунта уже изменён. Обновите страницу." };
        await enqueueModeratorNotifications(tx, {
          kind: "NEW_ACCOUNT",
          login: currentUser.login,
          platform: parsed.data.platform,
          url: "/moderator/accounts",
        }, `account-review:${existing.id}:${now.getTime()}`);
        return { message: "Повторная заявка отправлена на проверку." };
      }

      const createdAccount = await tx.platformAccount.create({
        data: {
          userId: owner.id,
          platform: parsed.data.platform,
          url: parsed.data.url,
          status: AccountStatus.PENDING,
        },
        select: { id: true },
      });
      await enqueueModeratorNotifications(tx, {
        kind: "NEW_ACCOUNT",
        login: currentUser.login,
        platform: parsed.data.platform,
        url: "/moderator/accounts",
      }, `account-review:${createdAccount.id}`);
      return { message: "Аккаунт отправлен на проверку." };
    });

    if (result.message) revalidatePath("/accounts");
    return result;
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return { error: "Эта ссылка уже используется." };
    }
    throw error;
  }
}

export async function decidePlatformAccountAction(
  _previousState: AccountActionState,
  formData: FormData,
): Promise<AccountActionState> {
  await requireModerator();

  const input = z.object({
    accountId: z.string().min(1),
    decision: z.enum([AccountStatus.APPROVED, AccountStatus.REJECTED]),
  }).safeParse({
    accountId: formData.get("accountId"),
    decision: formData.get("decision"),
  });
  if (!input.success) return { error: "Некорректное решение." };

  const result = await prisma.$transaction(async (tx) => {
    const account = await tx.platformAccount.findUnique({
      where: { id: input.data.accountId },
      select: { id: true, userId: true, platform: true, status: true },
    });
    if (!account || account.status !== AccountStatus.PENDING) return false;
    const updated = await tx.platformAccount.updateMany({
      where: { id: account.id, status: AccountStatus.PENDING },
      data: {
        status: input.data.decision,
        ...(input.data.decision === AccountStatus.APPROVED ? { approvedAt: new Date() } : {}),
      },
    });
    if (updated.count === 0) return false;
    const kind = input.data.decision === AccountStatus.APPROVED ? "ACCOUNT_APPROVED" : "ACCOUNT_REJECTED";
    await enqueueUserNotification(tx, account.userId, {
      kind,
      platform: account.platform,
      url: "/accounts",
    }, `account-decision:${account.id}:${input.data.decision}`);
    return true;
  });
  if (!result) return { error: "Аккаунт уже обработан." };

  revalidatePath("/moderator/accounts");
  revalidatePath("/accounts");
  return { message: "Решение сохранено." };
}
