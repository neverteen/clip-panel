"use client";

import { useActionState } from "react";
import { decidePlatformAccountAction, type AccountActionState } from "@/app/accounts/actions";

const initialState: AccountActionState = {};

export function AccountDecisionForm({ accountId }: { accountId: string }) {
  const [state, action, pending] = useActionState(decidePlatformAccountAction, initialState);

  return (
    <form action={action} className="space-y-2">
      <input name="accountId" type="hidden" value={accountId} />
      <div className="flex flex-wrap gap-2">
        <button
          className="rounded-md bg-green-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
          disabled={pending}
          name="decision"
          type="submit"
          value="APPROVED"
        >
          Одобрить
        </button>
        <button
          className="rounded-md bg-red-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
          disabled={pending}
          name="decision"
          type="submit"
          value="REJECTED"
        >
          Отклонить
        </button>
      </div>
      {(state.error || state.message) && (
        <p className="text-sm text-zinc-600" role={state.error ? "alert" : "status"}>
          {state.error ?? state.message}
        </p>
      )}
    </form>
  );
}
