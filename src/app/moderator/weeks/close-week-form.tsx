"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui";
import { closeWeekAction, type CloseWeekState } from "./actions";

const initialState: CloseWeekState = {};

export function CloseWeekForm({ weekStart }: { weekStart: string }) {
  const [state, action, pending] = useActionState(closeWeekAction, initialState);
  return (
    <form
      action={action}
      className="space-y-2"
      onSubmit={(event) => {
        if (!window.confirm("Закрыть неделю? Результаты и записи журнала будут зафиксированы.")) {
          event.preventDefault();
        }
      }}
    >
      <input name="weekStart" type="hidden" value={weekStart} />
      <Button disabled={pending} type="submit">{pending ? "Закрытие…" : "Закрыть неделю"}</Button>
      {(state.error || state.message) && (
        <p className="text-sm" role={state.error ? "alert" : "status"}>{state.error ?? state.message}</p>
      )}
    </form>
  );
}
