import { redirect } from "next/navigation";
import { Role } from "@prisma/client";
import { auth } from "../../auth";
import { prisma } from "./prisma";

export async function requireUser() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, login: true, role: true, isActive: true },
  });

  if (!user?.isActive) redirect("/login");
  return user;
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
