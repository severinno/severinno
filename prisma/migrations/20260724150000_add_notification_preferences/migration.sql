-- Create notification preferences table

CREATE TABLE IF NOT EXISTS "NotificationPreference" (
  "id"              TEXT      NOT NULL,
  "userId"          TEXT      NOT NULL,
  "type"            TEXT      NOT NULL,
  "pushEnabled"     BOOLEAN  NOT NULL DEFAULT true,
  "emailEnabled"    BOOLEAN  NOT NULL DEFAULT true,
  "whatsappEnabled" BOOLEAN  NOT NULL DEFAULT true,
  "soundEnabled"    BOOLEAN  NOT NULL DEFAULT true,

  CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "NotificationPreference_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "NotificationPreference_userId_type_key"
  ON "NotificationPreference" ("userId", "type");

CREATE INDEX IF NOT EXISTS "idx_notification_preference_user"
  ON "NotificationPreference" ("userId");
