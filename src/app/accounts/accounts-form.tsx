"use client";

import { useActionState, useEffect, useState } from "react";
import { addPlatformAccountAction, type AccountActionState } from "./actions";

type Props = {
  checkedAt: number;
  opensAt: number;
  closesAt: number;
};

function formatMoscowDate(value: number) {
  return new Intl.DateTimeFormat("ru-RU", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Moscow",
  }).format(value);
}

function formatRemaining(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const remainingSeconds = seconds % 60;
  return `${days} дн. ${hours} ч. ${minutes} мин. ${remainingSeconds} сек.`;
}

export function AccountsForm({ checkedAt, opensAt, closesAt }: Props) {
  const [state, action, pending] = useActionState<AccountActionState, FormData>(
    addPlatformAccountAction,
    {},
  );
  const [currentTime, setCurrentTime] = useState(checkedAt);

  useEffect(() => {
    const clientStart = Date.now();
    const tick = () => setCurrentTime(checkedAt + Date.now() - clientStart);
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [checkedAt]);

  const isOpen = currentTime >= opensAt && currentTime < closesAt;
  const countdownTarget = isOpen ? closesAt : opensAt;

  return (
    <section className="space-y-4 rounded-lg border border-zinc-200 p-5">
      <h2 className="text-xl font-medium">Добавить аккаунт</h2>
      {isOpen ? (
        <p className="text-sm text-green-800" role="status">
          Окно открыто. До закрытия: {formatRemaining(countdownTarget - currentTime)}.
        </p>
      ) : (
        <p className="text-sm text-amber-900" role="status">
          Добавлять аккаунты можно только во вторник с 00:00 до 22:00 МСК. Ближайшее открытие: {formatMoscowDate(opensAt)} МСК. До открытия: {formatRemaining(countdownTarget - currentTime)}.
        </p>
      )}

      <form action={action} className="space-y-3">
        <fieldset className="space-y-3" disabled={!isOpen || pending}>
          <label className="block space-y-1 text-sm">
            <span>Платформа</span>
            <select
              className="w-full rounded-md border border-zinc-300 px-3 py-2"
              defaultValue="TIKTOK"
              name="platform"
            >
              <option value="TIKTOK">TikTok</option>
              <option value="YOUTUBE">YouTube</option>
              <option value="INSTAGRAM">Instagram</option>
            </select>
          </label>
          <label className="block space-y-1 text-sm">
            <span>Ссылка на профиль или канал</span>
            <input
              autoComplete="url"
              className="w-full rounded-md border border-zinc-300 px-3 py-2"
              maxLength={2048}
              name="url"
              placeholder="https://www.tiktok.com/@username"
              required
              type="url"
            />
          </label>
          <button
            className="rounded-md bg-zinc-900 px-4 py-2 font-medium text-white disabled:opacity-60"
            type="submit"
          >
            {pending ? "Отправляем…" : "Отправить на проверку"}
          </button>
        </fieldset>
        {state.error && <p className="text-sm text-red-700" role="alert">{state.error}</p>}
        {state.message && <p className="text-sm text-green-800" role="status">{state.message}</p>}
      </form>
    </section>
  );
}
