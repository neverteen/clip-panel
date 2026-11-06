import Link from "next/link";
import { redirect } from "next/navigation";
import { Role } from "@prisma/client";
import { connection } from "next/server";
import { auth } from "../../../auth";
import { Card, PageHeader } from "@/components/ui";
import { prisma } from "@/lib/prisma";
import { roleHome } from "@/lib/route-access";
import { passwordVersionMatches } from "@/lib/password-version";
import { LoginForm } from "./login-form";

export const instant = false;

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  await connection();
  const session = await auth();
  if (session?.user?.id) {
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { isActive: true, role: true, passwordChangedAt: true },
    });
    if (user?.isActive && passwordVersionMatches(session.user.passwordChangedAt, user.passwordChangedAt)) {
      redirect(roleHome(user.role === Role.MODERATOR ? "MODERATOR" : "CLIPPER"));
    }
  }
  const params = await searchParams;
  const callbackUrl = typeof params.callbackUrl === "string" ? params.callbackUrl : "";

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-10 sm:px-6 sm:py-16">
      <Card>
        <p className="mb-4 font-heading text-sm font-bold tracking-[0.2em] text-accent-2">CLOSETAPE CLIPS</p>
        <Link className="text-sm text-muted underline underline-offset-4 hover:text-accent-2" href="/">На главную</Link>
        <div className="mt-6"><PageHeader title="Вход" description="Введите логин и пароль, выданные модератором." /></div>
        {params.passwordChanged === "1" && <p className="mt-4 rounded-md border border-success/40 bg-success/10 p-3 text-sm text-success" role="status">Пароль изменён, войдите заново.</p>}
        <LoginForm callbackUrl={callbackUrl} />
      </Card>
    </main>
  );
}
