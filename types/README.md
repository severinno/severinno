# Declarações de Tipo (`types/`)

Diretório centralizado para todas as declarações `.d.ts` do projeto.  
Carregado automaticamente pelo `tsconfig.json` através do padrão `"types/**/*.d.ts"`.

---

## Arquivos

### `vitest.d.ts`

Augmentação de tipo para os matchers do ecossistema Vitest.

```ts
/// <reference types="@testing-library/jest-dom/vitest" />
/// <reference types="vitest-axe/extend-expect" />
```

| Referência | Matchers que habilita | Runtime |
|:-----------|:----------------------|:--------|
| `@testing-library/jest-dom/vitest` | `toBeInTheDocument`, `toHaveAttribute`, `toBeDisabled`, `toHaveTextContent`, `toHaveValue`, `toBeVisible`, `toHaveClass`, `toHaveStyle`, etc. | `vitest.setup.ts` via `expect.extend(matchers)` |
| `vitest-axe/extend-expect` | `toHaveNoViolations` | OPCIONAL — cada teste importa o `axe` manualmente |

**Regra:** **Nunca** importe `@testing-library/jest-dom` diretamente em arquivos de teste.  
Sempre use a augmentação centralizada aqui + o `expect.extend()` em `vitest.setup.ts`.

---

### `css-modules.d.ts`

Declaração para importação do CSS do MapLibre em componentes que usam mapa:

```ts
declare module "maplibre-gl/dist/maplibre-gl.css"
```

Sem esta declaração, o TypeScript reclamaria ao importar um arquivo `.css` diretamente num
módulo TypeScript (ex.: `import "maplibre-gl/dist/maplibre-gl.css"` no componente de mapa).

---

### `modules.d.ts`

Ambient declarations para bibliotecas que não têm tipos publicados no DefinitelyTyped
ou cujos tipos publicados não correspondem ao uso que o projeto faz delas.

| Módulo | O que declara | Motivo |
|:-------|:--------------|:-------|
| `amqplib` | Re-exporta de `amqplib/channel_api` + default export | Tipos públicos do `amqplib` não expõem corretamente o `channel_api` como default |
| `nodemailer` | Re-exporta de `nodemailer/lib/nodemailer` + default export | Mesmo caso do `amqplib` — tipos `@types/nodemailer` divergem da importação real |
| `web-push` | `sendNotification`, `setVapidDetails`, `generateVAPIDKeys`, interfaces `PushSubscription`, `PushOptions`, `SendResult` | Biblioteca não tem tipos publicados |

**Nota:** Estas declarações são **ambientes** — não precisam ser importadas em lugar nenhum.
O TypeScript as encontra automaticamente através do `include` do `tsconfig.json`.

---

## Convenções para Novas Declarações

### 1. Escolha o arquivo certo

| Cenário | Arquivo |
|:--------|:--------|
| Augmentação de tipo para teste (jest-dom, vitest-axe) | `vitest.d.ts` |
| Importação de CSS de terceiros (ex.: `*.css`) | `css-modules.d.ts` |
| Biblioteca sem tipos publicados ou com tipos incorretos | `modules.d.ts` |
| Declaração específica de uma feature | Novo arquivo `*.d.ts` neste diretório |

### 2. Prefira `@types/` packages

Antes de criar uma ambient declaration aqui, verifique se a biblioteca tem tipos
publicados no DefinitelyTyped:

```bash
npm install --save-dev @types/nome-da-biblioteca
```

Se existir, use o `@types/` package em vez de declarar manualmente.
Crie uma ambient declaration **apenas** quando:
- O `@types/` package não existir
- O `@types/` package estiver desatualizado ou incorreto para a versão que usamos
- A declaração for muito pequena (ex.: CSS module) e não justificar um package separado

### 3. Estrutura da declaração

**Para CSS modules:**
```ts
declare module "nome-do-pacote/arquivo.css"
```

**Para módulos completos:**
```ts
declare module "nome-do-pacote" {
  // Interfaces primeiro
  // Funções depois
  // Export no final
  export function minhaFuncao(): void
  export interface MinhaInterface { ... }
}
```

### 4. NUNCA coloque lógica de runtime em `.d.ts`

Arquivos `.d.ts` são **apenas tipos** — não devem conter implementação,
constantes, ou lógica executável. Para código de runtime, use arquivos `.ts` normais.

### 5. Mantenha este README atualizado

Sempre que adicionar, remover ou modificar uma declaração, atualize a seção
correspondente acima para que o diretório continue sendo a fonte única de verdade
para o sistema de tipos do projeto.
