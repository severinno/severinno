-- Índice composto do seek keyset (paginação por cursor da listagem de
-- prestadores, commit 2a14a4a7).
--
-- As expressões são IDÊNTICAS às chaves de ORDER BY do modo rating em
-- src/lib/keyset.ts (RATING_KEYS): -COALESCE("avgRating", -1),
-- -COALESCE("favoriteCount", 0), id — todas ASC. O Postgres só usa um
-- índice para servir o ORDER BY quando a expressão casa EXATAMENTE;
-- índice de coluna simples (avgRating, favoriteCount) não é elegível e o
-- planner cai em Sort O(n log n) sobre todas as rows qualificadas por
-- request (top-N heapsort observado no EXPLAIN antes deste índice).
--
-- Parcial: toda query de listagem traz role='PROVIDER' AND active=true
-- AND verified=true AND "deletedAt" IS NULL (buildProviderWhereClause,
-- src/lib/sql-builder.ts), então o índice cobre apenas prestadores
-- visíveis — menor e mais quente em cache.
--
-- O seek usa row-comparison "(k0,k1,k2) > ($1::float8,$2::float8,$3)":
-- com o índice o planner segue a fronteira lexicográfica O(log n + página)
-- em vez de reordenar o dataset a cada página funda.

CREATE INDEX IF NOT EXISTS idx_user_keyset_rating
ON "User" ((-COALESCE("avgRating", -1)), (-COALESCE("favoriteCount", 0)), id)
WHERE role = 'PROVIDER' AND active = true AND verified = true AND "deletedAt" IS NULL;
