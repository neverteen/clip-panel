import type { Ref, TextareaHTMLAttributes } from "react";

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & { ref?: Ref<HTMLTextAreaElement> };

export function Textarea({ className = "", ...props }: TextareaProps) {
  return <textarea className={`w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 ${className}`} {...props} />;
}
