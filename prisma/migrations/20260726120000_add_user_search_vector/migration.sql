-- Migration: Add search_vector to User for full-text provider search
--
-- CRITICAL: The code in src/lib/sql-builder.ts references u.search_vector
-- for full-text search on providers, but this column was never added to
-- the User table. This migration fixes that gap.
--
-- Adds:
--   1. search_vector tsvector column on User
--   2. GIN index for fast full-text search
--   3. Trigger to auto-update search_vector when name, bio, city, district change
--   4. Backfill existing rows

-- 1. Add tsvector column
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS search_vector tsvector;

-- 2. Create GIN index for fast full-text search
CREATE INDEX IF NOT EXISTS idx_user_search_vector
  ON "User" USING GIN (search_vector);

-- 3. Create trigger function to update search_vector
CREATE OR REPLACE FUNCTION user_search_vector_update()
RETURNS trigger AS $$
BEGIN
  NEW.search_vector := to_tsvector(
    'portuguese',
    COALESCE(NEW.name, '') || ' ' ||
    COALESCE(NEW.bio, '') || ' ' ||
    COALESCE(NEW.city, '') || ' ' ||
    COALESCE(NEW.district, '') || ' ' ||
    COALESCE(NEW.street, '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop trigger if exists, then create
DROP TRIGGER IF EXISTS trg_user_search_vector ON "User";
CREATE TRIGGER trg_user_search_vector
  BEFORE INSERT OR UPDATE OF name, bio, city, district, street
  ON "User"
  FOR EACH ROW
  EXECUTE FUNCTION user_search_vector_update();

-- 4. Backfill existing rows (force trigger execution by updating name in place)
UPDATE "User" SET name = name WHERE search_vector IS NULL;
