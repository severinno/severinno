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
  <img src="https://img.shields.io/badge/encoding%20guards-8%2F8%20active%20%E2%9C%85-2ea44f" alt="Encoding guards: 8/8 active">
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
|    🎯 **CRLF Scope**    | `git commit` + push/PR     | `scripts/check-crlf-scope.mjs` (pre-commit + `utf8-check.yml`)                 |  <1s  |     ✅ Exit 1     |
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

**CRLF Scope Guard** (`scripts/check-crlf-scope.mjs`): **trava a decisão de
escopo** dos guards CRLF no código — eles escaneiam **APENAS `*.sh`/`*.bash`**,
nunca `.ts`/`.tsx`. O guard falha (exit 1) se alguém estender os pathspecs do
`git ls-files` dos guards CRLF para qualquer outra extensão (ex.: `'*.ts'`
`'*.tsx'`), ou se o filtro de extensão for removido por completo.

> **Por que o guard de CRLF é `.sh`-only (decisão ESCOPO INTENCIONAL)**
>
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

**Auditoria histórica de blobs `.sh`** (`scripts/audit_blob_crlf_history.py`,
`bun run audit:blob-crlf-history`): varre TODO o histórico alcançável
(`git rev-list --all --objects`) e detecta qualquer blob `.sh`/`.bash` cujo
conteúdo contenha CR (0x0D) — um registro permanente de que nenhum commit
passado reintroduzirá CRLF em checkouts futuros.

> **Estado histórico (auditado em 2026-08):** 61 blobs `.sh` únicos no
> histórico (rev-list --all) — **0 com CRLF**. Ref por ref: `HEAD` 51,
> `main` 41, `v0.3.0-cache-mvp` 26, `v0.4.0` 41, `release/v0.4.0` 41 —
> todos `i/lf`. **Correção retroativa NÃO é necessária**.
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

## Git Hooks — Pre-commit vs Pre-push (simetria)

Os hooks locais (`.husky/`) formam uma cadeia de validação em camadas: o
**pre-commit** roda a stack completa de qualidade em cada commit; o
**pre-push** revalida os fast gates que o CI roda (`utf8-check.yml`) e os
testes da branch (via smart-skip) antes de expor o push ao remoto.

Os **10 fast gates compartilhados** (linhas `✅ | ✅` abaixo) rodam via
`scripts/run-encoding-guards.sh` — a **fonte única** da lista, chamada por
ambos os hooks. Adicionar um guard novo = editar esse script em UM lugar,
sem drift entre pre-commit e pre-push (e espelha o `utf8-check.yml`).

| Validação                                                 | Pre-commit |   Pre-push    |
| :-------------------------------------------------------- | :--------: | :-----------: |
| UTF-8 (`check-utf8.sh --dry-run --ci src/`)               |     ✅     |      ✅       |
| CRLF working tree (`check-crlf.sh --ci`)                  |     ✅     |      ✅       |
| Escopo CRLF (`check-crlf-scope.mjs`)                      |     ✅     |      ✅       |
| CRLF blob commitado (`check-blob-crlf.sh --ci`)           |     ✅     |      ✅       |
| Single-line `out=` (`check-single-line-out-assign.sh`)    |     ✅     |      ✅       |
| Badge encoding guards (`check-encoding-guards-badge.mjs`) |     ✅     |      ✅       |
| Docs repro marker (`check-readme-repro-marker.mjs`)       |     ✅     |      ✅       |
| Setup-bun externo (`check-no-setup-bun.mjs`)              |     ✅     |      ✅       |
| Fonte única Bun (`check-bun-mirror.mjs`)                  |     ✅     |      ✅       |
| Ícones lucide (`scan-lucide-icons.mjs --check`)           |     ✅     |      ✅       |
| Format + lint (lint-staged: prettier + eslint --fix)      |     ✅     |       —       |
| Imports diretos (check:direct-rtl-import + barrel-lint)   |     ✅     |       —       |
| Typecheck (`tsc --noEmit`)                                |     ✅     |       —       |
| Snapshots (quando `.snap`/snapshot tests alterados)       |  ✅ cond.  |       —       |
| Testes unitários + fuzz (`test:unit`/`fuzz:ci`/`fuzz`)    |     —      | ✅ smart-skip |

