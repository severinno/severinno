CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS postgis_topology;

-- Performance indexes for Severinno Marketplace
-- Adds: search_vector, spatial GIST indexes, composite B-tree indexes

-- 1. Full-text search on Service
ALTER TABLE "Service" ADD COLUMN IF NOT EXISTS search_vector tsvector;

CREATE INDEX IF NOT EXISTS idx_service_search_vector
  ON "Service" USING GIN (search_vector);

CREATE OR REPLACE FUNCTION service_search_vector_update()
RETURNS trigger AS $$
BEGIN
  NEW.search_vector := to_tsvector(
    'portuguese',
    COALESCE(NEW.title, '') || ' ' || COALESCE(NEW.description, '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_service_search_vector ON "Service";
CREATE TRIGGER trg_service_search_vector
  BEFORE INSERT OR UPDATE ON "Service"
  FOR EACH ROW EXECUTE FUNCTION service_search_vector_update();

-- Backfill existing rows
UPDATE "Service" SET title = title WHERE search_vector IS NULL;

-- 2. GiST spatial indexes (consolidated from ensurePostGIS())
CREATE INDEX IF NOT EXISTS idx_user_location_gist
  ON "User" USING GIST (ST_SetSRID(ST_MakePoint("lng", "lat"), 4326));

CREATE INDEX IF NOT EXISTS idx_booking_location_gist
  ON "Booking" USING GIST (ST_SetSRID(ST_MakePoint("lng", "lat"), 4326));

CREATE INDEX IF NOT EXISTS idx_quoterequest_location_gist
  ON "QuoteRequest" USING GIST (ST_SetSRID(ST_MakePoint("lng", "lat"), 4326));

-- 3. Composite B-tree indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_review_provider_rating
  ON "Review" ("providerId", "rating" DESC);

CREATE INDEX IF NOT EXISTS idx_booking_provider_scheduled
  ON "Booking" ("providerId", "scheduledAt" DESC);

CREATE INDEX IF NOT EXISTS idx_booking_client_scheduled
  ON "Booking" ("clientId", "scheduledAt" DESC);

CREATE INDEX IF NOT EXISTS idx_service_category_active
  ON "Service" ("categoryId", "active")
  WHERE active = true;

CREATE INDEX IF NOT EXISTS idx_user_provider_list
  ON "User" (role, active, verified, city)
  WHERE role = 'PROVIDER' AND active = true AND verified = true;
