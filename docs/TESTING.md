# Testing Guide — Severinno Marketplace

> Estratégia, padrões e lições aprendidas sobre testes no projeto.

## Stack

| Camada             | Ferramenta                       | Escopo                                  |
| ------------------ | -------------------------------- | --------------------------------------- |
| **Unitários**      | Vitest 3.x                       | API routes, libs, hooks                 |
| **Componentes**    | Vitest + jsdom + Testing Library | React components                        |
| **E2E**            | Playwright                       | Fluxos críticos (cache, auth, bookings) |
| **Acessibilidade** | `vitest-axe`                     | Componentes de UI                       |

```
Total: 155 unitários | 32 E2E
```

## Estrutura de Arquivos

```
src/
  app/api/__tests__/          ← 27 test files for 80 API routes
  components/*/__tests__/      ← Co-located with components
  lib/__tests__/               ← Tests for utility modules
  lib/__tests__/helpers/       ← Shared test utilities (createMockRequest, parseResponse)
e2e/                           ← Playwright E2E specs
```

---

## ⚠️ Known Vitest Quirks

### 1. `vi.clearAllMocks()` RESETA `mockResolvedValue`/`mockReturnValue`

**Comportamento observado no `vitest@3.1.1`:** (versão atual do projeto — reavaliar após upgrade)

A documentação do Vitest diz que `vi.clearAllMocks()` equivale a `mockClear()` (que só limpa call history, não implementações). **Na prática, ele também reseta `mockResolvedValue` e `mockReturnValue`**, fazendo os mocks retornarem `undefined`.

```typescript
// ❌ NÃO funciona — mock retorna undefined após clearAllMocks:
beforeEach(() => {
  vi.clearAllMocks()
})

it("test", async () => {
  vi.mocked(db.booking.findUnique).mockResolvedValue({ id: "book-1" })
  const result = await db.booking.findUnique() // undefined!
})
```

**Solução:** Recriar os mocks com `vi.fn()` fresco no `beforeEach`, em vez de usar `vi.clearAllMocks()`:

```typescript
// ✅ Funciona — substitui a prop no objeto mock compartilhado:
function resetDbMocks() {
  db.booking.findUnique = vi.fn()
  db.booking.update = vi.fn()
  db.payment.update = vi.fn()
  db.$transaction = vi.fn(async (q) => Promise.all(q))
}

beforeEach(() => {
  process.env.SOME_ENV = "value"
  vi.mocked(verifyWebhookSignature).mockReturnValue(true)
  resetDbMocks() // <-- fresh vi.fn() para cada teste
})

it("test", async () => {
  db.booking.findUnique = vi.fn().mockResolvedValue({ id: "book-1" })
  const result = await db.booking.findUnique() // { id: "book-1" } ✅
})
```

> **Por que funciona?** O `vi.mock("@/lib/db", () => ({ db: { ... } }))` cria um objeto JS comum.
> A rota importa `{ db }` que é uma referência para esse mesmo objeto.
> Reatribuir `db.booking.findUnique = vi.fn()` no `beforeEach` é visto pela rota porque
> é o mesmo objeto em memória.

**Arquivos afetados no projeto:**

| Arquivo                                              | Padrão usado                                                                                  |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `webhooks-lytex-route.test.ts`                       | `resetDbMocks()` com fresh `vi.fn()`                                                          |
| `admin-finance-route.test.ts`                        | `resetDbMocks()` com fresh `vi.fn()`                                                          |
| `admin-finance-export-route.test.ts`                 | `resetDbMocks()` com fresh `vi.fn()`                                                          |
| `admin-finance-provider-transactions-route.test.ts`  | `resetDbMocks()` com fresh `vi.fn()`                                                          |
| Demais testes (`bookings-route`, `auth-route`, etc.) | `vi.clearAllMocks()` + mocks simples — funcionam porque usam `let _mockVar` que é reatribuído |

### 2. `mockResolvedValueOnce` TEM PRIORIDADE sobre `mockResolvedValue`

**Comportamento:**

Quando um mock tem tanto um valor default (`mockResolvedValue`) quanto valores
one-time (`mockResolvedValueOnce`), os valores one-time são consumidos PRIMEIRO:

```typescript
const fn = vi
  .fn()
  .mockResolvedValue("default") // ← usado APÓS exaurir os once
  .mockResolvedValueOnce("primeiro") // 1ª chamada → "primeiro"
  .mockResolvedValueOnce("segundo") // 2ª chamada → "segundo"
// 3ª chamada → "default"
```

