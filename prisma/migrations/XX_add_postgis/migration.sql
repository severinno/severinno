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
CREATE INDEX IF NOT EXISTS idx_booking_location_gist
ON "Booking" USING GIST (location);
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
