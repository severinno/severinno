# Plano — Semana de Produção (Severinno)

> **Para agentes:** implemente task por task seguindo este plano (subagent-driven ou execução inline com checkpoints). Cada task tem comando de verificação com resultado esperado. Sempre rode a verificação antes de marcar a task como concluída. Use o padrão `cmd > /tmp/xxx.log 2>&1; echo EXIT=$?` (sem pipe) para capturar exit code de forma confiável.

**Goal:** Deixar o Severinno pronto para produção até sexta-feira: CI 100% verde, `.env.production` validado, performance e bundle dentro do orçamento, e deploy smoke-testado em staging antes do release.

**Data:** 2026-08-07 · **Versão alvo:** v0.5.0

---

## 0. Status Snapshot (verificado nesta sessão — não re-fazer)

| Checklist | Status | Onde |
|---|---|---|
| P0 perf (hero LCP `priority`+`sizes`, CLS `<img>`, Sentry `tracesSampleRate: 0.15`) | ✅ Commitado | `cff5128` |
| Budget de bundle (`check-js-budget.mjs` + `analyze:webpack`/`budget:js` + job `budget` no CI) | ✅ Commitado | `cff5128` + `1beab51` |
| `.env.example` (37 vars, placeholders, `!.env.example` no `.gitignore`) | ✅ Commitado | `1beab51` |
| `globals: true` no `vitest.config.unit.ts` | ✅ Feito | working tree |
| **Testes verdes** | 🔴 **PENDENTE** | — |
| **Validação do `.env.production`** | 🔴 **PENDENTE** | — |
| **Smoke test do deploy em staging** | 🔴 **PENDENTE** | — |

## 0.1 Diagnóstico já realizado (causas raiz conhecidas — não re-investigar do zero)

1. **Hang da suíte** está localizado em `src/app` (exit 124). `src/hooks+store+queue` ✅ (2.77s), `src/components` ✅ (36s), `src/lib/__tests__` ✅ (16s, só o fuzz falha). Suspeito principal: `geo-reverse-route.test.ts` faz **chamada de rede real** ao Nominatim (~983ms num teste 502) — sujeito a rate-limit (1 req/s) e a travar o run. `mail.test.ts` **não** é a causa (suíte sem ele continua travando).
2. **`cache-key-fuzz.test.ts` 1000/1000**: causa raiz **encontrada** — `validateCacheKey` em `src/lib/__tests__/fuzz-utils.ts` tem assinatura `(key: string): boolean`, mas o teste chama `validateCacheKey(key, lat, lng)` e lê `v.pass`/`v.reason` → todo caso falha com `reason: undefined`. **Correção mínima: mudar SÓ `fuzz-utils.ts`** (assinatura + retorno) para bater com o uso do teste — o teste não precisa ser editado.
3. **3 arquivos de teste quebrados (pré-existentes desde `d547476`)**: `auth-route.test.ts` (8 falhas), `admin-settlements-route.test.ts` (6 falhas), `admin-finance-provider-transactions-route.test.ts`. Padrão comum: `vi.mocked(db.X).mockResolvedValue(...)` → `TypeError: ...mockResolvedValue is not a function`, e `(vi as any).clearAllMocks()` → `is not a function`. `admin-settlements`/`admin-finance` **não** fazem `vi.mock("@/lib/db")` — usam `resetDbMocks()` atribuindo `(db.settlementPeriod as any) = {...}` sobre o **db real** (Prisma `$extends` proxy), onde a atribuição não cria métodos mockáveis.
4. **`star-rating.test.tsx`**: passa isolado (10/10), falha no run completo (`getMultipleElementsFoundError` em `getByText(/12/)`) — poluição entre arquivos, prioridade baixa.
5. **`renderHook` (3 arquivos)**: passam isolados (66 testes). O "dispatcher null" é **efeito cascata** do hang, não bug de harness.
6. **`src/lib/env.ts`**: importa `server-only` (linha 1) — **lança erro em Node puro** (fora do RSC do Next) — e `envSchema` **NÃO é exportado** (só `export const env = parsed.data`). Qualquer script que importe `env.ts` via tsx quebrará na importação. **Correção: extrair o schema para `src/lib/env.schema.ts`** (sem `server-only`).
7. **Rotas que falham importam `db` de `@/lib/db`** (specifier único `@/lib/db`). `auth-route.test.ts` mocka `@/lib/db` corretamente (linha 44) — investigar por que `vi.mocked(db.user.findUnique)` não é `vi.fn` em runtime (provável: factory sem `default`).

