export type TelegramApiResult<T> =
  | { ok: true; result: T }
  | { ok: false; status: number; retryAfterSeconds?: number };

type TelegramEnvelope<T> = {
  ok?: boolean;
  result?: T;
  error_code?: number;
  parameters?: { retry_after?: number };
};

export async function callTelegramApi<T>(
  token: string,
  method: string,
  body: Record<string, unknown>,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
  timeoutMs = 10_000,
): Promise<TelegramApiResult<T>> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const requestSignal = signal ? AbortSignal.any([timeout, signal]) : timeout;
  let response: Response;
  try {
    response = await fetcher(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: requestSignal,
      cache: "no-store",
    });
  } catch {
    return { ok: false, status: 0 };
  }

  let payload: TelegramEnvelope<T>;
  try {
    payload = await response.json() as TelegramEnvelope<T>;
  } catch {
    return { ok: false, status: response.status };
  }
  if (response.ok && payload.ok === true) return { ok: true, result: payload.result as T };
  return {
    ok: false,
    status: Number.isInteger(payload.error_code) ? payload.error_code! : response.status,
    retryAfterSeconds: Number.isFinite(payload.parameters?.retry_after) ? payload.parameters!.retry_after : undefined,
  };
}

export function getTelegramConfig() {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const username = process.env.TELEGRAM_BOT_USERNAME?.trim();
  if (!token || !username || !/^[A-Za-z0-9_]{5,32}$/.test(username.replace(/^@/, ""))) {
    return null;
  }
  return { token, username: username.replace(/^@/, "") };
}
