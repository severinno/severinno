/**
 * measure-mutation-trend.test.ts
 *
 * Testes do scripts/measure-mutation-trend.mjs — o guard de TENDÊNCIA do
 * overhead do mutation-coord (semanal, benchmark-weekly.yml): compara a
 * duração do step 'Run mutation test (contrato coordenado — 5 cenários, 2
 * elos)' do run ATUAL contra a MEDIANA dos N runs ANTERIORES e emite
 * ::warning:: quando o drift relativo passa de X% — pegando a tendência
 * ANTES do gate duro (--max 240 do measure-mutation-timing) disparar.
 *
 * Cobre (padrão dos testes de guards — funções puras + CLI real):
 *   1. computeMedian — mediana (imune a outliers), par/ímpar, vazio → null
 *   2. computeDriftPct — (current - median) / median * 100; median null/0 → null
 *   3. extractStepDurationFromJobsPayload — reusa o extractMutationStep do
 *      medidor (a MESMA fonte do gate) + computeDurationSecs; null sem step
 *   3b. buildRunListJq — trava a comparação do databaseId por NÚMERO puro no
 *      gh run list (o bug `!= \"123\"` string deixaria o run atual na própria
 *      mediana, viciando o drift para 0) + filtro de runs completos
 *   4. buildTrendReport — monta o relatório completo: history limitado à
 *      window, medianSecs, driftPct, warned (driftPct > maxDriftPct);
 *      current 0s/NaN (data quebrada) vira found:false (fail-closed, nunca
 *      '-100% saudável' mudo)
 *   5. CLI real (spawn):
 *      - modo TESTE (--jobs-file + --history-file): drift dentro do limiar →
 *        exit 0 + ::notice:: saudável; drift ACIMA → exit 0 + ::warning::
 *        (alerta NÃO-bloqueante por design); sem histórico (history < window)
 *        → exit 0 + ::notice:: de baseline; step ausente → exit 2 (drift de
 *        contrato, fail-closed); fixture ilegível → exit 1 (infra)
 *      - validações: --run + --jobs-file → exit 2; --jobs-file sem
 *        --history-file → exit 2; --window 0 → exit 2; --max-drift inválido
 *        → exit 2; --help → exit 0
 *   6. Regressão REAL do repo — buildTrendReport com fixture real passa.
 *
 * Uso:
 *   npx vitest run --config vitest.config.unit.ts src/lib/__tests__/measure-mutation-trend.test.ts
 */

import { describe, it, expect } from "vitest"
import { spawnSync } from "node:child_process"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  computeMedian,
  computeDriftPct,
  extractStepDurationFromJobsPayload,
  buildTrendReport,
  buildRunListJq,
} from "../../../scripts/measure-mutation-trend.mjs"

const SCRIPT = join(process.cwd(), "scripts", "measure-mutation-trend.mjs")

// ── Fixture real — payload da jobs API com o step exato do seed-guards.yml ─

const CONTRACT_JOB = "Mutation Test (contrato coordenado — doc↔anchor↔código)"
const CONTRACT_STEP = "Run mutation test (contrato coordenado — 5 cenários, 2 elos)"

/** Payload da jobs API com o step de mutation na duração dada. */
function jobsPayload(durationSecs: number) {
  return {
    total_count: 1,
    jobs: [
      {
        name: CONTRACT_JOB,
        steps: [
          {
            name: CONTRACT_STEP,
            started_at: "2026-08-09T03:00:00Z",
            completed_at: new Date(Date.parse("2026-08-09T03:00:00Z") + durationSecs * 1000)
              .toISOString()
              .replace(/\.000Z$/, "Z"),
            conclusion: "success",
          },
        ],
      },
    ],
  }
}

function writeJsonFixture(data: unknown) {
  const dir = mkdtempSync(join(tmpdir(), "mutation-trend-"))
  const file = join(dir, "fixture.json")
  writeFileSync(file, JSON.stringify(data))
  return { dir, file }
}

