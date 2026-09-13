/**
 * quality-gate-workflow.test.ts
 *
 * Snapshot test do reusable workflow .github/workflows/quality-gate.yml
 * (on: workflow_call — chamado por ci.yml/deploy/release-deploy) — consolida
 * os validadores de qualidade: barrel-lint, security-audit, coverage-gaps,
 * cache-manifest e coverage-badge.
 *
 * Foi um dos workflows SEM teste de contrato (auditoria 08/2026). Valida
 * (padrão do tier1-fastpath-guard-workflow.test.ts, funções puras do
 * check-workflow-refs.mjs):
 *
 *   1. Sintaxe YAML — js-yaml parse do conteúdo REAL (lança se inválido) +
 *      snapshot da estrutura parsed. Mudança estrutural exige revisão
 *      consciente do snapshot.
 *   2. Fatos-chave — `on: workflow_call` (reusable, SEM push/pr/schedule),
 *      os 5 jobs validadores com setup-bun + install + o validador, e os
 *      artefatos que cada um invoca (barrel-lint.mjs, security:audit,
 *      coverage-gaps.ts --ci, validate-cache-manifest.ts,
 *      coverage-badge.ts --save).
 *   3. Refs contra o check-workflow-refs — extractScriptRefs /
 *      extractPkgScriptRefs / extractActionUses no conteúdo REAL, cada ref
 *      validada contra o repo real. (extractWorkflowUses é VACUO — o
 *      quality-gate não chama outros reusables; o loop vale como guard de
 *      regressão.)
 *
 * Uso:
 *   npx vitest run --config vitest.config.unit.ts src/lib/__tests__/quality-gate-workflow.test.ts
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
const WF_NAME = "quality-gate.yml"
const WF_PATH = join(CWD, ".github", "workflows", WF_NAME)

// ── Fixtures reais (lidas do repo) ──────────────────────────────────────

const content = readFileSync(WF_PATH, "utf8")
const parsed = yaml.load(content) as {
  name?: string
  on?: Record<string, unknown>
  permissions?: Record<string, string>
  jobs?: Record<
    string,
    {
      name?: string
      steps?: { name?: string; id?: string; run?: string; uses?: string; with?: object }[]
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

describe("quality-gate.yml — sintaxe YAML + snapshot", () => {
  it("parseia como YAML válido (js-yaml não lança) e casa com o snapshot", () => {
    expect(parsed).toMatchSnapshot()
  })

  it("estrutura mínima: os 5 jobs validadores", () => {
    const jobs = Object.keys(parsed.jobs ?? {})
    expect(jobs).toEqual([
      "barrel-lint",
      "security-audit",
      "coverage-gaps",
      "cache-manifest",
      "coverage-badge",
    ])
  })

  it("é reusable: SOMENTE on: workflow_call (sem push/pr/schedule)", () => {
    const triggers = Object.keys(parsed.on ?? {})
    expect(triggers).toEqual(["workflow_call"])
  })
})

// ── 2. Fatos-chave dos jobs validadores ─────────────────────────────────

describe("quality-gate.yml — fatos-chave", () => {
  function jobRun(jobName: string, needle: string): string {
    // o primeiro `run:` de cada job é o `bun install --frozen-lockfile` — a
    // busca é por CONTEÚDO (needle) para pegar o step do VALIDADOR.
    const steps = parsed.jobs?.[jobName]?.steps ?? []
    const s = steps.find((x) => (x.run ?? "").includes(needle))
    if (!s) throw new Error(`run contendo '${needle}' não encontrado no job ${jobName}`)
    return s.run ?? ""
  }

  it("todo job segue o padrão checkout → setup do Bun (run:) → install", () => {
    for (const [name, job] of Object.entries(parsed.jobs ?? {})) {
      const uses = (job.steps ?? []).map((s) => s.uses).filter(Boolean)
      expect(uses[0], `${name}: primeiro use deve ser checkout`).toBe("actions/checkout@v4")
      // O setup do Bun é um `run:` (scripts/setup-bun-ci.sh), não um composite
      // local — `run:` não passa pelo resolvedor de actions do runner.
      const runs = (job.steps ?? []).map((s) => s.run ?? "")
      expect(
        runs.some((r) => r.includes("scripts/setup-bun-ci.sh")),
        `${name}: deve rodar o setup do Bun por run: (scripts/setup-bun-ci.sh)`,
      ).toBe(true)
      const install = (job.steps ?? []).find((s) => s.run === "bun install --frozen-lockfile")
      expect(install, `${name}: deve rodar bun install --frozen-lockfile`).toBeDefined()
    }
  })

  it("barrel-lint roda node scripts/barrel-lint.mjs", () => {
    expect(jobRun("barrel-lint", "node scripts/barrel-lint.mjs")).toContain(
      "node scripts/barrel-lint.mjs",
    )
  })

  it("o step do barrel-lint é FAIL-CLOSED: um comando, cujo código de saída É o veredito", () => {
    // O contrato morava aqui como AVISO: o `|| exit_code=$?` capturava o status
    // e o ramo `-eq 3` o transformava em "non-blocking (fix in progress)" — um
    // gate que NUNCA falhava. Capturar o status de novo (por qualquer motivo)
    // reintroduz o problema, então o teste exige o comando PURO.
    const run = jobRun("barrel-lint", "node scripts/barrel-lint.mjs")
    expect(run.trim()).toBe("node scripts/barrel-lint.mjs")
    expect(run).not.toContain("exit_code")
    expect(run).not.toMatch(/-eq\s+\d/)
    expect(run).not.toContain("non-blocking")
  })

  it("security-audit roda bun run security:audit", () => {
    expect(jobRun("security-audit", "bun run security:audit")).toContain("bun run security:audit")
  })

  it("coverage-gaps roda coverage-gaps.ts --ci", () => {
    expect(jobRun("coverage-gaps", "npx tsx scripts/coverage-gaps.ts --ci")).toContain(
      "npx tsx scripts/coverage-gaps.ts --ci",
    )
  })

  it("cache-manifest roda validate-cache-manifest.ts", () => {
    expect(jobRun("cache-manifest", "npx tsx scripts/validate-cache-manifest.ts")).toContain(
      "npx tsx scripts/validate-cache-manifest.ts",
    )
  })

  it("coverage-badge roda coverage-badge.ts --save", () => {
    expect(jobRun("coverage-badge", "npx tsx scripts/coverage-badge.ts --save")).toContain(
      "npx tsx scripts/coverage-badge.ts --save",
    )
  })
})

// ── 3. Refs de script/package.json/actions contra o repo real ───────────

describe("quality-gate.yml — refs contra o check-workflow-refs", () => {
  it("os 4 validadores tsx/mjs existem em scripts/ (npx tsx não casa o regex do guard — assert direto)", () => {
    for (const name of [
      "barrel-lint.mjs",
      "coverage-gaps.ts",
      "validate-cache-manifest.ts",
      "coverage-badge.ts",
    ]) {
      expect(ctx.scripts.has(name), `script ausente: ${name}`).toBe(true)
    }
  })

  it("toda ref de script do guard resolve em scripts/", () => {
    const refs = extractScriptRefs(content)
    expect(refs.length).toBeGreaterThan(0)
    for (const r of refs) {
      expect(ctx.scripts.has(r.ref), `script ausente: ${r.ref} (linha ${r.line})`).toBe(true)
    }
  })

  it("a entry security:audit existe em package.json (bun run security:audit)", () => {
    const refs = extractPkgScriptRefs(content)
    expect(refs.map((r) => r.ref)).toContain("security:audit")
    for (const r of refs) {
      expect(
        ctx.pkgScripts.has(r.ref),
        `entry ausente em package.json: ${r.ref} (linha ${r.line})`,
      ).toBe(true)
    }
  })

  it("não usa action local (./) e o setup do Bun é o script do repo", () => {
    const refs = extractActionUses(content)
    expect(refs, "nenhuma ref de action local deve restar").toEqual([])
    expect(content).toContain("bash scripts/setup-bun-ci.sh")
  })

  // NOTA: extractWorkflowUses é VACUO neste workflow (não chama outros
  // reusables locais). O loop roda zero iterações; vale como guard de
  // regressão: se um dia uma ref desses tipos entrar com artefato faltante,
  // o teste falha antes do CI.
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
})
