# Security Headers Gate — Investigação (2026-08-09)

> Investigação do job `security-headers` do `pr-check.yml` (run 31308965954,
> branch `ci-proof/encode-gate`): falha com exit 1 no curl contra a URL de
> produção. Veredito: **não é flake, não é URL indisponível e não é regressão
> de header no app** — é um **mismatch de DNS/hosting** (o domínio aponta para
> um placeholder WordPress na Hostinger, não para o VPS onde o app + Caddy
> rodam).

## 1. Sintoma

- Run **31308965954** → job **Security Headers: failure** (exit 1).
- Comando do job: `bash scripts/test-security-headers.sh --ci --url "${{ secrets.BASE_URL || 'https://severinno.com.br' }}"`
- Este é o **único** job de CI que faz curl numa URL externa de produção.
  Todos os demais (health-check, lighthouse, e2e-cache, docker-test) apontam
  para `http://localhost:3000` (containers efêmeros do próprio run).

## 2. Evidência

### 2.1 Log do CI (run 31308965954, job Security Headers)

```
[PASS] - Endpoint respondeu com HTTP 200
[FAIL] [X] Header Strict-Transport-Security esta presente
[FAIL] [X]   default-src 'self'
[FAIL] [X]   object-src 'none'
[FAIL] [X]   frame-ancestors 'none'
[FAIL] [X]   base-uri 'self'
[FAIL] [X]   form-action 'self'
[FAIL] [X]   worker-src 'self' blob:
[FAIL] [X]   manifest-src 'self'
[FAIL] [X]   report-to csp-endpoint
[FAIL] [X]   report-uri /api/csp-report (legado)
[FAIL] [X]   Header Reporting-Endpoints: csp-endpoint
[FAIL] [X] X-Content-Type-Options: nosniff
[FAIL] [X] X-Frame-Options: DENY
[FAIL] [X] Referrer-Policy: strict-origin-when-cross-origin
[FAIL] [X] Permissions-Policy: camera/mic/geolocation
[FAIL] [X] Header Server removido - presente: 'hcdn'
[FAIL] [X] Header X-Powered-By removido
```

### 2.2 Headers reais agora (curl -sI https://severinno.com.br)

```
HTTP/1.1 200 OK
Content-Type: text/html; charset=UTF-8
X-Powered-By: PHP/8.3.31
Link: <https://severinno.com.br/wp-json/>; rel="https://api.w.org/"
X-LiteSpeed-Cache: hit
platform: hostinger
panel: hpanel
Content-Security-Policy: upgrade-insecure-requests
Server: hcdn
```

Ou seja: o host responde **HTTP 200** (não é indisponibilidade) e serve um
**placeholder WordPress na Hostinger** (PHP 8.3.31, LiteSpeed, `wp-json`),
com apenas `upgrade-insecure-requests` como CSP — nada de HSTS, XFO, nosniff,
Referrer-Policy, Permissions-Policy; ainda vaza `Server: hcdn` e
`X-Powered-By: PHP/8.3.31`.

### 2.3 DNS

```
nslookup severinno.com.br
  Addresses: 2a02:4780:84:8a38:ae5:6259:544d:de2f   (IPv6)
             2a02:4780:84:acd4:57eb:f6d3:778d:ce6d   (IPv6)
             88.222.222.208                          (IPv4)
             84.32.84.4                              (IPv4)
```

Todos os IPs são da faixa da **Hostinger** — não do VPS onde o app e o Caddy
rodam. `www` redireciona (301) para `https://severinno.com.br/` (WordPress).

### 2.4 Reprodução local do gate (2026-08-09)

```
$ bash scripts/test-security-headers.sh --ci --url "https://severinno.com.br"
  Total de assercoes: 23
  [FAIL] Falharam:        19
GATE_EXIT=1
```

Falha **consistente e reprodutível** — 19/23 asserções, exit 1.

### 2.5 O que o repo declara (o alvo pretendido)

