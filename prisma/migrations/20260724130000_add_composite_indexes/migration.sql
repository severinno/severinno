-- Composite indexes for common query patterns (Phase 2)
-- Target: queries that sort by date, filter by status/rating

-- 1. Review listing by provider (profile page: show reviews sorted by date)
CREATE INDEX IF NOT EXISTS idx_review_provider_rating_date
  ON "Review" ("providerId", "rating" DESC, "createdAt" DESC);

-- 2. Message conversation history (chat view between two users)
CREATE INDEX IF NOT EXISTS idx_message_conversation
  ON "Message" ("fromId", "toId", "createdAt" DESC);

-- 3. Notification center sorted by date
CREATE INDEX IF NOT EXISTS idx_notification_user_date
  ON "Notification" ("userId", "createdAt" DESC);

-- 4. Provider quotes dashboard (sorted by most recent)
CREATE INDEX IF NOT EXISTS idx_quoterequest_provider_status_date
  ON "QuoteRequest" ("providerId", "status", "createdAt" DESC);

-- 5. Client quotes dashboard
CREATE INDEX IF NOT EXISTS idx_quoterequest_client_status_date
  ON "QuoteRequest" ("clientId", "status", "createdAt" DESC);

-- 6. Provider agenda view (filter by status + scheduled date)
CREATE INDEX IF NOT EXISTS idx_booking_provider_status_scheduled
  ON "Booking" ("providerId", "status", "scheduledAt");

-- 7. Active services for a provider (provider dashboard, excludes soft-deleted)
CREATE INDEX IF NOT EXISTS idx_service_provider_active
  ON "Service" ("providerId", "active", "deletedAt")
  WHERE active = true;

-- 8. Favorite lookup sorted by date (recent favorites)
CREATE INDEX IF NOT EXISTS idx_favorite_client_date
  ON "Favorite" ("clientId", "createdAt" DESC);

-- 9. Payment status lookup (admin finance dashboard)
CREATE INDEX IF NOT EXISTS idx_payment_booking_status
  ON "Payment" ("bookingId", "status");
