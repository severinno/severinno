/**
 * scan-hook-parallel-race.test.ts - suite hermética do guard de estabilidade
 * do par paralelo lint-staged | tsc (secao 11.8 do gates-proofs.md).
 *
 * O QUE ESTA TRAVADO AQUI:
 *  1. PARSE: parseIterations - flag --iterations > env > default 10.
 *  2. PROBE: probeContent() e TS valido nos DOIS estados (let/const) e
 *     ASCII puro; isProbeFixed() detecta a reescrita let -> const.
 *  3. TRANSIENT: detectTransient - tsc != 0 com baseline 0 = raca; com
 *     baseline != 0 = erro real (nao e raca, retorna []).
 *  4. CLI HERMETICO (fake commands + PARALLEL_RACE_ROOT sintetico +
 *     PARALLEL_RACE_SKIP_GIT=1): o par roda de verdade com comandos fake
 *     via env - baseline ok + N runs limpos -> exit 0 "race-stable";
 *     MUTATION transient (fake tsc exit 1 num run especifico) -> exit 1
 *     com "TRANSIENT TS ERROR em run(s) [N]"; MUTATION baseline vermelho
 *     (fake tsc exit 1 sempre) -> exit 1 com "BASELINE tsc FAILED";
 *     probe nunca fixado (fake lint nao reescreve) -> exit 1 com "prova
 *     vacua".
 *
 * O CLI real (bun run typecheck + bun x lint-staged) NAO roda aqui - o
 * custo real do par (~17-55s por run) pertence ao job dedicado
 * hook-parallel-race.yml (N=10); esta suite prova a LOGICA e a FIAÇAO
 * com comandos fake rapidos (o padrao FRAGILE_SCAN_ROOT dos outros
 * guards). Subprocess-heavy -> timeout explicito em todo it().
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { cleanupTempDirs, createTempDir, runSubprocess } from "./golden-copy-utils"
import { detectTransient, isProbeFixed, parseIterations, probeContent } from "../scan-hook-parallel-race.mjs"

const SCRIPT = path.resolve(process.cwd(), "scripts", "scan-hook-parallel-race.mjs")

/** Fake tsc: exit 1 so quando FAKE_TSC_FAIL_AT for atingido (1-based). */
const FAKE_TSC = path.join(os.tmpdir(), "race-fake-tsc.mjs")

/** Fake lint: reescreve o probe (let -> const) quando FAKE_LINT_FIX != "0". */
const FAKE_LINT = path.join(os.tmpdir(), "race-fake-lint.mjs")

/**
 * Roda o CLI do guard com fake commands num root sintetico. O env carrega
 * os overrides PARALLEL_RACE_* (root, comandos, probe, skip-git) + os
 * controles dos fakes (FAKE_TSC_COUNTER/FAIL_AT, FAKE_LINT_PROBE/FIX).
 */
function runGuard(root: string, opts: { iterations?: number; failAt?: number; lintFix?: boolean } = {}) {
  const counter = path.join(root, "fake-counter.txt")
  fs.rmSync(counter, { force: true })
  const env: Record<string, string> = {
    PARALLEL_RACE_ROOT: root,
    PARALLEL_RACE_ITERATIONS: String(opts.iterations ?? 3),
    PARALLEL_RACE_TSC_CMD: `node "${FAKE_TSC}"`,
    PARALLEL_RACE_LINT_CMD: `node "${FAKE_LINT}"`,
    PARALLEL_RACE_SKIP_GIT: "1",
    PARALLEL_RACE_PROBE_REL: "e2e/__race_probe__.ts",
    FAKE_TSC_COUNTER: counter,
    FAKE_TSC_FAIL_AT: String(opts.failAt ?? 0),
    FAKE_LINT_PROBE: path.join(root, "e2e", "__race_probe__.ts"),
    FAKE_LINT_FIX: opts.lintFix === false ? "0" : "1",
  }
  return runSubprocess({ command: process.execPath, args: [SCRIPT], env, timeoutMs: 60_000 })
}

