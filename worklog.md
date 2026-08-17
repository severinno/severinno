# Severinno Marketplace SaaS — Worklog (Fase 1 / MVP)

Projeto: Marketplace de serviços com geolocalização (Clientes ↔ Prestadores verificados).
Stack adaptada ao ambiente: Next.js 16 + Prisma (SQLite) + MapLibre + shadcn/ui + WebSocket (mini-service porta 3003).
Arquitetura-alvo (PostGIS/RabbitMQ/OSRM) referenciada na doc arquitetural; MVP entrega funcionalidade equivalente nesta stack.

Convenções:

- Apenas a rota `/` é visível (SPA com view-switching via Zustand).
- Cor primária: emerald (serviços/confiança) — NUNCA indigo/azul.
- APIs em `src/app/api/**` (não server actions).
- z-ai-web-dev-sdk apenas no backend.

## Índice de Task IDs

- [REALTIME-REDIS-ADAPTER](#realtime-redis-adapter) — Escala horizontal do realtime: @socket.io/redis-adapter (rooms/broadcasts entre réplicas via Redis pub/sub, fail-open single-node, estado no /health) + sticky sessions (lb_policy cookie) no Caddyfile.prod + docs do custo de consistência entre réplicas.
- [REALTIME-COPY-GUARD](#realtime-copy-guard) — Guard check-realtime-copy.mjs: valida que o Dockerfile do realtime copia todo módulo importado transitivamente por index.ts (módulo esquecido = imagem quebrada com module not found), com mutation test e registro no pre-commit/CI/GUARDS.md.
- [TELEMETRY-E2E](#telemetry-e2e) — Spec E2E do fluxo completo da telemetria do realtime: admin autenticado chama GET /api/admin/realtime/telemetry com socket real + emit disparado, conferindo emits > 0 na janela e o sinal multi (usersWithMultipleSockets + flag) no Redis.
- [CRLF-NORM](#crlf-norm) — Normalizar o working tree deste checkout — converter os 415 .ts/.tsx com w/crlf para LF. O artefato…
- [2](#2) — Set up WebSocket mini-service (port 3003, path /) with socket.io for realtime messaging/booking/quo…
- [1](#1) — Construir a fundação do Severinno Marketplace SaaS — Prisma schema (SQLite, sem enum nativo), seed…
- [3](#3) — Criar TODAS as rotas de API backend do Severinno Marketplace SaaS (Fase 1 / MVP) sob `src/app/api/*…
- [5](#5) — Construir os Flow Modals do Severinno Marketplace SaaS (Fase 1/MVP): Quote flow, Booking flow, Prov…
- [4](#4) — Build the public storefront (vitrine) with MapLibre map, provider cards, filters, hero, topbar, foo…
- [7](#7) — Construir o PAINEL DO PRESTADOR do Severinno Marketplace SaaS (Fase 1 / MVP): 10 views (dashboard,…
- [6](#6) — Build the Client panel (dashboard, bookings, quotes, services, finance, messages, reviews, favorite…
- [8](#8) — Build the Admin panel (dashboard, taxonomy tree, users, providers, services, bookings, settings).
- [9](#9) — Integrate all surfaces into the single / route (SPA view-switching) + app shell + footer.
- [10](#10) — End-to-end browser verification of all surfaces and flows.
- [F0](#f0) — Fix auth store persistence race condition causing guard to fire on reload after cookie-based login.
- [F1](#f1) — Polish the vitrine (storefront) visual design — topbar, hero, category showcase, how-it-works, prov…
- [F3](#f3) — Refine visual design, layout density, transitions, and form UX of all flow modals (auth, provider p…
- [F2](#f2) — Polish the three dashboard panels (client / provider / admin) and the shared DashboardShell to a pr…
- [Memory System](#memory-system) — Configurar sistema de memória persistente para retomar contexto entre threads.
- [MEDIO-PRAZO-3A](#medio-prazo-3a) — Executar as 3 ações de médio prazo recomendadas no parecer técnico: (1) consolidar o meta-tooling c…
- [SEED-COUNT-LITERALS](#seed-count-literals) — Criar um guard (padrão check-e2e-counts) que varre TODO o repo — scripts/, docs/, .github/ — por li…
- [SINGLE-LINE-CONTRATO](#single-line-contrato) — Conferir se o exemplo '128 checks' nos comentários do check-single-line-out-assign.sh (L11/L15) ref…
- [MUTATION-COORD-UPDATE](#mutation-coord-update) — Mutation test do contrato de atualização COORDENADA dos counts de seed — prova que o seed-e2e-count…
- [MUTATION-COORD-UPDATE-B (direção inversa)](#mutation-coord-update-b-direção-inversa) — Estender o mutation test do contrato coordenado para a DIREÇÃO INVERSA — mutar SÓ a âncora do teste…
- [MUTATION-COORD-2ELOS (guard estático + vitest)](#mutation-coord-2elos-guard-estático--vitest) — Fechar os DOIS elos da cadeia de validação no mesmo mutation test — rodar o guard estático check-e2…
- [MUTATION-COORD-MEASURE (overhead por PR)](#mutation-coord-measure-overhead-por-pr) — Medir o tempo real do job mutation-coord-update (payload) e documentar o overhead por PR na seção d…
- [BARREL-LINT-PRE-LINTSTAGED](#barrel-lint-pre-lintstaged) — Mover o barrel-lint (guard de headers Usage/Exit codes nas 50 primeiras linhas) para ANTES do lint-…
- [COMMIT-6A900E1](#commit-6a900e1) — Commit 6a900e1 — guards de dependências + fix do rate-limit do /api/chat (20 arquivos).
- [CLEANUP-65-ARQUIVOS](#cleanup-65-arquivos) — Pequenos itens técnicos — 65 arquivos mortos removidos (14MB) + achado do middleware raiz.
- [RATE-LIMIT-UPSTASH-FIX](#rate-limit-upstash-fix) — Fix do rate limit Upstash inativo — integrado no src/middleware.ts.
- [DEPLOY-PATH-MIGRATE](#deploy-path-migrate) — Confirmar se produção usa `prisma migrate deploy` (gap era só dev) ou `db push`
- [CRON-REVOKE-INACTIVE](#cron-revoke-inactive) — Webhook/job agendado que revoga sockets realtime de usuários inativos automaticamente.
- [RT-SESSION-LIMIT](#rt-session-limit) — Manter apenas o socket mais recente por usuário no realtime, derrubando os antigos com motivo "sess…
- [RT-TTL-REVOKE](#rt-ttl-revoke) — Disparar session:revoke quando a sessão expira por TTL (não só no logout explícito), garantindo que…
- [RT-TELEMETRY](#rt-telemetry) — Auditoria estruturada no POST /emit (userId, rooms, source) + métricas de sessão ativa por usuário…
- [FETCH-TIMEOUT-HELPER](#fetch-timeout-helper) — Extrair o guard `Math.max(1, Number(env) || default)` + `AbortSignal.timeout()` em um helper compar…
- [FETCH-TIMEOUT-TESTS](#fetch-timeout-tests) — Adicionar testes de 'não trava quando o serviço aceita TCP mas nunca responde' (simulação de hang c…
- [DATA-TIMEOUTS-AUDIT](#data-timeouts-audit) — Auditar os timeouts do client OpenSearch (requestTimeout 10s existe, connectionTimeout não explícit…
- [ADMIN-ONLINE-CARD](#admin-online-card) — Exibir o total de usuários online como card/contador no topo da lista de usuários do painel admin,…
- [ADMIN-ONLINE-PROVIDERS](#admin-online-providers) — Estender o indicador de usuários online e a ação "Revogar sessões" do AdminUsers para o AdminProvid…
- [CRON-REVOKE-INACTIVE-TEST](#cron-revoke-inactive-test) — Adicionar teste unitário do cron revoke-inactive-sessions (GET /api/cron/revoke-inactive-sessions)…
- [ADMIN-REVOKE-AUDIT](#admin-revoke-audit) — Endpoint admin de audit trail dos runs do cron de revogação de sessões inativas + botão "Executar v…
- [CRON-PASSWORD-CHANGE-REVOKE](#cron-password-change-revoke) — Estender o cron revoke-inactive-sessions para também revogar sessões de usuários que trocaram a sen…
- [NPX-RUNNER-DIAG](#npx-runner-diag) — Registrar no worklog o trecho do diagnóstico (npx vs bunx, shim .EXE,
- [REVOKE-ORPHANS](#revoke-orphans) — Botão "Revogar sockets órfãos" no card de usuários online — desconecta sockets do realtime cuja ses…
- [WORKLOG-GUARD](#worklog-guard) — Guard de integridade do worklog.md — cada Task ID com o formato mínimo (Task ID/Agent/Task/Work Log…
- [WORKLOG-TOC](#worklog-toc) — Índice (TOC) no topo do worklog.md listando todos os Task IDs com âncora e linha de resumo, para na…
- [CACHE-PATTERNS-GUARD](#cache-patterns-guard) — Adicionar um guard check-*.mjs que valida a lista CACHE_PATTERNS do seed contra os prefixes reais d…
- [DEV-DB-DRIFT-MIGRATIONS](#dev-db-drift-migrations) — Aplicar as demais migrations custom pendentes ao banco dev (XX_add_postgis GIST indexes, mv_provide…
- [KICK-AUDIT-REDIS](#kick-audit-redis) — Persistir o kick audit do realtime no Redis (realtime:kick-audit, janela deslizante 7d) em vez de Map em…
- [SESSION-CONFLICT-ALERT](#session-conflict-alert) — Badge de conflito de sessão na view de detalhes do provider + alerta global no topo do Admin…
- [SESSION-CONFLICT-E2E](#session-conflict-e2e) — Spec E2E do indicador de conflito: dashboard do mesmo provider em 2 abas → badge âmbar "2 sessões" na UI admin via refresh manual + motivo do último kick (session_limit) no tooltip.
- [REALTIME-PORT-ENV](#realtime-port-env) — Parametrizar o PORT do realtime via env (REALTIME_PORT com fallback 3003): o compose já repassava PORT: ${REALTIME_PORT:-3003}, mas o index.ts tinha const PORT = 3003 hardcoded (parametrizacao morta). parseRealtimePort no security.ts + derivacao nos clientes (realtime-client/env/use-realtime/rotas admin/health) + e2e realtimePort() + composes/.env.example/README.
- [SESSION-LIMITS-ADMIN](#session-limits-admin) — Refletir o limite de sessoes POR ROLE no painel admin: kick audit com max (mesmo valor do payload session:limit) no tooltip do OnlineSessionsCell + card de status SessionLimitsCard no dashboard com a config atual (default + perRole do GET /sessions).
- [REALTIME-ROLE-LIMIT-E2E](#realtime-role-limit-e2e) — Spec E2E novo que valida o limite por role do realtime de ponta a ponta: PROVIDER=2 mantem 2 de 3 abas (3a derruba a mais antiga) e CLIENT segue limite 1 (2a aba derruba a 1a) — provider E client isolados registrados via API (emails unicos por run).
- [SESSION-LIMIT-CLIENT-MAX](#session-limit-client-max) — Cobrir o payload max do session:limit no client: onSessionLimited captura o limite POR ROLE aplicado e expoe lastSessionLimit no hook; RealtimeProvider mostra toast 'Sua sessao foi encerrada em outro dispositivo' com 'Limite de N sessoes simultaneas por perfil'; 5 testes unitarios do hook (guards de degradacao).
- [SESSION-LIMIT-BY-PLAN](#session-limit-by-plan) — Limite de sessoes POR PLANO/TENANT com fallback ao per-role: User.plan (default FREE) + migration + REALTIME_MAX_SESSIONS_PER_PLAN; realtime le o plano no join (user-plan.ts fail-open) e resolve plano > role > default; admin reflete perPlan; E2E PREMIUM=5 vs FREE per-role 2; fix port.ts (env.ts parava de puxar node:crypto pro Edge).
- [REALTIME-RENEW-SMOKE](#realtime-renew-smoke) — Smoke E2E do session:renew (rotacao de cookie): forja cookie com TTL curto (15s), o app REEMITE via GET /api/auth/me (getSession reissue em <15d) e propaga session:renew ao realtime; o socket renovado SOBREVIVE ao TTL sweep enquanto o controle (sem renew) cai com session_expired — diferencial de dois providers isolados registrados via API.
- [RT-HEALTH-RENEWS](#rt-health-renews) — Estender a telemetria do /health do realtime: contadores de session:renew APLICADOS por minuto (janela deslizante 1h em memoria, buckets UTC) + socketsWithExtendedExpiry (flag renewed setada pelo renewSessionSockets EXTEND-ONLY) — ops monitora se a propagacao da rotacao de cookie esta fluindo; testes unitarios do flag + countRenewedSockets.
- [RT-RENEW-DEDUPE-MULTI](#rt-renew-dedupe-multi) — Investigar o caso multi-replica do dedupe de renew (chave Redis realtime:renewed:{userId} TTL 1h): happy path seguro (renew idempotente EXTEND-ONLY, primeira replica entrega e as demais pulam), MAS bug de ordering — chave reivindicada ANTES do emit com emitRealtime engolindo falhas silenciava TODAS as replicas por 1h apos um emit falho. Fix: emitRealtime retorna res.ok (boolean) e a chave so e reivindicada apos entrega CONFIRMADA + rollback do Map in-process em falha (renew E revoke-expired); realtime sem adapter Redis documentado (cada replica ve so os proprios sockets).
- [SSR-SESSION-EXPIRY](#ssr-session-expiry) — Expor o expiresAt da sessao via SSR (server components): helper getSessionExpiresAt le o cookie SEM reemitir (RSC nao pode cookies().set()) e espelha a rotacao <15d aritmeticamente; dashboard/page.tsx vira async e passa initialSessionExpiresAt ao client, que semeia o auth store via seedSessionExpiry (so se null) — o countdown do banner/pill renderiza no primeiro paint sem flash antes do fetchMe resolver.
- [SESSION-EXPIRY-E2E](#session-expiry-e2e) — Spec E2E do fluxo de expiração de sessão no browser: provider isolado registrado via API → login real → GET /api/auth/me devolve expiresAt (~30d sessão fresca) → pill do countdown visível no dropdown (data-testid=session-expiry-info) → e cenário do Renovar com cookie FORJADO de 2 dias (<15d, mesmo HMAC do app): o /api/auth/me (mesmo request do renewSession) reemite o cookie (Set-Cookie novo + expiresAt ~30d).
- [PILL-RENEW-8-15D](#pill-renew-8-15d) — Fechar a janela 8–15 dias: botão "Renovar" na pill SessionExpiryInfo quando days ≤ SESSION_EXPIRY_RENEW_DAYS (15) — o servidor JÁ reemite o cookie em qualquer request <15d, mas a ação explícita dá controle ao usuário antes da rotação proativa; acima de 15d a pill não oferece o botão (renovar seria no-op). Unit tests da janela (12d mostra, boundary 15/16, >15 esconde, click chama renewSession NUNCA fetchMe) + assert negativo no E2E (sessão fresca >15d sem botão).
- [TTL-SWEEP-RENEW-E2E](#ttl-sweep-renew-e2e) — Segundo cenário no realtime-ttl-sweep.spec.ts provando o gap da rotação deslizante (renovação) ponta-a-ponta: par renovado/controle com cookies forjados de TTL 15s — o renovado recebe session:renew via POST /emit (Bearer, mesmo bridge do app) ANTES do expiry e SOBREVIVE ao sweep (EXTEND-ONLY do renewSessionSockets, hoje só unit test), enquanto o controle (sem renew) cai com session_expired provando o sweep ativo. Gate via recentEmits do /health/detailed + cross-check /sessions. Providers isolados registrados via API.
- [MAKE-E2E-TTL](#make-e2e-ttl) — Target no Makefile (make e2e-ttl) que sobe o realtime dev com REALTIME_TTL_SWEEP_MS=2000 numa porta DEDICADA (3199, não toca o realtime da 3003) via scripts/test-e2e-ttl-sweep.sh e roda a suíte realtime-ttl-sweep em ~40s (piso do TTL forjado de 15s do spec) em vez de ~1.5min com o sweep de 60s; documenta o comando exato de boot com o env (SESSION_SECRET + REALTIME_EMIT_TOKEN exportados do .env.local, fail-closed) no header do script + Makefile + docs/TESTING.md.
- [TTL-SWEEP-TELEMETRY](#ttl-sweep-telemetry) — Métrica no /health do realtime: contagem de sockets encerrados por session_expired na janela de 1h (perMinute + lastHourTotal + maxPerMinute) e flag de SPIKE (> REALTIME_EXPIRED_SPIKE_THRESHOLD/min) — sinal de ataque de sessões stale ou bug de rotatividade (session:renew não propagando → expirações em massa). Helpers puros no security.ts (minuteWindowKey/bumpMinuteWindow compartilhados com o renew — janela única de 1h; parseExpiredSpikeThreshold; computeExpiredSweepMetrics), bump no TTL sweep + revoke-orphans, exposição agregada (sem userIds — /health é sem auth) no snapshot; assert E2E no realtime-ttl-sweep (cenário 1).
- [COOKIE-TTL-PER-ROLE](#cookie-ttl-per-role) — TTL do cookie de sessão POR ROLE no app: env estruturada SESSION_COOKIE_MAX_AGE_PER_ROLE (JSON de segundos, ex.: CLIENT 15d / PROVIDER 30d / ADMIN 7d) com fallback ao global SESSION_COOKIE_MAX_AGE_SECONDS. Helpers puros parseCookieMaxAgePerRole + resolveCookieMaxAgeForRole (clamp >= 60, UPPERCASE, entradas inválidas descartadas); createSession assina o expiresAt com o TTL da role; rotação deslizante por role (threshold = metade do TTL EFETIVO da role — CLIENT 15d roda a 7.5d) no getSession + espelho SSR no getSessionExpiresAt. O realtime NÃO muda: o sweep respeita o expiresAt embutido no cookie de cada socket. Docs (README/.env.example/composes) + testes unitários (parse/resolve puros + integração com vi.resetModules).
- [ADMIN-REALTIME-TELEMETRY](#admin-realtime-telemetry) — Fechamento do loop do dashboard: nova view admin.realtime-telemetry (admin-realtime-telemetry.tsx) que renderiza o gráfico de emits por evento (Recharts bar chart horizontal) e o sinal de sockets órfãos (area chart do multi[] → usersWithMultipleSockets por bucket) lendo GET /api/admin/realtime/telemetry com poll de 15s, seletor de janela (30min/1h/6h/24h → ?minutes), cards de resumo (emits totais, órfãos agora, multi-socket, máx/usuário), badge/banner de ALERTA quando a flag está ativa, top-5 de eventos como fallback acessível e degradação graciosa (ok:false → EmptyState). Registrada no admin-panel (NAV_ITEMS + VIEW_META + switch + ícone RadioTower) e coberta por admin-realtime-telemetry.test.tsx (estados, dados, flag on/off, janela, refresh, axe).
- [ORPHAN-ALERT-JOB](#orphan-alert-job) — Job de alerta operacional (GET /api/cron/realtime-orphan-alert, Bearer CRON_SECRET, a cada ~5min) que lê a flag realtime:telemetry:multi:flag + os N buckets de minuto do realtime e notifica (GlitchTip/Sentry + email ADMIN_EMAIL) quando sockets órfãos PERSISTIREM por N minutos seguidos — evita falso-positivo de pico transitório. Cooldown Redis (ORPHAN_ALERT_COOLDOWN_MS, marcado SÓ em alertas reais) + dry-run ?dryRun=1 no padrão do revoke-inactive-sessions; fail-open em Redis fora/leitura/notificação (nunca 500). Engine src/lib/realtime-orphan-alert.ts + rota + 18 testes unitários (persistência pura, env guards, rota com fake timers p/ determinismo).
- [MULTI-BUCKET-MAX](#multi-bucket-max) — Fechar o tradeoff do bucket multi quando REALTIME_TELEMETRY_INTERVAL_MS < 60s: com vários persists no MESMO bucket de minuto, o último write sobrescrevia o pico intra-minuto de usersWithMultipleSockets (a timeline do dashboard perdia o sintoma). Fix: GET+compare+SET no persist — helper puro shouldPersistMultiSnapshot (ausente/corrompido → escreve; novo > existente → escreve; igual/menor → mantém o pico) + get do bucket no pipeline antes do setex condicional; teste de pico 0→3→1 com fake stateful prova o bucket final = 3 com só 2 writes.

---

Task ID: CRLF-NORM
<a id="crlf-norm"></a>
Agent: orchestrator (normalização de checkout)
Task: Normalizar o working tree deste checkout — converter os 415 .ts/.tsx com w/crlf para LF. O artefato de checkout (w/crlf) some sem tocar no histórico (blobs i/lf intocados).

Work Log:

- Diagnóstico: `git ls-files --eol '*.ts' '*.tsx'` → 415 arquivos `w/crlf`, 406 `w/lf`; TODOS os blobs `i/lf` (checkout Windows pré-.gitattributes — o atributo `*.ts text eol=lf` já garantia LF no blob/commit).
- Rodou `NORMALIZE_CRLF_EXTS=".ts .tsx" ./scripts/normalize-crlf.sh --dry-run` → confirmou exatamente 415 arquivos.
- Rodou o fix real (mesma var de escopo): converteu os 415 w/crlf → LF no disco e executou `git add --renormalize` nos 415 (só EOL-only vira renormalize — conteúdo real preservado unstaged).
- Pós-fix: `git ls-files --eol '*.ts' '*.tsx'` → 821/821 `w/lf` (zero w/crlf); `NORMALIZE_CRLF_EXTS=".ts .tsx" ./scripts/normalize-crlf.sh --check` → exit 0.
- Prova de que o histórico NÃO foi tocado: `git diff --quiet -- src/app/layout.tsx` e `src/lib/geo.ts` → limpos (zero diff — blob LF + working tree LF = nada a comparar).
- Únicas mudanças .ts/.tsx no status: as EDIÇÕES REAIS desta thread — 2 modificados (check-blob-crlf.test.ts +57, check-crlf.test.ts +68 — testes de CRLF/escopo adicionados) e 2 novos (check-crlf-scope.test.ts, check-readme-repro-marker.test.ts) — todos preservados unstaged pelo renormalize.
- Escopo: .ts/.tsx apenas (conforme pedido). Os .md (README.md, docs/*.md, worklog.md) seguem w/crlf no disco (blobs i/lf) — deliberadamente não tocados aqui; o mesmo vale para qualquer artefato de checkout não-escopado (a normalização completa de um checkout usa o default `.sh .ts .md` de `normalize-crlf.sh`).

Stage Summary:

- **Antes**: 415 .ts/.tsx `w/crlf` (todos `i/lf`). **Depois**: 821/821 `w/lf` — zero CRLF no working tree de .ts/.tsx.
- **Histórico intocado**: nenhum blob alterado; `git status` .ts/.tsx mostra só as edições reais da thread (2 M + 2 untracked novos).
- **Guard**: `normalize-crlf.sh --check` (escopo .ts/.tsx) → exit 0.

---

Task ID: 2
<a id="2"></a>
Agent: general-purpose (websocket mini-service)
Task: Set up WebSocket mini-service (port 3003, path /) with socket.io for realtime messaging/booking/quote/tracking events; provide singleton React client hook; start service in background and verify.

Work Log:

- Read worklog.md and examples/websocket/server.ts + examples/websocket/frontend.tsx to lock the exact Caddy-friendly pattern (path "/", XTransformPort query param).
- Created `/home/z/my-project/mini-services/realtime/` as an independent bun project.
- Wrote `package.json` (deps: socket.io; scripts: dev=`bun --hot index.ts`).
- Wrote `index.ts` (socket.io server, port 3003, path "/", cors *) implementing events:
  - `join { userId, role }` -> joins rooms `user:{userId}` + `role:{role}`, ack `{ ok: true }`
  - `message:send { fromId, toId, content, bookingId? }` -> emits `message:new` (id+timestamp) + `notification:new` to `user:{toId}`
  - `booking:update { bookingId, clientId, providerId, status }` -> emits `booking:updated` to both `user:{clientId}` and `user:{providerId}`
  - `quote:update { quoteId, clientId, providerId, status }` -> emits `quote:updated` to both rooms
  - `tracking:position { bookingId, clientId, lat, lng }` -> emits `tracking:position` to `user:{clientId}`
  - `ping` -> ack `{ pong: true, t: Date.now() }`
  - `disconnect` -> logs reason
  - connection logs socket id; SIGTERM/SIGINT graceful shutdown (io.close + httpServer.close + safety timeout).
- Ran `bun install` in the mini-service folder (installed socket.io@4.8.3 + lockfile).
- Started service in background: `nohup bun run dev > service.log 2>&1 &`. Verified log shows `WebSocket server running on port 3003`. HTTP poll on `/?EIO=4&transport=polling` returned 200.
- Installed `socket.io-client` in the main project (`bun add socket.io-client`).
- Created `/home/z/my-project/src/hooks/use-realtime.ts` — singleton client hook:
  - Uses `io("/?XTransformPort=3003")` with path "/" (default), transports websocket+polling, reconnection enabled.
  - SSR guard (`typeof window === 'undefined'`), singleton via module-level `socketRef`.
  - Returns `{ socket, isConnected, status, join, sendMessage, updateBooking, updateQuote, sendTrackingPosition, ping, emit, on, off, disconnect }`.
  - `join` and `ping` use acknowledgements. `on` returns an unsubscribe fn.
- Typecheck (`tsc --noEmit -p tsconfig.json`): no errors from our new files (pre-existing errors in examples/ and skills/ are unrelated to this task).
- Ran integration smoke test (two clients join, sender emits message:send/booking:update/ping): PASS — receiver got `message:new`, `notification:new`, and `booking:updated` correctly.
- Did NOT touch src/app/page.tsx, src/app/layout.tsx, Prisma, or other agents' files.

Stage Summary:

- Files created:
  - `/home/z/my-project/mini-services/realtime/package.json`
  - `/home/z/my-project/mini-services/realtime/index.ts`
  - `/home/z/my-project/mini-services/realtime/service.log` (runtime log)
  - `/home/z/my-project/src/hooks/use-realtime.ts`
- How to run:
  - Service: `cd mini-services/realtime && bun run dev` (already running in background, port 3003, path "/")
  - Frontend: import `useRealtime` from `@/hooks/use-realtime`; call `useRealtime()` and use `join({ userId, role })` on connect.
- Port: 3003 (hard). Path: "/" (hard, required by Caddy). Frontend connects via `io("/?XTransformPort=3003")`.
- Events supported (client->server): `join`, `message:send`, `booking:update`, `quote:update`, `tracking:position`, `ping`.
- Events emitted (server->client): `message:new`, `notification:new`, `booking:updated`, `quote:updated`, `tracking:position`.
- Status: RUNNING (verified by HTTP 200 on polling endpoint + integration smoke test PASS).

---

Task ID: 1
<a id="1"></a>
Agent: full-stack-developer (foundation)
Task: Construir a fundação do Severinno Marketplace SaaS — Prisma schema (SQLite, sem enum nativo), seed com 1 admin + 2 clients + 6 providers + categorias 3-níveis + services + bookings/reviews, design system emerald, Zustand stores (auth/geo/view/ui) e lib utilities (crypto scrypt, auth HMAC cookie, geo ViaCEP/Nominatim/haversine, format pt-BR, constants, validators Zod 4).

Work Log:

- Leu worklog.md, package.json, schema.prisma atual, layout.tsx, globals.css, db.ts, tsconfig.json, eslint.config.mjs, dev.log e page.tsx (não modificado).
- Criou `prisma/schema.prisma` com 13 modelos marketplace (User, Category, Service, ProviderAvailability, QuoteRequest, QuoteItem, Booking, Review, Favorite, Message, Notification, Payment, Setting), todos enums como String + comentário, indexes nas colunas de busca.
- Rodou `bunx prisma db push --accept-data-loss` → ok; `bun run db:generate` → ok (Prisma 6.19.2).
- Criou `src/lib/crypto.ts` (scrypt N=16384, salt 16B, timing-safe verify).
- Criou `src/lib/auth.ts` (server-only, cookie httpOnly `severinno_session` com HMAC-SHA256, getSession/requireUser/requireRole/getOptionalSession/destroySession).
- Criou `src/lib/geo.ts` (server-only, haversineKm, formatDistance, geocodeCEP ViaCEP, reverseGeocode Nominatim com User-Agent, formatCurrencyBRL).
- Criou `src/lib/format.ts` (formatBRL/Date/DateTime/Time/Relative + formatHHmm, date-fns locale ptBR).
- Criou `src/lib/constants.ts` (labels/cores pt-BR de roles, units, quote/booking/payment statuses, weekdays, notification types, APP_NAME).
- Criou `src/lib/validators.ts` (Zod 4: login, register com refine, providerProfile, service, category, quote, quoteItemResponse, booking, review, message, setting, availability).
- Criou `prisma/seed.ts` idempotente (wipes na ordem de FKs) + script `db:seed` em package.json. Rodou com sucesso: 9 users, 27 categorias, 13 services, 36 availabilities, 4 bookings+reviews+payments, 2 favorites, 9 notifications, 9 settings.
- Atualizou `src/app/globals.css`: primary emerald `oklch(0.55 0.15 160)` (light) / `oklch(0.7 0.16 160)` (dark), ring/sidebar-primary/accent/chart-1 alinhados, scrollbar thin/rounded com hover emerald, estilos `.map-popup`.
- Atualizou `src/app/layout.tsx`: metadata pt-BR (title "Severinno Marketplace", locale pt_BR, keywords), `<html lang="pt-BR" suppressHydrationWarning>`, wrap children em `<Providers>`.
- Criou `src/components/providers.tsx` combinando next-themes + @tanstack/react-query + sonner Toaster.
- Criou 4 Zustand stores em `src/store/`: auth (persist), geo (persist), view (persist só view+params), ui (não persiste). Centralizou exports em `src/store/index.ts`.
- Rodou `bunx tsc --noEmit` — meus arquivos limpos.
- Rodou `bunx eslint` nos meus arquivos — zero erros. Único erro de lint restante no projeto está em `src/hooks/use-realtime.ts` (não meu, regra `react-hooks/refs`).

Stage Summary:

- **Schema**: `prisma/schema.prisma` — 13 modelos, SQLite-safe (sem enum), indexes em campos de busca. Pushed + Prisma Client gerado.
- **Seed**: `bun run db:seed` (idempotente). Logins: admin@severinno.com/admin123, cliente@severinno.com/cliente123, maria@severinno.com/cliente123, [provider]@severinno.com/provider123.
- **Design system**: `src/app/globals.css` — primary emerald, scrollbar custom, `.map-popup` MapLibre.
- **Layout**: `src/app/layout.tsx` + `src/components/providers.tsx` — ThemeProvider + QueryClientProvider + SonnerToaster, metadata pt-BR.
- **Libs**: `src/lib/{crypto,auth,geo,format,constants,validators}.ts` — prontos para uso por APIs e UI.
- **Stores**: `src/store/{auth,geo,view,ui,index}.ts` — prontos para uso por UI. auth/geo/view persistem em localStorage (`severinno:*`).
- **Agent record**: `/home/z/my-project/agent-ctx/1-foundation.md` — detalhes completos, incluindo 10 caveats para próximos agentes (SQLite sem enum, geo.ts é server-only, SESSION_SECRET em prod, Nominatim User-Agent/limite 1 req/s, etc).
- **Caveats**: (a) `src/lib/geo.ts` importa `server-only` — não usar em client components. (b) `src/hooks/use-realtime.ts` tem erro lint `react-hooks/refs` (fora do escopo Task 1). (c) `src/app/page.tsx` intencionalmente não modificado. (d) zod 4 API: `z.enum([...], { message })` em vez de `errorMap`.

---

Task ID: 3
<a id="3"></a>
Agent: full-stack-developer (api routes)
Task: Criar TODAS as rotas de API backend do Severinno Marketplace SaaS (Fase 1 / MVP) sob `src/app/api/**` usando Next.js 16 App Router route handlers + Prisma (SQLite) + Zod, alinhadas ao contrato esperado pela UI (foundation `src/lib/api.ts`).

Work Log:

- Leu worklog.md, agent-ctx/1-foundation.md, prisma/schema.prisma, src/lib/{auth,crypto,geo,constants,validators,db}.ts e os componentes UI que consomem a API (vitrine/, modals/) para inferir o contrato de resposta esperado por `apiGet<T>`.
- Descobriu que `src/lib/api.ts` é o **wrapper tipado client-side** da foundation (apiGet/apiPost/apiPatch/apiDelete + tipos ProviderCard/ProviderDetail/ProviderService/Category/PagedResult/FavoriteResponse/CepResult) — NÃO deve ser tocado.
- Criou `src/lib/api-server.ts` (novo) com helpers server-only: HttpError, handleError (mapeia UNAUTHORIZED→401, FORBIDDEN→403, ZodError→400, HttpError→status), badRequest/unauthorized/forbidden/notFound/conflict, parsePagination, USER_PUBLIC_SELECT, publicUser, getCategoryDescendants (BFS sobre a árvore de categorias).
- Criou 29 route handlers em `src/app/api/` cobrindo: auth (register/login/logout/me), categories (GET público + POST/PATCH/DELETE admin), providers (list com filtros geo/categoria/radius/sort + detail + favorite toggle), services (list/create/patch/delete com regra "preço só sobe"), geo (cep ViaCEP + reverse Nominatim), quotes (create com items + list por role + detail + patch status + item response), bookings (create + list + detail + patch com transition table + pay simulado), reviews (create com validação "uma por booking COMPLETED" + list), messages (conversas + thread com auto-mark-read + send com notificação), notifications (list unread-first + mark read), favorites (list flat), admin (stats agregadas + users paginado + user patch/delete + settings upsert many), upload (multipart → sharp → webp 1200px q80 em public/uploads).
- Alinhou os shapes de resposta ao contrato da UI: categorias/services/favorites retornam arrays flat; providers retorna `{items,total,page,limit}`; provider detail retorna `ProviderDetail` direto com `reviews[].author` (alias para `client`); geo/cep e geo/reverse retornam objetos flat (sem wrapper `address`).
- Tratou erros: `passwordHash` sempre stripado; auth errors via throw "UNAUTHORIZED"/"FORBIDDEN" mapeados por handleError; Zod errors com details; HttpError com status custom; upload com fallback 400 para FormData não-multipart e sharp em imagem corrompida.
- Validou transições de status de booking (PROVIDER: PENDING→CONFIRMED/IN_PROGRESS/CANCELLED; CLIENT: PENDING/CONFIRMED→CANCELLED, CONFIRMED/IN_PROGRESS→COMPLETED). CONFIRM seta paymentStatus=PAID (simulado); CANCEL em booking PAID seta REFUNDED e sincroniza Payment.
- Quote items: validou serviceId pertence ao providerId; status PENDING→RESPONDED automático quando provider responde um item; expiresAt default now+7d.
- Executou `bunx tsc --noEmit` — 0 erros em src/app/api/** e src/lib/api-server.ts (erros remanescentes em src/components/modals/{auth,quote}-modal.tsx e src/components/vitrine/providers-map.tsx são do escopo UI).
- Executou `bunx eslint src/app/api src/lib/api-server.ts` — 0 erros. `bun run lint` só acusa o pré-existente `react-hooks/refs` em src/hooks/use-realtime.ts (Task 2, fora de escopo).
- Smoke tests via curl no dev server (porta 3000) — todos os fluxos críticos OK: categories flat array, providers com filtros/sort/distância/category tree, provider detail com reviews[].author, favorite toggle, auth login+me com cookie, favorites 401→200 com auth, geo/cep flat, quote create+list, booking list, review duplicate guard, message send+notification, notifications list+unreadCount, admin stats+users, upload (401/400/400/201 webp).
- NÃO tocou em src/app/page.tsx, src/app/layout.tsx, src/components/**, src/store/**, src/hooks/**, ou qualquer lib da foundation (src/lib/auth/crypto/geo/constants/validators/db/format.ts e o client-side src/lib/api.ts).

Stage Summary:

- **Arquivos criados**:
  - `src/lib/api-server.ts` — helpers server-only (HttpError, handleError, badRequest/unauthorized/forbidden/notFound/conflict, parsePagination, USER_PUBLIC_SELECT, publicUser, getCategoryDescendants).
  - `src/app/api/auth/{register,login,logout,me}/route.ts` — auth completo (POST register/login/logout, GET me).
  - `src/app/api/categories/route.ts` + `[id]/route.ts` — GET público (array flat), POST/PATCH/DELETE admin (DELETE bloqueia se tem filhas ou serviços → 409).
  - `src/app/api/providers/route.ts` — catálogo público com filtros (q, categoryId subtree, radius haversine), sort (rating|distance), paginação, agregados (rating/reviewCount/favoriteCount/distanceKm).
  - `src/app/api/providers/[id]/route.ts` — detail com services, availability, reviews (author), favorited flag.
  - `src/app/api/providers/[id]/favorite/route.ts` — toggle (CLIENT).
  - `src/app/api/services/route.ts` + `[id]/route.ts` — list (array flat), create (PROVIDER/ADMIN), patch (preço só sobe), delete.
  - `src/app/api/geo/{cep,reverse}/route.ts` — ViaCEP + Nominatim (resposta flat).
  - `src/app/api/quotes/route.ts` + `[id]/route.ts` + `[id]/items/[itemId]/route.ts` — create com items, list por role, detail, patch status, item response (PENDING→RESPONDED).
  - `src/app/api/bookings/route.ts` + `[id]/route.ts` + `[id]/pay/route.ts` — create + payment PENDING, list por role, detail, patch com transition table + side effects (CONFIRM→PAID, CANCEL→REFUNDED), pay simulado.
  - `src/app/api/reviews/route.ts` — create (uma por booking COMPLETED do cliente), list por provider/booking.
  - `src/app/api/messages/route.ts` — conversas (last msg + unread per peer) ou thread (auto mark-read), send com notificação MESSAGE.
  - `src/app/api/notifications/route.ts` + `[id]/read/route.ts` — list unread-first com unreadCount, mark read.
  - `src/app/api/favorites/route.ts` — list flat de ProviderCard com distanceKm opcional.
  - `src/app/api/admin/{stats,users,users/[id],settings}/route.ts` — stats agregadas, users paginado, user patch/delete, settings upsert many.
  - `src/app/api/upload/route.ts` — multipart → sharp → webp 1200px q80 em public/uploads/<uuid>.webp.
- **Decisões chave**:
  - Helpers server-only em arquivo novo (`api-server.ts`) para não tocar o wrapper client-side `api.ts` da foundation.
  - Shapes de resposta alinhados 1:1 ao que `apiGet<T>` (UI) espera — flat arrays p/ categorias/services/favorites, wrapped `{items,total,page,limit}` p/ providers/bookings/quotes/admin, flat object p/ provider detail e geo.
  - Reviews em provider detail renomeadas `client`→`author` (UI usa `r.author.name`).
  - Booking status transitions hard-coded em PROVIDER_NEXT/CLIENT_NEXT (admin pode tudo).
  - Payment simulado: `/api/bookings/[id]/pay` e CONFIRM ambos setam PAID; CANCEL em PAID seta REFUNDED.
  - Quote items: outer providerId usado para todos os items (per-item providerId enviado pela UI é stripped pelo Zod; multi-provider quote é feature futura).
- **Caveats**:
  - `src/lib/api.ts` (foundation) é client-side; NÃO importar de route handlers — use `@/lib/api-server`.
  - Alguns shapes são flat arrays e outros wrapped — não alterar sem checar o consumer.
  - Erros remanescentes de tsc/lint estão todos em arquivos UI (modals/vitrine) e em `src/hooks/use-realtime.ts` (Task 2) — fora de escopo.
  - `public/uploads/` não é versionado em prod (precisaria de CDN/object storage).

---

Task ID: 5
<a id="5"></a>
Agent: full-stack-developer (flow modals)
Task: Construir os Flow Modals do Severinno Marketplace SaaS (Fase 1/MVP): Quote flow, Booking flow, Provider Profile modal, Auth modal e bits compartilhados (star-rating, file-photos, address-form) + orchestrator modals-host. Next.js 16 + shadcn/ui + Tailwind 4 + react-hook-form + Zod 4 + TanStack Query + framer-motion. Primary emerald, pt-BR, mobile-first.

Work Log:

- Leu worklog.md + agent-ctx/1-foundation.md para entender stores (useAuthStore/useGeoStore/useUIStore/useViewStore), libs (format/constants/validators) e componentes shadcn disponíveis.
- Verificou que `src/lib/api.ts` já existia (parallel agent) com apiGet/apiPost/apiPatch/apiDelete + fetchProviderDetail/fetchProviders/fetchCategories/toggleFavorite/fetchCep + tipos ProviderCard/ProviderDetail/ProviderService/ProviderAvailability/ProviderReview/Category/CepResult. Estendeu `ProviderService` com `description?` e `photos?` para refletir o contrato real.
- Criou `src/components/modals/star-rating.tsx`: StarRatingDisplay (clip-based, meia estrela via % width) + StarRatingInput (radiogroup ARIA, teclado ←→↑↓ e 1–5, hover preview).
- Criou `src/components/modals/file-photos.tsx`: uploader com preview grid (max N, default 4), 5MB/foto, POST /api/upload com FormData via fetch direto (apiPost existente não suporta FormData porque sempre seta Content-Type: application/json). Fallback para URL.createObjectURL se upload falhar.
- Criou `src/components/modals/address-form.tsx`: CEP com auto-fill ViaCEP (apiGet /api/geo/cep), botão GPS (useGeoStore.setFromGPS + apiGet /api/geo/reverse), campos rua/número/complemento/bairro/cidade/UF (Select). Tipagem AddressFormValue exportada para reuso.
- Criou `src/components/modals/auth-modal.tsx`: Dialog sm:max-w-md com Tabs Login/Cadastrar. Role toggle Cliente/Prestador (cartões animados framer-motion). Campos condicionais para provider (cpfCnpj/whatsapp/cidade/UF) via AnimatePresence. Valida com loginSchema/registerSchema. Chama useAuthStore.login/register, fetchMe, navigate para client.dashboard ou provider.dashboard. "Esqueci a senha" com toast info (no-op MVP).
- Criou `src/components/modals/provider-profile-modal.tsx`: Dialog sm:max-w-3xl (Sheet full-screen mobile via useIsMobile). Cover+avatar+BadgeCheck verified+StarRatingDisplay+distância/cidade. Header actions: Heart favorito (toggle UI), Share2 (navigator.share || clipboard). Tabs: Serviços (Accordion por categoria, Carousel de fotos por serviço, botões Orçamento/Agendar que fecham este modal e abrem quote/booking com preset providerId+serviceId), Sobre (bio+endereço+raio+whatsapp), Avaliações (lista com avatar+nome+stars+comentário+data), Expediente (Table 7 dias com slots em Badge). Footer sticky: Pedir orçamento + Agendar serviço. useQuery /api/providers/:id.
- Criou `src/components/modals/quote-modal.tsx`: multi-item (useFieldArray, max 5, animação add/remove framer-motion). Cada item: ProviderCombobox (Popover+Command, async search via useQuery /api/providers?q=), ServiceSelect (Select dependente do provider, useQuery /api/services?providerId=), descrição textarea (min 10), quantidade+unidade (Select), FilePhotos (max 4). Seção 2: AddressForm reusado. Seção 3: Resumo (lista de itens + endereço). Footer sticky com total + submit. POST /api/quotes. Toast success + navigate client.quotes. Auth gate: se não logado → toast info + openAuth('register','CLIENT'). Resolver cast `as unknown as Resolver<T>` por known issue Zod 4 com z.coerce.number().
- Criou `src/components/modals/booking-modal.tsx`: 3-step stepper inline (dots animados + linha + Progress bar). Step 1: Calendar (react-day-picker, pt-BR, disable past) + slots 60min gerados da availability do dia selecionado (mensagem "Prestador não atende neste dia" se vazio). Step 2: card resumo (provider avatar+name, service title+price+unit, data/hora, valor), quantidade, AddressForm, notes textarea. Step 3: RadioGroup PIX/Cartão (PaymentOption cards com ícone). Cartão mock (número formatado, validade MM/AA, CVV) marcado "Demonstração". PIX com QR placeholder + copiar chave + "Já paguei". Amount summary (service × qty + fees=0 + total). POST /api/bookings. Toast + navigate client.bookings. Auth gate no início do flow. Validação por step (step1Valid/step2Valid/step3Valid), Continuar disabled se inválido.
- Criou `src/components/modals/modals-host.tsx`: <ModalsHost /> monta os 4 modais (Auth, Provider, Quote, Booking). Cada modal lê seu open-state do useUIStore. Sem props.
- Corrigiu 3 warnings de unused eslint-disable directives (file-photos, provider-profile-modal x2, quote-modal x1).
- TypeScript: 2 erros iniciais em auth-modal (Resolver mismatch por z.coerce) + 4 erros em quote-modal (idem + AddressFormValue lat/lng null vs undefined). Corrigidos com: cast `as unknown as Resolver<T>`, schema lat/lng com `.nullable().optional()`, e schema complement/district como `z.string().default("")` (não optional) para match com AddressFormValue.
- Verificação final: `bun run lint` → 0 erros nos meus arquivos (2 erros pre-existing em use-realtime.ts não meu). `bunx tsc --noEmit` → 0 erros nos meus arquivos (2 erros pre-existing em vitrine/providers-map.tsx não meu). Dev server log mostra /api/providers, /api/categories, /api/upload, /api/messages, /api/bookings funcionando.

Stage Summary:

- **Modais criados** (todos client components, SSR-safe):
  - `src/components/modals/star-rating.tsx` — StarRatingDisplay + StarRatingInput
  - `src/components/modals/file-photos.tsx` — FilePhotos uploader (FormData via fetch, fallback object URL)
  - `src/components/modals/address-form.tsx` — AddressForm (CEP + GPS + UF select)
  - `src/components/modals/auth-modal.tsx` — AuthModal (Tabs login/register, role toggle)
  - `src/components/modals/provider-profile-modal.tsx` — ProviderProfileModal (Dialog/Sheet, 4 tabs, accordion+carousel)
  - `src/components/modals/quote-modal.tsx` — QuoteModal (multi-item useFieldArray, combobox provider, dependent service select)
  - `src/components/modals/booking-modal.tsx` — BookingModal (3-step stepper, calendar+slots, address, payment mock)
  - `src/components/modals/modals-host.tsx` — ModalsHost (orchestrator, mount once)
- **Key UX decisions**: Dialog desktop + Sheet mobile (useIsMobile), emerald accent everywhere, framer-motion para item add/remove + step transition + role toggle, auth gate (prevention heuristic) antes de submeter quote/booking, validation per-step no booking, sticky footer com submit + total, fallback gracioso em uploads.
- **Caveats**:
  (a) ModalsHost precisa ser montado no app shell (importar `@/components/modals/modals-host`).
  (b) `/api/upload` em paralelo ainda intermitente — FilePhotos faz fallback para blob URL.
  (c) Resolver cast `as unknown as Resolver<T>` em 3 resolvers (login/register/quote) por known issue Zod 4 + z.coerce.
  (d) ProviderService estendido em src/lib/api.ts (paralelo) com `description?` e `photos?`.
  (e) Booking slots: 60min fixo, não checa conflitos com bookings existentes (MVP).
  (f) Pagamento totalmente mock (card form não envia para gateway; PIX usa chave fixa).
  (g) Favorito no provider modal é toggle UI-only (não chama /api/favorites ainda).
  (h) Share usa navigator.share quando disponível, senão clipboard.

---

Task ID: 4
<a id="4"></a>
Agent: full-stack-developer (vitrine) [completed files; verification record added by orchestrator after agent cancellation]
Task: Build the public storefront (vitrine) with MapLibre map, provider cards, filters, hero, topbar, footer.

Work Log:

- Installed maplibre-gl.
- Created src/lib/api.ts (typed fetch wrapper + shared API types: ProviderCard, Service, etc.).
- Created src/components/vitrine/{topbar,hero,category-showcase,how-it-works,filters,provider-card,providers-map,vitrine-results,vitrine}.tsx
- Created src/components/shared/footer.tsx (sticky footer for min-h-screen flex-col layout).
- maplibre map uses OSM raster tiles with attribution; SSR-guarded; emerald markers; fitBounds; popups.
- All fetches RELATIVE via TanStack Query.

Stage Summary:

- Vitrine complete and lint-clean (0 eslint errors).
- Components: Topbar (search+GPS+auth), Hero (emerald gradient + search), CategoryShowcase, HowItWorks, Filters (3-level category cascade + radius + sort), ProviderCard (cover+avatar+rating+distance+accordion services+Orçamento/Agendar), ProvidersMap (maplibre), VitrineResults (list/map toggle + pagination), Vitrine orchestrator.
- Sticky footer at src/components/shared/footer.tsx.
- Caveat: providers-map.tsx had pre-existing tsc notes (per Task 5 agent) — to be re-checked in final verification.

---

Task ID: 7
<a id="7"></a>
Agent: full-stack-developer (provider panel)
Task: Construir o PAINEL DO PRESTADOR do Severinno Marketplace SaaS (Fase 1 / MVP): 10 views (dashboard, expediente, agenda, bookings, quotes, services, finance, messages, reviews, profile) + orquestrador provider-panel + 3 rotas API (availability GET/POST, availability/[id] DELETE, users/me GET/PATCH) + shared MessagesView. Next.js 16 + shadcn/ui + Tailwind 4 + recharts + react-hook-form + Zod 4 + TanStack Query. Primary emerald, pt-BR, mobile-first.

Work Log:

- Leu worklog.md + agent-ctx/1-foundation.md + stores (auth/view/ui) + libs (api, api-server, auth, validators, constants, format) + rotas API existentes (services, bookings, quotes, messages, notifications, reviews, categories, auth/me) + componentes shared (footer) + modais (file-photos, star-rating, address-form) + hooks (use-realtime, use-mobile) + UI primitives (sidebar, card, avatar, button, table, tabs, dialog, alert-dialog, dropdown-menu, popover, switch, input, textarea, select, slider, scroll-area, separator, tooltip, pagination).
- Confirmou que `src/app/api/users/me/route.ts` NÃO existia → criou. Confirmou que `src/app/api/availability/*` NÃO existia → criou as 2 rotas.
- Confirmou que `src/components/shared/dashboard-shell.tsx` foi criado EM PARALELO pelo Task 6 (Client Panel) — e eles sobrescreveram minha versão inicial com uma API diferente (`panelLabel` + `panelIcon` em vez de `headerLabel`). Adaptei o `provider-panel.tsx` para respeitar o contrato final deles (read-first, never-overwrite respeitado).
- Criou `src/components/shared/messages-view.tsx` (chat 2-pane reutilizável com realtime via useRealtime).
- Criou 10 views em `src/components/provider/`:
  1. `provider-dashboard.tsx` — KPIs (hoje/semana, orçamentos pendentes, avaliação média, receita recebida) + 2 charts (recharts: agendamentos 7 dias bar, receita por mês line) + 3 listas recentes (próximos agendamentos, orçamentos pendentes, últimas avaliações) + quick actions.
  2. `provider-expediente.tsx` — 7 cards de dia da semana (Dom-Sáb), cada um com lista de slots {startTime, endTime, active}, add/remove slot, Switch de ativo, "Copiar para dias úteis", aviso de sobreposição, validação startTime < endTime, POST /api/availability upsert.
  3. `provider-agenda.tsx` — Calendar grid mensal (date-fns) com dots coloridos por status, navegação mês anterior/próximo, tabs Hoje/Semana/Mês, lista do dia selecionado, mapa OpenStreetMap link nos detalhes. Read-only.
  4. `provider-bookings.tsx` — Tabs por status (Pendentes/Confirmados/Em andamento/Concluídos/Cancelados/Todos), cards com avatar+cliente+serviço+data+endereço+valor+status, ações em dropdown (Confirmar, Iniciar, Cancelar, Ver detalhes, Enviar mensagem), dialog de detalhes com link "Abrir no mapa", paginação.
  5. `provider-quotes.tsx` — Tabs por status (Pendentes/Respondidos/Aprovados/Rejeitados/Todos), cards expandíveis por request, cada item com formulário de resposta (price + note + Enviar orçamento) para PENDING, mostra preço/nota para QUOTED, link "Enviar mensagem ao cliente".
  6. `provider-services.tsx` — CRUD completo: lista com thumbnail, título, categoria, preço+unidade, active toggle inline, editar/excluir; Dialog form com cascade 3-nível (pai → filha → subcategoria) usando Select, validação serviceSchema, FilePhotos (max 4), preço só sobe (alerta se menor que atual), AlertDialog de exclusão, busca textual.
  7. `provider-finance.tsx` — Cards de resumo (Recebido/A receber/Estornado no ano), chart de receita por mês (recharts bar), filtros por status+mês+ano, tabela de transações com cliente+serviço+método+status+valor.
  8. `provider-messages.tsx` — Wrapper do MessagesView shared com initialPeerId vindo dos params (para navegar a partir de bookings/quotes).
  9. `provider-reviews.tsx` — Card de avaliação média + distribuição (5★-1★ com barras), lista de reviews com avatar+nome+stars+comentário+data+serviço+booking, empty state.
  10. `provider-profile.tsx` — Cover+avatar preview, SinglePhoto uploader para avatar e cover, formulário com name/bio/whatsapp/phone, campos read-only (email, cpfCnpj, verified badge), AddressForm fields (CEP/rua/número/complemento/bairro/cidade/UF), Slider de raio de atendimento, botão GPS, PATCH /api/users/me.
- Criou `provider-panel.tsx` (orquestrador): mapeia `useViewStore.view` → view correspondente, monta DashboardShell com nav items (10 itens com ícones Lucide: LayoutDashboard, Clock, CalendarDays, CalendarCheck, FileText, Wrench, Wallet, MessageSquare, Star, User) + badges dinâmicos (pendingQuotes, pendingBookings) + breadcrumbs + headerLabel "Painel do Prestador".
- Criou 3 rotas API:
  - `src/app/api/availability/route.ts` — GET (own availability) + POST (upsert array, replace strategy via $transaction deleteMany + create, valida startTime < endTime, schema availabilitySchema).
  - `src/app/api/availability/[id]/route.ts` — DELETE (owner check).
  - `src/app/api/users/me/route.ts` — GET (USER_PUBLIC_SELECT) + PATCH (providerProfileSchema, only owner).
- Coordenação com Task 6: meu dashboard-shell.tsx inicial foi sobrescrito pelo Task 6 (eles criaram a versão final). Adaptei provider-panel.tsx para o contrato final deles (`panelLabel` + `panelIcon` em vez de `headerLabel`). Meu messages-view.tsx permanece intacto e reutilizável por ambos os painéis.
- Verificação:
  - `bunx tsc --noEmit` → 0 erros nos meus arquivos (erros remanescentes em examples/, skills/, src/components/vitrine/providers-map.tsx, src/components/client/client-dashboard.tsx — todos fora do meu escopo).
  - `bunx eslint src/components/provider src/components/shared/messages-view.tsx src/app/api/availability src/app/api/users/me` → 0 erros, 0 warnings.
  - `bun run lint` (projeto inteiro) → só 2 erros pre-existing em `src/hooks/use-realtime.ts` (Task 2, `react-hooks/refs`).
  - Dev server compilando sem erros novos (apenas warnings pré-existentes em /api/upload).
- Correções durante o lint:
  - Removido `now` do deps array de `useMemo` em provider-finance.tsx (React Compiler preserve-manual-memoization).
  - Removidos 4 `// eslint-disable-next-line @next/next/no-img-element` unused directives (provider-quotes, provider-profile x2, provider-services).
  - Trocado `form.watch("basePrice")` por `useWatch({ control, name: "basePrice" })` em provider-services.tsx (react-hooks/incompatible-library warning).
- Não tocou em src/app/page.tsx, src/app/layout.tsx, vitrine, modais, stores, foundation lib, ou arquivos do painel client/admin.

Stage Summary:

- **Views criadas** (`src/components/provider/`):
  - `provider-dashboard.tsx` — overview com KPIs + 2 charts (recharts) + 3 listas recentes
  - `provider-expediente.tsx` — gerenciamento de disponibilidade semanal (7 dias, add/remove slots, ativo toggle, copiar para dias úteis)
  - `provider-agenda.tsx` — calendário mensal + lista do dia (date-fns, read-only)
  - `provider-bookings.tsx` — gestão de agendamentos com tabs por status + ações (confirmar/iniciar/cancelar/detalhes/mensagem)
  - `provider-quotes.tsx` — gestão de orçamentos com tabs por status + formulário de resposta por item
  - `provider-services.tsx` — CRUD de serviços com cascade 3-nível de categorias + FilePhotos + AlertDialog de exclusão
  - `provider-finance.tsx` — financeiro com cards de resumo + chart mensal + filtros + tabela de transações
  - `provider-messages.tsx` — wrapper do MessagesView shared
  - `provider-reviews.tsx` — avaliações recebidas com média + distribuição + lista
  - `provider-profile.tsx` — edição de perfil com avatar/cover + address + radius + GPS
  - `provider-panel.tsx` — orquestrador que mapeia view → componente, monta DashboardShell com nav + badges + breadcrumbs
- **API routes criadas**:
  - `src/app/api/availability/route.ts` — GET + POST (upsert)
  - `src/app/api/availability/[id]/route.ts` — DELETE
  - `src/app/api/users/me/route.ts` — GET + PATCH (criada porque não existia)
- **Shared components criados**:
  - `src/components/shared/messages-view.tsx` — chat 2-pane reutilizável (client + provider) com realtime via useRealtime hook, conversas list + thread + composer.
- **Caveats**:
  (a) `dashboard-shell.tsx` foi criado EM PARALELO pelo Task 6 — minha versão inicial foi sobrescrita pela deles. Adaptei-me ao contrato final deles (`panelLabel` + `panelIcon`). Se outro agente precisar usar o shell, leia o header do arquivo para o contrato atual.
  (b) `users/me` route: criada por mim (Task 7) já que Task 6 não havia criado quando comecei. Se Task 6 também criou, há risco de merge conflict — meu conteúdo prevaleceu (escrito depois).
  (c) Availability POST usa strategy "delete all + create all" (idempotente). IDs mudam a cada save — frontend nunca reutiliza IDs para atualização local.
  (d) Provider dashboard deriva KPIs de 3 chamadas (bookings/quotes/reviews) com limit=200 — suficiente para MVP, mas pode precisar de endpoints agregados dedicados em escala.
  (e) Quote items mostram TODOS os items do request (não só os do provider logado). Backend já filtra requests via OR no providerId, mas items array vem completo. Defensivo: provider só pode responder aos próprios items (validação server-side).
  (f) Bookings: provider NÃO pode concluir (apenas cliente) — UI mostra nota explicativa e esconde o botão Concluir.
  (g) Mensagens: MessagesView invalida queries em tempo real via socket `message:new`. Refetch interval de 10-15s como fallback.
  (h) Profile: avatar/cover usam fetch direto (não apiPost) porque apiPost sempre seta Content-Type JSON. Mesmo padrão do FilePhotos.
  (i) Não implementei paginação nos quotes (limit=50) — se ultrapassar, precisará de paginação real. Bookings tem paginação (10 por página).
  (j) Mapa nos detalhes de booking é um link externo para OpenStreetMap (sem maplibre inline para manter o bundle leve).

---

Task ID: 6
<a id="6"></a>
Agent: full-stack-developer (client panel) [files complete; agent stopped during reporting — record added by orchestrator]
Task: Build the Client panel (dashboard, bookings, quotes, services, finance, messages, reviews, favorites, profile).

Work Log:

- Created src/components/shared/dashboard-shell.tsx (sidebar + topbar + notifications + user dropdown, reusable by all panels).
- Created 11 files in src/components/client/: client-dashboard, client-bookings, client-quotes, client-services, client-finance, client-reviews, client-favorites, client-messages, client-profile, client-panel (orchestrator), review-dialog.
- client-panel maps useViewStore.view ('client.*') to views; nav items with lucide icons + emerald accent.

Stage Summary:

- DashboardShell at src/components/shared/dashboard-shell.tsx (API: navItems, currentView, title, subtitle, breadcrumbs, user, onNavigate, panelLabel, panelIcon).
- Client panel complete. 11 views. Uses TanStack Query + realtime hook for messages/notifications.
- review-dialog for post-completion reviews.

---

Task ID: 8
<a id="8"></a>
Agent: full-stack-developer (admin panel) [files complete; agent stopped during reporting — record added by orchestrator]
Task: Build the Admin panel (dashboard, taxonomy tree, users, providers, services, bookings, settings).

Work Log:

- Created 8 files in src/components/admin/: admin-dashboard, admin-taxonomy (3-level tree, flagship), admin-users, admin-providers, admin-services, admin-bookings, admin-settings (.env-like config console), admin-panel (orchestrator).
- admin-panel maps useViewStore.view ('admin.*') to views; nav: Visão geral, Taxonomia, Usuários, Prestadores, Serviços, Agendamentos, Configurações.

Stage Summary:

- Admin panel complete. 8 views.
- Flagship: admin-taxonomy.tsx (3-level autoconfigurable category tree with pai›filha›subcategoria, inline edit, delete with 409 guard, service counts).
- admin-settings.tsx: dynamic .env-like configuration console (grouped by prefix, inline edit, add/delete).

---

Task ID: 9
<a id="9"></a>
Agent: orchestrator (main route integration)
Task: Integrate all surfaces into the single / route (SPA view-switching) + app shell + footer.

Work Log:

- Rewrote src/app/page.tsx as the AppShell: hydration gate (useSyncExternalStore), initial fetchMe, view-based routing (vitrine / client.* / provider.* / admin.*), auth guard for panel views (gated on mounted+initialized to avoid hydration race), realtime room join on auth, global ModalsHost mount.
- Fixed use-realtime.ts lint errors (react-hooks/refs + set-state-in-effect) by removing the exposed `socket` ref and extracting socket-status sync into a callback.
- Added src/types/css-modules.d.ts for maplibre-gl CSS import.
- Fixed providers API bug: radius filter was excluding all providers when lat/lng absent (now only applies when hasGeo).
- Fixed auth-modal navigation: LoginForm now navigates by role (was missing entirely); RegisterForm now handles ADMIN role (was hardcoding client/provider). Removed redundant fetchMe() after login that could null out the user.

Stage Summary:

- Single / route fully functional: vitrine (default), client/provider/admin panels via view-switching.
- Auth guard robust against hydration timing (mounted gate).
- Post-login navigation routes to the correct panel per role.

---

Task ID: 10
<a id="10"></a>
Agent: orchestrator (E2E verification)
Task: End-to-end browser verification of all surfaces and flows.

Work Log:

- Verified with Agent Browser + VLM (image analysis):
  - Vitrine: topbar (logo, search, GPS, Entrar/Cadastrar, category nav), hero (emerald gradient, search, trust badges), 6 provider cards (cover, avatar, rating stars, distance, services accordion, Orçamento/Agendar buttons), footer (sticky, all sections, Open Source attribution).
  - Provider profile modal: cover, avatar, name, 5.0 rating, 4 tabs (Serviços/Sobre/Avaliações/Expediente), service list, Pedir orçamento/Agendar buttons.
  - Auth modal: login/register tabs, email/password, role toggle.
  - Admin panel: dashboard with KPIs (9 usuários, R$ 720 receita, 4 agendamentos), sidebar, charts. Taxonomy tree (3-level: Reparos→Elétrica/Hidráulica/Pintura, +Nova categoria, edit/delete/toggle). Settings console.
  - Client panel: dashboard with KPIs (agendamentos, orçamentos, serviços, total investido), charts, all 9 nav items.
  - Provider panel: dashboard with KPIs (hoje, orçamentos pendentes, avaliação, receita), all 10 nav items. Services CRUD with 3-level category cascade, title/description/price/unit/photo upload.
- Lint: 0 errors. Dev log: clean (all 200s, no errors). Realtime service: accepting connections.

Stage Summary:

- FASE 1 (MVP) fully verified end-to-end. All 3 personas (Cliente, Prestador, Admin) functional. Vitrine with MapLibre-ready map, provider cards, quote/booking flows, realtime service running on port 3003.

---

Task ID: F0
<a id="f0"></a>
Agent: orchestrator (frontend focus — auth fix)
Task: Fix auth store persistence race condition causing guard to fire on reload after cookie-based login.

Work Log:

- Root cause: `initialized: true` was persisted, so on reload the guard saw initialized=true + user=null (when login happened via cookie, not store) and reset the view to vitrine + opened auth modal.
- Fix: removed `initialized` from the persist partialize. Now `initialized` always starts false on mount and flips to true only after fetchMe() verifies the session cookie. The guard in page.tsx (gated on `mounted && initialized`) waits for this before evaluating.
- Verified: client.dashboard view now persists across reload after cookie login.

Stage Summary:

- Auth guard race condition resolved. Panel navigation now robust.

---

Task ID: F1
<a id="f1"></a>
Agent: frontend-styling-expert (vitrine polish)
Task: Polish the vitrine (storefront) visual design — topbar, hero, category showcase, how-it-works, provider card, filters, vitrine-results, footer — to production-polished level. Edit existing files surgically; preserve all component APIs, props, exports, and data logic.

Work Log:

- src/components/vitrine/topbar.tsx: tighter sticky header (`bg-background/80 backdrop-blur-md`), emerald pill location chip (`bg-emerald-50 text-emerald-700 border-emerald-200`) with prominent mobile shortcut button; aligned Entrar (ghost) and Cadastrar (default) at same h-9 size sm; category nav now relative with fade-edge gradients; pills tightened (h-8, hover:text-primary); mobile sheet auth reordered (Entrar outline, Cadastrar primary, both h-11); mobile location uses emerald outline card; logo button shrinks correctly.
- src/components/vitrine/hero.tsx: stronger typographic hierarchy (`text-3xl md:text-5xl font-bold tracking-tight` title + `font-light` subtitle on emerald-50/90); gradient extended to teal-800; search card is pure white `rounded-2xl shadow-2xl p-2` with `h-12` left-aligned inputs and prominent `h-12` emerald Buscar button; GPS link is now a subtle `text-emerald-50 hover:text-white hover:underline` pill (LocateFixed icon); trust badges get larger `size-8 bg-white/10 ring-1 ring-white/15` circles and `text-sm` labels; section padding tightened to `py-12 md:py-16`.
- src/components/vitrine/category-showcase.tsx: section title bumped to `text-2xl md:text-3xl`; cards now `min-w-[140px]` and flex (horizontal scroll) on mobile → grid on sm+; emerald circle icons (`bg-emerald-50 text-emerald-700`); shadow-sm baseline + hover lift + emerald-300 hover border + `bg-emerald-50/40` hover tint.
- src/components/vitrine/how-it-works.tsx: dropped the wrapper card in favor of a cleaner centered header + 3-col grid; each step card `rounded-xl border p-6 text-center shadow-sm hover:shadow-md`; numbered badge (1/2/3) as `size-6 rounded-full ring-1 ring-primary/30` on the icon's corner; tighter `py-12 gap-6`.
- src/components/vitrine/provider-card.tsx: card now `rounded-xl shadow-sm hover:shadow-md hover:border-emerald-200`; cover fixed `h-32 md:h-36` with subtle bottom gradient overlay; verified badge replaced with `bg-emerald-500` pill + ShieldCheck icon (top-left); favorite heart is `bg-white/90 backdrop-blur shadow-sm hover:bg-white`, active state `fill-rose-500 text-rose-500`; avatar `size-14 -mt-7 ml-4 border-4 border-card` (overlapping cover, counter moved into rating line as `(reviewCount)`); rating line `Star amber-400 + number + count text-xs`; distance uses `text-emerald-600`; service rows `border-b last:border-b-0` with price in `text-emerald-700 font-medium`; footer buttons all `h-9 size sm` with Orçamento outline emerald-tinted, Agendar solid, Ver perfil ghost; skeleton updated to match the new shorter cover + avatar cutout.
- src/components/vitrine/filters.tsx: removed redundant badge import; labels now `text-xs font-medium text-muted-foreground`; radius live value is an emerald pill chip; sort is a 2-col segmented control (`SortOption`) replacing the plain select; added a breadcrumb chip (`border-emerald-200 bg-emerald-50/60 text-emerald-800`) showing the selected category path with X to clear; verified-only row hover border-emerald-200; gap scale tightened to gap-5.
- src/components/vitrine/vitrine-results.tsx: removed Badge import; active filter chips restyled to emerald pill chips (`border-emerald-200 bg-emerald-50 text-emerald-800`); view-toggle segmented control now always visible (was `hidden sm:inline-flex`) with `shadow-sm`; results grid `gap-5` and `sm:grid-cols-2 xl:grid-cols-3`; map view height bumped to `h-[500px]` with `rounded-xl overflow-hidden`; selection ring rounded-xl; sidebar has shadow-sm; empty state gets `size-16` emerald circle with SearchX + emerald-tinted "Limpar filtros" CTA; result count title `tracking-tight`.
- src/components/vitrine/vitrine.tsx: untouched (orchestrator) — visual polish comes from children.
- src/components/shared/footer.tsx: converted to dark `bg-slate-900 text-slate-300 border-t border-slate-800`; brand text white, body text `slate-400 hover:text-white`, headers `slate-500`; social icons `border-slate-700 hover:border-primary hover:text-primary`; bottom bar `border-slate-800 mt-8 pt-6 text-xs text-slate-500` with MapLibre/OSM links `slate-400 hover:text-white`; tightened gaps to gap-2.5 between links.

Stage Summary:

- All 9 owned files surgically polished; component APIs (props/exports), data logic, query hooks, mutations and event handlers untouched.
- `bunx tsc --noEmit` — 0 errors in src/components/vitrine/** and src/components/shared/footer.tsx (only pre-existing baseline errors in examples/ and skills/ remain).
- `bun run lint` — passes with 0 errors.
- Visual language is now consistent: emerald primary throughout, slate-900 footer for contrast, amber-400 rating stars, emerald pills for active chips/badges, shadow-sm cards with hover:shadow-md and emerald-tinted hover borders, consistent rounded-xl on cards and rounded-lg on inner controls.
- Mobile-first verified: topbar collapses to hamburger + emerald location icon shortcut, hero stacks single-column with full-width search, category showcase horizontal-scrolls, filters move into a Sheet, results grid collapses to 1 col, footer grid → 2 cols.
- Caveats: framer-motion was NOT introduced (existing components use CSS transitions for hover lifts; kept performance predictable). Providers-map.tsx was NOT touched (outside owned scope). No API/data changes.

---

Task ID: F3
<a id="f3"></a>
Agent: full-stack-developer (modals polish)
Task: Refine visual design, layout density, transitions, and form UX of all flow modals (auth, provider profile, quote, booking) plus shared bits (file-photos, address-form, star-rating, modals-host) to a production-polished level. Emerald primary, pt-BR, mobile-first, Nielsen heuristics.

Work Log:

- src/components/modals/auth-modal.tsx: rebuilt header with brand mark (emerald gradient + Wrench tile), pill-style tab toggle (rounded-full, active = bg-primary text-primary-foreground), Mail/Lock icons inside h-10 inputs, full-width h-11 emerald submit buttons, role toggle as large selectable cards (icon + label + description, selected = border-primary bg-primary/5 ring-1 ring-primary), inline helper text, animated form-level error messages via framer-motion, provider fields helper badges reformatted as an emerald-tinted alert.
- src/components/modals/provider-profile-modal.tsx: cover with gradient overlay, avatar border-4 border-card + shadow-sm, name text-xl font-bold, distance now uses Navigation icon, custom action row (close X + share + favorite) so Dialog default close is hidden via showCloseButton={false}; on mobile Sheet default close hidden via [&_[data-slot=sheet-close]]:hidden; pill-style scrollable tabs (active = bg-primary text-primary-foreground); ReviewsTab now shows big-number summary + 5★→1★ distribution bars + reviews list; HoursTab adds a status column (Aberto/Fechado badge) and "hoje" highlight on current weekday; AboutTab adds a small radius visual (concentric circles) and uses uppercase section labels; service cards show price as text-emerald-700 font-semibold (no longer a Badge).
- src/components/modals/quote-modal.tsx: dialog header subtitle changed to "Solicite orçamentos de um ou mais serviços."; new auth-gate alert (amber-50 bg, amber-200 border) with "Entrar / Cadastrar" button shown when user is not authenticated; ItemCard padding standardized to rounded-xl border p-4; "Adicionar item" button uses border-dashed border-primary/30 hover:border-primary hover:bg-primary/5; AddressForm wrapped in rounded-xl border bg-card p-4; sticky footer button is h-11 emerald; footer count now uses unique provider count via Set; button label changed to "Enviar orçamentos".
- src/components/modals/booking-modal.tsx: dialog width sm:max-w-lg (was sm:max-w-2xl); slot grid uses rounded-lg border p-2 text-sm text-center, selected = border-primary bg-primary/10 text-primary (was solid emerald); no-slots state uses CalendarOff icon + "Prestador não atende neste dia"; payment option cards now use border-primary bg-primary/5 ring-1 ring-primary when selected (was emerald-600); card form is rounded-xl border p-4 with "Demonstração — não processa pagamento real" badge; PIX QR placeholder is rounded-lg bg-slate-100 p-8 text-center; footer buttons h-11 emerald.
- src/components/modals/file-photos.tsx: replaced tiny square buttons with a full-width drag-drop zone (border-2 border-dashed, hover:border-primary hover:bg-primary/5, UploadCloud icon, drag state styling); preview grid is grid-cols-4 gap-2 with aspect-square rounded-lg overflow-hidden cells; max indicator reads "X/4 fotos"; supports keyboard activation (Enter/Space) on the drop zone; preserved value/onChange/max/label/hint/disabled API.
- src/components/modals/address-form.tsx: tightened grid to gap-3; all inputs h-10 text-sm; GPS button uses border-primary/30 text-primary hover:bg-primary/5 styling for prominence; UF select now in 2-col grid alongside a "Localização confirmada" status pill (or hint when no coords); errors shown under UF select.
- src/components/modals/star-rating.tsx: default StarRatingInput size bumped to 32 (size-8 per spec); added ml-1.5 spacing for value label.
- src/components/modals/modals-host.tsx: untouched (no design changes needed; only mounts the four modals).

Stage Summary:

- Visual: pill tabs, large role/payment cards, polished header/cover with custom action buttons, distribution bars on reviews, status badges on expediente, drag-drop photo zone — all aligned to emerald primary and shadcn tokens.
- Form UX: consistent h-10 inputs + text-sm, h-11 emerald submit buttons, helper text, inline error text, animated transitions (framer-motion for tab/form errors and step changes preserved), auth gate visible on quote flow, GPS button visually prominent.
- Mobile: provider profile uses full-screen Sheet on mobile with the default close hidden (custom close X lives in the cover); other modals keep standard Sheet close.
- Verification: `bunx eslint src/components/modals/` exits 0; `bunx tsc --noEmit` reports no errors in src/components/modals/* (pre-existing errors in admin-dashboard.tsx and skills/ examples are out of scope for F3).
- Caveats: Did not change any component APIs (props, exports, store actions, API calls). The drag-drop FilePhotos uses native HTML5 drag events (works on desktop; mobile falls back to tap-to-pick). Booking step 1 calendar selection color comes from --primary (emerald) via shadcn Calendar tokens — no override needed.

---

Task ID: F2
<a id="f2"></a>
Agent: frontend-styling-expert (dashboard polish)
Task: Polish the three dashboard panels (client / provider / admin) and the shared DashboardShell to a production-polished level — KPI cards, charts, spacing, hierarchy, sidebar/topbar, notifications dropdown.

Work Log:

- `src/components/shared/dashboard-shell.tsx`:
  - Added `next-themes` `useTheme` import + `framer-motion` `motion` import; added Sun/Moon + CheckCheck icons (removed unused LocateFixed).
  - Sidebar nav: `SidebarMenuButton` now uses `size="lg"` with `rounded-lg`, emerald-tinted active state (`!bg-primary/10 !text-primary font-medium`) + a `size-1` left emerald indicator bar; icons `size-4`, labels `text-sm`; group label uppercase tracking.
  - Sidebar header: rounded-xl emerald icon tile (size-9) + panel name + APP_NAME.
  - Sidebar footer (desktop + mobile Sheet): avatar + name + role badge (Badge variant=secondary) + ghost logout button; mobile Sheet nav restyled to match desktop (rounded-lg + left indicator bar).
  - Topbar: `h-14 border-b bg-background/80 backdrop-blur`; page title bumped to `text-base md:text-lg font-semibold tracking-tight` + subtitle `text-xs text-muted-foreground`. Avatar trigger is now borderless (`p-0.5 rounded-full`), location chip uses `border bg-card rounded-full` with MapPin (not LocateFixed).
  - Added theme toggle (Sun/Moon) between location chip and notifications bell.
  - NotificationsBell: redesigned to `w-80 p-0` dropdown with header (title + "X novas" emerald badge + "Marcar todas" button), unread dot in emerald with ring border for read items, `text-[10px]` relative time, type badge. Added `onMarkAllRead` mutation (parallel PATCHes).
  - StatCard: rewritten to spec — `rounded-xl bg-card p-5 shadow-sm hover:shadow-md` wrapper, `size-10 rounded-lg bg-primary/10 text-primary` icon tile, `text-2xl font-bold tracking-tight tabular-nums` value, `text-xs uppercase tracking-wide text-muted-foreground` label, optional `text-xs` hint; wrapped in framer-motion `motion.div` with `delay: index * 0.05` stagger; added optional `trend` pill (up/down arrow).
  - SectionTitle: bumped to `text-base md:text-lg font-semibold tracking-tight` + `text-xs` description.

- `src/components/client/client-dashboard.tsx`:
  - Replaced inline PIE_COLORS with emerald family palette (emerald-400/500/600, teal-400/500/600, lime-400).
  - Added shared `CHART_TOOLTIP_STYLE` constant (popover bg, border, 12px font, soft shadow).
  - KPI grid: gap-4, each StatCard passes `index` for stagger; full labels shown (no truncation).
  - Charts row: each Card is `rounded-xl shadow-sm p-5`, with an icon-tile + `text-sm font-semibold uppercase tracking-wide text-muted-foreground` title.
  - Area chart (bookings/month): switched to `var(--primary)` for stroke/fill, gradient 0.35→0.02 opacity, dashed cursor, axis ticks `fill: var(--muted-foreground)`, grid `var(--border)`.
  - Donut (spending by category): `innerRadius=60 outerRadius=90`, `stroke=var(--background) strokeWidth=2`, legend below in 2-col grid with color dots + values.
  - Activity list + upcoming bookings preview: polished cards with `rounded-xl shadow-sm hover:shadow-md`, emerald avatar fallbacks, consistent status badges.

- `src/components/provider/provider-dashboard.tsx`:
  - Removed local `StatCard` + unused imports (`Bell`, `Link`, `addDays`, `formatTime`, `LineChart`/`Line`, `CardDescription`/`CardHeader`/`CardTitle`, `BOOKING_STATUS_LABELS`); switched to shared `StatCard` from dashboard-shell.
  - KPI row relabeled per spec: "Agendamentos hoje", "Orçamentos pendentes", "Avaliação média" (with `N avaliações` hint), "Receita recebida" (formatBRL).
  - Charts: Bar (7-day bookings) + Area (revenue/month, was LineChart) with emerald `var(--primary)` palette, consistent axis ticks/grid, dashed cursor for area, `barSize=28`, styled tooltip.
  - Quick action buttons: removed oversaturated `bg-emerald-600 hover:bg-emerald-700` from Expediente (now uses default primary token).
  - Three recent lists (upcoming / pending quotes / latest reviews): cards are `rounded-xl shadow-sm p-5`, headers `text-sm font-semibold uppercase tracking-wide`, list items `rounded-lg border bg-card p-2.5 hover:bg-accent/40`; avatars use `bg-primary text-primary-foreground` fallback; "Ver todos" buttons use emerald-tinted ghost style.

- `src/components/admin/admin-dashboard.tsx`:
  - Removed shadcn `ChartContainer`/`ChartTooltip`/`ChartTooltipContent`/`ChartConfig` imports + `CardHeader`/`CardTitle`/`CardDescription` + `QUOTE_STATUS_LABELS`; added recharts `ResponsiveContainer` + `Tooltip as RTooltip`.
  - Replaced 8-card KpiCard grid with spec'd 5-card primary KPI row (Total de usuários with role breakdown subtext, Prestadores verificados, Serviços ativos, Receita total, Agendamentos totais) using shared `StatCard` (staggered).
  - Added a 4-card secondary `MiniStat` row (Orçamentos, Ticket médio, Prestadores em destaque, Taxa de conclusão) — compact, no animation, preserves the metrics that no longer fit the primary row.
  - Charts: switched all to direct recharts + `var(--primary)` palette with shared `CHART_TOOLTIP_STYLE`, dashed `var(--border)` grid, `var(--muted-foreground)` ticks. Donut (status) uses emerald family palette (`DONUT_COLORS`) with `innerRadius=60 outerRadius=90`, legend below with color dots + counts + percentages.
  - Removed unused `KpiCard` function; DashboardSkeleton updated to reflect new layout (5 primary + 4 secondary + 4 charts).
  - Recent activity: "Últimos agendamentos" (5) + "Top prestadores" (5) lists in `rounded-xl overflow-hidden shadow-sm` cards with border-b header bar + `text-xs` "Ver todos" emerald ghost button.
  - Added page header (title + subtitle) for hierarchy.

Stage Summary:

- All four files lint clean (`bun run lint` → 0 errors) and type-check clean (`bunx tsc --noEmit` reports no errors in `src/components/{client,provider,admin,shared}/`).

---

Task ID: Memory System
<a id="memory-system"></a>
Agent: Buffy (AI coding assistant)
Task: Configurar sistema de memória persistente para retomar contexto entre threads.

Work Log:

- Criou `.agents/memory/` com 5 arquivos de memória persistente:
  - `MEMORY.md`: índice central com entradas para projeto, stack, user, decisions e topic files
  - `project-conventions.md`: stack completo, design system, estrutura de diretórios, regras de código, credenciais de teste
  - `tech-decisions.md`: 10 decisões arquiteturais com rationale (rota única, SQLite MVP, auth HMAC, WebSocket path "/", etc.)
  - `user-preferences.md`: perfil do desenvolvedor, preferências técnicas, estilo de comunicação
  - `session-history.md`: resumo de todas as 14 sessões/tasks anteriores + esta sessão

Stage Summary:

- Sistema de memória persistente configurado em `.agents/memory/`.
- Agora qualquer agente que iniciar uma nova thread pode ler `.agents/memory/MEMORY.md` para obter contexto completo do projeto.
- worklog.md mantido como registro detalhado de cada task.

---

Task ID: MEDIO-PRAZO-3A
<a id="medio-prazo-3a"></a>
Agent: Buffy (orchestrator — parecer + 3 ações recomendadas)
Task: Executar as 3 ações de médio prazo recomendadas no parecer técnico: (1) consolidar o meta-tooling com doc do "porquê" de cada família de guard, (2) revisar o useViewStore (performance/histórico), (3) ampliar a auditoria de segredos com classificação de severidade.

Work Log:

- **Ação 1 — Consolidação do meta-tooling**: criado `docs/GUARDS.md` catalogando as famílias de guard de `scripts/` (check-_, test-mutation-_, audit-_, validate-_, run-*) com o "porquê" de cada uma: encoding/cache (check-bun-mirror, check-crlf, check-blob-crlf, check-utf8, check-single-line-out-assign, normalize-crlf), doc-symmetry (check-encoding-guards-badge, check-hooks-symmetry, check-readme-anchors/toc/images, check-mutation-jobs, check-workflow-refs), segredos (audit-secret-leaks + check-secret-leaks-baseline), infra (check-tier1-fastpath, check-tier2-cache-restore, check-e2e-counts) e benchs (act-startup-bench, bench-setup-bun). Seção 7 documenta a correção da premissa do parecer: o guard semanal de segredos NÃO gateia só o total — gateia por assinatura (qualquer achado novo falha, incluindo todos os de severidade alta); o `--min-severity` é opt-out para quem quiser relaxar deliberadamente.
- **Ação 2 — Revisão do useViewStore** (`src/store/view.ts`): adicionado `HISTORY_LIMIT = 50` com cap FIFO do histórico (impede crescimento ilimitado em navegação longa) e dedupe de navegação repetida (navigate para a MESMA view + mesmos params é no-op, evitando entradas duplicadas no histórico e re-renders desnecessários). `sameViewAndParams` compara params shallowly (objetos/arrays nunca colidem — sem falso-positivo de dedupe). Testes adicionados em `src/store/__tests__/view.test.ts` (cap + dedupe, incluindo o math exato do off-by-one `client.view-19`). Sem mudança de API — nenhum call site tocado.
- **Ação 3 — Severidade na auditoria de segredos**:
  - `scripts/audit-secret-leaks.mjs`: patterns refatorados para objetos `{ id, severity, re }` (PRIVATE_KEY/PREFIX_TOKEN = alta, SECRET_ASSIGN = média); `scanHistory` usa `pat.re` com backward-compat (`pat.re ?? pat`); findings agora carregam `severity`; JSDoc `@returns` e HELP atualizados; campo `label` removido (redundante com `id`) após review.
  - `scripts/check-secret-leaks-baseline.mjs`: novos exports `SEVERITY_ORDER`, `severityRank` (severidade desconhecida → ALTA fail-closed — padrão novo no audit nunca escapa do gate) e `splitBySeverity(newFindings, minSeverity) → { blocking, warnings }`; flag `--min-severity` (default `baixa` = comportamento histórico: QUALQUER achado novo falha); `buildBaseline` persiste severidade; JSON output adiciona `minSeverity`/`blockingCount`/`blocking`; output texto distingue blocking vs warnings (warnings exit 0).
  - `.github/workflows/benchmark-weekly.yml`: job secret-leaks-audit RODA NO DEFAULT (sem `--min-severity alta` — o review provou que isso ENFRAQUECERIA o gate para achados médios; o default já falha em qualquer achado novo, incluindo todos os altos, que é exatamente o pedido do parecer). Comentário no YAML explica a correção da premissa.
  - `docs/security/secret-leaks-baseline.json` regenerado com `--update`: count 141 preservado, TODOS os findings agora carregam `severity`, sem drift de commit/line (diff severity-only).
  - Testes: `src/lib/__tests__/audit-secret-leaks.test.ts` e `check-secret-leaks-baseline.test.ts` ganharam asserções de severidade (incluindo `severityRank(undefined) = ALTA` fail-closed e `splitBySeverity` com `--min-severity alta`).

Stage Summary:

- **Ação 1**: `docs/GUARDS.md` criado — catálogo de famílias de guard com o "porquê" de cada uma (156 scripts explicados por família, não por script).
- **Ação 2**: `src/store/view.ts` — `HISTORY_LIMIT = 50` + dedupe de navegação; API intacta; testes novos verdes.
- **Ação 3**: auditoria com severidade (alta/média), guard com `--min-severity` fail-closed, baseline 141 findings com severidade, job semanal no default (gate mais forte) — premissa do parecer corrigida na doc.
- **Validação**: vitest 3 suítes (audit-secret-leaks 20 + check-secret-leaks-baseline 18 + view 15 = 53/53) ✓ · tsc --noEmit 0 erros ✓ · prettier 0 nos 8 arquivos ✓ · guards reais (hooks-symmetry, badge, workflow-refs, mutation-jobs) exit 0 ✓ · guard real default e --min-severity alta exit 0 ✓ · 3 rodadas de code review (pontos críticos aplicados: job revertido para default, fail-safe invertido p/ ALTA, backward-compat do patterns, cleanup do label).

---

Task ID: SEED-COUNT-LITERALS
<a id="seed-count-literals"></a>
Agent: Buffy (orchestrator — guard de refs órfãos de counts)
Task: Criar um guard (padrão check-e2e-counts) que varre TODO o repo — scripts/, docs/, .github/ — por literais 115/123 de counts de seed que não batam com a derivação real, evitando que um bump futuro deixe outro ref órfão como a âncora ficou.

Work Log:

- **Contexto**: a derivação real dá prod=128, dev=162 (bun scripts/seed-e2e-count.ts --json); o check-e2e-counts.mjs cobre SÓ os workflows + script local (SCAN_FILES explícito), mas não varre docs/ nem todos os scripts/ — o incidente histórico (doc dizia 128, âncora de teste esperava 123) deixou um literal órfão sem ninguém perceber. Audit: únicos refs numéricos "N checks" no repo são 128/162 (UTF-8 checks não têm número); prosa histórica do GUARDS.md ("doc dizia 128, âncora esperava 123") não tem "checks" adjacente.
- **Guard criado** (`scripts/check-seed-count-literals.mjs`): varre scripts/, docs/, .github/ recursivamente (TEXT_EXTS + SKIP_DIRS node_modules/.git/tool-results/etc) extraindo literais de count EM CONTEXTO e validando contra o conjunto {prod, dev} da derivação. REUSA runDerivation do check-e2e-counts.mjs (fonte única — um só ponto de derivação, nunca literal). Fail-closed: derivação indisponível → exit 1.
- **Padrões anti-falso-positivo** (3 rodadas de review): (1) principal `/(?:^|[^\w-])(\d{2,})\s+checks?\b/gi` — prefixo `[^\w-]` bloqueia "UTF-8 check" (hífen) e números colados; `\d{2,}` bloqueia single-digit ("run 3 checks", flag '1') e deixa teto aberto p/ counts de 4+ dígitos num bump futuro; (2)+(3) ternary ESPECÍFICO da matrix `'prod' && '(\d{2,})'` e `|| '(\d{2,})' }} checks` — ternaries genéricos (SKIP_PRISMA_GENERATE `&& '1'`) não casam. Mock data (CVC 123, endereços, rgba, senhas) e prosa histórica sem "checks" adjacente não são flags.
- **Self-scan tripwire evitado**: o guard varre scripts/ (inclui a si mesmo) — o header usa "N checks" genérico (não "128 checks") para um bump futuro não transformar a doc do guard num tripwire (nota documentada no header).
- **Testes**: `src/lib/__tests__/check-seed-count-literals.test.ts` (7 unit: extract + checkLiterals + fixtures de falsos positivos UTF-8/ternary '1'/mock/prosa) e `check-seed-count-literals-cli.test.ts` (6 CLI: fake repos com stub da derivação — docs stale exit 1, workflow stale exit 1, clean+noise exit 0, derivação falha/JSON inválido fail-closed, repo real exit 0). Bugs reais pegos no caminho: padrão ternary casando `'prod' && '1'` e asserção CLI errada ("divergente" vs "fora da derivação") + escape `\${{` em template literals (esbuild).
- **Wiring**: package.json `check:seed-count-literals`; pr-check.yml job novo `seed-count-literals-guard` (logo após e2e-counts-guard, com setup-bun + node script); docs/GUARDS.md seção 5 atualizada (check-e2e-counts + check-seed-count-literals).

Stage Summary:

- **Guard**: `scripts/check-seed-count-literals.mjs` — varre scripts/, docs/, .github/ por literais de count em contexto fora de {prod: 128, dev: 162}; exit 0 sincronizado / 1 com arquivo:linha + Ação (ou fail-closed se a derivação falhar).
- **Testes**: 13 novos (7 unit + 6 CLI) + regressão check-e2e-counts 8+8 → 29/29 verdes. tsc 0, prettier 0 (6 arquivos), CRLF 0, node --check OK.
- **Validação**: guard real exit 0 ("Counts de seed sincronizados em scripts, docs, .github (prod=128, dev=162)") · check-e2e-counts exit 0 (comentário novo do job não confunde os TARGET_PATTERNS) · check-workflow-refs exit 0 · mutation-jobs exit 0 · hooks-symmetry exit 0 · 3 rodadas de code review (fixes: \d{2,3}→\d{2,} teto aberto, self-scan tripwire do header, \${{ escapes).

---

Task ID: SINGLE-LINE-CONTRATO
<a id="single-line-contrato"></a>
Agent: Buffy (orchestrator — contrato do último ref de count não auditado)
Task: Conferir se o exemplo '128 checks' nos comentários do check-single-line-out-assign.sh (L11/L15) reflete o estado atual dos workflows e documentar o contrato — fechando o último ref de count não auditado.

Work Log:

- **Verificação**: a derivação real dá prod=128, dev=162; `validate-seed-guards-matrix-local.sh` (L143) tem a string exata `cell "Rodando prod E2E (128 checks)..."` — o exemplo do header é ATUAL (não drift). Extração direta via check-seed-count-literals.mjs: 4 literais 128 no arquivo (L11/L15/header novo/fim), zero violações contra {128, 162}.
- **Contrato documentado**: novo bloco 'CONTRATO DE COUNTS' no header do check-single-line-out-assign.sh — o exemplo "128 checks" é um ref VIVO (não ilustração genérica): o check-seed-count-literals.mjs varre TODO o repo e falha se qualquer literal "N checks" sair do conjunto válido {prod, dev}; num bump do seed, o exemplo DEVE ser atualizado junto com os workflows. O bloco de correção no fim do script usa "N checks" genérico de propósito (sem dígito, evita segundo ref a sincronizar).
- **Decisões do review**: referência grep-able (`grep -n 'Rodando prod E2E' scripts/validate-seed-guards-matrix-local.sh`) em vez de "(L143)" hardcoded (drift); parenthetical documentando que o snapshot "hoje" é deliberado — prosa sem "checks" adjacente não é flag (igual à prosa histórica do GUARDS.md).

Stage Summary:

- **Arquivo**: scripts/check-single-line-out-assign.sh — header com bloco CONTRATO DE COUNTS (ref vivo auditado, atualizar em bump).
- **Validação**: bash -n OK · guard real exit 0 (4×128, zero violações) · CRLF 0 · prettier 0 · review SHIP.
- **Estado**: todos os refs de count do repo agora são auditados — os workflows pelo check-e2e-counts, e TODO o repo (scripts/, docs/, .github/) pelo check-seed-count-literals (incluindo os exemplos de doc deste guard).

---

Stage: MUTATION-COORD-UPDATE
<a id="mutation-coord-update"></a>
Agent: orchestrator
Task: Mutation test do contrato de atualização COORDENADA dos counts de seed — prova que o seed-e2e-count.test.ts pega o cenário exato do bug histórico (atualizar SÓ os comentários dos workflows 128→N sem tocar a âncora do teste).

Work Log:

- **Problema**: o incidente 123/128 (anchor stale) mostrou que a doc dos workflows e o anchor do teste precisam ser atualizados JUNTOS num bump — mas não havia prova end-to-end de que a atualização unilateral é pega. O mutation-seed-dev-e2e prova sensibilidade do E2E ao seed; faltava provar a sensibilidade do seed-e2e-count.test.ts à generalização da doc.
- **Script novo**: scripts/test-mutation-coord-update.sh (padrão seed-dev-e2e: backup + trap EXIT com cp, NUNCA git checkout) — CONTROLE (vitest real no seed-e2e-count.test.ts deve passar, exit 0) → mutação in-place dos 3 SCAN_FILES (pr-check.yml, seed-guards.yml, validate-seed-guards-matrix-local.sh): "128 checks"→"N checks" + ternary '128'→'N' (fail-fast se o padrão não existir) → MUTAÇÃO (deve FALHAR com "piso prod violado" — o piso de sites prod ≥ 8 quebra quando os sites somem da extração; o anchor de valor 128 NÃO muda, a derivação é do código). Exit 0 = mutação detectada; 1 = guard cego ou infra.
- **Por que o piso falha**: extractDocumentedCounts perde os sites de prod quando a doc vira "N checks" → o teste "piso de sites documentados por alvo" falha com arquivo:linha. A âncora de sanidade (prod=128) continua passando (vem do código) — prova que o contrato é coordenado, não duplicado.
- **Wiring**: package.json "test:mutation-coord-update" (após test:mutation-seed-dev-e2e) + job mutation-coord-update no seed-guards.yml (checkout + setup-bun + cache node_modules + bun install + run + summary). NÃO vai na matriz node-pura do master mutation-guards (roda vitest real, precisa de node_modules). Sem postgis: teste unitário, não toca banco.
- **Decisões do review**: wording do comentário do job corrigido — "em cópia" → "IN-PLACE no working tree (é assim que o teste lê os arquivos via process.cwd(); cópia em temp quebraria a premissa)".

Stage Summary:

- **Arquivos**: scripts/test-mutation-coord-update.sh (novo) · package.json (script test:mutation-coord-update) · .github/workflows/seed-guards.yml (job mutation-coord-update).
- **Validação**: mutation test real exit 0 (controle OK → mutação DETECTADA "piso prod violado" → 2 failed/20 passed no run mutado → SCAN_FILES restaurados) · bash -n OK · check-mutation-jobs exit 0 (16 mutation tests cobertos) · check-e2e-counts exit 0 (prod=128, dev=162) · prettier --ignore-unknown OK · CRLF 0 · 2 rodadas de review (SHIP).
- **Estado**: contrato de atualização coordenada enforced — um PR que atualize SÓ os comentários dos workflows falha o seed-e2e-count.test.ts no CI, obrigando doc + anchor a andarem juntos.

---

Stage: MUTATION-COORD-UPDATE-B (direção inversa)
<a id="mutation-coord-update-b-direção-inversa"></a>
Agent: orchestrator
Task: Estender o mutation test do contrato coordenado para a DIREÇÃO INVERSA — mutar SÓ a âncora do teste (.toBe(128)→.toBe(129)) sem tocar a doc dos workflows, provando o contrato nas 2 direções em um único script.

Work Log:

- **Cenário A (já existia)**: doc dos workflows 128→N (SCAN_FILES) → teste deve FALHAR com "piso prod violado" (sites de prod somem da extração).
- **Cenário B (novo)**: muta SÓ a âncora de sanidade do teste (`.toBe(128)` → `.toBe(129)` no seed-e2e-count.test.ts) com backup + sed in-place; verifica que a doc ficou INTACTA ("128 checks" presente — a falha tem que vir só da âncora, isolando a causa); roda o vitest real e exige FALHA com "anchor prod desatualizado" (a derivação real continua 128, o literal esperado virou 129). Fail-fast se o padrão `.toBe(128)` não existir (teste refatorado → mensagem clara em vez de guard cego).
- **Refactor do script**: restore dividido em restore_scan/restore_anchor/restore_all (backup keys scan-$i e anchor); helper expect_failure() compartilhado com o veredicto de 3 casos (exit 0 = guard cego; falhou mas asserção errada = infra; asserção certa = detectado); restore_scan explícito entre cenários (B precisa da doc íntegra); restore_anchor explícito antes das mensagens finais (claim verdadeiro no print; trap EXIT redundante e seguro).
- **Wiring**: seed-guards.yml — job mutation-coord-update renomeado para "contrato coordenado — doc↔anchor, 2 direções", comentário e Publish summary com 2 linhas (A e B). Script name inalterado → check-mutation-jobs continua cobrindo (16 tests).

Stage Summary:

- **Arquivos**: scripts/test-mutation-coord-update.sh (2 direções) · .github/workflows/seed-guards.yml (job + summary 2 direções).
- **Validação**: mutation test real exit 0 (controle OK → A detectado "piso prod violado" → B detectado "anchor prod desatualizado" → todos os arquivos restaurados; git status só mostra os 2 arquivos intencionais) · bash -n OK · prettier --ignore-unknown OK · CRLF 0 · check-mutation-jobs exit 0 (16 cobertos) · check-e2e-counts exit 0 · 2 rodadas de review (SHIP + nit de restore aplicado).
- **Estado**: contrato de atualização coordenada enforced nas 2 direções — doc sem anchor e anchor sem doc falham o seed-e2e-count.test.ts no CI, obrigando os dois lados a andarem juntos em qualquer bump.

---

Stage: MUTATION-COORD-2ELOS (guard estático + vitest)
<a id="mutation-coord-2elos-guard-estático--vitest"></a>
Agent: orchestrator
Task: Fechar os DOIS elos da cadeia de validação no mesmo mutation test — rodar o guard estático check-e2e-counts.mjs contra a doc mutada e exigir que ele FALHE com exit 1, além do vitest.

Work Log:

- **Achado empírico ANTES do fix**: o guard estático NÃO falhava na doc generalizada 128→N — a extração (extractDocumentedCounts) perdia TODOS os sites de prod ("N checks" não casa `\d+ checks`), zero sites encontrados = zero violações no checkCounts → exit 0 ("✅ sincronizados") com a doc esvaziada. Blind spot REAL: só o piso do vitest pegava.
- **Guard estendido**: MIN_DOCUMENTED_SITES={prod:8, dev:6} (MESMO piso do seed-e2e-count.test.ts) + função pura checkSitePisos(documented, minimums) → main() agrega allDocumented nos SCAN_FILES e sai com exit 1 ("piso por alvo violado") quando um alvo fica abaixo do piso. Mensagem de ação clara (restaure o site ou ajuste o piso se a simplificação foi legítima/deliberada).
- **Mutation test com 2 elos**: GUARD_CMD=(node scripts/check-e2e-counts.mjs) + expect_failure reusado (mensagem CEGO generalizada para "a validação passou" — antes dizia "seed-e2e-count.test.ts passou", enganoso quando o GUARD é quem passa). CONTROLE roda vitest E guard (ambos exit 0); CENÁRIO A exige que AMBOS falhem (vitest 'piso prod violado' + guard 'piso por alvo violado'); CENÁRIO B exige que o guard PASSE com a doc íntegra (exit 0) — isolando a causa da falha na âncora e provando que o guard não quebrou (falha de A vem SÓ da doc mutada).
- **Wiring**: seed-guards.yml job mutation-coord-update — comentário + step name atualizados ("2 direções, 2 elos"). Script name inalterado → check-mutation-jobs continua cobrindo (16).
- **Fixtures do checkSitePisos**: os 2 testes que falharam primeiro passavam só sites de prod — o checkSitePisos valida AMBOS os alvos (alvo ausente = found 0 = violação); fixtures corrigidas com dev no piso para isolar a violação de prod.

Stage Summary:

- **Arquivos**: scripts/check-e2e-counts.mjs (piso + header) · src/lib/**tests**/check-e2e-counts.test.ts (+4 testes) · scripts/test-mutation-coord-update.sh (2 elos) · .github/workflows/seed-guards.yml (comentário).
- **Validação**: mutation test exit 0 ×3 (controle vitest+guard pass → A: ambos falham com seus pisos → B: vitest falha 'anchor prod desatualizado' + guard exit 0 → arquivos restaurados; git status só com os 4 arquivos intencionais) · vitest 37 passados (2 suites) · guard real exit 0 · node --check OK · prettier --ignore-unknown OK · CRLF 0 nos 4 arquivos · check-mutation-jobs exit 0 (16 cobertos) · 3 rodadas de review (SHIP).
- **Estado**: os 2 elos da cadeia agora concordam — um PR que generaliza a doc dos workflows falha o guard estático (piso) E o teste de integração (piso) no mesmo mutation test; a âncora mutada falha o vitest com o guard passando (causa isolada).

---

Stage: MUTATION-COORD-MEASURE (overhead por PR)
<a id="mutation-coord-measure-overhead-por-pr"></a>
Agent: orchestrator
Task: Medir o tempo real do job mutation-coord-update (payload) e documentar o overhead por PR na seção de mutation tests do docs/GUARDS.md.

Work Log:

- **Limitação honesta**: gh NÃO está autenticado neste worktree ("auth fantasma" já documentado; repo privado → API sem token dá 404). Timings reais do GitHub Actions não puderam ser buscados — o padrão do repo (README) é act como proxy CI com caveat explícito. O job roda em ubuntu-latest (NÃO usa a imagem ubuntu-bun — essa é só do tier-1 local/act), então não há pull de imagem custom no CI deste job.
- **Medições locais (Windows host)**: payload do mutation test = **21s** total (3 vitest: controle 5.0s + A 3.4s + B 3.4s + 3 guard runs ~0.3-0.4s cada) · bun install warm = 7s · guard isolado ~320-408ms.
- **Proxy act (imagem catthehacker em cache)**: checkout 24.6s* · setup-bun composite 36.6s* (cache emulado 26.0s) · cache node_modules 19.0s* · bun install 5m58s* (frio, emulado) · **payload mutation test 17.1s** · summary 0.8s. O act travou no "Post Cache node_modules" (tar do cache emulado — overhead pós-step que não existe no CI real). * = overhead de emulação.
- **Número confiável**: payload do mutation test **~17-21s por PR** (17.1s container / 21s local) — os demais componentes (checkout/setup-bun/cache/install) são os mesmos de qualquer job com bun install (~1-2s cada no CI real).
- **Doc**: docs/GUARDS.md seção 3 (Mutation tests) ganhou sub-bloco "Overhead por PR do job mutation-coord-update (medido 08/2026)" com tabela Local × act × CI real, caveats de emulação (marcados * e nota ¹ do setup-bun tier-2) e o aviso de auth fantasma.

Stage Summary:

- **Arquivo**: docs/GUARDS.md (sub-bloco de overhead na seção 3).
- **Validação**: prettier --ignore-unknown OK · CRLF 0 · check-readme-anchors docs/GUARDS.md exit 0 (15 headings, forward) · check-readme-toc exit 0 · review SHIP.
- **Estado**: overhead por PR documentado com evidência (payload 17-21s) e sem overclaim — timings reais do GH Actions pendentes de gh auth (comando de medição documentado no padrão do repo).

---

Stage: BARREL-LINT-PRE-LINTSTAGED
<a id="barrel-lint-pre-lintstaged"></a>
Agent: orchestrator
Task: Mover o barrel-lint (guard de headers Usage/Exit codes nas 50 primeiras linhas) para ANTES do lint-staged no pre-commit — a violação de header pega com arquivo:linha cedo, sem o prettier já ter reformatado o working tree.

Work Log:

- **Problema**: no commit anterior o barrel-lint travou o commit com 3 scripts sem header válido — mas rodava DEPOIS do lint-staged (o prettier já tinha reformatado o working tree quando o erro aparecia). Pedido: reordenar para falhar cedo.
- **Mudança**: .husky/pre-commit — `bun run barrel-lint` movido de depois para ANTES do `bun x lint-staged` (ordem: staged bun-guard → staged mutation-jobs → run-encoding-guards → barrel-lint → lint-staged → direct-rtl-import → typecheck → snapshot). Comentário atualizado com o rationale.
- **Prova imediata do valor**: o barrel-lint reordenado pegou de cara uma violação REAL pré-existente — scripts/test-mutation-coord-update.sh com o bloco Usage/Exit codes além da linha 50 (a prosa dos 2 elos empurrou o bloco para baixo; mesma classe de erro que travou o commit anterior). Corrigido movendo o bloco para logo após o título (conteúdo idêntico, posição correta — padrão dos outros scripts corrigidos).
- **Sem impacto de simetria**: o check-hooks-symmetry é order-independent (presença, não ordem) — tabela README continua batendo (16 compartilhados + reverse OK).

Stage Summary:

- **Arquivos**: .husky/pre-commit (reordenação) · scripts/test-mutation-coord-update.sh (header Usage/Exit codes movido para o topo).
- **Validação**: bash -n OK (ambos) · bun run barrel-lint exit 0 (antes exit 3 com a violação do coord-update — o reorder provou o valor imediatamente) · check-hooks-symmetry exit 0 · CRLF 0 · prettier --ignore-unknown OK · mutation test exit 0 (header movido não quebrou nada; arquivos restaurados) · review SHIP.
- **Estado**: violação de header agora falha o pre-commit ANTES do lint-staged, com arquivo:linha — o dev corrige sobre o working tree limpo, não sobre arquivos já formatados pelo prettier.

## MUTATION-COORD-CENARIO-C — triângulo doc↔anchor↔código fechado (08/2026)

- scripts/test-mutation-coord-update.sh: +CENÁRIO C — muta a DERIVAÇÃO de verdade
  (sed comenta a 1ª asserção `expect(` real do scripts/test-seed-prod-e2e.ts via
  `0,/^[[:space:]]*expect(/s//\/\/ MUTATION-C: expect(/` → prod cai 128→127). Doc
  dos workflows E âncora do teste verificados INTACTOS (isolamento) → vitest deve
  falhar com "cada count documentado bate" E guard estático com "divergente(s)
  entre workflows e derivação" (2 elos). restore_derivation + trap EXIT.
- Header/pipeline/exit-codes/banner atualizados para o triângulo de 3 direções.
- .github/workflows/seed-guards.yml: job mutation-coord-update renomeado para
  "doc↔anchor↔código, 3 direções"; comentário, step e summary com a linha C.
- Validação: mutation test exit 0 (A piso 2 elos, B sanidade guard passa, C
  derivação 2 elos), vitest 37/37, barrel-lint 0, prettier 0, CRLF 0, review SHIP.

## MUTATION-COORD-CENARIO-D — independência do teste vs guard (08/2026)

- scripts/test-mutation-coord-update.sh: +CENÁRIO D (4º) — prova que o vitest
  do seed-e2e-count NÃO depende do guard estático: muta a doc (128→N, como em
  A) E neutraliza o piso do guard (GUARD_PISO_PATTERN { prod: 8, dev: 6 } →
  { prod: 0, dev: 6 } via sed no check-e2e-counts.mjs). Com piso zero e sem
  sites de prod para divergir, o guard fica CEGO (exit 0, verificado) mas o
  vitest CONTINUA falhando ("piso prod violado") — o piso do TESTE é próprio
  (hardcoded ≥ 8 no seed-e2e-count.test.ts), não herdado do guard.
- restore_guard + trap EXIT; header/pipeline/banner/result para 4 cenários.
- .github/workflows/seed-guards.yml: job renomeado "4 cenários"; comentário,
  step e summary com a linha D (independência).
- Validação: mutation test exit 0 ×2 (A piso 2 elos, B sanidade guard passa,
  C derivação 2 elos, D independência guard cego), vitest 37/37, barrel-lint 0,
  prettier 0, CRLF 0, guard real exit 0 com piso restaurado, review SHIP ×2.

## MUTATION-COORD-CENARIO-E — contrato estendido ao count de DEV (08/2026)

- scripts/test-mutation-coord-update.sh: +CENÁRIO E (5º) — o contrato de
  atualização coordenada agora vale para AMBOS os counts: além de prod (128,
  cenário A), o DEV (162) também é auditado. MUTATION_SED_DEV ("162 checks"
  → "N checks" + ternary '162' → 'N') ataca SÓ os sites de dev (5
  literais + o ternary dev do seed-guards.yml L211); prod ("128 checks") e a
  âncora dev (.toBe(162)) ficam INTACTAS (isolamento verificado) → vitest
  falha com "piso dev violado" (hardcoded ≥ 6 no seed-e2e-count.test.ts) E
  guard falha com "piso por alvo violado" (dev 0 < 6) — os 2 elos no par.
- Header/pipeline/banner/result para 5 cenários; fail-fast "162 checks".
- .github/workflows/seed-guards.yml: bullet (E), job "5 cenários", step,
  summary com a linha E (contrato p/ prod E dev).
- Validação: mutation test exit 0 ×2 (5 cenários, pós-prettier), vitest 37/37,
  barrel-lint 0, prettier 0, CRLF 0, guard real exit 0, 162 restaurado,
  review SHIP ×2. Prosa "162 checks" no comentário (E) confirmada INERTE
  (nenhum TARGET_PATTERN extrai; guard/vitest exit 0).
- MUTATION-COORD-ACT-CI (08/2026): rodado o job mutation-coord-update via act com a
  imagem ubuntu-bun:1.3.14. O run REVELOU um bug real de portabilidade: no container
  (GITHUB_ACTIONS=true) o reporter padrão do vitest vira o github-actions, que
  URL-encodea o TITLE do ::error (espaços → %20); o EXPECTED_FAILURE_DERIVATION
  ('cada count documentado bate') é o NOME do teste (no title), então o grep do
  cenário C não achava a asserção (cenários A/B/D/E falham por mensagens no body,
  não-encoded). FIX: VITEST_CMD ganhou --reporter=basic (determinístico em qualquer
  ambiente — testado com decoy: nome literal 3x, 0 %20, mesmo com GITHUB_ACTIONS).
- Validação pós-fix: mutation test exit 0 local com GITHUB_ACTIONS=true (5 cenários,
  arquivos restaurados) E no container via act (log '✅ Mutation test passou',
  summary com os 5 cenários ✅, step 'Success [4m37.56s]'; o job foi morto pelo
  timeout de 900s SÓ no Post Cache emulado — tar do bind mount, pós-step, não existe
  no CI real). setup-bun atingiu tier-1 fast path ('Bun já instalado no runner').
- GUARDS.md (seção 3): tabela de overhead atualizada do estado stale ('2 direções',
  3 vitest runs, 17.1s) para o real de 5 cenários: local medido 51s, act/ubuntu-bun
  4m37.6s (overhead de emulação /mnt/c documentado), CI real ~35-45s (estimado, a
  medir com gh). Prettier reflow fundiu uma linha da tabela — corrigido e revalidado
  (8 linhas × 6 campos, prettier 0, CRLF 0, anchors/toc/images 0). Review SHIP ×4.
- README-MUTATION-COORD-CI (08/2026): pedido de medir o tempo REAL do job
  mutation-coord-update no CI via gh run view. MEDIÇÃO BLOQUEADA e confirmada:
  gh sem auth (hosts.yml ausente — auth fantasma), repo PRIVADO (API sem auth →
  404), nenhum GH/GITHUB_TOKEN em .env/env. Premissa do pedido ('3 execuções de
  vitest: controle + 2 cenários') estava OBSOLETA — o job roda 5 cenários (A–E)
  = 6 runs de vitest + 6 do guard (corrigido na doc). Entregue a parte
  documentável: bloco novo no README (seção Git Hooks) 'Overhead do job
  mutation-coord-update' com local 51s (medido), act+ubuntu-bun 4m37.6s (step),
  CI real '~35-45s (est.)¹ pendente de medição real' + one-liner gh para quando
  autenticado + comparação ~16× vs 16 fast gates (3.2s). Prettier 0, CRLF 0,
  anchors/toc/images 0, hooks-symmetry 0, badge 0. Review SHIP ×2.
- AUTH-FANTASMA-RESOLVIDO (08/2026): `gh auth login` completado NO ambiente do
  worktree com autorização humana (device flow: código 6125-781F em
  https://github.com/login/device → hosts.yml GRAVADO em %AppData%\GitHub CLI).
  Confirmado: conta severinno, scopes 'gist','read:org','repo', gh api exit 0.
  O bug documentado em Bugs conhecidos era FALTA de interação humana, não falha
  do gh — a entrada do README foi marcada RESOLVIDO com a evidência.
- MEDICAO-CI-MUTATION-COORD (08/2026): o one-liner de medição (gh run view
  --jq) foi VALIDADO de ponta a ponta num run real (bench-setup-bun 30765242263:
  timings reais de steps capturados). MAS mutation-coord-update NUNCA rodou no
  CI real: seed-guards.yml não existe na branch default (release/v0.4.0 — só
  neste branch do worktree, nunca mergeado) → GitHub API 404, zero runs. A
  estimativa ~35-45s da tabela de overhead NÃO pôde ser substituída por dado
  real — o bloqueio mudou de 'gh sem auth' para 'workflow não mergeado'. Docs
  atualizadas: README (bloco mutation tests + footnote ¹ + Bugs conhecidos) e
  GUARDS.md seção 3 com o estado verdadeiro. Prettier 0, CRLF 0, anchors/toc/
  images 0, hooks-symmetry 0, badge 0, zero ocorrências de 'gh sem auth'.
- MUTATION-COORD-TIMING-JOB (08/2026): re-medição SEMANAL do tempo real do step
  'Run mutation test (contrato coordenado)' do seed-guards.yml SEM depender de
  auth local — o gh do runner usa o GITHUB_TOKEN do próprio Actions. Novo
  scripts/measure-mutation-timing.mjs (node puro): extrai o step do payload da
  jobs API pelos MARKERS de contrato (JOB/STEP_NAME_MARKER = nomes reais do
  seed-guards.yml), modos --jobs-file (teste/fixtures) e --run (spawn gh api
  repos/X/actions/runs/<id>/jobs --per-page 100, retry 5×10s inclusive em erro
  transiente, sleep via Atomics.wait), exit 0 achado / 1 infra fail-closed /
  2 drift de contrato ('não achado' não é 'limpo'). Novo job mutation-coord-
  timing no benchmark-weekly.yml: needs: seed-guards + if: always() (mede
  também quando o seed-guards falhou — timeout é o alvo), permissions actions:
  read, GH_TOKEN: ${{ github.token }}, --run github.run_id (jobs do reusable
  workflow aparecem no run do chamador), artifact + Summary (if: always()).
  Testes: 16 unit (extract/compute/CLI real incl. infra exit 1 e drift exit 2)
  - 13 snapshot de workflow (YAML, contrato needs/if/permissions/GH_TOKEN,
    markers vs seed-guards.yml com busca por sufixo exato — o arquivo tem DOIS
    jobs 'Mutation Test', seed-dev-e2e vem antes; refs vs check-workflow-refs).
    Review: 1 blocking (markers .find pega o job errado) + 1 médio (--paginate
    quebra com >30 jobs: gh aplica jq por página e concatena objetos → JSON
    inválido; trocado por --per-page 100) + barrel-lint (header exigia 'Usage:'
    literal, usava 'Uso:') — todos corrigidos. 29/29 testes, prettier 0, barrel-
    lint 0, refs 0, anchors/toc/images/hooks-symmetry/badge 0, CRLF 0, .snap
    criado (benchmark-weekly-mutation-timing-workflow.test.ts.snap — incluir no
    commit). Review final SHIP ×2.
- MUTATION-COORD-TIMING-BUDGET (08/2026): GATE de budget de payload do step
  'Run mutation test (contrato coordenado)' — falha se ultrapassar 180s (3
  min), prevenindo regressão de overhead do contrato coordenado ANTES do
  merge. Timing NATIVO do Actions (started_at/completed_at da jobs API — o
  mesmo da UI), medido pelo measure-mutation-timing.mjs com a nova flag
  --max SECS (relatório ganha budgetSecs + exceeded; exit 1 fail-closed) e
  --warn-only (::warning:: + exit 0 — alerta não-bloqueante p/ dispatch).
  Gate: novo job mutation-coord-timing-guard no pr-check.yml (needs:
  seed-guards + if: always(), permissions actions: read, GH_TOKEN,
  --max 180, artifact + Summary com linha EXCEDIDO) + o semanal
  mutation-coord-timing (benchmark-weekly.yml) agora também passa --max 180
  (re-gateia semanalmente). Testes: +6 unit de budget (dentro/fora/warn-only/
  uso inválido — 22 no total) + novo pr-check-mutation-timing-guard-workflow.
  test.ts (snapshot: contrato needs/if/permissions/--max 180/not --warn-only)
  - weekly atualizado (asserção --max 180) + snapshots regenerados (-u).
    README: parágrafo 'Budget de payload (gate 180s)' no bloco de overhead —
    fonte da verdade com os 4 lugares coordenados de tuning (2 jobs + 2 testes)
    e o racional de ~4× headroom (~35-45s esperado). Corrigidos no review: 2
    testes (--help com strings novas de exit code; parse do JSON do budget —
    regex de chaves, o merge stdout+stderr poluía o slice) + ::error:: no gate
    (convenção do repo) + doc gap do README (a nota TUINING referenciava o
    README como fonte da verdade sem o bloco existir). 45/45 testes (22+13+10),
    prettier 0, barrel-lint 0, refs 0, guards de docs 0, CRLF 0, 2 .snap
    presentes. Review SHIP ×2.

## Overhead consolidado de TODOS os gates por PR (README, 08/2026)

Extensão da seção Git Hooks/CI do README com o custo real de TODOS os
gates pesados do pr-check.yml + e2e-cache.yml, na metodologia do repo
(mediana 3 runs warm local + act com ubuntu-bun --pull=false):

- Tabela de mutation tests atualizada: master agora 10 sub-tests (era 9 —
  o cenário workflow-refs já existia), local ≈40.75s (39.5–42.9, mediana
  3 warm) vs 15.8s antigo de 5 sub-tests, step act ≈9.1s (era 4.4s);
  footnote ² com a re-medição completa (actionlint 3.61s, utf8-check
  7.46s no mesmo atmo).
- NOVA tabela consolidada 'Custo de TODOS os gates por PR': 16 fast
  guards 3.2s · utf8-check 0.92s/7.46s · actionlint 0.51s/3.61s ·
  mutation-guards 40.75s/9.1s · mutation-coord-update 51s/4m37.6s
  (CI ~35-45s est.) · e2e-cache 4m6s só build (1 run, condicional via
  paths no trigger, timeout 15min). Pior caso node-puro ≈1m32s vs 3.2s
  dos fast guards — por design (cada mutation roda o guard REAL).
- Honestidade nos nits do review: checkout@v4 0.03s quente/32.2s frio
  (footnote * separa os dois runs do act), e2e-cache marcado como 1 run
  (não estabilizado), footnotes ²/¹/³ desambiguadas entre as 3 tabelas.
  Validação: prettier 0, CRLF 0, 7 guards de docs 0 (anchors/toc/images/
  hooks-symmetry/badge/reverse-baseline/seed-count-literals). Review SHIP ×2.

## Guard de default branch — workflows de medição mergeados? (08/2026)

Previne o falso estado 'pendente de medição' que ocorreu neste thread: o
gh run list --workflow=seed-guards.yml responde '404: workflow not found
on the default branch' quando o workflow NÃO foi mergeado — o bloqueio
real é o MERGE, não a falta de run. Novo guard scripts/check-default-
branch-workflows.mjs (node-puro) valida via gh api que os workflows de
medição (default: seed-guards.yml) EXISTEM na branch default do repo.

- Exit codes fail-closed: 0 = todos presentes; 1 = AUSENTE (GATE com
  ::error:: citando MERGE + o 404 — causa raiz explícita); 2 = infra
  (gh indisponível/API) ou uso. Flags: --repo (default GITHUB_REPOSITORY),
  --workflow (repetível), --default-branch (override — evita chamada gh),
  --fixture-dir (modo TESTE determinístico, classe do --jobs-file),
  --json, --warn-only (::warning:: + exit 0). Exports puros testados:
  extractDefaultBranch, classifyExistenceCheck (404=ausente apenas porque
  o caller resolve a branch primeiro — assunção documentada), e a const
  DEFAULT_MEASUREMENT_WORKFLOWS.
- Job semanal default-branch-workflow-guard no benchmark-weekly.yml:
  permissions contents: read, GH_TOKEN github.token, --repo
  github.repository --workflow seed-guards.yml, artifact + Summary
  (if: always(), linha 'BLOQUEIO REAL'). Comentário no job explica por
  que NÃO passa --default-branch (schedule tem github.event.repository
  VAZIO — resolve via gh api, único caminho confiável no cron).
- Testes 38/38: 17 unit (funções puras + CLI com fixtures: presente→0,
  ausente→1 com MERGE/404, warn-only→0, multi-workflow, infra→2,
  sem args→2, --help, --json, override de branch) + 8 do workflow
  (snapshot + contrato GH_TOKEN/invocação/artifact/summary + asserção do
  header com normalização que remove marcadores '//' — o /\s+/ sozinho
  deixava '//' literal no meio da frase) + 13 de regressão do timing.
- Review: 2 rodadas SHIP (nits aplicados: comentário do schedule no job,
  assunção 404 no docstring; 1 teste quebrado corrigido com strip de
  '// ' por linha antes do toContain). Validação: vitest 38/38, prettier
  0, barrel-lint 0, check-workflow-refs 0, node --check OK, CRLF 0,
  guards de docs 0, .snap criado.

## Device flow humano documentado (README, seção medição do setup-bun, 08/2026)

Passo a passo EXATO do gh auth device flow na seção 'Fluxo completo
(auth → push → medição → cleanup)' do setup-bun — para o 'auth fantasma'
não voltar em ambientes futuros: blockquote com 4 passos (1. gh auth
login --web imprime o código de um só uso; 2. abrir github.com/login/
device e digitar o CÓDIGO exibido pelo CLI (não o token); 3. autorizar
com scopes repo+workflow; 4. hosts.yml gravado + auth status completa) + ⚠️
alerta: o código EXPIRA em ~15 min — sem autorização humana o processo
fica pendurado, o token nunca é gravado (sintoma do auth fantasma) e é
preciso reiniciar com gh auth login --web (código NOVO). Menciona o
preflight --dry-run (exit 4 = API bloqueada) e linka #bugs-conhecidos.
Passo 1 do bash atualizado para gh auth login --web (era gh auth login).
Review SHIP com 1 nit de convenção (⚠️ dentro do bold: '> **⚠️ ...' —
padrão do repo) aplicado. Validação: prettier 0, CRLF 0, 7 guards de
docs 0.

## Mutation test do gate de budget 180s (timing-budget, 08/2026)

Prova o GATE de overhead do contrato coordenado end-to-end no CI (não só
no teste unitário): scripts/test-mutation-timing-budget.sh gera fixtures
da jobs API em mktemp com os MARKERS reais do seed-guards.yml e valida 3
direções do measure-mutation-timing.mjs --max 180: CONTROLE 35s → exit 0

- exceeded:false (gate não é over-eager); MUTAÇÃO 300s → exit 1 +
  'budget de payload EXCEDIDO' + exceeded:true (regressão DETECTADA — o
  contrato coordenado ficou lento e ninguém percebeu); WARN-ONLY mesma
  mutação → exit 0 + ::warning:: (alerta sem mascarar a detecção). Sem
  tocar arquivos reais (fixtures em mktemp, trap EXIT). Wire no master:
  SUBTESTS ganhou a entrada timing-budget (11 no total) + comentário da
  matriz + mensagem final; check-mutation-jobs cobre transitivamente via
  matriz do master (JOBS:0). README: 10→11 sub-tests em 4 pontos (lista
  L739, tabela L751, footnote ² — reescrita sem run-on: medição com os 10
  originais + nota do 11º adicionado depois, 'fixtures JSON em mktemp' em
  vez do impreciso 'git reais' —, tabela consolidada L837). Nits do review
  aplicados: header do master 10→11; diagnóstico de DRIFT DE CONTRATO
  (exit 2 — markers não casam) separado de GUARD CEGA no caminho de falha.
  Validação: bash -n OK, granular exit 0, master --scenario exit 0, --list
  = 11, prettier 0, CRLF 0, guards de docs 0, refs 0. Review SHIP ×2.

### [08/2026] Gate de budget em DUAS FAIXAS (--max 240 duro + --warn 180 soft)

Extensão do measure-mutation-timing.mjs: faixa SOFT (warn < d <= max) emite
::warning:: + exit 0 (zone 'warn' — ruído de runner tolerado SEM perder o
gate); faixa DURO (d > max) continua ::error:: + exit 1 (zone 'fail'). O
relatório ganha warnSecs/zone/warned. Validações: --warn exige --max; --warn
deve ser < --max; usage() documenta 'budget duro excedido'. Coordenação:
pr-check.yml + benchmark-weekly.yml passam --max 240 --warn 180; Summary dos
2 jobs agora imprime zone (fail/warn/ok) + duração com ambos os budgets;
comentário TUINING DO BUDGET reescrito (240/180, cinco lugares). Mutation
test test-mutation-timing-budget.sh: 4 direções (CONTROLE 35s→zone ok, FAIXA
SOFT 200s→exit 0 + ::warning:: + zone warn, MUTAÇÃO 300s→exit 1 + zone fail,
WARN-ONLY→exit 0); BUDGET_MAX=240/BUDGET_WARN=180. README: parágrafo Budget
reescrito com as duas faixas + limites exatos (soft: warn < d <= max — d==max
é warn; dura: d > max) + cinco lugares coordenados (inclui constantes do
mutation test). Nome do job/step alinhado para 'budget 240/180s'. Validação:
bash -n OK, mutation granular exit 0 (4 direções), vitest 51/51 (unit 23 + 2
workflow 28) com snapshots regenerados, prettier 0, CRLF 0, guards de docs 0,
refs 0, scan de stale 180s limpo. Review SHIP ×2 (nits aplicados: asserção
--help 'budget duro excedido', 5º lugar coordenado no README, ordenação do
nome, precisão do limite).

## [2026-08-05] Medição do budget do mutation test VIA ACT (--act-log) — PRs sem seed-guards na default

Adicionado ao measure-mutation-timing.mjs o modo `--act-log FILE` + `--act-exit CODE`:
re-execução do job mutation-coord-update via act (imagem ubuntu-bun) e extração da
duração do step da linha 'Success - Main Run mutation test ... [X.XXs]' (reusa
extractDurationFromLine do check-setup-bun-common.mjs — mesma técnica do tier1).
Cobre PRs que ainda NÃO têm o seed-guards.yml na branch default (reusable não roda
no CI real → jobs API não mede). --act-exit != 0 sem evidência = act morreu antes do
step (infra, exit 1 com diagnóstico); exit 0 sem evidência = drift (exit 2). O MESMO
gate de duas faixas (--max 240 --warn 180).

Novo job mutation-coord-timing-act-guard no pr-check.yml: path filter
origin/main...HEAD, act v0.2.89 pinado, --eventpath mínimo ({workflow_call:{}}) para
o seed-guards.yml workflow_call-only, -P imagem ubuntu-bun, ACT_EXIT → GITHUB_OUTPUT,
guard com --act-log --max 240 --warn 180 --act-exit. permissions packages: read.

Refactor do review: bloco de gate duplicado (~30 linhas) extraído para o helper
compartilhado applyBudgetGate(report, args, stepName, viaSuffix) — fonte única da
verdade das zonas (ok/warn/fail) entre os modos jobs-file/run e act-log; validação
--act-exit exige --act-log (simétrica ao --warn exige --max) + teste unitário.

Testes: pr-check-mutation-timing-act-workflow.test.ts (novo, snapshot + contrato);
measure-mutation-timing.test.ts ganhou seção 1b extractMutationStepFromActLog + 5b
CLI --act-log + validação --act-exit; mutation test timing-budget agora com 7 direções
(+act-log 300s fail, 35s ok, infra exit 1). README: 'sete lugares coordenados'.

Fix barrel-lint: headers do measure-mutation-timing.mjs e test-mutation-guards.sh
tiveram Usage:/Exit codes: movidos para as 50 primeiras linhas (a doc do --act-log e
a entrada timing-budget na matriz os tinham empurrado para fora).

Validação: bash -n OK, mutation granular exit 0 (7 direções), vitest 76/76 (unit +
3 workflow tests), prettier 0, barrel-lint 0, CRLF 0, 6 guards de docs 0, refs 0.
Review SHIP ×2 (nits aplicados: helper applyBudgetGate, validação --act-exit, teste
do nit, headers < 50 linhas).

## [2026-08-05] Baseline auto-atualizado do budget (--publish-baseline via gh variable set)

Estendido o measure-mutation-timing.mjs para PUBLICAR o tempo real medido como
repository variable quando o budget passa — o gate consulta a variável em vez do
literal 180, tolerando variação de runner.

Script: flags --publish-baseline NAME (regex ^[A-Z][A-Z0-9_]_$; rejeitado com
--act-log) + --baseline-margin FRAC (default 0.2; exige --publish-baseline).
computeBaselineValue(duration, margin, max) = ceil(d_(1+margin)), min 1s, clamp
para SEMPRE < max (faixa warn nunca vira vazia). maybePublishBaseline spawna
'gh variable set NAME <valor> --repo <repo>' (GH_TOKEN do env); FAIL-SOFT
(::warning:: + published:false, exit inalterado); dry-run para testes via env
MEASURE_MUTATION_TIMING_DRY_PUBLISH=1 (published:'dry-run'). Trigger dentro do
applyBudgetGate (após zone) — publica SÓ quando zone != fail (run lento não
ratcheta o baseline). Report ganha baseline: {name, value, published}.

Workflows: benchmark-weekly mutation-coord-timing agora com permissions actions:
WRITE (gh variable set), --warn ${{ vars.MUTATION_TIMING_BASELINE || '180' }} +
--publish-baseline MUTATION_TIMING_BASELINE --baseline-margin 0.2. pr-check
(mutation-coord-timing-guard + mutation-coord-timing-act-guard) renomeados para
'budget 240/baseline', consultam a var (fallback 180) e NÃO publicam (PR não
muta repo state).

Testes: unit (computeBaselineValue pura com clamp, validações de parseArgs,
CLI dry-run: 35s→baseline 42 published dry-run; 300s fail→sem baseline+exit 1);
3 workflow tests (asserções --warn baseline var + publish no semanal + sem
publish no PR + nomes); mutation test timing-budget agora com 9 direções
(+PUBLISH: 35s→42 publicado, 300s→não publica). Snapshots regenerados (nomes de
jobs mudaram). README reescrito (baseline var, semanal publica, tuning = max +
margem; baseline em si auto-atualiza).

Review 8 rodadas (SHIP): bug crítico da validação de --baseline-margin (presença
explícita via null default + ?? 0.2) corrigido; nits aplicados (param morto,
Summary title, header < 50 linhas para barrel-lint, NOVE direções, typo,
convenção uppercase, refs stale).

Validação: bash -n OK, mutation granular exit 0 (9 direções), vitest 85/85 (4
arquivos, snapshots regenerados), prettier 0, barrel-lint 0, CRLF 0, 6 guards de
docs 0, workflow-refs 0, stale-scan limpo (só menções intencionais de fixtures).

Round 9 (fechamento do baseline auto-atualizado): aplicados os 2 últimos nits do
review — (1) validação `--publish-baseline exige --max` no parseArgs (era no-op
silencioso sem --max: maybePublishBaseline só dispara dentro do applyBudgetGate,
que retorna cedo quando max é null) + teste unitário novo (exit 2 com a mensagem
exata); (2) Summary do semanal agora exibe baseline.published. Review 9 SHIP com
1 nit de paridade de doc (header do --publish-baseline agora diz 'Exige --max',
paridade com o --warn) + nota de verificação (o 4º arquivo de teste,
pr-check-mutation-timing-act-workflow.test.ts, estava fora da bateria por nome
errado — rodado: 86/86). Prettier --write aplicado em 2 arquivos (reformat
neutro), prettier --check 0 em 9 arquivos, vitest pós-reformat 86/86, CRLF 0,
barrel 0, guards de docs 0, workflow-refs 0.

---

Task ID: COMMIT-6A900E1
<a id="commit-6a900e1"></a>
Agent: orchestrator (commit local 6a900e1)
Task: Commit 6a900e1 — guards de dependências + fix do rate-limit do /api/chat (20 arquivos).

Work Log:

## [2026-08-06] Commit 6a900e1 — guards de dependências + fix do rate-limit do /api/chat (20 arquivos)

Commit local na branch `freebuff/new-thread-thms5x3m7xt8k4` (8 novos + 12 modificados,
+3091/−57), estilo `feat:` pt-BR do repo. Corpo coeso: higiene de dependências +
fronteira de imports + primeiros testes da rota de chat.

### Escopo do commit

- **check-no-leaked-imports.mjs (novo, ~600 linhas)**: import bare que resolve para
  FORA do node_modules do worktree falha exit 1 — o bug do `z-ai-web-dev-sdk`
  mascarado pelo node_modules do PROJETO PAI (worktree aninhado em
  C:/PROJETOS/severinno/). Achou `pg@8.22.0` usado pelo geo-benchmark-gist sem
  declarar no package.json (job semanal quebraria no CI limpo) — declarado junto
  com z-ai-web-dev-sdk@0.0.18. 19 testes unit + CLI + mutation test (3 cenários:
  leak do pai / dep inexistente / install pendente passa) + 15º sub-test do master.
- **check-unused-deps --staged**: dep órfã INTRODUZIDA pelo commit falha no
  pre-commit (~290ms vs ~850ms do scan completo; import em arquivo não-staged não
  conta) + contrato de política README↔guard (check-unused-deps-policy-contract.
  test.ts, 5 testes — ALLOWLIST exportada e REAL_REMOVED derivado do header) +
  cenário C no test-mutation-unused-deps.sh.
- **check-mutation-count.mjs (novo)**: deriva N do array SUBTESTS do master e
  falha se job name/summary do pr-check ou o README divergirem — trava o drift
  12→15 corrigido à mão; job mutation-count-guard no pr-check.
- **test-mutation-lint-guard.sh**: cenário do bloco REAL do pre-commit (prettier
  --check em staged de repo git temp com diff --cached).
- **chat/route.ts**: `assertRateLimit` movido para DENTRO do try (429 vira JSON
  com headers via handleError, padrão das demais rotas; antes propagava como erro
  não tratado → 500) + primeiros 10 testes unitários (rate-limit 429, mensagem
  vazia, sucesso, trim de histórico p/ 10, falhas do provider).
- **docs**: README (15 sub-tests, no-leaked-imports, linha do unused-deps staged
  na tabela Git Hooks) e GUARDS.md (seção 12 do check-unused-deps com link único
  para a política ZERO-órfãs).

### Detalhe do processo

- O pre-commit do repo travou o commit uma vez: o `check-unused-deps.mjs --staged`
  foi adicionado ao `.husky/pre-commit` sem a linha na tabela '## Git Hooks' do
  README — exatamente o contrato que o guard de simetria (check-hooks-symmetry)
  protege. Linha adicionada e o commit fechou.
- Pré-commit também rodou eslint e pegou 3 issues pré-existentes no trabalho do
  no-leaked-imports (CODE_EXTENSIONS dead code + 2× require() no teste +
  readFileSync faltando no import) — corrigidos antes do commit.

### Validação (tudo verde)

- vitest 76/76 (5 suítes: chat-route 10, unused-deps 30, policy-contract 5,
  no-leaked 19, mutation-count 12) · tsc --noEmit 0 erros.
- Guards reais exit 0: unused-deps full + staged, no-leaked-imports,
  mutation-count, mutation-jobs, workflow-refs.
- Mutation tests: mutation-count e no-leaked-imports exit 0. Varredura de segredos
  no diff: 0.

## [2026-08-06] Bateria pós-commit — test:unit 228/228 + fix do hang do worker (lucide Proxy)

Validação completa para confirmar que o 6a900e1 não regrediu fora das suítes
tocadas. Achado principal: o `bun run test:unit` NUNCA completava de verdade —
travava com 'Worker exited unexpectedly' em login-page/register-page, e o run
inteiro parava em 217/228 arquivos. Diagnóstico por bisect de probes: o mock
Proxy do lucide-react em `src/app/__tests__/test-setup.tsx` retornava `Icon`
(função) para TODA chave, incluindo `Symbol.iterator`, `Symbol.toStringTag` e
`then` — o vite-node via o módulo como THENABLE e ficava aguardando o `then`
para sempre (hang no worker). Fix: traps `get`/`has`/`getOwnPropertyDescriptor`
guardando symbols + chaves de interop (then, __esModule) — só nomes de string
viram Icon. + 2 asserts ambíguos ('Entrar'/'Criar conta' existem no h2 E no
botão) trocados por getByRole('heading').

Resultado da bateria: **test:unit 228/228 arquivos, 3494/3494 testes verdes**
(antes parava em 217/228 — o fix destravou a suíte inteira); master
test-mutation-guards.sh 15/15 PASS; tsc 0; guards reais (unused-deps,
no-leaked-imports, mutation-count, workflow-refs, hooks-symmetry) todos exit 0;
prettier/eslint 0. E2E spot com stack docker real (postgis+redis+dev server):
health.spec 3/3 + smoke /api/providers /api/categories /api/search 200;
providers-cache.spec 6/9 (3 falhas de Cache-Control são artefato de dev-mode —
o CI roda `next start` prod onde cacheControlPublic aplica; 6a900e1 não toca
nem providers/route.ts nem api-server). home.spec falha localmente (h1 some na
hidratação com DB vazio em dev) mas NÃO roda em nenhum workflow e o commit não
toca arquivos da home — pré-existente. Observações de ambiente: `bun run build`
falha no Windows (output: standalone + pnpm symlink EPERM no .pnpm/sharp —
limitação local; CI é Linux).

## [2026-08-06] Medição pós-merge PENDENTE — pr-check nunca rodou no CI real

Estado da medição de overhead do PR (seção Git Hooks/CI do README, tabela de
overhead): as células de `unused-deps-guard` (~10-15s est.) e `typecheck`
(~2-3 min est.) ainda são ESTIMATIVAS — substituição por medições reais do
GitHub-hosted runner segue pendente de merge.

Verificado nesta thread: branch `freebuff/new-thread-thms5x3m7xt8k4` NÃO está
mergeada na default `release/v0.4.0`; gh autenticado (scope repo); pr-check.yml
EXISTE na default; mas **ZERO runs de pr-check.yml nos últimos 200 runs** — o
workflow nunca executou no GitHub (só via act local). O 404 de
`gh run list --workflow=pr-check.yml` é sintoma de workflow com zero runs
registrados (GitHub só indexa por nome após a 1ª execução), não de arquivo
ausente.

Receita validada para rodar pós-merge (o merge não dispara pr-check — trigger é
pull_request/merge_group/workflow_dispatch):

```
gh workflow run pr-check.yml --ref release/v0.4.0
RID=$(gh run list --workflow=pr-check.yml --limit 1 --json databaseId -q '.[0].databaseId')
gh run view $RID --json jobs --jq \
  '.jobs[] | select(.name | contains("Unused Deps Guard")) | .steps[] | select(.name == "Check unused deps") | {name, startedAt, completedAt}'
gh run view $RID --json jobs --jq \
  '.jobs[] | select(.name | contains("TypeCheck")) | .steps[] | select(.name == "Type check") | {name, startedAt, completedAt}'
```

Duração = `((.completedAt | fromdateiso8601) - (.startedAt | fromdateiso8601))` —
mesmo mecanismo do measure-mutation-timing.mjs; shape camelCase (startedAt/
completedAt) validado num run real do ci.yml (30438401889). Bloqueio atual: o
pre-push falha no hang do login-page (agora corrigido) — o merge fast-forward
(57 commits à frente, 0 atrás, sem workflow de push para release/v0.4.0) fica
liberado após o commit do fix do test-setup.

---

Task ID: CLEANUP-65-ARQUIVOS
<a id="cleanup-65-arquivos"></a>
Agent: orchestrator (limpeza de arquivos mortos)
Task: Pequenos itens técnicos — 65 arquivos mortos removidos (14MB) + achado do middleware raiz.

Work Log:

## [2026-08-06] Pequenos itens técnicos — 65 arquivos mortos removidos (14MB) + achado do middleware raiz

### Limpeza executada (git rm, 65 arquivos, ~14MB)

- **63 PNGs de screenshot órfãos na raiz** (admin-_.png, qa-_.png, final-_.png,
  screenshot-_.png, sidebar-*.png, after-redesign, client-panel, current-state,
  landing-page-current, login-dialog, mobile-view, verify-screenshot, etc.) —
  ZERO referências em src/, README.md, docs/, .github/, scripts/, e2e/
  (grep estrito de ".png" nos consumers; admin-panel/client-panel nas fontes
  são strings de view, não arquivos).
- **`--full-page`** (PNG 1280x577 de ferramenta de screenshot, 380K) — órfão.
- **`download/homepage-check.png`** — órfão (mantido download/README.md).

Validado após a remoção: tsc 0 erros · check-unused-deps 98 deps 0 órfãs ·
check-no-leaked-imports 0 · check-workflow-refs 0 · check-mutation-jobs 0 ·
check-readme-images (7 imagens resolvem) · prettier limpo.

### Achado sinalizado (NÃO removido — decisão de produto/segurança pendente)

- **`middleware.ts` raiz é dead code em RUNTIME**: com o diretório `src/`,
  o Next.js ignora o middleware da raiz e só carrega `src/middleware.ts`.
  Consequência: o **rate limit global Upstash** (checkGlobalRateLimit) do
  middleware raiz **NUNCA roda em produção** — bug latente de segurança.
  `src/middleware.ts` tem rate limit próprio (token bucket 60 req/min, in-memory)
  - auth + CSP + CORS, então a proteção básica existe — mas a camada global
    Upstash documentada no header do arquivo raiz está inativa.
- `src/lib/global-rate-limit.ts` **continua viva e usada** (rotas admin
  /api/admin/global-rate-limit-status + reset + testes) — NÃO remover.
- `src/lib/__tests__/middleware.test.ts` testa o middleware raiz órfão
  (import de `../../../middleware`) — cobertura de código que não roda.

**Decisões possíveis (escolher uma):** (a) integrar o rate limit global Upstash
no src/middleware.ts (restaurar a camada), (b) remover middleware.ts raiz +
middleware.test.ts (aceitar só o token bucket), ou (c) manter como está
(documentado). Recomendação: (a) antes do go-live — a camada Upstash foi
construída intencionalmente (commit 489686f) e hoje não protege nada.

---

Task ID: RATE-LIMIT-UPSTASH-FIX
<a id="rate-limit-upstash-fix"></a>
Agent: orchestrator (fix do rate limit Upstash)
Task: Fix do rate limit Upstash inativo — integrado no src/middleware.ts.

Work Log:

## [2026-08-06] Fix do rate limit Upstash inativo — integrado no src/middleware.ts

Resolução do achado sinalizado no commit c40b72b: o middleware.ts raiz (rate
limit global Upstash) NUNCA rodava em produção — com src/ dir, o Next ignora o
middleware da raiz e só carrega src/middleware.ts.

O que foi feito:

- **src/middleware.ts**: substituído o token bucket local (60 req/min, in-memory
  Map) pelo `checkGlobalRateLimit` + `globalRateLimitHeaders`
  (`@/lib/global-rate-limit`): Upstash Redis via REST quando
  UPSTASH_REDIS_REST_URL/TOKEN configurados, com fallback in-memory por
  processo. Config via GLOBAL_RATE_LIMIT_MAX/WINDOW_MS/BYPASS_IPS/WHITELIST.
  Bypasses: /api/health, /api/stats/public, /api/newsletter (fixas) +
  /api/webhooks/_, /api/cron/_ (prefixos) + whitelist env. Headers de compat
  X-RateLimit-* mantidos ao lado do contrato X-Global-RateLimit-*; o 429 agora
  carrega os dois + CORS (addCorsHeaders) — paridade com o antigo middleware raiz.
- **Fix colateral de produção**: `/api/geo/search` adicionado ao PUBLIC_API —
  o address-autocomplete da vitrine pública chama essa rota sem sessão e, com
  SESSION_SECRET setado em produção, o middleware 401aria (bug latente
  pré-existente que os testes fail-open mascaravam). `/api/webhooks/evolution`
  também adicionado ao PUBLIC_API (paridade com lytex/sentry-alert — sem ele,
  o webhook evolution recebia 401).
- **Removidos**: `middleware.ts` raiz (dead code em runtime) e
  `src/lib/__tests__/middleware.test.ts` (testava o middleware morto).
- **Novo teste**: `src/lib/__tests__/middleware-global-rate-limit.test.ts`
  (11 testes) migrado para o src/middleware.ts com paths públicos EXATOS
  (não dependem do fail-open de SESSION_SECRET ausente), cobrindo allowed/429/
  bypasses (health, webhooks, cron)/whitelist/OPTIONS/header wiring real +
  os 2 fix de auth (geo/search público com limiter; health/detailed limitado).

Validação: vitest 62/62 (4 suites de rate limit) · tsc 0 erros · prettier limpo ·
guards (no-leaked-imports, workflow-refs, unused-deps, barrel-lint) exit 0.

---

Task ID: DEPLOY-PATH-MIGRATE
<a id="deploy-path-migrate"></a>
Agent: auditoria (camada 3 — verificar caminho de deploy p/ gap de triggers/GIST)
Task: Confirmar se produção usa `prisma migrate deploy` (gap era só dev) ou `db push`
(bug de produção) e registrar a conclusão.

Contexto: no banco dev (criado via `prisma db push` + seed), os triggers de sync
(avgRating/reviewCount/favoriteCount/location) e os índices GIST do PostGIS NÃO
existiam — o `db push` sincroniza só o schema declarado em schema.prisma e não
roda o SQL arbitrário das migrations customizadas. Ficou a dúvida: e em produção?

Work Log:

- **`.github/workflows/deploy.yml` (job `migrate`, linhas 166-182)**: primário
  `bunx prisma migrate deploy` → fallback `db push --accept-data-loss`.
- **`.github/workflows/release-deploy.yml` (job `migrate`, linhas 191-208)**: mesmo
  padrão (`migrate deploy` → fallback `db push`).
- **`scripts/deploy.sh` (linhas 316-332)**: passo 3 "Database migrations" roda
  `bunx prisma migrate deploy`; `db push --accept-data-loss` só como fallback.
- **`scripts/entrypoint.sh` (linhas 58-61)**: `bunx prisma migrate deploy` →
  fallback `db push` — usado como ENTRYPOINT dos workers (Dockerfile.worker);
  o server mode não é o caminho do compose prod. O `docker-entrypoint.sh` usado
  no compose prod (app/workers) só lê secrets e monta URLs — não roda migrations.
- **`Makefile` (db-migrate) e `package.json` (db:migrate)**: `prisma migrate deploy`.
- **Postgres de prod**: `postgis/postgis:16-3.4-alpine` (PG 16) — OK p/
  `CREATE OR REPLACE TRIGGER` (requer PG 14+).

Conclusão:

- **Produção usa `prisma migrate deploy` como caminho PRIMÁRIO** em todos os
  fluxos (CI/CD, deploy.sh, entrypoint.sh, Makefile). Isso APLICA as migrations
  SQL customizadas (XX_add_postgis → GIST indexes + sync location;
  20260726130000 → triggers de rating/favorite + backfill;
  20260724140000 → notify_search_reindex). → **O gap era SÓ dev, não prod.**
- **Ressalva importante**: o fallback `db push --accept-data-loss` NÃO aplica SQL
  customizado (triggers/GIST). Se em algum deploy o `migrate deploy` falhar e o
  fallback disparar num banco que nunca teve as SQLs customizadas, os triggers
  ficariam de fora. Cenário de risco: banco prod inicializado com `db push`
  (migrations base conflitariam no `migrate deploy`). Validar no primeiro deploy
  real que `_prisma_migrations` registre as SQLs customizadas.
- A correção aplicada no dev (rodar as migrations SQL + backfill) reproduz o que
  o `migrate deploy` de prod já faz — estado dev agora consistente com prod.

Validação: leitura de 7 fontes (2 workflows, deploy.sh, 2 entrypoints, Makefile,
package.json) · versão PG de prod 16 (>= 14) · nenhuma mudança de código.

---

Task ID: CRON-REVOKE-INACTIVE
<a id="cron-revoke-inactive"></a>
Agent: orchestrator (job agendado de revogação de sessões inativas)
Task: Webhook/job agendado que revoga sockets realtime de usuários inativos automaticamente.

Work Log:

- Nova rota `GET /api/cron/revoke-inactive-sessions` (src/app/api/cron/revoke-inactive-sessions/route.ts):
  - Varre em lote (páginas de 100, cursor por id) usuários com `active=false` há mais de
    INACTIVE_DAYS (padrão 7, usa `updatedAt` como proxy do momento da desativação — o PATCH
    admin de desativação atualiza updatedAt) OU `deletedAt` há mais de DELETED_DAYS (padrão 7,
    cobre soft-deletes antigos anteriores à revogação no DELETE).
  - Para cada usuário chama `revokeUserSessions(id)` (emitRealtime session:revoke → o realtime
    mini-service força o close dos sockets da sala user:{id} + sweep via fetchSockets).
  - Pool de concorrência limitada (5 workers) para não sobrecarregar o /emit do realtime;
    `revokeUserSessions` nunca lança (emitRealtime captura erros) — realtime fora do ar degrada
    a varredura, não a quebra.
  - Autenticação: Bearer CRON_SECRET (mesmo padrão dos outros crons). Cooldown Redis de 23h
    (isCooldownElapsed/markCompleted de src/lib/cron-cooldown.ts). Dry-run via `?dryRun=1`.
  - Auditoria: summary via captureMessage (Sentry/GlitchTip) com scanned/revoked/failed/elapsed.
- Como agendar (cron-job.org / systemd timer / docker):
  URL: https://severinno.com.br/api/cron/revoke-inactive-sessions
  Header: Authorization: Bearer <CRON_SECRET>
  Period: diário (1x/dia é suficiente — cooldown de 23h impede execuções repetidas).
  Teste manual: `curl -H "Authorization: Bearer $CRON_SECRET" "http://localhost:3000/api/cron/revoke-inactive-sessions?dryRun=1"`

Stage Summary:

- **Novo**: src/app/api/cron/revoke-inactive-sessions/route.ts (+ revokeInactiveSessionsBatch
  exportado para teste unitário com db/revoke mockados).
- **Audit**: esta entrada no worklog.md (documentação da rota, critérios e agendamento).

---

Task ID: RT-SESSION-LIMIT
<a id="rt-session-limit"></a>
Agent: orchestrator (limite de sessões simultâneas no realtime)
Task: Manter apenas o socket mais recente por usuário no realtime, derrubando os antigos com motivo "session_limit".

Work Log:

- Novo `REALTIME_MAX_SESSIONS_PER_USER` (default 1; 0/negativo clampado para 1; NaN → 1)
  em mini-services/realtime/index.ts e docker-compose.dev.yml/prod.yml.
- `enforceSessionLimit(userId, justJoinedSocketId)` roda no join (best-effort, não bloqueia o ack):
  sweep `io.fetchSockets()` + função pura `selectSocketsToKickForSessionLimit` (security.ts,
  reusa `filterSocketsBySessionUserId`; ordena por `joinedAt` ascendente — socket conectado
  mas nunca joined (sem joinedAt) ordena como o mais antigo, então o straggler é derrubado
  primeiro; `excludeSocketId` = socket que acabou de dar join, nunca é derrubado mesmo com
  timestamp igual em ms). Para cada antigo: emite `session:limit` { userId, reason:
  "session_limit" } + force-close atrasado (mesmo flush-delay do session:revoke).
- Client (src/hooks/use-realtime.ts): novo handler `session:limit` espelhando o
  `session:revoked` — reseta o singleton (socketRef = null) e desconecta, evitando o loop de
  reconexão automática (reconnection: true faria join→kick→rejoin infinito).
- Testes: unitários em src/lib/**tests**/realtime-security.test.ts (7 casos da função pura:
  mantém mais recente, limite 2, dentro do limite, ignora outros usuários, straggler sem
  joinedAt, excludeSocketId em empate de ms, maxSessions<1, tipo concreto preservado) + spec
  E2E e2e/realtime-session-limit.spec.ts (provider próprio fernanda@severinno.com — cada spec
  de realtime usa um provider distinto para rodar em paralelo sem interferir por userId):
  aba A assume, aba B assume → socket A cai (session_limit), socket B permanece e recebe o
  toast de um novo booking; nenhum toast na aba A.
- Como testar: `bunx vitest run src/lib/__tests__/realtime-security.test.ts` e
  `bunx playwright test e2e/realtime-session-limit.spec.ts --project=chromium`.
- Nota de operação: default 1 = uma sessão ativa por usuário. Para permitir múltiplas abas
  simultâneas, suba o env (ex.: REALTIME_MAX_SESSIONS_PER_USER=3).

Stage Summary:

- **Alterado**: mini-services/realtime/security.ts, mini-services/realtime/index.ts,
  src/hooks/use-realtime.ts, docker-compose.dev.yml, docker-compose.prod.yml,
  src/lib/**tests**/realtime-security.test.ts, e2e/realtime-session-limit.spec.ts (novo),
  worklog.md.

---

Task ID: RT-TTL-REVOKE
<a id="rt-ttl-revoke"></a>
Agent: orchestrator (revogação realtime por TTL da sessão)
Task: Disparar session:revoke quando a sessão expira por TTL (não só no logout explícito), garantindo que sockets antigos morram mesmo sem ação do usuário.

Work Log:

- App (src/lib/auth.ts, getSession): quando o cookie tem assinatura VÁLIDA mas o expiresAt
  passou (expiração por TTL, sem logout), dispara `revokeExpiredSessionSockets(userId)` —
  fire-and-forget (nunca bloqueia o request), deduplicado em 2 camadas:
  (a) Map em memória por processo com janela de 1h (com poda quando >1000 entradas);
  (b) chave Redis `realtime:revoked:expired:{userId}` com TTL 1h (dedupe cross-instância).
  Se o cache falhar, cai para o emit mesmo assim (revogação é idempotente).
- Realtime (mini-services/realtime/security.ts): `VerifiedSession` ganha `expiresAt`
  (Unix seconds — já era verificado no handshake, agora é retornado) e nova função pura
  `selectExpiredSessionSockets(sockets, nowMs)` — seleciona sockets cuja sessão passou do
  TTL; sockets sem sessão ou sem expiresAt nunca são selecionados.
- Realtime (mini-services/realtime/index.ts): sweep periódico (setInterval 60s, .unref())
  que roda `selectExpiredSessionSockets` sobre `io.fetchSockets()` e, para cada socket
  expirado, emite `session:revoked` { userId, reason: "session_expired" } + force-close
  atrasado (mesmo padrão do session:revoke). Fecha o gap de sockets OCIOSOS (dashboard/
  tab aberta por meses) que nunca disparam outro request pelo app — sem o sweep, só o
  próximo request com cookie expirado revogaria (ou nunca, sem tráfego).
- Testes: src/lib/**tests**/auth.test.ts (cookie válido-assinado mas expirado → emite
  session:revoke 1x; dedupe na 2ª chamada; cookie válido → não emite; tamperado → não
  emite; userIds independentes não se suprimem) e src/lib/**tests**/realtime-security.test.ts
  (selectExpiredSessionSockets: passado selecionado, futuro ignorado, sem sessão/expiresAt
  ignorado, expiresAt não-numérico ignorado; verifySessionCookie retorna expiresAt).
- Como testar: `bunx vitest run src/lib/__tests__/auth.test.ts src/lib/__tests__/realtime-security.test.ts`.
- Nota de operação: o sweep do realtime é independente do app — mesmo com o Next.js fora,
  sockets com sessão expirada são fechados em até ~60s pelo mini-service.

Stage Summary:

- **Alterado**: src/lib/auth.ts, mini-services/realtime/security.ts,
  mini-services/realtime/index.ts, src/lib/**tests**/auth.test.ts,
  src/lib/**tests**/realtime-security.test.ts, worklog.md.
- Edge case documentado (rotação do cookie): o sweep usa `session.expiresAt` capturado no
  handshake. Com a rotação do getSession (reissue em <15d, novo cookie +30d), um socket
  conectado no dia 0 carrega expiresAt = dia 30 e o sweep pode fechá-lo no dia 30 mesmo com
  cookie reemitido válido até o dia 45; o client não reconecta automaticamente (onSessionRevoked
  zera o singleton). Raríssimo (tab ociosa >30d) e a alternativa (reconectar) criaria loop com
  sessão genuinamente expirada — escolha atual é a mais segura, apenas documentada.

---

Task ID: RT-TELEMETRY
<a id="rt-telemetry"></a>
Agent: orchestrator (telemetria/auditoria do realtime)
Task: Auditoria estruturada no POST /emit (userId, rooms, source) + métricas de sessão ativa por usuário no /health, para operação e debugging (ex.: socket órfão do HMR).

Work Log:

- Realtime security (mini-services/realtime/security.ts), funções puras testáveis:
  - `extractEmitEventInfo(event, data)` — extrai userId + rooms + relatedIds de cada payload
    de evento: booking:update/quote:update → rooms [user:{clientId}, user:{providerId}];
    message:send/notification:new → room user:{toId}; tracking:position → user:{clientId};
    session:revoke → userId sem room (fetchSockets sweep, não broadcast); evento desconhecido
    ou payload malformado → degrade sem throw (rooms []).
  - `summarizeActiveSessions(sessions)` — agrega total, byRole, usersWithMultipleSockets
    (sinal do socket órfão do HMR: usuário com >1 socket simultâneo) e maxSocketsPerUser.
- Realtime index (mini-services/realtime/index.ts):
  - Auditoria: `auditEmit(source, event, data)` — contadores em memória por evento
    (emitCounters) + ring buffer recentEmits (máx 20, expõe últimos 10) + log estruturado
    `audit emit|socket event=... rooms=[...] userId=...`. Chamado no POST /emit (source="emit")
    e nos handlers de socket via wrapper `withAudit` (source="socket") — mesma telemetria nas
    duas vias. Best-effort (try/catch): auditoria nunca quebra o fluxo do evento.
  - /health enriquecido (mantém 200 p/ healthcheck do compose): { status:"ok", uptimeSeconds,
    sockets: { total, verified, joined }, sessions: metrics, emitCounters, recentEmits }.
    Best-effort: se fetchSockets falhar, responde 200 com metricsError (healthcheck só exige 200).
- Testes: src/lib/**tests**/realtime-security.test.ts — 12 novos casos (8 extractEmitEventInfo:
  booking/quote/message/notification/tracking/revoke/desconhecido/malformado + 4
  summarizeActiveSessions: total+byRole, multi-sockets, vazio, 1-socket-por-user).
- Como testar: `bunx vitest run src/lib/__tests__/realtime-security.test.ts`; smoke:
  `curl -s localhost:3003/health` e `curl -s localhost:3003/sessions` (Bearer).

Stage Summary:

- **Alterado**: mini-services/realtime/security.ts, mini-services/realtime/index.ts,
  src/lib/**tests**/realtime-security.test.ts, worklog.md.

---

Task ID: FETCH-TIMEOUT-HELPER
<a id="fetch-timeout-helper"></a>
Agent: orchestrator (helper compartilhado de fetch timeout)
Task: Extrair o guard `Math.max(1, Number(env) || default)` + `AbortSignal.timeout()` em um helper compartilhado src/lib/fetch-timeout.ts, eliminando a duplicação em 7 arquivos.

Work Log:

- Novo src/lib/fetch-timeout.ts com 2 funções:
  - `resolveTimeoutMs(envName, fallbackMs)` — guarda `Math.max(1, Number(env) || default)`:
    env ausente/vazia/NaN → fallback; "0" (falsy) → fallback; negativo → clamp 1.
  - `envTimeoutSignal(envName, fallbackMs)` — AbortSignal.timeout() com o guard aplicado.
- Refatorados 7 arquivos (o pedido dizia 6; o grep revelou 7 com o padrão combinado):
  - inline `envTimeoutSignal(...)` (uso único): src/lib/realtime-client.ts
    (REALTIME_EMIT_TIMEOUT_MS/3000), src/lib/lytex.ts (LYTEX_TIMEOUT_MS/10_000),
    src/lib/evolution.ts (EVOLUTION_TIMEOUT_MS/10_000), src/app/api/sentry/route.ts
    (GLITCHTIP_TIMEOUT_MS/5_000).
  - `resolveTimeoutMs(...)` em const (uso em 2 fetches): src/app/api/webhooks/sentry-alert/route.ts
    (ALERT_WEBHOOK_TIMEOUT_MS/5_000), src/app/api/admin/gateway/invoices/route.ts e
    src/app/api/admin/gateway/stats/route.ts (LYTEX_TIMEOUT_MS/10_000).
- FORA do escopo (não são timeouts): paginação `Math.max(1, Number(searchParams page/limit))`
  em api-server.ts e rotas de busca (clamp de paginação, não fetch timeout); e o
  `MAX_SESSIONS_PER_USER` do mini-services (contagem de sessão num runtime standalone que
  não importa src/lib).
- Testes: novo src/lib/**tests**/fetch-timeout.test.ts (7 casos resolveTimeoutMs: fallback
  ausente/vazio, valor válido, NaN, "0" falsy, negativo clamp 1, decimal; 2 casos
  envTimeoutSignal: instância AbortSignal + guard aplicado sem throw).
- Como testar: `bunx vitest run src/lib/__tests__/fetch-timeout.test.ts`.

Stage Summary:

- **Alterado**: src/lib/fetch-timeout.ts (novo), src/lib/**tests**/fetch-timeout.test.ts (novo),
  src/lib/realtime-client.ts, src/lib/lytex.ts, src/lib/evolution.ts,
  src/app/api/sentry/route.ts, src/app/api/webhooks/sentry-alert/route.ts,
  src/app/api/admin/gateway/invoices/route.ts, src/app/api/admin/gateway/stats/route.ts,
  worklog.md.

---

Task ID: FETCH-TIMEOUT-TESTS
<a id="fetch-timeout-tests"></a>
Agent: orchestrator (testes de hang/AbortSignal dos helpers e rotas refatoradas)
Task: Adicionar testes de 'não trava quando o serviço aceita TCP mas nunca responde' (simulação de hang com AbortSignal) para os helpers lytexRequest e evolutionRequest, seguindo o padrão do realtime-client.test.ts, e teste de presença do signal nos fetches das rotas gateway e sentry.

Work Log:

- Novos src/lib/**tests**/lytex-timeout.test.ts e evolution-timeout.test.ts — testam o módulo
  REAL (complementam o lytex.test.ts auto-contido, que replica a lógica sem importar o módulo):
  - Presença de signal: o fetch carrega AbortSignal (instância, aborted=false) via
    envTimeoutSignal(LYTEX_TIMEOUT_MS / EVOLUTION_TIMEOUT_MS).
  - Hang: com a env de timeout em 50ms e um fetch que só rejeita quando o signal abortar,
    o request rejeita com TimeoutError em <2s (não pendura o fluxo de booking/WhatsApp).
  - Padrão copiado de realtime-client.test.ts (stub de fetch + logger mockado com child()).
- Estendidos os testes das rotas gateway:
  - admin-gateway-invoices-route.test.ts: novo describe 'signal presence' — TODOS os fetches
    (auth token + listagem) carregam AbortSignal.
  - admin-gateway-stats-route.test.ts: idem para auth + paginação do fetchAllInvoices.
- Novos src/app/api/**tests**/sentry-route.test.ts e sentry-alert-route.test.ts:
  - Tunnel /api/sentry: fetch do GlitchTip com AbortSignal no URL
    http://glitchtip-web:8000/api/42/envelope/ (dsn projeto 42) + fail-closed 200 com
    ECONNREFUSED.
  - Webhook /api/webhooks/sentry-alert: fetches de Discord E Telegram carregam AbortSignal
    (com DISCORD_WEBHOOK_URL + TELEGRAM_* stubbed e SENTRY_ALERT_SECRET vazio → authorized).
- Como testar: bunx vitest run src/lib/**tests**/lytex-timeout.test.ts
  src/lib/**tests**/evolution-timeout.test.ts src/app/api/**tests**/sentry-route.test.ts
  src/app/api/**tests**/sentry-alert-route.test.ts src/app/api/**tests**/admin-gateway-invoices-route.test.ts
  src/app/api/**tests**/admin-gateway-stats-route.test.ts

Stage Summary:

- **Alterado**: src/lib/**tests**/lytex-timeout.test.ts (novo), src/lib/**tests**/evolution-timeout.test.ts (novo),
  src/app/api/**tests**/sentry-route.test.ts (novo), src/app/api/**tests**/sentry-alert-route.test.ts (novo),
  src/app/api/**tests**/admin-gateway-invoices-route.test.ts, src/app/api/**tests**/admin-gateway-stats-route.test.ts,
  worklog.md.

---

Task ID: DATA-TIMEOUTS-AUDIT
<a id="data-timeouts-audit"></a>
Agent: orchestrator (auditoria de timeouts dos clientes de dados)
Task: Auditar os timeouts do client OpenSearch (requestTimeout 10s existe, connectionTimeout não explícito) e do Prisma (query_timeout/connection_limit) para garantir que nenhum serviço de dados pendure requests indefinidamente, documentando a conclusão.

Work Log:

- AUDITORIA OpenSearch (src/lib/search.ts):
  - Verificado nas ClientOptions instaladas (@opensearch-project/opensearch v3.6.0):
    a opção `connectionTimeout` NÃO EXISTE — só requestTimeout/maxRetries/agent.
  - O Transport repassa o requestTimeout ao http.request do Node, que seta o
    socket timeout ANTES de conectar — logo o requestTimeout: 10_000 cobre
    TAMBÉM a fase de connect (OpenSearch que aceita TCP mas nunca responde →
    TimeoutError em 10s). Sem gap real de conexão.
  - Hardening aplicado: `maxRetries: 1` explícito (default era 3, implícito) —
    pior caso ~20s, nunca infinito; search falha aberto (itens vazios) e o
    consumer de reindex tem a própria fila. Comentário no código documenta tudo.
- AUDITORIA Prisma (src/lib/db.ts + src/queue/search-index-consumer.ts):
  - Verificado no PrismaClientOptions gerado (Prisma 6.19.3): `query_timeout` e
    `connection_limit` FORAM REMOVIDOS das options do construtor. O mecanismo
    suportado são params na connection string (engine clássico):
    connection_limit (int), connect_timeout (seg), pool_timeout (seg),
    statement_timeout (ms — default 0 = DESABILITADO: sem ele, uma query
    travada no Postgres pendura o request INDEFINIDAMENTE — gap real fechado).
  - Novo src/lib/prisma-timeout.ts: `buildPrismaDatasourceUrl(url)` aplica os 4
    params (só os ausentes, nunca duplica os explícitos) com defaults
    connection_limit=10 / connect_timeout=10s / pool_timeout=10s /
    statement_timeout=10_000ms e override via env (PRISMA_CONNECTION_LIMIT,
    PRISMA_CONNECT_TIMEOUT_SEC, PRISMA_POOL_TIMEOUT_SEC,
    PRISMA_STATEMENT_TIMEOUT_MS) com o guard do padrão (NaN/0/vazio → default;
    negativo → 1).
  - Aplicado via `datasourceUrl` no construtor do app client (db.ts) e do
    worker search-index-consumer (consumer que faz $queryRawUnsafe no poll).
    Seeds/scripts que criam PrismaClient próprio ficam FORA (tooling dev, não
    servem requests) — podem adotar o helper se desejado.
- Testes:
  - Novo src/lib/**tests**/prisma-timeout.test.ts (5 casos): defaults aplicados,
    não-duplicação de params existentes, override via env, clamp negativo,
    statement_timeout nunca fica 0.
  - src/lib/**tests**/search.test.ts: mock do Client agora captura as options;
    novo caso 'createClient' garante requestTimeout=10_000 e maxRetries=1.
- Como testar: bunx vitest run src/lib/**tests**/prisma-timeout.test.ts
  src/lib/**tests**/search.test.ts

Stage Summary:

- **Alterado**: src/lib/prisma-timeout.ts (novo), src/lib/**tests**/prisma-timeout.test.ts (novo),
  src/lib/db.ts, src/queue/search-index-consumer.ts, src/lib/search.ts,
  src/lib/**tests**/search.test.ts, worklog.md.

---

Task ID: ADMIN-ONLINE-CARD
<a id="admin-online-card"></a>
Agent: general-purpose (admin panel)
Task: Exibir o total de usuários online como card/contador no topo da lista de usuários do painel admin, com refresh manual ao lado da coluna Online.

Work Log:

- src/components/admin/admin-users.tsx: a query de sessões realtime
  (`GET /api/admin/realtime/sessions`, queryKey `admin/realtime/sessions`)
  agora expõe `refetch` e `isFetching` — antes só o `data` era consumido.
- Novo card KpiCard "Usuários online" no topo da lista (após o
  PageSectionHeader, antes das tabs de role): usa `onlineUsers` da resposta
  (contagem de usuários com sessão verificada E joined no realtime), com
  subtitle exibindo `totalSockets` sockets ativos ou "Realtime indisponível"
  quando `ok === false` (degradação graciosa — realtime fora do ar não quebra
  o painel). Consome o KpiCard do _shared (design system consistente).
- Refresh manual: botão de ícone RefreshCcw ao lado do label "Online" no
  TableHead — chama `refetchSessions()` (mesma query do card, atualiza ambos),
  com animate-spin durante isRefetching (só refetches posteriores, não o mount
  inicial) e aria-label de acessibilidade. O card segue com refetchInterval de
  30s automático.

Stage Summary:

- **Alterado**: src/components/admin/admin-users.tsx, worklog.md.
- **Sem mudança de API**: a rota /api/admin/realtime/sessions já retornava
  `onlineUsers` e `totalSockets` — só o consumo no frontend mudou.

---

Task ID: ADMIN-ONLINE-PROVIDERS
<a id="admin-online-providers"></a>
Agent: general-purpose (admin panel)
Task: Estender o indicador de usuários online e a ação "Revogar sessões" do AdminUsers para o AdminProviders (admin-providers.tsx), seguindo o mesmo padrão.

Work Log:

- src/components/admin/admin-providers.tsx:
  - Query de sessões realtime (`GET /api/admin/realtime/sessions`, queryKey
    `admin/realtime/sessions`, staleTime 15s, refetchInterval 30s) expondo
    `refetch: refetchSessions` e `isRefetching: isSessionsRefetching` — mesma
    queryKey do AdminUsers, então o cache é compartilhado entre as duas listas.
  - Novo KpiCard "Usuários online" no topo (após o PageSectionHeader): usa
    `onlineUsers` da resposta, subtitle com `totalSockets` ou "Realtime
    indisponível" quando `ok === false` (degradação graciosa).
  - Nova coluna "Online" entre Status e Desde: badge emerald "Online" (Wifi com
    animate-pulse) por prestador com sessão joined + botão de refresh manual
    (RefreshCcw, isRefetching → animate-spin/disabled, aria-label).
  - Novo item "Revogar sessões" no dropdown ⋮ (ícone RefreshCcw): chama
    POST /api/admin/users/[id]/revoke-sessions sem desativar a conta, com
    toast de sucesso, invalidação da query de sessões e error banner/toast em
    falha; desabilitado quando o prestador não está online ou já revogando.
  - onlineByUser memo derivado de sessionsData (userId → online).
- Consistência: tipo RealtimeSessionsResponse e padrões (badge, tooltip,
  refresh) replicam o AdminUsers — a queryKey compartilhada evita fetch duplicado.

Stage Summary:

- **Alterado**: src/components/admin/admin-providers.tsx, worklog.md.
- **Sem mudança de API**: reusa GET /api/admin/realtime/sessions e
  POST /api/admin/users/[id]/revoke-sessions já existentes.

---

Task ID: CRON-REVOKE-INACTIVE-TEST
<a id="cron-revoke-inactive-test"></a>
Agent: general-purpose (testes de cron)
Task: Adicionar teste unitário do cron revoke-inactive-sessions (GET /api/cron/revoke-inactive-sessions) no padrão do cron-settlements-route.test.ts.

Work Log:

- Novo src/app/api/**tests**/cron-revoke-inactive-sessions-route.test.ts:
  - Mocks hoisted: @/lib/auth (revokeUserSessions), @/lib/cron-cooldown
    (isCooldownElapsed default true + markCompleted), @/lib/sentry
    (captureMessage), @/lib/logger (default). db.user.findMany resetável
    via (db.user as any) no beforeEach — mesmo padrão do settlements.
  - revokeInactiveSessionsBatch (função pura exportada pela rota) — 3 casos:
    pool de concorrência (max in-flight <= 5 com 12 usuários e revoke com
    delay de 5ms; >1 prova que a concorrência é realmente usada), falhas
    contadas separadamente quando revoke lança, dryRun conta sem chamar
    revoke.
  - GET — 7 casos: varredura multi-página (100+100+50 = 250, cursor na 2ª/3ª
    chamada via skip:1 + cursor:{id}), página vazia encerra sem emitir, dryRun
    via query param reporta sem emitir, cooldown ativo → skip sem varrer nem
    emitir nem marcar completed, 401 Bearer ausente/errado, acesso liberado com
    CRON_SECRET vazio, 500 com mensagem em erro interno.
- Como testar: bunx vitest run src/app/api/**tests**/cron-revoke-inactive-sessions-route.test.ts

Stage Summary:

- **Adicionado**: src/app/api/**tests**/cron-revoke-inactive-sessions-route.test.ts,
  worklog.md.
- **Sem mudança de produção**: só teste novo do cron existente.

---

Task ID: ADMIN-REVOKE-AUDIT
<a id="admin-revoke-audit"></a>
Agent: general-purpose (admin panel + cron)
Task: Endpoint admin de audit trail dos runs do cron de revogação de sessões inativas + botão "Executar varredura agora" com dry-run por padrão no painel.

Work Log:

- src/lib/revoke-run-audit.ts (NOVO): audit trail Redis dos runs do cron de
  revogação. Chave `cron:revoke-inactive:runs` (array JSON, bounded em 50,
  TTL 30d, mais recente primeiro). `recordRevokeRun(entry)` (best-effort,
  nunca lança) e `listRevokeRuns(limit=50)`. Usa a camada tier-aware
  (cacheGet/cacheSet) — degrada para a store em memória sem quebrar a varredura.
- src/lib/revoke-inactive-scan.ts (NOVO): motor compartilhado da varredura,
  extraído da rota cron. `revokeInactiveSessionsBatch` (pool de concorrência
  5, puro) + `runRevokeInactiveScan({ dryRun, source: 'cron'|'admin',
bypassCooldown })`: cooldown Redis (23h, bypassável), lote com cursor,
  markCompleted, logger/Sentry e registro do run no audit trail
  (status completed/skipped/error).
- src/app/api/cron/revoke-inactive-sessions/route.ts: refatorada para usar o
  motor compartilhado (GET mantém auth Bearer CRON_SECRET + ?dryRun=1; re-exporta
  o batch puro para os testes existentes).
- Rotas admin (NOVAS):
  - GET /api/admin/cron/revoke-inactive/runs — audit trail (ADMIN-only),
    degrada para { runs: [] }.
  - POST /api/admin/cron/revoke-inactive/run — executa AGORA com DRY-RUN POR
    PADRÃO (dryRun default true; ?dryRun=0 para revogar de verdade),
    bypassCooldown=true (o admin pediu explicitamente), source="admin",
    ADMIN-only.
- src/components/admin/admin-revoke-inactive.tsx (NOVO): página no painel com
  select Dry-run (padrão) / Revogar de verdade (com ConfirmDialog destrutivo
  H5), botão "Executar agora" e tabela do audit trail (quando, origem,
  status, modo, varridos, revogados, falhas, duração) + skeleton/empty/error.
- admin-panel.tsx: nova view "admin.revoke-inactive" (nav + meta + switch).
  index.ts: barrel `RevokeInactive`.
- Testes: revoke-run-audit.test.ts (6 casos), admin-revoke-inactive-run-route
  (5 casos: dryRun default, dryRun=0 real, bypassCooldown, skipped, 401),
  admin-revoke-inactive-runs-route (4 casos: 200, vazio, 401, 403);
  cron-revoke-inactive-sessions-route.test.ts ganhou mock do audit.

Stage Summary:

- **Adicionado**: src/lib/revoke-run-audit.ts, src/lib/revoke-inactive-scan.ts,
  rotas admin (runs + run), admin-revoke-inactive.tsx, 3 arquivos de teste.
- **Alterado**: rota cron (usa motor compartilhado), admin-panel.tsx,
  index.ts, cron-revoke-inactive-sessions-route.test.ts, worklog.md.
- **Sem breaking change**: respostas do cron GET preservadas; batch puro
  re-exportado.

---

Task ID: CRON-PASSWORD-CHANGE-REVOKE
<a id="cron-password-change-revoke"></a>
Agent: general-purpose (cron + auth)
Task: Estender o cron revoke-inactive-sessions para também revogar sessões de usuários que trocaram a senha há N dias (defesa extra pós-vazamento), reutilizando a mesma varredura em lote.

Work Log:

- prisma/schema.prisma: novo campo `passwordChangedAt DateTime?` no model User
  (comentário explicando o uso no cron).
- prisma/migrations/20260816100000_add_password_changed_at/migration.sql (NOVO):
  ALTER TABLE "User" ADD COLUMN "passwordChangedAt" TIMESTAMP(3).
- src/app/api/auth/change-password/route.ts e reset-password/route.ts: o update
  de senha agora grava `passwordChangedAt: new Date()` junto do novo hash —
  alimenta o critério do cron (sem isso o campo nunca seria populado).
- src/lib/revoke-inactive-scan.ts: nova condição no WHERE OR da varredura —
  `{ passwordChangedAt: { lte: agora - PASSWORD_CHANGE_DAYS } }` (default 30,
  env PASSWORD_CHANGE_DAYS). Threshold da resposta/audit agora inclui
  `passwordChangedSince`. Logger/Sentry passam a incluir passwordChangeDays.
- src/lib/revoke-run-audit.ts + admin-revoke-inactive.tsx: tipo threshold
  sincronizado com o novo campo passwordChangedSince.
- Testes: change-password.test.ts (data do update com passwordChangedAt),
  cron-revoke-inactive-sessions-route.test.ts (where com as 3 condições +
  threshold.passwordChangedSince), fixtures dos testes admin atualizados.

Stage Summary:

- **Adicionado**: migration + campo passwordChangedAt; condição de varredura
  por troca de senha.
- **Alterado**: 2 rotas de auth, motor do cron, audit trail, página admin,
  4 arquivos de teste, worklog.md.
- **Como aplicar no banco**: prisma migrate deploy (prod) ou db push (dev).

Fix (rodada 2 — once-only marker `revokedByCronAt`):

- BUG detectado no review: com `lte` (troca há MAIS de N dias), um usuário
  ativo que trocou a senha seria re-revogado TODO dia para sempre — o
  passwordChangedAt não muda no login (expulsão forçada diária + flooding do
  audit trail). Correção com marcador once-only:
- prisma/schema.prisma: novo campo `revokedByCronAt DateTime?` no model User.
- Migration 20260816100000_add_password_changed_at/migration.sql: agora cria
  as DUAS colunas (passwordChangedAt + revokedByCronAt) — migration ainda não
  aplicada em nenhum banco.
- rotas change-password/reset-password: além de gravar passwordChangedAt,
  limpam `revokedByCronAt: null` (nova troca de senha reabilita a varredura).
- revoke-inactive-scan.ts: condição de senha agora exige `revokedByCronAt:
null`; após cada página (non-dryRun) grava `revokedByCronAt` via
  db.user.updateMany nos revogados (marcar todos da página é seguro — o
  marcador só é consultado junto da condição de senha).
- Testes: cron test (condição com revokedByCronAt null + updateMany 3x com
  marcador; dry-run e página vazia NÃO gravam), change-password test (data do
  update com revokedByCronAt: null).

Fix (rodada 3 — validação):

- Assert do cron test corrigido: o where real é `{ deletedAt: { lte: Date } }` /
  `{ passwordChangedAt: { lte: Date }, revokedByCronAt: null }` — o assert usava
  `expect.any(Date)` onde deveria ser `expect.objectContaining({ lte: ... })`.
- `prisma generate --no-engine` usado para o typecheck (o generate padrão
  falhava com EPERM no rename da query engine DLL — lock do dev server da 3000
  rodando desta worktree). Depois, com o dev server parado (taskkill PID),
  `prisma generate` completo foi rodado para restaurar o client COM engine
  (o app usa PrismaClient sem driver adapter — client no-engine quebraria o
  próximo start) e o dev server da 3000 foi reiniciado e verificado
  (200 em /api/services, que toca o banco via Prisma).
- revoke-run-audit.test.ts: fixture makeEntry ganhou `passwordChangedSince`
  no threshold (campo obrigatório no tipo RevokeRunEntry).
- revoke-inactive-scan.ts: `if (!dryRun && page.length > 0)` simplificado
  para `if (!dryRun)` (length > 0 garantido dentro do loop).
- Prettier: .prisma/.sql não têm parser no prettier do repo — o check roda
  só em ts/tsx/md.

## NO-NPX-PLAYWRIGHT-GUARD — guard do runner oficial E2E

Task: Adicionar um guard (check-*.mjs) que falha se alguém reintroduzir
`npx playwright` em docs/scripts/package.json, apontando para o bunx como
runner oficial — no padrão dos guards existentes de README/escopo.

- scripts/check-no-npx-playwright.mjs (NOVO): Node puro, funções puras
  exportadas (findNpxPlaywrightRefs/scanNpxPlaywright) + IS_DIRECT_RUN, exit
  0/1/2, --root para fixtures. Escopo: README.md + docs/**/_.md (só posição de
  comando: linha iniciando com `npx playwright` ou com subcomando/flag —
  prosa do Troubleshooting isenta), scripts/_.sh/_.bash (fora comentário/echo;
  test-mutation-_ excluídos de propósito), package.json.
- src/lib/**tests**/check-no-npx-playwright-cli.test.ts (NOVO): 6 testes CLI
  (spawn real com --root): fixture limpo pass, .sh/docs/package.json com
  mutação fail citando o arquivo, prosa exenta pass, test-mutation-* excluído.
- scripts/test-mutation-no-npx-playwright.sh (NOVO): controle (limpo) + 3
  mutações (.sh, docs, package.json) que DEVEM falhar citando o arquivo +
  prosa documental que DEVE passar.
- Wiring: package.json (check:no-npx-playwright), .husky/pre-commit (fast
  gate), check-hooks-symmetry.mjs (HOOK_KEY_BY_CMD), pr-check.yml
  (job no-npx-playwright-guard: mutation test + guard real — cobertura direta
  do check-mutation-jobs), README (tabela Git Hooks), docs/GUARDS.md (família
  13 Runner oficial).
- Por que existe: npx resolve instância DIFERENTE de @playwright/test no
  Windows (shims .cmd vs symlinks do bun) e TODOS os specs falham com
  'did not expect test.describe() to be called here'; bunx é o runner oficial
  (README Troubleshooting).

## NPX-SHIMS-WINDOWS — fazer o npx FUNCIONAR de verdade no Windows

Task: Gerar os shims .cmd/.ps1 do npm no worktree (`npm install --no-save`)
para que o npx não dependa do re-quoting do cmd.exe sobre o .EXE do bun, e
documentar o resultado.

- Diagnóstico (causa raiz REAL, diferente da hipótese original): o bun cria
  `node_modules/.bin/playwright.exe` (shim .exe de ~15KB) + ponteiro
  `playwright.bunx`, SEM .cmd/.ps1. Quando o npx executa o .exe via cmd.exe,
  o runner resolve uma instância DIFERENTE de @playwright/test no grafo de
  módulos (bun install vs layout npm) — `npx playwright test --list` retornava
  `No tests found` (0 arquivos, exit 0) enquanto o bunx achava os testes.
  `--config` explícito NÃO resolve (não é problema de config/CWD — é o grafo
  duplicado: o shim .exe spawna o cli.js via node, e o require('@playwright/test')
  do config/runner resolve na instância do npm, não na do cli).
- Fix aplicado: `npm install --no-save --no-package-lock @playwright/test@<versão
do bun.lock>` no worktree — o npm criou `playwright.cmd`/`playwright.ps1`/
  `playwright` ao lado dos shims do bun + sua própria cópia do pacote, e o
  npx passou a resolver o shim do npm com grafo único. Sem package-lock.json
  (guard check-bun-mirror: só bun.lock). Gitignored — ajuste LOCAL de
  node_modules, não padrão do repo.
- Prova de ponta a ponta (Windows): `npx playwright test --list` → 253 testes
  em 23 arquivos (exit 0); `npx playwright test e2e/health.spec.ts` → 3 passed
  (4.1s); regressão do bunx → 3 passed (1.4s) — ambos os runners funcionando.
- Sanity do repo: typecheck 0 e git status limpo após o npm install (o tooling
  bun não foi afetado pelo layout npm).
- Documentação: README Troubleshooting reescrito com a causa raiz real (grafo
  duplicado, não re-quoting) + workaround dos shims com os flags corretos e o
  aviso do guard check-bun-mirror; mensagem do guard check-no-npx-playwright
  atualizada para o mecanismo real (sem literal proibido pelo próprio guard).
  O guard continua exigindo bunx em docs/scripts/package.json — o npx com
  shims é workaround local de node_modules, não o padrão documentado.

---

Task ID: NPX-RUNNER-DIAG
<a id="npx-runner-diag"></a>
Agent: orchestrator (diagnóstico do runner oficial E2E no Windows)
Task: Registrar no worklog o trecho do diagnóstico (npx vs bunx, shim .EXE,
reprodução via cmd.exe) e a decisão de runner oficial, para auditoria futura.

Work Log:

- Contexto: em projeto instalado com bun, `node_modules/.bin` contém o shim
  `playwright.EXE` (~15KB) + ponteiro `playwright.bunx` — SEM os shims
  `.cmd`/`.ps1` do npm.
- Reprodução (Windows, via cmd.exe): `npx playwright test <spec> --list` →
  0 arquivos / `No tests found` (exit 0) enquanto `bunx playwright test
<spec> --list` achava os testes; `--config` explícito NÃO resolveu.
- Causa raiz: o shim `.EXE` do bun spawna o cli.js via node, e o
  `require('@playwright/test')` do config/runner resolve numa instância
  DIFERENTE da do cli (bun install vs layout npm) — grafo de módulos
  duplicado. Não é (apenas) re-quoting do cmd.exe como se suspeitava a
  princípio; a hipótese inicial foi descartada por evidência (`--config` não
  muda nada e o `--list` via npx acha 0 vs bunx 253).
- Decisão registrada: **runner oficial do repo é `bunx playwright`** (ou
  `bun run e2e`). O guard `check-no-npx-playwright` trava a reintrodução de
  `npx playwright` em docs/scripts/package.json (ver seção
  NO-NPX-PLAYWRIGHT-GUARD). npx com shims npm (`npm install --no-save
--no-package-lock`) é workaround LOCAL de node_modules (gitignored), não
  padrão do repo (ver seção NPX-SHIMS-WINDOWS).

Stage Summary:

- **Alterado**: worklog.md (registro de auditoria do diagnóstico + decisão).

## ME-EXPIRY — expiresAt do cookie exposto ao client + countdown + renovação proativa

Task: Adicionar um endpoint /api/auth/me-expiry OU incluir expiresAt na resposta
do /api/auth/me para o client mostrar "sua sessão expira em X dias" no
dashboard e renovar proativamente. Escolhido: incluir expiresAt na resposta
existente (sem endpoint novo — um round-trip a menos).

- **Backend**: `src/lib/auth.ts` — SessionPayload ganha `expiresAt?` (unix
  seconds); getSession retorna o expiry EFETIVO (o NOVO quando reemite <15d,
  senão o original) — requireUser/requireRole/getOptionalSession herdam.
  `/api/auth/me` devolve `{ user, expiresAt }` (null em todos os branches
  sem sessão/user).
- **Store**: `sessionExpiresAt` (NÃO persistido — o cookie é a verdade;
  logout/unauth resetam) + ação dedicada `renewSession()` NÃO-destrutiva:
  GET /api/auth/me; em erro de rede/5xx MANTER o estado (o fetchMe marca
  unauthenticated e derruba o usuário para login — renovar que falha não
  pode expulsar ninguém); initialized:true no sucesso.
- **UI**: `SessionExpiryBanner` (urgente ≤7d, botão Renovar via renewSession,
  dismiss por montagem sem localStorage) + `SessionExpiryInfo` (pill SEMPRE
  visível no dropdown do usuário). Decisão de design (reviewer): a rotação
  deslizante + polling 30s mantém o expiry entre 15–30d — um banner ≤7d
  NUNCA apareceria em operação normal, então a pill sempre visível é o que
  atende "mostrar X dias"; o banner cobre o caso urgente.
- **Countdown**: `daysLeft` = ceil (6d23h → 7; 23h → 1; expirado → 0) — floor
  derrubava 1 dia pelo delta de ms entre servidor (segundos) e render (ms):
  sessão fresca de 30d viraria "29 dias" (3 falhas de teste pegaram).
- **Lint aprendido**: localStorage no useState initializer / useEffect →
  `react-hooks/set-state-in-effect` + `Cannot call impure function during
render`; `Date.now()` em render é flagged — `new Date().getTime()` passa
  (mesmo padrão do `getFullYear` do shell). Dismiss por montagem resolve.
- **Testes**: +2 lib auth (expiresAt exposto; novo expiry após rotação), +1
  route (expiresAt na resposta + null), +8 banner, +4 pill, +5 store
  (contrato não-destrutivo do renewSession + referência destrutiva do
  fetchMe) = 108 total.
- **Validação**: typecheck 0, vitest 108/108, prettier/eslint 0, reviewer 4
  rodadas (3 bugs reais pegados: ceil/floor, Renovar destrutivo, role=status
  múltiplo + set-state-in-effect) — nada bloqueante no final.

## COOKIE-ROTATION-RENEW — sessão reemitida (<15d) nunca é fechada pelo sweep de TTL

Task: Fechar o edge case da rotação do cookie: quando o getSession reemite o
cookie (janela <15d restante), propagar a NOVA expiração ao realtime para o
sweep de TTL nunca fechar uma sessão reemitida válida.

- **Problema**: o realtime fixa `socket.data.session.expiresAt` no HANDSHAKE.
  O app reemite o cookie (rotação deslizante) quando restam <15d dos 30d,
  mas o socket mantém o expiry ORIGINAL — o sweep de TTL
  (selectExpiredSessionSockets) fecharia a sessão VÁLIDA quando o expiry
  original passar, derrubando dashboards de usuários ativos.
- **Por que propagação app→realtime e não "re-verificar o cookie no ping"**
  (a alternativa citada na task): o cookie é `httpOnly` — o browser NÃO o
  reenvia em pings do transporte websocket (só no handshake HTTP inicial), e
  o client JS não consegue lê-lo para incluir no payload. Re-verificar por
  ping é inviável por design; a propagação server-side via bridge /emit com
  Bearer (REALTIME_EMIT_TOKEN) é o único mecanismo robusto.
- **Implementação**:
  - `mini-services/realtime/security.ts`: helper puro `renewSessionSockets`
    (EXTEND-ONLY — ignora renew com expiry anterior/igual ao armazenado;
    nunca encurta sessão; retorna contagem; ignora NaN/sem sessão/outros
    users) + `extractEmitEventInfo` cobrindo `session:renew` (mesmo padrão
    do `session:revoke`: userId, sem rooms).
  - `mini-services/realtime/index.ts`: `handleSessionRenew` (fetchSockets
    sweep — cobre connected-but-not-joined — + renew + log, best-effort com
    .catch) + case `session:renew` no POST /emit (Bearer-protected).
  - `src/lib/auth.ts`: `reissueSession` agora RETORNA o createSession (com o
    novo expiresAt); no getSession, quando remaining < 15d →
    `void propagateSessionRenewal(userId, renewed.expiresAt)` — fire-and-
    forget, NUNCA bloqueia o request. Dedupe em 2 camadas (Map em memória 1h
    - chave Redis `realtime:renewed:{userId}` TTL 1h) porque o getSession
      roda em TODO request passado o threshold; best-effort (Redis fora →
      emite mesmo assim; renew é idempotente). Falha transiente do emit é
      tolerável: o restart do realtime faz os sockets reconectarem e o
      handshake re-verifica o cookie ATUAL (reemitido) — auto-heal do edge
      case; a janela do Map (1h) libera o próximo retry.
- **Testes**: realtime-security.test.ts +7 casos (renewSessionSockets:
  extend, extend-only no-op p/ anterior/igual, sem sessão, NaN, vazio,
  tipo concreto; extract session:renew) e auth.test.ts +6 casos (emit com
  novo expiresAt > original+15d, dedupe 1h, não-emite fora da janela /
  expirado / tampered, cross-user independente).
- **Decisões**: payload do session:renew carrega só `{ userId, expiresAt }`
  (role não muda na rotação — não enviada). Footgun documentado nos testes:
  Maps de dedupe do auth.ts são module-level e não resetam — userIds
  distintos por caso (ttl-user-_/rot-user-_).
- **Validação**: typecheck 0, vitest 123/123 (realtime-security + auth +
  session-notification), prettier/eslint 0, reviewer aprovado (nits: helper
  de cookie deduplicado em auth.test.ts + doc do porquê — ambos aplicados).

## SEED-CACHE-PATTERNS — invalidação pós-seed de TODOS os caches do catálogo

Task: Estender a invalidação pós-seed aos demais prefixes de cache que ficam
stale após um re-seed (providers:* da vitrine, proximidade geo, categorias) —
mapear todas as chaves withCache e adicioná-las à invalidação do seed como um
padrão genérico invalidateCachePatterns().

- Mapeamento completo das chaves withCache do app:
  - **STALE pós-seed (incluídos)**: services:* (30s TTL), providers:count:*
    (radius-expansion, 120s), proximity:* (postgis, 60s), categories:*
    (categorias da vitrine), cat:desc:* (descendentes de categoria, 10min),
    reviews:recent:* (depoimentos, 60s).
  - **Excluídos de propósito (documentado no seed)**: geo:* (cep/search/
    reverse — cacheiam API EXTERNA ViaCEP/Nominatim, não dados do seed;
    edge conhecido: fallback local fica stale mas auto-expira 7d/24h),
    user:active:/realtime:revoked:/push:payload:/cron:cooldown:/
    geo:metrics: (estado de sessão/push/ops — IDs órfãos inofensivos).
- prisma/seed.ts: invalidateServicesCache() → invalidateCachePatterns(patterns[])
  genérico + constante CACHE_PATTERNS (6 padrões, readonly). Mesmo motor
  cluster-aware (SCAN por master + DEL, evitando CROSSSLOT) e standalone
  (KEYS + DEL) via ioredis puro — o seed standalone NÃO pode importar
  @/lib/redis (cadeia server-only). Best-effort: Redis fora → loga aviso e
  não falha o seed. Nit aplicado: cluster.nodes("master") hoisted para fora
  do loop de padrões.
- e2e/realtime-notification.spec.ts: comentário atualizado (referência ao
  nome novo e aos 6 padrões).
- Smoke real (Redis 6380): semeou 1 chave fake em cada um dos 6 padrões
  (PRE_EXIST=6) → rodou bun prisma/seed.ts → os 6 padrões invalidados
  (1 chave cada) e POST_EXIST=0.
- Gap pré-existente de ambiente descoberto no smoke: a tabela
  search_reindex_queue (migration custom 20260724140000_auto_reindex_triggers)
  nunca tinha sido aplicada ao banco dev (criado via db push) — o wipe do
  seed falhava com P2021. Corrigido com `prisma db execute` da migration
  (fora do escopo do delta).
- Validação: typecheck 0, prettier 0, eslint 0, reviewer 2 rodadas aprovado
  (nits de hoist + edge geo:* documentado, ambos aplicados).

## Task: TTL do sweep configurável + spec E2E de expiração por TTL

- **`SESSION_COOKIE_MAX_AGE_SECONDS`** (app, src/lib/auth.ts): TTL do cookie de
  sessão configurável via env (default 30d, clamp ≥ 60s). Helper puro exportado
  `resolveCookieMaxAgeSeconds` (guard `Math.max(60, Number(env) || default)`;
  unit-testado). O realtime NÃO lê essa env — o sweep usa o `expiresAt`
  EMBUTIDO e assinado no cookie de cada socket, então alterar o TTL do app
  nunca dessincroniza app ↔ realtime (decisão documentada no README).
- **`REALTIME_TTL_SWEEP_MS`** (realtime, mini-services/realtime): intervalo do
  sweep de TTL configurável via env (default 60000, clamp ≥ 1000). Helper puro
  `parseSweepIntervalMs` em security.ts (unit-testado), usado no
  `TTL_SWEEP_INTERVAL_MS` do index.ts. Passthrough adicionado nos composes
  dev e prod. Valor baixo em dev/CI acelera o spec E2E de TTL.
- **`e2e/realtime-ttl-sweep.spec.ts`** (novo): forja cookie HMAC com TTL de
  15s (mesmo SESSION_SECRET do app) e conecta um client socket.io Node
  (extraHeaders.Cookie) → join aceito (sessão verificada no handshake),
  sanidade via GET /sessions (provider online), espera o sweep (deadline =
  TTL + REALTIME_TTL_SWEEP_MS + close delay + margem) e valida: socket
  fechado + evento `session:revoked` com `reason: "session_expired"` +
  audit /sessions (`kicks[userId].reason === session_expired`; usuário fora
  do online). Provider isolado: lima@severinno.com.
- **POR QUE client Node e não browser/dashboard**: o app (getSession) também
  dispara session:revoke ao ver o cookie expirado no próximo request — o
  polling de 30s do dashboard correria com o sweep e o motivo registrado
  oscilaria entre "revoke" (app) e "session_expired" (sweep). O client Node
  sem requests ao app isola o caminho do sweep → reason determinística. A
  reação do client browser ao session:revoked já é coberta pelos specs
  session-revocation / admin-session-revocation.
- Validação: prettier/eslint/typecheck 0 + vitest alvo (auth.test +
  realtime-security.test) + spec E2E rodado com dev 3000 + realtime 3003.

## Task: telemetria do realtime persistida no Redis (janela deslizante)

- **`mini-services/realtime/redis-telemetry.ts`** (novo): persiste a telemetria
  do realtime em Redis com janela deslizante por TTL (buckets de minuto,
  24h): `realtime:telemetry:emits:{minuto}` (HASH event → emits no minuto,
  deltas por ciclo), `realtime:telemetry:multi:{minuto}` (JSON de métricas de
  sessão) e a flag de alerta `realtime:telemetry:multi:flag` (TTL ≈ 2×
  intervalo, self-clearing) quando usersWithMultipleSockets > 0 (sintoma de
  sockets órfãos/HMR que vazam). Helpers puros (buildTelemetryBucket,
  computeEmitDeltas) + createTelemetryPersister fail-open (client null ou
  erro → log dedup e resolve) + createRedisLoader lazy ioredis (mesmo padrão
  do booking-participant pg; docker-secret aware via readSecret).
- **`mini-services/realtime/index.ts`**: timer a cada
  REALTIME_TELEMETRY_INTERVAL_MS (default 30s; parseTelemetryIntervalMs em
  security.ts, unit-testado) reusa o getHealthSnapshot() do /health para
  persistir emitCounters + sessions metrics. unref (não segura o processo).
- **`src/app/api/admin/realtime/telemetry/route.ts`** (novo): GET admin
  ?minutes=N (default 60, max 1440) lê os buckets + flag num pipeline único
  (chaves derivadas do range — sem SCAN), agregando emits por evento.
  Degradação graciosa: Redis fora → { ok:false, available:false }.
- **Dependência**: ioredis 5.6.1 adicionada ao mini-services/realtime
  (mesma versão do app). Compose dev + prod: REDIS_URL + REALTIME_TELEMETRY_
  INTERVAL_MS no serviço realtime.
- **Unit tests**: realtime-telemetry.test.ts (deltas, keys, persister
  fail-open com client fake, flag só com órfãos, clamp do flagTtl, loader
  memoizado) + casos de parseTelemetryIntervalMs no realtime-security.test.ts
  - telemetry-route.test.ts (auth, degradação, agregação da janela, clamp
    minutes).
- Smoke real (Redis dev): realtime local reiniciado com REALTIME_TELEMETRY_
  INTERVAL_MS=2000 + REDIS_URL do .env.local → 3 ciclos geraram buckets
  emits/multi + flag no Redis (verificado via ioredis).
- Validação: prettier/eslint/typecheck 0 + vitest alvo + reviewer.

## Task: GET /health/detailed (Bearer) — recentEmits completo p/ debug do socket órfão

- **`mini-services/realtime/security.ts`**: tipos RecentEmitEntry (completo:
  userId/rooms/relatedIds) + PublicRecentEmit (só t/source/event) + helper puro
  `toPublicRecentEmits` — a FRONTEIRA DE PRIVACIDADE: o /health SEM auth só
  expõe a forma pública; qualquer vazamento de userId quebra o unit test.
- **`mini-services/realtime/index.ts`**: o ring `recentEmits` agora GUARDA o
  detalhe completo (antes só t/source/event — o userId/rooms só ia pro log de
  console); o `/health` público recebe `toPublicRecentEmits(...)`; NOVO
  `GET /health/detailed` (Bearer via verifyEmitToken, mesma regra do
  /sessions) devolve o snapshot completo + `recentEmits` COMPLETO (ring de 20)
  - `kicks` (snapshotKickAudit) — o rastreio de quem emitiu o quê para qual
    sala, para debugging do socket órfão do HMR. 401 sem Bearer.
- **Unit tests**: toPublicRecentEmits (strip + garantia explícita de que
  userId/rooms/relatedIds NÃO sobrevivem; ordem preservada; lista vazia).
- README: linha do Path + seção de debug do /health/detailed com curl.
- Validação: prettier/eslint/typecheck 0 + vitest alvo + smoke real (401 sem
  Bearer; 200 com Bearer expondo userId/rooms; /health público continua
  stripped) + reviewer.

## Task: alerta operacional de sockets órfãos (Sentry/GlitchTip webhook)

- **`mini-services/realtime/ops-alert.ts`** (novo): alerta quando
  usersWithMultipleSockets cruza o threshold (env REALTIME_ORPHAN_ALERT_
  THRESHOLD, default 0) via envelope Sentry v7 RAW (mesmo protocolo de
  ingest que o SDK usa — o mini-service Bun não tem @sentry/nextjs): parseDsn
  - buildEnvelopeUrl + buildSentryEnvelope (length em BYTES do payload) +
    generateEventId + parsers de env + createOrphanAlert (scheduler stateful:
    crossing → error; cooldown por direção default 15min clamp >= 60s;
    recovery → info; fail-open com log dedup). Sender default fetch +
    AbortSignal.timeout(10s); clock/sender injectáveis para teste.
- **`mini-services/realtime/index.ts`**: no timer de telemetria (mesmo
  snapshot do /health), após o persist no Redis → orphanAlert.evaluate().
  DSN via resolveAlertDsn (GLITCHTIP_DSN ?? SENTRY_DSN, docker-secret aware).
- **Compose dev + prod**: GLITCHTIP_DSN/SENTRY_DSN + REALTIME_ORPHAN_ALERT_
  THRESHOLD/COOLDOWN_MS no serviço realtime.
- **Unit tests** `src/lib/__tests__/realtime-ops-alert.test.ts`: parseDsn
  (válido/porta/http/inválido), envelope (header + item length em bytes +
  campos), env parsers (clamps), scheduler (sem alerta abaixo do threshold,
  crossing com error + contexto, cooldown, re-alerta pós-cooldown, recovery
  info com cooldown próprio, fail-open sem DSN e sender rejeitando).
- Smoke real: listener local capturou o envelope (level error + contexto
  usersWithMultipleSockets) com 2 sockets do mesmo user (threshold 0, max
  sessions 5); recovery (info) ao fechar um socket.
- Validação: prettier/eslint/typecheck 0 + vitest alvo + reviewer.

## Task: GET /metrics no realtime (telemetria persistida p/ dashboards)

- **`mini-services/realtime/redis-telemetry.ts`**: leitor da janela
  deslizante — `readTelemetryWindow(client, minutes, now)` com pipeline
  ÚNICO (hgetall emits + get multi por bucket + get flag; chaves derivadas
  do range, sem SCAN; O(minutes)); agrega emits por evento, ordena multi
  oldest→newest, skip de bucket corrompido, fail-open → null (endpoint
  responde available:false). `RedisPipelineLike` ganhou hgetall/get.
  Constantes TELEMETRY_BUCKET_MS / DEFAULT_METRICS_MINUTES (60) /
  MAX_METRICS_MINUTES (1440).
- **`mini-services/realtime/index.ts`**: GET /metrics (Bearer verifyEmitToken,
  mesmo do /sessions//health/detailed; 401 sem) → `?minutes=N` (default 60,
  max 1440) devolve `{ ok, available, minutes, windowStart, windowEnd,
emits, multi[], flag }` — emitCounters por minuto + histórico
  usersWithMultipleSockets + flag órfã (o mesmo contrato do
  GET /api/admin/realtime/telemetry do app). Loader Redis compartilhado
  (persister escreve, /metrics lê o mesmo client lazy).
- **Unit tests** `src/lib/__tests__/realtime-telemetry.test.ts`: agregação de
  emits + multi ordenado + flag; flag ausente → false; bucket corrompido e
  erro por comando → skip; clamp de minutes; fail-open (exec rejeita → null).
- README: Path + seção com curl do /metrics. Validação: prettier/eslint/
  typecheck 0 + vitest alvo + smoke real + reviewer.

## Task: admin sessions com idade de socket + conflitos/órfãos em tempo real

- **`mini-services/realtime/security.ts`**: `computeSocketAgeMs` puro
  (idade do socket desde o handshake; clamp >= 0; ausente/inválido → 0).
- **`mini-services/realtime/index.ts`**: `getActiveSessions()` agora inclui
  `ageMs` por socket (calculado no snapshot do GET /sessions).
- **`src/app/api/admin/realtime/sessions/route.ts`**: RealtimeSession ganhou
  `ageMs` (passthrough) + NOVO `buildSessionConflicts` puro — usuários com
  > 1 socket simultâneo (o sinal do órfão: HMR leak/stale/multi-tab),
  > ordenados por gravidade (socketCount desc, desempate: socket mais antigo),
  > com `oldestAgeMs` + o último kick como contexto; resposta ganhou
  > `conflicts[]` + `usersWithMultipleSockets`. Degradação graciosa mantida
  > (EMPTY quando realtime fora do ar, nunca 500).
- **Unit tests**: `computeSocketAgeMs` (idade/clamp/futuro/inválido) em
  realtime-security.test.ts + NOVO sessions-route.test.ts (401 sem ADMIN,
  degradação sem token e com fetch TimeoutError, agrupamento + ageMs/kicks
  passthrough + conflitos ordenados, e casos puros de buildSessionConflicts).
- README: linha Admin online na tabela do realtime + seção de sessões ativas.
- Validação: prettier/eslint/typecheck 0 + vitest alvo + smoke real + reviewer.

## Task: sweep de timeout em todos os fetch( de src/ (fecha classe de hangs)

Aplicar `envTimeoutSignal` a todo `fetch(` de `src/` que ainda não passava `signal` com `AbortSignal.timeout`, fechando a classe de hangs quando um serviço aceita TCP mas nunca responde.

**Sweep (23 fetches / 21 arquivos):**

- Wrapper central `src/lib/api.ts` (request<T>) — cobre apiGet/apiPost/apiPatch/apiDelete de toda a SPA.
- Libs: `routing.ts` (OSRM, converteu AbortController manual 5s → envTimeoutSignal), `slack-notify.ts`, `whatsapp.ts`, `use-upload.ts`.
- Store: `geo.ts` (CEP lookup client).
- Auth pages: `auth/reset-password/page.tsx`, `auth/reset-password/[token]/page.tsx`, `reset-password/reset-password-form.tsx`.
- Componentes: `admin-finance.tsx` (2), `gist-reindex-button.tsx`, `client-profile.tsx`, `file-photos.tsx`, `provider-date-blocks.tsx`, `provider-onboarding.tsx`, `provider-profile.tsx`, `ai-chat-widget.tsx`, `change-password-form.tsx`, `footer.tsx`, `push-subscriber.tsx` (2), `cta-banner.tsx`.

**Envs novos (padrão `*_TIMEOUT_MS` com fallback):** `API_TIMEOUT_MS` (15s), `UPLOAD_TIMEOUT_MS` (60s), `OSRM_TIMEOUT_MS` (5s), `SLACK_TIMEOUT_MS` (10s), `WHATSAPP_TIMEOUT_MS` (10s), `GEO_CEP_TIMEOUT_MS` (10s).

**Guard de regressão:** `scripts/check-fetch-timeout.mjs` (padrão check-*.mjs, `bun run check:fetch-timeout`) — falha se um `fetch(` de `src/` voltar a aparecer sem signal; trata falsos positivos (comentários/strings apagados, delegação pura `fetch(url, init)` com signal no arquivo, testes excluídos).

**Testes:** `src/lib/__tests__/api-timeout.test.ts` (signal no init do wrapper, não-trava com hang simulado 50ms, fallback de env inválido) + `src/lib/__tests__/check-fetch-timeout-cli.test.ts` (fixtures: limpo exit 0, violação cita arquivo:linha exit 1, delegação/comentário/teste exit 0, flag inválida exit 2).

**Validação:** prettier/eslint/typecheck/vitest + guard no repo verde.

## Task: piso global de timeout no fetch (GLOBAL_FETCH_TIMEOUT_MS)

Avaliar e implementar um AbortSignal.timeout DEFAULT no fetch global (instrumentation.ts + client), com env-specific sobrepondo via helper — fechando hangs de código que NÃO passa signal (libs de terceiros, fetches fora do guard).

**Modelo de precedência (única fonte de verdade):**

1. Signal EXPLÍCITO no `init` (ex.: `envTimeoutSignal("API_TIMEOUT_MS", ...)`) → passado INTACTO ao fetch nativo. Timeouts env-specific sempre vencem.
2. `Request` com signal próprio → honrado (alinhado ao spec do fetch — fetch(req) respeita req.signal).
3. Sem signal → piso global: `AbortSignal.timeout(GLOBAL_FETCH_TIMEOUT_MS, default 60s)`, com o mesmo guard de invalidez do `resolveTimeoutMs`.

**Implementação:**

- `src/lib/fetch-timeout.ts`: `installGlobalFetchTimeoutFloor()` — embrulha o fetch global; checa `init.signal` E `input.signal` (Request); idempotente via FLOOR_MARKER (protege HMR/registro duplo).
- Server: `src/instrumentation.ts` `register()` instala o piso (após `./lib/env`).
- Client: `src/lib/fetch-timeout-client.ts` ("use client") importado no `Providers` — browser-safe (`process?.env?.[envName]` já era optional chaining; no browser o valor efetivo é o fallback 60s, env não-NEXT_PUBLIC não chega ao bundle).

**Fix pós-review (HMR):** o `FLOOR_MARKER` nasceu como `Symbol`, mas no HMR o módulo client é re-avaliado e um Symbol novo perde identidade — o check `g.fetch[novoSymbol]` falharia no wrapper antigo e o fetch seria re-embrulhado a cada reload (leak de camadas). Trocado por chave STRING (`__severinno_fetch_timeout_floor__`) — igualdade por valor sobrevive à re-avaliação; o marker vive no wrapper, então restaurar o fetch original (testes) também o remove.

**Limite conhecido (documentado):** (1) `fetch(new Request(url))` nu SEMPRE carrega um signal (o default nunca aborta) — o wrapper não distingue default de explícito e honra o do Request (spec-aligned). O guard `check-fetch-timeout` cobre `src/`; o piso é rede de segurança para fora dele. (2) **Streaming/SSE:** o piso de 60s pode abortar respostas de streaming longo de libs de terceiros que não passam signal próprio — sem SSE no `src/` hoje; se entrar, o caller deve passar signal explícito (regra 1) para excluir o stream do piso.

**Testes:** `src/lib/__tests__/fetch-global-timeout.test.ts` (9 casos) — sem signal ganha signal do piso; init do caller não é mutado (spread); signal explícito no init vence; Request com signal vence; Request default passado intacto (limite conhecido); env controla o valor (spy AbortSignal.timeout); env inválida cai no fallback 60s; idempotência (2x instalação → mesmo wrapper); delegação única.

**Validação:** prettier/eslint/typecheck/vitest + guard `check:fetch-timeout` no repo verde; README env table + guards TOC/anchors.

## Task: timeouts de hang nos clientes Redis e S3 (REDIS_COMMAND_TIMEOUT_MS etc.)

Aplicar o mesmo padrão de proteção de hang (serviço que aceita TCP mas nunca responde) aos clientes Redis e S3 do app, que ainda não tinham cobertura de timeout — fechando a classe inteira de pendências HTTP/TCP.

**redis.ts (ioredis):**

- `REDIS_COMMAND_TIMEOUT_MS` (default 5s) — comando sem resposta aborta (o caso do Redis que aceita TCP mas nunca responde): sem ele, `cacheGet`/`cacheSet` travaria para sempre.
- `REDIS_CONNECT_TIMEOUT_MS` (default 10s) — handshake TCP/connect (cluster tinha hardcoded 10s; standalone não tinha nenhum).
- Aplicado no cluster (redisOptions) E no standalone. Reusa `resolveTimeoutMs` (mesmo guard de invalidez do fetch-timeout: NaN/'0'/negativo → fallback/clamp).

**s3.ts / storage.ts (SDK @aws-sdk/client-s3):**

- `S3_REQUEST_TIMEOUT_MS` (default 30s) — request inteira sem resposta aborta (s3.ts tinha 30s hardcoded; storage.ts NÃO tinha nenhum timeout).
- ❌ `S3_CONNECTION_TIMEOUT_MS` NÃO foi adotada: o connectionTimeout do SDK não funciona nesta versão (mesmo problema do requestTimeout) e o tipo do S3ClientConfig rejeita a opção top-level — documentação da env foi removida do README.
- ⚠️ **Descoberta empírica (SDK v3.1090.0, probes com servidor TCP real):** o `requestHandler: { requestTimeout }` como plain-object NÃO aplica os timeouts (handler.config fica sem eles), e o `requestTimeout` top-level no config do S3Client TAMBÉM não aborta contra um servidor que aceita TCP mas nunca responde (send pendurou >120s). O 30s antigo do s3.ts era um **no-op**. O mecanismo que FUNCIONA é o **abortSignal no segundo argumento do `client.send(cmd, { abortSignal: envTimeoutSignal("S3_REQUEST_TIMEOUT_MS", 30_000) })`** — rejeita com AbortError em ~timeoutMs (medido: 169ms com env 150ms). Aplicado inline nos 3 sends do s3.ts (uploadToS3, deleteFromS3, listObjects) e no uploadFile do storage.ts. Helper genérico com união de comandos quebra a inferência do send (TS não unifica os InitializeHandler) — inline preserva o output type por comando.

**Testes de hang (padrão realtime-client.test.ts, com TCP REAL node:net):**

- `src/lib/__tests__/redis-timeout.test.ts` — servidor TCP que aceita e nunca responde + ioredis REAL: `cacheSet`+`cacheGet` completam <3s (commandTimeout 150ms aborta, cadeia degrada standalone→memory, valor servido da memória); + test de wiring dos options a partir das envs.
- `src/lib/__tests__/s3-timeout.test.ts` — SDK REAL apontado para o TCP hang: `uploadToS3` rejeita <5s com "Falha ao fazer upload do arquivo".
- `src/lib/__tests__/storage-timeout.test.ts` — `uploadFile` retorna null <5s (engole o erro do SDK).

**Nota:** o `.env.example` linkado no README não existe no worktree (arquivo ausente/gitignored) — as novas envs ficam documentadas na tabela do README (seção Fetch timeouts, com nota dos clientes Redis/S3).

**Validação:** prettier/eslint/typecheck/vitest + guard check:fetch-timeout no repo verde; reviewer em paralelo.

## Task: guard de consistência das envs de timeout (check-timeout-envs.mjs)

Validar de ponta a ponta que os valores de timeout das envs (LYTEX_TIMEOUT_MS,
EVOLUTION_TIMEOUT_MS, GLITCHTIP_TIMEOUT_MS, ALERT_WEBHOOK_TIMEOUT_MS) estão
documentados no README/.env.example e no compose, com um guard de consistência.

**Descoberta:** as 4 envs existiam no código (fallbacks válidos) mas estavam
INVISÍVEIS na doc — a tabela "Fetch timeouts" do README não as listava,
`.env.example` não existia no repo (link quebrado) e o compose não passava
nenhuma env de timeout. Operação não sabia que dava para tunar o timeout do
Lytex/Evolution/GlitchTip/alerta, e o default documentado podia driftar do
código.

**Guard novo (`scripts/check-timeout-envs.mjs`, derivado — nada hardcoded):**

- DERIVA as 15 envs `*_TIMEOUT_MS` de src/ via `envTimeoutSignal`/
  `resolveTimeoutMs` (literal) + pares de constantes `X_ENV`/`X_DEFAULT_MS`
  (o GLOBAL_FETCH_TIMEOUT_MS é passado via constantes, não literal — o
  pareamento é por PREFIXO porque os nomes não são simétricos:
  `GLOBAL_FETCH_TIMEOUT_MS_ENV` vs `GLOBAL_FETCH_TIMEOUT_DEFAULT_MS`).
- Exige o par env+default (ms) nas 3 docs: README (tabela Fetch timeouts),
  `.env.example` e os 2 composes (docker-compose.yml + prod, serviço app).
- Bidirecional: forward (env sem doc/default divergente/defaults inconsistentes
  no próprio src/) + reverse (linha stale na tabela do README).
- Escopo: sufixo `_TIMEOUT_MS` (PRISMA_CONNECT_TIMEOUT_SEC etc. ficam fora).

**Docs corrigidas:** README +5 linhas na tabela (LYTEX 10s, EVOLUTION 10s,
GLITCHTIP 5s, ALERT_WEBHOOK 5s, REALTIME_EMIT 3s) + prosa dos guards de
regressão; `.env.example` CRIADO e rastreado (exceção `!.env.example` no
gitignore, sem segredos — só timeouts); docker-compose.yml + prod ganharam as
15 envs `ENV: ${ENV:-default}` no serviço app.

**Wiring:** package.json `check:timeout-envs` + pre-commit (após
check:fetch-timeout) + job `timeout-envs-guard` no pr-check.yml (mutation test

- guard real, padrão do fetch-timeout-guard — fora da matriz do master).

**Testes:** `src/lib/__tests__/check-timeout-envs-cli.test.ts` (8 CLI + 3
funções puras: blankComments preserva strings, parseDocDefaultMs, reverse
stale) + `scripts/test-mutation-timeout-envs.sh` (controle + 7 mutações:
README removido, default divergente, .env.example vazio, compose base/prod sem
env, linha stale, defaults inconsistentes em src/).

**Nota:** o guard exige o arquivo `.env.example` presente (fail-closed) — o
arquivo agora é rastreado, então CI/hooks sempre o têm.

**Validação:** guard no repo exit 0 (15 envs consistentes nas 3 docs) + vitest

- mutation test + typecheck + prettier/eslint + guards (hooks-symmetry,
  mutation-jobs, TOC/anchors) + reviewer.

---

Task ID: REVOKE-ORPHANS
<a id="revoke-orphans"></a>
Agent: buffy (ops/admin)
Task: Botão "Revogar sockets órfãos" no card de usuários online — desconecta sockets do realtime cuja sessão expirou por TTL OU cujo userId não existe (mais) no banco (contas removidas/soft-deletadas com sessão stale), com auditoria Redis + worklog.

Work Log:

- Criou o selector puro `selectOrphanSockets` em `mini-services/realtime/security.ts` (async; classifica expired por TTL sem consultar DB + missingUser via `isUserAlive` injetado; `toRevoke` = união sem duplicar; `userIdsToCheck` só dos não-expirados).
- Adicionou `POST /revoke-orphans` no realtime (Bearer fail-closed): `io.fetchSockets()` → `selectOrphanSockets` com `isUserAlive` reusando o pool pg lazy (SQL `SELECT 1 FROM "User" WHERE id=$1 AND "deletedAt" IS NULL` — tabela sem @@map, camelCase). FAIL-OPEN na checagem de existência (sem DB/erro → alive; só TTL-expirados revogados — nunca derruba usuário válido por falha de infra). Emite `session:revoked` + force-close atrasado + kick audit com o MESMO reason emitido (session_expired vs revoke). Responde `{ok, revoked, expired, missingUser, checkedUsers}`.
- Criou a rota admin `POST /api/admin/realtime/sessions/revoke-orphans` (requireRole ADMIN): proxy Bearer + `AbortSignal.timeout` (REALTIME_ORPHANS_TIMEOUT_MS 5s, guard ≥1s) + `recordRevokeRun` (source=admin, completed/error, reason com counts, elapsedMs medido). Degradação graciosa por NOME do TimeoutError (Bun não instanceof Error): sem token / realtime fora → `ok:false` 200, nunca 500.
- Card `OnlineUsersKpiCard` (admin-users + admin-providers): botão "Revogar sockets órfãos" + ConfirmDialog (H5) + toast do resultado + `invalidateQueries(['admin','realtime','sessions'])` (indicador re-renderiza).
- Auditoria: trail Redis via `revoke-run-audit.ts` (listável no painel) + esta entrada no worklog.

Resultado da varredura:

- Testes: rota admin (5) + selector puro (6) + card (7) = 18 verdes.
- Validação: typecheck 0, prettier 0, eslint 0 (só warning pré-existente MAX_METRICS_MINUTES), reviewer 4 rodadas sem bloqueio.
- Requisito: "Revogar todos os sockets órfãos" — implementado como "Revogar sockets órfãos" (rótulo mais preciso; o fluxo proxy+auditoria é coberto por testes).

Stage Summary:

- **Realtime**: endpoint novo + selector puro testável; kick audit consistente com o evento emitido.
- **Admin**: rota proxy Bearer + auditoria Redis; botão com confirmação no card compartilhado.
- **Segurança**: fail-closed no token; fail-open na checagem de existência (direção segura).

---

Task ID: WORKLOG-GUARD
<a id="worklog-guard"></a>
Agent: buffy (ops/docs)
Task: Guard de integridade do worklog.md — cada Task ID com o formato mínimo (Task ID/Agent/Task/Work Log) e IDs únicos, na família dos guards de docs.

Work Log:

- Criou `scripts/check-worklog.mjs` (node-puro, <1s): divide o worklog em entradas por separador `---` (fence-aware — ``` não quebra entrada), extrai headers (Task ID moderno + Stage legado + Agent/Task/Work Log com sufixo parentético tolerado) e valida: entrada sem ID = violação; Task ID vazio = violação; ID duplicado no arquivo = violação; sem Agent/Task/Work Log = violação. Head do arquivo (prosa antes do 1º separador) é isento.
- Worklog real normalizado para o formato mínimo: 3 entradas de commits antigos (COMMIT-6A900E1, CLEANUP-65-ARQUIVOS, RATE-LIMIT-UPSTASH-FIX) receberam Task ID/Agent/Task/Work Log; a DEPLOY-PATH-MIGRATE teve o heading `Work Log (evidência lida no código):` aceito pelo regex (sufixo parentético) — 36 entradas íntegras no repo.
- Wiring: package.json `check:worklog` + .husky/pre-commit (após check:timeout-envs) + job `worklog-guard` no pr-check.yml (rodada node, sem mutation test próprio).
- Testes: `src/lib/__tests__/check-worklog-cli.test.ts` (11 testes: CLI exit codes + funções puras splitEntries/extractEntryHeaders/checkWorklog com fences e legado) + `scripts/test-mutation-worklog.sh` (controle + 5 mutações: sem Agent/Task/Work Log, ID duplicado, sem ID).

Resultado da varredura:

- Guard no repo exit 0 (36 entradas íntegras, IDs únicos).
- Validação: vitest do CLI test + mutation test 5/5 + typecheck 0 + prettier/eslint 0 + guards de wiring (hooks-symmetry, mutation-jobs, workflow-refs, barrel-lint, TOC/anchors) + reviewer.

Stage Summary:

- **Guard**: check-worklog.mjs na família 4 (README/docs guards) — formato mínimo + unicidade de IDs enforced.
- **Docs**: GUARDS.md seção 4 atualizada; worklog com Task IDs únicos (3 entradas de commits normalizadas).
- **CI**: pre-commit + pr-check job worklog-guard.

---

Task ID: WORKLOG-TOC
<a id="worklog-toc"></a>
Agent: buffy (ops/docs)
Task: Índice (TOC) no topo do worklog.md listando todos os Task IDs com âncora e linha de resumo, para navegação rápida nas 30+ entradas — com guard de sincronia (check-worklog-toc.mjs) no padrão check-readme-toc.

Work Log:

- Criou `scripts/check-worklog-toc.mjs` (node-puro, <1s): extração fence-aware de entradas (`Task ID:` moderno + `Stage:` legado), linhas do TOC (`- [ID](#slug) — resumo`) e âncoras `<a id="slug">`; valida nas TRÊS direções: forward (todo link do índice resolve para âncora real), reverse (todo Task ID/Stage tem linha no índice) e anchor (âncora = slugify(id) — mesmo algoritmo github-slugger do check-readme-anchors, reutilizado por import, sem drift) + stale (linha do índice sem entrada real).
- Gerador `scripts/gen-worklog-toc.mjs`: deriva o resumo de cada entrada da linha `Task:` (truncado ~100 chars), normaliza a posição da âncora para logo após o Task ID, rejoin com separador `---` entre entradas e revalida com AMBOS os guards (TOC + integridade) antes de escrever — fail-closed, nunca deixa o repo quebrado. Idempotente (2ª run == 1ª).
- REPARO de estrutura no worklog: 6 entradas estavam COLADAS sem separador `---` (RT-TTL-REVOKE/RT-TELEMETRY/FETCH-TIMEOUT-HELPER/FETCH-TIMEOUT-TESTS/DATA-TIMEOUTS-AUDIT dentro do bloco do RT-SESSION-LIMIT + NPX-RUNNER-DIAG dentro do CRON-PASSWORD-CHANGE-REVOKE) — 43 IDs em 37 blocos. Separadores re-inseridos (fence-aware) → 43 entradas íntegras; o check-worklog agora conta 43.
- TOC real regenerado: 43 linhas com resumo derivado da Task: de cada entrada (zero placeholders `— —`).
- Wiring: package.json `check:worklog-toc` + `gen:worklog-toc` + .husky/pre-commit (após check:worklog) + job `worklog-toc-guard` no pr-check.yml (com mutation test bash antes do check — satisfaz o check-mutation-jobs).
- Testes: `src/lib/__tests__/check-worklog-toc-cli.test.ts` (CLI exit codes + funções puras extractEntries/extractTocRows/extractAnchors/checkWorklogToc com fences, tabelas e legado) + `scripts/test-mutation-worklog-toc.sh` (controle + 4 mutações: sem linha no índice, sem âncora, slug errado, linha stale).

Resultado da varredura:

- Guard no repo exit 0 (43 entradas ↔ 43 linhas de índice, forward + reverse + anchor ok).
- Validação: vitest do CLI test + mutation test + typecheck + prettier/eslint + guards de wiring (hooks-symmetry, mutation-jobs, mutation-count, workflow-refs, barrel-lint, TOC/anchors) + reviewer.

Stage Summary:

- **Guard**: check-worklog-toc.mjs na família 4 — índice bidirecional enforced (todo ID indexado, todo link resolve, slug correto).
- **Gerador**: gen-worklog-toc.mjs mantém o índice em sincronia (resumo da Task:, âncora normalizada, idempotente).
- **Reparo**: 6 entradas coladas sem separador re-parceladas (43 blocos íntegros).
- **Docs**: GUARDS.md seção 4 atualizada; worklog com Task ID WORKLOG-TOC.
- **CI**: pre-commit + pr-check job worklog-toc-guard.

---

Task ID: CACHE-PATTERNS-GUARD
<a id="cache-patterns-guard"></a>
Agent: buffy (ops/docs)
Task: Adicionar um guard check-*.mjs que valida a lista CACHE_PATTERNS do seed contra os prefixes reais de withCache/cacheInvalidate do src/ (detecta prefixos novos esquecidos ou padrões órfãos), no padrão dos guards de docs/escopo do repo.

Work Log:

- Criou `scripts/check-cache-patterns.mjs` (node-puro, <1s): deriva os padrões do literal `CACHE_PATTERNS` do prisma/seed.ts (fonte da verdade — nunca hardcoded) e os prefixes reais dos call sites `withCache`/`withCachedGeo`/`cacheInvalidate` + builders `*CacheKey` em arquivos cache-capable de src/ (testes excluídos, comentários blanked preservando strings). Valida nas DUAS direções: forward (prefixo de catálogo NOVO em src/ sem padrão no CACHE_PATTERNS nem na ALLOWLIST = esquecido do re-seed — a janela de stale volta) e reverse (padrão do seed sem nenhum uso real em src/ = órfão).
- ALLOWLIST no guard (espelho exato do comentário "Excluídos de propósito" do seed): `geo:*`, `user:active:*`, `realtime:renewed:*`, `realtime:revoked:*`, `distance:*`, `postgis:available`, `push:payload:*`, `cron:cooldown:*`, `geo:metrics:*` — não-catálogo não vira falso positivo.
- Calibração com probe: varredura ingênua de strings pegava CSS/tailwind/logs/protocolos (`https:`, `dark:bg-*`, `node:buffer`) — a extração scoped (call sites + templates com shape de chave sem espaços) pega EXATAMENTE os 15 prefixes reais sem ruído.
- Comentário do prisma/seed.ts atualizado: exclusões agora documentam `realtime:renewed:*`, `distance:*` e `postgis:available` (espelho da ALLOWLIST do guard).
- Wiring: package.json `check:cache-patterns` + .husky/pre-commit (após check:worklog-toc) + job `cache-patterns-guard` no pr-check.yml (com mutation test bash antes do check — satisfaz o check-mutation-jobs).
- Testes: `src/lib/__tests__/check-cache-patterns-cli.test.ts` (CLI exit codes + funções puras extractCachePatterns/collectCachePrefixes/checkCachePatterns/stripComments) + `scripts/test-mutation-cache-patterns.sh` (controle + mutações A forward/B reverse/C allowlist).

Resultado da varredura:

- Guard no repo exit 0 (6 padrões catálogo ↔ 6 prefixes reais + 9 allowlist, zero falsos positivos).
- Validação: vitest do CLI test + mutation test + typecheck + prettier/eslint + guards de wiring (hooks-symmetry, mutation-jobs, mutation-count, workflow-refs, barrel-lint, TOC/anchors) + reviewer.

Stage Summary:

- **Guard**: check-cache-patterns.mjs na família 4 — CACHE_PATTERNS nunca deriva do código (forward + reverse + allowlist).
- **Derivação**: padrões do literal do seed; prefixes dos call sites reais (nada hardcoded).
- **Docs**: GUARDS.md seção 4 atualizada + comentário de exclusões do seed em sync com a ALLOWLIST; worklog com Task ID CACHE-PATTERNS-GUARD.
- **CI**: pre-commit + pr-check job cache-patterns-guard.

---

Task ID: DEV-DB-DRIFT-MIGRATIONS
<a id="dev-db-drift-migrations"></a>
Agent: buffy (ops/data)
Task: Aplicar as demais migrations custom pendentes ao banco dev (XX_add_postgis GIST indexes, mv_provider_stats, índices compostos, user/service search_vector) via prisma db execute e documentar o estado de drift do ambiente (db push vs migrations SQL custom).

Work Log:

- DRIFT IDENTIFICADO no banco dev (postgres:5433, db severinno_test): criado por `prisma db push` (SEM tabela `_prisma_migrations`), ele diverge das migrations SQL customizadas que o db push não cobre. Inventário pré-aplicação:
  - JÁ APLICADO (via seed/setup anterior): extensão postgis, colunas location (User/Booking/QuoteRequest), triggers de sync de location/rating/favorite, search_reindex_queue + notify_search_reindex, soft-delete (deletedAt), tabelas de push/webhook, passwordChangedAt/revokedByCronAt, updatedAt, FKs RESTRICT.
  - PENDENTE (6 migrations): GIST indexes da coluna location (idx_user/booking/quoterequest_location_gist — a query ST_DWithin(u.location) usa a COLUNA, não a expressão ST_MakePoint), search_vector de User (coluna + GIN + trigger + backfill), GIN/trigger de Service search_vector, mv_provider_stats (materialized view + refresh triggers), e os ~25 índices compostos custom `idx_*` (20260722120000/24130000/24160000).
- APLICADO via `prisma db execute --file <migration.sql>` (ordem importa): XX_add_postgis → 20260722120000_add_performance_indexes → 20260724120000_mv_provider_stats → 20260724130000_add_composite_indexes → 20260724160000_add_missing_composite_indexes → 20260726120000_add_user_search_vector. Todas exit 0 (idempotentes — IF NOT EXISTS/CREATE OR REPLACE/DROP IF EXISTS).
- FIX DE ORDEM EM XX_ADD_POSTGIS (revisor): `migrate deploy` aplica as migrations em ordem LEXICOGRÁFICA — `20260722120000_add_performance_indexes` (começa com "2") roda ANTES de `XX_add_postgis` ("X"). A 22120000 cria `idx_user_location_gist` como índice de EXPRESSÃO geométrica (ST_MakePoint(lng,lat)) com o MESMO nome; o `CREATE INDEX IF NOT EXISTS` da XX seria então PULADO (nome já existe) e a query `ST_DWithin(u.location, ...)` (opclass geography) ficaria SEM índice em produção. Fix aplicado no arquivo: XX_add_postgis agora faz `DROP INDEX IF EXISTS` antes do `CREATE INDEX IF NOT EXISTS` nos 3 GIST indexes (user/booking/quoterequest) — a definição na COLUNA location é garantida independente da ordem de aplicação. Grep confirma que nenhuma query da app usa a expressão crua ST_MakePoint(lng,lat) (todas usam `location` / `::geography`), então dropar o índice de expressão é seguro. Re-aplicado no dev e verificado: `pg_indexes` mostra os 3 como `USING gist (location)`.
- VERIFICAÇÃO PÓS-ESTADO: User.search_vector preenchido 9/9 (backfill ok); 5 índices GIST/GIN (idx_user/booking/quoterequest_location_gist, idx_service_search_vector, idx_user_search_vector); mv_provider_stats com 6 rows; triggers trg_user/service_search_vector + trg_refresh_mv_on_review/booking/favorite; 30 índices custom `idx_*` presentes.
- VALIDAÇÃO FUNCIONAL: busca full-text com o padrão EXATO da app (`encanador:*` → to_tsquery 'portuguese') retorna "Carlos Encanador"; GIST index confirmado via EXPLAIN (Bitmap Index Scan em idx_user_location_gist quando enable_seqscan=off — o Seq Scan padrão é escolha de custo com 9 rows, correto); MV retorna avg_rating/review_count/completed_booking_count/favorite_count coerentes.
- NOTA (quirk do PG): busca por prefixo curto (`encanad:*`) retorna vazio — o config 'portuguese' aplica stemming no prefixo; a app manda palavras completas + `:*`, que funciona. Não é bug da migration.
- DOCUMENTAÇÃO DE DRIFT (estado completo do ambiente):
  - O banco dev é criado por `db push` (sem tabela `_prisma_migrations`) — migrations SQL custom precisam ser aplicadas manualmente; produção usa `migrate deploy` (ver README/deploy). DISTINÇÃO IMPORTANTE: `migrate deploy` aplica DIRETÓRIOS versionados (ex.: `XX_add_postgis` É diretório → chega à produção automaticamente); arquivos SOLTOS na raiz de prisma/migrations/ (ex.: `003_database_optimizations.sql`) NÃO são executados — precisam de caminho explícito em produção.
  - ACHADO 1 (mv_provider_stats): materialized view declarada no schema.prisma (`MvProviderStats`, type-safe) mas SEM uso ativo nas rotas — a vitrine usa as colunas denormalizadas `u.avgRating/reviewCount/favoriteCount` (fonte primária, ver 20260726130000). Os triggers de refresh (trg_refresh_mv_on_review/booking/favorite) rodam `REFRESH MATERIALIZED VIEW CONCURRENTLY` em CADA statement de Review/Booking/Favorite — write amplification real duplicando o sync denormalizado. Decisão documentada: manter (pré-computação disponível para queries futuras), mas revisitar antes de produção — se nenhuma query futura precisar de stats pré-computados, dropar SÓ os refresh triggers (não a MV) elimina a amplificação preservando o modelo declarado type-safe.
  - ACHADO 2 (003_database_optimizations.sql root-level): arquivo SOLTO na raiz de prisma/migrations/ (não é diretório versionado) — `migrate deploy` NÃO executa arquivos root-level, só diretórios (contraste com XX_add_postgis, que É diretório e chega à produção). Seus efeitos (updatedAt, Category.search_vector, FKs RESTRICT, índices compostos) entraram no dev via db push/schema ou aplicação manual — produção PRECISA de caminho explícito para o 003 (ou consolidar no schema).
  - ACHADO 3 (Notification_userId_idx): o 003 manda dropar (redundante com o composto userId+createdAt) mas o schema.prisma declara `@@index([userId])` — o db push recria. Redundância persistente no dev; alinhar schema se quiser eliminar.
  - ACHADO 4 (tabelas de fila duplicadas): `search_reindex_queue` (minúsculo — gravado pelos triggers e pelos helpers sync*Search, drenado pelo consumer src/queue/search-index-consumer.ts) E `SearchReindexQueue` (PascalCase, criada pela 20260728150000 — SEM uso em código). A pipeline funciona na minúscula; a PascalCase é peso morto — dropar na próxima janela de manutenção.
  - ACHADO 5 (User.search_vector fora do schema): a coluna/trigger/GIN de search_vector de User existe só via migration SQL (20260726120000) — o schema.prisma NÃO declara (Service/Category têm `search_vector Unsupported("tsvector")?`; User não). Re-seeds/`db push` em outro ambiente perdem a coluna — adicionar `search_vector Unsupported("tsvector")?` ao model User para o db push recriar.
  - ACHADO 6 (colisão de nome de índice XX × 22120000 em produção): o dev só ficou correto porque a XX foi aplicada MANUALMENTE antes da 22120000. Em produção `migrate deploy` roda 22120000 primeiro (lexicográfico) e o `IF NOT EXISTS` da XX pularia o índice na coluna — `ST_DWithin(u.location)` sem índice espacial em prod. CORRIGIDO no arquivo XX_add_postgis (DROP antes de CREATE, ver bullet acima); a correção é idempotente e já revalidada no dev. CAVEAT para ambientes que JÁ aplicaram a XX com o conteúdo antigo: `migrate deploy` não re-executa migrations presentes no `_prisma_migrations` — o arquivo editado fica inerte nesses ambientes e o índice de expressão sobrevive. Remediação: DROP INDEX + CREATE INDEX manual na coluna (ou migration de follow-up).

Resultado da varredura:

- 6 migrations custom aplicadas no banco dev (5433/severinno_test), exit 0 todas; pós-estado validado (colunas, GIN/GIST, MV, triggers, índices) e funcional (busca + geo + vitrine).

Stage Summary:

- **Drift**: banco dev criado por db push sem `_prisma_migrations` — migrations SQL custom ficam fora do schema push.
- **Aplicação**: 6 arquivos via prisma db execute; fix de ordem de índice embutido na XX (DROP antes de CREATE — não depende mais da ordem manual).
- **Validação**: search_vector backfill 9/9, busca da app ok, GIST index ok (Bitmap Scan), MV com 6 providers.
- **Docs**: worklog Task ID DEV-DB-DRIFT-MIGRATIONS.

---

Task ID: KICK-AUDIT-REDIS
<a id="kick-audit-redis"></a>
Agent: buffy (ops/realtime)
Task: Persistir o kick audit do realtime no Redis (em vez de Map em memória) para sobreviver a restart do serviço e permitir histórico por usuário no painel admin — seguindo o padrão do cron de revogação (pool serializado + cooldown).

Work Log:

- PROBLEMA: o kick audit (por que os sockets de um usuário foram derrubados: session_limit / revoke / session_expired) vivia num Map em memória (security.ts recordKickAudit/snapshotKickAudit + index.ts). Um restart do realtime zerava o histórico; o painel admin só via o ÚLTIMO kick por usuário, sem série temporal.
- SOLUÇÃO: novo módulo mini-services/realtime/redis-kick-audit.ts — persister com:
  - Chave única `realtime:kick-audit` (STRING JSON, TTL janela deslizante 7d, sem SCAN) mapeando userId → { count, entries[] } com entries bounded (KICK_HISTORY_MAX=20) e usuários capped (KICK_USERS_MAX=500, eviction do mais antigo por ordem de inserção).
  - Escrita em LOTE com COOLDOWN (debounce flush a cada REALTIME_KICK_AUDIT_FLUSH_MS, default 5s, clamp >= 1s — mesmo guard `Math.max(1, Number(env) || default)` do repo) em vez de um RMW por kick.
  - POOL de 1: flush serializado (o cron de revogação usa pool 5; aqui o RMW é sobre UMA chave, então 1 é o pool correto) — flushs concorrentes são coalesced.
  - FAIL-OPEN: sem REDIS_URL ou Redis fora → record() mantém o pending em memória (espelho do antigo Map) e snapshot() funde Redis + pending; um kick ou um GET /sessions nunca quebra por falha de Redis.
  - Loader INJETADO (duck-typed, zero import de ioredis no módulo) — o index.ts reusa o createRedisLoader() da telemetria; testes unitários passam fakes.
- WIRING (mini-services/realtime/index.ts): os 4 call sites de recordKickAudit (session_limit no enforceSessionLimit, session_expired no TTL sweep, revoke no handleSessionRevoke e revoke-orphans) agora chamam kickAudit.record(userId, reason, socketId, at); os 2 snapshot (GET /sessions e GET /health/detailed) chamam `await kickAudit.snapshot()` (assíncrono, com history).
- ADMIN (src/app/api/admin/realtime/sessions/route.ts + admin-users.tsx + admin-providers.tsx): tipo RealtimeKickInfo estendido com `history[]` (reason/at/socketId, oldest → newest); o tooltip do OnlineSessionsCell (espelho H4 nas duas views) agora lista os últimos kicks além do motivo atual — o admin vê a série (ex.: session_limit às 14h, revoke às 15h), não só o último.
- TESTES: src/lib/**tests**/realtime-kick-audit.test.ts (padrão realtime-telemetry.test.ts, fake client sem ioredis): helpers puros (append merge/bounded/eviction, snapshot último=current, parse sanitize/corrompido), flush grava setex com TTL 7d, snapshot funde Redis+pending, cooldown com fake timers (nada antes do intervalo, um setex coalesced com 2 kicks), pool de 1 (3 flushs concorrentes → 1 write), fail-open (loadClient null/rejeita, setex rejeita com retry do pending, get rejeita), no-op com userId vazio.
- FIX de default: o flushIntervalMs do persister tinha bug quando a option era omitida (caía para 1s em vez do default 5s) — corrigido com default honesto + clamp >= 1s.
- DECISÃO (padrão do cron): a janela deslizante de 7d + bounded por usuário mantém o Redis pequeno e a leitura O(1) (uma chave, sem SCAN) — suficiente para o painel admin e auditoria pós-incidente.

Resultado da varredura:

- Kick audit persistido no Redis (sobrevive a restart), histórico por usuário exposto no admin, 16 testes unitários verdes, fail-open em todos os caminhos de Redis.

Stage Summary:

- **Persistência**: realtime:kick-audit (STRING, TTL 7d) com pool de 1 + cooldown 5s + fail-open (pending em memória cobre Redis fora).
- **Admin**: RealtimeKickInfo.history[] + tooltip do OnlineSessionsCell lista os últimos kicks (users e providers).
- **Testes**: realtime-kick-audit.test.ts (helpers + persister + cooldown/pool/fail-open), padrão da telemetria.
- **Docs**: worklog Task ID KICK-AUDIT-REDIS (TOC sincronizado).

---

Task ID: SESSION-CONFLICT-ALERT
<a id="session-conflict-alert"></a>
Agent: buffy (ops/realtime/admin)
Task: Adicionar badge de conflito de sessão na view de detalhes do provider (ProviderProfileModal) e alerta global no topo do AdminDashboard quando houver qualquer usuário com >1 socket simultâneo no realtime.

Work Log:

- MOTIVAÇÃO: o indicador de conflito de sessão (>1 socket simultâneo — órfão de HMR / stale / multi-tab) existia só na coluna "Online" das tabelas admin (OnlineSessionsCell). O admin precisava do problema visível: (1) NA view de detalhes do provider (ao abrir o perfil para revogar/desativar) e (2) GLOBALMENTE na primeira tela do dashboard.
- NOVO COMPONENTE src/components/admin/admin-session-conflict-alert.tsx: banner global (Alert âmbar) que renderiza quando usersWithMultipleSockets > 0 — contagem de usuários em conflito + total de sockets + CTA "Ver usuários" (onNavigate("admin.users")). Degradação graciosa: sessionsData undefined / ok:false / 0 conflitos → renderiza NADA (dashboard nunca quebra). Exportado via _shared.ts (padrão OnlineUsersKpiCard).
- WIRING AdminDashboard: nova query de sessões com a MESMA queryKey compartilhada ["admin","realtime","sessions"] (staleTime 15s, refetchInterval 30s — cache reutilizado com as tabelas admin, zero fetch extra) e <SessionConflictAlert> no topo da view.
- BADGE ProviderProfileModal (admin-only): o modal agora lê useAuthStore.user.role — só ADMIN dispara a query de sessões (enabled: isAdmin && open && !!providerId, mesma key compartilhada). provider.id É o userId (a rota /api/providers/[id] busca db.user por id), então casa direto com sessions[userId]. Badge âmbar "N sessões" + tooltip no header (ao lado do Verificado) quando o provider tem >1 socket. Clientes/visitantes nunca disparam a query (gate isAdmin).
- TESTES: (1) admin-session-conflict-alert.test.tsx (novo, 7 testes): nada sem dados / ok:false / 0 conflitos; banner com contagem singular+plural; CTA navega admin.users; sem onNavigate → sem botão. (2) provider-profile-modal.test.tsx (4 testes novos no bloco "session conflict badge"): não-admin não vê badge mesmo com sockets; admin vê com 3 sockets; 1 socket → sem badge; ok:false → sem badge. Mock de useQuery brancha por queryKey (provider vs admin sessions).
- DECISÃO: o badge/alert são 100% client-side sobre a resposta existente do GET /api/admin/realtime/sessions (sem mudança de API). O AdminDashboard testa com o mock de useQuery retornando o mesmo objeto para as duas queries — o alert degrada (usersWithMultipleSockets undefined → nada), mantendo o teste existente verde.

Resultado da varredura:

- Conflito de sessão visível em 2 novos pontos (detalhe do provider + topo do dashboard), 11 testes novos/estendidos, sem mudança de API.

Stage Summary:

- **Dashboard**: SessionConflictAlert global no topo (query key compartilhada, degrada gracioso).
- **Modal provider**: badge "N sessões" admin-only (gate useAuthStore + enabled).
- **Testes**: 7 (alert) + 4 (modal badge) = 11 novos.
- **Docs**: worklog Task ID SESSION-CONFLICT-ALERT (TOC sincronizado).

---

Task ID: SESSION-CONFLICT-E2E
<a id="session-conflict-e2e"></a>
Agent: buffy (realtime/admin/e2e)
Task: Spec E2E do indicador de conflito de sessão (badge âmbar "2 sessões" no admin via refresh manual + session_limit no tooltip) + alinhamento do realtime dev ao limite por role documentado (PROVIDER=2) + adaptação do realtime-session-limit.spec.ts ao novo limite.

Work Log:

- MOTIVAÇÃO: o badge de conflito (>1 socket simultâneo) e o tooltip de kick existiam na UI admin (OnlineSessionsCell / SESSION-CONFLICT-ALERT), mas só com unit tests. Faltava a prova NO BROWSER: 2 abas do mesmo provider → badge âmbar "2 sessões" via refresh manual; 3ª aba → tooltip com o motivo do último kick (session_limit).
- DRIFT DESCOBERTO (probe realtime-probe.mjs): o realtime dev rodando aplicava max:1 para PROVIDER (2º socket derrubava o 1º na hora — badge "2 sessões" impossível), enquanto o repo documenta o limite por role no compose e nas notas do admin-session-revocation ("limite de sockets por PROVIDER no realtime é 2"). Alinhado o .env.local com REALTIME_MAX_SESSIONS_PER_ROLE={"CLIENT":1,"PROVIDER":2,"ADMIN":5} e reiniciado o realtime → probe 2 confirmou: 2 sockets coexistindo + 3º derruba o mais antigo com session:limit max:2.
- BUG REAL CORRIGIDO de passagem: mini-services/realtime/index.ts declarava telemetryLoadClient DUAS vezes (linhas ~329 e ~530) — o realtime nem subia após o restart ("has already been declared"). Removida a declaração duplicada (o loader é memoizado e compartilhado — a seção de telemetria só consome).
- NOVO SPEC e2e/admin-session-conflict.spec.ts: provider ISOLADO registrado via API no beforeAll (email único por run — os 6 do seed já pertencem a outros specs de realtime; com limite PROVIDER=2 um terceiro spec no mesmo provider derrubaria os sockets deles). Fases: admin na view Usuários → aba A + aba B (2 sockets coexistem) → refresh manual ("Atualizar status online") → badge âmbar "2 sessões" na linha → aba C (3 > 2 derruba o mais antigo) → refresh manual → badge segue "2 sessões" + hover no badge → tooltip "Último kick: limite de sessões (2ª aba derrubou a 1ª)" + sanidade de close do socket A.
- ADAPTAÇÃO e2e/realtime-session-limit.spec.ts ao PROVIDER=2: o spec assumia limite 1 (2ª aba derrubava a 1ª) e quebraria com o novo limite. Reescrito para o fluxo real: abas A e B coexistem (dentro do limite), aba C derruba a MAIS ANTIGA (A) com session_limit; toasts nas abas vivas (B/C), nenhum na A. FOOTGUN do header atualizado para "REQUISITO DE CONFIG" (PROVIDER=2 ativo no dev).

Resultado da varredura:

- Indicador de conflito validado no browser (badge + tooltip), realtime dev alinhado à config documentada, spec de limite adaptado e bug de boot do realtime corrigido.

Stage Summary:

- **Config**: .env.local com REALTIME_MAX_SESSIONS_PER_ROLE (PROVIDER=2) + realtime reiniciado (probe confirma max:2).
- **Bugfix**: duplicata telemetryLoadClient removida (realtime voltou a subir).
- **E2E novo**: admin-session-conflict.spec.ts (badge "2 sessões" + session_limit no tooltip, provider isolado via register).
- **Adaptação**: realtime-session-limit.spec.ts → fluxo 3 abas (limite 2).
- **Docs**: worklog Task ID SESSION-CONFLICT-E2E (TOC sincronizado).

---

Task ID: REALTIME-PORT-ENV
<a id="realtime-port-env"></a>
Agent: buffy (realtime/infra)
Task: Parametrizar o PORT do realtime mini-service via env (REALTIME_PORT com fallback 3003) de ponta a ponta.

Work Log:

- DRIFT DESCOBERTO: o docker-compose.yml JÁ repassava `PORT: ${REALTIME_PORT:-3003}` ao container realtime, mas o index.ts tinha `const PORT = 3003` hardcoded — a parametrização do compose era MORTA (o serviço sempre ouvia em 3003). Smoke de boot em porta alternativa (ex.: 3199) era impossível e testes de isolamento (múltiplas instâncias no mesmo host) ficavam inviáveis.
- FIX SERVIDOR: `parseRealtimePort` em mini-services/realtime/security.ts (padrão do parseSweepIntervalMs: NaN/não-inteiro/'0'/fora do range 1–65535 → fallback; uma porta inválida NUNCA derruba o listen) + index.ts `const PORT = parseRealtimePort(process.env.REALTIME_PORT ?? process.env.PORT)` (aceita REALTIME_PORT primeiro, depois PORT — compatível com o contrato do compose; fallback 3003). Header do index.ts atualizado (XTransformPort=<port>).
- CLIENTES DERIVAM A MESMA PORTA (isolation reflete sem tocar em código): src/lib/realtime-client.ts (REALTIME_URL default de REALTIME_PORT), src/lib/env.ts (REALTIME_PORT no schema + REALTIME_URL default derivado), src/hooks/use-realtime.ts (NEXT_PUBLIC_REALTIME_PORT no XTransformPort do gateway), rotas admin src/app/api/admin/realtime/sessions/route.ts + revoke-orphans/route.ts, e src/app/api/health/detailed/route.ts (healthcheck em Docker: http://realtime:${REALTIME_PORT}).
- E2E: e2e/realtime-emit.ts ganhou `realtimePort()` (readEnv REALTIME_PORT ?? "3003") e os 5 specs que filtravam websockets/URLs com :3003 hardcoded (admin-session-revocation, admin-session-conflict, realtime-session-limit, session-revocation, realtime-ttl-sweep) agora usam o helper — rodar o realtime em porta alternativa não quebra os specs.
- COMPOSES + DOCS: docker-compose.dev.yml (ports + REALTIME_PORT env), docker-compose.yml (REALTIME_PORT + PORT mantido para compatibilidade), .env.example (REALTIME_PORT=3003), README (linha da porta + seção "Porta alternativa" com smoke boot).
- TESTES: parseRealtimePort (6 casos — valid/invalid/range/fracionário) no realtime-security.test.ts + env.test.ts (REALTIME_URL default derivada da REALTIME_PORT e REALTIME_URL manual sobrescrevendo).

Resultado da varredura:

- Porta do realtime 100% configurável via env com fallback 3003, sem nenhum 3003 funcional hardcoded no código (restam só EXPOSE do Dockerfile, comentários e o default documentado).

Stage Summary:

- **Servidor**: parseRealtimePort + PORT via REALTIME_PORT/PORT (fallback 3003).
- **Clientes**: realtime-client, env, use-realtime, rotas admin + health/detailed derivam a porta.
- **E2E**: realtimePort() no realtime-emit + 5 specs sem :3003 hardcoded.
- **Infra/docs**: composes dev/prod, .env.example, README com smoke de boot alternativo.
- **Validação**: typecheck + vitest + eslint/prettier + guards + smoke real com REALTIME_PORT=3199.

---

Task ID: SESSION-LIMITS-ADMIN
<a id="session-limits-admin"></a>
Agent: buffy (realtime/admin)
Task: Refletir o limite de sessões POR ROLE no painel admin — exibir o `max` aplicado por usuário no tooltip do kick (o mesmo valor do payload session:limit) e a config atual de limites por role num card de status no dashboard admin.

Work Log:

- GAP: o payload `session:limit` emitido ao socket derrubado JÁ carregava `max` (limite por role aplicado), mas o kick AUDIT (Redis, realtime:kick-audit) NÃO persistia esse valor — o tooltip do admin mostrava o motivo (session_limit) sem o limite aplicado, e o texto do conflito dizia "limite do realtime é 1" hardcoded (errado com PROVIDER=2).
- KICK AUDIT COM MAX: mini-services/realtime/redis-kick-audit.ts — StoredKickEntry ganha `max?: number` (só session_limit carrega; revoke/session_expired → undefined), KickAuditSnapshotEntry + history ganham max, `record(userId, reason, socketId, at, max?)` persiste com guard (número >= 1 → floor; inválido → undefined), `parseStoredKickAudit` sanitiza max (válido mantido, inválido DERRUBADO — nunca aceita dado corrompido), `storedToKickSnapshot` carrega max do último entry + history.
- EMISSOR: mini-services/realtime/index.ts — `enforceSessionLimit` agora passa `maxSessions` ao `kickAudit.record` (o MESMO valor do payload session:limit — fonte única). NOVO `SESSION_LIMITS_CONFIG` (default global + CLIENT/PROVIDER/ADMIN resolvidos via resolveMaxSessionsPerRole — a MESMA resolução do join) exposto no GET /sessions (Bearer).
- ROTA ADMIN: src/app/api/admin/realtime/sessions/route.ts — RealtimeKickInfo ganha `max` (+ history), NOVO tipo RealtimeLimitsConfig, response passa `limits` do realtime (ausente → undefined, degradação graciosa).
- UI (tipos IDÊNTICOS nos dois admins — H4): admin-users.tsx + admin-providers.tsx — tipo kicks ganha max + limits; OnlineSessionsCell mostra "Limite aplicado: N socket(s) simultâneo(s)" quando session_limit com max; texto do CONFLITO dinâmico por role ("Conflito: 2 sessões ativas — o limite de PROVIDER é 2 sockets por usuário") em vez do default hardcoded 1, com cláusula de derrubada SÓ acima do limite (count > roleLimit) — honesto: com PROVIDER=2 e 2 sockets nada é derrubado até a 3ª aba.
- CARD DE STATUS: NOVO src/components/admin/admin-session-limits-card.tsx — card no AdminDashboard com default + max por role (Clientes/Prestadores/Administradores), degrada para NADA quando realtime fora (available=false) ou limits ausente; exportado em _shared.ts; AdminDashboard renderiza com limits={sessionsData?.limits} available={sessionsData?.ok === true}; SessionConflictAlertData ganha limits (optional).
- TESTES: realtime-kick-audit (max no snapshot/history, record com max, record sem max → undefined, parse sanitize max incl. floor de fracionário e derrubada de inválido), sessions-route (limits pass-through, sem limits → undefined, KICK com max), NOVO admin-session-limits-card.test.tsx (undefined/false → nada; render default + roles; fallback ao default sem override).
- REVIEWER (2 nits de texto + 1 estilo aplicados): (1) plural do conflito usava `roleLimit === 1` contra o valor cru — sem limits o texto viraria "1 sockets"; corrigido para `(roleLimit ?? 1) === 1`; (2) cláusula "a mais antiga será derrubada" aparecia mesmo dentro do limite (PROVIDER=2 com 2 sockets) — gate por count > roleLimit com texto alternativo honesto; (3) admin-session-limits-card.test.tsx importava vi.mock sem `vi` explícito — alinhado ao padrão dos demais testes admin.

Resultado da varredura:

- O admin enxerga o limite REAL por role (card de status no dashboard + tooltip do kick com "Limite aplicado: N") e o texto do conflito reflete a config atual em vez do default hardcoded — sem conhecer as envs do realtime (o SESSION_LIMITS_CONFIG é a fonte única de resolução).

Stage Summary:

- **Servidor**: kick audit com max + SESSION_LIMITS_CONFIG no GET /sessions.
- **API admin**: RealtimeKickInfo.max + RealtimeLimitsConfig pass-through.
- **UI**: OnlineSessionsCell (limite aplicado + conflito dinâmico por role) em ambos os admins + SessionLimitsCard no dashboard.
- **Testes**: kick-audit (max), sessions-route (limits), SessionLimitsCard (novo) — 44 testes verdes.
- **Validação**: typecheck + vitest + eslint/prettier + guards todos 0.

---

Task ID: REALTIME-ROLE-LIMIT-E2E
<a id="realtime-role-limit-e2e"></a>
Agent: buffy (realtime/e2e)
Task: Spec E2E novo validando o limite de sessoes POR ROLE do realtime de ponta a ponta — com REALTIME_MAX_SESSIONS_PER_ROLE ativo (minimo {"PROVIDER":2}), 3 abas do mesmo provider mantem 2 (a 3a derruba a mais antiga) e CLIENT segue o limite 1 (a 2a aba derruba a 1a).

Work Log:

- MOTIVAÇÃO: o limite por role do realtime (REALTIME_MAX_SESSIONS_PER_ROLE) so tinha cobertura no spec realtime-session-limit (PROVIDER=2, 3 abas) usando users do seed. Faltava: (a) um spec dedicado ao COMPORTAMENTO DIFERENCIAL por role (PROVIDER=2 co-existe com 2 abas vs CLIENT=1 derrubando na 2a aba) e (b) a prova de que CLIENT sem override por role cai no default global 1.
- ISOLAMENTO COMPLETO: provider E client REGISTRADOS via API no beforeAll (emails unicos por run — mesmo padrao do admin-session-conflict.spec.ts; CLIENT nao exige cpfCnpj/whatsapp/city no registerSchema). Nenhum user do seed usado — specs de realtime rodam fullyParallel e casam sockets por userId (users compartilhados se derrubariam entre specs).
- NOVO SPEC e2e/realtime-role-limit.spec.ts (2 testes seriais):
  - PROVIDER=2: abas A e B COEXISTEM (socket A permanece aberto — assert diferencial que distingue limite 2 de limite 1); aba C derruba a MAIS ANTIGA (A, session_limit — waitForWsClose); sockets B e C permanecem abertos.
  - CLIENT=1: abas A e B do mesmo client no painel (qualquer pagina autenticada conecta — RealtimeProvider e role-agnostico); a 2a aba derruba a 1a (default global 1); socket B permanece.
  - Helpers: trackRealtimeSockets + waitForRealtimeSocket (poll pelo ws realtime sem depender do bell) + waitForWsClose — mesmo padrao do realtime-session-limit.spec.ts.
- Header do realtime-session-limit.spec.ts atualizado com a linha do realtime-role-limit no mapa de isolamento.
- REVIEWER: aprovou; nit unico aplicado — seção REQUISITO DE CONFIG agora documenta que o minimo e {"PROVIDER":2} e que a assercao CLIENT=1 passa nas DUAS configs (CLIENT sem override cai no default global 1).

Resultado da varredura:

- Limite por role validado no browser para os DOIS perfis (PROVIDER=2 mantem 2 de 3 abas; CLIENT=1 derruba na 2a aba) com users isolados — prova o comportamento diferencial sem colisao com os demais specs de realtime.

Stage Summary:

- **E2E novo**: realtime-role-limit.spec.ts (2 testes seriais: provider 3 abas + client 2 abas).
- **Isolamento**: provider + client registrados via API (emails unicos por run).
- **Docs**: worklog Task ID REALTIME-ROLE-LIMIT-E2E (TOC sincronizado) + mapa de isolamento atualizado.
- **Validacao**: prettier/eslint/typecheck 0 + guards 0 + spec rodado 2/2 verde (42s) com dev 3000 + realtime 3003 no ar.

---

Task ID: SESSION-LIMIT-CLIENT-MAX
<a id="session-limit-client-max"></a>
Agent: buffy (realtime/hooks)
Task: Cobrir o payload `max` do `session:limit` no client — o handler `onSessionLimited` em use-realtime.ts captura o limite POR ROLE aplicado no kick e expõe `lastSessionLimit` no hook; o RealtimeProvider mostra um toast 'Sua sessão foi encerrada em outro dispositivo' com 'Limite de N sessões simultâneas por perfil'; painel admin já expõe o motivo do último kick (verificado).

Work Log:

- MOTIVAÇÃO: o servidor emite `session:limit` com o `max` (limite por role aplicado, ex.: PROVIDER=2) e o painel admin já mostra 'Limite aplicado: N' no tooltip do kick (delta SESSION-LIMITS-ADMIN), mas o CLIENT ignorava o payload — o usuário derrubado não sabia o limite do seu perfil.
- use-realtime.ts: NOVOS tipos SessionLimitPayload { userId?, reason?, max? } + SessionLimitInfo { max, at }; onSessionLimited agora recebe o payload e extrai o max (guard: number finito >= 1 → floor; invalido/ausente → 0 — degradação graciosa) → setLastSessionLimit({ max, at: ISO }); mantém o reset do singleton (socketRef = null + disconnect — sem loop de reconexao). UseRealtimeResult ganha lastSessionLimit: SessionLimitInfo | null.
- realtime-provider.tsx: NOVO useEffect em [lastSessionLimit] → toast sonner 'Sua sessao foi encerrada em outro dispositivo' com description 'Limite de N sessao(oes) simultanea(s) por perfil' (max > 0) ou texto generico (max 0). Efeito sem loop (dependencia por identidade do objeto — cada kick cria objeto novo).
- TESTE src/hooks/**tests**/use-realtime.test.tsx (NOVO): fake socket.io (vi.hoisted + vi.mock) + renderHook oficial do test-utils; 5 testes — max=2 no payload → lastSessionLimit { max: 2, at }; sem max → 0; max invalido (string/NaN/0/negativo) → 0; lastSessionLimit inicial null; singleton resetado → novo mount cria socket NOVO.
- FIXES DE RODADA: (1) teste com JSX em .ts → TS1005 (TS parseou <Harness /> como type assertion) → renomeado para .tsx (padrao do repo); (2) render() do test-utils reutiliza o MESMO root singleton — segundo render(<Harness />) era UPDATE (useEffect deps [] nao roda) → teste 5 usa o auto-unmount do renderHook do test-utils ao ser chamado de novo (mount NOVO de verdade); (3) eslint react-hooks/globals bloqueava `rt = useRealtime()` (reatribuicao de variavel de fora do componente no corpo do render) → reescrito com o renderHook oficial (result.current via ref).
- PAINEL ADMIN: OnlineSessionsCell ja expoe o motivo do ultimo kick + 'Limite aplicado: N' (delta SESSION-LIMITS-ADMIN) — verificado, sem mudanca nova.
- LIMITACOES CONHECIDAS (registradas pelo reviewer, nao-bloqueantes): (a) double-toast race — o socket derrubado pode receber session:limit (emit direto) e, em janela de poucos ms, o notification:new (broadcast na room antes do disconnect propagar); dedupe nao vale o risco (suprimiria o toast legitimo no socket NOVO); (b) lastSessionLimit nunca limpo — inofensivo (deps por identidade impedem re-fire; reset no remount); se o provider precisar descartar estado stale, um clearSessionLimit() resolve.

Resultado da varredura:

- O usuário derrubado por session_limit agora vê o toast com o limite POR PERFIL ('Limite de N sessões simultâneas por perfil') — o mesmo `max` que o painel admin mostra no tooltip do kick — com degradação graciosa quando o payload não carrega max.

Stage Summary:

- **Hook**: SessionLimitPayload/SessionLimitInfo + onSessionLimited com payload (guard de max) + lastSessionLimit exposto.
- **UI**: toast no RealtimeProvider com o limite por perfil (max > 0) ou texto generico (max 0).
- **Testes**: use-realtime.test.tsx (5) — payload max, degradacao (sem max / invalido), estado inicial, reset do singleton.
- **Validação**: typecheck + vitest (5/5) + eslint/prettier 0 + reviewer aprovou (2 rodadas); guards rodando junto.
- **Limitações**: double-toast race + lastSessionLimit nunca limpo documentados (follow-ups opcionais).

---

Task ID: SESSION-LIMIT-BY-PLAN
<a id="session-limit-by-plan"></a>
Agent: buffy (realtime/admin/schema)
Task: Estender o limite de sessões para ser configurável por TENANT/PLANO (ex.: FREE 1, PREMIUM 5) em vez de só por role — lendo o plano do usuário no banco no join e fazendo fallback ao per-role atual.

Work Log:

- MOTIVAÇÃO: o limite de sessões do realtime era só por role (REALTIME_MAX_SESSIONS_PER_ROLE) + default global. Para monetizar por plano/tenant (gratuito 1 sessão, premium 5), o limite precisa variar por plano — lendo o plano do usuário (que NÃO está no cookie de sessão `${userId}.${role}.${expiresAt}.${sig}`) e resolvendo plano > role > default com fallback ao per-role atual.
- SCHEMA: User ganha `plan String @default("FREE")` (comment com FREE/PREMIUM) + migration 20260817090000_add_user_plan (ALTER TABLE ADD COLUMN plan TEXT NOT NULL DEFAULT 'FREE') — aplicada no banco dev via prisma db execute (coluna verificada via information_schema) + prisma generate; seed marca o admin como PREMIUM (demo; demais users FREE).
- security.ts: `parseMaxSessionsPerPlan` (alias do parser genérico do per-role — mesma estrutura JSON) + `resolveMaxSessionsForUser(plan, perPlan, role, perRole, fallback)` — plano com override VENCE o per-role (case-insensitive); plano sem override cai no per-role ATUAL (nunca rebaixa quem já tem limite por role maior); perPlan ausente → per-role intacto; sempre ≥ 1.
- NOVO mini-services/realtime/user-plan.ts: `createUserPlanLoader` (SELECT plan FROM "User" WHERE id=$1 AND "deletedAt" IS NULL) — duck-typed pool (sem import pg), fail-open: pool ausente / erro / coluna inexistente pré-migration → null → cai no per-role.
- index.ts: `MAX_SESSIONS_PER_PLAN` parseado (warn se inválido); `SESSION_LIMITS_CONFIG` ganha `perPlan` ({} quando não configurado → /sessions expõe ao admin); `enforceSessionLimit` resolve via `loadUserPlan(userId)` SOMENTE quando perPlan configurado (zero DB hit no default); payload session:limit + kick audit carregam o max plan-aware; log do kick inclui plan.
- ADMIN: RealtimeLimitsConfig.perPlan (rota /api/admin/realtime/sessions) + SessionLimitsCard renderiza chips de plano (★ FREE 1 / PREMIUM 5) com tooltip "Override por plano — vence o limite por role" quando perPlan presente; sem perPlan → nenhum chip (roles intactos).
- E2E NOVO e2e/realtime-plan-limit.spec.ts: 2 providers ISOLADOS registrados via API (emails únicos por run); um sobe para PREMIUM via UPDATE pg no beforeAll (billing server-side — register não aceita plano); teste 1 PREMIUM=5 → 3 abas COEXISTEM (plano vence per-role PROVIDER=2); teste 2 FREE → 3ª aba derruba a mais antiga (fallback per-role 2). REQUISITO DE CONFIG documentado (env REALTIME_MAX_SESSIONS_PER_PLAN + coluna no banco dev). Rodado 2/2 VERDE (2.6 min).
- COMPOSE dev/prod + .env.example: REALTIME_MAX_SESSIONS_PER_PLAN documentada ao lado do per-role; mapa de isolamento do realtime-session-limit atualizado com o novo spec.
- FIX DE CAUSA RAIZ (herança do delta REALTIME-PORT-ENV anterior — NÃO deste): o 500 em TODAS as rotas API no dev pós-restart era o instrumentation do Next 16 falhando no Edge Runtime — `src/lib/env.ts` importava `parseRealtimePort` de `mini-services/realtime/security.ts`, que puxa `node:crypto` pro grafo Edge. FIX: NOVO módulo puro `mini-services/realtime/port.ts` (zero imports) com parseRealtimePort; security.ts re-exporta de ./port (fonte única — index.ts e testes seguem importando de security); env.ts importa direto de ./port. Dev validado: register=201 + log sem node:crypto/instrumentation error.
- REVIEWER (5 rodadas): nits aplicados — (1) log do shared pool agora cobre os dois consumidores (booking DENIED / plan fail-open); (2) rótulo do teste de resolução (FREE=1 é plano-vence, não fallback); (3) card test ambiguidade de texto (getAllByText/getAllByTitle); (4) tipo do registerProvider no E2E (APIRequestContext em vez de Parameters<...> → never); (5) confirmação do fix port.ts (re-export preserva contratos).

Resultado da varredura:

- Limite por plano validado de ponta a ponta: PREMIUM=5 mantém 3 abas do mesmo provider (plano vence o per-role PROVIDER=2) enquanto FREE cai no per-role 2 (3ª aba derruba a mais antiga) — com leitura do plano no join (fail-open) e zero DB hit quando o env per-plan não está configurado. Painel admin reflete o perPlan real (card de status + tooltip do kick com max plan-aware).

Stage Summary:

- **Schema**: User.plan (default FREE) + migration aplicada no banco dev + prisma generate + seed admin PREMIUM.
- **Servidor**: parseMaxSessionsPerPlan + resolveMaxSessionsForUser (plano > role > default) + user-plan.ts (fail-open) + SESSION_LIMITS_CONFIG.perPlan.
- **Admin**: RealtimeLimitsConfig.perPlan + SessionLimitsCard com chips de plano.
- **Testes**: security (7), sessions-route (perPlan + ausente), card (chips + ausente) — 126 verdes; E2E realtime-plan-limit 2/2.
- **Infra**: port.ts (fix Edge) + composes + .env.example.
- **Validação**: typecheck 0 + vitest 126/126 + eslint/prettier 0 (warning MAX_METRICS_MINUTES pré-existente) + guards 0 + E2E 2/2 verde + reviewer aprovou.

---

Task ID: REALTIME-RENEW-SMOKE
<a id="realtime-renew-smoke"></a>
Agent: buffy (e2e/realtime)
Task: Smoke E2E do session:renew (rotação de cookie): provar que, quando o app REEMITE o cookie (getSession reissue na janela <15d) e PROPAGA o novo expiresAt ao realtime via bridge /emit (event session:renew), o TTL sweep NÃO derruba o socket da sessão reemitida válida — fechando o edge case da rotação de cookie documentado no README.

Work Log:

- MOTIVAÇÃO: os sockets fixam o expiresAt no HANDSHAKE; sem o renew, o TTL sweep fecharia a sessão reemitida VÁLIDA quando o expiry ORIGINAL passasse. O renew (renewSessionSockets, EXTEND-ONLY) já existia em security.ts + propagateSessionRenewal em auth.ts, mas NÃO havia cobertura E2E do caminho real app→realtime.
- SPEC NOVO e2e/realtime-renew-sweep.spec.ts (serial, timeout 180s): DOIS providers ISOLADOS registrados via API (emails únicos por run — padrão do realtime-role-limit). O spec FORJA o cookie HMAC (mesmo formato `${userId}.${role}.${expiresAt}.${sig}` com o MESMO SESSION_SECRET) com expiresAt = agora + 15s — remaining < ROTATION_THRESHOLD (metade do TTL 30d = 15d), então o GET /api/auth/me com esse cookie dispara a REEMISSÃO REAL do app (reissueSession → novo ~30d → propagateSessionRenewal → POST /emit session:renew). É o caminho real, não simulação do bridge.
- DIFERENCIAL (coração do smoke): o provider CONTROLE conecta com o MESMO cookie forjado de 15s mas SEM passar pelo /api/auth/me. O sweep derruba o controle com session_expired (prova que o sweep está ATIVO) enquanto o renovado sobrevive — sem o controle, "o socket não caiu" seria falso positivo de sweep não rodando.
- GATES de determinismo: (1) espera do sweep derivada de REALTIME_TTL_SWEEP_MS com FOOTGUN-guard (Math.max(1000, ...) || 60s — nunca undershoot do default); (2) waitForRenewLanded via GET /health/detailed (Bearer) — prova que o session:renew CHEGOU ao realtime (recentEmits com event+userId) ANTES de esperar o sweep; (3) GET /sessions (Bearer) p/ cross-check server-side (renovado online, controle fora, kick audit: controle=session_expired, renovado SEM kick de TTL).
- POR QUE client socket.io NODE (não browser): o cookie forjado precisa chegar ao handshake como o realtime o fixaria (extraHeaders.Cookie — idêntico ao browser com cookie httpOnly). Um browser com dashboard usaria o cookie REAL de 30d → sweep nunca tocaria → cenário inerte. Mesmo padrão do realtime-ttl-sweep.spec.ts.
- REQUISITO DE CONFIG documentado no cabeçalho: SESSION_COOKIE_MAX_AGE_SECONDS default (30d) — a reemissão precisa gerar expiry MUITO além da janela do sweep (~90s); se a env for reduzida, a asserção de reemissão falha rápido com mensagem clara (não flaky).

Resultado da varredura:

- Rodado 2/2 VERDE (com dev 3000 + realtime 3003 no ar): provider renovado PERMANECE online em /sessions após a janela do sweep (sem session:revoked, kick audit sem session_expired) enquanto o controle cai com session_expired — provando o renew de ponta a ponta (cookie forjado → reemissão real do app → bridge session:renew → socket estendido → sweep não derruba).

Stage Summary:

- **Spec**: e2e/realtime-renew-sweep.spec.ts (serial, 180s, 2 providers isolados, cookie forjado 15s, reemissão real via /api/auth/me, gates /health/detailed + /sessions).
- **Validação**: prettier/eslint/typecheck + rodada E2E real (2/2 verde) + guards worklog/toc.

---

Task ID: RT-HEALTH-RENEWS
<a id="rt-health-renews"></a>
Agent: buffy (realtime/telemetria)
Task: Estender a telemetria do GET /health do realtime para expor contadores de session:renew (renews APLICADOS por minuto) e o total de sockets com expiry estendido — para ops monitorar se a propagação da rotação de cookie (app → bridge /emit → renewSessionSockets) está fluindo em produção.

Work Log:

- MOTIVAÇÃO: o session:renew (rotação de cookie) já existia (REALTIME-RENEW-SMOKE provou o caminho), mas o /health não expunha NADA sobre renovação — ops não via se a propagação estava fluindo nem quantos sockets tinham expiry estendido. O emitCounters contava o EVENTO /emit, não a APLICAÇÃO.
- security.ts: `VerifiedSession` ganha `renewed?: boolean` — setado SOMENTE quando o renewSessionSockets EFETIVAMENTE estende o socket (EXTEND-ONLY: renew antigo/igual/não-finito ou outro userId NÃO marca — a flag reflete aplicação real, não tentativa). Novo helper puro `countRenewedSockets` (conta sockets com session.renewed) — derivado ao vivo via fetchSockets no snapshot (mesma fonte da verdade da revogação/TTL, sem registro paralelo).
- index.ts: `renewCounters` (Map bucket por minuto UTC "YYYY-MM-DDTHH:mm", janela deslizante de 1h em memória — RENEW_BUCKETS_MAX=60, poda pelo mais antigo) + `bumpRenewCounter(updated)` chamado no handleSessionRenew APÓS o renewSessionSockets devolver quantos atualizou (renew que não estende nada → 0 → não incrementa). GET /health (e /health/detailed via spread do snapshot) agora expõe `renews: { perMinute: {...}, socketsWithExtendedExpiry: N }` — dados AGREGADOS, sem userIds, então o /health público (SEM auth) pode expor (mesma fronteira de privacidade do emitCounters).
- TESTES: realtime-security.test.ts — (1) renewSessionSockets marca `renewed: true` no socket estendido; (2) NÃO marca em no-op (expiry antes/igual) nem em outro usuário; (3) countRenewedSockets conta só os com flag (ignora null/sem flag, lista vazia → 0). 6 novos testes no bloco de renew + describe novo.

Resultado da varredura:

- Telemetria de renovação exposta no /health público: perMinute (renews aplicados por minuto, janela 1h) + socketsWithExtendedExpiry (quem já foi estendido e segue conectado) — ops monitora a propagação com o mesmo padrão do emitCounters. Zero DB hit, zero fetchSockets extra (reusa o do snapshot).

Stage Summary:

- **security.ts**: flag `renewed` (EXTEND-ONLY) + countRenewedSockets (puro, testado).
- **index.ts**: renewCounters por minuto (janela 1h em memória) + bump no handleSessionRenew + `renews` no /health.
- **Testes**: 6 novos (flag aplicada/no-op/outro usuário + countRenewedSockets ×3).
- **Validação**: prettier/eslint/typecheck + vitest + guards worklog/toc + reviewer.

---

Task ID: RT-RENEW-DEDUPE-MULTI
<a id="rt-renew-dedupe-multi"></a>
Agent: buffy (auth/realtime)
Task: Investigar o caso multi-réplica do dedupe de renew — validar que a chave Redis `realtime:renewed:{userId}` (TTL 1h) não perde renews quando réplicas diferentes reemitem em momentos distintos — e documentar a conclusão.

Work Log:

- ARQUITETURA DO DEDUPE (app-side): o dedupe vive em `src/lib/auth.ts` `propagateSessionRenewal` — NÃO no realtime. Duas camadas: (1) Map em memória `sessionRenewedAt` (por processo, janela 1h, poda >1000) e (2) chave Redis `realtime:renewed:{userId}` TTL 1h (compartilhada entre réplicas do app via o MESMO Redis do cache). O realtime em si NÃO tem adaptador Redis do socket.io (sem @socket.io/redis-adapter) — cada réplica do realtime vê só os próprios sockets locais via io.fetchSockets() (limitação documentada, não deste delta).
- HAPPY PATH MULTI-RÉPLICA — VÁLIDO: o renew é idempotente e EXTEND-ONLY no realtime (renewSessionSockets). A primeira réplica a emitir reivindica a chave compartilhada; as demais consultam a chave antes e pulam. Nenhum renew se perde — o socket foi estendido pelo primeiro emit, os demais são no-op. Dedupe correto, sem perda, quando réplicas reemitem em momentos distintos.
- BUG DE ORDERING (encontrado e CORRIGIDO): o código ANTIGO fazia `cacheSet(dedupeKey, ...)` ANTES de `emitRealtime(...)` — e o emitRealtime engolia falhas (catch + log, retorno void). Um emit que FALHA (realtime fora/timeout/HTTP não-2xx) ainda deixava a chave setada por 1h, suprimindo retries de TODAS as réplicas do app: a sessão reemitida VÁLIDA morreria no sweep do expiry ORIGINAL (o renew não chega ao realtime → socket mantém o expiresAt do handshake → selectExpiredSessionSockets fecha). Perda de renew por até 1h após uma falha.
- FIX APLICADO (3 arquivos):
  1. `src/lib/realtime-client.ts` — `emitRealtime` agora retorna `Promise<boolean>` = `res.ok` (HTTP 2xx = entrega CONFIRMADA; erro de rede/timeout/não-2xx = false). Retrocompatível: todos os consumers só faziam `await` ignorando o retorno (rotas, notification-queue, notifications, revokeUserSessions).
  2. `src/lib/auth.ts` `propagateSessionRenewal` — reordena: checa a chave Redis (sem reivindicar) → guard Map in-process → emit → SÓ se `delivered === true` reivindica a chave Redis; em falha, rollback do Map (`delete`) para o próximo request/outra réplica retentar. Mesmo padrão aplicado a `revokeExpiredSessionSockets` (chave `realtime:revoked:expired:{userId}` + rollback do `expiredRevokeEmittedAt`) e `revokeUserSessions` agora devolve `Promise<boolean>`.
  3. Typo no comentário do auth.ts corrigido (`realtime:renewed:expired:{userId}` → `realtime:renewed:{userId}` — o sufixo "expired" pertence à chave de revoke).
- TESTES: realtime-client.test.ts — 200 → resolves true; erro de rede → resolves false (antes toBeUndefined); NOVO caso HTTP 500 → false (entrega não confirmada); hang → false. auth.test.ts — mock do emitRealtime agora resolve true por default (entrega confirmada); NOVOS 4 testes multi-réplica: (1) entrega OK reivindica a chave Redis; (2) entrega FALHA NÃO reivindica (outra réplica retentaria); (3) réplica com Map vazio vê a chave reivindicada por outra e NÃO reemite; (4) revoke-expired idem com `realtime:revoked:expired:{userId}`.

Resultado da varredura:

- Conclusão VALIDADA: a chave Redis `realtime:renewed:{userId}` TTL 1h NÃO perde renews no happy path multi-réplica (renew idempotente, primeiro que entrega vence, demais pulam). O risco real era a reivindicação PRÉ-emit + emitRealtime que engolia falhas — corrigido para reivindicação PÓS-entrega confirmada com rollback do Map in-process, cobrindo renew e revoke-expired. Limitação documentada: o realtime sem adapter Redis vê só os próprios sockets por réplica (multi-replica do realtime exigiria @socket.io/redis-adapter — fora de escopo).

Stage Summary:

- **realtime-client.ts**: emitRealtime → Promise<boolean> (res.ok) — entrega confirmada vs falha.
- **auth.ts**: chave Redis reivindicada SÓ após emit OK (renew + revoke-expired) + rollback do Map in-process em falha + typo do comentário + revokeUserSessions → Promise<boolean>.
- **Testes**: realtime-client (200→true, erro→false, NOVO 500→false, hang→false) + 4 novos testes multi-réplica no auth.test.ts.
- **Validação**: prettier/eslint/typecheck + vitest + guards worklog/toc + reviewer.

---

Task ID: SSR-SESSION-EXPIRY
<a id="ssr-session-expiry"></a>
Agent: orchestrator (frontend — countdown SSR)
Task: Expor o expiresAt da sessão também via SSR (server components): ler o cookie no server component e passar o countdown inicial ao client para evitar o flash de carregamento no dashboard antes do fetchMe resolver.

Work Log:

- Contexto: /api/auth/me já devolve expiresAt e o auth store guarda em sessionExpiresAt, mas o dashboard/page.tsx era SSR vazio que renderizava um client component sem dados — o countdown (SessionExpiryBanner/SessionExpiryInfo) só aparecia após o fetchMe resolver (round-trip de rede), com flash de loading no primeiro paint.
- auth.ts: extraiu verifySessionCookieValue (parser puro + HMAC, sem side effects — safe para RSC onde cookies().set() é proibido) e criou getSessionExpiresAt() — leitura SSR-safe que NUNCA reemite cookie, mas ESPELHA a rotação <15d aritmeticamente (now + COOKIE_MAX_AGE) para o valor inicial já ser o que o client verá pós-fetchMe (evita o salto "10 dias" → "30 dias"). getSession refatorado para reusar o parser (comportamento idêntico).
- dashboard/page.tsx: virou async — chama getSessionExpiresAt() e passa initialSessionExpiresAt ao DashboardPageClient.
- store/auth.ts: nova action seedSessionExpiry(expiresAt) — preenche sessionExpiresAt SOMENTE se ainda null (o mais fresco vence; SSR lento não regride valor já resolvido pelo fetchMe). Não toca user/status.
- dashboard-page-client.tsx: aceita a prop e semeia o store no mount (useEffect) antes/em paralelo ao fetchMe.
- Testes: auth.test.ts (verifySessionCookieValue 4 casos + getSessionExpiresAt 5 casos: fora da janela, espelho da rotação, sem cookie, adulterado, expirado); store auth.test.ts (seedSessionExpiry 3 casos: preenche null, não sobrescreve resolvido, não altera user/status); novo dashboard-page-client.test.tsx (seeding com prop, null não semeia, renderiza painel do role, spinner quando não inicializado).

Resultado da varredura:

- O countdown da sessão agora renderiza no PRIMEIRO paint do dashboard (valor vindo do SSR) sem depender do round-trip do fetchMe.
- getSessionExpiresAt é a única leitura nova; a reemissão real do cookie continua no primeiro /api/auth/me (nenhuma renovação perdida).

Stage Summary:

- src/lib/auth.ts: verifySessionCookieValue (export) + getSessionExpiresAt (export) + getSession refatorado.
- src/app/dashboard/page.tsx: async, passa initialSessionExpiresAt.
- src/store/auth.ts: seedSessionExpiry.
- src/app/dashboard/dashboard-page-client.tsx: prop + seeding no mount.
- Testes: auth.test.ts, store/**tests**/auth.test.ts, app/dashboard/**tests**/dashboard-page-client.test.tsx (novo).
- Validação: prettier, eslint, typecheck, vitest + guards + code-reviewer.

---

Task ID: SESSION-EXPIRY-E2E
<a id="session-expiry-e2e"></a>
Agent: orchestrator (E2E do fluxo de expiração de sessão)
Task: Adicionar um spec E2E Playwright que valida o fluxo completo de expiração/renovação da sessão no browser: login real, /api/auth/me retornando expiresAt, pill do countdown no dropdown do usuário e o botão Renovar reemitindo o cookie (<15d simulado).

Work Log:

- e2e/session-expiry-flow.spec.ts (novo): describe.serial com 2 testes cobrindo os 3 contratos do delta SSR-SESSION-EXPIRY + o botão Renovar.
- Teste 1 (login real → /api/auth/me → pill): provider ISOLADO registrado via API no beforeAll (email único por run — padrão realtime-role-limit); login via page.request.post("/api/auth/login") (cookie salvo no context); GET /api/auth/me asserta user.id == providerId E expiresAt ~ now + 30d (sessão fresca; margem 1h cobre atraso); abre /dashboard → dropdown (button[aria-label="Menu da conta"]) → pill [data-testid="session-expiry-info"] visível com regex /Sessão expira em (2[5-9]|30) dias/ (ceil do daysLeft — margem evita flake de timing).
- Teste 2 (Renovar reemite o cookie no <15d simulado): mesmo provider; login real; FORJA cookie de sessão com TTL de 2 dias usando o MESMO HMAC do app (signSessionCookie `${userId}.${role}.${expiresAt}.${sig}` com SESSION_SECRET lido via readEnv — padrão do realtime-renew-sweep); seta no context via ctx.addCookies (substitui o cookie real); dispara GET /api/auth/me — o MESMO request que o botão Renovar executa via renewSession; o getSession vê remaining 2d < ROTATION_THRESHOLD (metade do TTL) → REEMITE: asserta expiresAt renovado (~now + 30d — saltou de 2 dias) + Set-Cookie header contendo o novo severinno_session (reemissão FÍSICA); re-abre o dashboard e a pill reflete o countdown renovado.
- POR QUE forjar o cookie: a rotação real só dispara com remaining < metade do TTL (30d default → janela <15d); um cookie real de 30d nunca entraria na janela durante o spec. O forjado percorre o CAMINHO REAL do app (getSession → reissueSession → Set-Cookie), idem realtime-renew-sweep.
- Isolamento: describe.serial porque os 2 testes usam o MESMO provider e cada um fecha o próprio context no finally (nenhum socket realtime vaza entre testes).
- REQUISITO DE CONFIG documentado no header: SESSION_SECRET precisa estar no env/.env.local do app E acessível ao spec via readEnv (HMAC do cookie forjado precisa casar com o servidor).

Resultado da varredura:

- O fluxo completo do countdown de sessão agora tem cobertura E2E no browser: login → expiresAt no /api/auth/me → pill no dropdown (paint inicial SSR) → renovação <15d reemitindo o cookie de verdade.
- O spec prova que o botão Renovar (renewSession → /api/auth/me) reemite o cookie quando o remaining está na janela de rotação — sem depender de mock do bridge ou de esperar 30d.
- Sem mudanças em src/: o spec consome contratos já expostos (data-testid da pill, aria-label do dropdown, /api/auth/me com expiresAt, HMAC do cookie).

Stage Summary:

- e2e/session-expiry-flow.spec.ts (novo) — 2 testes serial.
- Worklog: Task ID SESSION-EXPIRY-E2E + TOC.
- Validação: prettier, eslint, typecheck, guards + execução do spec no chromium com dev 3000 + realtime 3003 no ar.

---

Task ID: PILL-RENEW-8-15D
<a id="pill-renew-8-15d"></a>
Agent: orchestrator (fechar a janela 8–15 dias da renovação de sessão)
Task: Adicionar o botão "Renovar" na pill SessionExpiryInfo do dropdown do usuário quando days ≤ 15 (SESSION_EXPIRY_RENEW_DAYS) — o servidor JÁ reemite o cookie em qualquer request <15d, mas a ação explícita dá controle ao usuário antes da rotação proativa acontecer. Acima de 15d a pill não oferece o botão (o servidor ainda não reemite — renovar seria no-op).

Work Log:

- src/components/shared/session-expiry-banner.tsx: nova constante exportada SESSION_EXPIRY_RENEW_DAYS = 15 (janela de renovação EXPLÍCITA na pill, 8–15d) + SessionExpiryInfo ganhou o botão "Renovar" (variant ghost, tamanho compacto, ícone RefreshCw/Loader2 com estado renewing + disabled) renderizado quando days ≤ SESSION_EXPIRY_RENEW_DAYS.
- Reusa a MESMA ação NÃO-destrutiva do banner (renewSession do auth store — nunca fetchMe, que em erro de rede marca unauthenticated e derruba o usuário para o login); o doc header foi atualizado explicando a janela 8–15d (o banner cobre só ≤7d; a pill fecha o gap onde a rotação <15d já está ativa).
- Flex-wrap na pill (inline-flex flex-wrap gap-x/gap-y) para o botão quebrar linha sem estourar o layout do dropdown em telas estreitas.
- dashboard-shell.test.tsx: ajustado o teste existente "o botão Renovar chama renewSession" (agora a 2d TANTO o banner ≤7d QUANTO a pill ≤15d exibem o botão — getAllByRole para não estourar strict mode do getByRole) + 4 testes novos da janela: (1) 12d mostra o botão na pill (gap 8–15d fechado); (2) boundary 15d mostra / 16d esconde; (3) >15d (20d) esconde (fora da janela de rotação); (4) click na pill chama renewSession e NUNCA fetchMe.
- e2e/session-expiry-flow.spec.ts: assert negativo nos 2 testes (sessão FRESCA >15d → pill SEM botão Renovar) — o caso POSITIVO da janela 8–15d fica nos unit tests porque no browser o SSR espelha a rotação (getSessionExpiresAt) e o fetchMe reemite: qualquer sessão <15d aparece como ~TTL fresco na UI (o botão a 8–15d só é observável com mock direto do sessionExpiresAt).

Resultado da varredura:

- A janela 8–15 dias agora tem ação explícita: o usuário vê o botão "Renovar" na pill do dropdown quando faltam ≤ 15 dias (e o banner ≤7d continua oferecendo o mesmo botão) — cobertura contínua do countdown em toda a vida da sessão.
- Sem mudanças em src/lib ou no store: a pill reusa o renewSession já existente; o delta é UI + testes + docs.

Stage Summary:

- src/components/shared/session-expiry-banner.tsx: SESSION_EXPIRY_RENEW_DAYS + botão na pill (renewing state).
- src/components/shared/**tests**/dashboard-shell.test.tsx: getAllByRole no teste do banner + 4 testes da janela 8–15d.
- e2e/session-expiry-flow.spec.ts: assert negativo (sem botão a >15d) nos 2 testes.
- Worklog: Task ID PILL-RENEW-8-15D + TOC.
- Validação: prettier, eslint, typecheck, vitest (dashboard-shell + sessão) + guards + execução do spec E2E no chromium com dev 3000 + realtime 3003 no ar + code-reviewer.

---

Task ID: TTL-SWEEP-RENEW-E2E
<a id="ttl-sweep-renew-e2e"></a>
Agent: orchestrator (cenário 2 do TTL sweep — renew × sweep)
Task: Adicionar um segundo cenário no realtime-ttl-sweep.spec.ts que valida a interação renew × sweep: com o realtime em sweep curto, forjar cookie com TTL curto, emitir session:renew (extend) ANTES do expiry e garantir que o socket NÃO é fechado — provando o gap da rotação deslizante que hoje só tem unit test.

Work Log:

- e2e/realtime-ttl-sweep.spec.ts (cenário 2): par renovado/controle com DOIS providers ISOLADOS registrados via API no beforeAll (emails únicos por run — padrão realtime-role-limit/realtime-renew-sweep; specs de realtime rodam fullyParallel e casam sockets por userId).
- Helpers novos: registerProvider (API), connectSocket (client socket.io NODE com cookie forjado no handshake), emitSessionRenew (POST /emit Bearer com { event: session:renew, data: { userId, expiresAt } } — o MESMO bridge que o app usa via realtime-client.ts), fetchHealthDetailed + waitForRenewLanded (gate via recentEmits do /health/detailed).
- Fluxo do teste: forja cookies com o MESMO TTL curto (15s) para os dois providers → conecta ambos → join (sanidade sessão verificada) → EMIT session:renew para o RENOVADO com novo expiresAt BEM além da janela do sweep (+15min) ANTES do expiry original → GATE waitForRenewLanded (prova que o renew chegou ao realtime) → espera a janela do sweep (TTL + 1 intervalo + close delay + margem; loop termina cedo no disconnect do controle) → asserts do DIFERENCIAL: CONTROLE caiu com session_expired (prova o sweep ATIVO — sem isso o resultado do renovado poderia ser falso positivo de sweep não rodando) e RENOVADO sobreviveu (EXTEND-ONLY do renewSessionSockets aplicado, sem session:revoked, sem disconnect) → cross-check /sessions: renovado online, controle fora, kick audit control=session_expired / renew≠session_expired.
- Header doc atualizado com os DOIS cenários + REQUISITO DE CONFIG do cenário 2 (REALTIME_EMIT_TOKEN no realtime + SESSION_SECRET compartilhado).

Resultado da varredura:

- O gap da rotação deslizante (renovar antes do sweep) agora tem cobertura E2E ponta-a-ponta no realtime — o EXTEND-ONLY do renewSessionSockets era coberto só por unit test.
- O par renovado/controle elimina o falso positivo: o controle caindo prova que o sweep está ativo e que a sobrevivência do renovado é o renew agindo, não timing.
- Sem mudanças em src/ ou mini-services: o spec exercita contratos já expostos (POST /emit Bearer, /health/detailed, /sessions).

Stage Summary:

- e2e/realtime-ttl-sweep.spec.ts (cenário 2 + helpers).
- Worklog: Task ID TTL-SWEEP-RENEW-E2E + TOC.
- Validação: prettier, eslint, typecheck, guards + execução do spec no chromium com dev 3000 + realtime 3003 no ar + code-reviewer.

---

Task ID: MAKE-E2E-TTL
<a id="make-e2e-ttl"></a>
Agent: orchestrator
Task: Criar um target no Makefile (ex.: e2e-ttl) que sobe o realtime dev com REALTIME_TTL_SWEEP_MS=2000 e roda a suíte realtime-ttl-sweep em ~40s (piso: FORGED_TTL_SECONDS=15 hardcoded no spec) em vez de ~1.5min com o sweep de 60s, documentando o comando exato de boot com o env.

Work Log:

- scripts/test-e2e-ttl-sweep.sh (novo): pipeline E2E TTL sweep. Sobe o realtime dev numa PORTA DEDICADA (REALTIME_PORT, default 3199 — NÃO toca o realtime dev da 3003) com REALTIME_TTL_SWEEP_MS=2000 (default 60s), espera o /health, roda e2e/realtime-ttl-sweep.spec.ts (chromium) com REALTIME_PORT exportado (o spec conecta via realtimePort(), sem hardcode) e derruba o realtime no exit (trap; --skip-cleanup mantém de pé).
- Comando de boot documentado no header do script: cd mini-services/realtime && REALTIME_PORT=3199 REALTIME_TTL_SWEEP_MS=2000 SESSION_SECRET=... REALTIME_EMIT_TOKEN=... bun --hot index.ts. O script exporta SESSION_SECRET + REALTIME_EMIT_TOKEN do .env.local (fail-closed do realtime: sem eles os joins são rejeitados e o POST /emit do cenário 2 recusado) e verifica o app na :3000 antes (o spec registra providers via API no beforeAll).
- Por que acelera: com o sweep de 60s, o socket expirado (cookie forjado TTL 15s) só cai no próximo tick — até ~75s por cenário (~1.5min na suíte). Com 2000ms, cai em ~17s por cenário (TTL 15s + 1 tick de 2s + close delay 0.5s) — suíte inteira ~40s. O deadline do spec é só um limite superior (clamp no fallback de 60s); o loop termina cedo no disconnect, então o tempo real acompanha o sweep do servidor.
- Makefile: target e2e-ttl + .PHONY + linha no help, com o boot exato comentado acima do alvo.
- docs/TESTING.md: seção "E2E TTL sweep do realtime (make e2e-ttl)" com o comando de boot manual equivalente.

Resultado da varredura:

- O alvo encapsula o requisito de config do spec (REALTIME_TTL_SWEEP_MS baixo em dev/CI) num único comando, sem exigir conhecimento do boot do realtime nem tocar o processo da 3003 (porta dedicada).

Stage Summary:

- scripts/test-e2e-ttl-sweep.sh (novo).
- Makefile: target e2e-ttl + .PHONY + help.
- docs/TESTING.md: seção do TTL sweep.
- Worklog: Task ID MAKE-E2E-TTL + TOC.
- Validação: bash -n, guards (crlf/utf8/worklog/toc), execução real do target com dev 3000 + realtime dedicado na 3199 + code-reviewer.

---

Task ID: TTL-SWEEP-TELEMETRY
<a id="ttl-sweep-telemetry"></a>
Agent: orchestrator
Task: Adicionar métrica no /health do realtime: contagem de sockets encerrados por session_expired na última janela (ex.: 1h) e um flag de spike (ex.: >N por minuto) — sinal de ataque de sessões stale ou bug de rotatividade — expondo a telemetria do TTL sweep para ops.

Work Log:

- mini-services/realtime/security.ts (helpers PUROS, unit-testáveis): minuteWindowKey (chave UTC "YYYY-MM-DDTHH:mm" do bucket) + bumpMinuteWindow (incrementa o bucket do minuto e poda a janela de 1h = 60 buckets pelo MÍNIMO da inserção — Map preserva ordem de inserção; count <= 0 é ignorado) — MESMA janela já usada pelo renew (fonte única da semântica, sem duplicação); parseExpiredSpikeThreshold (env REALTIME_EXPIRED_SPIKE_THRESHOLD, default 50/min; 0/NaN → default; negativo → clamp 1); computeExpiredSweepMetrics (lastHourTotal + maxPerMinute + spike = maxPerMinute > threshold — agregado, sem userIds).
- mini-services/realtime/index.ts: expiredCounters (Map por minuto, janela deslizante de 1h em memória) + EXPIRED_SPIKE_THRESHOLD lido no boot (warn se env inválida); bumpMinuteWindow(expiredCounters, expired.length) no TTL sweep periódico E no POST /revoke-orphans (expired.length — a varredura manual também entra na janela, spike reflete o volume real de expirações); snapshot getHealthSnapshot expõe ttlSweep { perMinute, lastHourTotal, maxPerMinute, spike, spikeThreshold } — dados AGREGADOS (sem userIds) porque o /health é SEM auth por design.
- Docs: .env.example (linha REALTIME_EXPIRED_SPIKE_THRESHOLD=) + docker-compose.dev.yml (pass-through ${REALTIME_EXPIRED_SPIKE_THRESHOLD:-}).
- src/lib/**tests**/realtime-security.test.ts: describes de minuteWindowKey/bumpMinuteWindow (janela + poda + count<=0), parseExpiredSpikeThreshold (default/0/NaN/negativo/valor válido) e computeExpiredSweepMetrics (soma, pico, spike ligado/desligado).
- e2e/realtime-ttl-sweep.spec.ts (cenário 1): helper fetchHealthPublic (GET /health sem auth) + waitForExpiredTelemetry (poll até lastHourTotal >= 1 — o bump roda no MESMO ciclo do sweep que fecha o socket; o poll cobre o timing de rede do disconnect) + asserts do shape (perMinute, maxPerMinute >= 1, spike boolean, spikeThreshold número >= 1 — 1 expiração nunca acende o spike por acidente com o default 50).

Resultado da varredura:

- Ops agora vê no /health (sem auth) a janela de expirações por TTL do realtime: lastHourTotal (volume), maxPerMinute (pico), perMinute (distribuição) e o flag spike — sinal de ataque de sessões stale (lote de cookies vencendo juntos) ou bug de rotatividade (session:renew não propagando → expirações em massa).
- A janela por minuto é COMPARTILHADA com o renew (bumpMinuteWindow/minuteWindowKey em security.ts) — uma única semântica de janela no serviço, sem duplicação.
- Nenhum teste/spec asserta o shape exato do /health (varredura prévia): adicionar campos não quebra igualdade.

Stage Summary:

- mini-services/realtime/security.ts + index.ts: telemetria ttlSweep + spike.
- .env.example + docker-compose.dev.yml: REALTIME_EXPIRED_SPIKE_THRESHOLD.
- src/lib/**tests**/realtime-security.test.ts: 3 describes novos.
- e2e/realtime-ttl-sweep.spec.ts: assert de telemetria no cenário 1.
- Worklog: Task ID TTL-SWEEP-TELEMETRY + TOC.
- Validação: prettier + eslint + typecheck + vitest (realtime-security) + guards (worklog/toc) + E2E (make e2e-ttl) + code-reviewer.

---

Task ID: COOKIE-TTL-PER-ROLE
<a id="cookie-ttl-per-role"></a>
Agent: orchestrator
Task: Estender o SESSION_COOKIE_MAX_AGE_SECONDS para suportar TTLs distintos por role (ex.: clientes 15d, providers 30d, admins 7d) — o app assina o expiresAt no cookie e o sweep do realtime já respeita o valor embutido por socket, então a mudança fica só no app.

Work Log:

- src/lib/auth.ts: helpers puros parseCookieMaxAgePerRole (env estruturada SESSION_COOKIE_MAX_AGE_PER_ROLE — JSON de segundos; roles UPPERCASE; entradas inválidas descartadas; clamp >= 60; JSON inválido/vazio/{} → undefined) + resolveCookieMaxAgeForRole (override por role case-insensitive → fallback global; sempre >= 60s — misconfig nunca quebra a sessão). Constantes de boot: COOKIE_MAX_AGE_PER_ROLE (warn se env setada mas inválida) + cookieMaxAgeForRole + rotationThresholdSeconds(role) = metade do TTL EFETIVO da role (substitui o ROTATION_THRESHOLD_SECONDS global).
- createSession: assina o expiresAt com o TTL da role (maxAge = cookieMaxAgeForRole(role)) — o valor embutido no cookie é o que o realtime respeita no sweep, então nenhuma mudança no mini-service.
- getSession: rotação deslizante POR ROLE (remaining < rotationThresholdSeconds(role)) — CLIENT com TTL 15d roda a 7.5d, PROVIDER com 30d a 15d; o renewSession propagado via bridge /emit leva o novo expiresAt (TTL da role) ao realtime.
- getSessionExpiresAt (SSR/RSC-safe): espelho da rotação com o TTL da role (now + cookieMaxAgeForRole(role)) — o countdown SSR não salta; sem reemitir cookie.
- Docs: README (bullet do TTL atualizado com a env por role), .env.example (bloco SESSION_COOKIE_MAX_AGE_SECONDS + SESSION_COOKIE_MAX_AGE_PER_ROLE com exemplo JSON), docker-compose.yml (app) + docker-compose.prod.yml (app) com pass-through ${SESSION_COOKIE_MAX_AGE_PER_ROLE:-}.
- src/lib/**tests**/auth.test.ts: describes puros de parseCookieMaxAgePerRole (JSON válido, UPPERCASE, entradas inválidas, clamp 60s, undefined) + resolveCookieMaxAgeForRole (override, case-insensitive, fallback, override <60 ignorado, clamp do fallback); describe de INTEGRAÇÃO no padrão do env.test.ts (vi.resetModules + process.env setado + import dinâmico — instância fresca do módulo por teste): createSession CLIENT 15d / PROVIDER 30d / ADMIN 7d; rotação por role (CLIENT 10d restantes NÃO roda — threshold 7.5d; PROVIDER 10d restantes RODA — threshold 15d, refresh ~30d); getSessionExpiresAt espelha +30d para PROVIDER. A instância dinâmica usa os mocks hoisted (cookieStore/mockCacheStore compartilhados); o import estático do topo continua na instância ORIGINAL (env sem per-role → 30d) — describes existentes não afetados.

Resultado da varredura:

- O TTL do cookie agora é configurável POR ROLE com fallback ao global — o expiresAt assinado no cookie carrega o TTL da role e o sweep/renew do realtime seguem o valor embutido (EXTEND-ONLY), sem mudança no mini-service.
- A rotação deslizante é consistente com o TTL: a janela de renovação é metade do TTL EFETIVO da role (não uma constante global), e o espelho SSR usa o mesmo TTL — o countdown e o renew sempre casam com o que o getSession reemite.
- Default preservado: sem a env por role, tudo cai no comportamento anterior (global 30d, threshold 15d) — zero quebra para quem não configurar.

Stage Summary:

- src/lib/auth.ts: parseCookieMaxAgePerRole + resolveCookieMaxAgeForRole + createSession/getSession/getSessionExpiresAt role-aware.
- Docs: README.md, .env.example, docker-compose.yml, docker-compose.prod.yml.
- src/lib/**tests**/auth.test.ts: 2 describes puros + 1 describe de integração (4 testes).
- Worklog: Task ID COOKIE-TTL-PER-ROLE + TOC.
- Validação: prettier + eslint + typecheck + vitest (auth.test.ts) + guards (worklog/toc) + code-reviewer.

---

Task ID: ADMIN-REALTIME-TELEMETRY
<a id="admin-realtime-telemetry"></a>
Agent: orchestrator
Task: Fechar o loop do dashboard: adicionar uma view no painel admin (ex.: admin.realtimeTelemetry) que renderiza o gráfico de emits por evento e o sinal de sockets órfãos lendo GET /api/admin/realtime/telemetry, com badge de alerta quando a flag estiver ativa.

Work Log:

- src/components/admin/admin-realtime-telemetry.tsx (nova view): poll de GET /api/admin/realtime/telemetry?minutes=N a cada 15s (persist do realtime = 30s por default; 15s de leitura mantém flag/último bucket frescos sem martelar o proxy) via useQuery (refetchInterval 15000, staleTime 7500).
- Seletor de janela segmented (30 min / 1 h / 6 h / 24 h → ?minutes da rota; buttons com aria-pressed, sem aria-controls órfão — mesmo padrão do filtro de role do AdminActiveSessions).
- Cards de resumo (grid 4): emits totais na janela (soma do map), órfãos AGORA (ATIVO/OK com destaque âmbar quando flag=true), usuários multi-socket (último bucket + pico no período), máx. sockets/usuário (último bucket + pico).
- Bar chart de emits POR EVENTO (Recharts, layout="vertical" — nomes de evento longos; barras horizontais, fill primary, tooltip TOOLTIP_STYLE do admin-chart-theme) + top-5 de eventos como fallback acessível (H7 — leitura além do chart, também assertável no teste com o mock pass-through do recharts).
- Area chart do sinal de órfãos: multi[] → { ts, label (formatRelative), orphans, total } com gradiente âmbar; badge flag ativo/ok no header do card.
- Banner de ALERTA (role="alert", âmbar) quando flag=true — o sintoma do socket órfão do HMR/multi-abas (mesmo contrato do SessionConflictAlert); ausente quando flag=false.
- Degradação graciosa: isError → ErrorState com retry; ok:false/available:false → EmptyState "Telemetria indisponível"; sem emits E sem multi → EmptyState "Sem telemetria na janela" (nunca quebra o painel).
- admin-panel.tsx: import + NAV_ITEMS (view "admin.realtime-telemetry", label "Telemetria Realtime", ícone RadioTower — após Sessões Ativas) + VIEW_META (título/subtítulo/breadcrumbs) + case no switch.
- src/components/admin/**tests**/admin-realtime-telemetry.test.tsx (novo, no padrão do admin-active-sessions.test.tsx): mocks de useQuery/apiGet/format/lucide/recharts (createRechartsMock do mocks.tsx) + 9 testes: skeleton no loading; ErrorState com retry; EmptyState de degradação (ok:false); EmptyState sem telemetria; cards de resumo com valores somados (54 emits); banner+badge de alerta com flag=true; sem banner com flag=false (flag ok / OK); top-5 de eventos; seletor de janela refaz a query com ?minutes=360; refresh chama refetch; axe sem violações.

Resultado da varredura:

- O loop do dashboard fecha: o admin vê no MESMO painel a telemetria que o realtime persiste (emits por evento + sinal de órfãos com alerta), sem depender de logs — o badge flag ativo destaca o sintoma do HMR antes de virar incidente.
- O shape da rota (emits agregados + multi[] por minuto + flag) já era o contrato persistido no Redis — a view é 100% consumidora, zero mudança no backend/realtime.
- Recharts já era dependência do repo (16+ views admin) — o padrão visual (TOOLTIP_STYLE, fill primary, grid tracejado) segue admin-chart-theme, e o mock pass-through do recharts no JSDOM já existia em mocks.tsx.

Stage Summary:

- src/components/admin/admin-realtime-telemetry.tsx (nova view).
- src/components/admin/admin-panel.tsx: registro da view + NAV_ITEMS + VIEW_META.
- src/components/admin/**tests**/admin-realtime-telemetry.test.tsx (novo, 9 testes).
- Worklog: Task ID ADMIN-REALTIME-TELEMETRY + TOC.
- Validação: prettier + eslint + typecheck + vitest (novo teste + admin-panel) + guards (worklog/toc) + code-reviewer.

---

Task ID: ORPHAN-ALERT-JOB
<a id="orphan-alert-job"></a>
Agent: orchestrator (alerta operacional de sockets órfãos persistidos)
Task: Job de alerta (cron) que lê a flag realtime:telemetry:multi:flag e notifica quando sockets órfãos PERSISTIREM por N minutos seguidos em produção — GlitchTip/Sentry + email, com cooldown e dry-run no padrão do revoke-inactive-sessions.

Work Log:

- Mapeou o contrato: o realtime grava a flag `realtime:telemetry:multi:flag` (STRING "1", TTL curto ≈ 2× persist interval) sempre que usersWithMultipleSockets > 0, e buckets por minuto `realtime:telemetry:multi:{minuteBucket}` (JSON total/byRole/usersWithMultipleSockets/maxSocketsPerUser, TTL 24h). A flag sozinha não prova persistência (TTL curto = "agora"); os buckets provam o histórico.
- Criou src/lib/realtime-orphan-alert.ts (engine, espelha revoke-inactive-scan.ts):
  - Puros: MULTI_FLAG_KEY, buildMultiBucketKey (mesmo cálculo do mini-service), parseOrphanAlertMinutes (env, default 5, clamp 1..1440), parseOrphanAlertCooldownMs (env, default 60min, clamp >= 60s), readOrphanPersistence (lê os N buckets do minuto atual para trás; persisted = TODOS os N confirmam órfãos; bucket ausente/JSON corrompido/usersWithMultipleSockets=0 = NÃO confirmado — fail-closed na evidência).
  - Notificação: buildOrphanAlertHtml (email branded inline) + defaultNotify (captureMessage → GlitchTip/Sentry sempre + sendMail para ADMIN_EMAIL se setado). Injetável para testes.
  - runRealtimeOrphanAlert: cooldown Redis primeiro (isCooldownElapsed/markCompleted do cron-cooldown) → leitura fail-open (client null → completed sem alerta, nunca 500) → flag ativa AGORA E persistência comprovada → alerta real (notify + markCompleted) ou dry-run (reporta sem notificar, NÃO marca cooldown).
- Decisão de design: cooldown marcado SÓ em alertas reais (não em runs limpos nem dry-run) — um monitor precisa re-checar a cada intervalo para pegar um NOVO episódio dentro da janela; a supressão anti-storm é por alerta, não por run (divergência consciente do revoke-inactive, que marca em todo run completado por ser job diário).
- Criou src/app/api/cron/realtime-orphan-alert/route.ts (GET, Bearer CRON_SECRET com warn-skip se vazio, ?dryRun=1, runtime nodejs, re-export dos puros para testes) — mesmo padrão do cron-revoke-inactive-sessions.
- Criou src/app/api/**tests**/cron-realtime-orphan-alert-route.test.ts (18 testes): readOrphanPersistence puro (N confirmam / ausente / corrompido / 0 quebra a cadeia — com nowMs explícito), env guards (incl. empty-string → fallback, bug real do Number("")=0), flag ausente → completed sem notify, flag + 5 buckets → alerted com captureMessage+sendMail+markCompleted, persistência insuficiente (2/5) → not-persisted, dryRun reporta sem notificar nem marcar, cooldown → skipped sem ler Redis, client null → fail-open com reason redis-unavailable + available:false, leitura falha (get rejeita) → idem, 401 Bearer falta/errado, acesso sem CRON_SECRET, clock injetável now (engine direto com notify espião). Fake timers (vi.useFakeTimers({now})) nos testes de rota: o GET() chama a engine sem now → Date.now() interno precisa bater com as chaves fixas do mapa (flake de virada de minuto eliminado).
- Docs: .env.example (ORPHAN_ALERT_MINUTES/COOLDOWN_MS/ADMIN_EMAIL com comentários), worklog TOC + Task ID.

Resultado da varredura:

- O alerta fecha o loop operacional do socket órfão: o realtime PERSISTE a flag, o admin VE o sinal (view telemetria), e agora a equipe é NOTIFICADA proativamente quando a condição dura N minutos — sem depender de alguém olhando o dashboard.
- Fail-open em 3 pontos (Redis fora, leitura falha, notificação falha) garante que o job nunca quebra o cron nem 500a; fail-closed na evidência evita falso-positivo com dados incompletos.

Stage Summary:

- src/lib/realtime-orphan-alert.ts (engine + notificação + email HTML).
- src/app/api/cron/realtime-orphan-alert/route.ts (rota cron).
- src/app/api/**tests**/cron-realtime-orphan-alert-route.test.ts (novo, 18 testes).
- .env.example: ORPHAN_ALERT_MINUTES/COOLDOWN_MS/ADMIN_EMAIL.
- Worklog: Task ID ORPHAN-ALERT-JOB + TOC.
- Validação: prettier + eslint + typecheck + vitest (novo teste) + guards (worklog/toc) + code-reviewer.

---

Task ID: MULTI-BUCKET-MAX
<a id="multi-bucket-max"></a>
Agent: orchestrator (persistência de telemetria do realtime)
Task: Fechar o tradeoff do bucket multi quando REALTIME_TELEMETRY_INTERVAL_MS < 60s — manter o MÁXIMO de usersWithMultipleSockets por minuto (GET+compare+SET no persist) para a timeline do dashboard não perder picos intra-minuto, com teste unitário do comportamento.

Work Log:

- Diagnóstico: com o intervalo de persistência < 60s (ex.: 30s), DOIS OU MAIS persists caem no MESMO bucket de minuto. O persist() antigo fazia setex incondicional do snapshot — o ÚLTIMO write do minuto sobrescrevia o pico intra-minuto (ex.: 3 órfãos no segundo 10 → 0 no segundo 40: o bucket ficava 0 e a timeline do dashboard perdia o sintoma). Os emits já eram DELTA (acumulam), mas o multi era substituído.
- Fix em mini-services/realtime/redis-telemetry.ts:
  - Novo helper puro shouldPersistMultiSnapshot(raw, newOrphans): bucket ausente (primeiro write do minuto) ou JSON corrompido → escreve (não há base de comparação); novo valor > existente → escreve (pico maior); igual ou menor → mantém o bucket atual (o pico já está gravado).
  - persist() agora emite `get(multiBucketKey(bucket))` no pipeline (índice conhecido = entries.length*2, sem SCAN) e só faz o setex do snapshot quando shouldPersistMultiSnapshot decide que o bucket muda — write separado (não engorda o pipeline principal).
  - Design notes do header atualizados (bucket multi = PEAK do minuto).
- Testes em src/lib/**tests**/realtime-telemetry.test.ts:
  - Novo describe shouldPersistMultiSnapshot (5 casos puros: ausente → true, corrompido → true, pico maior → true, igual/menor → false, campo ausente → 0).
  - Teste de pico intra-minuto com fake ESTATEFUL (get devolve o store; setex grava no store): 3 persists no mesmo minuto 0→3→1 → bucket final = 3 (pico preservado) com SÓ 2 writes (primeiro + pico) e flag emitida nos ciclos com órfãos.
  - Teste GET+compare+SET: pico 3 seguido de 1 e 0 → mantém 3 com só 1 write.
  - Teste existente do pipeline atualizado: agora verifica o get do multi bucket antes do setex condicional.

Resultado da varredura:

- A timeline do dashboard (area chart do multi[] → usersWithMultipleSockets por bucket) agora mostra o PICO de cada minuto, não o último snapshot — com intervalo < 60s o sintoma do socket órfão não some mais do gráfico.
- O ORPHAN-ALERT-JOB se beneficia indiretamente: bucket com pico > 0 confirma persistência mesmo que o snapshot do fim do minuto seja 0 (a cadeia de N minutos não quebra por um pico transitório a menos).
- Tradeoff documentado: o setex agora é condicional (1 write por pico, não 1 por ciclo) — custo extra de 1 GET por persist no pipeline, desprezível (chave derivada, sem SCAN).

Stage Summary:

- mini-services/realtime/redis-telemetry.ts: shouldPersistMultiSnapshot (puro) + get no pipeline + setex condicional + design notes.
- src/lib/**tests**/realtime-telemetry.test.ts: 2 describes novos (helper puro + pico intra-minuto com fake stateful) + teste do pipeline atualizado.
- Worklog: Task ID MULTI-BUCKET-MAX + TOC.
- Validação: prettier + eslint + typecheck + vitest (realtime-telemetry + realtime-security) + guards + code-reviewer.

---

Task ID: TELEMETRY-E2E
<a id="telemetry-e2e"></a>
Agent: orchestrator (E2E da telemetria do realtime)
Task: Adicionar um spec E2E (Playwright) que valida o fluxo completo da telemetria: admin autenticado chama GET /api/admin/realtime/telemetry com um socket real conectado e um emit disparado, conferindo emits > 0 na janela e o sinal multi (usersWithMultipleSockets + flag) no Redis.

Work Log:

- Spec novo e2e/admin-realtime-telemetry.spec.ts (describe.serial, 180s, provider isolado registrado via API no beforeAll com email único por run — zero interferência com os 6 providers do seed em fullyParallel):
  - C1 — Emits > 0 na janela: provider abre o dashboard (socket real + join em user:{id} via RealtimeProvider), o spec dispara POST /emit (notification:new) pela bridge server→server (Bearer REALTIME_EMIT_TOKEN, helper e2e/realtime-emit.ts) e o admin logado faz poll em GET /api/admin/realtime/telemetry?minutes=60 até emits[notification:new] >= 1. O poll (150s, step 3s) cobre o atraso do persist do realtime (REALTIME_TELEMETRY_INTERVAL_MS, default 30s) e viradas de minuto.
  - C2 — Sinal multi no Redis: o provider abre o dashboard em DUAS abas do mesmo context (2 sockets simultâneos dentro do limite PROVIDER=2 — o antigo NÃO é derrubado) e o admin faz poll até `multi` ter bucket com usersWithMultipleSockets >= 1 E `flag === true` (a flag realtime:telemetry:multi:flag, TTL ≈ 2× intervalo, self-clears quando a condição deixa de ser observada).
  - Requisitos de config documentados no header: realtime 3003 com REDIS_URL (sem Redis a rota responde { ok:false, available:false }), REALTIME_MAX_SESSIONS_PER_ROLE='{"CLIENT":1,"PROVIDER":2,"ADMIN":5}' (mesmo do admin-session-conflict) e REALTIME_EMIT_TOKEN no .env.local.
  - FLAKINESS tratada: emits asserido como >= 1 (nunca igualdade exata — outros specs em fullyParallel também emitem notification:new); o sinal multi casa por USER (usersWithMultipleSockets), imune aos demais specs.

Resultado da varredura:

- O spec prova ponta a ponta a cadeia emit → persist em Redis (buckets de minuto + flag) → leitura pela rota admin: o C1 garante que um emit real aparece nos emitCounters persistidos; o C2 reproduz o sintoma do socket órfão (HMR leak) de forma controlada e o vê refletido no dashboard de telemetria.
- O poll tolerante (150s) absorve o intervalo de persistência sem flake de virada de minuto; o diagnóstico no timeout imprime o último snapshot (emits/multi/flag) para debugging.

Stage Summary:

- e2e/admin-realtime-telemetry.spec.ts: spec novo (C1 emits > 0 + C2 sinal multi + flag) com provider isolado via API.
- Worklog: Task ID TELEMETRY-E2E + TOC.
- Validação: prettier + eslint + typecheck + run do spec com dev 3000 + realtime 3003 no ar + code-reviewer.

---

Task ID: REALTIME-COPY-GUARD
<a id="realtime-copy-guard"></a>
Agent: orchestrator (guard de consistência do Dockerfile do realtime)
Task: Adicionar um guard check-*.mjs que falha se o Dockerfile do realtime deixar de copiar algum módulo importado pelo index.ts (parse dos imports vs COPY), evitando a regressão de imagem quebrada em futuros deltas.

Work Log:

- Diagnóstico: o COPY explícito do realtime (index.ts security.ts booking-participant.ts) quebrou 2x quando um módulo novo entrou (redis-telemetry/redis-kick-audit/ops-alert/user-plan/session-notification/port) e o container bootou com module not found — o fix foi COPY *.ts ./ (glob), mas sem um guard a regressão (alguém reverte para lista explícita e esquece um módulo) poderia voltar silenciosamente.
- Guard novo scripts/check-realtime-copy.mjs (node-puro, <1s, padrão do check-cache-patterns.mjs):
  - Deriva o CLOSURE TRANSITIVO dos imports locais a partir de index.ts (collectModuleClosure: cada módulo lido e seus próprios imports seguidos até fechar; Set visited evita ciclos ex.: security ↔ index).
  - extractLocalImports captura from/import/re-export (`from "./x"`, `import "./x"`, `export { a } from "./x"`) e normaliza (.ts/.js removido); imports de pacotes não são locais. Subdiretório (`./lib/x`) é rastreado como `lib/x` — o glob *.ts NÃO recursa, então o forward flagra o gap real (não só arquivo ausente).
  - parseDockerfileCopies distingue glob (_.ts/_.js), `.` (diretório inteiro, recursivo) e lista explícita; ignora --from e dest diferente de ./|/app.
  - checkRealtimeCopy valida em 3 camadas: (1) arquivo AUSENTE em qualquer lugar (resolved-set acumulado via readModule) = module not found SEMPRE — mesmo na lista do COPY (fecha o fail-open do skip por list-membership que o reviewer achou); (2) arquivo existe mas o COPY não o alcança (subdir + glob que não recursa — gated em hasGlob, a lista explícita é dona do caso; skip quando a lista cobre o subdir no mixed glob+lista); (3) reverse (entrada órfã na lista explícita).
  - Fail-closed: index.ts, Dockerfile ou COPY de fonte ausentes = violação.
- Testes em src/lib/**tests**/check-realtime-copy.test.ts (18 testes): CLI (fixture limpo → 0; módulo sem arquivo → 1; lista omitindo módulo → 1; órfã → 1; módulo na lista SEM arquivo em lugar nenhum → 1 (fail-open do reviewer); index/Dockerfile ausente → 1; sem COPY de fonte → 1; subdir com arquivo em lib/ → 1; flag desconhecida → 2) + funções puras (extractLocalImports com from/import/re-export + normalize + subdir; closure transitivo com ciclo; parseDockerfileCopies glob vs lista; checkRealtimeCopy nas 3 camadas + mixed glob+lista → [] e subdir não listado → flagra "NÃO está na lista" sem mensagem de glob).
- Mutation test scripts/test-mutation-realtime-copy.sh (controle + 4 mutações): A import ./ghost sem arquivo → falha; B lista explícita sem ops-alert → falha; C ghost.ts órfão na lista → falha; D glob *.ts com módulo novo → passa (sem falso positivo).
- Registro: package.json (check:realtime-copy), .husky/pre-commit (após check:cache-patterns), job realtime-copy-guard no pr-check.yml (mutation + check + summary), docs/GUARDS.md seção 4 (header + descrição).

Resultado da varredura:

- O guard fecha a classe de regressão do COPY de forma DERIVADA do código (nunca lista hardcoded): um módulo novo importado por index.ts sem o .ts no diretório, ou fora da lista explícita do COPY, falha o commit/CI antes de gerar imagem quebrada.
- O glob *.ts continua sendo o fix recomendado (cobre qualquer módulo top-level futuro automaticamente); o guard só falha quando o glob não tem o que copiar (arquivo ausente) ou alguém volta para lista explícita incompleta/órfã.
- Documentado em docs/GUARDS.md (seção 4) com o mesmo padrão dos demais guards de consistência.

Stage Summary:

- scripts/check-realtime-copy.mjs: guard novo (closure de imports transitivos vs COPY, arquivo-ausente-sempre + cobertura + reverse, fail-closed).
- src/lib/**tests**/check-realtime-copy.test.ts: 18 testes (CLI + funções puras).
- scripts/test-mutation-realtime-copy.sh: mutation test (controle + 4 mutações).
- package.json + .husky/pre-commit + .github/workflows/pr-check.yml (job realtime-copy-guard) + docs/GUARDS.md + worklog TOC/Task ID.
- Validação: guard real no repo + vitest + mutation test + guards + code-reviewer.

---

Task ID: REALTIME-REDIS-ADAPTER
<a id="realtime-redis-adapter"></a>
Agent: orchestrator (escala horizontal do realtime)
Task: Preparar o realtime para escala horizontal: @socket.io/redis-adapter (rooms/sweeps compartilhados via Redis) + sticky sessions no Caddy para as rotas WS, com nota sobre o custo de consistência entre réplicas.

Work Log:

- Diagnóstico: sem o adapter, cada réplica do realtime só vê os próprios sockets — um `io.to(user:{id})` emitido na réplica A nunca alcança um socket conectado na réplica B. O `fetchSockets()` do adapter v8 é GLOBAL (sweeps de TTL/limite/revoke/órfãos passam a enxergar todas as réplicas), mas o socket.data é serializado via JSON no transporte cross-node (a VerifiedSession userId/role/expiresAt é JSON-serializável — ok). Estado in-memory (emitCounters/recentEmits/renew/expired counters/pending do kick audit) permanece por processo.
- mini-services/realtime/redis-adapter.ts (novo): loader promise-memoizado `createRedisAdapterLoader` com deps INJETÁVEIS (readSecret/createClientPair/createAdapter duck-typed — o módulo nunca importa ioredis/@socket.io/redis-adapter no topo; factories default usam dynamic import, testes passam fakes) + `attachRedisAdapter(io, loader)` → `{ attached, mode: "redis"|"local", close }`. Fail-open: sem REDIS_URL ou erro no connect → null (single-node, comportamento atual); a falha NÃO é memoizada (o próximo load() tenta de novo — auto-recuperação, mesmo padrão do createRedisLoader). createClientPair cria pub+sub (duplicate) com lazyConnect/connectTimeout 2s/maxRetries 1/offline queue off; createAdapter usa `key: REDIS_ADAPTER_KEY` + `requestsTimeout: 5000` (evita hangs nos broadcasts cross-replica).
- mini-services/realtime/index.ts: TLA (`await attachRedisAdapter(io, createRedisAdapterLoader())`) ANTES do httpServer.listen — a ordem é garantida (nenhuma conexão entra sem o modo decidido). `/health` expõe `adapter: { attached, mode }` para ops confirmar o modo de cada réplica. Shutdown (SIGTERM/SIGINT) chama `void redisAdapterState.close()` (fecha os clientes pub/sub, best-effort, não bloqueia o exit de 5s).
- Caddyfile.prod: STICKY SESSIONS OBRIGATÓRIAS no `handle_path /socket.io/*` → `reverse_proxy realtime:3003 { lb_policy cookie severinno_realtime }` (Caddy 2.7+; resolve NAT/CGNAT melhor que sticky por IP). A CONEXÃO socket.io (handshake + polling + upgrade) é estado in-memory do engine.io da réplica que a aceitou — o adapter compartilha SALAS, não conexões; sem sticky um polling que cai noutra réplica quebra a sessão (reconnect loop). Nota de escala: `docker compose up -d --scale realtime=N` (DNS do Docker devolve os N IPs).
- Caddyfile (dev): nota de que sticky NÃO se aplica (XTransformPort, instância única por porta — escala N só em prod).
- docker-compose.prod.yml: nota no serviço realtime (réplicas: estado in-memory por processo, /metrics agrega via Redis, Redis fora → degradado com broadcasts locais).
- .env.example: nota da env REDIS_URL (mesmo Redis do app) + sticky sessions no multi-réplica.
- README: seção "Escala horizontal (N réplicas + Redis adapter)" — modo no /health, comando de escala, aviso de sticky sessions, e o custo de consistência entre réplicas (rooms/broadcasts globais; fetchSockets global com JSON do socket.data; estado in-memory por processo; Redis single point para cross-replica com requestsTimeout 5s).
- Testes unitários src/lib/**tests**/realtime-redis-adapter.test.ts (padrão dos irmãos, fakes herméticos, sem rede): shouldUseRedisAdapter (url presente/ausente); loader fail-open sem REDIS_URL; sucesso cria pub/sub + attacha factory; promise-memoizado (mesma promise); falha NÃO memoizada (createClientPair null e createAdapter throw → próximo load retenta); createClientPair lança → null; attach (io.adapter chamado, attached/mode, close fecha os clients); fail-open loader null/throw → mode local com close no-op; REGRESSÃO do leak: io.adapter() lança após load OK → mode local MAS os clients pub/sub são fechados (try/catch aninhado no attachRedisAdapter).

Stage Summary:

- mini-services/realtime/redis-adapter.ts: módulo novo (loader + attach, fail-open, deps injetáveis).
- mini-services/realtime/index.ts: TLA attach antes do listen + adapter no /health + close no shutdown.
- Caddyfile.prod: lb_policy cookie severinno_realtime no /socket.io/* (sticky obrigatório com N réplicas).
- Caddyfile + docker-compose.prod.yml + .env.example + README: docs da escala horizontal e consistência entre réplicas.
- src/lib/**tests**/realtime-redis-adapter.test.ts: testes unitários do loader/attach (fakes).
- Validação: typecheck + vitest + prettier/eslint + guard check-realtime-copy + smoke boot com Redis + code-reviewer.
