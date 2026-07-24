-- Materialized View: mv_provider_stats
-- Pré-calcula rating médio, contagem de reviews, bookings completos e favoritos
-- para eliminar JOINs e subqueries na consulta de vitrine.
--
-- Uso: JOIN "User" u LEFT JOIN mv_provider_stats s ON s.provider_id = u.id
-- Refresh: REFRESH MATERIALIZED VIEW CONCURRENTLY mv_provider_stats;

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_provider_stats AS
SELECT
  u.id AS provider_id,
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

-- Unique index on provider_id for fast lookups and CONCURRENTLY refresh support
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_provider_stats_provider_id
  ON mv_provider_stats (provider_id);

-- Index on avg_rating DESC for sorting providers by rating
CREATE INDEX IF NOT EXISTS idx_mv_provider_stats_avg_rating_desc
  ON mv_provider_stats (avg_rating DESC);

-- Index on completed_booking_count for popularity sorting
CREATE INDEX IF NOT EXISTS idx_mv_provider_stats_completed_bookings_desc
  ON mv_provider_stats (completed_booking_count DESC);

-- ============================================================================
-- Auto-refresh trigger: keeps MV updated when reviews, bookings, or favorites change
-- ============================================================================

CREATE OR REPLACE FUNCTION refresh_mv_provider_stats()
RETURNS trigger AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_provider_stats;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Review changes affect avg_rating and review_count
DROP TRIGGER IF EXISTS trg_refresh_mv_on_review ON "Review";
CREATE TRIGGER trg_refresh_mv_on_review
  AFTER INSERT OR UPDATE OR DELETE ON "Review"
  FOR EACH STATEMENT EXECUTE FUNCTION refresh_mv_provider_stats();

-- Booking completion affects completed_booking_count
DROP TRIGGER IF EXISTS trg_refresh_mv_on_booking ON "Booking";
CREATE TRIGGER trg_refresh_mv_on_booking
  AFTER INSERT OR UPDATE OR DELETE ON "Booking"
  FOR EACH STATEMENT EXECUTE FUNCTION refresh_mv_provider_stats();

-- Favorite changes affect favorite_count
DROP TRIGGER IF EXISTS trg_refresh_mv_on_favorite ON "Favorite";
CREATE TRIGGER trg_refresh_mv_on_favorite
  AFTER INSERT OR UPDATE OR DELETE ON "Favorite"
  FOR EACH STATEMENT EXECUTE FUNCTION refresh_mv_provider_stats();
