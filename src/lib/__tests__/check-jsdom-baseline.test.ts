/**
 * check-jsdom-baseline.test.ts
 *
 * Testes do guard de drift da suíte jsdom de componentes
 * (scripts/check-jsdom-baseline.mjs) — falha SOMENTE com drift PARA CIMA:
 * arquivo de teste NOVO falhando ou count de falhas CRESCENDO, comparando
 * por ARQUIVO contra um baseline commitado
 * (docs/quality/jsdom-failures-baseline.json).
 *
 * Cobre:
 *   - parseVitestJson: parse do JSON do reporter do vitest (shape jest-like)
 *     → falhas por arquivo; suite sem assertionResults (status failed) conta
 *     1; suite passed é ignorada; JSON inválido lança
 *   - buildBaseline: estrutura do arquivo (count, fileCount, updatedAt, files)
 *   - parseBaseline: valida JSON + campo files
 *   - findDrift: arquivo NOVO detectado; CRESCIMENTO detectado; melhoria
 *     (count caiu) NÃO viola; arquivo curado 100% NÃO viola; igualdade ok
 *   - CLI real (spawnSync + temp dir com fixtures de --results-file):
 *       - exit 0 quando nenhum drift além do baseline
 *       - exit 1 quando um arquivo NOVO passa a falhar (mutation)
 *       - exit 1 quando o count de um arquivo CRESCE (mutation)
 *       - exit 0 quando um arquivo MELHORA (count caiu)
 *       - --update regenera o baseline (count atual)
 *       - exit 2 quando o baseline está ausente (fail-closed)
 *       - exit 2 quando --results-file não existe (fail-closed)
 *
 * O modo --results-file lê o JSON do vitest de um FIXTURE em vez de spawnar
 * a suíte real (~6 min) — é o que torna o teste unitário e o mutation test
 * rápidos. O shape do fixture é o MESMO que o reporter do vitest emite.
 *
 * Usage:
 *   npx vitest run --config vitest.config.unit.ts src/lib/__tests__/check-jsdom-baseline.test.ts
 */

import { describe, it, expect, afterEach } from "vitest"
import { spawnSync } from "node:child_process"
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import {
  parseVitestJson,
  buildBaseline,
  parseBaseline,
  findDrift,
  normalizePath,
} from "../../../scripts/check-jsdom-baseline.mjs"

/** Shape mínimo de um resultado do reporter do vitest (jest-like). */
type VitestSuite = {
  name: string
  status: string
  assertionResults?: { status: string; fullName?: string }[]
}

const SCRIPT = resolve(process.cwd(), "scripts/check-jsdom-baseline.mjs")
const tmpDirs: string[] = []

/** Constrói um fixture de resultados do vitest a partir de suítes. */
function makeResults(suites: VitestSuite[]): string {
  return JSON.stringify({ numTotalTests: 99, testResults: suites })
}

const OK_SUITES: VitestSuite[] = [
  {
    name: "/repo/src/components/a.test.tsx",
    status: "failed",
    assertionResults: [
      { status: "failed", fullName: "a renders" },
      { status: "passed", fullName: "a clicks" },
    ],
  },
  {
    name: "/repo/src/components/b.test.tsx",
    status: "failed",
    assertionResults: [{ status: "failed", fullName: "b renders" }],
  },
  {
    name: "/repo/src/components/c.test.tsx",
    status: "passed",
    assertionResults: [{ status: "passed", fullName: "c renders" }],
  },
]

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "jsdom-base-"))
  tmpDirs.push(dir)
  return dir
}

function runCheck(dir: string, args: string[]) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: dir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

// ── parseVitestJson ────────────────────────────────────────────────────────

describe("parseVitestJson", () => {
  it("conta falhas por arquivo a partir de assertionResults (ignora passed)", () => {
    expect(parseVitestJson(makeResults(OK_SUITES))).toEqual({
      "/repo/src/components/a.test.tsx": 1,
      "/repo/src/components/b.test.tsx": 1,
    })
  })

  it("suite sem assertionResults com status failed conta 1 (shape antigo)", () => {
    const res = parseVitestJson(
      makeResults([{ name: "/repo/src/components/d.test.tsx", status: "failed" }]),
    )
    expect(res).toEqual({ "/repo/src/components/d.test.tsx": 1 })
  })

  it("sem testResults → objeto vazio (defensivo)", () => {
    expect(parseVitestJson({ numTotalTests: 0 })).toEqual({})
  })

  it("JSON inválido lança (fail-closed no main)", () => {
    expect(() => parseVitestJson("not json")).toThrow()
  })
})

