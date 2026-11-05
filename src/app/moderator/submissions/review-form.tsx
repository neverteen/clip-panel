"use client";

import { useActionState } from "react";
import { reviewSubmissionAction, type ReviewActionState } from "./actions";

const initialState: ReviewActionState = {};

export function ReviewForm({
  submissionId,
  publishedAt,
  isUserActive,
}: {
  submissionId: string;
  publishedAt: string;
  isUserActive: boolean;
}) {
  const [state, action, pending] = useActionState(reviewSubmissionAction, initialState);

  return (
    <form action={action} className="min-w-72 space-y-3">
      <input name="submissionId" type="hidden" value={submissionId} />
      {!isUserActive && (
        <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
          <p>Пользователь отключён. Для решения нужно явное подтверждение.</p>
          <label className="flex items-start gap-2">
            <input className="mt-1" name="confirmInactive" type="checkbox" value="true" />
            <span>Подтверждаю решение по заявке отключённого пользователя</span>
          </label>
        </div>
      )}
      <label className="block space-y-1 text-sm">
        <span>Проверенные просмотры</span>
        <input
          className="w-full rounded-md border border-zinc-300 px-2 py-1"
          inputMode="numeric"
          max="1000000000"
          min="0"
          name="views"
          type="number"
        />
      </label>
      <label className="block space-y-1 text-sm">
        <span>Дата и время публикации (МСК)</span>
        <input
          className="w-full rounded-md border border-zinc-300 px-2 py-1"
          defaultValue={publishedAt}
          name="publishedAt"
          type="datetime-local"
        />
      </label>
      <label className="block space-y-1 text-sm">
        <span>Причина отклонения (обязательна при отклонении)</span>
        <textarea
          className="min-h-20 w-full rounded-md border border-zinc-300 px-2 py-1"
          maxLength={500}
          name="rejectReason"
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <button
          className="rounded-md bg-green-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
          disabled={pending}
          name="decision"
          type="submit"
          value="APPROVE"
        >
          Одобрить
        </button>
        <button
          className="rounded-md bg-red-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
          disabled={pending}
          name="decision"
          type="submit"
          value="REJECT"
        >
          Отклонить
        </button>
      </div>
      {(state.error || state.message) && (
        <p className="text-sm text-zinc-700" role={state.error ? "alert" : "status"}>
          {state.error ?? state.message}
        </p>
      )}
    </form>
  );
}
