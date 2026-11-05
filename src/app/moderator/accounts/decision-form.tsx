"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui";
import { decidePlatformAccountAction, type AccountActionState } from "@/app/accounts/actions";

const initialState: AccountActionState = {};

export function AccountDecisionForm({ accountId }: { accountId: string }) {
  const [state, action, pending] = useActionState(decidePlatformAccountAction, initialState);

  return (
    <form action={action} className="space-y-2">
      <input name="accountId" type="hidden" value={accountId} />
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={pending}
          name="decision"
          type="submit"
          value="APPROVED"
        >
          Одобрить
        </Button>
        <Button
          size="sm"
          variant="danger"
          disabled={pending}
          name="decision"
          type="submit"
          value="REJECTED"
        >
          Отклонить
        </Button>
      </div>
      {(state.error || state.message) && (
        <p className="text-sm text-muted" role={state.error ? "alert" : "status"}>
          {state.error ?? state.message}
        </p>
      )}
    </form>
  );
}
