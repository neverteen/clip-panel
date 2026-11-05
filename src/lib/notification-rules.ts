import { retryDelayMs } from "./telegram-rules.ts";

export function deliveryFailureOutcome(attempts: number, retryAfterSeconds?: number) {
  if (attempts >= 5) return { status: "FAILED" as const };
  return { status: "PENDING" as const, delayMs: retryDelayMs(attempts, retryAfterSeconds) };
}
