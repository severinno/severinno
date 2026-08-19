# API Reference — Severinno Marketplace

> Documentação completa dos endpoints REST da API.
> Base URL: `https://severinno.com.br/api`
> Última atualização: 2026-08-17

## Autenticação

A API usa cookies de sessão (`severinno_session`) com `SameSite=Lax`.
O cookie é definido automaticamente após `POST /api/auth/login` e
enviado em todas as requisições.

### Headers

```http
Cookie: severinno_session=<userId.role.expiresAt.signature>
Content-Type: application/json
```

### Respostas de Erro

```json
{
  "error": "Mensagem descritiva do erro"
}
```

| Status | Significado                             |
| :----: | :-------------------------------------- |
|  400   | Bad Request — validação falhou          |
|  401   | Unauthorized — não autenticado          |
|  403   | Forbidden — sem permissão               |
|  404   | Not Found                               |
|  409   | Conflict — estado conflitante           |
|  429   | Too Many Requests — rate limit excedido |
|  500   | Internal Server Error                   |

---

## Índice de Rotas

| #   | Rota                              |  Método   | Auth  | Descrição                |
| :-- | :-------------------------------- | :-------: | :---: | :----------------------- |
| 1   | [Auth](#1-auth)                   |           |       |                          |
|     | `/api/auth/register`              |   POST    |  ❌   | Criar conta              |
|     | `/api/auth/login`                 |   POST    |  ❌   | Autenticar               |
|     | `/api/auth/logout`                |   POST    |  ❌   | Destruir sessão          |
|     | `/api/auth/me`                    |    GET    |  ❌   | Usuário atual            |
|     | `/api/auth/forgot-password`       |   POST    |  ❌   | Recuperar senha          |
|     | `/api/auth/reset-password`        |   POST    |  ❌   | Resetar senha            |
| 2   | [Categories](#2-categories)       |           |       |                          |
|     | `/api/categories`                 |    GET    |  ❌   | Árvore de categorias     |
|     | `/api/categories`                 |   POST    | ADMIN | Criar categoria          |
|     | `/api/categories/:id`             | PATCH/DEL | ADMIN | Editar/remover categoria |
| 3   | [Providers](#3-providers)         |           |       |                          |
|     | `/api/providers`                  |    GET    |  ❌   | Listar prestadores       |
|     | `/api/providers/:id`              |    GET    |  ❌   | Detalhe do prestador     |
|     | `/api/providers/:id/favorite`     |   POST    |  ✅   | Favoritar                |
| 4   | [Services](#4-services)           |           |       |                          |
|     | `/api/services`                   |    GET    |  ❌   | Listar serviços          |
| 5   | [Search](#5-search)               |           |       |                          |
|     | `/api/search`                     |    GET    |  ❌   | Busca full-text          |
|     | `/api/search/providers`           |    GET    |  ❌   | Busca prestadores        |
|     | `/api/search/services`            |    GET    |  ❌   | Busca serviços           |
| 6   | [Geo](#6-geo)                     |           |       |                          |
|     | `/api/geo/cep`                    |    GET    |  ❌   | Geocode CEP              |
|     | `/api/geo/reverse`                |    GET    |  ❌   | Reverse geocode          |
| 7   | [Auth Required](#7-auth-required) |           |       |                          |
|     | `/api/users/me`                   | GET/PATCH |  ✅   | Perfil próprio           |
|     | `/api/bookings`                   | GET/POST  |  ✅   | Agendamentos             |
|     | `/api/bookings/:id`               | GET/PATCH |  ✅   | Detalhe booking          |
|     | `/api/bookings/:id/pay`           |   POST    |  ✅   | Pagar booking            |
|     | `/api/quotes`                     | GET/POST  |  ✅   | Orçamentos               |
|     | `/api/quotes/:id`                 | GET/PATCH |  ✅   | Detalhe orçamento        |
|     | `/api/messages`                   | GET/POST  |  ✅   | Mensagens                |
|     | `/api/availability`               | GET/POST  |  ✅   | Disponibilidade          |
|     | `/api/reviews`                    | GET/POST  |  ✅   | Avaliações               |
|     | `/api/notifications`              |    GET    |  ✅   | Notificações             |
|     | `/api/favorites`                  |    GET    |  ✅   | Favoritos                |
| 8   | [Admin](#8-admin)                 |           |       |                          |
|     | `/api/admin/stats`                |    GET    | ADMIN | Analytics                |
|     | `/api/admin/users`                |    GET    | ADMIN | Gerenciar usuários       |
|     | `/api/admin/services`             |    GET    | ADMIN | Gerenciar serviços       |
|     | `/api/admin/settings`             | GET/POST  | ADMIN | Configurações            |
|     | `/api/admin/settlements`          | GET/POST  | ADMIN | Repasses                 |
|     | `/api/admin/cache-routes`         |    GET    | ADMIN | Manifesto de cache       |
| 9   | [Push](#9-push)                   |           |       |                          |
|     | `/api/push/subscribe`             | POST/DEL  |  ✅   | Registrar/remover sub    |
|     | `/api/admin/push/send`            |   POST    | ADMIN | Enviar push manual       |
|     | `/api/push/payload/:id`           |    GET    |  ❌   | Buscar payload (SW)      |
|     | `/api/push/click`                 |   POST    |  ❌   | Tracking de clique (SW)  |
| 10  | [Webhooks](#10-webhooks)          |           |       |                          |
|     | `/api/webhooks/lytex`             |   POST    |  ❌   | Pagamentos Lytex         |
|     | `/api/webhooks/sentry-alert`      |   POST    |  ❌   | Alertas Sentry           |
| 11  | [Health](#11-health)              |           |       |                          |
|     | `/api/health`                     |    GET    |  ❌   | Healthcheck básico       |
|     | `/api/health/detailed`            |    GET    |  ❌   | Healthcheck detalhado    |
|     | `/api/metrics/prometheus`         |    GET    |  ❌   | Métricas OpenMetrics     |

---

## Panorama da API (v1.0.1)

A API totaliza **124 arquivos `route.ts` / 148 handlers HTTP** (GET 88 · POST 38 · PATCH 13 · DELETE 9), distribuídos em:

| Grupo                                                                                                        | Rotas | Cobertura abaixo                                  |
| :----------------------------------------------------------------------------------------------------------- | :---: | :------------------------------------------------ |
| `admin/*` (47: finance, settlements, push, geo-*, users, gateway…)                                           |  47   | Subconjunto nas seções 8–9                        |
| `cron/*` (8)                                                                                                 |   8   | — (agendamentos internos)                         |
| `provider/*` (8)                                                                                             |   8   | — (wallet, withdraw, history, export, onboarding) |
| `auth` (7)                                                                                                   |   7   | Seção 1                                           |
| `availability` (4)                                                                                           |   4   | —                                                 |
| `quotes` (4)                                                                                                 |   4   | Trecho na seção 7                                 |
| `push` (4)                                                                                                   |   4   | Seção 9                                           |
| `geo` (4)                                                                                                    |   4   | Seção 6                                           |
| `bookings` (3) / `search` (3) / `providers` (3) / `notifications` (3) / `webhooks` (3)                       |  15   | Seções 3, 5, 7, 10                                |
| `stats` (2) / `users` (2) / `services` (2) / `categories` (2) / `reviews` (2) / `health` (2) / `metrics` (2) |  14   | Seções 2, 4, 7, 11                                |
| Singles (`chat`, `messages`, `sentry`, `newsletter`, `monitor`, `tracking`, `upload`, `favorites`, raiz)     |   9   | Parcial (seção 7)                                 |

### Rotas existentes não detalhadas neste documento

- **Auth:** `POST /api/auth/change-password`, `POST /api/auth/forgot-password`, `POST /api/auth/reset-password` — ver `src/app/api/auth/`
- **Usuários:** `POST /api/users/me/slug` (definir slug do perfil)
- **Reviews:** `GET /api/reviews/recent`
- **Quotes:** `POST /api/quotes/[id]/book`, `PATCH /api/quotes/[id]/items/[itemId]`
- **Availability:** `DELETE /api/availability/[id]`, `GET|POST /api/availability/blocks`, `DELETE /api/availability/blocks/[id]`
- **Notifications:** `GET|PATCH /api/notifications/preferences`, `PATCH /api/notifications/[id]/read`
- **Tracking:** `GET /api/tracking/[id]` (posição GPS do prestador)
- **Chat:** `POST /api/chat` — ver `src/app/api/chat/`
- **Newsletter:** `POST /api/newsletter` (inscrever e-mail)
- **Stats:** `GET /api/stats/public`, `GET /api/stats/activity`
- **Sentry:** `POST /api/sentry` (tunnel de erros do client)
- **Geo:** `GET /api/geo/search`, `GET /api/geo/debug` (diagnóstico)
- **Webhooks:** `POST /api/webhooks/evolution` (WhatsApp), além de `sentry-alert` e `lytex`
- **Monitor:** `GET /api/monitor/push-failures`
- **Cron (8):** settlements, stats-infra, reminders, cleanup… — ver `src/app/api/cron/`
- **Admin (~40 não listados aqui):** `geo-*` (reindex, cache-diagnostics, rate-limit-status, query-log, snapshots-summary, metrics), `push/*` (analytics, audit, history, metrics, recurring, schedule, send, users, webhooks), `gateway/*`, `finance/*` (relatórios/export), `settlements/[id]/finalize`, `settlements/[id]/pay/[providerId]`, `users/[id]`, `commissions`, `benchmarks`, `coverage`, `errors`, `rate-limit-status`, `pgbouncer`, `redis-diagnostics`, `performance`, `stats`, `settings`, `services`, `cache-routes`
- **Provider:** `wallet`, `wallet/history`, `wallet/history/export`, `wallet/withdraw`, `onboarding`, `lytex`, `region-demand`, `stats` — ver `src/app/api/provider/`
- **Push:** `POST /api/push/action` (ação do usuário no push, ex.: abrir booking)

> Fonte da verdade: `src/app/api/**/route.ts` (o guard de cache usa `src/lib/cache-manifest.ts`).

---

## 1. Auth

### POST /api/auth/register

Criar nova conta.

**Request:**

```json
{
  "name": "João Silva",
  "email": "joao@email.com",
  "password": "minha-senha-123",
  "confirmPassword": "minha-senha-123",
  "role": "CLIENT",
  "cpfCnpj": "123.456.789-00",
  "whatsapp": "11999999999",
  "city": "São Paulo",
  "state": "SP"
}
```

**Rate limit:** 5/min

### POST /api/auth/login

**Request:**

```json
{
  "email": "joao@email.com",
  "password": "minha-senha-123"
}
```

**Response (200):**

```json
{
  "user": {
    "id": "clx...",
    "name": "João Silva",
    "email": "joao@email.com",
    "role": "CLIENT"
  }
}
```

**Rate limit:** 10/min

### POST /api/auth/logout

Remove o cookie de sessão.

### GET /api/auth/me

Retorna o usuário autenticado atual.

---

## 2. Categories

### GET /api/categories

Retorna a árvore completa de categorias (3 níveis).

**Cache:** `public, max-age=120, s-maxage=600`

**Response (200):**

```json
[
  {
    "id": "cat-1",
    "name": "Limpeza",
    "slug": "limpeza",
    "level": 0,
    "children": [
      {
        "id": "cat-1-1",
        "name": "Limpeza Residencial",
        "slug": "limpeza-residencial",
        "level": 1,
        "children": [
          { "id": "cat-1-1-1", "name": "Limpeza Simples", "slug": "limpeza-simples", "level": 2 },
          { "id": "cat-1-1-2", "name": "Limpeza Pesada", "slug": "limpeza-pesada", "level": 2 }
        ]
      }
    ]
  }
]
```

---

## 3. Providers

### GET /api/providers

Lista prestadores com filtros e geolocalização.

**Query Parameters:**

| Parâmetro    |  Tipo  |  Default   | Descrição                      |
| :----------- | :----: | :--------: | :----------------------------- |
| `lat`        | number |     —      | Latitude do usuário            |
| `lng`        | number |     —      | Longitude do usuário           |
| `categoryId` | string |     —      | Filtrar por categoria          |
| `search`     | string |     —      | Busca textual                  |
| `city`       | string |     —      | Filtrar por cidade             |
| `sort`       | string | `distance` | Ordenação (distance \| rating) |
| `page`       | number |     1      | Paginação                      |
| `limit`      | number |     20     | Resultados por página          |

**Cache:** `public, max-age=60, s-maxage=60`

### GET /api/providers/:id

Detalhe do prestador com serviços, avaliações e disponibilidade.

**Cache:** `private, max-age=60` (contém flag `favorited` por usuário)

---

## 4. Services

### GET /api/services

**Query Parameters:** `providerId`, `categoryId`, `search`

**Cache:** `public, max-age=30, s-maxage=120`

---

## 5. Search

### GET /api/search?q=diarista&lat=-23.55&lng=-46.63

Busca full-text usando PostgreSQL `tsvector` ranking.

**Cache:** `public, max-age=30, s-maxage=30`

---

## 6. Geo

### GET /api/geo/cep?cep=01001000

Busca endereço por CEP via ViaCEP.

**Cache:** `public, max-age=60, s-maxage=60`

### GET /api/geo/reverse?lat=-23.55&lng=-46.63

Reverse geocode via Nominatim (OpenStreetMap).

**Cache:** `public, max-age=60, s-maxage=60`

**Rate limit:** 1/s (respeita política do Nominatim)

---

## 7. Auth Required

### POST /api/bookings

**Request:**

```json
{
  "providerId": "clx-provider-1",
  "serviceId": "clx-service-1",
  "scheduledAt": "2026-08-15T14:00:00.000Z",
  "address": "Rua Augusta, 1500",
  "cep": "01304-001",
  "lat": -23.55,
  "lng": -46.63,
  "amount": 150.0,
  "paymentMethod": "PIX"
}
```

### POST /api/bookings/:id/pay

Inicia pagamento via Lytex (PIX ou Cartão).

**Rate limit:** 10/min (por usuário + por booking)

### POST /api/upload

Upload de arquivos (avatar, fotos de serviço).

```http
Content-Type: multipart/form-data
file: <arquivo>
type: avatar | service-photo
```

---

## 8. Admin

Todas as rotas admin requerem role `ADMIN`.

### GET /api/admin/stats

Dashboard de analytics da plataforma.

### GET /api/admin/settlements

Lista períodos de repasse financeiro.

### POST /api/admin/settlements

Cria novo período de repasse.

**Rate limit:** 10/min

---

## 9. Push

### POST /api/push/subscribe

Registra a subscription do navegador para push notifications.
`DELETE` remove a subscription (logout / opt-out).

**Request (POST):**

```json
{
  "endpoint": "https://fcm.googleapis.com/fcm/send/...",
  "keys": {
    "p256dh": "BGe...",
    "auth": "kD8..."
  }
}
```

### GET /api/push/payload/:id

Usado pelo service worker para buscar payload completo quando o push
contém apenas um sinal (payload > 4KB).

---

## 10. Webhooks

### POST /api/webhooks/lytex

Recebe notificações de pagamento da Lytex (PIX confirmado, cartão aprovado).

**Validação:** HMAC-SHA256 signature verification com `LYTEX_CLIENT_SECRET`

**Rate limit:** 20/min

---

## 11. Health

### GET /api/health

Healthcheck básico (DB + Redis).

### GET /api/health/detailed

Healthcheck detalhado com status de 10 serviços.

**Query Parameters:**

| Parâmetro |  Tipo  | Default | Descrição              |
| :-------- | :----: | :-----: | :--------------------- |
| `format`  | string | `json`  | `json` ou `prometheus` |

**Prometheus/OpenMetrics:**

```http
GET /api/health/detailed?format=prometheus
Content-Type: text/plain; version=0.0.4

# HELP severinno_health_status Overall health
# TYPE severinno_health_status gauge
severinno_health_status{status="healthy"} 1
# EOF
```

### GET /api/metrics/prometheus

Redirect (302) para `/api/health/detailed?format=prometheus`.
Facilita configuração do Prometheus.
