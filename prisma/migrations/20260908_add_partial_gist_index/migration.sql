-- Melhoria #3: Índice GiST parcial para providers ativos
--
-- A query ST_DWithin em postgis.ts filtra por role/active/verified/deletedAt.
-- Sem índice parcial, o PostgreSQL faz scan do GiST completo e depois filtra.
-- Este índice inclui apenas providers ativos com localização, reduzindo o
-- tamanho do índice em ~60-80% e acelerando queries espaciais proporcionalmente.
--
-- CONCURRENTLY evita lock de escrita na tabela durante a criação.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_location_active_provider
ON "User" USING gist (location)
WHERE role = 'PROVIDER'
  AND active = true
  AND verified = true
  AND "deletedAt" IS NULL
  AND location IS NOT NULL;
