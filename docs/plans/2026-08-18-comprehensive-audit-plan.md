# 🛡️ Plano de Auditoria Completa — Severinno Marketplace

> **Para agentes de código:** Use este plano camada por camada. Cada camada tem uma lista de verificação com itens acionáveis. O resultado de cada camada deve ser documentado em `docs/audit/YYYY-MM-DD-<camada>.md`.

**Objetivo:** Realizar auditoria técnica completa em todas as 12 camadas da plataforma Severinno Marketplace, identificando vulnerabilidades, gargalos de performance, dívida técnica, gaps de cobertura, e oportunidades de melhoria.

**Arquitetura:** Auditoria bottom-up (infra → dados → cache → API → frontend) para que findings de camadas inferiores informem a análise das superiores.

**Stack:** Next.js 16, React 19, TypeScript 5, Prisma 6.19, PostgreSQL 16 + PostGIS 3.4, Redis 7, RabbitMQ 4, Socket.io 4, Docker, GitHub Actions.

---

## 📋 Estrutura de Saída

Cada camada gera um relatório em `docs/audit/` com:

- **Status geral:** 🟢 Saudável | 🟡 Atenção | 🔴 Crítico
- **Itens verificados** (✅/❌/⚠️)
- **Finding detalhado** (se aplicável)
- **Recomendação** com prioridade (P0-P3)
- **Esfroço estimado** (horas)

---

# Camada 12 — Infraestrutura Local (Docker Compose)

> Começar por aqui porque problemas de infra afetam todas as outras camadas.

## 12.1 Docker Compose Base

- [ ] **Verificar versões dos serviços:** PostGIS 16-3.4, Redis 7-alpine, RabbitMQ 4-alpine, MinIO, Node 22-alpine — estão em versões suportadas?
- [ ] **Health checks:** Todos os serviços críticos (postgres, redis, minio, rabbitmq) têm `healthcheck` configurado com `condition: service_healthy` nos depends_on?
- [ ] **Volumes persistentes:** `postgres_data`, `redis_data`, `minio_data`, `rabbitmq_data` estão declarados e mapeados?
- [ ] **Networks:** Services comunicam na rede correta? O realtime service acessa redis via nome de service?
- [ ] **Environment variables:** Todos os `*_URL` usam nomes de service Docker (ex: `redis://redis:6379`, não `localhost`)?

## 12.2 Dockerfile (Multi-stage)

- [ ] **Stage deps:** `bun install --frozen-lockfile` com `--frozen-lockfile`? Build arg `BUN_VERSION` é obrigatório?
- [ ] **Stage builder:** `SKIP_TYPESCRIPT_CHECK=true` e `BUILD_STANDALONE=true` estão setados? `prisma generate` roda antes do `next build`?
- [ ] **Stage runner:** Usuário não-root (`severinno:1001`)? Healthcheck com `curl` configurado? Prisma client + migrations copiados?
- [ ] **Security:** Nenhuma credencial hardcoded? `NODE_ENV=production`? `poweredByHeader: false`?

## 12.3 Workers (Profile Isolado)

- [ ] **email-worker:** Depende de postgres, redis, rabbitmq com `service_healthy`? `WORKER_TYPE=email`? SMTP configs passadas?
- [ ] **notification-worker:** VAPID keys, Evolution API configs, REALTIME_URL configurados?
- [ ] **search-index-worker:** OPENSEARCH_URL, POLL_INTERVAL_MS, BATCH_SIZE configurados?
- [ ] **Dockerfile.worker:** Compartilha build stages do Dockerfile principal? Usa a mesma base?

## 12.4 Geo Cache Warm

- [ ] **One-shot:** `restart: "no"` para não loops? Depende de `app: service_healthy`?
- [ ] **CRON_SECRET:** Passado corretamente para autenticação do endpoint?
- [ ] **Error handling:** Exit code correto (0 para sucesso/cooldown, 1 para falha)?

## 12.5 Redundância & Resiliência

- [ ] **Graceful shutdown:** Docker ENV `PORT=3000`, `HOST=0.0.0.0`? `EXPOSE 3000`?
- [ ] **Restart policy:** `unless-stopped` em todos os services long-running?
- [ ] **Orçamento de memória:** Algum service com limite de memória? Risco de OOM?

---

# Camada 11 — CI/CD (21 Workflows)

## 11.1 Pipeline Principal (`ci.yml`)

