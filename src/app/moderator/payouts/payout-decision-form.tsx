"use client";

import { useActionState } from "react";
import { Button, Input, Textarea } from "@/components/ui";
import { processPayoutAction, type PayoutDecisionState } from "./actions";

const initialState: PayoutDecisionState = {};

export function PayoutDecisionForm({ payoutId, userIsActive }: { payoutId: string; userIsActive: boolean }) {
  const [state, action, pending] = useActionState(processPayoutAction, initialState);
  return (
    <form action={action} className="space-y-3">
      <input name="payoutId" type="hidden" value={payoutId} />
      {!userIsActive && (
        <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
          <p>Пользователь отключён. Для обработки требуется явное подтверждение.</p>
          <label className="flex items-start gap-2">
            <input className="mt-1" name="confirmInactive" type="checkbox" value="true" />
            <span>Подтверждаю действие по заявке отключённого пользователя</span>
          </label>
        </div>
      )}
      <label className="block space-y-1 text-sm">
        <span>Подтверждение выплаты: хеш транзакции или заметка о передаче скинов</span>
        <Input autoComplete="off" maxLength={200} minLength={3} name="txRef" />
      </label>
      <label className="block space-y-1 text-sm">
        <span>Причина отклонения</span>
        <Textarea maxLength={500} minLength={3} name="rejectReason" />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button disabled={pending} name="decision" type="submit" value="PAID">Оплачено</Button>
        <button className="rounded-md bg-red-700 px-4 py-2 font-medium text-white disabled:opacity-50" disabled={pending} name="decision" type="submit" value="REJECTED">Отклонить</button>
      </div>
      {(state.error || state.message) && <p className="text-sm" role={state.error ? "alert" : "status"}>{state.error ?? state.message}</p>}
    </form>
  );
}
