/**
 * tier1-fastpath-guard-workflow.test.ts
 *
 * Snapshot test do workflow PERIÓDICO .github/workflows/tier1-fastpath-guard.yml
 * (guard do tier-1 fast path do setup-bun via act + imagem custom).
 *
 * Valida TRÊS coisas (padrão dos testes de guards existentes — funções puras
 * do check-workflow-refs.mjs, como no check-workflow-refs.test.ts):
 *
 *   1. Sintaxe YAML — js-yaml parse do conteúdo REAL do arquivo (lança se
 *      inválido) + snapshot da estrutura parsed. Qualquer mudança estrutural
 *      no workflow (job removido, step renomeado, args do guard alterados)
 *      exige revisão consciente do snapshot — impede drift silencioso entre o
 *      que o CI executa e o que o guard espera.
 *   2. Refs contra o check-workflow-refs — extractScriptRefs /
 *      extractPkgScriptRefs / extractWorkflowUses / extractActionUses são
 *      executados no conteúdo REAL, e cada ref é validada contra o repo real
 *      (scripts/, package.json, .github/workflows/, .github/actions/). Uma
 *      referência quebrada no workflow falha este teste ANTES do CI.
 *   3. Fatos-chave — o step guard invoca scripts/check-tier1-fastpath.mjs com
 *      --threshold 5 e --act-exit (wiring do ACT_EXIT), e o job é 'guard'.
 *
 * Uso:
 *   npx vitest run --config vitest.config.unit.ts src/lib/__tests__/tier1-fastpath-guard-workflow.test.ts
 *
 * NOTA: snapshot de estrutura — para REGENERAR após mudança INTENCIONAL do
 * workflow: npx vitest run ... -u (atualiza o .snap). O snapshot captura a
 * estrutura parsed (js-yaml), não o texto bruto — formatação/comentários não
 * invalidam.
 */

