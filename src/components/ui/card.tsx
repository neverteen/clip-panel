import type { HTMLAttributes } from "react";

export function Card({ className = "", ...props }: HTMLAttributes<HTMLElement>) {
  return <section className={`min-w-0 rounded-xl border border-border bg-surface p-4 shadow-xl sm:p-5 ${className}`} {...props} />;
}
