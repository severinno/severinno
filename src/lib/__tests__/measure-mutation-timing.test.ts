/**
 * measure-mutation-timing.test.ts
 *
 * Testes do scripts/measure-mutation-timing.mjs — o medidor do tempo REAL do
 * step 'Run mutation test (contrato coordenado — 5 cenários, 2 elos)' do job
 * 'Mutation Test (contrato coordenado — doc↔anchor↔código, 5 cenários)' nos
 * runs do GitHub Actions (job semanal benchmark-weekly.yml).
 *
 * Cobre (padrão dos testes de guards — funções puras + CLI real):
 *   1. extractMutationStep — acha o job/step pelos MARKERS de contrato (os
 *      nomes REAIS do seed-guards.yml) e extrai timestamps + conclusion;
 *      retorna null quando o job/step NÃO existe (drift de contrato ou o
 *      seed-guards não rodou o mutation-coord-update no run).
 *   2. computeDurationSecs — arredonda para cima (>= 1s), timestamps inválidos
 *      → 0.
 *   3. CLI real — spawn de `node scripts/measure-mutation-timing.mjs`:
 *      - --jobs-file com fixture (achado) → exit 0 + relatório com duração;
 *      - --jobs-file SEM o job (drift) → exit 2 (fail-closed: 'não achado'
 *        não é evidência de 'limpo');
 *      - sem argumentos → exit 2 (uso inválido);
 *      - --help → exit 0 com a doc de exit codes.
 *
 * Uso:
 *   npx vitest run --config vitest.config.unit.ts src/lib/__tests__/measure-mutation-timing.test.ts
 */

import { describe, it, expect } from "vitest"
import { spawnSync } from "node:child_process"
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  extractMutationStep,
  extractMutationStepFromActLog,
  computeDurationSecs,
  computeBaselineValue,
  computeMedian,
  deriveWarnFromMedian,
  buildRunListJq,
} from "../../../scripts/measure-mutation-timing.mjs"

const SCRIPT = join(process.cwd(), "scripts", "measure-mutation-timing.mjs")

/** Fixture real — espelha o payload da jobs API com o job/step exatos do seed-guards.yml. */
function realJobsPayload(mutationDurationSecs = 35) {
  return {
    total_count: 3,
    jobs: [
      {
        name: "Setup-bun real",
        steps: [
          {
            name: "Run actions/checkout@v4",
            started_at: "2026-08-02T20:16:34Z",
            completed_at: "2026-08-02T20:16:40Z",
            conclusion: "success",
          },
        ],
      },
      {
        name: "Mutation Test (contrato coordenado — doc↔anchor↔código, 5 cenários)",
        steps: [
          {
            name: "Run actions/checkout@v4",
            started_at: "2026-08-02T20:16:34Z",
            completed_at: "2026-08-02T20:16:40Z",
            conclusion: "success",
          },
          {
            name: "Run mutation test (contrato coordenado — 5 cenários, 2 elos)",
            started_at: "2026-08-02T20:17:00Z",
            completed_at: new Date(Date.parse("2026-08-02T20:17:00Z") + mutationDurationSecs * 1000)
              .toISOString()
              .replace(/\.000Z$/, "Z"),
            conclusion: "success",
          },
          {
            name: "Post Run actions/checkout@v4",
            started_at: "2026-08-02T20:17:35Z",
            completed_at: "2026-08-02T20:17:35Z",
            conclusion: "success",
          },
        ],
      },
      {
        name: "PostgreSQL Replica",
        steps: [
          {
            name: "Run docker",
            started_at: "2026-08-02T20:17:36Z",
            completed_at: "2026-08-02T20:18:00Z",
            conclusion: "success",
          },
        ],
      },
    ],
  }
}

/** Cria um fixture temporário com o payload dado e devolve o caminho. */
function writeFixture(payload: unknown) {
  const dir = mkdtempSync(join(tmpdir(), "mutation-timing-"))
  const file = join(dir, "jobs.json")
  writeFileSync(file, JSON.stringify(payload))
  return { dir, file }
}

/** Cria um fixture temporário de log do act e devolve o caminho (módulo — reuso entre describes). */
function writeActLog(text: string) {
  const dir = mkdtempSync(join(tmpdir(), "mutation-timing-actlog-"))
  const file = join(dir, "act.log")
  writeFileSync(file, text)
  return { dir, file }
}

function runCli(args: string[]) {
  // stdout E stderr unidos (o erro de uso/not-found vai para stderr; o
  // relatório JSON achado vai para stdout) — o teste asserta o conteúdo
  // visível independente do canal.
  const res = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" })
  return { status: res.status ?? -1, stdout: `${res.stdout ?? ""}${res.stderr ?? ""}` }
}

/** runCli com env extra (ex.: MEASURE_MUTATION_TIMING_DRY_PUBLISH=1). */
function runCliEnv(args: string[], env: Record<string, string>) {
  const res = spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  })
  return { status: res.status ?? -1, stdout: `${res.stdout ?? ""}${res.stderr ?? ""}` }
}

/**
 * Extrai o relatório JSON do output mesclado do CLI (stdout + stderr).
 *
 * O CLI imprime o relatório SEMPRE como a ÚLTIMA estrutura JSON (JSON.stringify
 * com indent — primeira linha exatamente '{', última '}'). O ::notice::/
 * ::warning:: vai para o stdout ANTES dele, e pode embutir o stderr do gh
 * (ex.: erro do gh real no CI — 'gh repo view falhou (exit 1): ...' com
 * chaves no texto) — o regex greedy /\{[\s\S]*\}/ quebrava nesse caso
 * (capturava do 1º '{' do notice ao último '}' — texto não-JSON no meio).
 * Âncora: primeira linha '{' a partir do FIM (a do relatório) até a última
 * linha '}' — imune a chaves no texto do notice/erro.
 */
interface TimingReport {
  found: boolean
  source: string
  jobName?: string
  stepName?: string
  durationSecs: number
  conclusion?: string
  zone: string
  exceeded: boolean
  budgetSecs?: number
  alertSecs?: number
  warnSecs?: number
  warned?: boolean
  noticed?: boolean
  drifted?: boolean
  driftPct?: number
  driftSource?: string
  driftWindow?: number
  driftHistoryCount?: number
  driftMedianSecs?: number | null
  driftMaxPct?: number
  warnSource?: string
  warnWindow?: number
  warnMargin?: number
  warnMedianSecs?: number | null
  warnHistoryCount?: number
  baseline?: unknown
  json?: string
}

function extractJsonReport(merged: string): TimingReport {
  const lines = merged.split("\n")
  let start = -1
  let end = -1
  for (let i = lines.length - 1; i >= 0; i--) {
    if (end === -1 && lines[i] === "}") end = i
    if (lines[i] === "{") {
      start = i
      break
    }
  }
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`relatório JSON não encontrado no output do CLI:\n${merged.slice(0, 200)}`)
  }
  return JSON.parse(lines.slice(start, end + 1).join("\n"))
}

// ── 1. extractMutationStep (função pura) ─────────────────────────────────

describe("extractMutationStep", () => {
  it("acha o job/step do mutation-coord-update pelos markers de contrato e extrai timestamps + conclusion", () => {
    const step = extractMutationStep(realJobsPayload())
    expect(step).not.toBeNull()
    expect(step).toMatchObject({
      jobName: "Mutation Test (contrato coordenado — doc↔anchor↔código, 5 cenários)",
      stepName: "Run mutation test (contrato coordenado — 5 cenários, 2 elos)",
      startedAt: "2026-08-02T20:17:00Z",
      completedAt: "2026-08-02T20:17:35Z",
      conclusion: "success",
    })
  })

  it("retorna null quando o JOB não existe (drift de contrato — renomearam ou o seed-guards não rodou)", () => {
    const payload = { jobs: [{ name: "Mutation Test (seed dev E2E pega regressões?)", steps: [] }] }
    expect(extractMutationStep(payload)).toBeNull()
  })

  it("retorna null quando o STEP não existe dentro do job", () => {
    const payload = {
      jobs: [
        {
          name: "Mutation Test (contrato coordenado — doc↔anchor↔código, 5 cenários)",
          steps: [
            {
              name: "Run actions/checkout@v4",
              started_at: "x",
              completed_at: "y",
              conclusion: "success",
            },
          ],
        },
      ],
    }
    expect(extractMutationStep(payload)).toBeNull()
  })

  it("retorna null quando timestamps estão ausentes (step não completou)", () => {
    const payload = {
      jobs: [
        {
          name: "Mutation Test (contrato coordenado — doc↔anchor↔código, 5 cenários)",
          steps: [
            {
              name: "Run mutation test (contrato coordenado — 5 cenários, 2 elos)",
              started_at: undefined,
              completed_at: undefined,
              conclusion: "in_progress",
            },
          ],
        },
      ],
    }
    expect(extractMutationStep(payload)).toBeNull()
  })

  it("ignora payloads sem a chave jobs (robustez de shape)", () => {
    expect(extractMutationStep({})).toBeNull()
    expect(extractMutationStep(null)).toBeNull()
    expect(extractMutationStep(undefined)).toBeNull()
  })
})

