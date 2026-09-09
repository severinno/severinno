/**
 * check-env-flakes.test.ts
 *
 * Testes das funções PURAS do scripts/check-env-flakes.mjs — guard irmão do
 * check-clock-bombs.mjs que fecha a família de flakies AMBIENTAIS: locale do
 * sistema (toLocale*), fuso do sistema (Intl.*Format), Math.random em
 * asserção e mutação global de process.env.TZ.
 *
 * Calibrado contra o repo (09/2026): zero violações reais — todos os
 * toLocale* usam "pt-BR" explícito e Math.random só aparece em fixtures/IDs.
 *
 * Cobre:
 *   - hasMathControl / hasTzControl (exonerações por arquivo)
 *   - findEnvViolations: toLocale* sem locale / Intl sem timeZone /
 *     Math.random em expect / process.env.TZ mutado
 *   - Não-falsos-positivos: toLocaleString("pt-BR"), Intl com timeZone,
 *     Math.random em fixture (sem expect), vi.stubEnv("TZ"), comentários
 *   - scanTestDir: retorna por arquivo; dir sem violações → []
 */

import { describe, it, expect, afterAll } from "vitest"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  hasMathControl,
  hasTzControl,
  findEnvViolations,
  scanTestDir,
} from "../../../scripts/check-env-flakes.mjs"

const tmpDirs: string[] = []

function makeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "env-flakes-"))
  tmpDirs.push(dir)
  return dir
}

