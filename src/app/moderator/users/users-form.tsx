"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Button, Card, Input, Textarea } from "@/components/ui";
import {
  createUsersAction,
  createClipperWithChannelsAction,
  addChannelsToClipperAction,
  type ActionState,
  type BatchState,
  type ClipChannelState,
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

function generatePassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*_-";
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => alphabet[value % alphabet.length]).join("");
}

function ChannelErrors({ errors }: { errors: ClipChannelState["lineErrors"] }) {
  if (!errors?.length) return null;
  return <ul className="space-y-1 text-sm text-danger" role="alert">
    {errors.map((error, index) => <li key={`${error.line}-${index}`}>{error.line ? `Строка ${error.line}: ` : ""}{error.reason}</li>)}
  </ul>;
}

export function NewClipperForm() {
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [links, setLinks] = useState("");
  const submittedRef = useRef<{ login: string; password: string } | null>(null);
  const [credentials, setCredentials] = useState<{ login: string; password: string } | null>(null);
  const [copyMessage, setCopyMessage] = useState("");
  const [state, action, pending] = useActionState<ClipChannelState, FormData>(async (previous, formData) => {
    const result = await createClipperWithChannelsAction(previous, formData);
    if (result.created && submittedRef.current) {
      setCredentials(submittedRef.current);
      setLinks("");
      setLogin("");
    }
    submittedRef.current = null;
    setPassword("");
    return result;
  }, {});

  async function copyCredentials() {
    if (!credentials) return;
    const value = `Логин: ${credentials.login}\nПароль: ${credentials.password}`;
    try {
      await navigator.clipboard.writeText(value);
      setCopyMessage("Скопировано");
    } catch {
      const area = document.createElement("textarea");
      area.value = value;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.append(area);
      area.select();
      document.execCommand("copy");
      area.remove();
      setCopyMessage("Скопировано");
    }
  }

  return <div className="space-y-4">
    <form action={action} className="space-y-3" onSubmit={() => { submittedRef.current = { login: login.trim().toLowerCase(), password }; }}>
      <label className="block space-y-1 text-sm"><span>Логин</span><Input autoComplete="username" name="login" onChange={(event) => setLogin(event.target.value)} value={login} required /></label>
      <label className="block space-y-1 text-sm"><span>Пароль</span><span className="flex gap-2"><Input autoComplete="new-password" className="min-w-0 flex-1" name="password" onChange={(event) => setPassword(event.target.value)} value={password} minLength={8} required type="password" /><Button onClick={() => setPassword(generatePassword())} type="button" variant="secondary">Сгенерировать</Button></span></label>
      <label className="block space-y-1 text-sm"><span>Ссылки на каналы (необязательно, до 15 строк)</span><Textarea autoComplete="off" className="min-h-32 font-mono" name="links" onChange={(event) => setLinks(event.target.value)} value={links} spellCheck={false} /></label>
      {state.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
      <ChannelErrors errors={state.lineErrors} />
      <Button disabled={pending} loading={pending} type="submit">Создать нарезчика</Button>
    </form>
    {credentials && <Card className="space-y-3 border-accent/50 shadow-[0_0_24px_color-mix(in_srgb,var(--accent)_18%,transparent)]">
      <h3 className="font-semibold">Логин и пароль для отправки нарезчику</h3>
      <p className="break-all font-mono text-sm">{credentials.login}<br />{credentials.password}</p>
      <div className="flex flex-wrap gap-2"><Button onClick={copyCredentials} type="button" variant="secondary">Копировать</Button><Button onClick={() => { setCredentials(null); setCopyMessage(""); }} type="button" variant="ghost">Закрыть</Button></div>
      {copyMessage && <p className="text-sm text-success" role="status">{copyMessage}</p>}
    </Card>}
  </div>;
}

function AddChannelsForm({ userId }: { userId: string }) {
  const [open, setOpen] = useState(false);
  const [links, setLinks] = useState("");
  const [state, action, pending] = useActionState<ClipChannelState, FormData>(async (previous, formData) => {
    const result = await addChannelsToClipperAction(userId, previous, formData);
    if (result.created) { setOpen(false); setLinks(""); }
    return result;
  }, {});
  return <div className="space-y-2">
    <Button onClick={() => setOpen((value) => !value)} type="button" variant="secondary" size="sm">Добавить каналы</Button>
    {open && <form action={action} className="space-y-2">
      <Textarea autoComplete="off" className="min-h-28 font-mono" name="links" onChange={(event) => setLinks(event.target.value)} value={links} placeholder="По одной ссылке на строку" />
      <ChannelErrors errors={state.lineErrors} />
      {state.created && <p className="text-sm text-success" role="status">Каналы добавлены и одобрены.</p>}
      <Button disabled={pending} loading={pending} size="sm" type="submit">Добавить</Button>
    </form>}
  </div>;
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
  isClipper,
}: {
  userId: string;
  isActive: boolean;
  isClipper: boolean;
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
      {isClipper && <AddChannelsForm userId={userId} />}
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