// ── normalizePath (portabilidade do baseline entre ambientes) ─────────────

describe("normalizePath", () => {
  it("relativiza path absoluto do reporter contra o cwd (Windows e POSIX)", () => {
    expect(normalizePath("C:/repo/src/components/a.test.tsx", "C:/repo")).toBe(
      "src/components/a.test.tsx",
    )
    expect(
      normalizePath("/home/runner/work/r/r/src/components/a.test.tsx", "/home/runner/work/r/r"),
    ).toBe("src/components/a.test.tsx")
  })

  it("normaliza backslashes do Windows no path absoluto", () => {
    expect(normalizePath("C:\\repo\\src\\components\\b.test.tsx", "C:\\repo")).toBe(
      "src/components/b.test.tsx",
    )
  })

  it("deixa intacto path que não começa com o cwd (defensivo — fixtures)", () => {
    expect(normalizePath("/repo/src/components/a.test.tsx", "C:/worktree")).toBe(
      "/repo/src/components/a.test.tsx",
    )
  })
})

// ── buildBaseline / parseBaseline ─────────────────────────────────────────

describe("buildBaseline / parseBaseline", () => {
  const FILES = { "/repo/src/components/a.test.tsx": 1, "/repo/src/components/b.test.tsx": 2 }

  it("buildBaseline gera count + fileCount + updatedAt + files (round-trip)", () => {
    const bl = buildBaseline(FILES)
    expect(bl.count).toBe(3)
    expect(bl.fileCount).toBe(2)
    expect(bl.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(bl.files).toEqual(FILES)

    const parsed = parseBaseline(JSON.stringify(bl))
    expect(parsed.count).toBe(3)
    expect(parsed.files).toEqual(FILES)
  })

  it("parseBaseline falha com JSON inválido / sem campo files", () => {
    expect(() => parseBaseline("not json")).toThrow()
    expect(() => parseBaseline('{"count": 1}')).toThrow("files")
  })
})

// ── findDrift (a regra do guard) ───────────────────────────────────────────

describe("findDrift", () => {
  const BASELINE = { "/repo/src/components/a.test.tsx": 1, "/repo/src/components/b.test.tsx": 1 }

  it("nenhum drift quando tudo está igual ao baseline", () => {
    expect(findDrift(BASELINE, BASELINE)).toEqual({ violations: [], improved: [] })
  })

  it("detecta arquivo NOVO falhando (não está no baseline)", () => {
    const current = { ...BASELINE, "/repo/src/components/z.test.tsx": 2 }
    const { violations } = findDrift(current, BASELINE)
    expect(violations).toHaveLength(1)
    expect(violations[0]).toEqual({
      file: "/repo/src/components/z.test.tsx",
      kind: "novo",
      current: 2,
      baseline: 0,
    })
  })

  it("detecta CRESCIMENTO do count de um arquivo (1 → 3)", () => {
    const current = { ...BASELINE, "/repo/src/components/b.test.tsx": 3 }
    const { violations } = findDrift(current, BASELINE)
    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatchObject({
      file: "/repo/src/components/b.test.tsx",
      kind: "crescimento",
      current: 3,
      baseline: 1,
    })
  })

  it("MELHORIA (count caiu) não viola — entra em improved", () => {
    // b sumiu das falhas — current tem só a (curado 100% = base → 0)
    const current = { "/repo/src/components/a.test.tsx": 1 }
    const { violations, improved } = findDrift(current, BASELINE)
    expect(violations).toEqual([])
    expect(improved).toContain("/repo/src/components/b.test.tsx (1 → 0)")
  })

  it("arquivo curado 100% (removido do current) não viola", () => {
    const current = { "/repo/src/components/a.test.tsx": 1 }
    const { violations } = findDrift(current, BASELINE)
    expect(violations).toEqual([])
  })
})

// ── CLI real (temp dir + fixtures de --results-file) ───────────────────────

describe("check-jsdom-baseline.mjs — CLI real (fixtures)", () => {
  it("exit 0: nenhum drift além do baseline gerado por --update", () => {
    const dir = makeRepo()
    writeFileSync(join(dir, "results.json"), makeResults(OK_SUITES), "utf8")
    const upd = runCheck(dir, [
      "--baseline",
      "baseline.json",
      "--results-file",
      "results.json",
      "--update",
    ])
    expect(upd.status).toBe(0)
    const bl = JSON.parse(readFileSync(join(dir, "baseline.json"), "utf8"))
    expect(bl.count).toBe(2)
    expect(bl.fileCount).toBe(2)

    const check = runCheck(dir, ["--baseline", "baseline.json", "--results-file", "results.json"])
    expect(check.status).toBe(0)
    expect(check.stdout).toContain("nenhum drift")
  })

  it("exit 1: arquivo de teste NOVO passando a falhar (a mutação que o guard pega)", () => {
    const dir = makeRepo()
    writeFileSync(join(dir, "results.json"), makeResults(OK_SUITES), "utf8")
    runCheck(dir, ["--baseline", "baseline.json", "--results-file", "results.json", "--update"])

    // MUTAÇÃO: um suite NOVO falha (arquivo fora do baseline)
    const mutated = [
      ...OK_SUITES,
      {
        name: "/repo/src/components/zz.test.tsx",
        status: "failed",
        assertionResults: [{ status: "failed", fullName: "zz" }],
      },
    ]
    writeFileSync(join(dir, "results.json"), makeResults(mutated), "utf8")
    const check = runCheck(dir, ["--baseline", "baseline.json", "--results-file", "results.json"])
    expect(check.status).toBe(1)
    expect(check.stderr).toContain("NOVO arquivo falhando")
    expect(check.stderr).toContain("zz.test.tsx")
  })

  it("exit 1: count de falhas de um arquivo CRESCE (baseline 1 → 3)", () => {
    const dir = makeRepo()
    writeFileSync(join(dir, "results.json"), makeResults(OK_SUITES), "utf8")
    runCheck(dir, ["--baseline", "baseline.json", "--results-file", "results.json", "--update"])

    // MUTAÇÃO: o suite b passa a ter 3 testes falhando (antes 1)
    const mutated = OK_SUITES.map((s) =>
      s.name.endsWith("b.test.tsx")
        ? {
            ...s,
            assertionResults: [{ status: "failed" }, { status: "failed" }, { status: "failed" }],
          }
        : s,
    )
    writeFileSync(join(dir, "results.json"), makeResults(mutated), "utf8")
    const check = runCheck(dir, ["--baseline", "baseline.json", "--results-file", "results.json"])
    expect(check.status).toBe(1)
    expect(check.stderr).toContain("Crescimento")
    expect(check.stderr).toContain("b.test.tsx")
  })

  it("exit 0: arquivo MELHORA (count caiu) — melhoria não bloqueia", () => {
    const dir = makeRepo()
    writeFileSync(join(dir, "results.json"), makeResults(OK_SUITES), "utf8")
    runCheck(dir, ["--baseline", "baseline.json", "--results-file", "results.json", "--update"])

    // Melhoria: b foi curado (suite passa)
    const improved = OK_SUITES.map((s) =>
      s.name.endsWith("b.test.tsx") ? { ...s, status: "passed", assertionResults: [] } : s,
    )
    writeFileSync(join(dir, "results.json"), makeResults(improved), "utf8")
    const check = runCheck(dir, ["--baseline", "baseline.json", "--results-file", "results.json"])
    expect(check.status).toBe(0)
    expect(check.stdout).toContain("Melhorias")
  })

  it("--update regenera o baseline com o count atual", () => {
    const dir = makeRepo()
    writeFileSync(join(dir, "results.json"), makeResults(OK_SUITES), "utf8")
    const upd = runCheck(dir, [
      "--baseline",
      "base.json",
      "--results-file",
      "results.json",
      "--update",
    ])
    expect(upd.status).toBe(0)
    const bl = JSON.parse(readFileSync(join(dir, "base.json"), "utf8"))
    expect(bl.count).toBe(2)

    const check = runCheck(dir, ["--baseline", "base.json", "--results-file", "results.json"])
    expect(check.status).toBe(0)
  })

  it("exit 2: baseline ausente sem --update (fail-closed com instrução)", () => {
    const dir = makeRepo()
    writeFileSync(join(dir, "results.json"), makeResults(OK_SUITES), "utf8")
    const res = runCheck(dir, ["--baseline", "missing.json", "--results-file", "results.json"])
    expect(res.status).toBe(2)
    expect(res.stderr).toContain("Baseline ausente")
    expect(res.stderr).toContain("--update")
  })

  it("exit 2: --results-file inexistente (fail-closed)", () => {
    const dir = makeRepo()
    const res = runCheck(dir, ["--baseline", "base.json", "--results-file", "nope.json"])
    expect(res.status).toBe(2)
    expect(res.stderr).toContain("--results-file")
  })
})
