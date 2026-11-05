export type PayoutRequestFailure = "open_request" | "daily_limit" | "below_threshold";

export function validatePayoutRequest(input: {
  balanceCents: number;
  hasOpenRequest: boolean;
  requestsInLast24Hours: number;
  thresholdCents: number;
  maxRequestsPer24Hours: number;
}): PayoutRequestFailure | null {
  if (input.hasOpenRequest) return "open_request";
  if (input.requestsInLast24Hours >= input.maxRequestsPer24Hours) return "daily_limit";
  if (input.balanceCents < input.thresholdCents) return "below_threshold";
  return null;
}

export function balanceAfterReservation(balanceCents: number, amountCents: number) {
  if (!Number.isInteger(balanceCents) || !Number.isInteger(amountCents) || amountCents <= 0) return null;
  const result = balanceCents - amountCents;
  return result < 0 ? null : result;
}

export function balanceAfterRefund(balanceCents: number, amountCents: number) {
  if (!Number.isInteger(balanceCents) || !Number.isInteger(amountCents) || amountCents <= 0) return null;
  return balanceCents + amountCents;
}

export function canEditPayoutDetails(hasOpenRequest: boolean) {
  return !hasOpenRequest;
}

export function canProcessPayout(status: string) {
  return status === "REQUESTED";
}
