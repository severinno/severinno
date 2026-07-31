# 🎭 Admin Test Mocks — `mocks.tsx`

Este diretório contém mocks compartilhados para testes de componentes admin,
centralizados em [`mocks.tsx`](./mocks.tsx). O objetivo é evitar duplicação de
mocks entre os 12+ arquivos de teste e garantir que todos os testes usem as
mesmas implementações stub para dependências externas (lucide-react,
AlertDialog, sonner, fetch, etc.).

---

## Barrel `index.ts`

O [`index.ts`](./index.ts) re-exporta `mocks.tsx` e `fixtures.ts` como um
barrel, permitindo import mais curto nos testes:

```typescript
// Antes — imports separados
import { DEFAULT_GIST_DEGRADATION_PROPS } from "@/components/admin/__tests__/mocks"
import { FIXTURE_BENCHMARK } from "./fixtures"

// Depois — barrel único
import { DEFAULT_GIST_DEGRADATION_PROPS, FIXTURE_BENCHMARK } from "./index"
```

**⚠️ Atenção — NÃO use o barrel dentro de factories de `vi.mock()`:**

```typescript
vi.mock("lucide-react", async () => {
  const { MockIcon } = await import("./mocks") // ← direto, NÃO ./index
  return { Database: MockIcon }
})
```

O Vitest hoista as chamadas `vi.mock()` para o topo do arquivo; importar o
barrel aí carregaria `fixtures.ts` (que importa `vi` e cria mocks no escopo do
módulo) antes da hora. Use sempre o import direto `"./mocks"` nas factories.

---

## Índice

