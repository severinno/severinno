-- Índice GiST parcial de localização para o modo sort=distance da listagem
-- de prestadores (keyset, commit 2a14a4a7) e demais buscas geográficas.
--
-- Antes dele, ST_DWithin(u.location, ponto, raio) era aplicado como FILTER
-- após Index Scan no User_role_active_verified_idx: distância geodésica
-- calculada por linha em TODOS os prestadores visíveis, por request
-- (EXPLAIN real: 410 rows calculadas, 186 buffers, ~7ms num dataset de 415).
-- Com o GiST, o filtro de raio usa bounding boxes O(log n) e só as rows
-- candidatas pagam a distância exata — o ganho cresce com o tamanho da
-- tabela e a seletividade do raio.
--
-- Parcial com o predicado de visibilidade exato do buildProviderWhereClause
-- (src/lib/sql-builder.ts): role='PROVIDER' AND active=true AND
-- verified=true AND "deletedAt" IS NULL — índice menor e sempre quente.
--
-- A coluna é geography (cast ::geography que as queries fazem), não a
-- expressão geometry da migration 20260722120000 — casa com o plano real.
--
-- O ORDER BY ST_Distance(...) continua em Sort (GiST não ordena por
-- função; o operador KNN <-> não se aplica com os tiebreakers do keyset) —
-- a eliminação do sort completo é papel do seek keyset.

CREATE INDEX IF NOT EXISTS idx_user_location_visible_gist
ON "User" USING GIST (location)
WHERE role = 'PROVIDER' AND active = true AND verified = true AND "deletedAt" IS NULL;
