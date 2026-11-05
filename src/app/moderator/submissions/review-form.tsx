"use client";

import { useActionState } from "react";
import { Button, Input, Textarea } from "@/components/ui";
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
        <div className="space-y-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
          <p>Пользователь отключён. Для решения нужно явное подтверждение.</p>
          <label className="flex items-start gap-2">
            <input className="mt-1" name="confirmInactive" type="checkbox" value="true" />
            <span>Подтверждаю решение по заявке отключённого пользователя</span>
          </label>
        </div>
      )}
      <label className="block space-y-1 text-sm">
        <span>Проверенные просмотры</span>
        <Input
          inputMode="numeric"
          max="1000000000"
          min="0"
          name="views"
          type="number"
        />
      </label>
      <label className="block space-y-1 text-sm">
        <span>Дата и время публикации (МСК)</span>
        <Input
          defaultValue={publishedAt}
          name="publishedAt"
          type="datetime-local"
        />
      </label>
      <label className="block space-y-1 text-sm">
        <span>Причина отклонения (обязательна при отклонении)</span>
        <Textarea
          className="min-h-20"
          maxLength={500}
          name="rejectReason"
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={pending}
          name="decision"
          type="submit"
          value="APPROVE"
        >
          Одобрить
        </Button>
        <Button
          size="sm"
          variant="danger"
          disabled={pending}
          name="decision"
          type="submit"
          value="REJECT"
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
