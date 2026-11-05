import type { ReactNode } from "react";

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return <div className="rounded-xl border border-dashed border-border bg-surface/60 px-5 py-10 text-center">
    <h2 className="font-heading text-lg font-semibold">{title}</h2>
    {description && <p className="mx-auto mt-2 max-w-xl text-sm text-muted">{description}</p>}
    {action && <div className="mt-5 flex justify-center">{action}</div>}
  </div>;
}
