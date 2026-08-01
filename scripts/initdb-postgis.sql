-- =============================================================================
-- scripts/initdb-postgis.sql — enable PostGIS on ephemeral test databases
--
-- The postgis/postgis image auto-enables the extension only in the `postgres`
-- DB and in `template_postgis`; a database created via POSTGRES_DB comes from
-- template1 and does NOT have it. Without this, `prisma db push` fails on the
-- Unsupported("geography(Point, 4326)") columns.
--
-- Mounted at /docker-entrypoint-initdb.d/10-postgis.sql by:
--   - docker-compose.test.yml (local full-pipeline E2E runs)
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS postgis;
