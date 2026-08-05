/**
 * pr-check-mutation-timing-guard-workflow.test.ts
 *
 * Snapshot test do job mutation-coord-timing-guard do
 * .github/workflows/pr-check.yml — o GATE de BUDGET DE PAYLOAD que roda a
 * CADA PR (antes do merge): mede o tempo real do step 'Run mutation test
 * (contrato coordenado — 5 cenários, 2 elos)' do seed-guards.yml (timing
 * NATIVO do Actions via jobs API) e FALHA o PR se o step ultrapassar o
 * budget DURO de 240s (faixa soft baseline-orientada — fallback 180s até o
 * primeiro publish do semanal — alerta com ::warning:: sem falhar) —
 * prevenindo regressão de overhead do contrato coordenado que o pr-check de
 * CORREÇÃO não percebe.
 *
 * Valida (padrão dos testes de guards — espelha o
 * benchmark-weekly-mutation-timing-workflow.test.ts):
 *
 *   1. Sintaxe YAML — js-yaml parse do conteúdo REAL do arquivo (lança se
 *      inválido) + snapshot da estrutura do JOB. Qualquer mudança
 *      estrutural (step renomeado, budget alterado, GH_TOKEN removido)
 *      exige revisão consciente do snapshot.
 *   2. Contrato de gate: needs: seed-guards + if: always() (mede TAMBÉM
 *      quando o seed-guards falhou — timeout é o alvo do budget),
 *      permissions actions: read (jobs API), GH_TOKEN: ${{ github.token }},
 *      e o script é invocado com --run github.run_id --repo github.repository
 *      --max 240 --warn ${{ vars.MUTATION_TIMING_BASELINE || '180' }}
 *      (DUAS FAIXAS — o GATE: exit 1 do script na faixa dura falha o job do
 *      PR; a faixa soft emite ::warning:: sem falhar).
 *   3. Budget TRAVADO: o passo measure usa --max 240 + --warn da baseline
 *      var (fallback 180) — se alguém trocar o budget (ou remover o gate),
 *      o snapshot + esta asserção quebram no PR; a constante é a FONTE do
 *      contrato de overhead do README.
 *   4. Refs contra o check-workflow-refs — measure-mutation-timing.mjs
 *      existe, seed-guards.yml tem on: workflow_call (needs dele).
 *   5. Fail-closed: o job roda node puro (sem bun) e o artifact/summary
 *      usam if: always() — a evidência existe mesmo com exit 1 (infra ou
 *      budget) ou 2 (drift).
 *
 * Uso:
 *   npx vitest run --config vitest.config.unit.ts src/lib/__tests__/pr-check-mutation-timing-guard-workflow.test.ts
 *
 * NOTA: snapshot de estrutura — para REGENERAR após mudança INTENCIONAL do
 * job: npx vitest run ... -u. O snapshot captura a estrutura parsed
 * (js-yaml) do JOB (não do arquivo inteiro — o pr-check tem ~25 jobs e
 * qualquer adição invalidaria o snapshot inteiro sem relação com este job).
 */

import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import yaml from "js-yaml"
import { extractScriptRefs, extractWorkflowUses } from "../../../scripts/check-workflow-refs.mjs"

// js-yaml é dep transitiva SEM @types — a declaração ambiente mínima vive em
// js-yaml.d.ts (mesmo diretório; .d.ts global, não inline, para evitar TS2665).

const CWD = process.cwd()
const WF_NAME = "pr-check.yml"
const WF_PATH = join(CWD, ".github", "workflows", WF_NAME)
const JOB_KEY = "mutation-coord-timing-guard"

// ── Fixtures reais (lidas do repo) ──────────────────────────────────────

const content = readFileSync(WF_PATH, "utf8")
const parsed = yaml.load(content) as {
  name?: string
  on?: Record<string, unknown>
  jobs?: Record<
    string,
    {
      name?: string
      needs?: string | string[]
      if?: string
      permissions?: Record<string, string>
      steps?: {
        name?: string
        id?: string
        if?: string
        run?: string
        uses?: string
        with?: Record<string, unknown>
        env?: Record<string, string>
      }[]
    }
  >
}

const job = parsed.jobs?.[JOB_KEY]
const steps = job?.steps ?? []

/** Contexto real do repo (mesmos artefatos que o guard valida em main()). */
const ctx = (() => {
  const wfDir = join(CWD, ".github", "workflows")
  const names = readdirSync(wfDir).filter((f) => f.endsWith(".yml"))
  const scripts = new Set(readdirSync(join(CWD, "scripts")))
  const workflowCall = new Set(
    names.filter((n) => readFileSync(join(wfDir, n), "utf8").includes("workflow_call")),
  )
  return { scripts, workflows: new Set(names), workflowCall }
})()

