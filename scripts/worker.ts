import { prisma } from "../src/lib/prisma.ts";
import { runTelegramWorker } from "../src/lib/telegram-worker.ts";

process.on("unhandledRejection", () => {
  console.error("Telegram worker encountered an unhandled rejection; exiting for supervisor restart.");
  process.exit(1);
});
process.on("uncaughtException", () => {
  console.error("Telegram worker encountered an uncaught exception; exiting for supervisor restart.");
  process.exit(1);
});

try {
  await runTelegramWorker();
} catch (error) {
  const safeMessage = error instanceof Error && [
    "TELEGRAM_BOT_TOKEN is missing; Telegram worker cannot start.",
    "Telegram worker lease is held by another process.",
    "Telegram worker lease lost; restart required.",
  ].includes(error.message)
    ? error.message
    : "Telegram worker stopped because of an internal error.";
  console.error(safeMessage);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
