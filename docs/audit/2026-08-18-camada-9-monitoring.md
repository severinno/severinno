# Auditoria — Camada 9: Monitoramento & Ops

**Data:** 2026-08-18
**Auditor:** Buffy (Codebuff)
**Status Geral:** 🟢 Saudável (Multi-layer monitoring)

---

## Resumo Executivo

A camada de monitoramento é **abrangente** com 3 endpoints de health (lightweight, detailed, extended), health monitor com thresholds e debounce, alerting service multi-canal, Sentry/GlitchTip integration, Prometheus/OpenMetrics support, e structured logging com Pino. Identificadas **0 vulnerabilidades P0**, **0 vulnerabilidades P1** e **3 melhorias P2/P3**.

---

## Itens Verificados

### 1. Health Endpoints

#### `GET /api/health` (Lightweight)

- ✅ **Checks**: Database (SELECT 1), Redis (PING), Nominatim, ViaCEP, PostGIS
- ✅ **Kill-switch**: Nominatim/ViaCEP respeitam `nominatim_enabled`/`viacep_enabled`
- ✅ **Cache**: 15s in-memory cache (apenas respostas healthy)
- ✅ **Sentry alert**: Envia warning quando geo services degraded
- ✅ **Status**: `ok` | `degraded` (200/503)

#### `GET /api/health/detailed` (Full)

- ✅ **10 serviços**: app, database, redis, rabbitmq, pgbouncer, realtime, minio, caddy, disk, workers
- ✅ **Criticality tiers**: `CRITICAL_SERVICES` (database, app) → unhealthy se down
- ✅ **Prometheus**: `?format=prometheus` retorna OpenMetrics text
- ✅ **Cache**: 15s in-memory (apenas healthy)
- ✅ **Latency tracking**: performance.now() por serviço

#### `GET /api/health/extended` (Extended)

- ✅ **4 checks**: Database + PostGIS, Redis GEO, OSRM routing, Memory stats
- ✅ **PostGIS version**: Detecta versão da extensão
- ✅ **Redis GEO stats**: Coordenadas no grid, engine type
- ✅ **OSRM**: Testa com coordenadas reais de São Paulo

### 2. Health Monitor (`health-monitor.ts`)

- ✅ **Cron endpoint**: `GET /api/cron/health-monitor` autenticado com CRON_SECRET
- ✅ **Thresholds configurados**:
  - RSS > 400MB warn, > 600MB crit
  - Heap > 200MB warn, > 350MB crit
  - DB latency > 2s warn, > 5s crit
  - Cache hit ratio < 50% warn
  - Queue depth > 100 warn, > 500 crit
- ✅ **Debounce**: 3 checks consecutivos antes de alertar
- ✅ **Sentry events**: Cada serviço unhealthy/degraded gera evento separado
- ✅ **Summary event**: Status geral quando sistema degraded/unhealthy
- ✅ **Proactive recovery**: Após 5+ degradações, GiST REINDEX + Redis restart

### 3. Alerting Service (`alerting-service.ts`)

- ✅ **Multi-canal**: Discord, Slack, Telegram, Generic Webhooks
- ✅ **Severidades**: INFO, WARNING, CRITICAL, EMERGENCY
- ✅ **Payload formatado**: Embeds com color, fields, footer
- ✅ **Helpers**: `reportOutage()`, `reportLatencySpike()`, `reportFraudAttempt()`
- ✅ **Timeout**: 4s timeout no fetch do webhook
- ✅ **Fallback**: Log stdout/stderr quando webhook não configurado

### 4. Business Metrics (`metrics.ts`)

- ✅ **KPIs**: Users (total/clients/providers/verified/new30d), Bookings (total/byStatus/completed/cancelled), Quotes, Reviews, Revenue
- ✅ **Conversion rates**: Booking/Quote ratio, average booking value
- ✅ **Period**: Configurable (default 30 days)
- ✅ **Parallel queries**: Promise.all para performance

### 5. Sentry / GlitchTip

- ✅ **Lazy loading**: `getSentry()` com try/catch — não crasha sem DSN
- ✅ **`captureError()`**: Exception + context extras
- ✅ **`captureMessage()`**: Severity mapping (info/warn/error/fatal)
- ✅ **`flushSentry()`**: Timeout 2s para graceful shutdown
- ✅ **Production only**: Não envia em dev/test
- ✅ **Self-hosted**: GlitchTip (Sentry-compatible, MIT license)