function runCli(args: string[]) {
  const res = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" })
  return { status: res.status ?? -1, stdout: `${res.stdout ?? ""}${res.stderr ?? ""}` }
}

// ── 1. computeMedian (função pura) ───────────────────────────────────────

describe("computeMedian", () => {
  it("ímpar → elemento central (ordenado)", () => {
    expect(computeMedian([40, 55, 75, 90, 120])).toBe(75)
  })

  it("par → média dos dois centrais (imune a outlier)", () => {
    // outlier 300s não distorce: mediana de [40, 55, 75, 300] = (55+75)/2 = 65
    expect(computeMedian([300, 55, 75, 40])).toBe(65)
  })

  it("2 valores → média", () => {
    expect(computeMedian([40, 60])).toBe(50)
  })

  it("1 valor → o próprio", () => {
    expect(computeMedian([42])).toBe(42)
  })

  it("vazio → null (sem histórico para tendência)", () => {
    expect(computeMedian([])).toBeNull()
    expect(computeMedian(undefined as unknown as number[])).toBeNull()
  })

  it("filtra NaN (dado de API ruim não envenena o sort nem a mediana)", () => {
    expect(computeMedian([40, NaN, 55, NaN])).toBe(47.5)
    expect(computeMedian([NaN, NaN])).toBeNull()
  })
})

// ── 2. computeDriftPct (função pura) ─────────────────────────────────────

describe("computeDriftPct", () => {
  it("positivo = mais lento (drift de overhead)", () => {
    expect(computeDriftPct(90, 60)).toBeCloseTo(50)
  })

  it("negativo = mais rápido", () => {
    expect(computeDriftPct(45, 60)).toBeCloseTo(-25)
  })

  it("zero = igual à mediana", () => {
    expect(computeDriftPct(60, 60)).toBe(0)
  })

  it("mediana null ou 0 → null (não calculável)", () => {
    expect(computeDriftPct(90, null)).toBeNull()
    expect(computeDriftPct(90, 0)).toBeNull()
  })

  it("mediana NaN → null (não vira 'NaN%' no alerta)", () => {
    expect(computeDriftPct(90, NaN)).toBeNull()
  })

  it("current NaN ou 0 → null (dado quebrado da API não vira '-100% saudável' mudo)", () => {
    expect(computeDriftPct(NaN, 62.5)).toBeNull()
    expect(computeDriftPct(0, 62.5)).toBeNull()
  })
})

// ── 3. extractStepDurationFromJobsPayload (função pura) ──────────────────

describe("extractStepDurationFromJobsPayload", () => {
  it("extrai a duração do step do contrato (reusa o extractMutationStep do medidor)", () => {
    expect(extractStepDurationFromJobsPayload(jobsPayload(90))).toEqual({ durationSecs: 90 })
  })

  it("retorna null quando o step não existe (drift de contrato ou seed-guards não rodou)", () => {
    expect(
      extractStepDurationFromJobsPayload({
        jobs: [{ name: "Mutation Test (seed dev E2E pega regressões?)", steps: [] }],
      }),
    ).toBeNull()
  })

  it("retorna null em payload sem a chave jobs (robustez de shape)", () => {
    expect(extractStepDurationFromJobsPayload({})).toBeNull()
    expect(extractStepDurationFromJobsPayload(null)).toBeNull()
  })
})

// ── 3b. buildRunListJq (função pura — trava o bug do run atual na mediana) ─

