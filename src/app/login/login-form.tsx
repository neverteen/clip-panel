"use client";

import Link from "next/link";
import { useActionState } from "react";
import { loginAction, type LoginState } from "./actions";

const initialState: LoginState = {};

export function LoginForm() {
  const [state, action, pending] = useActionState(loginAction, initialState);

  return (
    <form action={action} className="mt-6 space-y-4">
      <label className="block space-y-1 text-sm">
        <span>Электронная почта</span>
        <input
          autoComplete="email"
          className="w-full rounded-md border border-zinc-300 px-3 py-2"
          name="email"
          required
          type="email"
        />
      </label>
      <label className="block space-y-1 text-sm">
        <span>Пароль</span>
        <input
          autoComplete="current-password"
          className="w-full rounded-md border border-zinc-300 px-3 py-2"
          minLength={8}
          name="password"
          required
          type="password"
        />
      </label>
      {state.error && <p className="text-sm text-red-700" role="alert">{state.error}</p>}
      <button
        className="w-full rounded-md bg-zinc-900 px-4 py-2 font-medium text-white disabled:opacity-60"
        disabled={pending}
        type="submit"
      >
        {pending ? "Входим…" : "Войти"}
      </button>
      <p className="text-sm text-zinc-600">
        Нет аккаунта? <Link className="underline" href="/register">Зарегистрироваться</Link>
      </p>
    </form>
  );
}
