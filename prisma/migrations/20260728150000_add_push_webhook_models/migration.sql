-- Migration: add_push_webhook_models
-- Created: 2026-07-28
-- Description: Add push notification, webhook, analytics, and audit log tables

-- ============================================================================
-- 1. SCHEDULED PUSH NOTIFICATION — admin schedules push for future delivery
-- ============================================================================
-- status: "PENDING" | "SENT" | "CANCELLED" | "FAILED"

CREATE TABLE "ScheduledPushNotification" (
    "id" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "title" TEXT NOT NULL,
    "body" TEXT,
    "pushUrl" TEXT NOT NULL DEFAULT '/',
    "type" TEXT NOT NULL DEFAULT 'ADMIN_MANUAL',
    "userIds" JSONB NOT NULL DEFAULT '[]',
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "recurringId" TEXT,

    CONSTRAINT "ScheduledPushNotification_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ScheduledPushNotification_status_idx" ON "ScheduledPushNotification"("status");
CREATE INDEX "ScheduledPushNotification_scheduledAt_idx" ON "ScheduledPushNotification"("scheduledAt");
CREATE INDEX "ScheduledPushNotification_recurringId_idx" ON "ScheduledPushNotification"("recurringId");

-- ============================================================================
-- 2. EVENT WEBHOOK — configurable auto push triggers for system events
-- ============================================================================
-- event: "booking.created" | "booking.confirmed" | "booking.cancelled" |
--        "booking.completed" | "review.created" | "quote.received" |
--        "quote.responded" | "payment.confirmed" | "message.sent" |
--        "provider.registered"
-- targetRoles: JSON array of roles that receive the notification

CREATE TABLE "EventWebhook" (
    "id" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "pushUrl" TEXT NOT NULL DEFAULT '/',
    "targetRoles" JSONB NOT NULL DEFAULT '["PROVIDER"]',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventWebhook_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EventWebhook_event_title_key" ON "EventWebhook"("event", "title");
CREATE INDEX "EventWebhook_event_active_idx" ON "EventWebhook"("event", "active");

-- ============================================================================
-- 3. PUSH ANALYTICS — delivery metrics for push notifications
-- ============================================================================
-- source: "manual" | "auto" | "webhook" | "scheduled" | "cron"
-- status: "sent" | "delivered" | "clicked" | "bounced" | "failed"
-- action: "accept" | "reject" | "view"

CREATE TABLE "PushAnalytics" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "type" TEXT NOT NULL DEFAULT 'ADMIN_MANUAL',
    "source" TEXT NOT NULL DEFAULT 'manual',
    "status" TEXT NOT NULL DEFAULT 'sent',
    "deviceCount" INTEGER NOT NULL DEFAULT 0,
    "latencyMs" INTEGER,
    "clickedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "action" TEXT,
    "actionResult" TEXT,
    "bookingId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushAnalytics_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PushAnalytics_userId_idx" ON "PushAnalytics"("userId");
CREATE INDEX "PushAnalytics_status_idx" ON "PushAnalytics"("status");
CREATE INDEX "PushAnalytics_createdAt_idx" ON "PushAnalytics"("createdAt");
CREATE INDEX "PushAnalytics_type_idx" ON "PushAnalytics"("type");
CREATE INDEX "PushAnalytics_source_idx" ON "PushAnalytics"("source");
CREATE INDEX "PushAnalytics_action_idx" ON "PushAnalytics"("action");
CREATE INDEX "PushAnalytics_bookingId_idx" ON "PushAnalytics"("bookingId");

-- ============================================================================
-- 4. RECURRING PUSH SCHEDULE — notificações push que se repetem
-- ============================================================================
-- frequency: "daily" | "weekly" | "monthly"
-- status: "ACTIVE" | "PAUSED" | "ARCHIVED"

CREATE TABLE "RecurringPushSchedule" (
    "id" TEXT NOT NULL,
    "frequency" TEXT NOT NULL,
    "time" TEXT NOT NULL,
    "dayOfWeek" INTEGER,
    "dayOfMonth" INTEGER,
    "timezone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    "title" TEXT NOT NULL,
    "body" TEXT,
    "pushUrl" TEXT NOT NULL DEFAULT '/',
    "type" TEXT NOT NULL DEFAULT 'RECURRING',
    "targetRoles" JSONB NOT NULL DEFAULT '["CLIENT","PROVIDER"]',
    "filterCity" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "lastSentAt" TIMESTAMP(3),
    "totalSent" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecurringPushSchedule_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RecurringPushSchedule_status_frequency_idx" ON "RecurringPushSchedule"("status", "frequency");
CREATE INDEX "RecurringPushSchedule_status_time_idx" ON "RecurringPushSchedule"("status", "time");

-- ============================================================================
-- 5. NOTIFICATION PREFERENCE — per-user per-type notification toggles
-- ============================================================================

CREATE TABLE "NotificationPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "pushEnabled" BOOLEAN NOT NULL DEFAULT true,
    "emailEnabled" BOOLEAN NOT NULL DEFAULT true,
    "whatsappEnabled" BOOLEAN NOT NULL DEFAULT true,
    "soundEnabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NotificationPreference_userId_type_key" ON "NotificationPreference"("userId", "type");
CREATE INDEX "NotificationPreference_userId_idx" ON "NotificationPreference"("userId");

ALTER TABLE "NotificationPreference"
    ADD CONSTRAINT "NotificationPreference_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
-- 6. PUSH SEND LOG — audit trail for push notification batches
-- ============================================================================
-- action: "manual_send" | "manual_schedule" | "scheduled_send" | "recurring_send"

CREATE TABLE "PushSendLog" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "pushUrl" TEXT NOT NULL DEFAULT '/',
    "notificationType" TEXT NOT NULL DEFAULT 'ADMIN_MANUAL',
    "recipientCount" INTEGER NOT NULL DEFAULT 0,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "directPushCount" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushSendLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PushSendLog_adminId_idx" ON "PushSendLog"("adminId");
CREATE INDEX "PushSendLog_action_idx" ON "PushSendLog"("action");
CREATE INDEX "PushSendLog_createdAt_idx" ON "PushSendLog"("createdAt");
CREATE INDEX "PushSendLog_notificationType_idx" ON "PushSendLog"("notificationType");

ALTER TABLE "PushSendLog"
    ADD CONSTRAINT "PushSendLog_adminId_fkey"
    FOREIGN KEY ("adminId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
-- 7. WEBHOOK EXECUTION LOG — audit trail for event webhook firings
-- ============================================================================
-- status: "success" | "partial" | "failed"

CREATE TABLE "WebhookExecutionLog" (
    "id" TEXT NOT NULL,
    "webhookId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "pushUrl" TEXT,
    "targetRoles" JSONB,
    "usersFound" INTEGER NOT NULL DEFAULT 0,
    "usersSent" INTEGER NOT NULL DEFAULT 0,
    "usersFailed" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "status" TEXT NOT NULL DEFAULT 'success',
    "context" JSONB,
    "executionMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookExecutionLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WebhookExecutionLog_webhookId_idx" ON "WebhookExecutionLog"("webhookId");
CREATE INDEX "WebhookExecutionLog_event_idx" ON "WebhookExecutionLog"("event");
CREATE INDEX "WebhookExecutionLog_createdAt_idx" ON "WebhookExecutionLog"("createdAt");
CREATE INDEX "WebhookExecutionLog_status_idx" ON "WebhookExecutionLog"("status");

-- ============================================================================
-- 8. SEARCH REINDEX QUEUE — async queue for OpenSearch reindexing
-- ============================================================================
-- NOTE: Uses CREATE TABLE IF NOT EXISTS so it's safe to re-run.
-- The triggers that populate it are defined in migration
-- 20260724140000_auto_reindex_triggers.

CREATE TABLE IF NOT EXISTS "SearchReindexQueue" (
    "id" BIGSERIAL NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SearchReindexQueue_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SearchReindexQueue_createdAt_idx" ON "SearchReindexQueue"("createdAt");
