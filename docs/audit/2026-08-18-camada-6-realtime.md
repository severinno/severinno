# Auditoria — Camada 6: Realtime (Socket.io)

**Data:** 2026-08-18
**Auditor:** Buffy (Codebuff)
**Status Geral:** 🟢 Saudável (Enterprise-grade with Redis adapter)

---

## Resumo Executivo

A camada de realtime é **bem projetada** com Socket.io v4, Redis pub/sub adapter para horizontal scaling, CORS restritivo, graceful shutdown, e HTTP bridge para server-side emit. Identificadas **0 vulnerabilidades P0**, **0 vulnerabilidades P1** e **3 melhorias P2/P3**.

---

## Itens Verificados

### 1. Mini-Service Architecture

- ✅ **Runtime**: Bun + Socket.io v4 + Engine.io
- ✅ **Porta**: 3003 (path "/")
- ✅ **Engine.io manual**: Criado sem auto-attach para compartilhar HTTP com `/health` e `/emit`
- ✅ **Redis adapter**: `@socket.io/redis-adapter` com pub/sub para horizontal scaling
- ✅ **Read-only filesystem**: Docker compose com read_only: true + tmpfs

### 2. CORS Security

- ✅ **Origins restritas**: 6 origins listados (localhost x2, severinno.com.br, www.severinno.com.br)
- ✅ **Wildcard subdomain**: `*.severinno.com.br` via regex
- ✅ **Callback pattern**: `cors.origin` usa callback (não síncrono)
- ✅ **Credentials**: `credentials: true`

### 3. Socket.io Events

- ✅ **join**: Rooms `user:{userId}` e `role:{role}` — ack com `{ok: boolean}`
- ✅ **message:send**: Emite `message:new` + `notification:new` para destinatário
- ✅ **booking:update**: Emite `booking:updated` para client + provider
- ✅ **quote:update**: Emite `quote:updated` para client + provider
- ✅ **tracking:position**: Emite `tracking:position` para client
- ✅ **ping**: Ack com `{pong: true, t: Date.now()}`
- ✅ **Input validation**: Todos os handlers validam payload antes de processar
- ✅ **Error handling**: Try/catch em cada handler com console.error

### 4. HTTP Endpoints

- ✅ **GET /health**: Retorna `{"status":"ok"}` — usado por Docker healthcheck
- ✅ **POST /emit**: Bridge server-side para eventos — body limit 1MB
- ✅ **Event routing**: booking:update, quote:update, message:send, notification:new, tracking:position
- ✅ **Unknown events**: Retorna 400 com erro descritivo

### 5. Graceful Shutdown

- ✅ **SIGTERM/SIGINT**: Handlers configurados
- ✅ **Disconnect sockets**: `io.disconnectSockets(true)` antes de fechar
- ✅ **Close order**: Sockets → io → httpServer → redis clients
- ✅ **Hard exit**: Timeout 5s como safety net
- ✅ **Idempotent**: `shuttingDown` flag previne duplo shutdown

### 6. Client Hook (`use-realtime.ts`)

- ✅ **Singleton**: Socket reutilizado via module-level `socketRef`
- ✅ **SSR guard**: `typeof window === "undefined"` retorna null
- ✅ **Auto-reconnect**: `reconnectionAttempts: Infinity`, delay 1s-5s
- ✅ **Transport**: WebSocket first, polling fallback
- ✅ **URL resolution**: `NEXT_PUBLIC_REALTIME_URL` ou Caddy gateway (`?XTransformPort=3003`)
- ✅ **Connection status**: connecting/connected/disconnected/reconnecting/error
- ✅ **Typed helpers**: join, sendMessage, updateBooking, updateQuote, sendTrackingPosition, ping
- ✅ **Generic emit/on/off**: Para eventos customizados
- ✅ **Cleanup**: `disconnect()` limpa socket e estado

### 7. Docker Configuration