---

## Fase 1 — Testes verdes (Dia 1–2) 🔴 BLOQUEADOR

### Task 1.1: Corrigir `cache-key-fuzz.test.ts` (falha 1000/1000 — causa raiz conhecida)

**Files:**
- Modificar: `src/lib/__tests__/fuzz-utils.ts` (função `validateCacheKey`) — **único arquivo que muda**
- Conferir (não modificar): `src/lib/__tests__/cache-key-fuzz.test.ts`

- [ ] **Step 1: Confirmar os usos de `validateCacheKey`**

```bash
grep -rn "validateCacheKey" src --include="*.ts" --include="*.tsx" | grep -v node_modules
```
Esperado: definição em `fuzz-utils.ts` + consumo apenas em `cache-key-fuzz.test.ts` (chamada `validateCacheKey(key, lat, lng)` lendo `v.pass`/`v.reason`).

- [ ] **Step 2: Alterar `validateCacheKey` em `fuzz-utils.ts`** para a assinatura que o teste já usa, retornando `{ pass, reason }` e **validando pelos invariantes reais da key** (o docstring do teste: prefixo `providers:count:`, contém lat/lng com 3 casas). **Não usar regex whitelist no corpo inteiro da key** — a query vai crua (pode conter `!$#&`, espaços) e multi-categorias são unidas com vírgula, então um whitelist estrito sempre falharia:

```ts
export function validateCacheKey(
  key: string | undefined,
  lat?: number,
  lng?: number,
): { pass: boolean; reason?: string } {
  if (!key || typeof key !== "string") {
    return { pass: false, reason: "key não é string" }
  }
  if (key.length > 512) {
    return { pass: false, reason: "key com mais de 512 chars" }
  }
  if (!key.startsWith("providers:count:")) {
    return { pass: false, reason: "key não começa com providers:count:" }
  }
  // Invariante do teste: contém lat/lng formatados a 3 casas decimais.
  // (número finito; NaN.toFixed(3) é "NaN" e passa no startsWith do prefixo)
  if (typeof lat === "number" && Number.isFinite(lat) && !key.includes(lat.toFixed(3))) {
    return { pass: false, reason: `key não contém lat ${lat.toFixed(3)}` }
  }
  if (typeof lng === "number" && Number.isFinite(lng) && !key.includes(lng.toFixed(3))) {
    return { pass: false, reason: `key não contém lng ${lng.toFixed(3)}` }
  }
  return { pass: true }
}
```

- [ ] **Step 3: Rodar o teste isolado** (se ainda houver falhas, conferir a razão no erro — as razões agora são descritivas: "não contém lat/lng" ou "não começa com prefixo"):

```bash
npx vitest run src/lib/__tests__/cache-key-fuzz.test.ts
```
Esperado: PASS (11 testes).

- [ ] **Step 4: Commit**

```bash
git add src/lib/__tests__/fuzz-utils.ts
git commit -m "fix: validateCacheKey com assinatura {pass, reason} alinhada ao teste fuzz"
```

### Task 1.2: Corrigir `auth-route.test.ts` (8 falhas)

**Files:**
- Modificar: `src/app/api/__tests__/auth-route.test.ts`
- Referência de padrão correto: `src/lib/__tests__/metrics.test.ts` (usa `vi.hoisted` + `vi.mock("@/lib/db")` com `default` e `db`)

- [ ] **Step 1: Reproduzir isolado com reporter verbose para pegar o stack do primeiro erro**

```bash
npx vitest run src/app/api/__tests__/auth-route.test.ts --reporter=verbose > /tmp/auth.log 2>&1; echo EXIT=$?; head -60 /tmp/auth.log
```
Esperado: reproduzir `TypeError: vi.mocked(...).mockResolvedValue(...)(...).mockResolvedValue is not a function`.

