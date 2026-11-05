import { Card } from "@/components/ui";
import { requireClipper } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { ProfileForm } from "./profile-form";

export const instant = false;

export default async function ProfilePage() {
  const user = await requireClipper();
  const profile = await prisma.user.findUnique({
    where: { id: user.id },
    select: { wallet: true, steamTradeUrl: true },
  });

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 space-y-5 px-6 py-10">
      <p className="text-sm text-[var(--muted-foreground)]">Профиль: {user.login}</p>
      <ProfileForm wallet={profile?.wallet ?? ""} steamTradeUrl={profile?.steamTradeUrl ?? ""} />
      <Card className="text-sm text-[var(--muted-foreground)]">
        Токен в Steam-ссылке даёт доступ к обмену. Не передавайте эту ссылку другим людям.
      </Card>
    </main>
  );
}
