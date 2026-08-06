/**
 * pr-check-unused-deps-workflow.test.ts
 *
 * Snapshot test do job unused-deps-guard do .github/workflows/pr-check.yml —
 * o GATE de higiene de dependências (item #4 da auditoria: 5 deps órfãs
 * reais removidas do package.json: next-intl, react-markdown, @mdxeditor/editor,
 * @tanstack/react-table, zod-to-openapi — ZERO hits em código).
 *
 * Valida (padrão dos testes de guards — espelha o
 * pr-check-bun-audit-workflow.test.ts, funções puras do
 * check-workflow-refs.mjs):
 *
 *   1. Sintaxe YAML — js-yaml parse do conteúdo REAL do arquivo (lança se
 *      inválido) + snapshot da estrutura do JOB. Qualquer mudança estrutural
 *      (step renomeado, args do guard alterados, job removido) exige revisão
 *      consciente do snapshot.
 *   2. Fatos-chave — o job roda o mutation test de sensibilidade
 *      (test-mutation-unused-deps.sh, fixtures --root node-puro) ANTES do
 *      guard real, e o guard real roda `node scripts/check-unused-deps.mjs`
 *      (sem baseline — política ZERO órfãs: adicionou dep, use-a ou remova-a).
 *   3. Refs contra o check-workflow-refs — extractScriptRefs /
 *      extractPkgScriptRefs / extractWorkflowUses / extractActionUses rodam
 *      no conteúdo REAL, e cada ref é validada contra o repo real.
 *
 * Uso:
 *   npx vitest run --config vitest.config.unit.ts src/lib/__tests__/pr-check-unused-deps-workflow.test.ts
 *
 * NOTA: snapshot de estrutura — para REGENERAR após mudança INTENCIONAL do
 * job: npx vitest run ... -u. O snapshot captura a estrutura parsed (js-yaml)
 * do JOB (não do arquivo inteiro — o pr-check tem 29+ jobs).
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
const JOB_KEY = "unused-deps-guard"

// ── Fixtures reais (lidas do repo) ──────────────────────────────────────

const content = readFileSync(WF_PATH, "utf8")
const parsed = yaml.load(content) as {
  jobs?: Record<
    string,
    {
      name?: string
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
  const actions = new Set(existsSync(actionsDir) ? readdirSync(actionsDir) : [])
  return { scripts, pkgScripts, workflowCall, actions }
})()

describe(`pr-check.yml — job ${JOB_KEY}`, () => {
  it("o arquivo YAML é válido e o job existe", () => {
    expect(parsed.jobs?.[JOB_KEY]).toBeDefined()
  })

  it("snapshot da estrutura do job (mudança estrutural exige revisão consciente)", () => {
    expect(job).toMatchSnapshot()
  })

  it("roda o mutation test de sensibilidade ANTES do guard real (fail-fast)", () => {
    const runs = steps.map((s) => s.run ?? "").filter(Boolean)
    expect(runs.some((r) => r.includes("test-mutation-unused-deps.sh"))).toBe(true)
    const mutIdx = runs.findIndex((r) => r.includes("test-mutation-unused-deps.sh"))
    const guardIdx = runs.findIndex((r) => r.includes("check-unused-deps.mjs"))
    expect(mutIdx).toBeGreaterThanOrEqual(0)
    expect(guardIdx).toBeGreaterThan(mutIdx)
  })

  it("o guard real roda `node scripts/check-unused-deps.mjs` (sem --update/baseline)", () => {
    const runs = steps.map((s) => s.run ?? "")
    const guard = runs.find((r) => r.includes("check-unused-deps.mjs"))
    expect(guard).toBeDefined()
    expect(guard).not.toContain("--update")
  })

  it("usa o setup-bun local com vars.BUN_VERSION", () => {
    const setup = steps.find((s) => s.uses === "./.github/actions/setup-bun")
    expect(setup).toBeDefined()
    expect(setup?.with).toMatchObject({ "bun-version": "${{ vars.BUN_VERSION }}" })
  })

  it("refs do job existem no repo real (check-workflow-refs)", () => {
    const refs = [
      ...extractScriptRefs(content).filter((r) => r.line > 0 && r.ref),
      ...extractPkgScriptRefs(content),
      ...extractWorkflowUses(content),
      ...extractActionUses(content),
    ]
    const bad = refs.filter((r) => {
      if (r.ref.startsWith(".github/workflows/")) {
        const f = r.ref.replace(".github/workflows/", "")
        return !ctx.workflowCall.has(f) && !namesInclude(f)
      }
      if (r.ref.startsWith(".github/actions/")) {
        const a = r.ref.replace(".github/actions/", "").split("/")[0]
        return !ctx.actions.has(a)
      }
      if (r.ref.startsWith("scripts/")) {
        return !ctx.scripts.has(r.ref.replace("scripts/", ""))
      }
      if (r.ref.startsWith("bun run ") || r.ref.startsWith("bun run ")) {
        return !ctx.pkgScripts.has(r.ref.replace(/^bun run /, ""))
      }
      return false
    })
    expect(bad).toEqual([])
  })
})

/** Os nomes de workflows do diretório (para a validação de refs locais). */
function namesInclude(f: string) {
  return existsSync(join(CWD, ".github", "workflows", f))
}