- [ ] **Jobs na ordem correta:** lint → typecheck → utf8-check → quality-gate → test → build → deploy?
- [ ] **Concurrency:** `cancel-in-progress: true` para evitar builds obsoletos?
- [ ] **Services:** PostGIS container com healthcheck no job de test?
- [ ] **Node options:** `NODE_OPTIONS: --max-old-space-size=4096` no typecheck?
- [ ] **Coverage badge:** Atualizado automaticamente no push para main?

## 11.2 Quality Gate (`quality-gate.yml`)

- [ ] **Jobs paralelos:** barrel-lint, security-audit, coverage-gaps, cache-manifest, coverage-badge rodando em paralelo?
- [ ] **Exit codes:** Barrel lint com exit code diferenciado (1=violation, 3=warning)?
- [ ] **Security audit:** `bun run security:audit` executando e bloqueando builds?

## 11.3 Deploy (`deploy.yml`)

- [ ] **Artefatos:** Standalone build uploadado com retenção de 3 dias?
- [ ] **Condicional:** Deploy só roda no push para main?
- [ ] **SSH deploy:** Configurado com secrets (não hardcoded)?

## 11.4 Workflows Especializados

- [ ] **e2e-cache.yml:** Cache de Playwright restaurado entre runs?
- [ ] **benchmark-\*.yml:** Benchmarks semanais comparando com baseline?
- [ ] **seed-guards.yml:** Guards de seed protegem contra dados incorretos?
- [ ] **tier1-fastpath-guard.yml:** Guard de performance no caminho crítico?
- [ ] **utf8-check.yml:** Validação de encoding em todos os .ts files?
- [ ] **sync-mirrors.yml:** Mirror do Bun sincronizado?

## 11.5 Actions Customizadas

- [ ] **`.github/actions/setup-bun`:** Versão do Bun via `vars.BUN_VERSION` (fonte única)?

---

# Camada 10 — Qualidade & Testes

## 10.1 Cobertura de Testes

- [ ] **Executar:** `bun run test:run` — todos os testes passam?
- [ ] **Coverage:** `bun run test:coverage` — cobertura por módulo >= 80%?
- [ ] **Gap analysis:** `npx tsx scripts/coverage-gaps.ts --ci` — todas as rotas API têm testes?
- [ ] **Testes admin:** `bun run test:admin` — painel administrativo coberto?

## 10.2 Testes Unitários (Vitest)

- [ ] **Config:** `pool: "forks"`, `singleFork: true`, jsdom environment?
- [ ] **Setup files:** `vitest.act-setup.ts` → `vitest.setup.ts` → `vitest.setup.tsx` na ordem correta?
- [ ] **Mocks:** `__mocks__/server-only.ts` funcionando? Aliases `@/` corretos?
- [ ] **Fuzz testing:** `fast-check` sendo usado em testes de propriedade?
- [ ] **Snapshot tests:** `bun run test:snapshots` — snapshots atualizados?

## 10.3 Testes E2E (Playwright)

- [ ] **Specs críticos:** auth, booking-flow, quote-flow, vitine-search, dashboard passando?
- [ ] **A11y:** `@axe-core/playwright` rodando nos specs de acessibilidade?
- [ ] **Screenshots:** Pasta `e2e/screenshots/` sendo populada?
- [ ] **Masters suite:** `master-e2e-suite.spec.ts` cobrindo fluxos end-to-end?

## 10.4 Mutation Testing

- [ ] **Scripts:** 10+ mutation test suites (`test:mutation-*.sh`) rodando?
- [ ] **Baseline:** Mutation score mantido ou melhorando?

## 10.5 Benchmarks

- [ ] **Geo benchmarks:** `bun run benchmark:geo` — latência de busca geo < 50ms?
- [ ] **Cache benchmarks:** `bun run benchmark:cache` — hit ratio > 80%?
- [ ] **Pipeline benchmarks:** `bun run benchmark:pipeline` — throughput OK?

---

# Camada 9 — Monitoramento & Ops

## 9.1 Health Checks

- [ ] **Endpoint principal:** `GET /api/health` retornando 200?
- [ ] **Health detalhado:** `GET /api/health/detailed` verificando todos os serviços (database, redis, rabbitmq, s3, opensearch)?
- [ ] **Classificação:** Serviços classificados como healthy/degraded/unhealthy?

