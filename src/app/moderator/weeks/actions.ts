"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireModerator } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { closeWeekInTransaction } from "@/lib/week-closure";
import { getWindow } from "@/lib/week";

export type CloseWeekState = { error?: string; message?: string };

const inputSchema = z.object({ weekStart: z.string().datetime({ offset: true }) });

function isWeekStart(value: Date) {
  return getWindow(value).start.getTime() === value.getTime();
}

export async function closeWeekAction(
  _previousState: CloseWeekState,
  formData: FormData,
): Promise<CloseWeekState> {
  const moderator = await requireModerator();
  const parsed = inputSchema.safeParse({ weekStart: formData.get("weekStart") });
  if (!parsed.success) return { error: "Выберите корректную неделю." };
  const weekStart = new Date(parsed.data.weekStart);
  if (!isWeekStart(weekStart)) return { error: "Начало недели указано некорректно." };

  try {
    const result = await prisma.$transaction((tx) => closeWeekInTransaction(tx, {
      weekStart,
      moderatorId: moderator.id,
    }));

    if (result.message) {
      revalidatePath("/moderator/weeks");
      revalidatePath("/balance");
      revalidatePath("/moderator/submissions");
      revalidatePath("/submissions");
    }
    return result;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { error: "Неделя уже закрыта." };
    }
    throw error;
  }
}
