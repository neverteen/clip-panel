import Link from "next/link";
import { requireModerator } from "@/lib/auth-guards";

const links = [
  ["Заявки", "/moderator/submissions"],
  ["Аккаунты", "/moderator/accounts"],
  ["Пользователи", "/moderator/users"],
  ["Выплаты", "/moderator/payouts"],
  ["Недели", "/moderator/weeks"],
  ["Профиль", "/profile"],
] as const;

export default async function ModeratorLayout({ children }: LayoutProps<"/moderator">) {
  await requireModerator();

  return (
    <>
      <nav aria-label="Навигация модератора" className="border-b border-[var(--border)] bg-[var(--card)] px-6 py-3">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap gap-x-5 gap-y-2">
          {links.map(([label, href]) => (
            <Link className="text-sm font-medium text-[var(--foreground)] underline-offset-4 hover:underline" href={href} key={href}>
              {label}
            </Link>
          ))}
        </div>
      </nav>
      {children}
    </>
  );
}
