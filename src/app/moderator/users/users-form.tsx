"use client";

import { useActionState, useEffect, useRef } from "react";
import { Button, Input, Textarea } from "@/components/ui";
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
        <Textarea
          autoComplete="off"
          className="min-h-40 font-mono"
          name="users"
          ref={inputRef}
          spellCheck={false}
        />
      </label>
      {state.message && <p className="text-sm text-muted" role="status">{state.message}</p>}
      <Button disabled={pending} loading={pending} type="submit">Создать пользователей</Button>
      {state.results.length > 0 && <BatchReport results={state.results} />}
    </form>
  );
}

function BatchReport({ results }: { results: BatchState["results"] }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <table className="responsive-table w-full text-left text-sm">
        <thead className="bg-surface-2">
          <tr>
            <th className="px-3 py-2">Строка</th>
            <th className="px-3 py-2">Логин</th>
            <th className="px-3 py-2">Результат</th>
            <th className="px-3 py-2">Причина</th>
          </tr>
        </thead>
        <tbody>
          {results.map((result, index) => (
            <tr className="border-t border-border" key={`${result.line}-${index}`}>
              <td className="px-3 py-2" data-label="Строка">{result.line}</td>
              <td className="px-3 py-2" data-label="Логин">{result.login ?? "—"}</td>
              <td className="px-3 py-2" data-label="Результат">
                {result.status === "created" ? "Создано" : "Ошибка"}
              </td>
              <td className="px-3 py-2" data-label="Причина">{result.reason ?? "—"}</td>
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
        <Input
          autoComplete="new-password"
          className="min-w-0 flex-1"
          maxLength={72}
          minLength={8}
          name="password"
          placeholder="Новый пароль"
          ref={passwordRef}
          required
          type="password"
        />
        <Button
          variant="secondary"
          size="sm"
          disabled={resetPending}
          type="submit"
        >
          Сбросить пароль
        </Button>
      </form>
      {(resetState.message || resetState.error) && (
        <p className="text-sm text-muted" role={resetState.error ? "alert" : "status"}>
          {resetState.error ?? resetState.message}
        </p>
      )}
      {isActive && (
        <form action={deactivateFormAction}>
          <Button
            variant="danger"
            size="sm"
            disabled={deactivatePending}
            type="submit"
          >
            Отключить
          </Button>
        </form>
      )}
      {(deactivateState.message || deactivateState.error) && (
        <p className="text-sm text-muted" role={deactivateState.error ? "alert" : "status"}>
          {deactivateState.error ?? deactivateState.message}
        </p>
      )}
    </div>
  );
}
