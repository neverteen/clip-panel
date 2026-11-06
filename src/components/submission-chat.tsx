"use client";
/* eslint @next/next/no-img-element: off -- private attachment routes must not use the image optimizer */

import { useCallback, useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from "react";
import { Button, Card, Textarea } from "@/components/ui";
import { shouldSubmitChatOnEnter } from "@/lib/chat-input-rules";
import { ATTACHMENT_MAX_FILES_PER_MESSAGE, ATTACHMENT_MAX_INPUT_BYTES } from "@/lib/config";

type Attachment = { id: string; mime: string; sizeBytes: number; width: number; height: number; createdAt: string };
type ChatMessage = { id: string; text: string; createdAt: string; authorId: string; author: { login: string }; attachments: Attachment[] };
type ChatEvent = { id: string; kind: string; createdAt: string; text: string };
type PollResponse = { messages: ChatMessage[]; events: ChatEvent[]; error?: string };
type LocalFile = { key: string; file: File; preview: string; error?: string };

const ACCEPTED = new Set(["image/jpeg", "image/png", "image/webp"]);
const maxInputMegabytes = ATTACHMENT_MAX_INPUT_BYTES / 1024 / 1024;

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Europe/Moscow",
  }).format(new Date(value));
}

function validateClientFile(file: File) {
  if (!ACCEPTED.has(file.type)) return "Выберите файл JPEG, PNG или WebP.";
  if (file.size > ATTACHMENT_MAX_INPUT_BYTES) return `Размер файла не должен превышать ${maxInputMegabytes} МБ.`;
  return undefined;
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
  const [text, setText] = useState("");
  const [files, setFiles] = useState<LocalFile[]>([]);
  const filesRef = useRef<LocalFile[]>([]);
  const [fileErrors, setFileErrors] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const addFiles = useCallback((incoming: File[]) => {
    const current = filesRef.current;
    const remaining = Math.max(0, ATTACHMENT_MAX_FILES_PER_MESSAGE - current.length);
    const errors: string[] = [];
    const accepted = incoming.slice(0, remaining).map((file) => {
      const validationError = validateClientFile(file);
      if (validationError) {
        errors.push(`${file.name || "Изображение"}: ${validationError}`);
        return null;
      }
      return { key: crypto.randomUUID(), file, preview: URL.createObjectURL(file) };
    }).filter((item): item is LocalFile => item !== null);
    if (incoming.length > remaining) errors.push(`Можно прикрепить не более ${ATTACHMENT_MAX_FILES_PER_MESSAGE} изображений.`);
    const next = [...current, ...accepted];
    filesRef.current = next;
    setFiles(next);
    setFileErrors(errors);
  }, []);

  const removeFile = (key: string) => {
    const current = filesRef.current;
    const removed = current.find((file) => file.key === key);
    if (removed) URL.revokeObjectURL(removed.preview);
    const next = current.filter((file) => file.key !== key);
    filesRef.current = next;
    setFiles(next);
  };

  useEffect(() => () => filesRef.current.forEach((file) => URL.revokeObjectURL(file.preview)), []);

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
            const merged = [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
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
    const timer = window.setInterval(() => void poll(), 5000);
    const onVisibilityChange = () => { if (document.visibilityState === "visible") void poll(); };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [submissionId]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (selectedImage && !dialog.open) dialog.showModal();
    if (!selectedImage && dialog.open) dialog.close();
  }, [selectedImage]);

  const send = async () => {
    const cleanText = text.trim();
    if (sendingRef.current || (!cleanText && filesRef.current.length === 0)) return;
    sendingRef.current = true;
    setSending(true);
    setError("");
    setFileErrors([]);
    const formData = new FormData();
    formData.set("text", text);
    filesRef.current.forEach(({ file }) => formData.append("files", file, file.name || "image"));
    try {
      const response = await fetch(`/api/submissions/${encodeURIComponent(submissionId)}/messages`, {
        method: "POST",
        body: formData,
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      const result = await response.json() as { message?: ChatMessage; error?: string; fileErrors?: Array<{ name: string; error: string }> };
      if (!response.ok || !result.message) {
        setError(result.error ?? "Не удалось отправить сообщение.");
        setFileErrors(result.fileErrors?.map((item) => `${item.name}: ${item.error}`) ?? []);
        return;
      }
      setMessages((current) => {
        if (current.some((message) => message.id === result.message?.id)) return current;
        const merged = [...current, result.message!].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
        messagesRef.current = merged;
        return merged;
      });
      setText("");
      filesRef.current.forEach((file) => URL.revokeObjectURL(file.preview));
      filesRef.current = [];
      setFiles([]);
      if (inputRef.current) inputRef.current.value = "";
    } catch {
      setError("Не удалось отправить сообщение. Проверьте соединение и попробуйте снова.");
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const touchInput = window.matchMedia("(hover: none) and (pointer: coarse)").matches;
    if (!shouldSubmitChatOnEnter({
      key: event.key,
      shiftKey: event.shiftKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      altKey: event.altKey,
      isComposing: event.nativeEvent.isComposing,
      keyCode: event.keyCode,
      touchInput,
    })) return;
    event.preventDefault();
    void send();
  };

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const imageFiles = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null);
    if (!imageFiles.length) return;
    event.preventDefault();
    addFiles(imageFiles);
    const pastedText = event.clipboardData.getData("text/plain");
    if (pastedText) {
      const input = event.currentTarget;
      const start = input.selectionStart;
      const end = input.selectionEnd;
      const next = `${text.slice(0, start)}${pastedText}${text.slice(end)}`;
      setText(next);
      requestAnimationFrame(() => input.setSelectionRange(start + pastedText.length, start + pastedText.length));
    }
  };

  const items = [
    ...events.map((event) => ({ ...event, system: true as const })),
    ...messages.map((message) => ({ ...message, system: false as const, kind: "message" })),
  ].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));

  return (
    <Card className="space-y-4">
      <h2 className="text-xl font-semibold">Чат заявки</h2>
      <ol aria-live="polite" className="max-h-[32rem] space-y-3 overflow-y-auto">
        {items.map((item) => (
          <li className={item.system ? "rounded-md bg-surface-2 p-3 text-sm text-muted" : "rounded-md border border-border p-3"} key={item.id}>
            {item.system ? <>
              <p className="whitespace-pre-wrap break-words">{item.text}</p>
              <time className="mt-1 block text-xs">{formatDate(item.createdAt)} МСК</time>
            </> : <>
              <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                <span className="font-medium">{item.authorId === viewerId ? "Вы" : item.author.login}</span>
                <time className="text-xs text-muted">{formatDate(item.createdAt)} МСК</time>
              </div>
              {item.text && <p className="mt-2 whitespace-pre-wrap break-words">{item.text}</p>}
              {item.attachments.length > 0 && <div className="mt-3 flex flex-wrap gap-2">
                {item.attachments.map((attachment) => <button
                  aria-label="Открыть изображение"
                  className="min-h-11 min-w-11 overflow-hidden rounded-lg border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  key={attachment.id}
                  onClick={() => setSelectedImage(`/api/attachments/${encodeURIComponent(attachment.id)}`)}
                  type="button"
                ><img alt="Вложение" className="h-24 w-24 object-cover" loading="lazy" src={`/api/attachments/${encodeURIComponent(attachment.id)}`} /></button>)}
              </div>}
            </>}
          </li>
        ))}
        {items.length === 0 && <li className="text-sm text-muted">Сообщений пока нет.</li>}
      </ol>
      {pollError && <p className="text-sm text-danger" role="status">{pollError}</p>}
      <form className="space-y-2" onSubmit={(event) => { event.preventDefault(); void send(); }}>
        <label className="block space-y-1 text-sm">
          <span>Сообщение или скриншот</span>
          <Textarea
            className={`min-h-24 ${dragging ? "border-accent ring-2 ring-accent/30" : ""}`}
            maxLength={2000}
            onChange={(event) => setText(event.target.value)}
            onDragEnter={(event: DragEvent<HTMLTextAreaElement>) => { event.preventDefault(); setDragging(true); }}
            onDragLeave={(event: DragEvent<HTMLTextAreaElement>) => { event.preventDefault(); setDragging(false); }}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => { event.preventDefault(); setDragging(false); addFiles(Array.from(event.dataTransfer.files)); }}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder="Напишите сообщение…"
            ref={textareaRef}
            value={text}
          />
        </label>
        <p className="text-xs text-muted">До {maxInputMegabytes} МБ, до {ATTACHMENT_MAX_FILES_PER_MESSAGE} файлов, jpg, png, webp.</p>
        <p className="hidden text-xs text-muted md:block">Enter отправить, Shift+Enter новая строка</p>
        <input
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          multiple
          onChange={(event) => { addFiles(Array.from(event.target.files ?? [])); event.currentTarget.value = ""; }}
          ref={inputRef}
          type="file"
        />
        {files.length > 0 && <ul className="flex flex-wrap gap-3" aria-label="Выбранные изображения">
          {files.map((file) => <li className="relative" key={file.key}>
            <img alt={`Предпросмотр: ${file.file.name || "изображение"}`} className="h-20 w-20 rounded-lg border border-border object-cover" src={file.preview} />
            <button aria-label={`Удалить ${file.file.name || "изображение"}`} className="absolute -right-2 -top-2 min-h-11 min-w-11 rounded-full bg-surface-2 text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" onClick={() => removeFile(file.key)} type="button">×</button>
          </li>)}
        </ul>}
        {fileErrors.map((fileError) => <p className="text-sm text-danger" key={fileError} role="alert">{fileError}</p>)}
        <div className="flex flex-wrap items-center gap-3">
          <Button disabled={sending || files.length >= ATTACHMENT_MAX_FILES_PER_MESSAGE} onClick={() => inputRef.current?.click()} type="button">Прикрепить</Button>
          <Button disabled={sending || (!text.trim() && files.length === 0)} type="submit">{sending ? "Загрузка…" : "Отправить"}</Button>
          {error && <span className="text-sm text-danger" role="alert">{error}</span>}
        </div>
      </form>
      <dialog
        aria-label="Просмотр вложения"
        className="m-0 h-screen w-screen max-h-none max-w-none rounded-none border-0 bg-bg p-0 backdrop:bg-black/80 md:m-auto md:h-auto md:w-auto md:max-h-[90vh] md:max-w-[90vw] md:rounded-xl"
        onClick={(event) => { if (event.target === dialogRef.current) setSelectedImage(null); }}
        onClose={() => setSelectedImage(null)}
        ref={dialogRef}
      >
        {selectedImage && <img alt="Вложение" className="max-h-screen max-w-screen object-contain md:max-h-[90vh] md:max-w-[90vw]" src={selectedImage} />}
      </dialog>
    </Card>
  );
}