**Overhead medido:** a seção de guards do pre-push ≈ **6.5s** (dominada por
`check-single-line-out-assign` ~3s); os testes entram apenas quando
arquivos-fonte mudaram (docs/config pulam via smart-skip).

> **Por que o pre-push não repete typecheck/lint-staged?** O pre-commit já os
> rodou em cada commit da branch — reexecutá-los no push seria redundante. O
> pre-push cobre exatamente o gap entre "commitei local" e "o CI vai rodar":
> revalida os guards do `utf8-check.yml` + roda os testes da branch.

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

| Onde                                    | Como lê a versão                                                                 |
| --------------------------------------- | -------------------------------------------------------------------------------- |
| Workflows (`bun-version:` no setup-bun) | `${{ vars.BUN_VERSION }}`                                                        |
| Cache keys `bun-`/`prisma-`             | `bun-${{ vars.BUN_VERSION }}-${{ hashFiles(...) }}`                              |
| Mirror GHCR (`sync-bun-mirror.yml` env) | `BUN_VERSION: ${{ vars.BUN_VERSION }}`                                           |
| Composite action `setup-bun`            | resolve do input `bun-version` (callers resolvem `vars.BUN_VERSION` no workflow) |
| Act local (`.actrc`)                    | `--var BUN_VERSION=<versão>` (espelho local da variável)                         |

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
- o `.actrc` não definir `BUN_VERSION` (o act local quebraria).

> ⚠️ **`.actrc` local**: mantenha `--var BUN_VERSION=<versão>` em sincronia com
> a repository variable do GitHub. O act não lê as variables do repositório —
> o arquivo é o espelho local. Veja `### Act (executa os jobs localmente)`.

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

**Overhead de startup do container (medido, act 0.2.89, job `secrets-guard`
SEM setup-bun — o mesmo job nas duas imagens, `--pull=false`):**

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

