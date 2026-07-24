-- ============================================================================
-- Auto-reindex queue for OpenSearch
--
-- PostgreSQL triggers on User (PROVIDER), Service, and Category tables
-- insert rows into search_reindex_queue whenever relevant data changes.
-- A background worker (or cron job) polls this queue and reindexes the
-- affected documents in OpenSearch, then deletes the processed rows.
-- ============================================================================

-- ── Queue table ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "search_reindex_queue" (
  "id"         BIGSERIAL PRIMARY KEY,
  "entityType" TEXT      NOT NULL,   -- 'provider' | 'service' | 'category'
  "entityId"   TEXT      NOT NULL,   -- ID of the affected row
  "action"     TEXT      NOT NULL,   -- 'upsert' | 'delete'
  "createdAt"  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for worker polling (oldest entries first)
CREATE INDEX IF NOT EXISTS idx_search_reindex_queue_created
  ON "search_reindex_queue" ("createdAt" ASC);

-- ── Trigger function: insert reindex request ───────────────────────────────

CREATE OR REPLACE FUNCTION notify_search_reindex()
RETURNS trigger AS $$
DECLARE
  _entity_type TEXT;
  _entity_id   TEXT;
  _action      TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    _entity_id := OLD.id;
    _action    := 'delete';
  ELSE
    _entity_id := NEW.id;
    _action    := 'upsert';
  END IF;

  CASE TG_TABLE_NAME
    WHEN 'User' THEN
      -- Only index PROVIDER records
      IF TG_OP = 'DELETE' THEN
        _entity_type := 'provider';
      ELSIF NEW.role = 'PROVIDER' THEN
        _entity_type := 'provider';
      ELSE
        RETURN NULL; -- ignore non-provider
      END IF;
    WHEN 'Service' THEN
      _entity_type := 'service';
    WHEN 'Category' THEN
      _entity_type := 'category';
    ELSE
      RETURN NULL;
  END CASE;

  INSERT INTO "search_reindex_queue" ("entityType", "entityId", "action")
  VALUES (_entity_type, _entity_id, _action);

  RETURN NULL; -- trigger AFTER, return is ignored
END;
$$ LANGUAGE plpgsql;

-- ── Attach triggers ─────────────────────────────────────────────────────────

-- Provider changes — only relevant fields
CREATE OR REPLACE TRIGGER trg_search_reindex_user
  AFTER INSERT OR UPDATE OF
    "name", "bio", "city", "state", "district",
    "lat", "lng", "verified", "active", "deletedAt"
  OR DELETE ON "User"
  FOR EACH ROW
  EXECUTE FUNCTION notify_search_reindex();

-- Service changes
CREATE OR REPLACE TRIGGER trg_search_reindex_service
  AFTER INSERT OR UPDATE OF
    "title", "description", "basePrice", "unit",
    "categoryId", "active", "deletedAt"
  OR DELETE ON "Service"
  FOR EACH ROW
  EXECUTE FUNCTION notify_search_reindex();

-- Category changes
CREATE OR REPLACE TRIGGER trg_search_reindex_category
  AFTER INSERT OR UPDATE OF
    "name", "slug", "active", "parentId"
  OR DELETE ON "Category"
  FOR EACH ROW
  EXECUTE FUNCTION notify_search_reindex();
