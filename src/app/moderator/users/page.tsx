import { Role } from "@prisma/client";
import { requireModerator } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { CreateUsersForm, UserControls } from "./users-form";

export const instant = false;

export default async function ModeratorUsersPage() {
  const moderator = await requireModerator();
  const users = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    select: { id: true, login: true, role: true, createdAt: true, isActive: true },
  });

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 space-y-10 px-6 py-10">
      <header>
        <h1 className="text-3xl font-semibold">Пользователи</h1>
        <p className="mt-2 text-muted">
          Создавайте аккаунты нарезчиков и управляйте доступом.
        </p>
      </header>

      <section className="space-y-4 rounded-lg border border-border p-5">
        <h2 className="text-xl font-medium">Создать пользователей</h2>
        <p className="text-sm text-muted">
          Новые аккаунты получают роль {Role.CLIPPER}. Пароль используется только при создании.
        </p>
        <CreateUsersForm />
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-medium">Список пользователей</h2>
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="responsive-table w-full min-w-[900px] text-left text-sm">
            <thead className="bg-surface-2">
              <tr>
                <th className="px-4 py-3">Логин</th>
                <th className="px-4 py-3">Роль</th>
                <th className="px-4 py-3">Создан</th>
                <th className="px-4 py-3">Доступ</th>
                <th className="px-4 py-3">Действия</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr className="border-t border-border align-top" key={user.id}>
                  <td className="px-4 py-3" data-label="Логин">{user.login}</td>
                  <td className="px-4 py-3" data-label="Роль">
                    {user.role === Role.MODERATOR ? "Модератор" : "Нарезчик"}
                  </td>
                  <td className="px-4 py-3" data-label="Создан">
                    {new Intl.DateTimeFormat("ru-RU", {
                      dateStyle: "medium",
                      timeStyle: "short",
                      timeZone: "Europe/Moscow",
                    }).format(user.createdAt)}
                  </td>
                  <td className="px-4 py-3" data-label="Доступ">{user.isActive ? "Активен" : "Отключён"}</td>
                  <td className="px-4 py-3" data-label="Действия">
                    <UserControls
                      isActive={user.isActive}
                      userId={user.id}
                    />
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td className="px-4 py-3 text-muted" colSpan={5}>
                    Пользователей пока нет.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted">Текущая сессия модератора: {moderator.login}</p>
      </section>
    </main>
  );
}
