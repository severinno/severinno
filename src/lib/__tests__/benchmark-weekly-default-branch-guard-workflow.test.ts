/**
 * benchmark-weekly-default-branch-guard-workflow.test.ts
 *
 * Snapshot test do job PERIÓDICO default-branch-workflow-guard do
 * .github/workflows/benchmark-weekly.yml — o guard que valida que os
 * workflows de MEDIÇÃO de CI (seed-guards.yml) EXISTEM na branch DEFAULT
 * do repo, prevenindo o falso estado 'pendente de medição' (o gh run list
 * responde '404: workflow not found on the default branch' quando o
 * workflow NÃO foi mergeado — o bloqueio real é o MERGE, não a falta de
 * run).
 *
 * Valida (padrão dos testes de guards — espelha o
 * benchmark-weekly-mutation-timing-workflow.test.ts):
 *
 *   1. Sintaxe YAML — js-yaml parse do conteúdo REAL do arquivo (lança se
 *      inválido) + snapshot da estrutura do JOB.
 *   2. Contrato de verificação: permissions contents: read (gh api
 *      repos/X/contents), GH_TOKEN: ${{ github.token }}, invocação do
 *      script com --repo github.repository --workflow seed-guards.yml e
 *      --json /tmp/default-branch-guard.json.
 *   3. Fail-closed documentado no header do script: exit 1 = workflow
 *      ausente (GATE), exit 2 = infra — o job falha (não silencia) quando
 *      a medição não está deployada.
 *   4. Refs contra o check-workflow-refs — extractScriptRefs roda no
 *      conteúdo REAL e o script existe em scripts/.
 *
 * Uso:
 *   npx vitest run --config vitest.config.unit.ts src/lib/__tests__/benchmark-weekly-default-branch-guard-workflow.test.ts
 *
 * NOTA: snapshot de estrutura — para REGENERAR após mudança INTENCIONAL do
 * job: npx vitest run ... -u.
 */

import { describe, it, expect } from "vitest"
import { readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import yaml from "js-yaml"
import { extractScriptRefs } from "../../../scripts/check-workflow-refs.mjs"

const CWD = process.cwd()
const WF_NAME = "benchmark-weekly.yml"
const WF_PATH = join(CWD, ".github", "workflows", WF_NAME)
const JOB_KEY = "default-branch-workflow-guard"

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

// ── 1. Sintaxe YAML + snapshot da estrutura do job ─────────────────────

describe("benchmark-weekly.yml — job default-branch-workflow-guard (sintaxe YAML + snapshot)", () => {
  it("parseia como YAML válido e o job casa com o snapshot da estrutura", () => {
    expect(job).toBeDefined()
    expect(job).toMatchSnapshot()
  })

  it("estrutura mínima: job com 4 steps (checkout, validação, artifact, summary)", () => {
    expect(job?.name).toBe("Default-branch workflow guard (medição deployada?)")
    expect(steps.length).toBe(4)
  })

  it("checkout simples (fetch-depth default — o guard não precisa de histórico)", () => {
    expect(steps[0]?.uses).toBe("actions/checkout@v4")
  })
})

// ── 2. Contrato de verificação (permissions/GH_TOKEN/invocação) ────────

describe("benchmark-weekly.yml — contrato de verificação do default-branch-workflow-guard", () => {
  it("permissions: contents: read (gh api repos/X/contents — existência do workflow na branch)", () => {
    expect(job?.permissions).toMatchObject({
      contents: "read",
    })
  })

  it("passo de validação (id: guard) injeta GH_TOKEN do github.token e invoca o script com repo + workflow de medição + json", () => {
    const guard = steps.find((s) => s.id === "guard")
    expect(guard).toBeDefined()
    expect(guard?.env).toEqual({ GH_TOKEN: "${{ github.token }}" })
    const run = guard?.run ?? ""
    expect(run).toContain("node scripts/check-default-branch-workflows.mjs")
    expect(run).toContain('--repo "${{ github.repository }}"')
    expect(run).toContain("--workflow seed-guards.yml")
    expect(run).toContain("--json /tmp/default-branch-guard.json")
  })

  it("artifact e summary usam if: always() — a evidência existe mesmo com exit 1/2 do script", () => {
    const artifact = steps.find((s) => s.uses?.startsWith("actions/upload-artifact"))
    const summary = steps.find((s) => s.name === "Summary")
    expect(artifact?.if).toBe("always()")
    expect(artifact?.with).toMatchObject({ path: "/tmp/default-branch-guard.json" })
    expect(summary?.if).toBe("always()")
    expect(summary?.run ?? "").toContain("$GITHUB_STEP_SUMMARY")
    expect(summary?.run ?? "").toContain("BLOQUEIO REAL")
  })
})

// ── 3. Fail-closed documentado no script ───────────────────────────────

describe("check-default-branch-workflows.mjs — contrato fail-closed no header", () => {
  it("o header documenta o exit 1 como GATE de workflow ausente (a causa raiz do falso 'pendente')", () => {
    const script = readFileSync(join(CWD, "scripts", "check-default-branch-workflows.mjs"), "utf8")
    expect(script).toContain("1 — pelo menos um workflow AUSENTE (GATE")
    expect(script).toContain("MERGE do branch")
    // A frase do 404 quebra em DUAS linhas no header (comentário wrapado) —
    // remove os marcadores '// ' de continuação E normaliza o whitespace
    // antes de assertar o texto completo (o regex /\s+/ sozinho deixaria o
    // '//' literal no meio da frase: '404: workflow // seed-guards.yml').
    const normalized = script
      .split("\n")
      .map((l) => l.replace(/^\/\/\s*/, ""))
      .join(" ")
      .replace(/\s+/g, " ")
    expect(normalized).toContain("404: workflow seed-guards.yml not found on the default branch")
  })
})

// ── 4. Refs de script contra o repo real ───────────────────────────────

describe("benchmark-weekly.yml — refs do default-branch-workflow-guard contra o check-workflow-refs", () => {
  it("o script invocado existe em scripts/ (check-default-branch-workflows.mjs resolve)", () => {
    const refs = extractScriptRefs(content)
    const ref = refs.find((r) => r.ref === "check-default-branch-workflows.mjs")
    expect(ref).toBeDefined()
    expect(existsSync(join(CWD, "scripts", "check-default-branch-workflows.mjs"))).toBe(true)
  })
})