## 9.2 Health Monitor (Cron)

- [ ] **Endpoint:** `GET /api/cron/health-monitor` autenticado com `CRON_SECRET`?
- [ ] **Thresholds:** Memória (RSS > 400MB warn, > 600MB crit), DB latency (> 2s warn, > 5s crit), cache hit ratio (< 50% warn)?
- [ ] **Debounce:** Alertas com debounce de 3 checks consecutivos?
- [ ] **Sentry:** Eventos sendo enviados para GlitchTip/Sentry?

## 9.3 Alerting Service

- [ ] **Webhooks:** Discord/Slack/Telegram webhook configurado?
- [ ] **Severidades:** INFO, WARNING, CRITICAL, EMERGENCY mapeadas corretamente?
- [ ] **Cobertura:** Outage, latency spike, fraud detection cobertos?

## 9.4 Sentry / GlitchTip

- [ ] **DSN:** `SENTRY_DSN` / `GLITCHTIP_DSN` configurados?
- [ ] **Source maps:** Uploadados para debug de erros?
- [ ] **Release tracking:** `SENTRY_RELEASE` definido?

## 9.5 Logging (Pino)

- [ ] **Levels:** `LOG_LEVEL` configurado (debug em dev, info em prod)?
- [ ] **Redaction:** `password`, `passwordHash`, `req.headers.cookie`, `req.headers.authorization` sendo redactados?
- [ ] **Transport:** `pino-pretty` em dev, JSON raw em prod?

## 9.6 Metrics

- [ ] **Business metrics:** `GET /api/stats` retornando KPIs (usuários, bookings, revenue)?
- [ ] **Geo metrics:** Cache hit ratio, latência de queries, taxa de expansão de raio?
- [ ] **Push analytics:** Delivery rate, click rate, bounce rate?

---

# Camada 8 — Storage (S3/R2 + Fallback Local)

## 8.1 Configuração S3

- [ ] **Client singleton:** `getS3Client()` criando cliente lazy com retry?
- [ ] **Credentials:** `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_ENDPOINT`, `S3_BUCKET` configurados?
- [ ] **R2 vs MinIO:** `forcePathStyle` desabilitado para R2 (virtual-hosted), habilitado para MinIO?
- [ ] **Timeout:** Request timeout de 30s configurado?

## 8.2 Upload

- [ ] **Sanitização:** Filenames sanitizados (`/[^a-zA-Z0-9._-]/g → _`)?
- [ ] **Prefixos:** Uploads em subdiretórios (`uploads/`, `avatars/`, `services/`)?
- [ ] **Content-Type:** Detectado corretamente pelo `guessContentType()`?
- [ ] **ACL:** `public-read` como default?

## 8.3 Download & Signed URLs

- [ ] **Presigner:** `@aws-sdk/s3-request-presigner` instalado e funcional?
- [ ] **TTL:** Signed URLs com expiração configurável (default 3600s)?

## 8.4 Delete

- [ ] **Cleanup:** `deleteFromS3()` sendo chamado quando arquivos são removidos?
- [ ] **Orfãos:** Storage de órfãos (arquivos no S3 sem referência) sendo monitorado?

## 8.5 Fallback

- [ ] **Storage.ts:** Fallback local quando S3 não configurado? `uploadFile()` retornando `null`?
- [ ] **S3.ts:** Erros de upload logados e re-throw com mensagem amigável?

---

# Camada 7 — Auth & Segurança

## 7.1 Session Management

- [ ] **Cookie signing:** HMAC-SHA256 com `SESSION_SECRET` (>= 32 chars)?
- [ ] **Formato:** `${userId}.${role}.${expiresAt}.${signatureHex}`?
- [ ] **Rotation:** Rotação automática quando `remaining < ROTATION_THRESHOLD_SECONDS` (15 dias)?
- [ ] **HttpOnly + Secure:** Cookie com `httpOnly: true`, `secure: true` em prod, `sameSite: "lax"`?

## 7.2 Auth Guards

- [ ] **requireUser():** Verifica sessão + valida se usuário está ativo (com cache Redis 5min)?
- [ ] **requireRole():** Verifica role específica (CLIENT/PROVIDER/ADMIN)?
- [ ] **getOptionalSession():** Retorna null em vez de throw (para páginas públicas)?
- [ ] **Demo accounts:** Contas demo bloqueadas em produção (`isDemoAccountsEnabled()`)?

