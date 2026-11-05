import type { Ref, TextareaHTMLAttributes } from "react";

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & { ref?: Ref<HTMLTextAreaElement> };

export function Textarea({ className = "", ...props }: TextareaProps) {
  return <textarea className={`min-h-24 w-full min-w-0 rounded-lg border border-border bg-surface px-3 py-2.5 text-base text-text outline-none placeholder:text-muted focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30 disabled:cursor-not-allowed disabled:opacity-60 ${className}`} {...props} />;
}
