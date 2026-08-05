# Database Schema — Severinno Marketplace

> Schema do banco de dados PostgreSQL do Severinno Marketplace.
> 21 tabelas, PostGIS espacial, soft-delete, full-text search.

---

## 📊 Visão Geral

```
┌─────────────────────────────────────────────────────────────┐
│                    ECOSSISTEMA DE DADOS                      │
├─────────────┬───────────────┬───────────────┬───────────────┤
│   Núcleo    │  Transacional │  Geoespacial  │  Suporte      │
│             │               │               │               │
│ • User      │ • Booking     │ • location    │ • Setting     │
│ • Category  │ • Payment     │   (PostGIS)   │ • ResetToken  │
│ • Service   │ • Review      │ • GiST index  │ • PushSubsc.  │
│             │ • QuoteReq    │ • ST_DWithin  │ • NotifPrefs  │
│             │ • Message     │ • ST_Distance │ • WalletTx    │
│             │ • Favorite    │               │ • SearchQueue │
│             │ • Notification│               │ • Settlement  │
└─────────────┴───────────────┴───────────────┴───────────────┘
```

---

## 📋 Modelos

### 1. User — Conta base (CLIENT | PROVIDER | ADMIN)

| Coluna        | Tipo                      | Descrição                                        |
| ------------- | ------------------------- | ------------------------------------------------ |
| id            | `TEXT PK`                 | CUID único                                       |
| email         | `TEXT UNIQUE`             | Login único                                      |
| passwordHash  | `TEXT`                    | bcrypt hash                                      |
| name          | `TEXT`                    | Nome completo                                    |
| role          | `TEXT`                    | `CLIENT` / `PROVIDER` / `ADMIN`                  |
| cpfCnpj       | `TEXT?`                   | CPF ou CNPJ                                      |
| whatsapp      | `TEXT?`                   | WhatsApp com DDI                                 |
| lat, lng      | `FLOAT?`                  | Coordenadas geográficas                          |
| location      | `geography(Point, 4326)?` | PostGIS (auto-sincronizado por trigger)          |
| search_vector | `tsvector?`               | Full-text search (auto-sincronizado por trigger) |
| avgRating     | `FLOAT`                   | Denormalizado (sincronizado por trigger)         |
| reviewCount   | `INT`                     | Denormalizado (sincronizado por trigger)         |
| favoriteCount | `INT`                     | Denormalizado (sincronizado por trigger)         |
| slug          | `TEXT? UNIQUE`            | URL amigável                                     |
| verified      | `BOOLEAN`                 | Documentos validados                             |
| active        | `BOOLEAN`                 | Conta ativa                                      |
| deletedAt     | `TIMESTAMPTZ?`            | Soft-delete                                      |

**Indexes:**

- `idx_user_role_active_verified` — `(role, active, verified)`
- `idx_user_city` — `(city)`
- `idx_user_lat_lng` — `(lat, lng)`
- `idx_user_location_gist` — GiST em `location`
- `idx_user_search_vector` — GIN em `search_vector`
- `idx_user_provider_list` — Partial `WHERE role = 'PROVIDER' AND active = true AND verified = true`

**Triggers:**

- `trg_sync_user_location` — Sincroniza `location` quando `lat/lng` mudam
- `trg_user_search_vector` — Atualiza `search_vector` quando `name/bio/city/district/street` mudam

---

### 2. Category — Árvore de 3 níveis

| Coluna   | Tipo                | Descrição                      |
| -------- | ------------------- | ------------------------------ |
| id       | `TEXT PK`           | CUID                           |
| name     | `TEXT`              | Nome (ex: "Reparos")           |
| slug     | `TEXT UNIQUE`       | URL amigável                   |
| parentId | `TEXT? FK→Category` | Categoria pai (nível 0 = null) |
| level    | `INT`               | 0=pai, 1=filha, 2=subcategoria |
| icon     | `TEXT?`             | Nome do ícone Lucide           |
| order    | `INT`               | Ordem de exibição              |
| active   | `BOOLEAN`           | Visível                        |

