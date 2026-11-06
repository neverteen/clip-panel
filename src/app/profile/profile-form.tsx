"use client";

import { useActionState, useState, useTransition } from "react";
import { Button, Card, Input, PageHeader } from "@/components/ui";
import {
  createTelegramLinkAction,
  setTelegramNotificationsAction,
  unlinkTelegramAction,
  updatePayoutProfileAction,
  changePasswordAction,
  type ProfileActionState,
} from "./actions";

const initialState: ProfileActionState = {};

export function ProfileForm({
  showPayoutDetails,
  wallet,
  steamTradeUrl,
  telegramConnected,
  telegramNotificationsEnabled,
  showPasswordChange,
  passwordError,
}: {
  showPayoutDetails: boolean;
  wallet: string;
  steamTradeUrl: string;
  telegramConnected: boolean;
  telegramNotificationsEnabled: boolean;
  showPasswordChange: boolean;
  passwordError?: string;
}) {
  const [state, action, pending] = useActionState(updatePayoutProfileAction, initialState);
  const [telegramLink, setTelegramLink] = useState<string | null>(null);
  const [telegramError, setTelegramError] = useState("");
  const [telegramPending, startTelegramTransition] = useTransition();

  function createLink() {
    setTelegramError("");
    startTelegramTransition(async () => {
      const result = await createTelegramLinkAction();
      setTelegramLink(result.link ?? null);
      setTelegramError(result.error ?? "");
    });
  }

  function unlink() {
    setTelegramError("");
    startTelegramTransition(async () => {
      const result = await unlinkTelegramAction();
      setTelegramLink(null);
      setTelegramError(result.error ?? result.message ?? "");
    });
  }

  async function saveTelegramNotifications(formData: FormData) {
    await setTelegramNotificationsAction(formData);
  }

  return (
    <Card className="space-y-5">
      <PageHeader title="Профиль" description={showPayoutDetails ? "Настройки Telegram и реквизиты для вывода." : "Настройки Telegram."} />
      {showPayoutDetails && (
        <>
          <p className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
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
        </>
      )}
      {showPasswordChange && <section className="space-y-3 border-t border-[var(--border)] pt-5">
        <h2 className="font-semibold">Сменить пароль</h2>
        {passwordError && <p className="text-sm text-danger" role="alert">{passwordError}</p>}
        <form action={changePasswordAction} className="space-y-3">
          <label className="block space-y-1 text-sm"><span>Текущий пароль</span><Input autoComplete="current-password" name="currentPassword" required type="password" /></label>
          <label className="block space-y-1 text-sm"><span>Новый пароль</span><Input autoComplete="new-password" maxLength={72} minLength={8} name="newPassword" required type="password" /></label>
          <label className="block space-y-1 text-sm"><span>Повторите новый пароль</span><Input autoComplete="new-password" maxLength={72} minLength={8} name="confirmPassword" required type="password" /></label>
          <Button type="submit">Изменить пароль</Button>
        </form>
      </section>}
      <section className="space-y-3 border-t border-[var(--border)] pt-5">
        <h2 className="font-semibold">Telegram</h2>
        <p className="text-sm text-[var(--muted-foreground)]">
          {telegramConnected ? "Аккаунт привязан." : "Аккаунт не привязан."}
        </p>
        {telegramConnected ? (
          <Button disabled={telegramPending} onClick={unlink} type="button">Отвязать Telegram</Button>
        ) : (
          <Button disabled={telegramPending} onClick={createLink} type="button">
            {telegramPending ? "Создание ссылки…" : "Привязать Telegram"}
          </Button>
        )}
        {telegramLink && (
          <p className="break-all text-sm">
            Ссылка действует 10 минут: <a className="underline" href={telegramLink} rel="noopener noreferrer" target="_blank">Открыть Telegram</a>
          </p>
        )}
        {telegramError && <p className="text-sm" role="status">{telegramError}</p>}
        <form action={saveTelegramNotifications}>
          <input name="enabled" type="hidden" value="false" />
          <label className="flex items-center gap-2 text-sm">
            <input defaultChecked={telegramNotificationsEnabled} name="enabled" type="checkbox" value="true" />
            Получать уведомления
          </label>
          <Button className="mt-2" type="submit">Сохранить настройку уведомлений</Button>
        </form>
      </section>
    </Card>
  );
}