// ── 1b. extractMutationStepFromActLog (função pura — modo --act-log) ───
// Extrai a duração do step de mutation da linha 'Success - Main ...' do log
// do act (mesma técnica do check-tier1-fastpath.mjs). Cobre PRs que ainda
// não têm o seed-guards.yml na branch DEFAULT: o reusable não roda no CI
// real, então o act re-executa o job com a imagem ubuntu-bun e o log é a
// única fonte de medição.

describe("extractMutationStepFromActLog", () => {
  const actLogWith = (lines: string[]) => lines.join("\n")

  it("extrai a duração da linha 'Success - Main Run mutation test ... [X.XXs]'", () => {
    const log = actLogWith([
      "[Mutation Test (contrato coordenado — doc↔anchor↔código, 5 cenários)/Run mutation test (contrato coordenado — 5 cenários, 2 elos)] ⭐ Run Main bun run test:mutation-coord-update",
      "[Mutation Test (contrato coordenado — doc↔anchor↔código, 5 cenários)/Run mutation test (contrato coordenado — 5 cenários, 2 elos)] ✅  Success - Main Run mutation test (contrato coordenado — 5 cenários, 2 elos) [42.5s]",
    ])
    const step = extractMutationStepFromActLog(log)
    expect(step).not.toBeNull()
    expect(step?.durationSecs).toBeCloseTo(42.5)
    expect(step?.stepName).toContain("Run mutation test (contrato coordenado")
  })

  it("suporta durações em ms (mesma regex do extractDurationFromLine)", () => {
    const log = actLogWith([
      "✅  Success - Main Run mutation test (contrato coordenado — 5 cenários, 2 elos) [1234.5ms]",
    ])
    const step = extractMutationStepFromActLog(log)
    expect(step?.durationSecs).toBeCloseTo(1.2345)
  })

  it("retorna null quando a linha 'Success - Main' do step de mutation não existe", () => {
    const log = actLogWith([
      "[Mutation Test (contrato coordenado — doc↔anchor↔código, 5 cenários)/Run actions/checkout@v4] ✅  Success - Main Run actions/checkout@v4 [3.1s]",
      "[Mutation Test (contrato coordenado — doc↔anchor↔código, 5 cenários)/Run mutation test (contrato coordenado — 5 cenários, 2 elos)] ❌  Error - Main Run mutation test (contrato coordenado — 5 cenários, 2 elos)",
    ])
    // 'Error - Main' não é 'Success - Main' → a medição NÃO conta (o step
    // falhou; o log do act diria act exit != 0 — --act-exit pega o infra).
    expect(extractMutationStepFromActLog(log)).toBeNull()
  })

  it("retorna null quando a linha de sucesso não tem duração (formato inesperado)", () => {
    const log = actLogWith([
      "✅  Success - Main Run mutation test (contrato coordenado — 5 cenários, 2 elos) sem-duração",
    ])
    expect(extractMutationStepFromActLog(log)).toBeNull()
  })

  it("retorna null em logs vazios ou sem nenhum step (robustez)", () => {
    expect(extractMutationStepFromActLog("")).toBeNull()
    expect(extractMutationStepFromActLog("[job/step] ⭐ Run Main checkout")).toBeNull()
  })
})

// ── 2. computeDurationSecs (função pura) ─────────────────────────────────

describe("computeDurationSecs", () => {
  it("calcula a duração em segundos entre duas timestamps ISO", () => {
    expect(computeDurationSecs("2026-08-02T20:17:00Z", "2026-08-02T20:17:35Z")).toBe(35)
  })

  it("arredonda PARA CIMA — um step de 0.3s reporta 1s, nunca 0 (evita falso 'instantâneo')", () => {
    expect(computeDurationSecs("2026-08-02T20:17:00.0Z", "2026-08-02T20:17:00.3Z")).toBe(1)
  })

  it("timestamps inválidos → 0", () => {
    expect(computeDurationSecs("não-é-data", "2026-08-02T20:17:35Z")).toBe(0)
    expect(computeDurationSecs("2026-08-02T20:17:00Z", "não-é-data")).toBe(0)
  })

  it("completedAt antes de startedAt (clock skew) → no mínimo 1s", () => {
    expect(computeDurationSecs("2026-08-02T20:17:35Z", "2026-08-02T20:17:00Z")).toBe(1)
  })
})

// ── 3. CLI real (spawn) ─────────────────────────────────────────────────

