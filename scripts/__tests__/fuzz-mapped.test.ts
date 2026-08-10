/**
 * fuzz-mapped.test.ts - suite hermética do pacote fuzz mapeado (secao 11.11
 * do gates-proofs.md, adotado 2026-08-10): scripts/fuzz-targets.mjs
 * (manifest) + scripts/run-mapped-fuzz.mjs (runner do Gate 2 do pre-push).
 *
 * O QUE ESTA TRAVADO AQUI:
 *  1. MANIFEST: selectFuzzSuites resolve alvo -> suite(s), a aresta
 *     shared-helper dispara TODAS, arquivo nao-fuzz nao seleciona nada,
 *     backslashes sao normalizados.
 *  2. PLAN (runner): resolveFuzzPlan - since invalido/zeros = fallback FULL
 *     (todas as suites), since valido sem match = SKIP, com match = MAPPED.
 *  3. COVERAGE CONTRACT (a classe de gap silencioso da secao 11.11 ponto 5):
 *     uma suite *-fuzz*.test.{ts,tsx} NOVA em src/ SEM entrada no manifest
 *     rodaria so no CI (o runner mapeado nao a seleciona). O CLI
 *     --check-coverage falha com o caminho exato - testado de forma
 *     HERMETICA via FUZZ_TARGETS_SCAN_ROOT (root sintetico) e como
 *     REAL-REPO CONTRACT (o repo real hoje: toda suite descoberta pelo
 *     run-all-fuzz tem manifest E toda entrada do manifest existe em src/ -
 *     sincronia nos dois sentidos, nenhuma orfa).
 *
 * Hermetico: os testes de selecao/plan sao puros (sem fs, sem git); os de
 * cobertura usam root sintetico via env override. Subprocess-heavy (CLI
 * spawns via runSubprocess) -> timeout explicito em todo it().
 */
import { afterEach, describe, expect, it } from "vitest"
import fs from "node:fs"
import path from "node:path"
import { cleanupTempDirs, createTempDir, runSubprocess } from "./golden-copy-utils"
import {
  FUZZ_TARGETS,
  SHARED_HELPER_FILES,
  allFuzzSuites,
  discoverFuzzSuites,
  isFuzzFile,
  missingManifestSuites,
  selectFuzzSuites,
} from "../fuzz-targets.mjs"
import { parseSince, resolveFuzzPlan } from "../run-mapped-fuzz.mjs"

const TARGETS_SCRIPT = path.resolve(process.cwd(), "scripts", "fuzz-targets.mjs")

function runCheckCoverage(dir: string) {
  return runSubprocess({
    command: process.execPath,
    args: [TARGETS_SCRIPT, "--check-coverage"],
    env: { FUZZ_TARGETS_SCAN_ROOT: dir },
  })
}

/** Write the 6 manifest suites under a synthetic root's src/ tree. */
function writeManifestSuites(dir: string) {
  for (const entry of FUZZ_TARGETS) {
    const p = path.join(dir, entry.suite)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, "// synthetic fuzz suite\n")
  }
}

/** A fuzz-suite filename the run-all-fuzz matcher would discover. */
const EXTRA_SUITE = "src/lib/__tests__/brand-new-fuzz.test.ts"

