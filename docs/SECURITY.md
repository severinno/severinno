# Security Guide — Severinno Marketplace

> Medidas de segurança implementadas para proteger uma plataforma que lida com
> **valores monetários**, dados pessoais e geolocalização de usuários.
> Última atualização: 2026-08-01 | Versão: v0.4.0

## Sumário

1. [Transport Security](#1-transport-security)
2. [Content Security Policy](#2-content-security-policy)
3. [Authentication & Sessions](#3-authentication--sessions)
4. [Password Storage](#4-password-storage)
5. [Rate Limiting](#5-rate-limiting)
6. [CSRF Protection](#6-csrf-protection)
7. [Input Validation](#7-input-validation)
8. [CORS Policy](#8-cors-policy)
9. [Docker Hardening](#9-docker-hardening)
10. [Docker Secrets](#10-docker-secrets)
11. [Webhook Security](#11-webhook-security)
12. [Audit Trail](#12-audit-trail)
13. [Seed Test Hooks (SEED_SPEC_PATCH)](#13-seed-test-hooks-seed_spec_patch)

---

## 1. Transport Security

### HSTS (HTTP Strict Transport Security)

```http
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
```

- **Duração:** 1 ano (31536000s)
- **Subdomínios:** Incluídos (inclui `glitchtip.severinno.com.br`)
- **Preload:** Elegível para pré-carga em navegadores

**Aplicado em:** Caddyfile.prod + middleware.ts (Edge Runtime)

### TLS

- Certificados automáticos via Let's Encrypt / ZeroSSL (Caddy)
- OCSP Stapling ativado
- TLS 1.2+ (configuração padrão do Caddy)

---

## 2. Content Security Policy (CSP)

```http
Content-Security-Policy:
  default-src 'self';
  script-src 'self' 'unsafe-inline' 'unsafe-eval' https://unpkg.com;
  style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://unpkg.com;
  img-src 'self' https://*.tile.openstreetmap.org data: blob: https://s3.severinno.com.br https://www.gravatar.com;
  font-src 'self' https://fonts.gstatic.com data:;
  connect-src 'self' https://*.tile.openstreetmap.org https://nominatim.openstreetmap.org ws: wss: https://api.glitchtip.com wss://severinno.com.br;
  frame-src 'self';
  frame-ancestors 'none';
  object-src 'none';
  base-uri 'self';
  form-action 'self';
  worker-src 'self' blob:;
  media-src 'self';
  manifest-src 'self';
```

**Aplicado em:** Caddyfile.prod (ver arquivo completo para diretivas atualizadas)

### Headers de Segurança Adicionais (Middleware + Caddy)

| Header                   | Valor                                          |    Onde    |
| ------------------------ | ---------------------------------------------- | :--------: |
| `X-Content-Type-Options` | `nosniff`                                      |   Ambos    |
| `X-Frame-Options`        | `DENY`                                         |   Ambos    |
| `X-XSS-Protection`       | `1; mode=block`                                |   Caddy    |
| `Referrer-Policy`        | `strict-origin-when-cross-origin`              |   Ambos    |
| `Permissions-Policy`     | `camera=(), microphone=(), geolocation=(self)` |   Ambos    |
| `X-DNS-Prefetch-Control` | `on`                                           | Middleware |

---

## 3. Authentication & Sessions

### Session Cookies

- **Formato:** `${userId}.${role}.${expiresAt}.${hmacSha256Hex}`
- **Duração:** 30 dias
- **Rotação:** Reemissão automática após 15 dias
- **HttpOnly:** true (inacessível via JavaScript)
- **SameSite:** Lax (protege contra CSRF)
- **Secure:** true em produção
- **Assinatura:** HMAC-SHA256 com `SESSION_SECRET`

### Edge Runtime Verification

O middleware.ts replica a verificação HMAC usando Web Crypto API (constant-time):

```typescript
// Constant-time compare para prevenir timing attacks
let mismatch = 0
for (let i = 0; i < expected.length; i++) {
  mismatch |= expected.charCodeAt(i) ^ signature.charCodeAt(i)
}
```

---

## 4. Password Storage

### Scrypt (NIST Recommended)

```typescript
import { scryptSync, randomBytes, timingSafeEqual } from "crypto"

// Hash: saltHex + ":" + hashHex
const SALT_LEN = 16
const KEY_LEN = 64
const SCRYPT_N = 16384 // 2^14 — custo computacional
const SCRYPT_R = 8 // block size
const SCRYPT_P = 1 // paralelismo
```

### Timing-Safe Verification

```typescript
return timingSafeEqual(computed, hash)
// NOTA: timingSafeEqual compara byte a byte em TEMPO CONSTANTE,
// independente de onde a diferença ocorre. Isso previne attackers
// de inferirem a senha baseado no tempo de resposta.
```

---

## 5. Rate Limiting

### Edge Runtime (Middleware)

- **Mecanismo:** Token bucket in-memory
- **Janela:** 60 segundos
- **Limite:** 60 requisições por IP
- **Headers:** `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`

### Redis + In-Memory (Rotas Específicas)

| Rota                | Limite |   Janela   | Propósito         |
| :------------------ | :----: | :--------: | :---------------- |
| Login               |   10   |   1 min    | Brute force       |
| Register            |   5    |   1 min    | Criação de conta  |
| Password Recovery   |   3    |   10 min   | Abuso de recovery |
| Providers           |  100   |   1 min    | Search API        |
| Bookings            |   30   |   1 min    | Agendamentos      |
| Messages            |   30   |   1 min    | Chat              |
| Reviews             |   10   |   1 min    | Avaliações        |
| **Payments**        | **10** | **1 min**  | **⬆ Pagamentos**  |
| **Wallet**          | **10** | **1 min**  | **⬆ Carteira**    |
| **Wallet Withdraw** | **3**  | **10 min** | **⬆⬆ Saques**     |
| **Settlements**     | **10** | **1 min**  | **⬆ Repasses**    |
| **Webhook Lytex**   | **20** | **1 min**  | **⬆ Webhooks**    |
| Admin Ops           |   30   |   1 min    | Operações admin   |

### Fallback

Se Redis estiver indisponível, o rate limiting fallback para um Map in-memory
com cleanup periódico a cada 60s.

---

## 6. CSRF Protection

### SameSite Cookie

O cookie de sessão usa `SameSite=Lax`, que bloqueia envio do cookie em:

- Requisições POST de formulários cross-site
- Requisições com `Content-Type` não seguro
- Requisições fetch de origens diferentes

### Defense-in-Depth

- CORS whitelist com origens restritas (`NEXT_PUBLIC_APP_URL`)
- Preflight OPTIONS retorna 204 sem processamento adicional
- Rate limiting em rotas mutantes

---

## 7. Input Validation

### Zod Schemas

Todos os inputs são validados via **Zod** antes de serem processados:

| Schema                 | Campos validados                                                        |
| ---------------------- | ----------------------------------------------------------------------- |
| `loginSchema`          | email (formato), password (min 6)                                       |
| `registerSchema`       | name, email, password + confirm, role, cpfCnpj, whatsapp                |
| `serviceSchema`        | title, description, categoryId, basePrice (0..1M), unit, photos (max 4) |
| `bookingSchema`        | providerId, serviceId, scheduledAt, address, cep, lat, lng, amount (>0) |
| `reviewSchema`         | bookingId, rating (1-5), comment (max 1000)                             |
| `messageSchema`        | toId, content (1-2000)                                                  |
| `categorySchema`       | name, slug (regex), parentId, level                                     |
| `quoteItemInputSchema` | serviceId, quantity (0.01..100000)                                      |

### Environment Validation

`src/lib/env.ts` valida todas as variáveis de ambiente na inicialização:

```typescript
const envSchema = z.object({
  SESSION_SECRET: z.string().min(32), // ← mínimo 32 chars
  DATABASE_URL: z.string().url(),
  // ... 50+ variáveis validadas
})
```

---

## 8. CORS Policy

**Aplicado em:** `src/middleware.ts`

```typescript
const ALLOWED_ORIGINS = process.env.NEXT_PUBLIC_APP_URL ? [process.env.NEXT_PUBLIC_APP_URL] : [] // Sem fallback — CORS bloqueado se não configurado
```

Headers para origens permitidas:

```
Access-Control-Allow-Origin: https://severinno.com.br
Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization
Access-Control-Allow-Credentials: true
Access-Control-Max-Age: 86400
```

---

## 9. Docker Hardening

Cada serviço no `docker-compose.prod.yml` segue o princípio de **privilégio mínimo**:

### Aplicado a TODOS os serviços

```yaml
security_opt:
  - no-new-privileges:true # Impede escalonamento de privilégios
cap_drop:
  - ALL # Remove TODAS as capacidades Linux
cap_add:
  - NET_BIND_SERVICE # Apenas bind em portas <1024
```

### Serviços com read_only

| Serviço       | read_only |         tmpfs         | Exceções                   |
| :------------ | :-------: | :-------------------: | :------------------------- |
| Caddy         |    ✅     |         /tmp          | /data + /config (volumes)  |
| Redis         |    ✅     |       /tmp:64M        | /data (volume)             |
| RabbitMQ      |    ✅     | /tmp + /var/log (RAM) | /var/lib/rabbitmq (volume) |
| Realtime      |    ✅     |       /tmp:64M        | —                          |
| PgBouncer     |    ❌     |       /tmp:16M        | userlist.txt (entrypoint)  |
| PostgreSQL    |    ❌     |       /tmp:256M       | WAL + dados (volume)       |
| MinIO         |    ❌     |       /tmp:128M       | /data (volume)             |
| App (Next.js) |    ❌     |       /tmp:256M       | .next cache                |

### Redes Isoladas

```
frontend — Caddy exposto (80/443)
backend  — Todos os serviços internos (SEM exposição externa)
          → Subnet: 172.20.1.0/24
```

---

## 10. Docker Secrets

Senhas e chaves sensíveis são montadas como arquivos em `/run/secrets/`:

```yaml
secrets:
  postgres_password:
    file: ./secrets/postgres_password.secret
  session_secret:
    file: ./secrets/session_secret.secret
  vapid_private_key:
    file: ./secrets/vapid_private_key.secret
  s3_secret_key:
    file: ./secrets/s3_secret_key.secret
  rabbitmq_pass:
    file: ./secrets/rabbitmq_pass.secret
  smtp_pass:
    file: ./secrets/smtp_pass.secret
  cron_secret:
    file: ./secrets/cron_secret.secret
  lytex_client_secret:
    file: ./secrets/lytex_client_secret.secret
```

Serviços como PostgreSQL, RabbitMQ e MinIO suportam `_FILE` nas env vars
(leem o segredo diretamente do arquivo). Demais serviços usam entrypoint
customizado (`scripts/docker-entrypoint.sh`) para exportar como env vars.

---

## 11. Webhook Security

### Lytex Pagamentos

Os webhooks da Lytex são validados com **HMAC-SHA256**:

```typescript
// Gera e verifica assinatura do payload (excluindo campo 'signature')
const expected = createHmac("sha256", LYTEX_CLIENT_SECRET)
  .update(JSON.stringify(payloadWithoutSignature))
  .digest("hex")

return timingSafeEqual(Buffer.from(payload.signature), Buffer.from(expected))
```

- Chave: `LYTEX_CLIENT_SECRET` (armazenado como Docker secret)
- Algoritmo: HMAC-SHA256
- Comparação: `timingSafeEqual` (tempo constante)

---

## 12. Audit Trail

| Atividade         | Modelo                | Campos                                                        |
| :---------------- | :-------------------- | :------------------------------------------------------------ |
| Push enviado      | `PushSendLog`         | adminId, action, title, recipientCount, sentCount, errorCount |
| Push analytics    | `PushAnalytics`       | userId, status, source, latencyMs, deviceCount                |
| Webhook executado | `WebhookExecutionLog` | webhookId, event, status, usersFound, usersSent, usersFailed  |
| Wallet transação  | `WalletTransaction`   | providerId, amount, status, description                       |
| Login             | Session cookie        | (log implícito via logger)                                    |

---

## 13. Seed Test Hooks (SEED_SPEC_PATCH)

Os seeds compartilham o spec canônico de categorias (`CATEGORY_SPEC` em
`prisma/seed-data.ts`). Para validar a convergência de **UPDATE/RENAME** nos
E2Es, os dois seeds aceitam um hook de teste via env var `SEED_SPEC_PATCH` que
**substitui temporariamente** o spec de categorias por uma versão patchada —
o upsert/convergência reage ao spec mutado exatamente como reagiria a uma
mudança real de código.

> ⚠️ **O PATCH SÓ APLICA FORA DE PRODUÇÃO.** O hook é INERTE quando o seed roda
> em produção — nunca altera a árvore canônica de um banco produtivo:
>
> | Seed                   | Gate do patch                                         | Em produção                                           |
> | :--------------------- | :---------------------------------------------------- | :---------------------------------------------------- |
> | `prisma/seed-prod.ts`  | `PROD_SEED_ALLOW_DEV=1` (banco efêmero/CI)            | `SPEC === CATEGORY_SPEC` sempre                       |
> | `prisma/seed.ts` (dev) | `isDemoAccountsEnabled()` (`NODE_ENV !== production`) | guard de contas demo recusa ANTES de qualquer escrita |
>
> Mesmo que a env exista no ambiente, sem o override o seed-prod usa o spec
> canônico; e em `NODE_ENV=production` o seed dev recusa antes de tocar o
> banco. Implementação compartilhada e pura: `buildPatchedSpec()` em
> `prisma/seed-data.ts`, validada por `assertValidCategorySpec()` (fail-fast
> antes de qualquer escrita — JSON inválido ou patch que quebre a árvore
> RECUSA o seed com erro claro).

### Formato do patch (JSON array)

| Campo      |  Tipo  | Obrigatório | Efeito                                                                                   |
| :--------- | :----: | :---------: | :--------------------------------------------------------------------------------------- |
| `name`     | string |     ✅      | Nome da categoria no `CATEGORY_SPEC` a ser patchada                                      |
| `icon`     | string |     ❌      | Troca o icon (update in-place, mesmo slug)                                               |
| `order`    | number |     ❌      | Troca a ordem de exibição (update in-place, mesmo slug)                                  |
| `renameTo` | string |     ❌      | Renomeia a categoria; filhos são reparentados em cascata (muda o slug → cria linha nova) |

### Exemplos de uso

**Update in-place (icon/order — mesmo slug, converge sem duplicar):**

```bash
SEED_SPEC_PATCH='[{"name":"Elétrica","icon":"bolt"},{"name":"Reparos","order":5}]' \
NODE_ENV=development PROD_SEED_ALLOW_DEV=1 bun prisma/seed-prod.ts
```

**Seed dev** (gate diferente — `NODE_ENV !== production`, sem override):

```bash
SEED_SPEC_PATCH='[{"name":"Elétrica","icon":"bolt"}]' NODE_ENV=development bun run db:seed
```

**Rename (muda o nome → muda o slug):**

```bash
SEED_SPEC_PATCH='[{"name":"Elétrica","renameTo":"Eletricidade"}]' \
NODE_ENV=development PROD_SEED_ALLOW_DEV=1 bun prisma/seed-prod.ts
```

> ⚠️ **Rename no seed-prod é PERIGOSO** (semântica não-destrutiva): o upsert
> CRIA a linha nova e DEIXA a antiga órfã (services continuam apontando para
> ela) — renomear exige migração manual de FKs, nunca re-run do seed. O dry-run
> (`--dry-run` / `DRY_RUN=1`) detecta e avisa com **⚠️ POSSÍVEL RENOMEAÇÃO**.
> No seed dev (wipe+recreate) o rename é seguro: o estado final tem o nome novo
> e o re-run canônico restaura.

### Quem usa

- `scripts/test-seed-prod-e2e.ts` — cenários 7 (update) e 8 (rename)
- `scripts/test-seed-dev-e2e.ts` — cenários 9 (update) e 10 (rename)
- `src/lib/__tests__/seed-data.test.ts` — 5 testes unitários de `buildPatchedSpec`
