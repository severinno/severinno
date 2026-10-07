# Security Guide — Severinno Marketplace

> Medidas de segurança implementadas para proteger uma plataforma que lida com
> **valores monetários**, dados pessoais e geolocalização de usuários.
> Última atualização: 2026-08-01 | Versão: v0.4.0

## Sumário

1. [Transport Security](#1-transport-security)
2. [Content Security Policy](#2-content-security-policy-csp)
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
14. [Retenção LGPD de Identidade (cron de segurança)](#14-retenção-lgpd-de-identidade-cron-de-segurança)

---

## 1. Transport Security

### HSTS (HTTP Strict Transport Security)

```http
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
```

- **Duração:** 1 ano (31536000s)
- **Subdomínios:** Incluídos (inclui `glitchtip.severinno.com.br`)
- **Preload:** Elegível para pré-carga em navegadores

**Aplicado em:** Caddyfile.prod + proxy.ts (Edge Runtime)

### TLS

- Certificados automáticos via Let's Encrypt / ZeroSSL (Caddy)
- OCSP Stapling ativado
- TLS 1.2+ (configuração padrão do Caddy)

---

## 2. Content Security Policy (CSP)

CSP **estrita com nonce por-request** gerado no middleware Edge
(`proxy.ts` → `src/lib/csp.ts`), propagado ao App Router do Next.js via
header `x-nonce`:

```http
Content-Security-Policy:
  default-src 'self';
  script-src 'self' 'nonce-<por-request>' 'strict-dynamic' https://va.vercel-scripts.com https://vercel-insights.com;
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
  report-uri /api/csp-report;
```

`script-src` **sem `unsafe-inline`/`unsafe-eval` e sem unpkg** (o bloco
antigo desta seção documentava a política legada). Na presença de nonce +
`strict-dynamic`, browsers modernos ignoram `'unsafe-inline'` de style-src
para scripts. Em dev, `'unsafe-eval'` permanece (HMR do Next).

**Modo de rollout (produção):** o header enviado é
`Content-Security-Policy-Report-Only` enquanto `CSP_REPORT_ONLY=1` (default
no compose de produção). Enforce: `CSP_ENFORCE=1` (kill-switch reverso
incluído) e, para estável, `CSP_REPORT_ONLY=0`. Plano completo, critério de
avanço e monitoramento: **RUNBOOK.md § 6**. Violações: `POST /api/csp-report`
(coleta) e `GET /api/csp-report` (painel ADMIN).

**Aplicado em:** `proxy.ts` (defense-in-depth, todas as respostas) + Caddy
quando aplicável

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

### Websocket (realtime) — ticket de handshake single-use

O mini-service de realtime autentica o handshake por **ticket single-use** —
fecha a lacuna do join auto-declarado (qualquer socket podia entrar em
`user:{id}` de terceiros):

1. Cliente com sessão válida chama `POST /api/realtime/ticket`; a identidade
   (`userId`/`role`) vem SEMPRE da sessão (cookie HMAC + `sessionVersion` no
   banco) — o corpo do request é ignorado;
2. O app grava `{userId, role}` no Redis compartilhado sob
   `auth:socket-ticket:<64 hex>` com **TTL de 60s**;
3. O handshake do Socket.io envia o ticket em `auth.ticket` (opção `auth` do
   cliente — roda a cada (re)conexão, renovando o ticket); o mini-service
   consome com **GETDEL** (atômico: replay não funciona) e estampa
   `socket.data.userId/role`;
4. `join` passa a usar a identidade estampada — o payload do cliente é
   **ignorado**; `message:send` força `fromId` = identidade; `booking:update`
   e `quote:update` exigem que o remetente seja parte do booking/cotação;
5. **Produção é fail-closed**: handshake sem ticket válido é rejeitado. Em
   dev o socket conecta não autenticado (fallback para scripts e2e locais),
   mas não recebe salas nem retransmite nada.

### Edge Runtime Verification

O proxy.ts replica a verificação HMAC usando Web Crypto API (constant-time):

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

### Rate Limit Progressivo por Fingerprint de Sessão (auth)

Camada adicional em TODAS as rotas de autenticação (login, 2fa/verify,
register, forgot-password, reset-password) via
`src/lib/auth-rate-limit.ts`, ALÉM do limite fixo por IP da tabela acima:

- **Identidade:** fingerprint composto IP + hash(user-agent/accept) —
  `getCompositeFingerprint` (a mesma dos limiters global/rota), com escopo
  por fluxo (`login:`, `register:`, …) — contadores independentes;
- **Escada progressiva** (janela de 10 min): 3 tentativas sem atraso
  (digitação errada, 2FA), depois **0.5s → 1s → 2s → 4s → teto 8s**
  (dobra a cada tentativa);
- **Limite duro:** acima de 12 tentativas na janela → 429 com `Retry-After`;
- **Só falha satura:** `recordFailure()` é chamado apenas em credencial/
  código inválido — login bem-sucedido não conta;
- **Decaimento automático:** cada tentativa apodrece 10 min após feita
  (sem reset manual);
- **Por que delay e não lockout:** o fingerprint é fraco (IP/UA forjáveis);
  um lockout por fingerprint permitiria DoS da vítima atrás de NAT
  compartilhado. O delay encarece sem negar serviço; o lockout por e-mail
  (5 falhas → 15 min) continua sendo a barreira por identidade atacada.
  Juntas, as camadas fecham a rotação de IP: quem troca de IP para fugir do
  limite por IP ainda bate no lockout da conta; quem martela uma origem só
  espera cada vez mais.
- **Armazenamento:** mesma camada de cache do lockout por e-mail
  (`@/lib/redis`) — degrada junto, sem dependência nova.

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

### Uploads — magic bytes e SVG bloqueado

A rota `POST /api/upload` valida em **3 camadas** (ver `src/lib/file-signature.ts`):

1. MIME declarado na allowlist (string controlada pelo cliente — só o primeiro filtro);
2. extensão compatível com o MIME (anti MIME-spoofing);
3. **magic bytes** do conteúdo real — a defesa definitiva.

**SVG removido da allowlist (09/2026).** SVG é XML ativo: aceita `<script>`,
`onload=`, `<foreignObject>` e event handlers que executam no contexto da
origem que o serve. Como o bucket é público e servido na mesma origem do app
(via Caddy), um SVG uploadado é **XSS armazenado**. Renomear `.svg` → `.jpg`
não contorna: a assinatura textual é detectada e o arquivo é rejeitado com 415.

**Remediação de legado** — arquivos enviados ANTES do bloqueio continuam no
bucket e são reprocessados com `scripts/reprocess-svg-uploads.ts`:

```bash
bun scripts/reprocess-svg-uploads.ts              # dry-run (relatório, nada altera)
bun scripts/reprocess-svg-uploads.ts --apply      # converte SVG → PNG
bun scripts/reprocess-svg-uploads.ts --apply --delete   # só remove os SVGs
```

- Detecção **pelo conteúdo** (não pela extensão) — pega SVGs renomeados;
- conversão via sharp (raster 1024px) com o original preservado em
  `quarantine/svg-legacy/<chave>` antes de qualquer remoção;
- idempotente: pode ser re-executado; objetos grandes (>15 MB) são pulados;
- executar uma vez no rollout e, se necessário, como tarefa recorrente até
  `svgFound: 0` no resumo final.

---

## 8. CORS Policy

**Aplicado em:** `proxy.ts`

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

---

## 14. Retenção LGPD de Identidade (cron de segurança)

> A política completa (os 3 atos da retenção de biometria) vive no código:
> `src/lib/identity-retention.ts`. Esta seção documenta a OPERAÇÃO do ato 2
> (pendência expirada) e o seu gatilho automatizado — a parte que não pode
> depender de alguém lembrar de executá-la.

### 14.1 O que o cron faz

Todo dia às **03:15** (depois do settlements 03:00; entrada em
`scripts/setup-cron-push.sh`), o endpoint `GET /api/cron/identity-purge`
executa `purgeStalePendingIdentities(30)` sobre os usuários com
`identityStatus = "pending"` há mais de 30 dias:

1. as URLs de biometria são nuladas no banco PRIMEIRO (o app para de expor
   mesmo se o bucket falhar);
2. documento e selfie saem do MinIO (best-effort por objeto);
3. o status vira `rejected` com motivo gravado no Redis (30d de TTL) —
   reenviar a verificação é um clique, não um caso de suporte.

A operação é **idempotente**: rodada repetida devolve `purged: 0` e não
muda nada. O estado saudável do cron diário é `purged` baixo ou zero.

### 14.2 Os dois gatilhos do ato 2

| Gatilho        | Rota                             | Autenticação                     | Quando               |
| -------------- | -------------------------------- | -------------------------------- | -------------------- |
| Manual (admin) | `POST /api/admin/identity/purge` | Sessão + `requireRole("ADMIN")`  | Sob demanda          |
| Diário (cron)  | `GET /api/cron/identity-purge`   | `CRON_SECRET` Bearer fail-closed | 03:15, todos os dias |

O cron existe porque compliance que depende de operador de plantão não
roda no dia em que o plantão esquece: a janela de retenção só é garantida
quando o gatilho é automático e a rota manual fica para a exceção
(ex.: purgar antes do prazo após pedido do titular).

### 14.3 Fail-closed e operação

A autenticação é a mesma família dos demais crons: Bearer contra
`CRON_SECRET`, **sem query param** (não vaza em log de access). Sem
`CRON_SECRET` configurado no ambiente, nenhum Bearer passa — o endpoint
não "consegue rodar de qualquer jeito".

```bash
# Execução manual (VPS, credenciais locais):
curl -s -H "Authorization: Bearer $CRON_SECRET" \
  https://severinno.com.br/api/cron/identity-purge | jq
# Log do cron do host: ~/cron-logs/identity-purge.log (código HTTP por linha)
```

Leitura do log:

- `200` com `purged: 0` — saudável (não havia pendências expiradas);
- `401` no log do host — `CRON_SECRET` divergente entre host e app
  (ver § 10 Docker Secrets) ou entrada do cron sem o header;
- `5xx` — falha de banco/S3 na varredura; investigar antes de re-run
  (a função é idempotente e best-effort POR usuário: uma falha pontual
  não corrompe o lote nem duplica remoção).

A execução registra `logger.info` estruturado (`purged`, por usuário em
`identity-retention.ts`) — segue para o Loki como o resto do audit trail
(§ 12). Os logs do próprio container nunca recebem o conteúdo da
biometria: só contagens e `userId`.
