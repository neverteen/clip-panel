import { redirect } from "next/navigation";
import { Role } from "@prisma/client";
import { auth } from "../../auth";

export async function requireUser() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  return session.user;
}

export async function requireModerator() {
  const user = await requireUser();
  if (user.role !== Role.MODERATOR) redirect("/");
  return user;
}
