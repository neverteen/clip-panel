import Link from "next/link";
import { Button, Card, PageHeader } from "@/components/ui";

export default function Home() {
  return <main className="mx-auto flex w-full max-w-5xl flex-1 items-center px-4 py-10 sm:px-6 sm:py-16">
    <Card className="relative w-full overflow-hidden p-6 sm:p-10">
      <div aria-hidden="true" className="pointer-events-none absolute -right-16 -top-20 size-64 rounded-full bg-accent/10 blur-3xl" />
      <div className="relative max-w-2xl space-y-6">
        <p className="font-heading text-sm font-semibold tracking-[0.22em] text-accent-2">CLOSETAPE CLIPS</p>
        <PageHeader title="Панель клипмейкера" description="Добавляйте аккаунты, отправляйте ролики на проверку и следите за балансом в одном месте." />
        <Link className="inline-flex" href="/login"><Button size="lg">Войти в панель</Button></Link>
      </div>
    </Card>
  </main>;
}
