import type { Metadata } from "next";
import { Platform } from "@prisma/client";
import { connection } from "next/server";
import { auth } from "../../auth";
import { LandingPage } from "@/components/landing-page";
import { landingContent } from "@/content/landing";
import { prisma } from "@/lib/prisma";
import {
  MAX_ACCOUNTS_PER_PLATFORM,
  MAX_SUBMISSIONS_PER_WEEK,
  MIN_VIDEO_VIEWS,
  MIN_WEEK_VIEWS,
  PAYOUT_SLA_DAYS,
  PAYOUT_THRESHOLD_CENTS,
  RATE_CENTS_PER_1000,
} from "@/lib/config";
import { activeHomeDestination } from "@/lib/route-access";
import { createLandingPayoutTable } from "@/lib/landing-payout-table";

export const metadata: Metadata = landingContent.metadata;
export const instant = false;

export default async function HomePage() {
  await connection();
  const session = await auth();
  const userId = session?.user?.id;
  const activeUser = userId
    ? await prisma.user.findUnique({ where: { id: userId }, select: { isActive: true } })
    : null;
  const login = session?.user?.login ?? null;
  const dashboardHref = activeHomeDestination(session?.user?.role, activeUser?.isActive);

  return <LandingPage
    login={dashboardHref ? login : null}
    dashboardHref={dashboardHref}
    numbers={{
      rateCentsPer1000: RATE_CENTS_PER_1000,
      minVideoViews: MIN_VIDEO_VIEWS,
      minWeekViews: MIN_WEEK_VIEWS,
      payoutThresholdCents: PAYOUT_THRESHOLD_CENTS,
      maxAccountsTotal: Object.values(Platform).length * MAX_ACCOUNTS_PER_PLATFORM,
      maxAccountsPerPlatform: MAX_ACCOUNTS_PER_PLATFORM,
      maxSubmissionsPerWeek: MAX_SUBMISSIONS_PER_WEEK,
      payoutSlaDays: PAYOUT_SLA_DAYS,
    }}
    payoutRows={createLandingPayoutTable(RATE_CENTS_PER_1000)}
  />;
}