## 7.3 Password Security

- [ ] **Hashing:** Senhas hasheadas com bcrypt/argon2 (via Prisma)?
- [ ] **Reset tokens:** Tokens com expiração e flag `used`?
- [ ] **Rate limit:** Login: 5/min, Register: 5/min, Forgot password: 3/10min?

## 7.4 API Security

- [ ] **Rate limiting global:** Middleware Edge com sliding window (100 req/min default)?
- [ ] **Rate limiting por rota:** `RATE_LIMITS` configurados para todas as rotas sensíveis?
- [ ] **Geo rate limiting:** Nominatim (30/min), ViaCEP (60/min) com Redis sorted sets?
- [ ] **CORS:** Headers dinâmicos no middleware, origins configuradas?
- [ ] **CSP:** Content Security Policy configurada?
- [ ] **Security headers:** `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`?

## 7.5 Input Validation

- [ ] **Zod schemas:** Todos os inputs validados via `validators.ts`?
- [ ] **parseBody/parseSearchParams:** Usados em todas as rotas API?
- [ ] **SQL injection:** Queries raw usando `$queryRawUnsafe` com parâmetros ($1, $2)?
- [ ] **XSS:** Outputs sanitizados? `dangerouslySetInnerHTML` evitado?

## 7.6 HMAC Auth (Webhooks)

- [ ] **Webhook verification:** Assinatura HMAC verificada em webhooks de pagamento (Lytex)?
- [ ] **Timing-safe:** `timingSafeEqual` usado em comparações?

---

# Camada 6 — Realtime (Socket.io)

## 6.1 Mini-Service

- [ ] **Porta:** Servidor rodando na porta 3003?
- [ ] **CORS:** Origins restritas (localhost + severinno.com.br + subdomínios)?
- [ ] **Redis adapter:** `@socket.io/redis-adapter` com pub/sub para horizontal scaling?
- [ ] **Engine.io:** Criado manualmente (sem `attach`) para compartilhar HTTP com `/health` e `/emit`?

## 6.2 Eventos

- [ ] **join:** Rooms `user:{userId}` e `role:{role}` criados corretamente?
- [ ] **message:send:** Emite `message:new` + `notification:new` para destinatário?
- [ ] **booking:update:** Emite `booking:updated` para client + provider?
- [ ] **quote:update:** Emite `quote:updated` para client + provider?
- [ ] **tracking:position:** Emite `tracking:position` para client?

## 6.3 HTTP Endpoints

- [ ] **GET /health:** Retorna `{"status":"ok"}`?
- [ ] **POST /emit:** Bridge server-side para eventos (autenticado via `CRON_SECRET`)?
- [ ] **Validação:** Body parseado com limite de 1MB?

## 6.4 Graceful Shutdown

- [ ] **SIGTERM/SIGINT:** Handlers configurados com timeout de 5s?
- [ ] **Disconnect:** `io.disconnectSockets(true)` antes de fechar?
- [ ] **Redis:** Clients desconectados após fechar Socket.io?

## 6.5 Client Side

- [ ] **Hook:** `use-realtime.ts` conectando corretamente?
- [ ] **URL:** `NEXT_PUBLIC_REALTIME_URL` ou fallback para `ws://localhost:3003`?
- [ ] **Reconnection:** Auto-reconnect configurado?

---

# Camada 5 — Filas / Mensageria (RabbitMQ)

## 5.1 Connection Management

- [ ] **Singleton:** Conexão reutilizada via `globalThis.__rabbitConn`?
- [ ] **Reconnection:** `connPromise = null` no `error`/`close` para reconexão lazy?
- [ ] **Timeout:** Conexão com timeout adequado?

## 5.2 Exchanges & Queues

- [ ] **Exchange principal:** `severinno.direct` (direct, durable)?
- [ ] **DLX:** `severinno.dlx` configurado para dead-lettering?
- [ ] **DLQ:** `{queue}.dlq` criada para cada consumer?

## 5.3 Publishers

- [ ] **Routing keys:** Corretos para cada tipo de mensagem?
- [ ] **Persistence:** `persistent: true` por default?
- [ ] **Content-Type:** `application/json`?

## 5.4 Consumers

