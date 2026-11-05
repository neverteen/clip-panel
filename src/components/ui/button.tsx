import type { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  children: ReactNode;
};

const variants = {
  primary: "bg-accent text-background shadow-[0_0_18px_color-mix(in_srgb,var(--accent)_22%,transparent)] hover:brightness-110",
  secondary: "border border-border bg-surface-2 text-text hover:border-accent/60 hover:bg-surface-2",
  ghost: "bg-transparent text-muted hover:bg-surface-2 hover:text-text",
  danger: "bg-danger text-background hover:brightness-110",
};

const sizes = {
  sm: "min-h-11 px-3 text-sm",
  md: "min-h-11 px-4 text-sm",
  lg: "min-h-12 px-5 text-base",
};

export function Button({ className = "", variant = "primary", size = "md", loading = false, disabled, children, ...props }: ButtonProps) {
  return <button aria-busy={loading || undefined} className={`inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]} ${sizes[size]} ${className}`} disabled={disabled || loading} {...props}>{loading && <span aria-hidden="true" className="size-4 animate-spin rounded-full border-2 border-current border-r-transparent" />}{children}</button>;
}
