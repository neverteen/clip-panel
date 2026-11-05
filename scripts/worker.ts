import { prisma } from "../src/lib/prisma.ts";
import { runTelegramWorker } from "../src/lib/telegram-worker.ts";

try {
  await runTelegramWorker();
} catch {
  console.error("Telegram worker stopped because of an internal error.");
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
