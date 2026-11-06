import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { PrismaClient, Role, Platform, AccountStatus, SubmissionStatus } from "@prisma/client";

const prisma = new PrismaClient();
const unique = () => randomUUID().replaceAll("-", "");

test("database trigger rejects the fourth attachment and transaction rollback leaves no records", async () => {
  const userLogin = `attach_${unique().slice(0, 20)}`;
  let ids;
  try {
    await assert.rejects(prisma.$transaction(async (tx) => {
      const user = await tx.user.create({ data: { login: userLogin, password: "integration-only", role: Role.CLIPPER } });
      const account = await tx.platformAccount.create({
        data: { userId: user.id, platform: Platform.TIKTOK, url: `https://www.tiktok.com/@${unique()}`, status: AccountStatus.APPROVED },
      });
      const submission = await tx.submission.create({
        data: {
          userId: user.id,
          accountId: account.id,
          videoUrl: `https://www.tiktok.com/video/${unique()}`,
          publishedAt: new Date(),
          weekStart: new Date(),
          status: SubmissionStatus.PENDING,
        },
      });
      const message = await tx.message.create({ data: { submissionId: submission.id, authorId: user.id, text: "" } });
      ids = { userId: user.id, messageId: message.id };

      const attachmentIds = [];
      for (let index = 0; index < 3; index += 1) {
        const attachment = await tx.messageAttachment.create({
          data: {
            messageId: message.id,
            storageKey: `${randomUUID()}.png`,
            mime: "image/png",
            sizeBytes: 64,
            width: 4,
            height: 4,
          },
        });
        attachmentIds.push(attachment.id);
      }
      await tx.$executeRawUnsafe("SAVEPOINT attachment_limit_test");
      await assert.rejects(tx.messageAttachment.create({
        data: {
          messageId: message.id,
          storageKey: `${randomUUID()}.png`,
          mime: "image/png",
          sizeBytes: 64,
          width: 4,
          height: 4,
        },
      }));
      await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT attachment_limit_test");
      const retained = await tx.messageAttachment.count({ where: { messageId: message.id } });
      assert.equal(retained, 3, "fourth insert failure leaves the first three intact");

      await tx.$executeRawUnsafe("SAVEPOINT attachment_update_test");
      await assert.rejects(tx.messageAttachment.update({ where: { id: attachmentIds[0] }, data: { sizeBytes: 65 } }), /attachments are immutable/);
      await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT attachment_update_test");
      assert.equal(await tx.messageAttachment.count({ where: { messageId: message.id } }), 3);

      await tx.messageAttachment.delete({ where: { id: attachmentIds[0] } });
      assert.equal(await tx.messageAttachment.count({ where: { messageId: message.id } }), 2, "DELETE remains allowed");
      throw new Error("ROLLBACK_ATTACHMENT_TEST_TRANSACTION");
    }), /ROLLBACK_ATTACHMENT_TEST_TRANSACTION/);
  } finally {
    const user = await prisma.user.findUnique({ where: { login: userLogin }, select: { id: true } });
    assert.equal(user, null, "the outer transaction must roll back all created records");
    await prisma.$disconnect();
  }
  assert.ok(ids);
});
