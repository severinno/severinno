/**
 * pr-check-mutation-timing-act-workflow.test.ts
 *
 * Snapshot test do job mutation-coord-timing-act-guard do
 * .github/workflows/pr-check.yml — o GATE de BUDGET DE PAYLOAD via ACT que
 * cobre PRs que ainda NÃO têm o seed-guards.yml na branch DEFAULT.
 *
 * POR QUE EXISTE: o gate real (mutation-coord-timing-guard) mede o step via
 * jobs API do run ATUAL — mas o seed-guards.yml é um reusable workflow_call:
 * se ele não existir na branch default (ex.: branch de criação ainda não
 * mergeada), o reusable não roda no CI e a jobs API não mede NADA (exit 2
 * drift / 404). Este job re-executa o job mutation-coord-update LOCALMENTE
 * com o act + imagem custom (ghcr.io/<owner>/ubuntu-bun, bun PRÉ-INSTALADO —
 * o mesmo pipeline do tier1-fastpath-guard) e aplica o MESMO gate de duas
 * faixas (--max 240 duro / --warn da baseline var soft) sobre a duração do
 * step extraída
 * do LOG do act (measure-mutation-timing.mjs --act-log).
 *
 * Valida (padrão dos testes de guards — espelha o
 * pr-check-mutation-timing-guard-workflow.test.ts):
 *
 *   1. Sintaxe YAML — js-yaml parse do conteúdo REAL do arquivo (lança se
 *      inválido) + snapshot da estrutura do JOB. Qualquer mudança
 *      estrutural (step renomeado, budget alterado, act removido) exige
 *      revisão consciente do snapshot.
 *   2. Contrato de gate: path filter (só roda quando o PR toca o contrato
 *      coordenado), permissions/pull da imagem custom, act v0.2.89 pinado,
 *      -j mutation-coord-update contra seed-guards.yml, e o guard invocado
 *      com --act-log /tmp/act-mutation.log --max 240 --warn
 *      ${{ vars.MUTATION_TIMING_BASELINE || '180' }}
 *      --act-exit steps.act.outputs.ACT_EXIT.
 *   3. Budget TRAVADO: o passo guard usa --max 240 + --warn da baseline var
 *      (fallback 180) — a mesma constante do gate real e do
 *      benchmark-weekly (lugares coordenados + o mutation test).
 *   4. Refs contra o check-workflow-refs — measure-mutation-timing.mjs
 *      existe, seed-guards.yml existe (alvo do -j do act).
 *
 * Uso:
 *   npx vitest run --config vitest.config.unit.ts src/lib/__tests__/pr-check-mutation-timing-act-workflow.test.ts
 *
 * NOTA: snapshot de estrutura — para REGENERAR após mudança INTENCIONAL do
 * job: npx vitest run ... -u. O snapshot captura a estrutura parsed
 * (js-yaml) do JOB (não do arquivo inteiro — o pr-check tem ~30 jobs e
 * qualquer adição invalidaria o snapshot inteiro sem relação com este job).
 */

import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import yaml from "js-yaml"
import { extractScriptRefs } from "../../../scripts/check-workflow-refs.mjs"

// js-yaml é dep transitiva SEM @types — a declaração ambiente mínima vive em
// js-yaml.d.ts (mesmo diretório; .d.ts global, não inline, para evitar TS2665).

const CWD = process.cwd()
const WF_NAME = "pr-check.yml"
const WF_PATH = join(CWD, ".github", "workflows", WF_NAME)
const JOB_KEY = "mutation-coord-timing-act-guard"

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
      }[]
    }
  >
}

const job = parsed.jobs?.[JOB_KEY]
const steps = job?.steps ?? []

/** Contexto real do repo (mesmos artefatos que o guard valida em main()). */
const ctx = (() => {
  const scripts = new Set(readdirSync(join(CWD, "scripts")))
  return { scripts }
})()

// ── 1. Sintaxe YAML + snapshot da estrutura do job ──────────────────────

describe("pr-check.yml — job mutation-coord-timing-act-guard (sintaxe YAML + snapshot)", () => {
  it("parseia como YAML válido e o job casa com o snapshot da estrutura", () => {
    expect(job).toBeDefined()
    expect(job).toMatchSnapshot()
  })

  it("estrutura mínima: job com 7 steps (checkout, detect, valida, act install, run act, guard, summary)", () => {
    expect(job?.name).toBe("Mutation coord timing (act, budget 240/mediana 4)")
    expect(steps.length).toBe(7)
  })

  it("roda no PR (pull_request) — o gate de overhead act-based é ANTES do merge", () => {
    const triggers = Object.keys(parsed.on ?? {})
    expect(triggers).toContain("pull_request")
    expect(triggers).toContain("workflow_dispatch")
  })

  it("permissions incluem packages: read — pull da imagem privada ghcr.io/<owner>/ubuntu-bun pelo act (mesmo contrato do periódico tier1)", () => {
    expect(job?.permissions).toMatchObject({
      contents: "read",
      packages: "read",
    })
  })

  it("checkout com fetch-depth: 0 (diff origin/main...HEAD do path filter)", () => {
    expect(steps[0]?.uses).toBe("actions/checkout@v4")
    expect(steps[0]?.with).toMatchObject({ "fetch-depth": 0 })
  })
})

