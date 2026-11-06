import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { AccountStatus, Platform, PrismaClient } from "@prisma/client";
import { addApprovedChannelsToClipper, createClipperBundle } from "../src/lib/moderator-channel-operations.ts";

const prisma = new PrismaClient();
const prefix = () => `onboard_${randomUUID().replaceAll("-", "").slice(0, 14)}`;

test("moderator onboarding transaction rolls back bundles, approves channels, enforces limits, and reopens rejected channels", async () => {
  const createdUserIds = [];
  let moderatorId;
  try {
    const moderator = await prisma.user.create({ data: { login: prefix(), password: "integration-test-only", role: "MODERATOR" }, select: { id: true } });
    moderatorId = moderator.id;
    const owner = await prisma.user.create({ data: { login: prefix(), password: "integration-test-only" }, select: { id: true, login: true } });
    const target = await prisma.user.create({ data: { login: prefix(), password: "integration-test-only" }, select: { id: true } });
    const concurrentTarget = await prisma.user.create({ data: { login: prefix(), password: "integration-test-only" }, select: { id: true } });
    createdUserIds.push(owner.id, target.id, concurrentTarget.id);

    const claimedUrl = `https://tiktok.com/@${prefix()}`;
    await prisma.platformAccount.create({ data: { userId: owner.id, platform: Platform.TIKTOK, url: claimedUrl, status: AccountStatus.APPROVED } });
    const rollbackLogin = prefix();
    await assert.rejects(prisma.$transaction((tx) => createClipperBundle(tx, {
      login: rollbackLogin,
      passwordHash: "test-hash",
      addedById: moderatorId,
      channels: [
        { line: 1, platform: Platform.INSTAGRAM, url: `https://instagram.com/${prefix()}` },
        { line: 2, platform: Platform.TIKTOK, url: claimedUrl },
      ],
    })));
    assert.equal(await prisma.user.count({ where: { login: rollbackLogin } }), 0);

    const successfulLogin = prefix();
    const approvedAt = new Date();
    const newClipperId = await prisma.$transaction((tx) => createClipperBundle(tx, {
      login: successfulLogin,
      passwordHash: "test-hash",
      addedById: moderatorId,
      now: approvedAt,
      channels: [{ line: 1, platform: Platform.YOUTUBE, url: `https://youtube.com/@${prefix()}` }],
    }));
    createdUserIds.push(newClipperId);
    const createdAccount = await prisma.platformAccount.findFirstOrThrow({ where: { userId: newClipperId } });
    assert.equal(createdAccount.status, AccountStatus.APPROVED);
    assert.equal(createdAccount.addedById, moderatorId);
    assert.equal(createdAccount.approvedAt?.getTime(), approvedAt.getTime());

    for (let index = 0; index < 5; index += 1) {
      const url = `https://tiktok.com/@${prefix()}`;
      await prisma.platformAccount.create({
        data: {
          userId: target.id,
          platform: Platform.TIKTOK,
          url,
          status: index % 2 ? AccountStatus.PENDING : AccountStatus.APPROVED,
        },
      });
    }
    const rejectedUrl = `https://instagram.com/${prefix()}`;
    const rejected = await prisma.platformAccount.create({
      data: { userId: target.id, platform: Platform.INSTAGRAM, url: rejectedUrl, status: AccountStatus.REJECTED },
      select: { id: true },
    });

    const limitErrors = await prisma.$transaction((tx) => addApprovedChannelsToClipper(tx, {
      userId: target.id,
      moderatorId,
      channels: [{ line: 1, platform: Platform.TIKTOK, url: `https://tiktok.com/@${prefix()}` }],
    }));
    assert.ok(limitErrors.some((item) => item.line === 1));
    assert.equal(await prisma.platformAccount.count({ where: { userId: target.id, platform: Platform.TIKTOK, status: { in: ["PENDING", "APPROVED"] } } }), 5);

    const foreignErrors = await prisma.$transaction((tx) => addApprovedChannelsToClipper(tx, {
      userId: target.id,
      moderatorId,
      channels: [{ line: 7, platform: Platform.TIKTOK, url: claimedUrl }],
    }));
    assert.match(foreignErrors[0]?.reason ?? "", new RegExp(owner.login));

    for (let index = 0; index < 4; index += 1) {
      await prisma.platformAccount.create({
        data: { userId: concurrentTarget.id, platform: Platform.YOUTUBE, url: `https://youtube.com/@${prefix()}`, status: AccountStatus.APPROVED },
      });
    }
    const parallelAdds = await Promise.all([
      prisma.$transaction((tx) => addApprovedChannelsToClipper(tx, {
        userId: concurrentTarget.id,
        moderatorId,
        channels: [{ line: 1, platform: Platform.YOUTUBE, url: `https://youtube.com/@${prefix()}` }],
      })),
      prisma.$transaction((tx) => addApprovedChannelsToClipper(tx, {
        userId: concurrentTarget.id,
        moderatorId,
        channels: [{ line: 1, platform: Platform.YOUTUBE, url: `https://youtube.com/@${prefix()}` }],
      })),
    ]);
    assert.equal(parallelAdds.filter((errors) => errors.length === 0).length, 1);
    assert.equal(await prisma.platformAccount.count({ where: { userId: concurrentTarget.id, platform: Platform.YOUTUBE, status: { in: ["PENDING", "APPROVED"] } } }), 5);

    const reopenErrors = await prisma.$transaction((tx) => addApprovedChannelsToClipper(tx, {
      userId: target.id,
      moderatorId,
      channels: [{ line: 1, platform: Platform.INSTAGRAM, url: rejectedUrl }],
    }));
    assert.deepEqual(reopenErrors, []);
    const reopened = await prisma.platformAccount.findUniqueOrThrow({ where: { id: rejected.id } });
    assert.equal(reopened.status, AccountStatus.APPROVED);
    assert.equal(reopened.addedById, moderatorId);
    assert.ok(reopened.approvedAt);
    assert.equal(await prisma.platformAccount.count({ where: { userId: target.id, url: rejectedUrl } }), 1);
  } finally {
    const userIds = [...createdUserIds];
    if (moderatorId) userIds.push(moderatorId);
    if (userIds.length) {
      await prisma.platformAccount.deleteMany({ where: { OR: [{ userId: { in: userIds } }, { addedById: { in: userIds } }] } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
  }
  await prisma.$disconnect();
});
