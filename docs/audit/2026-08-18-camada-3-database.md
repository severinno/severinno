# Auditoria — Camada 3: Banco de Dados (PostgreSQL 16 + PostGIS 3.4)

**Data:** 2026-08-18
**Auditor:** Buffy (Codebuff)
**Status Geral:** 🟢 Saudável (Enterprise-grade with PostGIS spatial)

---

## Resumo Executivo

O banco de dados é **bem projetado** com 25+ models, enums nativos do PostgreSQL, PostGIS para geolocalização, soft delete automático via Prisma middleware, SQL builders parametrizados, e OpenSearch para full-text search. Identificadas **0 vulnerabilidades P0**, **1 melhoria P1** e **4 melhorias P2/P3**.

---

## Itens Verificados

### 1. Prisma Schema

- ✅ **25+ models**: User, Category, Service, QuoteRequest, QuoteItem, Booking, Dispute, Review, Favorite, Message, Notification, Payment, SettlementPeriod, ProviderSettlement, Setting, ResetToken, DateBlock, PushSubscription, ScheduledPushNotification, RecurringPushSchedule, EventWebhook, PushAnalytics, WalletTransaction, NotificationPreference, PushSendLog, WebhookExecutionLog, SearchReindexQueue
- ✅ **Enums nativos**: Role, BookingStatus, PaymentMethod, PaymentStatus, QuoteStatus, QuoteItemStatus, ServiceUnit
- ✅ **Relações**: Cascade deletes configurados corretamente (User → Booking, Booking → Payment)
- ✅ **Unique constraints**: Email, slug, bookingId em Review, Favorite(clientId, providerId)
- ✅ **Soft delete**: `deletedAt` em User, Service, Booking

### 2. Indexes

- ✅ **User**: `@@index([role, active, verified])`, `@@index([city])`, `@@index([city, active, verified])`, `@@index([lat, lng])`
- ✅ **Service**: `@@index([providerId])`, `@@index([categoryId])`, `@@index([active])`, `@@index([categoryId, active])`
- ✅ **Booking**: `@@index([clientId])`, `@@index([providerId])`, `@@index([serviceId])`, `@@index([status])`, `@@index([paymentStatus])`, `@@index([scheduledAt])`, `@@index([providerId, status, scheduledAt])`, `@@index([clientId, status, scheduledAt])`
- ✅ **QuoteRequest**: `@@index([clientId])`, `@@index([providerId])`, `@@index([status])`
- ✅ **Message**: `@@index([fromId])`, `@@index([toId])`, `@@index([fromId, toId, createdAt])`, `@@index([bookingId])`, `@@index([read])`
- ✅ **Notification**: `@@index([userId])`, `@@index([userId, createdAt])`, `@@index([read])`
- ✅ **Payment**: `@@index([status])`, `@@index([lytexId])`, `@@index([lytexStatus])`

### 3. PostGIS Spatial

- ✅ **Columns**: `location Unsupported("geography(Point, 4326)")` em User, Booking, QuoteRequest
- ✅ **Triggers**: `sync_user_location`, `sync_booking_location`, `sync_quoterequest_location` (sync lat/lng → geography)
- ✅ **Spatial indexes**: GiST indexes (idx_user_location_gist, idx_booking_location_gist, idx_quoterequest_location_gist)
- ✅ **ST_DWithin**: Index-assisted proximity queries com cache Redis 60s
- ✅ **ST_Distance**: Cálculo de distância entre dois pontos
- ✅ **ST_MakeEnvelope**: Bounding box queries para map viewport
- ✅ **ST_Contains**: Point-in-polygon para service zones
- ✅ **REINDEX CONCURRENTLY**: Proactive recovery no redis.ts após 5+ degradações

### 4. Soft Delete

- ✅ **Middleware**: `db.ts` com `$extends` (Prisma v6) — auto-filtra `deletedAt: null` em reads
- ✅ **Block hard delete**: `delete` e `deleteMany` lançam erro claro
- ✅ **Models suportados**: User, Service, Booking
- ✅ **Read ops protegidos**: findMany, findFirst, findFirstOrThrow, count, aggregate, groupBy
- ✅ **Escaped by**: findUnique / findUniqueOrThrow (usam unique constraints, não WHERE arbitrário)