**Indexes:** `parentId`, `slug`, `level`

---

### 3. Service — Serviço oferecido por um prestador

| Coluna        | Tipo               | Descrição                                                      |
| ------------- | ------------------ | -------------------------------------------------------------- |
| id            | `TEXT PK`          | CUID                                                           |
| providerId    | `TEXT FK→User`     | Dono do serviço                                                |
| categoryId    | `TEXT FK→Category` | Categoria (nível 2)                                            |
| title         | `TEXT`             | Nome do serviço                                                |
| description   | `TEXT`             | Descrição detalhada                                            |
| basePrice     | `FLOAT`            | Preço base em R$                                               |
| unit          | `TEXT`             | `UNIDADE` / `METRO_LINEAR` / `METRO_QUADRADO` / `METRO_CUBICO` |
| photos        | `JSON`             | Array de URLs (máx 4)                                          |
| search_vector | `tsvector?`        | Full-text search (auto-sincronizado)                           |
| duration      | `INT?`             | Duração em minutos                                             |
| active        | `BOOLEAN`          | Visível                                                        |
| deletedAt     | `TIMESTAMPTZ?`     | Soft-delete                                                    |

**Indexes:** GIN em `search_vector`, `(providerId)`, `(categoryId)`, `(active)`, `(providerId, active, deletedAt)` partial, `(categoryId, active, basePrice)` partial

**Trigger:** `trg_service_search_vector` — Atualiza `search_vector` em `INSERT OR UPDATE OF title, description`

---

### 4. Booking — Agendamento de serviço

| Coluna        | Tipo                      | Descrição                                                           |
| ------------- | ------------------------- | ------------------------------------------------------------------- |
| id            | `TEXT PK`                 | CUID                                                                |
| clientId      | `TEXT FK→User`            | Quem contratou                                                      |
| providerId    | `TEXT FK→User`            | Prestador                                                           |
| serviceId     | `TEXT FK→Service`         | Serviço contratado                                                  |
| scheduledAt   | `TIMESTAMP`               | Data/hora agendada                                                  |
| status        | `TEXT`                    | `PENDING` / `CONFIRMED` / `IN_PROGRESS` / `COMPLETED` / `CANCELLED` |
| amount        | `FLOAT`                   | Valor total                                                         |
| paymentMethod | `TEXT`                    | `PIX` / `CARD`                                                      |
| paymentStatus | `TEXT`                    | `PENDING` / `PAID` / `REFUNDED`                                     |
| quoteId       | `TEXT? FK→QuoteRequest`   | Origem do orçamento                                                 |
| completionPin | `TEXT?`                   | PIN para confirmar conclusão                                        |
| location      | `geography(Point, 4326)?` | PostGIS (auto-sincronizado)                                         |
| deletedAt     | `TIMESTAMPTZ?`            | Soft-delete                                                         |

**Indexes compostos:** `(clientId, status, scheduledAt)`, `(providerId, status, scheduledAt)`, e mais 5 índices

---

### 5. Payment — Transação financeira

| Coluna         | Tipo                     | Descrição                       |
| -------------- | ------------------------ | ------------------------------- |
| id             | `TEXT PK`                | CUID                            |
| bookingId      | `TEXT FK→Booking UNIQUE` | 1:1 com agendamento             |
| amount         | `FLOAT`                  | Valor                           |
| method         | `TEXT`                   | `PIX` / `CARD`                  |
| status         | `TEXT`                   | `PENDING` / `PAID` / `REFUNDED` |
| lytexId        | `TEXT? UNIQUE`           | ID no Lytex                     |
| lytexStatus    | `TEXT?`                  | Status no Lytex                 |
| qrCode         | `TEXT?`                  | PIX copia-e-cola                |
| cardLastDigits | `TEXT?`                  | Final do cartão                 |

---

### 6. Review — Avaliação (1 por booking)

