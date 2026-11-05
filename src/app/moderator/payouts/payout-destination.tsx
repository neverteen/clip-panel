"use client";

import { useState } from "react";
import { revealPayoutDestinationAction } from "./actions";

export function PayoutDestination({ payoutId, masked }: { payoutId: string; masked: string }) {
  const [destination, setDestination] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  async function reveal() {
    if (destination) {
      setDestination(null);
      setMessage("");
      return;
    }
    setPending(true);
    const result = await revealPayoutDestinationAction(payoutId);
    setPending(false);
    if (!result.destination) {
      setMessage(result.error ?? "Не удалось открыть реквизиты.");
      return;
    }
    setDestination(result.destination);
    setMessage("");
  }

  async function copy() {
    if (!destination) return;
    try {
      await navigator.clipboard.writeText(destination);
      setMessage("Реквизиты скопированы.");
    } catch {
      setMessage("Не удалось скопировать реквизиты.");
    }
  }

  return (
    <div className="space-y-2">
      <p className="break-all font-mono text-sm">{destination ?? masked}</p>
      <div className="flex flex-wrap gap-2">
        <button className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm" disabled={pending} onClick={reveal} type="button">
          {pending ? "Загрузка…" : destination ? "Скрыть реквизиты" : "Показать полностью"}
        </button>
        {destination && (
          <button className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm" onClick={copy} type="button">
            Копировать
          </button>
        )}
      </div>
      {message && <p className="text-xs text-[var(--muted-foreground)]" role="status">{message}</p>}
    </div>
  );
}
