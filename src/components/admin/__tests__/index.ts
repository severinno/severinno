/**
 * index.ts — Barrel de testes admin
 *
 * Ponto de entrada único para helpers compartilhados dos testes admin.
 * Re-exporta `mocks.tsx` e `fixtures.ts` para imports mais curtos:
 *
 *   // Antes
 *   import { DEFAULT_GIST_DEGRADATION_PROPS } from "@/components/admin/__tests__/mocks"
 *   import { FIXTURE_BENCHMARK } from "./fixtures"
 *
 *   // Depois
 *   import { DEFAULT_GIST_DEGRADATION_PROPS, FIXTURE_BENCHMARK } from "./index"
 *
 * ⚠️ IMPORTANTE — NÃO use este barrel dentro de factories de `vi.mock()`:
 *
 *   vi.mock("lucide-react", async () => {
 *     const { MockIcon } = await import("./mocks")   // ← direto, NÃO ./index
 *   })
 *
 *   O Vitest hoista as chamadas `vi.mock()` para o topo do arquivo; importar
 *   o barrel aí carregaria `fixtures.ts` (que importa `vi` e cria mocks no
 *   escopo do módulo) antes da hora. Mantenha o import direto `"./mocks"`
 *   nas factories (ver README.md → "Convenção: vi.mock assíncrono").
 *
 * O `README.md` é documentação (markdown), não um módulo — não pode ser
 * re-exportado aqui. Consulte-o para a convenção de mocks.
 */

export * from "./mocks"
export * from "./fixtures"
