-- Migration: Índices Parciais Condicionais para Alta Performance (Camada 2)
-- Reduz o consumo de buffer cache e elimina scans de tabelas quentes (Booking, Notification, Payment, QuoteRequest, Dispute, User).

-- 1. Booking: Índice parcial para chamadas pendentes (matching, claim, dispatch relâmpago)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_booking_pending_partial
ON "Booking" ("providerId", "scheduledAt", "createdAt")
WHERE status = 'PENDING';

-- 2. Booking: Índice parcial para agendamentos em andamento (tracking ao vivo, SSE, geofence)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_booking_in_progress_partial
ON "Booking" ("providerId", "clientId", "scheduledAt")
WHERE status = 'IN_PROGRESS';

-- 3. Booking: Índice parcial para agendamentos ativos em geral (evita carregar COMPLETED e CANCELLED)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_booking_active_partial
ON "Booking" ("id", "providerId", "clientId", "status", "scheduledAt")
WHERE status IN ('PENDING', 'CONFIRMED', 'IN_PROGRESS');

-- 4. Notification: Índice parcial para notificações não lidas (badge de balão e lista de pendências)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notification_unread_partial
ON "Notification" ("userId", "createdAt" DESC)
WHERE read = false;

-- 5. Payment: Índice parcial para custódia financeira retida (Escrow em aberto)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payment_held_escrow_partial
ON "Payment" ("bookingId", "amount", "updatedAt")
WHERE status = 'HELD';

-- 6. Payment: Índice parcial para pagamentos pendentes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payment_pending_partial
ON "Payment" ("bookingId", "amount", "createdAt")
WHERE status = 'PENDING';

-- 7. QuoteRequest: Índice parcial para orçamentos pendentes de resposta
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_quoterequest_pending_partial
ON "QuoteRequest" ("providerId", "expiresAt", "createdAt")
WHERE status = 'PENDING';

-- 8. Dispute: Índice parcial para disputas abertas que exigem mediação
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_dispute_open_partial
ON "Dispute" ("bookingId", "createdAt")
WHERE status = 'OPEN';

-- 9. User: Índice parcial para busca rápida de prestadores ativos e verificados
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_active_provider_partial
ON "User" ("city", "avgRating" DESC, "id", "slug")
WHERE role = 'PROVIDER' AND active = true AND "deletedAt" IS NULL;
