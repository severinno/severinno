/**
 * pr-check-lint-guard-workflow.test.ts
 *
 * Snapshot test do job lint-guard do .github/workflows/pr-check.yml — o GATE
 * de lint/prettier do PR (Fase 3/4 do parecer: lint/prettier zero).
 *
 * Valida (padrão dos testes de guards — espelha o
 * tier1-fastpath-guard-workflow.test.ts, funções puras do
 * check-workflow-refs.mjs):
 *
 *   1. Sintaxe YAML — js-yaml parse do conteúdo REAL do arquivo (lança se
 *      inválido) + snapshot da estrutura do JOB. Qualquer mudança estrutural
 *      no job (step renomeado, args do prettier/eslint alterados, job
 *      removido) exige revisão consciente do snapshot — impede drift
 *      silencioso entre o que o CI executa e o que a Fase 3 travou.
 *   2. Fatos-chave — o job roda `npx prettier --check --ignore-unknown` com
 *      o escopo explícito (src/ scripts/ docs/ prisma/ .github/ configs) E
 *      `npx eslint . --max-warnings 0` — os DOIS gates que zeram a camada
 *      3 do parecer. O escopo do prettier é o MESMO validado localmente na
 *      Fase 3 (um `prettier --check .` puro quebraria em globs *.prisma).
 *   3. Refs contra o check-workflow-refs — extractScriptRefs /
 *      extractPkgScriptRefs / extractWorkflowUses / extractActionUses rodam
 *      no conteúdo REAL, e cada ref é validada contra o repo real
 *      (scripts/, package.json, .github/workflows/, .github/actions/). O
 *      job usa ./.github/actions/setup-bun — uma ref quebrada falha este
 *      teste ANTES do CI.
 *
 * Uso:
 *   npx vitest run --config vitest.config.unit.ts src/lib/__tests__/pr-check-lint-guard-workflow.test.ts
 *
 * NOTA: snapshot de estrutura — para REGENERAR após mudança INTENCIONAL do
 * job: npx vitest run ... -u (atualiza o .snap). O snapshot captura a
 * estrutura parsed (js-yaml) do JOB (não do arquivo inteiro — o pr-check
 * tem 27+ jobs e qualquer adição invalidaria o snapshot inteiro sem relação
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
const JOB_KEY = "lint-guard"

// ── Fixtures reais (lidas do repo) ──────────────────────────────────────

const content = readFileSync(WF_PATH, "utf8")
const parsed = yaml.load(content) as {
  name?: string
  on?: Record<string, unknown>
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
  const actions = new Set(
    existsSync(actionsDir)
      ? readdirSync(actionsDir).filter((d) => existsSync(join(actionsDir, d, "action.yml")))
      : [],
  )
  return { scripts, pkgScripts, workflows: new Set(names), workflowCall, actions }
})()

// ── 1. Sintaxe YAML + snapshot da estrutura do job ──────────────────────

describe("pr-check.yml — job lint-guard (sintaxe YAML + snapshot)", () => {
  it("parseia como YAML válido e o job casa com o snapshot da estrutura", () => {
    expect(job).toBeDefined()
    expect(job).toMatchSnapshot()
  })

  it("estrutura mínima: checkout, setup-bun, cache, install, prettier, eslint, summary", () => {
    expect(job?.name).toBe("Lint Guard (prettier + eslint zero)")
    expect(steps.length).toBeGreaterThanOrEqual(7)
  })

  it("usa o composite action local setup-bun com a versão via vars.BUN_VERSION", () => {
    const setupBun = steps.find((s) => s.uses === "./.github/actions/setup-bun")
    expect(setupBun).toBeDefined()
    expect(setupBun?.with).toMatchObject({ "bun-version": "${{ vars.BUN_VERSION }}" })
  })

  it("cobre node_modules via actions/cache com key bun-BUN_VERSION-hashFiles", () => {
    const cache = steps.find((s) => s.uses === "actions/cache@v4")
    expect(cache).toBeDefined()
    const withObj = cache?.with as { key?: string; path?: string } | undefined
    expect(withObj?.path).toBe("node_modules")
    expect(withObj?.key).toContain("bun-${{ vars.BUN_VERSION }}")
    expect(withObj?.key).toContain("hashFiles('bun.lock')")
  })
})

// ── 2. Fatos-chave do gate de lint/prettier ─────────────────────────────

describe("pr-check.yml — lint-guard (gate de lint/prettier)", () => {
  function stepRun(nameOrPrefix: string): string {
    const s = steps.find((x) => x.name?.startsWith(nameOrPrefix))
    if (!s) throw new Error(`step '${nameOrPrefix}' não encontrado no job lint-guard`)
    return s.run ?? ""
  }

  it("roda prettier --check --ignore-unknown (falha em qualquer arquivo fora do padrão)", () => {
    const run = stepRun("Check prettier formatting")
    expect(run).toContain("npx prettier --check --ignore-unknown")
    // Escopo explícito = o mesmo validado localmente na Fase 3 — um
    // `prettier --check .` puro quebraria em globs *.prisma/*.sql na raiz.
    expect(run).toContain(
      "'src/**' 'scripts/**' 'docs/**' '*.json' '*.ts' '*.mjs' '*.md' '*.yml' '.github/**' 'prisma/**'",
    )
  })

  it("roda eslint . --max-warnings 0 (falha em QUALQUER warning/erro)", () => {
    const run = stepRun("Check eslint")
    expect(run).toContain("npx eslint . --max-warnings 0")
  })

  it("instala deps antes dos checks (bun install --frozen-lockfile)", () => {
    const run = stepRun("Install deps")
    expect(run).toContain("bun install --frozen-lockfile")
  })
})

// ── 3. Refs de script/package.json/workflows/actions contra o repo real ─

describe("pr-check.yml — refs contra o check-workflow-refs", () => {
  it("todo script invocado existe em scripts/ (refs resolvem no repo real)", () => {
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
    expect(refs.length).toBeGreaterThan(0)
    for (const r of refs) {
      expect(ctx.actions.has(r.ref), `action ausente: ${r.ref} (linha ${r.line})`).toBe(true)
    }
    // O job lint-guard depende do setup-bun local — ref central do job.
    expect(ctx.actions.has("setup-bun")).toBe(true)
  })
})
