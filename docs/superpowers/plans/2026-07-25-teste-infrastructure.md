# Test Infrastructure — Diagnóstico e Plano de Correção

> **For agentic workers:** Use subagent-driven-development ou executing-plans para implementar task por task.

**Goal:** Diagnosticar, corrigir e completar a infraestrutura de testes do Severinno Marketplace. O projeto já possui 97 arquivos de teste com 1.143 testes, mas 29 arquivos estão falhando (406 testes quebrados).

**Diagnóstico atual:**
- ✅ 67 arquivos de teste passando (730 testes)
- ❌ 29 arquivos de teste falhando (406 testes)
- ⏭️ 1 arquivo skipped (7 testes)
- 6 suites E2E Playwright (17 spec files, 5 browsers cada)

**Tech Stack:** Vitest 3.1.1, Playwright 1.52.0, @testing-library/react 16, jsdom 26, React 19

---

## Global Constraints

- NUNCA modificar o código de produção para fazer testes passarem — os testes devem refletir o comportamento real
- Manter os mocks existentes em `vitest.setup.ts` e `src/lib/__tests__/__mocks__/`
- Usar `test-utils.tsx` existentes para mock de stores e providers
- Manter a estrutura de diretórios de teste colocalizada (`__tests__` junto ao módulo testado)
- E2E executam contra dev server rodando na porta 3000

---

### Task 1: Diagnóstico completo dos 29 arquivos falhando

**Files:** (read-only)
- Run: `npx vitest run --reporter=verbose 2>&1 | grep "FAIL" > test-failures.txt`

**Goal:** Categorizar cada falha por causa raiz.

- [ ] **Step 1: Rodar suite completa e categorizar falhas**

```bash
npx vitest run 2>&1 | tee test-output.txt

# Extrair apenas os nomes dos arquivos que falharam
grep "FAIL" test-output.txt | sort > failing-files.txt
```

Categorias esperadas de erro:
- **Categoria A — "Invalid hook call" / "Cannot read useState"** (~70% das falhas): React 19 + jsdom 26 incompatibilidade. Componentes que usam hooks (useState, useEffect) dentro de contextos que o jsdom não suporta (ex: WebSocket, AudioContext, IntersectionObserver).
- **Categoria B — Timeout / Async:** Testes que esperam eventos assíncronos que não disparam no ambiente de teste.
- **Categoria C — Missing mocks:** Componentes que dependem de módulos não mockados (ex: maplibre-gl, socket.io-client).
- **Categoria D — Router/Navigation:** Testes que dependem de next/navigation não mockado.

- [ ] **Step 2: Gerar relatório de categorias**

```bash
echo "=== Failing Files by Category ==="
echo ""
echo "Category A (Invalid hook call):"
grep -l "Invalid hook call\|Cannot read.*useState" test-output.txt | while read f; do echo "  - $f"; done
echo ""
echo "Category B (Timeout):"
grep -l "timeout\|Timed out" test-output.txt | while read f; do echo "  - $f"; done
echo ""
echo "Category C (Missing mock):"
grep -l "Cannot find module\|is not defined\|Module.*not found" test-output.txt | while read f; do echo "  - $f"; done  
```

- [ ] **Step 3: Commitar relatório**

```bash
git add test-failures.txt
git commit -m "chore: add test failure diagnostic report"
```

---

### Task 2: Fix — Mock global para módulos faltantes no vitest.setup.ts

**Files:**
- Modify: `vitest.setup.ts`
- Check: `src/lib/__tests__/__mocks__/server-only.ts`

**Goal:** Adicionar mocks globais para os módulos que faltam e causam "Invalid hook call".

- [ ] **Step 1: Adicionar mocks para os módulos mais comuns**

