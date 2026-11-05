import Link from "next/link";
import type { ReactNode } from "react";
import { LogoutForm } from "@/components/logout-form";

const clipperLinks = [
  ["Главная", "/"], ["Аккаунты", "/accounts"], ["Заявки", "/submissions"], ["Баланс", "/balance"], ["Профиль", "/profile"],
] as const;

const moderatorLinks = [
  ["Аккаунты", "/moderator/accounts", "accounts"],
  ["Заявки", "/moderator/submissions", "submissions"],
  ["Недели", "/moderator/weeks", "weeks"],
  ["Выплаты", "/moderator/payouts", "payouts"],
  ["Пользователи", "/moderator/users", "users"],
  ["Профиль", "/profile", "profile"],
] as const;

function Count({ children }: { children: number }) {
  if (children <= 0) return null;
  return <span className="ml-auto inline-flex min-h-6 min-w-6 items-center justify-center rounded-full bg-accent/15 px-2 text-xs font-semibold text-accent-2">{children}</span>;
}

export function ClipperShell({ login, children }: { login: string; children: ReactNode }) {
  const links = clipperLinks.map(([label, href]) => <Link className="flex min-h-11 items-center rounded-lg px-3 text-sm font-medium text-muted transition hover:bg-surface-2 hover:text-text" href={href} key={href}>{label}</Link>);
  return <div className="flex min-h-screen flex-1 flex-col">
    <header className="sticky top-0 z-20 hidden min-h-16 items-center justify-between gap-3 border-b border-border bg-background/90 px-6 backdrop-blur sm:flex">
      <Link className="shrink-0 font-heading text-lg font-bold tracking-wide text-text" href="/">CLOSETAPE CLIPS</Link>
      <nav aria-label="Основная навигация" className="flex items-center gap-1">{links}</nav>
      <div className="flex shrink-0 items-center gap-2"><span className="max-w-36 truncate text-sm text-muted">{login}</span><LogoutForm /></div>
    </header>
    <header className="sticky top-0 z-20 flex min-h-14 items-center justify-between gap-2 border-b border-border bg-background/95 px-3 py-1 backdrop-blur sm:hidden">
      <Link className="font-heading text-sm font-bold tracking-wide text-text" href="/">CLOSETAPE CLIPS</Link>
      <div className="flex min-w-0 items-center gap-1"><span className="max-w-24 truncate text-xs text-muted">{login}</span><LogoutForm /></div>
    </header>
    <div className="flex flex-1 flex-col pb-20 sm:pb-0">{children}</div>
    <nav aria-label="Основная навигация" className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-border bg-surface/95 px-1 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden">
      {clipperLinks.map(([label, href]) => <Link className="flex min-h-14 min-w-0 items-center justify-center px-1 text-center text-[0.7rem] font-medium text-muted hover:text-accent-2" href={href} key={href}>{label}</Link>)}
    </nav>
  </div>;
}

export function ModeratorShell({ login, counts, children }: { login: string; counts: { accounts: number; submissions: number; payouts: number }; children: ReactNode }) {
  const navigation = moderatorLinks.map(([label, href, key]) => (
    <Link className="flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium text-muted transition hover:bg-surface-2 hover:text-text" href={href} key={href}>
      <span>{label}</span><Count>{counts[key as keyof typeof counts] ?? 0}</Count>
    </Link>
  ));
  return <div className="flex min-h-screen flex-1">
    <aside className="hidden w-64 shrink-0 flex-col border-r border-border bg-surface p-5 lg:flex">
      <Link className="font-heading text-lg font-bold tracking-wide text-text" href="/">CLOSETAPE CLIPS</Link>
      <p className="mb-7 mt-1 text-xs text-muted">Панель модератора</p>
      <nav aria-label="Навигация модератора" className="space-y-1">{navigation}</nav>
      <div className="mt-auto flex items-center justify-between gap-2 border-t border-border pt-4">
        <p className="min-w-0 truncate text-xs text-muted">{login}</p><LogoutForm />
      </div>
    </aside>
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="sticky top-0 z-20 flex flex-col gap-1 border-b border-border bg-background/95 px-3 py-2 backdrop-blur lg:hidden">
        <div className="flex min-h-11 items-center justify-between gap-2">
          <Link className="font-heading text-sm font-bold tracking-wide" href="/">CLOSETAPE CLIPS</Link>
          <details className="relative">
            <summary className="flex min-h-11 cursor-pointer list-none items-center rounded-lg border border-border px-4 text-sm">Меню</summary>
            <nav aria-label="Навигация модератора" className="absolute right-0 top-12 z-30 w-64 space-y-1 rounded-xl border border-border bg-surface p-3 shadow-2xl">{navigation}</nav>
          </details>
        </div>
        <div className="flex min-h-11 items-center justify-between gap-2 border-t border-border/70 pt-1">
          <span className="min-w-0 truncate text-xs text-muted">{login}</span><LogoutForm />
        </div>
      </header>
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
    </div>
  </div>;
}