- [ ] **Step 2: Diagnosticar o mock de `db`** — conferir os exports de `@/lib/db` e o factory do mock:

```bash
grep -n "^export" src/lib/db.ts | head
```
Esperado: verificar se existe `export default` além de `export const db` (se sim, o factory do mock precisa expor `default` também).

- [ ] **Step 3: Corrigir o factory do mock** — replicar o padrão de `metrics.test.ts`: `vi.mock("@/lib/db", () => ({ default: mockDb, db: mockDb }))` com `vi.hoisted`, garantindo que TODAS as funções usadas no teste existam no factory (`user.findUnique/create/update/findMany`). Rodar de novo:

```bash
npx vitest run src/app/api/__tests__/auth-route.test.ts > /tmp/auth2.log 2>&1; echo EXIT=$?; tail -8 /tmp/auth2.log
```
Esperado: EXIT=0 — 15/15 PASS.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/__tests__/auth-route.test.ts
git commit -m "fix: corrige mock de db em auth-route.test.ts (vi.hoisted + default)"
```

### Task 1.3: Corrigir `admin-settlements-route.test.ts` + `admin-finance-provider-transactions-route.test.ts`

**Files:**
- Modificar: `src/app/api/__tests__/admin-settlements-route.test.ts`
- Modificar: `src/app/api/__tests__/admin-finance-provider-transactions-route.test.ts`

- [ ] **Step 1: Substituir o hack `resetDbMocks()` (atribuição em `db` real/$extends) pelo padrão `vi.hoisted` + `vi.mock("@/lib/db")`**, copiando o padrão de `metrics.test.ts`:

```ts
const mockDb = vi.hoisted(() => ({
  settlementPeriod: { findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  providerSettlement: { findUnique: vi.fn(), update: vi.fn() },
  setting: { findUnique: vi.fn(), upsert: vi.fn(), findMany: vi.fn() },
  payment: { findMany: vi.fn(), count: vi.fn(), groupBy: vi.fn() },
  // + campos usados pelo admin-finance (ex.: booking, provider) — conferir no arquivo
}))

vi.mock("@/lib/db", () => ({ default: mockDb, db: mockDb }))
```

- [ ] **Step 2: Remover `resetDbMocks()`** do `beforeEach` e usar `vi.clearAllMocks()` (os métodos agora são `vi.fn` de verdade vindos do factory).

- [ ] **Step 3: Rodar os 2 arquivos**

```bash
npx vitest run src/app/api/__tests__/admin-settlements-route.test.ts src/app/api/__tests__/admin-finance-provider-transactions-route.test.ts > /tmp/admin.log 2>&1; echo EXIT=$?; tail -8 /tmp/admin.log
```
Esperado: EXIT=0 — todos PASS (settlements: 19 testes; finance: ~6).

- [ ] **Step 4: Commit**

```bash
git add src/app/api/__tests__/admin-settlements-route.test.ts src/app/api/__tests__/admin-finance-provider-transactions-route.test.ts
git commit -m "fix: usa vi.hoisted + vi.mock para db em rotas admin (prisma \$extends proxy)"
```

### Task 1.4: Corrigir o hang da suíte em `src/app`

**Files:**
- Provável: `src/app/api/__tests__/geo-reverse-route.test.ts` (e/ou `geo-search-route.test.ts`, `geo-cep-route.test.ts`)
- Modificar: o teste do geo para **mockar a rede** em vez de chamar o Nominatim real (padrão já usado em `geo-search-route.test.ts`)

- [ ] **Step 1: Bisect fino dentro de `src/app` para achar o arquivo que trava**

```bash
timeout 120 npx vitest run src/app/api/__tests__/geo-reverse-route.test.ts --testTimeout=10000 > /tmp/geo-rev.log 2>&1; echo EXIT=$?
```
Esperado: se EXIT=124 (timeout), este é o culpado (rede real + rate-limit). Teste também `geo-search-route.test.ts` e `geo-cep-route.test.ts` isolados. Se nenhum travar sozinho, rodar o diretório `src/app/api/__tests__` inteiro com timeout 180 e anotar o último arquivo completo (o hang pode exigir interação entre arquivos).

- [ ] **Step 2: Mockar o cliente geo / fetch** no(s) teste(s) culpado(s) — copiar o padrão de `geo-search-route.test.ts` (`vi.mock("@/lib/geo", ...)` + `vi.mocked(geocodeReverse).mockResolvedValue(...)`). Remover dependência de rede real.

- [ ] **Step 3: Verificar o arquivo corrigido + o diretório `src/app` inteiro**

```bash
timeout 180 npx vitest run src/app --testTimeout=15000 > /tmp/app.log 2>&1; echo EXIT=$?; tail -8 /tmp/app.log
```
Esperado: EXIT=0 (sem timeout).

- [ ] **Step 4: Commit**

```bash
git add src/app/api/__tests__/
git commit -m "fix: mocka rede do Nominatim nos testes geo (elimina hang por rate-limit)"
```

### Task 1.5: Suíte completa verde (validação final da fase)

- [ ] **Step 1: Rodar a suíte completa** (capturar exit code SEM pipe — usar arquivo de log)

```bash
timeout 600 npx vitest run --testTimeout=15000 > /tmp/full-suite.log 2>&1; echo FULL_EXIT=$?; tail -20 /tmp/full-suite.log
```
Esperado: `FULL_EXIT=0`, `Test Files  N passed (N)`, `Tests  M passed (M)` — zero failures.

- [ ] **Step 2: Rodar também a config de unit (usada no CI pr-check)**

```bash
timeout 300 npx vitest run --config vitest.config.unit.ts > /tmp/unit.log 2>&1; echo UNIT_EXIT=$?; tail -10 /tmp/unit.log
```
Esperado: `UNIT_EXIT=0`.

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit > /tmp/tsc.log 2>&1; echo TSC_EXIT=$?; head -10 /tmp/tsc.log
```
Esperado: `TSC_EXIT=0` (0 erros).

- [ ] **Step 4: (Opcional, baixa prioridade) `star-rating.test.tsx`** — se ainda falhar só no run completo, investigar `getByText(/12/)` com múltiplos matches (poluição de estado global). Não bloquear a fase por isso.

---

## Fase 2 — Validação do `.env.production` (Dia 2–3)

### Task 2.1: Extrair o schema de env para um módulo reutilizável

**Files:**
- Criar: `src/lib/env.schema.ts` (schema puro, **sem** `import "server-only"`)
- Modificar: `src/lib/env.ts` (remover o objeto `z.object`, importar de `env.schema.ts`, exportar `envSchema`)

- [ ] **Step 1: Criar `src/lib/env.schema.ts`** movendo o objeto `z.object({...})` de `env.ts` (linhas 4–92) sem alterar nenhum campo:

```ts
import { z } from "zod"

export const envSchema = z.object({
  // <— colar o objeto completo de env.ts (NODE_ENV ... DB_PASSWORD), inalterado
})
```

- [ ] **Step 2: Atualizar `src/lib/env.ts`** — trocar a definição local por import:

```ts
import "server-only"
import { envSchema } from "./env.schema"
// remover: const envSchema = z.object({...}) e o import de z (se não usado mais)
// manter: const parsed = envSchema.safeParse(process.env) ... export const env = parsed.data
```

- [ ] **Step 3: Verificar que nada quebrou** — typecheck + um teste que importa env:

```bash
npx tsc --noEmit > /tmp/tsc2.log 2>&1; echo TSC_EXIT=$?; head -10 /tmp/tsc2.log
npx vitest run src/lib/__tests__/env.test.ts > /tmp/env-test.log 2>&1; echo ENV_TEST_EXIT=$?; tail -6 /tmp/env-test.log
```
Esperado: `TSC_EXIT=0`, `ENV_TEST_EXIT=0`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/env.schema.ts src/lib/env.ts
git commit -m "refactor: extrai envSchema para env.schema.ts (reuso sem server-only)"
```

### Task 2.2: Criar `scripts/validate-env.ts` e validar `.env.production`

**Files:**
- Criar: `scripts/validate-env.ts` (parser inline — `dotenv` NÃO é dependência direta do projeto, só transitiva do Prisma)

- [ ] **Step 1: Criar `scripts/validate-env.ts`** — sem `dotenv`, sem importar `env.ts` (evita `server-only`):

```ts
// scripts/validate-env.ts
// Uso: npx tsx scripts/validate-env.ts [--file .env.production]
//      npx tsx scripts/validate-env.ts --ci   (valida process.env, sem arquivo — p/ CI)
import fs from "node:fs"
import { envSchema } from "../src/lib/env.schema"

const ci = process.argv.includes("--ci")

if (!ci) {
  const file = process.argv.includes("--file")
    ? process.argv[process.argv.indexOf("--file") + 1]
    : ".env.production"
  const raw = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : ""
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (m) process.env[m[1]] = m[2]
  }
}

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  console.error(`❌ env inválido:`)
  const flat = parsed.error.flatten()
  for (const [key, errors] of Object.entries(flat.fieldErrors)) {
    for (const err of errors ?? []) console.error(`   ${key}: ${err}`)
  }
  for (const err of flat.formErrors) console.error(`   ${err}`)
  process.exit(1)
}
console.log(`✅ env válido (envSchema).`)
process.exit(0)
```

- [ ] **Step 2: Rodar contra o `.env.production`** (arquivo existe localmente; nunca commitar — `.env*` é gitignored)

```bash
npx tsx scripts/validate-env.ts --file .env.production
```
Esperado: `✅ env válido (envSchema).` — se falhar, corrigir o `.env.production` e repetir.

- [ ] **Step 3: Checagem extra de segredos não-vazios** (o schema permite `.optional()`, mas produção exige preenchidos). Não imprimir valores:

```bash
for v in SESSION_SECRET DATABASE_URL REDIS_URL S3_ACCESS_KEY S3_SECRET_KEY VAPID_PRIVATE_KEY SMTP_PASS PAYMENT_WEBHOOK_SECRET GLITCHTIP_SECRET; do
  val=$(grep -E "^$v=" .env.production | cut -d= -f2-)
  [ -z "$val" ] && echo "⚠️ $v VAZIO" || echo "✅ $v preenchido"
