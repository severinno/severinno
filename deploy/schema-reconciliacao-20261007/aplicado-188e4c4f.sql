BEGIN;

-- ==== §A. DESARME (triggers que leem colunas re-typed) ====
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

-- ==== §B. DIFF (DB -> schema do commit 188e4c4f) ====
-- DropIndex
DROP INDEX "idx_service_search_vector";
CREATE INDEX IF NOT EXISTS idx_service_search_vector
  ON "Service" USING GIN (search_vector);

-- DropIndex
DROP INDEX "idx_user_search_vector";
CREATE INDEX IF NOT EXISTS idx_user_search_vector
  ON "User" USING GIN (search_vector);

-- AlterTable
ALTER TABLE "Booking" ALTER COLUMN "amount" SET DATA TYPE DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "Payment" ALTER COLUMN "amount" SET DATA TYPE DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "ProviderSettlement" ALTER COLUMN "totalAmount" SET DATA TYPE DOUBLE PRECISION,
ALTER COLUMN "commission" SET DATA TYPE DOUBLE PRECISION,
ALTER COLUMN "netAmount" SET DATA TYPE DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "QuoteItem" ALTER COLUMN "price" SET DATA TYPE DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "Service" ALTER COLUMN "basePrice" SET DATA TYPE DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "SettlementPeriod" ALTER COLUMN "totalCommission" SET DATA TYPE DOUBLE PRECISION,
ALTER COLUMN "totalNet" SET DATA TYPE DOUBLE PRECISION,
ALTER COLUMN "totalAmount" SET DATA TYPE DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "User" DROP COLUMN "soundEnabled",
DROP COLUMN "vibrateEnabled";

-- AlterTable
ALTER TABLE "WalletTransaction" ALTER COLUMN "amount" SET DATA TYPE DOUBLE PRECISION;

-- DropTable
DROP TABLE IF EXISTS "IdempotencyRecord";


-- ==== §C. REARME (snapshot prévio) ====
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
COMMIT;
