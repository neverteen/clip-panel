import type { InputHTMLAttributes } from "react";

export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 ${className}`} {...props} />;
}
