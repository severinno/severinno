-- Migration: Enable PostGIS and add spatial geography column to User
-- Run after: existing schema with lat/lng columns

-- 1. Enable PostGIS extension (idempotent)
CREATE EXTENSION IF NOT EXISTS postgis;

-- 2. Add geography column to User (nullable — backfilled from existing lat/lng)
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS location geography(Point, 4326);

-- 3. Backfill location from existing lat/lng columns
UPDATE "User"
SET location = ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography
WHERE lat IS NOT NULL AND lng IS NOT NULL AND location IS NULL;

-- 4. Create spatial GiST index for fast ST_DWithin / ST_Distance queries
--
-- ORDERING HAZARD (reviewer finding, fixed here):
--   20260722120000_add_performance_indexes creates the SAME index name
--   (idx_user_location_gist) as a geometry EXPRESSION index on
--   ST_SetSRID(ST_MakePoint(lng, lat), 4326). Prisma `migrate deploy` sorts
--   migrations lexicographically, so that migration runs BEFORE this one and
--   its CREATE INDEX IF NOT EXISTS would make the geography-column index
--   below get SKIPPED — leaving prod with an index that cannot serve
--   ST_DWithin(u.location, ...) (geography opclass).
--   Fix: DROP the name first so the geography-column GIST index is
--   guaranteed to exist regardless of application order. No app query uses
--   the raw ST_MakePoint(lng, lat) expression (all use `location` /
--   ::geography), so dropping the expression index is safe.
DROP INDEX IF EXISTS idx_user_location_gist;
CREATE INDEX IF NOT EXISTS idx_user_location_gist
ON "User" USING GIST (location);

-- 5. Create a trigger function to keep location in sync with lat/lng columns
-- (so the app can write lat/lng and location stays consistent automatically)
CREATE OR REPLACE FUNCTION sync_user_location()
RETURNS trigger AS $$
BEGIN
  IF NEW.lat IS NOT NULL AND NEW.lng IS NOT NULL THEN
    NEW.location := ST_SetSRID(ST_MakePoint(NEW.lng, NEW.lat), 4326)::geography;
  ELSE
    NEW.location := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop trigger if it already exists, then create
DROP TRIGGER IF EXISTS trg_sync_user_location ON "User";
CREATE TRIGGER trg_sync_user_location
  BEFORE INSERT OR UPDATE OF lat, lng
  ON "User"
  FOR EACH ROW
  EXECUTE FUNCTION sync_user_location();

-- 6. Add geography columns to Booking and QuoteRequest as well (optional for future)
ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS location geography(Point, 4326);
ALTER TABLE "QuoteRequest" ADD COLUMN IF NOT EXISTS location geography(Point, 4326);

-- Backfill Booking
UPDATE "Booking"
SET location = ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography
WHERE lat IS NOT NULL AND lng IS NOT NULL AND location IS NULL;

-- Backfill QuoteRequest
UPDATE "QuoteRequest"
SET location = ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography
WHERE lat IS NOT NULL AND lng IS NOT NULL AND location IS NULL;

-- Create indexes for Booking and QuoteRequest
-- (same ordering-hazard fix as idx_user_location_gist above)
DROP INDEX IF EXISTS idx_booking_location_gist;
CREATE INDEX IF NOT EXISTS idx_booking_location_gist
ON "Booking" USING GIST (location);
DROP INDEX IF EXISTS idx_quoterequest_location_gist;
CREATE INDEX IF NOT EXISTS idx_quoterequest_location_gist
ON "QuoteRequest" USING GIST (location);

-- Add sync triggers for Booking and QuoteRequest
CREATE OR REPLACE FUNCTION sync_booking_location()
RETURNS trigger AS $$
BEGIN
  IF NEW.lat IS NOT NULL AND NEW.lng IS NOT NULL THEN
    NEW.location := ST_SetSRID(ST_MakePoint(NEW.lng, NEW.lat), 4326)::geography;
  ELSE
    NEW.location := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_booking_location ON "Booking";
CREATE TRIGGER trg_sync_booking_location
  BEFORE INSERT OR UPDATE OF lat, lng
  ON "Booking"
  FOR EACH ROW
  EXECUTE FUNCTION sync_booking_location();

CREATE OR REPLACE FUNCTION sync_quoterequest_location()
RETURNS trigger AS $$
BEGIN
  IF NEW.lat IS NOT NULL AND NEW.lng IS NOT NULL THEN
    NEW.location := ST_SetSRID(ST_MakePoint(NEW.lng, NEW.lat), 4326)::geography;
  ELSE
    NEW.location := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_quoterequest_location ON "QuoteRequest";
CREATE TRIGGER trg_sync_quoterequest_location
  BEFORE INSERT OR UPDATE OF lat, lng
  ON "QuoteRequest"
  FOR EACH ROW
  EXECUTE FUNCTION sync_quoterequest_location();
