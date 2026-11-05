import Link from "next/link";

export function Tabs({ items, active }: { items: Array<{ label: string; href: string; count?: number }>; active: string }) {
  return <nav aria-label="Разделы" className="flex max-w-full gap-1 overflow-x-auto rounded-xl border border-border bg-surface p-1">
    {items.map((item) => <Link aria-current={active === item.href ? "page" : undefined} className={`inline-flex min-h-11 shrink-0 items-center gap-2 rounded-lg px-3 text-sm font-medium transition ${active === item.href ? "bg-accent/15 text-accent-2 shadow-[0_0_16px_color-mix(in_srgb,var(--accent)_16%,transparent)]" : "text-muted hover:bg-surface-2 hover:text-text"}`} href={item.href} key={item.href}>
      {item.label}{Boolean(item.count) && <span className="rounded-full bg-danger px-2 py-0.5 text-xs text-background">{item.count}</span>}
    </Link>)}
  </nav>;
}
