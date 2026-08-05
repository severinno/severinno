# PostGIS Setup Guide

> Guia para configuração do PostgreSQL + PostGIS no ambiente de desenvolvimento do Severinno Marketplace.

## Quick Start

```bash
# 1. Start PostgreSQL + PostGIS
docker compose -f docker-compose.dev.yml up -d postgis

# 2. Push schema to PostgreSQL
DATABASE_URL="postgresql://severinno:severinno@localhost:5432/severinno" bun run db:push

# 3. Apply PostGIS migration (manual SQL)
PGPASSWORD=severinno psql -h localhost -U severinno -d severinno \
  -f prisma/migrations/XX_add_postgis/migration.sql

# 4. Seed data (auto-syncs location via trigger)
DATABASE_URL="postgresql://severinno:severinno@localhost:5432/severinno" bun run db:seed

# 5. Test spatial queries
DATABASE_URL="postgresql://severinno:severinno@localhost:5432/severinno" bun run test:postgis
```

## Environment Variables

Set in `.env.local`:

```env
DATABASE_URL="postgresql://severinno:severinno@localhost:5432/severinno"
REDIS_URL="redis://localhost:6380"
```

## Estrutura da Migração

A migração PostGIS (`prisma/migrations/XX_add_postgis/migration.sql`) inclui:

| Componente            | Descrição                                                               |
| --------------------- | ----------------------------------------------------------------------- |
| **PostGIS extension** | `CREATE EXTENSION IF NOT EXISTS postgis`                                |
| **Coluna `location`** | `geography(Point, 4326)` em User, Booking, QuoteRequest                 |
| **GiST index**        | `idx_user_location_gist` para queries espaciais rápidas                 |
| **Triggers**          | Sincronizam `location` automaticamente quando `lat`/`lng` são alterados |

### Modelos com coluna espacial

| Modelo         | Coluna                            | Trigger                          |
| -------------- | --------------------------------- | -------------------------------- |
| `User`         | `location geography(Point, 4326)` | `trg_sync_user_location`         |
| `Booking`      | `location geography(Point, 4326)` | `trg_sync_booking_location`      |
| `QuoteRequest` | `location geography(Point, 4326)` | `trg_sync_quoterequest_location` |

> **Importante:** As colunas `location` são gerenciadas por triggers SQL. Quando você atualiza `lat`/`lng` via Prisma, o trigger sincroniza `location` automaticamente. Para batch inserts (`createMany`), execute o sync manual via:
>
> ```sql
> UPDATE "User" SET location = ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography
> WHERE lat IS NOT NULL AND lng IS NOT NULL AND location IS NULL;
> ```

## Migrating de SQLite

Se você estava usando SQLite durante o MVP, use o script de migração:

```bash
# 1. Start PostgreSQL
docker compose -f docker-compose.dev.yml up -d postgis

# 2. Run migration
DATABASE_URL_SQLITE="file:./prisma/dev.db" \
DATABASE_URL_PG="postgresql://severinno:severinno@localhost:5432/severinno" \
bun scripts/migrate-sqlite-to-postgres.ts
```

## Verificação

Após configurar, execute o suite de testes PostGIS:

```bash
DATABASE_URL="postgresql://severinno:severinno@localhost:5432/severinno" \
bun run test:postgis
```

Saída esperada:

```
🧪 Testing PostGIS spatial operations...

✅ PostGIS extension is available
✅ location column exists on User
✅ location column exists on Booking
✅ Trigger sync invoked (INSERT with lat/lng)
✅ GiST index 'idx_user_location_gist' exists
✅ ST_Distance matches Haversine (PG: ...km, Haversine: ...km, diff: ...km)

📊 Results: 6 passed, 0 failed, 6 total
```

## Rollback

Para remover a extensão PostGIS e colunas espaciais (rollback):

```sql
DROP TRIGGER IF EXISTS trg_sync_user_location ON "User";
DROP TRIGGER IF EXISTS trg_sync_booking_location ON "Booking";
DROP TRIGGER IF EXISTS trg_sync_quoterequest_location ON "QuoteRequest";
DROP FUNCTION IF EXISTS sync_user_location();
DROP FUNCTION IF EXISTS sync_booking_location();
DROP FUNCTION IF EXISTS sync_quoterequest_location();
DROP INDEX IF EXISTS idx_user_location_gist;
DROP INDEX IF EXISTS idx_booking_location_gist;
DROP INDEX IF EXISTS idx_quoterequest_location_gist;
ALTER TABLE "User" DROP COLUMN IF EXISTS location;
ALTER TABLE "Booking" DROP COLUMN IF EXISTS location;
ALTER TABLE "QuoteRequest" DROP COLUMN IF EXISTS location;
```

## Arquitetura

```
                    ┌─────────────────────┐
                    │   providers/route.ts │
                    │  (faz o merge SQL +  │
                    │   Prisma typed data) │
                    └──────┬──────────────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
     ┌──────────────┐ ┌──────────┐ ┌──────────┐
     │ postgis.ts   │ │ geo.ts   │ │ geo-     │
     │ (raw SQL:    │ │ (API de  │ │ shared.ts│
     │  ST_DWithin, │ │ CEP,     │ │ (math:   │
     │  ST_Distance)│ │ reverse  │ │ Haversine│
     │              │ │ geocode) │ │ fallback)│
     └──────────────┘ └──────────┘ └──────────┘
                           │
                           ▼
                    ┌──────────────┐
                    │ PostgreSQL   │
                    │ + PostGIS    │
                    │ + GiST index │
                    └──────────────┘
```

Para mais detalhes sobre a arquitetura do projeto, veja `Arquitetura_Software.md`.
