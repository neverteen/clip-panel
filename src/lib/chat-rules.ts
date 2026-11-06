import { Role } from "@prisma/client";

export function canAccessSubmissionChat(
  role: Role,
  viewerId: string,
  ownerId: string,
  isActive = true,
) {
  return isActive && (role === Role.MODERATOR || (role === Role.CLIPPER && viewerId === ownerId));
}

export function getMessageRateLimitError(
  minuteCount: number,
  dayCount: number,
) {
  if (minuteCount >= 10) return "Лимит сообщений: не более 10 в минуту.";
  if (dayCount >= 200) return "Достигнут дневной лимит: не более 200 сообщений за сутки.";
  return null;
}

export function getAttachmentRateLimitError(attachmentCount: number, requestedCount: number, limit: number) {
  return attachmentCount + requestedCount > limit
    ? `Достигнут дневной лимит: не более ${limit} изображений за сутки.`
    : null;
}

export function countUnreadMessages(
  messages: Array<{ authorId: string; createdAt: Date }>,
  viewerId: string,
  lastReadAt: Date | null,
) {
  return messages.filter((message) =>
    message.authorId !== viewerId &&
    (!lastReadAt || message.createdAt.getTime() > lastReadAt.getTime()),
  ).length;
}
