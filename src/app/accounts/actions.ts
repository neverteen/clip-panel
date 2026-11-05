"use server";

import { AccountStatus, Platform, Prisma, Role } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireClipper, requireModerator } from "@/lib/auth-guards";
import { getAccountWindow, getAccountWindowNow, isAccountWindowOpen } from "@/lib/account-window";
import { prisma } from "@/lib/prisma";

const PLATFORM_HOSTS = {
  TIKTOK: "tiktok.com",
  YOUTUBE: "youtube.com",
  INSTAGRAM: "instagram.com",
} as const;

type NormalizedUrl = { url: string } | { error: string };

function normalizeProfileUrl(platform: Platform, input: string): NormalizedUrl {
  let url: URL;
  try {
    const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(input)
      ? input
      : `https://${input}`;
    url = new URL(candidate);
  } catch {
    return { error: "Введите корректную ссылку на профиль или канал." };
  }

  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    url.username ||
    url.password ||
    (url.port !== "" && url.port !== "80" && url.port !== "443")
  ) {
    return { error: "Ссылка должна вести на официальный профиль или канал." };
  }

  const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  const expectedHost = PLATFORM_HOSTS[platform];
  if (hostname !== expectedHost) {
    if (platform === Platform.YOUTUBE && hostname === "youtu.be") {
      return { error: "Короткие ссылки youtu.be на видео не принимаются. Укажите ссылку на канал." };
    }
    if (platform === Platform.TIKTOK && hostname.endsWith(".tiktok.com")) {
      return { error: "Сокращённые ссылки TikTok не принимаются. Укажите tiktok.com/@имя." };
    }
    return {
      error: `Для ${platform === Platform.TIKTOK ? "TikTok" : platform === Platform.YOUTUBE ? "YouTube" : "Instagram"} укажите ссылку с домена ${expectedHost}.`,
    };
  }

  const path = url.pathname.replace(/\/+$/, "") || "/";
  if (platform === Platform.TIKTOK) {
    if (!/^\/@[a-z\d._]+$/i.test(path)) {
      return { error: "Нужна ссылка на профиль TikTok вида tiktok.com/@имя. Ссылки на видео не принимаются." };
    }
    url.pathname = path.toLowerCase();
  } else if (platform === Platform.YOUTUBE) {
    if (/^\/(watch|shorts|embed|live|playlist|v)(\/|$)/i.test(path)) {
      return { error: "Нужна ссылка на канал YouTube вида youtube.com/@имя или /channel/ID, не на видео." };
    }
    if (!/^\/@[a-z\d._-]+$/i.test(path) && !/^\/channel\/[a-z\d_-]+$/i.test(path)) {
      return { error: "Укажите канал YouTube в формате youtube.com/@имя или youtube.com/channel/ID." };
    }
    if (path.startsWith("/@")) url.pathname = path.toLowerCase();
    else url.pathname = path;
  } else {
    const username = path.slice(1);
    const reservedPaths = new Set([
      "about", "accounts", "direct", "explore", "p", "reel", "reels", "stories",
    ]);
    if (
      !/^\/[a-z\d._]+$/i.test(path) ||
      reservedPaths.has(username.toLowerCase())
    ) {
      return { error: "Нужна ссылка на профиль Instagram вида instagram.com/имя, не на публикацию или reel." };
    }
    url.pathname = path.toLowerCase();
  }

  url.protocol = "https:";
  url.hostname = hostname;
  url.port = "";
  url.search = "";
  url.hash = "";
  return { url: url.toString().replace(/\/$/, "") };
}

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
        select: { isActive: true, role: true },
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
          platform: parsed.data.platform,
          status: { in: [AccountStatus.PENDING, AccountStatus.APPROVED] },
        },
      });
      if (used >= 3) {
        return { error: "Достигнут лимит: максимум 3 аккаунта на платформу." };
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
        return { message: "Повторная заявка отправлена на проверку." };
      }

      await tx.platformAccount.create({
        data: {
          userId: owner.id,
          platform: parsed.data.platform,
          url: parsed.data.url,
          status: AccountStatus.PENDING,
        },
        select: { id: true },
      });
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

  const updated = await prisma.platformAccount.updateMany({
    where: { id: input.data.accountId, status: AccountStatus.PENDING },
    data: { status: input.data.decision },
  });
  if (updated.count === 0) return { error: "Аккаунт уже обработан." };

  revalidatePath("/moderator/accounts");
  revalidatePath("/accounts");
  return { message: "Решение сохранено." };
}