Isso é **contraintuitivo** quando você escreve:

```typescript
// ❌ Erro comum — o default é consumido POR ÚLTIMO:
.mockResolvedValue(monthlyData)     // ← SÓ usado na 5ª chamada
.mockResolvedValueOnce(txData)      // 1ª chamada recebe ISTO
.mockResolvedValueOnce([])          // 2ª chamada
.mockResolvedValueOnce([])          // 3ª chamada
.mockResolvedValueOnce(providerData) // 4ª chamada
// 5ª chamada → monthlyData (default) — errado!
```

**Solução:** Usar `mockResolvedValueOnce` para **todas as chamadas**, sem default:

```typescript
// ✅ Correto — todas as N chamadas têm seu próprio once:
.mockResolvedValueOnce(monthlyData)   // 1ª chamada → monthly
.mockResolvedValueOnce(txData)        // 2ª chamada → transactions
.mockResolvedValueOnce([])            // 3ª chamada → MRR current
.mockResolvedValueOnce([])            // 4ª chamada → MRR previous
.mockResolvedValueOnce(providerData)  // 5ª chamada → provider
```

> **Dica:** Conte quantas vezes a função é chamada no handler e use exatamente
> esse número de `mockResolvedValueOnce`. No `admin-finance-route`, por exemplo,
> `db.payment.findMany` é chamado 5 vezes via `Promise.all`.

---

## Padrões de Mock

### Mock de `@/lib/db` (Prisma)

O mock do Prisma é declarado com `vi.mock` no topo do arquivo e reatribuído
no `beforeEach`:

```typescript
// 1. Mock factory no topo (executa uma vez):
vi.mock("@/lib/db", () => ({ db: {} }))

// 2. Reatribui no beforeEach (executa a cada teste):
function resetDbMocks() {
  db.booking = { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn(), create: vi.fn() }
  db.payment = {
    findMany: vi.fn(),
    update: vi.fn(),
    upsert: vi.fn(),
    groupBy: vi.fn(),
    count: vi.fn(),
  }
  db.setting = { findUnique: vi.fn() }
}

beforeEach(() => {
  resetDbMocks()
  vi.mocked(auth.requireRole).mockResolvedValue(undefined)
})

// 3. Cada teste configura apenas os mocks que precisa:
it("exemplo", async () => {
  db.booking.findUnique = vi.fn().mockResolvedValue({ id: "b-1", status: "PAID" })
  const res = await handler(request)
  // ...
})
```

### Mock de `@/lib/auth`

Usa uma variável `let` mutável que o `beforeEach` reatribui:

```typescript
let _mockRole: string | null = null

vi.mock("@/lib/auth", () => ({
  requireRole: vi.fn().mockImplementation(async (role: string) => {
    if (_mockRole !== role) throw new Error("FORBIDDEN")
  }),
}))

beforeEach(() => {
  _mockRole = "ADMIN" // ou "CLIENT", "PROVIDER", null
})
```

> **Nota:** Esse padrão funciona mesmo sem `vi.clearAllMocks()` porque
> a variável `let` é reatribuída. Mas a implementação do mock (`mockImplementation`)
> precisa ser preservada — outro motivo para não usar `vi.clearAllMocks()`.

---

## CLI Commands

