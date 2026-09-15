/**
 * forge-actrc-sync-workflow.test.ts
 *
 * Trava o contrato do workflow AGENDADO de espelhos da forja
 * (.gitea/workflows/actrc-sync.yml) — o job que compara `.actrc` +
 * `deploy/env.gitea.example` + o `deploy/.env.gitea` do HOST com a repository
 * variable BUN_VERSION, no lado que é DONO DO MERGE.
 *
 * POR QUE ESTE TESTE EXISTE: o guard já rodava no GitHub, e nada garantia que
 * ele também rodasse na forja — o lado que decide o merge e o único cujo
 * checkout tem o arquivo do host (num runner do GitHub ele é gitignored). Um
 * gate que só existe na forja espelho não protege a pipeline que bloqueia.
 *
 * Valida QUATRO coisas:
 *
 *   1. Estrutura + triggers — o YAML parseia e o trigger é cron +
 *      `workflow_dispatch`. Um job agendado nunca reporta status num PR, então
 *      exigi-lo como required check travaria todo PR para sempre.
 *   2. Não pode virar required check — asserção contra o manifesto REAL
 *      (ci/required-checks.json).
 *   3. Fonte única do Bun — env resolvendo de vars.BUN_VERSION, nenhum literal
 *      de versão e a chamada do setup passando a versão como argumento (as
 *      funções do próprio check-bun-mirror rodam sobre o conteúdo real).
 *   4. PARIDADE COM O LADO GITHUB — os dois lados invocam o MESMO script com o
 *      MESMO `--expected`, senão os dois espelhos passam a ter guardas
 *      diferentes e um deles vira decoração. A única diferença permitida é o
 *      modo (`--fail` aqui, `::warning::` lá), e ela é deliberada: na forja não
 *      existe canal de issue, o único sinal visível é o status do run.
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"
import yaml from "js-yaml"

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

const CWD = process.cwd()
const FORGE_WF = join(CWD, ".gitea", "workflows", "actrc-sync.yml")
const GITHUB_WF = join(CWD, ".github", "workflows", "benchmark-weekly.yml")
const MANIFEST = join(CWD, "ci", "required-checks.json")

const content = readFileSync(FORGE_WF, "utf8")
const githubContent = readFileSync(GITHUB_WF, "utf8")
const parsed = yaml.load(content) as {
  name: string
  on: Record<string, unknown>
  jobs: Record<
    string,
    { "runs-on": string; steps: { name?: string; uses?: string; run?: string }[] }
  >
  env: Record<string, string>
}

const job = parsed.jobs["actrc-sync"]

/** As linhas `run:` executáveis (comentário não é comando). */
function runLines(): string[] {
  return job.steps
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
    expect(Object.keys(parsed.jobs)).toEqual(["actrc-sync"])
    expect(job["runs-on"]).toBe("ubuntu-latest")
  })

  it("trigger é cron + dispatch (job agendado não reporta status em PR)", () => {
    expect(Object.keys(parsed.on).sort()).toEqual(["schedule", "workflow_dispatch"])
    const cron = (parsed.on.schedule as { cron: string }[])[0].cron
    expect(cron).toMatch(/^\d+ \d+ \* \* \d$/)
  })

  it("faz checkout e garante o Bun pelo script (sem composite local, como a ci.yml)", () => {
    const uses = job.steps.map((s) => s.uses).filter(Boolean)
    expect(uses).toContain("actions/checkout@v4")
    expect(runLines().some((l) => l.includes("scripts/setup-bun-ci.sh"))).toBe(true)
  })

  it("roda `bun <script>` direto, não `bun run <entry>` (a imagem da forja não garante node)", () => {
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
    expect(parsed.env.BUN_VERSION).toBe(BUN_VERSION_VAR)
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
    // Deliberada e documentada: na forja não há canal de issue, então o único
    // sinal visível é o status do run — um ::warning:: dentro de um run verde
    // não é lido por ninguém. O GitHub mantém o aviso e a issue acionável.
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
    // A promessa do job: no checkout da forja o `deploy/.env.gitea` é lido. Aqui
    // se prova a peça que a sustenta (a descoberta), com o repo real — se
    // alguém trocar o nome do arquivo, o job continuaria verde e olhando nada.
    const mirrors = discoverEnvMirrors(CWD)
    // O repo real pode não ter o arquivo do host (é gitignored); o que não pode
    // é o caminho ter deixado de ser candidato.
    const deployed = mirrors.filter((m) => m.deployed).map((m) => m.label)
    const expectedDeployed = GITEA_ENV_DEPLOYED.filter((p) =>
      mirrors.some((m) => m.path.endsWith(p)),
    )
    expect(deployed.every((d) => GITEA_ENV_DEPLOYED.includes(d))).toBe(true)
    expect(expectedDeployed.length).toBe(deployed.length)
  })
})