describe("buildRunListJq", () => {
  it('compara o databaseId por NÚMERO puro (gh emite JSON number — `!= "123"` string nunca excluiria o run atual)', () => {
    const jq = buildRunListJq("123")
    // Número SEM aspas: `!= 123`, nunca `!= \"123\"` (comparação de tipos
    // diferentes → sempre true → o run atual entraria na própria mediana,
    // viciando o drift para 0 e mascarando a regressão).
    expect(jq).toContain(".databaseId != 123")
    expect(jq).not.toContain('.databaseId != "123"')
    expect(jq).not.toContain(".databaseId != '123'")
  })

  it("mantém só runs COMPLETOS (in_progress ainda não fechou o step — ruído)", () => {
    expect(buildRunListJq(7)).toContain('select(.status == "completed")')
  })

  it("aceita número ou string numérica e devolve um programa jq válido", () => {
    expect(buildRunListJq(42)).toBe(
      '.[] | select(.databaseId != 42) | select(.status == "completed") | .databaseId',
    )
    expect(buildRunListJq("42")).toBe(
      '.[] | select(.databaseId != 42) | select(.status == "completed") | .databaseId',
    )
  })
})

// ── 4. buildTrendReport (função pura) ────────────────────────────────────

describe("buildTrendReport", () => {
  const base = {
    runId: "123",
    repo: "severinno/severinno",
    window: 4,
    maxDriftPct: 30,
  }

  it("monta o relatório: history limitado à window + mediana + driftPct + warned false (saudável)", () => {
    const report = buildTrendReport({
      ...base,
      current: { found: true, durationSecs: 70 },
      history: [
        { runId: "1", durationSecs: 60 },
        { runId: "2", durationSecs: 55 },
        { runId: "3", durationSecs: 65 },
        { runId: "4", durationSecs: 70 },
      ],
    })
    expect(report.medianSecs).toBe(62.5) // (60+65)/2
    expect(report.driftPct).toBeCloseTo(((70 - 62.5) / 62.5) * 100) // +12% <= 30%
    expect(report.warned).toBe(false)
    expect(report.history).toHaveLength(4)
  })

  it("drift ACIMA do limiar → warned true (o ::warning:: que o CLI emite)", () => {
    const report = buildTrendReport({
      ...base,
      current: { found: true, durationSecs: 120 },
      history: [
        { runId: "1", durationSecs: 60 },
        { runId: "2", durationSecs: 55 },
        { runId: "3", durationSecs: 65 },
        { runId: "4", durationSecs: 70 },
      ],
    })
    // drift = (120-62.5)/62.5 = +92% > 30% → warned
    expect(report.warned).toBe(true)
  })

  it("history limitado à window (mais runs que a window → só os N mais recentes)", () => {
    const report = buildTrendReport({
      ...base,
      window: 2,
      current: { found: true, durationSecs: 90 },
      history: [
        { runId: "1", durationSecs: 70 },
        { runId: "2", durationSecs: 65 },
        { runId: "3", durationSecs: 55 },
        { runId: "4", durationSecs: 60 },
      ],
    })
    expect(report.history).toHaveLength(2) // [70, 65] — os mais recentes (primeiros da lista)
    expect(report.medianSecs).toBe(67.5)
  })

  it("sem histórico suficiente (history vazio) → medianSecs null + driftPct null + warned false", () => {
    const report = buildTrendReport({
      ...base,
      current: { found: true, durationSecs: 90 },
      history: [],
    })
    expect(report.medianSecs).toBeNull()
    expect(report.driftPct).toBeNull()
    expect(report.warned).toBe(false)
  })

  it("current não encontrado → driftPct null (o CLI trata como drift de contrato, exit 2)", () => {
    const report = buildTrendReport({
      ...base,
      current: { found: false },
      history: [
        { runId: "1", durationSecs: 60 },
        { runId: "2", durationSecs: 70 },
      ],
    })
    expect(report.driftPct).toBeNull()
    expect(report.warned).toBe(false)
  })

  it("history com duração NaN é filtrada antes da mediana (robustez de API ruim)", () => {
    const report = buildTrendReport({
      ...base,
      current: { found: true, durationSecs: 70 },
      history: [
        { runId: "1", durationSecs: 60 },
        { runId: "2", durationSecs: NaN }, // data quebrada do gh — ignorada
        { runId: "3", durationSecs: 70 },
      ],
    })
    expect(report.history).toHaveLength(2) // só os finitos entram
    expect(report.medianSecs).toBe(65)
    expect(report.driftPct).toBeCloseTo(((70 - 65) / 65) * 100) // +7.7% <= 30%
    expect(report.warned).toBe(false)
  })

  it("current com duração 0s (data quebrada da API) → fail-closed: vira found:false, nunca '-100% saudável'", () => {
    const report = buildTrendReport({
      ...base,
      current: { found: true, durationSecs: 0 }, // o medidor devolve 0 para datas inválidas
      history: [
        { runId: "1", durationSecs: 60 },
        { runId: "2", durationSecs: 70 },
      ],
    })
    expect(report.current.found).toBe(false)
    expect(report.driftPct).toBeNull()
    expect(report.warned).toBe(false)
  })
})

