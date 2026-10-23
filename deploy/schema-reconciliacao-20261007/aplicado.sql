BEGIN;

-- ==== §A0. DESARME TOTAL de triggers de negócio (snapshot prévio) ====
DROP TRIGGER IF EXISTS trg_search_reindex_category ON "Category";
DROP TRIGGER IF EXISTS trg_refresh_mv_on_review ON "Review";
DROP TRIGGER IF EXISTS trg_refresh_mv_on_favorite ON "Favorite";
DROP TRIGGER IF EXISTS trg_search_reindex_service ON "Service";
DROP TRIGGER IF EXISTS trg_service_search_vector ON "Service";
DROP TRIGGER IF EXISTS trg_sync_user_location ON "User";
DROP TRIGGER IF EXISTS trg_user_search_vector ON "User";
DROP TRIGGER IF EXISTS trg_search_reindex_user ON "User";
DROP TRIGGER IF EXISTS trg_sync_booking_location ON "Booking";
DROP TRIGGER IF EXISTS trg_refresh_mv_on_booking ON "Booking";
DROP TRIGGER IF EXISTS trg_sync_quoterequest_location ON "QuoteRequest";
DROP MATERIALIZED VIEW IF EXISTS mv_provider_stats;

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('CLIENT', 'PROVIDER', 'ADMIN');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('PENDING', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CARD', 'PIX');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'AUTHORIZED', 'HELD', 'PAID', 'REFUNDED', 'FAILED');

-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('PENDING', 'RESPONDED', 'APPROVED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "QuoteItemStatus" AS ENUM ('PENDING', 'QUOTED', 'ACCEPTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ServiceUnit" AS ENUM ('UNIDADE', 'METRO_LINEAR', 'METRO_QUADRADO', 'METRO_CUBICO', 'HORA');

-- DropForeignKey
ALTER TABLE "Booking" DROP CONSTRAINT "Booking_quoteId_fkey";

-- DropForeignKey
ALTER TABLE "NotificationPreference" DROP CONSTRAINT "NotificationPreference_userId_fkey";

-- DropIndex
DROP INDEX "idx_booking_client_scheduled";

-- DropIndex
DROP INDEX "idx_booking_provider_scheduled";

-- DropIndex
DROP INDEX "idx_favorite_client_date";

-- DropIndex
DROP INDEX "idx_message_conversation";

-- DropIndex
DROP INDEX "idx_notification_user_date";

-- DropIndex
DROP INDEX "Payment_gatewayId_idx";

-- DropIndex
DROP INDEX "idx_payment_booking_status";

-- DropIndex
DROP INDEX "idx_quoterequest_client_status_date";

-- DropIndex
DROP INDEX "idx_quoterequest_provider_status_date";

-- DropIndex
DROP INDEX "idx_review_provider_rating";

-- DropIndex
DROP INDEX "idx_review_provider_rating_date";

-- DropIndex
DROP INDEX "idx_service_search_vector";

-- DropIndex
DROP INDEX "User_role_idx";

-- DropIndex
DROP INDEX "idx_user_search_vector";

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "afterPhotos" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "beforePhotos" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "completionNote" TEXT,
ADD COLUMN     "escrowDisputeReason" TEXT,
ADD COLUMN     "escrowReleasedAt" TIMESTAMP(3),
ADD COLUMN     "geofenceAlertSentAt" TIMESTAMP(3),
DROP COLUMN "status",
ADD COLUMN     "status" "BookingStatus" NOT NULL DEFAULT 'PENDING',
ALTER COLUMN "amount" SET DATA TYPE DECIMAL(10,2),
DROP COLUMN "paymentMethod",
ADD COLUMN     "paymentMethod" "PaymentMethod" NOT NULL DEFAULT 'PIX',
DROP COLUMN "paymentStatus",
ADD COLUMN     "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
ALTER COLUMN "deletedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Category" ADD COLUMN     "description" TEXT,
ADD COLUMN     "search_vector" tsvector;

-- AlterTable
ALTER TABLE "Favorite" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "Payment" DROP COLUMN "checkoutUrl",
DROP COLUMN "gatewayHashId",
DROP COLUMN "gatewayId",
DROP COLUMN "gatewayMetadata",
DROP COLUMN "gatewayPaidAt",
ADD COLUMN     "cardBrand" TEXT,
ADD COLUMN     "cardLastDigits" TEXT,
ADD COLUMN     "installments" INTEGER,
ADD COLUMN     "lytexId" TEXT,
ADD COLUMN     "lytexRawResponse" JSONB,
ADD COLUMN     "lytexStatus" TEXT,
ADD COLUMN     "paidAt" TIMESTAMP(3),
ADD COLUMN     "qrCode" TEXT,
ADD COLUMN     "qrCodeImage" TEXT,
ALTER COLUMN "amount" SET DATA TYPE DECIMAL(10,2),
DROP COLUMN "method",
ADD COLUMN     "method" "PaymentMethod" NOT NULL DEFAULT 'PIX',
DROP COLUMN "status",
ADD COLUMN     "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING';

-- AlterTable
ALTER TABLE "PushSubscription" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "QuoteItem" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL,
DROP COLUMN "unit",
ADD COLUMN     "unit" "ServiceUnit" NOT NULL DEFAULT 'UNIDADE',
ALTER COLUMN "price" SET DATA TYPE DECIMAL(10,2),
DROP COLUMN "status",
ADD COLUMN     "status" "QuoteItemStatus" NOT NULL DEFAULT 'PENDING';

-- AlterTable
ALTER TABLE "QuoteRequest" DROP COLUMN "status",
ADD COLUMN     "status" "QuoteStatus" NOT NULL DEFAULT 'PENDING';

-- AlterTable
ALTER TABLE "ResetToken" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "Review" ADD COLUMN     "photos" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "providerComment" TEXT,
ADD COLUMN     "providerRating" INTEGER,
ADD COLUMN     "providerReply" TEXT,
ADD COLUMN     "providerReplyAt" TIMESTAMP(3),
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "Service" ADD COLUMN     "duration" INTEGER,
ALTER COLUMN "basePrice" SET DATA TYPE DECIMAL(10,2),
DROP COLUMN "unit",
ADD COLUMN     "unit" "ServiceUnit" NOT NULL DEFAULT 'UNIDADE',
ALTER COLUMN "deletedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Setting" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "avgRating" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "cityId" TEXT,
ADD COLUMN     "favoriteCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "gpsAccuracyM" DOUBLE PRECISION,
ADD COLUMN     "identityDocUrl" TEXT,
ADD COLUMN     "identitySelfieUrl" TEXT,
ADD COLUMN     "identityStatus" TEXT,
ADD COLUMN     "identityVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "reviewCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "servicePolygon" JSONB,
ADD COLUMN     "sessionVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "soundEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "travelFeePolicy" JSONB,
ADD COLUMN     "twoFactorBackupCodes" TEXT,
ADD COLUMN     "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "twoFactorSecret" TEXT,
ADD COLUMN     "vibrateEnabled" BOOLEAN NOT NULL DEFAULT true,
DROP COLUMN "role",
ADD COLUMN     "role" "Role" NOT NULL DEFAULT 'CLIENT',
ALTER COLUMN "deletedAt" SET DATA TYPE TIMESTAMP(3);

-- CreateTable
CREATE TABLE "City" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "state" TEXT,
    "country" TEXT NOT NULL DEFAULT 'BR',
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "timezone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "City_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Waypoint" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "label" TEXT,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "arrivalEstimate" TIMESTAMP(3),
    "arrivedAt" TIMESTAMP(3),
    "geofenceRadiusMeters" INTEGER NOT NULL DEFAULT 200,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Waypoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dispute" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "resolution" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "Dispute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyRecord" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'pay:create',
    "context" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'processing',
    "response" JSONB,
    "error" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SettlementPeriod" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'WEEKLY',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "totalCommission" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "totalNet" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "providerCount" INTEGER NOT NULL DEFAULT 0,
    "transactionCount" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "finalizedAt" TIMESTAMP(3),
    "finalizedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SettlementPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderSettlement" (
    "id" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "totalAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "commission" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "netAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "transactionCount" INTEGER NOT NULL DEFAULT 0,
    "paidAt" TIMESTAMP(3),
    "paidBy" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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

-- CreateTable
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

-- CreateTable
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

-- CreateTable
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
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PushAnalytics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletTransaction" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WalletTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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

-- CreateTable
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
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebhookExecutionLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
DROP INDEX IF EXISTS "City_slug_key";
CREATE UNIQUE INDEX "City_slug_key" ON "City"("slug");

-- CreateIndex
DROP INDEX IF EXISTS "City_active_idx";
CREATE INDEX "City_active_idx" ON "City"("active");

-- CreateIndex
DROP INDEX IF EXISTS "Waypoint_bookingId_idx";
CREATE INDEX "Waypoint_bookingId_idx" ON "Waypoint"("bookingId");

-- CreateIndex
DROP INDEX IF EXISTS "Waypoint_bookingId_order_idx";
CREATE INDEX "Waypoint_bookingId_order_idx" ON "Waypoint"("bookingId", "order");

-- CreateIndex
DROP INDEX IF EXISTS "Waypoint_bookingId_arrivedAt_idx";
CREATE INDEX "Waypoint_bookingId_arrivedAt_idx" ON "Waypoint"("bookingId", "arrivedAt");

-- CreateIndex
DROP INDEX IF EXISTS "Dispute_bookingId_idx";
CREATE INDEX "Dispute_bookingId_idx" ON "Dispute"("bookingId");

-- CreateIndex
DROP INDEX IF EXISTS "Dispute_status_idx";
CREATE INDEX "Dispute_status_idx" ON "Dispute"("status");

-- CreateIndex
DROP INDEX IF EXISTS "IdempotencyRecord_key_key";
CREATE UNIQUE INDEX "IdempotencyRecord_key_key" ON "IdempotencyRecord"("key");

-- CreateIndex
DROP INDEX IF EXISTS "IdempotencyRecord_expiresAt_idx";
CREATE INDEX "IdempotencyRecord_expiresAt_idx" ON "IdempotencyRecord"("expiresAt");

-- CreateIndex
DROP INDEX IF EXISTS "IdempotencyRecord_scope_createdAt_idx";
CREATE INDEX "IdempotencyRecord_scope_createdAt_idx" ON "IdempotencyRecord"("scope", "createdAt");

-- CreateIndex
DROP INDEX IF EXISTS "SettlementPeriod_status_idx";
CREATE INDEX "SettlementPeriod_status_idx" ON "SettlementPeriod"("status");

-- CreateIndex
DROP INDEX IF EXISTS "SettlementPeriod_startDate_endDate_idx";
CREATE INDEX "SettlementPeriod_startDate_endDate_idx" ON "SettlementPeriod"("startDate", "endDate");

-- CreateIndex
DROP INDEX IF EXISTS "ProviderSettlement_periodId_idx";
CREATE INDEX "ProviderSettlement_periodId_idx" ON "ProviderSettlement"("periodId");

-- CreateIndex
DROP INDEX IF EXISTS "ProviderSettlement_providerId_idx";
CREATE INDEX "ProviderSettlement_providerId_idx" ON "ProviderSettlement"("providerId");

-- CreateIndex
DROP INDEX IF EXISTS "ProviderSettlement_status_idx";
CREATE INDEX "ProviderSettlement_status_idx" ON "ProviderSettlement"("status");

-- CreateIndex
DROP INDEX IF EXISTS "ProviderSettlement_periodId_providerId_key";
CREATE UNIQUE INDEX "ProviderSettlement_periodId_providerId_key" ON "ProviderSettlement"("periodId", "providerId");

-- CreateIndex
DROP INDEX IF EXISTS "ScheduledPushNotification_status_idx";
CREATE INDEX "ScheduledPushNotification_status_idx" ON "ScheduledPushNotification"("status");

-- CreateIndex
DROP INDEX IF EXISTS "ScheduledPushNotification_scheduledAt_idx";
CREATE INDEX "ScheduledPushNotification_scheduledAt_idx" ON "ScheduledPushNotification"("scheduledAt");

-- CreateIndex
DROP INDEX IF EXISTS "ScheduledPushNotification_recurringId_idx";
CREATE INDEX "ScheduledPushNotification_recurringId_idx" ON "ScheduledPushNotification"("recurringId");

-- CreateIndex
DROP INDEX IF EXISTS "ScheduledPushNotification_status_scheduledAt_idx";
CREATE INDEX "ScheduledPushNotification_status_scheduledAt_idx" ON "ScheduledPushNotification"("status", "scheduledAt");

-- CreateIndex
DROP INDEX IF EXISTS "RecurringPushSchedule_status_frequency_idx";
CREATE INDEX "RecurringPushSchedule_status_frequency_idx" ON "RecurringPushSchedule"("status", "frequency");

-- CreateIndex
DROP INDEX IF EXISTS "RecurringPushSchedule_status_time_idx";
CREATE INDEX "RecurringPushSchedule_status_time_idx" ON "RecurringPushSchedule"("status", "time");

-- CreateIndex
DROP INDEX IF EXISTS "EventWebhook_event_active_idx";
CREATE INDEX "EventWebhook_event_active_idx" ON "EventWebhook"("event", "active");

-- CreateIndex
DROP INDEX IF EXISTS "EventWebhook_event_title_key";
CREATE UNIQUE INDEX "EventWebhook_event_title_key" ON "EventWebhook"("event", "title");

-- CreateIndex
DROP INDEX IF EXISTS "PushAnalytics_userId_idx";
CREATE INDEX "PushAnalytics_userId_idx" ON "PushAnalytics"("userId");

-- CreateIndex
DROP INDEX IF EXISTS "PushAnalytics_status_idx";
CREATE INDEX "PushAnalytics_status_idx" ON "PushAnalytics"("status");

-- CreateIndex
DROP INDEX IF EXISTS "PushAnalytics_createdAt_idx";
CREATE INDEX "PushAnalytics_createdAt_idx" ON "PushAnalytics"("createdAt");

-- CreateIndex
DROP INDEX IF EXISTS "PushAnalytics_type_idx";
CREATE INDEX "PushAnalytics_type_idx" ON "PushAnalytics"("type");

-- CreateIndex
DROP INDEX IF EXISTS "PushAnalytics_source_idx";
CREATE INDEX "PushAnalytics_source_idx" ON "PushAnalytics"("source");

-- CreateIndex
DROP INDEX IF EXISTS "PushAnalytics_action_idx";
CREATE INDEX "PushAnalytics_action_idx" ON "PushAnalytics"("action");

-- CreateIndex
DROP INDEX IF EXISTS "PushAnalytics_bookingId_idx";
CREATE INDEX "PushAnalytics_bookingId_idx" ON "PushAnalytics"("bookingId");

-- CreateIndex
DROP INDEX IF EXISTS "WalletTransaction_providerId_idx";
CREATE INDEX "WalletTransaction_providerId_idx" ON "WalletTransaction"("providerId");

-- CreateIndex
DROP INDEX IF EXISTS "WalletTransaction_status_idx";
CREATE INDEX "WalletTransaction_status_idx" ON "WalletTransaction"("status");

-- CreateIndex
DROP INDEX IF EXISTS "PushSendLog_adminId_idx";
CREATE INDEX "PushSendLog_adminId_idx" ON "PushSendLog"("adminId");

-- CreateIndex
DROP INDEX IF EXISTS "PushSendLog_action_idx";
CREATE INDEX "PushSendLog_action_idx" ON "PushSendLog"("action");

-- CreateIndex
DROP INDEX IF EXISTS "PushSendLog_createdAt_idx";
CREATE INDEX "PushSendLog_createdAt_idx" ON "PushSendLog"("createdAt");

-- CreateIndex
DROP INDEX IF EXISTS "PushSendLog_notificationType_idx";
CREATE INDEX "PushSendLog_notificationType_idx" ON "PushSendLog"("notificationType");

-- CreateIndex
DROP INDEX IF EXISTS "WebhookExecutionLog_webhookId_idx";
CREATE INDEX "WebhookExecutionLog_webhookId_idx" ON "WebhookExecutionLog"("webhookId");

-- CreateIndex
DROP INDEX IF EXISTS "WebhookExecutionLog_event_idx";
CREATE INDEX "WebhookExecutionLog_event_idx" ON "WebhookExecutionLog"("event");

-- CreateIndex
DROP INDEX IF EXISTS "WebhookExecutionLog_createdAt_idx";
CREATE INDEX "WebhookExecutionLog_createdAt_idx" ON "WebhookExecutionLog"("createdAt");

-- CreateIndex
DROP INDEX IF EXISTS "WebhookExecutionLog_status_idx";
CREATE INDEX "WebhookExecutionLog_status_idx" ON "WebhookExecutionLog"("status");

-- CreateIndex
DROP INDEX IF EXISTS "Booking_status_idx";
CREATE INDEX "Booking_status_idx" ON "Booking"("status");

-- CreateIndex
DROP INDEX IF EXISTS "Booking_paymentStatus_idx";
CREATE INDEX "Booking_paymentStatus_idx" ON "Booking"("paymentStatus");

-- CreateIndex
DROP INDEX IF EXISTS "Booking_paymentStatus_createdAt_idx";
CREATE INDEX "Booking_paymentStatus_createdAt_idx" ON "Booking"("paymentStatus", "createdAt");

-- CreateIndex
DROP INDEX IF EXISTS "Booking_providerId_status_scheduledAt_idx";
CREATE INDEX "Booking_providerId_status_scheduledAt_idx" ON "Booking"("providerId", "status", "scheduledAt");

-- CreateIndex
DROP INDEX IF EXISTS "Booking_clientId_status_scheduledAt_idx";
CREATE INDEX "Booking_clientId_status_scheduledAt_idx" ON "Booking"("clientId", "status", "scheduledAt");

-- CreateIndex
DROP INDEX IF EXISTS "Message_fromId_toId_createdAt_idx";
CREATE INDEX "Message_fromId_toId_createdAt_idx" ON "Message"("fromId", "toId", "createdAt");

-- CreateIndex
DROP INDEX IF EXISTS "Notification_userId_createdAt_idx";
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- CreateIndex
DROP INDEX IF EXISTS "Notification_userId_read_createdAt_idx";
CREATE INDEX "Notification_userId_read_createdAt_idx" ON "Notification"("userId", "read", "createdAt");

-- CreateIndex
DROP INDEX IF EXISTS "Payment_lytexId_key";
CREATE UNIQUE INDEX "Payment_lytexId_key" ON "Payment"("lytexId");

-- CreateIndex
DROP INDEX IF EXISTS "Payment_status_idx";
CREATE INDEX "Payment_status_idx" ON "Payment"("status");

-- CreateIndex
DROP INDEX IF EXISTS "Payment_status_createdAt_idx";
CREATE INDEX "Payment_status_createdAt_idx" ON "Payment"("status", "createdAt");

-- CreateIndex
DROP INDEX IF EXISTS "Payment_lytexId_idx";
CREATE INDEX "Payment_lytexId_idx" ON "Payment"("lytexId");

-- CreateIndex
DROP INDEX IF EXISTS "Payment_lytexStatus_idx";
CREATE INDEX "Payment_lytexStatus_idx" ON "Payment"("lytexStatus");

-- CreateIndex
DROP INDEX IF EXISTS "QuoteRequest_status_idx";
CREATE INDEX "QuoteRequest_status_idx" ON "QuoteRequest"("status");

-- CreateIndex
DROP INDEX IF EXISTS "Review_providerId_createdAt_idx";
CREATE INDEX "Review_providerId_createdAt_idx" ON "Review"("providerId", "createdAt");

-- CreateIndex
DROP INDEX IF EXISTS "Review_providerId_rating_idx";
CREATE INDEX "Review_providerId_rating_idx" ON "Review"("providerId", "rating");

-- CreateIndex
DROP INDEX IF EXISTS "Service_categoryId_active_idx";
CREATE INDEX "Service_categoryId_active_idx" ON "Service"("categoryId", "active");

-- CreateIndex
DROP INDEX IF EXISTS "User_slug_key";
CREATE UNIQUE INDEX "User_slug_key" ON "User"("slug");

-- CreateIndex
DROP INDEX IF EXISTS "User_role_active_verified_idx";
CREATE INDEX "User_role_active_verified_idx" ON "User"("role", "active", "verified");

-- CreateIndex
DROP INDEX IF EXISTS "User_deletedAt_idx";
CREATE INDEX "User_deletedAt_idx" ON "User"("deletedAt");

-- CreateIndex
DROP INDEX IF EXISTS "User_city_active_verified_idx";
CREATE INDEX "User_city_active_verified_idx" ON "User"("city", "active", "verified");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "QuoteRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Waypoint" ADD CONSTRAINT "Waypoint_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderSettlement" ADD CONSTRAINT "ProviderSettlement_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "SettlementPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderSettlement" ADD CONSTRAINT "ProviderSettlement_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushAnalytics" ADD CONSTRAINT "PushAnalytics_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushAnalytics" ADD CONSTRAINT "PushAnalytics_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushSendLog" ADD CONSTRAINT "PushSendLog_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookExecutionLog" ADD CONSTRAINT "WebhookExecutionLog_webhookId_fkey" FOREIGN KEY ("webhookId") REFERENCES "EventWebhook"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
DO $$ BEGIN
  ALTER INDEX "idx_booking_provider_status_scheduled" RENAME TO "Booking_providerId_status_scheduledAt_idx";
EXCEPTION WHEN undefined_object THEN NULL; WHEN undefined_table THEN NULL; WHEN duplicate_object THEN NULL; END $$;

-- RenameIndex
DO $$ BEGIN
  ALTER INDEX "idx_notification_preference_user" RENAME TO "NotificationPreference_userId_idx";
EXCEPTION WHEN undefined_object THEN NULL; WHEN undefined_table THEN NULL; WHEN duplicate_object THEN NULL; END $$;



-- ==== §B0. MV recriada (antes dos triggers que a usam) ====
CREATE MATERIALIZED VIEW mv_provider_stats AS
SELECT u.id AS provider_id,
  COALESCE(AVG(r.rating)::float8, 0) AS avg_rating,
  COUNT(r.id)::int AS review_count,
  COUNT(DISTINCT b.id) FILTER (WHERE b.status = 'COMPLETED')::int AS completed_booking_count,
  COUNT(DISTINCT f.id)::int AS favorite_count
FROM "User" u
LEFT JOIN "Review" r ON r."providerId" = u.id
LEFT JOIN "Booking" b ON b."providerId" = u.id
LEFT JOIN "Favorite" f ON f."providerId" = u.id
WHERE u.role = 'PROVIDER'
GROUP BY u.id
WITH DATA;
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_provider_stats_provider_id ON mv_provider_stats (provider_id);
CREATE INDEX IF NOT EXISTS idx_mv_provider_stats_avg_rating_desc ON mv_provider_stats (avg_rating DESC);
CREATE INDEX IF NOT EXISTS idx_mv_provider_stats_completed_bookings_desc ON mv_provider_stats (completed_booking_count DESC);

-- ==== §C. RECONSTRUÇÃO: snapshot capturado ANTES (pg_get_triggerdef) ====
CREATE TRIGGER trg_search_reindex_category AFTER INSERT OR DELETE OR UPDATE OF name, slug, active, "parentId" ON public."Category" FOR EACH ROW EXECUTE FUNCTION notify_search_reindex();
CREATE TRIGGER trg_refresh_mv_on_review AFTER INSERT OR DELETE OR UPDATE ON public."Review" FOR EACH STATEMENT EXECUTE FUNCTION refresh_mv_provider_stats();
CREATE TRIGGER trg_refresh_mv_on_favorite AFTER INSERT OR DELETE OR UPDATE ON public."Favorite" FOR EACH STATEMENT EXECUTE FUNCTION refresh_mv_provider_stats();
CREATE TRIGGER trg_search_reindex_service AFTER INSERT OR DELETE OR UPDATE OF title, description, "basePrice", unit, "categoryId", active, "deletedAt" ON public."Service" FOR EACH ROW EXECUTE FUNCTION notify_search_reindex();
CREATE TRIGGER trg_service_search_vector BEFORE INSERT OR UPDATE ON public."Service" FOR EACH ROW EXECUTE FUNCTION service_search_vector_update();
CREATE TRIGGER trg_sync_user_location BEFORE INSERT OR UPDATE OF lat, lng ON public."User" FOR EACH ROW EXECUTE FUNCTION sync_user_location();
CREATE TRIGGER trg_user_search_vector BEFORE INSERT OR UPDATE OF name, bio, city, district, street ON public."User" FOR EACH ROW EXECUTE FUNCTION user_search_vector_update();
CREATE TRIGGER trg_search_reindex_user AFTER INSERT OR DELETE OR UPDATE OF name, bio, city, state, district, lat, lng, verified, active, "deletedAt" ON public."User" FOR EACH ROW EXECUTE FUNCTION notify_search_reindex();
CREATE TRIGGER trg_sync_booking_location BEFORE INSERT OR UPDATE OF lat, lng ON public."Booking" FOR EACH ROW EXECUTE FUNCTION sync_booking_location();
CREATE TRIGGER trg_refresh_mv_on_booking AFTER INSERT OR DELETE OR UPDATE ON public."Booking" FOR EACH STATEMENT EXECUTE FUNCTION refresh_mv_provider_stats();
CREATE TRIGGER trg_sync_quoterequest_location BEFORE INSERT OR UPDATE OF lat, lng ON public."QuoteRequest" FOR EACH ROW EXECUTE FUNCTION sync_quoterequest_location();


-- ==== §D. APÊNDICE: índices hand-made ====
CREATE INDEX IF NOT EXISTS idx_service_search_vector ON "Service" USING GIN (search_vector);
CREATE INDEX IF NOT EXISTS idx_user_search_vector ON "User" USING GIN (search_vector);
CREATE INDEX IF NOT EXISTS idx_user_keyset_rating
ON "User" ((-COALESCE("avgRating", -1)), (-COALESCE("favoriteCount", 0)), id)
WHERE role = 'PROVIDER' AND active = true AND verified = true AND "deletedAt" IS NULL;
CREATE INDEX IF NOT EXISTS idx_user_location_visible_gist
ON "User" USING GIST (location)
WHERE role = 'PROVIDER' AND active = true AND verified = true AND "deletedAt" IS NULL;

COMMIT;