> **Hooks locais (pre-commit vs pre-push):** o `pre-commit` roda a stack
> completa de qualidade (guards de encoding + lint-staged + barrel-lint +
> typecheck + snapshots condicionais); o `pre-push` revalida os fast gates que
> o CI roda (`utf8-check.yml`) e os testes da branch (smart-skip). Tabela de
> simetria → [README: Git Hooks](../README.md#git-hooks--pre-commit-vs-pre-push-simetria).

```bash
# Rodar todos os unitários
npx vitest run

# Rodar arquivo específico
npx vitest run src/app/api/__tests__/admin-finance-route.test.ts

# Rodar em modo verbose (nomes dos testes)
npx vitest run --reporter=verbose

# Coverage gaps report
npx tsx scripts/coverage-gaps.ts
npx tsx scripts/coverage-gaps.ts --verbose
npx tsx scripts/coverage-gaps.ts --ci

# E2E (requer dev server em :3000)
npx playwright test e2e/providers-cache.spec.ts --project=chromium
```

---

## Seed E2Es (PostGIS efêmero)

Os seeds têm dois E2Es dedicados que rodam contra um **PostGIS descartável**
(subido via `docker-compose.test.yml`, dados em `tmpfs` — nada persiste):

| E2E                  | Seed validado         | Checks | Valida                                                                                                      |
| :------------------- | :-------------------- | :----: | :---------------------------------------------------------------------------------------------------------- |
| `test:seed-prod-e2e` | `prisma/seed-prod.ts` |  115   | guard de produção, dry-run, árvore (27 cats), settings (9), **zero usuários**, idempotência                 |
| `test:seed-dev-e2e`  | `prisma/seed.ts`      |  162   | guard anti-destruição (vazio + populado), 9 usuários demo, árvore, bookings/payments/reviews, wipe+recreate |

Ambos cobrem os cenários de **`SEED_SPEC_PATCH`** (update mid-cycle + rename
mid-cycle + spec inválido): o seed é executado como SUBPROCESSO com o spec
mutado e a convergência é validada no banco real. Os cenários de update/rename
usam o helper compartilhado `scripts/seed-e2e-utils.ts` (fonte única dos
patches + `buildPatchedSpec` do seed-data — sem drift manual entre os E2Es).

### Rodando

```bash
# Suite completa (start PostGIS → push schema → validação → cleanup)
bun run test:seed-prod-e2e
bun run test:seed-dev-e2e

# Flags:
#   --skip-docker   — reutiliza um PostGIS já de pé (ex.: prod primeiro, dev no MESMO container)
#   --skip-cleanup  — mantém os containers rodando após o E2E (debug do estado do banco)
bun run test:seed-prod-e2e --skip-docker --skip-cleanup
bun run test:seed-dev-e2e --skip-docker
```

Pré-requisitos:

- Docker (imagem `postgis/postgis:16-3.4`)
- `bun` + client Prisma gerado (`bunx prisma generate`)
- Porta `5433` livre (DATABASE_URL default do compose de teste)

### SEED_SPEC_PATCH manualmente em dev

O hook de teste pode ser usado manualmente para validar a convergência do seed
sem rodar o E2E completo — o formato completo (icon/order/renameTo + gates de
produção) está documentado em [`docs/SECURITY.md#13`](docs/SECURITY.md).

```bash
# Update in-place (icon/order — mesmo slug, converge sem duplicar) — seed dev
SEED_SPEC_PATCH='[{"name":"Elétrica","icon":"bolt"}]' NODE_ENV=development bun run db:seed

# Update in-place — seed prod (exige override — banco efêmero/CI)
SEED_SPEC_PATCH='[{"name":"Elétrica","icon":"bolt"},{"name":"Reparos","order":5}]' \
  NODE_ENV=development PROD_SEED_ALLOW_DEV=1 bun prisma/seed-prod.ts

# Rename (muda o nome → muda o slug → CRIA linha nova) — dry-run avisa ANTES
SEED_SPEC_PATCH='[{"name":"Elétrica","renameTo":"Eletricidade"}]' \
  NODE_ENV=development PROD_SEED_ALLOW_DEV=1 bun prisma/seed-prod.ts --dry-run
```

> ⚠️ **Gotcha:** os E2Es **não limpam** `SEED_SPEC_PATCH` do ambiente herdado —
> os runs canônicos (que restauram os valores originais) herdariam um patch
> exportado no shell e quebrariam as asserções. Antes de rodar os E2Es:
>
> ```bash
> unset SEED_SPEC_PATCH
> ```

---

## Snapshot Management

O projeto usa **snapshot tests** do Vitest (`toMatchSnapshot`) para capturar
a saída renderizada de componentes em diferentes estados visuais.

Atualmente há 8 snapshot tests em `src/components/admin/__tests__/`:

| Arquivo                                    | Componente             |                  Snapshots                   |
| :----------------------------------------- | :--------------------- | :------------------------------------------: |
| `gist-reindex-button-snapshot.test.tsx`    | `GistReindexButton`    | 4 (initial, reindexing, success, refetching) |
| `gist-degradation-panel-snapshot.test.tsx` | `GistDegradationPanel` | 4 (initial, reindexing, success, refetching) |

### Workflow

#### Atualizar snapshots (quando uma mudança intencional de UI quebra snapshots)

```bash
# Regenera TODOS os snapshots
bun run test:snapshot-update

# Ou para um arquivo específico
npx vitest run --update src/components/admin/__tests__/gist-reindex-button-snapshot.test.tsx
```

#### Visualizar diff ao revisar snapshots

```bash
# Vitest mostra o diff no terminal quando um snapshot diverge
bun run test:unit  # Se um snapshot quebrou, o diff aparece no output
```

#### Commitar snapshots atualizados

1. Execute `bun run test:snapshot-update`
2. Revise o diff dos snapshots no `git diff` — confirme que a mudança é intencional
3. Faça commit junto com as alterações de código que os geraram
4. **Nunca** faça `git add -A` depois de `--update` sem revisar o diff primeiro

### Diretrizes

- **Snapshots são arquivos de commit** — estão em `src/components/*/__tests__/__snapshots__/`
  e precisam ser versionados para que o CI possa compará-los
- **Prefira snapshots pequenos** — cada teste deve capturar UM estado visual, não o componente inteiro
- **Nomeie snapshots com prefixo do componente** — ex: `gist-reindex-button-initial`,
  `gist-degradation-panel-success` — para evitar colisão entre arquivos
- **Evite atualizar snapshots em lote** — se mais de 3 snapshots quebrarem, a mudança
  provavelmente é intencional (e o diff é fácil de revisar). Se dezenas quebrarem,
  desconfie de mudança estrutural no componente base
- **CI falha se snapshots divergirem** — é um guardrail contra regressão visual.
  Execute `--update` localmente, revise, e comite. O CI só aceita snapshots exatos

### Troubleshooting

| Problema                                    | Causa provável                                                                  | Solução                                                               |
| :------------------------------------------ | :------------------------------------------------------------------------------ | :-------------------------------------------------------------------- |
| Snapshot quebrou no CI mas não localmente   | Versão diferente do React, jsdom, ou sistema de arquivos                        | Rode `bun run test:snapshot-update` na mesma plataforma do CI (Linux) |
| `asFragment()` captura HTML enorme (>100KB) | Mock renderiza conteúdo condicional incondicionalmente                          | Verifique se Collapsible/AlertDialog mocks têm wrapper conditional    |
| Snapshot mudou sem alteração de código      | Dependência dinâmica (ex: `Date.now()`, `Math.random()`, `crypto.randomUUID()`) | Mock a função com `vi.fn().mockReturnValue(fixedValue)`               |

---

## Histórico de Lições Aprendidas

### Sessão: Webhook Lytex + Admin Finance Tests

**Problema:** `vi.clearAllMocks()` reseta `mockResolvedValue` no Vitest 3.x.
Todos os 8 novos testes do webhook retornavam 401 porque `verifyWebhookSignature`
retornava `undefined` em vez de `true`.

**Diagnóstico:** Gastamos 3 iterações para identificar a causa raiz. O debug
`expect(await (db.booking.findUnique as any)()).toHaveProperty("paymentStatus", "PAID")`
revelou que o mock retornava `undefined` mesmo após `mockResolvedValue`.

**Solução:** Substituir `vi.clearAllMocks()` por reatribuição direta de `vi.fn()`.

### Sessão: Admin Finance Route Tests

**Problema:** `mockResolvedValueOnce` tem prioridade sobre `mockResolvedValue`,
fazendo com que os valores fossem consumidos na ordem errada para as 5 chamadas
`findMany` dentro de `Promise.all`.

**Diagnóstico:** Testes com `mockResolvedValue(default).mockResolvedValueOnce(x4)`
retornavam 500 porque a 1ª chamada recebia o 1º once em vez do default.

**Solução:** Usar 5x `mockResolvedValueOnce` — uma para cada chamada.

### Sessão: Snapshot Gravity — GiST Degradation Panel

**Problema:** Ao criar snapshots para o `GistDegradationPanel`, os 4 estados visuais do
botão filho (`GistReindexButton`) geravam arquivos grandes (>50KB cada) porque o mock do
`Collapsible` e `AlertDialog` renderizavam conteúdo condicional incondicionalmente.

**Aprendizado:** Mocks que ignoram `open`/`closed` state produzem snapshots que
capturam TODO o conteúdo do componente, não apenas o estado atual. Isso é aceitável
para testes de snapshot (o snapshot ainda detecta regressão), mas torna o diff menos
legível. Para testes de asserção, mantivemos os testes funcionais separados.

**Solução:** Manter ambos: snapshot tests (detecção de regressão) + assertion tests
(validação isolada de estados), aceitando que os snapshots são mais pesados que o ideal.
