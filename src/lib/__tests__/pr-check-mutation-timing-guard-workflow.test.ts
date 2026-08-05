/**
 * pr-check-mutation-timing-guard-workflow.test.ts
 *
 * Snapshot test do job mutation-coord-timing-guard do
 * .github/workflows/pr-check.yml — o GATE de BUDGET DE PAYLOAD que roda a
 * CADA PR (antes do merge): mede o tempo real do step 'Run mutation test
 * (contrato coordenado — 5 cenários, 2 elos)' do seed-guards.yml (timing
 * NATIVO do Actions via jobs API) e FALHA o PR quando a duração excede a
 * MEDIANA do histórico por mais que o threshold configurável de drift
 * relativo (--fail-drift, var MUTATION_TIMING_DRIFT_MAX default 50%) OU
 * ultrapassa o TETO ABSOLUTO de 240s (--max — falha SEMPRE, mesmo com drift
 * pequeno) — prevenindo regressão de overhead do contrato coordenado que o
 * pr-check de CORREÇÃO não percebe.
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
 *      --max 240 --fail-drift ${{ vars.MUTATION_TIMING_DRIFT_MAX || '50' }}
 *      --window 4 (DRIFT RELATIVO vs a mediana do histórico + TETO absoluto
 *      — o GATE: exit 1 do script falha o job do PR).
 *   3. Budget TRAVADO: o passo measure usa --max 240 (teto absoluto) +
 *      --fail-drift (threshold de drift relativo, var configurável) — se
 *      alguém trocar o budget (ou remover o gate), o snapshot + esta
 *      asserção quebram no PR; a constante é a FONTE do contrato de
 *      overhead do README.
 *   4. Refs contra o check-workflow-refs — measure-mutation-timing.mjs
 *      existe, seed-guards.yml tem on: workflow_call (needs dele).
 *   5. Fail-closed: o job roda node puro (sem bun) e o artifact/summary
 *      usam if: always() — a evidência existe mesmo com exit 1 (infra,
 *      drift relativo ou teto) ou 2 (drift de contrato).
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
    expect(job?.name).toBe("Mutation coord timing (drift 50%/teto 240)")
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

  it("passo de medida (id: measure) injeta GH_TOKEN, invoca o script com run atual E aplica o GATE de DRIFT RELATIVO --max 240 --fail-drift (threshold var configurável) --window 4", () => {
    const measure = steps.find((s) => s.id === "measure")
    expect(measure).toBeDefined()
    expect(measure?.env).toEqual({ GH_TOKEN: "${{ github.token }}" })
    const run = measure?.run ?? ""
    expect(run).toContain("node scripts/measure-mutation-timing.mjs")
    expect(run).toContain('--run "${{ github.run_id }}"')
    expect(run).toContain('--repo "${{ github.repository }}"')
    // GATE: --max 240 = TETO ABSOLUTO (falha SEMPRE acima — mesmo com drift
    // pequeno) + --fail-drift compara a duração contra a MEDIANA do histórico
    // e falha quando o desvio relativo ultrapassa o threshold configurável
    // (--fail-drift "${{ vars.MUTATION_TIMING_DRIFT_MAX || '50' }}" = default
    // 50% mais lento que a mediana; a var permite ajuste por repo sem editar
    // o workflow). O histórico vem da branch DEFAULT (gh run list
    // benchmark-weekly.yml + jobs API — o MESMO mecanismo do trend guard).
    expect(run).toContain("--max 240")
    expect(run).toContain("--fail-drift \"${{ vars.MUTATION_TIMING_DRIFT_MAX || '50' }}\"")
    expect(run).toContain("--window 4")
    expect(run).toContain("--json /tmp/mutation-timing.json")
    // SEM faixa soft: a semântica do gate do PR é DRIFT RELATIVO (não
    // --warn-median/--warn — exclusivos no parseArgs).
    expect(run).not.toContain("--warn-median")
    expect(run).not.toContain('--warn "')
    expect(run).not.toContain("--publish-baseline")
    // GATE: o script SEM --warn-only no job do PR — exit 1 (drift/teto/infra)
    // ou 2 (drift de contrato) falha o job; não é modo alerta.
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

  it("summary publica o DRIFT do PR como tabela 'atual vs mediana vs threshold' (não só o JSON bruto) — reuso do shape do mutation-coord-trend", () => {
    // O PR deve mostrar o NÚMERO que falhou: quando r.driftPct é number, o
    // summary renderiza a linha 'Atual vs mediana' (duração vs mediana da
    // janela) e 'Drift relativo' com o threshold configurável — o mesmo shape
    // do summary do mutation-coord-trend do benchmark-weekly.yml. Sem isto,
    // um PR que falha por drift relativo mostraria só o JSON cru do artifact.
    const summary = steps.find((s) => s.name === "Summary")
    const run = summary?.run ?? ""
    // Guarda: o relatório real do --fail-drift expõe driftPct/driftMedianSecs/
    // driftMaxPct/driftWindow (vistos no measure-mutation-timing.test.ts).
    expect(run).toContain("typeof r.driftPct === 'number'")
    expect(run).toContain("Atual vs mediana")
    expect(run).toContain("r.durationSecs + 's vs ' + r.driftMedianSecs")
    expect(run).toContain("Drift relativo")
    expect(run).toContain("r.driftPct.toFixed(1)")
    expect(run).toContain("r.driftMaxPct")
    expect(run).toContain("r.driftWindow")
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
