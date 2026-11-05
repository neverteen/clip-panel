"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Button, Card, Textarea } from "@/components/ui";
import { sendMessageAction, type SendMessageState } from "@/app/submissions/[id]/actions";

type ChatMessage = NonNullable<SendMessageState["message"]>;
type ChatEvent = { id: string; kind: string; createdAt: string; text: string };
type PollResponse = { messages: ChatMessage[]; events: ChatEvent[]; error?: string };

const initialState: SendMessageState = {};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Europe/Moscow",
  }).format(new Date(value));
}

export function SubmissionChat({
  submissionId,
  viewerId,
  initialMessages,
  initialEvents,
}: {
  submissionId: string;
  viewerId: string;
  initialMessages: ChatMessage[];
  initialEvents: ChatEvent[];
}) {
  const [messages, setMessages] = useState(initialMessages);
  const messagesRef = useRef(messages);
  const [events, setEvents] = useState(initialEvents);
  const [pollError, setPollError] = useState("");
  const [state, action, pending] = useActionState(sendMessageAction, initialState);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    const poll = async () => {
      if (document.visibilityState !== "visible") return;
      const latest = messagesRef.current.at(-1);
      const after = latest ? `${latest.createdAt}|${latest.id}` : null;
      const query = after ? `?after=${encodeURIComponent(after)}` : "";
      try {
        const response = await fetch(`/api/submissions/${encodeURIComponent(submissionId)}/messages${query}`, {
          cache: "no-store",
          headers: { Accept: "application/json" },
        });
        if (!response.ok) throw new Error("Не удалось обновить чат.");
        const data = await response.json() as PollResponse;
        if (data.messages.length) {
          setMessages((current) => {
            const byId = new Map(current.map((message) => [message.id, message]));
            data.messages.forEach((message) => byId.set(message.id, message));
            const merged = [...byId.values()].sort((a, b) =>
              a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
            );
            messagesRef.current = merged;
            return merged;
          });
        }
        setEvents(data.events);
        setPollError("");
      } catch {
        setPollError("Не удалось обновить чат. Повторная попытка через 5 секунд.");
      }
    };

    const timer = window.setInterval(poll, 5000);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void poll();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [submissionId]);

  useEffect(() => {
    if (!state.message) return;
    setMessages((current) => {
      if (current.some((message) => message.id === state.message?.id)) return current;
      const next = [...current, state.message!].sort((a, b) =>
        a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
      );
      messagesRef.current = next;
      return next;
    });
    if (textareaRef.current) textareaRef.current.value = "";
  }, [state.message]);

  const items = [
    ...events.map((event) => ({ ...event, system: true as const })),
    ...messages.map((message) => ({
      ...message,
      system: false as const,
      kind: "message",
    })),
  ].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));

  return (
    <Card className="space-y-4">
      <h2 className="text-xl font-semibold">Чат заявки</h2>
      <ol aria-live="polite" className="max-h-[32rem] space-y-3 overflow-y-auto">
        {items.map((item) => (
          <li
            className={item.system
              ? "rounded-md bg-surface-2 p-3 text-sm text-muted"
              : "rounded-md border border-[var(--border)] p-3"}
            key={item.system ? item.id : item.id}
          >
            {item.system ? (
              <>
                <p className="whitespace-pre-wrap break-words">{item.text}</p>
                <time className="mt-1 block text-xs">{formatDate(item.createdAt)} МСК</time>
              </>
            ) : (
              <>
                <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                  <span className="font-medium">{item.authorId === viewerId ? "Вы" : item.author.login}</span>
                  <time className="text-xs text-[var(--muted-foreground)]">{formatDate(item.createdAt)} МСК</time>
                </div>
                <p className="mt-2 whitespace-pre-wrap break-words">{item.text}</p>
              </>
            )}
          </li>
        ))}
        {items.length === 0 && <li className="text-sm text-[var(--muted-foreground)]">Сообщений пока нет.</li>}
      </ol>
      {pollError && <p className="text-sm text-danger" role="status">{pollError}</p>}
      <form action={action} className="space-y-2">
        <input name="submissionId" type="hidden" value={submissionId} />
        <label className="block space-y-1 text-sm">
          <span>Сообщение</span>
          <Textarea
            className="min-h-24"
            maxLength={2000}
            name="text"
            placeholder="Напишите сообщение…"
            ref={textareaRef}
            required
          />
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <Button disabled={pending} type="submit">{pending ? "Отправка…" : "Отправить"}</Button>
          <span className="text-sm text-danger" role="alert">{state.error}</span>
        </div>
      </form>
    </Card>
  );
}