// ── 1. Sintaxe YAML + snapshot da estrutura do job ──────────────────────

describe("pr-check.yml — job mutation-coord-timing-guard (sintaxe YAML + snapshot)", () => {
  it("parseia como YAML válido e o job casa com o snapshot da estrutura", () => {
    expect(job).toBeDefined()
    expect(job).toMatchSnapshot()
  })

  it("estrutura mínima: job com 4 steps (checkout, medida, artifact, summary)", () => {
    expect(job?.name).toBe("Mutation coord timing (budget 240/baseline)")
    expect(steps.length).toBe(4)
  })

  it("roda no PR (pull_request) — o gate de overhead é ANTES do merge", () => {
    const triggers = Object.keys(parsed.on ?? {})
    expect(triggers).toContain("pull_request")
    expect(triggers).toContain("workflow_dispatch")
  })

  it("checkout simples (fetch-depth default — a medição não precisa de histórico)", () => {
    expect(steps[0]?.uses).toBe("actions/checkout@v4")
  })
})

// ── 2. Contrato do gate (needs/if/permissions/GH_TOKEN/invocação) ───────

describe("pr-check.yml — contrato do gate mutation-coord-timing-guard", () => {
  it("needs: seed-guards E if: always() — mede TAMBÉM quando o seed-guards falhou (timeout é o alvo)", () => {
    expect(job?.needs).toBe("seed-guards")
    expect(job?.if).toBe("always()")
  })

  it("permissions: actions: read (jobs API) + contents: read", () => {
    expect(job?.permissions).toMatchObject({
      contents: "read",
      actions: "read",
    })
  })

  it("passo de medida (id: measure) injeta GH_TOKEN, invoca o script com run atual E aplica o GATE em DUAS FAIXAS --max 240 --warn da baseline var", () => {
    const measure = steps.find((s) => s.id === "measure")
    expect(measure).toBeDefined()
    expect(measure?.env).toEqual({ GH_TOKEN: "${{ github.token }}" })
    const run = measure?.run ?? ""
    expect(run).toContain("node scripts/measure-mutation-timing.mjs")
    expect(run).toContain('--run "${{ github.run_id }}"')
    expect(run).toContain('--repo "${{ github.repository }}"')
    // GATE em duas faixas: --max 240 (duro — exit 1 falha o PR) + --warn
    // consulta a variable MUTATION_TIMING_BASELINE (publicada pelo semanal
    // quando o budget passa) com fallback 180 — o soft band tolera variação
    // de runner re-anchorando no tempo real medido.
    expect(run).toContain("--max 240")
    expect(run).toContain("--warn \"${{ vars.MUTATION_TIMING_BASELINE || '180' }}\"")
    expect(run).toContain("--json /tmp/mutation-timing.json")
    // PR NÃO publica baseline (só o job semanal publica — PR não muta repo
    // state); o script roda sem --publish-baseline.
    expect(run).not.toContain("--publish-baseline")
    // GATE: o script SEM --warn-only no job do PR — exit 1 (budget/infra) ou
    // 2 (drift) falha o job; não é modo alerta (isso é para dispatch manual).
    expect(run).not.toContain("--warn-only")
  })

  it("artifact e summary usam if: always() — a evidência existe mesmo com exit 1/2 do script", () => {
    const artifact = steps.find((s) => s.uses?.startsWith("actions/upload-artifact"))
    const summary = steps.find((s) => s.name === "Summary")
    expect(artifact?.if).toBe("always()")
    expect(artifact?.with).toMatchObject({ path: "/tmp/mutation-timing.json" })
    expect(summary?.if).toBe("always()")
    expect(summary?.run ?? "").toContain("$GITHUB_STEP_SUMMARY")
    expect(summary?.run ?? "").toContain("EXCEDIDO")
  })
})

// ── 3. Refs de script/workflow contra o repo real ───────────────────────

describe("pr-check.yml — refs do mutation-coord-timing-guard contra o check-workflow-refs", () => {
  it("todo script invocado existe em scripts/ (measure-mutation-timing.mjs resolve)", () => {
    const refs = extractScriptRefs(content)
    const timingRef = refs.find((r) => r.ref === "measure-mutation-timing.mjs")
    expect(timingRef).toBeDefined()
    expect(ctx.scripts.has("measure-mutation-timing.mjs")).toBe(true)
  })

  it("nenhum reusable workflow local quebrado (seed-guards.yml existe e tem workflow_call)", () => {
    const refs = extractWorkflowUses(content)
    const seedRef = refs.find((r) => r.ref === "seed-guards.yml")
    expect(seedRef).toBeDefined()
    expect(ctx.workflows.has("seed-guards.yml")).toBe(true)
    expect(ctx.workflowCall.has("seed-guards.yml")).toBe(true)
  })
})
