export type TelegramApiResult<T> =
  | { ok: true; result: T }
  | {
      ok: false;
      status: number;
      failureCode: "HTTP_429" | "HTTP_403" | "HTTP_400" | "HTTP_5XX" | "TIMEOUT" | "NETWORK" | "INVALID_CHAT";
      retryAfterSeconds?: number;
    };

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
    return { ok: false, status: 0, failureCode: timeout.aborted ? "TIMEOUT" : "NETWORK" };
  }

  let payload: TelegramEnvelope<T>;
  try {
    payload = await response.json() as TelegramEnvelope<T>;
  } catch {
    const failureCode = response.status === 429
      ? "HTTP_429"
      : response.status === 403
        ? "HTTP_403"
        : response.status >= 500
          ? "HTTP_5XX"
          : "HTTP_400";
    return { ok: false, status: response.status, failureCode };
  }
  if (response.ok && payload.ok === true) return { ok: true, result: payload.result as T };
  const description = typeof (payload as TelegramEnvelope<T> & { description?: unknown }).description === "string"
    ? (payload as TelegramEnvelope<T> & { description: string }).description.toLowerCase()
    : "";
  const failureCode = payload.error_code === 403
    ? "HTTP_403"
    : payload.error_code === 429
      ? "HTTP_429"
      : payload.error_code === 400 && /chat not found|bot was blocked|user is deactivated/.test(description)
        ? "INVALID_CHAT"
        : payload.error_code === 400
          ? "HTTP_400"
          : (payload.error_code ?? response.status) >= 500
            ? "HTTP_5XX"
            : "HTTP_400";
  return {
    ok: false,
    status: Number.isInteger(payload.error_code) ? payload.error_code! : response.status,
    failureCode,
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
