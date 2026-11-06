ALTER TABLE "Notification" ADD COLUMN "lastErrorCode" TEXT;

ALTER TABLE "Notification"
ADD CONSTRAINT "Notification_lastErrorCode_length_check"
CHECK ("lastErrorCode" IS NULL OR char_length("lastErrorCode") <= 64);
