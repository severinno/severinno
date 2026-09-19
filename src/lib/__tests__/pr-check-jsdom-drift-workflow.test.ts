/**
 * pr-check-jsdom-drift-workflow.test.ts
 *
 * Snapshot test do job jsdom-drift-guard do .github/workflows/pr-check.yml —
 * o GATE de drift da suíte jsdom de componentes (P0 qualidade da auditoria:
 * a suíte NÃO roda no test:unit do CI — este job a roda com baseline que
 * não pode crescer).
 *
 * Valida (padrão dos testes de guards — espelha o
 * pr-check-lint-guard-workflow.test.ts, funções puras do
 * check-workflow-refs.mjs):
 *
 *   1. Sintaxe YAML — js-yaml parse do conteúdo REAL do arquivo (lança se
 *      inválido) + snapshot da estrutura do JOB. Qualquer mudança estrutural
 *      (step renomeado, args do guard alterados, job removido) exige revisão
 *      consciente do snapshot — impede drift silencioso entre o que o CI
 *      executa e o que o guard espera.
 *   2. Fatos-chave — o job roda o mutation test de sensibilidade
 *      (test-mutation-jsdom-baseline.sh, fixtures --results-file node-puro)
 *      ANTES do guard real, e o guard real roda
 *      `node scripts/check-jsdom-baseline.mjs` SEM --update (o --update é
 *      uso LOCAL — nunca no PR: re-baseline automático esconderia drift).
 *   3. Refs contra o check-workflow-refs — extractScriptRefs /
 *      extractPkgScriptRefs / extractWorkflowUses / extractActionUses rodam
 *      no conteúdo REAL, e cada ref é validada contra o repo real
 *      (scripts/, package.json, .github/workflows/, .github/actions/).
 *
 * Uso:
 *   npx vitest run --config vitest.config.unit.ts src/lib/__tests__/pr-check-jsdom-drift-workflow.test.ts
 *
 * NOTA: snapshot de estrutura — para REGENERAR após mudança INTENCIONAL do
 * job: npx vitest run ... -u (atualiza o .snap). O snapshot captura a
 * estrutura parsed (js-yaml) do JOB (não do arquivo inteiro — o pr-check
 * tem 28+ jobs e qualquer adição invalidaria o snapshot inteiro sem relação
 * com este job).
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
const WF_NAME = "pr-check.yml"
const WF_PATH = join(CWD, ".github", "workflows", WF_NAME)
const JOB_KEY = "jsdom-drift-guard"

// ── Fixtures reais (lidas do repo) ──────────────────────────────────────

const content = readFileSync(WF_PATH, "utf8")
const parsed = yaml.load(content) as {
  jobs?: Record<
    string,
    {
      name?: string
      "timeout-minutes"?: number
      steps?: { name?: string; id?: string; run?: string; uses?: string; with?: object }[]
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

// ── 1. Sintaxe YAML + snapshot da estrutura do job ──────────────────────

describe("pr-check.yml — job jsdom-drift-guard (sintaxe YAML + snapshot)", () => {
  it("parseia como YAML válido e o job casa com o snapshot da estrutura", () => {
    expect(job).toBeDefined()
    expect(job).toMatchSnapshot()
  })

  it("estrutura mínima: checkout, setup-bun, cache, install, mutation, guard, summary", () => {
    expect(job?.name).toBe("JSDOM component suite — drift baseline")
    expect(steps.length).toBeGreaterThanOrEqual(7)
  })

  it("tem timeout-minutes definido (o run real da suíte é lento)", () => {
    expect(job?.["timeout-minutes"]).toBeGreaterThanOrEqual(15)
  })

  it("usa o composite action local setup-bun com a versão via vars.BUN_VERSION", () => {
    // `run:` (scripts/setup-bun-ci.sh) — não passa pelo resolvedor de actions.
    const setupBun = steps.find((s) => (s.run ?? "").includes("scripts/setup-bun-ci.sh"))
    expect(setupBun, "setup do Bun por run:").toBeDefined()
    expect(setupBun?.run).toContain('bash scripts/setup-bun-ci.sh "${{ vars.BUN_VERSION }}"')
  })

  it("cobre node_modules via actions/cache com key bun-BUN_VERSION-hashFiles", () => {
    // Dois blocos actions/cache no job desde a migração do setup (o do Bun em
    // ~/.bun e o de node_modules) — seleciona por PATH.
    const cache = steps.find(
      (s) =>
        s.uses === "actions/cache@v4" && (s.with as { path?: string })?.path === "node_modules",
    )
    expect(cache).toBeDefined()
    const withObj = cache?.with as { key?: string; path?: string } | undefined
    expect(withObj?.path).toBe("node_modules")
    expect(withObj?.key).toContain("bun-${{ vars.BUN_VERSION }}")
    expect(withObj?.key).toContain("hashFiles('bun.lock')")
  })
})

// ── 2. Fatos-chave do gate de drift jsdom ───────────────────────────────

describe("pr-check.yml — jsdom-drift-guard (gate de drift)", () => {
  function stepRun(nameOrPrefix: string): string {
    const s = steps.find((x) => x.name?.startsWith(nameOrPrefix))
    if (!s) throw new Error(`step '${nameOrPrefix}' não encontrado no job jsdom-drift-guard`)
    return s.run ?? ""
  }

  it("roda o mutation test de sensibilidade (fixtures --results-file, node-puro)", () => {
    const run = stepRun("Mutation test")
    expect(run).toContain("bash scripts/test-mutation-jsdom-baseline.sh")
  })

  it("roda o guard real SEM --update (re-baseline é uso LOCAL, nunca PR)", () => {
    const run = stepRun("Check jsdom failure drift")
    expect(run).toContain("node scripts/check-jsdom-baseline.mjs")
    expect(run).not.toContain("--update")
  })

  it("instala deps antes dos checks (bun install --frozen-lockfile)", () => {
    const run = stepRun("Install deps")
    expect(run).toContain("bun install --frozen-lockfile")
  })
})

// ── 3. Refs de script/package.json/workflows/actions contra o repo real ─

describe("pr-check.yml — refs contra o check-workflow-refs", () => {
  it("os 2 scripts do job existem em scripts/ (guard + mutation test)", () => {
    expect(ctx.scripts.has("check-jsdom-baseline.mjs")).toBe(true)
    expect(ctx.scripts.has("test-mutation-jsdom-baseline.sh")).toBe(true)
  })

  it("todo script invocado em QUALQUER run: existe em scripts/ (refs resolvem)", () => {
    const refs = extractScriptRefs(content)
    expect(refs.length).toBeGreaterThan(0)
    for (const r of refs) {
      expect(ctx.scripts.has(r.ref), `script ausente: ${r.ref} (linha ${r.line})`).toBe(true)
    }
  })

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

  it("nenhum composite action local quebrado (uses: ./.github/actions/ — setup-bun existe)", () => {
    const refs = extractActionUses(content)
    expect(refs, "nenhuma ref de action local deve restar").toEqual([])
    // O setup do Bun é o script do repo (chamado por `run:`), não um action.
    expect(content).toContain("bash scripts/setup-bun-ci.sh")
  })
})