// ── 6. nenhuma variável do compose fica só com a checagem de existência ───
//
// A comparação de VALOR só acontece se o workflow ENTREGAR o valor. Uma
// variável que o compose consome e que não chega ao guard por flag volta em
// silêncio ao regime antigo ("só existe") — exatamente o buraco que esta
// extensão fecha, agora no nível do call site. A lista sai do REGISTRO
// (`MIRROR_VARIABLES`), não de uma lista escrita à mão: uma variável nova no
// compose falha AQUI até chegar aos três consumidores (o guard do GitHub, o
// publicador da issue e o doctor da forja).

describe("nenhuma variável do compose fica só com a checagem de existência", () => {
  const DOCTOR_WF = join(CWD, ".gitea", "workflows", "forge-doctor.yml")
  const doctorContent = readFileSync(DOCTOR_WF, "utf8")

  /** As comparadas que NÃO usam o atalho da versão (`--expected`). */
  const viaExpectedVar = MIRROR_VARIABLES.filter((n) => n !== "BUN_VERSION")

  /** `${{ vars.NAME }}` — o valor vem da VARIABLE, nunca de um literal no YAML. */
  const varExpr = (name: string) => "${{ vars." + name + " }}"

  /** O argv esperado: `--expected-var NAME=$NAME` (o shell do runner). */
  const flag = (name: string) => '--expected-var "' + name + "=$" + name + '"'

  /** As linhas executáveis que invocam `entry` (comentário não é comando). */
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

  it("a issue do GitHub carrega as MESMAS variáveis (o comando de reprodução não mente)", () => {
    const [line] = commands(githubContent, "actrc-sync-issue.mjs")
    expect(line, "o publicador da issue sumiu do benchmark-weekly.yml").toBeTruthy()
    for (const name of viaExpectedVar) {
      expect(line).toContain('--expected-var "' + name + "=" + varExpr(name) + '"')
    }
  })

  it("a forja passa o valor das MESMAS variáveis (duas forjas, uma régua)", () => {
    for (const name of viaExpectedVar) {
      expect(parsed.env[name]).toBe(varExpr(name))
      expect(guardLine()).toContain(flag(name))
    }
  })

  it("o doctor da forja compara o MESMO conjunto (a prontidão não fica na existência)", () => {
    const doctor = yaml.load(doctorContent) as { env: Record<string, string> }
    for (const name of viaExpectedVar) {
      expect(doctor.env[name]).toBe(varExpr(name))
      expect(doctorContent).toContain(flag(name))
    }
  })

  it("a versão entra por --expected nos DOIS lados (uma forma só de escrever o valor)", () => {
    // O guard REJEITA `--expected-var BUN_VERSION=...` (exit 2 — precedência
    // silenciosa entre duas formas): se algum call site passasse a versão por
    // ali, o job morreria com erro de uso em vez de comparar.
    expect(MIRROR_VARIABLES).toContain("BUN_VERSION")
    expect(doctorContent).not.toContain('--expected-var "BUN_VERSION=')
    expect(githubContent).not.toContain('--expected-var "BUN_VERSION=')
  })
})
