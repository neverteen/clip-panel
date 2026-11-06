import { Role } from "@prisma/client";
import { ClipperShell, ModeratorShell } from "@/components/app-shell";
import { Card } from "@/components/ui";
import { requireUser } from "@/lib/auth-guards";
import { getModeratorNavigationCounts } from "@/lib/navigation-counts";
import { prisma } from "@/lib/prisma";
import { getProfileSections } from "@/lib/profile-sections";
import { ProfileForm } from "./profile-form";

export const instant = false;

const passwordErrors: Record<string, string> = {
  invalid: "Проверьте новый пароль: не менее 8 символов и не более 72 байт в UTF-8.",
  mismatch: "Новые пароли не совпадают.",
  locked: "Слишком много неверных попыток. Попробуйте позже.",
  incorrect: "Текущий пароль неверен.",
  same: "Новый пароль должен отличаться от текущего.",
};

export default async function ProfilePage({ searchParams }: PageProps<"/profile">) {
  const user = await requireUser();
  const params = await searchParams;
  const sections = getProfileSections(user.role);
  const profile = await prisma.user.findUnique({
    where: { id: user.id },
    select: { telegramChatId: true, telegramNotificationsEnabled: true },
  });
  const payoutProfile = sections.payoutDetails
    ? await prisma.user.findUnique({ where: { id: user.id }, select: { wallet: true, steamTradeUrl: true } })
    : null;
  const moderatorCounts = user.role === Role.MODERATOR ? await getModeratorNavigationCounts(user) : null;

  const content = (
    <main className="mx-auto w-full max-w-3xl flex-1 space-y-5 px-6 py-10">
      <p className="text-sm text-[var(--muted-foreground)]">Профиль: {user.login}</p>
      <ProfileForm
        showPayoutDetails={sections.payoutDetails}
        wallet={payoutProfile?.wallet ?? ""}
        steamTradeUrl={payoutProfile?.steamTradeUrl ?? ""}
        telegramConnected={Boolean(profile?.telegramChatId)}
        telegramNotificationsEnabled={profile?.telegramNotificationsEnabled ?? true}
        showPasswordChange={user.role === Role.CLIPPER}
        passwordError={typeof params.passwordError === "string" ? passwordErrors[params.passwordError] : undefined}
      />
      {sections.payoutDetails && (
        <Card className="text-sm text-[var(--muted-foreground)]">
          Токен в Steam-ссылке даёт доступ к обмену. Не передавайте эту ссылку другим людям.
        </Card>
      )}
    </main>
  );
  return user.role === Role.MODERATOR && moderatorCounts
    ? <ModeratorShell counts={moderatorCounts} login={user.login}>{content}</ModeratorShell>
    : <ClipperShell login={user.login}>{content}</ClipperShell>;
}
