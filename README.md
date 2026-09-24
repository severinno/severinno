# Severinno Marketplace

<p align="center">
  <a href="https://github.com/severinno/severinno/actions/workflows/ci.yml">
    <img src="https://github.com/severinno/severinno/actions/workflows/ci.yml/badge.svg" alt="CI/CD">
  </a>
  <a href="https://github.com/severinno/severinno/actions/workflows/pr-check.yml">
    <img src="https://github.com/severinno/severinno/actions/workflows/pr-check.yml/badge.svg" alt="PR Check">
  </a>
  <a href="https://github.com/severinno/severinno/actions/workflows/e2e-cache.yml">
    <img src="https://github.com/severinno/severinno/actions/workflows/e2e-cache.yml/badge.svg" alt="E2E Cache">
  </a>
  <img src="https://img.shields.io/badge/utf8--check-837%20files%20%E2%9C%85-2ea44f" alt="UTF-8: 837 files">
  <img src="https://img.shields.io/badge/tests-4.564%20unit%20%7C%20realtime%20e2e%204%2F4%20%E2%9C%85-2ea44f" alt="Tests: 4.564 unit | realtime E2E 4/4">
  <img src="https://img.shields.io/badge/encoding%20guards-8%2F8%20active%20%E2%9C%85-2ea44f" alt="Encoding guards: 8/8 active">
</p>

> Marketplace de serviços com geolocalização — encontre prestadores verificados próximos a você.

## Stack

| Layer          | Tech                                                                                 |
| -------------- | ------------------------------------------------------------------------------------ |
| **Frontend**   | Next.js 16 (App Router, Turbopack), React 19, Tailwind v4, shadcn/ui, Motion, XState |
| **Backend**    | Next.js API routes, Prisma ORM, Zod validation                                       |
| **Database**   | PostgreSQL 16 + PostGIS 3.4                                                          |
| **Cache**      | Redis 7 (geo cache, rate limiting, session)                                          |
| **Queue**      | RabbitMQ 4 (notifications, email)                                                    |
| **Routing**    | OSRM (fallback Haversine)                                                            |
| **Realtime**   | Socket.io (tracking, chat, notifications)                                            |
| **Auth**       | Session cookie HMAC-SHA256 (custom, no JWT)                                          |
| **Storage**    | S3-compatible (R2) with local fallback                                               |
| **Monitoring** | Sentry (errors), Pino (logs)                                                         |
| **Testing**    | Vitest (unit), Playwright (E2E)                                                      |
| **Container**  | Docker Compose (postgis, redis, rabbitmq, pgbackup)                                  |

## Quick Start

### Pré-requisitos

- **Bun ≥ 1.0** (`curl -fsSL https://bun.sh/install | bash`) — Node 20.9+ também funciona (ver `.nvmrc`)
- **Docker + Docker Compose** (para PostGIS, Redis, RabbitMQ, OpenSearch, MinIO, Realtime, GlitchTip)
- **Node 20 LTS** — `nvm use` respeita o `.nvmrc`

### Setup (um comando)

```bash
# 1. Instala dependências
bun install

# 2. Cria .env a partir do template (preencha os valores obrigatórios)
cp .env.example .env

# 3. Sobe a infraestrutura completa (PostGIS + Redis + RabbitMQ + Realtime + MinIO)
make infra

# 4. Aplica migrations, popula o banco com seed e indexa a busca — tudo em um comando
bun run db:setup

# 5. Sobe o servidor de desenvolvimento
bun run dev
```

### Alternativa: setup automático completo

```bash
make setup        # pré-requisitos + .env + infra + seed + dev server (detecta o compose certo)
```

> **Qual compose usar?** A infra real (PostGIS, RabbitMQ, OpenSearch, MinIO,
> GlitchTip, Realtime) mora no `docker-compose.dev.yml`. O `docker-compose.yml`
> contém apenas o serviço `app` (Next.js). Os targets do Makefile já apontam
> para o arquivo correto: `make infra` usa o dev.yml, `make build`/`make deploy`
> usam o app. Para incluir o OSRM (rota de mapa), use `make infra-full`.

> **DATABASE_URL:** o compose expõe o PostGIS na porta `5432` com DB `severinno`
> (usuário/senha `severinno`/`severinno`) e a imagem `postgis` já habilita
> a extensão no DB criado por ela. Para um DB criado manualmente, rode
> `CREATE EXTENSION postgis;` antes do `db push` (senão: `type "geography"
does not exist`). Ajustes locais vão em `.env.local` (gitignored).