### 6. Structured Logging (Pino)

- ✅ **Levels**: Configurável via `LOG_LEVEL` (default: debug dev, info prod)
- ✅ **Transport**: `pino-pretty` em dev, JSON raw em prod
- ✅ **Redaction**: `password`, `passwordHash`, `req.headers.cookie`, `req.headers.authorization`
- ✅ **Server-only**: `import "server-only"` impede import no client

### 7. Prometheus / OpenMetrics

- ✅ **Endpoint**: `/api/health/detailed?format=prometheus` (alias via `/api/metrics/prometheus`)
- ✅ **Metrics**: build_info, health_status, service_status, service_latency, process metrics (RSS, heap, CPU), cache metrics, RabbitMQ queue depths, worker status
- ✅ **Format**: `text/plain; version=0.0.4` (OpenMetrics)
- ✅ **EOF marker**: `# EOF` requerido pelo OpenMetrics

### 8. Push Monitoring

- ✅ **PushAnalytics model**: Delivery metrics (sent, delivered, clicked, bounced, failed)
- ✅ **Action tracking**: accept, reject, view com resultado
- ✅ **PushSendLog model**: Audit trail para envios (manual, scheduled, recurring)
- ✅ **Admin dashboard**: `admin-push-analytics.tsx`, `admin-push-metrics.tsx`

---

## Findings Detalhados

### F-001: Health monitor thresholds não são configuráveis via env

- **Severidade:** P2 (Melhoria)
- **Camada:** 9
- **Descrição:** Os thresholds do health monitor (RSS 400MB, heap 200MB, DB latency 2s) são hardcoded. Em diferentes ambientes (dev vs prod), os limites ideais podem ser diferentes.
- **Impacto:** Alertas falsos em ambientes com menos recursos
- **Recomendação:** Tornar thresholds configuráveis via env vars (ex: `HEALTH_RSS_WARN_MB=400`)
- **Esfroço:** 2h

### F-002: Sentry integration não tem sample rate configurável

- **Severidade:** P2 (Melhoria)
- **Camada:** 9
- **Descrição:** A integração Sentry envia 100% dos erros em produção. Para alta escala, um sample rate (ex: 0.1) reduziria custos e tráfego.
- **Impacto:** Custo/tráfego Sentry pode ser alto em produção com muitos erros
- **Recomendação:** Adicionar `SENTRY_SAMPLE_RATE` env var (default 1.0)
- **Esfroço:** 1h

### F-003: Extended health não tem cache

- **Severidade:** P3 (Baixa)
- **Camada:** 9
- **Descrição:** `/api/health/extended` faz checks pesados (DB count, Redis GEO stats, OSRM fetch) sem cache. Requests frequentes podem sobrecarregar.
- **Impacto:** Performance degradada com requests frequentes
- **Recomendação:** Adicionar cache 30s como os outros health endpoints
- **Esfroço:** 1h

---

## Resumo por Prioridade

### P0 (Imediato)

- Nenhum finding P0 identificado

### P1 (Próxima sprint)

- Nenhum finding P1 identificado

### P2 (Backlog)

1. **F-001:** Tornar thresholds configuráveis via env
2. **F-002:** Adicionar SENTRY_SAMPLE_RATE

### P3 (Melhoria contínua)

3. **F-003:** Cache para extended health

---

## Estatísticas

| Métrica               | Valor                                         |
| --------------------- | --------------------------------------------- |
| Health endpoints      | 3 (lightweight, detailed, extended)           |
| Monitored services    | 10+                                           |
| Alert thresholds      | 8 (memory, latency, cache, queue)             |
| Sentry event types    | 3 (captureError, captureMessage, flushSentry) |
| Prometheus metrics    | 15+                                           |
| Push analytics models | 2 (PushAnalytics, PushSendLog)                |

## Padrões Positivos

1. **3 endpoints de health**: Lightweight (Docker), Detailed (Prometheus), Extended (deep checks)
2. **Criticality tiers**: Serviços críticos vs degradáveis
3. **Threshold-based alerting**: Com debounce de 3 checks
4. **Prometheus/OpenMetrics**: Formato padrão para monitoring stacks
5. **Sentry lazy loading**: Não crasha sem DSN configurado
6. **Structured logging**: Pino com redaction de dados sensíveis
7. **Push analytics**: Métricas de delivery, click, bounce
8. **Kill-switches**: Nominatim/ViaCEP configuráveis via admin
