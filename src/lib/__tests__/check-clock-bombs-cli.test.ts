/**
 * check-clock-bombs-cli.test.ts
 *
 * Testes de INTEGRAÇÃO do guard scripts/check-clock-bombs.mjs: roda a CLI
 * REAL via child_process (process.execPath — robusto no Windows) contra
 * diretórios temporários com src/*.test.ts fake, validando o fluxo completo
 * do guard (não apenas as funções puras, já cobertas pelo
 * check-clock-bombs.test.ts).
 *
 * Cobre:
 *   - teste com isRushHour sem clock control → exit 1
 *   - teste com clock control (useFakeTimers) → exit 0
 *   - repo fake limpo (sem padrões) → exit 0
 *   - repo real do projeto → exit 0 (nenhuma bomba-relógio hoje)
 *
 * Usage:
 *   npx vitest run --config vitest.config.unit.ts src/lib/__tests__/check-clock-bombs-cli.test.ts
 */

import { describe, it, expect, afterAll } from "vitest"
import { spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

const SCRIPT = join(process.cwd(), "scripts", "check-clock-bombs.mjs")
const ROOT_TMP = mkdtempSync(join(tmpdir(), "clock-bombs-cli-"))

/** Roda `check-clock-bombs.mjs` num cwd arbitrário (CLI real). */
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
    // dirname() (node:path) resolve o separador certo por SO — o corte manual
    // com lastIndexOf("/") quebrava no Windows (join() usa "\\").
    const filePath = join(srcDir, fileName)
    mkdirSync(dirname(filePath), { recursive: true })
    writeFileSync(filePath, content, "utf8")
  }
  return dir
}

describe("check-clock-bombs.mjs — CLI real (fast gate)", () => {
  afterAll(() => {
    rmSync(ROOT_TMP, { recursive: true, force: true })
  })

  it("teste com isRushHour sem clock control → exit 1", () => {
    const dir = makeFakeRepo("t1-bomb", {
      "bomb.test.ts": `import { describe, it, expect } from "vitest"\nimport { isRushHour } from "../travel-fee"\n\ndescribe("bomb", () => {\n  it("fails at night", () => {\n    expect(isRushHour(new Date())).toBe(true)\n  })\n})\n`,
    })
    const { status, out } = runGuard(dir)
    expect(status).toBe(1)
    expect(out).toContain("BOMBA(S)-RELÓGIO DETECTADA(S)")
    expect(out).toContain("isRushHour()")
  })

  it("teste com expect(Date.now()) sem clock control → exit 1", () => {
    const dir = makeFakeRepo("t2-expect-now", {
      "rate.test.ts": `import { describe, it, expect } from "vitest"\n\ndescribe("rate", () => {\n  it("reset in future", () => {\n    expect(12345).toBeGreaterThan(Date.now())\n  })\n})\n`,
    })
    const { status, out } = runGuard(dir)
    expect(status).toBe(1)
    expect(out).toContain("asserção")
  })

  it("teste com clock control (useFakeTimers) → exit 0", () => {
    const dir = makeFakeRepo("t3-safe", {
      "safe.test.ts": `import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"\nimport { isRushHour } from "../travel-fee"\n\nbeforeEach(() => {\n  vi.useFakeTimers({ toFake: ["Date"] })\n  vi.setSystemTime(new Date("2026-01-05T15:00:00.000Z"))\n})\n\nafterEach(() => vi.useRealTimers())\n\ndescribe("safe", () => {\n  it("deterministic", () => {\n    expect(isRushHour(new Date())).toBe(true)\n  })\n})\n`,
    })
    const { status, out } = runGuard(dir)
    expect(status).toBe(0)
    expect(out).toContain("Nenhum teste usa relógio de parede")
  })

  it("repo fake limpo (fixtures relativos sem expect) → exit 0", () => {
    const dir = makeFakeRepo("t4-clean", {
      "fixture.test.ts": `import { describe, it, expect } from "vitest"\n\ndescribe("fixture", () => {\n  it("relative", () => {\n    const booking = { id: "b-1", createdAt: new Date(), expiresAt: Date.now() + 86400000 }\n    expect(booking.id).toBe("b-1")\n  })\n})\n`,
    })
    const { status, out } = runGuard(dir)
    expect(status).toBe(0)
    expect(out).toContain("Nenhum teste usa relógio de parede")
  })

  it("repo real do projeto → exit 0 (nenhuma bomba-relógio hoje)", () => {
    const { status, out } = runGuard(process.cwd())
    expect(status).toBe(0)
    expect(out).toContain("Nenhum teste usa relógio de parede")
  })
})