> **Seed test hook (`SEED_SPEC_PATCH`):** os seeds aceitam um patch temporário
> do spec de categorias para validar convergência de update/rename nos E2Es —
> **só aplica fora de produção** (seed-prod exige `PROD_SEED_ALLOW_DEV=1`).
> Ver [docs/SECURITY.md#13-seed-test-hooks-seed_spec_patch](docs/SECURITY.md).

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌──────────────┐
│   Browser    │────▶│  Next.js 16  │────▶│  API Routes  │
│  (React SPA) │     │  (Server)    │     │ (124 rotas)  │
└─────────────┘     └──────┬───────┘     └──────┬───────┘
                           │                    │
                    ┌──────▼───────┐     ┌──────▼───────┐
                    │  Socket.io   │     │   Prisma     │
                    │  (port 3003) │     │     │        │
                    └──────────────┘     ┌────▼────┐    │
                                        │PostgreSQL│    │
                                        │ +PostGIS │    │
                                        └──────────┘    │
                    ┌──────────────┐     ┌──────────────┐
                    │    Redis     │     │   RabbitMQ   │
                    │ (cache/rate) │     │ (queue/email) │
                    └──────────────┘     └──────────────┘
```

### Mini-Services

O projeto possui serviços auxiliares independentes que rodam fora do Next.js.
Cada um pode ser executado individualmente para desenvolvimento ou debug.

#### Realtime (Socket.io)

Servidor WebSocket para notificações em tempo real, chat e tracking.

| Propriedade          | Valor                                                            |
| -------------------- | ---------------------------------------------------------------- |
| **Porta**            | `3003`                                                           |
| **Path**             | `/ws` (Socket.io) — `/health` (healthcheck), `/emit` (HTTP emit) |
| **Stack**            | Socket.io 4, Bun                                                 |
| **Docker**           | `docker compose up -d realtime`                                  |
| **Manual**           | `cd mini-services/realtime && bun index.ts`                      |
| **Dev (hot-reload)** | `cd mini-services/realtime && bun --hot index.ts`                |

**Healthcheck:** `curl http://localhost:3003/health` → `{"status":"ok"}`

**Envio manual de evento (debug):**

```bash
curl -X POST http://localhost:3003/emit \
  -H "Content-Type: application/json" \
  -d '{
    "event": "booking:update",
    "data": {
      "bookingId": "abc123",
      "clientId": "user-id-cliente",
      "providerId": "user-id-prestador",
      "status": "PENDING"
    }
  }'
```

**Eventos suportados:**

| Evento              | Roteamento                              | Descrição                  |
| ------------------- | --------------------------------------- | -------------------------- |
| `booking:update`    | `user:{clientId}` + `user:{providerId}` | Atualização de agendamento |
| `quote:update`      | `user:{clientId}` + `user:{providerId}` | Resposta de orçamento      |
| `message:send`      | `user:{toId}`                           | Nova mensagem no chat      |
| `notification:new`  | `user:{toId}`                           | Notificação push           |
| `tracking:position` | `user:{clientId}`                       | Posição em tempo real      |

**Conexão do cliente:**

- **Desenvolvimento:** Conecta direto em `http://localhost:3003` (via `NEXT_PUBLIC_REALTIME_URL` no `.env`)
- **Produção:** Conecta via Caddy em `/?XTransformPort=3003` (que roteia para o container `realtime:3003`)

#### Workers (RabbitMQ Consumers)

Processam filas de email e notificações em background.

```bash
# Consumer de notificações
bun run consumer

# Consumer de email
bun run src/queue/email-consumer.ts
```

#### OSRM Routing (Opcional)

Servidor de roteamento para cálculo de distâncias entre coordenadas.

```bash
docker compose --profile routing up -d osrm
```

Requer download de dados OSRM do Brasil (~600MB). Veja [documentação OSRM](https://project-osrm.org/docs/v5.24.0/api/).

## Views (SPA routing via `useViewStore`)

| View         | Description                                                    |
| ------------ | -------------------------------------------------------------- |
| `vitrine`    | Public storefront — hero, search, filters, provider cards, map |
| `client.*`   | Client dashboard — bookings, quotes, favorites, messages       |
| `provider.*` | Provider panel — services, agenda, finances, messages          |
| `admin.*`    | Admin panel — users, services, taxonomy, settings              |

## API Routes (124 rotas / 148 handlers)

### Public

- `GET  /api/providers` — list with filters, geolocation, pagination
- `GET  /api/providers/:id` — detail with services, reviews, availability
- `GET  /api/categories` — category tree
- `GET  /api/services` — list services (filter by providerId, categoryId, search)
- `GET  /api/search?q=` — full-text search with Postgres tsvector ranking
- `GET  /api/geo/cep?cep=` — geocode CEP via ViaCEP
- `GET  /api/geo/reverse?lat=&lng=` — reverse geocode via Nominatim
- `GET  /api/stats/public` — platform stats (providers, services, cities)
- `POST /api/newsletter` — subscribe email

### Auth

- `POST /api/auth/register` — create account
- `POST /api/auth/login` — authenticate
- `POST /api/auth/logout` — destroy session
- `GET  /api/auth/me` — current user

### Authenticated

- `GET|PATCH /api/users/me` — read/update own profile
- `GET|POST  /api/bookings` — list/create bookings
- `GET|PATCH /api/bookings/:id` — detail/update booking
- `POST /api/bookings/:id/pay` — confirm payment
- `GET|POST  /api/quotes` — list/request quotes
- `GET|PATCH /api/quotes/:id` — detail/respond to quote
- `GET|POST  /api/messages` — chat messages
- `GET|POST  /api/availability` — manage schedule
- `GET|POST  /api/reviews` — write/list reviews
- `GET  /api/favorites` — list favorites
- `POST /api/providers/:id/favorite` — toggle favorite
- `GET  /api/notifications` — list notifications
- `PATCH /api/notifications/:id/read` — mark as read
- `POST /api/upload` — upload file (avatar, photo)

### Admin

- `GET /api/admin/stats` — platform analytics
- `GET /api/admin/users` — list/manage users
- `GET|POST /api/admin/services` — manage all services
- `GET|POST /api/admin/settings` — platform settings

### Health

- `GET  /api/health` — DB + Redis + RabbitMQ status

## Environment Variables

See [`.env.example`](.env.example) for all variables and their descriptions.

## Scripts

### Development

```bash
bun run dev        # Development server (Next.js + Turbopack)
bun run build      # Production build
bun run start      # Start production server
bun run db:seed       # Seed database
```

### Workers

```bash
bun run consumer         # Start RabbitMQ notification worker
bun run src/queue/email-consumer.ts   # Start email queue worker
```

### Testes de Cache

```bash
# Fast gate — valida manifesto contra codigo real (~2s)
npx tsx scripts/validate-cache-manifest.ts

# Unit tests — 65 testes em 5 suites de cache
bun vitest run src/app/api/__tests__/all-cache-routes.test.ts
bun vitest run src/app/api/__tests__/providers-cache-header.test.ts
bun vitest run src/app/api/__tests__/categories-cache-header.test.ts
bun vitest run src/lib/__tests__/api-server.test.ts
bun vitest run src/lib/__tests__/routing.test.ts

# E2E cache headers via HTTP (requer servidor em :3000)
npx playwright test e2e/all-cache-routes.spec.ts --project=chromium
npx playwright test e2e/providers-cache.spec.ts --project=chromium

# Todos os testes de cache de uma vez
npx playwright test e2e/providers-cache.spec.ts e2e/all-cache-routes.spec.ts --project=chromium
```

### Geral

```bash
bun run test:run   # Run all unit tests (vitest run)
bun run e2e        # Run full Playwright E2E suite (all browsers)
npx playwright install  # Install Playwright browsers (first time only)
```

## Docker

```bash
# Start all services
docker compose up -d

# Start only infrastructure (dev mode)
docker compose up -d postgis redis rabbitmq

# Backup (daily)
docker compose --profile backup up -d pgbackup

# Routing (requires OSRM data)
docker compose --profile routing up -d osrm
```

## Diagnostic Scripts

Scripts de diagnóstico da infraestrutura Docker, localizados em `scripts/`.

| Script                   | Plataforma  | O que verifica                                                                                                      |
| ------------------------ | ----------- | ------------------------------------------------------------------------------------------------------------------- |
| `diagnose-docker.ps1`    | Windows     | Port bindings, healthchecks, redes, Hyper-V, conflitos de porta, recursos Docker                                    |
| `diagnose-docker.sh`     | Linux / Mac | Mesmo que o .ps1, exceto Hyper-V (Windows-only)                                                                     |
| `diagnose-completo.sh`   | Linux / Mac | Tudo do `diagnose-docker.sh` + workers (RabbitMQ), filas, PostgreSQL, Redis, E2E                                    |
| `audit-secret-leaks.mjs` | Node        | Varre `git log -p --all` por segredos vazados no histórico (chaves privadas, `sk-*`, tokens, atribuições de `.env`) |

### audit-secret-leaks — segredos vazados no histórico do git

Um segredo commitado uma vez fica no histórico **para sempre** — mesmo após
`git rm --cached` — então a única remediação real é **rotacionar** o valor
(via `scripts/rotate-secrets.mjs`). Este script **audita** o histórico para
responder _quais commits expõem o quê_:

```bash
bun run audit:secret-leaks                  # audita todo o histórico
node scripts/audit-secret-leaks.mjs --since origin/main   # só commits novos
node scripts/audit-secret-leaks.mjs --max-count 100       # limita commits
node scripts/audit-secret-leaks.mjs --json                # saída JSON
node scripts/audit-secret-leaks.mjs --check               # exit 1 se achar
node scripts/audit-secret-leaks.mjs --include-tests       # inclui fixtures
```

**Detecta:** chaves privadas (RSA/EC/OPENSSH/PGP), tokens com prefixo
(`sk-*`, `sk_live_*`, `ghp_*`, `github_pat_*`, `xox*`, `AKIA*`) e atribuições
de secrets em `.env` (`SESSION_SECRET=`, `DB_PASSWORD=`, `API_KEY=`, …).
Fixtures de teste (`sk-test-...`, `__tests__`, `test-fixtures`, `.example`)
são ignoradas por padrão (`--include-tests` para incluí-las).

**Segurança:** o output **mascara** os segredos (8 primeiros caracteres +
`…`) — nunca imprime o valor completo. A auditoria não é um CI guard padrão
(o histórico não muda em PRs normais); é uma ferramenta de operação — rode
após onboarding, antes de tornar o repo público, ou em incident response de
vazamento.

> **Guard semanal de baseline** (`scripts/check-secret-leaks-baseline.mjs`, job
> `secret-leaks-audit` do `benchmark-weekly.yml`): roda a auditoria contra o
> histórico completo (`git log -p --all`, `fetch-depth: 0`) e compara com o
> baseline commitado [`docs/security/secret-leaks-baseline.json`](docs/security/secret-leaks-baseline.json)
> (o número de achados conhecidos vive no ARQUIVO, nunca aqui: ele é derivado).
> Falha (exit 1) **somente se CONTEÚDO novo aparecer**, por assinatura
> `arquivo:linha:padrão:chave:valor-mascarado` — o **commit não entra** (não por
> count: linha trocada com count igual ainda é detectada como novo; achado
> removido não falha). A **proveniência do baseline** é reportada como **motivo
> próprio** — `intacta`, `indeterminado`, `reescrita` (filter-repo/rebase/amend ou
> branch apagado) e **`raso`** (clone raso: o commit existe no remoto e só não foi
> baixado, então a ação é `git fetch --unshallow` e não caçar uma reescrita
> inexistente) — em vez de acusar os achados conhecidos como novos. Nenhum dos
> quatro falha o gate. O count do baseline é **derivado**, nunca
> literal: `node scripts/check-secret-leaks-baseline.mjs --update` regenera o
> arquivo a partir do audit real (mesmo princípio do badge de encoding guards).
> Após remediar um vazamento novo (rotação), rode `--update` para adotar o novo
> estado como baseline. Fail-closed: baseline ausente = exit 2 com instrução.

> **Guard semanal de drift semântico do README** (`scripts/check-readme-reverse-baseline.mjs`, job
> `readme-reverse-audit` do `benchmark-weekly.yml`): roda o `check-readme-anchors.mjs --reverse`
> (links que RESOLVEM mas apontam para o heading semanticamente errado — o
> forward não vê) e compara com o baseline commitado
> [`docs/security/readme-reverse-baseline.json`](docs/security/readme-reverse-baseline.json)
> — **0 achados conhecidos** (2026-08, o README passa `--reverse` limpo). Falha (exit 1)
> **somente se achados NOVOS aparecerem**, por assinatura `file+slug+label`
> (não por count; a linha NÃO participa — o README cresce e as linhas migram
> a cada edição, então comparar por linha geraria falso alarme). O count do
> baseline é **derivado**, nunca literal: `node scripts/check-readme-reverse-baseline.mjs --update`
> regenera o arquivo a partir do guard real. O job é **semanal por design** —
> drift semântico não bloqueia PRs (o forward já é gate no CI/hooks); o
> `--reverse-strict` (mais agressivo, flagia prosa single-token) fica fora do
> CI como gate. Fail-closed: baseline ausente = exit 2 com instrução.
>
> **Ticket acionável (não só falha):** quando o guard acha achados NOVOS, o
> job `readme-reverse-audit` publica **uma GitHub Issue por achado** via
> `scripts/readme-reverse-issue.mjs` (`gh issue create`, label `readme-drift`,
> `permissions: issues: write`) — o link, o heading atual e a sugestão do
> heading correto viram um ticket. **Dedup por assinatura** `file+slug+label`
> (a MESMA do baseline, importada sem drift) contra issues abertas: a issue
> vira o estado da dívida até ser fechada — sem duplicata a cada run semanal.
> Preview local sem criar nada: `node scripts/readme-reverse-issue.mjs --dry-run`
> (ou com `--report <arquivo.json>` para um report pré-gerado, sem rede).
>
> **Alerta audível (não-gate) do strict:** o job `readme-reverse-strict-alert`
> do pr-check.yml (workflow_dispatch) roda o `--reverse-strict` com
> `--prose-allowlist abaixo,acima,seguir,aqui,fluxo` e emite `::warning::` por
> achado sem bloquear o merge. A allowlist exime palavras de prosa comum que o
> strict flagaria como falso positivo (medido 08/2026: o label 'abaixo' →
> heading legítimo) — a renomeação single-token REAL continua pega (token
> permitido que exista como heading em outro lugar → regra 4 com sugestão).

### diagnose-docker (Windows / Linux / Mac)

Diagnóstico básico da infraestrutura:

| #   | Seção                  | Descrição                                               |
| --- | ---------------------- | ------------------------------------------------------- |
| 1   | Pré-requisitos         | Docker CLI, Compose, daemon, curl, jq                   |
| 2   | Portas Excluídas (PS1) | Hyper-V / Windows (`netsh`) — apenas no `.ps1`          |
| 2/3 | Port Conflicts         | Portas ocupadas no host (ss / lsof / netstat)           |
| 3/4 | Container Status       | `docker compose ps` + healthcheck parsing               |
| 4/5 | Port Bindings          | `docker inspect` — publicadas vs expostas               |
| 5/6 | Networks               | frontend / backend, flag `internal`, containers na rede |
| 6/7 | Healthcheck            | HTTP endpoints (Realtime + Next.js)                     |
| 7/8 | Docker Resources       | `docker system df`                                      |

**Uso:**

```bash
# Windows
powershell -ExecutionPolicy Bypass -File scripts/diagnose-docker.ps1
powershell -ExecutionPolicy Bypass -File scripts/diagnose-docker.ps1 -Verbose

# Linux / Mac
./scripts/diagnose-docker.sh
./scripts/diagnose-docker.sh -v
```

### diagnose-completo (Linux / Mac)

Diagnóstico completo da stack, incluindo workers e serviços:

| #   | Seção             | Descrição                                                                 |
| --- | ----------------- | ------------------------------------------------------------------------- |
| 1-5 | (mesmo do básico) | Portas, containers, bindings, redes                                       |
| 6   | **Workers**       | email-worker + notification-worker: estado, logs, restart count           |
| 7   | **RabbitMQ**      | Conectividade, filas, consumidores, exchange (`rabbitmqctl`)              |
| 8   | **DB & Redis**    | PostgreSQL (`pg_isready`), Redis (`PING`) via `docker exec`               |
| 9   | Healthcheck       | Realtime + Next.js `/api/health` com parsing de serviços                  |
| 10  | **E2E Filas**     | Publica mensagem via `rabbitmqctl publish`, verifica consumo before/after |
| 11  | Docker Resources  | `docker system df`                                                        |

**Uso:**

```bash
./scripts/diagnose-completo.sh
./scripts/diagnose-completo.sh -v
```

**Pré-requisitos:**

- `docker` + `docker compose` funcionando
- `curl` (para healthchecks HTTP)
- `jq` (recomendado para parsing JSON preciso)
- `ss` ou `lsof` ou `netstat` (para detecção de portas)

**Requisitos dos workers:** Os workers precisam estar rodando via Docker Compose:

```bash
docker compose up -d app realtime postgis redis rabbitmq email-worker notification-worker
```

## Documentação

| Documento                                                  | Descrição                                                       |
| :--------------------------------------------------------- | :-------------------------------------------------------------- |
| [`docs/API.md`](docs/API.md)                               | Referência completa da API REST (124 rotas / 148 handlers)      |
| [`docs/CACHE_STRATEGY.md`](docs/CACHE_STRATEGY.md)         | Estratégia de cache em 3 camadas (Redis + HTTP + Browser)       |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)                 | Guia de deploy em produção com Docker + Caddy                   |
| [`docs/PUSH_NOTIFICATIONS.md`](docs/PUSH_NOTIFICATIONS.md) | Sistema de push notifications (Web Push, agendamento, webhooks) |
| [`docs/SECURITY.md`](docs/SECURITY.md)                     | Medidas de segurança (CSP, rate limiting, criptografia, Docker) |
| [`docs/TESTING.md`](docs/TESTING.md)                       | Guia de testes (Vitest + Playwright, padrões de mock)           |
| [`docs/BUN_BUMP.md`](docs/BUN_BUMP.md)                     | Procedimento completo de bump do Bun (variável + mirrors GHCR)  |
| [`docs/postgis-guide.md`](docs/postgis-guide.md)           | Guia de PostGIS (geolocalização, consultas espaciais)           |
| [`lytex-integration.md`](lytex-integration.md)             | Integração com Lytex Pagamentos (PIX + Cartão)                  |
| [`Arquitetura_Software.md`](Arquitetura_Software.md)       | Arquitetura de software do sistema                              |

## Testing

```bash
# Unit tests
bun vitest run

# Watch mode
bun vitest

# Snapshot update (regenera todos os snapshots)
bun run test:snapshot-update

# E2E (requires built app + Playwright browsers)
npx playwright install
bun run e2e
```

> **Snapshot management:** `bun run test:snapshot-update` → revisar `git diff`.
> [Guia completo → `docs/TESTING.md#snapshot-management`](docs/TESTING.md#snapshot-management)

## Encoding Guards

Quatro camadas de proteção previnem que arquivos com encoding corrompido (ex: byte `0x97` Windows-1252) cheguem ao repositório:

**Índice da seção (9 sub-blocos):**

- [CRLF Guard](#crlf-guard) — working tree `.sh`/`.bash`
- [Normalizador](#normalizador) — fix de uma vez em novos checkouts
- [Blob CRLF Guard](#blob-crlf-guard) — blobs commitados (`i/` EOL)
- [CRLF Scope Guard](#crlf-scope-guard) — escopo travado em `.sh`/`.bash`
- [UTF-8 Scope Guard](#utf-8-scope-guard) — escopo do check-utf8 travado em `src/`
- [A régua única de leitura de YAML (`scripts/forge-workflows.mjs`)](#a-régua-única-de-leitura-de-yaml-scriptsforge-workflowsmjs) — linha, passo e declaração numa casa só
- [O retrato arquivado declara QUANDO cada passo roda (`check:archived-pipeline`)](#o-retrato-arquivado-declara-quando-cada-passo-roda-checkarchived-pipeline) — as condições do `.woodpecker.yml` provadas contra a forja
- [O fecho de TLA das declarações do remédio (`check:tla-closure`)](#o-fecho-de-tla-das-declarações-do-remédio-checktla-closure) — nenhum top-level await alcançável: o ciclo mata o hook em silêncio
- [Por que `.sh`-only? (decisão ESCOPO INTENCIONAL)](#por-que-o-guard-de-crlf-é-sh-only-decisão-escopo-intencional)
- [Auditoria histórica de blobs CRLF](#auditoria-histórica-de-blobs-crlf) — histórico completo (`rev-list --all`)
- [Single-line out= Guard](#single-line-out-guard) — `cmd "..." out=$(...)` em 1 linha

⁶Tempos como estão desde **03/08/2026** (o commit que fixou estes valores). O
bloco precisa da âncora porque ele DECLARA duração: `node scripts/bench-freshness.mjs`
mede a idade dela como a das famílias do bench.

|       Camada       | Gatilho                    | Comando                                                           | Tempo |     Bloqueia?     |
| :----------------: | -------------------------- | ----------------------------------------------------------------- | :---: | :---------------: |
| 🏠 **Pre-commit**  | `git commit`               | `scripts/check-utf8.sh --dry-run --ci src/`                       |  ~2s  |     ✅ Exit 1     |
|  🚀 **Pre-push**   | `git push`                 | `scripts/check-utf8.sh --dry-run --ci src/`                       |  ~2s  |     ✅ Exit 1     |
|    🔄 **CI/CD**    | Push para `main`/`develop` | `scripts/check-utf8.sh --ci src/` (via `ci.yml`)                  | <10s  | ✅ Bloqueia build |
|  📋 **PR Check**   | `pull_request` para `main` | `scripts/check-utf8.sh --ci src/` (via `pr-check.yml`)            | <10s  | ✅ Bloqueia merge |
| 🔒 **CRLF Guard**  | `git commit` + push/PR     | `scripts/check-crlf.sh --ci` (pre-commit + `utf8-check.yml`)      |  <1s  |     ✅ Exit 1     |
|  📦 **Blob CRLF**  | `git commit` + push/PR     | `scripts/check-blob-crlf.sh --ci` (pre-commit + `utf8-check.yml`) |  <1s  |     ✅ Exit 1     |
| 🎯 **CRLF Scope**  | `git commit` + push/PR     | `scripts/check-crlf-scope.mjs` (pre-commit + `utf8-check.yml`)    |  <1s  |     ✅ Exit 1     |     | 🧨 **Single-line out=** | `git commit` + push/PR | `scripts/check-single-line-out-assign.sh --ci` (pre-commit + `utf8-check.yml`) | <1s | ✅ Exit 1 |
| 🎯 **UTF-8 Scope** | `git commit` + push/PR     | `scripts/check-utf8-scope.mjs` (pre-commit + `utf8-check.yml`)    |  <1s  |     ✅ Exit 1     |

**837 arquivos escaneados** (`.ts` + `.tsx`) em cada execução — zero corrupção encontrada.

### CRLF Guard

`scripts/check-crlf.sh` — complementa o `check-utf8.sh` verificando
se **qualquer `.sh`/`.bash` trackeado** tem CRLF no working tree. Git Bash tolera
CRLF, mas containers Linux (act/CI) quebram com `set: pipefail: invalid option
name` — o guard bloqueia o commit/PR antes que isso chegue ao CI.

### Normalizador

`scripts/normalize-crlf.sh` — aplica o fix de uma vez em
qualquer novo checkout/worktree — converte `.sh`/`.ts`/`.md` trackeados com CRLF
para LF no working tree e roda `git add --renormalize` (mudanças reais
unstaged são preservadas, nunca stageadas). Uso: `./scripts/normalize-crlf.sh`
(`--check` para falhar se houver CRLF, `--dry-run` para listar sem modificar).

### Blob CRLF Guard

`scripts/check-blob-crlf.sh` — complementa o guard de
working tree verificando a EOL do **blob commitado** (coluna `i/` de
`git ls-files --eol`). Um `.sh` commitado com CRLF no blob reproduz CRLF em
**todo checkout futuro, em qualquer branch** — mesmo com working tree limpo.
O guard falha (exit 1) se algum blob `.sh`/`.bash` tiver `i/crlf` ou `i/mixed`.
`--fix` roda `git add --renormalize` nos ofensores (revisar `git diff --cached`
e commitar).

### CRLF Scope Guard

`scripts/check-crlf-scope.mjs` — **trava a decisão de
escopo** dos guards CRLF no código — eles escaneiam **APENAS `*.sh`/`*.bash`**,
nunca `.ts`/`.tsx`. O guard falha (exit 1) se alguém estender os pathspecs do
`git ls-files` dos guards CRLF para qualquer outra extensão (ex.: `'*.ts'`
`'*.tsx'`), ou se o filtro de extensão for removido por completo.

### UTF-8 Scope Guard

`scripts/check-utf8-scope.mjs` — **trava a decisão de
escopo** do check-utf8.sh: as chamadas a `check-utf8.sh`/`check_utf8.py` devem
SEMPRE receber `src/` como argumento de diretório. O guard falha (exit 1) se
o argumento for removido (varredura sem diretório — potencialmente varrendo
`node_modules/` ou `.next/`) ou trocado para outro diretório. Espelho do
`check-crlf-scope.mjs`.

### A régua única de leitura de YAML (`scripts/forge-workflows.mjs`)

Os guards que leem workflow YAML (paridade de forja, refs, sintaxe dos `run:`,
cobertura de mutation test, sentinel, SIGPIPE, escopo de CRLF/UTF-8, espelhos do
Bun e call sites do setup do Bun) perguntam todos a MESMA coisa — _esta linha
executa? isto é um passo? isto é declaração?_ — e cada um respondia com a própria
cópia. Eram **quatro** leituras de passo e **oito** cópias da regra de
comentário, e as cópias já divergiam: duas não conheciam `/*`, uma só conhecia
`#`, e o comentário de FIM DE LINHA era ignorado em um guard e não no outro. Duas consequências medidas: o mesmo YAML dava **dois
vereditos dentro do `check-forge-parity`** (a régua de rótulo lia o corpo do
`run: |` e a de comando não — **11 arquivos** com gate visível sem comando
correspondente), e a correção do comentário de fim de linha teve de ser aplicada
duas vezes.

Hoje a régua é uma: `executableLine`/`executableLines` (comentário de linha e de
fim de linha fora, `${{ ... }}` do runner mascarado), `codeLine` (a MESMA régua
sem o mascaramento — para quem precisa da expressão INTEIRA como valor, como o
comparador de argumento do setup do Bun), `isCommentLine(line, { slash })` (a
SINTAXE é declarada no call site) e `workflowRunBodies` (item de lista, `- run:`
na mesma linha, bloco `|` **e** `>`, `shell:` antes ou depois do `run:`, fim do
corpo medido). Os últimos a chegar foram os scanners de linha do
`check-bun-mirror` (cinco cópias, uma delas com o alinhamento escrito no código
na forma _"mesmo tratamento do check-no-setup-bun.mjs"_) e o `check-no-setup-bun`:
a diferença não era de opinião, era de POSIÇÃO no arquivo — todos ignoravam só a
linha INTEIRA de comentário, então a prosa de um `#` no fim de linha valia como
declaração de versão, como path de cache ou como uso REAL do action. O que muda
no veredito está tabelado em
`docs/GUARDS.md` §22; a prova é `src/lib/__tests__/forge-workflows-ruler.test.ts`,
que além de medir a leitura de cada guard exige que ela continue vindo de um
lugar só (o regex do comentário de fim de linha e o padrão da expressão existem
em UM arquivo, e a varredura é sobre `scripts/*.mjs` inteiro — um guard novo com
a cópia derruba o teste sem ninguém registrá-lo).

### O retrato arquivado declara QUANDO cada passo roda (`check:archived-pipeline`)

`.woodpecker.yml` é a alternativa ao Gitea/Forgejo **avaliada e arquivada**: ela
fica versionada como registro, e o registro continua sendo lido como se
descrevesse a pipeline. Já havia dois gates sobre esse arquivo — a invariante 19
do `check-bun-mirror` (o **valor** da versão do Bun em cada uso) e o
`check:registry-source` (o **host** do registry) —, mas o `when:` de cada passo,
que é **quando** ele roda, não era julgado por ninguém: a forja muda o `on:` de
um workflow e o retrato segue afirmando o gatilho antigo, sem nada ficar
vermelho. O `check:archived-pipeline` fecha isso: cada passo **declara** a sua
condição em `when:` (lista de cláusulas, como no Woodpecker) e o gate **deriva**
dos workflows da forja os gatilhos (`on:`) e o `if:` de cada job para exigir
**igualdade**.

| o que o retrato dizia                                                | o que a forja faz                                                                                             |
| :------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------ |
| 10 passos de CI **sem** `when:` (o silêncio prometia "roda em tudo") | `ci.yml` roda em `push@[main, develop]` e `pull_request@[main]` — o gate exige as duas cláusulas **escritas** |
| `cron` do drift de required checks                                   | `schedule` **e** `workflow_dispatch` (a vigilância periódica também pode ser disparada à mão)                 |
| `push a main` nos três passos do deploy                              | `push a main` **e** `workflow_dispatch`                                                                       |
| passo de notificação (`when: status:`) sem contraparte declarada     | **declarado** `# fora da forja: <motivo>` e NOMEADO no relatório                                              |

A contraparte de cada passo é descoberta pelo **comando** que ele roda (com a
canonicalização: `bun run check:x` vale pelo script que a entrada executa);
quando o comando é ambíguo (o mesmo script em dois jobs da forja) ou o passo é
plugin (`settings:`, sem comando), o passo **declara** a contraparte em
comentário (`# espelha: .gitea/workflows/deploy.yml#build`) e o gate confere o
alvo nos dois sentidos — arquivo, job e trabalho. Um `if:` que sai da gramática
declarada (função de STATUS, `startsWith`) **não** é adivinhado: o gate sai com
exit 2 nomeando workflow, job e expressão. O que NÃO é julgado aqui é o
CONJUNTO de passos (um job da forja sem passo no retrato é de outra régua) e o
`needs:` (dependência não é gatilho). A família e os limites estão em
`docs/GUARDS.md` §26.

### O fecho de TLA das declarações do remédio (`check:tla-closure`)

A regra estava só na **prosa**: o cabeçalho do loader das classes
(`remedy-classes.mjs`) e o do canal (`pr-fixers.mjs`) avisam que a descoberta é
assíncrona, e quem escreve a linha que quebra o hook não abre esse arquivo. A
regra é **nenhum módulo com top-level await pode ser alcançável a partir de uma
declaração de classe ou de canal** — e agora ela é veredito
(`docs/GUARDS.md` §29).

O que a execução mediu (`tla-cycle:prove`, que copia a árvore e injeta a aresta
de volta NA CÓPIA): quando o alcance **fecha o ciclo**, o `node` sai com **exit
13 e ZERO bytes** nos dois fluxos — o pre-commit perde a **oferta do remédio**
sem imprimir causa nenhuma. Um TLA alcançável **sem** aresta de volta carrega
normal (rc=0), e a régua o recusa mesmo assim, nomeando o caso (`CICLO · cadeia`
vs `sem volta · cadeia`): a aresta que falta é UMA importação escrita dentro do
módulo, e é o commit seguinte que a paga.

| o grafo                                                     | `node`                      | veredito   |
| :---------------------------------------------------------- | :-------------------------- | :--------- |
| árvore intacta (CONTROLE)                                   | rc=0, 0B                    | ✅ verde   |
| TLA alcançável **sem** volta                                | rc=0 — não mata             | ❌ recusa  |
| a declaração de CLASSE importa o loader das classes (CICLO) | rc=13, stdout 0B, stderr 0B | ❌ `CICLO` |
| a declaração de CANAL importa o loader do canal (CICLO)     | rc=13, stdout 0B, stderr 0B | ❌ `CICLO` |

O guard roda no **pre-commit** (~1,1s, na fase paralela) e nos jobs `guards`
(forja dona do merge) e `check` (espelho) com o MESMO comando. A prova é
executada nessas mesmas baterias pelo contrato do `check:prove-docs` (o guard que
EXECUTA cada bloco `prove-doc` documentado), sem step próprio: a régua do doctor
recusa `prove-*` como comando de gate da bateria do dono do merge. Os dois pares que já alcançavam TLA hoje
(`hook-commands` e `run-syntax` → `runner-shells.mjs`, cujo `await` é de ENTRADA)
estão em `ALCANCE_DECLARADO` com motivo e data, e o guard confere os dois
sentidos (um par que sumiu é violação: dívida paga não fica no papel).

### Por que o guard de CRLF é `.sh`-only (decisão ESCOPO INTENCIONAL)

> O guard existe para bloquear o único cenário em que CRLF causa **falha
> funcional**: `.sh`/`.bash` com CRLF no working tree quebram bash em
> containers Linux (`set: pipefail: invalid option name`). Estender o escopo
> para `.ts`/`.tsx` não protegeria nada — e falharia em **cada checkout
> Windows**. As evidências:
>
> 1. **CRLF em `.ts`/`.tsx` não quebra nada.** `tsc`/`next`/`bun`/`vitest`
>    aceitam CRLF sem reclamar; o problema do `.sh` é exclusivo do bash no
>    container.
> 2. **Os blobs são 100% LF** (fato invariante): `.gitattributes` (`*.ts
text eol=lf`) força LF no checkout e no commit; e a auditoria histórica
>    (`bun run audit:blob-crlf-history`, 2026-08) confirmou **0 blobs `.sh`
>    com CRLF** em todo o histórico (61 blobs únicos, ref por ref `i/lf`).
> 3. **O git NÃO vê o CRLF do working tree em `.ts`.** O clean filter
>    normaliza o CRLF na comparação — um checkout Windows pré-normalização
>    mostra `w/crlf` no disco **sem o `git status` marcar os arquivos**. Um
>    guard de working tree para `.ts` falharia em todo checkout Windows sem
>    sinal real (ruído puro).
> 4. **prettier + lint-staged já normalizam no commit.** `endOfLine: lf` no
>    `.prettierrc` + lint-staged (`prettier --write` em `*`) convertem
>    CRLF→LF no working tree a cada commit — o artefato de checkout de `.ts`
>    é corrigido na borda do commit, sem precisar de guard.
>
> O artefato de checkout de `.ts`/`.md`, quando aparece, é corrigido de uma
> vez com `./scripts/normalize-crlf.sh` (não com um guard). Decisão completa
> no header do `check-crlf.sh` (ESCOPO INTENCIONAL).

### Auditoria histórica de blobs CRLF

`scripts/audit_blob_crlf_history.py` (`bun run audit:blob-crlf-history`) —
varre TODO o histórico alcançável
(`git rev-list --all --objects`) e detecta qualquer blob cujo conteúdo
contenha CR (0x0D) — um registro permanente de que nenhum commit passado
reintroduzirá CRLF em checkouts futuros.

#### Dois escopos (extendido 2026-08)

- `bun run audit:blob-crlf-history` — **GATE** (default): apenas `.sh`/`.bash`
  (CRLF QUEBRA bash em containers Linux; exit 1 = falha no CI).
- `bun run audit:blob-crlf-history:all-text` — **REPORT** (`--all-text`):
  TODOS os tipos com `eol=lf` no `.gitattributes` (`.md`/`.ts`/`.tsx`/`.mjs`/
  `.cjs`/`.js`/`.json`/`.css`/`.scss`/`.prisma`/`.sql`/`.yml`/`.yaml`/`.sh`/
  `.bash`/`.svg`) — mapeia o alcance real de CRLF em blobs commitados
  ANTES do `.gitattributes` sem virar gate (CRLF nesses tipos não quebra
  toolchain; prettier normaliza no commit). Exit 0 sempre.
- `--extensions .md,.ts` — lista explícita em modo GATE (exit 1 se achar).

> **Alerta semanal (`--all-text`, job `blob-crlf-all-text-alert` do `benchmark-weekly.yml`):**
> roda o audit em modo **REPORT** (`--all-text` — exit 0 sempre, CRLF em tipos
> benignos não é gate) e **grepa o output pelo sentinel `'com CRLF'`**: se o
> mapeamento revelar CRLF em qualquer tipo `text eol=lf` do `.gitattributes`, o
> job falha com aviso (incidente visível no Actions em vez de mapeamento
> silencioso).
>
> **A ISSUE é o canal** (o vermelho do run é a lembrança): o step
> `if: always()` roda `scripts/blob-crlf-scope-issue.mjs`, que lê o **mesmo**
> relatório teed (`--report all-text-report.txt`) + o exit code do audit
> (`--audit-exit`) — fonte única, sem re-varrer o histórico — e publica/comenta
> **UMA issue** (label `crlf-scope-drift`) com os blobs e tipos ofensores, o
> remédio (`git filter-repo`). O dedup é por **assinatura do conjunto de paths**:
> o mesmo alcance não vira ruído semanal, um achado NOVO comenta na issue aberta.
> Quando o audit volta a reportar **0 CRLF**, ele **reconcilia**: comenta a prova
> e fecha o que ele abriu (a dívida não fica aberta depois de resolvida). Um
> audit **quebrado** (exit != 0) NÃO publica e NÃO fecha — _não medido ≠ resolvido_.
>
> **Validação manual do alerta** (fixture git real + REPORT + réplica do gate,
> sem depender do cron) — o procedimento passo a passo está em
> [docs/TESTING.md — Auditoria de CRLF no histórico, run manual do alerta](docs/TESTING.md#auditoria-de-crlf-no-histórico--run-manual-do-alerta---all-text),
> e automatizado em **1 comando** (roda no CI — job `all-text-alert-validation`
> do pr-check — e localmente):
>
> ```bash
> bun run test:validate-all-text-alert
> ```
>
> O fluxo cria dois fixtures git reais (`autocrlf=false`): um **limpo** (`.md`
> LF + `.gitattributes` — o sentinel NÃO pode aparecer, senão seria falso
> positivo) e um **achado** (blob `.md` CRLF commitado ANTES do
> `.gitattributes` — o sentinel DEVE aparecer, senão o grep do job estaria
> cego) — e replica o gate do job (`grep -Fq 'com CRLF'`). A semântica do
> alerta também está travada em teste unitário (`src/lib/__tests__/validate-all-text-alert.test.ts`).

> **Estado histórico (auditado em 2026-08, com a própria ferramenta):**
> **Gate `.sh`/`.bash`:** 69 blobs únicos no histórico — **0 com CRLF**.
> **`--all-text` (tipos `text eol=lf` do `.gitattributes` — lista DERIVADA
> do arquivo em runtime, não hardcoded; um tipo novo adicionado ao
> `.gitattributes` entra automaticamente na auditoria):** **2.962 blobs**
> únicos (sufixos `.md`/`.ts`/`.tsx`/`.mjs`/`.cjs`/`.js`/`.json`/`.css`/
> `.scss`/`.prisma`/`.sql`/`.yml`/`.yaml`/`.sh`/`.svg`/`.bash` + nomes
> exatos/globs sem extensão: `Makefile`, `Caddyfile*`, `Dockerfile*`,
> `.prettierrc`, `.husky/*`, `.env.*.example`) — **0 com CRLF**. Ou seja:
> o `.gitattributes` já protege todo o histórico; nenhum blob de texto
> commitado tem CRLF. **Correção retroativa NÃO é necessária** em nenhum
> escopo.
>
> **Por que não usar `grep $'\r'`:** no Git Bash/Windows, `grep -q $'\r'`
> **falha silenciosamente** (exit 0 mesmo em arquivo CRLF — tradução de
> pipe do MSYS). O script lê bytes via `git cat-file --batch` e testa 0x0D
> em Python, o mesmo mecanismo binário do `check_blob_crlf.py`.
>
> **Se um dia um blob CRLF entrar no histórico** (ex.: antes do
> `.gitattributes`, ou `autocrlf` desabilitado), a correção retroativa é
> **reescrita de história com `git filter-repo`** — deliberada e
> irreversível (rewrite hashes, requer force-push + coordenação de clones):
>
> ```bash
> # 1. Backups antes de qualquer rewrite
> git clone --mirror . /tmp/repo-backup.git
> # 2. Normalizar blobs .sh/.bash (CRLF → LF) em TODO o histórico
> git filter-repo --blob-callback '\
>   if b"\r" in blob.data and blob.path.endswith((".sh", ".bash")):
>       blob.data = blob.data.replace(b"\r\n", b"\n").replace(b"\r", b"\n")'
> # 3. Force-push + avisar todos os clones a re-clonar (hashes mudaram)
> ```
>
> Tradeoffs documentados: `filter-repo` reescreve TODOS os commit hashes a
> partir do primeiro blob alterado (PRs/issue links por hash quebram),
> invalidates assinaturas GPG e tags assinadas, e exige força-push com
> acordo de equipe. Por isso o guard de blob atual (check-blob-crlf) é a
> defesa de primeira linha — impede que o problema SEJA introduzido, em vez
> de depender de reescrita retroativa.

### Single-line out= Guard

`scripts/check-single-line-out-assign.sh` — falha
(exit 1) se um `.sh`/`.bash` trackeado sob `scripts/` tiver o padrão
`comando "..." out=$(...)` numa ÚNICA linha. Numa linha, o `out=` vira
ARGUMENTO POSICIONAL do comando (não atribuição): `out` nunca é setado e `$?`
captura o comando errado — o script quebra em silêncio enquanto a string de
count (ex.: `"128 checks"`) ainda passa no `check-e2e-counts.mjs` (falso
positivo). A forma correta são DUAS linhas:

```bash
cell "Rodando prod E2E (128 checks)..."
out=$(cd "$SCRIPT_DIR" && bun run test:seed-prod-e2e 2>&1)
```

#### Escopo deliberado (scripts/ only, travado em teste)

A convenção de
helpers `cell "..." + out=$(...)` vive em `scripts/` (E2Es de seed/CI), e o
escopo é travado em teste — `check-single-line-out-assign.test.ts` ignora
`.sh`/`.bash` fora de `scripts/` e `.ts`. Diferente do CRLF, estender a TODOS
os `.sh` seria inofensivo (sem falso positivo), então não há guard dedicado
como o `check-crlf-scope.mjs` — apenas o teste fixa o contrato.

> 📖 Veja [`docs/CACHE_STRATEGY.md`](docs/CACHE_STRATEGY.md) para lições aprendidas sobre:
>
> - **Next.js Vary injection** — App Router prepends seus próprios valores Vary
> - **Windows-1252 byte 0x97** — Como diagnosticar e corrigir encoding corrompido

## Git Hooks — Pre-commit vs Pre-push (simetria)

Os hooks locais (`.husky/`) formam uma cadeia de validação em camadas: o
**pre-commit** roda a stack completa de qualidade em cada commit; o
**pre-push** revalida os fast gates que o CI roda (`utf8-check.yml`) e os
testes da branch (via smart-skip) antes de expor o push ao remoto.

Os **17 fast gates compartilhados** (linhas `✅ | ✅` abaixo) rodam via
`scripts/run-encoding-guards.sh` — a **fonte única** da lista, chamada por
ambos os hooks. Adicionar um guard novo = editar esse script em UM lugar,
sem drift entre pre-commit e pre-push (e espelha o `utf8-check.yml`).

> O `check-hook-commands.mjs` **DESCE** nesse runner: ele julga também os
> comandos que os **scripts de shell chamados pelos hooks** executam por dentro
> (transitivo, cada script uma vez, com ciclo e teto NOMEADOS no relatório).
> Parar no alvo do `bash` deixava uma linha tipada DENTRO do
> `run-encoding-guards.sh` como o mesmo passo-que-nunca-roda, um nível abaixo —
> num arquivo que roda em **todo** commit. A descida segue também o alvo
> **PROVADO** por variável (`bash "$SCRIPT_DIR/x.sh"`): o interior de um script
> cujo caminho o guard acabou de provar não fica sem julgamento. E o alvo do interpretador
> (`python3 "$PYTHON_SCRIPT"`) é **PROVADO**, não declarado: o guard resolve as
> **atribuições de caminho do próprio arquivo** (incluindo o idioma
> `SCRIPT_DIR="$(cd $(dirname ${BASH_SOURCE[0]}) && pwd)"`), fail-closed quando
> algum valor não é estático, nem um conjunto acima do teto de combinações nem um
> valor que pode ser **VAZIO** (o `""` resolveria pelo DIRETÓRIO `node_modules/.bin`
> e o comando sairia verde). E o escopo **não é só o arquivo**: um script chamado
> por `bash` recebe o AMBIENTE, então o que o pai `export`ou é **herdado** pelo
> filho (com a proveniência no motivo), o `source` herda tudo e a atribuição do
> filho não apaga o valor herdado — a régua é a UNIÃO. O idioma do diretório viaja
> **congelado** (`o valor de quem EXPORTOU`, porque o bash exporta o VALOR e não a
> expressão): sem isso o filho o re-avaliaria no diretório DELE e o guard daria
> VERDE para um caminho que o processo novo nunca pode ver. O mesmo vale para a **entrada** de `bun run`
> montada em variável (`bun run "$ENTRADA"`): o valor provável tem de existir em
> `scripts` (ou ser binário de dependência declarada) e o que ele EXECUTA é
> julgado recursivamente — a decisão datada que cobria essa classe não distinguia
> a entrada que existe da que foi removida no mesmo commit. Detalhes no
> GUARDS.md §24.

> Por que os guards CRLF escaneiam só `.sh` (e não `.ts`)? — a decisão de
> escopo está documentada em
> [Encoding Guards → Por que `.sh`-only?](#por-que-o-guard-de-crlf-é-sh-only-decisão-escopo-intencional).

> O guard `check-hooks-symmetry.mjs` (linha "Hooks symmetry" acima) valida
> que esta tabela bate com o conteúdo REAL de `.husky/pre-commit` e
> `.husky/pre-push` — nas DUAS direções: adicionar um guard novo a um hook
> sem documentá-lo aqui falha o CI (`utf8-check.yml`) e o commit/push
> locais; e **remover um guard dos hooks deixando a linha órfã na tabela
> também falha** (linha stale). Linhas descritivas sem chave de script (ex.:
> "Snapshots (cond.)") são exceções documentadas no guard com a âncora do
> bloco real (`bun test:snapshots`) — se o bloco sumir do hook, a linha vira
> stale e falha igual.

| Validação                                                                       | Pre-commit |   Pre-push    |
| :------------------------------------------------------------------------------ | :--------: | :-----------: |
| UTF-8 (`check-utf8.sh --dry-run --ci src/`)                                     |     ✅     |      ✅       |
| Escopo UTF-8 (`check-utf8-scope.mjs`)                                           |     ✅     |      ✅       |
| CRLF working tree (`check-crlf.sh --ci`)                                        |     ✅     |      ✅       |
| Escopo CRLF (`check-crlf-scope.mjs`)                                            |     ✅     |      ✅       |
| CRLF blob commitado (`check-blob-crlf.sh --ci`)                                 |     ✅     |      ✅       |
| Single-line `out=` (`check-single-line-out-assign.sh`)                          |     ✅     |      ✅       |
| Badge encoding guards (`check-encoding-guards-badge.mjs`)                       |     ✅     |      ✅       |
| Docs repro marker (`check-readme-repro-marker.mjs`)                             |     ✅     |      ✅       |
| Âncoras README (`check-readme-anchors.mjs`)                                     |     ✅     |      ✅       |
| TOC README (`check-readme-toc.mjs`)                                             |     ✅     |      ✅       |
| Imagens README (`check-readme-images.mjs`)                                      |     ✅     |      ✅       |
| Setup-bun externo (`check-no-setup-bun.mjs`)                                    |     ✅     |      ✅       |
| Fonte única Bun (`check-bun-mirror.mjs`)                                        |     ✅     |      ✅       |
| Bun staged diff (`check-bun-mirror.mjs --staged`)                               |     ✅     |       —       |
| Ícones lucide (`scan-lucide-icons.mjs --check`)                                 |     ✅     |      ✅       |
| Hooks symmetry (`check-hooks-symmetry.mjs`)                                     |     ✅     |      ✅       |
| Paridade hook ↔ CI (`check-hook-ci-parity.mjs`)                                 |     ✅     |       —       |
| Comandos do hook resolvem (`check-hook-commands.mjs`)                           |     ✅     |       —       |
| Pipefail / SIGPIPE (`check-pipefail-sigpipe.mjs`)                               |     ✅     |       —       |
| Condições do retrato arquivado (`check-archived-pipeline.mjs`)                  |     ✅     |       —       |
| Fecho de TLA do remédio (`check-tla-closure.mjs`)                               |     ✅     |       —       |
| Hash citado na prosa (`check-doc-hashes.mjs`)                                   |     ✅     |       —       |
| Contagem da matriz no índice (`check-mutation-count.mjs --staged`)              |     ✅     |       —       |
| Mutation jobs CI (`check-mutation-jobs.mjs`)                                    |     ✅     |      ✅       |
| Mutation jobs staged diff (`check-mutation-jobs.mjs --staged`)                  |     ✅     |       —       |
| Unused-deps staged diff (`check-unused-deps.mjs --staged`)                      |     ✅     |       —       |
| Contrato mutation-coord (`check-mutation-timing-contract.mjs`)                  |     ✅     |      ✅       |
| Contrato mutation-coord staged (`check-mutation-timing-contract.mjs --staged`)  |     ✅     |       —       |
| Sintaxe shell staged diff (`check-workflow-run-syntax.mjs --staged`)            |     ✅     |       —       |
| Contrato de merge staged (`check-required-checks.mjs --staged`)                 |     ✅     |       —       |
| Escopo do lint no índice (`check-lint-scope.mjs --staged`)                      |     ✅     |       —       |
| Remédio do commit (`pre-commit-remedy.mjs`, classes derivadas, com confirmação) |     ✅     |       —       |
| Format + lint (lint-staged: prettier + eslint --fix)                            |     ✅     |       —       |
| Imports diretos (check:direct-rtl-import + barrel-lint)                         |     ✅     |       —       |
| Barrel lint (`barrel-lint`)                                                     |     ✅     |       —       |
| Typecheck (`bun run typecheck`)                                                 |     ✅     |      ✅       |
| Recorte do MEIO no push (`prove-stack-per-commit.mjs --pushed`)                 |     —      |      ✅       |
| Snapshots (quando `.snap`/snapshot tests alterados)                             |  ✅ cond.  |       —       |
| Testes unitários + fuzz (`test:unit`/`fuzz:ci`/`fuzz`)                          |     —      | ✅ smart-skip |

**Overhead medido** (`bash scripts/bench-encoding-guards.sh` — 5 runs, mediana
por guard): o TOTAL dos 17 guards ≈ **3.2s**, dominado por `check-blob-crlf`
(~0.59s), `check-utf8` (~0.56s) e `check-crlf` (~0.55s) — os três varrem
blobs/.ts/.sh inteiros. O `check-readme-toc` (README de 54 headings) custa
~**0.23s** — tão rápido quanto os demais guards de README (~0.22-0.25s); o
`check-single-line-out-assign` caiu de ~3s para ~0.46s (otimização
single-grep). Os testes entram apenas quando arquivos-fonte mudaram
(docs/config pulam via smart-skip).

**A doc não pode mentir sobre o NOME de um commit.** `check:doc-hashes` julga cada
citação de commit da prosa versionada contra a HISTÓRIA do HEAD: a rewrite
(rebase, `--amend`, a dobra de um conserto no commit que ele conserta) troca o nome
do commit preservando o assunto, e a citação velha fica órfã — o objeto continua no
repositório (o reflog o segura), então um `git cat-file -e` diz "existe" e a doc
passa a descrever um ato que ninguém consegue abrir (medido em 22/09/2026: a dobra
da proveniência deixou **21 citações órfãs** em 12 arquivos, e nenhuma falhava
nada). No órfão o guard NOMEIA o commit de MESMO assunto na história — o nome que a
rewrite deixou —, e o que não existe como commit (typo, cópia truncada) sai como
outro defeito, porque o remédio é outro. Número puro (`31536000`), digest de
artefato (`sha256:`), o `src/` e os fixtures `.ts` ficam fora da régua por DECISÃO
declarada no guard; fail-closed (exit 2) quando o git não responde. O comando é o
MESMO nas duas pipelines (invariante do CORE) e na bateria do `pre-commit`
(~0,7s), e a suíte de mutação declara oito metades — as duas últimas medem o
REMÉDIO e não a régua (o preview do `--fix` que GRAVA, e a confirmação explícita
que deixa de barrar).

E ele tem **remédio mecânico**: o `--fix` troca a citação órfã pelo commit de MESMO
assunto que a história deixou (o candidato que o próprio veredito nomeia), com
confirmação explícita no terminal — `--fix --dry-run` imprime o PATCH exato sem
gravar, e é esse mesmo patch que o job do PR publica como comentário, para o autor
aplicar com um clique. O que não tem remendo (órfão sem commit de mesmo assunto,
hash que não existe) sai NOMEADO: o remédio não inventa um nome.

**Overhead dos mutation tests por PR** — os mutation tests NÃO são fast gates:
rodam no job consolidado `mutation-guards` do `pr-check.yml`, que orquestra os
**41 sub-tests node-puro** via `scripts/test-mutation-guards.sh` — e, desde que a
isenção `GITHUB_ONLY` da classe caiu, o **mesmo comando** roda também no job
`guards` da **forja dona do merge** (o `check-forge-parity` exige a matriz e a
prova das três regras de classificação nas duas pipelines): quem mergeia na forja
não pode ficar verde com um guard **cego**, e o custo do passo entrou no modelo
(`ci/merge-latency.json`) com a procedência declarada — incluindo o **runtime**:
a suíte foi re-medida dentro do container da própria imagem do runner (32/32
sub-tests, 238.7s, contra os 248s medidos nativos), porque _a forja sabe rodar
isto?_ é a pergunta que autoriza a mudança.

**A lista acima não é escrita à mão** — nem aqui, nem no master, nem na doc do
guard: cada suíte declara as suas metades no bloco `METADES=(...)` do PRÓPRIO
script (`'id|o que a metade tira do lugar'`, **em aspas simples** — em aspas
duplas o shell expandiria a descrição antes de guardá-la e a suíte morreria com
`variável não associada`, defeito medido em quatro suítes), e é dali que o master
deriva a descrição de cada sub-test (`bash scripts/test-mutation-guards.sh
--list`) e o `check:mutation-count` confere a prosa desta doc e do
`docs/GUARDS.md`. Uma suíte que não declara o bloco FALHA (fail-closed), a
entrada em aspas duplas é recusada nomeando a expansão, e a contagem escrita na
doc que envelheceu contra o bloco acende com o delta — acrescentar uma mutação é
acrescentar UMA linha no bloco, sem prosa para atualizar em lugar nenhum.

**E a matriz tem um TERCEIRO lugar que a declara: o ATO que a versionou.** A prosa
pode estar toda certa enquanto o registro versionado do bench
(`docs/benchmarks/guard-timing-baseline.json`, família `mutations`) segue com as
formas do ato ANTERIOR — foi o que aconteceu em 22/09/2026: a matriz ganhou duas
entradas e o número declarado do job (e o PISO do job `guards`, que dele se soma)
passou a descrever uma matriz que já não existia, sem NADA no repositório olhar
para isso. O `check:mutation-count` passa a julgar essa ligação: todo sub-test da
matriz tem de ter a **forma** dele no ato, e a defasagem FALHA nomeando o sub-test
que ninguém versionou e o comando do ato (`node scripts/bench-guard-timing.mjs
--only mutations --json --baseline --merge`, com a árvore JÁ COMMITADA).

**E a coluna de metades é DERIVADA da matriz, não herdada do ato.** O custo
herda (é o que `meta.reused` descreve); a unidade NÃO — ela descreve a suíte, e a
suíte está nesta árvore. Até 23/09/2026 a coluna viajava junto com o custo, e uma
unidade acrescentada à suíte depois daquela medição ficava escrita como a
anterior: o registro dizia oito metades para uma suíte que já declarava dez, e
nada acusava. Agora o ato reescreve a coluna e o total da família a partir da
mesma régua que o master e a doc leem (`scripts/metades.mjs`, via
`metadesDaMatriz`), **depois** da herança, e diz o que fez no próprio registro
(`metadesDaMatriz`, com quantas formas ela corrigiu — a marca sai mesmo quando não
havia nada a corrigir: "nada mudou" e "a derivação não rodou" não podem ter a
mesma cara); o guard compara forma a forma contra a matriz de agora e
nomeia a que divergiu, e o total da família contra a própria coluna. A derivação
não inventa número: a forma que a matriz não
conhece e a que ela não conseguiu medir ficam intocadas e são ditas (zero ali
apagaria o número do registro, e a coluna não medida é lista, não acusação). Os
outros limites são da régua: o registro **fora
da árvore** não é violação — mas o veredito DIZ que a ligação não
foi julgada (nunca silêncio), e um registro presente e **corrompido** é exit 2, não
"nada a julgar". A metade que mede isso está na suíte do count (metades Q e R): a
coluna herdada FALHA nomeando a forma e o delta, e sem a derivação passada à régua
ela passa.

A prova da
CLASSIFICAÇÃO do `check-forge-parity` também é um job próprio
(`forge-parity-mutation`): ela mede o contrato de merge em si — quais gates
podem pular uma forja e com que forma de comando — e por isso diz QUAL regra
quebrou em vez de ser mais uma linha da matriz. Como a matriz, ela roda nas
DUAS forjas com o mesmo comando (na forja, dentro do job `guards`), e a mutação
que a prova carrega para isso é a remoção da matriz do dono do merge.

O `name:` do job `mutation-guards` é **count-free de propósito**: o nome de um
job é o **CONTEXTO do required check** que o branch protection exige, então um
número ali faria CADA bump da matriz reescrever o contrato de merge — a proteção
da forja passaria a exigir um check inexistente e o PR travaria, sem nenhuma
linha de gate parecer errada. O count vive onde é **diagnóstico** (aqui, no
summary do job, no comentário e no header do master) e o `check:mutation-count`
compara todos com o derivado; o `check:required-checks` recusa um `name:` de
required check que carregue uma contagem.

E o OUTRO LADO dessa lei é o que a mudança tem de TRAZER: quem bloqueia o merge é
a proteção APLICADA na forja, não o arquivo, então renomear um job required (ou
entrar/sair da lista) sem reaplicar deixaria a forja exigindo o contexto antigo —
o PR travaria num check que nunca roda. A reaplicação é **declarada** em
`ci/required-checks-applied.json`, escrito por `apply-required-checks.mjs --apply`
(nunca à mão: declarado = aplicado), e o mesmo `check:required-checks` compara a
declaração com os contextos derivados AGORA — sem a reaplicação declarada o PR
fica vermelho nomeando o job e os dois contextos.

Dois casos que essa lei passou a tratar por nome. O **gate CORE fora do
contrato**: o `CORE_INVARIANTS` declara `bun-mirror-guard` como o gate de merge
do GitHub para a invariante `bun-mirror`, e um gate CORE que roda fora do
manifesto fica vermelho sem bloquear nada (na Gitea a MESMA invariante roda
DENTRO do job `guards`, já required — por isso o id dela não aparece na lista de
lá). E a **forja que RECUSA a feature**: no GitHub (privado, plano sem branch
protection) nenhum required check pode ser aplicado nem lido, e o `--apply`
declara o estado em vez de abortar — `unsupported: {reason, readAt}` na entrada
da forja, os contextos passando a descrever a INTENÇÃO, e o veredito publicando a
forja sem portão em toda rodada, com o remédio de **plano/visibilidade** (nenhum
token resolve). O marcador mudo é violação: sem motivo e data, "não há portão"
vira mais um verde que esconde o fato.

> **A pergunta seguinte — "o registro BLOQUEIA?" — tem cron, não só operador**
> (`.github/workflows/merge-gate-proof.yml`, job `merge-gate-proof`, semanal): a
> prova `merge-gate:prove` sobe um Gitea efêmero, aplica o manifesto com o
> APLIADOR DE VERDADE e tenta mergear em quatro situações; ela rodava sob demanda,
> no host de quem já desconfia. O que ela mede é CÓDIGO (o applier) cujo efeito
> ninguém vê no PR: um registro com contexto a MENOS deixa o merge passar com o
> gate vermelho, com contexto a MAIS trava o PR para sempre, e uma CONTAGEM no nome
> do contexto muda o contrato sozinha quando a matriz cresce. O cron entrega o
> veredito ao publicador `merge-gate-issue.mjs`: **violado** abre/atualiza a issue
> (com o contexto exigido, o delta nas três direções, a matriz caso a caso e os
> LIMITES da prova — que saem do MESMO relatório do `--json`), **provado** comenta
> a prova e FECHA o que ele abriu, e **`unavailable`** (sem docker, imagem não
> puxável, API fora) não publica nem fecha — FALHA o run nomeando o caso, porque um
> cron que não mediu não pode terminar verde. Roda no runner self-hosted do GitHub
> porque a prova exige docker, e na forja da Gitea o job vive DENTRO do container
> da imagem, sem o socket montado — lá o veredito seria `unavailable` para sempre.
> A prova não mede a proteção do GitHub: mede a PEÇA, contra uma forja descartável.
>
> **E a OUTRA PONTA — o PR.** A issue chega na segunda-feira; quem mudou o applier
> está num PR hoje. O MESMO relatório vira um COMENTÁRIO RECONCILIADO no PR
> (`merge-gate-comment.mjs`): **violado** publica o contexto e o delta onde o autor
> lê, **provado** RETIRA o comentário (o delta sumiu) e **`unavailable`** não
> publica nem retira — não medido ≠ resolvido (quem FALHA por não medir é o cron).
> O run de PR filtra os CAMINHOS que a prova mede (o applier, o manifesto, o guard
> do contrato, os publicadores e o compose do ensaio), então um PR que não os toca
> não paga o custo de subir o Gitea efêmero.

A MESMA ideia rege o gate de sintaxe do shell do repositório: o job
`workflow-run-syntax` roda o guard REAL contra o working tree do PR e, no MESMO
job, `scripts/test-mutation-workflow-run-syntax.sh` prova por MUTAÇÃO que cada
mecanismo do gate é load-bearing: matar a metade do AVISO (o heredoc truncado que
o `bash` aprova, exit 0), tirar o corpo do STDIN do `bash`, alargar o LIMITE da
máscara de `${{ }}`, ler a ÁRVORE onde o recorte `--staged` deve ler o ÍNDICE,
aceitar qualquer `shell:` como presente na imagem do runner, remover a guarda do
corpo vazio no `--fix`, tirar a SEGUNDA FONTE (a varredura dos scripts de shell
que o passo executa com `bash scripts/x.sh`), tirar cada metade da TERCEIRA (o
`RUN` do Dockerfile e o payload do `sh -c`), ler o YAML como texto no lugar da
estrutura, não desfazer o `$$` do compose, ler o heredoc como código ou forçar
`isBashShell` a julgar todo passo como bash (o passo python legítimo vira violação
FALSA) têm de mudar o veredito do gate — e cada mutação é cirúrgica (as outras
metades seguem mordendo).
A última tem DUAS testemunhas: o gate por EXECUÇÃO e a **suíte unitária**, que tem
de ficar VERMELHA (a segunda roda quando o `vitest` está instalado e DIZ quando
não está — uma testemunha que falha por ambiente seria lida como mutante morto).

E o remédio do `--fix` atravessa a MESMA distância no PR:
`scripts/pr-remedy-comment.mjs` (passo do MESMO job, `always()`) publica o
**PATCH** do `--fix --dry-run` — o mesmo fixer, uma régua com dois consumidores —
como **COMENTÁRIO** no PR: copiar o bloco e colar no terminal aplica o remendo
inteiro. O patch é APLICÁVEL, e isso não é promessa: o teste roda `git apply` de
verdade e compara o resultado **byte a byte** com o que o `--fix` gravaria em outro
fixture idêntico. As RECUSAS (heredoc, forma dobrada `run: >`, arquivo de shell,
shell embutido) entram no MESMO comentário com o motivo de cada uma — um comentário
que só mostrasse o patch esconderia o que ele não cobre. O comentário é
**RECONCILIADO**: quando a cicatriz some ele é **RETIRADO sozinho**, em vez de
ficar aberto mentindo sobre um defeito que já não existe. Sem canal (token
ausente, PR de fork sem escrita) o passo NÃO falha — vira `::notice::`/`::warning::`
nomeado, porque o GATE é o veredito e o comentário é um canal a mais —, mas uma
API que existe e recusa é `::error::` e falha o passo: um canal que existe e não
publica é pior que a ausência dele.
O canal é **um módulo com um REGISTRO de fixers** (`FIXERS`, `--fixer <id>`): o
`pipefail-sigpipe` publica o patch do `| grep -q` → herestring pelo MESMO
mecanismo (`--fix --dry-run`, `git apply`, ciclo de reconciliação), e o
`doc-hashes` (seção da citação órfã) publica a troca do nome morto pelo nome que a
dobra deixou. Cada
fixer tem o SEU marcador: os remédios convivem no mesmo PR, e a reconciliação
de um não pode escolher — nem retirar — o comentário do outro. O patch dos dois sai
da MESMA construção de diff (`scripts/unified-patch.mjs`), com CONTEXTO no hunk — um
hunk sem contexto é recusado pelo `git apply`, e o comentário prometeria um remendo
inaplicável em silêncio.

**A pipeline não enumera fixers — ela invoca o REGISTRO** (`--all`, com o
`--backend` da forja): **um passo por pipeline**, e a cobertura sai de `FIXERS`, não
de uma lista escrita no YAML. Antes havia um passo por fixer nas DUAS pontas, o que
fazia de um fixer novo um trabalho de lembrar de editar dois workflows — e o passo
copiado de uma forja para a outra publicaria no canal errado, com o token errado,
sem nenhum veredito. O `check-forge-parity` mede isso como **quinta regra** (o canal
não é gate, então as quatro regras de classificação não o alcançavam): um passo por
pipeline, com `--all`, com a cobertura IGUAL à do registro (o fixer que ficar de fora
sai NOMEADO) e com o `--backend` da própria forja — e a prova por mutação G1–G3
mostra que remover o passo, estreitar a cobertura ou trocar o backend volta a
falhar o PR.

O `check-workflow-run-syntax.mjs` julga, além do PARSING, o `shell:` declarado
contra o que a imagem do runner MEDIU (ref, digest, data e o comando em
`--shells`): um passo com `shell: pwsh` num runner sem `pwsh` morria com
`command not found` DEPOIS do setup, e nenhum parser pega essa classe. Essa
declaração não fica dependendo de alguém lembrar de re-medir: o job semanal
`runner-shells-drift` roda o MESMO probe dentro da imagem, compara com o
declarado e publica a divergência como issue acionável (`runner-shells-issue.mjs`,
que também a FECHA quando a medição volta a bater, com a tabela medida de prova, e
que o doctor reporta como dívida aberta na prontidão — sem cruzamento de
caducidade, declarado);
as duas direções da mentira são invisíveis para os outros gates — declarar
presente o que a imagem não tem faz o gate PASSAR o passo que morre, e declarar
ausente o que existe faz REPROVAR um passo legítimo. Sem medição (sem docker,
imagem não puxável, `BUN_VERSION` sem valor) o cron **falha** em vez de ficar
verde. `--fix`
remenda a cicatriz mecânica (operador pendente no fim do corpo), `--fix --dry-run`
imprime o PATCH exato (STDOUT limpo, `| git apply`) **sem gravar** — é esse patch
que o comentário do PR publica —, e o `--fix` só grava depois
de o corpo voltar a fazer parsing — medido em memória E relendo o arquivo do
disco, com a gravação DESFEITA se o disco não passar; num ARQUIVO de shell ele
**recusa** com motivo escrito (a cicatriz que ele conhece é uma linha ancorada no
`run: |`) — recusa é veredito (exit 1), não um `✓` que esconde o script.

O MESMO guard roda no pre-commit como RECORTE `--staged` (declarado em
`HOOK_DECLARED`): julga os workflows E os scripts do ÍNDICE, com o conteúdo do
commit. Quando um gate do hook reprova por um defeito **MECÂNICO**, ele **OFERECE o
remendo** (`scripts/pre-commit-remedy.mjs`, comando `LOCAL` declarado) — em **UMA
pergunta** para as classes que o repositório já sabe consertar por máquina
(**sete** hoje: a oferta é DERIVADA de `scripts/remedy-classes/<id>.mjs`, um módulo
por classe declarado pelo GUARD DONO, então um fixer novo entra na oferta sem
ninguém editar o remédio — e uma declaração inválida RECUSA a rodada com exit 2 em
vez de sumir da oferta em silêncio): a cicatriz de `run:` (o `--fix` do gate), o CR/CRLF do working tree
(`check-crlf.sh --fix`), o CRLF do blob do índice (`check-blob-crlf.sh --fix`), o
byte 0x97 do UTF-8 (`check-utf8.sh --fix src/`), o **caminho tipado** num comando
de hook (`check-hook-commands.mjs --fix`, que troca o token pelo vizinho mais
próximo quando não há dúvida: até 2 caracteres de diferença, um candidato só, e
recusa EMPATE — e o token tem de estar NO hook: um caminho tipado DENTRO de um
script chamado sai como **recusa NOMEADA**, porque o remendo só escreve em
`.husky/`) e o **`PRODUTOR | grep -q` sob pipefail** (`check-pipefail-sigpipe.mjs
--fix`, o herestring que tira a intermitência do SIGPIPE), mais a **declaração de
espelho APAGADA** pelo commit (o arg `BUN_VERSION` de um build site do compose e o
`packageManager` do `package.json`, pelo `check-bun-mirror.mjs --fix`: ele restaura
da HEAD a linha que sumiu — a âncora única diz ONDE —, e NÃO remenda a linha que só
TROCA o valor, porque isso é divergência, não apagamento). Cada classe é DETECTADA e
REMENDADA pelo guard dono, rodado como o hook o roda (ou importado, quando o dono é
um módulo) — nenhuma régua paralela.

**O que faz uma classe ser OFERECÍVEL é o guard dono RODAR no hook** — o `--fix`
sozinho não basta, porque o remédio só é invocado quando uma fase do commit
reprova. É por isso que a sexta classe entrou junto com o guard dela na **fase B**
do pre-commit: o MESMO comando do CI, medido em ~0,14s (129 scripts + 33
workflows), em vez de mais um invariante em `HOOK_NOT_RUN` cujo remédio só
existiria no CI. A sétima é o caso OPOSTO, e reforça a mesma régua: o guard dono já
rodava — `check-bun-mirror.mjs --staged` é um dos seis guards da **fase A** —, e o
que faltava era ele saber se consertar; declarado o `--fix` no mesmo commit, a
recusa e o remendo passaram a viver no MESMO lugar (medido: com o arg apagado do
build site, a fase A recusa, o remendo volta ao índice e o `--staged` revalida
verde).

O preview usa o MESMO caminho de decisão do fixer (`dry`, nada gravado), a pergunta
diz os três efeitos do "sim" (remenda a ÁRVORE, re-estagia, REVALIDA) e o veredito
final é o do guard dono. O `git add` é RETIDO em arquivo que já tinha WIP (o
remendo fica na árvore e o operador é avisado), e a classe que ESTAGIA POR CONTA
PRÓPRIA (o blob, cujo fixer roda `git add --renormalize`) se retém quando não há
como separar o que ela estagiaria. A resposta vem do **TERMINAL DE
CONTROLE**: o git NÃO dá o terminal ao stdin do hook — medido, o fd 0 de dentro do
`git commit` está em `/dev/null` (o 1 e o 2 são o terminal) —, então o remédio
abre o **`/dev/tty`** e pergunta ali (a pergunta **acontece** no commit). Sem
terminal de controle (CI, `ssh` sem tty) o `/dev/tty` não abre: ele imprime o
caminho à mão e o commit segue bloqueado; a espera tem teto de 2 minutos
(`TTY_WAIT_MS`) e há um desligamento declarado da pergunta
(`PRE_COMMIT_REMEDY_NO_PROMPT`, para quem tem terminal e não tem operador — a
mesma pergunta, e o mesmo desligamento, que o `check-hook-commands --fix` usa). A
classe do caminho tipado tem uma consequência própria: ela REESCREVE O ARQUIVO QUE A
CASCA EXECUTA, então o remédio aplica, leva ao índice e **BLOQUEIA pedindo um `git
commit` NOVO** (o interpretador lê o arquivo por deslocamento; medido: exit 127 com
um "not found" numa linha posterior). As
**direções** (e a mutação que apaga a reexecução da fase) são medidas sob um pty de
verdade (`src/lib/__tests__/pre-commit-remedy-pty.test.ts`), sem injetar `isTTY`: o remédio
direto sob o terminal, o `git commit` (que pergunta, remenda e ENTRA com o "sim") e
a sessão sem terminal de controle (que não pergunta e bloqueia) —, mais o caminho
da **fase B**: com um defeito de encoding a pergunta também acontece, o remédio
remenda e re-estagia, e quem dá o veredito é a fase, rodada de novo. O bloqueio é
do HOOK, e em duas camadas: a variável que autoriza o commit nasce "não provou
nada" e só o **exit 0** do remédio a zera (o remédio pode LEVANTAR a falha, nunca
criá-la), **e** a fase que reprovou volta a rodar sobre o índice remendado — um exit
0 que não remendou nada não levanta falha nenhuma (medido com o desfecho do remédio
AFIRMADO por dublê). As **duas** fases do hook são **funções** (`fase_a`, `fase_b`)
justamente por isso: cada uma roda duas vezes quando o remédio entra — uma para
medir, outra para revalidar com o remendo já no índice —, e a reexecução cobre
**só as fases que estavam vermelhas** (pagar o instrumento de um veredito que já é
verde seria trabalho por nada) e alcança os guards que o `run-encoding-guards.sh`
nem chegou a rodar (ele para no primeiro que falha). A fase A entra nessa regra
como qualquer outra: a falha de um guard do ÍNDICE não levanta com um remédio
verde (medido por mutação: sem a reexecução dela, o commit com o gate do índice
vermelho PASSA) e — a metade que o operador sente — também **não engole a oferta**,
porque a oferta é das classes presentes no commit e não do gate que reprovou; a
fase B que a fase A vermelha deixou sem medição é medida no fim do bloco.

**O custo da oferta está medido nos DOIS caminhos do commit** (família `hook` do
`bench-guard-timing`, com a baseline versionada MOVIDA nesta rodada para ela; o
número vivo é o de `docs/benchmarks/guard-timing-latest.json`). No caminho **comum** (nada reprova) a
oferta custa **+1ms (≈0)**: ela não é alcançada, porque o `if` só abre com fase
vermelha — o custo é pago por quem TEM defeito, não em todo commit. A espera
SEPARADA do gate de sintaxe contra a agregação no `wait_all` custa **+1ms** (as duas
esperam o mesmo conjunto; o teto é o `max`). No caminho de **falha** (defeito no
índice, sem terminal) a oferta custa **+143ms**, e a fase rodada de novo depois de um
remédio VERDE custa **+71ms**. A sexta classe é o que cresceu aí: a detecção roda
todas as classes quando é invocada, e a do SIGPIPE varre o repositório inteiro (o
veredito dela é o estado da árvore, o mesmo `scanRoot` do CI) — a detecção contra a
árvore real saiu de **201ms para 305ms**. No caminho comum nada disso é pago (a
oferta só é alcançada com fase vermelha), e a invocação do guard no hook custa
**~0,14s**, em paralelo com as outras guardas da fase B. O contrafactual é uma transformação DO PRÓPRIO hook,
anunciada no texto dele (`sem-oferta` mantém o veredito e tira o bloco; `wait
agregado` devolve o gate ao `wait_all`) — sem as âncoras a família se declara **NÃO
MEDIDA**, em vez de comparar o hook com ele mesmo. A REVALIDAÇÃO é provada por
execução (o veredito do gate dono aparece **duas** vezes na saída quando o remédio
sai verde e **uma** no fail-closed), e a detecção da oferta contra a árvore real
(**182ms**) é read-only por construção, com o `git status` conferido antes e
depois: `escreveu: true` é violação da família, não um detalhe do log.

<!-- bench:mutations:custo — DERIVADO do registro (`mutations` da baseline); não edite à mão: o ato o reescreve -->

**O custo do job mais caro do PR não é uma conta à mão** (família `mutations` do
`bench-guard-timing`). O job `mutation-guards` roda 41 sub-tests, e o que CADA um
custa é medido pelo próprio master (`--json`) e versionado sub-test a sub-test no
registro: o ato VERSIONADO de 24/09/2026 (`30447a57`) — o MESMO comando, com a árvore COMMITADA —
mediu **479.8s** de sub-tests + **4.6s** de harness =
**484.5s**, com `job-deps` (109.3s, 23%), `workflow-run-syntax` (73.4s, 15%), `hook-commands` (60.2s, 13%) e `bench-freshness` (45.9s, 10%) no topo — antes disso
ninguém sabia QUAL sub-test pagava a conta. A mediana é **1.8s**, dez sub-tests
pagam **84%** da soma, e o registro guarda **252 metades**.
Quem entra com um sub-test novo não compõe nada: ele entra **MEDIDO** na rodada seguinte
(forma nova no relatório), e a projeção de quanto o PRÓXIMO acrescenta (**~11.8s**) é dita
como **PROJEÇÃO** — a média dos scripts já medidos mais o harness por sub-test. **LIMITE DECLARADO:** na rodada do ato, 3 sub-test(s) NÃO passaram (`pipefail-sigpipe`, `github-deps`, `pre-commit-proof`) — o custo deles não julga nada.

Esta prosa é **DERIVADA**: quem a reescreve é o ato (o bloco é dele), e o
`check:mutation-count` recusa o commit em que ela divirja do registro versionado.
<!-- /bench:mutations:custo -->

O ato é feito em DUAS rodadas, e isso é deliberado: `--no-mutations` mede a
bateria, o lint, o typecheck, a suíte e o hook, e `--only mutations --baseline
--merge` mede o master e MOVE a baseline herdando o resto, com o ato e o commit de
origem de cada família gravados no arquivo (`meta.families`), ao lado do ESTADO DA
ÁRVORE que o ato encontrou (`meta.treeState`) e do que cada forma mediu
(`meta.formOrigin`).

**E a IDADE dessa régua deixou de ser invisível** (`scripts/bench-freshness.mjs`,
seção **9/9** do doctor). O número da baseline é consumido **fora** do bench — o
modelo de latência de merge e as tabelas acima declaram o custo dos jobs a partir
dele —, e a comparação por percentual é **cega para QUANDO os dois números foram
medidos**: foi por essa fenda que uma divergência de **28%** no `mutation-guards`
(271.755ms declarados × 380.700ms medidos) viveu sem que nenhum guard a nomeasse.
A régua mede, por **declaração datada**, quantos commits de `HEAD` separam a
origem gravada da árvore de agora, e o teto é **DERIVADO do ritmo** do próprio
repositório, medido na hora: a política declara o que **não** se mede — **2
ciclos** do cron semanal, ritmo contado numa janela de **28 dias** e um **piso de
20/ciclo** (um repositório parado daria teto 0 e acusaria tudo) — e o número sai
desse produto (`ciclos × commits por ciclo`). A janela é fato medido, não gosto:
re-medida em 22/09/2026, ela dava 157 commits (14 dias dariam 164, 90 dariam 79 —
e a de 90 acusaria 22 das 35 declarações que têm teto, todas de menos de uma
semana de calendário; a janela ROLA, e é por isso que a política declara a janela
e nunca o número). Quando o git não
responde o ritmo, o teto cai na **reserva declarada de 150 commits** e o fato diz
qual das duas réguas valeu (`teto.origem`) — um teto silencioso é o defeito. O
mesmo passo semanal que publica a regressão de tempo publica esta como issue
(`bench-freshness-drift`, dedup por assinatura, fechada sozinha quando a régua é
re-medida).

**A terceira pergunta é o RELÓGIO DA MATRIZ — e ela abre ITEM DATADO.** As outras
duas são de conteúdo (a contagem de sub-tests e a existência do arquivo de cada
forma no commit de origem), e nenhuma delas olha o TEMPO: um sub-test cujo alvo
muda ou um corpo de suíte que muda de custo deixam o número declarado — e o piso do
job — descrevendo uma matriz que esta árvore não tem mais, **sem mexer em contagem
nenhuma**. O escopo do relógio é o master **e as suítes que ele cita**, o ritmo é
contado naqueles commits e o teto sai da política DELA (piso de 1 por ciclo). O que
o doctor publica quando ele vence é o item **`bench-ato-na-matriz`**, com a data
**derivada da história** (o primeiro commit que a matriz ganhou depois do ato, nunca
o relógio da run: um item que se re-datasse a cada execução nunca envelheceria) — no
relatório, no veredito e no corpo da issue, pela mesma frase. Ele é declarável como
qualquer dívida datada do `ci/unproven.json` (`kind: lacuna` + `closedBy:
ato-na-matriz`), e esse predicado fecha por **medição**: o relatório que mede o
relógio dentro do teto prova o item.

**E ela não mede só o bench: qualquer número declarado entra no MESMO julgamento.**
São três tipos, e o `kind` de cada um diz de onde ele vem: a família MEDIDA do
bench (a origem é o `commit` que a baseline grava), cada `ms` do modelo de
latência (`ci/merge-latency.json`) e cada tabela de custo DESTE README que declara
duração. Os dois últimos passaram a exigir a própria âncora — o número do modelo a
sua `date` e a tabela a data no bloco dela —, e a origem é DERIVADA dela
(`git rev-list -1 --before`), medida pela MESMA sonda (uma segunda régua de idade
divergiria da primeira no dia em que alguém ajustasse uma delas). O teto é POR
TIPO: o teto derivado para as famílias e para os números do modelo (os dois são
re-medidos no mesmo ato em que o guard ou o job muda — só o tipo tem política, não
o número), e **sem teto (a idade é publicada)** para a prosa de custo — ela é
re-medida quando o GUARD muda,
não por calendário, e um teto em commits compararia o ritmo do CÓDIGO com o da DOC.
A célula que só cita uma duração no meio de uma frase não é tabela de custo: o
tempo tem de começar a célula. O checkout daquele job é feito com a história inteira (`fetch-depth:
0`): a idade é contada em commits e um clone raso responderia "sem idade", nunca
"fresca". **A régua tem prova por mutação própria** (`scripts/test-mutation-bench-freshness.sh`,
**em DOZE direções**): cada regra que o veredito consome é desligada no lugar — a
derivação da origem pela data, a âncora de mês, o teto por tipo, a fronteira dele,
o fail-closed das duas fontes, o TETO DERIVADO do ritmo, a PROCEDÊNCIA dele, a
FONTE da forma no commit de origem, o fail-closed da pergunta que não pôde ser
feita, o ESCOPO do relógio da matriz (com o master sozinho, as 39 suítes que ele
cita saem da conta) e a DATA do item datado (com o relógio da run no lugar da
história, a lacuna nunca envelhece) — e o
vermelho é exigido, com a régua restaurada e
medindo o mesmo fato de novo no controle final. E a régua publica a procedência do
próprio teto: o relatório, o doctor e a issue repetem a linha do `tetoLine`
("derivado do ritmo — N commits em J dias …" ou "RESERVA declarada …"), para um
teto de fail-closed nunca sair com a cara de um teto medido.

**E ela pergunta também o que a origem CONTÉM.** A idade conta commits, e
distância não é conteúdo: foi por essa fenda que a `doc-hashes` viveu (medida em
22/09/2026 com a suíte no ÍNDICE, num ato cujo commit de origem — `8e76c9a6` —
não a tinha). O ato passou a gravar o ESTADO DA ÁRVORE (`meta.treeState`: limpa,
staged e unstaged, separados) e, por forma, se ela existe no commit de origem
(`meta.formOrigin`, com o `script` de cada forma no registro em vez de a fonte ser
adivinhada pelo nome). A régua de "de qual arquivo veio esta forma?" é UMA SÓ (a
folha `scripts/bench-families.mjs`), aplicada pelo ato à árvore e pela régua da
idade ao commit. O veredito publica a linha ao lado da idade (uma idade vencida
não pode MASCARAR uma forma que a origem não tem), a classe entra como dúvida com
o remédio — commite a árvore e rode o ato de novo — e o item
`bench-forma-fora-do-commit` do registro datado (`ci/unproven.json`) fecha só com
`missing` e `semResposta` em ZERO: "não perguntei" não fecha dívida. No
repositório de hoje ela MEDE uma forma fora (a `doc-hashes`), e é essa a dívida
aberta.

**LIMITE DECLARADO:** a régua mede FRESCOR, não exatidão — um commit a
mais pode não mudar nada do que a família mede; o que ela impede é o silêncio de
um número que ninguém re-mediu enquanto a árvore andou. **Gravar nunca
perde:** o que a rodada não mediu é herdado na ordem `[baseline, latest]` — a
baseline é o **piso** (uma família que a régua tem não chega `null` ao arquivo, e o
número dela vence quando as duas fontes o têm), e o arquivo diz de QUAL delas veio
o número (`meta.reused[].source`), sempre fora do veredito.

**E o que o veredito NÃO cobre passou a ter DATA** (`ci/unproven.json`, lido pela
régua `scripts/doctor-unproven.mjs` e publicado numa seção própria do
relatório). As duas listas do doctor — os `unproven` (o que ele não promete) e os
`unknowns` (o que não conseguiu medir) — eram honestas e **anônimas no tempo**:
sem data, uma lacuna nunca é reafirmada, nunca vence e nunca fecha, e o ciclo de
reconciliação das outras dívidas (issue aberta, fechada por **medição**) não a
alcançava. Cada item é uma declaração datada de duas classes — `lacuna` (o estado
que a prova exige não está ao alcance deste checkout: credencial, o env do host, a
stack de pé; **envelhece**) e `limite` (por desenho o veredito não cobre aquilo a
partir de um checkout: o histórico da forja, o smoke em runtime, o docker do job;
datado e **sem janela**) —, e o estado sai dos **próprios fatos** do relatório por
um predicado nomeado (o `closedBy`): `proven` (o fato foi medido — a entrada virou
letra morta e o remédio é removê-la), `open` (dentro da janela de **90 dias**: o
que ela acrescenta ao veredito é a **data**), `aged` (INDETERMINADA, com a janela
e o remédio), `invalid`/`unread` (**BLOQUEIA** — uma declaração sem data, ou um
registro ilegível, não tem como envelhecer, e "não li" nunca é "nada fora de
alcance"). A data chega à linha onde o operador lê, por um **trecho estável
declarado no próprio registro** (uma string ou uma lista de alternativas: o mesmo
assunto muda de lista conforme o estado medido) — e os testes exigem que cada
declaração viva case com **exatamente uma** linha do relatório de verdade, para
prosa reescrita falhar o PR em vez de envelhecer calada. O canal é o que já
existia: a declaração vencida entra no corpo da issue do veredito
(`forge-doctor-issue.mjs`) e a issue se fecha quando a prontidão volta — a mesma
reconciliação das outras dívidas, sem um segundo publicador. E o corpo da issue
sai **datado pela mesma régua** (o fato viaja no próprio relatório, não numa
segunda leitura do registro): o operador que lê o ticket vê desde quando a
lacuna existe, e a assinatura do dedup continua saindo do veredito cru — datar a
prosa não faz a mesma issue ser comentada de novo a cada dia.

Do lado do veredito, o que é de **classe sai uma vez**: os gates CORE cuja branch
protection não foi lida (ou cuja forja não tem o recurso) saem numa linha por
(causa, forja) — com a contagem e as invariantes alcançadas — em vez de uma linha
por gate, e as **duas causas da proteção** (o plano sem a feature × o token que
falta) saem as duas, nomeando as forjas de cada uma (antes elas eram um `else
if`, e a leitura que faltava desaparecia atrás do plano). Medido no perfil
completo em 22/09/2026: **64 das 71 linhas de "não provado" eram duas causas
repetidas**, e o muro escondia o resto do veredito. O detalhe por gate continua
no `--json` (`gateContracts.results[]`), e um teste mede a promessa pelo lado das
LINHAS: no estado medido daquele dia, **nenhuma** das três listas do veredito sai
sem data.

**O que a primeira medição de verdade encontrou (22/09/2026, perfil completo, com
`GH_TOKEN` e `GH_REPOSITORY`): hoje NENHUMA das duas forjas tem portão de
merge confirmado.** _(O canal do repo é `GH_REPOSITORY` desde a régua descrita no
`docs/GUARDS.md`: o doctor deixou de ler o `GITHUB_REPOSITORY` do ambiente — num
runner da Gitea ele aponta para o repositório da forja.)_ A Gitea — a dona do merge — porque a leitura da branch
protection exige `GITEA_TOKEN`; e o GitHub porque o repositório é **privado num
plano sem branch protection** (medido: `gh api …/protection/required_status_checks`
responde **HTTP 403**, "Upgrade to GitHub Pro or make this repository public"), o
que confirma por medição o estado que o applier já declarava em
`ci/required-checks-applied.json` desde 20/09. Para o espelho não há credencial que
resolva: é decisão de **plano × visibilidade**, e é ela que fecha (ou não) a
declaração. As duas lacunas estão datadas, com a prova e o remédio de cada uma —
e o mesmo perfil medido mostrou o runner auto-hospedado do GitHub **ausente**
(BLOQUEIO, com o `setup-github-runner.sh` declarando 4 labels) e o registro do
`act_runner` sem container para ler, o que é o estado que os itens descrevem.

**A re-medição do mesmo dia, com a régua fechada, é o que prova a promessa:**
perfil completo (`GH_TOKEN` + `GH_REPOSITORY` + `--expected 1.3.14`),
veredito **BLOQUEADA** por um bloqueio só (o runner do GitHub não registrado —
`gh api …/actions/runners` devolve `total_count: 0`), e as **19 linhas** das três
listas todas datadas, com os **14 itens** de `ci/unproven.json` consumidos e
nenhum órfão. Os 66 gates viraram 2 linhas (as duas causas, nomeando as forjas) e
o valor dos espelhos segue sem comparação (`gh variable list` continua só com
`BUN_VERSION` e `HOSTINGER_VM_ID`).

**E a TERCEIRA pergunta ao MESMO registro: a versão registrada × o PIN do
script.** O payload da API devolve, por runner, o campo `version` — a versão que o
**serviço aceitou** (o runner se atualiza sozinho para ela) —, e o
`RUNNER_VERSION` de `deploy/setup-github-runner.sh` é o pin que o repositório
declara: os dois têm de casar, **por valor** (o `v` de uma tag e o espaço em volta
não são drift). MEDIDO em 22/09/2026: com o pin em **2.320.0** o runner registrou,
pegou o primeiro job e se **auto-atualizou para 2.337.0 no MEIO dele** — o update
derruba o worker, o job fica **preso** em `in_progress` segurando o único runner
(o cancel do run e o remove do runner respondem `422 "is currently running a
job"`) e a forja fica **parada em vez de vermelha**. O drift entra numa lista
própria (`exit 1`, com o remédio do PIN — re-registrar com o mesmo pin recusado
reproduz o defeito), o doctor o trata como **BLOQUEIO**, e "não deu para julgar"
(script sem o pin, ou API sem o campo) **rebaixa** o veredito em vez de virar ✅.
A declaração datada `github-runner-version` (`ci/unproven.json`) dá a data a essa
linha e fecha **por medição** — quando o registro volta a responder a versão que
o script pina.

**E a MESMA pergunta do lado da forja, com o mecanismo invertido: a versão do
BINÁRIO do act_runner × a TAG que o compose declara.** O container do act_runner
não se auto-atualiza — quem decide a versão é a **IMAGEM** —, e o compose
declarava `gitea/act_runner:latest`: um `docker compose pull` de outro dia troca
a versão que roda **sem uma linha do repositório mudar** e sem sintoma nenhum na
forja. MEDIDO em 22/09/2026: a `latest` reportava `v0.6.1` e a tag `0.2.11`
reporta `v0.2.11`, as duas no disco — e a tag foi PINADA no mesmo dia em
**`gitea/act_runner:0.6.1`**, o mesmo digest que o `latest` servia (`v0.6.1` não
existe no registry: o `v` seria um pin quebrado), com o guard medindo
**`0.6.1 = tag 0.6.1 (proven)`** e o relatório fechando a entrada datada por
medição. O guard lê o `act_runner --version` dentro do
container e compara com a tag do **render**, por valor; o `drift` sai em
`versionViolations` (**exit 1**, com o remédio da TAG — re-registrar não muda a
versão de um milímetro), a tag que não pina versão sai `floating` (declaração
pendente), o pin por DIGEST sai `digest` (imutável, mas não declara versão — o que
evitá-lo em `floating`, cuja prosa afirmaria que "a versão que roda é a que o pull
do dia tiver servido"), e `no-image`/`unread` são o que não deu para julgar. No
veredito, o drift **BLOQUEIA** e os outros quatro **rebaixam**, com a lacuna datada
`act-runner-version` em `ci/unproven.json` fechando **por medição**.

**A medição seguinte (com o runner já registrado) mostra o mecanismo FECHANDO:** o
registro ficou com **16 itens** — 8 abertos, 6 limites e **2 provados** (o
`github-self-hosted-runner`, porque o runner passou a existir, e o
`github-runner-version`, porque o registro responde a versão que o script pina):
os dois saem do veredito como **letra morta**, com a data do fechamento e a
instrução de remover a entrada — a lacuna declarada em 22/09 deixou de existir, e
é isso que o registro tem de dizer. A classe não fica sem data quando o defeito
volta: o item é redeclarado (e o `matches` pode nomear o próprio id, para a linha
da letra morta também sair datada).

A OFERTA também é uma superfície MEDIDA, e não só o bloco que o operador lê:
`node scripts/pre-commit-remedy.mjs --oferta` roda a MESMA detecção (com o guard
dono de cada classe) e publica o payload em **JSON** no stdout, sem pergunta e
sem escrever na árvore nem no índice. A semântica é a da medição, não a do
remédio: a oferta vazia sai **exit 0** ("nada a remendar" é o fato medido, e quem
exige a classe é quem mede) e uma classe que não pôde ser medida sai **exit 2**
com o motivo — o mesmo fail-closed da oferta incompleta. É essa superfície que a
prova do runtime do CI consome: medir por TEXTO exigiria prosa como requisito, e
medir por exit code não diria QUAL classe foi oferecida.

A pergunta vem depois das fases (e a fase que não chegou a rodar é medida logo
depois do remédio — nenhuma fase fica sem veredito). Que o hook
**bloqueia de verdade** não é medido por leitura do arquivo:
`src/lib/__tests__/pre-commit-run-syntax-blocks.test.ts` EXECUTA o
`.husky/pre-commit` real num repo temporário com o defeito staged e exige exit 1
apontando arquivo e linha (e 0 + a manchete do guard no corpo são, que é o que
desmente um não-zero por motivo errado). O mesmo harness prova o recorte de
compose (`src/lib/__tests__/pre-commit-compose-arg-removal-blocks.test.ts`): o
commit que **REMOVE** o `BUN_VERSION` de um build site é recusado nomeando o
serviço, contra o estado base comitado — e sem a comparação bloco-do-índice ×
bloco-de-HEAD o commit passa. É esse mesmo fixture, com a fase A reprovando de
VERDADE, que mede a oferta sobrevivendo a um gate sem fixer: o remédio é oferecido
(o caminho à mão da classe que estava no MESMO índice) e a mutação que devolve o
hook ao estado do HEAD mostra a oferta sendo PERDIDA, com o mesmo veredito; a
reexecução da fase A depois de um remédio verde é medida pelo veredito do guard
aparecendo **duas** vezes na saída, e tirá-la faz o commit passar. O irmão dele
(`src/lib/__tests__/pre-commit-toolchain-removal-blocks.test.ts`) mede a outra
declaração que um commit pode apagar: o `packageManager` do `package.json`
sai do índice e o hook real recusa, nomeando o campo e o valor declarado — sem o
recorte registrado no guard, o commit passa. Quatro mutações cobrem as metades que a
leitura não vê: deixar de chamar o guard, perder o `--staged`, **deixar de chamar
o remédio** (o commit continua bloqueado — o bloqueio é do hook, não do remédio) e
**perder o veredito do gate** (aí o commit com a cicatriz entra); e a direção
oposta é medida também: com o remédio afirmado como exit 0, o hook **levanta** a
falha e o commit segue. A camada de baixo tem prova própria
(`src/lib/__tests__/pre-commit-git-commit-blocks.test.ts`): um `git commit` de
verdade com `core.hooksPath` apontando para os hooks, e o veredito medido no
**objeto** — corpo quebrado no índice ⇒ falha e **zero objeto de commit**
(`git cat-file`), corpo são ⇒ 1 objeto e a manchete do guard no modo `--staged`;
sem a chamada ao guard ou sem o `--staged` o defeito é **commitado**, e um hook
sem o bit de execução é ignorado por git (o commit entra) — as provas do hook
usam o MESMO simulador (`helpers/hook-simulator.ts`: repo git temporário, dublê
com passagem declarada para o processo real, medições no banco do git), e
`helpers/pre-commit-fixture.ts` é a camada com as constantes do `pre-commit`. O
`pre-push` tem prova própria na mesma máquina
(`src/lib/__tests__/pre-push-git-push-blocks.test.ts`, sobre a camada
`scripts/pre-push-proof.mjs` — a MESMA de onde o doctor executa
`provePushBlocks()` para publicar o fato): um `git push` de verdade
para um remoto **bare**, com o typecheck reprovando pelo CONTEÚDO versionado do
fixture e o veredito medido do outro lado — recusado ⇒ **zero ref e zero objeto**
no remoto, verde ⇒ o ref e o conteúdo chegando; quatro mutações (sem a chamada ao
typecheck, `hooksPath` para outro diretório, hook sem bit de execução e o dublê
**deixando de liberar** o processo real) medem, uma a uma, que essas metades são
load-bearing. O fast path do smart-skip tinha a MESMA classe de defeito — o
typecheck rodava como `bun run typecheck 2>&1 | head -5` e, sem `pipefail`, o
status da pipeline era o do `head`: o não-zero era MASCARADO (o payload reprovava
e o push entrava). **Consertado**: a saída é CAPTURADA (`TYPE_OUT=$(bun run
typecheck 2>&1)`), o veredito é o do comando e o recorte sai por `head` sobre
herestring (sem produtor vivo, logo sem SIGPIPE). Três mutações medem que o
conserto é o conserto: remover a fase 2 passa a RECUSAR o push (não mais
entregá-lo), devolver a pipeline que engole **inverte** o desfecho (o vermelho
chega ao ref do remoto) e remover as duas invocações deixa o defeito entrar sem
veredito nenhum sobre a árvore. Os DOIS elos têm
prova de execução **no veredito de prontidão** (`bun run doctor`), como PARTES do
MESMO fato — o `localContract`, que junta os dois elos EXECUTADOS e o que cada
hook RODA (a régua dos comandos vem do `check-hook-commands`, importada, não
recopiada): o do commit mede "nenhum objeto de commit criado" e o do push mede
"nenhum objeto chegou ao REMOTO" — o git consulta o remoto antes do hook e só
manda o pack depois dele, então a promessa do push só existe do outro lado. No
recorte do MERGE (`--ci`) as QUATRO partes do fato têm de sair `proven`: ali elas
só precisam de git/bash/bun e do próprio checkout, então um `unavailable` — ou um
`--no-pre-*-proof` no YAML do job — **BLOQUEIA** o veredito em vez de virar
INDETERMINADA. A quarta parte é o **LIMITE** das duas anteriores, medido com o
mesmo fixture: o `git push --no-verify` NÃO executa o hook, então a árvore
vermelha **CHEGA** ao remoto (ref, objetos e o conteúdo com o marcador na ref, e
o hook sem rodar — as invocações do typecheck ficam as do controle) e quem barra
o defeito depois é o CI: o comando do gate reprova o conteúdo que chegou, julgado
num **clone do remoto** e não na árvore de trabalho de quem empurrou. O relatório
diz isso com números ("limite (git push --no-verify)" e "quem barra: 'bun run
typecheck' … → exit 1") e a linha entra no "NÃO CUBRE": o hook local não é
barreira contra quem o desliga — o que sustenta a promessa é o job no contrato de
merge (o SINAL é medido ali, sobre os bytes que viajaram; o EFEITO na forja — o PR
com o check required vermelho não mergeando — é a prova `prove-gitea-merge-gate`,
contra um Gitea efêmero de verdade). `violated` nessa parte é o defeito passar pelos DOIS lados (contornar o
hook E o CI não reprovar o que chegou), e aí não há rede depois do gate local. E os dois elos têm, além
do fato, um job próprio que roda a prova **DENTRO do runtime do CI**
(`bun run pre-commit-in-runner:prove`, job `pre-commit-in-runner-proof` nas duas
pipelines, required check): o MESMO módulo de prova é lançado dentro da imagem
do runner — em lugar no job da forja (o label `docker://` já põe o job no
container da imagem, sem o socket do docker montado) ou por `docker run` no
espelho, cujo runner self-hosted é uma máquina com docker. Ali dentro o
`git version` da evidência é o DA IMAGEM, e o `--in-image` RECUSA (exit 2)
quando os marcadores do runtime (`/.dockerenv` + `/opt/acttoolcache`) não estão
lá — senão a prova mediria a máquina de quem a roda. O job roda essa prova em
DUAS FORMAS: a padrão (o hook somado ao dublê dos guards irmãos, declarada no
"NÃO CUBRE" dela) e a `--sem-duble`, que é a que fecha esse limite — o hook REAL
sobre uma CÓPIA do checkout, com as **duas fases rodando de verdade** (os
**seis guards de fase A, o gate e os dez membros da fase B**), a atribuição
medida por **exit code** (os seis saem 0 e o gate não, e
é o gate quem recusa o commit) e o CONTROLE entrando com o corpo fechado. A mesma
forma mede a **fase B pelo lado que RECUSA**: um byte `0x97` num `.ts` NOVO e um
link interno quebrado num `.md` NOVO entram no índice, o commit é recusado, a
**descida** do runner de encoding nomeia o guard de cada classe (`check-utf8.sh`,
`check-readme-anchors.mjs`) e o arquivo REMENDADO entra. E a mesma cópia mede o
**bump de matriz sem o ato que o versiona** — o defeito que só o commit local
produz: a matriz num commit e o registro do custo no seguinte. O
`check-mutation-count --staged` recusa aquele índice nomeando a defasagem e o
sub-test novo, com os irmãos de fase A, os membros da fase B e o gate **verdes no
MESMO índice** (sem isso a recusa não seria dele), e o CONTROLE — o mesmo índice
com o ato versionado — ENTRA com a forma conferida em HEAD. O texto
do hook é evidência, não veredito (a escrita num pipe pode perder uma linha); o
exit code não pode.

A forma padrão mede **duas metades**, e o exit code é o da pior delas. Além do
bloqueio, ela mede a **OFERTA do remédio**: um commit que **APAGA** o arg
`BUN_VERSION` de um build site de compose é recusado pelo **guard dono** rodando
de verdade no recorte `--staged`, a oferta nomeia a classe `bun-mirror-removal`
(medida pela CLI `--oferta` do MESMO script que o hook executa — a cópia do
fixture, byte a byte — e com o vínculo provado no lado DO HOOK: a saída do commit
cita a classe), e o `--fix` do dono devolve a declaração ao índice: o `--staged`
volta a 0 e o commit de CONTROLE entra. O CONTROLE soma uma mudança benigna ao
índice de propósito — o remendo RESTAURA o que o commit apagava, então o commit
sozinho seria **VAZIO** para o git (medido: `nada adicionado ao envio`), e o que
se mede é o veredito do hook com a declaração de volta. É a metade que faz o job
medir o REMÉDIO no runtime do CI, e não só o bloqueio: até aqui a oferta só era
medida no simulador (a suíte e o ensaio do pty). Ela custa **≈0,61s** (mediana de
3 execuções warm neste host, 09/2026) e é paga uma vez, pelo passo padrão do job.

> **"Cada commit da pilha passa SOZINHO?"** — o PR mede o TOPO, e a pilha tem commits no
> MEIO (`bun run stack-per-commit:prove`, `scripts/prove-stack-per-commit.mjs`): cada commit
> é materializado num `git worktree` PRÓPRIO (com o `node_modules` do repo medido ligado por
> symlink) e medido sozinho — os testes que o DIFF dele alcança (o grafo de imports e a
> convenção de nome) mais três invariantes de ÁRVORE que qualquer commit pode quebrar sem
> tocar o dono delas (a contagem da matriz, a paridade das forjas e a prosa da versão). O
> veredito é por commit: `vermelho` nomeia o commit e o gate, `indeterminado` (worktree que
> não abriu, comando ausente, timeout) nunca vale verde, e acima do teto de commits a pilha
> sai INDETERMINADA. Medido na cadeia do `#25` (16 commits): **três commits NÃO passavam
> sozinhos** — hoje `4962399e`, `5cb3abf2` e `a318c9c2` (os mesmos três, sob os
> nomes que a dobra deixou), todos porque a origem gravada na baseline fica órfã
> quando uma reescrita troca o hash do commit do ato; o topo é verde, e é ele que esconde o commit do
> meio que nasceu vermelho. **A dobra que o gate pediu foi feita e medida: os 20 commits que
> ela produziu passam SOZINHOS** (`--only` em cada um, 0 vermelhos — mais o commit da doc que
> declara isso) — e as DUAS causas que o primeiro vermelho escondia, da mesma classe (uma
> asserção que viaja antes do que ela mede), foram consertadas DENTRO do commit que as criou.
>
> **A régua tem prova por mutação própria** (`scripts/test-mutation-stack-per-commit.sh`,
> **em CINCO direções** — a 38.ª sub-test da matriz): o fixture é um repositório git de
> verdade com uma pilha de três commits onde **dois NASCEM vermelhos**, cada um por uma
> régua DIFERENTE, e o TOPO os conserta — a classe do defeito, medida. Tirar a régua do
> nome ou a do grafo da derivação tira **um** vermelho do veredito; tirar o veredito por
> commit faz os dois saírem ✅; tirar o da série deixa o relatório dizendo os dois
> vermelhos **com exit 0** (o job ficaria verde com dois commits vermelhos dentro); e
> tirar o teto faz a pilha acima dele sair verde **sem ter medido um único commit**. A
> detecção é o CONJUNTO de commits vermelhos, e a derivação é lida na fonte (o runner do
> fixture registra os arquivos que recebeu, por commit). Custa **3,3s** e é node-pura (o
> fixture declara o próprio runner, sem `node_modules`).
>
> **E o pre-push passou a medir o MEIO da pilha** (o mesmo módulo, com `--pushed`): as refs
> que saem chegam pelo stdin (o protocolo do git), o recorte é a união `remote_sha..local_sha`
> **sem o topo** — a árvore do topo é o que as outras fases do hook e o PR já medem —, e o que
> o faz caber no push é uma **amostra declarada** (`PILHA_PUSH_MAX`, default 6): determinística,
> com o mais antigo sempre dentro e os **PULADOS NOMEADOS** (pulado não é verde, é NÃO MEDIDO).
> Medido neste host: um push de UM commit não tem meio e sai em **0,04s** (o caminho comum); a
> amostra cheia de 6 custou **37,8s**. Um commit do MEIO que nasce vermelho **bloqueia o push**
> — provado por execução (`git push` de verdade recusado, os MESMOS objetos no remoto, a ref
> parada e o commit NOMEADO), com o controle verde chegando —, enquanto `indeterminado` e o
> próprio recorte sem veredito seguem o push, nomeados: a mesma postura do `--no-verify`, e o
> job `stack-per-commit` do CI mede a pilha inteira.
>
> **E o instrumento não deixa resíduo.** Uma execução MORTA (timeout, `kill -9`, sessão que
> cai) nunca chega ao `rmSync` do fim, e o acúmulo foi medido: **151 worktrees** e ~11 GB em
> `/tmp/pilha-*`. Agora cada worktree nasce com o **dono declarado** ao lado (`dono.json`:
> ferramenta, pid, host, sha, `keep`), a execução **varre o resíduo antes de medir** julgando
> pelo marcador (pid vivo no mesmo host fica, `keep` fica e é dito, marcador alheio ou
> ilegível não é tocado, o resto sai — com o metadado órfão do git), a varredura é DITA no
> relatório e no `--json`, e a medição em curso é removida no SINAL. O `kill -9` continua
> deixando o resíduo — e é a varredura da execução seguinte que o recolhe, provado por
> execução com um filho de verdade morrendo dos dois jeitos.
>
> **A pergunta seguinte — "cada etapa do corte do GitHub é shippable sozinha?" — também
> tem medidor** (`bun run cut-stages:prove`, `scripts/prove-cut-stages.mjs`): as cinco
> etapas de [`docs/GITHUB_CUT.md`](./docs/GITHUB_CUT.md) §3 são APLICADAS em sequência
> numa cópia da árvore rastreada (nunca na árvore real), e o veredito dos contratos em
> cada passo é lido com as MESMAS funções que as pipelines executam — a derivação de gates
> do `doctor`, o `discoverGates`/`findParityViolations` e a resolução de contextos do
> `check-required-checks`. Duas invariantes valem em TODOS os passos (por isso não são
> declaráveis): os gates da forja dona do merge e os required checks dela ficam
> **idênticos**. Medido: os **9 crons** do espelho saem na etapa 2 (9 blocos, fechando com os
> "9 crons" da entrega), o espelho não perde **nenhum** gate até a etapa 5 (nem tirando os
> 11 passos de canal `gh` da etapa 3, nem trocando 100 `uses:` de terceiro na 4), a etapa 5
> só fica verde levando a declaração (`PIPELINES`) junto — sem ela o guard nomeia a forja
> fantasma —, e a medição NOMEIA o que a prosa do plano não dizia: 5 desses passos têm nome
> de VERIFICAÇÃO e não são gates pela régua do contrato, e **2 dos 11 arquivos** que ainda
> afirmam o host antigo o usam numa DECISÃO (um é o host do GHCR, que decide se a etapa de
> visibilidade se aplica; o outro é a próxima decisão) — os demais são mensagem ou registro
> (o inventário e o próprio medidor guardam o valor antigo de propósito). ≈2,4s neste host,
> sem docker.

> **E a etapa 1 do plano, que declarava um limite — "a publicação aconteceu num registry
> local" — também tem medidor do lado de cá do limite** (`bun run gitea-registry:prove`,
> `scripts/prove-gitea-registry.mjs`): ele sobe a stack da forja **efêmera** (o MESMO
> `deploy/docker-compose.gitea.yml`, com porta, volumes e `ROOT_URL` próprios), publica as
> DUAS imagens no registry **embutido daquele Gitea** e as puxa de volta **pelo digest**, com
> a tag local removida antes. O que um `registry:2` local não mede e ele mede: o `/v2/`
> respondendo **401 com Bearer** com o `realm` apontando para o endereço efêmero (senão o
> `docker login` do ensaio sairia para a produção), o **token de pull** do dono do pacote por
> basic auth, o `Docker-Content-Digest` da tag igual ao digest do push, os blobs com `HEAD`
> conferido contra o manifest **e** o conteúdo de dois deles baixado e **hasheado** pela API
> (o `untag` não apaga camada: sem isso o pull-back poderia vir do store local) — e o
> artefato: `bun --version` = a versão declarada **dentro** da imagem que voltou, com a label
> `org.opencontainers.image.version` respondendo pelo mesmo valor (o mirror é `scratch`, então
> a evidência dele é a extração do `/bun`, o caminho do consumidor). Os dois controles
> negativos (digest inexistente e tag nunca publicada) têm de FALHAR — um controle que passa é
> **violação**, senão um pull que aceitasse qualquer coisa passaria por prova. Medido neste
> host (09/2026): **exit 0 em 37,5s**, 52 passos verdes, `ubuntu-bun` = `sha256:fd027ee77b52…`
> (9 blobs, 603.649.165 B) e o mirror do Bun = `sha256:b79e21c5b0b1…` (2 blobs, 36.607.127 B),
> zero container e volume deixados para trás. O achado que o ensaio trouxe está FECHADO: ele
> descobriu que **`GITEA__registry__ENABLED` não era declarado em lugar nenhum do
> repositório** (o ensaio o ligava por override, com `<ausente>` como valor de origem — um
> default da série não é promessa escrita). Hoje a stack o declara (`=true` no template da
> forja, consumido pelo compose com o MESMO valor como default), o `check:registry-source`
> cobra o par POR VALOR (`checkComposeValueDefaults`, a régua dos defaults de imagem), o
> `check:mirror-coverage` mede o espelho no recorte do commit e o ensaio **não sobrepõe mais**
> o valor: ele exige a declaração e mede o render nos DOIS caminhos (com o env do host e sem
> ela — o default, que é o que vale num `.env.gitea` mais velho que o template).
> Sem docker ele é INDETERMINADO, nunca verde — o caminho `docker-ausente` é cobrado a cada PR
> pelo `check:prove-docs`.

O inventário também tem **canal acionável**, como as outras dívidas: o job semanal
`github-dependencies-audit` (declarado em `ci/periodic-alerts.json`, canal `issue`)
roda o publicador (`scripts/github-dependencies-issue.mjs`) e publica **uma issue
por dependência NOVA** — label `github-dependency-new`, com a CLASSE, a ETAPA do
corte e o DELTA no corpo —, e a **FECHA** quando o item sai do repositório
(cortado, ou absorvido pela declaração no mesmo commit); inventário ilegível não
fecha nada ("não medido" não é evidência de resolvido), e a assinatura é por ITEM
na lista e por CLASSE+FAIXA no contador (um contador que cresce dentro da faixa é
a mesma dívida). O doctor lê essa label como dívida do board e cruza com o gate
que ele MESMO executa: passou → **caducada**, falhou → **viva**, guard pulado
(`--no-guards`, perfil `--ci`) → **não verificada** — `null` nunca vira "caducou".

O gate de sintaxe, no hook, custa ≈**0.03s**
no caminho comum (nada de corpo nem script staged: um `git diff --cached` e mais
nada), o que o põe no orçamento de um hook que roda a CADA commit sem duplicar a
varredura do CI. Custo medido neste host (Linux,
09/2026, mediana de 3 runs warm): o guard ≈ **2.46s** (2.46–2.48) — ele julga os
**124 arquivos de shell** (121 `*.sh` e os 3 hooks do `.husky/`) e os **33 textos
de shell EMBUTIDO** (o `RUN` dos Dockerfiles e o payload dos `sh -c`), um
`bash -n` por texto — e a prova de mutação ≈ **30.8s** onde o `vitest` está
instalado (as duas rodadas da suíte unitária do M8 são ~24.9s disso, o que põe o
gate sozinho em ≈ **5.9s**: aritmética sobre duas medições deste host, não uma
nova medição): o caminho do gate é node-puro (um `bash -n` por cenário, sem
docker) e a suíte só roda onde há dependências. ⚠️ Não existe um job
`readme-toc-mutation-guard` ISOLADO — o cenário de TOC roda dentro da matriz
aninhada `test-mutation-readme-guards.sh` (anchors + toc + images, 1 sub-test do
master). Custo medido em 08/2026 (Windows host, worktree local, mediana de 3 runs
warm):

| Item                                      | Local (Windows, node frio) | act (proxy CI, container) |
| :---------------------------------------- | :------------------------: | :-----------------------: |
| cenário toc isolado (mediana 5 runs)      |   ≈ **2.2s** (1.9–2.8s)    |     — (só via master)     |
| matriz readme-guards (anchors+toc+images) |          ≈ **7s**          |     — (só via master)     |
| master `mutation-guards` (41 sub-tests)³  |    **528.5s** (1 run)³     |     **step ≈ 9.1s**²      |
| checkout@v4                               |             —              |   0.03s* (frio: 32.2s*)   |
| Summary                                   |             —              |           0.34s           |

O gap **9.1s (act) vs 221s (local)** no master sugere que o node no container
roda mais rápido que o host local (warm cache/FS — não é causa provada, é
observação). A coluna "Local (Windows)" desta tabela é de 08/2026: para o master
o valor VIVO é o de ³ (este host, Linux) — o número do Windows fica só como
histórico do instrumento dele, nunca como o custo declarado do job.
²Medido em 08/2026 (era de 15 sub-tests — o e2e-cache-budget roda em
SKIP — exit 0 enquanto measure-e2e-cache.mjs não existir —, custo ~0s;
⚠️ a medição local foi com 12 — o lint-guard (13º), o mutation-count (14º)
e o no-leaked-imports (15º) foram adicionados DEPOIS e não re-medidos,
custo estimado ~0.5s cada):
mediana de 3 runs warm, **39s local** (39–40s) — valor RETIRADO para o master:
era de 23 sub-tests e de OUTRO host (Windows), e o número vivo é o de ³. O
**9.1s** de step no act
com a imagem ubuntu-bun + `--pull=false` foi medido ANTES, com 10
sub-tests, e não foi re-medido (o mesmo act mediu o actionlint em 3.6s e o
utf8-check em 7.46s). O custo escala com o nº de sub-tests — cada um cria
fixtures e roda o guard contra a mutação —, então o valor antigo (15.8s)
era de 5 sub-tests e o timing-budget (~1s) foi adicionado após a medição de 10.
³Medição da MUDANÇA (host Linux 16 cpus / 31 GB, 09/2026). O ato de **31
sub-tests** mediu ≈ **221s** com mediana de 3 runs warm, TODAS verdes
(221 · 221 · 221); o ato SEGUINTE — a CATRACA do inventário do GitHub entrou na
matriz — mediu **248s** numa rodada WARM da matriz COMPLETA, 32/32 verdes, e foi
por um tempo o valor declarado por `ci/merge-latency.json` (hoje ele declara o ato
da baseline, abaixo); o ato da DESCOBERTA
do registro do canal entrou na matriz — mediu
**271.8s**, 33/33 verdes, com a 33ª custando **9.0s** sozinha (`canal-fixers`), e
é a medição VERSIONADA na família `mutations` do `bench-guard-timing` (esquema v6:
o ato grava o commit de ORIGEM do que mediu); o ato SEGUINTE — as ETAPAS DO
CORTE, a COBERTURA DO RECORTE e a PROVA SEM DUBLÊ entraram na matriz — mediu
**353.2s** numa rodada da matriz COMPLETA, 36/36 verdes, com a 34.ª custando
**17.4s** sozinha (`cut-stages`), a 35.ª **11.0s** (`mirror-coverage`, o CONTROLE,
a soma por tabela e a recusa do pulo sem motivo) e a 36.ª **37.9s**
(`pre-commit-proof`, a declaração dos recusadores, a descida e o CONTROLE); e o
ato de AGORA — as três suítes acima mais as QUATRO metades novas (a CLASSE do alvo
no `job-deps` e as K/L/M do recorte do count), com a árvore COMMITADA — mediu
**381.0s** (376.7s de sub-tests + 4.3s de harness) numa rodada da matriz COMPLETA,
36/36 verdes (ato anterior, baseline ancorada em `2757e3a5`); e o ato de AGORA
MESMO — as **39** entradas da matriz, com as DUAS novas MEDIDAS (`doc-hashes`,
**1.2s** sozinho; `stack-per-commit`, **3.6s** sozinho) — o ato de **23/09/2026**
mediu **528.5s** (524.0s de sub-tests + 4.5s de harness) numa rodada da matriz
COMPLETA, **39/39 verdes**, com a árvore COMMITADA (`d06cc118`) e a coluna de
metades DERIVADA da matriz (**238**). É esse ato que a baseline passa a
guardar e que
`ci/merge-latency.json` passa a declarar para o espelho (**528502ms** medidos, 0% de
delta contra o derivado), e ele move o PISO
do job `guards` da forja dona do merge para **562423ms** (a bateria + o
gate de sintaxe + a matriz de 528.5s + a paridade das regras de classificação). O ato
ANTERIOR (a medição de 37 sub-tests, commit `6125c9da`), mantido como história do
instrumento: a
**37.ª**, a régua da idade (`bench-freshness`), MEDIDA pelo mesmo caminho do job
(**17.3s** sozinha, 6 metades) — mediu **395.0s** (390.8s de sub-tests + 4.2s de
harness) numa rodada da matriz COMPLETA, **37/37 verdes**, e o PISO do job `guards`
ficou em **428880ms**. Os
**28% de divergência**
que a baseline ancorada em outro commit sustentava ficaram em zero. A
32ª custa **11.0s** sozinha pelo caminho do master (`--scenario github-deps`:
10.97 · 11.06 · 11.02); o resto do delta (≈221 + 11 = 232s esperados contra os
248 medidos) é a deriva de host que as rodadas anteriores já registravam, somada
à atividade concorrente da MESMA janela — e é por isso que o valor de 32 está
declarado como UMA rodada, e não como mediana de 3 (o que se mediu é o teto, não
a estimativa de centro). A 31ª é a régua das CONDIÇÕES do retrato
arquivado (o passo do `.woodpecker.yml` ↔ a forja: a exigência de declarar, o
ESTREITAMENTO do `if:` do job, a contraparte por marcador — existência E
trabalho —, o fail-closed da leitura e o desempate do casamento ambíguo) e custa
**1.0s** sozinha pelo caminho do master (`--scenario archived-pipeline`: 1.00 ·
1.00 · 1.00 — fixtures sintéticas e o guard node-puro, 0.05s por invocação). A
30ª é a régua do REGISTRO da proteção da forja (o contexto a MENOS, o a MAIS, a
CONTAGEM no nome, o fio do veredito e a régua da contagem gulosa; o veredito é
medido POR EXECUÇÃO contra uma forja dublada, sem docker) e custa **7.9s**
sozinha pelo caminho do master (`--scenario gate-registration`: 8.00 · 7.98 ·
7.93). A composição — a medição anterior, com
29 suítes da matriz (188.6s), mais os 7.9 da 30ª e o 1.0 desta — dá ≈197.5s
esperados contra os
221 medidos: os ≈23.5s de
excesso NÃO são desta suíte — as suítes vizinhas cresceram na MESMA janela (a
`hook-commands` ganhou M18/M19/M20/M21 e hoje custa **41.5s** sozinha, medido
nesta rodada; cada mutação roda a suíte unitária inteira) e as rodadas anteriores
já registravam deriva de HOST. O que domina o job segue sendo UMA sub-test — a
prova de mutação do gate de sintaxe custa ≈58.5s sozinha, e a `hook-commands`
≈41.5s. A 28ª (a prova da RESPOSTA do
remédio no TTY, mediana de 3 pelo caminho do master: 27.2 · 27.1 · 27.1) segue
dentro do total. A suíte do Bun (a 1ª da matriz) custa **≈1.8s inteira** hoje
(1.76 · 1.77 · 1.75, 3 runs warm, todas verdes, medidos neste host em 09/2026) —
é o TETO do que as três metades novas do REMENDO (`M5g`/`M5h`/`M5i`: o `--fix`
real + o ciclo com o estágio, a chave-pai devolvida junto e a âncora única que
recusa em vez de adivinhar) acrescentaram ao job; como o teto fica abaixo da
deriva de host que esta rodada já registrava, aquele ato não reabriu o valor VIVO
do master (**221s** — era de 31 sub-tests) — o que mudou ali foi a composição declarada. O
valor foi reaberto no ato SEGUINTE, quando a 32ª entrou na matriz (ver ³:
**248s**, uma rodada declarada). Uma rodada de OUTRA medição foi DESCARTADA da mediana (171.1s):
ela rodou com duas sub-tests vermelhas no CONTROLE (o recorte era outro), e um
número medido sobre a árvore quebrada não descreve o job. O **39s**
(Windows, 23 sub-tests, 08/2026) está **RETIRADO como valor**: era de outro
host, com quatro sub-tests a menos, e ficava abaixo de UMA das sub-tests que o
job contém — o valor declarado de um job não pode ser menor que o de um passo
dentro dele. As rodadas intermediárias (≈101.1s com 26; ≈87.3s com 25; ≈81.3s
com 24 — e o **17.2s** de 24, esse de outro host) são HISTÓRICO do crescimento
da matriz, não o custo de hoje; a medição de 23 sub-tests (a prova de mutação do
gate de sintaxe, ≈1.5s sozinha, que substituiu a versão de ≈0.2s) mostra que a
diferença entre rodadas é do host/cache, não do recorte. A sub-test que saiu da
matriz — a prova de classificação do `check-forge-parity`, agora o job próprio
`forge-parity-mutation` — custa ≈ **0.33s** (0.32–0.39) sozinha. O job novo é
node-puro, sem docker e sem node_modules: o PR ganha um job de ≈0.3s e a prova
passa a ser um check com NOME no contrato de merge, em vez de uma linha da
matriz.
*O checkout no act é overhead de EMULAÇÃO (docker cp do worktree inteiro):
**32.2s na 1ª run fria** (volume não cacheado) vs **~0.03s nas runs seguintes**
(volume quente — os steps de 9.1s/7.46s/3.61s destas tabelas foram medidos com
volume quente, `--pull=false`) — o GitHub Actions real faz checkout em ~1-2s. Comparando com os
fast gates: cada guard <1s (o `check-readme-toc` real ≈ 0.23s); o runner dos
16 guards ≈ 3.2s de mediana. Ou seja, os mutation tests são o item mais caro
dessa classe no PR-check (~9.1s de step no container vs ~3.2s dos 16 fast
gates), mas seguem node-puro e sem docker. ⚠️ Timing REAL do GitHub Actions
não medido aqui — o `gh` está autenticado (auth fantasma RESOLVIDO em 08/2026,
ver Bugs conhecidos), mas o `seed-guards.yml` não existe na branch default
(`release/v0.4.0` — este branch não foi mergeado), então o job
`mutation-coord-update` nunca rodou no CI real e não há run para medir; o act é
o proxy local.

**Overhead do job `mutation-coord-update` (seed-guards.yml, contrato coordenado)** —
diferente do master `mutation-guards` (node-puro), este job roda o **vitest REAL
6× (controle + 5 cenários A–E: doc prod 128→N, anchor 128→129, derivação 128→127,
independência com piso do guard neutralizado e doc dev 162→N) + o guard estático
6×**. ⚠️ A premissa antiga de "3 execuções de vitest (controle + 2 cenários)" está
**OBSOLETA** desde o cenário E (08/2026): o contrato cresceu para 5 cenários = 6
runs. Medido 08/2026:

| Item (job mutation-coord-update)                   | Local (Windows, node frio) | act + ubuntu-bun (container) | CI real (GH hosted) |
| :------------------------------------------------- | :------------------------: | :--------------------------: | :-----------------: |
| payload do mutation test (6 vitest + 6 guard runs) |          **51s**           |      **4m37.6s** (step)      |   ~35-45s (est.)¹   |
| setup-bun (composite, tier-1 na imagem custom)     |             —              |            13.5s             |        ~1-2s        |
| Cache node_modules (restore+save)                  |             —              |            17.4s*            |        ~1-2s        |
| bun install (warm, cache hit)                      |             7s             |            12.8s*            |        ~2-5s        |

*Overhead de EMULAÇÃO do act (actions/cache emulado + bind mount `/mnt/c`) — o
GitHub Actions real não paga esses custos.

¹ O payload de 51s local (6 runs de vitest ≈ 8.5s/run a frio) sobe para 4m37.6s
no act por overhead de EMULAÇÃO (bind mount `/mnt/c` + docker cp); no GitHub
Actions real (FS nativo + cache warm) a estimativa é ~35-45s — **pendente de
medição real**: o `gh` está autenticado (auth fantasma RESOLVIDO em 08/2026),
mas o `seed-guards.yml` não existe na branch default (`release/v0.4.0` — nunca
mergeado), então o job nunca rodou no CI real (API → 404, zero runs). Assim que
o workflow for mergeado e um run real existir:
`gh run list --workflow=seed-guards.yml --limit 1` → `gh run view <id> --json
jobs --jq '.jobs[] | select(.name | contains("contrato")) | .steps[] |
select(.name | contains("Run mutation test")) | {name, startedAt, completedAt}'`.

**Budget de payload (DRIFT RELATIVO no PR / faixa soft derivada no semanal —
240s como TETO absoluto):** o step 'Run mutation test (contrato coordenado)'
tem um **teto absoluto de 240s (4 min)** — falha SEMPRE acima dele, mesmo com
drift pequeno (regressão de overhead do contrato coordenado). O **job do PR
(`mutation-coord-timing-guard`)** gateia por **DRIFT RELATIVO vs a MEDIANA do
histórico**: `--fail-drift ${{ vars.MUTATION_TIMING_DRIFT_MAX || '50' }}` —
falha quando o step é mais que o threshold configurável (% do desvio
relativo, default 50%) mais lento que a mediana dos últimos 4 runs medidos
do MESMO step (gh run list `benchmark-weekly.yml` + jobs API por run — o
mesmo mecanismo do trend guard; histórico SEMPRE da branch DEFAULT, resolvida
via `gh repo view`). Isso pega a **regressão lenta** (ex.: 100s vs mediana
62.5s = +60% — falha por drift ANTES de tocar o teto) que um teto fixo jamais
veria, sem depender de literal — e a var `MUTATION_TIMING_DRIFT_MAX` permite
ajuste por repo sem editar o workflow. O **job semanal e o act-guard** usam a
**faixa soft DERIVADA DA MEDIANA** (`--warn-median 4 --warn-margin 0.2`): o
warn = `ceil(mediana × 1.2)`, clampado `< 240` — se **AUTO-AJUSTA ao runner
real** e emite `::warning::` sem falhar; o **primeiro run** (sem histórico
suficiente) mede o baseline com `::notice::` + gate só no duro — não existe
mais a variable `MUTATION_TIMING_BASELINE` nem `--publish-baseline` (o semanal
agora é read-only nas permissions). Abaixo do warn derivado há ainda a
**faixa SUAVE `--alert`** (escalada suave em 3 degraus: `d <= alert` → `ok`
silencioso; `alert < d <= warn` → `::notice::` + exit 0; `warn < d <= max` →
`::warning::` + exit 0; `d > max` → `::error::` + exit 1) — o notice observa
o drift cedo (ruído baixo) ANTES do warning acender. O timing é o **NATIVO do
Actions** (started_at/completed_at da jobs API — o mesmo que a UI mostra),
medido por `scripts/measure-mutation-timing.mjs` (no modo TESTE o histórico
vem de `--history-file` — fixtures determinísticos, sem gh). O teto de 240s
tem ~5× de headroom sobre o esperado ~35-45s (evita flakiness de runner); o
drift relativo absorve picos intermediários sem falhar o PR. O relatório JSON
ganha `zone` (`'ok'`|`'notice'`|`'warn'`|`'fail'`) + `alertSecs` + `warnSecs`

- `noticed` + `warned` + `warnSource: 'median'`/`warnWindow`/`warnMargin`/
  `warnMedianSecs`/`warnHistoryCount` (a derivação — null sem histórico
  suficiente) e, no modo `--fail-drift`, `driftSource`/`driftWindow`/
  `driftMaxPct`/`driftMedianSecs`/`driftPct`/`driftHistoryCount`/`drifted` (a
  zone `'fail'` distingue `drifted: true` — drift relativo — de `exceeded: true`
  — teto absoluto) — o caller distingue notice de alerta de falha de
  infra/drift.

**Medição via ACT (PRs sem seed-guards na default):** o gate real mede via
jobs API do run ATUAL — mas o `seed-guards.yml` é um reusable `workflow_call`:
se ele ainda não existir na **branch DEFAULT** (ex.: branch de criação não
mergeada, como ocorreu com `release/v0.4.0`), o reusable não roda no CI e a
jobs API não mede NADA. O job **`mutation-coord-timing-act-guard`**
(pr-check.yml, paths-filtered) cobre esse buraco: re-executa o job
`mutation-coord-update` **localmente via act com a imagem ubuntu-bun** (o
MESMO pipeline do tier1-fastpath-guard — bun pré-instalado) e o guard roda em
modo `--act-log` (`measure-mutation-timing.mjs --act-log <log> --max 240
--warn-median 4 --warn-margin 0.2 --act-exit <exit>`) —
extraindo a duração do step da linha
`Success - Main Run mutation test ... [X.XXs]` do log do act (mesma técnica de
parse do check-tier1-fastpath). Só roda quando o PR toca o contrato coordenado
(seed-guards.yml / measure-mutation-timing.mjs / test-mutation-timing-budget.sh
/ seed-e2e-count.ts), com custo ~15 min de act — o preço de travar o budget
mesmo antes do merge, quando o run real ainda não pode medir.
**Tuning do budget:** o **teto** (`--max 240`), o **threshold de drift**
(`--fail-drift`, default 50%) e a **margem da derivação** (`--warn-margin
0.2`) alteram em **lugares coordenados** — os TRÊS jobs (pr-check.yml
`mutation-coord-timing-guard` com `--max 240 --fail-drift
${{ vars.MUTATION_TIMING_DRIFT_MAX || '50' }} --window 4`;
`mutation-coord-timing-act-guard` e benchmark-weekly.yml
`mutation-coord-timing` com `--max 240 --warn-median 4 --warn-margin 0.2`),
as TRÊS asserções de teste de
workflow (`benchmark-weekly-mutation-timing-workflow.test.ts`,
`pr-check-mutation-timing-guard-workflow.test.ts` — trava o `--fail-drift` +
`--window 4` + `--max 240` + a AUSÊNCIA de `--warn-median`/`--publish-baseline`
— e `pr-check-mutation-timing-act-workflow.test.ts` — trava o `--warn-median`

- `--warn-margin` + a AUSÊNCIA de `--publish-baseline`) e as constantes
  `BUDGET_MAX`/`BUDGET_WARN`/`BUDGET_ALERT` + os cenários `--fail-drift` do
  mutation test (`scripts/test-mutation-timing-budget.sh` — os fixtures de
  120s/200s/300s dependem das faixas; o próprio mutation test falha se os
  budgets mudarem e os fixtures ficarem na faixa errada). A **janela do
  histórico** (`--window 4`) e o **threshold de drift** (`--fail-drift`) podem
  ser tuning via vars (`MUTATION_TIMING_DRIFT_MAX` no PR;
  `MUTATION_TIMING_TREND_WINDOW` já existe para o trend) — a mediana em si NÃO
  precisa de tuning: auto-deriva do tempo real medido. O modo `--warn-only`
  emite `::warning::` em vez de falhar (alerta não-bloqueante para dispatch
  manual); a faixa notice é SEMPRE não-bloqueante (`::notice::` + exit 0, com ou
  sem `--warn-only`).
  Limites: faixa suave é **`alert < d <= warn`** (d == warn ainda é notice, não
  warn); faixa soft é **`warn < d <= max`** (d == max ainda é warn, não fail);
  faixa dura é **`d > max`** — só estritamente acima do duro falha. O contrato
  exige `alert < warn < max` (o CLI rejeita `--alert >= --warn` com exit 2 —
  faixa notice vazia).

Comparando com os fast gates: os 16 guards somam ≈ **3.2s** de mediana; o payload
do mutation-coord-update (51s local) é **~16× mais caro que TODA a classe de fast
gates junta** — por design: cada cenário roda vitest real + guard estático (não é
node-puro como o master `mutation-guards`). É o item mais caro dos mutation tests
por PR, mas roda apenas no `seed-guards.yml` (reusable, chamado no PR-check), não
no pre-push.

**Custo de TODOS os gates por PR (visão consolidada, medido 08/2026)** — os jobs
pesados do `pr-check.yml` + `e2e-cache.yml` na MESMA metodologia (mediana de 3
runs warm local — exceto `e2e-cache`, 1 run; act com a imagem ubuntu-bun,
`--pull=false`):

| Gate / job                                        | Local (Windows, node frio) |            act + ubuntu-bun (step real)            | CI real (GH hosted) |
| :------------------------------------------------ | :------------------------: | :------------------------------------------------: | :-----------------: |
| 16 fast guards (`run-encoding-guards.sh`)         |         ≈ **3.2s**         |                      — (n/a)                       |         <2s         |
| `utf8-check` (837 arquivos, `--ci src/`)          |        ≈ **0.92s**         |                     **7.46s**                      |    ~2-5s (est.)     |
| `actionlint` (rhysd/actionlint via docker)        |        ≈ **0.51s**         |                     **3.61s**                      |    ~1-2s (est.)     |
| `mutation-guards` (41 sub-tests node-puro)³       |        **528.5s**³         |                     **9.1s**²                      |   ~15-25s (est.)    |
| `mutation-coord-update` (6 vitest + 6 guard runs) |          **51s**           |                    **4m37.6s**                     |   ~35-45s (est.)³   |
| `unused-deps-guard` (mutation test + guard real)  |        ≈ **0.5s**⁴         |          **26.8s** cold / **20.9s** warm⁴          |   ~10-15s (est.)    |
| `lint-guard` (prettier --check + eslint zero)     |     ~**4min** (local)⁵     | **7m22s** 1ª run / **6m23s** 2ª run (lint total)⁴  |   ~4-7 min (est.)   |
| `typecheck` (tsc --noEmit, heap 4096MB)           |     **~2min** (local)      | **3m52s** cold / **2m31s** warm (step Type check)⁴ |   ~2-3 min (est.)   |
| `e2e-cache` (build Next.js + playwright cache)    |  **4m6s** (build, 1 run)   |                — (requer serviços)                 | **~6-9 min (est.)** |

³Mesmo valor do bloco `mutation-coord-update` acima — estimativa, pendente de
medição real (o `seed-guards.yml` não existe na branch default).

⁴Medido via act (imagem `ghcr.io/severinno/ubuntu-bun:1.3.14`, `--bind` — o
`docker cp` default falha no Windows com RWLayer nil, no `setup-bun` E no
post-step de cache; por isso os valores de job são dos steps principais, não
job end-to-end). `unused-deps-guard` (job inteiro, 2 runs: 26.8s cold /
20.9s warm, ambos Job succeeded). `typecheck`: o step `Type check` custa
3m52s (cold, 1ª run pós-mudança do lockfile) / 2m31s (warm, cache-hit) e
PASSOU nos dois (sem erros TS); o job inclui ainda setup-bun (~8-15s), bun
install (~8-9s) e prisma generate (~26-54s). `lint-guard`: lint total =
prettier (2m20s / 1m53s) + eslint (5m3s / 4m30s) nas 2 runs (MESMA cache
key — o delta é warm-up do FS/runner, não cache-hit), ambos os steps
PASSARAM; soma ≈ 7m22s / 6m23s (+ setup ~14s + install ~23-31s). É o gate
node-puro MAIS caro por PR — o eslint repo-wide (com `@typescript-eslint`
sobre todo o src/) domina o custo. Nota:
na 1ª medição do typecheck o job FALHOU no act — `src/app/api/chat/route.ts`
importava `z-ai-web-dev-sdk` que NÃO estava no package.json (o tsc local
passava por resolução de módulo vazando do node_modules do projeto pai,
worktree aninhado). Corrigido adicionando a dep (0.0.18, existe no npm) — o
typecheck do CI real teria quebrado o merge sem esse fix.
⁵Medição local (Windows, node frio, 08/2026): prettier --check repo-wide
≈ **85s** + eslint . --max-warnings 0 ≈ **146s** = **~4min** total (o
estimado ~4-7 min de CI reflete runner carregado + variação de hardware;
local 1 run, não mediana).

O `e2e-cache` é o item MAIS caro por PR, mas é **condicional**: o trigger tem
`paths:` (cache-manifest, api-server.ts, rotas de cache, `providers-cache.spec`,
workflows de encoding/cache) — PRs comuns NÃO o rodam; quando roda (timeout 15
min), o custo é dominado pelo `bun run build` (4m6s local, **1 run** — não foi
estabilizado em 3 runs como os demais) + `playwright install chromium` + testes
de cache. Os demais gates somam ≈ **1m32s** no pior caso
(mutation-guards 174.9s + coord-update 51s local) contra ≈ **3.2s** dos 16 fast
guards — por design: cada mutation test roda o guard REAL contra uma mutação
(não é node-puro) e o coord-update roda vitest real + guard estático por cenário.

**LATÊNCIA DE MERGE — o que o PR espera (não a soma)** — a tabela acima é um
catálogo de custos e convida a somar, mas o PR não paga a soma: ele paga o
**caminho crítico** do grafo `needs:` e, com poucos runners, a **fila**.
`bun run bench:merge-latency` mede as duas contas a partir da pipeline real
(`.gitea/workflows/ci.yml`, `.github/workflows/pr-check.yml`) + o modelo
`ci/merge-latency.json` (duração por job com fonte e data, confrontada contra o
benchmark versionado). Medido em 17/09/2026:

| Forja                                      | Soma dos gates |               Caminho crítico |                **Latência de merge** |        O que a concorrência economiza |
| :----------------------------------------- | -------------: | ----------------------------: | -----------------------------------: | ------------------------------------: |
| Gitea (dona do merge, **1** `act_runner`)  |         472.7s |       377.5s (`test → build`) |                           **472.7s** | 0s — com 1 runner a pipeline é SERIAL |
| GitHub (espelho, **1** runner self-hosted) |     ≤ 11176.7s | 7200.0s (`seed-guards`, teto) | ≤ **11176.7s** (676.7s sem os TETOs) |             0s — SERIAL, como a forja |

Ou seja: o PR da forja espera **7m52s**, e o **teto** do ganho com runners
de sobra é **95.2s** (472.7 − 377.5) — o `build` (246s) e o `test` (131.5s)
dominam a cadeia, e todo o resto (lint, guards, typecheck, bring-up-proof) roda
**em paralelo a eles** quando há runner livre. Com 1 runner nada disso importa: a
latência É a soma. É essa diferença que a tabela de custos não dizia.

O espelho tem os 36 jobs do PR cobertos desde 17/09/2026 — 13 por **medição**
neste repositório (com os comandos na fonte e a data), 2 por **PISO** (o passo
de fora NOMEADO: `security-headers` faz requisições ao alvo do CI, que é produção;
`benchmark-gist` depende do módulo de geo, que vive em outro branch) e 4 por
**TETO** (`tier1-fastpath-guard`, `mutation-coord-timing-act-guard`,
`seed-guards` e `mutation-coord-timing-guard`, cujo custo é dominado por `act`,
PostGIS e matrix). O TETO é o `timeout-minutes` que a própria pipeline escreve no
job: um LIMITE SUPERIOR, não uma medição — o relatório imprime os quatro
nomeados, publica a **soma sem os tetos** ao lado e o veredito diz que a latência
do espelho é um limite.

**E um passo deixou de ter número próprio.** O `mutation-count-guard` do espelho é
o primeiro job do repositório declarado por **PASSOS** (`steps`): o `setup-bun`
(17.175s), o `install` (62ms), o `check-mutation-count` (93ms) e o `Summary`
(98ms, um bloco) são MEDIDOS ali, e o passo da suíte —
`bash scripts/test-mutation-mutation-count.sh` — **LÊ** a forma `mutation-count`
da baseline versionada (3.897s, com o commit `2757e3a5` ao lado) em vez de repetir
o número. Antes, os dois números do MESMO passo viviam separados: 3870ms no modelo
contra 3897ms na baseline (e, na versão anterior da suíte, 155ms contra 447ms —
**3x**), e nenhum dos dois era derivado do outro, então a divergência era
invisível por construção. Ligado, o custo da suíte muda nos dois lugares ao mesmo
tempo (é o mesmo número), a procedência do passo nomeia a forma e o commit dela, e
o `Summary` — que estava FORA do total declarado (21198ms = setup + install + suíte

- check) — entrou pela cobertura exata: todo `run:` do job tem de estar contado, e
  um passo novo na pipeline indetermina o veredito em vez de entrar custando zero.

O gate de sintaxe julga três fontes: os **482 corpos** `run:` das duas forjas, os
**124 scripts de shell** versionados e — desde a terceira fonte — **33 textos de
shell EMBUTIDO**: as 14 instruções `RUN` dos Dockerfiles (o shell do BUILD, com a
continuação `\` juntada antes do parser) e os 19 payloads de `sh -c` de scripts,
corpos e composes (que para o `bash -n` do arquivo que os contém são uma STRING).
O escopo cresceu de novo e o custo acompanhou **apenas em parte**: o guard foi
2280ms → 2464ms → **2496ms** (os composes e os Dockerfiles entram na leitura, e o
`bash -n` deles é marginal), enquanto o mutation test — dominante no job, 96% —
subiu de 8 para **14 metades** (22850ms → 30817ms → **58457ms**: o que move o
custo dele agora é o número de INVOCAÇÕES da suíte unitária, não o programa a
julgar — as duas metades com testemunha unitária rodam o vitest 2× cada, 13,3s
por run neste host). No job do espelho isso é 25,1s → 33,3s → **61,0s**; no
`guards` da forja a soma declarada segue **19.4s**, porque ele roda o GUARD e não
o mutation test (ainda PISO: `check:pipefail-sigpipe`, `install` e checkout
seguem fora). O caminho crítico de NENHUMA das duas forjas muda — o que muda é o
total serial, em 0,2s na forja e 35,9s no espelho.

Uma premissa por FONTE, e é ela que evita o falso positivo: o texto de um `RUN` é
a instrução JUNTADA (a continuação `\` faz parte, o comentário dela é descartado
como o docker faz, e as flags `--mount=` não chegam ao shell); um payload de
workflow leva `${{ ... }}` mascarado; um de compose leva o `$$` **desescapado**
(medido: sem isso o gate acusava `RESPONSE=$$(curl ...)` em
`docker-compose.prod.yml` — para o bash `$$` é o PID, e o parêntese ficaria solto);
e num script o texto vai cru. Um compose é lido por ESTRUTURA (`js-yaml`), não por
texto: a lista de um `entrypoint:` entrega o CORPO do script, não a marca de lista
do YAML. O que o gate NÃO julga, ele nomeia: payload que só existe em runtime
(`bash -c "$cmd"`), forma EXEC sem shell, `-c` de `python3` e corpo de heredoc
(dado, não programa).

O gate `check:merge-latency` (mesmo comando nas duas forjas) fecha a conta do
dono do merge: um job do PR **sem duração** (e sem `timeout-minutes` que o
cubra) sai NOMEADO em vez de a latência publicada encolher em silêncio — ver
`docs/GUARDS.md` §10.1 para o que o modelo NÃO prova.

> **Por que o pre-push não repete typecheck/lint-staged?** O pre-commit já os
> rodou em cada commit da branch — reexecutá-los no push seria redundante. O
> pre-push cobre exatamente o gap entre "commitei local" e "o CI vai rodar":
> revalida os guards do `utf8-check.yml` + roda os testes da branch.

### Auditoria de dependências — política ZERO-órfãs

O `check-unused-deps.mjs` (job `unused-deps-guard` no `pr-check.yml`; node-puro, <2s,
roda só no CI — fora do pre-commit por ser um scan repo-wide mais lento) é o
**guarda de higiene do `package.json`**: escaneia TODO o código do repo (src/, scripts/,
e2e/, mini-services/, configs, workflows, hooks, Dockerfiles) procurando referências a
CADA dep (`dependencies` + `devDependencies`) e **falha (exit 1) quando uma dep tem
ZERO referências** — a política é ZERO-órfãs.

**Fluxo ao adicionar uma dependência nova:**

1. **Use-a** — importe/referencie o pacote no código (a referência pode ser em
   qualquer contexto: import TS, CLI `bunx`/`npx` em workflow, config como
   `next.config`/`tailwind.config`/`postcss`, hook do husky ou Dockerfile).
2. **Ou remova-a** — o guard rejeita dep adicionada e não usada; não existe
   "baseline de órfãs" (diferente dos guards de baseline de secrets/jsdom/bun-audit,
   que têm `--update`). O objetivo é ENCOLHER o lockfile.
3. **Allowlist com razão** — apenas uso IMPLÍCITO (o pacote funciona sem nunca ser
   referenciado em código): `@types/*` e `bun-types` (tipos via `tsconfig types`),
   `@vitest/coverage-v8` (provider v8 da config), `sharp` (runtime implícito da
   otimização de imagem do Next — remover quebraria produção), `husky`/`lint-staged`
   (CLIs via `prepare`/pre-commit) e `prisma` (CLI de generate/migrate). A entrada
   precisa da razão no header do guard — sem razão não entra.

**5 deps órfãs removidas no bump 0.4.0** (08/2026, item #4 da auditoria —
verificadas com ZERO hits em código/config/scripts, `bun install` só removeu,
sem mudar versões): `next-intl`, `react-markdown`, `@mdxeditor/editor`,
`@tanstack/react-table` e `zod-to-openapi` — 101 → **96 deps** (hoje 97: a
`z-ai-web-dev-sdk` foi declarada DEPOIS, 08/2026, quando a medição via act do
typecheck expôs que ela era importada pela rota `/api/chat` sem estar no
package.json — ver nota ⁴ na tabela de overhead). Limitações
documentadas do scan (prefix-substring ex.: `xstate` vs `@xstate/react`;
arquivos ignorados por prefixo `_`/`dev.*`/`run-*`/`start-*`/`supervisor*`) estão no
header do guard.

> O job `unused-deps-guard` do `pr-check.yml` roda o mutation test
> `test-mutation-unused-deps.sh` (controle limpo passa, órfã falha exit 1) seguido
> do guard real — a política é revalidada a cada PR (o pre-commit não o roda;
> o scan repo-wide é responsabilidade do CI). Para checagem local pontual:
> `bun run check:unused-deps`.
>
> **Revisão vencida:** cada entrada da allowlist registra a data da decisão
> (`addedAt`) e, passada a janela de 180 dias, está **SEM REVISÃO** — o scan
> normal avisa e o job semanal `registry-allowlist-review` a escala a violação
> (a mesma regra das allowlists do `check-registry-source`, do módulo
> compartilhado `allowlist-review.mjs`). É o que impede uma isenção antiga de
> virar permanente por esquecimento.

#### As dependências de um JOB — `check-job-deps.mjs`

O `check-unused-deps` pergunta se uma dep do `package.json` tem uso. O
`check-job-deps` (passo `Job dependencies (install or declared exemption)` do job
`guards`, nas DUAS forjas) pergunta a outra metade: **um job que RODA um comando
cujo veredito exige `node_modules` INSTALA as dependências** — ou a isenção está
DECLARADA, com data e janela de revisão — porque o verde de um job que não
instala não tem causa no repositório.

A classe foi MEDIDA, não suposta: `node scripts/check-*.mjs` PARECE "node puro"
(a prosa dos workflows diz isso), mas oito guards leem YAML com `js-yaml` e, num
checkout SEM `node_modules`, saem **exit 2** ("NÃO JULGÁVEL") — o mesmo comando
tem DOIS desfechos e nenhum está escrito no workflow. O sintoma que o operador
vê é "NÃO JULGÁVEL", nunca "faltou instalar". Quem responde "de onde vem o
`node_modules`" é quem assina a decisão em `JOB_DEPS_ALLOWLIST`, e a isenção é
**verificada contra o grafo de imports**: dizer "não precisa" para um `import` de
topo ou um binário de dependência é provadamente falso. Isenção sem `addedAt`,
mentirosa, sem objeto (o job passou a não exigir nada) ou vencida (`--review`, no
job semanal, ao lado das outras quatro allowlists) é violação.

O que o guard NÃO segue sai NOMEADO (categoria + motivo), e a categoria vem da
MESMA classe de alvo do `check-hook-commands` (`alvoDoLancador` → `classeDoFlag`,
por interpretador): o `node --version` (que não lê arquivo nenhum) e o
`bash -u x.sh` (cujo alvo É o arquivo) deixaram de ser o mesmo rótulo — e o
comando com um flag na frente do ARQUIVO passou a ser JULGADO, porque o flag não
é o alvo.

O guard tem um **SEGUNDO CONTRATO** (desde 24/09/2026): a de onde vem o
`node_modules` é uma metade; a outra é **onde o veredito RODA** — um gate de
LEITURA DE YAML não pode estar preso à infraestrutura da forja. A classe é
DERIVADA do próprio job (ele lê YAML pela leitura compartilhada, por SPECIFIER, e
não tem serviço, docker, suíte de mutação nem shell fora do plumbing do Bun), e um
`runs-on: self-hosted` a viola: o remédio é o caminho hospedado (`ubuntu-latest`)
com o par de install — o hospedado chega sem `node_modules` — ou a exceção
declarada com data e motivo (`RUNNER_PATH_ALLOWLIST`). Medido em 24/09/2026: com
o runner auto-hospedado `hostinger-runner` offline, os 50 jobs do `pr-check`
ficaram ~35 min em `queued` e os gates de leitura não cunharam veredito nenhum —
a forja não erra, ela espera. Ver docs/GUARDS.md §12.1.

### Typecheck — gate de tipo do PR

O `tsc --noEmit` (com `prisma generate` antes — o client é requisito do typecheck)
roda no **job `typecheck` PARALELO** do `pr-check.yml` (desde 08/2026): antes ele
rodava serial dentro do job `check` (lint → ts-nocheck → typecheck → unit tests),
esticando o caminho crítico do PR. Hoje é o **gate de tipo oficial do PR** —
bloqueia merge em qualquer erro TS (`bun run typecheck` local é o espelho do
pre-commit, mesma semântica). O contrato do job é travado por
`pr-check-typecheck-workflow.test.ts` (snapshot + verificação de que o job `check`
NÃO mantém o step serial).

**O comando é UM só (`bun run typecheck`), e o preço dele está medido** desde
`2f85d803`, que levou o comando INTEIRO — inclusive o heap de 4GB — para dentro
do script do package.json: 4 workflows pagavam o heap num `env: NODE_OPTIONS`
inline e o hook de push rodava o `tsc` **sem** heap. O benchmark
(`bun run bench:guard-timing`, ver `docs/GUARDS.md` §10 e
docs/benchmarks/guard-timing-latest.json) separa as duas metades e mede
COLD (o `tsconfig.tsbuildinfo` é removido antes de cada amostra):

- nas pipelines o acrescentado é **ruído** (+0.1s por call site) — o MESMO
  comando com o MESMO heap: a unificação moveu um valor, não trabalho;
- no hook, o acrescentado foi o HEAP — e ele só muda algo onde o default do node
  é menor que o do script (o default vem da RAM da máquina). O relatório mede o
  default (aqui: 4144MB) e o exit da régua sem heap, e diz **INDETERMINADO**
  sobre o SIGABRT 134 do runner em vez de afirmá-lo.

A mesma unificação (`2f85d803`) fez as duas forjas rodarem a régua **mais
ampla** da suíte (`bun run test:run`, que INCLUI `src/components/**`) — o check
exigido do GitHub rodava a mais estreita (`test:unit`, que a EXCLUI). O custo do
job que upgrade, medido em 16/09/2026 numa máquina Linux de 16 cpus / 32GB (o
JSON registra cpus, RAM e o heap default do node — sem isso um wall time não é
comparável): a suíte completa custa **131.5s** com 781 testes A MAIS, e as
**433.5s** da régua anterior não são pagas mais — o job ficou **302s mais
BARATO**, porque o config do app roda com 4 workers e o unit com 1 (a atribuição
é reportada como NÃO conferida, e é para isso que a conferência existe).

## Regression Guards

Testes que protegem contra regressões em condições de contorno — alterar a lógica
sem perceber o impacto em edge cases.

### `p95 > threshold` — Degradação por Limiar

| Arquivo                                                                                              | Teste                                                              | Descrição                                                                                                                                                                                                    |
| :--------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`src/lib/__tests__/geo-performance-alert.test.ts`](src/lib/__tests__/geo-performance-alert.test.ts) | `returns not degraded when P95 equals threshold exactly (>= vs >)` | **Teste #9** — Verifica que `p95 > threshold` usa **comparação estrita (`>`)** e não `>=`. Quando P95 é exatamente igual ao limiar (ex: 500ms === 500ms), o serviço **não** deve ser marcado como degradado. |

**⚠️ Alerta de regressão:** Substituir `p95 > threshold` por `p95 >= threshold` no código de
`checkGeoPerformance()` (`src/lib/geo-performance-alert.ts`) **quebra este teste** e faz com que
serviços cujo P95 iguale exatamente o limiar sejam falsamente marcados como degradados,
disparando notificações de alerta desnecessárias. O teste #9 serve como guardrail contra essa
mudança inadvertida.

## Bun Toolchain — Fonte Única (repository variable BUN_VERSION)

A versão do Bun usada no CI vive **em UM lugar**: a repository variable
`BUN_VERSION` (Settings → Secrets and variables → Actions). Trocar o Bun =
alterar a variável em um único ponto — nada de editar 40+ ocorrências.

```bash
# Definir / atualizar a versão (uma única vez por bump):
gh variable set BUN_VERSION 1.3.14
```

Como a versão flui:

| Onde                                         | Como lê a versão                                                                                                                                  |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workflows (`bun-version:` no setup-bun)      | `${{ vars.BUN_VERSION }}`                                                                                                                         |
| Cache keys `bun-`/`prisma-`                  | `bun-${{ vars.BUN_VERSION }}-${{ hashFiles(...) }}`                                                                                               |
| Mirror GHCR (`sync-bun-mirror.yml` env)      | `BUN_VERSION: ${{ vars.BUN_VERSION }}`                                                                                                            |
| Composite action `setup-bun`                 | resolve do input `bun-version` (callers resolvem `vars.BUN_VERSION` no workflow)                                                                  |
| Act local (`.actrc`)                         | `--var BUN_VERSION=<versão>` (espelho local da variável)                                                                                          |
| Scripts (`scripts/**`, hooks do `.husky/**`) | `requireBunVersion()` (`scripts/bun-version.mjs`): env → `.actrc` → `deploy/env.gitea.example`, e ERRO se não houver — nunca um default literal   |
| Composes (build arg/env)                     | `${BUN_VERSION:-<valor declarado>}` — o default só pode ser o valor do espelho (um literal puro é violação)                                       |
| Build da app/worker (`--build-arg`)          | `BUN_VERSION: ${{ vars.BUN_VERSION }}` na pipeline; o Dockerfile **não** tem default e todo build site PASSA o arg (invariante 18)                |
| Toolchain declarado (`package.json`)         | `"packageManager": "bun@1.3.14"` — o mesmo valor dos espelhos (o bump o escreve)                                                                  |
| Pipeline de terceiro (`.woodpecker.yml`)     | a tag `oven/bun:<v>` de cada passo e os `BUN_VERSION=<v>` de `build_args` dizem o valor declarado; o bump reescreve os treze usos (invariante 19) |

Por que o action não tem `default:` no input? Metadata de action (`action.yml`)
é **estática** — `default: ${{ ... }}` NÃO é avaliado (seria o literal
`"${{ vars.BUN_VERSION }}"`). Um default literal (ex.: `1.3.14`) criaria um
segundo ponto de verdade com risco de drift. A resolução acontece em runtime
no step _Resolve Bun version_, com erro claro se nem input nem variável
existirem.

O guard `scripts/check-bun-mirror.mjs` (PR Check + `utf8-check.yml`) falha se:

- o mirror `sync-bun-mirror.yml` tiver `BUN_VERSION` **literal** em vez da variável;
- o action `setup-bun` tiver `default:` literal (metadata não avalia `${{ }}`);
- o action não referenciar `inputs.bun-version` no step de resolve (o
  composite NÃO lê `vars` internamente — act 0.2.89 não resolve vars em
  composite actions; os callers passam o valor resolvido de `vars.BUN_VERSION`);
- algum call site do setup-bun omitir `bun-version:` ou usar literal;
- qualquer workflow tiver versão literal do Bun (`bun-version: 1.3.14`,
  `bun-1.3.14-...`, `BUN_VERSION: "1.3.14"`);
- cache keys `bun-`/`prisma-` não referenciarem `${{ vars.BUN_VERSION }}`;
- o `path:` de um bloco actions/cache não fechar o par key↔path da toolchain
  (bun → `node_modules`/`~/.bun`; prisma → `node_modules/.prisma` +
  `node_modules/@prisma/client`) — ex.: path de outra toolchain sob a key
  errada, path desconhecido ou bloco sem path;
- o `.actrc` não definir `BUN_VERSION` (o act local quebraria);
- algum **SCRIPT** (`scripts/**` + hooks do `.husky/**`) carregar literal da
  versão ou da TAG da imagem do runner (`bun-1.3.14`, `bun@1.3.14`, `bun-v1.3.14`,
  `ubuntu-bun:1.3.14`, `process.env.BUN_VERSION || "1.3.14"`) — a classe que a
  auditoria de 09/2026 abriu: o script continua FUNCIONANDO depois do bump, só
  com a versão antiga, então nada fica vermelho sozinho. Fixtures usam uma
  **sentinela** (`9.9.9-sentinel`), que não é uma afirmação de versão;
- algum **COMPOSE** der um valor a `BUN_VERSION` que não derive: literal puro
  (`BUN_VERSION: "1.4.0"` [divergente]) ou default divergente do declarado no espelho. O
  default é o que RODA onde a variável não existe;
- algum **EXEMPLO DE VERSÃO EM PROSA** (cabeçalho de script, README, docs) não
  bater com o valor declarado — `BUN_VERSION=1.3.14`, `--expected 1.3.14`,
  `ubuntu-bun:1.3.14`, o argumento do setup. O sintoma é o mesmo dos scripts
  (nada fica vermelho, porque doc não executa), deslocado para quem LÊ a doc:
  quem copia o comando roda/mede a versão antiga. Um exemplo que precisa
  divergir declara o papel na própria linha — `[divergente]` (contra-exemplo,
  tem de DIFERIR do vigente) ou `[próxima]` (alvo do bump, tem de ser MAIOR); a
  **sentinela** (`9.9.9-sentinel`) segue fora, semver que não fala do Bun
  (`act 0.2.89`, `lodash 4.17.21`) não é julgado, e `docs/BUN_BUMP.md` é um
  cenário declarado (walkthrough do bump: vale o vigente ou um valor maior);
- algum **DOCKERFILE** declarar VALOR para a versão (invariante 18a): o default
  do ARG (`ARG BUN_VERSION=<v>`) ou um default embutido na referência
  (`${BUN_VERSION:-<v>}`) — é o valor que TODO build que não passa o arg herda
  em silêncio, e que nenhum bump alcança. Sem default, um build sem o arg falha
  alto em vez de rodar outro Bun;
- algum **BUILD SITE** (compose) de um Dockerfile com `ARG BUN_VERSION` não
  passar o arg (invariante 18b), ou o **`packageManager`** do `package.json`
  divergir do valor declarado (invariante 18c). As duas têm recorte no commit:
  o pre-commit julga os blocos de build que o diff TOCA (lidos do ÍNDICE) e, na
  outra direção, o que o commit **APAGA** — o arg de um build site que
  sobrevive e a própria declaração de toolchain, comparando o bloco do ÍNDICE
  com o de HEAD (o que o commit tira não ganha linha adicionada nenhuma, e era
  por ali que remover tanto um quanto o outro passava o pre-commit e só
  encontrava o PR). Era este o buraco da classe:
  um build site que não passa o arg não tem valor escrito NENHUM, então as
  varreduras de literal não tinham o que julgar enquanto ele herdava o default —
  o app da staging rodava um Bun que nenhum arquivo da cadeia de deploy
  declarava, e nada ficava vermelho;
- algum uso da versão no **pipeline de terceiro** (`.woodpecker.yml`, a
  alternativa arquivada) divergir do declarado (invariante 19): a tag da imagem
  ou o build arg. Foram **treze usos** que envelheceram sete versões atrás do
  repositório enquanto o arquivo tinha uma isenção escrita no próprio cabeçalho —
  aqui um literal **igual** ao declarado passa (num `image:` o valor tem de estar
  escrito), o que não pode é ser OUTRO número; o bump os reescreve (seção 2e) e
  confere a reescrita;
- o **alcance** dessa varredura — o que ela **não** olha — mudar de forma
  silenciosa: o doctor publica, como fato próprio, os TIPOS de pipeline de
  terceiro declarados (hoje um: `woodpecker`), quantos arquivos cada um cobre e se
  algum CI presente no repositório está fora deles (`.gitlab-ci.yml`,
  `Jenkinsfile`, `.circleci/config.yml`, …). Um CI detectado fora dos tipos
  declarados **BLOQUEIA** a prontidão: sem essa metade, um pipeline novo entra
  cego e o verde da invariante 19 continua **idêntico** — a varredura responde
  sobre o que olhou, e nada perguntava o que ela não olhou.

### A regra real do Prisma (exemplo vivo)

A cache key do client Prisma nos workflows (ex.: `seed-guards.yml`) é o
**exemplo mais completo** de como a regra se materializa — a versão do Bun
fica no **1º segmento da key**, antes do hash do schema:

```yaml
# seed-guards.yml (jobs seed-prod-e2e / seed-dev-e2e / migrate-category-rename-e2e)
# cacheia node_modules/.prisma + node_modules/@prisma/client
key: prisma-${{ vars.BUN_VERSION }}-${{ hashFiles('prisma/schema.prisma') }}-${{ hashFiles('bun.lock') }}
restore-keys: prisma-${{ vars.BUN_VERSION }}-
```

Em runtime a key resolve para algo como `prisma-1.3.14-a1b2c3d-9f8e7d`.
**Por que a versão do Bun entra na key do Prisma?** O client é **GERADO com
a toolchain do Bun** (`bunx prisma generate` dentro do job). Se o Bun subir
mas o `schema.prisma` não mudar, o hash do schema permanece igual — sem a
versão na key, o cache serviria um client gerado por **outra versão do Bun**
(toolchain errada, silenciosamente). O guard `check-bun-mirror.mjs` falha o
PR se qualquer key `prisma-`/`bun-` não referenciar `${{ vars.BUN_VERSION }}`
— é essa proteção que mantém o exemplo vivo sempre correto.

#### Cobertura das cache keys (auditoria 08/2026)

Auditoria manual + guard mecânico (`node scripts/check-bun-mirror.mjs` →
exit 0, zero violações) de TODAS as cache keys de toolchain nos workflows:
**14 keys `bun-` + 4 keys `prisma-` + 17 `restore-keys` — 100% com a versão
do Bun na key** (diretamente via `${{ vars.BUN_VERSION }}` ou via o resolve
do input no composite; nenhum literal, nenhum prefixo sem versão).

| Prefixo              | Onde (workflows)                                                                                                                                                         | Qtd `key:` | Key (padrão)                                                                                           | Versão na key?                                      | Status  |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------- | ------- |
| `bun-`               | `benchmark-all-weekly` (1) · `benchmark-auto-baseline` (1) · `benchmark-gist-weekly` (1) · `benchmark-weekly` (1) · `e2e-cache` (1) · `pr-check` (4) · `seed-guards` (4) | 13         | `bun-${{ vars.BUN_VERSION }}-${{ hashFiles('bun.lock') }}`                                             | ✅ `vars.BUN_VERSION`                               | ✅ OK   |
| `bun-`               | `.github/actions/setup-bun/action.yml` (tier-2, cache interno)                                                                                                           | 1          | `bun-${{ steps.resolve.outputs.version }}-${{ runner.os }}-${{ runner.arch }}`                         | ✅ resolve do input (que vem de `vars.BUN_VERSION`) | ✅ OK   |
| `prisma-`            | `seed-guards` (4)                                                                                                                                                        | 4          | `prisma-${{ vars.BUN_VERSION }}-${{ hashFiles('prisma/schema.prisma') }}-${{ hashFiles('bun.lock') }}` | ✅ `vars.BUN_VERSION`                               | ✅ OK   |
| `restore-keys`       | mesmos blocos acima (13 `bun-` + 4 `prisma-`)                                                                                                                            | —          | `bun-${{ vars.BUN_VERSION }}-` / `prisma-${{ vars.BUN_VERSION }}-`                                     | ✅ `vars.BUN_VERSION`                               | ✅ OK   |
| `turbo`              | — (não usado no projeto — zero refs em `package.json`/`next.config.ts`/workflows)                                                                                        | 0          | n/a                                                                                                    | n/a                                                 | ⚪ n/a  |
| `secrets.DEPLOY_KEY` | `deploy.yml` (2) · `release-deploy.yml` (2) · `ci.yml` (2, comentado)                                                                                                    | —          | `key: ${{ secrets.DEPLOY_KEY }}` (SSH deploy key do `appleboy/ssh-action`, NÃO é actions/cache)        | n/a (não é cache)                                   | ⚪ fora |

**Notas da auditoria:**

- `turbo` **não existe** no projeto (nem como dependência, nem como cache) —
  se um dia entrar, a regra vale igual: `turbo-${{ vars.BUN_VERSION }}-...`
  via `DEFAULT_CACHE_KEY_RULES` do guard (configurável por prefixo).
- As `key:` do `appleboy/ssh-action` (`secrets.DEPLOY_KEY`) **não são cache**
  — são chaves SSH; o guard ignora (só valida `actions/cache@v4`).
- O par key↔path também é validado: `bun-` → `node_modules`/`~/.bun`;
  `prisma-` → `node_modules/.prisma` + `node_modules/@prisma/client` — um
  path de toolchain errada sob a key errada é violação (regra 7b do guard).
- A key interna do tier-2 (`setup-bun/action.yml`, `steps.resolve.outputs.
version`) está FORA do escopo de scan do guard (só `.github/workflows/`)
  — verificada manualmente nesta auditoria; um drift futuro ali não seria
  pego mecanicamente (vale monitorar em bump de versão).
- O `--staged` do guard cobre keys **introduzidas pelo próprio PR** — uma key
  antiga adicionada no diff falha antes do merge.

**Fluxo de bump do Bun (ex.: 1.3.14 → 1.3.15):** — procedimento completo e
auditável (comandos `gh` + re-sync dos mirrors + troubleshooting) em
[docs/BUN_BUMP.md](docs/BUN_BUMP.md).

| #   | Passo                           | O que fazer                                                                                                                 | Edita algo?                                        |
| --- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| 1   | **Variável**                    | `gh variable set BUN_VERSION 1.3.15` [próxima]                                                                              | ✅ única edição OBRIGATÓRIA no CI (fonte única)    |
| 2   | **Mirrors GHCR**                | re-dispatch `sync-bun-mirror.yml` + `sync-ubuntu-bun-mirror.yml` (leem `vars.BUN_VERSION`; o cron semanal roda sozinho)     | ❌ leem a variável — só re-rodar                   |
| 3   | **Cache keys `prisma-`/`bun-`** | nada — derivam de `${{ vars.BUN_VERSION }}`; as keys antigas viram cache miss automaticamente (toolchain nova ≠ chave nova) | ❌ automático (é exatamente o que o guard protege) |
| 4   | **`action.yml`**                | nada — sem `default:`, resolve do input `bun-version` em runtime                                                            | ❌ metadata estática                               |
| 5   | **`.actrc` local**              | `--var BUN_VERSION=1.3.15` [próxima] (espelho local para o act)                                                             | ✅ local apenas                                    |
| 6   | **Call sites do setup-bun**     | nada — todos passam `bun-version: ${{ vars.BUN_VERSION }}` (o guard exige)                                                  | ❌ automático                                      |

A 1ª execução do CI após o bump roda com **cache miss em todas as keys
`bun-*`/`prisma-*`** (custo único de ~20-30s por job) e re-popula o cache
com as chaves novas — o preço deliberado de nunca servir toolchain errada
de cache. O guard `check-bun-mirror.mjs` **falha o PR por DRIFT**, não por
bump "esquecido": se alguém contornar a fonte única (ex.: hardcodar uma
versão literal num workflow/key em vez de `${{ vars.BUN_VERSION }}`, ou
atualizar a variável deixando um literal antigo para trás), o guard detecta
a inconsistência e bloqueia o merge — é essa a proteção que mantém o exemplo
vivo sempre correto.

> ⚠️ **`.actrc` local**: mantenha `--var BUN_VERSION=<versão>` em sincronia com
> a repository variable do GitHub. O act não lê as variables do repositório —
> o arquivo é o espelho local. Veja `### Act (executa os jobs localmente)`.
>
> **Drift de VALOR nos espelhos (job semanal `actrc-sync`):** o guard estático
> `check-bun-mirror.mjs` só valida que cada espelho DEFINE `BUN_VERSION` — o
> VALOR é impossível de conferir estaticamente (a variável remota só existe em
> runtime). O job `actrc-sync` do `benchmark-weekly.yml` compara os **dois**
> espelhos do working tree com o valor de **cada variável que o compose da forja
> consome** — `vars.BUN_VERSION`, `vars.IMAGE_REGISTRY` e
> `vars.IMAGE_NAMESPACE`. O guard recebe o valor da versão por `--expected` e o
> das outras duas por `--expected-var NOME=VALOR`, e emite `::warning::`
> (NÃO-bloqueante) se divergirem: o `.actrc`, onde o act local passaria a testar
> uma versão (ou um
> registry) diferente da produção; e `deploy/env.gitea.example`, que alimenta a
> label do runner da forja — ali o sintoma é pior, porque o setup-bun funciona
> igual com ou sem Bun pré-instalado, então a divergência só desliga o fast path
> de 0s do tier-1 em silêncio (todo job volta a pagar o download), e um
> registry/namespace trocado só aparece quando um job tenta puxar a imagem.
> Para registry e namespace, antes só existia a checagem de existência
> (`check-registry-source`); agora o valor é comparado. Uma variável sem valor
> passado à run sai como **NÃO COMPARADA** (nomeada no log, nunca conferida), e
> variável ausente no repositório também vira `::warning::` (exit 0), não falha
> o job.
>
> **E os scripts deixaram de cravar o literal por conta própria:** o valor que
> eles usam vem do mesmo resolvedor (`scripts/registry-source.mjs`) — ambiente
> primeiro, **espelho comitado** depois (`.actrc`, `deploy/env.gitea.example`,
> `.env.production.example`), e nada se não houver nenhum dos dois (não existe
> default de reserva de propósito: ele sobrevive à troca de registry, o script
> continua puxando do host VELHO, e como a imagem continua existindo lá, nada
> fica vermelho). A varredura da invariante 9 cobre quatro **famílias** de
> arquivo — todo compose com default (inclusive uma stack nova que ninguém
> cadastrou em par), o shell de `scripts/` e `deploy/`, o `.mjs` (que não pode
> ter literal: use o resolvedor) e o fallback do YAML dos workflows — e cada
> forma de default vale na SUA família: `${NOME:-x}` em compose/shell,
> `X || "valor"` em JS, `vars.NOME || 'valor'` em YAML. O que casa a forma de
> outra família (mensagem de erro, payload de uma prova) é contado e dito no
> relatório, **nunca** julgado como valor — e cada metade disso tem a sua
> mutação (`scripts/test-mutation-registry-defaults.sh`, sub-test 26 do master).
> A **grafia** também não é julgada: `|| 'x'` e `|| "x"` são a mesma declaração
> (antes, a forma entre aspas duplas saía como "dinâmica", fora da comparação —
> o divergente passava em silêncio). E o **tipo** é da tabela, não da régua: o
> Controle C declara um tipo novo numa forma inédita, aplica o remendo só na
> tabela e exige o julgamento — com a soma do corpo da comparação medida antes e
> depois, byte a byte igual.
>
> **E o mesmo valor é conferido a cada PR, não só no cron:** o job `guards` da
> forja e um job do `pr-check.yml` rodam `scripts/check-doctor-ci.mjs` — o
> doctor no perfil `--ci` (a fatia local: contrato, env mirror, render do
> compose e o VALOR dos espelhos). Ele BLOQUEIA o PR quando o valor diverge do
> que os espelhos declaram, e **nomeia** a variável que não chegou (régua vazia
> seria "não perguntado", e um verde que não conferiu nada é o defeito).
>
> Como o run fica **verde** em qualquer cenário, a anotação não é canal de
> ninguém: o step `if: always()` publica o drift como **issue**
> (`scripts/actrc-sync-issue.mjs`, label `actrc-sync-drift`, dedup por
> assinatura no corpo **e nos comentários** — a issue é o estado da dívida até
> ser fechada). E, quando os
> espelhos **voltam a concordar**, o mesmo script comenta a prova e **fecha** a
> issue: uma dívida resolvida que continua aberta mente no board, e o próximo
> bump seria investigado duas vezes. Só fecha o que ele mesmo abriu (o marcador
> da própria assinatura, não o label) e declara no comentário que o espelho do **host**
> (`deploy/.env.gitea`, gitignored) não entra na comparação num runner do
> GitHub. Na forja, onde não há canal de issue, o mesmo job roda com `--fail`.

## Local Workflow Validation (actionlint + act)

Valide os `.github/workflows/*.yml` localmente antes de abrir PR, sem depender do CI.
O job `actionlint` do `pr-check.yml` roda a mesma verificação no GitHub.

### Actionlint (sintaxe YAML + shellcheck)

```bash
# Valida todos os workflows (YAML + shellcheck), igual ao job actionlint do pr-check.yml
MSYS_NO_PATHCONV=1 docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:latest
```

> **Windows/Git Bash:** `MSYS_NO_PATHCONV=1` impede que o Git Bash converta `/repo` para um
> caminho Windows (senão o volume monta no lugar errado). No Linux/macOS pode omitir.

### Act (executa os jobs localmente)

O binário fica em `tool-results/act/act.exe` (v0.2.89) — baixado de
[nektos/act releases](https://github.com/nektos/act/releases) (não é rastreado pelo git).

```bash
# Dry-run: lista o plano de execução SEM executar (a flag é -n, NÃO --dry-run)
tool-results/act/act.exe -n -W .github/workflows/pr-check.yml -j actionlint

# Execução real de um job (mapeia ubuntu-latest para a imagem que o CI usa)
tool-results/act/act.exe -W .github/workflows/pr-check.yml -j secrets-guard \
  -P ubuntu-latest=catthehacker/ubuntu:act-latest
```

#### Imagem custom com Bun pré-instalado (tier-1 fast path)

O composite local `.github/actions/setup-bun` tem 3 camadas — o **tier-1
(pre-installed fast path, ZERO download)** só dispara se `bun` já estiver no
PATH com a versão pedida. **Nenhuma imagem padrão embarca Bun** (nem os
runners GitHub-hosted nem `catthehacker/ubuntu:act-latest`) — o tier-1 nunca
disparava no act. A imagem custom `ghcr.io/<owner>/ubuntu-bun:<versão>`
(`Dockerfile.ubuntu-bun`, base catthehacker + bun pré-instalado, espelhada
pelo workflow `sync-ubuntu-bun-mirror.yml`) ativa o fast path de verdade:

```bash
# Build local (FONTE ÚNICA: vars.BUN_VERSION como --build-arg)
docker build --build-arg BUN_VERSION=1.3.14 -f Dockerfile.ubuntu-bun \
  -t ghcr.io/<owner>/ubuntu-bun:1.3.14 .

# Executa o job com a imagem custom (--pull=false usa a imagem local)
tool-results/act/act.exe -b -W .github/workflows/pr-check.yml -j check \
  -P ubuntu-latest=ghcr.io/<owner>/ubuntu-bun:1.3.14 --pull=false
```

**Ganho medido — expectativa CORRIGIDA (act 0.2.89, medido 08/2026):** o
tempo do setup-bun depende do AMBIENTE — a expectativa de "0-2s" vale SÓ
para o tier-1 em runner COM bun pré-instalado e SEM overhead de container;
no act, o composite do log SEMPRE inclui o overhead do próprio act (~11s
warm / ~30s cold na 1ª execução de actions), então não é métrica do
setup-bun em si:

| Ambiente                                              | Tier engajado                     | Tempo observado                                                                                                                                                                              |
| ----------------------------------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| act + imagem default `catthehacker/ubuntu:act-latest` | tier-2 (cache EMULADO pelo act)   | composite ~33s — `Restore Bun release from cache [21.22s]` (o act emula o actions/cache sem o serviço real do GitHub)                                                                        |
| act + imagem custom `ubuntu-bun`                      | tier-1 (fast path, zero download) | steps ~0.4-0.6s cada; composite ~11s warm (overhead do próprio act)                                                                                                                          |
| CI real do GitHub (hosted runner)                     | tier-2 (cache REAL do GitHub)     | **~1-2s esperado — o ganho real** (antes, `oven-sh/setup-bun@v2`: ~25-35s). Medir com `scripts/bench-setup-bun.sh` (ver [abaixo](#medição-real-do-setup-bun-no-ci-scriptsbench-setup-bunsh)) |

O marcador `✅ Usando Bun pré-instalado: 1.3.14 (0s, sem download)` confirma
que o tier-1 ENGAGOU (0s = sem download), mas a linha
`Success - Main ./.github/actions/setup-bun [X.XXs]` do log do act NÃO deve
ser lida como "tempo do setup-bun" — é o composite com o overhead do act.

**Overhead de startup do container (medido em 02/08/2026, act 0.2.89, job
`secrets-guard` SEM setup-bun — o mesmo job nas duas imagens, `--pull=false`):**

| Métrica                                             | catthehacker (default) | ubuntu-bun (custom) | Delta                         |
| --------------------------------------------------- | ---------------------- | ------------------- | ----------------------------- |
| Startup puro, média 5 runs (`docker run /bin/true`) | ~1.22s                 | ~1.19s              | **~-0.03s** (dentro do ruído) |
| Job completo no act, média 5 runs (`secrets-guard`) | ~7.06s                 | ~7.40s              | **~+0.34s** (dentro do ruído) |
| Step `Set up job` no act, amostra única (run 3)     | ~2.22s                 | ~2.48s              | ~+0.27s (dentro do ruído)     |

**Decisão (por que NÃO trocar a imagem padrão do `.actrc`/README):** o
overhead de startup do container da imagem custom é **estatisticamente
desprezível** (de ~-30ms a ~+350ms, nos dois sentidos, dentro da variância
run-to-run de ±400ms de um job de ~7s; a imagem é só ~130MB maior — 2.46GB
vs 2.33GB). Para jobs SEM
setup-bun (ex.: `secrets-guard`, `actionlint`, guards) a imagem custom **não
traz nenhum ganho**. Para jobs COM setup-bun (ex.: `check`) o tier-1
economiza **~25-35s por job** vs o `oven-sh/setup-bun@v2` antigo — o ganho
supera em ~70-100× o custo de startup. **Uso recomendado:** o `.actrc` hoje
**não tem linha `-P`** (só `--var BUN_VERSION=1.3.14`) — o default do act já
é `catthehacker/ubuntu:act-latest` via mapping embutido; trocar a imagem
padrão exigiria ADICIONAR um `-P` explícito, o que **não recomendamos**.
Manter a custom **somente nos jobs que exercitam o setup-bun**, via
`-P ubuntu-latest=ghcr.io/<owner>/ubuntu-bun:1.3.14 --pull=false` (como no
exemplo acima).

> **Repro das medições** (5 runs por métrica):
> `docker run --rm <img> /bin/true` para o startup puro; e
> `act -b -W .github/workflows/pr-check.yml -j secrets-guard` (com e sem
> `-P ubuntu-latest=...ubuntu-bun:1.3.14 --pull=false`) para o job completo.
>
> **Automatizado** (revalidar a cada bump da imagem — nova versão do mirror
> ubuntu-bun → rodar de novo): `bun run bench:act-startup`
> (`scripts/act-startup-bench.sh` — roda o `secrets-guard` N vezes em cada
> imagem, `--pull=false`, e imprime a tabela de delta cold/warm; suporta
> `-n N`, `--assert-pct P` para falhar se alguma imagem exceder a baseline
> além do percentual, e `--image 'label|tag'` para testar candidatas).

#### Limitação act 0.2.89 — composite actions não resolvem `vars`

O act 0.2.89 varre **TODOS os tokens `${{ }}`** do composite action —
incluindo comentários, descrições e prosa — e tenta avaliá-los.
`${{ vars.BUN_VERSION }}` em QUALQUER lugar do `action.yml` (até num
comentário) quebra o parse com `Unknown Variable Access vars` (o token vazio
`${{ }}` também quebra). Por isso o composite resolve a versão **do input**
`bun-version` (os callers passam o valor resolvido de `vars.BUN_VERSION` no
workflow, onde o act funciona) e o guard `check-bun-mirror.mjs` falha o PR se
um call site omitir o input. No **workflow-level**, `${{ vars.BUN_VERSION }}`
funciona normalmente no act (verificado empiricamente).

#### `--bind` para actions locais untracked

Por padrão o act copia o working tree para um volume a partir do **HEAD do
git** — arquivos NOVOS/untracked (ex.: uma action local recém-criada) não
são visíveis e o act falha com `failed to read 'action.yml'... file does not
exist`, mesmo com o arquivo presente no disco. Use `-b`/`--bind` para montar
o working tree real (untracked inclusos) — é o que o exemplo acima usa.

### Medição real do setup-bun no CI (`scripts/bench-setup-bun.sh`)

O act **emula** o actions/cache sem o serviço real do GitHub — o tempo do
setup-bun medido localmente (~33s catthehacker / ~11s custom) **NÃO é o do
CI real**. O `scripts/bench-setup-bun.sh` automatiza a medição REAL:

1. Dispara o workflow `bench-setup-bun.yml` no repo real N× via
   `workflow_dispatch` (run #1 = **cache frio**, run #2+ = **cache quente**).
2. Espera concluir (polling com filtro de precisão ms na `created_at`).
3. Lê a duração do step `./.github/actions/setup-bun` da **jobs API** — o span
   do 1º ao último sub-step RODADO (`status == "completed"`; steps skipped têm
   timestamps nulos e são filtrados — evita NaN no run cold), precisão ms via
   `scripts/bench-setup-bun-span.mjs` (lógica pura testada em
   `src/lib/__tests__/bench-setup-bun-span.test.ts`).
4. Detecta o tier (1/2/3) pelo log do run e imprime a tabela comparativa
   real vs act (~33s) + gap warm/cold. Saída JSON opcional (`--json`).

**Fluxo completo (auth → push → medição → cleanup):**

> **Auth — device flow HUMANO, passo a passo (o 'auth fantasma' não completa
> sozinho):**
>
> 1. `gh auth login --web` — inicia o device flow; o CLI imprime um
>    **código de um só uso** (ex.: `XXXX-XXXX`).
> 2. Abra `https://github.com/login/device` e **digite o código exibido
>    pelo CLI** — não o token, o CÓDIGO de verificação do terminal.
> 3. Autorize no navegador com a conta que tem acesso ao repo
>    (scopes: `repo` + `workflow`).
> 4. Volte ao terminal — o `hosts.yml` é gravado e o `gh auth status`
>    completa ("Logged in to github.com").
>
> **⚠️ O código EXPIRA em ~15 minutos.** Se a autorização humana não
> acontecer dentro da janela, o processo fica pendurado, o token NUNCA é
> gravado e o `gh auth status` continua "not logged in" — o sintoma
> exato do 'auth fantasma'. **Reinicie com `gh auth login --web` de novo
> (código NOVO)**; o fluxo não completa sozinho e não herda auth de outro
> checkout/worktree. `bench-setup-bun.sh --dry-run` valida o auth antes
> de gastar um run (exit 4 = API bloqueada). Diagnóstico completo em
> [Bugs conhecidos](#bugs-conhecidos).

```bash
# 1. Auth — OBRIGATÓRIO completar NO ambiente do worktree (device flow — ver acima)
gh auth login --web              # inicia o device flow; o CLI mostra o código
gh auth status                   # confirmar "Logged in to github.com"
gh api repos/<owner>/<repo>      # exit 0 = acesso ok (404 = conta sem acesso)

# 2. Fonte única da versão — precisa existir no repo real
#    Settings → Secrets and variables → Actions → BUN_VERSION=1.3.14
gh variable set BUN_VERSION 1.3.14

# 3. Push de uma branch que contenha o bench-setup-bun.yml
#    (workflow_dispatch exige o arquivo num ref REMOTO para o dispatch funcionar)
git push origin <branch>

# 4. Medição (o preflight valida os passos 1-3 sozinho, exit 2 se faltar algo)
./scripts/bench-setup-bun.sh                     # ciclo completo cold→warm
./scripts/bench-setup-bun.sh --dry-run           # só valida pré-requisitos
./scripts/bench-setup-bun.sh --runs 3 --json out.json   # N runs + JSON
./scripts/bench-setup-bun.sh --ref main          # dispatch em outro ref

# 5. Cleanup pós-medição
#    - remover o trigger `push:` do bench-setup-bun.yml (deixar só workflow_dispatch)
#    - deletar a branch remota de medição
#    (feito no fluxo original: commit 457b9abe + git push origin --delete <branch>)
```

**Exit codes:** `0` runs executados e timings extraídos · `1` algum run falhou
ou timing não encontrado · `2` usage/auth/setup error (mensagem clara do que
falta) · `3` `vars.BUN_VERSION` ausente — mensagem detalhada com a URL direta
(`https://github.com/<owner>/<repo>/settings/variables/actions`) + comando
`gh variable set BUN_VERSION 1.3.14 -R <repo>` para criar a variável, em vez
de falhar obscuro · `4` **API bloqueada** — quando o `gh` está sem acesso ao
repo mas o **git SSH alcança o remoto**, o preflight confirma o workflow no
ref via `git ls-remote`/`git fetch`/`git ls-tree` (fallback SSH) e reporta com
clareza que o **único bloqueio restante é a API** (workflow_dispatch + jobs
API — o SSH não cobre). Env overrides: `BENCH_GH_REPO`, `BENCH_REF`,
`BENCH_RUNS`, `BENCH_TIMEOUT_S`.

**O que a tabela diz:** run #1 (cold) = tier-3 download real (~5-10s); run #2
(warm) = tier-2 cache REAL do GitHub (~1-2s) — **este é o número que fecha a
comparação** vs os ~33s do act emulado (gap ≈ 30×), provando que a emulação
local é o gargalo, não a migração do setup-bun.

### Bugs conhecidos

| Bug                                                         | Sintoma                                                                                                                                                                                                                                | Workaround                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| :---------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`--dry-run` não existe**                                  | `Error: unknown flag: --dry-run`                                                                                                                                                                                                       | Usar `-n`. Atenção: `-n` só mostra o plano e **não** executa os `run:` — não pega erros de runtime (ex: CRLF, comandos ausentes).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **`oven-sh/setup-bun@v2` lento**                            | Baixa o Bun do GitHub a cada execução (~20–35s), sem cache entre runs                                                                                                                                                                  | **Confirmado (comportamento do action EXTERNO antigo, medido ANTES da migração):** 2 execuções consecutivas do job `e2e-counts-guard` no act — run #1 = 35.5s, run #2 = 24.2s, ambos com `cache-hit=false` explícito no output do setup-bun → re-download a cada execução, sem cache de layers nem de release. Exit 0 (é lentidão, não falha). (Uma captura posterior na mesma máquina deu 11.66s/13.53s — durações variam por máquina/rede; o invariante é `cache-hit=false` em todas — ver [Evidência empírica](#evidência-empírica-log-real-do-act--bug-do-setup-bun).)<br>**Repro automatizado:** `bun run repro:setup-bun` (scripts/act-repro-setup-bun.sh) — roda o job 2×, extrai a duração do step setup-bun e o cache-hit de cada run, e asserta o comportamento esperado (cache-miss em todas = bug; cache-hit na última = fix). Use num checkout ANTERIOR ao commit de migração para reproduzir o bug. **Hoje o bug não é reproduzível em `main`:** o job usa o composite local `.github/actions/setup-bun` (cache keyed na versão) — ver `scripts/check-bun-mirror.mjs`. Na época era aceitável para validação pontual; exigia rede para o GitHub.                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **Fast path (tier-1) não dispara no catthehacker**          | No act com a imagem default `catthehacker/ubuntu:act-latest` o tier-1 NUNCA engaja — a imagem não embarca bun — e o act **emula** o actions/cache com espera (~21s medidos: `Restore Bun release from cache [21.22s]`, composite ~33s) | Usar a imagem custom `ghcr.io/<owner>/ubuntu-bun:<versão>` com `-P ubuntu-latest=... --pull=false` para exercitar o tier-1 de verdade. **O ganho real (~1-2s) aparece no CI do GitHub** (tier-2 com cache REAL do GitHub; tier-1 só em runner com bun pré-instalado) — a expectativa de 0-2s no act é incorreta: o composite inclui o overhead do próprio act (~11s warm).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **act 0.2.89 não resolve `vars` em composite action**       | `Unknown Variable Access vars` ao parsear o `action.yml` — e `expressions are not allowed here` para o token vazio `${{ }}` em descrição                                                                                               | Resolver a versão **no workflow** e passar via input `bun-version` (o composite lê só inputs); o guard `check-bun-mirror.mjs` exige `bun-version: ${{ vars.BUN_VERSION }}` em todo call site. Workflow-level `${{ vars.BUN_VERSION }}` funciona no act. Ver [Imagem custom](#imagem-custom-com-bun-pré-instalado-tier-1-fast-path).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Actions locais untracked invisíveis**                     | `failed to read 'action.yml'... file does not exist` para actions recém-criadas                                                                                                                                                        | Usar `-b`/`--bind` (monta o working tree real, untracked inclusos) em vez do volume padrão copiado do HEAD.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **CRLF quebra bash no container (Windows)**                 | `scripts/check-utf8.sh: line 20: set: pipefail: invalid option name`                                                                                                                                                                   | **Causa raiz (confirmada):** `core.autocrlf=true` deixa o working tree CRLF (`i/lf w/crlf`) em **todos os 41 `.sh`** — o checkout ocorreu antes de `.gitattributes` declarar `eol=lf`, então o atributo nunca foi aplicado aos arquivos já presentes. O act copia o working tree para o container Linux → bash falha em `set -euo pipefail`. **Fix aplicado:** normalizar os `.sh` para LF no disco (o blob já era LF → **zero diff** no git) + `git add --renormalize` para sincronizar o stat cache do index (sem mudar conteúdo). **Evidência pós-fix no act:** exit 0 — 748 arquivos escaneados, "Status: OK -- all valid UTF-8". Alternativa: `git config core.autocrlf false` + `git add --renormalize`, ou WSL. **Proteção anti-regressão:** `scripts/check-crlf.sh` (working tree) + `scripts/check-blob-crlf.sh` (blob commitado — `i/crlf`/`i/mixed` via `git ls-files --eol`) rodam no pre-commit e no `utf8-check.yml`, falhando se qualquer `.sh` voltar a ter CRLF. **Fix reutilizável:** `scripts/normalize-crlf.sh` aplica a normalização em qualquer checkout/worktree (`.sh`/`.ts`/`.md` → LF + `git add --renormalize`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **`gh auth login` "fantasma" (device flow nunca completa)** | `gh auth status` sempre "not logged in" e o `bench-setup-bun.sh` sai com **exit 4 (API bloqueada)** mesmo depois de rodar o login — o processo do device flow fica vivo aguardando, mas nada acontece                                  | **RESOLVIDO (08/2026):** o device flow do `gh` exige autorização **humana no navegador** — quando o código é digitado em `https://github.com/login/device` dentro da janela (~15 min), o `hosts.yml` **É gravado** e o login completa (confirmado neste ambiente: conta `severinno`, scope `repo`, `gh api` exit 0). O bug só ocorria porque o fluxo rodava num ambiente sem interação — o processo ficava pendurado até o código expirar e o token nunca era gravado. Evidência da investigação original (3 ocasiões + polling de ~40 min): `hosts.yml` **ausente** (o arquivo só é criado quando a autorização completa), repo **privado** (API 404 sem token), `GH_TOKEN`/`GITHUB_TOKEN` **vazios**. **Lição para futuros devs:** `gh auth login` **DEVE ser completado NO ambiente do worktree com autorização humana** — abrir `https://github.com/login/device`, digitar o código exibido pelo CLI e autorizar a conta com acesso ao repo (`repo,workflow`). O fluxo não completa sozinho, não herda auth de outro checkout/worktree, e o código expira em ~15 min (reiniciar com código novo se passar disso). O `bench-setup-bun.sh --dry-run` valida o auth antes de gastar um run — ver o passo 1 do [fluxo de medição](#medição-real-do-setup-bun-no-ci-scriptsbench-setup-bunsh). **Pós-auth:** o one-liner de medição (`gh run view --jq`) foi validado num run real do `bench-setup-bun` (run 30765242263 — um run de FALHA num commit pré-fix; só prova o MECANISMO de captura de timing, não o ganho ~1-2s) — mas o `mutation-coord-update` ainda não tem run real porque o `seed-guards.yml` não está na branch default. |

#### Evidência empírica (log real do act — bug do setup-bun)

Log **real** capturado rodando `scripts/act-repro-setup-bun.sh` contra o estado
PRÉ-migração (`oven-sh/setup-bun@v2` no `pr-check.yml` do commit `a59b3601`) —
mesmo com o cache do action já presente localmente no act
(`docker cp src=...oven-sh-setup-bun@v2/`), as DUAS execuções consecutivas
re-baixam o Bun do GitHub e reportam `cache-hit=false`:

```text
# run 1/2 — e2e-counts-guard (job com oven-sh/setup-bun@v2)
⭐ Run Main oven-sh/setup-bun@v2
  | Downloading a new version of Bun: https://github.com/oven-sh/bun/releases/download/bun-v1.3.14/bun-linux-x64.zip
  ✅  Success - Main oven-sh/setup-bun@v2 [11.6592129s]
  ⚙  ::set-output:: cache-hit=false

# run 2/2 — MESMA máquina, execução consecutiva (cache do act já populado)
⭐ Run Main oven-sh/setup-bun@v2
  | Downloading a new version of Bun: https://github.com/oven-sh/bun/releases/download/bun-v1.3.14/bun-linux-x64.zip
  ✅  Success - Main oven-sh/setup-bun@v2 [13.5306277s]
  ⚙  ::set-output:: cache-hit=false
```

Saída consolidada do repro (resumo do próprio script, exit 0):

```text
=== setup-bun repro — job=e2e-counts-guard runs=2 action=external expect=cache-miss ===
  run | setup-bun step | cache-hit | job exit
  ----|----------------|-----------|---------
   1  |    11.6592129s |     false | 0
   2  |    13.5306277s |     false | 0
  logs: /tmp/bun-repro-evidence
✅ PASS — nenhuma run teve cache-hit=true (bug reproduzido: re-download em cada execução)
```

As linhas acima são verbatim do output do act (prefixo `[PR Check/...]` elidido
para legibilidade; a linha `| Downloading a new version of Bun:` + o
`::set-output:: cache-hit=false` são idênticos ao log original em
`/tmp/bun-repro-evidence/run-1.log` e `run-2.log`).

> **Sobre os dois pares de durações** (tabela acima: 35.5s/24.2s; aqui:
> 11.66s/13.53s): são **capturas independentes do mesmo bug** em momentos e
> condições de rede/máquina diferentes — o que importa é o **invariante**:
> `cache-hit=false` em **todas** as runs consecutivas (re-download a cada
> execução, sem cache de layers nem de release). As durações variam por
> máquina/rede e NÃO fazem parte da caracterização do bug.

Para reproduzir: num checkout anterior ao commit de migração (`5f5d8a88`), rode
`bun run repro:setup-bun` (`--expect cache-miss`). No `main` atual o job usa o
composite local `.github/actions/setup-bun` e a 2ª run reporta `cache-hit=true`
(fix).

# test deploy hostinger