// ── 5. CLI real (spawn) — modo TESTE (fixtures determinísticos) ──────────

describe("measure-mutation-trend.mjs CLI — modo teste (fixtures)", () => {
  /** Roda o CLI no modo TESTE com os fixtures dados. */
  function runWithFixtures(
    currentSecs: number,
    historySecs: number[],
    extra: string[] = [],
    currentFound = true,
  ) {
    const current = writeJsonFixture(
      currentFound
        ? jobsPayload(currentSecs)
        : {
            jobs: [{ name: "Mutation Test (seed dev E2E pega regressões?)", steps: [] }],
          },
    )
    const history = writeJsonFixture({
      runs: historySecs.map((s, i) => ({ runId: String(i + 1), durationSecs: s })),
    })
    try {
      return runCli([
        "--jobs-file",
        current.file,
        "--history-file",
        history.file,
        "--window",
        "4",
        "--max-drift",
        "30",
        ...extra,
      ])
    } finally {
      rmSync(current.dir, { recursive: true, force: true })
      rmSync(history.dir, { recursive: true, force: true })
    }
  }

  it("drift DENTRO do limiar → exit 0 + ::notice:: saudável (alerta não-bloqueante)", () => {
    const { status, stdout } = runWithFixtures(70, [60, 55, 65, 70])
    expect(status).toBe(0)
    expect(stdout).toContain("::notice::Drift de tendência do mutation-coord")
    expect(stdout).toContain("saudável")
    expect(stdout).not.toContain("::warning::")
    const report = JSON.parse(stdout.replace(/^::notice::.*\n/, ""))
    expect(report.current.durationSecs).toBe(70)
    expect(report.medianSecs).toBe(62.5)
    expect(report.warned).toBe(false)
  })

  it("drift ACIMA do limiar → exit 0 + ::warning:: (pega a tendência ANTES do gate duro)", () => {
    const { status, stdout } = runWithFixtures(120, [60, 55, 65, 70])
    expect(status).toBe(0) // o alerta NÃO falha o CI — rede de segurança periódica
    expect(stdout).toContain("::warning::Drift de tendência do mutation-coord")
    expect(stdout).toContain("+92")
    const report = JSON.parse(stdout.replace(/^::warning::.*\n/, ""))
    expect(report.warned).toBe(true)
  })

  it("sem histórico suficiente (history vazio) → exit 0 + ::notice:: de baseline (primeiro runs medem o baseline)", () => {
    const { status, stdout } = runWithFixtures(90, [])
    expect(status).toBe(0)
    expect(stdout).toContain("::notice::Sem histórico suficiente")
    expect(stdout).toContain("baseline")
  })

  it("step atual ausente → exit 2 (drift de contrato — fail-closed, não é evidência de limpo)", () => {
    const { status, stdout } = runWithFixtures(90, [60, 70], [], false)
    expect(status).toBe(2)
    expect(stdout).toContain("não encontrado")
    expect(stdout).toContain("drift de contrato")
  })

  it("current com datas quebradas (medidor devolve 0s) → exit 2 (duração inválida é fail-closed, nunca '-100% saudável')", () => {
    const current = writeJsonFixture({
      total_count: 1,
      jobs: [
        {
          name: CONTRACT_JOB,
          steps: [
            {
              name: CONTRACT_STEP,
              started_at: "nao-e-uma-data",
              completed_at: "tambem-nao",
              conclusion: "success",
            },
          ],
        },
      ],
    })
    const history = writeJsonFixture({ runs: [{ runId: "1", durationSecs: 65 }] })
    try {
      const { status, stdout } = runCli([
        "--jobs-file",
        current.file,
        "--history-file",
        history.file,
        "--window",
        "4",
        "--max-drift",
        "30",
      ])
      expect(status).toBe(2)
      expect(stdout).toContain("duração inválida")
    } finally {
      rmSync(current.dir, { recursive: true, force: true })
      rmSync(history.dir, { recursive: true, force: true })
    }
  })

  it("--jobs-file ilegível → exit 1 (infra fail-closed)", () => {
    const { status, stdout } = runCli([
      "--jobs-file",
      join(tmpdir(), "missing-trend-" + Date.now(), "jobs.json"),
      "--history-file",
      join(tmpdir(), "missing-trend-hist-" + Date.now(), "hist.json"),
    ])
    expect(status).toBe(1)
    expect(stdout).toContain("infra")
  })

  it("--window custom (2) muda a mediana calculada", () => {
    const current = writeJsonFixture(jobsPayload(70))
    const history = writeJsonFixture({
      runs: [
        { runId: "1", durationSecs: 70 },
        { runId: "2", durationSecs: 65 },
        { runId: "3", durationSecs: 55 },
        { runId: "4", durationSecs: 60 },
      ],
    })
    try {
      const { status, stdout } = runCli([
        "--jobs-file",
        current.file,
        "--history-file",
        history.file,
        "--window",
        "2",
        "--max-drift",
        "30",
      ])
      expect(status).toBe(0)
      const report = JSON.parse(stdout.replace(/^::(?:warning|notice)::.*\n/, ""))
      expect(report.history).toHaveLength(2) // [70, 65] — os mais recentes
      expect(report.medianSecs).toBe(67.5)
    } finally {
      rmSync(current.dir, { recursive: true, force: true })
      rmSync(history.dir, { recursive: true, force: true })
    }
  })
})

