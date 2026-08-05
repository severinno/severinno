/**
 * benchmark-weekly-mutation-trend-workflow.test.ts
 *
 * Snapshot test do job PERIÓDICO mutation-coord-trend do
 * .github/workflows/benchmark-weekly.yml — o guard de TENDÊNCIA do overhead
 * do mutation-coord: compara a duração do step 'Run mutation test (contrato
 * coordenado)' do run ATUAL contra a MEDIANA dos N runs anteriores e emite
 * ::warning:: quando o drift relativo passa de X% — pegando a tendência
 * ANTES do gate duro (--max 240) disparar.
 *
 * Valida (padrão dos testes de guards — espelha o
 * benchmark-weekly-mutation-timing-workflow.test.ts):
 *
 *   1. Sintaxe YAML — js-yaml parse do conteúdo REAL do arquivo (lança se
 *      inválido) + snapshot da estrutura do JOB.
 *   2. Contrato de medição: needs: seed-guards + if: always() (mede TAMBÉM
 *      quando o seed-guards falhou), permissions actions: read (só leitura —
 *      o trend NÃO publica baseline, ao contrário do timing job que tem
 *      actions: write), GH_TOKEN: ${{ github.token }}, invocação com
 *      --run github.run_id --repo github.repository --window (var com
 *      fallback 4) --max-drift (var com fallback 30) --json.
 *   3. Contrato de alerta: o drift é NÃO-bloqueante (::warning::, exit 0 do
 *      script) — mas o step ausente é fail-closed (exit 2) e o artifact +
 *      summary usam if: always() (evidência existe mesmo com exit 1/2).
 *   4. Refs contra o check-workflow-refs — measure-mutation-trend.mjs existe
 *      em scripts/ e a invocação resolve.
 *   5. Paridade com o timing job: o trend reusa a MESMA fonte de extração
 *      (measure-mutation-timing.mjs — extractMutationStep) e o MESMO contrato
 *      de markers.
 *
 * Uso:
 *   npx vitest run --config vitest.config.unit.ts src/lib/__tests__/benchmark-weekly-mutation-trend-workflow.test.ts
 *
 * NOTA: snapshot de estrutura — para REGENERAR após mudança INTENCIONAL do
 * job: npx vitest run ... -u.
 */

import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import yaml from "js-yaml"
import { extractScriptRefs } from "../../../scripts/check-workflow-refs.mjs"
import { JOB_NAME_MARKER, STEP_NAME_MARKER } from "../../../scripts/measure-mutation-timing.mjs"

const CWD = process.cwd()
const WF_NAME = "benchmark-weekly.yml"
const WF_PATH = join(CWD, ".github", "workflows", WF_NAME)
const JOB_KEY = "mutation-coord-trend"
const SEED_GUARDS_PATH = join(CWD, ".github", "workflows", "seed-guards.yml")

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

describe("benchmark-weekly.yml — job mutation-coord-trend (sintaxe YAML + snapshot)", () => {
  it("parseia como YAML válido e o job casa com o snapshot da estrutura", () => {
    expect(job).toBeDefined()
    expect(job).toMatchSnapshot()
  })

  it("estrutura mínima: job com 4 steps (checkout, medida, artifact, summary)", () => {
    expect(job?.name).toBe("Mutation coord trend (mediana vs drift %)")
    expect(steps.length).toBe(4)
  })

  it("checkout simples (fetch-depth default — a medição usa a jobs API, não histórico local)", () => {
    expect(steps[0]?.uses).toBe("actions/checkout@v4")
  })
})

// ── 2. Contrato de medição (needs/if/permissions/GH_TOKEN/invocação) ───

describe("benchmark-weekly.yml — contrato de medição do mutation-coord-trend", () => {
  it("needs: seed-guards E if: always() — mede TAMBÉM quando o seed-guards falhou", () => {
    expect(job?.needs).toBe("seed-guards")
    expect(job?.if).toBe("always()")
  })

  it("permissions: actions: READ (só leitura — o trend NÃO publica baseline, ao contrário do timing job com write)", () => {
    expect(job?.permissions).toMatchObject({
      contents: "read",
      actions: "read",
    })
    // O timing job precisa de actions: write (gh variable set do baseline);
    // o trend só lê run list + jobs API — travar a diferença evita que
    // alguém copie o contrato do timing job sem necessidade.
    expect((job?.permissions as Record<string, string>).actions).not.toBe("write")
  })

  it("passo de medida (id: trend) injeta GH_TOKEN, invoca o script com run atual, window e max-drift de vars com fallback, salva JSON", () => {
    const trend = steps.find((s) => s.id === "trend")
    expect(trend).toBeDefined()
    expect(trend?.env).toEqual({ GH_TOKEN: "${{ github.token }}" })
    const run = trend?.run ?? ""
    expect(run).toContain("node scripts/measure-mutation-trend.mjs")
    expect(run).toContain('--run "${{ github.run_id }}"')
    expect(run).toContain('--repo "${{ github.repository }}"')
    // window e max-drift são TUNING coordenado via vars com fallback (como o
    // --warn do timing job consulta a baseline var)
    expect(run).toContain("--window \"${{ vars.MUTATION_TIMING_TREND_WINDOW || '4' }}\"")
    expect(run).toContain("--max-drift \"${{ vars.MUTATION_TIMING_TREND_MAX_DRIFT || '30' }}\"")
    expect(run).toContain("--json /tmp/mutation-trend.json")
  })

  it("artifact e summary usam if: always() — a evidência existe mesmo com exit 1/2 do script", () => {
    const artifact = steps.find((s) => s.uses?.startsWith("actions/upload-artifact"))
    const summary = steps.find((s) => s.name === "Summary")
    expect(artifact?.if).toBe("always()")
    expect(artifact?.with).toMatchObject({ path: "/tmp/mutation-trend.json" })
    expect(summary?.if).toBe("always()")
    expect(summary?.run ?? "").toContain("$GITHUB_STEP_SUMMARY")
    expect(summary?.run ?? "").toContain("Baseline (mediana")
  })
})

// ── 3. Contrato de alerta: não-bloqueante por design, fail-closed no step ─

describe("benchmark-weekly.yml — contrato de alerta do mutation-coord-trend", () => {
  it("o summary descreve o alerta como ::warning:: de tendência (não gate de falha)", () => {
    const summary = steps.find((s) => s.name === "Summary")
    const run = summary?.run ?? ""
    expect(run).toContain("ACIMA do limiar")
    expect(run).toContain("overhead subindo antes do gate duro disparar")
  })

  it("o step de medida NÃO passa --max (o gate duro vive no timing job — o trend só mede a derivada)", () => {
    const trend = steps.find((s) => s.id === "trend")
    const run = trend?.run ?? ""
    expect(run).not.toContain("--max ")
  })
})

// ── 4. MARKERS de contrato: o trend reusa a MESMA fonte do medidor ──────

describe("measure-mutation-trend.mjs — markers casam com os nomes reais do seed-guards.yml", () => {
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
})

// ── 5. Refs de script contra o repo real ────────────────────────────────

describe("benchmark-weekly.yml — refs do mutation-coord-trend contra o check-workflow-refs", () => {
  it("measure-mutation-trend.mjs existe em scripts/ e é referenciado", () => {
    const refs = extractScriptRefs(content)
    const trendRef = refs.find((r) => r.ref === "measure-mutation-trend.mjs")
    expect(trendRef).toBeDefined()
    expect(ctx.scripts.has("measure-mutation-trend.mjs")).toBe(true)
  })
})
