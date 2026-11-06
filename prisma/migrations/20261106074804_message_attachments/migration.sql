-- CreateTable
CREATE TABLE "MessageAttachment" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageAttachment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Message_authorId_createdAt_idx" ON "Message"("authorId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MessageAttachment_storageKey_key" ON "MessageAttachment"("storageKey");

-- CreateIndex
CREATE INDEX "MessageAttachment_messageId_createdAt_id_idx" ON "MessageAttachment"("messageId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "MessageAttachment_createdAt_idx" ON "MessageAttachment"("createdAt");

-- AddForeignKey
ALTER TABLE "MessageAttachment" ADD CONSTRAINT "MessageAttachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Keep attachment metadata within the formats and limits enforced by the upload pipeline.
ALTER TABLE "MessageAttachment" ADD CONSTRAINT "MessageAttachment_metadata_check" CHECK (
    "storageKey" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp)$' AND
    "mime" IN ('image/jpeg', 'image/png', 'image/webp') AND
    "sizeBytes" BETWEEN 1 AND 8388608 AND
    "width" BETWEEN 1 AND 8000 AND
    "height" BETWEEN 1 AND 8000 AND
    "width" * "height" <= 40000000
);

CREATE FUNCTION "enforce_message_attachment_limit"() RETURNS trigger AS $$
DECLARE
    existing_count integer;
BEGIN
    PERFORM 1 FROM "Message" WHERE "id" = NEW."messageId" FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'message does not exist for attachment' USING ERRCODE = '23503';
    END IF;

    SELECT count(*) INTO existing_count
    FROM "MessageAttachment"
    WHERE "messageId" = NEW."messageId";

    IF existing_count >= 3 THEN
        RAISE EXCEPTION 'a message may have at most three attachments'
            USING ERRCODE = '23514', CONSTRAINT = 'MessageAttachment_max_three_check';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER "MessageAttachment_max_three_trigger"
BEFORE INSERT ON "MessageAttachment"
FOR EACH ROW EXECUTE FUNCTION "enforce_message_attachment_limit"();

CREATE FUNCTION "prevent_message_attachment_update"() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'attachments are immutable' USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER "MessageAttachment_immutable_update_trigger"
BEFORE UPDATE ON "MessageAttachment"
FOR EACH ROW EXECUTE FUNCTION "prevent_message_attachment_update"();
