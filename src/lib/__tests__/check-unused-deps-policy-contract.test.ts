/**
 * check-unused-deps-policy-contract.test.ts
 *
 * Teste de CONTRATO da política ZERO-órfãs: valida a PARIDADE entre a doc do
 * README (seção "Auditoria de dependências — política ZERO-órfãs") e a fonte
 * da verdade — o header do `scripts/check-unused-deps.mjs` (allowlist + deps
 * órfãs removidas) — travando a doc contra drift da política REAL.
 *
 * Por que um teste DEDICADO (e não só o check-contract-pairs.mjs): o guard
 * parametrizável valida literais entre ARQUIVOS de código (budgets, markers),
 * mas aqui a fonte é o HEADER (prosa/comentário) + a const ALLOWLIST do
 * guard; o contrato é SEMÂNTICO (a doc deve citar exatamente as mesmas deps
 * da política real) e é mais robusto lendo os arquivos reais do repo.
 *
 * Direções validadas (ambas — o drift não tem lado preferido):
 *   1. README → código: toda dep documentada na seção ZERO-órfãs do README
 *      (allowlist + removidas) existe na política REAL do guard. Se alguém
 *      documenta uma dep que a política não implementa, falha (doc mentiu).
 *   2. código → README: toda dep da política real do guard (ALLOWLIST const
 *      + deps removidas no header) está documentada no README. Se um bump
 *      muda a política e a doc não acompanha, falha (doc desatualizada).
 *
 * Padrão: lê os arquivos REAIS do repo (resolve(process.cwd())) — sem
 * fixtures; o teste é a rede de segurança que o check-hooks-symmetry dá à
 * tabela de hooks, aqui para a política de dependências.
 *
 * Usage:
 *   npx vitest run --config vitest.config.unit.ts src/lib/__tests__/check-unused-deps-policy-contract.test.ts
 */

import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { ALLOWLIST } from "../../../scripts/check-unused-deps.mjs"

const README_PATH = resolve(process.cwd(), "README.md")
const GUARD_PATH = resolve(process.cwd(), "scripts/check-unused-deps.mjs")

const README = readFileSync(README_PATH, "utf8")
const GUARD = readFileSync(GUARD_PATH, "utf8")

// ── Fontes da verdade ─────────────────────────────────────────────────────

/** Deps da allowlist REAL do guard (const exportada — fonte do isAllowlisted). */
const REAL_ALLOWLIST = ALLOWLIST.map((a) => a.match)

/** Deps órfãs REMOVIDAS documentadas no header do guard (prosa). */
/**
 * Deps órfãs REMOVIDAS do header do guard (prosa) — DERIVADAS do header
 * (fonte da verdade), não duplicadas: se o header listar 6 deps, o teste
 * passa a validar 6 automaticamente (um bump que muda a política sem doc
 * seria pego sem precisar editar este arquivo).
 */
