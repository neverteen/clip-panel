"use server";

import { PayoutMethod, Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireClipper } from "@/lib/auth-guards";
import { getNow } from "@/lib/now";
import { prisma } from "@/lib/prisma";
import { createPayoutReservation, PayoutOperationError } from "@/lib/payout-operations";

export type PayoutRequestState = { error?: string; message?: string };

const methodSchema = z.nativeEnum(PayoutMethod);

function safeError(code: string) {
  if (code === "open_request") return "У вас уже есть открытая заявка на вывод.";
  if (code === "daily_limit") return "За последние 24 часа можно создать не более 3 заявок на вывод.";
  if (code === "below_threshold") return "Доступный баланс ниже минимального порога вывода.";
  if (code === "missing_destination") return "Сначала добавьте реквизиты выбранного способа в профиле.";
  if (code === "invalid_destination") return "Реквизиты выбранного способа некорректны. Проверьте профиль.";
  if (code === "inactive_user") return "Отключённый пользователь не может создать заявку на вывод.";
  if (code === "negative_balance") return "Баланс изменился. Обновите страницу и попробуйте снова.";
  return "Не удалось создать заявку на вывод.";
}

export async function requestPayoutAction(
  _previousState: PayoutRequestState,
  formData: FormData,
): Promise<PayoutRequestState> {
  const user = await requireClipper();
  const parsedMethod = methodSchema.safeParse(formData.get("method"));
  if (!parsedMethod.success) return { error: "Выберите способ вывода." };

  try {
    await prisma.$transaction((tx) =>
      createPayoutReservation(tx, user.id, parsedMethod.data, getNow()),
    );
  } catch (error) {
    if (error instanceof PayoutOperationError) return { error: safeError(error.code) };
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { error: "У вас уже есть открытая заявка на вывод." };
    }
    throw error;
  }
  revalidatePath("/balance");
  revalidatePath("/moderator/payouts");
  return { message: "Заявка создана. Весь доступный баланс зарезервирован." };
}
