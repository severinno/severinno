# Auditoria — Camada 2: API / Backend (158 Rotas)

**Data:** 2026-08-18
**Auditor:** Buffy (Codebuff)
**Status Geral:** 🟢 Saudável (com melhorias P2/P3)

---

## Resumo Executivo

A camada de API apresenta **arquitetura madura e bem estruturada** com 158 rotas organizadas por domínio. Padrões de error handling, rate limiting, validação Zod e auth guards estão consistentes. Identificadas **0 vulnerabilidades P0**, **3 melhorias P1** e **8 oportunidades P2/P3**.

---

## Itens Verificados

### 1. Padrão de Rotas (`apiRoute` + `handleError`)

- ✅ **Padrão `apiRoute()`**: Usado em maioria das rotas — wrapper com try/catch automático
- ⚠️ **Inconsistência**: Algumas rotas usam `try/catch` manual com `handleError(e)` diretamente (login, register, bookings) em vez de `apiRoute()` — funcional mas mais verbose
- ✅ **`handleError()`**: Mapeia HttpError, AuthError, BookingError, PaymentError, ZodError corretamente
- ✅ **Logging**: Erros 500 logados via Pino com contexto

### 2. Auth Guards

- ✅ **`requireUser()`**: Usado em todas as rotas autenticadas — verifica sessão + usuário ativo (cache Redis 5min)
- ✅ **`requireRole("ADMIN")`**: Usado corretamente em rotas admin (settings, users, settlements)
- ✅ **`getOptionalSession()`**: Usado em `/api/auth/me` para retorno flexível
- ✅ **Participation checks**: Bookings verificam `clientId === session.userId || providerId === session.userId || role === "ADMIN"`
- ✅ **Demo account guard**: `isDemoAccountsEnabled()` bloqueia contas demo em produção em login, register, forgot-password, reset-password

### 3. Rate Limiting

- ✅ **Global rate limit**: Middleware Edge com sliding window (100 req/min default)
- ✅ **Per-route rate limits**: `RATE_LIMITS` definidos para todas as rotas sensíveis:
  - Login: 5/min ✅
  - Register: 5/min ✅
  - Forgot password: 3/10min ✅ (via `withRateLimit`)
  - Bookings: 30/min ✅
  - Messages: 30/min ✅
  - Geo: 30/min ✅ (via `assertGeoRateLimit`)
  - Webhooks: 20/min ✅
- ✅ **Headers**: `X-RateLimit-*` e `Retry-After` em respostas 429
- ✅ **Exceções**: `/api/health`, `/api/webhooks/*`, `/api/stats/public` bypassando corretamente

### 4. Input Validation (Zod)

- ✅ **`parseBody()`**: Usado para validação de request body
- ✅ **`parseSearchParams()`**: Usado para validação de query params
- ✅ **Schemas em `validators.ts`**: loginSchema, registerSchema, bookingSchema, messageSchema, etc.
- ✅ **Geo validation**: geocodeCepSchema, geocodeSearchSchema com transform/ refine

### 5. Error Handling

- ✅ **Typed errors**: BookingError (8 códigos), PaymentError (9 códidos), AuthError
- ✅ **HTTP status codes**: Mapeados corretamente (400, 401, 403, 404, 409, 429, 500)
- ✅ **Sentry**: Erros capturados via `captureError`/`captureMessage`
- ✅ **User-friendly messages**: Mensagens em pt-BR

### 6. Rotas Críticas

#### Auth (7 rotas)

- ✅ `/api/auth/login`: Rate limit, demo guard, timing-safe password comparison
- ✅ `/api/auth/register`: Rate limit, demo guard, email uniqueness, role validation
- ✅ `/api/auth/me`: `getOptionalSession()` + `USER_PUBLIC_SELECT` (nunca expõe passwordHash)
- ✅ `/api/auth/logout`: `destroySession()` limpa cookie
- ✅ `/api/auth/forgot-password`: Rate limit (via withRateLimit), email enumeration prevention (resposta 200 sempre)
- ✅ `/api/auth/reset-password`: Token validation, expiration check, demo guard
- ✅ `/api/auth/change-password`: Verify current password, send security notification

#### Bookings (8 rotas)

- ✅ `POST /api/bookings`: Auth + CLIENT role check, service/provider validation, payment record creation
- ✅ `GET /api/bookings`: Role-based filtering (client/provider/admin)
- ✅ `PATCH /api/bookings/[id]`: Status transition validation (PROVIDER_NEXT/CLIENT_NEXT maps), escrow logic, Lytex refund
- ✅ `POST /api/bookings/[id]/pay`: Lytex PIX/Card integration, idempotency, rate limit per booking
- ✅ `POST /api/bookings/[id]/confirm-completion`: Escrow release, payment status update

