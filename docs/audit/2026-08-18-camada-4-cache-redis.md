# Auditoria — Camada 4: Cache (Redis 7 / Upstash)

**Data:** 2026-08-18
**Auditor:** Buffy (Codebuff)
**Status Geral:** 🟢 Saudável (Enterprise-grade with 3-tier fallback)

---

## Resumo Executivo

A camada de cache é **excepcionalmente bem projetada** com arquitetura de 3 tiers (Cluster → Standalone → In-memory), recovery automático, proactive recovery com GiST REINDEX, e rate limiting em 3 camadas. Client-side caching com BroadcastChannel cross-tab e cache warming server-side completam o sistema. Identificadas **0 vulnerabilidades P0**, **0 vulnerabilidades P1** e **3 melhorias P2/P3**.

---

## Itens Verificados

### 1. Redis Architecture (3-Tier)

- ✅ **3 tiers**: Cluster → Standalone → In-memory Map
- ✅ **Degradation automática**: `degradeTier()` chamado em erro de conexão
- ✅ **Recovery**: Timer de 30s tentando recuperar para tier superior
- ✅ **Proactive recovery**: Após 5+ degradações, GiST REINDEX + restart de clientes
- ✅ **Sentry alerts**: Após 3+ degradações, alerta Sentry (debounce 15min)
- ✅ **Tier info exportado**: `currentTier` e `hasEverConnected` para observabilidade

### 2. Cache Operations

- ✅ **`cacheGet()`**: Tenta Redis → retry com novo tier → fallback memory → retorna null
- ✅ **`cacheSet()`**: Escreve em memory (always) + Redis (best-effort)
- ✅ **`cacheInvalidate()`**: Limpa memory + Redis (cluster-aware SCAN)
- ✅ **`withCache()`**: Cache-aside helper com hit/miss counters
- ✅ **TTLs**: Configuráveis por chamada, cleanup periódico (60s)

### 3. Cluster Mode

- ✅ **Config**: `REDIS_CLUSTER_MODE=true` + `REDIS_CLUSTER_NODES`
- ✅ **SCAN cluster-safe**: `scanKeys()` itera todos os masters para evitar CROSSSLOT
- ✅ **Scale reads**: `scaleReads: "master"`
- ✅ **Retry strategy**: Exponential backoff (200ms, 400ms, 800ms, 1600ms)
- ✅ **Lazy connect**: `lazyConnect: true` para startup rápido

### 4. Rate Limiting (3 Camadas)

#### Camada 1: Global Rate Limit (Edge Middleware)

- ✅ **Upstash Redis**: REST-based, Edge-compatible, ~5ms latency
- ✅ **In-memory fallback**: Sliding window quando Upstash não configurado
- ✅ **IP extraction**: x-forwarded-for, x-real-ip, cf-connecting-ip, fallback hash
- ✅ **Bypass routes**: /api/health, /api/stats/public, /api/newsletter
- ✅ **Bypass prefixes**: /api/webhooks/, /api/cron/
- ✅ **Default**: 100 req/min por IP

#### Camada 2: Per-Route Rate Limit (Redis INCR + EXPIRE)

- ✅ **`rate-limit.ts`**: Sliding window com Redis
- ✅ **`withRateLimit()`**: HOF para envolver route handlers
- ✅ **`assertRateLimit()`**: Throw HttpError(429) com headers
- ✅ **Preset rates**: 17 presets (login 5/min, bookings 30/min, etc.)
- ✅ **In-memory fallback**: Map com cleanup periódico (60s)

#### Camada 3: Geo Rate Limit (Redis Sorted Sets)

- ✅ **`geo-rate-limit.ts`**: Sliding window com sorted sets (preciso)
- ✅ **Pipeline**: zremrangebyscore → zcard → zadd → pexpire
- ✅ **Per-endpoint**: search 30/min, cep 60/min, reverse 30/min
- ✅ **Nominatim compliance**: 1 req/s respeita política OSM
- ✅ **Diagnostics**: Top IPs, counters, memory store size

### 5. Client-Side Caching

#### CEP Cache (`client-cep-cache.ts`)

- ✅ **localStorage persistence**: Sobrevive page refreshes e tab switches
- ✅ **7-day TTL**: CEP data raramente muda
- ✅ **BroadcastChannel**: Cross-tab sync (tab A busca, tab B recebe)
- ✅ **Diagnostics**: Entry count, oldest entry age, TTL config
- ✅ **Sweep**: Remove entries expiradas manualmente

#### Geo Cache (`client-geo-cache.ts`)

- ✅ **localStorage persistence**: Sobrevive page refreshes
- ✅ **1-hour TTL**: Address/search data muda mais que CEP
- ✅ **Max 100 entries**: FIFO eviction previne localStorage unbounded
- ✅ **BroadcastChannel**: Cross-tab sync
- ✅ **Query normalization**: lowercase, trim, whitespace collapse
- ✅ **FIFO queue**: Queue key separada para tracking de ordem

#### Cache Warming (`client-geo-cache-warm.ts`)

- ✅ **Warming window**: 3-5 AM local time (conservador)
- ✅ **Cooldown**: 23h (once daily)
- ✅ **Geo warming**: Renova entries com < 15min TTL restante
- ✅ **CEP warming**: Renova entries com < 12h TTL restante
- ✅ **Max 20 entries**: Evita thundering herd
- ✅ **Diagnostics**: Warming state, last warm timestamp

### 6. Server-Side Cache Warming

- ✅ **`geo-cache-warm.ts`**: 48+ queries estáticas (25 cidades, 15 CEPs, 8 coords, 5 bairros, 6 capitais)
- ✅ **Log-based warming**: Top 10 searches, 10 CEPs, 5 reverses do query log
- ✅ **Deduplication**: `isKeyCached()` pula entries já em cache
- ✅ **Rate limiting**: Respeita 1 req/s Nominatim via `rateLimitedNominatim`
- ✅ **Idempotent**: Seguro para múltiplas execuções
- ✅ **Cron endpoint**: `GET /api/cron/geo-cache-warm` com cooldown 23h

