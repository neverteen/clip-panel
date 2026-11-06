import { NotificationStatus } from "@prisma/client";
import { prisma } from "../src/lib/prisma.ts";

const LEASE_ID = "telegram-get-updates";

try {
  const [counts, oldestPending, lease, failed] = await Promise.all([
    prisma.notification.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.notification.findFirst({
      where: { status: NotificationStatus.PENDING },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    }),
    prisma.telegramWorkerLease.findUnique({ where: { id: LEASE_ID }, select: { workerId: true, leaseUntil: true } }),
    prisma.notification.findMany({
      where: { status: NotificationStatus.FAILED },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 5,
      select: { id: true, kind: true, attempts: true, lastErrorCode: true, createdAt: true },
    }),
  ]);
  const getCount = (status: NotificationStatus) => counts.find((row) => row.status === status)?._count._all ?? 0;
  const ageSeconds = oldestPending ? Math.max(0, Math.floor((Date.now() - oldestPending.createdAt.getTime()) / 1000)) : null;

  console.log("Telegram outbox status");
  console.log(`PENDING: ${getCount(NotificationStatus.PENDING)}`);
  console.log(`SENDING: ${getCount(NotificationStatus.SENDING)}`);
  console.log(`SENT: ${getCount(NotificationStatus.SENT)}`);
  console.log(`FAILED: ${getCount(NotificationStatus.FAILED)}`);
  console.log(`Oldest PENDING age: ${ageSeconds === null ? "none" : `${ageSeconds}s`}`);
  console.log(`Worker lease owner: ${lease?.workerId ?? "none"}`);
  console.log(`Worker lease until: ${lease?.leaseUntil.toISOString() ?? "none"}`);
  console.log("Latest FAILED notifications:");
  if (failed.length === 0) console.log("none");
  for (const notification of failed) {
    console.log(`${notification.id} kind=${notification.kind} attempts=${notification.attempts} code=${notification.lastErrorCode ?? "UNKNOWN"} createdAt=${notification.createdAt.toISOString()}`);
  }
} catch {
  console.error("Unable to read Telegram worker status from the database.");
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
