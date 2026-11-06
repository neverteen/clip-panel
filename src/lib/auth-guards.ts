import { redirect } from "next/navigation";
import { Role } from "@prisma/client";
import { auth } from "../../auth";
import { prisma } from "./prisma";
import { passwordVersionMatches } from "./password-version";

export async function requireUser() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, login: true, role: true, isActive: true, passwordChangedAt: true },
  });

  if (!user?.isActive || !passwordVersionMatches(session.user.passwordChangedAt, user.passwordChangedAt)) redirect("/login");
  return { id: user.id, login: user.login, role: user.role, isActive: user.isActive };
}

export async function requireModerator() {
  const user = await requireUser();
  if (user.role !== Role.MODERATOR) redirect("/");
  return user;
}

export async function requireClipper() {
  const user = await requireUser();
  if (user.role !== Role.CLIPPER) redirect("/");
  return user;
}