- [ ] **Prefetch:** `prefetch(10)` configurado?
- [ ] **Retry logic:** Max 3 retries com nack + requeue?
- [ ] **Dead letter:** Mensagens após max retries vão para DLQ?
- [ ] **DLQ consumer:** Logando mensagens mortas para revisão manual?

## 5.5 Workers

- [ ] **email-worker:** Consumindo fila `emails` com handler de envio SMTP?
- [ ] **notification-worker:** Consumindo fila `notifications` com dispatch push/WhatsApp/realtime?
- [ ] **search-index-worker:** Polling `search_reindex_queue` com batch processing?

## 5.6 Fallback

- [ ] **RabbitMQ indisponível:** `publish()` logando erro sem crash?
- [ ] **Direct push:** Fallback para push direto quando RabbitMQ cai?

---

# Camada 4 — Cache (Redis 7 / Upstash)

## 4.1 Arquitetura de Tiers

- [ ] **3 tiers:** Cluster → Standalone → In-memory Map?
- [ ] **Degradation automática:** `degradeTier()` chamado em erro de conexão?
- [ ] **Recovery:** Timer de 30s tentando recuperar para tier superior?
- [ ] **Proactive recovery:** Após 5+ degradações, GiST REINDEX + restart de clientes?

## 4.2 Cache Operations

- [ ] **cacheGet:** Tenta Redis → fallback memory → retorna null?
- [ ] **cacheSet:** Escreve em memory + Redis (best-effort)?
- [ ] **cacheInvalidate:** Limpa memory + Redis (cluster-aware SCAN)?
- [ ] **withCache:** Cache-aside helper com hit/miss counters?

## 4.3 Cluster Mode

- [ ] **Config:** `REDIS_CLUSTER_MODE=true` + `REDIS_CLUSTER_NODES`?
- [ ] **SCAN:** `scanKeys()` iterando todos os masters para evitar CROSSSLOT?
- [ ] **Scale reads:** `scaleReads: "master"`?

## 4.4 Rate Limiting

- [ ] **Global:** Middleware Edge com sliding window (Upstash Redis)?
- [ ] **Per-route:** `RATE_LIMITS` com Redis INCR + EXPIRE?
- [ ] **Geo:** Sliding window com Redis sorted sets?
- [ ] **In-memory fallback:** Map com cleanup periódico (60s)?

## 4.5 Observability

- [ ] **Hit ratio:** `getCacheStats()` retornando hits/misses/ratio?
- [ ] **Diagnostics:** `getRedisDiagnostics()` com cluster nodes, slot distribution?
- [ ] **Memory cache:** `getMemoryCacheDiagnostics()` com size e maxAge?

## 4.6 TTLs

- [ ] **User active:** 300s (5min)?
- [ ] **Category descendants:** 600s (10min)?
- [ ] **Geo queries:** Configurados por tipo de query?
- [ ] **Cleanup:** Timer de 60s limpando entries expiradas do memory store?

---

# Camada 3 — Banco de Dados (PostgreSQL 16 + PostGIS)

## 3.1 Schema Prisma

- [ ] **Enums nativos:** Role, BookingStatus, PaymentMethod, PaymentStatus, QuoteStatus, ServiceUnit?
- [ ] **Models:** 25+ models com relações corretas?
- [ ] **Indexes:** Todos os campos frequentemente consultados indexados?
- [ ] **Soft delete:** `deletedAt` em User, Service, Booking?
- [ ] **Geolocation:** `location Unsupported("geography(Point, 4326)")` com triggers SQL?

## 3.2 Migrations

- [ ] **Migrations recentes:** Todas as migrations aplicadas?
- [ ] **Seed:** `prisma/seed.ts` para dev, `prisma/seed-prod.ts` para produção?
- [ ] **Dry run:** `bun prisma/seed-prod.ts --dry-run` funcionando?

## 3.3 PostGIS

- [ ] **Spatial indexes:** GiST indexes em User, Booking, QuoteRequest?
- [ ] **Triggers:** `sync_user_location`, `sync_booking_location`, `sync_quoterequest_location`?
- [ ] **REINDEX:** `REINDEX INDEX CONCURRENTLY` no proactive recovery do Redis?
- [ ] **Haversine:** Cálculo de distância correto nas queries de proximidade?

## 3.4 SQL Builders

- [ ] **sql-builder.ts:** Queries parametrizadas com `$1, $2`?
- [ ] **sql-booking-builder.ts:** Queries de booking otimizadas?
- [ ] **sql-service-builder.ts:** Queries de serviço com join em category?