```typescript
// Adicionar ao vitest.setup.ts:

// ── Mock next/navigation ────────────────────────────────────────────
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));

// ── Mock next/image ─────────────────────────────────────────────────
vi.mock("next/image", () => ({
  __esModule: true,
  default: (props: any) => {
    const { fill, priority, ...rest } = props;
    return <img {...rest} />;
  },
}));

// ── Mock maplibre-gl ───────────────────────────────────────────────
vi.mock("maplibre-gl", () => ({
  default: {
    Map: vi.fn(),
    Marker: vi.fn(),
    Popup: vi.fn(),
    NavigationControl: vi.fn(),
    GeolocateControl: vi.fn(),
  },
  Map: vi.fn(),
  Marker: vi.fn(),
  Popup: vi.fn(),
  NavigationControl: vi.fn(),
  GeolocateControl: vi.fn(),
}));

// ── Mock socket.io-client ──────────────────────────────────────────
vi.mock("socket.io-client", () => ({
  io: vi.fn(() => ({
    on: vi.fn(),
    emit: vi.fn(),
    off: vi.fn(),
    disconnect: vi.fn(),
    connect: vi.fn(),
    id: "mock-socket-id",
  })),
  Socket: vi.fn(),
}));

// ── Mock Web Audio API ─────────────────────────────────────────────
// Para testes de som/áudio que usam AudioContext
globalThis.AudioContext = vi.fn().mockImplementation(() => ({
  createBufferSource: vi.fn(() => ({
    connect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  })),
  createGain: vi.fn(() => ({
    connect: vi.fn(),
    gain: { value: 0, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() },
  })),
  destination: {},
  currentTime: 0,
  close: vi.fn(),
  resume: vi.fn(),
})) as any;

// ── Mock IntersectionObserver ───────────────────────────────────────
globalThis.IntersectionObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
})) as any;

// ── Mock WebSocket (nativo) ────────────────────────────────────────
globalThis.WebSocket = vi.fn().mockImplementation(() => ({
  send: vi.fn(),
  close: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
})) as any;
```

- [ ] **Step 2: Rodar testes para verificar se as falhas Category A e C reduziram**

```bash
npx vitest run 2>&1 | grep -E "FAIL|Test Files|Tests "
```

Expected: Redução de 50-70% das falhas.

- [ ] **Step 3: Adicionar mocks adicionais conforme necessário** (iterativo)

Para cada arquivo que ainda falha com "Invalid hook call" ou "not defined", identificar o módulo específico e adicionar mock.

- [ ] **Step 4: Commit**

```bash
git add vitest.setup.ts
git commit -m "test: add global mocks for next/navigation, maplibre-gl, socket.io, AudioContext, IntersectionObserver"
```

---

### Task 3: Fix — Component accessibility tests (Category A principal)

**Files:**
- Modify: `src/components/modals/__tests__/accessibility.test.tsx`
- Modify: `src/app/__tests__/accessibility.test.tsx`
- Modify: `src/app/__tests__/loading-accessibility.test.tsx`
- Modify: `src/app/__tests__/loading-base.test.tsx`
- Modify: `src/components/vitrine/__tests__/vitrine-accessibility.test.tsx`

**Goal:** Consertar os testes de acessibilidade que falham por "Invalid hook call".

- [ ] **Step 1: Diagnosticar causa específica**

Para cada arquivo, identificar qual hook específico está causando o erro (não o mock genérico, mas o componente real que o teste renderiza).

Problema comum: componentes que usam hooks condicionalmente ou que dependem de Context não mockado.

- [ ] **Step 2: Corrigir cada arquivo de teste**

Padrão de correção para testes de acessibilidade:
```tsx
// Se o componente precisa de ThemeProvider
import { ThemeProvider } from "next-themes"

function TestWrapper({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="light">
      {children}
    </ThemeProvider>
  )
}

// Usar no teste:
render(
  <TestWrapper>
    <ComponentUnderTest />
  </TestWrapper>
)
```

- [ ] **Step 3: Verificar**

```bash
npx vitest run src/components/modals/__tests__/accessibility.test.tsx src/app/__tests__/accessibility.test.tsx src/components/vitrine/__tests__/vitrine-accessibility.test.tsx
```

- [ ] **Step 4: Commit**

```bash
git add src/components/modals/__tests__/accessibility.test.tsx
git add src/app/__tests__/accessibility.test.tsx
git add src/components/vitrine/__tests__/vitrine-accessibility.test.tsx
git commit -m "test: fix accessibility test setup with proper providers"
```

---

### Task 4: Fix — Sound/audio hook tests (use-coin-sound, sound-context)

**Files:**
- Read: `src/lib/__tests__/use-coin-sound.test.ts`
- Read: `src/lib/__tests__/sound-context.test.tsx`
- Read: `src/hooks/use-coin-sound.ts` (provável nome do hook real)
- Read: `src/lib/sound-context.tsx` (provável nome do context real)
- Modify: conforme necessário

**Goal:** Consertar testes de hooks de som que dependem de AudioContext.

