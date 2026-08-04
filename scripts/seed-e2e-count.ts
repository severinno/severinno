/**
 * scripts/seed-e2e-count.ts
 *
 * FONTE DA VERDADE dos counts de checks dos E2Es de seed — DERIVA o total
 * esperado do CÓDIGO (sem nenhum literal hardcoded como 128/162):
 *
 *   prod  → scripts/test-seed-prod-e2e.ts
 *   dev   → scripts/test-seed-dev-e2e.ts
 *
 * A derivação soma 3 contribuições:
 *   1. Sites de asserção no PRÓPRIO arquivo do E2E (`expect(`/`ok(`/`bad(`),
 *      contados no source (fora de comentários) — se uma asserção for
 *      adicionada/removida, o count ajusta sozinho.
 *   2. Expansão dos LOOPS dirigidos por dados no arquivo do E2E: cada loop
 *      contribui 1 site no source mas executa N× no runtime (ex.:
 *      `for (const s of DEFAULT_SETTINGS)` executa DEFAULT_SETTINGS.length
 *      vezes; `for (const [k, v] of Object.entries(<counts>))` executa o nº
 *      de campos do type Counts vezes).
 *   3. Contribuição dos HELPERS compartilhados chamados com `rep`:
 *      validateTree (derivado de CATEGORY_SPEC), validateUsers (derivado de
 *      EXPECTED_EMAILS — só dev) e assertPatchedUpdatePlan (3 fixas).
 *
 * Quem consome:
 *   - Os E2Es — `export const EXPECTED_TOTAL = deriveExpectedChecks("prod")`
 *     (o runtime drift check valida que o total REAL impresso bate com ela).
 *   - Os .sh (test-seed-{prod,dev}-e2e.sh) — `bun scripts/seed-e2e-count.ts
 *     prod|dev` para validar o count na camada do shell.
 *   - O guard estático scripts/check-e2e-counts.mjs — `bun ... --json` para
 *     comparar os counts documentados nos workflows com a derivação.
 *
 * Usage:
 *   bun scripts/seed-e2e-count.ts prod    # imprime 128
 *   bun scripts/seed-e2e-count.ts dev     # imprime 162
 *   bun scripts/seed-e2e-count.ts --json  # imprime {"prod":128,"dev":162}
 *
 * Exit codes:
 *   0 — derivação concluída (imprime o(s) número(s))
 *   1 — argumento inválido
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { DEFAULT_SETTINGS } from "../prisma/seed-data"
import { validateTreeCheckCount, validateUsersCheckCount } from "./seed-e2e-common"
import { PLAN_ASSERT_COUNT } from "./seed-e2e-utils"

/** Arquivos dos E2Es (relativos à raiz do repo). */
const E2E_FILES = {
  prod: "scripts/test-seed-prod-e2e.ts",
  dev: "scripts/test-seed-dev-e2e.ts",
} as const

export type E2EKind = keyof typeof E2E_FILES

// ---------------------------------------------------------------------------
// 1. Sites de asserção no source do E2E
// ---------------------------------------------------------------------------

