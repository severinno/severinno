/**
 * benchmark-weekly-default-branch-guard-workflow.test.ts
 *
 * Snapshot test do job PERIÓDICO default-branch-workflow-guard do
 * .github/workflows/benchmark-weekly.yml — o guard que valida que os
 * workflows de MEDIÇÃO de CI (seed-guards.yml) EXISTEM na branch DEFAULT
 * do repo, prevenindo o falso estado 'pendente de medição' (o gh run list
 * responde '404: workflow not found on the default branch' quando o
 * workflow NÃO foi mergeado — o bloqueio real é o MERGE, não a falta de
 * run).
 *
 * Valida (padrão dos testes de guards — espelha o
 * benchmark-weekly-mutation-timing-workflow.test.ts):
 *
 *   1. Sintaxe YAML — carregamento via helper compartilhado + snapshot
 *      da estrutura do JOB.
 *   2. Contrato de verificação: permissions contents: read (gh api
 *      repos/X/contents), GH_TOKEN: ${{ github.token }}, invocação do
 *      script com --repo github.repository --workflow seed-guards.yml e
 *      --json /tmp/default-branch-guard.json.
 *   3. Fail-closed documentado no header do script: exit 1 = workflow
 *      ausente (GATE), exit 2 = infra — o job falha (não silencia) quando
 *      a medição não está deployada.
 *   4. Refs contra o check-workflow-refs via helper expectAllRefs.
 *
 * Uso:
 *   npx vitest run --config vitest.config.unit.ts src/lib/__tests__/benchmark-weekly-default-branch-guard-workflow.test.ts
 *
 * NOTA: snapshot de estrutura — para REGENERAR após mudança INTENCIONAL do
 * job: npx vitest run ... -u.
 */

import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

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
const JOB_KEY = "default-branch-workflow-guard"

const wf = loadWorkflow(`.github/workflows/${WF_NAME}`)
const content = readWorkflowContent(`.github/workflows/${WF_NAME}`)
const job = getJob(wf, JOB_KEY)
const steps = getSteps(job)
const ctx = buildRepoContext()

// ── 1. Sintaxe YAML + snapshot da estrutura do job ─────────────────────

describe("benchmark-weekly.yml — job default-branch-workflow-guard (sintaxe YAML + snapshot)", () => {
  it("parseia como YAML válido e o job casa com o snapshot da estrutura", () => {
    expect(job).toBeDefined()
    expect(job).toMatchSnapshot()
  })

  it("estrutura mínima: job com 4 steps (checkout, validação, artifact, summary)", () => {
    expect(job.name).toBe("Default-branch workflow guard (medição deployada?)")
    expect(steps.length).toBe(4)
  })

  it("checkout simples (fetch-depth default — o guard não precisa de histórico)", () => {
    expect(steps[0]?.uses).toBe("actions/checkout@v4")
  })
})

// ── 2. Contrato de verificação (permissions/GH_TOKEN/invocação) ────────

describe("benchmark-weekly.yml — contrato de verificação do default-branch-workflow-guard", () => {
  it("permissions: contents: read (gh api repos/X/contents — existência do workflow na branch)", () => {
    expect(job.permissions).toMatchObject({
      contents: "read",
    })
  })

  it("passo de validação (id: guard) injeta GH_TOKEN do github.token e invoca o script com repo + workflow de medição + json", () => {
    const guard = steps.find((s) => s.id === "guard")
    expect(guard).toBeDefined()
    expect(guard?.env).toEqual({ GH_TOKEN: "${{ github.token }}" })
    const run = guard?.run ?? ""
    expect(run).toContain("node scripts/check-default-branch-workflows.mjs")
    expect(run).toContain('--repo "${{ github.repository }}"')
    expect(run).toContain("--workflow seed-guards.yml")
    expect(run).toContain("--json /tmp/default-branch-guard.json")
  })

  it("artifact e summary usam if: always() — a evidência existe mesmo com exit 1/2 do script", () => {
    const artifact = steps.find((s) => s.uses?.startsWith("actions/upload-artifact"))
    const summary = steps.find((s) => s.name === "Summary")
    expect(artifact?.if).toBe("always()")
    expect(artifact?.with).toMatchObject({ path: "/tmp/default-branch-guard.json" })
    expect(summary?.if).toBe("always()")
    expect(summary?.run ?? "").toContain("$GITHUB_STEP_SUMMARY")
    expect(summary?.run ?? "").toContain("BLOQUEIO REAL")
  })

  it("os 4 steps executam independentemente do resultado anterior (if: always() no artifact/summary)", () => {
    const executable = filterExecutableSteps(job)
    expect(executable.length).toBeGreaterThanOrEqual(2)
    // Sempre executa: checkout + guard (sem if = success por default)
    expect(executable[0]?.uses).toBe("actions/checkout@v4")
    expect(executable[1]?.id).toBe("guard")
  })
})

// ── 3. Fail-closed documentado no script ───────────────────────────────

describe("check-default-branch-workflows.mjs — contrato fail-closed no header", () => {
  it("o header documenta o exit 1 como GATE de workflow ausente (a causa raiz do falso 'pendente')", () => {
    const script = readFileSync(
      join(ctx.cwd, "scripts", "check-default-branch-workflows.mjs"),
      "utf8",
    )
    expect(script).toContain("1 — pelo menos um workflow AUSENTE (GATE")
    expect(script).toContain("MERGE do branch")
    const normalized = script
      .split("\n")
      .map((l) => l.replace(/^\/\/\s*/, ""))
      .join(" ")
      .replace(/\s+/g, " ")
    expect(normalized).toContain("404: workflow seed-guards.yml not found on the default branch")
  })
})

// ── 4. Refs de script contra o repo real ───────────────────────────────

describe("benchmark-weekly.yml — refs do default-branch-workflow-guard", () => {
  it("todas as refs resolvem (scripts, workflows, actions)", () => {
    expectAllRefs(content, ctx)
  })
})