- [ ] **Step 1: Verificar se o AudioContext mock global (Task 2) resolve**

```bash
npx vitest run src/lib/__tests__/use-coin-sound.test.ts src/lib/__tests__/sound-context.test.tsx
```

- [ ] **Step 2: Se ainda falhar, adicionar mocks específicos**

Possível causa: o hook usa `new Audio()` (HTML5 Audio), não `AudioContext`. Adicionar:
```typescript
// Mock HTMLAudioElement
globalThis.Audio = vi.fn().mockImplementation(() => ({
  play: vi.fn().mockResolvedValue(undefined),
  pause: vi.fn(),
  load: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  currentTime: 0,
  volume: 1,
  src: "",
})) as any;
```

- [ ] **Step 3: Verificar e commit**

```bash
npx vitest run src/lib/__tests__/use-coin-sound.test.ts src/lib/__tests__/sound-context.test.tsx
```

---

### Task 5: Fix — Loading shell / Loading base tests

**Files:**
- Modify: `src/app/__tests__/loading.test.tsx`
- Modify: `src/app/__tests__/loading-shell.test.tsx`
- Modify: `src/app/__tests__/loading-base.test.tsx`

**Goal:** Consertar testes de loading que dependem de AppShell ou Providers.

- [ ] **Step 1: Diagnosticar causa**

Verificar se os componentes de loading dependem de stores (useAuthStore, useViewStore) que não estão mockadas.

- [ ] **Step 2: Aplicar correção**

Envolver em providers mockados ou usar `TestQueryProvider` + mocks de store.

- [ ] **Step 3: Verificar**

```bash
npx vitest run src/app/__tests__/loading.test.tsx src/app/__tests__/loading-shell.test.tsx
```

---

### Task 6: Adicionar script de CI e GitHub Actions

**Files:**
- Create: `.github/workflows/test.yml`

**Goal:** Rodar testes automaticamente em CI (push e PR).

- [ ] **Step 1: Criar workflow de CI**

```yaml
# .github/workflows/test.yml
name: Test

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    
    services:
      postgres:
        image: postgis/postgis:16-3.4
        env:
          POSTGRES_DB: severinno_test
          POSTGRES_USER: severinno
          POSTGRES_PASSWORD: severinno
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
      redis:
        image: valkey/valkey:7.2-alpine
        ports:
          - 6379:6379
        options: >-
          --health-cmd "valkey-cli ping"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    steps:
      - uses: actions/checkout@v4
      
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest
      
      - name: Install dependencies
        run: bun install --frozen-lockfile
      
      - name: Generate Prisma client
        run: bunx prisma generate
      
      - name: Run unit tests
        run: bun run test:unit
        env:
          DATABASE_URL: postgresql://severinno:severinno@localhost:5432/severinno_test
          SESSION_SECRET: ci-secret-at-least-32-chars-long-for-testing
      
      - name: Run full test suite
        run: bun run test:run
        env:
          DATABASE_URL: postgresql://severinno:severinno@localhost:5432/severinno_test
          SESSION_SECRET: ci-secret-at-least-32-chars-long-for-testing
      
      - name: Upload coverage
        uses: actions/upload-artifact@v4
        if: always()
        with:
          name: coverage
          path: coverage/
      
      - name: Install Playwright browsers
        run: npx playwright install --with-deps chromium
      
      - name: Run E2E tests (Chromium only)
        run: bun run e2e --project=chromium
        env:
          CI: true
          SESSION_SECRET: ci-secret-at-least-32-chars-long-for-testing
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/test.yml
git commit -m "ci: add GitHub Actions workflow for tests"
```

---

### Task 7: Adicionar testes de cobertura para áreas críticas descobertas

**Files:** (conforme necessário)
- Create/Modify: testes nos diretórios __tests__ correspondentes

**Goal:** Garantir cobertura mínima de 70% nas libs core e 50% nos componentes.

- [ ] **Step 1: Rodar relatório de cobertura**

```bash
npx vitest run --coverage 2>&1 | tail -60
```

Identificar áreas com cobertura baixa.

- [ ] **Step 2: Adicionar testes prioritários**

Prioridade:
1. **Libs core** (auth, crypto, geo, validators, format) — se alguma estiver < 80%
2. **API routes** mais críticas (auth, providers, bookings, quotes)
3. **Stores** (auth, geo, view, ui)
4. **Hooks** principais (use-realtime, use-mobile)