function writeFakes() {
  fs.writeFileSync(
    FAKE_TSC,
    [
      'import fs from "node:fs"',
      "const counter = process.env.FAKE_TSC_COUNTER",
      "const failAt = Number(process.env.FAKE_TSC_FAIL_AT || \"0\")",
      "const n = (fs.existsSync(counter) ? Number(fs.readFileSync(counter, \"utf8\")) : 0) + 1",
      "fs.writeFileSync(counter, String(n))",
      "process.exit(failAt > 0 && n === failAt ? 1 : 0)",
      "",
    ].join("\n"),
    "utf8",
  )
  fs.writeFileSync(
    FAKE_LINT,
    [
      'import fs from "node:fs"',
      "const probe = process.env.FAKE_LINT_PROBE",
      'const fix = process.env.FAKE_LINT_FIX !== "0"',
      "if (fix && probe && fs.existsSync(probe)) {",
      '  const src = fs.readFileSync(probe, "utf8")',
      '  fs.writeFileSync(probe, src.replace("let raceProbeValue", "const raceProbeValue"))',
      "}",
      "process.exit(0)",
      "",
    ].join("\n"),
    "utf8",
  )
}

afterEach(() => {
  cleanupTempDirs()
})

describe("scripts/scan-hook-parallel-race.mjs - funcoes puras", () => {
  it("parseIterations: flag --iterations > env > default 10", () => {
    expect(parseIterations([])).toBe(10)
    expect(parseIterations(["--iterations", "5"])).toBe(5)
    expect(parseIterations([], { PARALLEL_RACE_ITERATIONS: "7" } as unknown as NodeJS.ProcessEnv)).toBe(7)
    expect(parseIterations(["--iterations", "3"], { PARALLEL_RACE_ITERATIONS: "7" } as unknown as NodeJS.ProcessEnv)).toBe(3)
    expect(parseIterations(["--iterations", "0"])).toBe(10) // invalido -> default
    expect(parseIterations(["--iterations"])).toBe(10) // sem valor -> default
  })

  it("probeContent: TS valido nos dois estados (let e const) e ASCII puro", () => {
    const c = probeContent()
    expect(c).toContain("let raceProbeValue = 1")
    expect(c).toContain("export { raceProbeValue }")
    expect(c).not.toContain("const raceProbeValue") // estado sujo
    // ASCII puro (gate file): nenhum byte > 127
    expect(/[^\x00-\x7f]/.test(c)).toBe(false)
  })

  it("isProbeFixed: let -> const e detectado; estado sujo nao", () => {
    expect(isProbeFixed("const raceProbeValue = 1\n")).toBe(true)
    expect(isProbeFixed("let raceProbeValue = 1\n")).toBe(false)
  })

  it("detectTransient: tsc != 0 com baseline 0 = raca; com baseline != 0 = erro real (nao e raca)", () => {
    const runs = [
      { run: 1, tscExit: 0, lintExit: 0 },
      { run: 2, tscExit: 1, lintExit: 0 },
      { run: 3, tscExit: 0, lintExit: 0 },
    ]
    expect(detectTransient(runs, 0)).toEqual([2])
    expect(detectTransient(runs, 1)).toEqual([]) // baseline vermelho: erro real, nao raca
    expect(detectTransient([], 0)).toEqual([])
  })
})