```bash
# 1. Auth — OBRIGATÓRIO completar NO ambiente do worktree (device flow)
gh auth login                    # conta com acesso ao repo real
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
#    (feito no fluxo original: commit a271e5c + git push origin --delete <branch>)
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

| Bug                                                   | Sintoma                                                                                                                                                                                                                                | Workaround                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| :---------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`--dry-run` não existe**                            | `Error: unknown flag: --dry-run`                                                                                                                                                                                                       | Usar `-n`. Atenção: `-n` só mostra o plano e **não** executa os `run:` — não pega erros de runtime (ex: CRLF, comandos ausentes).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **`oven-sh/setup-bun@v2` lento**                      | Baixa o Bun do GitHub a cada execução (~20–35s), sem cache entre runs                                                                                                                                                                  | **Confirmado (comportamento do action EXTERNO antigo, medido ANTES da migração):** 2 execuções consecutivas do job `e2e-counts-guard` no act — run #1 = 35.5s, run #2 = 24.2s, ambos com `cache-hit=false` explícito no output do setup-bun → re-download a cada execução, sem cache de layers nem de release. Exit 0 (é lentidão, não falha). (Uma captura posterior na mesma máquina deu 11.66s/13.53s — durações variam por máquina/rede; o invariante é `cache-hit=false` em todas — ver [Evidência empírica](#evidência-empírica-log-real-do-act--bug-do-setup-bun).)<br>**Repro automatizado:** `bun run repro:setup-bun` (scripts/act-repro-setup-bun.sh) — roda o job 2×, extrai a duração do step setup-bun e o cache-hit de cada run, e asserta o comportamento esperado (cache-miss em todas = bug; cache-hit na última = fix). Use num checkout ANTERIOR ao commit de migração para reproduzir o bug. **Hoje o bug não é reproduzível em `main`:** o job usa o composite local `.github/actions/setup-bun` (cache keyed na versão) — ver `scripts/check-bun-mirror.mjs`. Na época era aceitável para validação pontual; exigia rede para o GitHub. |
| **Fast path (tier-1) não dispara no catthehacker**    | No act com a imagem default `catthehacker/ubuntu:act-latest` o tier-1 NUNCA engaja — a imagem não embarca bun — e o act **emula** o actions/cache com espera (~21s medidos: `Restore Bun release from cache [21.22s]`, composite ~33s) | Usar a imagem custom `ghcr.io/<owner>/ubuntu-bun:<versão>` com `-P ubuntu-latest=... --pull=false` para exercitar o tier-1 de verdade. **O ganho real (~1-2s) aparece no CI do GitHub** (tier-2 com cache REAL do GitHub; tier-1 só em runner com bun pré-instalado) — a expectativa de 0-2s no act é incorreta: o composite inclui o overhead do próprio act (~11s warm).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **act 0.2.89 não resolve `vars` em composite action** | `Unknown Variable Access vars` ao parsear o `action.yml` — e `expressions are not allowed here` para o token vazio `${{ }}` em descrição                                                                                               | Resolver a versão **no workflow** e passar via input `bun-version` (o composite lê só inputs); o guard `check-bun-mirror.mjs` exige `bun-version: ${{ vars.BUN_VERSION }}` em todo call site. Workflow-level `${{ vars.BUN_VERSION }}` funciona no act. Ver [Imagem custom](#imagem-custom-com-bun-pré-instalado-tier-1-fast-path).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **Actions locais untracked invisíveis**               | `failed to read 'action.yml'... file does not exist` para actions recém-criadas                                                                                                                                                        | Usar `-b`/`--bind` (monta o working tree real, untracked inclusos) em vez do volume padrão copiado do HEAD.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **CRLF quebra bash no container (Windows)**           | `scripts/check-utf8.sh: line 20: set: pipefail: invalid option name`                                                                                                                                                                   | **Causa raiz (confirmada):** `core.autocrlf=true` deixa o working tree CRLF (`i/lf w/crlf`) em **todos os 41 `.sh`** — o checkout ocorreu antes de `.gitattributes` declarar `eol=lf`, então o atributo nunca foi aplicado aos arquivos já presentes. O act copia o working tree para o container Linux → bash falha em `set -euo pipefail`. **Fix aplicado:** normalizar os `.sh` para LF no disco (o blob já era LF → **zero diff** no git) + `git add --renormalize` para sincronizar o stat cache do index (sem mudar conteúdo). **Evidência pós-fix no act:** exit 0 — 748 arquivos escaneados, "Status: OK -- all valid UTF-8". Alternativa: `git config core.autocrlf false` + `git add --renormalize`, ou WSL. **Proteção anti-regressão:** `scripts/check-crlf.sh` (working tree) + `scripts/check-blob-crlf.sh` (blob commitado — `i/crlf`/`i/mixed` via `git ls-files --eol`) rodam no pre-commit e no `utf8-check.yml`, falhando se qualquer `.sh` voltar a ter CRLF. **Fix reutilizável:** `scripts/normalize-crlf.sh` aplica a normalização em qualquer checkout/worktree (`.sh`/`.ts`/`.md` → LF + `git add --renormalize`).                    |

#### Evidência empírica (log real do act — bug do setup-bun)

Log **real** capturado rodando `scripts/act-repro-setup-bun.sh` contra o estado
PRÉ-migração (`oven-sh/setup-bun@v2` no `pr-check.yml` do commit `867b520`) —
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

Para reproduzir: num checkout anterior ao commit de migração (`fd5381a`), rode
`bun run repro:setup-bun` (`--expect cache-miss`). No `main` atual o job usa o
composite local `.github/actions/setup-bun` e a 2ª run reporta `cache-hit=true`
(fix).