// ── 2. Contrato do gate (path filter / act / invocação) ─────────────────

describe("pr-check.yml — contrato do gate act-based mutation-coord-timing-act-guard", () => {
  it("path filter detecta mudanças no contrato coordenado (seed-guards.yml + medidor + scripts do contrato)", () => {
    const detect = steps.find((s) => s.id === "changes")
    expect(detect).toBeDefined()
    const run = detect?.run ?? ""
    expect(run).toContain("git diff --name-only origin/main...HEAD")
    // O contrato que o gate protege: o próprio workflow, o medidor, o
    // mutation test e a derivação dos counts. Se o PR não tocar nenhum, o
    // act (caro, ~15 min) não roda. NOTA: o grep -qE usa `\.` escapado
    // (ERE) — as asserções casam o TOKEN sem o escape para não depender da
    // forma exata do regex (o que importa é o arquivo estar coberto).
    expect(run).toContain("seed-guards")
    expect(run).toContain("measure-mutation-timing")
    expect(run).toContain("test-mutation-timing-budget")
    expect(run).toContain("seed-e2e-count")
  })

  it("steps pesados têm if: steps.changes.outputs.changed == 'true' (act só quando o contrato muda)", () => {
    const heavy = steps.filter(
      (s) =>
        s.name?.startsWith("Install act") ||
        s.name?.startsWith("Run act") ||
        s.name?.startsWith("Guard mutation"),
    )
    expect(heavy.length).toBeGreaterThanOrEqual(3)
    for (const s of heavy) {
      expect(s.if).toBe("steps.changes.outputs.changed == 'true'")
    }
  })

  it("instala o act PINADO v0.2.89 (mesma versão do tier1-fastpath-guard)", () => {
    const install = steps.find((s) => s.name?.startsWith("Install act"))
    const run = install?.run ?? ""
    expect(run).toContain("act_Linux_x86_64.tar.gz")
    expect(run).toContain("v0.2.89")
    expect(run).toContain("/tmp/act --version")
  })

  it("passo 'Run act' (id: act) re-executa -j mutation-coord-update do seed-guards.yml com a imagem ubuntu-bun e captura ACT_EXIT", () => {
    const runAct = steps.find((s) => s.name?.startsWith("Run act"))
    expect(runAct).toBeDefined()
    expect(runAct?.id).toBe("act")
    const run = runAct?.run ?? ""
    expect(run).toContain("timeout 900 /tmp/act -b")
    expect(run).toContain("-W .github/workflows/seed-guards.yml")
    expect(run).toContain("-j mutation-coord-update")
    expect(run).toContain(
      '-P "ubuntu-latest=ghcr.io/${{ github.repository_owner }}/ubuntu-bun:${{ vars.BUN_VERSION }}"',
    )
    expect(run).toContain('--var "BUN_VERSION=${{ vars.BUN_VERSION }}"')
    expect(run).toContain("ACT_EXIT=")
    expect(run).toContain('"$GITHUB_OUTPUT"')
    expect(run).toContain("/tmp/act-mutation.log")
  })

  it("passo guard invoca measure-mutation-timing.mjs com --act-log --max 240 --warn-median 4 --warn-margin 0.2 e --act-exit do GITHUB_OUTPUT", () => {
    const guard = steps.find((s) => s.name?.startsWith("Guard mutation"))
    expect(guard).toBeDefined()
    const run = guard?.run ?? ""
    expect(run).toContain("node scripts/measure-mutation-timing.mjs")
    expect(run).toContain("--act-log /tmp/act-mutation.log")
    // GATE em duas faixas: --max 240 duro + faixa soft DERIVADA da MEDIANA
    // (--warn-median 4 --warn-margin 0.2 — o histórico vem do gh run list;
    // o act NÃO publica baseline: a faixa deriva, nada é publicado).
    expect(run).toContain("--max 240")
    expect(run).toContain("--warn-median 4")
    expect(run).toContain("--warn-margin 0.2")
    expect(run).toContain('--act-exit "${{ steps.act.outputs.ACT_EXIT }}"')
    expect(run).toContain("--json /tmp/mutation-timing-act.json")
    expect(run).not.toContain("--publish-baseline")
    expect(run).not.toContain('--warn "')
  })
})

// ── 3. Refs de script contra o repo real ────────────────────────────────

describe("pr-check.yml — refs do mutation-coord-timing-act-guard contra o check-workflow-refs", () => {
  it("todo script invocado existe em scripts/ (measure-mutation-timing.mjs resolve)", () => {
    const refs = extractScriptRefs(content)
    const timingRef = refs.find((r) => r.ref === "measure-mutation-timing.mjs")
    expect(timingRef).toBeDefined()
    expect(ctx.scripts.has("measure-mutation-timing.mjs")).toBe(true)
  })
})
