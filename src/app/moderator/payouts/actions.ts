"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireModerator } from "@/lib/auth-guards";
import { getNow } from "@/lib/now";
import { prisma } from "@/lib/prisma";
import { decidePayout, PayoutOperationError } from "@/lib/payout-operations";

export type PayoutDecisionState = { error?: string; message?: string };

const decisionSchema = z.object({
  payoutId: z.string().cuid(),
  decision: z.enum(["PAID", "REJECTED"]),
  txRef: z.string().optional(),
  rejectReason: z.string().optional(),
  confirmInactive: z.string().optional(),
});
const txRefSchema = z.string().trim().min(3, "Укажите подтверждение длиной от 3 символов.").max(200, "Подтверждение должно быть не длиннее 200 символов.");
const rejectReasonSchema = z.string().trim().min(3, "Причина должна содержать не менее 3 символов.").max(500, "Причина должна содержать не более 500 символов.");

function safeError(code: string) {
  if (code === "not_found") return "Заявка на вывод не найдена.";
  if (code === "already_processed") return "Заявка уже обработана.";
  if (code === "inactive_confirmation_required") return "Пользователь отключён. Подтвердите действие явно.";
  if (code === "negative_balance") return "Операция привела бы к отрицательному балансу и отменена.";
  return "Не удалось обработать заявку на вывод.";
}

export async function processPayoutAction(
  _previousState: PayoutDecisionState,
  formData: FormData,
): Promise<PayoutDecisionState> {
  const moderator = await requireModerator();
  const parsed = decisionSchema.safeParse({
    payoutId: formData.get("payoutId"),
    decision: formData.get("decision"),
    txRef: formData.get("txRef") ?? undefined,
    rejectReason: formData.get("rejectReason") ?? undefined,
    confirmInactive: formData.get("confirmInactive") ?? undefined,
  });
  if (!parsed.success) return { error: "Некорректные данные решения." };

  const txRef = parsed.data.decision === "PAID"
    ? txRefSchema.safeParse(parsed.data.txRef ?? "")
    : null;
  if (txRef && !txRef.success) return { error: txRef.error.issues[0]?.message ?? "Укажите подтверждение оплаты." };
  const rejectReason = parsed.data.decision === "REJECTED"
    ? rejectReasonSchema.safeParse(parsed.data.rejectReason ?? "")
    : null;
  if (rejectReason && !rejectReason.success) return { error: rejectReason.error.issues[0]?.message ?? "Укажите причину отказа." };

  try {
    await prisma.$transaction((tx) => decidePayout(tx, {
      payoutId: parsed.data.payoutId,
      moderatorId: moderator.id,
      decision: parsed.data.decision,
      txRef: txRef?.success ? txRef.data : undefined,
      rejectReason: rejectReason?.success ? rejectReason.data : undefined,
      confirmInactive: parsed.data.confirmInactive === "true",
      now: getNow(),
    }));
  } catch (error) {
    if (error instanceof PayoutOperationError) return { error: safeError(error.code) };
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { error: "Заявка уже обработана." };
    }
    throw error;
  }

  revalidatePath("/moderator/payouts");
  revalidatePath("/balance");
  return { message: parsed.data.decision === "PAID" ? "Вывод отмечен как оплаченный." : "Вывод отклонён, баланс восстановлен." };
}

export async function revealPayoutDestinationAction(payoutId: string): Promise<{ destination?: string; error?: string }> {
  await requireModerator();
  if (!z.string().cuid().safeParse(payoutId).success) return { error: "Заявка на вывод не найдена." };
  const payout = await prisma.payout.findUnique({
    where: { id: payoutId },
    select: { destination: true },
  });
  if (!payout) return { error: "Заявка на вывод не найдена." };
  return { destination: payout.destination };
}