describe("scripts/scan-hook-parallel-race.mjs - CLI hermetico (fake commands)", () => {
  beforeAll(writeFakes)

  it("baseline ok + 3 runs limpos -> exit 0 race-stable (par roda de verdade)", () => {
    const dir = createTempDir("race-clean-")
    const r = runGuard(dir, { iterations: 3 })
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("baseline tsc ok")
    expect(r.stdout).toContain("run 1/3: tsc=0 lint=0 probeFixed=true ok")
    expect(r.stdout).toContain("race-stable: 3/3 runs")
    // o probe foi limpo no finally
    expect(fs.existsSync(path.join(dir, "e2e", "__race_probe__.ts"))).toBe(false)
  }, 60000)

  it("MUTATION transient: fake tsc exit 1 no run 2 -> exit 1 com run nomeado (a raca materializou)", () => {
    const dir = createTempDir("race-transient-")
    // baseline = chamada 1 (exit 0), run 1 = chamada 2 (exit 0),
    // run 2 = chamada 3 (exit 1) -> transient no run 2
    const r = runGuard(dir, { iterations: 3, failAt: 3 })
    expect(r.status).toBe(1)
    expect(r.stderr).toContain("TRANSIENT TS ERROR em run(s) [2]")
    expect(r.stderr).toContain("REVERTA o bloco paralelo")
    // baseline ok aparece (a falha NAO foi confundida com erro real)
    expect(r.stdout).toContain("baseline tsc ok")
  }, 60000)

  it("MUTATION baseline vermelho: fake tsc exit 1 sempre -> exit 1 com BASELINE (erro real, nao raca)", () => {
    const dir = createTempDir("race-baseline-")
    const r = runGuard(dir, { iterations: 2, failAt: 1 })
    expect(r.status).toBe(1)
    expect(r.stderr).toContain("BASELINE tsc FAILED")
    expect(r.stderr).toContain("erro TS REAL")
    // nao confunde com transient
    expect(r.stderr).not.toContain("TRANSIENT")
  }, 60000)

  it("MUTATION probe nunca fixado: fake lint nao reescreve -> exit 1 prova vacua", () => {
    const dir = createTempDir("race-nofix-")
    const r = runGuard(dir, { iterations: 2, lintFix: false })
    expect(r.status).toBe(1)
    expect(r.stderr).toContain("probe NUNCA foi reescrito")
    expect(r.stderr).toContain("prova vacua")
  }, 60000)

  it("cleanup: probe removido apos rodada suja (finally - so o probe e contrato do guard; o counter e artefato do fake tsc)", () => {
    const dir = createTempDir("race-cleanup-")
    const r = runGuard(dir, { iterations: 2 })
    expect(r.status).toBe(0)
    // O finally do guard remove o probe - o artefato central do cleanup.
    expect(fs.existsSync(path.join(dir, "e2e", "__race_probe__.ts"))).toBe(false)
    // O counter e criado pelo FAKE tsc (nao pelo guard) - nao e contrato.
    expect(fs.existsSync(path.join(dir, "fake-counter.txt"))).toBe(true)
  }, 60000)

  it("CLI: o script roda com o repo real sem tocar no index (PARALLEL_RACE_SKIP_GIT=1, comandos fake)", () => {
    // Prova de fiação no repo real: o CLI resolve o root real, roda o par
    // fake, e nao deixa probe nem staged (skip-git). O probe real
    // e2e/__race_probe__.ts e criado transitoriamente (o finally do guard
    // o remove) - o cleanup defensivo abaixo cobre o caso de o subprocess
    // ser morto por timeout: o probe nunca pode sobrar no working tree
    // real (untracked sujo que o fragile-range veria no proximo commit).
    const REAL_PROBE = path.join(process.cwd(), "e2e", "__race_probe__.ts")
    try {
      const r = runSubprocess({
        command: process.execPath,
        args: [SCRIPT],
        env: {
          PARALLEL_RACE_ROOT: process.cwd(),
          PARALLEL_RACE_ITERATIONS: "1",
          PARALLEL_RACE_TSC_CMD: `node "${FAKE_TSC}"`,
          PARALLEL_RACE_LINT_CMD: `node "${FAKE_LINT}"`,
          PARALLEL_RACE_SKIP_GIT: "1",
          FAKE_TSC_COUNTER: path.join(os.tmpdir(), "race-real-counter.txt"),
          FAKE_TSC_FAIL_AT: "0",
          FAKE_LINT_PROBE: REAL_PROBE,
          FAKE_LINT_FIX: "1",
        },
        timeoutMs: 60_000,
      })
      expect(r.status).toBe(0)
      expect(r.stdout).toContain("race-stable: 1/1 runs")
    } finally {
      // Cleanup defensivo (timeout/kill do child): nunca deixa probe no
      // working tree real, mesmo que o finally do guard nao rode.
      fs.rmSync(REAL_PROBE, { force: true })
    }
    expect(fs.existsSync(REAL_PROBE)).toBe(false)
  }, 60000)
})