describe("fuzz-targets.mjs - manifest suite -> alvos", () => {
  afterEach(cleanupTempDirs)

  it("alvo -> suite: tocar radius-expansion.ts seleciona cache-key + radius-expansion (ambos, ordem do manifest)", () => {
    const got = selectFuzzSuites(["src/lib/radius-expansion.ts"])
    expect(got).toEqual([
      "src/lib/__tests__/cache-key-fuzz.test.ts",
      "src/lib/__tests__/radius-expansion-fuzz.test.ts",
    ])
  }, 60000)

  it("alvo -> suite: benchmark-utils.ts seleciona so benchmark-utils", () => {
    const got = selectFuzzSuites(["src/lib/benchmark-utils.ts"])
    expect(got).toEqual(["src/lib/__tests__/benchmark-utils-fuzz.test.ts"])
  }, 60000)

  it("alvo -> suite: address-autocomplete.tsx seleciona a suite vitrine (componente, nao helper de lib)", () => {
    const got = selectFuzzSuites(["src/components/vitrine/address-autocomplete.tsx"])
    expect(got).toEqual([
      "src/components/vitrine/__tests__/address-autocomplete-fuzz.test.tsx",
    ])
  }, 60000)

  it("aresta SHARED-HELPER: tocar fuzz-utils.ts dispara TODAS as suites", () => {
    const got = selectFuzzSuites(["src/lib/__tests__/fuzz-utils.ts"])
    expect(got).toEqual(allFuzzSuites())
    expect(got.length).toBe(FUZZ_TARGETS.length)
  }, 60000)

  it("aresta SHARED-HELPER: tocar fuzz-utils.mjs (shim) dispara TODAS as suites", () => {
    const got = selectFuzzSuites(["src/lib/fuzz-utils.mjs"])
    expect(got).toEqual(allFuzzSuites())
  }, 60000)

  it("aresta SHARED-HELPER: tocar o barrel src/lib/__tests__/index.ts dispara TODAS as suites", () => {
    expect(SHARED_HELPER_FILES).toContain("src/lib/__tests__/index.ts")
    const got = selectFuzzSuites(["src/lib/__tests__/index.ts"])
    expect(got).toEqual(allFuzzSuites())
  }, 60000)

  it("arquivo nao-fuzz (docs/admin/ui) nao seleciona nada", () => {
    const got = selectFuzzSuites([
      "docs/ascii-safe.md",
      "src/components/admin/admin-settings.tsx",
      ".github/workflows/pr-check.yml",
    ])
    expect(got).toEqual([])
  }, 60000)

  it("normaliza backslashes (caminho Windows nativo == caminho POSIX do git)", () => {
    const got = selectFuzzSuites(["src\\lib\\radius-expansion.ts"])
    expect(got).toEqual([
      "src/lib/__tests__/cache-key-fuzz.test.ts",
      "src/lib/__tests__/radius-expansion-fuzz.test.ts",
    ])
  }, 60000)

  it("isFuzzFile: reconhece as suites fuzz e rejeita nao-fuzz (refuzz nao casa; foo-fuzzer E casa - o matcher do run-all-fuzz)", () => {
    for (const suite of allFuzzSuites()) expect(isFuzzFile(suite)).toBe(true)
    // fuzz sem separador no inicio do nome NAO casa (a classe que o
    // run-all-fuzz documenta evitar: refuzz.test.ts)
    expect(isFuzzFile("src/lib/refuzz.test.ts")).toBe(false)
    expect(isFuzzFile("src/lib/foo.test.ts")).toBe(false)
    // fuzz precedido de separador casa MESMO com sufixo (foo-fuzzer = fuzz + er
    // .test) - o matcher e permissivo de proposito, e o coverage contract
    // exige manifest para qualquer suite que ele descubra
    expect(isFuzzFile("src/lib/foo-fuzzer.test.ts")).toBe(true)
  }, 60000)

  it("discoverFuzzSuites: root sintetico descobre so as suites fuzz (POSIX rel, ordenado)", () => {
    const dir = createTempDir("fuzz-targets-")
    writeManifestSuites(dir)
    fs.writeFileSync(path.join(dir, "src/lib/__tests__/plain.test.ts"), "// not fuzz\n")
    const got = discoverFuzzSuites(dir)
    expect(got).toEqual([...allFuzzSuites()].sort())
  }, 60000)
})