## 3.5 Performance

- [ ] **Connection pooling:** PgBouncer configurado? (ver `admin-pgbouncer.tsx`)
- [ ] **Query analysis:** Queries lentas identificadas e otimizadas?
- [ ] **N+1 queries:** Evitadas com `include`/`select` adequados no Prisma?

## 3.6 Search

- [ ] **tsvector:** `search_vector` em Category e Service?
- [ ] **Trigram:** Fuzzy search com pg_trgm?
- [ ] **OpenSearch sync:** `search_reindex_queue` populado corretamente?

## 3.7 Data Integrity

- [ ] **Cascade deletes:** Configurados corretamente (User → Booking, Booking → Payment)?
- [ ] **Unique constraints:** Email, slug, bookingId em review?
- [ ] **Notas:** `@@unique` emFavorite(clientId, providerId)?

---

# Camada 2 — API / Backend (124 Rotas)

## 2.1 Arquitetura de Rotas

- [ ] **Organização:** Módulos por domínio (admin, auth, bookings, categories, etc.)?
- [ ] **Padrão:** Todas as rotas usam `apiRoute()` wrapper?
- [ ] **Validação:** Todas as rotas usam `parseBody()` ou `parseSearchParams()`?

## 2.2 Rotas Críticas

- [ ] **Auth:** `/api/auth/login`, `/api/auth/register`, `/api/auth/me`, `/api/auth/logout`?
- [ ] **Bookings:** CRUD completo com status transitions?
- [ ] **Payments:** Criação, webhook, status check?
- [ ] **Providers:** Listagem com geo, detalhe, favoritos?
- [ ] **Quotes:** Criação, resposta, aprovação/rejeição?

## 2.3 Error Handling

- [ ] **handleError:** Mapeia HttpError, AuthError, BookingError, PaymentError, ZodError?
- [ ] **Logging:** Erros 500 logados via Pino?
- [ ] **Sentry:** Erros capturados via `captureError`?

## 2.4 Rate Limiting

- [ ] **Todas as rotas:** Rate limit aplicado (global + per-route)?
- [ ] **Headers:** `X-RateLimit-*` e `Retry-After` em respostas 429?
- [ ] **Exceções:** `/api/health`, `/api/webhooks/*`, `/api/stats/public` bypassando?

## 2.5 Pagination

- [ ] **Cursor-based:** `cursor-pagination.ts` para listagens grandes?
- [ ] **Page-based:** `parsePagination()` para admin?
- [ ] **Limit:** Max 50 itens por página?

## 2.6 Cache HTTP

- [ ] **Cache-Control:** `cacheControlPublic()` para endpoints públicos?
- [ ] **Private:** `cacheControlPrivate()` para dados personalizados?
- [ ] **Vary:** Headers `Vary` configurados (Accept-Encoding, Cookie, Origin)?

## 2.7 Cron Jobs

- [ ] **`/api/cron/*`:** Todos autenticados com `CRON_SECRET`?
- [ ] **Geo cache warm:** Cooldown de 23h?
- [ ] **Health monitor:** Thresholds e debounce configurados?
- [ ] **Push scheduled:** Notificações agendadas sendo processadas?

## 2.8 Webhooks

- [ ] **Lytex:** Verificação HMAC, processamento de pagamento?
- [ ] **Sentry/GlitchTip:** Recebendo eventos de erro?

## 2.9 Domain Errors

- [ ] **BookingError:** 8 códigos de erro com status HTTP correto?
- [ ] **PaymentError:** 9 códigos de erro com status HTTP correto?
- [ ] **AuthError:** UNAUTHORIZED (401), FORBIDDEN (403)?

---

# Camada 1 — Frontend (React 19 + Next.js 16)

## 1.1 App Router

- [ ] **Layout:** `layout.tsx` com Providers, fonts Geist/Geist_Mono?
- [ ] **Loading states:** `loading.tsx`, `loading-shell.tsx`, `loading-global.tsx`?
- [ ] **Error boundaries:** `error.tsx`, `global-error.tsx`?
- [ ] **Not found:** `not-found.tsx` com link para home?

## 1.2 Home Page

- [ ] **SSR streaming:** `page.tsx` usando `Suspense` + `dynamic()`?
- [ ] **AppShell:** Componente principal com view router, auth, panels?
- [ ] **SEO:** Metadata, OpenGraph, Twitter card configurados?