| Coluna     | Tipo                     | Descrição        |
| ---------- | ------------------------ | ---------------- |
| id         | `TEXT PK`                | CUID             |
| bookingId  | `TEXT FK→Booking UNIQUE` | Booking avaliado |
| clientId   | `TEXT FK→User`           | Autor            |
| providerId | `TEXT FK→User`           | Avaliado         |
| rating     | `INT`                    | 1-5              |
| comment    | `TEXT?`                  | Comentário       |

**Indexes composostos:** `(providerId, rating, createdAt)`, `(bookingId, rating)`

---

### 7. QuoteRequest + QuoteItem — Orçamento

**QuoteRequest** — Pedido de orçamento:

| Coluna   | Tipo                      | Descrição                                                     |
| -------- | ------------------------- | ------------------------------------------------------------- |
| status   | `TEXT`                    | `PENDING` / `RESPONDED` / `APPROVED` / `REJECTED` / `EXPIRED` |
| location | `geography(Point, 4326)?` | PostGIS (auto-sincronizado)                                   |

**QuoteItem** — Item do orçamento:

| Coluna       | Tipo     | Descrição                                      |
| ------------ | -------- | ---------------------------------------------- |
| status       | `TEXT`   | `PENDING` / `QUOTED` / `ACCEPTED` / `REJECTED` |
| price        | `FLOAT?` | Preço cotado pelo prestador                    |
| providerNote | `TEXT?`  | Observação                                     |

---

### 8. Demais Modelos

| Modelo                   | Propósito                | Colunas-chave                            |
| ------------------------ | ------------------------ | ---------------------------------------- |
| `ProviderAvailability`   | Horários semanais        | `dayOfWeek`, `startTime`, `endTime`      |
| `DateBlock`              | Bloqueio de datas        | `date`, `allDay`, `startTime`, `endTime` |
| `Message`                | Mensagens diretas        | `fromId`, `toId`, `read`, `bookingId`    |
| `Notification`           | Central de notificações  | `userId`, `type`, `read`                 |
| `Favorite`               | Favoritos                | `(clientId, providerId)` unique          |
| `SettlementPeriod`       | Ciclo de liquidação      | `type`, `status`, `startDate`, `endDate` |
| `ProviderSettlement`     | Liquidação por prestador | `(periodId, providerId)` unique          |
| `WalletTransaction`      | Histórico de saques      | `providerId`, `amount`, `status`         |
| `PushSubscription`       | Web Push                 | `endpoint` unique, `p256dh`, `auth`      |
| `NotificationPreference` | Preferências             | `(userId, type)` unique                  |
| `ResetToken`             | Reset de senha           | `token` unique, `expiresAt`              |
| `Setting`                | Configuração dinâmica    | `key` unique, `value`                    |
| `SearchReindexQueue`     | Fila de reindexação      | `entityType`, `entityId`, `action`       |

---

## 🔄 Triggers do Banco

| Trigger                          | Tabela       | Evento                                                         | Função                              |
| -------------------------------- | ------------ | -------------------------------------------------------------- | ----------------------------------- |
| `trg_sync_user_location`         | User         | `BEFORE INSERT OR UPDATE OF lat, lng`                          | Sincroniza `location` (geography)   |
| `trg_user_search_vector`         | User         | `BEFORE INSERT OR UPDATE OF name, bio, city, district, street` | Atualiza `search_vector`            |
| `trg_sync_booking_location`      | Booking      | `BEFORE INSERT OR UPDATE OF lat, lng`                          | Sincroniza `location` (geography)   |
| `trg_sync_quoterequest_location` | QuoteRequest | `BEFORE INSERT OR UPDATE OF lat, lng`                          | Sincroniza `location` (geography)   |
| `trg_service_search_vector`      | Service      | `BEFORE INSERT OR UPDATE OF title, description`                | Atualiza `search_vector`            |
| `trg_sync_user_review_stats`     | Review       | `AFTER INSERT OR UPDATE OR DELETE`                             | Atualiza `avgRating`, `reviewCount` |
| `trg_sync_user_favorite_count`   | Favorite     | `AFTER INSERT OR DELETE`                                       | Atualiza `favoriteCount`            |
| `trg_refresh_mv_on_review`       | Review       | `AFTER INSERT OR UPDATE OR DELETE`                             | Atualiza `mv_provider_stats`        |
| `trg_refresh_mv_on_booking`      | Booking      | `AFTER INSERT OR UPDATE OR DELETE`                             | Atualiza `mv_provider_stats`        |
| `trg_refresh_mv_on_favorite`     | Favorite     | `AFTER INSERT OR UPDATE OR DELETE`                             | Atualiza `mv_provider_stats`        |
| `trg_search_reindex_user`        | User         | `AFTER INSERT OR UPDATE OR DELETE`                             | Insere na fila de reindexação       |
| `trg_search_reindex_service`     | Service      | `AFTER INSERT OR UPDATE OR DELETE`                             | Insere na fila de reindexação       |
| `trg_search_reindex_category`    | Category     | `AFTER INSERT OR UPDATE OR DELETE`                             | Insere na fila de reindexação       |

