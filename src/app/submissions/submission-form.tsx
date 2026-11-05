"use client";

import { useActionState, useEffect, useState } from "react";
import { createSubmissionAction, type SubmissionActionState } from "./actions";
import { getWindow, utcToMoscowDateTimeValue, WEEK_MS } from "@/lib/week";

type AccountOption = {
  id: string;
  platform: string;
  url: string;
};

type Props = {
  accounts: AccountOption[];
  checkedAt: number;
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

function formatCountdown(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  return `${days} дн. ${hours} ч. ${minutes} мин. ${seconds % 60} сек.`;
}

export function SubmissionForm({ accounts, checkedAt }: Props) {
  const [state, action, pending] = useActionState<SubmissionActionState, FormData>(
    createSubmissionAction,
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

  const now = new Date(currentTime);
  const currentWindow = getWindow(now);
  const displayStart = currentTime >= currentWindow.end.getTime()
    ? currentWindow.start.getTime() + WEEK_MS
    : currentWindow.start.getTime();
  const displayEnd = displayStart + (currentWindow.end.getTime() - currentWindow.start.getTime());
  const isOpen = currentWindow.isOpen;
  const countdown = isOpen
    ? currentWindow.end.getTime() - currentTime
    : displayStart - currentTime;

  return (
    <section className="space-y-4 rounded-lg border border-zinc-200 p-5">
      <div>
        <h2 className="text-xl font-medium">Текущая неделя</h2>
        <p className="mt-1 text-sm text-zinc-600">
          {formatMoscowDate(displayStart)} — {formatMoscowDate(displayEnd)} МСК
        </p>
      </div>

      {isOpen ? (
        <p className="text-sm text-green-800" role="status">
          До закрытия окна (воскресенье 22:00 МСК): {formatCountdown(countdown)}.
        </p>
      ) : (
        <p className="text-sm text-amber-900" role="status">
          Окно закрыто. Оно действует с понедельника 01:00 до воскресенья 22:00 МСК. До открытия следующего окна: {formatCountdown(countdown)}.
        </p>
      )}
      <p className="text-sm text-zinc-600">
        Ролик, опубликованный вне этого окна, не засчитывается и не переносится на следующую неделю.
      </p>

      {accounts.length === 0 && (
        <p className="text-sm text-zinc-600">
          Для подачи заявки нужен собственный аккаунт платформы со статусом «Одобрен».
        </p>
      )}

      <form action={action} className="space-y-3">
        <fieldset className="space-y-3" disabled={!isOpen || accounts.length === 0 || pending}>
          <label className="block space-y-1 text-sm">
            <span>Одобренный аккаунт</span>
            <select className="w-full rounded-md border border-zinc-300 px-3 py-2" name="accountId" required>
              <option value="">Выберите аккаунт</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.platform}: {account.url}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1 text-sm">
            <span>Ссылка на ролик</span>
            <input
              autoComplete="url"
              className="w-full rounded-md border border-zinc-300 px-3 py-2"
              maxLength={2048}
              name="videoUrl"
              placeholder="Ссылка на видео, Short или Reel"
              required
              type="url"
            />
          </label>
          <label className="block space-y-1 text-sm">
            <span>Дата и время публикации (МСК)</span>
            <input
              className="w-full rounded-md border border-zinc-300 px-3 py-2"
              defaultValue={utcToMoscowDateTimeValue(new Date(checkedAt))}
              name="publishedAt"
              required
              type="datetime-local"
            />
          </label>
          <button
            className="rounded-md bg-zinc-900 px-4 py-2 font-medium text-white disabled:opacity-60"
            type="submit"
          >
            {pending ? "Отправляем…" : "Подать заявку"}
          </button>
        </fieldset>
        {state.error && <p className="text-sm text-red-700" role="alert">{state.error}</p>}
        {state.message && <p className="text-sm text-green-800" role="status">{state.message}</p>}
      </form>
    </section>
  );
}
