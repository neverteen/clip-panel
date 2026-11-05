import type { ReactNode } from "react";
import { ClipperShell } from "@/components/app-shell";
import { requireClipper } from "@/lib/auth-guards";

export default async function AccountsLayout({ children }: { children: ReactNode }) {
  const user = await requireClipper();
  return <ClipperShell login={user.login}>{children}</ClipperShell>;
}
