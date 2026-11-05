import { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getUnreadCounts } from "@/lib/submission-chat";

export async function getModeratorNavigationCounts(user: { id: string; role: Role }) {
  const [accounts, payouts, unreadBySubmission] = await Promise.all([
    prisma.platformAccount.count({ where: { status: "PENDING" } }),
    prisma.payout.count({ where: { status: "REQUESTED" } }),
    getUnreadCounts(user.id, user.role),
  ]);
  return {
    accounts,
    payouts,
    submissions: [...unreadBySubmission.values()].reduce((sum, count) => sum + count, 0),
  };
}
