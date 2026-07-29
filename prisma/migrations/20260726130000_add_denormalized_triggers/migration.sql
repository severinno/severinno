-- Migration: Add triggers to sync denormalized fields on User
--
-- The User model has avgRating, reviewCount, and favoriteCount as
-- denormalized columns for performance (avoid expensive JOINs on the
-- vitrine query). However, there were NO triggers to keep these fields
-- in sync when reviews, bookings, or favorites change.
--
-- This migration adds triggers to auto-update these fields.
-- Note: mv_provider_stats also exists but has its own separate triggers.
-- These denormalized fields are the primary source of truth for the
-- vitrine query (GET /api/providers uses u.avgRating for sorting).
--
-- Also adds a trigger to update favoriteCount when favorites change.

-- 1. Trigger function to update avgRating and reviewCount
CREATE OR REPLACE FUNCTION sync_user_review_stats()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
    UPDATE "User" SET
      "avgRating" = (SELECT COALESCE(AVG(rating), 0) FROM "Review" WHERE "providerId" = NEW."providerId"),
      "reviewCount" = (SELECT COUNT(*) FROM "Review" WHERE "providerId" = NEW."providerId")
    WHERE id = NEW."providerId";
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE "User" SET
      "avgRating" = (SELECT COALESCE(AVG(rating), 0) FROM "Review" WHERE "providerId" = OLD."providerId"),
      "reviewCount" = (SELECT COUNT(*) FROM "Review" WHERE "providerId" = OLD."providerId")
    WHERE id = OLD."providerId";
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- 2. Trigger function to update favoriteCount
CREATE OR REPLACE FUNCTION sync_user_favorite_count()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE "User" SET "favoriteCount" = (SELECT COUNT(*) FROM "Favorite" WHERE "providerId" = NEW."providerId")
    WHERE id = NEW."providerId";
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE "User" SET "favoriteCount" = (SELECT COUNT(*) FROM "Favorite" WHERE "providerId" = OLD."providerId")
    WHERE id = OLD."providerId";
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- 3. Attach trigger to Review table
DROP TRIGGER IF EXISTS trg_sync_user_review_stats ON "Review";
CREATE TRIGGER trg_sync_user_review_stats
  AFTER INSERT OR UPDATE OR DELETE ON "Review"
  FOR EACH ROW
  EXECUTE FUNCTION sync_user_review_stats();

-- 4. Attach trigger to Favorite table
DROP TRIGGER IF EXISTS trg_sync_user_favorite_count ON "Favorite";
CREATE TRIGGER trg_sync_user_favorite_count
  AFTER INSERT OR DELETE ON "Favorite"
  FOR EACH ROW
  EXECUTE FUNCTION sync_user_favorite_count();

-- 5. Backfill existing data
UPDATE "User" u SET
  "avgRating" = COALESCE((SELECT AVG(rating) FROM "Review" WHERE "providerId" = u.id), 0),
  "reviewCount" = (SELECT COUNT(*) FROM "Review" WHERE "providerId" = u.id),
  "favoriteCount" = (SELECT COUNT(*) FROM "Favorite" WHERE "providerId" = u.id)
WHERE u.role = 'PROVIDER';
