# Auditoria — Camada 5: Filas / Mensageria (RabbitMQ 4)

**Data:** 2026-08-18
**Auditor:** Buffy (Codebuff)
**Status Geral:** 🟢 Saudável (Enterprise-grade with DLX/DLQ)

---

## Resumo Executivo

A camada de mensageria é **bem projetada** com exchange `severinno.direct`, dead-letter exchanges para retry, dead-letter queues para mensagens mortas, graceful shutdown, e 3 workers especializados (email, notification, search-index). Identificadas **0 vulnerabilidades P0**, **0 vulnerabilidades P1** e **3 melhorias P2/P3**.

---

## Itens Verificados

### 1. Connection Management

- ✅ **Singleton**: Conexão reutilizada via `globalThis.__rabbitConn` e `globalThis.__rabbitChan`
- ✅ **Lazy init**: `connPromise` e `chanPromise` criados sob demanda
- ✅ **Reconnection**: `connPromise = null` e `chanPromise = null` no `error`/`close` events
- ✅ **Graceful shutdown**: `setupGracefulShutdown()` com timeout 10s

### 2. Exchanges & Queues

- ✅ **Exchange principal**: `severinno.direct` (direct, durable)
- ✅ **DLX**: `severinno.dlx` (dead-letter exchange para retry counting)
- ✅ **DLQ**: `{queue}.dlq` criada para cada consumer
- ✅ **Binding**: Queues bindadas via routing keys

### 3. Publishers

- ✅ **`publish()`**: Exchange `severinno.direct`, routing key, JSON payload
- ✅ **Persistence**: `persistent: true` por default
- ✅ **Content-Type**: `application/json`
- ✅ **Error handling**: Log + swallow (não crasha o publisher)
- ✅ **2 publishers**: `email-queue.ts` (routing: "email"), `notification-queue.ts` (routing: "notification")

### 4. Consumers

- ✅ **`consume()`**: Prefetch configurável (default 10)
- ✅ **Retry logic**: Max 3 retries com nack + requeue
- ✅ **Dead letter**: Mensagens após max retries vão para DLQ via `ch.nack(raw, false, false)`
- ✅ **DLQ consumer**: Loga mensagens mortas para revisão manual
- ✅ **Death count**: `getDeathCount()` conta `x-death` headers

### 5. Workers

#### Notification Worker (`src/queue/consumer.ts`)

- ✅ **Queue**: "notifications", routing: "notification"
- ✅ **Prefetch**: 10
- ✅ **Graceful shutdown**: SIGINT/SIGTERM → close()
- ✅ **Handler**: `handleNotification()` — dispatch push + WhatsApp + realtime

#### Email Worker (Docker)

- ✅ **Queue**: "emails", routing: "email"
- ✅ **SMTP config**: Host, port, user, pass via env vars
- ✅ **Healthcheck**: TCP connectivity to RabbitMQ

#### Search Index Worker (Docker)

- ✅ **Polling**: `search_reindex_queue` table (não RabbitMQ)
- ✅ **Batch processing**: Configurable via POLL_INTERVAL_MS, BATCH_SIZE
- ✅ **Healthcheck**: TCP connectivity to PgBouncer

### 6. Notification Dispatch

- ✅ **Multi-channel**: Push + WhatsApp + Realtime em paralelo
- ✅ **User preferences**: Respeita `NotificationPreference` (push, whatsapp, sound)
- ✅ **Fallback**: `Promise.allSettled()` — falha de um canal não afeta outros
- ✅ **In-app notification**: Criada antes de queue (garante persistência)
- ✅ **Best-effort**: push/whatsapp/realtime são fire-and-forget

### 7. Event-Driven System

