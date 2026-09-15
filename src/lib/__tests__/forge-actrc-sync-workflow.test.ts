/**
 * forge-actrc-sync-workflow.test.ts
 *
 * Trava o contrato do workflow AGENDADO de espelhos da forja
 * (.gitea/workflows/actrc-sync.yml) — o job que compara `.actrc` +
 * `deploy/env.gitea.example` + o `deploy/.env.gitea` do HOST com a
 * repository variable BUN_VERSION, no lado que é DONO DO MERGE.
 *
 * Migração para o helper compartilhado workflow-execution.
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import {
  BUN_VERSION_VAR,
  extractEnvVersion,
  findBunLiteralInScript,
} from "../../../scripts/check-bun-mirror.mjs"
import {
  discoverEnvMirrors,
  GITEA_ENV_DEPLOYED,
  GITEA_ENV_MIRROR,
  MIRROR_VARIABLES,
} from "../../../scripts/check-actrc-sync.mjs"

import {
  loadWorkflow,
  readWorkflowContent,
  getJob,
  getSteps,
  buildRepoContext,
  expectAllRefs,
  getTriggers,
} from "./helpers/workflow-execution"

const FORGE_WF = ".gitea/workflows/actrc-sync.yml"
const GITHUB_WF = ".github/workflows/benchmark-weekly.yml"
const MANIFEST = join(process.cwd(), "ci", "required-checks.json")

const wf = loadWorkflow(FORGE_WF)
const content = readWorkflowContent(FORGE_WF)
const githubContent = readWorkflowContent(GITHUB_WF)
const job = getJob(wf, "actrc-sync")
const steps = getSteps(job)
const ctx = buildRepoContext()

/** As linhas `run:` executáveis (comentário não é comando). */
function runLines(): string[] {
  return steps
    .map((s) => s.run)
    .filter((r): r is string => typeof r === "string")
    .flatMap((r) => r.split("\n"))
    .map((l) => l.trim())
    .filter((l) => l !== "" && !l.startsWith("#"))
}

const guardLine = () => runLines().find((l) => l.includes("check-actrc-sync.mjs")) ?? ""

// ── 1. estrutura + triggers ───────────────────────────────────────────────

describe("forge actrc-sync — estrutura", () => {
  it("YAML válido com o job esperado", () => {
    expect(Object.keys(wf.jobs ?? {})).toEqual(["actrc-sync"])
    expect(job["runs-on"]).toBe("ubuntu-latest")
  })

  it("trigger é cron + dispatch (job agendado não reporta status em PR)", () => {
    const triggers = getTriggers(wf)
    expect(triggers).toContain("schedule")
    expect(triggers).toContain("workflow_dispatch")
    const cron = (wf.on?.schedule as { cron: string }[])[0].cron
    expect(cron).toMatch(/^\d+ \d+ \* \* \d$/)
  })

  it("faz checkout e garante o Bun pelo script (sem composite local)", () => {
    const uses = steps.map((s) => s.uses).filter(Boolean)
    expect(uses).toContain("actions/checkout@v4")
    expect(runLines().some((l) => l.includes("scripts/setup-bun-ci.sh"))).toBe(true)
  })

  it("roda `bun <script>` direto, não `bun run <entry>`", () => {
    expect(guardLine()).toMatch(/^bun scripts\/check-actrc-sync\.mjs/)
  })
})

// ── 2. não pode virar required check ──────────────────────────────────────

describe("forge actrc-sync — não pode ser required check", () => {
  it("o manifesto REAL não exige este job (cron travaria todo PR para sempre)", () => {
    const manifest = JSON.parse(readFileSync(MANIFEST, "utf8")) as {
      forges: Record<string, { jobs: string[] }>
    }
    for (const forge of Object.values(manifest.forges)) {
      expect(forge.jobs).not.toContain("actrc-sync")
    }
  })
})

// ── 3. fonte única do Bun ─────────────────────────────────────────────────

describe("forge actrc-sync — fonte única do Bun", () => {
  it("a versão vem da repository variable (env do workflow)", () => {
    expect(extractEnvVersion(content)).toBe(BUN_VERSION_VAR)
    expect(wf.env?.BUN_VERSION).toBe(BUN_VERSION_VAR)
  })

  it("nenhuma versão literal do Bun no workflow", () => {
    expect(findBunLiteralInScript(content)).toBeNull()
  })

  it("a guarda compara com a variável, e não com uma versão cravada", () => {
    expect(guardLine()).toContain('--expected "$BUN_VERSION"')
  })
})

// ── 4. paridade com o lado GitHub ─────────────────────────────────────────