const REAL_REMOVED = (() => {
  // o header quebra a linha: '5 deps órfãs reais\n// (08/2026): next-intl, ...\n// zod-to-openapi — verificadas...'
  // captura TUDO entre ': ' e ' — verificadas' (multi-linha, tolera vírgula final)
  const line = GUARD.match(/5 deps órfãs reais[\s\S]*?\(08\/2026\): ([\s\S]*?) — verificadas/)
  expect(line, "header do guard deve citar as deps órfãs reais do bump 0.4.0").not.toBeNull()
  const names = line![1]
    .split(",")
    .map((s) => s.replace(/\/\//g, "").trim()) // comentário multi-linha: cada linha tem '//'
    .filter(Boolean)
  expect(names.length).toBeGreaterThan(0)
  return names
})()

/** Seção do README da política ZERO-órfãs (entre os dois h3). */
function readmeSection(): string {
  const start = README.indexOf("### Auditoria de dependências — política ZERO-órfãs")
  expect(
    start,
    "README deve ter a seção '### Auditoria de dependências — política ZERO-órfãs'",
  ).toBeGreaterThan(-1)
  const end = README.indexOf("### Typecheck — gate de tipo do PR", start)
  expect(
    end,
    "seção ZERO-órfãs deve terminar antes de '### Typecheck — gate de tipo do PR'",
  ).toBeGreaterThan(start)
  return README.slice(start, end)
}

/** Strings entre backticks de um trecho (citações de deps na doc). */
function backtickTokens(text: string): string[] {
  return [...text.matchAll(/`([^`]+)`/g)].map((m) => m[1])
}

/** Extensões de arquivo que NÃO são deps (ex.: check-unused-deps.mjs). */
const FILE_EXT_RE = /\.(mjs|cjs|js|ts|tsx|jsx|json|yml|yaml|md|sh|prisma|css|py|lock|snap)$/i

/** CLIs/conceitos de fluxo que a doc cita em backtick mas NÃO são deps. */
const CONTEXT_WORDS = new Set([
  "bunx",
  "npx",
  "bun",
  "node",
  "yarn",
  "pnpm",
  "npm",
  "prepare",
  "generate",
  "migrate",
  "pre-commit",
  "pre-push",
  "use",
  "ou",
  "e",
  "com",
  "sem",
  "via",
  "em",
  "para",
  "de",
  "que",
  "uma",
  "não",
  "sim",
  "só",
  "a",
  "o",
  "no",
  "na",
  "da",
  "do",
  "as",
  "os",
  "um",
  "dep",
  "deps",
  "bun run",
  "bun install",
  "dependencies",
  "devDependencies",
  "scripts",
  "package.json",
  "tsconfig",
  "next.config",
  "tailwind.config",
  "postcss",
])

/**
 * Filtra tokens de backtick para candidatos a NOME DE PACOTE npm: exige o
 * formato de pacote (scoped `@scope/name` ou simples `name`), sem `*`
 * (wildcards de limitação ex.: dev.*), sem flags (--update), sem
 * CLIs/conceitos de contexto, sem nomes de scripts/jobs do repo.
 */
// Aceita scoped `@scope/name`, simples `name` E prefixo scoped `@scope/`
// (o `@types/*` da doc normaliza para `@types/` — prefixo da política).
// A parte de nome é OPCIONAL quando há scope — `@types/` casa como prefixo.
const PACKAGE_NAME_RE =
  /^(@[a-zA-Z0-9][a-zA-Z0-9._-]*\/)?[a-zA-Z0-9][a-zA-Z0-9._-]*\/?$|^@[a-zA-Z0-9][a-zA-Z0-9._-]*\/$/

function packageTokens(tokens: string[]): string[] {
  return tokens
    .map((t) => t.trim())
    .filter(
      (t) =>
        t.length > 0 &&
        !t.includes(" ") &&
        // `*` só como SUFIXO de wildcard scoped (ex.: @types/* → normalize
        // para @types/); dev.*, run-* (limitações) são excluídos abaixo.
        (!t.includes("*") || t.endsWith("/*")) &&
        !t.startsWith("--") &&
        !FILE_EXT_RE.test(t) &&
        !CONTEXT_WORDS.has(t) &&
        !/^(check-|test-|run-|start-)/.test(t) &&
        !/guard$/.test(t) &&
        PACKAGE_NAME_RE.test(normalizeToken(t)),
    )
}

/** Parágrafo do item 3 (allowlist) da seção — o único que lista allowlist. */
function allowlistParagraph(): string {
  const section = readmeSection()
  const start = section.indexOf("3. **Allowlist com razão**")
  expect(start, "seção ZERO-órfãs deve ter o item '3. **Allowlist com razão**'").toBeGreaterThan(-1)
  const end = section.indexOf("**5 deps órfãs removidas", start)
  expect(
    end,
    "item 3 (allowlist) deve terminar antes de '**5 deps órfãs removidas'",
  ).toBeGreaterThan(start)
  return section.slice(start, end)
}

/** Normaliza um token da doc para comparar com a política (ex.: @types/* → @types/). */
function normalizeToken(tok: string): string {
  return tok.replace(/\*/g, "").trim()
}

// ── README → código (a doc não pode citar dep que a política não tem) ─────

describe("política ZERO-órfãs — README → código (doc não pode mentir)", () => {
  it("toda dep da allowlist documentada no README existe na ALLOWLIST real do guard", () => {
    const section = allowlistParagraph()
    const docAllow = new Set(packageTokens(backtickTokens(section)).map(normalizeToken))
    // tokens que a doc CITA como allowlist: os que existem na política real
    // OU os que parecem dep (caminho scoped/exato) — qualquer token citado
    // como allowlist precisa ter contraparte na política.
    for (const tok of docAllow) {
      const inReal =
        REAL_ALLOWLIST.includes(tok) ||
        REAL_ALLOWLIST.some((r) => tok.startsWith(r.replace(/\*$/, "")) && r.endsWith("/"))
      if (inReal) continue
      // Dep citada na doc que a política não conhece → falha.
      expect.fail(
        `README cita '${tok}' como parte da política ZERO-órfãs mas a ALLOWLIST real do guard não tem essa entrada. Se a dep é allowlist de verdade, adicione-a na const ALLOWLIST do check-unused-deps.mjs (com razão); se não, remova-a da doc.`,
      )
    }
  })

  it("toda dep 'removida' citada no README está na lista real de removidas do header do guard", () => {
    const section = readmeSection()
    const removedMention = section.match(
      /5 deps órfãs removidas no bump 0\.4\.0[\s\S]*?zod-to-openapi/,
    )
    expect(
      removedMention,
      "seção deve citar as 5 deps órfãs removidas do bump 0.4.0",
    ).not.toBeNull()
    const tokens = packageTokens(backtickTokens(removedMention![0])).map(normalizeToken)
    for (const tok of tokens) {
      if (!REAL_REMOVED.includes(tok)) {
        expect.fail(
          `README cita '${tok}' como dep órfã removida no bump 0.4.0 mas o header do guard não a lista como removida. Alinhe a doc com a realidade (header do check-unused-deps.mjs).`,
        )
      }
    }
  })
})

// ── código → README (a política não pode mudar sem a doc acompanhar) ──────

describe("política ZERO-órfãs — código → README (doc não pode desatualizar)", () => {
  it("toda entrada da ALLOWLIST real do guard está documentada no README", () => {
    const section = readmeSection()
    for (const match of REAL_ALLOWLIST) {
      // @types/ → a doc cita @types/*; as demais por nome exato
      const needle = match.endsWith("/") ? match + "*" : match
      expect(
        section.includes(needle),
        `ALLOWLIST do guard tem '${match}' mas a seção ZERO-órfãs do README não a documenta. Atualize a doc (política mudou).`,
      ).toBe(true)
    }
  })

  it("toda dep órfã removida no header do guard está documentada no README", () => {
    const section = readmeSection()
    for (const dep of REAL_REMOVED) {
      expect(
        section.includes(dep),
        `Header do guard lista '${dep}' como órfã removida no bump 0.4.0 mas o README não a menciona. Atualize a doc.`,
      ).toBe(true)
    }
  })

  it("a const ALLOWLIST exportada casa com a allowlist documentada no header do guard", () => {
    // O header (prosa) documenta a mesma allowlist da const — guarda contra
    // drift entre o comentário e o código real (fonte do isAllowlisted).
    const headerDoc = GUARD.slice(0, GUARD.indexOf("import {"))
    const docMatches = new Set(
      backtickTokens(headerDoc)
        .map(normalizeToken)
        .filter((t) => t.length > 0),
    )
    for (const match of REAL_ALLOWLIST) {
      const needle = match.endsWith("/") ? match + "*" : match
      expect(
        docMatches.has(needle) || headerDoc.includes(needle),
        `Header do guard não documenta a allowlist '${match}' que a const ALLOWLIST implementa. Mantenha header e const em paridade.`,
      ).toBe(true)
    }
  })
})