### 5. SQL Builders (Parametrized)

- ✅ **`sql-builder.ts`**: WHERE clause para providers (role, active, verified, PostGIS, full-text, category)
- ✅ **`sql-booking-builder.ts`**: WHERE clause para bookings (client, provider, status, date ranges)
- ✅ **`sql-service-builder.ts`**: WHERE clause para services (provider, category, text search, price range)
- ✅ **Parâmetros**: Todos usam `$1, $2, $3...` (não interpolação de string)
- ✅ **Pure functions**: Sem I/O, sem side effects — trivialmente testáveis
- ✅ **Soft-delete guard**: Todas as queries incluem `"deletedAt" IS NULL`

### 6. Full-Text Search

- ✅ **PostgreSQL tsvector**: `search_vector` em Category e Service (GIN index)
- ✅ **Trigram**: Fuzzy search com pg_trgm
- ✅ **OpenSearch**: 3 índices (providers, services, categories) com analyzer brasileiro
- ✅ **Synonyms**: Arquivo `synonyms.txt` montado no OpenSearch
- ✅ **Boosting**: serviceTitles^2, name^3, title^3
- ✅ **Fuzziness**: AUTO para tolerância a erros de digitação
- ✅ **Search reindex queue**: Tabela `search_reindex_queue` para async reindexing

### 7. Connection Pooling

- ✅ **PgBouncer**: Transaction mode para Prisma/Next.js
- ✅ **Prepared statements**: `max_prepared_statements = 200` (crítico para Prisma)
- ✅ **Pool sizing**: default_pool_size=25, reserve_pool_size=5, max_client_conn=1000
- ✅ **Timeouts**: query_timeout=30s, server_idle_timeout=600s, server_lifetime=3600s
- ✅ **DIRECT_URL**: Para Prisma Migrate (conexão direta, sem PgBouncer)

### 8. Migrations

- ✅ **20 migrations**: De `add_gateway_fields` a `escrow_disputes_and_kyc`
- ✅ **Manual SQL**: `XX_add_postgis` para extensão PostGIS
- ✅ **Database optimizations**: `003_database_optimizations.sql`
- ✅ **Performance indexes**: `20260722120000_add_performance_indexes`
- ✅ **Denormalized triggers**: `20260726130000_add_denormalized_triggers`
- ✅ **Auto reindex triggers**: `20260724140000_auto_reindex_triggers`
- ✅ **Native enums**: `20260813200000_native_enums_and_postgis_sync`

### 9. Denormalized Fields

- ✅ **User**: `avgRating`, `reviewCount`, `favoriteCount` — evitam JOINs em listagens
- ✅ **Triggers SQL**: Sincronizam denormalized fields automaticamente
- ✅ **Service**: `search_vector` atualizado via trigger

### 10. Data Integrity

- ✅ **Cascade deletes**: User → Booking → Payment, User → Review
- ✅ **Restrict**: Service → Category (não pode deletar categoria com serviços)
- ✅ **SetNull**: Booking → QuoteRequest (quote pode ser deletado sem afetar booking)
- ✅ **Unique**: Favorite(clientId, providerId), Payment(bookingId), Review(bookingId)

---

## Findings Detalhados

### F-001: `sql-service-builder.ts` usa ILIKE para full-text search

- **Severidade:** P1 (Atenção)
- **Camada:** 3
- **Descrição:** O `buildServiceWhereClause` usa `ILIKE $pattern` para busca de texto em services, enquanto o `buildProviderWhereClause` usa `to_tsquery` com GIN index. ILIKE não usa índice e faz scan linear em services grandes.
- **Impacto:** Performance degradada com muitos serviços (>10k)
- **Recomendação:** Migrar para `to_tsquery('portuguese', ...)` com GIN index em Service.search_vector
- **Esfroço:** 4h