### 7. Geohash Cache (`geohash-cache.ts`)

- ✅ **Pure TypeScript**: Encode/decode geohash sem dependências externas
- ✅ **SWR pattern**: Stale-While-Revalidate para searches espaciais
- ✅ **Precision levels**: 4 (~39km) a 7 (~152m)
- ✅ **In-memory store**: Map com TTL + stale window
- ✅ **Background refresh**: Stale entries retornam dados antigos enquanto revalidam

### 8. Push Payload Store (`push-store.ts`)

- ✅ **Redis-first**: Armazena payloads grandes (>3KB) no Redis
- ✅ **Memory fallback**: In-memory Map quando Redis indisponível
- ✅ **5-min TTL**: Push deve ser processado rapidamente
- ✅ **One-time access**: Deleta após leitura
- ✅ **Short IDs**: 16 chars URL-safe (crypto.getRandomValues)

### 9. External API Rate Limiting

- ✅ **Nominatim**: 1 req/s (sliding window, module-level timestamp)
- ✅ **ViaCEP**: 60 req/min (sliding window, independent budget)
- ✅ **Separation**: ViaCEP e Nominatim não se influenciam mutuamente
- ✅ **Fallback**: Retry com wait quando budget esgotado

### 10. Observability

- ✅ **Hit/miss counters**: `getCacheStats()` com hit ratio
- ✅ **Redis diagnostics**: `getRedisDiagnostics()` com cluster nodes, slot distribution
- ✅ **Memory cache**: `getMemoryCacheDiagnostics()` com size e maxAge
- ✅ **Rate limit counters**: `getRateLimitCounters()` com allowed/blocked
- ✅ **Global rate limit**: `getGlobalRateLimitDiagnostics()` com store size
- ✅ **Admin dashboard**: Componentes `admin-redis-diagnostics.tsx`, `admin-geo-rate-limit-status.tsx`

---

## Findings Detalhados

### F-001: `rate-limit.ts` cria novo Redis client por request

- **Severidade:** P2 (Melhoria)
- **Camada:** 4
- **Descrição:** A função `getRedisClient()` em `rate-limit.ts` cria um novo `ioredis` client a cada chamada, testa conexão com `ping()`, e não reutiliza. Isso gera overhead de connection pooling. O módulo `redis.ts` já tem um singleton client compartilhado.
- **Impacto:** Overhead de ~1-2ms por request para criar/conectar client
- **Recomendação:** Reutilizar o client do `redis.ts` em vez de criar novo client
- **Esfroço:** 2h

### F-002: In-memory stores não têm limite de tamanho

- **Severidade:** P2 (Melhoria)
- **Camada:** 4
- **Descrição:** Os memory stores em `redis.ts`, `rate-limit.ts`, `geo-rate-limit.ts`, e `global-rate-limit.ts` usam `Map` sem limite de tamanho. Em cenários de alto tráfego com muitos IPs únicos, o memory store pode crescer indefinidamente.
- **Impacto:** Potencial memory leak em cenários extremos
- **Recomendação:** Adicionar max size (ex: 10,000 entries) com LRU eviction
- **Esfroço:** 4h

### F-003: Client-side cache warming roda em 3-5 AM (fuso do browser)

- **Severidade:** P3 (Baixa)
- **Camada:** 4
- **Descrição:** O `client-geo-cache-warm.ts` usa `new Date().getHours()` que retorna a hora local do browser. Se o usuário estiver em outro fuso horário, o warming pode não rodar na janela esperada.
- **Impacto:** Nenhum funcional — warming é best-effort
- **Recomendação:** Manter como está (warming é opcional e idempotente)
- **Esfroço:** 0h

---

## Resumo por Prioridade

### P0 (Imediato)

- Nenhum finding P0 identificado

### P1 (Próxima sprint)

- Nenhum finding P1 identificado

### P2 (Backlog)

1. **F-001:** Reutilizar client Redis no rate-limit.ts
2. **F-002:** Adicionar max size nos in-memory stores

### P3 (Melhoria contínua)

3. **F-003:** Warming window timezone (informativo)

---

## Estatísticas

| Métrica                   | Valor                                                      |
| ------------------------- | ---------------------------------------------------------- |
| Tiers de cache            | 3 (Cluster → Standalone → Memory)                          |
| Camadas de rate limiting  | 3 (Edge + per-route + geo)                                 |
| Client-side caches        | 3 (CEP, Geo, Push payload)                                 |
| Server-side cache warming | 48+ queries estáticas + log-based                          |
| Presets de rate limit     | 17                                                         |
| TTLs configurados         | 5min (user active), 10min (categories), 7d (CEP), 1h (geo) |

## Padrões Positivos

1. **3-tier fallback**: Cluster → Standalone → Memory com degradação automática
2. **Proactive recovery**: GiST REINDEX + Redis restart após 5+ degradações
3. **3 camadas de rate limiting**: Edge (Upstash) → per-route (Redis) → geo (sorted sets)
4. **Client-side caching**: localStorage + BroadcastChannel cross-tab sync
5. **Cache warming**: Server-side (48+ queries) + client-side (3-5 AM window)
6. **SWR pattern**: Geohash cache com stale-while-revalidate
7. **Observability**: Hit ratio, diagnostics, admin dashboard
8. **Idempotent warming**: Seguro para múltiplas execuções
9. **Nominatim compliance**: 1 req/s com rate limiter dedicado
10. **Push payload store**: Signal-only pattern para payloads grandes
