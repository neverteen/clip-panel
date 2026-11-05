import Link from "next/link";
import { Card, PageHeader } from "@/components/ui";
import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-10 sm:px-6 sm:py-16">
      <Card>
        <p className="mb-4 font-heading text-sm font-bold tracking-[0.2em] text-accent-2">CLOSETAPE CLIPS</p>
        <Link className="text-sm text-muted underline underline-offset-4 hover:text-accent-2" href="/">На главную</Link>
        <div className="mt-6"><PageHeader title="Вход" description="Введите логин и пароль, выданные модератором." /></div>
        <LoginForm />
      </Card>
    </main>
  );
}
