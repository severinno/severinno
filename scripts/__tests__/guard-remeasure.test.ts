/**
 * guard-remeasure.test.ts - pins the guard-remeasure helper (sec 11.81).
 *
 * WHY: a re-mediacao da sec 8.1 (a banda 19-23.5s do step test:guard) era um
 * ciclo MANUAL de 4 passos (dispatch + abrir o log + extrair timestamps +
 * comparar com a banda). O helper automatiza o ciclo: dispatch do
 * guard-gates via ci-proof-run, extracao do step do log capturado,
 * comparacao com a banda registrada e o veredito do no-filter. Esta suite
 * pina as FUNCOES PURAS (extracao + veredito) com log sintetico e o CICLO
 * hermetico com o fake cmd (GUARD_REMEASURE_CIPROOF_CMD -> o fixture
 * guard-remeasure-fake-cmd.mjs, o mesmo padrao do DOC_REVALIDATE_CLI_CMD).
 *
 * Subprocess-heavy (os E2E spawnam node) -> um timeout explicito em todo
 * it() que roda o CLI (o scan-timeouts guard exige).
 */
import { afterEach, describe, expect, it } from "vitest"
import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import {
  GUARD_BAND,
  bandVerdict,
  buildCiproveCmd,
  extractTestCounts,
  parseArgs,
  parseDoneLine,
  parseLogTs,
  stepSpan,
} from "../guard-remeasure.mjs"
import { cleanupTempDirs, createTempDir } from "./golden-copy-utils"

const SCRIPT = path.resolve(process.cwd(), "scripts", "guard-remeasure.mjs")
const FAKE_CMD = path.resolve(process.cwd(), "scripts", "__tests__", "fixtures", "guard-remeasure-fake-cmd.mjs")

const STEP = "Run guard vitest suites (BASELINE + divergence guards)"
const NEXT_STEP = "Scan subprocess-heavy tests for explicit timeouts"

/** Uma linha de log do GitHub Actions no formato real do job log. */
function logLine(step: string, ts: string, content = "##[group]Run bun run test:guard"): string {
  return `Guard Gates (fragile-range + golden-copy)\t${step}\t${ts} ${content}`
}

/** O log sintetico da re-mediacao (6) (run 31595541005: step 22.47s). */
const SYNTH_LOG_22 = [
  logLine(STEP, "2026-08-12T12:15:34.4869012Z", "\uFEFF##[group]Run bun run test:guard"),
  logLine(STEP, "2026-08-12T12:15:34.4913761Z", "shell: /usr/bin/bash -e {0}"),
  logLine(STEP, "2026-08-12T12:15:56.9349212Z", "\u001b[2m Test Files \u001b[22m \u001b[1m\u001b[32m14 passed\u001b[39m\u001b[22m"),
  logLine(STEP, "2026-08-12T12:15:56.9350192Z", "\u001b[2m      Tests \u001b[22m \u001b[1m\u001b[32m304 passed\u001b[39m\u001b[22m"),
  logLine(NEXT_STEP, "2026-08-12T12:15:56.9601480Z", "##[group]Run node scripts/scan-timeouts.mjs --ci"),
].join("\n")

function runCli(args: string[], env: Record<string, string> = {}): { status: number; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
    timeout: 30_000,
  })
  return { status: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" }
}

afterEach(() => {
  cleanupTempDirs()
})

// ---------------------------------------------------------------------------
// 1. Funcoes puras - extracao do step do log
// ---------------------------------------------------------------------------

describe("guard-remeasure - parseLogTs", () => {
  it("extrai o timestamp ISO do campo (incluindo o BOM do 1o ##[group])", () => {
    expect(parseLogTs("2026-08-12T12:15:34.4869012Z ##[group]Run")).toBe(
      Date.parse("2026-08-12T12:15:34.4869012Z"),
    )
    expect(parseLogTs("\uFEFF2026-08-12T12:15:34.4869012Z ##[group]Run")).toBe(
      Date.parse("2026-08-12T12:15:34.4869012Z"),
    )
  })

  it("retorna null sem timestamp", () => {
    expect(parseLogTs("sem timestamp aqui")).toBeNull()
    expect(parseLogTs("")).toBeNull()
  })
})

