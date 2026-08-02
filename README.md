# Severinno Marketplace

<p align="center">
  <em>Substitua <code>{owner}/{repo}</code> pelo seu repositório GitHub para ativar as badges dinâmicas.</em><br>
  <a href="https://github.com/{owner}/{repo}/actions/workflows/ci.yml">
    <img src="https://github.com/{owner}/{repo}/actions/workflows/ci.yml/badge.svg" alt="CI/CD">
  </a>
  <a href="https://github.com/{owner}/{repo}/actions/workflows/pr-check.yml">
    <img src="https://github.com/{owner}/{repo}/actions/workflows/pr-check.yml/badge.svg" alt="PR Check">
  </a>
  <a href="https://github.com/{owner}/{repo}/actions/workflows/e2e-cache.yml">
    <img src="https://github.com/{owner}/{repo}/actions/workflows/e2e-cache.yml/badge.svg" alt="E2E Cache">
  </a>
  <img src="https://img.shields.io/badge/utf8--check-748%20files%20%E2%9C%85-2ea44f" alt="UTF-8: 748 files">
  <img src="https://img.shields.io/badge/tests-74%20unit%20%7C%20160%20e2e%20%E2%9C%85-2ea44f" alt="Tests: 74 unit | 160 E2E">
  <img src="https://img.shields.io/badge/encoding%20guards-7%2F7%20active%20%E2%9C%85-2ea44f" alt="Encoding guards: 7/7 active">
  <img src="https://img.shields.io/badge/coverage-57%25%20(45%2F79)-bfa100" alt="Coverage: 57%">
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
| **Auth**       | Session-based (iron-web-token, crypto)                                               |
| **Storage**    | S3-compatible (R2) with local fallback                                               |
| **Monitoring** | Sentry (errors), Pino (logs)                                                         |
| **Testing**    | Vitest (unit), Playwright (E2E)                                                      |
| **Container**  | Docker Compose (postgis, redis, rabbitmq, pgbackup)                                  |

## Quick Start

```bash
# 1. Install dependencies
bun install

# 2. Start infrastructure
docker compose up -d postgis redis rabbitmq

# 3. Setup database
bunx prisma migrate dev

# 4. Seed data
bun run seed

# 5. Start dev server
bun run dev
```

> **Seed test hook (`SEED_SPEC_PATCH`):** os seeds aceitam um patch temporário
> do spec de categorias para validar convergência de update/rename nos E2Es —
> **só aplica fora de produção** (seed-prod exige `PROD_SEED_ALLOW_DEV=1`).
> Ver [docs/SECURITY.md#13-seed-test-hooks-seed_spec_patch](docs/SECURITY.md).

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌──────────────┐
│   Browser    │────▶│  Next.js 16  │────▶│  API Routes  │
│  (React SPA) │     │  (Server)    │     │  (36 rotas)  │
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
bun run email-consumer
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

## API Routes (36 endpoints)

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
bun run seed       # Seed database
```

### Workers

```bash
bun run consumer         # Start RabbitMQ notification worker
bun run email-consumer   # Start email queue worker
```

### Testes de Cache

```bash
# Fast gate — valida manifesto contra codigo real (~2s)
npx tsx scripts/validate-cache-manifest.ts

# Unit tests — 74 testes em 5 suites de cache
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
bun run vitest     # Run all unit tests
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

| Script                 | Plataforma  | O que verifica                                                                   |
| ---------------------- | ----------- | -------------------------------------------------------------------------------- |
| `diagnose-docker.ps1`  | Windows     | Port bindings, healthchecks, redes, Hyper-V, conflitos de porta, recursos Docker |
| `diagnose-docker.sh`   | Linux / Mac | Mesmo que o .ps1, exceto Hyper-V (Windows-only)                                  |
| `diagnose-completo.sh` | Linux / Mac | Tudo do `diagnose-docker.sh` + workers (RabbitMQ), filas, PostgreSQL, Redis, E2E |

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
| [`docs/API.md`](docs/API.md)                               | Referência completa da API REST (50+ endpoints)                 |
| [`docs/CACHE_STRATEGY.md`](docs/CACHE_STRATEGY.md)         | Estratégia de cache em 3 camadas (Redis + HTTP + Browser)       |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)                 | Guia de deploy em produção com Docker + Caddy                   |
| [`docs/PUSH_NOTIFICATIONS.md`](docs/PUSH_NOTIFICATIONS.md) | Sistema de push notifications (Web Push, agendamento, webhooks) |
| [`docs/SECURITY.md`](docs/SECURITY.md)                     | Medidas de segurança (CSP, rate limiting, criptografia, Docker) |
| [`docs/TESTING.md`](docs/TESTING.md)                       | Guia de testes (Vitest + Playwright, padrões de mock)           |
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