describe("run-mapped-fuzz.mjs - resolveFuzzPlan (logica pura, sem git/fs)", () => {
  afterEach(cleanupTempDirs)

  it("since ausente/zeros (primeiro push ou rodada manual) -> fallback FULL com todas as suites", () => {
    for (const since of ["", "0000000000000000000000000000000000000000"]) {
      expect(resolveFuzzPlan({ since, touched: [], allSuites: allFuzzSuites() })).toEqual({
        mode: "full",
        suites: allFuzzSuites(),
      })
    }
  }, 60000)

  it("since valido + diff sem superficie fuzz -> SKIP (exit 0, fast path docs/admin/ui)", () => {
    const plan = resolveFuzzPlan({
      since: "abc123",
      touched: ["docs/ascii-safe.md", "src/components/admin/admin-settings.tsx"],
      allSuites: allFuzzSuites(),
    })
    expect(plan).toEqual({ mode: "skip", suites: [] })
  }, 60000)

  it("since valido + alvo tocado -> MAPPED com as suites selecionadas", () => {
    const plan = resolveFuzzPlan({
      since: "abc123",
      touched: ["src/lib/radius-expansion.ts"],
      allSuites: allFuzzSuites(),
    })
    expect(plan.mode).toBe("mapped")
    expect(plan.suites).toEqual([
      "src/lib/__tests__/cache-key-fuzz.test.ts",
      "src/lib/__tests__/radius-expansion-fuzz.test.ts",
    ])
  }, 60000)

  it("since valido + helper compartilhado tocado -> MAPPED com TODAS as suites (aresta preservada no plan)", () => {
    const plan = resolveFuzzPlan({
      since: "abc123",
      touched: ["src/lib/__tests__/fuzz-utils.ts"],
      allSuites: allFuzzSuites(),
    })
    expect(plan).toEqual({ mode: "mapped", suites: allFuzzSuites() })
  }, 60000)

  it("parseSince: le --since next-arg; ausente -> vazio (o fallback do hook)", () => {
    expect(parseSince(["--since", "abc123"])).toBe("abc123")
    expect(parseSince([])).toBe("")
    expect(parseSince(["--since"])).toBe("")
  }, 60000)
})

describe("fuzz-targets.mjs - COVERAGE CONTRACT (secao 11.11 ponto 5, classe de gap silencioso)", () => {
  afterEach(cleanupTempDirs)

  it("hermetico CLEAN: root sintetico com as 6 suites do manifest -> exit 0", () => {
    const dir = createTempDir("fuzz-cov-")
    writeManifestSuites(dir)
    const r = runCheckCoverage(dir)
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("coverage clean")
    // derived count, never a magic literal - a 7th suite added to both src/
    // and the manifest self-adjusts instead of tripping a stale pin
    expect(r.stdout).toContain(`${FUZZ_TARGETS.length} suite(s)`)
  }, 60000)

  it("hermetico DIRTY: suite fuzz NOVA sem entrada no manifest -> exit 1 com o caminho exato (rodaria so no CI)", () => {
    const dir = createTempDir("fuzz-cov-")
    writeManifestSuites(dir)
    fs.mkdirSync(path.dirname(path.join(dir, EXTRA_SUITE)), { recursive: true })
    fs.writeFileSync(path.join(dir, EXTRA_SUITE), "// new suite missing from manifest\n")
    const r = runCheckCoverage(dir)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain(`FUZZ SUITE SEM MANIFEST em ${EXTRA_SUITE}`)
    // only the extra suite trips - the 6 known ones never appear as missing
    expect(r.stdout).not.toContain("benchmark-utils-fuzz")
  }, 60000)

  it("root sintetico sem src/ -> clean (arvore minima nao trip)", () => {
    const dir = createTempDir("fuzz-cov-")
    const r = runCheckCoverage(dir)
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("coverage clean")
    expect(r.stdout).toContain("0 suite(s)")
  }, 60000)

  it("REAL-REPO CONTRACT: toda suite descoberta em src/ tem manifest E toda entrada do manifest existe em src/ (sincronia nos dois sentidos)", () => {
    const root = process.cwd()
    const discovered = discoverFuzzSuites(root)
    // the lock: a new *-fuzz*.test.{ts,tsx} in src/ without a manifest entry
    // fails here FIRST (the exact gap the CLI catches too) - via the EXPORTED
    // function, the same one the CLI --check-coverage runs
    expect(missingManifestSuites(root)).toEqual([])
    const orphan = allFuzzSuites().filter(
      (s) => !fs.existsSync(path.join(root, s)) || !isFuzzFile(s),
    )
    expect(orphan).toEqual([])
    expect(discovered.length).toBe(FUZZ_TARGETS.length)
    // every manifest TARGET exists on disk (a dead target would select a
    // suite that never runs when its file is touched)
    const deadTargets = FUZZ_TARGETS.flatMap((e) =>
      e.targets.filter((t) => !fs.existsSync(path.join(root, t))).map((t) => `${e.suite} -> ${t}`),
    )
    expect(deadTargets).toEqual([])
  }, 60000)

  it("REAL-REPO CONTRACT: CLI --check-coverage no repo real -> exit 0 (o estado atual e a sincronia)", () => {
    const r = runSubprocess({
      command: process.execPath,
      args: [TARGETS_SCRIPT, "--check-coverage"],
    })
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("coverage clean")
  }, 60000)
})
