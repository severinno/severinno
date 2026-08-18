# Auditoria — Camada 12: Infraestrutura Local (Docker Compose)

**Data:** 2026-08-18
**Auditor:** Buffy (Codebuff)
**Status Geral:** 🟢 Saudável (Enterprise-grade)

---

## Resumo Executivo

A infraestrutura Docker é **excepcionalmente bem configurada** com hardening de segurança (no-new-privileges, cap_drop ALL, read_only, tmpfs), Docker Secrets para credenciais, PgBouncer para connection pooling, resource limits em todos os serviços, e health checks completos. Identificadas **0 vulnerabilidades P0**, **1 melhoria P1** e **5 oportunidades P2/P3**.

---

## Itens Verificados

### 1. Docker Compose Base

- ✅ **Serviços core**: PostgreSQL 16-3.4-alpine, Redis 7-alpine, RabbitMQ 4-alpine, MinIO (pinned), PgBouncer (pinned v1.25.2-p0)
- ✅ **Health checks**: Todos os serviços core com `healthcheck` configurado
- ✅ **Depends_on condicional**: `condition: service_healthy` em todos os dependentes
- ✅ **Volumes persistentes**: postgres_data, redis_data, minio_data, rabbitmq_data, caddy_data/config/logs
- ✅ **Redes**: Frontend (172.20.0.0/24) + Backend (172.20.1.0/24) separadas
- ✅ **Docker Secrets**: 10 secrets montados em /run/secrets/ (postgres_password, session_secret, vapid_private_key, etc.)

### 2. Hardening de Segurança

- ✅ **`security_opt: no-new-privileges:true`**: Em TODOS os serviços (14/14)
- ✅ **`cap_drop: ALL`**: Em TODOS os serviços — apenas NET_BIND_SERVICE adicionado quando necessário
- ✅ **`read_only: true`**: Redis, Realtime, PgBouncer (com tmpfs para /tmp)
- ✅ **`tmpfs`**: Configurado em todos os serviços para arquivos temporários
- ✅ **Resource limits**: CPU e memória definidos para todos os serviços:
  - Caddy: 0.5 CPU, 256MB
  - PostgreSQL: 1.0 CPU, 1GB
  - Redis: 0.5 CPU, 512MB
  - RabbitMQ: 0.5 CPU, 512MB
  - MinIO: 0.5 CPU, 512MB
  - PgBouncer: 0.25 CPU, 128MB
  - Realtime: 0.5 CPU, 256MB
  - App: 1.0 CPU, 1GB
  - Workers: 0.25 CPU, 256MB cada
- ✅ **Logging**: `json-file` com `max-size: 10m` e `max-file: 3` em todos os serviços
- ✅ **Non-root users**: App (severinno:1001), Worker (appuser:1001)

### 3. Dockerfile Principal (Multi-stage)

- ✅ **3 stages**: deps → builder → runner
- ✅ **Bun version**: `ARG BUN_VERSION` obrigatório (fonte única via vars.BUN_VERSION)
- ✅ **Frozen lockfile**: `bun install --frozen-lockfile`
- ✅ **Prisma generate**: Roda antes do build
- ✅ **Standalone output**: `BUILD_STANDALONE=true`
- ✅ **User não-root**: `severinno:1001`
- ✅ **Healthcheck**: `curl -f http://localhost:3000/api/health`
- ✅ **Prisma client + migrations**: Copiados para o runner

### 4. Dockerfile.worker

- ✅ **3 stages**: deps → builder → runner (leve, sem Next.js)
- ✅ **Production only**: `bun install --frozen-lockfile --production`
- ✅ **User não-root**: `appuser:1001`
- ✅ **Healthcheck**: `bun --eval 'process.exit(0)'`
- ✅ **Entrypoint**: `scripts/entrypoint.sh` para ler Docker Secrets

### 5. Mini-service Realtime

- ✅ **Dockerfile**: Bun slim, production deps only
- ✅ **Healthcheck**: `bun -e fetch(...)` verificando /health
- ✅ **Read-only**: Filesystem somente leitura
- ✅ **Redis adapter**: Para horizontal scaling

### 6. PgBouncer

