import type { HTMLAttributes } from "react";

export function Card({ className = "", ...props }: HTMLAttributes<HTMLElement>) {
  return <section className={`rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 ${className}`} {...props} />;
}