- ✅ **`event-hub.ts`**: 10 tipos de eventos (booking._, review._, quote._, payment._, message._, provider._)
- ✅ **Template engine**: `{{variable}}` interpolation
- ✅ **Scoped notifications**: `scopedUserIds` previne spam para todos os providers
- ✅ **Webhook rules**: `EventWebhook` model com targetRoles
- ✅ **Audit log**: `WebhookExecutionLog` com status, timing, errors
- ✅ **Fire-and-forget**: Nunca throw — loga errors

### 8. Docker Workers

- ✅ **3 workers**: email, notification, search-index
- ✅ **Healthchecks**: TCP connectivity check (RabbitMQ/PgBouncer)
- ✅ **Secrets**: postgres_password, rabbitmq_pass, smtp_pass, vapid_private_key
- ✅ **Resource limits**: 0.25 CPU, 256MB cada
- ✅ **Profile isolado**: `profiles: [workers]` para deploy seletivo

---

## Findings Detalhados

### F-001: Worker Dockerfile não tem dependências de typing

- **Severidade:** P2 (Melhoria)
- **Camada:** 5
- **Descrição:** O `Dockerfile.worker` copia `src/queue` e `src/lib` mas não inclui `src/types/`. Se algum módulo em `src/lib` importar de `src/types/`, o build falhará silenciosamente em runtime.
- **Impacto:** Potential runtime error se types forem importados
- **Recomendação:** Adicionar `COPY src/types ./src/types` no Dockerfile.worker
- **Esfroço:** 0.5h

### F-002: `handleNotification` faz query raw com array como parâmetro

- **Severidade:** P2 (Melhoria)
- **Camada:** 5
- **Descrição:** Em `notification-queue.ts`, a query `$queryRawUnsafe` usa `[userId, type]` como array, mas `$queryRawUnsafe` espera parâmetros como argumentos separados, não array.
- **Impacto:** Query pode não funcionar corretamente em todos os drivers
- **Recomendação:** Mudar para `$queryRawUnsafe(..., userId, type)` (spread)
- **Esfroço:** 0.5h

### F-003: Falta métricas de queue depth em runtime

- **Severidade:** P3 (Baixa)
- **Camada:** 5
- **Descrição:** O health monitor verifica queue depths via `checkQueue()` mas não expõe métricas contínuas (ex: Prometheus metrics para queue depth ao longo do tempo).
- **Impacto:** Sem visibilidade de tendências de fila
- **Recomendação:** Adicionar counter gauge para queue depth no `/api/metrics/prometheus`
- **Esfroço:** 2h

---

## Resumo por Prioridade

### P0 (Imediato)

- Nenhum finding P0 identificado

### P1 (Próxima sprint)

- Nenhum finding P1 identificado

### P2 (Backlog)

1. **F-001:** Adicionar `src/types` ao Dockerfile.worker
2. **F-002:** Corrigir parâmetros da query raw em notification-queue

### P3 (Melhoria contínua)

3. **F-003:** Métricas Prometheus de queue depth

---

## Estatísticas

| Métrica      | Valor                                   |
| ------------ | --------------------------------------- |
| Exchanges    | 2 (severinno.direct, severinno.dlx)     |
| Routing keys | 2 (email, notification)                 |
| Workers      | 3 (email, notification, search-index)   |
| Event types  | 10 (booking._, review._, quote.*, etc.) |
| Max retries  | 3                                       |
| Prefetch     | 10                                      |

## Padrões Positivos

1. **DLX/DLQ pattern**: Dead-letter exchanges para retry counting + dead-letter queues para mensagens mortas
2. **Graceful shutdown**: SIGINT/SIGTERM com timeout 10s
3. **Multi-channel dispatch**: Push + WhatsApp + Realtime em paralelo com Promise.allSettled
4. **User preferences**: Respeita NotificationPreference antes de dispatch
5. **Scoped notifications**: `scopedUserIds` previne spam para todos os providers
6. **Event-driven audit**: WebhookExecutionLog com status, timing, errors
7. **Fire-and-forget**: Event hub nunca throw — loga errors
8. **Singleton connection**: Reutiliza conexão via globalThis
