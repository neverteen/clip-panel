"use client";

import { useActionState } from "react";
import { Button, Input } from "@/components/ui";
import { loginAction, type LoginState } from "./actions";

const initialState: LoginState = {};

export function LoginForm({ callbackUrl }: { callbackUrl: string }) {
  const [state, action, pending] = useActionState(loginAction, initialState);

  return (
    <form action={action} className="mt-6 space-y-4">
      <input type="hidden" name="callbackUrl" value={callbackUrl} />
      <label className="block space-y-1 text-sm">
        <span>Логин</span>
        <Input
          autoComplete="username"
          name="login"
          required
          type="text"
        />
      </label>
      <label className="block space-y-1 text-sm">
        <span>Пароль</span>
        <Input
          autoComplete="current-password"
          minLength={8}
          maxLength={72}
          name="password"
          required
          type="password"
        />
      </label>
      {state.error && <p className="text-sm text-danger" role="alert">{state.error}</p>}
      <Button className="w-full" disabled={pending} loading={pending} type="submit">Войти</Button>
      <p className="text-sm text-muted">
        Обратитесь к модератору, чтобы получить аккаунт.
      </p>
    </form>
  );
}