done
```
Esperado: todos `✅ preenchido`.

- [ ] **Step 4: Commit**

```bash
git add scripts/validate-env.ts
git commit -m "feat: script de validacao de env contra envSchema (producao/CI)"
```

- [ ] **Step 5 (opcional): wire no CI** — adicionar passo no `release-deploy.yml` (job de build) executando `npx tsx scripts/validate-env.ts --ci` (valida as env vars do workflow, **não** o arquivo — `.env.production` não existe no runner do GitHub). Para validar o arquivo real, rodar no VPS via SSH antes do `docker compose up`.

### Task 2.3: Verificação de completude do `.env.example` (checklist)

- [ ] **Step 1: Comparar os nomes de vars do `.env` com o `.env.example`** (esperado 37/37, nada faltando — padrão com dígitos permitidos):

```bash
grep -vE '^[[:space:]]*#|^[[:space:]]*$' .env | sed 's/=.*//' | sort > /tmp/env-names.txt
grep -E '^[A-Z][A-Z0-9_]*=' .env.example | sed 's/=.*//' | sort > /tmp/example-names.txt
echo "env: $(wc -l < /tmp/env-names.txt)  example: $(wc -l < /tmp/example-names.txt)"
comm -23 /tmp/env-names.txt /tmp/example-names.txt
```
Esperado: `env: 37 example: 37` e `comm` vazio (nenhuma var faltando).

---

## Fase 3 — P0 de performance (Dia 3) — VERIFICAÇÃO (já implementado)

### Task 3.1: Confirmar os 3 itens P0 no código

- [ ] **Step 1: Confirmar no código** (já commitados em `cff5128`):

```bash
grep -n "priority\|sizes" src/components/vitrine/hero.tsx | head -3          # hero LCP
grep -n "width=\|height=" src/components/modals/provider-profile-modal.tsx | head -3
grep -n "tracesSampleRate" sentry.client.config.ts                            # 0.15
```
Esperado: `priority`, `sizes` no hero; `width/height` nos `<img>`; `tracesSampleRate: 0.15`.

### Task 3.2: Lighthouse (ideal: após staging no ar — Fase 5; fallback: localhost)

- [ ] **Step 1: Subir build de produção local para auditar** (se staging ainda não estiver no ar). Anote o PID do servidor para matá-lo no Step 3:

```bash
set -a; source .env; set +a
pnpm build && (NODE_ENV=production node .next/standalone/server.js &) && sleep 5
```

- [ ] **Step 2: Rodar Lighthouse CI**

```bash
npx lhci autorun
```
Esperado: LCP < 2.5s, CLS < 0.1, LHS ≥ 90 (conferir `lighthouserc.json` — já existe e está configurado com assertions).

- [ ] **Step 3: Matar o servidor local de produção** (não deixar a porta 3000 vazando para as próximas tasks)

```bash
lsof -ti:3000 | xargs kill 2>/dev/null; echo OK
```

- [ ] **Step 4: Registrar resultado** no `worklog.md` (data, métricas, URL testada). Sem código para commitar nesta task, a menos que o Lighthouse aponte regressão.

---

## Fase 4 — Budget de bundle (Dia 3) — VERIFICAÇÃO (já implementado)

### Task 4.1: Rodar o analyzer + gate de budget e confirmar o job do CI

- [ ] **Step 1: Build com análise + budget**

```bash
set -a; source .env; set +a
ANALYZE=true pnpm exec next build --webpack > /tmp/analyze.log 2>&1; echo BUILD_EXIT=$?
node scripts/check-js-budget.mjs > /tmp/budget.log 2>&1; echo BUDGET_EXIT=$?; tail -12 /tmp/budget.log
```
Esperado: `BUDGET_EXIT=0` — `✅ All JS budgets within limits.` (budgets atuais: initial 150 KB, total 1400 KB, largest 300 KB, maplibre 300, recharts 100, framer 50, socket.io 20 — gzip).

- [ ] **Step 2: Recalibrar budgets se o baseline mudou**

```bash
node scripts/check-js-budget.mjs --update
```
Usar os valores sugeridos (atual +20%) só se o build atual estiver muito acima/abaixo dos budgets definidos. Editar os defaults em `scripts/check-js-budget.mjs` e commitar se mudar.

- [ ] **Step 3: Confirmar o job `budget` no CI** — `grep -n "budget" .github/workflows/ci.yml` deve mostrar o job com `ANALYZE=true bunx next build --webpack` + `bun run budget:js` (já commitado em `1beab51`). Nada a fazer além de confirmar.

- [ ] **Step 4: (Decisão) Tornar budget bloqueador de release** — se desejado, adicionar `budget` ao `needs:` do job `deploy` no `ci.yml`:

```yaml
deploy:
  needs: [build, budget]
