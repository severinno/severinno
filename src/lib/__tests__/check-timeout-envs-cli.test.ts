import { describe, it, expect, afterEach } from "vitest"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import {
  blankComments,
  parseDocDefaultMs,
  checkTimeoutEnvs,
  collectCodeTimeoutEnvs,
} from "../../../scripts/check-timeout-envs.mjs"

const GUARD = resolve(process.cwd(), "scripts/check-timeout-envs.mjs")

const tmpDirs: string[] = []

/** Fixture limpo: env em src/ + doc consistente nas 3 docs. */
function makeFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "timeout-envs-"))
  tmpDirs.push(dir)
  mkdirSync(join(dir, "src", "lib"), { recursive: true })
  writeFileSync(
    join(dir, "src", "lib", "client.ts"),
    [
      'import { envTimeoutSignal, resolveTimeoutMs } from "@/lib/fetch-timeout"',
      "",
      'export const T = resolveTimeoutMs("LYTEX_TIMEOUT_MS", 10_000)',
      "export async function call(url: string) {",
      "  const res = await fetch(url, {",
      '    signal: envTimeoutSignal("LYTEX_TIMEOUT_MS", 10_000),',
      "  })",
      "  return res.json()",
      "}",
      "",
    ].join("\n"),
  )
  writeFileSync(
    join(dir, "README.md"),
    [
      "## Environment Variables",
      "",
      "### Fetch timeouts (`*_TIMEOUT_MS`)",
      "",
      "| Env                | Default | Scope                     |",
      "| ------------------ | ------- | ------------------------- |",
      "| `LYTEX_TIMEOUT_MS` | 10s     | Gateway Lytex             |",
      "",
    ].join("\n"),
  )
  writeFileSync(
    join(dir, ".env.example"),
    ["# Timeout envs (ms)", "LYTEX_TIMEOUT_MS=10000", ""].join("\n"),
  )
  writeFileSync(
    join(dir, "docker-compose.yml"),
    [
      "services:",
      "  app:",
      "    image: app:latest",
      "    environment:",
      "      LYTEX_TIMEOUT_MS: ${LYTEX_TIMEOUT_MS:-10000}",
      "",
    ].join("\n"),
  )
  writeFileSync(
    join(dir, "docker-compose.prod.yml"),
    [
      "services:",
      "  app:",
      "    image: app:latest",
      "    environment:",
      "      LYTEX_TIMEOUT_MS: ${LYTEX_TIMEOUT_MS:-10000}",
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

describe("check-timeout-envs.mjs (CLI)", () => {
  it("exit 0 quando o fixture está limpo (env documentada nas 3 docs)", () => {
    const dir = makeFixture()
    const res = run(dir)
    expect(res.status).toBe(0)
    expect(outputOf(res)).toContain("✅")
  })

  it("exit 1 e cita o README quando a env some da tabela", () => {
    const dir = makeFixture()
    writeFileSync(
      join(dir, "README.md"),
      [
        "## Environment Variables",
        "",
        "### Fetch timeouts (`*_TIMEOUT_MS`)",
        "",
        "| Env | Default | Scope |",
        "| --- | ------- | ----- |",
        "",
      ].join("\n"),
    )
    const res = run(dir)
    expect(res.status).toBe(1)
    expect(outputOf(res)).toContain("README")
  })

  it("exit 1 e cita a divergência quando o default da doc difere do código", () => {
    const dir = makeFixture()
    writeFileSync(
      join(dir, "README.md"),
      [
        "## Environment Variables",
        "",
        "### Fetch timeouts (`*_TIMEOUT_MS`)",
        "",
        "| Env                | Default | Scope         |",
        "| ------------------ | ------- | ------------- |",
        "| `LYTEX_TIMEOUT_MS` | 99s     | Gateway Lytex |",
        "",
      ].join("\n"),
    )
    const res = run(dir)
    expect(res.status).toBe(1)
    expect(outputOf(res)).toContain("≠ código")
  })

  it("exit 1 e cita o .env.example quando a env some de lá", () => {
    const dir = makeFixture()
    writeFileSync(join(dir, ".env.example"), "# Timeout envs (ms)\n")
    const res = run(dir)
    expect(res.status).toBe(1)
    expect(outputOf(res)).toContain(".env.example")
  })

  it("exit 1 e cita o docker-compose.yml quando a env some do compose base", () => {
    const dir = makeFixture()
    writeFileSync(
      join(dir, "docker-compose.yml"),
      [
        "services:",
        "  app:",
        "    image: app:latest",
        "    environment:",
        "      PORT: 3000",
        "",
      ].join("\n"),
    )
    const res = run(dir)
    expect(res.status).toBe(1)
    expect(outputOf(res)).toContain("docker-compose.yml")
  })

  it("exit 1 e cita o docker-compose.prod.yml quando a env some do compose prod", () => {
    const dir = makeFixture()
    writeFileSync(
      join(dir, "docker-compose.prod.yml"),
      [
        "services:",
        "  app:",
        "    image: app:latest",
        "    environment:",
        "      PORT: 3000",
        "",
      ].join("\n"),
    )
    const res = run(dir)
    expect(res.status).toBe(1)
    expect(outputOf(res)).toContain("docker-compose.prod.yml")
  })

  it("exit 1 e cita stale quando o README documenta env sem uso em src/", () => {
    const dir = makeFixture()
    writeFileSync(
      join(dir, "README.md"),
      [
        "## Environment Variables",
        "",
        "### Fetch timeouts (`*_TIMEOUT_MS`)",
        "",
        "| Env                | Default | Scope                        |",
        "| ------------------ | ------- | ---------------------------- |",
        "| `LYTEX_TIMEOUT_MS` | 10s     | Gateway Lytex                |",
        "| `GHOST_TIMEOUT_MS` | 30s     | Env que não existe em src/   |",
        "",
      ].join("\n"),
    )
    const res = run(dir)
    expect(res.status).toBe(1)
    expect(outputOf(res)).toContain("stale")
  })

  it("exit 1 quando a env tem defaults inconsistentes no próprio src/", () => {
    const dir = makeFixture()
    writeFileSync(
      join(dir, "src", "lib", "client.ts"),
      [
        'import { resolveTimeoutMs } from "@/lib/fetch-timeout"',
        "",
        'export const A = resolveTimeoutMs("LYTEX_TIMEOUT_MS", 10_000)',
        'export const B = resolveTimeoutMs("LYTEX_TIMEOUT_MS", 5_000)',
        "",
      ].join("\n"),
    )
    const res = run(dir)
    expect(res.status).toBe(1)
    expect(outputOf(res)).toContain("DIFERENTES")
  })

  it("exit 1 quando o .env.example está ausente (fail-closed das 3 docs)", () => {
    const dir = makeFixture()
    rmSync(join(dir, ".env.example"))
    const res = run(dir)
    expect(res.status).toBe(1)
    expect(outputOf(res)).toContain(".env.example")
  })

  it("exit 2 para flag desconhecida", () => {
    const dir = makeFixture()
    const res = spawnSync(process.execPath, [GUARD, "--nope", dir], { encoding: "utf8" })
    expect(res.status).toBe(2)
  })
})

describe("check-timeout-envs.mjs (funções puras)", () => {
  it("blankComments apaga comentários mas preserva strings (env real sobrevive)", () => {
    const code = [
      '/** Docstring: envTimeoutSignal("LYTEX_TIMEOUT_MS", 10_000) — prosa não conta */',
      'const A = resolveTimeoutMs("LYTEX_TIMEOUT_MS", 10_000) // comentário inline',
      "",
    ].join("\n")
    const clean = blankComments(code)
    expect(clean).toContain('resolveTimeoutMs("LYTEX_TIMEOUT_MS", 10_000)')
    expect(clean).not.toContain("envTimeoutSignal")
  })

  it("parseDocDefaultMs converte '15s' → 15000 e '3000' → 3000", () => {
    expect(parseDocDefaultMs("15s")).toBe(15000)
    expect(parseDocDefaultMs("3s")).toBe(3000)
    expect(parseDocDefaultMs("3000")).toBe(3000)
    expect(parseDocDefaultMs("nope")).toBeNull()
  })

  it("collectCodeTimeoutEnvs pareia constantes X_ENV/X_DEFAULT_MS por relação exata", () => {
    const dir = makeFixture()
    writeFileSync(
      join(dir, "src", "lib", "fetch-timeout.ts"),
      [
        'export const GLOBAL_FETCH_TIMEOUT_MS_ENV = "GLOBAL_FETCH_TIMEOUT_MS"',
        "export const GLOBAL_FETCH_TIMEOUT_DEFAULT_MS = 60_000",
        // um FOO_DEFAULT_MS NÃO deve parear com um FOO_BAR_TIMEOUT_MS_ENV
        "export const FOO_DEFAULT_MS = 5_000",
        'export const FOO_BAR_TIMEOUT_MS_ENV = "FOO_BAR_TIMEOUT_MS"',
        "",
      ].join("\n"),
    )
    const envs = collectCodeTimeoutEnvs(dir)
    expect(envs.get("GLOBAL_FETCH_TIMEOUT_MS")).toEqual(new Set([60_000]))
    expect(envs.has("FOO_BAR_TIMEOUT_MS")).toBe(false)
  })

  it("checkTimeoutEnvs reporta default divergente e reverse stale", () => {
    const code = new Map([["LYTEX_TIMEOUT_MS", new Set([10_000])]])
    const violations = checkTimeoutEnvs(
      code,
      new Map([["LYTEX_TIMEOUT_MS", 9_999]]),
      new Map([["LYTEX_TIMEOUT_MS", 10_000]]),
      new Map([["LYTEX_TIMEOUT_MS", 10_000]]),
      new Map([["LYTEX_TIMEOUT_MS", 10_000]]),
    )
    expect(violations.some((v) => v.includes("≠ código"))).toBe(true)

    const stale = checkTimeoutEnvs(
      code,
      new Map([
        ["LYTEX_TIMEOUT_MS", 10_000],
        ["GHOST_TIMEOUT_MS", 30_000],
      ]),
      new Map([["LYTEX_TIMEOUT_MS", 10_000]]),
      new Map([["LYTEX_TIMEOUT_MS", 10_000]]),
      new Map([["LYTEX_TIMEOUT_MS", 10_000]]),
    )
    expect(stale.some((v) => v.includes("stale"))).toBe(true)
  })
})
