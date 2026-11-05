import type { SelectHTMLAttributes } from "react";

export function Select({ className = "", children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`min-h-11 w-full min-w-0 rounded-lg border border-border bg-surface px-3 py-2.5 text-base text-text outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30 disabled:cursor-not-allowed disabled:opacity-60 ${className}`} {...props}>{children}</select>;
}
