/**
 * benchmark-weekly-mutation-timing-workflow.test.ts
 *
 * Snapshot test do job PERIÓDICO mutation-coord-timing do
 * .github/workflows/benchmark-weekly.yml — a RE-MEDIÇÃO semanal do tempo
 * real do step 'Run mutation test (contrato coordenado — 5 cenários, 2
 * elos)' do seed-guards.yml.
 *
 * Migração para o helper compartilhado workflow-execution: substitui
 * asserções de leitura de YAML por provas de execução via
 * filterExecutableSteps e resolveCondition.
 *
 * Uso:
 *   npx vitest run --config vitest.config.unit.ts src/lib/__tests__/benchmark-weekly-mutation-timing-workflow.test.ts
 *
 * NOTA: snapshot de estrutura — para REGENERAR após mudança INTENCIONAL do
 * job: npx vitest run ... -u.
 */

import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { JOB_NAME_MARKER, STEP_NAME_MARKER } from "../../../scripts/measure-mutation-timing.mjs"
import {
  loadWorkflow,
  readWorkflowContent,
  getJob,
  getSteps,
  buildRepoContext,
  expectAllRefs,
  filterExecutableSteps,
  resolveCondition,
} from "./helpers/workflow-execution"

const WF_NAME = "benchmark-weekly.yml"
const JOB_KEY = "mutation-coord-timing"
const SEED_GUARDS_PATH = join(process.cwd(), ".github", "workflows", "seed-guards.yml")

const wf = loadWorkflow(`.github/workflows/${WF_NAME}`)
const content = readWorkflowContent(`.github/workflows/${WF_NAME}`)
const job = getJob(wf, JOB_KEY)
const steps = getSteps(job)
const ctx = buildRepoContext()
const seedGuardsContent = readFileSync(SEED_GUARDS_PATH, "utf8")

// ── 1. Sintaxe YAML + snapshot da estrutura do job ──────────────────────

describe("benchmark-weekly.yml — job mutation-coord-timing (sintaxe YAML + snapshot)", () => {
  it("parseia como YAML válido e o job casa com o snapshot da estrutura", () => {
    expect(job).toBeDefined()
    expect(job).toMatchSnapshot()
  })

  it("estrutura mínima: job com 4 steps (checkout, medida, artifact, summary)", () => {
    expect(job.name).toBe("Mutation coord timing (re-medição semanal)")
    expect(steps.length).toBe(4)
  })

  it("triggers: schedule semanal + workflow_dispatch (nenhum push/pr)", () => {
    const triggers = Object.keys(wf.on ?? {})
    expect(triggers).toContain("schedule")
    expect(triggers).toContain("workflow_dispatch")
    expect(triggers).not.toContain("push")
    expect(triggers).not.toContain("pull_request")
  })

  it("checkout simples (fetch-depth default — a medição não precisa de histórico)", () => {
    expect(steps[0]?.uses).toBe("actions/checkout@v4")
  })
})

// ── 2. Contrato de medição (needs/if/permissions/GH_TOKEN/invocação) ───

describe("benchmark-weekly.yml — contrato de medição do mutation-coord-timing", () => {
  it("needs: seed-guards E if: always() — mede TAMBÉM quando o seed-guards falhou (timeout é o alvo)", () => {
    expect(job.needs).toBe("seed-guards")
    expect(job.if).toBe("always()")
    // Prova de execução: always() é verdadeiro em QUALQUER contexto
    expect(resolveCondition("always()", { previousJobFailed: true })).toBe(true)
    expect(resolveCondition("always()", { previousJobFailed: false })).toBe(true)
    expect(resolveCondition("always()", { previousJobCancelled: true })).toBe(true)
  })

  it("permissions: actions: READ (jobs API + gh run list da derivação — NÃO publica variable) + contents: read", () => {
    expect(job.permissions).toMatchObject({
      contents: "read",
      actions: "read",
    })
    expect(job.permissions).not.toMatchObject({ actions: "write" })
  })

  it("passo de medida (id: measure) injeta GH_TOKEN, invoca o script com run atual E DERIVA a faixa soft da MEDIANA", () => {
    const measure = steps.find((s) => s.id === "measure")
    expect(measure).toBeDefined()
    expect(measure?.env).toEqual({ GH_TOKEN: "${{ github.token }}" })
    const run = measure?.run ?? ""
    expect(run).toContain("node scripts/measure-mutation-timing.mjs")
    expect(run).toContain('--run "${{ github.run_id }}"')
    expect(run).toContain('--repo "${{ github.repository }}"')
    expect(run).toContain("--max 240")
    expect(run).toContain("--warn-median 4")
    expect(run).toContain("--warn-margin 0.2")
    expect(run).toContain("--json /tmp/mutation-timing.json")
    expect(run).not.toContain("--publish-baseline")
    expect(run).not.toContain('--warn "')
  })

  it("artifact e summary usam if: always() — a evidência existe mesmo com exit 1/2 do script", () => {
    const artifact = steps.find((s) => s.uses?.startsWith("actions/upload-artifact"))
    const summary = steps.find((s) => s.name === "Summary")
    expect(artifact?.if).toBe("always()")
    expect(artifact?.with).toMatchObject({ path: "/tmp/mutation-timing.json" })
    expect(summary?.if).toBe("always()")
    expect(summary?.run ?? "").toContain("$GITHUB_STEP_SUMMARY")
  })

  it("todos os steps executam independentemente do resultado (always() nos 3 últimos)", () => {
    const executable = filterExecutableSteps(job)
    expect(executable.length).toBe(4)
    // Checkout + measure (sem if = success) + artifact (always) + summary (always)
    expect(executable[0]?.uses).toBe("actions/checkout@v4")
    expect(executable[1]?.id).toBe("measure")
    expect(executable[2]?.if).toBe("always()")
    expect(executable[3]?.if).toBe("always()")
  })
})

// ── 3. MARKERS de contrato: script ↔ nomes REAIS do seed-guards.yml ────

describe("measure-mutation-timing.mjs — markers casam com os nomes reais do seed-guards.yml", () => {
  it("JOB_NAME_MARKER ('contrato coordenado') aparece no nome REAL do job do seed-guards", () => {
    const jobLine = seedGuardsContent
      .split("\n")
      .find((l) => l.includes("name: Mutation Test (contrato coordenado"))
    expect(jobLine).toBeDefined()
    expect(jobLine).toContain(JOB_NAME_MARKER)
  })

  it("STEP_NAME_MARKER ('Run mutation test') aparece no nome REAL do step do seed-guards", () => {
    const stepLine = seedGuardsContent
      .split("\n")
      .find((l) => l.includes("name: Run mutation test"))
    expect(stepLine).toBeDefined()
    expect(stepLine).toContain(STEP_NAME_MARKER)
  })

  it("o step real do seed-guards tem id: mutation (o summary do job o referencia)", () => {
    const block = seedGuardsContent.split("name: Run mutation test (contrato coordenado")
    expect(block.length).toBeGreaterThan(1)
    expect(block[1]).toContain("id: mutation")
  })
})

// ── 4. Refs de script/workflow contra o repo real ───────────────────────

describe("benchmark-weekly.yml — refs do mutation-coord-timing", () => {
  it("todas as refs resolvem (scripts, workflows, actions)", () => {
    expectAllRefs(content, ctx)
  })
})
