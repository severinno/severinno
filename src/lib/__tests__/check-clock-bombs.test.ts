/**
 * check-clock-bombs.test.ts
 *
 * Testes das funções PURAS do scripts/check-clock-bombs.mjs — guard que
 * impede o RETORNO de bombas-relógio nos testes (padrão de relógio de parede
 * sem vi.useFakeTimers/vi.setSystemTime no arquivo).
 *
 * Contexto (08–09/2026): geo-innovations.test.ts falhava no rush hour BRT
 * (17:30–19:30) porque calculateTravelFee aplicava o multiplicador 1.25 de
 * isRushHour() com o relógio real; format.test.ts falhava em dias de
 * transição de DST (dia de 23h). Este guard encerra a classe de bug.
 *
 * Cobre:
 *   - hasClockControl: aceita useFakeTimers OU setSystemTime
 *   - findClockViolations: isRushHour / .getDay() / .getHours() /
 *     .getTimezoneOffset() (+ variantes UTC) e Date.now()/new Date() em linha
 *     de expect(...)
 *   - Não-falsos-positivos: fixtures relativos (createdAt: new Date() em
 *     assignment, SEM expect), comentários, linhas vazias
 *   - scanTestDir: retorna por arquivo; dir sem violações → []
 */

import { describe, it, expect, afterAll } from "vitest"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  hasClockControl,
  findClockViolations,
  scanTestDir,
} from "../../../scripts/check-clock-bombs.mjs"

const tmpDirs: string[] = []

function makeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "clock-bombs-"))
  tmpDirs.push(dir)
  return dir
}

afterAll(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

// ── hasClockControl ───────────────────────────────────────────────────────

describe("hasClockControl", () => {
  it("aceita vi.useFakeTimers", () => {
    expect(
      hasClockControl(`import { vi } from "vitest"\nvi.useFakeTimers({ toFake: ["Date"] })`),
    ).toBe(true)
  })

  it("aceita vi.setSystemTime", () => {
    expect(hasClockControl(`vi.setSystemTime(new Date("2026-01-05T15:00:00.000Z"))`)).toBe(true)
  })

  it("rejeita conteúdo sem controle de relógio", () => {
    expect(
      hasClockControl(`import { describe, it, expect } from "vitest"\nconst now = Date.now()`),
    ).toBe(false)
  })

  it("useRealTimers sozinho NÃO conta como controle (é o restore)", () => {
    expect(hasClockControl(`afterEach(() => vi.useRealTimers())`)).toBe(false)
  })
})

// ── findClockViolations ────────────────────────────────────────────────────

describe("findClockViolations", () => {
  it("flaga isRushHour() (o caso canônico do geo-innovations)", () => {
    const violations = findClockViolations(
      `import { isRushHour } from "../travel-fee"\nconst peak = isRushHour(new Date())\n`,
    )
    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatchObject({ line: 2, pattern: "isRushHour()" })
  })

  it("flaga .getDay() / .getHours() / .getTimezoneOffset() / variantes UTC", () => {
    const content = [
      `const d = new Date()`,
      `const dow = d.getDay()`,
      `const h = d.getHours()`,
      `const off = d.getTimezoneOffset()`,
      `const udow = d.getUTCDay()`,
      `const uh = d.getUTCHours()`,
    ].join("\n")
    const violations = findClockViolations(content)
    expect(violations).toHaveLength(5)
    expect(violations.map((v) => v.pattern).sort()).toEqual([
      ".getDay()",
      ".getHours()",
      ".getTimezoneOffset()",
      ".getUTCDay()",
      ".getUTCHours()",
    ])
  })

  it("flaga Date.now() em linha de expect(...) (asserção de janela temporal)", () => {
    const violations = findClockViolations(
      `const result = await checkRateLimit(req, { max: 30, windowMs: 60_000 })\nexpect(result.reset).toBeGreaterThan(Date.now())\n`,
    )
    expect(violations).toHaveLength(1)
    expect(violations[0].pattern).toContain("Date.now()/new Date() em asserção")
  })

  it("flaga new Date() em linha de expect(...)", () => {
    const violations = findClockViolations(`expect(escrow.expiresAt).toBeGreaterThan(new Date())\n`)
    expect(violations).toHaveLength(1)
  })

  it("NÃO flaga fixture relativo (createdAt: new Date() em assignment, sem expect)", () => {
    const violations = findClockViolations(`const booking = { id: "b-1", createdAt: new Date() }\n`)
    expect(violations).toEqual([])
  })

  it("NÃO flaga Date.now() em fixture relativo (expiresAt: now + 86400000)", () => {
    const violations = findClockViolations(`const expiresAt = new Date(Date.now() + 86400000)\n`)
    expect(violations).toEqual([])
  })

  it("ignora comentários e linhas vazias", () => {
    const violations = findClockViolations(
      `// isRushHour() explicado em comentário — não é chamada\n\n* docblock .getDay()\nconst x = 1\n`,
    )
    expect(violations).toEqual([])
  })

  it("flaga múltiplas violações na mesma linha (expect + isRushHour)", () => {
    const violations = findClockViolations(`expect(isRushHour(new Date())).toBe(true)\n`)
    expect(violations.length).toBeGreaterThanOrEqual(2)
    const patterns = violations.map((v) => v.pattern)
    expect(patterns).toContain("isRushHour()")
    expect(patterns.some((p) => p.includes("asserção"))).toBe(true)
  })

  it("não flaga isRushHour importado sem chamada", () => {
    const violations = findClockViolations(`import { isRushHour } from "../travel-fee"\n`)
    expect(violations).toEqual([])
  })
})

// ── scanTestDir ───────────────────────────────────────────────────────────

describe("scanTestDir", () => {
  it("retorna violações por arquivo sem clock control", () => {
    const dir = makeDir()
    writeFileSync(
      join(dir, "bomb.test.ts"),
      `import { isRushHour } from "../travel-fee"\nexpect(isRushHour(new Date())).toBe(true)\n`,
    )
    writeFileSync(
      join(dir, "safe.test.ts"),
      `import { vi } from "vitest"\nvi.useFakeTimers({ toFake: ["Date"] })\nexpect(isRushHour(new Date())).toBe(true)\n`,
    )
    writeFileSync(join(dir, "plain.ts"), `const now = Date.now()\n`)
    const results = scanTestDir(dir)
    expect(results).toHaveLength(1)
    expect(results[0].file).toContain("bomb.test.ts")
    expect(results[0].violations.length).toBeGreaterThanOrEqual(1)
  })

  it("ignora node_modules e .next", () => {
    const dir = makeDir()
    writeFileSync(join(dir, "ok.test.ts"), `const x = 1\n`)
    const nm = join(dir, "node_modules", "pkg")
    const nx = join(dir, ".next")
    // scanTestDir já pula esses diretórios por nome — apenas assegura que não
    // quebra quando existem (mesmo vazios). mkdirSync no pai antes de escrever.
    mkdirSync(join(dir, "node_modules"), { recursive: true })
    mkdirSync(join(dir, ".next"), { recursive: true })
    writeFileSync(join(dir, "node_modules", ".keep"), "")
    writeFileSync(join(dir, ".next", ".keep"), "")
    expect(nm).toBeDefined()
    expect(nx).toBeDefined()
    expect(scanTestDir(dir)).toEqual([])
  })

  it("diretório sem arquivos de teste → []", () => {
    const dir = makeDir()
    writeFileSync(join(dir, "helper.ts"), `const now = Date.now()\n`)
    expect(scanTestDir(dir)).toEqual([])
  })
})