```
Commit opcional: `ci: torna budget de JS gate do deploy`.

---

## Fase 5 — Smoke test do deploy em staging (Dia 4) 🔴 PENDENTE

### Task 5.1: Subir staging + health checks

**Files/recursos:**
- `scripts/deploy.sh` (existe — git ops + docker + migrate + health), `scripts/check-health.sh`, `scripts/check-health.ps1`
- `docker compose` (serviços: app, realtime, workers, postgis, redis, rabbitmq)
- `.env.production` (validado na Fase 2)

- [ ] **Step 1: Subir o stack em staging**

```bash
bash scripts/deploy.sh   # ou conforme o fluxo de staging do projeto
```
Esperado: containers up (app, realtime, email-worker, notification-worker), health 200.

- [ ] **Step 2: Health check automatizado**

```bash
bash scripts/check-health.sh
```
Esperado: todos os checks ✅ (HTTP 200 em `/api/health`, dependências OK).

- [ ] **Step 3: Smoke e2e de cache (roteiro Playwright já existente)**

```bash
npx playwright test e2e/all-cache-routes.spec.ts --project=chromium > /tmp/e2e-cache.log 2>&1; echo E2E_EXIT=$?; tail -10 /tmp/e2e-cache.log
```
Esperado: `E2E_EXIT=0` (valida headers `Cache-Control` com `stale-while-revalidate` nas 12 rotas). Conferir a `baseURL` no `playwright.config.ts` para apontar para o staging.

- [ ] **Step 4: Security headers** (CSP, HSTS, XFO, etc. — script existe)

```bash
bash scripts/test-security-headers.sh --url "https://staging.severinno.com.br"
```
Esperado: ✅ todos os headers obrigatórios.

- [ ] **Step 5: Smoke manual das jornadas críticas** (no staging): busca por categoria, perfil de profissional, modal de orçamento, login/registro, web push. Registrar resultados no `worklog.md`.

### Task 5.2: Revisar fluxo de release (preparação para o Dia 5)

- [ ] **Step 1: Validar `scripts/release.sh`** — conferir que faz bump de versão, atualiza `CHANGELOG.md`, cria tag `v*` e que `release-deploy.yml` (trigger por tag ou push em main) roda: utf8 → lint/typecheck/test → cache manifest → docker build GHCR → migrate → deploy. Rodar em dry-run se o script suportar; senão, revisar o script e o workflow apenas.

---

## Fase 6 — Release & pós-deploy (Dia 5)

### Task 6.1: Congelar e lançar v0.5.0

- [ ] **Step 1: Pré-flight final** — suíte completa verde, typecheck 0 erros, `.env.production` validado, staging smoke ok (Fases 1–5 todas ✅).

- [ ] **Step 2: Release**

```bash
bash scripts/release.sh
```
Esperado: bump para v0.5.0, `CHANGELOG.md` atualizado, tag criada e push (dispara `release-deploy.yml`).

- [ ] **Step 3: Pós-deploy em produção**
  1. `curl -sf https://severinno.com.br/api/health` → 200
  2. `bash scripts/check-health.sh` contra produção
  3. Verificar Glitchtip/Sentry sem novos erros fatais (DSN configurados via env)
  4. Confirmar rotas de marketing com ISR (`curl -sI / | grep -i "x-vercel-cache\|cache-control"`)