// ── 6. CLI real — validações de uso ──────────────────────────────────────

describe("measure-mutation-trend.mjs CLI — validações de uso", () => {
  it("--help → exit 0 e documenta os 3 exit codes", () => {
    const { status, stdout } = runCli(["--help"])
    expect(status).toBe(0)
    expect(stdout).toContain("Exit codes:")
    expect(stdout).toContain("0 — tendência medida")
    expect(stdout).toContain("1 — infra")
    expect(stdout).toContain("2 — step atual não encontrado")
  })

  it("sem argumentos → exit 2 (exige --run OU --jobs-file + --history-file)", () => {
    const { status, stdout } = runCli([])
    expect(status).toBe(2)
    expect(stdout).toContain("exija --run")
  })

  it("--jobs-file SEM --history-file → exit 2 (par de fixtures exigido)", () => {
    const { status, stdout } = runCli(["--jobs-file", "x.json"])
    expect(status).toBe(2)
    expect(stdout).toContain("exigem os DOIS")
  })

  it("--jobs-file + --history-file + --run → exit 2 (modos exclusivos)", () => {
    const { status, stdout } = runCli(["--jobs-file", "a", "--history-file", "b", "--run", "1"])
    expect(status).toBe(2)
    expect(stdout).toContain("não podem ser combinados")
  })

  it("--window 0 → exit 2 (uso inválido)", () => {
    const { status, stdout } = runCli(["--run", "1", "--window", "0"])
    expect(status).toBe(2)
    expect(stdout).toContain("--window deve ser um inteiro >= 1")
  })

  it("--max-drift inválido (não-numérico) → exit 2 (uso inválido)", () => {
    const { status, stdout } = runCli(["--run", "1", "--max-drift", "abc"])
    expect(status).toBe(2)
    expect(stdout).toContain("--max-drift deve ser um número")
  })
})