## 1.3 Components

- [ ] **shadcn/ui:** Primitives Radix UI instaladas e configuradas?
- [ ] **Admin:** 40+ componentes do painel administrativo?
- [ ] **Vitrine:** Componentes da home page com search, filtros, cards?
- [ ] **Forms:** React Hook Form + Zod validation em todos os formulários?

## 1.4 State Management

- [ ] **Zustand:** Stores em `src/store/` (auth, geo, compare, view, ui)?
- [ ] **React Query:** `query-client.ts` configurado com staleTime/cacheTime?
- [ ] **XState:** Machines em `src/machines/` para fluxos complexos?

## 1.5 Hooks Customizados

- [ ] **use-realtime.ts:** Conexão Socket.io com auto-reconnect?
- [ ] **use-geo-search.ts:** Busca geo com SWR/cache?
- [ ] **use-checkout.ts:** Fluxo de pagamento?
- [ ] **use-tracking.ts:** Tracking de localização em tempo real?

## 1.6 Performance

- [ ] **Dynamic imports:** Componentes pesados carregados via `next/dynamic`?
- [ ] **Image optimization:** Formatos AVIF/WebP, deviceSizes configurados?
- [ ] **Bundle analyzer:** `ANALYZE=true` disponível?
- [ ] **optimizePackageImports:** lucide-react, recharts, date-fns, framer-motion?

## 1.7 PWA

- [ ] **Manifest:** `/manifest.json` configurado?
- [ ] **Icons:** icon-152, icon-167, icon-180?
- [ ] **Service worker:** Registrado?

## 1.8 Accessibility

- [ ] **A11y tests:** `vitest-axe` + `@axe-core/playwright`?
- [ ] **Keyboard navigation:** Todos os componentes interativos acessíveis?
- [ ] **ARIA labels:** Inputs, buttons, modais com labels?

---

# 🔍 Execução da Auditoria

## Ordem Recomendada

1. **Camada 12** (Infra) → 2h
2. **Camada 11** (CI/CD) → 1h
3. **Camada 10** (Testes) → 2h
4. **Camada 9** (Monitoramento) → 1h
5. **Camada 8** (Storage) → 1h
6. **Camada 7** (Auth/Security) → 2h ⭐ Prioridade máxima
7. **Camada 6** (Realtime) → 1h
8. **Camada 5** (Queues) → 1h
9. **Camada 4** (Cache) → 2h
10. **Camada 3** (Database) → 2h
11. **Camada 2** (API) → 3h ⭐ Prioridade máxima
12. **Camada 1** (Frontend) → 2h

**Total estimado:** ~20h de trabalho

## Comandos para Iniciar

```bash
# Infraestrutura
docker compose config  # Validar compose
docker compose up -d   # Subir stack
curl http://localhost:3000/api/health  # Health check

# Testes
bun run test:run       # Todos os testes
bun run test:coverage  # Cobertura
bun run typecheck      # Type checking
bun run lint           # Linting

# Segurança
bun run security:audit  # Auditoria de dependências
bun run audit:secret-leaks  # Vazamento de secrets
bun run check:secret-leaks-baseline  # Baseline de secrets

# Performance
bun run benchmark:all  # Todos os benchmarks
bun run benchmark:geo  # Geo benchmarks
```

## Formato do Relatório

Para cada camada, criar `docs/audit/YYYY-MM-DD-camada-N.md`:

```markdown
# Auditoria — Camada N: [Nome]

**Data:** YYYY-MM-DD
**Auditor:** [Nome]
**Status Geral:** 🟢/🟡/🔴

## Resumo Executivo

[Resumo de 3-5 linhas]

## Itens Verificados

### 1. [Categoria]

- ✅ [Item OK]
- ⚠️ [Item com atenção] — [Descrição]
- ❌ [Item crítico] — [Descrição + recomendação]

## Findings Detalhados

### F-001: [Título]

- **Severidade:** P0/P1/P2/P3
- **Camada:** N
- **Descrição:** ...
- **Impacto:** ...
- **Recomendação:** ...
- **Esfroço:** Xh

## Recomendações por Prioridade

### P0 (Imediato)

1. ...

### P1 (Próxima sprint)

1. ...

### P2 (Backlog)

1. ...

### P3 (Melhoria contínua)

1. ...
```
