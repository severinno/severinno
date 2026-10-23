-- ============================================================================
-- Migration: dinheiro Float → Decimal
-- ============================================================================
-- Campos monetários migrados de DOUBLE PRECISION para NUMERIC:
--
--   "Service"."basePrice"                 (10,2)
--   "QuoteItem"."price"                   (10,2, nullable)
--   "Booking"."amount"                    (10,2)
--   "Payment"."amount"                    (10,2)
--   "SettlementPeriod"."totalCommission"  (12,2, default 0)
--   "SettlementPeriod"."totalNet"         (12,2, default 0)
--   "SettlementPeriod"."totalAmount"      (12,2, default 0)
--   "ProviderSettlement"."totalAmount"    (12,2, default 0)
--   "ProviderSettlement"."commission"     (12,2, default 0)
--   "ProviderSettlement"."netAmount"      (12,2, default 0)
--   "WalletTransaction"."amount"          (10,2)
--
-- Motivo: DOUBLE PRECISION (binary float) introduz erro de representação em
-- valores monetários (0.1 + 0.2 !== 0.3) — inaceitável para custódia, split,
-- comissão e settlement. NUMERIC é exato em base 10.
--
-- Segurança da conversão:
--   - A conversão implícita float8 → numeric arredonda o meio-centavo
--     residual de floats existentes (ex.: 9.999999999 → 10.00) — nenhum dado
--     é perdido além do centavo, e R$ acima de 99.999.999,99 (precisão 10,2)
--     excederia o range; o schema já limita entradas a max(1_000_000) via Zod.
--   - Settlement totals usam (12,2): agregados de milhares de bookings por
--     período precisam de 2 dígitos inteiros extras.
--
-- ============================================================================
-- Autossuficiência em produção (drop/recriação de gatilhos e MV)
-- ============================================================================
-- A produção aplica esta migration via `prisma migrate deploy` (deploy.yml,
-- release-deploy.yml, entrypoint.sh) num banco onde JÁ existem:
--   mv_provider_stats          ← 20260724120000_mv_provider_stats
--   trg_refresh_mv_on_booking  ← idem (executa refresh_mv_provider_stats())
--   trg_search_reindex_service ← 20260724140000_auto_reindex_triggers
--
-- A versão anterior desta migration deixava a produção QUEBRADA: dropava a MV
-- no fim e nunca a recriava — o primeiro write em Booking/Review/Favorite
-- disparava trg_refresh_mv_* contra uma relação inexistente (erro no write) e
-- a vitrine perdia a leitura pré-calculada de provider-stats.
--
-- Por que cada desarme:
--   - trg_refresh_mv_on_booking/review/favorite: os 3 executam a mesma
--     refresh_mv_provider_stats(), que faz REFRESH MATERIALIZED VIEW
--     CONCURRENTLY na MV dropada abaixo. Deixá-los armados recriaria a
--     armadilha (REFRESH contra relação ausente) e trocaria a ordem de locks
--     com o ALTER TABLE (row lock do write vs ACCESS EXCLUSIVE do ALTER) —
--     receita de deadlock. Recriados idênticos ao canônico.
--   - trg_search_reindex_service: lista "basePrice" no UPDATE OF — a recriação
--     revalida a referência contra o novo tipo e garante o estado canônico.
--     Os valores não mudam semanticamente (9.99 float → 9.99 numeric), então
--     nada precisa ser reenfileirado em search_reindex_queue.
--   - mv_provider_stats: dropada e recriada WITH DATA para invalidar qualquer
--     plan cache preso ao estado antigo. Ela não referencia colunas
--     monetárias, mas recomputar sobre dados já convertidos mantém o canônico.
--
-- notify_search_reindex() NÃO é recriada aqui: função canônica de
-- 20260724140000, que sempre roda antes desta migration (ordem do deploy) —
-- duplicá-la criaria segunda fonte de verdade.
--
-- Tudo com IF EXISTS / CREATE OR REPLACE: no banco limpo do CI os drops são
-- no-op e a migration continua re-executável.
-- ============================================================================

-- ── 0. Desarma o que depende dos objetos dropados/reescritos ───────────────

DROP TRIGGER IF EXISTS trg_search_reindex_service ON "Service";

DROP TRIGGER IF EXISTS trg_refresh_mv_on_booking ON "Booking";
DROP TRIGGER IF EXISTS trg_refresh_mv_on_review ON "Review";
DROP TRIGGER IF EXISTS trg_refresh_mv_on_favorite ON "Favorite";

DROP MATERIALIZED VIEW IF EXISTS mv_provider_stats;

-- ── 1. Conversão Float → Decimal ───────────────────────────────────────────

ALTER TABLE "Service"
  ALTER COLUMN "basePrice" TYPE DECIMAL(10,2),
  ALTER COLUMN "basePrice" SET DEFAULT 0;

ALTER TABLE "QuoteItem"
  ALTER COLUMN "price" TYPE DECIMAL(10,2);

ALTER TABLE "Booking"
  ALTER COLUMN "amount" TYPE DECIMAL(10,2);

ALTER TABLE "Payment"
  ALTER COLUMN "amount" TYPE DECIMAL(10,2);

ALTER TABLE "SettlementPeriod"
  ALTER COLUMN "totalCommission" TYPE DECIMAL(12,2),
  ALTER COLUMN "totalCommission" SET DEFAULT 0,
  ALTER COLUMN "totalNet" TYPE DECIMAL(12,2),
  ALTER COLUMN "totalNet" SET DEFAULT 0,
  ALTER COLUMN "totalAmount" TYPE DECIMAL(12,2),
  ALTER COLUMN "totalAmount" SET DEFAULT 0;

ALTER TABLE "ProviderSettlement"
  ALTER COLUMN "totalAmount" TYPE DECIMAL(12,2),
  ALTER COLUMN "totalAmount" SET DEFAULT 0,
  ALTER COLUMN "commission" TYPE DECIMAL(12,2),
  ALTER COLUMN "commission" SET DEFAULT 0,
  ALTER COLUMN "netAmount" TYPE DECIMAL(12,2),
  ALTER COLUMN "netAmount" SET DEFAULT 0;

ALTER TABLE "WalletTransaction"
  ALTER COLUMN "amount" TYPE DECIMAL(10,2);

-- ── 2. Recriação canônica: mv_provider_stats (20260724120000) ──────────────

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

-- ── 3. Recriação canônica: fila de reindexação (20260724140000) ────────────

-- Service changes
CREATE OR REPLACE TRIGGER trg_search_reindex_service
  AFTER INSERT OR UPDATE OF
    "title", "description", "basePrice", "unit",
    "categoryId", "active", "deletedAt"
  OR DELETE ON "Service"
  FOR EACH ROW
  EXECUTE FUNCTION notify_search_reindex();
