-- Missing composite indexes for common query patterns (Phase 3)
-- Identified by query analysis: dashboard filters + notification queries

-- 1. Client dashboard: bookings by client, filtered by status, sorted by scheduled
CREATE INDEX IF NOT EXISTS idx_booking_client_status_scheduled
  ON "Booking" ("clientId", "status", "scheduledAt" DESC);

-- 2. Notification unread count + list (userId, read flag, creation date)
CREATE INDEX IF NOT EXISTS idx_notification_user_read_date
  ON "Notification" ("userId", "read", "createdAt" DESC);

-- 3. Message timeline in booking detail view
CREATE INDEX IF NOT EXISTS idx_message_booking_date
  ON "Message" ("bookingId", "createdAt" ASC);

-- 4. Wallet history for providers (transaction log)
CREATE INDEX IF NOT EXISTS idx_wallet_transaction_provider_date
  ON "WalletTransaction" ("providerId", "createdAt" DESC);

-- 5. QuoteRequest items by provider (for provider response dashboard)
CREATE INDEX IF NOT EXISTS idx_quoteitem_provider_request
  ON "QuoteItem" ("providerId", "requestId");

-- 6. Service listing price sort (category filter + price order)
CREATE INDEX IF NOT EXISTS idx_service_category_active_price
  ON "Service" ("categoryId", "active", "basePrice")
  WHERE active = true;

-- 7. Review booking lookup (admin panel, dispute resolution)
CREATE INDEX IF NOT EXISTS idx_review_booking_rating
  ON "Review" ("bookingId", "rating");
