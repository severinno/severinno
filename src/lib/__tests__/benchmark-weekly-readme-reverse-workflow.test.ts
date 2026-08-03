/**
 * benchmark-weekly-readme-reverse-workflow.test.ts
 *
 * Snapshot test do job PERIÓDICO readme-reverse-audit do
 * .github/workflows/benchmark-weekly.yml — o guard semanal de drift
 * SEMÂNTICO de links do README (modo --reverse do check-readme-anchors:
 * links que RESOLVEM mas apontam para o heading semanticamente errado — o
 * forward não vê; falha SOMENTE em achados NOVOS além do baseline commitado
 * docs/security/readme-reverse-baseline.json, por assinatura file+slug+label).
 *
 * Valida (padrão dos testes de guards — espelha o
 * benchmark-weekly-all-text-crlf-workflow.test.ts, funções puras do
 * check-workflow-refs.mjs):
 *
 *   1. Sintaxe YAML — js-yaml parse do conteúdo REAL do arquivo (lança se
 *      inválido) + snapshot da estrutura do JOB. Qualquer mudança estrutural
 *      no job (step renomeado, gate trocado, sentinel mudado) exige revisão
 *      consciente do snapshot — impede drift silencioso entre o que o CI
 *      executa e o que este teste espera.
 *   2. GATE — o passo único (GATE) roda `node scripts/check-readme-reverse-
 *      baseline.mjs` SEM flags: exit 1 do guard = achados novos → job falha.
 *      A rede de segurança é o próprio guard (node puro, sem bun).
 *   3. Refs contra o check-workflow-refs — extractScriptRefs roda no
 *      conteúdo REAL, e cada ref é validada contra o repo real. Uma
 *      referência quebrada no workflow falha este teste ANTES do CI.
 *   4. Trigger — schedule semanal + workflow_dispatch, NENHUM push/pr (o
 *      job é periódico de propósito: drift semântico NÃO bloqueia PRs).
 *   5. Baseline derivado — o snapshot do baseline (docs/security/
 *      readme-reverse-baseline.json) existe e tem findings: [] (o README
 *      atual passa --reverse limpo). Se o README ganhar um drift deliberado,
 *      o --update regenera o arquivo E este teste precisa do snapshot novo.
 *
 * Uso:
 *   npx vitest run --config vitest.config.unit.ts src/lib/__tests__/benchmark-weekly-readme-reverse-workflow.test.ts
 *
 * NOTA: snapshot de estrutura — para REGENERAR após mudança INTENCIONAL do
 * job: npx vitest run ... -u (atualiza o .snap). O snapshot captura a
 * estrutura parsed (js-yaml) do JOB (não do arquivo inteiro — o
 * benchmark-weekly tem muitos jobs e qualquer adição invalidaria o snapshot
 * inteiro sem relação com este job).
 */

import { describe, it, expect } from "vitest"
import { readFileSync, existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import yaml from "js-yaml"
import { extractScriptRefs } from "../../../scripts/check-workflow-refs.mjs"

// js-yaml é dep transitiva SEM @types — a declaração ambiente mínima vive em
// js-yaml.d.ts (mesmo diretório; .d.ts global, não inline, para evitar TS2665).

const CWD = process.cwd()
const WF_NAME = "benchmark-weekly.yml"
const WF_PATH = join(CWD, ".github", "workflows", WF_NAME)
const JOB_KEY = "readme-reverse-audit"
const BASELINE_PATH = join(CWD, "docs", "security", "readme-reverse-baseline.json")

// ── Fixtures reais (lidas do repo) ──────────────────────────────────────

const content = readFileSync(WF_PATH, "utf8")
const parsed = yaml.load(content) as {
  name?: string
  on?: Record<string, unknown>
  jobs?: Record<
    string,
    {
      name?: string
      steps?: { name?: string; id?: string; if?: string; run?: string; uses?: string }[]
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
  return { scripts, workflows: new Set(names) }
})()

// ── 1. Sintaxe YAML + snapshot da estrutura do job ──────────────────────

describe("benchmark-weekly.yml — job readme-reverse-audit (sintaxe YAML + snapshot)", () => {
  it("parseia como YAML válido e o job casa com o snapshot da estrutura", () => {
    expect(job).toBeDefined()
    expect(job).toMatchSnapshot()
  })

  it("estrutura mínima: job com 3 steps (checkout, GATE, Summary)", () => {
    expect(job?.name).toBe("README reverse semantics (baseline)")
    expect(steps.length).toBe(3)
  })

  it("triggers: schedule semanal + workflow_dispatch (nenhum push/pr)", () => {
    const triggers = Object.keys(parsed.on ?? {})
    expect(triggers).toContain("schedule")
    expect(triggers).toContain("workflow_dispatch")
    expect(triggers).not.toContain("push")
    expect(triggers).not.toContain("pull_request")
  })

  it("checkout sem fetch-depth (o guard só lê o working tree do README)", () => {
    expect(steps[0]?.uses).toBe("actions/checkout@v4")
    // NÃO exige fetch-depth: 0 (diferente do secret-leaks — aqui não há git log)
    expect(steps[0]).not.toMatchObject({ with: { "fetch-depth": 0 } })
  })
})

// ── 2. GATE ─────────────────────────────────────────────────────────────

describe("benchmark-weekly.yml — gate do readme-reverse-audit", () => {
  function stepRun(nameOrId: string): string {
    const s = steps.find((x) => x.name === nameOrId || x.id === nameOrId)
    if (!s) throw new Error(`step '${nameOrId}' não encontrado no job`)
    return s.run ?? ""
  }

  it("GATE roda o guard real SEM flags — exit 1 do guard falha o job", () => {
    const gate = steps.find((s) => s.name?.startsWith("Auditar links"))
    expect(gate).toBeDefined()
    const run = stepRun("Auditar links do README (--reverse) vs baseline")
    expect(run).toContain("node scripts/check-readme-reverse-baseline.mjs")
    // o GATE não chama --update: o baseline commitado é a fonte da verdade
    expect(run).not.toContain("--update")
    expect(gate?.if).toBeUndefined() // roda sempre no schedule
  })

  it("Summary roda e o baseline commitado é citado", () => {
    const summary = steps.find((s) => s.name === "Summary")
    expect(summary).toBeDefined()
    expect(stepRun("Summary")).toContain("readme-reverse-baseline.json")
  })
})

// ── 3. Refs de script contra o repo real ────────────────────────────────

describe("benchmark-weekly.yml — refs do readme-reverse-audit", () => {
  it("o guard referenciado existe em scripts/ (ref resolve no repo real)", () => {
    const refs = extractScriptRefs(content)
    expect(refs.map((r) => r.ref)).toContain("check-readme-reverse-baseline.mjs")
    // o próprio arquivo existe (o teste falharia antes do CI se sumisse)
    expect(ctx.scripts.has("check-readme-reverse-baseline.mjs")).toBe(true)
  })
})

// ── 4. Baseline commitado e derivado ────────────────────────────────────

describe("readme-reverse-baseline.json — baseline commitado", () => {
  it("baseline existe e é JSON válido com findings (derivado, não literal)", () => {
    expect(existsSync(BASELINE_PATH)).toBe(true)
    const bl = JSON.parse(readFileSync(BASELINE_PATH, "utf8"))
    expect(Array.isArray(bl.findings)).toBe(true)
    expect(bl.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(bl.count).toBe(bl.findings.length) // count DERIVADO dos findings
  })
})
