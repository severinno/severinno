# Changelog

## v0.4.0 (2026-07-28)

### 🚀 Destaques

- **Infraestrutura de Produção** — Caddyfile.prod com SSL/HSTS/CSP, docker-compose.prod.yml com PgBouncer, RabbitMQ, workers, fail2ban, logrotate, Docker secrets
- **Push Notifications** — Web Push criptografado (>4KB), webhooks CRUD + fireEvent, agendamento recorrente + cron, dashboard admin com métricas
- **Segurança** — CSP 10+ diretivas, HSTS, assertRateLimit em 14 rotas financeiras, Docker secrets, E2E security-headers
- **Monitoramento** — /api/health/detailed (10+ serviços), /api/metrics/prometheus, dashboards admin (push, erros, performance, PgBouncer)
- **Gateway de Pagamento** — Dashboard com gráficos de receita, volume de transações e taxa de conversão

### Features

- Infraestrutura: Caddyfile.prod, docker-compose.prod.yml, fail2ban, PgBouncer
- Push: Web Push criptografado, service worker com badge, notificações em tempo real via WebSocket
- Webhooks: CRUD, fireEvent com template vars, templates pré-definidos, auditoria
- Agendamento: push one-shot + recorrente, cron job, fila de retry
- Segurança: assertRateLimit em 14 rotas financeiras, Docker secrets, CSP/HSTS hardening
- Monitoramento: health detailed, métricas Prometheus, dashboards admin visuais
- Gateway: dashboard de pagamento com gráficos e filtro de data inline

### Infraestrutura

- Docker secrets para senhas sensíveis (12 secrets)
- PgBouncer em transaction mode com pool tuning
- RabbitMQ + workers (email, notificação, search-index)
- fail2ban com 3 jails (caddy-access, caddy-badbots, recidive)
- Logrotate para Caddy logs

### Testes

- E2E: security-headers.spec.ts (40+ testes de headers HTTP)
- Unitários: 14+ arquivos com mocks corrigidos (lucide-react, framer-motion)
- Testes de webhook: event-hub, webhooks-event-route
- Testes de gateway: admin-gateway-stats-route, admin-gateway-dashboard

### Fixes

- not-found.test.tsx: mock lucide-react (Search, Home)
- accessibility.test.tsx: mock lucide-react (5 ícones)
- admin-panel.tsx: conflito ClipboardList/List no Turbopack
- .gitignore: .freebuff/, test-results/, .agents/

### Chores

- Bump version to v0.4.0
- TypeScript: 604 files

## v0.3.0-cache-mvp (2026-07-25)

This release marks the **Cache MVP** milestone — a complete HTTP caching
strategy across all public API routes, backed by Redis and validated through
unit + E2E tests.

### Highlights

- **HTTP Cache Strategy** — `cacheControlPublic` and `cacheControlPrivate`
  applied to all 11 GET API routes (10 public + 1 private), with documented `max-age` / `s-maxage`
  values and `Vary` policy (Accept-Encoding, Accept, Origin, Cookie).
- **Redis Cache Layer** — Cache-aside pattern (`withCache`) with configurable TTL
  per route, graceful degradation when Redis is unavailable, and automatic cache
  invalidation on category/service mutations.
- **Cache Manifest** — Single source of truth (`src/lib/cache-manifest.ts`) shared
  between the admin dashboard (`/api/admin/cache-routes`), Vitest ground-truth
  validation, and CI manifest validation.
- **Playwright E2E Cache Tests** — 160 E2E tests across 5 browsers validating
  `Cache-Control` headers for every cached route.
- **Encoding Guards** — 4-layer UTF-8 encoding validation (pre-commit, pre-push,
  CI, PR check) preventing Windows-1252 byte-0x97 corruption common on Brazilian
  Windows setups. Covers .ts, .tsx, .md, .json, .yml files.
- **Reusable CI Workflows** — `utf8-check.yml` refactored into a reusable
  `workflow_call` component used by `ci.yml`, `pr-check.yml`, `e2e-cache.yml`,
  and `deploy.yml`.
- **Release Tooling** — `scripts/release.sh` for automated version bump,
  CHANGELOG generation, and annotated git tag creation.

### Features

- Cache HTTP: `cacheControlPublic` and `cacheControlPrivate` across all 11 GET API routes (10 public + 1 private)
- PostGIS proximity queries with Redis cache (60s TTL)
- Redis cache-aside helper (`withCache`) with automatic hit/miss tracking
- Category tree query with 10min Redis TTL and automatic invalidation on mutation
- Sync service/category search indexes automatically on mutation
- Cache manifest (`src/lib/cache-manifest.ts`) as single source of truth
- Release automation script with semver bump, CHANGELOG prepend, and annotated tags

### Testing

- **106 total tests** (74 unit + 32 E2E)
- Unit tests for cache headers: providers, categories, search, services, geo routes
- Unit tests for `cacheControlPublic`, `cacheControlPrivate`, Vary injection
- Unit tests for `syncServiceSearch`, `syncCategorySearch`
- E2E Playwright tests across 5 browsers (chromium, firefox, webkit, mobile-chrome, mobile-safari)
- Git bisect run validating cache headers on every cached route
- Cache manifest validation script (`scripts/validate-cache-manifest.ts`)

### Infrastructure

- Docker compose with PostGIS, Redis, OSRM routing profiles
- Reusable `utf8-check.yml` workflow (workflow_call) for all CI pipelines
- Release CI/CD pipeline (`release-deploy.yml`) triggered by `v*` tags
- Encoding guards: `.husky/pre-commit`, `.husky/pre-push`, `ci.yml`, `pr-check.yml`
- GitHub Actions badges in README.md

### Fixes

- Fix: missing `invalidateCategoryCache` import in categories API route
- Fix: add `.catch(() => {})` to `syncCategorySearch(created)` in categories route
- Fix: repair 21 pre-existing test failures across 10 test suites
- Fix: release.sh CHANGELOG_FILE definition and consolidated commit flow
### Technical Debt

- 151 TypeScript errors resolved (55 production + 96 test files)
- `.husky/pre-commit` with encoding check + fix-encoding dry-run + lint-staged
- `.husky/pre-push` with encoding check + fix-encoding dry-run
- Windows-1252 → UTF-8 encoding repair across codebase
- Script `scripts/check-utf8.sh` for CI and local encoding verification
- Script `scripts/fix-encoding.sh` for automatic encoding repair (dry-run mode)
