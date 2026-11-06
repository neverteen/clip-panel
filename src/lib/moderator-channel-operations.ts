import { AccountStatus, Platform, Prisma, Role } from "@prisma/client";
import { MAX_ACCOUNTS_PER_PLATFORM } from "./config.ts";
import type { ChannelLineError, ParsedChannelLine } from "./moderator-channels.ts";

export async function createClipperBundle(
  tx: Prisma.TransactionClient,
  input: { login: string; passwordHash: string; addedById: string; channels: ParsedChannelLine[]; now?: Date },
) {
  const user = await tx.user.create({
    data: { login: input.login, password: input.passwordHash, role: Role.CLIPPER },
    select: { id: true },
  });
  const approvedAt = input.now ?? new Date();
  for (const channel of input.channels) {
    await tx.platformAccount.create({
      data: {
        userId: user.id,
        addedById: input.addedById,
        platform: channel.platform,
        url: channel.url,
        status: AccountStatus.APPROVED,
        approvedAt,
      },
      select: { id: true },
    });
  }
  return user.id;
}

export async function addApprovedChannelsToClipper(
  tx: Prisma.TransactionClient,
  input: { userId: string; moderatorId: string; channels: ParsedChannelLine[]; now?: Date },
): Promise<ChannelLineError[]> {
  const { userId, moderatorId, channels } = input;
  const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
  if (!locked.length) return [{ line: 0, reason: "Пользователь не найден." }];
  const target = await tx.user.findUnique({ where: { id: userId }, select: { id: true, role: true } });
  if (!target || target.role !== Role.CLIPPER) return [{ line: 0, reason: "Каналы можно добавлять только нарезчику." }];

  const counts = new Map<Platform, number>();
  for (const platform of [Platform.TIKTOK, Platform.YOUTUBE, Platform.INSTAGRAM]) {
    counts.set(platform, await tx.platformAccount.count({
      where: { userId, platform, status: { in: [AccountStatus.PENDING, AccountStatus.APPROVED] } },
    }));
  }
  const prepared: Array<{ channel: ParsedChannelLine; rejectedId?: string }> = [];
  const lineErrors: ChannelLineError[] = [];
  for (const channel of channels) {
    const existing = await tx.platformAccount.findUnique({
      where: { platform_url: { platform: channel.platform, url: channel.url } },
      select: { id: true, userId: true, status: true, user: { select: { login: true } } },
    });
    if (existing && existing.userId !== userId) {
      lineErrors.push({ line: channel.line, reason: `Ссылка уже занята пользователем ${existing.user.login}.` });
      continue;
    }
    if (existing && existing.status !== AccountStatus.REJECTED) {
      lineErrors.push({ line: channel.line, reason: "Этот аккаунт уже добавлен." });
      continue;
    }
    counts.set(channel.platform, (counts.get(channel.platform) ?? 0) + 1);
    prepared.push({ channel, ...(existing?.status === AccountStatus.REJECTED ? { rejectedId: existing.id } : {}) });
  }
  for (const [platform, count] of counts) {
    if (count > MAX_ACCOUNTS_PER_PLATFORM) {
      for (const item of prepared.filter(({ channel }) => channel.platform === platform)) {
        lineErrors.push({ line: item.channel.line, reason: `Превышен лимит: максимум ${MAX_ACCOUNTS_PER_PLATFORM} аккаунтов этой платформы.` });
      }
    }
  }
  if (lineErrors.length) return lineErrors;

  const approvedAt = input.now ?? new Date();
  for (const { channel, rejectedId } of prepared) {
    if (rejectedId) {
      await tx.platformAccount.update({
        where: { id: rejectedId },
        data: { status: AccountStatus.APPROVED, approvedAt, addedById: moderatorId },
        select: { id: true },
      });
    } else {
      await tx.platformAccount.create({
        data: { userId, addedById: moderatorId, platform: channel.platform, url: channel.url, status: AccountStatus.APPROVED, approvedAt },
        select: { id: true },
      });
    }
  }
  return [];
}
