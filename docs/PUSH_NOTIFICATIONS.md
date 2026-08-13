# Push Notification System — Severinno Marketplace

> Sistema completo de notificações push com Web Push API, suporte a agendamento,
> eventos automáticos via webhooks, payloads grandes (>4KB) e métricas de entrega.
> Última atualização: 2026-07-28 | Versão: v0.3.0-cache-mvp

## Arquitetura

```
┌──────────────┐     ┌──────────────────┐     ┌──────────────────┐
│   Navegador   │     │   Next.js (App)   │     │  Valkey (Cache)   │
│  Service      │◄────│  ┌──────────────┐ │     │  ┌────────────┐  │
│  Worker       │     │  │ push.ts      │ │     │  │ push-store  │  │
│  (sw.js)     │     │  │ sendPush...   │ │     │  │ (payloads)  │  │
└──────┬───────┘     │  └──────────────┘ │     │  └────────────┘  │
       │             │  ┌──────────────┐ │     └──────────────────┘
       │ Web Push    │  │ event-hub.ts │ │     
       │ (encrypted) │  │ fireEvent()  │ │     ┌──────────────────┐
       ▼             │  └──────────────┘ │     │  PostgreSQL       │
┌──────────────┐     │  ┌──────────────┐ │     │  ┌────────────┐  │
│  Web Push     │     │  │ push-monitor │ │     │  │ PushSub..  │  │
│  Service      │────►│  │ (retry +     │ │     │  │ PushAnal.. │  │
│  (Mozilla)    │     │  │  track)      │ │     │  │ PushSen..  │  │
└──────────────┘     │  └──────────────┘ │     │  └────────────┘  │
                     └──────────────────┘     └──────────────────┘
```

## Camadas do Sistema

### 1. Inscrição (Subscription)

O service worker registra o usuário via Push API e envia a subscription para o servidor:

```typescript
// service-worker.ts (gerado como sw.js)
// 1. Registrar SW
// 2. Chamar pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })
// 3. POST /api/push/register com { endpoint, keys: { p256dh, auth } }
```

**Modelo:** `PushSubscription` (armazenado em PostgreSQL)

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `id` | String | CUID |
| `userId` | String | FK → User |
| `endpoint` | String | URL única do push service (FCM/ Mozilla) |
| `p256dh` | String | Chave pública para criptografia |
| `auth` | String | Secreto de autenticação |
| `userAgent` | String? | Navegador do usuário |

### 2. Envio Imediato (sendPushNotification)

**Arquivo:** `src/lib/push.ts`

Função principal que envia push para um usuário específico:

```
sendPushNotification(userId, title, body, url?, opts?)
  ├─ Busca subscriptions do usuário (db.pushSubscription.findMany)
  ├─ Cria analytics record (db.pushAnalytics.create)
  ├─ Monta payload rico (title, body, url, icon, badge, actions, data)
  ├─ Se payload > 3072 bytes → signal-only pattern
  │   └─ Salva payload no push-store → envia só { _signal, payloadId }
  ├─ Para cada subscription:
  │   ├─ Tenta enviar com web-push (max 3 tentativas, exponential backoff)
  │   ├─ 410/404 → remove subscription + marca como bounced
  │   └─ Erro transiente (5xx/429/408) → retry com backoff
  └─ Atualiza analytics (latencyMs, finalStatus)
```

**Retry com Exponential Backoff:**

| Tentativa | Delay (base) | Delay máximo |
|:---------:|:------------:|:------------:|
| 1 | 500ms | 4s |
| 2 | 1000ms | 4s |
| 3 | 2000ms | 4s |

Cada delay inclui **jitter** (random 0-500ms) para evitar thundering herd.

### 3. Envio para Múltiplos (sendPushToMany)

```typescript
await sendPushToMany(userIds, title, body, url?, opts?)
// Usa Promise.allSettled — falha em um não quebra os outros
```

### 4. Payloads Grandes (Signal-Only Pattern)

Quando o payload excede **3072 bytes** (limite seguro de 4KB com overhead de criptografia):

```
1. storePayload(payload) → armazena no Valkey (5min TTL) ou memória
2. Envia apenas { _signal: true, payloadId, title, body(resumido), url }
3. Service worker recebe o sinal → GET /api/push/payload/:id
4. Recupera payload completo → exibe notificação rica
```

**Arquivo:** `src/lib/push-store.ts`

| Storage | Prioridade | TTL |
|---------|:----------:|:---:|
| Valkey | 1ª | 5 min |
| In-memory Map | Fallback | 5 min |

### 5. Botões de Ação (Action Buttons)

Tipos de notificação com ações pré-definidas:

| Tipo | Ações | Descrição |
|------|-------|-----------|
| `BOOKING_CREATED` | ✅ Aceitar / ❌ Recusar | Provider responde a booking |

O service worker captura o clique em ação e redireciona para:
```
POST /api/push/action { action, notificationId }
```

### 6. Notificações Agendadas

**Rotas Admin:**
- `POST /api/admin/push/send` — Envio manual imediato
- `POST /api/admin/push/schedule` — Agendar para futuro
- `GET /api/admin/push/history` — Histórico de envios
- `GET /api/admin/push/analytics` — Métricas de entrega
- `POST /api/admin/push/recurring` — Criar regra recorrente

