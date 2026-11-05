"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui";
import { requestPayoutAction, type PayoutRequestState } from "./actions";

const initialState: PayoutRequestState = {};

export function PayoutRequestForm({
  hasCrypto,
  hasSkins,
}: {
  hasCrypto: boolean;
  hasSkins: boolean;
}) {
  const [state, action, pending] = useActionState(requestPayoutAction, initialState);
  const hasAny = hasCrypto || hasSkins;
  return (
    <form action={action} className="space-y-3">
      {hasAny ? (
        <label className="block max-w-sm space-y-1 text-sm">
          <span>Способ вывода</span>
          <select className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2" name="method">
            {hasCrypto && <option value="CRYPTO">Криптовалюта</option>}
            {hasSkins && <option value="SKINS">Скины CS</option>}
          </select>
        </label>
      ) : (
        <p className="text-sm">Сначала добавьте реквизиты в <a className="text-blue-700 underline" href="/profile">профиле</a>.</p>
      )}
      <p className="text-sm text-[var(--muted-foreground)]">Будет запрошен весь доступный баланс. Реквизиты берутся из профиля и сохраняются в заявке.</p>
      <Button disabled={pending || !hasAny} type="submit">{pending ? "Создание…" : "Запросить вывод"}</Button>
      {(state.error || state.message) && <p className="text-sm" role={state.error ? "alert" : "status"}>{state.error ?? state.message}</p>}
    </form>
  );
}
