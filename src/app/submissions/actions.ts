"use server";

import { AccountStatus, Platform, Role, Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { MAX_SUBMISSIONS_PER_WEEK } from "@/lib/config";
import { requireClipper } from "@/lib/auth-guards";
import { getNow } from "@/lib/now";
import { prisma } from "@/lib/prisma";
import { getWindow, moscowDateTimeToUtc } from "@/lib/week";
import { normalizeVideoUrl } from "@/lib/video-url";
import { enqueueModeratorNotifications } from "@/lib/telegram-notifications";

const submissionInputSchema = z.object({
  accountId: z.string().min(1, "Выберите аккаунт."),
  videoUrl: z.string().trim().min(1, "Введите ссылку на ролик.").max(2048, "Ссылка слишком длинная."),
  publishedAt: z.string().min(1, "Укажите дату и время публикации."),
});

export type SubmissionActionState = {
  error?: string;
  message?: string;
};

function submissionWindowError(now: Date) {
  const window = getWindow(now);
  if (now.getTime() < window.start.getTime()) {
    const opening = new Intl.DateTimeFormat("ru-RU", {
      dateStyle: "full",
      timeStyle: "short",
      timeZone: "Europe/Moscow",
    }).format(window.start);
    return `Окно подачи ещё не открыто. Оно откроется ${opening} МСК.`;
  }
  return "Окно подачи закрыто. Заявки принимаются с понедельника 01:00 до воскресенья 22:00 МСК.";
}

export async function createSubmissionAction(
  _previousState: SubmissionActionState,
  formData: FormData,
): Promise<SubmissionActionState> {
  const owner = await requireClipper();
  const parsed = submissionInputSchema.safeParse({
    accountId: formData.get("accountId"),
    videoUrl: formData.get("videoUrl"),
    publishedAt: formData.get("publishedAt"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Проверьте поля заявки." };
  }

  const publishedAt = moscowDateTimeToUtc(parsed.data.publishedAt);
  if (!publishedAt) {
    return { error: "Введите корректные дату и время публикации по МСК." };
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

      const now = getNow();
      const window = getWindow(now);
      if (!window.isOpen) return { error: submissionWindowError(now) };
      if (publishedAt.getTime() > now.getTime()) {
        return { error: "Дата публикации не может быть в будущем." };
      }
      if (
        publishedAt.getTime() < window.start.getTime() ||
        publishedAt.getTime() >= window.end.getTime()
      ) {
        return { error: "Ролик должен быть опубликован внутри текущего окна подачи по МСК." };
      }

      const account = await tx.platformAccount.findUnique({
        where: { id: parsed.data.accountId },
        select: { id: true, userId: true, platform: true, status: true, url: true },
      });
      if (!account || account.userId !== owner.id) {
        return { error: "Выберите свой аккаунт платформы." };
      }
      if (account.status !== AccountStatus.APPROVED) {
        return { error: "Подавать ролики можно только с одобренного аккаунта." };
      }

      const normalized = normalizeVideoUrl(account.platform, parsed.data.videoUrl);
      if ("error" in normalized) return { error: normalized.error };

      if (account.platform === Platform.TIKTOK) {
        const accountHandle = /^\/@([^/]+)\/?$/.exec(new URL(account.url).pathname)?.[1]?.toLowerCase();
        if (!accountHandle || accountHandle !== normalized.tiktokUsername) {
          return { error: "Имя пользователя в ссылке на ролик не совпадает с выбранным TikTok-аккаунтом." };
        }
      }

      const weekSubmissionCount = await tx.submission.count({
        where: { userId: owner.id, weekStart: window.start },
      });
      if (weekSubmissionCount >= MAX_SUBMISSIONS_PER_WEEK) {
        return { error: `Достигнут лимит: не более ${MAX_SUBMISSIONS_PER_WEEK} заявок за неделю.` };
      }

      const submission = await tx.submission.create({
        data: {
          userId: owner.id,
          accountId: account.id,
          videoUrl: normalized.videoUrl,
          publishedAt,
          weekStart: window.start,
          status: "PENDING",
          views: 0,
          amountCents: 0,
        },
        select: { id: true },
      });
      await enqueueModeratorNotifications(tx, {
        kind: "NEW_SUBMISSION",
        login: currentUser.login,
        url: `/moderator/submissions/${submission.id}`,
      }, `submission-created:${submission.id}`);
      return { message: "Заявка отправлена на проверку." };
    });

    if (result.message) revalidatePath("/submissions");
    return result;
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return { error: "Этот ролик уже подан." };
    }
    throw error;
  }
}