- [Convenção: `vi.mock` assíncrono](#convenção-vimock-assíncrono)
- [Exports](#exports)
  - [`MockIcon`](#mockicon)
  - [`createAlertDialogMock()`](#createalertdialogmock)
  - [`toastMock`](#toastmock)
  - [`FetchResponseFn`](#fetchresponsefn)
  - [`buildReindexSuccessResponse()`](#buildreindexsuccessresponse)
  - [`buildReindexFailureResponse()`](#buildreindexfailureresponse)
  - [`buildReindexSlowResponse()`](#buildreindexslowresponse)
  - [`DEFAULT_GIST_DEGRADATION_PROPS`](#default_gist_degradation_props)
  - [`DEFAULT_GIST_REINDEX_PROPS`](#default_gist_reindex_props)
  - [`clickExecuteReindex()`](#clickexecutereindex)
- [Exemplos completos](#exemplos-completos)
- [Boas práticas](#boas-práticas)

---

## Convenção: `vi.mock` assíncrono

O Vitest **hoista** chamadas `vi.mock()` para o topo do arquivo, antes de
qualquer `import`. Isso significa que você **não pode** usar variáveis
definidas no mesmo módulo dentro da factory — elas ainda não existem.

A solução é usar **`vi.mock` assíncrono** com import dinâmico:

```typescript
vi.mock("lucide-react", async () => {
  const { MockIcon } = await import("./mocks")
  return { Database: MockIcon, RefreshCw: MockIcon /* , … */ }
})
```

Dentro da `async () =>`, o `await import("./mocks")` resolve porque o módulo
`mocks.tsx` já foi avaliado antes do Vitest executar as factories de mock
(a ordem das chamadas `vi.mock` não importa — todas executam após o módulo
ser totalmente carregado).

---

## Exports

### `MockIcon`

Componente React placeholder para ícones do **lucide-react**.

```typescript
export const MockIcon: React.FC<{ className?: string; "data-testid"?: string }>
```

- Renderiza um `<span>` com `data-testid="lucide-icon"` e `data-class` contendo
  o className original
- O `data-testid` pode ser sobrescrito via prop para diferenciar ícones
- `MockIcon.displayName = "LucideIcon"` — útil para debug

**Setup no teste:**

```typescript
vi.mock("lucide-react", async () => {
  const { MockIcon } = await import("./mocks")
  return {
    Database: MockIcon,
    RefreshCw: MockIcon,
    CheckCircle2: MockIcon,
    AlertTriangle: MockIcon,
    TrendingUp: MockIcon,
    BarChart3: MockIcon,
    // … qualquer outro ícone usado no componente
  }
})
```

**Verificação no teste:**

```typescript
// Contar ícones renderizados
const icons = screen.getAllByTestId("lucide-icon")
expect(icons.length).toBeGreaterThanOrEqual(1)

// Verificar classe CSS no ícone
const spinners = screen.getAllByTestId("lucide-icon")
const animatedSpinner = spinners.find((el) =>
  el.getAttribute("data-class")?.includes("animate-spin"),
)
expect(animatedSpinner).toBeInTheDocument()
```

---

### `createAlertDialogMock()`

Função que retorna um objeto com todos os componentes do
`@/components/ui/alert-dialog` como stubs baseados em `<div>` e `<button>`.

**Retorna:**

```typescript
{
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
}
```

**Comportamento do stub:**

| Componente           | Comportamento                                                                                                         |
| :------------------- | :-------------------------------------------------------------------------------------------------------------------- |
| `AlertDialog`        | `<div data-testid="alert-dialog" data-open="true                                                                      | false">`— quando`open=true`, adiciona `<div data-testid="alert-dialog-open" />` |
| `AlertDialogTrigger` | Se `asChild`: clona o child e injeta `onClick` que chama `onOpenChange(true)`. Caso contrário: `<button onClick={…}>` |
| `AlertDialogContent` | `<div data-testid="alert-dialog-content">`                                                                            |
| `AlertDialogFooter`  | `<div data-testid="alert-dialog-footer">`                                                                             |
| `AlertDialogAction`  | `<button data-testid="alert-dialog-action">` — respeita `disabled` e `onClick`                                        |
| `AlertDialogCancel`  | `<button>` simples                                                                                                    |

**Setup no teste:**

```typescript
vi.mock("@/components/ui/alert-dialog", async () => {
  const { createAlertDialogMock } = await import("./mocks")
  return createAlertDialogMock()
})
```

**Verificação no teste:**

```typescript
// Verificar estado do diálogo
expect(screen.getByTestId("alert-dialog").getAttribute("data-open")).toBe("true")

// Clicar no botão de confirmação
fireEvent.click(screen.getByTestId("alert-dialog-action"))

// Verificar botão desabilitado durante loading
expect(screen.getByTestId("alert-dialog-action")).toBeDisabled()
```

---

### `toastMock`

Mock singleton do **sonner** toaster. Cada método é um `vi.fn()` silencioso.

```typescript
export const toastMock = {
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}
```

**Setup no teste:**

```typescript
vi.mock("sonner", async () => {
  const { toastMock } = await import("./mocks")
  return { toast: toastMock }
})
```

**Verificação no teste:**

```typescript
import { toast } from "sonner"

expect(toast.success).toHaveBeenCalledWith("Índices GiST reindexados com sucesso")
expect(toast.error).toHaveBeenCalledWith("Falha ao reindexar índices GiST")
```

---

### `FetchResponseFn`

Type alias para a função de resposta do mock de `fetch`.

```typescript
export type FetchResponseFn = () => Promise<Response>
```

Usado em conjunto com as funções `buildReindex*Response` e uma variável
`let mockFetchResponse: FetchResponseFn` no escopo do `describe`:

```typescript
import type { FetchResponseFn } from "./mocks"

let mockFetchResponse: FetchResponseFn

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(() => mockFetchResponse()),
  )
  mockFetchResponse = () => Promise.resolve(buildReindexSuccessResponse())
})

afterEach(() => {
  vi.unstubAllGlobals()
})
```

**Note:** `vi.stubGlobal`/`vi.unstubAllGlobals` são chamados dentro de
`beforeEach`/`afterEach` para que cada teste tenha um fetch mock fresco.

---

### `buildReindexSuccessResponse()`

Retorna uma `Response` com status 200 simulando um REINDEX bem-sucedido.

```typescript
export function buildReindexSuccessResponse(): Response
```

**Response body:**

```json
{
  "success": true,
  "message": "3/3 índices reindexados com sucesso.",
  "indexes": [
    { "name": "idx_user_location_gist", "durationMs": 1234, "ok": true },
    { "name": "idx_booking_location_gist", "durationMs": 567, "ok": true },
    { "name": "idx_quoterequest_location_gist", "durationMs": 321, "ok": true }
  ],
  "totalDurationMs": 2122
}
```

---

### `buildReindexFailureResponse()`

Retorna uma `Response` com status 500 simulando falha no REINDEX.

```typescript
export function buildReindexFailureResponse(message = "Erro interno"): Response
```

**Uso típico:** sobrescrever `mockFetchResponse` em um teste específico:

```typescript
it("shows failure when API returns success:false", async () => {
  mockFetchResponse = () => Promise.resolve(buildReindexFailureResponse("deadlock detected"))
  // … render, click, assert
})
```

---

### `buildReindexSlowResponse()`

Retorna uma `Promise<Response>` que resolve após um atraso configurável.
Útil para testar **estados de loading**.

```typescript
export function buildReindexSlowResponse(delayMs = 100): Promise<Response>
```

**Uso típico:**

```typescript
// Fetch demora 100ms — tempo suficiente para capturar o estado "Reindexando…"
mockFetchResponse = () => buildReindexSlowResponse(100)

// Fetch nunca resolve — mantém loading indefinido
mockFetchResponse = () => new Promise(() => {})
```

---

### `DEFAULT_GIST_DEGRADATION_PROPS`

Props padrão para renderizar o `GistDegradationPanel` em testes. Valores
realistas que simulam degradação (P95=90ms, 4 de 5 escalas excedem o modelo).

```typescript
export const DEFAULT_GIST_DEGRADATION_PROPS = {
  gistDegraded: true,
  p95Mean: 90,
  radiusKm: 15,
  snapPct: 9,
  maxModelAtSelectivity: 35.2,
  exceedingCount: 4,
}
```

**Uso típico:**

```typescript
import { DEFAULT_GIST_DEGRADATION_PROPS } from "./mocks"

describe("meu teste", () => {
  it("renderiza com degradação", () => {
    render(<GistDegradationPanel {...DEFAULT_GIST_DEGRADATION_PROPS} />)
    expect(screen.getByText(/degrada/)).toBeInTheDocument()
  })

  it("não renderiza quando sem degradação", () => {
    render(<GistDegradationPanel {...DEFAULT_GIST_DEGRADATION_PROPS} gistDegraded={false} />)
    expect(screen.queryByText(/degrada/)).not.toBeInTheDocument()
  })
})
```

---

### `DEFAULT_GIST_REINDEX_PROPS`

Props padrão para renderizar o `GistReindexButton` em testes. Como ambas as
props são opcionais, o valor padrão é um objeto vazio.

```typescript
export const DEFAULT_GIST_REINDEX_PROPS: Record<string, never> = {}
```

**Uso típico:**

```typescript
import { DEFAULT_GIST_REINDEX_PROPS } from "./mocks"

it("estado inicial", () => {
  render(<GistReindexButton {...DEFAULT_GIST_REINDEX_PROPS} />)
  expect(screen.getByText("Executar REINDEX")).toBeInTheDocument()
})

it("refetching", () => {
  render(<GistReindexButton {...DEFAULT_GIST_REINDEX_PROPS} isRefetching={true} />)
  expect(screen.getByText("Atualizando métricas…")).toBeInTheDocument()
})
```

---

### `clickExecuteReindex()`

Helper que simula o fluxo completo de clique no REINDEX:

1. Clique no botão "Executar REINDEX" (abre o AlertDialog)
2. Clique no botão de confirmação (`data-testid="alert-dialog-action"`)
3. Aguarda até que o resultado (sucesso/Falha/Erro) apareça no DOM

```typescript
export async function clickExecuteReindex(): Promise<void>
```

**Uso típico:**

```typescript
import { clickExecuteReindex } from "./mocks"

it("sucesso", async () => {
  render(<GistReindexButton />)
  await clickExecuteReindex()

  expect(screen.getByText(/sucesso/)).toBeInTheDocument()
})
```

**Importante:** `clickExecuteReindex` é `async` — use `await` no teste.
Sem o `await`, a asserção executa antes do resultado aparecer.

---

## Exemplos completos

### Exemplo 1: Teste mínimo de `GistReindexButton`

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import React from "react"
import { render, screen, fireEvent, cleanup } from "@/__tests__/test-utils"
import { GistReindexButton } from "../gist-reindex-button"

// ── Mocks ──────────────────────────────────────────────

vi.mock("lucide-react", async () => {
  const { MockIcon } = await import("./mocks")
  return { Database: MockIcon, RefreshCw: MockIcon }
})

vi.mock("@/components/ui/alert-dialog", async () => {
  const { createAlertDialogMock } = await import("./mocks")
  return createAlertDialogMock()
})

vi.mock("sonner", async () => {
  const { toastMock } = await import("./mocks")
  return { toast: toastMock }
})

// ── Fetch mock ─────────────────────────────────────────

import type { FetchResponseFn } from "./mocks"
import {
  buildReindexSuccessResponse,
  clickExecuteReindex,
  DEFAULT_GIST_REINDEX_PROPS,
} from "./mocks"

let mockFetchResponse: FetchResponseFn

// ── Tests ──────────────────────────────────────────────

describe("MeuComponente", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => mockFetchResponse()),
    )
    mockFetchResponse = () => Promise.resolve(buildReindexSuccessResponse())
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it("renderiza botão", () => {
    render(<GistReindexButton {...DEFAULT_GIST_REINDEX_PROPS} />)
    expect(screen.getByText("Executar REINDEX")).toBeInTheDocument()
  })
})
```

### Exemplo 2: Snapshot test com `asFragment`

```typescript
it("estado inicial — snapshot", () => {
  const { asFragment } = render(
    <GistReindexButton {...DEFAULT_GIST_REINDEX_PROPS} />,
  )
  expect(asFragment()).toMatchSnapshot("meu-componente-initial")
})
```

---

## Boas práticas

1. **Sempre use `vi.mock` assíncrono** com `await import("./mocks")` — nunca
   importe diretamente no topo do arquivo de teste, pois o Vitest hoista
   `vi.mock` antes dos imports estáticos e a factory não encontrará o módulo.

2. **Mock de fetch**: use `vi.stubGlobal` dentro de `beforeEach` e
   `vi.unstubAllGlobals` em `afterEach`. Cada teste recebe uma instância nova.

3. **Mock de toast**: importe `{ toast } from "sonner"` no teste — o mock
   substitui o módulo real. Use `toast.success`, `toast.error` nas asserções.

4. **Sempre use DEFAULT_PROPS**: ao testar componentes que têm
   `DEFAULT_*_PROPS` definidos, importe-os e spread no JSX. Isso garante que
   todos os testes usem os mesmos defaults e facilita atualizações futuras.

5. **`clickExecuteReindex()` é async**: sempre use `await` ao chamar. A função
   espera até que o indicador de resultado apareça no DOM (timeout: 2s).

6. **Snapshot naming**: use nomes descritivos com prefixo do componente:
   - `"gist-reindex-button-initial"`
   - `"gist-reindex-button-reindexing"`
   - `"gist-degradation-panel-expanded"`

7. **Nunca importe `@testing-library/jest-dom` diretamente** — a centralização
   está em `types/vitest.d.ts`. Se um arquivo de teste precisar dos matchers,
   a configuração global em `vitest.setup.ts` já os carrega.

---

## Fluxo de trabalho

```bash
# Rodar testes admin
npx vitest run --config vitest.config.unit.ts src/components/admin/__tests__/

# Atualizar snapshots
npx vitest run --config vitest.config.unit.ts --update \\
  src/components/admin/__tests__/*snapshot*

# Cobertura
npx vitest run --config vitest.config.unit.ts --coverage \\
  src/components/admin/__tests__/
```
