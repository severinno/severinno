/**
 * benchmark-weekly-all-text-crlf-workflow.test.ts
 *
 * Snapshot test do job PERIÓDICO blob-crlf-all-text-alert do
 * .github/workflows/benchmark-weekly.yml — o ALERTA semanal de ALCANCE do
 * CRLF no histórico (modo --all-text do audit-blob-crlf-history).
 *
 * Migração para o helper compartilhado workflow-execution.
 *
 * Uso:
 *   npx vitest run --config vitest.config.unit.ts src/lib/__tests__/benchmark-weekly-all-text-crlf-workflow.test.ts
 *
 * NOTA: snapshot de estrutura — para REGENERAR após mudança INTENCIONAL do
 * job: npx vitest run ... -u.
 */

import { describe, it, expect } from "vitest"
import { readFileSync, existsSync } from "node:fs"
import { join } from "node:path"

import {
  loadWorkflow,
  readWorkflowContent,
  getJob,
  getSteps,
  buildRepoContext,
  expectAllRefs,
  filterExecutableSteps,
} from "./helpers/workflow-execution"

const WF_NAME = "benchmark-weekly.yml"
const JOB_KEY = "blob-crlf-all-text-alert"

const wf = loadWorkflow(`.github/workflows/${WF_NAME}`)
const content = readWorkflowContent(`.github/workflows/${WF_NAME}`)
const job = getJob(wf, JOB_KEY)
const steps = getSteps(job)
const ctx = buildRepoContext()

// ── 1. Sintaxe YAML + snapshot da estrutura do job ──────────────────────

describe("benchmark-weekly.yml — job blob-crlf-all-text-alert (sintaxe YAML + snapshot)", () => {
  it("parseia como YAML válido e o job casa com o snapshot da estrutura", () => {
    expect(job).toBeDefined()
    expect(job).toMatchSnapshot()
  })

  it("estrutura mínima: job com steps", () => {
    expect(steps.length).toBeGreaterThanOrEqual(3)
  })
})

// ── 2. Condicionais — sintaxe dos `if:` do job ─────────────────────────

describe("benchmark-weekly.yml — condicionais do blob-crlf-all-text-alert", () => {
  it("o passo ALERTA dispara quando report_exit != '0' OU found_crlf == 'true'", () => {
    const alertStep = steps.find((s) => s.name?.includes("Alertar") || s.name?.includes("ALERTA"))
    expect(alertStep).toBeDefined()
    const ifExpr = alertStep?.if ?? ""
    expect(ifExpr).toContain("report_exit")
    expect(ifExpr).toContain("found_crlf")
    expect(ifExpr).toContain("||")
  })

  it("o Summary (limpo) exige report_exit == '0' E found_crlf != 'true' — complemento lógico do ALERTA", () => {
    const summary = steps.find((s) => s.name?.includes("Summary"))
    expect(summary).toBeDefined()
    const ifExpr = summary?.if ?? ""
    expect(ifExpr).toContain("report_exit")
    expect(ifExpr).toContain("found_crlf")
    expect(ifExpr).toContain("&&")
    expect(ifExpr).not.toContain("||")
  })

  it("o passo REPORT (id: alltext) usa PIPESTATUS[0] para capturar exit code da auditoria", () => {
    const report = steps.find((s) => s.id === "alltext")
    expect(report).toBeDefined()
    expect(report?.run ?? "").toContain("PIPESTATUS[0]")
    expect(report?.run ?? "").toContain("GITHUB_OUTPUT")
  })
})

// ── 3. Sentinel 'com CRLF' + gate de report_exit TRAVADOS ──────────────

describe("benchmark-weekly.yml — sentinel e gate do blob-crlf-all-text-alert", () => {
  it("o passo REPORT usa grep -Fq 'com CRLF' sobre o all-text-report.txt", () => {
    const report = steps.find((s) => s.id === "alltext")
    const run = report?.run ?? ""
    expect(run).toContain("grep -Fq 'com CRLF'")
    expect(run).toContain("all-text-report.txt")
  })

  it("o script audit_blob_crlf_history.py produz o sentinel 'com CRLF' quando há achados", () => {
    const pyPath = join(ctx.cwd, "scripts", "audit_blob_crlf_history.py")
    if (existsSync(pyPath)) {
      const py = readFileSync(pyPath, "utf8")
      expect(py).toContain("com CRLF")
      expect(py).toContain("sem CRLF")
    }
  })
})

// ── 4. Refs contra o check-workflow-refs ────────────────────────────────

describe("benchmark-weekly.yml — refs do blob-crlf-all-text-alert", () => {
  it("todas as refs resolvem (scripts, workflows, actions)", () => {
    expectAllRefs(content, ctx)
  })
})

// ── 5. Estrutura de execução ───────────────────────────────────────────

describe("benchmark-weekly.yml — execução do blob-crlf-all-text-alert", () => {
  it("o REPORT sempre executa (sem if = success por default), ALERTA e Summary são condicionais", () => {
    const executable = filterExecutableSteps(job)
    // Pelo menos REPORT + ALERTA ou Summary dependem de contexto
    expect(executable.length).toBeGreaterThanOrEqual(1)
    // REPORT não tem if, sempre executa
    const report = steps.find((s) => s.id === "alltext")
    expect(report?.if).toBeUndefined()
  })
})
