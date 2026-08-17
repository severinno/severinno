import { describe, it, expect, afterEach } from "vitest"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const GUARD = resolve(process.cwd(), "scripts/check-fetch-timeout.mjs")

const tmpDirs: string[] = []

/** Fixture limpo: src/lib/client.ts com fetch+envTimeoutSignal. */
function makeFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "fetch-timeout-"))
  tmpDirs.push(dir)
  mkdirSync(join(dir, "src", "lib"), { recursive: true })
  writeFileSync(
    join(dir, "src", "lib", "client.ts"),
    [
      'import { envTimeoutSignal } from "@/lib/fetch-timeout"',
      "",
      "export async function call(url: string) {",
      "  const res = await fetch(url, {",
      '    method: "POST",',
      '    signal: envTimeoutSignal("API_TIMEOUT_MS", 15_000),',
      "  })",
      "  return res.json()",
      "}",
      "",
    ].join("\n"),
  )
  return dir
}

/** Output combinado stdout+stderr — o guard escreve violações no stderr. */
function outputOf(res: ReturnType<typeof run>): string {
  return `${res.stdout ?? ""}${res.stderr ?? ""}`
}

function run(dir: string) {
  return spawnSync(process.execPath, [GUARD, "--root", dir], { encoding: "utf8" })
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe("check-fetch-timeout.mjs (CLI)", () => {
  it("exit 0 quando o fixture está limpo (fetch com envTimeoutSignal)", () => {
    const dir = makeFixture()
    const res = run(dir)
    expect(res.status).toBe(0)
    expect(outputOf(res)).toContain("✅")
  })

  it("exit 1 e cita o arquivo:linha quando um fetch não tem signal", () => {
    const dir = makeFixture()
    writeFileSync(
      join(dir, "src", "lib", "bad.ts"),
      'export async function leak() {\n  const res = await fetch("/api/leak")\n  return res\n}\n',
    )
    const res = run(dir)
    expect(res.status).toBe(1)
    const out = outputOf(res)
    expect(out).toContain("bad.ts:2")
    expect(out).toContain("fetch(")
  })

  it("exit 0 para delegação pura fetch(url, init) quando o arquivo tem signal", () => {
    const dir = makeFixture()
    writeFileSync(
      join(dir, "src", "lib", "delegate.ts"),
      [
        'import { envTimeoutSignal } from "@/lib/fetch-timeout"',
        "",
        "export async function call(url: string) {",
        '  const init: RequestInit = { signal: envTimeoutSignal("API_TIMEOUT_MS", 15_000) }',
        "  const res = await fetch(url, init)",
        "  return res.json()",
        "}",
        "",
      ].join("\n"),
    )
    const res = run(dir)
    expect(res.status).toBe(0)
  })

  it("exit 0 para menção em comentário/prosa (não é fetch de verdade)", () => {
    const dir = makeFixture()
    writeFileSync(
      join(dir, "src", "lib", "docs.ts"),
      [
        "/**",
        ' * Exemplo de uso antigo: `fetch("/api/x")` — hoje usa envTimeoutSignal.',
        " */",
        'export const note = "fetch( sem signal era um hang potencial"',
        "",
      ].join("\n"),
    )
    const res = run(dir)
    expect(res.status).toBe(0)
  })

  it("exit 0 para arquivos de teste (mocks de fetch não precisam de signal)", () => {
    const dir = makeFixture()
    writeFileSync(
      join(dir, "src", "lib", "client.test.ts"),
      'import { vi } from "vitest"\nvi.stubGlobal("fetch", vi.fn())\n',
    )
    const res = run(dir)
    expect(res.status).toBe(0)
  })

  it("exit 2 para flag desconhecida", () => {
    const dir = makeFixture()
    const res = spawnSync(process.execPath, [GUARD, "--nope", dir], { encoding: "utf8" })
    expect(res.status).toBe(2)
  })
})
