"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireClipper } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { PayoutOperationError, updatePayoutDetails } from "@/lib/payout-operations";
import { parseSteamTradeUrl } from "@/lib/payout-profile";

export type ProfileActionState = { error?: string; message?: string };

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
