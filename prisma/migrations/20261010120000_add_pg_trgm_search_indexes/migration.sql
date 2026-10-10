-- Migration: Add pg_trgm extension and GIN trigram indexes for fast fuzzy & substring search
--
-- Background:
-- When full-text search (tsvector) is paired with user queries containing typos or substring
-- matches (e.g. ILIKE '%termo%'), PostgreSQL falls back to costly Sequential Scans unless
-- trigram indexing is available.
--
-- This migration adds:
--   1. pg_trgm extension (PostgreSQL native trigram operations)
--   2. GIN trigram index on Service.title
--   3. GIN trigram index on Service.description
--   4. GIN trigram index on Category.name
--   5. GIN trigram index on User.name (filtered for providers)
--
-- This enables ultra-fast ILIKE '%...%' and similarity() scans via Bitmap Index Scan in < 5ms.

-- 1. Enable pg_trgm extension
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 2. Service title trigram index (primary search column)
CREATE INDEX IF NOT EXISTS idx_service_title_trgm
  ON "Service" USING GIN (title gin_trgm_ops)
  WHERE active = true AND "deletedAt" IS NULL;

-- 3. Service description trigram index
CREATE INDEX IF NOT EXISTS idx_service_description_trgm
  ON "Service" USING GIN (description gin_trgm_ops)
  WHERE active = true AND "deletedAt" IS NULL;

-- 4. Category name trigram index (category synonym and text expansion)
CREATE INDEX IF NOT EXISTS idx_category_name_trgm
  ON "Category" USING GIN (name gin_trgm_ops)
  WHERE active = true;

-- 5. User name trigram index for providers
CREATE INDEX IF NOT EXISTS idx_user_name_trgm
  ON "User" USING GIN (name gin_trgm_ops)
  WHERE role = 'PROVIDER' AND active = true AND "deletedAt" IS NULL;
