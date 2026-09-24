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
 *   2. UM COMANDO SÓ, NAS DUAS FORJAS — o fato central deste arquivo. O job
 *      roda `bun run lint`, e é o MESMO comando do job `lint` da Gitea: a
 *      régua (prettier --check + `eslint . --max-warnings 0`) vive no script
 *      `lint` do package.json, a única fonte. O teste também exige que NENHUM
 *      passo traga o par inline (`npx prettier`/`npx eslint`) e que o script
 *      compartilhado contenha as duas metades — sem isso a assimetria volta:
 *      o job `lint` da Gitea rodava `bun run lint` = `eslint .` (sem o teto de
 *      warnings, sem prettier), e o mesmo commit passava no merge lá e era
 *      rejeitado aqui. O escopo do prettier (src/ scripts/ docs/ prisma/
 *      .github/ configs) é o MESMO validado na Fase 3 (um `prettier --check .`
 *      puro quebraria em globs *.prisma).
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
import { sliceJob } from "../../../scripts/forge-doctor.mjs"

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

  it("estrutura mínima: checkout, setup-bun, cache, install, lint, summary", () => {
    // O `name:` é o CONTEXTO do required check no GitHub: renomear o job muda o
    // contexto de status e o manifesto passaria a exigir um check que não roda
    // (o PR trava para sempre). Ele descreve o par — a régua —, não o jeito.
    expect(job?.name).toBe("Lint Guard (prettier + eslint zero)")
    expect(steps.length).toBeGreaterThanOrEqual(7)
  })

  it("faz o setup do Bun por run: com a versão via vars.BUN_VERSION", () => {
    // `run:` (scripts/setup-bun-ci.sh) — não passa pelo resolvedor de actions.
    const setupBun = steps.find((s) => (s.run ?? "").includes("scripts/setup-bun-ci.sh"))
    expect(setupBun, "setup do Bun por run:").toBeDefined()
    expect(setupBun?.run).toContain('bash scripts/setup-bun-ci.sh "${{ vars.BUN_VERSION }}"')
  })

  it("cobre node_modules via actions/cache com key bun-BUN_VERSION-hashFiles", () => {
    // O job tem DOIS blocos actions/cache desde a migração do setup: o do Bun
    // (~/.bun, antes do step 'Setup Bun') e o de dependências (node_modules).
    // Seleciona por PATH — pegar o primeiro `uses: actions/cache@v4` acharia o
    // do Bun.
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

// ── 2. Fatos-chave do gate de lint/prettier ─────────────────────────────

describe("pr-check.yml — lint-guard (gate de lint/prettier)", () => {
  function stepRun(nameOrPrefix: string): string {
    const s = steps.find((x) => x.name?.startsWith(nameOrPrefix))
    if (!s) throw new Error(`step '${nameOrPrefix}' não encontrado no job lint-guard`)
    return s.run ?? ""
  }

  it("roda UM comando só: `bun run lint` — o MESMO do job `lint` da Gitea", () => {
    const run = stepRun("Check lint")
    expect(run.trim()).toBe("bun run lint")
    // E o MESMO comando literal aparece na pipeline da outra forja: é o que
    // torna o veredito do merge igual dos dois lados. A leitura é do job REAL
    // da Gitea (não de uma constante): se um lado mudar a régua, este teste cai.
    const giteaJob = sliceJob(
      readFileSync(join(CWD, ".gitea", "workflows", "ci.yml"), "utf8"),
      "lint",
    )
    expect(giteaJob, "job 'lint' da Gitea").toBeTruthy()
    expect(giteaJob).toContain(run.trim())
  })

  it("NÃO tem régua inline: nenhum passo de comando chama prettier/eslint direto", () => {
    // A assimetria de volta tem uma forma exata: o par (prettier + eslint zero)
    // duplicado no YAML de UMA das forjas. Dois comandos para a mesma
    // invariante divergem com o tempo — e quem libera o merge é o lado mais
    // fraco. Aqui a régua mora em UM lugar (package.json > lint) e o workflow
    // só a INVOCA.
    //
    // O filtro tira os passos de `echo`: eles são MENSAGEM, não gate — o
    // resumo do job cita "prettier" e "eslint" no texto, e acusar isso seria
    // acusar a própria descrição do contrato.
    const gateSteps = steps.filter((s) => !/^\s*echo\b/.test(s.run ?? ""))
    expect(gateSteps.length).toBeGreaterThan(0)
    for (const s of gateSteps) {
      const run = s.run ?? ""
      expect(run, `passo '${s.name}' roda a régua inline`).not.toMatch(
        /(^|\s|-)(npx\s+)?(prettier|eslint)\s/,
      )
    }
  })

  it("o comando compartilhado (package.json > lint) é o par prettier + eslint zero", () => {
    // Sem esta asserção, o teste acima poderia passar com um script `lint`
    // esvaziado de uma das metades (ex.: `eslint .` — o estado ANTERIOR, que é
    // justamente o que liberava o merge na Gitea).
    const pkg = JSON.parse(readFileSync(join(CWD, "package.json"), "utf8")) as {
      scripts?: Record<string, string>
    }
    const lint = String(pkg.scripts?.lint ?? "")
    expect(lint).toContain("prettier --check --ignore-unknown")
    expect(lint).toContain("eslint . --max-warnings 0")
    // A LISTA inteira de globs NÃO é pinada aqui: o escopo é DERIVADO e julgado
    // pelo `check-lint-scope` (invariante `lint-scope` do CORE, com o comando
    // exigido nas DUAS pipelines) — uma segunda cópia da lista seria mais um
    // ponto para envelhecer em silêncio, que é exatamente a classe do defeito.
    // O que este teste prende é o que a lista ANTIGA deixava de fora: os
    // diretórios que o hook julga e o lint não cobria (`ci/` — o caso medido — e
    // `.gitea/`, as workflows da forja DONA DO MERGE) e as extensões de raiz que
    // o comando precisa declarar (o `--ignore-unknown` não abre diretório).
    for (const glob of ["'ci/**'", "'.gitea/**'", "'*.cjs'", "'*.js'", "'.prettierrc'"]) {
      expect(lint, `o escopo do prettier perdeu ${glob}`).toContain(glob)
    }
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
    expect(refs, "nenhuma ref de action local deve restar").toEqual([])
    // O setup do Bun é o script do repo (chamado por `run:`), não um action.
    expect(content).toContain("bash scripts/setup-bun-ci.sh")
  })
})
