import Link from "next/link";
import { RegisterForm } from "./register-form";

export default function RegisterPage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 py-16">
      <Link className="text-sm text-zinc-600 underline" href="/">На главную</Link>
      <h1 className="mt-6 text-3xl font-semibold">Регистрация</h1>
      <p className="mt-2 text-zinc-600">Создайте аккаунт нарезчика.</p>
      <RegisterForm />
    </main>
  );
}
