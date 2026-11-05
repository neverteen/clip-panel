"use client";

import { useActionState } from "react";
import { Button, Card, Input, PageHeader } from "@/components/ui";
import { updatePayoutProfileAction, type ProfileActionState } from "./actions";

const initialState: ProfileActionState = {};

export function ProfileForm({ wallet, steamTradeUrl }: { wallet: string; steamTradeUrl: string }) {
  const [state, action, pending] = useActionState(updatePayoutProfileAction, initialState);
  return (
    <Card className="space-y-5">
      <PageHeader title="Профиль и реквизиты" description="Реквизиты используются как снимок при создании заявки на вывод." />
      <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
        Проверьте реквизиты, выплата необратима.
      </p>
      <form action={action} className="space-y-4">
        <label className="block space-y-1 text-sm">
          <span>Криптокошелёк (сеть и адрес одной строкой)</span>
          <Input autoComplete="off" defaultValue={wallet} maxLength={200} name="wallet" />
        </label>
        <label className="block space-y-1 text-sm">
          <span>Steam Trade Offer URL</span>
          <Input autoComplete="off" defaultValue={steamTradeUrl} maxLength={200} name="steamTradeUrl" />
        </label>
        <p className="text-sm text-[var(--muted-foreground)]">Ссылка должна иметь вид https://steamcommunity.com/tradeoffer/new/?partner=...&amp;token=...</p>
        <Button disabled={pending} type="submit">{pending ? "Сохранение…" : "Сохранить реквизиты"}</Button>
        {(state.error || state.message) && <p className="text-sm" role={state.error ? "alert" : "status"}>{state.error ?? state.message}</p>}
      </form>
    </Card>
  );
}