- `Caddyfile.prod` — bloco `severinno.com.br, www.severinno.com.br`:
  HSTS `max-age=31536000; includeSubDomains; preload`, `X-Content-Type-Options:
  nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`,
  CSP completa (default-src/object-src/frame-ancestors/base-uri/form-action/
  worker-src/manifest-src/report-to/report-uri) + `Reporting-Endpoints`,
  remoção de `Server`/`X-Powered-By`.
- `src/middleware.ts` — segunda camada (HSTS, X-Frame-Options, etc.).
- O próprio header do `Caddyfile.prod` diz: *"Basta apontar o DNS do domínio
  para o IP do servidor"* — esse passo **não foi feito** (ou foi revertido).
- `docs/HSTS-PRELOAD.md` (§3) afirma que o header está configurado "em 3
  camadas" — verdadeiro **nos configs do repo**, mas o domínio live não serve
  nada disso.

## 3. Causa raiz

O domínio `severinno.com.br` está com DNS apontado para a **Hostinger**, onde
um **site WordPress antigo/placeholder** responde. O app Severinno (Next.js)
e o Caddy (que aplicaria os headers de segurança) rodam no **VPS** — que o DNS
**não expõe**. O gate `security-headers` é o único que verifica a URL pública,
então ele testa o host errado: um WordPress sem os headers.

## 4. Classificação do veredito

| Hipótese | Veredito | Evidência |
|---|---|---|
| Flake de ambiente | ❌ Não | Falha consistente (run de CI + reprodução local), HTTP 200 sempre |
| URL indisponível | ❌ Não | `curl -sI` → 200 OK (WordPress placeholder) |
| Regressão real de header no app | ❌ Não | `Caddyfile.prod` + `middleware.ts` declaram os headers corretamente |
| **Mismatch DNS/hosting (alvo do gate errado)** | ✅ **Sim** | DNS → Hostinger; live responde WordPress/PHP; headers ausentes |

## 5. O gate mascara uma regressão real? — Não

- O gate está **vermelho de forma alta e consistente** — não está escondendo
  nada: o domínio público realmente não serve os headers hoje.
- O risco de mascaramento é o **inverso**: se alguém "consertar" o gate
  afrouxando as asserções (ou apontando-o para um host que responda 200 sem
  headers), uma regressão real dos headers do app poderia passar
  despercebida. **Não afrouxar o script.**
- Uma vez que o DNS for corrigido, o gate deve **passar** contra o app real
  (o `Caddyfile.prod` declara todos os headers exigidos) — e aí ele passa a
  proteger de verdade a superfície pública.

## 6. Ações recomendadas (em ordem)

1. **Corrigir o DNS** de `severinno.com.br` (A/AAAA) e `www` para o IP do VPS
   onde rodam o app + Caddy — isso completa também o objetivo do
   `docs/HSTS-PRELOAD.md` (o domínio precisa servir HSTS para a submissão).
2. **Re-rodar o gate** após a propagação: `bash scripts/test-security-headers.sh --ci --url "https://severinno.com.br"`
   — esperado: 23/23 passando (exit 0).
3. **Interino (opcional, enquanto o DNS não é corrigido):** validar as
   asserções contra o app efêmero do CI (`http://localhost:3000` via
   docker-test), espelhando os demais jobs — para o contrato de headers ser
   verificado por PR sem depender de DNS externo. **Manter** o check da URL
   pública depois que o DNS estiver certo (é o único end-to-end).
4. Reavaliar se `secrets.BASE_URL` deve ser definido no repo/organização
   quando houver URL pública estável.

## 7. Comandos de verificação (reuso)

```bash
# Headers atuais do domínio público
curl -sI --max-time 20 https://severinno.com.br | head -25

# DNS atual
nslookup severinno.com.br

# Gate completo contra a URL pública (reprodução da falha)
bash scripts/test-security-headers.sh --ci --url "https://severinno.com.br"

# Gate contra o app local (esperado verde após DNS/ou interino)
bash scripts/test-security-headers.sh --url "http://localhost:3000"
```