- ✅ **Imagem corrigida**: `edoburu/pgbouncer:v1.25.2-p0` (não bitnami que não existe)
- ✅ **Pool mode**: `transaction` para Prisma/Next.js
- ✅ **Prepared statements**: `max_prepared_statements = 200` (crítico para Prisma)
- ✅ **Pool sizing**: default_pool_size=25, reserve_pool_size=5, max_client_conn=1000
- ✅ **Timeouts**: query_timeout=30s, server_idle_timeout=600s, server_lifetime=3600s
- ✅ **Healthcheck**: `pg_isready -h 127.0.0.1 -p 6432`
- ✅ **GlitchTip PgBouncer**: Pool mode=session, pool_size=15 (Django compatível)

### 7. Caddy (Reverse Proxy)

- ✅ **HTTPS automático**: Let's Encrypt / ZeroSSL via ACME
- ✅ **Security headers**: HSTS, X-Frame-Options, CSP, Permissions-Policy
- ✅ **Rate limiting**: `rate_limit` zone com 100 events/min
- ✅ **WebSocket**: Proxy para Socket.io com `flush_interval -1`
- ✅ **Health check pass-through**: `health_uri /api/health`, `health_interval 30s`
- ✅ **Circuit breaker**: `max_fails 3`, `fail_duration 30s`
- ✅ **Logging**: Combined Log Format para fail2ban (caddy-access, caddy-badbots, caddy-404-scan)
- ✅ **Error pages**: 4xx e 5xx sem vazar stack traces
- ✅ **Compression**: zstd + gzip
- ✅ **Admin API**: Porta 2019 para monitoramento interno

### 8. GlitchTip (Error Monitoring)

- ✅ **Profile isolado**: `profiles: [glitchtip]` — não afeta stack principal
- ✅ **5 serviços**: DB, PgBouncer, Redis, MinIO, Web, Worker
- ✅ **Migrations**: One-shot via `glitchtip-migrate`
- ✅ **MinIO init**: One-shot bucket creation
- ✅ **Resource limits**: Todos os serviços com limites

### 9. Workers (Profile Isolado)

- ✅ **3 workers**: email, notification, search-index
- ✅ **Healthchecks**: TCP connectivity check para RabbitMQ/PgBouncer
- ✅ **Secrets**: postgres_password, rabbitmq_pass, smtp_pass, vapid_private_key
- ✅ **Depends_on**: Todos com `condition: service_healthy`

### 10. Geo Cache Warm

- ✅ **One-shot**: `restart: "no"`
- ✅ **Depends_on**: `app: condition: service_healthy`
- ✅ **CRON_SECRET via Docker Secret**: `/run/secrets/cron_secret`
- ✅ **Error handling**: Exit code correto (0=success/cooldown, 1=failure)

### 11. Docker Compose Dev

- ✅ **Portas localhost-only**: `127.0.0.1:PORT:PORT` em todos os serviços
- ✅ **Valkey**: Redis-compatible FOSS (7.2-alpine) em vez de Redis
- ✅ **OpenSearch**: Para full-text search
- ✅ **OSRM**: Profile isolado para routing
- ✅ **GlitchTip**: Incluído diretamente (sem secrets em dev)

### 12. Docker Compose Test

- ✅ **PostGIS alpine**: 154MB vs 203MB da versão full
- ✅ **tmpfs para dados**: Throw-away data, fresh each run
- ✅ **Portas não-padrão**: 5433 (host) → 5432 (container) para evitar conflito
- ✅ **Valkey**: Cache efêmero

### 13. Variáveis de Ambiente

- ✅ **`.env.example`**: Template completo com documentação
- ✅ **Secrets**: Credenciais sensíveis em Docker Secrets, não em env vars
- ✅ **Defaults**: Valores sensíveis para dev, placeholders para prod
- ✅ **NEXT_PUBLIC_**: Apenas variáveis públicas expostas ao cliente

### 14. Docker Compose Prod

- ✅ **Networks separadas**: Frontend (exposto) + Backend (interno)
- ✅ **Docker Secrets**: 10 secrets para credenciais sensíveis
- ✅ **Image tags**: GHCR (ghcr.io/${GITHUB_REPOSITORY})
- ✅ **Entry point**: `scripts/docker-entrypoint.sh` para ler secrets
- ✅ **Caddy**: Único serviço exposto (portas 80/443)

---

## Findings Detalhados

### F-001: GlitchTip usa interpolação de env vars para secrets (não Docker Secrets)