- [ ] **Step 4: Registrar release no `worklog.md`** (hash, data, checks pós-deploy).

---

## Definition of Done (critério de saída da semana)

- [ ] `npx vitest run` → exit 0, 0 falhas
- [ ] `npx vitest run --config vitest.config.unit.ts` → exit 0
- [ ] `npx tsc --noEmit` → 0 erros
- [ ] `npx tsx scripts/validate-env.ts --file .env.production` → ✅
- [ ] `.env.example` → 37/37 vars cobertas (comm -23 vazio)
- [ ] `node scripts/check-js-budget.mjs` → exit 0
- [ ] Lighthouse: LCP < 2.5s, CLS < 0.1 (registrado no worklog)
- [ ] `bash scripts/check-health.sh` em staging e produção → ✅
- [ ] e2e `all-cache-routes` + security headers em staging → PASS
- [ ] Release v0.5.0 no ar, health 200, sem erros novos no Glitchtip

## Riscos / Observações

- **Hang em `src/app`**: se o culpado não for o geo (rede real), o bisect fino (Task 1.4 Step 1) apontará o arquivo exato — aplicar o mesmo tratamento (mockar rede/timers). Não assumir que é `mail.test.ts` (já descartado).
- **`vi.mocked` quebrado**: se o factory de mock não resolver (Task 1.2), comparar com `metrics.test.ts` (funciona) e replicar o padrão `vi.hoisted` + mock factory com `default` + `db`.
- **`server-only`**: NUNCA importar `src/lib/env.ts` (ou qualquer módulo que importe `server-only`) de scripts tsx rodando em Node puro — usar `env.schema.ts` (Task 2.1).
- **Não commitar `.env.production`**: `.env*` é gitignored; o script lê o arquivo local apenas; no CI usar `--ci` (process.env).
- **`star-rating.test.tsx`** é falha de poluição de baixa prioridade — pode ficar para depois do release se não atrapalhar o CI (avaliar se o CI roda o arquivo em isolamento).
- **Ordem das fases**: Fase 5 (staging) viabiliza o Lighthouse real (Fase 3.2); se o staging atrasar, usar o fallback localhost documentado.
