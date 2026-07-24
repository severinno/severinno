-- Severinno — GlitchTip Database Setup
-- ============================================================================
-- Run this once before starting GlitchTip for the first time:
--   docker compose exec postgis psql -U severinno -f scripts/init-glitchtip-db.sql
-- Or use the auto-init via docker-entrypoint-initdb.d:
--   cp scripts/init-glitchtip-db.sql scripts/init-postgis.sql (append)
-- ============================================================================

CREATE DATABASE severinno_errors;
GRANT ALL PRIVILEGES ON DATABASE severinno_errors TO severinno;