describe("measure-mutation-timing.mjs CLI", { timeout: 120_000 }, () => {
  it("--jobs-file com o job presente → exit 0 e relatório com duração correta", () => {
    const { dir, file } = writeFixture(realJobsPayload())
    try {
      const { status, stdout } = runCli(["--jobs-file", file])
      expect(status).toBe(0)
      const report = JSON.parse(stdout)
      expect(report.found).toBe(true)
      expect(report.durationSecs).toBe(35)
      expect(report.stepName).toContain("Run mutation test")
      expect(report.conclusion).toBe("success")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("--jobs-file INEXISTENTE → exit 1 (infra fail-closed — o mecanismo de medição quebrou, não o job que sumiu)", () => {
    const missing = join(tmpdir(), "mutation-timing-missing-" + Date.now(), "jobs.json")
    const { status, stdout } = runCli(["--jobs-file", missing])
    expect(status).toBe(1)
    expect(stdout).toContain("falha ao ler")
    expect(stdout).toContain("infra")
  })

  it("--jobs-file com JSON inválido → exit 1 (infra, mesmo caminho)", () => {
    const dir = mkdtempSync(join(tmpdir(), "mutation-timing-invalid-"))
    const file = join(dir, "jobs.json")
    // Conteúdo não-JSON — o JSON.parse falha → infraError (exit 1).
    writeFileSync(file, "isto não é json")
    try {
      const { status, stdout } = runCli(["--jobs-file", file])
      expect(status).toBe(1)
      expect(stdout).toContain("infra")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("--jobs-file SEM o job (drift de contrato) → exit 2 fail-closed com mensagem clara", () => {
    const { dir, file } = writeFixture({
      jobs: [{ name: "Mutation Test (seed dev E2E pega regressões?)", steps: [] }],
    })
    try {
      const { status, stdout } = runCli(["--jobs-file", file])
      expect(status).toBe(2)
      expect(stdout).toContain("não encontrado")
      expect(stdout).toContain("contrato")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("sem argumentos → exit 2 (uso inválido — exige uma fonte: jobs-file, run OU act-log)", () => {
    const { status, stdout } = runCli([])
    expect(status).toBe(2)
    expect(stdout).toContain("exija --jobs-file, --run OU --act-log")
  })

  it("--help → exit 0 e documenta os 3 exit codes", () => {
    const { status, stdout } = runCli(["--help"])
    expect(status).toBe(0)
    expect(stdout).toContain("Exit codes:")
    expect(stdout).toContain("0 — step encontrado, dentro do budget")
    expect(stdout).toContain("1 — falha de infra OU budget duro excedido")
    expect(stdout).toContain("2 — step/job não encontrado")
  })

  it("--json salva o relatório em arquivo além do stdout", () => {
    const { dir, file } = writeFixture(realJobsPayload())
    const outFile = join(dir, "report.json")
    try {
      const { status, stdout } = runCli(["--jobs-file", file, "--json", outFile])
      expect(status).toBe(0)
      const saved = JSON.parse(readFileSync(outFile, "utf8"))
      expect(saved.durationSecs).toBe(35)
      expect(JSON.parse(stdout)).toEqual(saved)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

// ── 4. GATE DE BUDGET (--max SECS + --warn-only) ───────────────────────

describe("measure-mutation-timing.mjs CLI — gate de budget (--max)", { timeout: 120_000 }, () => {
  it("--max acima da duração → exit 0 com report.exceeded=false e budgetSecs", () => {
    const { dir, file } = writeFixture(realJobsPayload())
    try {
      const { status, stdout } = runCli(["--jobs-file", file, "--max", "200"])
      expect(status).toBe(0)
      const report = JSON.parse(stdout)
      expect(report.found).toBe(true)
      expect(report.durationSecs).toBe(35)
      expect(report.budgetSecs).toBe(200)
      expect(report.exceeded).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("--max ABAIXO da duração → exit 1 (GATE) com mensagem clara e report.exceeded=true", () => {
    const { dir, file } = writeFixture(realJobsPayload())
    try {
      const { status, stdout } = runCli(["--jobs-file", file, "--max", "10"])
      expect(status).toBe(1)
      // runCli mescla stdout+stderr — a mensagem de erro vai para stderr (após
      // o JSON no merge) e o relatório JSON para stdout; o regex extrai o
      // objeto JSON completo (do 1º '{' ao último '}') ignorando o texto do
      // stderr que vem depois.
      expect(stdout).toContain("budget de payload EXCEDIDO")
      expect(stdout).toContain("35s > budget 10s")
      const report = extractJsonReport(stdout)
      expect(report.exceeded).toBe(true)
      expect(report.budgetSecs).toBe(10)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("--max + --warn-only acima da duração → exit 0 com ::warning:: no stdout (não-bloqueante)", () => {
    const { dir, file } = writeFixture(realJobsPayload())
    try {
      const { status, stdout } = runCli(["--jobs-file", file, "--max", "10", "--warn-only"])
      expect(status).toBe(0)
      expect(stdout).toContain("::warning::budget de payload EXCEDIDO")
      const report = JSON.parse(stdout.replace(/^::warning::.*\n/, ""))
      expect(report.exceeded).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("--max inválido (não-numérico) → exit 2 (uso inválido)", () => {
    const { status, stdout } = runCli(["--jobs-file", "x", "--max", "abc"])
    expect(status).toBe(2)
    expect(stdout).toContain("--max deve ser um inteiro positivo")
  })

  it("--max 0 → exit 2 (uso inválido — budget deve ser > 0)", () => {
    const { status, stdout } = runCli(["--jobs-file", "x", "--max", "0"])
    expect(status).toBe(2)
    expect(stdout).toContain("--max deve ser um inteiro positivo")
  })

  it("--warn-only sem --max → exit 2 (uso inválido — o budget define o alerta)", () => {
    const { status, stdout } = runCli(["--jobs-file", "x", "--warn-only"])
    expect(status).toBe(2)
    expect(stdout).toContain("--warn-only exige --max")
  })
})

// ── 5b. MODO --act-log (CLI real) — mesma fonte de medição via log do act ─
// O modo --act-log lê o log do act (re-execução do job com a imagem
// ubuntu-bun) em vez da jobs API — a cobertura de PRs que ainda não têm o
// seed-guards.yml na branch DEFAULT (o reusable não roda → jobs API vazia).
// O gate de duas faixas é o MESMO: --max 240 --warn 180.

describe("measure-mutation-timing.mjs CLI — modo --act-log", { timeout: 120_000 }, () => {
  /** Log do act com a linha de sucesso do step na duração dada. */
  function actLogWithDuration(secs: number) {
    return [
      "[Mutation Test (contrato coordenado — doc↔anchor↔código, 5 cenários)/Run mutation test (contrato coordenado — 5 cenários, 2 elos)] ⭐ Run Main bun run test:mutation-coord-update",
      `[Mutation Test (contrato coordenado — doc↔anchor↔código, 5 cenários)/Run mutation test (contrato coordenado — 5 cenários, 2 elos)] ✅  Success - Main Run mutation test (contrato coordenado — 5 cenários, 2 elos) [${secs}s]`,
    ].join("\n")
  }

  it("--act-log com duração dentro do budget → exit 0 + found:true + source act-log", () => {
    const { dir, file } = writeActLog(actLogWithDuration(35))
    try {
      const { status, stdout } = runCli(["--act-log", file, "--max", "240", "--warn", "180"])
      expect(status).toBe(0)
      const report = JSON.parse(stdout.replace(/^::warning::.*\n/, ""))
      expect(report.found).toBe(true)
      expect(report.source).toBe("act-log")
      expect(report.durationSecs).toBe(35)
      expect(report.zone).toBe("ok")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("--act-log com duração na faixa SOFT (200s) → exit 0 + ::warning:: + zone warn", () => {
    const { dir, file } = writeActLog(actLogWithDuration(200))
    try {
      const { status, stdout } = runCli(["--act-log", file, "--max", "240", "--warn", "180"])
      expect(status).toBe(0)
      expect(stdout).toContain("::warning::budget de payload na faixa de WARN")
      const report = JSON.parse(stdout.replace(/^::warning::.*\n/, ""))
      expect(report.zone).toBe("warn")
      expect(report.durationSecs).toBe(200)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("--act-log com duração ACIMA do budget duro (300s) → exit 1 (GATE) + zone fail", () => {
    const { dir, file } = writeActLog(actLogWithDuration(300))
    try {
      const { status, stdout } = runCli(["--act-log", file, "--max", "240", "--warn", "180"])
      expect(status).toBe(1)
      expect(stdout).toContain("budget de payload EXCEDIDO")
      const report = extractJsonReport(stdout)
      expect(report.zone).toBe("fail")
      expect(report.exceeded).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("--act-log SEM o step no log e sem --act-exit → exit 2 (drift de contrato)", () => {
    const { dir, file } = writeActLog(
      "[job/step] ✅  Success - Main Run actions/checkout@v4 [3.1s]\n",
    )
    try {
      const { status, stdout } = runCli(["--act-log", file, "--max", "240", "--warn", "180"])
      expect(status).toBe(2)
      expect(stdout).toContain("não encontrado")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("--act-log SEM o step no log COM --act-exit != 0 → exit 1 (infra — act morreu antes do step)", () => {
    const { dir, file } = writeActLog("[job/step] ❌  Error - Main Run actions/checkout@v4")
    try {
      const { status, stdout } = runCli([
        "--act-log",
        file,
        "--max",
        "240",
        "--warn",
        "180",
        "--act-exit",
        "1",
      ])
      expect(status).toBe(1)
      expect(stdout).toContain("act falhou ANTES do step")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("--act-log de arquivo inexistente → exit 1 (infra fail-closed)", () => {
    const missing = join(tmpdir(), "act-log-missing-" + Date.now(), "act.log")
    const { status, stdout } = runCli(["--act-log", missing])
    expect(status).toBe(1)
    expect(stdout).toContain("falha ao ler")
  })

  it("--act-log combinado com --jobs-file → exit 2 (uso inválido — escolha uma fonte)", () => {
    const { status, stdout } = runCli(["--act-log", "x", "--jobs-file", "y"])
    expect(status).toBe(2)
    expect(stdout).toContain("--act-log não pode ser combinado")
  })

  it("--act-exit inválido (não-numérico) → exit 2 (uso inválido)", () => {
    const { status, stdout } = runCli(["--act-log", "x", "--act-exit", "abc"])
    expect(status).toBe(2)
    expect(stdout).toContain("--act-exit deve ser um inteiro")
  })

  it("--act-exit SEM --act-log → exit 2 (uso inválido — o exit do act só existe no modo --act-log)", () => {
    // Validação simétrica ao '--warn exige --max': --act-exit fora do modo
    // --act-log seria silenciosamente ignorado (o jobs-file/run não tem exit
    // do act) — o contrato do CLI exige o par.
    const { status, stdout } = runCli(["--jobs-file", "x", "--act-exit", "1"])
    expect(status).toBe(2)
    expect(stdout).toContain("--act-exit exige --act-log")
  })
})

// ── 5. GATE DE BUDGET EM DUAS FAIXAS (--max duro + --warn soft) ────────

describe(
  "measure-mutation-timing.mjs CLI — duas faixas do budget (--max + --warn)",
  { timeout: 120_000 },
  () => {
    /** Payload com step de duração customizada (para as faixas warn/fail). */
    function payloadWithDuration(secs: number) {
      return {
        total_count: 1,
        jobs: [
          {
            name: "Mutation Test (contrato coordenado — doc↔anchor↔código, 5 cenários)",
            steps: [
              {
                name: "Run mutation test (contrato coordenado — 5 cenários, 2 elos)",
                started_at: "2026-08-02T20:00:00Z",
                completed_at: new Date(Date.parse("2026-08-02T20:00:00Z") + secs * 1000)
                  .toISOString()
                  .replace(/\.000Z$/, "Z"),
                conclusion: "success",
              },
            ],
          },
        ],
      }
    }

    it("faixa WARN: 200s com --max 240 --warn 180 → exit 0 + ::warning:: + zone 'warn' (ruído tolerado)", () => {
      const { dir, file } = writeFixture(payloadWithDuration(200))
      try {
        const { status, stdout } = runCli(["--jobs-file", file, "--max", "240", "--warn", "180"])
        expect(status).toBe(0)
        expect(stdout).toContain("::warning::budget de payload na faixa de WARN")
        expect(stdout).toContain("200s > warn 180s")
        const report = JSON.parse(stdout.replace(/^::warning::.*\n/, ""))
        expect(report.zone).toBe("warn")
        expect(report.warned).toBe(true)
        expect(report.exceeded).toBe(false)
        expect(report.budgetSecs).toBe(240)
        expect(report.warnSecs).toBe(180)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })

    it("faixa FAIL: 300s com --max 240 --warn 180 → exit 1 + zone 'fail' (gate duro mantido)", () => {
      const { dir, file } = writeFixture(payloadWithDuration(300))
      try {
        const { status, stdout } = runCli(["--jobs-file", file, "--max", "240", "--warn", "180"])
        expect(status).toBe(1)
        expect(stdout).toContain("budget de payload EXCEDIDO (faixa dura)")
        const report = extractJsonReport(stdout)
        expect(report.zone).toBe("fail")
        expect(report.exceeded).toBe(true)
        expect(report.warned).toBe(false)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })

    it("faixa OK: 35s com --max 240 --warn 180 → exit 0 + zone 'ok' (sem warning)", () => {
      const { dir, file } = writeFixture(payloadWithDuration(35))
      try {
        const { status, stdout } = runCli(["--jobs-file", file, "--max", "240", "--warn", "180"])
        expect(status).toBe(0)
        expect(stdout).not.toContain("::warning::")
        const report = JSON.parse(stdout)
        expect(report.zone).toBe("ok")
        expect(report.warned).toBe(false)
        expect(report.exceeded).toBe(false)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })

    it("--warn SEM --max → exit 2 (uso inválido — a faixa soft é relativa ao duro)", () => {
      const { status, stdout } = runCli(["--jobs-file", "x", "--warn", "180"])
      expect(status).toBe(2)
      expect(stdout).toContain("--warn exige --max")
    })

    it("--warn >= --max → exit 2 (uso inválido — faixa vazia)", () => {
      const { status, stdout } = runCli(["--jobs-file", "x", "--max", "180", "--warn", "180"])
      expect(status).toBe(2)
      expect(stdout).toContain("--warn deve ser MENOR que --max")
    })

    it("--warn inválido (não-numérico) → exit 2 (uso inválido)", () => {
      const { status, stdout } = runCli(["--jobs-file", "x", "--max", "240", "--warn", "abc"])
      expect(status).toBe(2)
      expect(stdout).toContain("--warn deve ser um inteiro positivo")
    })

    it("--publish-baseline sem valor → exit 2 (uso inválido)", () => {
      const { status, stdout } = runCli(["--jobs-file", "x", "--publish-baseline"])
      expect(status).toBe(2)
      expect(stdout).toContain("--publish-baseline exige o NOME")
    })

    it("--publish-baseline com nome inválido (minúsculas) → exit 2 (uso inválido)", () => {
      const { status, stdout } = runCli([
        "--jobs-file",
        "x",
        "--publish-baseline",
        "baseline-lower",
      ])
      expect(status).toBe(2)
      expect(stdout).toContain("nome de variable válido")
    })

    it("--publish-baseline com --act-log → exit 2 (uso inválido — timing do act é local, não baseline do CI)", () => {
      const { status, stdout } = runCli([
        "--act-log",
        "x",
        "--publish-baseline",
        "MUTATION_TIMING_BASELINE",
      ])
      expect(status).toBe(2)
      expect(stdout).toContain("NÃO pode ser combinado com --act-log")
    })

    it("--baseline-margin sem --publish-baseline → exit 2 (uso inválido — a margem define o baseline publicado)", () => {
      const { status, stdout } = runCli(["--jobs-file", "x", "--baseline-margin", "0.2"])
      expect(status).toBe(2)
      expect(stdout).toContain("--baseline-margin exige --publish-baseline")
    })

    it("--publish-baseline sem --max → exit 2 (uso inválido — publicar sem budget seria no-op silencioso)", () => {
      const { status, stdout } = runCli([
        "--jobs-file",
        "x",
        "--publish-baseline",
        "MUTATION_TIMING_BASELINE",
      ])
      expect(status).toBe(2)
      expect(stdout).toContain("--publish-baseline exige --max")
    })

    it("--baseline-margin inválido (não-numérico) → exit 2 (uso inválido)", () => {
      const { status, stdout } = runCli([
        "--jobs-file",
        "x",
        "--publish-baseline",
        "MUTATION_TIMING_BASELINE",
        "--baseline-margin",
        "abc",
      ])
      expect(status).toBe(2)
      expect(stdout).toContain("--baseline-margin deve ser um número")
    })
  },
)

// ── 5b. GATE EM TRÊS FAIXAS (--alert suave + --warn soft + --max duro) ──
// Escalada suave em QUATRO níveis: d <= alert → 'ok' (silencioso); alert < d
// <= warn → 'notice' (::notice::); warn < d <= max → 'warn' (::warning::);
// d > max → 'fail' (::error:: + exit 1). A faixa notice observa o drift cedo
// (ruído baixo) ANTES do warning acender — zone de 4 níveis + noticed.

describe(
  "measure-mutation-timing.mjs CLI — três faixas do budget (--alert + --warn + --max)",
  { timeout: 120_000 },
  () => {
    /** Payload com step de duração customizada (para as faixas notice/warn/fail). */
    function payloadWithDuration(secs: number) {
      return {
        total_count: 1,
        jobs: [
          {
            name: "Mutation Test (contrato coordenado — doc↔anchor↔código, 5 cenários)",
            steps: [
              {
                name: "Run mutation test (contrato coordenado — 5 cenários, 2 elos)",
                started_at: "2026-08-02T20:00:00Z",
                completed_at: new Date(Date.parse("2026-08-02T20:00:00Z") + secs * 1000)
                  .toISOString()
                  .replace(/\.000Z$/, "Z"),
                conclusion: "success",
              },
            ],
          },
        ],
      }
    }

    it("faixa OK: 35s com --max 240 --warn 180 --alert 100 → exit 0 + zone 'ok' + noticed false (sem ::notice::)", () => {
      const { dir, file } = writeFixture(payloadWithDuration(35))
      try {
        const { status, stdout } = runCli([
          "--jobs-file",
          file,
          "--max",
          "240",
          "--warn",
          "180",
          "--alert",
          "100",
        ])
        expect(status).toBe(0)
        expect(stdout).not.toContain("::notice::")
        expect(stdout).not.toContain("::warning::")
        const report = JSON.parse(stdout)
        expect(report.zone).toBe("ok")
        expect(report.noticed).toBe(false)
        expect(report.warned).toBe(false)
        expect(report.exceeded).toBe(false)
        expect(report.alertSecs).toBe(100)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })

    it("faixa NOTICE: 120s (alert 100 < 120 <= warn 180) → exit 0 + ::notice:: + zone 'notice' + noticed true", () => {
      const { dir, file } = writeFixture(payloadWithDuration(120))
      try {
        const { status, stdout } = runCli([
          "--jobs-file",
          file,
          "--max",
          "240",
          "--warn",
          "180",
          "--alert",
          "100",
        ])
        expect(status).toBe(0)
        expect(stdout).toContain("::notice::budget de payload na faixa de NOTICE")
        expect(stdout).toContain("120s > alert 100s")
        const report = JSON.parse(stdout.replace(/^::notice::.*\n/, ""))
        expect(report.zone).toBe("notice")
        expect(report.noticed).toBe(true)
        expect(report.warned).toBe(false)
        expect(report.exceeded).toBe(false)
        expect(report.alertSecs).toBe(100)
        expect(report.warnSecs).toBe(180)
        expect(report.budgetSecs).toBe(240)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })

    it("faixa WARN continua: 200s (warn 180 < 200 <= max 240) → exit 0 + ::warning:: + zone 'warn' MESMO com --alert", () => {
      const { dir, file } = writeFixture(payloadWithDuration(200))
      try {
        const { status, stdout } = runCli([
          "--jobs-file",
          file,
          "--max",
          "240",
          "--warn",
          "180",
          "--alert",
          "100",
        ])
        expect(status).toBe(0)
        expect(stdout).toContain("::warning::budget de payload na faixa de WARN")
        const report = JSON.parse(stdout.replace(/^::warning::.*\n/, ""))
        expect(report.zone).toBe("warn")
        expect(report.warned).toBe(true)
        expect(report.noticed).toBe(false)
        expect(report.exceeded).toBe(false)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })

    it("faixa FAIL continua: 300s (d > max 240) → exit 1 + zone 'fail' MESMO com --alert", () => {
      const { dir, file } = writeFixture(payloadWithDuration(300))
      try {
        const { status, stdout } = runCli([
          "--jobs-file",
          file,
          "--max",
          "240",
          "--warn",
          "180",
          "--alert",
          "100",
        ])
        expect(status).toBe(1)
        expect(stdout).toContain("budget de payload EXCEDIDO (faixa dura)")
        const report = extractJsonReport(stdout)
        expect(report.zone).toBe("fail")
        expect(report.exceeded).toBe(true)
        expect(report.noticed).toBe(false)
        expect(report.warned).toBe(false)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })

    it("--alert SEM --warn → exit 2 (uso inválido — a faixa notice é relativa à soft)", () => {
      const { status, stdout } = runCli(["--jobs-file", "x", "--max", "240", "--alert", "100"])
      expect(status).toBe(2)
      expect(stdout).toContain("--alert exige --warn")
    })

    it("--alert >= --warn → exit 2 (uso inválido — faixa vazia)", () => {
      const { status, stdout } = runCli([
        "--jobs-file",
        "x",
        "--max",
        "240",
        "--warn",
        "180",
        "--alert",
        "180",
      ])
      expect(status).toBe(2)
      expect(stdout).toContain("--alert deve ser MENOR que --warn")
    })

    it("--alert inválido (não-numérico) → exit 2 (uso inválido)", () => {
      const { status, stdout } = runCli([
        "--jobs-file",
        "x",
        "--max",
        "240",
        "--warn",
        "180",
        "--alert",
        "abc",
      ])
      expect(status).toBe(2)
      expect(stdout).toContain("--alert deve ser um inteiro positivo")
    })

    it("faixa NOTICE com --warn-only: 120s → exit 0 + ::notice:: (a faixa suave é SEMPRE não-bloqueante, com ou sem --warn-only)", () => {
      // O --warn-only só converte a faixa fail em ::warning:: + exit 0; a faixa
      // notice já é não-bloqueante por natureza — o teste trava que a combinação
      // não degrada o ::notice:: para nada.
      const { dir, file } = writeFixture(payloadWithDuration(120))
      try {
        const { status, stdout } = runCli([
          "--jobs-file",
          file,
          "--max",
          "240",
          "--warn",
          "180",
          "--alert",
          "100",
          "--warn-only",
        ])
        expect(status).toBe(0)
        expect(stdout).toContain("::notice::budget de payload na faixa de NOTICE")
        const report = JSON.parse(stdout.replace(/^::notice::.*\n/, ""))
        expect(report.zone).toBe("notice")
        expect(report.noticed).toBe(true)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })

    it("MODO --act-log: 120s com --alert → exit 0 + ::notice:: + zone 'notice' (paridade do gate nas duas fontes)", () => {
      const { dir, file } = writeActLog(
        "[Mutation Test (contrato coordenado — doc↔anchor↔código, 5 cenários)/Run mutation test (contrato coordenado — 5 cenários, 2 elos)] ⭐ Run Main bun run test:mutation-coord-update\n[Mutation Test (contrato coordenado — doc↔anchor↔código, 5 cenários)/Run mutation test (contrato coordenado — 5 cenários, 2 elos)] ✅  Success - Main Run mutation test (contrato coordenado — 5 cenários, 2 elos) [120s]",
      )
      try {
        const { status, stdout } = runCli([
          "--act-log",
          file,
          "--max",
          "240",
          "--warn",
          "180",
          "--alert",
          "100",
        ])
        expect(status).toBe(0)
        expect(stdout).toContain("::notice::budget de payload na faixa de NOTICE")
        const report = JSON.parse(stdout.replace(/^::notice::.*\n/, ""))
        expect(report.zone).toBe("notice")
        expect(report.noticed).toBe(true)
        expect(report.source).toBe("act-log")
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })
  },
)

// ── 5c. BASELINE AUTO-ATUALIZADO (--publish-baseline via gh variable set) ─

describe(
  "measure-mutation-timing.mjs — baseline auto-atualizado (--publish-baseline)",
  { timeout: 120_000 },
  () => {
    it("computeBaselineValue: duração * (1 + margem), ceil, mínimo 1s", () => {
      expect(computeBaselineValue(35, 0.2, 240)).toBe(42) // 35 * 1.2 = 42
      expect(computeBaselineValue(35, 0, 240)).toBe(35) // margem 0 = tempo real
      expect(computeBaselineValue(1, 0.2, 240)).toBe(2) // ceil(1.2) = 2
      expect(computeBaselineValue(300, 0.2, null)).toBe(360) // sem clamp
    })

    it("computeBaselineValue: clamp para SEMPRE ficar < --max (faixa warn nunca vira vazia)", () => {
      expect(computeBaselineValue(200, 0.2, 240)).toBe(239) // ceil(240) >= 240 → 239
      expect(computeBaselineValue(300, 0, 240)).toBe(239) // 300 >= 240 → 239
      expect(computeBaselineValue(250, 0.2, 1)).toBe(1) // max=1 → mínimo 1
    })

    it("CLI: 35s dentro do budget + --publish-baseline (dry-run) → exit 0 + report.baseline com valor computado (42) e published dry-run", () => {
      const { dir, file } = writeFixture(realJobsPayload())
      try {
        const { status, stdout } = runCliEnv(
          [
            "--jobs-file",
            file,
            "--max",
            "240",
            "--warn",
            "180",
            "--publish-baseline",
            "MUTATION_TIMING_BASELINE",
            "--baseline-margin",
            "0.2",
          ],
          { MEASURE_MUTATION_TIMING_DRY_PUBLISH: "1" },
        )
        expect(status).toBe(0)
        expect(stdout).toContain("[dry-run] gh variable set MUTATION_TIMING_BASELINE 42")
        const report = extractJsonReport(stdout)
        expect(report.baseline).toMatchObject({
          name: "MUTATION_TIMING_BASELINE",
          value: 42,
          published: "dry-run",
        })
        expect(report.zone).toBe("ok")
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })

    it("CLI: 300s ACIMA do budget (zone fail) + --publish-baseline → NÃO publica (run lento não ratcheta o baseline) e exit 1", () => {
      const { dir, file } = writeFixture(realJobsPayload(300))
      try {
        const { status, stdout } = runCliEnv(
          [
            "--jobs-file",
            file,
            "--max",
            "240",
            "--warn",
            "180",
            "--publish-baseline",
            "MUTATION_TIMING_BASELINE",
          ],
          { MEASURE_MUTATION_TIMING_DRY_PUBLISH: "1" },
        )
        expect(status).toBe(1)
        expect(stdout).toContain("budget de payload EXCEDIDO")
        expect(stdout).not.toContain("gh variable set")
        const report = extractJsonReport(stdout)
        expect(report.baseline).toBeUndefined()
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })
  },
)

// ── 5d. FAIXA SOFT DERIVADA DA MEDIANA (--warn-median N) ────────────────
// O warn se AUTO-AJUSTA ao runner real: a faixa soft = mediana dos últimos
// N runs medidos do MESMO step * (1 + --warn-margin), clampada < --max
// (reusa computeBaselineValue). O gate DURO (--max) NÃO muda — o drift é
// detectado por DESVIO RELATIVO à mediana (40→55→75→90s acende o soft cedo
// sem tocar o duro). Sem histórico suficiente (primeiro run) → ::notice:: e
// o gate opera SÓ no duro. No modo TESTE (--jobs-file) o histórico vem de
// --history-file (fixtures determinísticos — sem gh).

describe(
  "measure-mutation-timing.mjs — faixa soft derivada da mediana (--warn-median)",
  { timeout: 120_000 },
  () => {
    /** Payload com step de duração customizada (para as faixas ok/warn/fail). */
    function payloadWithDuration(secs: number) {
      return {
        total_count: 1,
        jobs: [
          {
            name: "Mutation Test (contrato coordenado — doc↔anchor↔código, 5 cenários)",
            steps: [
              {
                name: "Run mutation test (contrato coordenado — 5 cenários, 2 elos)",
                started_at: "2026-08-02T20:00:00Z",
                completed_at: new Date(Date.parse("2026-08-02T20:00:00Z") + secs * 1000)
                  .toISOString()
                  .replace(/\.000Z$/, "Z"),
                conclusion: "success",
              },
            ],
          },
        ],
      }
    }

    /** Fixture de histórico determinístico: { runs: [{ runId, durationSecs }] }. */
    function writeHistory(runs: { runId: string; durationSecs: number }[]) {
      const dir = mkdtempSync(join(tmpdir(), "mutation-timing-history-"))
      const file = join(dir, "history.json")
      writeFileSync(file, JSON.stringify({ runs }))
      return { dir, file }
    }

    it("computeMedian: mediana (não média) — imune a outliers; filtra não-finitos", () => {
      // 4 anteriores [40, 55, 70, 200]: média 91.25 (outlier 200 distorce), mas
      // mediana 62.5 — o runner lento NÃO empurra o baseline para cima.
      expect(computeMedian([40, 55, 70, 200])).toBe(62.5)
      expect(computeMedian([40, 55, 70])).toBe(55) // ímpar → elemento central
      expect(computeMedian([40, 55])).toBe(47.5) // par → média dos dois centrais
      expect(computeMedian([40, NaN, 55, NaN])).toBe(47.5) // NaN filtrado
      expect(computeMedian([])).toBeNull()
      expect(computeMedian([NaN, NaN])).toBeNull()
    })

    it("deriveWarnFromMedian: mediana * (1 + margem), ceil, mínimo 1s, clampado < --max", () => {
      expect(deriveWarnFromMedian(62.5, 0.2, 240)).toBe(75) // ceil(62.5*1.2) = 75
      expect(deriveWarnFromMedian(62.5, 0, 240)).toBe(63) // margem 0 → ceil(62.5)
      expect(deriveWarnFromMedian(1, 0.2, 240)).toBe(2) // ceil(1.2) = 2
      expect(deriveWarnFromMedian(200, 0.2, 240)).toBe(239) // ceil(240) >= 240 → 239
      expect(deriveWarnFromMedian(null, 0.2, 240)).toBeNull() // sem histórico
    })

    it("buildRunListJq: comparação por NÚMERO puro (o gh emite databaseId como number — string compararia tipos e NUNCA excluiria o run atual)", () => {
      const jq = buildRunListJq(123)
      expect(jq).toContain(".databaseId != 123")
      expect(jq).not.toContain('.databaseId != "123"')
      expect(jq).toContain('select(.status == "completed")')
      expect(buildRunListJq("123")).toBe(jq) // string e number equivalentes
    })

    it("faixa OK derivada: 35s com mediana 62.5 → warn 75 → exit 0 + zone 'ok' + relatório com a derivação", () => {
      const { dir, file } = writeFixture(payloadWithDuration(35))
      const { dir: hdir, file: hfile } = writeHistory([
        { runId: "1", durationSecs: 70 },
        { runId: "2", durationSecs: 55 },
        { runId: "3", durationSecs: 40 },
        { runId: "4", durationSecs: 200 }, // outlier — a mediana o absorve
      ])
      try {
        const { status, stdout } = runCli([
          "--jobs-file",
          file,
          "--history-file",
          hfile,
          "--max",
          "240",
          "--warn-median",
          "4",
          "--warn-margin",
          "0.2",
        ])
        expect(status).toBe(0)
        expect(stdout).not.toContain("::warning::")
        const report = JSON.parse(stdout)
        expect(report.zone).toBe("ok")
        expect(report.warned).toBe(false)
        expect(report.exceeded).toBe(false)
        expect(report.warnSource).toBe("median")
        expect(report.warnWindow).toBe(4)
        expect(report.warnMargin).toBe(0.2)
        expect(report.warnMedianSecs).toBe(62.5)
        expect(report.warnHistoryCount).toBe(4)
        expect(report.warnSecs).toBe(75)
        expect(report.budgetSecs).toBe(240)
      } finally {
        rmSync(dir, { recursive: true, force: true })
        rmSync(hdir, { recursive: true, force: true })
      }
    })

    it("faixa WARN derivada: 80s (warn 75 < 80 <= max 240) → exit 0 + ::warning:: + zone 'warn' — o soft auto-ajustado acende", () => {
      const { dir, file } = writeFixture(payloadWithDuration(80))
      const { dir: hdir, file: hfile } = writeHistory([
        { runId: "1", durationSecs: 70 },
        { runId: "2", durationSecs: 55 },
        { runId: "3", durationSecs: 40 },
        { runId: "4", durationSecs: 200 },
      ])
      try {
        const { status, stdout } = runCli([
          "--jobs-file",
          file,
          "--history-file",
          hfile,
          "--max",
          "240",
          "--warn-median",
          "4",
          "--warn-margin",
          "0.2",
        ])
        expect(status).toBe(0)
        expect(stdout).toContain("::warning::budget de payload na faixa de WARN")
        expect(stdout).toContain("80s > warn 75s")
        const report = JSON.parse(stdout.replace(/^::warning::.*\n/, ""))
        expect(report.zone).toBe("warn")
        expect(report.warned).toBe(true)
        expect(report.warnSecs).toBe(75)
        expect(report.warnMedianSecs).toBe(62.5)
      } finally {
        rmSync(dir, { recursive: true, force: true })
        rmSync(hdir, { recursive: true, force: true })
      }
    })

    it("faixa FAIL derivada: 300s (d > max 240) → exit 1 — o gate DURO continua fixo, a derivação não o move", () => {
      const { dir, file } = writeFixture(payloadWithDuration(300))
      const { dir: hdir, file: hfile } = writeHistory([
        { runId: "1", durationSecs: 70 },
        { runId: "2", durationSecs: 55 },
        { runId: "3", durationSecs: 40 },
        { runId: "4", durationSecs: 200 },
      ])
      try {
        const { status, stdout } = runCli([
          "--jobs-file",
          file,
          "--history-file",
          hfile,
          "--max",
          "240",
          "--warn-median",
          "4",
          "--warn-margin",
          "0.2",
        ])
        expect(status).toBe(1)
        expect(stdout).toContain("budget de payload EXCEDIDO (faixa dura)")
        const report = extractJsonReport(stdout)
        expect(report.zone).toBe("fail")
        expect(report.exceeded).toBe(true)
        expect(report.budgetSecs).toBe(240)
      } finally {
        rmSync(dir, { recursive: true, force: true })
        rmSync(hdir, { recursive: true, force: true })
      }
    })

    it("SEM histórico suficiente (primeiro run): ::notice:: + gate SÓ no duro — o primeiro run mede o baseline", () => {
      const { dir, file } = writeFixture(payloadWithDuration(35))
      const { dir: hdir, file: hfile } = writeHistory([])
      try {
        const { status, stdout } = runCli([
          "--jobs-file",
          file,
          "--history-file",
          hfile,
          "--max",
          "240",
          "--warn-median",
          "4",
          "--warn-margin",
          "0.2",
        ])
        expect(status).toBe(0)
        expect(stdout).toContain("::notice::sem histórico suficiente para a faixa soft")
        const report = JSON.parse(stdout.replace(/^::notice::.*\n/, ""))
        expect(report.zone).toBe("ok")
        expect(report.warnSource).toBe("median")
        expect(report.warnMedianSecs).toBeNull()
        expect(report.warnHistoryCount).toBe(0)
        expect(report.warnSecs).toBeUndefined() // gate só no duro
        expect(report.budgetSecs).toBe(240)
      } finally {
        rmSync(dir, { recursive: true, force: true })
        rmSync(hdir, { recursive: true, force: true })
      }
    })

    it("SEM histórico suficiente + 300s: o duro AINDA gateia → exit 1 (fail-closed)", () => {
      const { dir, file } = writeFixture(payloadWithDuration(300))
      const { dir: hdir, file: hfile } = writeHistory([])
      try {
        const { status, stdout } = runCli([
          "--jobs-file",
          file,
          "--history-file",
          hfile,
          "--max",
          "240",
          "--warn-median",
          "4",
        ])
        expect(status).toBe(1)
        expect(stdout).toContain("budget de payload EXCEDIDO")
        const report = extractJsonReport(stdout)
        expect(report.exceeded).toBe(true)
      } finally {
        rmSync(dir, { recursive: true, force: true })
        rmSync(hdir, { recursive: true, force: true })
      }
    })

    it("--warn-median SEM --max → exit 2 (uso inválido — a faixa derivada é relativa ao duro)", () => {
      const { status, stdout } = runCli([
        "--jobs-file",
        "x",
        "--history-file",
        "y",
        "--warn-median",
        "4",
      ])
      expect(status).toBe(2)
      expect(stdout).toContain("--warn-median exige --max")
    })

    it("--warn-median combinado com --warn → exit 2 (escolha: literal OU derivada da mediana)", () => {
      const { status, stdout } = runCli([
        "--jobs-file",
        "x",
        "--max",
        "240",
        "--warn",
        "180",
        "--warn-median",
        "4",
      ])
      expect(status).toBe(2)
      expect(stdout).toContain("--warn-median não pode ser combinado com --warn")
    })

    it("--warn-median com --jobs-file SEM --history-file → exit 2 (modo TESTE — o histórico não vem do gh)", () => {
      const { status, stdout } = runCli(["--jobs-file", "x", "--max", "240", "--warn-median", "4"])
      expect(status).toBe(2)
      expect(stdout).toContain("exige --history-file")
    })

    it("--history-file SEM --warn-median → exit 2 (o histórico alimenta a derivação)", () => {
      const { status, stdout } = runCli(["--jobs-file", "x", "--history-file", "y"])
      expect(status).toBe(2)
      expect(stdout).toContain("--history-file exige --warn-median")
    })

    it("--warn-margin SEM --warn-median → exit 2 (a margem define a faixa derivada)", () => {
      const { status, stdout } = runCli([
        "--jobs-file",
        "x",
        "--max",
        "240",
        "--warn-margin",
        "0.2",
      ])
      expect(status).toBe(2)
      expect(stdout).toContain("--warn-margin exige --warn-median")
    })

    it("--warn-median inválido (não-numérico / zero) → exit 2 (uso inválido)", () => {
      const { status, stdout } = runCli([
        "--jobs-file",
        "x",
        "--history-file",
        "y",
        "--max",
        "240",
        "--warn-median",
        "abc",
      ])
      expect(status).toBe(2)
      expect(stdout).toContain("--warn-median deve ser um inteiro")
      const { status: s2, stdout: o2 } = runCli([
        "--jobs-file",
        "x",
        "--history-file",
        "y",
        "--max",
        "240",
        "--warn-median",
        "0",
      ])
      expect(s2).toBe(2)
      expect(o2).toContain("--warn-median deve ser um inteiro")
    })

    it("--history-file de JSON inválido → exit 1 (infra — o mecanismo de derivação quebrou)", () => {
      const { dir, file } = writeFixture(payloadWithDuration(35))
      const hdir = mkdtempSync(join(tmpdir(), "mutation-timing-history-bad-"))
      const hfile = join(hdir, "history.json")
      writeFileSync(hfile, "não é json")
      try {
        const { status, stdout } = runCli([
          "--jobs-file",
          file,
          "--history-file",
          hfile,
          "--max",
          "240",
          "--warn-median",
          "4",
        ])
        expect(status).toBe(1)
        expect(stdout).toContain("falha ao ler --history-file")
      } finally {
        rmSync(dir, { recursive: true, force: true })
        rmSync(hdir, { recursive: true, force: true })
      }
    })

    it("gh do histórico indisponível (modo REAL): DEGRADA para ::notice:: + gate só no duro — 35s → exit 0 + zone ok (dependência secundária não derruba o gate)", () => {
      // Sem --history-file, a derivação vai ao gh (repo view + run list) — um
      // repo INEXISTENTE faz o gh falhar determinísticamente (404, sem
      // depender da rede/do gh instalado). O modo --act-log permite chegar à
      // derivação sem --jobs-file (que exigiria --history-file). A falha NÃO
      // é infra: DEGRADA para ::notice:: + gate só no duro — o sinal primário
      // (--max 240) continua intacto e um payload saudável passa.
      const { dir, file } = writeActLog(
        "[Mutation Test (contrato coordenado — doc↔anchor↔código, 5 cenários)/Run mutation test (contrato coordenado — 5 cenários, 2 elos)] ✅  Success - Main Run mutation test (contrato coordenado — 5 cenários, 2 elos) [35s]",
      )
      try {
        const { status, stdout } = runCli([
          "--act-log",
          file,
          "--max",
          "240",
          "--warn-median",
          "4",
          "--repo",
          "nonexistent/repo",
        ])
        expect(status).toBe(0)
        expect(stdout).toContain("::notice::histórico da mediana indisponível")
        expect(stdout).toContain("gate opera SÓ no duro")
        const report = extractJsonReport(stdout)
        expect(report.zone).toBe("ok")
        expect(report.exceeded).toBe(false)
        // Shape consistente com o primeiro-run (sem histórico): a derivação
        // falhou mas o relatório NÃO deixa o caller distinguir de um legítimo
        // 'ainda sem histórico' — evita tratamento especial por caminho.
        expect(report.warnSource).toBe("median")
        expect(report.warnWindow).toBe(4)
        expect(report.warnMedianSecs).toBeNull()
        expect(report.warnHistoryCount).toBe(0)
        expect(report.warnSecs).toBeUndefined() // gate só no duro
        expect(report.budgetSecs).toBe(240)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })

    it("gh do histórico indisponível + 300s: o gate DURO ainda FALHA → exit 1 + zone fail (fail-closed mesmo com a dependência secundária quebrada)", () => {
      // O caso crítico: quando o histórico não está disponível, um payload que
      // EXCEDE o --max 240 precisa CONTINUAR falhando. Se a derivação
      // degradada retornasse sem chegar ao applyBudgetGate, o 300s sairia
      // exit 0 silencioso — a regressão exata que o gate existe para matar.
      const { dir, file } = writeActLog(
        "[Mutation Test (contrato coordenado — doc↔anchor↔código, 5 cenários)/Run mutation test (contrato coordenado — 5 cenários, 2 elos)] ✅  Success - Main Run mutation test (contrato coordenado — 5 cenários, 2 elos) [300s]",
      )
      try {
        const { status, stdout } = runCli([
          "--act-log",
          file,
          "--max",
          "240",
          "--warn-median",
          "4",
          "--repo",
          "nonexistent/repo",
        ])
        expect(status).toBe(1)
        expect(stdout).toContain("::notice::histórico da mediana indisponível")
        expect(stdout).toContain("budget de payload EXCEDIDO (faixa dura)")
        const report = extractJsonReport(stdout)
        expect(report.zone).toBe("fail")
        expect(report.exceeded).toBe(true)
        expect(report.warnMedianSecs).toBeNull()
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })
  },
)

// ── 5e. GATE DE DRIFT RELATIVO (--fail-drift PCT) ───────────────────────
// O PR compara o timing atual contra a MEDIANA do histórico e FALHA por
// DESVIO RELATIVO (`(d - mediana)/mediana * 100 > PCT`) — o --max vira TETO
// ABSOLUTO de segurança (d > max falha SEMPRE, mesmo com drift pequeno).
// Drift pega a regressão por desvio relativo ANTES do teto (ex.: payload de
// 100s contra mediana 62.5s = +60% falha, mesmo com teto 240s longe).
// Sem histórico (primeiro run) ou gh fora → ::notice:: + gate só no teto.
// O relatório distingue as duas causas de fail: exceeded (teto) vs drifted
// (drift relativo) — o PR debuga a regressão certa.

describe(
  "measure-mutation-timing.mjs — gate de drift relativo (--fail-drift)",
  { timeout: 120_000 },
  () => {
    /** Payload com step de duração customizada. */
    function payloadWithDuration(secs: number) {
      return {
        total_count: 1,
        jobs: [
          {
            name: "Mutation Test (contrato coordenado — doc↔anchor↔código, 5 cenários)",
            steps: [
              {
                name: "Run mutation test (contrato coordenado — 5 cenários, 2 elos)",
                started_at: "2026-08-02T20:00:00Z",
                completed_at: new Date(Date.parse("2026-08-02T20:00:00Z") + secs * 1000)
                  .toISOString()
                  .replace(/\.000Z$/, "Z"),
                conclusion: "success",
              },
            ],
          },
        ],
      }
    }

    /** Histórico determinístico: mediana 62.5s (outlier 200s absorvido). */
    function writeDefaultHistory() {
      const dir = mkdtempSync(join(tmpdir(), "mutation-timing-drift-hist-"))
      const file = join(dir, "history.json")
      writeFileSync(
        file,
        JSON.stringify({
          runs: [
            { runId: "1", durationSecs: 70 },
            { runId: "2", durationSecs: 55 },
            { runId: "3", durationSecs: 40 },
            { runId: "4", durationSecs: 200 },
          ],
        }),
      )
      return { dir, file }
    }

    it("drift DENTRO do limiar: 90s vs mediana 62.5s (+44% <= 50%) → exit 0 + zone ok + drifted false (gate não é over-eager)", () => {
      const { dir, file } = writeFixture(payloadWithDuration(90))
      const { dir: hdir, file: hfile } = writeDefaultHistory()
      try {
        const { status, stdout } = runCli([
          "--jobs-file",
          file,
          "--history-file",
          hfile,
          "--max",
          "240",
          "--fail-drift",
          "50",
          "--window",
          "4",
        ])
        expect(status).toBe(0)
        expect(stdout).not.toContain("::error::")
        const report = JSON.parse(stdout)
        expect(report.zone).toBe("ok")
        expect(report.drifted).toBe(false)
        expect(report.exceeded).toBe(false)
        expect(report.driftSource).toBe("median")
        expect(report.driftWindow).toBe(4)
        expect(report.driftMaxPct).toBe(50)
        expect(report.driftMedianSecs).toBe(62.5)
        expect(report.driftHistoryCount).toBe(4)
        expect(report.driftPct).toBeCloseTo(44) // (90-62.5)/62.5*100
      } finally {
        rmSync(dir, { recursive: true, force: true })
        rmSync(hdir, { recursive: true, force: true })
      }
    })

    it("drift ACIMA do limiar: 100s vs mediana 62.5s (+60% > 50%) → exit 1 + zone fail + drifted true + mensagem 'drift relativo EXCEDIDO'", () => {
      const { dir, file } = writeFixture(payloadWithDuration(100))
      const { dir: hdir, file: hfile } = writeDefaultHistory()
      try {
        const { status, stdout } = runCli([
          "--jobs-file",
          file,
          "--history-file",
          hfile,
          "--max",
          "240",
          "--fail-drift",
          "50",
        ])
        expect(status).toBe(1)
        expect(stdout).toContain("drift relativo EXCEDIDO")
        expect(stdout).toContain("+60.0% > limiar 50%")
        const report = extractJsonReport(stdout)
        expect(report.zone).toBe("fail")
        expect(report.drifted).toBe(true)
        expect(report.exceeded).toBe(false) // teto NÃO foi tocado — drift pegou antes
        expect(report.driftPct).toBeCloseTo(60)
        expect(report.budgetSecs).toBe(240)
      } finally {
        rmSync(dir, { recursive: true, force: true })
        rmSync(hdir, { recursive: true, force: true })
      }
    })

    it("TETO ABSOLUTO: 250s com drift pequeno (mediana alta 227.5s → +9.9%) → exit 1 por exceeded (d > max falha SEMPRE, mesmo com drift <= limiar)", () => {
      const { dir, file } = writeFixture(payloadWithDuration(250))
      const hdir = mkdtempSync(join(tmpdir(), "mutation-timing-drift-teto-"))
      const hfile = join(hdir, "history.json")
      writeFileSync(
        hfile,
        JSON.stringify({
          runs: [
            { runId: "1", durationSecs: 230 },
            { runId: "2", durationSecs: 220 },
            { runId: "3", durationSecs: 225 },
            { runId: "4", durationSecs: 235 },
          ],
        }),
      )
      try {
        const { status, stdout } = runCli([
          "--jobs-file",
          file,
          "--history-file",
          hfile,
          "--max",
          "240",
          "--fail-drift",
          "50",
        ])
        expect(status).toBe(1)
        expect(stdout).toContain("budget de payload EXCEDIDO (faixa dura)")
        expect(stdout).toContain("250s > budget 240s")
        const report = extractJsonReport(stdout)
        expect(report.zone).toBe("fail")
        expect(report.exceeded).toBe(true) // causa: TETO, não drift
        expect(report.drifted).toBe(false)
        expect(report.driftPct).toBeCloseTo(9.9, 1) // drift pequeno NÃO salvou do teto
      } finally {
        rmSync(dir, { recursive: true, force: true })
        rmSync(hdir, { recursive: true, force: true })
      }
    })

    it("SEM histórico suficiente (primeiro run): ::notice:: + gate SÓ no teto — 35s → exit 0 (não falha por drift sem baseline)", () => {
      const { dir, file } = writeFixture(payloadWithDuration(35))
      const hdir = mkdtempSync(join(tmpdir(), "mutation-timing-drift-empty-"))
      const hfile = join(hdir, "history.json")
      writeFileSync(hfile, JSON.stringify({ runs: [] }))
      try {
        const { status, stdout } = runCli([
          "--jobs-file",
          file,
          "--history-file",
          hfile,
          "--max",
          "240",
          "--fail-drift",
          "50",
        ])
        expect(status).toBe(0)
        expect(stdout).toContain("::notice::sem histórico suficiente para o drift relativo")
        const report = JSON.parse(stdout.replace(/^::notice::.*\n/, ""))
        expect(report.zone).toBe("ok")
        expect(report.driftPct).toBeNull()
        expect(report.driftMedianSecs).toBeNull()
        expect(report.driftHistoryCount).toBe(0)
        expect(report.budgetSecs).toBe(240)
      } finally {
        rmSync(dir, { recursive: true, force: true })
        rmSync(hdir, { recursive: true, force: true })
      }
    })

    it("SEM histórico + 300s: o TETO ainda falha → exit 1 (fail-closed — primeiro run não abre buraco)", () => {
      const { dir, file } = writeFixture(payloadWithDuration(300))
      const hdir = mkdtempSync(join(tmpdir(), "mutation-timing-drift-empty2-"))
      const hfile = join(hdir, "history.json")
      writeFileSync(hfile, JSON.stringify({ runs: [] }))
      try {
        const { status, stdout } = runCli([
          "--jobs-file",
          file,
          "--history-file",
          hfile,
          "--max",
          "240",
          "--fail-drift",
          "50",
        ])
        expect(status).toBe(1)
        expect(stdout).toContain("budget de payload EXCEDIDO (faixa dura)")
        const report = extractJsonReport(stdout)
        expect(report.exceeded).toBe(true)
      } finally {
        rmSync(dir, { recursive: true, force: true })
        rmSync(hdir, { recursive: true, force: true })
      }
    })

    it("gh do histórico indisponível (modo REAL): DEGRADA p/ ::notice:: + gate só no teto — 35s → exit 0 (dependência secundária não derruba o gate)", () => {
      const { dir, file } = writeActLog(
        "[Mutation Test (contrato coordenado — doc↔anchor↔código, 5 cenários)/Run mutation test (contrato coordenado — 5 cenários, 2 elos)] ✅  Success - Main Run mutation test (contrato coordenado — 5 cenários, 2 elos) [35s]",
      )
      try {
        const { status, stdout } = runCli([
          "--act-log",
          file,
          "--max",
          "240",
          "--fail-drift",
          "50",
          "--repo",
          "nonexistent/repo",
        ])
        expect(status).toBe(0)
        expect(stdout).toContain("::notice::histórico do drift indisponível")
        const report = extractJsonReport(stdout)
        expect(report.zone).toBe("ok")
        expect(report.driftPct).toBeNull()
        expect(report.driftHistoryCount).toBe(0)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })

    it("gh do histórico indisponível + 300s: o TETO ainda FALHA → exit 1 (fail-closed com a dependência secundária quebrada)", () => {
      const { dir, file } = writeActLog(
        "[Mutation Test (contrato coordenado — doc↔anchor↔código, 5 cenários)/Run mutation test (contrato coordenado — 5 cenários, 2 elos)] ✅  Success - Main Run mutation test (contrato coordenado — 5 cenários, 2 elos) [300s]",
      )
      try {
        const { status, stdout } = runCli([
          "--act-log",
          file,
          "--max",
          "240",
          "--fail-drift",
          "50",
          "--repo",
          "nonexistent/repo",
        ])
        expect(status).toBe(1)
        expect(stdout).toContain("budget de payload EXCEDIDO (faixa dura)")
        const report = extractJsonReport(stdout)
        expect(report.exceeded).toBe(true)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })

    it("--fail-drift SEM --max → exit 2 (o teto absoluto define a segurança)", () => {
      const { status, stdout } = runCli([
        "--jobs-file",
        "x",
        "--history-file",
        "y",
        "--fail-drift",
        "50",
      ])
      expect(status).toBe(2)
      expect(stdout).toContain("--fail-drift exige --max")
    })

    it("--fail-drift combinado com --warn → exit 2 (escolha a semântica do gate)", () => {
      const { status, stdout } = runCli([
        "--jobs-file",
        "x",
        "--history-file",
        "y",
        "--max",
        "240",
        "--fail-drift",
        "50",
        "--warn",
        "180",
      ])
      expect(status).toBe(2)
      expect(stdout).toContain("--fail-drift não pode ser combinado com --warn")
    })

    it("--fail-drift combinado com --warn-median → exit 2 (semânticas exclusivas)", () => {
      const { status, stdout } = runCli([
        "--jobs-file",
        "x",
        "--history-file",
        "y",
        "--max",
        "240",
        "--fail-drift",
        "50",
        "--warn-median",
        "4",
      ])
      expect(status).toBe(2)
      expect(stdout).toContain("--fail-drift não pode ser combinado com --warn-median")
    })

    it("--fail-drift combinado com --alert → exit 2 (a escalada suave é da semântica de faixa)", () => {
      const { status, stdout } = runCli([
        "--jobs-file",
        "x",
        "--history-file",
        "y",
        "--max",
        "240",
        "--fail-drift",
        "50",
        "--alert",
        "100",
      ])
      expect(status).toBe(2)
      expect(stdout).toContain("--fail-drift não pode ser combinado com --alert")
    })

    it("--fail-drift com --jobs-file SEM --history-file → exit 2 (modo TESTE exige fixture de histórico)", () => {
      const { status, stdout } = runCli(["--jobs-file", "x", "--max", "240", "--fail-drift", "50"])
      expect(status).toBe(2)
      expect(stdout).toContain("exige --history-file")
    })

    it("--window SEM --fail-drift → exit 2 (a janela define o histórico do drift)", () => {
      const { status, stdout } = runCli([
        "--jobs-file",
        "x",
        "--history-file",
        "y",
        "--max",
        "240",
        "--window",
        "4",
      ])
      expect(status).toBe(2)
      expect(stdout).toContain("--window exige --fail-drift")
    })

    it("--history-file SEM --warn-median nem --fail-drift → exit 2 (mensagem cobre as duas derivações)", () => {
      const { status, stdout } = runCli(["--jobs-file", "x", "--history-file", "y", "--max", "240"])
      expect(status).toBe(2)
      expect(stdout).toContain("exige --warn-median OU --fail-drift")
    })

    it("--fail-drift inválido (não-numérico / negativo) → exit 2", () => {
      const { status, stdout } = runCli([
        "--jobs-file",
        "x",
        "--history-file",
        "y",
        "--max",
        "240",
        "--fail-drift",
        "abc",
      ])
      expect(status).toBe(2)
      expect(stdout).toContain("--fail-drift deve ser um número")
      const { status: s2, stdout: o2 } = runCli([
        "--jobs-file",
        "x",
        "--history-file",
        "y",
        "--max",
        "240",
        "--fail-drift",
        "-5",
      ])
      expect(s2).toBe(2)
      expect(o2).toContain("--fail-drift deve ser um número")
    })

    it("--window inválido (zero / não-numérico) → exit 2", () => {
      const { status, stdout } = runCli([
        "--jobs-file",
        "x",
        "--history-file",
        "y",
        "--max",
        "240",
        "--fail-drift",
        "50",
        "--window",
        "0",
      ])
      expect(status).toBe(2)
      expect(stdout).toContain("--window deve ser um inteiro")
    })
  },
)