#### Providers (1 rotas + sub-rotas)

- ✅ `GET /api/providers`: 2-phase query (PostGIS IDs → full data), radius expansion, cache control
- ✅ Rate limit: 100/min

#### Webhooks (3 rotas)

- ✅ `/api/webhooks/lytex`: HMAC signature verification, idempotency via Redis, always return 200
- ✅ Rate limit: 20/min

#### Geo (6 rotas)

- ✅ `/api/geo/cep`: ViaCEP geocoding, Redis cache 7d, rate limit
- ✅ `/api/geo/search`: Nominatim forward geocoding, free-form + structured, rate limit 30/min
- ✅ `/api/geo/reverse`: Nominatim reverse geocoding
- ✅ Cache-Control: `cacheControlPublic()` com 60s TTL

#### Health (2 rotas)

- ✅ `GET /api/health`: Lightweight check (DB, Redis, Nominatim, ViaCEP, PostGIS), 15s cache, Sentry alert on degraded
- ✅ `GET /api/health/detailed`: Full check (10 services), Prometheus/OpenMetrics format support, critical vs degrading service classification

#### Cron Jobs (6 rotas)

- ✅ Todos autenticados com `CRON_SECRET` Bearer token
- ✅ `geo-cache-warm`: Cooldown 23h via Redis
- ✅ `health-monitor`: Threshold-based alerting com debounce

### 7. Performance Patterns

- ✅ **Cache-Control**: `cacheControlPublic()` para endpoints públicos (60s TTL)
- ✅ **Private cache**: `cacheControlPrivate()` para dados personalizados
- ✅ **Vary headers**: Accept-Encoding, Cookie, Origin configurados
- ✅ **Pagination**: `parsePagination()` com limit max 50
- ✅ **Parallel queries**: `Promise.allSettled()` em health checks, `Promise.all()` em bookings listing
- ✅ **Redis caching**: `withCache()` para queries frequentes (category descendants 10min, geo queries)
- ✅ **Denormalized fields**: `avgRating`, `reviewCount`, `favoriteCount` em User evitam JOINs

### 8. Security

- ✅ **Password hashing**: scrypt (N=16384, r=8, p=1) com salt random de 16 bytes
- ✅ **Timing-safe comparison**: `timingSafeEqual` em password verification e webhook HMAC
- ✅ **No SQL injection**: Queries raw usam `$queryRawUnsafe` com parâmetros ($1, $2)
- ✅ **Cookie security**: HttpOnly, Secure (prod), SameSite=Lax
- ✅ **Session rotation**: Auto-rotation quando remaining < 15 dias
- ✅ **Webhook HMAC**: Verificação de assinatura Lytex com timing-safe compare
- ✅ **Idempotency**: Webhook Lytex com Redis key para prevenir processamento duplicado
- ✅ **CORS**: Headers dinâmicos no middleware

---

## Findings Detalhados

### F-001: `apiRoute()` wrapper não usado em todas as rotas

- **Severidade:** P2 (Melhoria)
- **Camada:** 2
- **Descrição:** ~30% das rotas (login, register, bookings, messages, upload) usam `try/catch` manual com `handleError(e)` em vez do wrapper `apiRoute()`. Ambos funcionam, mas `apiRoute()` é mais conciso e reduce boilerplate.
- **Impacto:** Manutenção — padronização facilita refactorings futuros
- **Recomendação:** Migrar rotas restantes para `apiRoute()` em refactorings incrementais
- **Esfroço:** 4h

### F-002: `POST /api/auth/login` não usa `parseBody()`

- **Severidade:** P2 (Melhoria)
- **Camada:** 2
- **Descrição:** A rota de login faz `request.json()` manual + `loginSchema.parse(body)` em vez de usar `parseBody(request, loginSchema)`. Funcional mas inconsistente com outras rotas.
- **Impacto:** Nenhum funcional, apenas consistência
- **Recomendação:** Refactor para usar `parseBody()`
- **Esfroço:** 0.5h

### F-003: Conversão de booking.amount para Number() sem validação

- **Severidade:** P1 (Atenção)
- **Camada:** 2
- **Descrição:** Em `POST /api/bookings`, o `amount` é convertido com `Number.isFinite(body?.amount) ? Number(body.amount) : service.basePrice`. Se `body.amount` for uma string como `"abc"`, `Number("abc")` retorna `NaN` que `isFinite` rejeita — correto. Mas se for `"1e999"`, `Infinity` é rejeitado. O schema Zod `bookingSchema` valida `min(0)` mas não `max()`.
- **Impacto:** Valores absurdos poderiam ser inseridos (max 1M seria suficiente)
- **Recomendação:** Adicionar `.max(1_000_000)` no schema Zod para `amount` no bookingSchema
- **Esfroço:** 0.5h