afterAll(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

// ── hasMathControl / hasTzControl ──────────────────────────────────────────

describe("hasMathControl / hasTzControl", () => {
  it("hasMathControl aceita vi.spyOn(Math, 'random')", () => {
    expect(hasMathControl(`vi.spyOn(Math, "random").mockReturnValue(0.5)`)).toBe(true)
  })

  it("hasMathControl aceita vi.stubGlobal('Math', ...)", () => {
    expect(hasMathControl(`vi.stubGlobal("Math", { random: () => 0.5 })`)).toBe(true)
  })

  it("hasMathControl rejeita arquivo sem controle", () => {
    expect(hasMathControl(`const r = Math.random()`)).toBe(false)
  })

  it("hasTzControl aceita vi.stubEnv('TZ', ...)", () => {
    expect(hasTzControl(`vi.stubEnv("TZ", "America/Sao_Paulo")`)).toBe(true)
  })

  it("hasTzControl rejeita process.env.TZ = direto", () => {
    expect(hasTzControl(`process.env.TZ = "America/Sao_Paulo"`)).toBe(false)
  })
})

// ── findEnvViolations ──────────────────────────────────────────────────────

describe("findEnvViolations", () => {
  it("flaga toLocaleString() sem locale (locale do sistema)", () => {
    const violations = findEnvViolations(`const v = amount.toLocaleString()\n`)
    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatchObject({ line: 1, pattern: "toLocale*() sem locale explícito" })
  })

  it("flaga toLocaleDateString() sem locale", () => {
    const violations = findEnvViolations(`const d = date.toLocaleDateString()\n`)
    expect(violations).toHaveLength(1)
  })

  it("NÃO flaga toLocaleString('pt-BR', ...) com locale explícito", () => {
    const violations = findEnvViolations(
      `const v = (n / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 })\n`,
    )
    expect(violations).toEqual([])
  })

  it("NÃO flaga toLocaleString com aspas simples ou template literal", () => {
    // Lookahead cobre " , ' e ` — os três são locale literal determinístico.
    expect(findEnvViolations(`const v = n.toLocaleString('pt-BR')\n`)).toEqual([])
    expect(findEnvViolations("const v = n.toLocaleString(`pt-BR`)\n")).toEqual([])
  })

  it("flaga new Intl.DateTimeFormat sem timeZone na linha", () => {
    const violations = findEnvViolations(`const fmt = new Intl.DateTimeFormat("pt-BR")\n`)
    expect(violations).toHaveLength(1)
    expect(violations[0].pattern).toContain("Intl.DateTimeFormat")
  })

  it("NÃO flaga Intl.DateTimeFormat com timeZone explícita", () => {
    const violations = findEnvViolations(
      `const fmt = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo" })\n`,
    )
    expect(violations).toEqual([])
  })

  it("flaga Intl.NumberFormat SEM locale literal (system-locale)", () => {
    const violations = findEnvViolations(`const fmt = new Intl.NumberFormat()\n`)
    expect(violations).toHaveLength(1)
    expect(violations[0].pattern).toContain("Intl.*Format sem locale explícito")
  })

  it("NÃO flaga Intl.NumberFormat com locale literal (NumberFormat não aceita timeZone)", () => {
    // Regressão do falso positivo real apontado no review: NumberFormat NÃO
    // tem opção timeZone — um teste determinístico com locale explícito não
    // pode ser exigido a ter timeZone.
    const violations = findEnvViolations(
      `const fmt = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" })\n`,
    )
    expect(violations).toEqual([])
  })

  it("NÃO flaga Intl.RelativeTimeFormat/PluralRules com locale literal", () => {
    expect(findEnvViolations(`const fmt = new Intl.RelativeTimeFormat("pt-BR")\n`)).toEqual([])
    expect(findEnvViolations(`const fmt = new Intl.PluralRules("pt-BR")\n`)).toEqual([])
  })

  it("flaga Math.random() em linha de expect(...)", () => {
    const violations = findEnvViolations(`expect(Math.random()).toBe(0.5)\n`)
    expect(violations).toHaveLength(1)
    expect(violations[0].pattern).toContain("Math.random")
  })

  it("NÃO flaga Math.random em fixture/ID (sem expect na linha)", () => {
    const violations = findEnvViolations(
      `const id = "inv-" + Math.random().toString(36).slice(2, 8)\n`,
    )
    expect(violations).toEqual([])
  })

  it("exime Math.random em expect quando o arquivo tem vi.spyOn(Math, 'random')", () => {
    const content = [
      `vi.spyOn(Math, "random").mockReturnValue(0.5)`,
      `expect(Math.random()).toBe(0.5)`,
    ].join("\n")
    expect(findEnvViolations(content)).toEqual([])
  })

  it("flaga process.env.TZ = direto (mutação global)", () => {
    const violations = findEnvViolations(`process.env.TZ = "America/Sao_Paulo"\n`)
    expect(violations).toHaveLength(1)
    expect(violations[0].pattern).toContain("TZ")
  })

  it("exime process.env.TZ quando o arquivo usa vi.stubEnv('TZ', ...)", () => {
    const content = [
      `vi.stubEnv("TZ", "America/Sao_Paulo")`,
      `process.env.TZ = "America/Sao_Paulo"`,
    ].join("\n")
    expect(findEnvViolations(content)).toEqual([])
  })

  it("ignora comentários e linhas vazias", () => {
    const violations = findEnvViolations(
      `// toLocaleString() explicado em comentário\n\n* docblock Math.random()\nconst x = 1\n`,
    )
    expect(violations).toEqual([])
  })
})

// ── scanTestDir ────────────────────────────────────────────────────────────

describe("scanTestDir", () => {
  it("retorna violações por arquivo", () => {
    const dir = makeDir()
    writeFileSync(join(dir, "bad.test.ts"), `const v = amount.toLocaleString()\n`)
    writeFileSync(join(dir, "good.test.ts"), `const v = amount.toLocaleString("pt-BR")\n`)
    writeFileSync(join(dir, "plain.ts"), `const v = amount.toLocaleString()\n`)
    const results = scanTestDir(dir)
    expect(results).toHaveLength(1)
    expect(results[0].file).toContain("bad.test.ts")
    expect(results[0].violations).toHaveLength(1)
  })

  it("ignora node_modules e .next", () => {
    const dir = makeDir()
    writeFileSync(join(dir, "ok.test.ts"), `const x = 1\n`)
    mkdirSync(join(dir, "node_modules"), { recursive: true })
    mkdirSync(join(dir, ".next"), { recursive: true })
    writeFileSync(join(dir, "node_modules", ".keep"), "")
    writeFileSync(join(dir, ".next", ".keep"), "")
    expect(scanTestDir(dir)).toEqual([])
  })

  it("diretório sem arquivos de teste → []", () => {
    const dir = makeDir()
    writeFileSync(join(dir, "helper.ts"), `const v = amount.toLocaleString()\n`)
    expect(scanTestDir(dir)).toEqual([])
  })
})