/**
 * Conta os sites de asserção (`expect(`/`ok(`/`bad(`) num source de E2E,
 * ignorando comentários de linha e de bloco.
 *
 * @param {string} source  conteúdo do arquivo do E2E
 * @returns {number}  nº de sites de asserção
 */ export function countAssertSites(source: string): number {
  // Sem flag `s` (dotAll): [\s\S] já cobre qualquer caractere — mantém o
  // target es2015 do tsconfig (não es2018+).
  const cleaned = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
  return (cleaned.match(/\b(?:expect|ok|bad|rep\.expect)\s*\(/g) ?? []).length
}

// ---------------------------------------------------------------------------
// 2. Expansão dos loops dirigidos por dados
// ---------------------------------------------------------------------------

/**
 * Conta os campos do `type Counts = { ... }` no source de um E2E (dev).
 * É o nº de iterações dos loops `for (const [k, v] of Object.entries(...))`.
 *
 * @param {string} source  conteúdo do arquivo do E2E
 * @returns {number}  nº de campos (0 se não houver type Counts)
 */
export function countCountsTypeFields(source: string): number {
  const m = source.match(/type Counts = \{\n([\s\S]*?)\n\}/)
  if (!m) return 0
  return (m[1].match(/^\s*\w+: /gm) ?? []).length
}

/**
 * Expansão dos loops dirigidos por dados: cada loop contribui 1 site no
 * source mas executa N× no runtime → delta = Σ(iterações - 1).
 *
 * Padrões detectados:
 *   - `for (const <x> of DEFAULT_SETTINGS)` → iterações = DEFAULT_SETTINGS.length
 *   - `for (const [k, v] of Object.entries(<counts>))` → iterações = campos do
 *     type Counts (10 no dev E2E)
 *
 * @param {string} source  conteúdo do arquivo do E2E
 * @param {E2EKind} kind   prod | dev (dev tem os loops de tabelas)
 * @returns {number}  delta a somar ao total de sites
 */
export function dataLoopExpansions(source: string, kind: E2EKind): number {
  let delta = 0
  const settingsLoops = (source.match(/for \(const \w+ of DEFAULT_SETTINGS\)/g) ?? []).length
  delta += settingsLoops * (DEFAULT_SETTINGS.length - 1)
  const entriesLoops = (source.match(/for \(const \[k, v\] of Object\.entries\(/g) ?? []).length
  if (entriesLoops > 0) {
    delta += entriesLoops * (countCountsTypeFields(source) - 1)
  }
  void kind // kind é mantido na assinatura para clareza; os loops de tabelas só existem no dev
  return delta
}

// ---------------------------------------------------------------------------
// 3. Derivação total
// ---------------------------------------------------------------------------

/**
 * Deriva o total de checks esperado de um E2E de seed A PARTIR DO CÓDIGO.
 *
 *   sites (arquivo) + expansão de loops + validateTree + validateUsers (dev)
 *   + assertPatchedUpdatePlan
 *
 * O parâmetro OPCIONAL `sourceOverride` habilita MUTATION TESTS: injetar ou
 * remover asserções numa CÓPIA do source (sem tocar no arquivo real do repo)
 * e validar que o count ajusta sozinho na proporção exata — o contrato
 * "ajusta sozinho" do guard. Sem ele, a função lê o arquivo real do E2E.
 *
 * @param {E2EKind} kind             prod | dev
 * @param {string} [sourceOverride]  source do E2E no lugar do arquivo (teste)
 * @returns {number}  total de checks esperado
 */
export function deriveExpectedChecks(kind: E2EKind, sourceOverride?: string): number {
  const source = sourceOverride ?? readFileSync(join(process.cwd(), E2E_FILES[kind]), "utf8")
  const sites = countAssertSites(source)
  const loops = dataLoopExpansions(source, kind)
  const tree = validateTreeCheckCount()
  const users = kind === "dev" ? validateUsersCheckCount() : 0
  return sites + loops + tree + users + PLAN_ASSERT_COUNT
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main() {
  const arg = process.argv[2]
  const prod = deriveExpectedChecks("prod")
  const dev = deriveExpectedChecks("dev")
  if (arg === "--json") {
    console.log(JSON.stringify({ prod, dev }))
  } else if (arg === "prod") {
    console.log(prod)
  } else if (arg === "dev") {
    console.log(dev)
  } else {
    console.error("uso: bun scripts/seed-e2e-count.ts [--json|prod|dev]")
    process.exit(1)
  }
}

// True apenas quando executado diretamente (bun ...) — permite importar as
// funções puras em testes unitários sem disparar o CLI.
const IS_DIRECT_RUN =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (IS_DIRECT_RUN) main()
