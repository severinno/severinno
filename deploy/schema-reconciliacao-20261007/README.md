# Reconciliação do banco de produção (07/10/2026)

## O estado que justificou a ação

- `_prisma_migrations` poluído: 33 registros, 8 de linhagens que não existem no
  checkout, todos `applied_steps_count=0` (carimbados, não aplicados);
- Banco sem `User.identityStatus`, `Setting.createdAt`, tipo `public.Role`,
  tabelas de settlement/idempotência/push e colunas recriadas (enums nativos):
  o app rodava por fallbacks (purge LGPD 500, geo em P2022, redis-geo → PostGIS);
- Schema e migração alvo: HEAD `114509a2` (26 migrations + schema.prisma).

## Método (aplicado em transação única, ON_ERROR_STOP=1)

1. **Backup prévio custom+plain**: `/root/pre-reconciliacao-20261007-091639/`
   (dump 85KB custom, schema-antes.sql, sha256sums, ROLLBACK.md — comando de
   reversão documentado; banco estava **vazio de negócio** — tudo n_live_tup=0 —
   mas o backup é o contrato mesmo assim).
2. **Desarme**: snapshot `pg_get_triggerdef` dos 11 triggers de negócio +
   `DROP mv_provider_stats` (a MV depende de Booking.status/columns — só o
   diff do prisma não cobre).
3. **Diff prisma** `migrate diff --from-url DB --to-schema-datamodel`
   (613 linhas): enums nativos, colunas recriadas, tabelas novas, indexes,
   FKs. Guardas: todo CREATE INDEX precedido de DROP IF EXISTS; RenameIndex
   em DO/EXCEPTION tolerante (undefined_object/undefined_table/duplicate).
4. **Reconstrução canônica**: MV recriada WITH DATA + índices; triggers
   rearmados DO SNAPSHOT (fonte de verdade, inclui denormalizados).
5. **Apêndice hand-made**: GIN search_vector (User/Service), keyset rating
   parcial, GiST location parcial (migrations 20260722120000/20260726120000 +
   WIPs 2026100412/13 — fora do conhecimento do prisma diff).

## Provas pós

- pós-check colunas/tipos: 7/7 User, Setting.createdAt, 7 enums, 13 tabelas
  novas, 6 índices, MV=1, triggers=11/11, `amount` numeric(10,2),
  `deletedAt` timestamp(3);
- `prisma migrate status` → **"Database schema is up to date!"**;
- **Ledger RE-BASEADO**: wipe das 33 linhas falsas + `migrate resolve --applied`
  nas 26 (25 + 1 já-registrada) + XX_add_postgis → 26 registros verdadeiros;
- Rotas que falhavam: `identity-purge` 200 (era 500), `providers/density`
  JSON de rings (era P2022), health `ok`, vitrine 200, **0 erros de schema**
  nos logs (janela 5min);
- Sanity INSERT/DELETE em City OK (0 linhas residuais).

## Segurança

- Todo DDL em uma transação com rollback em qualquer erro (4 tentativas, 3
  rollbacks limpos até o SQL v6 ficou verde);
- Dump de reversão verificado por sha256, comando em ROLLBACK.md.

## Doi pendurar

- `app` em produção já tinha o CLIENT da versão nova — não houve boot novo
  necessário; o próximo deploy pipeline aplica `migrate deploy` idempotente.
- `XX_add_postgis` e `003_database_optimizations.sql` permanecem no repo
  (aplicados/de adaptados); a regra do ledger é só "dir 2026*" e resolve
  foi usado para o XX.