describe("forge actrc-sync — paridade com o GitHub", () => {
  it("os DOIS lados invocam o mesmo script (uma guarda, duas forjas)", () => {
    expect(guardLine()).toContain("scripts/check-actrc-sync.mjs")
    const githubLine = githubContent
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.includes("check-actrc-sync.mjs"))
    expect(githubLine, "o job actrc-sync sumiu do benchmark-weekly.yml").toBeTruthy()
    expect(githubLine).toContain("scripts/check-actrc-sync.mjs")
  })

  it("os dois passam o MESMO valor esperado (vars.BUN_VERSION)", () => {
    expect(guardLine()).toContain("--expected")
    expect(guardLine()).toContain("BUN_VERSION")
    const githubBlock = githubContent.slice(githubContent.indexOf("actrc-sync:"))
    expect(githubBlock).toContain('--expected "${{ vars.BUN_VERSION }}"')
  })

  it("a DIFERENÇA permitida é só o modo: --fail na forja, aviso no GitHub", () => {
    expect(guardLine()).toContain("--fail")
    expect(guardLine()).not.toContain("::warning::")
  })

  it("o erro da forja carrega o remédio (não só 'falhou')", () => {
    const annotations = runLines().filter((l) => l.startsWith('echo "::error::'))
    expect(annotations.length).toBeGreaterThanOrEqual(2)
    expect(content).toContain("gitea-up.sh --re-register")
  })
})

// ── 5. o guard alcança o arquivo que a forja realmente lê ─────────────────

describe("forge actrc-sync — alcança o env do HOST", () => {
  it("declara o arquivo do host como espelho a descobrir", () => {
    expect(GITEA_ENV_DEPLOYED).toContain("deploy/.env.gitea")
    expect(GITEA_ENV_MIRROR).toBe("deploy/env.gitea.example")
  })

  it("num checkout onde o env do host existe, ele ENTRA na comparação", () => {
    const mirrors = discoverEnvMirrors(ctx.cwd)
    const deployed = mirrors.filter((m) => m.deployed).map((m) => m.label)
    const expectedDeployed = GITEA_ENV_DEPLOYED.filter((p) =>
      mirrors.some((m) => m.path.endsWith(p)),
    )
    expect(deployed.every((d) => GITEA_ENV_DEPLOYED.includes(d))).toBe(true)
    expect(expectedDeployed.length).toBe(deployed.length)
  })
})

// ── 6. nenhuma variável do compose fica só com a checagem de existência ───

describe("nenhuma variável do compose fica só com a checagem de existência", () => {
  const doctorContent = readWorkflowContent(".gitea/workflows/forge-doctor.yml")

  const viaExpectedVar = MIRROR_VARIABLES.filter((n) => n !== "BUN_VERSION")
  const varExpr = (name: string) => "${{ vars." + name + " }}"
  const flag = (name: string) => '--expected-var "' + name + "=$" + name + '"'

  const commands = (text: string, entry: string) =>
    text
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.includes(entry) && !l.startsWith("#"))

  it("o guard do GitHub passa o valor de TODAS as variáveis do registro", () => {
    const [line] = commands(githubContent, "check-actrc-sync.mjs")
    expect(line, "a chamada do guard sumiu do benchmark-weekly.yml").toBeTruthy()
    expect(line).toContain('--expected "${{ vars.BUN_VERSION }}"')
    for (const name of viaExpectedVar) {
      expect(line).toContain('--expected-var "' + name + "=" + varExpr(name) + '"')
    }
  })

  it("a issue do GitHub carrega as MESMAS variáveis", () => {
    const [line] = commands(githubContent, "actrc-sync-issue.mjs")
    expect(line, "o publicador da issue sumiu do benchmark-weekly.yml").toBeTruthy()
    for (const name of viaExpectedVar) {
      expect(line).toContain('--expected-var "' + name + "=" + varExpr(name) + '"')
    }
  })

  it("a forja passa o valor das MESMAS variáveis (duas forjas, uma régua)", () => {
    for (const name of viaExpectedVar) {
      expect(wf.env?.[name]).toBe(varExpr(name))
      expect(guardLine()).toContain(flag(name))
    }
  })

  it("o doctor da forja compara o MESMO conjunto", () => {
    const doctor = loadWorkflow(".gitea/workflows/forge-doctor.yml")
    for (const name of viaExpectedVar) {
      expect(doctor.env?.[name]).toBe(varExpr(name))
      expect(doctorContent).toContain(flag(name))
    }
  })

  it("a versão entra por --expected nos DOIS lados (uma forma só de escrever o valor)", () => {
    expect(MIRROR_VARIABLES).toContain("BUN_VERSION")
    expect(doctorContent).not.toContain('--expected-var "BUN_VERSION=')
    expect(githubContent).not.toContain('--expected-var "BUN_VERSION=')
  })
})

// ── 7. refs ───────────────────────────────────────────────────────────────

describe("forge actrc-sync — refs", () => {
  it("todas as refs resolvem (scripts, workflows, actions)", () => {
    expectAllRefs(content, ctx)
  })
})
