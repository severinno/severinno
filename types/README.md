# Type Declarations

Este diretório contém declarações de tipo globais do projeto, carregadas automaticamente pelo `tsconfig.json`.

## Estrutura

```
types/                          ← Declarações globais (augmentações)
├── README.md
└── vitest.d.ts                 ← jest-dom + vitest-axe matchers

src/types/                      ← Declarações de módulo (declare module)
├── css-modules.d.ts            ← maplibre-gl CSS import
└── modules.d.ts                ← amqplib, nodemailer, web-push

next-env.d.ts                   ← Gerado pelo Next.js (não editar manualmente)
```

## Como Funciona

### 1. Inclusão no `tsconfig.json`

```jsonc
{
  "include": [
    "types/**/*.d.ts", // <-- carrega todas as declarações daqui
    "**/*.ts",
    "**/*.tsx",
    // ...
  ],
}
```

Arquivos `.d.ts` em `types/` são carregados **globalmente** — não precisam de import nos arquivos de teste ou fonte.

### 2. `types/vitest.d.ts` — Augmentação de Matchers de Teste

Centraliza referências de tipo para matchers personalizados do Vitest:

```ts
/// <reference types="@testing-library/jest-dom/vitest" />
/// <reference types="vitest-axe/extend-expect" />
```

- **jest-dom**: `toBeInTheDocument`, `toHaveAttribute`, `toBeVisible`, `toHaveTextContent`, etc.
- **vitest-axe**: `toHaveNoViolations`

Ambas augmentam a interface `Vi.Assertion` do Vitest via _declaration merging_ do TypeScript. Como são namespaces diferentes, não há conflito.

#### Runtime (setup)

As augmentações de tipo **não** fornecem o comportamento em runtime — é necessário o `vitest.setup.ts`:

```ts
// vitest.setup.ts
import * as matchers from "@testing-library/jest-dom/matchers"
expect.extend(matchers) // habilita toBeInTheDocument etc. em runtime
```

O `vitest-axe` já faz `expect.extend` internamente — nenhum setup adicional é necessário para `toHaveNoViolations`.

### 3. `src/types/` — Declarações de Módulo

Usado para pacotes npm que não têm tipos publicados ou cujos tipos precisam de override:

```ts
// src/types/css-modules.d.ts
declare module "maplibre-gl/dist/maplibre-gl.css"

// src/types/modules.d.ts
declare module "amqplib" { ... }
declare module "nodemailer" { ... }
declare module "web-push" { ... }
```

## Quando Criar um Novo `.d.ts`

### Nova augmentação de matcher de teste

Adicione uma linha `/// <reference types="..." />` em `types/vitest.d.ts`:

```ts
/// <reference types="@testing-library/jest-dom/vitest" />
/// <reference types="vitest-axe/extend-expect" />
/// <reference types="novo-pacote/tipos" />  ← adicione aqui
```

### Nova declaração de módulo

Crie um arquivo em `src/types/` (ou adicione ao existente se for relacionado):

```ts
// src/types/meu-pacote.d.ts
declare module "meu-pacote" {
  export function minhaFuncao(): string
}
```

### Nova declaração global (fora de teste)

Crie um arquivo em `types/`:

```ts
// types/minha-global.d.ts
interface Window {
  minhaPropriedade: string
}
```

## Regras

1. **Nunca importe `@testing-library/jest-dom` ou `vitest-axe` diretamente em arquivos de teste** — as augmentações já estão centralizadas em `types/vitest.d.ts`
2. **Prefira criar arquivos separados** em vez de um arquivo `globals.d.ts` monolítico
3. **Declarações de módulo** vão em `src/types/` (junto ao código-fonte)
4. **Augmentações de matcher** vão em `types/vitest.d.ts` (globais, para todos os testes)
5. **Não edite `next-env.d.ts`** — é gerado pelo Next.js e sobrescrito a cada build
