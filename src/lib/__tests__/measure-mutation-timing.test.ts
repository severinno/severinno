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

describe("measure-mutation-timing.mjs CLI", () => {
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

describe("measure-mutation-timing.mjs CLI — gate de budget (--max)", () => {
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
      const report = JSON.parse(stdout.match(/\{[\s\S]*\}/)![0])
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

describe("measure-mutation-timing.mjs CLI — modo --act-log", () => {
  /** Log do act com a linha de sucesso do step na duração dada. */
  function actLogWithDuration(secs: number) {
    return [
      "[Mutation Test (contrato coordenado — doc↔anchor↔código, 5 cenários)/Run mutation test (contrato coordenado — 5 cenários, 2 elos)] ⭐ Run Main bun run test:mutation-coord-update",
      `[Mutation Test (contrato coordenado — doc↔anchor↔código, 5 cenários)/Run mutation test (contrato coordenado — 5 cenários, 2 elos)] ✅  Success - Main Run mutation test (contrato coordenado — 5 cenários, 2 elos) [${secs}s]`,
    ].join("\n")
  }

  function writeActLog(text: string) {
    const dir = mkdtempSync(join(tmpdir(), "mutation-timing-actlog-"))
    const file = join(dir, "act.log")
    writeFileSync(file, text)
    return { dir, file }
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
      const report = JSON.parse(stdout.match(/\{[\s\S]*\}/)![0])
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

describe("measure-mutation-timing.mjs CLI — duas faixas do budget (--max + --warn)", () => {
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
      const report = JSON.parse(stdout.match(/\{[\s\S]*\}/)![0])
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
    const { status, stdout } = runCli(["--jobs-file", "x", "--publish-baseline", "baseline-lower"])
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
})

// ── 5c. BASELINE AUTO-ATUALIZADO (--publish-baseline via gh variable set) ─

describe("measure-mutation-timing.mjs — baseline auto-atualizado (--publish-baseline)", () => {
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
      const report = JSON.parse(stdout.match(/\{[\s\S]*\}/)![0])
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
      const report = JSON.parse(stdout.match(/\{[\s\S]*\}/)![0])
      expect(report.baseline).toBeUndefined()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