**Modelo:** `ScheduledPushNotification`

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `scheduledAt` | DateTime | Quando enviar |
| `status` | String | PENDING \| SENT \| CANCELLED \| FAILED |
| `userIds` | JSON | Lista de destinatários |
| `type` | String | ADMIN_MANUAL \| RECURRING \| WEBHOOK |

**Cron job:** `/api/cron/push-scheduled` (executado a cada minuto via CRON_SECRET)

### 7. Notificações Recorrentes (Recurring Push)

**Modelo:** `RecurringPushSchedule`

| Frequência | Configuração |
|:----------:|--------------|
| `daily` | `time: "09:00"` — todo dia no horário |
| `weekly` | `time: "09:00", dayOfWeek: 1` — toda segunda |
| `monthly` | `time: "09:00", dayOfMonth: 15` — dia 15 |

O cron job verifica a cada minuto se alguma regra recorrente deve disparar hoje.

### 8. Webhooks de Evento (Auto Push Triggers)

**Arquivo:** `src/lib/event-hub.ts`

Eventos do sistema disparam push automáticos via regras configuráveis:

```typescript
EventHub.emit("booking.created", {
  bookingId: "abc",
  clientName: "João",
  providerId: "xyz",
  serviceName: "Limpeza",
  scheduledAt: "2026-08-01T14:00",
})
```

**Eventos suportados:**

| Evento | Template padrão | Destinatário |
|--------|----------------|--------------|
| `booking.created` | "{{clientName}} agendou {{serviceName}}" | Provider |
| `booking.confirmed` | "Agendamento confirmado!" | Cliente |
| `booking.cancelled` | "Agendamento cancelado" | Provider/Cliente |
| `booking.completed` | "Serviço concluído! Avalie" | Cliente |
| `review.created` | "{{clientName}} avaliou: ★★★★★" | Provider |
| `quote.received` | "{{clientName}} solicitou orçamento" | Provider |
| `quote.responded` | "{{providerName}} respondeu" | Cliente |
| `payment.confirmed` | "Pagamento confirmado!" | Provider |
| `message.sent` | "Nova mensagem de {{senderName}}" | Destinatário |
| `provider.registered` | "Novo prestador: {{providerName}}" | Admin |

**Modelo:** `EventWebhook` — regras configuráveis no admin panel

**Template variables:** `{{clientName}}`, `{{providerName}}`, `{{serviceName}}`, `{{bookingId}}`, `{{scheduledAt}}`, `{{amount}}`, `{{rating}}`

### 9. Métricas e Analytics

**Modelo:** `PushAnalytics`

| Métrica | Descrição |
|---------|-----------|
| Sent | Notificação enviada ao push service |
| Delivered | Recebida pelo dispositivo |
| Clicked | Usuário clicou na notificação |
| Bounced | Subscription expirada (410/404) |
| Failed | Erro após todas as tentativas |

**Dashboard Admin:** `/admin?view=admin.push`

### 10. Audit Trail

**Modelo:** `PushSendLog` — registro de auditoria para cada operação de envio

| action | Descrição |
|--------|-----------|
| `manual_send` | Envio manual pelo admin |
| `manual_schedule` | Agendamento criado pelo admin |
| `scheduled_send` | Disparo automático agendado |
| `recurring_send` | Disparo recorrente |

## Configuração

### Variáveis de Ambiente

```env
# Web Push VAPID keys (gerar com: npx web-push generate-vapid-keys)
VAPID_PUBLIC_KEY=BPk...
VAPID_PRIVATE_KEY=Yb4...
VAPID_SUBJECT=mailto:admin@severinno.com.br
NEXT_PUBLIC_VAPID_PUBLIC_KEY=BPk...  # (mesmo valor, para o service worker)

# CRON
CRON_SECRET=seu-cron-secret-aqui
```

### Service Worker

O service worker é servido em `/sw.js` e registrado no `layout.tsx`:

```typescript
// src/lib/push-sw.ts — lógica central do service worker
// Eventos:
//   push → Recebe push, busca payload se for signal, exibe notificação
//   notificationclick → Redireciona para URL da notificação
//   notification.action → Executa ação (accept/reject)
```

## Fallbacks

| Cenário | Comportamento |
|---------|---------------|
| Valkey indisponível | Payload store → memória. Rate limit → in-memory token bucket |
| RabbitMQ indisponível | Envio direto sem fila (directPushCount no log) |
| Push service retorna 410 | Subscription removida automaticamente |
| Push service retorna 5xx | Retry com backoff (max 3 tentativas) |
| Usuário sem subscriptions | Silenciosamente ignorado (sem erro) |
| Payload > 4KB | Signal-only pattern com store server-side |

## Testes

```bash
# Tests unitários do push system
npx vitest run src/lib/__tests__/push.test.ts
npx vitest run src/lib/__tests__/push-store.test.ts
npx vitest run src/lib/__tests__/event-hub.test.ts

# Dashboard admin
# Acesse /admin?view=admin.push
```
