/**
 * benchmark-weekly-mutation-timing-workflow.test.ts
 *
 * Snapshot test do job PERIÓDICO mutation-coord-timing do
 * .github/workflows/benchmark-weekly.yml — a RE-MEDIÇÃO semanal do tempo
 * real do step 'Run mutation test (contrato coordenado — 5 cenários, 2
 * elos)' do seed-guards.yml (fecha a linha '~35-45s (est.)¹ pendente de
 * medição real' da tabela de overhead do README sem depender de auth
 * local — o gh do runner usa o GITHUB_TOKEN do próprio Actions).
 *
 * Valida (padrão dos testes de guards — espelha o
 * benchmark-weekly-all-text-crlf-workflow.test.ts):
 *
 *   1. Sintaxe YAML — js-yaml parse do conteúdo REAL do arquivo (lança se
 *      inválido) + snapshot da estrutura do JOB. Qualquer mudança
 *      estrutural (step renomeado, condicional alterado, GH_TOKEN
 *      removido) exige revisão consciente do snapshot.
 *   2. Contrato de medição: needs: seed-guards + if: always() (mede
 *      TAMBÉM quando o seed-guards falhou — timeout é o alvo), permissions
 *      actions: read (jobs API), GH_TOKEN: ${{ github.token }}, e o script
 *      é invocado com --run github.run_id --repo github.repository.
 *   3. MARKERS de contrato TRAVADOS: os JOB_NAME_MARKER/STEP_NAME_MARKER
 *      exportados pelo scripts/measure-mutation-timing.mjs precisam casar
 *      com os nomes REAIS do job/step no seed-guards.yml — se alguém
 *      renomear o step no workflow, o medidor fica cego (exit 2 no
 *      semanal) E este teste quebra aqui, no PR.
 *   4. Refs contra o check-workflow-refs — extractScriptRefs /
 *      extractWorkflowUses rodam no conteúdo REAL, e cada ref é validada
 *      contra o repo real (measure-mutation-timing.mjs existe,
 *      seed-guards.yml tem on: workflow_call).
 *   5. Fail-closed: o job roda node puro (sem bun) e o summary/artifact
 *      usam if: always() — a evidência existe mesmo quando o script sai
 *      com exit 1 (infra) ou 2 (drift).
 *
 * Uso:
 *   npx vitest run --config vitest.config.unit.ts src/lib/__tests__/benchmark-weekly-mutation-timing-workflow.test.ts
 *
 * NOTA: snapshot de estrutura — para REGENERAR após mudança INTENCIONAL do
 * job: npx vitest run ... -u. O snapshot captura a estrutura parsed
 * (js-yaml) do JOB (não do arquivo inteiro — o benchmark-weekly tem 10
 * jobs e qualquer adição invalidaria o snapshot inteiro sem relação com
 * este job).
 */

import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import yaml from "js-yaml"
import { extractScriptRefs, extractWorkflowUses } from "../../../scripts/check-workflow-refs.mjs"
import { JOB_NAME_MARKER, STEP_NAME_MARKER } from "../../../scripts/measure-mutation-timing.mjs"

// js-yaml é dep transitiva SEM @types — a declaração ambiente mínima vive em
// js-yaml.d.ts (mesmo diretório; .d.ts global, não inline, para evitar TS2665).

const CWD = process.cwd()
const WF_NAME = "benchmark-weekly.yml"
const WF_PATH = join(CWD, ".github", "workflows", WF_NAME)
const JOB_KEY = "mutation-coord-timing"
const SEED_GUARDS_PATH = join(CWD, ".github", "workflows", "seed-guards.yml")

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
const seedGuardsContent = readFileSync(SEED_GUARDS_PATH, "utf8")

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

describe("benchmark-weekly.yml — job mutation-coord-timing (sintaxe YAML + snapshot)", () => {
  it("parseia como YAML válido e o job casa com o snapshot da estrutura", () => {
    expect(job).toBeDefined()
    expect(job).toMatchSnapshot()
  })

  it("estrutura mínima: job com 4 steps (checkout, medida, artifact, summary)", () => {
    expect(job?.name).toBe("Mutation coord timing (re-medição semanal)")
    expect(steps.length).toBe(4)
  })

  it("triggers: schedule semanal + workflow_dispatch (nenhum push/pr)", () => {
    const triggers = Object.keys(parsed.on ?? {})
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
    expect(job?.needs).toBe("seed-guards")
    expect(job?.if).toBe("always()")
  })

  it("permissions: actions: READ (jobs API + gh run list da derivação — NÃO publica variable) + contents: read", () => {
    expect(job?.permissions).toMatchObject({
      contents: "read",
      actions: "read",
    })
    // A faixa soft DERIVA da mediana dos últimos runs (gh run list) — não
    // publica baseline, então não precisa de actions: write.
    expect(job?.permissions).not.toMatchObject({ actions: "write" })
  })

  it("passo de medida (id: measure) injeta GH_TOKEN, invoca o script com run atual E DERIVA a faixa soft da MEDIANA (--max 240 --warn-median 4 --warn-margin 0.2 — sem publish)", () => {
    const measure = steps.find((s) => s.id === "measure")
    expect(measure).toBeDefined()
    expect(measure?.env).toEqual({ GH_TOKEN: "${{ github.token }}" })
    const run = measure?.run ?? ""
    expect(run).toContain("node scripts/measure-mutation-timing.mjs")
    expect(run).toContain('--run "${{ github.run_id }}"')
    expect(run).toContain('--repo "${{ github.repository }}"')
    // DUAS FAIXAS: --max 240 (duro, falha) + faixa soft DERIVADA da MEDIANA
    // dos últimos 4 runs medidos do MESMO step (--warn-median 4
    // --warn-margin 0.2 — o warn se AUTO-AJUSTA ao runner real, sem
    // variable publicada; o primeiro run mede o baseline com ::notice::).
    expect(run).toContain("--max 240")
    expect(run).toContain("--warn-median 4")
    expect(run).toContain("--warn-margin 0.2")
    expect(run).toContain("--json /tmp/mutation-timing.json")
    // SEM publish: o semanal não publica mais baseline (a derivação pela
    // mediana substituiu a variable auto-atualizada).
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
})

// ── 3. MARKERS de contrato: script ↔ nomes REAIS do seed-guards.yml ────

describe("measure-mutation-timing.mjs — markers casam com os nomes reais do seed-guards.yml", () => {
  it("JOB_NAME_MARKER ('contrato coordenado') aparece no nome REAL do job do seed-guards", () => {
    // CUIDADO: o seed-guards.yml tem DOIS jobs com 'name: Mutation Test'
    // (mutation-seed-dev-e2e vem ANTES no arquivo e não contém o marker).
    // Busca o job de coordenação pelo sufixo EXATO do nome real.
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
    // Também com sufixo EXATO: 'Run mutation test (seed dev E2E deve FALHAR)'
    // existe no mesmo arquivo e não é o alvo.
    const block = seedGuardsContent.split("name: Run mutation test (contrato coordenado")
    expect(block.length).toBeGreaterThan(1)
    expect(block[1]).toContain("id: mutation")
  })
})

// ── 4. Refs de script/workflow contra o repo real ───────────────────────

describe("benchmark-weekly.yml — refs do mutation-coord-timing contra o check-workflow-refs", () => {
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