---

## 📈 Materialized View

### mv_provider_stats

Pré-calcula estatísticas dos prestadores para evitar JOINs pesados na vitrine:

```sql
CREATE MATERIALIZED VIEW mv_provider_stats AS
SELECT
  u.id AS provider_id,
  COALESCE(AVG(r.rating)::float8, 0) AS avg_rating,
  COUNT(r.id)::int AS review_count,
  COUNT(DISTINCT b.id) FILTER (WHERE b.status = 'COMPLETED')::int AS completed_booking_count,
  COUNT(DISTINCT f.id)::int AS favorite_count
FROM "User" u
LEFT JOIN "Review" r ON r."providerId" = u.id
LEFT JOIN "Booking" b ON b."providerId" = u.id
LEFT JOIN "Favorite" f ON f."providerId" = u.id
WHERE u.role = 'PROVIDER'
GROUP BY u.id
WITH DATA;
```

**Índices:** `provider_id` (unique), `avg_rating DESC`, `completed_booking_count DESC`

**Refresh:** Automático via triggers nas tabelas Review, Booking e Favorite.

---

## 🔍 PostGIS / Geoespacial

3 tabelas com coluna `geography(Point, 4326)`:

| Tabela       | Coluna     | Trigger                          |
| ------------ | ---------- | -------------------------------- |
| User         | `location` | `trg_sync_user_location`         |
| Booking      | `location` | `trg_sync_booking_location`      |
| QuoteRequest | `location` | `trg_sync_quoterequest_location` |

Todas com índice GiST para queries espaciais rápidas (`ST_DWithin`, `ST_Distance`).

---

## 🗑️ Soft Delete

Tabelas com `deletedAt`:

- **User** — Prestadores/clientes removidos
- **Service** — Serviços removidos
- **Booking** — Agendamentos cancelados com retenção de histórico

A camada de soft-delete é aplicada automaticamente via `PrismaClient.$extends` em `src/lib/db.ts`.

---

## 📊 Total de Índices

| Fase        | Migração         | Qtd                      |
| ----------- | ---------------- | ------------------------ |
| Base        | `20260720010608` | 30 índices básicos       |
| Performance | `20260722120000` | 8 (GIN, GiST, compostos) |
| Compostos   | `20260724130000` | 9                        |
| Missing     | `20260724160000` | 7                        |
| User search | `20260726120000` | 1 (GIN)                  |
| **Total**   |                  | **~55 índices**          |

---

## 🔐 Convenções

- **IDs:** CUID (`cuid()`) — 25 caracteres, URL-safe
- **Timestamps:** `DateTime @default(now())` / `@updatedAt`
- **Enums:** `String` com validação em Zod (SQLite compat, PostgreSQL flexível)
- **Soft-delete:** `deletedAt: DateTime?` com filtro automático via `$extends`
- **Nomes:** camelCase no Prisma, PascalCase/SnakeCase no SQL (conforme Prisma)
- **Chaves estrangeiras:** `ON DELETE CASCADE` (usuário) / `RESTRICT` (serviço em booking) / `SET NULL` (categoria pai)