### F-002: `findProvidersWithinBounds` não tem cache

- **Severidade:** P2 (Melhoria)
- **Camada:** 3
- **Descrição:** `findProvidersWithinBounds` faz query direta sem cache, diferente de `findProvidersWithinRadius` que tem cache 60s. Map viewport queries podem ser频繁es.
- **Impacto:** Queries repetidas para mesmo viewport
- **Recomendação:** Adicionar `withCache` com TTL curto (30s)
- **Esfroço:** 1h

### F-003: Falta `@@index` em alguns campos frequentemente filtrados

- **Severidade:** P2 (Melhoria)
- **Camada:** 3
- **Descrição:** `Payment.transactionId` e `NotificationPreference.type` não têm índice próprio (usam compound indexes indiretos). Queries de lookup por transactionId podem ser lentas.
- **Impacto:** Queries de payment lookup podem fazer sequential scan
- **Recomendação:** Adicionar `@@index([transactionId])` em Payment
- **Esfroço:** 1h

### F-004: Geohash cache é in-memory only (não persiste entre restarts)

- **Severidade:** P3 (Baixa)
- **Camada:** 3
- **Descrição:** O `geohash-cache.ts` usa Map in-memory sem persistência Redis. Após restart, o cache espacial é perdido.
- **Impacto:** Cold start com queries lentas até cache esquentar
- **Recomendação:** Considerar Redis cache para geohash entries (ou aceitar cold start)
- **Esfroço:** 2h

### F-005: OpenSearch client cria novo client em production a cada chamada

- **Severidade:** P2 (Melhoria)
- **Camada:** 3
- **Descrição:** `getClient()` em `search.ts` retorna `createClient()` em produção (sem singleton), diferente de dev que usa `globalThis.__opensearch`. Cada chamada cria nova conexão.
- **Impacto:** Overhead de conexão a cada query de busca
- **Recomendação:** Usar singleton em produção também (via globalThis ou module-level)
- **Esfroço:** 1h

---

## Resumo por Prioridade

### P0 (Imediato)

- Nenhum finding P0 identificado

### P1 (Próxima sprint)

1. **F-001:** Migrar service search de ILIKE para tsquery com GIN index

### P2 (Backlog)

2. **F-002:** Adicionar cache em findProvidersWithinBounds
3. **F-003:** Adicionar índice em Payment.transactionId
4. **F-005:** Singleton OpenSearch client em produção

### P3 (Melhoria contínua)

5. **F-004:** Geohash cache Redis persistence

---

## Estatísticas

| Métrica             | Valor                                     |
| ------------------- | ----------------------------------------- |
| Total de models     | 25+                                       |
| Enums nativos       | 7                                         |
| Migrations          | 20                                        |
| Spatial columns     | 3 (User, Booking, QuoteRequest)           |
| GiST indexes        | 3                                         |
| SQL builders        | 3 (provider, booking, service)            |
| OpenSearch indices  | 3 (providers, services, categories)       |
| Soft-delete models  | 3 (User, Service, Booking)                |
| Denormalized fields | 3 (avgRating, reviewCount, favoriteCount) |

## Padrões Positivos

1. **PostGIS integration**: Spatial queries com ST_DWithin, ST_Distance, ST_MakeEnvelope, ST_Contains
2. **Soft delete automático**: Middleware Prisma v6 filtra deletedAt em reads, bloqueia hard delete
3. **SQL builders puros**: Funções puras sem I/O — trivialmente testáveis
4. **Parametrized queries**: Todas usam $1, $2... — zero SQL injection risk
5. **Connection pooling**: PgBouncer transaction mode com prepared statements
6. **Denormalized fields**: avgRating, reviewCount, favoriteCount evitam JOINs
7. **Full-text search**: PostgreSQL tsvector + OpenSearch com analyzer brasileiro
8. **Search reindex queue**: Async reindexing via tabela + worker
9. **Proactive REINDEX**: GiST REINDEX CONCURRENTLY no proactive recovery
10. **Cache strategy**: Redis cache 60s para proximity queries, 5min para PostGIS availability check