Para cada área:
```typescript
// Exemplo: test para auth lib
import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "../crypto";

describe("crypto", () => {
  it("hashes password and verifies correctly", async () => {
    const password = "minha-senha-secreta-123";
    const hash = await hashPassword(password);
    expect(hash).not.toBe(password);
    
    const valid = await verifyPassword(password, hash);
    expect(valid).toBe(true);
  });
  
  it("rejects wrong password", async () => {
    const hash = await hashPassword("correct-password");
    const valid = await verifyPassword("wrong-password", hash);
    expect(valid).toBe(false);
  });
});
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/__tests__/crypto.test.ts
git commit -m "test: add crypto unit tests for hashPassword and verifyPassword"
```

---

### Task 8: Documentação de testes

**Files:**
- Create: `docs/testing-guide.md`

**Goal:** Documentar como rodar, escrever e manter testes no projeto.

- [ ] **Step 1: Criar guia de testes**

```markdown
# Testing Guide — Severinno Marketplace

## Quick Start

```bash
# Rodar todos os testes
bun run test:run

# Rodar apenas unitários (exclui component tests)
bun run test:unit

# Rodar com watch mode
bun run test:watch

# Cobertura
bun run test:coverage

# E2E (requer dev server rodando)
bun run dev &
bun run e2e

# E2E com UI mode
bun run e2e:ui
```

## Estrutura

```
src/
├── lib/__tests__/         # Unit tests para libs (pure functions)
├── app/api/__tests__/     # Integration tests para API routes
├── components/*/__tests__/ # Component tests (RTL + vitest)
├── hooks/__tests__/       # Hook tests
├── store/__tests__/       # Store tests (Zustand)
└── machines/__tests__/    # XState machine tests
e2e/                       # Playwright E2E tests
```

## Conventions

1. **Testes colocalizados**: `__tests__/` junto ao módulo testado
2. **Nomenclatura**: `<module>.test.ts` ou `<module>.test.tsx`
3. **Mock stores**: Usar `createMockAuthStore`, `createMockUIStore`, `createMockViewStore` de `test-utils.tsx`
4. **Providers**: Envolver em `TestQueryProvider` para TanStack Query
5. **Accessibility**: Usar `vitest-axe` + `@testing-library/jest-dom`
6. **API tests**: Usar `createMockRequest` + `parseResponse` de `api-test-utils.ts`

## Debugging

```bash
# Rodar um arquivo específico
npx vitest run src/lib/__tests__/api-server.test.ts

# Rodar um test específico
npx vitest run src/lib/__tests__/api-server.test.ts -t "handleError"

# Com UI (Vitest UI)
npx vitest --ui
```
```

- [ ] **Step 2: Atualizar .agents/memory/project-conventions.md** com seção de testes

Adicionar ao final:
```markdown
## Testes

- **Framework:** Vitest 3 + Playwright + @testing-library/react
- **Comando:** `bun run test:run` (full), `bun run test:unit` (só unit), `bun run e2e` (E2E)
- **Setup:** `vitest.setup.ts` com mocks globais (ioredis, next/navigation, maplibre-gl, etc.)
- **Mocks de store:** `createMockAuthStore/UIStore/ViewStore` em `test-utils.tsx`
- **API test utils:** `createMockRequest` + `parseResponse` em `api-test-utils.ts`
- **Estrutura:** `__tests__/` colocalizado com o módulo
```

- [ ] **Step 3: Commit**

```bash
git add docs/testing-guide.md
git add .agents/memory/project-conventions.md
git commit -m "docs: add testing guide and update memory with test conventions"
```

---

### Task 9: Verificação final — rodar suite e garantir 0 falhas

**Goal:** Verificar que todos os 97 arquivos de teste passam.

- [ ] **Step 1: Rodar suite completa**

```bash
npx vitest run 2>&1 | tee final-test-output.txt
```

Expected:
```
Test Files  97 passed (97)
     Tests  1143 passed (1143)
```

- [ ] **Step 2: Rodar unit config separadamente**

```bash
npx vitest run --config vitest.config.unit.ts
```

- [ ] **Step 3: Se ainda houver falhas, iterar Tasks 2-5**

Cada falha residual deve ser investigada e corrigida individualmente.

- [ ] **Step 4: Commit final**

```bash
git add -A
git commit -m "test: achieve 100% test pass rate across 97 test files"
```
