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

## 8. Avaliação dos 3 levers (2026-08-10) — o tail de 9:08 era o curl SEM timeout

> Contexto (sec 11.20 do gates-proofs.md): o job Security Headers dominava o
> tail de TODA prova do ci-proof-run (9:08 no run 31430040398), falhando por
> causas pré-existentes (o mismatch DNS/hosting da seção 3). A pergunta: o job
> deveria ser **consertado** (headers reais do site), ganhar **timeout curto**,
> ou rodar **só em PR** (não em workflow_dispatch de prova)?

### 8.1 A medição que mudou o diagnóstico

- O site responde **rápido** (130–270ms, HTTP 200, 3 runs em 2026-08-10) — o
  tail NÃO era lentidão do host.
- O log do run 31430040398 mostra **`Endpoint respondeu com HTTP 000000`** —
  um **connect stall**: o curl do script estava SEM `--max-time`/`--connect-timeout`
  (o script não tinha nenhum bound; a linha 78 do fetch_headers e a 321 do
  TLS check eram `curl -s ...` puros). Um connect travado deixa o curl esperando
  minutos até o timeout do TCP stack — em toda trigger (PR, merge_group,
  workflow_dispatch de prova), o job queimava o tail inteiro.
- No run da Prova 20 (31442006152) o mesmo job falhou em **7s** — porque o DNS
  respondeu rápido e as asserções falharam de cara. As duas faces (9:08 stall,
  7s fast-fail) são o MESMO problema de fundo: host errado + curl sem bound.

### 8.2 Veredito por lever

| Lever | Veredito | Justificativa |
|---|---|---|
| **Consertar os headers reais do site** | ✅ **Necessário, mas EXTERNO** | O DNS aponta para a Hostinger (seção 3) — o repo não pode consertar isso. É o fix de infraestrutura documentado na seção 6; o gate vai continuar vermelho até lá, e isso é **correto** (o domínio público realmente não serve os headers). |
| **Timeout curto no script** | ✅ **ADOTADO** | O único lever 100% repo-side: `--max-time 20 --connect-timeout 10` nos 2 curls do `test-security-headers.sh` + 1 do `health-check.sh` (mesma classe). Bounds o custo do tail em TODA trigger — um stall agora falha em ~20s, não em 9min. |
| **Rodar só em PR** | ❌ **RECUSADO** | Com o timeout aplicado, o custo por trigger já é ≤ ~30s; restringir o trigger não reduz mais nada e **perde o valor da prova**: o workflow_dispatch é exatamente o que as Provas 7-20 usam para exercitar gates reais. Além disso, um filtro de trigger no pr-check.yml seria um ponto de drift (a matriz ci-proof branch do scan-surfaces). |

### 8.3 O lock estrutural (guard versionado)

O fix de timeout é um ajuste pontual — nada impediria um curl novo SEM bound de
voltar a um gate script e reintroduzir a classe de stall. O padrão da rede
(scan-timeouts, scan-push-full-suite, ...) exige o guard versionado:

- **`scripts/scan-curl-timeouts.mjs`** — falha com exit 1 se QUALQUER curl numa
  invocação lógica de gate script de CI (os `.sh` DERIVADOS dos workflows — a
  superfície viva, mesmo padrão SPREAD dos TARGET_DIRS) estiver sem `--max-time`.
  Mascara strings/comentários bash (prosa que cita curl não false-positiva),
  une continuações `\` (o `--max-time` do TLS check fica em linha de
  continuação), e deriva a superfície de `.github/workflows/*.yml` (um script
  novo citado por um workflow entra automaticamente — sem editar o guard).
  `--connect-timeout` é recomendado mas não exigido — o `--max-time` bounds o
  total, que é o que mata a classe.
- **`scripts/__tests__/scan-curl-timeouts.test.ts`** — BASELINE (a superfície
  real tem ZERO curls sem bound) + companion não-vazio + mutação CLI
  (exit 1 com `file:line` exato; com `--max-time` → exit 0) + edges de masking
  e continuação + edge de derivação (script não-citado fica fora por design).
- **Wiring**: step `Scan gate-script curls for explicit timeouts` no
  `guard-gates.yml` (push net) e no job `fragile-guard` do `pr-check.yml`
  (twin PR) — o MESMO comando, mirror do scan-timeouts.

> **Fronteira da superfície**: o guard cobre os curls dos **gate scripts .sh**
> (os derivados dos workflows) — a classe real do 9:08, que vivia no script.
> Curls **inline** num bloco `run:` de workflow ficam FORA da superfície por
> design (seria outra superfície: o texto YAML dos workflows, não o script
> que eles chamam). Se um dia um curl inline de rede externa entrar num job,
> ele precisa do mesmo `--max-time` — a decisão de escanear a superfície
> YAML é um guard irmão separado, não este.

### 8.4 Estado final do job

O job Security Headers segue rodando em toda trigger (PR, merge_group,
workflow_dispatch) e segue **vermelho enquanto o DNS não apontar para o VPS** —
mas agora falha em segundos, não em 9min. A correção real (DNS + headers) é
rastreada na seção 6 e no HSTS-PRELOAD.md; o guard 8.3 garante que o custo de
qualquer futuro curl de gate nunca volte a explodir.
