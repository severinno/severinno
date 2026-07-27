# Testing Guide — Severinno Marketplace

> Estratégia, padrões e lições aprendidas sobre testes no projeto.

## Stack

| Camada | Ferramenta | Escopo |
|--------|-----------|--------|
| **Unitários** | Vitest 3.x | API routes, libs, hooks |
| **Componentes** | Vitest + jsdom + Testing Library | React components |
| **E2E** | Playwright | Fluxos críticos (cache, auth, bookings) |
| **Acessibilidade** | `vitest-axe` | Componentes de UI |

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
  resetDbMocks()  // <-- fresh vi.fn() para cada teste
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

| Arquivo | Padrão usado |
|---------|-------------|
| `webhooks-lytex-route.test.ts` | `resetDbMocks()` com fresh `vi.fn()` |
| `admin-finance-route.test.ts` | `resetDbMocks()` com fresh `vi.fn()` |
| `admin-finance-export-route.test.ts` | `resetDbMocks()` com fresh `vi.fn()` |
| `admin-finance-provider-transactions-route.test.ts` | `resetDbMocks()` com fresh `vi.fn()` |
| Demais testes (`bookings-route`, `auth-route`, etc.) | `vi.clearAllMocks()` + mocks simples — funcionam porque usam `let _mockVar` que é reatribuído |

### 2. `mockResolvedValueOnce` TEM PRIORIDADE sobre `mockResolvedValue`

**Comportamento:**

Quando um mock tem tanto um valor default (`mockResolvedValue`) quanto valores
one-time (`mockResolvedValueOnce`), os valores one-time são consumidos PRIMEIRO:

```typescript
const fn = vi.fn()
  .mockResolvedValue("default")   // ← usado APÓS exaurir os once
  .mockResolvedValueOnce("primeiro")  // 1ª chamada → "primeiro"
  .mockResolvedValueOnce("segundo")   // 2ª chamada → "segundo"
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
  db.payment = { findMany: vi.fn(), update: vi.fn(), upsert: vi.fn(), groupBy: vi.fn(), count: vi.fn() }
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
  _mockRole = "ADMIN"  // ou "CLIENT", "PROVIDER", null
})
```

> **Nota:** Esse padrão funciona mesmo sem `vi.clearAllMocks()` porque
> a variável `let` é reatribuída. Mas a implementação do mock (`mockImplementation`)
> precisa ser preservada — outro motivo para não usar `vi.clearAllMocks()`.

---

## CLI Commands

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
