import { requireModerator } from "@/lib/auth-guards";
import { ModeratorShell } from "@/components/app-shell";
import { getModeratorNavigationCounts } from "@/lib/navigation-counts";

export default async function ModeratorLayout({ children }: LayoutProps<"/moderator">) {
  const moderator = await requireModerator();
  const counts = await getModeratorNavigationCounts(moderator);
  return <ModeratorShell counts={counts} login={moderator.login}>{children}</ModeratorShell>;
}
