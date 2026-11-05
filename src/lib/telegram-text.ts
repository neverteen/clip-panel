import { NotificationKind } from "@prisma/client";
import {
  formatCents,
  getNotificationUrl,
  sanitizeTelegramFragment,
  truncateTelegramText,
} from "./telegram-rules.ts";

export type NotificationEvent =
  | { kind: "NEW_SUBMISSION"; login: string; url: string }
  | { kind: "NEW_ACCOUNT"; login: string; platform: string; url: string }
  | { kind: "NEW_PAYOUT"; login: string; amountCents: number; url: string }
  | { kind: "CHAT_MESSAGE"; login: string; message: string; url: string }
  | { kind: "ACCOUNT_APPROVED" | "ACCOUNT_REJECTED"; platform: string; url: string }
  | { kind: "SUBMISSION_APPROVED"; views: number; amountCents: number; url: string }
  | { kind: "SUBMISSION_REJECTED"; reason: string; url: string }
  | { kind: "WEEK_CLOSED"; payableCents: number; carryOutCents: number; expiredCents: number; weekCents: number; url: string }
  | { kind: "PAYOUT_PAID"; amountCents: number; url: string }
  | { kind: "PAYOUT_REJECTED"; reason: string; amountCents: number; url: string }
  | { kind: "TELEGRAM_LINKED" | "TELEGRAM_UNLINKED" };

export function buildNotificationText(event: NotificationEvent, baseUrl: string) {
  const login = "login" in event ? sanitizeTelegramFragment(event.login) : "";
  let text: string;
  switch (event.kind) {
    case "NEW_SUBMISSION":
      text = `Новая заявка на ролик от ${login}: ${getNotificationUrl(baseUrl, event.url)}`;
      break;
    case "NEW_ACCOUNT":
      text = `Новый аккаунт ${sanitizeTelegramFragment(event.platform)} от ${login}: ${getNotificationUrl(baseUrl, event.url)}`;
      break;
    case "NEW_PAYOUT":
      text = `Новый запрос на вывод ${formatCents(event.amountCents)} от ${login}: ${getNotificationUrl(baseUrl, event.url)}`;
      break;
    case "CHAT_MESSAGE":
      text = `Новое сообщение по заявке от ${login}: ${sanitizeTelegramFragment(event.message)} ${getNotificationUrl(baseUrl, event.url)}`;
      break;
    case "ACCOUNT_APPROVED":
      text = `Аккаунт ${sanitizeTelegramFragment(event.platform)} одобрен: ${getNotificationUrl(baseUrl, event.url)}`;
      break;
    case "ACCOUNT_REJECTED":
      text = `Аккаунт ${sanitizeTelegramFragment(event.platform)} отклонён: ${getNotificationUrl(baseUrl, event.url)}`;
      break;
    case "SUBMISSION_APPROVED":
      text = `Ролик одобрен: ${event.views.toLocaleString("ru-RU")} просмотров, ${formatCents(event.amountCents)}. ${getNotificationUrl(baseUrl, event.url)}`;
      break;
    case "SUBMISSION_REJECTED":
      text = `Ролик отклонён: ${sanitizeTelegramFragment(event.reason)} ${getNotificationUrl(baseUrl, event.url)}`;
      break;
    case "WEEK_CLOSED": {
      const result = event.payableCents > 0
        ? `к выводу ${formatCents(event.payableCents)}`
        : event.carryOutCents > 0
          ? `в копилку ${formatCents(event.carryOutCents)}`
          : event.expiredCents > 0
            ? `копилка сгорела: ${formatCents(event.expiredCents)}`
            : `ниже порога (${formatCents(event.weekCents)})`;
      text = `Неделя закрыта: ${result}. ${getNotificationUrl(baseUrl, event.url)}`;
      break;
    }
    case "PAYOUT_PAID":
      text = `Вывод оплачен: ${formatCents(event.amountCents)}. ${getNotificationUrl(baseUrl, event.url)}`;
      break;
    case "PAYOUT_REJECTED":
      text = `Вывод отклонён (${formatCents(event.amountCents)}): ${sanitizeTelegramFragment(event.reason)} ${getNotificationUrl(baseUrl, event.url)}`;
      break;
    case "TELEGRAM_LINKED":
      text = "Telegram привязан к профилю.";
      break;
    case "TELEGRAM_UNLINKED":
      text = "Telegram отвязан.";
      break;
  }
  return { kind: NotificationKind[event.kind], text: truncateTelegramText(text) };
}
