"use client";

import { useActionState } from "react";
import { Button, Select } from "@/components/ui";
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
          <Select name="method">
            {hasCrypto && <option value="CRYPTO">Криптовалюта</option>}
            {hasSkins && <option value="SKINS">Скины CS</option>}
          </Select>
        </label>
      ) : (
        <p className="text-sm">Сначала добавьте реквизиты в <a className="text-accent-2 underline-offset-4 hover:underline underline" href="/profile">профиле</a>.</p>
      )}
      <p className="text-sm text-[var(--muted-foreground)]">Будет запрошен весь доступный баланс. Реквизиты берутся из профиля и сохраняются в заявке.</p>
      <Button disabled={pending || !hasAny} loading={pending} type="submit">Запросить вывод</Button>
      {(state.error || state.message) && <p className="text-sm" role={state.error ? "alert" : "status"}>{state.error ?? state.message}</p>}
    </form>
  );
}