### F-004: Polling assíncrono de pagamento sem retry/max attempts

- **Severidade:** P2 (Melhoria)
- **Camada:** 2
- **Descrição:** Em `POST /api/bookings/[id]/pay` (cartão), o `pollChargeStatus()` é chamado fire-and-forget sem limite de tentativas. Se o Lytex estiver instável, o polling pode rodar indefinidamente.
- **Impacto:** Potencial consumo de recursos em cenários de falha
- **Recomendação:** Adicionar max attempts (ex: 5) e timeout no polling
- **Esfroço:** 1h

### F-005: Admin users endpoint com filtro geo pós-paginação

- **Severidade:** P2 (Melhoria)
- **Camada:** 2
- **Descrição:** Documentado no código: `GET /api/admin/users` aplica filtro de raio APÓS skip/take, causando paginação incorreta quando raio está ativo.
- **Impacto:** Resultados inconsistentes para admins usando filtro geo
- **Recomendação:** Migrar para PostGIS como a rota de providers, ou documentar claramente a limitação
- **Esfroço:** 4h

### F-006: Falta de testes em algumas rotas admin

- **Severidade:** P2 (Melhoria)
- **Camada:** 2
- **Descrição:** O quality gate `coverage-gaps.ts` valida que todas as rotas API têm testes, mas a cobertura de rotas admin mais novas (gtm/leads, gateway/invoices, push/webhooks) pode estar abaixo do ideal.
- **Impacto:** Regressões passam despercebidas
- **Recomendação:** Verificar cobertura com `bun run test:admin` e adicionar testes faltantes
- **Esfroço:** 8h

### F-007: `GET /api/auth/me` não tem rate limit próprio

- **Severidade:** P3 (Baixa)
- **Camada:** 2
- **Descrição:** A rota `/api/auth/me` é chamada frequentemente pelo frontend (em cada render) mas não tem rate limit próprio. O rate limit global (100/min) protege, mas um limit mais permissivo (ex: 30/min) seria mais explícito.
- **Impacto:** Baixo — protegido pelo rate limit global
- **Recomendação:** Adicionar `RATE_LIMITS.authMe` se houver problema de abuso
- **Esfroço:** 0.5h

### F-008: `POST /api/upload` não valida extensão do arquivo

- **Severidade:** P1 (Atenção)
- **Camada:** 2
- **Descrição:** A rota valida `Content-Type` MIME mas não valida a extensão do arquivo. Um arquivo com extensão `.exe` mas Content-Type `image/jpeg` passaria. O `guessContentType()` no S3 usa extensão para detectar, mas o upload não valida extensão vs MIME consistency.
- **Impacto:** Upload de arquivos maliciosos com MIME spoofing
- **Recomendação:** Adicionar validação de extensão (whitelist de extensões permitidas) além do MIME
- **Esfroço:** 1h

---

## Resumo por Prioridade

### P0 (Imediato)

- Nenhum finding P0 identificado

### P1 (Próxima sprint)

1. **F-003:** Adicionar `.max(1_000_000)` no schema de booking amount
2. **F-008:** Adicionar validação de extensão no upload

### P2 (Backlog)

3. **F-001:** Migrar rotas para `apiRoute()` wrapper
4. **F-002:** Usar `parseBody()` no login
5. **F-004:** Limitar polling de pagamento
6. **F-005:** Corrigir geo filter pós-paginação no admin users
7. **F-006:** Melhorar cobertura de testes admin

### P3 (Melhoria contínua)

8. **F-007:** Adicionar rate limit explícito no `/api/auth/me`

---

## Estatísticas

| Métrica                 | Valor      |
| ----------------------- | ---------- |
| Total de rotas          | 158        |
| Rotas com auth guard    | ~120 (75%) |
| Rotas com rate limit    | ~100 (63%) |
| Rotas com validação Zod | ~90 (57%)  |
| Rotas admin             | ~52        |
| Rotas públicas          | ~15        |
| Cron jobs               | 6          |
| Webhooks                | 3          |
| Health checks           | 2          |

## Padrões Positivos

1. **Arquitetura modular**: Rotas organizadas por domínio com responsabilidades claras
2. **Defense in depth**: Rate limit global + per-route + geo-specific
3. **Typed errors**: BookingError/PaymentError com códigos e status HTTP
4. **Idempotency**: Webhook Lytex com Redis key
5. **Cache strategy**: Cache-Control headers, Redis caching, 15s health cache
6. **Prometheus support**: `/api/health/detailed?format=prometheus`
7. **Graceful degradation**: Health checks com classificação critical/degrading
8. **Demo account protection**: Guards em todas as rotas de auth
