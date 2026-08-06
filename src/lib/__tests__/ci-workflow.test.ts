/**
 * ci-workflow.test.ts
 *
 * Snapshot test do workflow .github/workflows/ci.yml (CI/CD — push main/develop
 * + PR main) — o pipeline que roda lint, typecheck, utf8, quality-gate, test,
 * build e deploy.
 *
 * Foi um dos workflows SEM teste de contrato (auditoria 08/2026 — dos 21
 * workflows, os do fluxo de merge não tinham snapshot). Valida (padrão do
 * tier1-fastpath-guard-workflow.test.ts, funções puras do
 * check-workflow-refs.mjs):
 *
 *   1. Sintaxe YAML — js-yaml parse do conteúdo REAL (lança se inválido) +
 *      snapshot da estrutura parsed. Mudança estrutural (job removido, step
 *      renomeado, args alterados) exige revisão consciente do snapshot.
 *   2. Fatos-chave — triggers (push main/develop, PR main), os 7 jobs
 *      (lint, typecheck, utf8-check, quality-gate, test, build, deploy), o
 *      build com needs de TODOS os gates, o typecheck com heap 4096MB, e os
 *      dois reusables locais (utf8-check.yml, quality-gate.yml).
 *   3. Refs contra o check-workflow-refs — extractScriptRefs /
 *      extractPkgScriptRefs / extractWorkflowUses / extractActionUses no
 *      conteúdo REAL, cada ref validada contra o repo real.
 *
 * Uso:
 *   npx vitest run --config vitest.config.unit.ts src/lib/__tests__/ci-workflow.test.ts
 *
 * NOTA: snapshot de estrutura — regenerar após mudança INTENCIONAL:
 * npx vitest run ... -u. O snapshot captura a estrutura parsed (js-yaml),
 * não o texto bruto — formatação/comentários não invalidam.
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
const WF_NAME = "ci.yml"
const WF_PATH = join(CWD, ".github", "workflows", WF_NAME)

// ── Fixtures reais (lidas do repo) ──────────────────────────────────────

const content = readFileSync(WF_PATH, "utf8")
const parsed = yaml.load(content) as {
  name?: string
  on?: Record<string, unknown>
  jobs?: Record<
    string,
    {
      name?: string
      needs?: string[]
      uses?: string
      "timeout-minutes"?: number
      services?: { postgres?: { image?: string } }
      steps?: {
        name?: string
        id?: string
        run?: string
        uses?: string
        with?: object
        env?: object
      }[]
    }
  >
}

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

// ── 1. Sintaxe YAML + snapshot da estrutura ─────────────────────────────

describe("ci.yml — sintaxe YAML + snapshot", () => {
  it("parseia como YAML válido (js-yaml não lança) e casa com o snapshot", () => {
    expect(parsed).toMatchSnapshot()
  })

  it("estrutura mínima: os 7 jobs do pipeline (lint, typecheck, utf8-check, quality-gate, test, build, deploy)", () => {
    const jobs = Object.keys(parsed.jobs ?? {})
    expect(jobs).toEqual([
      "lint",
      "typecheck",
      "utf8-check",
      "quality-gate",
      "test",
      "build",
      "deploy",
    ])
  })

  it("triggers: push em main/develop + pull_request em main (deploy só em push main)", () => {
    const on = parsed.on ?? {}
    const push = (on.push ?? {}) as { branches?: string[] }
    const pr = (on.pull_request ?? {}) as { branches?: string[] }
    expect(push.branches).toEqual(["main", "develop"])
    expect(pr.branches).toEqual(["main"])
  })
})

// ── 2. Fatos-chave dos jobs ─────────────────────────────────────────────

describe("ci.yml — fatos-chave", () => {
  function jobRun(jobName: string, needle: string): string {
    // steps de run MUITAS vezes são anônimos (só `run:` sem `name:`) — busca
    // por CONTEÚDO do comando, não por nome de step.
    const steps = parsed.jobs?.[jobName]?.steps ?? []
    const s = steps.find((x) => (x.run ?? "").includes(needle))
    if (!s) throw new Error(`run contendo '${needle}' não encontrado no job ${jobName}`)
    return s.run ?? ""
  }

  it("lint: setup-bun com vars.BUN_VERSION + install + bun run lint", () => {
    const lint = parsed.jobs?.lint
    const setupBun = lint?.steps?.find((s) => s.uses === "./.github/actions/setup-bun")
    expect(setupBun).toBeDefined()
    expect(setupBun?.with).toMatchObject({ "bun-version": "${{ vars.BUN_VERSION }}" })
    expect(lint?.steps?.some((s) => s.run === "bun install --frozen-lockfile")).toBe(true)
    expect(jobRun("lint", "bun run lint")).toContain("bun run lint")
  })

  it("typecheck: tsc --noEmit com heap 4096MB (o crash de OOM documentado)", () => {
    const steps = parsed.jobs?.typecheck?.steps ?? []
    const tc = steps.find((s) => s.name?.startsWith("Type check"))
    expect(tc).toBeDefined()
    expect(tc?.run).toContain("bunx tsc --noEmit")
    expect(tc?.env).toMatchObject({ NODE_OPTIONS: "--max-old-space-size=4096" })
  })

  it("utf8-check e quality-gate usam os reusables locais (não steps inline)", () => {
    expect(parsed.jobs?.["utf8-check"]?.uses).toBe("./.github/workflows/utf8-check.yml")
    expect(parsed.jobs?.["quality-gate"]?.uses).toBe("./.github/workflows/quality-gate.yml")
  })

  it("test: postgres service + bun run test:run", () => {
    const test = parsed.jobs?.test
    expect(test?.services?.postgres?.image).toContain("postgres")
    expect(jobRun("test", "bun run test:run")).toContain("bun run test:run")
  })

  it("build: needs TODOS os gates e roda bun run build com SKIP_TYPESCRIPT_CHECK", () => {
    const build = parsed.jobs?.build
    expect(build?.needs).toEqual(["lint", "typecheck", "utf8-check", "quality-gate", "test"])
    const run = build?.steps?.find((s) => s.run?.includes("bun run build"))
    expect(run?.run).toContain("bun run build")
    expect(run?.env).toMatchObject({ SKIP_TYPESCRIPT_CHECK: "true" })
  })
})

// ── 3. Refs de script/package.json/workflows/actions contra o repo real ─

describe("ci.yml — refs contra o check-workflow-refs", () => {
  it("toda entry de package.json invocada existe (lint, db:generate, test:run)", () => {
    const refs = extractPkgScriptRefs(content)
    expect(refs.length).toBeGreaterThanOrEqual(3)
    for (const r of refs) {
      expect(
        ctx.pkgScripts.has(r.ref),
        `entry ausente em package.json: ${r.ref} (linha ${r.line})`,
      ).toBe(true)
    }
    for (const name of ["lint", "db:generate", "test:run"]) {
      expect(refs.map((r) => r.ref)).toContain(name)
    }
  })

  it("os 2 reusables locais existem E têm on: workflow_call", () => {
    const refs = extractWorkflowUses(content)
    expect(refs.map((r) => r.ref).sort()).toEqual(["quality-gate.yml", "utf8-check.yml"])
    for (const r of refs) {
      expect(ctx.workflows.has(r.ref), `workflow ausente: ${r.ref} (linha ${r.line})`).toBe(true)
      expect(
        ctx.workflowCall.has(r.ref),
        `workflow sem on: workflow_call: ${r.ref} (linha ${r.line})`,
      ).toBe(true)
    }
  })

  it("o composite action local setup-bun existe (todos os jobs usam)", () => {
    const refs = extractActionUses(content)
    expect(refs.length).toBeGreaterThan(0)
    for (const r of refs) {
      expect(ctx.actions.has(r.ref), `action ausente: ${r.ref} (linha ${r.line})`).toBe(true)
    }
    expect(ctx.actions.has("setup-bun")).toBe(true)
  })

  it("scripts invocados via npx tsx existem em scripts/ (coverage-badge.ts)", () => {
    const refs = extractScriptRefs(content)
    for (const r of refs) {
      expect(ctx.scripts.has(r.ref), `script ausente: ${r.ref} (linha ${r.line})`).toBe(true)
    }
    // npx tsx scripts/X não casa o regex de ref do guard (prefixo é tsx) —
    // a existência do alvo é validada diretamente aqui.
    expect(ctx.scripts.has("coverage-badge.ts")).toBe(true)
  })
})
