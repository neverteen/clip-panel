"use client";

import { useActionState, useEffect, useRef } from "react";
import {
  createUsersAction,
  type ActionState,
  type BatchState,
} from "./actions";
import { deactivateUserAction, resetPasswordAction } from "./actions";

export function CreateUsersForm() {
  const [state, action, pending] = useActionState(createUsersAction, { results: [] });
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (state.submitted && inputRef.current) inputRef.current.value = "";
  }, [state]);

  return (
    <form action={action} className="space-y-3">
      <label className="block space-y-1 text-sm">
        <span>По одному пользователю на строку: логин:пароль</span>
        <textarea
          autoComplete="off"
          className="min-h-40 w-full rounded-md border border-zinc-300 px-3 py-2 font-mono"
          name="users"
          ref={inputRef}
          spellCheck={false}
        />
      </label>
      {state.message && <p className="text-sm text-zinc-600" role="status">{state.message}</p>}
      <button
        className="rounded-md bg-zinc-900 px-4 py-2 font-medium text-white disabled:opacity-60"
        disabled={pending}
        type="submit"
      >
        {pending ? "Обрабатываем…" : "Создать пользователей"}
      </button>
      {state.results.length > 0 && <BatchReport results={state.results} />}
    </form>
  );
}

function BatchReport({ results }: { results: BatchState["results"] }) {
  return (
    <div className="overflow-x-auto rounded-md border border-zinc-200">
      <table className="w-full text-left text-sm">
        <thead className="bg-zinc-100">
          <tr>
            <th className="px-3 py-2">Строка</th>
            <th className="px-3 py-2">Логин</th>
            <th className="px-3 py-2">Результат</th>
            <th className="px-3 py-2">Причина</th>
          </tr>
        </thead>
        <tbody>
          {results.map((result, index) => (
            <tr className="border-t border-zinc-200" key={`${result.line}-${index}`}>
              <td className="px-3 py-2">{result.line}</td>
              <td className="px-3 py-2">{result.login ?? "—"}</td>
              <td className="px-3 py-2">
                {result.status === "created" ? "Создано" : "Ошибка"}
              </td>
              <td className="px-3 py-2">{result.reason ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function UserControls({
  userId,
  isActive,
}: {
  userId: string;
  isActive: boolean;
}) {
  const resetAction = resetPasswordAction.bind(null, userId);
  const deactivateAction = deactivateUserAction.bind(null, userId);
  const [resetState, resetFormAction, resetPending] = useActionState<ActionState, FormData>(
    resetAction,
    {},
  );
  const [deactivateState, deactivateFormAction, deactivatePending] =
    useActionState<ActionState, FormData>(deactivateAction, {});
  const passwordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if ((resetState.message || resetState.error) && passwordRef.current) {
      passwordRef.current.value = "";
    }
  }, [resetState]);

  return (
    <div className="min-w-60 space-y-2">
      <form action={resetFormAction} className="flex gap-2">
        <input
          autoComplete="new-password"
          className="min-w-0 flex-1 rounded-md border border-zinc-300 px-2 py-1"
          maxLength={72}
          minLength={8}
          name="password"
          placeholder="Новый пароль"
          ref={passwordRef}
          required
          type="password"
        />
        <button
          className="rounded-md border border-zinc-300 px-2 py-1 text-sm disabled:opacity-60"
          disabled={resetPending}
          type="submit"
        >
          Сбросить пароль
        </button>
      </form>
      {(resetState.message || resetState.error) && (
        <p className="text-sm text-zinc-600" role={resetState.error ? "alert" : "status"}>
          {resetState.error ?? resetState.message}
        </p>
      )}
      {isActive && (
        <form action={deactivateFormAction}>
          <button
            className="rounded-md border border-red-300 px-3 py-1 text-sm text-red-700 disabled:opacity-60"
            disabled={deactivatePending}
            type="submit"
          >
            Отключить
          </button>
        </form>
      )}
      {(deactivateState.message || deactivateState.error) && (
        <p className="text-sm text-zinc-600" role={deactivateState.error ? "alert" : "status"}>
          {deactivateState.error ?? deactivateState.message}
        </p>
      )}
    </div>
  );
}