|         Camada          | Gatilho                    | Comando                                                                        | Tempo |     Bloqueia?     |
| :---------------------: | -------------------------- | ------------------------------------------------------------------------------ | :---: | :---------------: |
|    🏠 **Pre-commit**    | `git commit`               | `scripts/check-utf8.sh --dry-run --ci src/`                                    |  ~2s  |     ✅ Exit 1     |
|     🚀 **Pre-push**     | `git push`                 | `scripts/check-utf8.sh --dry-run --ci src/`                                    |  ~2s  |     ✅ Exit 1     |
|      🔄 **CI/CD**       | Push para `main`/`develop` | `scripts/check-utf8.sh --ci src/` (via `ci.yml`)                               | <10s  | ✅ Bloqueia build |
|     📋 **PR Check**     | `pull_request` para `main` | `scripts/check-utf8.sh --ci src/` (via `pr-check.yml`)                         | <10s  | ✅ Bloqueia merge |
|    🔒 **CRLF Guard**    | `git commit` + push/PR     | `scripts/check-crlf.sh --ci` (pre-commit + `utf8-check.yml`)                   |  <1s  |     ✅ Exit 1     |
|    📦 **Blob CRLF**     | `git commit` + push/PR     | `scripts/check-blob-crlf.sh --ci` (pre-commit + `utf8-check.yml`)              |  <1s  |     ✅ Exit 1     |
| 🧨 **Single-line out=** | `git commit` + push/PR     | `scripts/check-single-line-out-assign.sh --ci` (pre-commit + `utf8-check.yml`) |  <1s  |     ✅ Exit 1     |

**748 arquivos escaneados** (`.ts` + `.tsx`) em cada execução — zero corrupção encontrada.

**CRLF Guard** (`scripts/check-crlf.sh`): complementa o `check-utf8.sh` verificando
se **qualquer `.sh`/`.bash` trackeado** tem CRLF no working tree. Git Bash tolera
CRLF, mas containers Linux (act/CI) quebram com `set: pipefail: invalid option
name` — o guard bloqueia o commit/PR antes que isso chegue ao CI.

**Normalizador** (`scripts/normalize-crlf.sh`): aplica o fix de uma vez em
qualquer novo checkout/worktree — converte `.sh`/`.ts`/`.md` trackeados com CRLF
para LF no working tree e roda `git add --renormalize` (mudanças reais
unstaged são preservadas, nunca stageadas). Uso: `./scripts/normalize-crlf.sh`
(`--check` para falhar se houver CRLF, `--dry-run` para listar sem modificar).

**Blob CRLF Guard** (`scripts/check-blob-crlf.sh`): complementa o guard de
working tree verificando a EOL do **blob commitado** (coluna `i/` de
`git ls-files --eol`). Um `.sh` commitado com CRLF no blob reproduz CRLF em
**todo checkout futuro, em qualquer branch** — mesmo com working tree limpo.
O guard falha (exit 1) se algum blob `.sh`/`.bash` tiver `i/crlf` ou `i/mixed`.
`--fix` roda `git add --renormalize` nos ofensores (revisar `git diff --cached`
e commitar).

**Single-line out= Guard** (`scripts/check-single-line-out-assign.sh`): falha
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

> 📖 Veja [`docs/CACHE_STRATEGY.md`](docs/CACHE_STRATEGY.md) para lições aprendidas sobre:
>
> - **Next.js Vary injection** — App Router prepends seus próprios valores Vary
> - **Windows-1252 byte 0x97** — Como diagnosticar e corrigir encoding corrompido

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

### Bugs conhecidos

| Bug                                         | Sintoma                                                               | Workaround                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| :------------------------------------------ | :-------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **`--dry-run` não existe**                  | `Error: unknown flag: --dry-run`                                      | Usar `-n`. Atenção: `-n` só mostra o plano e **não** executa os `run:` — não pega erros de runtime (ex: CRLF, comandos ausentes).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **`oven-sh/setup-bun@v2` lento**            | Baixa o Bun do GitHub a cada execução (~20–35s), sem cache entre runs | **Confirmado (repro em 2 runs consecutivos do mesmo job):** run #1 = 35.5s, run #2 = 24.2s, ambos com `cache-hit=false` explícito no output do setup-bun → re-download a cada execução, sem cache de layers nem de release. Exit 0 (é lentidão, não falha). Aceitável para validação pontual; exige rede para o GitHub. Mapear a imagem com `-P ubuntu-latest=catthehacker/ubuntu:act-latest`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **CRLF quebra bash no container (Windows)** | `scripts/check-utf8.sh: line 20: set: pipefail: invalid option name`  | **Causa raiz (confirmada):** `core.autocrlf=true` deixa o working tree CRLF (`i/lf w/crlf`) em **todos os 41 `.sh`** — o checkout ocorreu antes de `.gitattributes` declarar `eol=lf`, então o atributo nunca foi aplicado aos arquivos já presentes. O act copia o working tree para o container Linux → bash falha em `set -euo pipefail`. **Fix aplicado:** normalizar os `.sh` para LF no disco (o blob já era LF → **zero diff** no git) + `git add --renormalize` para sincronizar o stat cache do index (sem mudar conteúdo). **Evidência pós-fix no act:** exit 0 — 748 arquivos escaneados, "Status: OK -- all valid UTF-8". Alternativa: `git config core.autocrlf false` + `git add --renormalize`, ou WSL. **Proteção anti-regressão:** `scripts/check-crlf.sh` (working tree) + `scripts/check-blob-crlf.sh` (blob commitado — `i/crlf`/`i/mixed` via `git ls-files --eol`) rodam no pre-commit e no `utf8-check.yml`, falhando se qualquer `.sh` voltar a ter CRLF. **Fix reutilizável:** `scripts/normalize-crlf.sh` aplica a normalização em qualquer checkout/worktree (`.sh`/`.ts`/`.md` → LF + `git add --renormalize`). |