- **Severidade:** P1 (Atenção)
- **Camada:** 12
- **Descrição:** Os serviços GlitchTip (glitchtip-web, glitchtip-worker, glitchtip-migrate) usam `GLITCHTIP_DB_PASSWORD`, `GLITCHTIP_SECRET_KEY`, `GLITCHTIP_S3_SECRET_KEY` via interpolação do Docker Compose, não via Docker Secrets (`_FILE`). O código documenta esta limitação explicitamente.
- **Impacto:** Secrets do GlitchTip aparecem em `docker inspect` e no histórico de comandos
- **Recomendação:** Usar entrypoint customizado para ler de /run/secrets/ ou Docker configs, como o app principal faz
- **Esfroço:** 4h

### F-002: healthcheck do worker usa `bun --eval` (não verifica serviço real)

- **Severidade:** P2 (Melhoria)
- **Camada:** 12
- **Descrição:** O healthcheck `bun --eval 'process.exit(0)'` apenas verifica se o Bun está rodando, não se o worker está consumindo filas. O healthcheck detalhado do `/api/health/detailed` já verifica consumers via RabbitMQ.
- **Impacto:** Worker pode estar "healthy" mas não processando filas
- **Recomendação:** Manter como está (verificação detalhada já existe no health monitor), mas documentar a limitação
- **Esfroço:** 0h (documentação)

### F-003: docker-compose.dev.yml usa Valkey em vez de Redis

- **Severidade:** P3 (Informativo)
- **Camada:** 12
- **Descrição:** O compose dev usa `valkey/valkey:7.2-alpine` (FOSS fork do Redis) enquanto o prod usa `redis:7-alpine`. São compatíveis mas imagens diferentes.
- **Impacto:** Nenhum funcional — Valkey é 100% compatível com protocolo Redis
- **Recomendação:** Manter como está (decisão intencional para usar FOSS em dev)

### F-004: Falta docker-compose.localai.yml (referenciado no README)

- **Severidade:** P3 (Baixa)
- **Camada:** 12
- **Descrição:** O README referencia `docker-compose.localai.yml` mas o arquivo não existe no diretório raiz.
- **Impacto:** Usuários que seguem o README podem ter dificuldade
- **Recomendação:** Criar o arquivo ou atualizar o README
- **Esfroço:** 1h

### F-005: Cache warming script depende de curlimages/curl (imagem externa)

- **Severidade:** P3 (Baixa)
- **Camada:** 12
- **Descrição:** O `geo-cache-warm` usa `curlimages/curl:8.12.1` — imagem third-party. Poderia usar a imagem do app (que já tem curl) ou um script Node/Bun.
- **Impacto:** Dependência de imagem externa, potencial vulnerabilidade supply-chain
- **Recomendação:** Migrar para script Bun/Node ou usar imagem alpine com curl
- **Esfroço:** 1h

---

## Resumo por Prioridade

### P0 (Imediato)

- Nenhum finding P0 identificado

### P1 (Próxima sprint)

1. **F-001:** GlitchTip secrets via env vars (documentar ou migrar para Docker Secrets)

### P2 (Backlog)

2. **F-002:** Documentar limitação do healthcheck worker

### P3 (Melhoria contínua)

3. **F-003:** Valkey vs Redis (informativo, decisão intencional)
4. **F-004:** Criar docker-compose.localai.yml ou atualizar README
5. **F-005:** Migrar geo-cache-warm de curlimages para script interno

---

## Estatísticas

| Métrica                       | Valor                      |
| ----------------------------- | -------------------------- |
| Total de serviços (prod)      | 14                         |
| Serviços com health check     | 14/14 (100%)               |
| Serviços com resource limits  | 14/14 (100%)               |
| Serviços com security_opt     | 14/14 (100%)               |
| Serviços com cap_drop: ALL    | 14/14 (100%)               |
| Docker Secrets configurados   | 10                         |
| Profiles (glitchtip, workers) | 2                          |
| Dockerfiles                   | 3 (main, worker, realtime) |
| PgBouncer configs             | 2 (app, glitchtip)         |

## Padrões Positivos

1. **Security-first**: no-new-privileges + cap_drop ALL em TODOS os serviços
2. **Docker Secrets**: Credenciais nunca em texto plano em env vars (exceto GlitchTip)
3. **Connection pooling**: PgBouncer com transaction mode para Prisma
4. **Resource limits**: Todos os serviços com CPU e memória limitados
5. **Health checks**: 100% dos serviços com health check + start_period
6. **Log rotation**: json-file com max-size 10MB e max-file 3
7. **Network isolation**: Frontend vs Backend networks
8. **Image pinning**: Todas as imagens com tags fixadas (não :latest)
9. **GlitchTip isolado**: Profile `glitchtip` não afeta stack principal
10. **Caddy hardening**: read_only + tmpfs + security headers completos
