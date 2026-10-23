-- Melhoria #3: Índice GiST parcial para providers ativos
--
-- A query ST_DWithin em postgis.ts filtra por role/active/verified/deletedAt.
-- Sem índice parcial, o PostgreSQL faz scan do GiST completo e depois filtra.
-- Este índice inclui apenas providers ativos com localização, reduzindo o
-- tamanho do índice em ~60-80% e acelerando queries espaciais proporcionalmente.
--
-- SEM `CONCURRENTLY` (mesma razão de 20261016180000): o Prisma Migrate roda
-- cada migration em UMA transação e `CREATE INDEX CONCURRENTLY` não roda em
-- bloco de transação. Esta migration foi marcada como aplicada em produção SEM
-- executar o índice (`applied_steps_count = 0`, e o índice não existe lá) — o
-- arquivo nunca rodou de verdade; corrigi-lo é o que faz um banco zerado
-- ganhar o índice, e é o que o guard de transação exige.

CREATE INDEX IF NOT EXISTS idx_user_location_active_provider
ON "User" USING gist (location)
WHERE role = 'PROVIDER'
  AND active = true
  AND verified = true
  AND "deletedAt" IS NULL
  AND location IS NOT NULL;