import { describe, it, expect } from "vitest"
import { readFileSync, existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import yaml from "js-yaml"
import {
  extractScriptRefs,
  extractPkgScriptRefs,
  extractWorkflowUses,
  extractActionUses,
} from "../../../scripts/check-workflow-refs.mjs"

// js-yaml é dep transitiva SEM @types — a declaração ambiente mínima vive em
// js-yaml.d.ts (mesmo diretório; .d.ts global, não inline, para evitar TS2665).

const CWD = process.cwd()
const WF_NAME = "tier1-fastpath-guard.yml"
const WF_PATH = join(CWD, ".github", "workflows", WF_NAME)

// ── Fixtures reais (lidas do repo) ──────────────────────────────────────

const content = readFileSync(WF_PATH, "utf8")
const parsed = yaml.load(content) as {
  name?: string
  on?: Record<string, unknown>
  permissions?: Record<string, string>
  jobs?: Record<
    string,
    { name?: string; steps?: { name?: string; id?: string; run?: string; uses?: string }[] }
  >
}

/**
 * Contexto real do repo (mesmos artefatos que o guard valida em main(): scripts/,
 * package.json > scripts, .github/workflows/*.yml com workflow_call,
 * .github/actions/<name>/action.yml). Lido UMA vez no escopo de módulo — o
 * guard também constrói o contexto uma única vez em main().
 */
const ctx = (() => {
  const wfDir = join(CWD, ".github", "workflows")
  const names = readdirSync(wfDir).filter((f) => f.endsWith(".yml"))
  const scripts = new Set(readdirSync(join(CWD, "scripts")))
  const pkgScripts = new Set(
    Object.keys(JSON.parse(readFileSync(join(CWD, "package.json"), "utf8")).scripts ?? {}),
  )
  const workflowCall = new Set(
    names.filter((n) => readFileSync(join(wfDir, n), "utf8").includes("workflow_call")),
  )
  const actionsDir = join(CWD, ".github", "actions")
  const actions = new Set(
    existsSync(actionsDir)
      ? readdirSync(actionsDir).filter((d) => existsSync(join(actionsDir, d, "action.yml")))
      : [],
  )
  return { scripts, pkgScripts, workflows: new Set(names), workflowCall, actions }
})()

// ── 1. Sintaxe YAML + snapshot da estrutura ─────────────────────────────

describe("tier1-fastpath-guard.yml — sintaxe YAML + snapshot", () => {
  it("parseia como YAML válido (js-yaml não lança) e casa com o snapshot da estrutura", () => {
    expect(parsed).toMatchSnapshot()
  })

  it("estrutura mínima: job 'guard' com steps e sem job adicional", () => {
    const jobs = parsed.jobs
    expect(jobs).toBeDefined()
    expect(Object.keys(jobs ?? {})).toEqual(["guard"])
    expect(jobs?.guard.steps?.length).toBeGreaterThanOrEqual(6)
  })

  it("triggers: schedule semanal + workflow_dispatch (nenhum push/pr)", () => {
    const triggers = Object.keys(parsed.on ?? {})
    expect(triggers).toContain("schedule")
    expect(triggers).toContain("workflow_dispatch")
    expect(triggers).not.toContain("push")
    expect(triggers).not.toContain("pull_request")
  })

  it("permissions incluem packages: read (pull da imagem GHCR privada)", () => {
    expect(parsed.permissions?.packages).toBe("read")
  })
})

// ── 2. Refs de script/package.json/workflows/actions contra o repo real ─

describe("tier1-fastpath-guard.yml — refs contra o check-workflow-refs", () => {
  it("todo script invocado existe em scripts/ (refs resolvem no repo real)", () => {
    const refs = extractScriptRefs(content)
    expect(refs.length).toBeGreaterThan(0)
    for (const r of refs) {
      expect(ctx.scripts.has(r.ref), `script ausente: ${r.ref} (linha ${r.line})`).toBe(true)
    }
  })

  it("o guard invoca check-tier1-fastpath.mjs (a ref central existe)", () => {
    const refs = extractScriptRefs(content)
    expect(refs.map((r) => r.ref)).toContain("check-tier1-fastpath.mjs")
  })

  // NOTA: para ESTE workflow, extractPkgScriptRefs/extractWorkflowUses/
  // extractActionUses são VACUOS hoje (o arquivo não tem `bun run`,
  // `uses: ./.github/workflows/` nem `uses: ./.github/actions/` — ele roda
  // steps diretos). Os loops rodam zero iterações; mesmo assim valem como
  // guard de regressão: se um dia uma ref desses tipos entrar no arquivo
  // com artefato faltante, o teste falha antes do CI.
  it("nenhuma entry de package.json quebrada (bun run <entry>)", () => {
    const refs = extractPkgScriptRefs(content)
    for (const r of refs) {
      expect(
        ctx.pkgScripts.has(r.ref),
        `entry ausente em package.json: ${r.ref} (linha ${r.line})`,
      ).toBe(true)
    }
  })

  it("nenhum reusable workflow local quebrado (uses: ./.github/workflows/)", () => {
    const refs = extractWorkflowUses(content)
    for (const r of refs) {
      expect(ctx.workflows.has(r.ref), `workflow ausente: ${r.ref} (linha ${r.line})`).toBe(true)
      expect(
        ctx.workflowCall.has(r.ref),
        `workflow sem on: workflow_call: ${r.ref} (linha ${r.line})`,
      ).toBe(true)
    }
  })

  it("nenhum composite action local quebrado (uses: ./.github/actions/)", () => {
    const refs = extractActionUses(content)
    for (const r of refs) {
      expect(ctx.actions.has(r.ref), `action ausente: ${r.ref} (linha ${r.line})`).toBe(true)
    }
  })
})

// ── 3. Fatos-chave do guard step ────────────────────────────────────────

describe("tier1-fastpath-guard.yml — guard step (fatos-chave)", () => {
  function guardStepRun(): string {
    const steps = parsed.jobs?.guard.steps ?? []
    const step = steps.find((s) => s.name?.startsWith("Guard tier-1 fast path"))
    if (!step) throw new Error("step 'Guard tier-1 fast path' não encontrado no workflow")
    return step.run ?? ""
  }

  it("invoca check-tier1-fastpath.mjs com --threshold 5 e --version", () => {
    const run = guardStepRun()
    expect(run).toContain("check-tier1-fastpath.mjs")
    expect(run).toContain("--threshold 5")
    expect(run).toContain("--version")
  })

  it("passa --act-exit do GITHUB_OUTPUT do step 'Run act' (wiring do ACT_EXIT)", () => {
    const run = guardStepRun()
    expect(run).toContain("--act-exit")
    expect(run).toContain("steps.act.outputs.ACT_EXIT")
  })

  it("step 'Run act' tem id: act e captura ACT_EXIT no GITHUB_OUTPUT", () => {
    const steps = parsed.jobs?.guard.steps ?? []
    const runAct = steps.find((s) => s.name?.startsWith("Run act"))
    expect(runAct).toBeDefined()
    // id: act é o CONTRATO do wiring — o guard step referencia
    // steps.act.outputs.ACT_EXIT; se o id mudar, o wiring quebra mesmo com o
    // texto da ref intacto no guard step.
    expect(runAct?.id).toBe("act")
    expect(runAct?.run ?? "").toContain("ACT_EXIT=")
    expect(runAct?.run ?? "").toContain('"$GITHUB_OUTPUT"')
  })
})
