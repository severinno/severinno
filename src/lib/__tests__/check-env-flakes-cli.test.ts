/**
 * check-env-flakes-cli.test.ts
 *
 * Testes de INTEGRAÇÃO do guard scripts/check-env-flakes.mjs: roda a CLI REAL
 * via child_process (process.execPath — robusto no Windows) contra diretórios
 * temporários com src/*.test.ts fake, validando o fluxo completo do guard.
 *
 * Cobre:
 *   - toLocale* sem locale → exit 1
 *   - Intl sem timeZone → exit 1
 *   - Math.random em expect → exit 1
 *   - repo fake limpo (tudo controlado/explícito) → exit 0
 *   - repo real do projeto → exit 0 (nenhum flaky ambiental hoje)
 *
 * Usage:
 *   npx vitest run --config vitest.config.unit.ts src/lib/__tests__/check-env-flakes-cli.test.ts
 */

import { describe, it, expect, afterAll } from "vitest"
import { spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

const SCRIPT = join(process.cwd(), "scripts", "check-env-flakes.mjs")
const ROOT_TMP = mkdtempSync(join(tmpdir(), "env-flakes-cli-"))

/** Roda `check-env-flakes.mjs` num cwd arbitrário (CLI real). */
function runGuard(cwd: string): { status: number | null; out: string } {
  const res = spawnSync(process.execPath, [SCRIPT], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })
  return { status: res.status, out: `${res.stdout ?? ""}${res.stderr ?? ""}` }
}

/** Cria um repo fake isolado com src/ contendo os arquivos de teste dados. */
function makeFakeRepo(name: string, testFiles: Record<string, string>): string {
  const dir = join(ROOT_TMP, name)
  const srcDir = join(dir, "src")
  mkdirSync(srcDir, { recursive: true })
  for (const [fileName, content] of Object.entries(testFiles)) {
    const filePath = join(srcDir, fileName)
    mkdirSync(dirname(filePath), { recursive: true })
    writeFileSync(filePath, content, "utf8")
  }
  return dir
}

describe("check-env-flakes.mjs — CLI real (fast gate)", () => {
  afterAll(() => {
    rmSync(ROOT_TMP, { recursive: true, force: true })
  })

  it("toLocale* sem locale → exit 1", () => {
    const dir = makeFakeRepo("t1-locale", {
      "locale.test.ts": `import { describe, it, expect } from "vitest"\n\ndescribe("locale", () => {\n  it("depends on system locale", () => {\n    expect((1234.5).toLocaleString()).toBe("1.234,5")\n  })\n})\n`,
    })
    const { status, out } = runGuard(dir)
    expect(status).toBe(1)
    expect(out).toContain("FLAKIES AMBIENTAIS")
    expect(out).toContain("toLocale*() sem locale explícito")
  })

  it("Intl sem timeZone → exit 1", () => {
    const dir = makeFakeRepo("t2-intl", {
      "intl.test.ts": `import { describe, it, expect } from "vitest"\n\ndescribe("intl", () => {\n  it("depends on system tz", () => {\n    const fmt = new Intl.DateTimeFormat("pt-BR")\n    expect(fmt.format(new Date("2026-01-05T15:00:00Z"))).toBeDefined()\n  })\n})\n`,
    })
    const { status, out } = runGuard(dir)
    expect(status).toBe(1)
    expect(out).toContain("Intl.DateTimeFormat sem timeZone explícito")
  })

  it("Math.random em expect → exit 1", () => {
    const dir = makeFakeRepo("t3-random", {
      "random.test.ts": `import { describe, it, expect } from "vitest"\n\ndescribe("random", () => {\n  it("asserts random", () => {\n    expect(Math.random()).toBe(0.5)\n  })\n})\n`,
    })
    const { status, out } = runGuard(dir)
    expect(status).toBe(1)
    expect(out).toContain("Math.random() em asserção")
  })

  it("repo fake limpo (tudo explícito/controlado) → exit 0", () => {
    const dir = makeFakeRepo("t4-clean", {
      "clean.test.ts": `import { describe, it, expect, vi } from "vitest"\n\ndescribe("clean", () => {\n  it("explicit locale", () => {\n    expect((1234.5).toLocaleString("pt-BR")).toBe("1.234,5")\n  })\n  it("controlled tz", () => {\n    const fmt = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo" })\n    expect(fmt.format(new Date("2026-01-05T15:00:00Z"))).toBeDefined()\n  })\n  it("fixture random ok", () => {\n    const id = "inv-" + Math.random().toString(36).slice(2, 8)\n    expect(id).toMatch(/^inv-/)\n  })\n})\n`,
    })
    const { status, out } = runGuard(dir)
    expect(status).toBe(0)
    expect(out).toContain("Nenhum teste depende de locale/TZ/Math.random")
  })

  it("Intl.NumberFormat com locale explícito no repo fake → exit 0 (não é falso positivo)", () => {
    // Regressão do falso positivo real: NumberFormat NÃO aceita timeZone — um
    // teste determinístico com locale explícito deve passar.
    const dir = makeFakeRepo("t5-numberformat", {
      "num.test.ts": `import { describe, it, expect } from "vitest"\n\ndescribe("num", () => {
  it("deterministic currency", () => {
    const fmt = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" })
    expect(fmt.format(1234.5)).toBe("R$ 1.234,50")
  })
})\n`,
    })
    const { status, out } = runGuard(dir)
    expect(status).toBe(0)
    expect(out).toContain("Nenhum teste depende de locale/TZ/Math.random")
  })

  it("repo real do projeto → exit 0 (nenhum flaky ambiental hoje)", () => {
    const { status, out } = runGuard(process.cwd())
    expect(status).toBe(0)
    expect(out).toContain("Nenhum teste depende de locale/TZ/Math.random")
  })
})