- ✅ **Image**: Build from `mini-services/realtime/Dockerfile`
- ✅ **Healthcheck**: `bun -e fetch(...)` verificando `/health`
- ✅ **Read-only**: Filesystem somente leitura
- ✅ **Resource limits**: 0.5 CPU, 256MB
- ✅ **Depends_on**: Redis com `condition: service_healthy`
- ✅ **Graceful shutdown**: SIGTERM/SIGINT handlers

### 8. Caddy Integration

- ✅ **WebSocket proxy**: `handle_path /socket.io/*` com `flush_interval -1`
- ✅ **Header forwarding**: X-Real-IP, X-Forwarded-For, X-Forwarded-Proto
- ✅ **Caddy healthcheck**: `health_uri /api/health` no upstream

---

## Findings Detalhados

### F-001: `/emit` endpoint não tem autenticação

- **Severidade:** P2 (Melhoria)
- **Camada:** 6
- **Descrição:** O endpoint `POST /emit` aceita qualquer request sem autenticação. Em produção, está protegido pela rede interna Docker (não exposto externamente), mas qualquer service na rede backend pode enviar eventos arbitrários.
- **Impacto:** Baixo em produção (rede interna), mas poderia ser explorado em cenário de container comprometido
- **Recomendação:** Adicionar header `x-api-key` ou Bearer token para autenticação do `/emit`
- **Esfroço:** 1h

### F-002: IDs gerados são previsíveis (`Math.random`)

- **Severidade:** P2 (Melhoria)
- **Camada:** 6
- **Descrição:** `generateId()` usa `Math.random().toString(36).slice(2, 11)` — IDs previsíveis e colidíveis. Para message IDs e notification IDs, isso é aceitável (não são security-sensitive), mas IDs mais robustos seriam melhores.
- **Impacto:** Baixo — IDs são internos, não expostos como PKs
- **Recomendação:** Usar `crypto.randomUUID()` ou `crypto.getRandomValues()` para IDs mais robustos
- **Esfroço:** 0.5h

### F-003: Falta métricas de conexões ativas

- **Severidade:** P3 (Baixa)
- **Camada:** 6
- **Descrição:** O realtime service não expõe métricas de conexões ativas (ex: `io.engine.clientsCount`). O healthcheck apenas verifica se o server está rodando.
- **Impacto:** Sem visibilidade de carga em tempo real
- **Recomendação:** Adicionar `/metrics` endpoint com contagem de sockets ativos
- **Esfroço:** 1h

---

## Resumo por Prioridade

### P0 (Imediato)

- Nenhum finding P0 identificado

### P1 (Próxima sprint)

- Nenhum finding P1 identificado

### P2 (Backlog)

1. **F-001:** Adicionar autenticação no endpoint `/emit`
2. **F-002:** Usar IDs mais robustos (crypto.randomUUID)

### P3 (Melhoria contínua)

3. **F-003:** Métricas de conexões ativas

---

## Estatísticas

| Métrica           | Valor                                             |
| ----------------- | ------------------------------------------------- |
| Socket.io events  | 6 (join, message, booking, quote, tracking, ping) |
| HTTP endpoints    | 2 (health, emit)                                  |
| CORS origins      | 6 + wildcard subdomain                            |
| Redis adapter     | Sim (pub/sub para horizontal scaling)             |
| Client transports | WebSocket + polling                               |

## Padrões Positivos

1. **Redis adapter**: Horizontal scaling via pub/sub
2. **CORS restritivo**: Origins hardcoded + wildcard regex
3. **Graceful shutdown**: Disconnect sockets → close io → close http → disconnect redis
4. **SSR guard**: Socket singleton só cria no browser
5. **Auto-reconnect**: Infinity attempts com delay 1s-5s
6. **HTTP bridge**: Server-side emit via POST /emit
7. **Input validation**: Todos os handlers validam payload
8. **Engine.io manual**: Compartilha HTTP com /health e /emit