describe("guard-remeasure - stepSpan", () => {
  it("mede o span do step: 1a linha do step -> 1a linha do PROXIMO step (22.47s do sintetico)", () => {
    const span = stepSpan(SYNTH_LOG_22, STEP)
    expect(span).not.toBeNull()
    expect(span!.seconds).toBeCloseTo(22.47, 2)
    expect(span!.startMs).toBe(Date.parse("2026-08-12T12:15:34.4869012Z"))
    expect(span!.endMs).toBe(Date.parse("2026-08-12T12:15:56.9601480Z"))
  })

  it("retorna null quando o step nao existe no log", () => {
    expect(stepSpan(SYNTH_LOG_22, "step inexistente")).toBeNull()
  })

  it("retorna null quando o log termina SEM o proximo step (delimitador ausente)", () => {
    const truncated = [logLine(STEP, "2026-08-12T12:15:34.4869012Z"), logLine(STEP, "2026-08-12T12:15:40.0000000Z")].join("\n")
    expect(stepSpan(truncated, STEP)).toBeNull()
  })
})

describe("guard-remeasure - extractTestCounts", () => {
  it("extrai Test Files / Tests do log ANSI-stripped", () => {
    const c = extractTestCounts(SYNTH_LOG_22)
    expect(c).toEqual({ files: 14, tests: 304 })
  })

  it("retorna null sem o resumo do vitest", () => {
    expect(extractTestCounts("log sem vitest")).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 2. Funcoes puras - veredito da banda
// ---------------------------------------------------------------------------

describe("guard-remeasure - bandVerdict (sec 8.1)", () => {
  it("dentro da banda 19-23.5s = calibrado (ok)", () => {
    const v = bandVerdict(22.5, GUARD_BAND)
    expect(v.ok).toBe(true)
    expect(v.message).toContain("no-filter continua calibrado")
  })

  it("fora da banda (acima) = ALERTA de reabertura", () => {
    const v = bandVerdict(27.0, GUARD_BAND)
    expect(v.ok).toBe(false)
    expect(v.message).toContain("ALERTA")
    expect(v.message).toContain("FORA da banda")
  })

  it("fora da banda (abaixo) = ALERTA (o incomumente rapido tambem reabre)", () => {
    const v = bandVerdict(12.0, GUARD_BAND)
    expect(v.ok).toBe(false)
    expect(v.message).toContain("ALERTA")
  })

  it("GUARD_BAND bate com o fato calibrado da sec 8.1 (19-23.5s)", () => {
    expect(GUARD_BAND).toEqual({ min: 19, max: 23.5 })
  })
})

// ---------------------------------------------------------------------------
// 3. Funcoes puras - o DONE line e o comando do ciclo
// ---------------------------------------------------------------------------

describe("guard-remeasure - parseDoneLine", () => {
  it("extrai run/url/conclusion/log do DONE line do ci-proof-run", () => {
    const d = parseDoneLine(
      "ci-proof-run: DONE run=31595541005 url=https://github.com/severinno/severinno/actions/runs/31595541005 conclusion=success log=C:\\tmp\\ci-proof-x-31595541005.log",
    )
    expect(d).toEqual({
      run: "31595541005",
      url: "https://github.com/severinno/severinno/actions/runs/31595541005",
      conclusion: "success",
      log: "C:\\tmp\\ci-proof-x-31595541005.log",
    })
  })

  it("retorna null sem o DONE line", () => {
    expect(parseDoneLine("sem DONE")).toBeNull()
    expect(parseDoneLine("")).toBeNull()
  })
})

describe("guard-remeasure - buildCiproveCmd", () => {
  it("monta o comando do ciclo: dispatch do guard-gates + poll do job + expect success", () => {
    const opts = parseArgs(["--branch", "ci-proof/remeasure-test"])
    const cmd = buildCiproveCmd(opts)
    expect(cmd).toContain("ci-proof-run.mjs")
    expect(cmd).toContain("--branch ci-proof/remeasure-test")
    expect(cmd).toContain(".github/workflows/guard-gates.yml")
    expect(cmd).toContain("--only-jobs \"Guard Gates (fragile-range + golden-copy)\"")
    expect(cmd).toContain("--expect success")
    expect(cmd).not.toContain("--stash-uncommitted")
  })

  it("repassa --stash-uncommitted / --timeout / --clean / --keep-branch", () => {
    const opts = parseArgs([
      "--branch",
      "ci-proof/remeasure-test",
      "--stash-uncommitted",
      "--timeout",
      "300",
      "--clean",
      "--keep-branch",
    ])
    const cmd = buildCiproveCmd(opts)
    expect(cmd).toContain("--stash-uncommitted")
    expect(cmd).toContain("--timeout 300")
    expect(cmd).toContain("--expect-success-implies-clean")
    expect(cmd).toContain("--keep-branch")
  })
})

describe("guard-remeasure - parseArgs", () => {
  it("defaults: branch ci-proof/remeasure-<data-local> + banda GUARD_BAND", () => {
    const opts = parseArgs([])
    expect(opts.error).toBeNull()
    expect(opts.branch).toMatch(/^ci-proof\/remeasure-\d{4}-\d{2}-\d{2}$/)
    expect(opts.band).toEqual(GUARD_BAND)
  })

  it("--band valido parseia min-max", () => {
    const opts = parseArgs(["--band", "20-24"])
    expect(opts.error).toBeNull()
    expect(opts.band).toEqual({ min: 20, max: 24 })
  })

  it("--band malformado = usage (exit 2)", () => {
    expect(parseArgs(["--band", "20"]).error).toContain("min-max")
    expect(parseArgs(["--band", "25-20"]).error).toContain("min > max")
  })
})

// ---------------------------------------------------------------------------
// 4. E2E hermetico - o ciclo com o fake cmd (GUARD_REMEASURE_CIPROOF_CMD)
// ---------------------------------------------------------------------------

describe("guard-remeasure - E2E com o fake cmd", () => {
  it("ciclo completo: fake DONE + log sintetico dentro da banda -> exit 0 com o veredito calibrado", () => {
    const dir = createTempDir("guard-rm-ok-")
    const logPath = path.join(dir, "job.log")
    fs.writeFileSync(logPath, SYNTH_LOG_22, "utf8")
    const r = runCli(["--branch", "ci-proof/remeasure-e2e"], {
      // `node` no PATH (nao process.execPath: o caminho real tem espaco em
      // 'Program Files' e o shell:true quebraria o comando - o padrao do
      // DOC_REVALIDATE_CLI_CMD = 'node scripts/...')
      GUARD_REMEASURE_CIPROOF_CMD: `node ${FAKE_CMD}`,
      GUARD_REMEASURE_FAKE_LOG: logPath,
      GUARD_REMEASURE_FAKE_RUN: "777",
    })
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("run #777 (success)")
    expect(r.stdout).toContain("22.47s")
    expect(r.stdout).toContain("14 suites / 304 testes")
    expect(r.stdout).toContain("no-filter continua calibrado")
  })

  it("ciclo com log FORA da banda -> exit 1 com o ALERTA de reabertura", () => {
    const dir = createTempDir("guard-rm-out-")
    const logPath = path.join(dir, "job.log")
    // Step de 27s (fora da banda 19-23.5): inicio 12:15:34.48 -> proximo 12:16:01.48
    const outLog = [
      logLine(STEP, "2026-08-12T12:15:34.4869012Z"),
      logLine(NEXT_STEP, "2026-08-12T12:16:01.4869012Z", "##[group]Run node scripts/scan-timeouts.mjs --ci"),
    ].join("\n")
    fs.writeFileSync(logPath, outLog, "utf8")
    const r = runCli(["--branch", "ci-proof/remeasure-e2e-out"], {
      GUARD_REMEASURE_CIPROOF_CMD: `node ${FAKE_CMD}`,
      GUARD_REMEASURE_FAKE_LOG: logPath,
      GUARD_REMEASURE_FAKE_RUN: "778",
    })
    expect(r.status).toBe(1)
    expect(r.stdout).toContain("ALERTA")
    expect(r.stdout).toContain("FORA da banda")
  })

  it("ciclo com conclusion=failure do ci-proof-run -> exit 1 (sem step para medir)", () => {
    const dir = createTempDir("guard-rm-fail-")
    const logPath = path.join(dir, "job.log")
    fs.writeFileSync(logPath, SYNTH_LOG_22, "utf8")
    const r = runCli(["--branch", "ci-proof/remeasure-e2e-fail"], {
      GUARD_REMEASURE_CIPROOF_CMD: `node ${FAKE_CMD}`,
      GUARD_REMEASURE_FAKE_LOG: logPath,
      GUARD_REMEASURE_FAKE_CONCLUSION: "failure",
    })
    expect(r.status).toBe(1)
    expect(r.stderr).toContain("nao concluiu success")
  })

  it("--log: extracao read-only de um log ja capturado (sem dispatch)", () => {
    const dir = createTempDir("guard-rm-log-")
    const logPath = path.join(dir, "captured.log")
    fs.writeFileSync(logPath, SYNTH_LOG_22, "utf8")
    // Sem GUARD_REMEASURE_CIPROF_CMD: o --log nao spawna o fake (e nao
    // deve tocar em git/gh reais).
    const r = runCli(["--log", logPath])
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("22.47s")
    expect(r.stdout).toContain("no-filter continua calibrado")
  })

  it("--dry-run: imprime o plano sem executar (exit 0)", () => {
    const r = runCli(["--branch", "ci-proof/remeasure-dry", "--dry-run"])
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("PLAN (dry-run)")
    expect(r.stdout).toContain("ci-proof-run.mjs")
  })
})
