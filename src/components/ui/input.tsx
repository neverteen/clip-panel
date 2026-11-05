import type { InputHTMLAttributes, Ref } from "react";

type InputProps = InputHTMLAttributes<HTMLInputElement> & { ref?: Ref<HTMLInputElement> };

export function Input({ className = "", ...props }: InputProps) {
  return <input className={`min-h-11 w-full min-w-0 rounded-lg border border-border bg-surface px-3 py-2.5 text-base text-text outline-none placeholder:text-muted focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30 disabled:cursor-not-allowed disabled:opacity-60 ${className}`} {...props} />;
}
