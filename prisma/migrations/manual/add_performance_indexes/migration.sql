-- Migration: Performance indexes and denormalized fields
-- Run AFTER add_postgis/migration.sql
-- Improves providers search performance by ~10x

-- ===========================================================================
-- 1. Full-text search support (eliminates ILIKE '%termo%')
-- ===========================================================================

-- Add tsvector column for full-text search on providers
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (
    to_tsvector('portuguese',
      coalesce(name, '') || ' ' ||
      coalesce(bio, '') || ' ' ||
      coalesce(city, '') || ' ' ||
      coalesce(street, '') || ' ' ||
      coalesce(district, '')
    )
  ) STORED;

-- GIN index for fast full-text search queries
CREATE INDEX IF NOT EXISTS idx_user_search_vector_gin
  ON "User" USING GIN(search_vector);

-- ===========================================================================
-- 2. Denormalized avgRating and reviewCount on User
-- ===========================================================================

-- Add columns (if not exist — schema.prisma already declares them)
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "avgRating" DOUBLE PRECISION DEFAULT 0;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "reviewCount" INTEGER DEFAULT 0;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "favoriteCount" INTEGER DEFAULT 0;

-- Trigger: update provider avgRating + reviewCount when a review is created/deleted
CREATE OR REPLACE FUNCTION update_provider_rating_stats()
RETURNS trigger AS $$
DECLARE
  target_id TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    target_id := NEW."providerId";
  ELSIF TG_OP = 'DELETE' THEN
    target_id := OLD."providerId";
  ELSE
    target_id := NEW."providerId";
  END IF;

  UPDATE "User"
  SET
    "avgRating" = COALESCE(
      (SELECT AVG(rating)::double precision FROM "Review" WHERE "providerId" = target_id),
      0
    ),
    "reviewCount" = (SELECT COUNT(*)::integer FROM "Review" WHERE "providerId" = target_id)
  WHERE id = target_id;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_review_update_provider_stats ON "Review";
CREATE TRIGGER trg_review_update_provider_stats
  AFTER INSERT OR DELETE OR UPDATE OF rating
  ON "Review"
  FOR EACH ROW
  EXECUTE FUNCTION update_provider_rating_stats();

-- ===========================================================================
-- 3. Denormalized favoriteCount on User
-- ===========================================================================

-- Trigger: update provider favoriteCount when favorite is created/deleted
CREATE OR REPLACE FUNCTION update_provider_favorite_count()
RETURNS trigger AS $$
DECLARE
  target_id TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    target_id := NEW."providerId";
  ELSIF TG_OP = 'DELETE' THEN
    target_id := OLD."providerId";
  ELSE
    target_id := NEW."providerId";
  END IF;

  UPDATE "User"
  SET "favoriteCount" = (SELECT COUNT(*)::integer FROM "Favorite" WHERE "providerId" = target_id)
  WHERE id = target_id;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_favorite_update_provider_count ON "Favorite";
CREATE TRIGGER trg_favorite_update_provider_count
  AFTER INSERT OR DELETE
  ON "Favorite"
  FOR EACH ROW
  EXECUTE FUNCTION update_provider_favorite_count();

-- ===========================================================================
-- 4. Composite index for the most common filter pattern
-- ===========================================================================

-- Already added via schema.prisma: @@index([role, active, verified])
-- This covers: WHERE role = 'PROVIDER' AND active = true AND verified = true
-- If the column name in the actual table differs (e.g. snake_case), uncomment:
-- CREATE INDEX IF NOT EXISTS idx_user_role_active_verified ON "User" (role, active, verified);

-- ===========================================================================
-- 5. Backfill existing data (run once)
-- ===========================================================================

-- Backfill avgRating and reviewCount for existing providers
UPDATE "User"
SET
  "avgRating" = COALESCE(
    (SELECT AVG(rating)::double precision FROM "Review" WHERE "providerId" = "User".id),
    0
  ),
  "reviewCount" = (SELECT COUNT(*)::integer FROM "Review" WHERE "providerId" = "User".id)
WHERE role = 'PROVIDER';

-- Backfill favoriteCount for existing providers
UPDATE "User"
SET "favoriteCount" = (SELECT COUNT(*)::integer FROM "Favorite" WHERE "providerId" = "User".id)
WHERE role = 'PROVIDER';
