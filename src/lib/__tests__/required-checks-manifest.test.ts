/**
 * Testes de `ci/required-checks.json` + `scripts/check-required-checks.mjs`.
 *
 * O guard roda no CI sem `node_modules` (o job `workflow-refs-guard` só faz
 * checkout), então ele parseia `jobs:` com um leitor caseiro em vez do pacote
 * `yaml`. Aqui essa escolha é travada por EXPECTATIVA EXPLÍCITA (não por uma
 * segunda implementação): se o parser passar a enxergar um job a mais/menos ou
 * errar um `if:`, estes testes quebram.
 *
 * Por que os `if:` importam: um required check CONDICIONAL pode pular num PR —
 * e um check que não roda não protege nada. O guard recusa manifesto com job
 * condicional; os testes abaixo garantem que a detecção de `if:` funciona.
 */

import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  MANIFEST_PATH,
  contagemNoContexto,
  contextFor,
  defaultIo,
  loadManifest,
  parseWorkflowJobs,
  resolveManifestContexts,
  validateManifest,
} from "../../../scripts/check-required-checks.mjs"
import {
  ISSUE_LABEL,
  driftBody,
  driftTitle,
  hasSignature,
  markerOf,
  signatureOf,
} from "../../../scripts/required-checks-drift-issue.mjs"

const ROOT = process.cwd()
const io = defaultIo(ROOT)
const manifest = loadManifest(ROOT, io)

const PR_CHECK = ".github/workflows/pr-check.yml"
const GITEA_CI = ".gitea/workflows/ci.yml"
const DRIFT_WORKFLOW = ".github/workflows/required-checks-drift.yml"
const GITEA_DRIFT_WORKFLOW = ".gitea/workflows/required-checks-drift.yml"

/** Jobs reais de cada workflow (verificado contra o YAML na revisão). */
const EXPECTED_JOB_IDS: Record<string, string[]> = {
  [PR_CHECK]: [
    "utf8-check",
    "blob-crlf-history-audit",
    "all-text-alert-validation",
    "secrets-guard",
    "seed-hooks-guard",
    "workflow-refs-guard",
    "workflow-run-syntax",
    "bring-up-proof",
    "pre-commit-in-runner-proof",
    "sentinel-producer-guard",
    "no-setup-bun-guard",
    "bun-mirror-guard",
    "doctor-mirrors-guard",
    "mutation-jobs-staged-guard",
    "mutation-guards",
    "forge-parity-mutation",
    "hooks-symmetry-guard",
    "mutation-jobs-guard",
    "readme-reverse-strict-alert",
    "tier1-fastpath-guard",
    "e2e-counts-guard",
    "seed-count-literals-guard",
    "actionlint",
    "lint-guard",
    "jsdom-drift-guard",
    "unused-deps-guard",
    "mutation-count-guard",
    "bun-audit-guard",
    "fuzz",
    "benchmark",
    "benchmark-gist",
    "seed-guards",
    "mutation-coord-timing-guard",
    "mutation-coord-timing-act-guard",
    "security-headers",
    "typecheck",
    "check",
    "pii-allowlist-guard",
  ],
  [GITEA_CI]: [
    "lint",
    "guards",
    "bring-up-proof",
    "pre-commit-in-runner-proof",
    "typecheck",
    "test",
    "build",
    "deploy",
  ],
}

/** Jobs que de fato declaram `if:` (nível de job) em cada workflow. */
const EXPECTED_CONDITIONAL_JOBS: Record<string, string[]> = {
  [PR_CHECK]: ["readme-reverse-strict-alert", "mutation-coord-timing-guard"],
  [GITEA_CI]: ["deploy"],
}

/** Contextos de status esperados — o que o branch protection precisa exigir. */
const EXPECTED_CONTEXTS: Record<string, string[]> = {
  github: [
    "UTF-8 Check",
    "Secrets Guard (no .env tracked)",
    "Workflow References Guard (no dangling refs)",
    // workflow-run-syntax: a sintaxe dos corpos `run:` é job PRÓPRIO — o check
    // DIZ o defeito (a classe que nasce de reescrita mecânica em massa) em vez
    // de derrubar um job que cobre seis invariantes.
    "Workflow run syntax (bash -n)",
    "Bring-up Gate Proof (pré-requisito 0, por execução)",
    // pre-commit-in-runner-proof: a prova do bloqueio do pre-commit DENTRO do
    // runtime do CI. O check DIZ o que foi medido (e onde) em vez de se diluir
    // num job que cobre vários invariantes — e o mesmo comando roda nas duas
    // pipelines (invariante CORE homônima no check-forge-parity).
    "Pre-commit Proof (dentro da imagem do runner)",
    // bun-mirror-guard: o gate CORE `bun-mirror` declara este job como o gate de
    // merge do GitHub (o `CORE_INVARIANTS` do check-forge-parity) — e um gate
    // CORE que roda FORA do manifesto fica vermelho sem bloquear nada. Na Gitea
    // a MESMA invariante roda DENTRO de `guards` (já required), e é por isso que
    // o id dela não aparece na lista de lá.
    "Bun Mirror Guard (fonte única vars.BUN_VERSION)",
    "Actionlint (workflow syntax)",
    "Lint Guard (prettier + eslint zero)",
    "TypeCheck (tsc --noEmit)",
    "check",
    "Security Headers",
    "PII Allowlist Guard (user payload projection)",
    // mutation-guards: job direto no pr-check.yml. O nome é COUNT-FREE de
    // propósito: ele é o CONTEXTO protegido, e um número ali faria cada bump da
    // matriz de mutation tests reescrever o contrato de merge (o
    // `check-mutation-count` falha se um count voltar ao name).
    "Mutation guards master",
    // forge-parity-mutation: a prova da classificação é job PRÓPRIO (diz qual
    // regra do contrato de merge quebrou, em vez de ser uma linha da matriz)
    "Forge Parity Mutation (regras de classificação)",
    // seed-guards: jobs resolvidos do reusable workflow seed-guards.yml
    "Seed E2E ${{ matrix.seed }} · ${{ matrix.variant }}",
    "Mutation Test (seed dev E2E pega regressões?)",
    // o `name:` deste job também é COUNT-FREE: o "5 cenários" era uma contagem
    // que CRESCE (o contrato coordenado ganha um cenário por release) dentro do
    // CONTEXTO protegido — o mesmo defeito do master de mutation tests.
    "Mutation Test (contrato coordenado — doc↔anchor↔código)",
    "Mutation Test (espelhos do doctor — comparação de valor)",
    "Mutation Test (os três fios do veredito do doctor)",
    "Mutation Test (as três regras do contrato de gates CORE)",
    "Mutation Test (perfil --ci do doctor — as 3 metades da comparação)",
    "Mutation Test (defesas do check-env-mirror)",
    "Seed Prod E2E (dev-env override)",
    "Migrate Category Rename E2E",
  ],
  gitea: [
    "Lint",
    "Repo Guards",
    "Bring-up Gate Proof (pré-requisito 0, por execução)",
    "Pre-commit Proof (dentro da imagem do runner)",
    "TypeCheck",
    "Tests",
    "Build",
  ],
}

function workflowContent(file: string): string {
  return readFileSync(join(ROOT, file), "utf8")
}

/** `io` sintético para testar a validação sem depender dos arquivos reais. */
function fakeIo(files: Record<string, string>) {
  return { readFile: (path: string) => files[path] ?? null }
}

describe("parser de `jobs:` (sem deps)", () => {
  it.each(Object.keys(EXPECTED_JOB_IDS))("extrai exatamente os jobs de %s", (file) => {
    const jobs = parseWorkflowJobs(workflowContent(file))
    expect([...jobs.keys()]).toEqual(EXPECTED_JOB_IDS[file])
  })

  it.each(Object.keys(EXPECTED_CONDITIONAL_JOBS))(
    "detecta `if:` de job (e NÃO o de step) em %s",
    (file) => {
      const jobs = parseWorkflowJobs(workflowContent(file))
      const conditional = [...jobs.entries()].filter(([, job]) => job.if !== null).map(([id]) => id)
      expect(conditional).toEqual(EXPECTED_CONDITIONAL_JOBS[file])
    },
  )

  it("resolve o contexto de um job sem `name:` para o próprio id", () => {
    const jobs = parseWorkflowJobs(workflowContent(PR_CHECK))
    expect(contextFor("check", jobs.get("check")!)).toBe("check")
    expect(contextFor("typecheck", jobs.get("typecheck")!)).toBe("TypeCheck (tsc --noEmit)")
  })
})

/**
 * O CONTEXTO do required check é derivado do `name:` do job — logo um número
 * que descreve uma CONTAGEM ali faz o contrato de merge mudar quando o número
 * muda (a matriz de mutation tests cresce a cada guard novo). Estes são os
 * casos que decidem se o guard pega o acoplamento ou o deixa passar.
 */
describe("contexto estável de required check (sem CONTAGEM)", () => {
  it("pega os contextos que acoplam o contrato de merge a uma contagem", () => {
    expect(contagemNoContexto("Mutation guards master (27 node-pure mutation tests)")).toBe(
      "(27 node-pure mutation tests)",
    )
    expect(contagemNoContexto("Mutation Test (contrato coordenado, 5 cenários)")).toBe(
      "(contrato coordenado, 5 cenários)",
    )
    expect(contagemNoContexto("Repo Guards (40 guards)")).toBe("(40 guards)")
  })

  it("deixa passar contextos cujo parêntese não é contagem", () => {
    expect(contagemNoContexto("Mutation guards master")).toBeNull()
    expect(contagemNoContexto("TypeCheck (tsc --noEmit)")).toBeNull()
    expect(contagemNoContexto("Workflow run syntax (bash -n)")).toBeNull()
    expect(contagemNoContexto("Bring-up Gate Proof (pré-requisito 0, por execução)")).toBeNull()
    expect(contagemNoContexto("Seed E2E ${{ matrix.seed }} · ${{ matrix.variant }}")).toBeNull()
  })

  it("recusa um manifesto cujo job de required check carrega o count no name", () => {
    const broken = `
name: Fixture
jobs:
  mutation-guards:
    name: Mutation guards master (27 node-pure mutation tests)
    runs-on: self-hosted
    steps:
      - run: echo ok
`
    const violations = validateManifest(
      {
        version: 1,
        branches: ["main"],
        forges: {
          github: { workflow: ".github/workflows/pr-check.yml", jobs: ["mutation-guards"] },
        },
      },
      fakeIo({ ".github/workflows/pr-check.yml": broken }),
    )
    expect(violations).toHaveLength(1)
    expect(violations[0].problem).toContain("CONTAGEM")
  })
})

/**
 * `resolveManifestContexts` vive num `.mjs` (JS inferido), então o tipo do
 * objeto resolvido não sobrevive à inferência — a forma é declarada aqui.
 */
type ResolvedForge = {
  workflow: string
  branches: string[]
  contexts: { jobId: string; context: string }[]
}

function resolvedForge(): Record<string, ResolvedForge> {
  return resolveManifestContexts(manifest, io) as unknown as Record<string, ResolvedForge>
}

describe("ci/required-checks.json", () => {
  it("existe e é válido", () => {
    expect(io.readFile(MANIFEST_PATH)).not.toBeNull()
    expect(manifest.version).toBe(1)
    expect(manifest.branches).toEqual(["main"])
  })

  it("não diverge dos workflows (mesma validação do CI)", () => {
    expect(validateManifest(manifest, io)).toEqual([])
  })

  it("resolve os contextos exatos que o branch protection deve exigir", () => {
    const resolved = resolvedForge()
    for (const [forge, expected] of Object.entries(EXPECTED_CONTEXTS)) {
      expect(resolved[forge].contexts.map((c) => c.context)).toEqual(expected)
    }
  })

  it("exige o gate de PII na forja principal", () => {
    // Regressão específica: o gate de PII é o motivo desta automação existir —
    // ele não pode sair do manifesto sem quebrar o teste e o review.
    expect(resolvedForge().github.contexts.map((c) => c.context)).toContain(
      "PII Allowlist Guard (user payload projection)",
    )
  })
})

describe("validateManifest recusa manifestos que travariam o merge", () => {
  const workflow = [
    "name: WF",
    "on:",
    "  pull_request:",
    "jobs:",
    "  good:",
    "    name: Good",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - run: echo ok",
    "  conditional:",
    "    name: Conditional",
    "    if: github.event_name == 'push'",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - run: echo ok",
    "  twin:",
    "    name: Good",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - run: echo ok",
    "",
  ].join("\n")

  const base = { version: 1, branches: ["main"], forges: {} }

  it("job inexistente (o PR esperaria para sempre)", () => {
    const violations = validateManifest(
      { ...base, forges: { github: { workflow: "wf.yml", jobs: ["missing"] } } },
      fakeIo({ "wf.yml": workflow }),
    )
    expect(violations).toHaveLength(1)
    expect(violations[0].problem).toContain("não existe")
  })

  it("job condicional (um check obrigatório que pode pular)", () => {
    const violations = validateManifest(
      { ...base, forges: { github: { workflow: "wf.yml", jobs: ["conditional"] } } },
      fakeIo({ "wf.yml": workflow }),
    )
    expect(violations).toHaveLength(1)
    expect(violations[0].problem).toContain("condicional")
  })

  it("contexto duplicado (dois jobs com o mesmo `name:`)", () => {
    const violations = validateManifest(
      { ...base, forges: { github: { workflow: "wf.yml", jobs: ["good", "twin"] } } },
      fakeIo({ "wf.yml": workflow }),
    )
    expect(violations).toHaveLength(1)
    expect(violations[0].problem).toContain("duplicado")
  })

  it("workflow ausente", () => {
    const violations = validateManifest(
      { ...base, forges: { github: { workflow: "nope.yml", jobs: ["good"] } } },
      fakeIo({ "wf.yml": workflow }),
    )
    expect(violations).toHaveLength(1)
    expect(violations[0].problem).toContain("não existe")
  })

  it("versão não suportada e branches vazio", () => {
    const violations = validateManifest(
      { version: 99, branches: [], forges: { github: { workflow: "wf.yml", jobs: ["good"] } } },
      fakeIo({ "wf.yml": workflow }),
    )
    expect(violations.map((v: { problem: string }) => v.problem).join(" | ")).toContain(
      "version deve ser 1",
    )
    expect(violations.map((v: { problem: string }) => v.problem).join(" | ")).toContain(
      "branches deve ser uma lista não-vazia",
    )
  })
})

// ---------------------------------------------------------------------------
// Vigilância do drift: o cron não pode virar required check
// ---------------------------------------------------------------------------

type DriftReport = {
  drift: boolean
  errors: { forge: string; message: string }[]
  forges: Record<
    string,
    {
      workflow: string
      branches: { branch: string; inSync: boolean; missing: string[]; extra: string[] }[]
    }
  >
}

function driftReport(overrides: Partial<DriftReport> = {}): DriftReport {
  return {
    drift: true,
    errors: [],
    forges: {
      github: {
        workflow: PR_CHECK,
        branches: [
          {
            branch: "main",
            inSync: false,
            missing: ["PII Allowlist Guard (user payload projection)", "TypeCheck (tsc --noEmit)"],
            extra: ["Legacy Check"],
          },
        ],
      },
    },
    ...overrides,
  }
}

describe("workflow agendado de drift", () => {
  it("existe no GitHub e no Gitea, com cron + dispatch manual", () => {
    for (const file of [DRIFT_WORKFLOW, GITEA_DRIFT_WORKFLOW]) {
      const content = io.readFile(file)
      expect(content, `${file} deve existir`).not.toBeNull()
      // Precisa rodar sozinho (cron) E poder ser disparado à mão (dispatch) —
      // sem o cron não há vigilância; sem o dispatch não há como re-verificar
      // depois de corrigir sem esperar uma semana.
      expect(content!).toMatch(/^on:\s*$/m)
      expect(content!).toMatch(/^\s*schedule:\s*$/m)
      expect(content!).toMatch(/^\s*- cron: "/m)
      expect(content!).toMatch(/^\s*workflow_dispatch:\s*$/m)
    }
  })

  it("NÃO lista o job do cron como required check (travaria todo PR)", () => {
    // Invariante central: um job que só roda por cron nunca reporta status num
    // PR. A exigí-lo, o PR esperaria PARA SEMPRE. O guard de manifesto não pega
    // isso sozinho (ele não sabe o trigger), então o teste trava aqui.
    const manifestWorkflows = Object.values(
      manifest.forges as Record<string, { workflow: string; jobs: string[] }>,
    ).map((forge) => forge.workflow)

    for (const file of [DRIFT_WORKFLOW, GITEA_DRIFT_WORKFLOW]) {
      expect(manifestWorkflows, `${file} não pode ser fonte de required checks`).not.toContain(file)
    }

    const driftJobs = [...parseWorkflowJobs(io.readFile(DRIFT_WORKFLOW)!).keys()]
    const requiredJobs = Object.values(
      manifest.forges as Record<string, { workflow: string; jobs: string[] }>,
    ).flatMap((forge) => forge.jobs)
    for (const job of driftJobs) {
      expect(requiredJobs, `job de cron "${job}" não pode ser required`).not.toContain(job)
    }
  })

  it("publica a ISSUE nas duas forjas: a dívida não pode ficar só no log", () => {
    // O alerta acionável é o ponto do workflow: um cron vermelho é alerta mudo.
    // Aqui a invariante é travada como CÓDIGO — remover o step da issue deixa
    // este teste vermelho, em vez de a dívida voltar a ser invisível.
    for (const file of [DRIFT_WORKFLOW, GITEA_DRIFT_WORKFLOW]) {
      const content = io.readFile(file)!
      expect(content, `${file} deve chamar o publicador de issue`).toContain(
        "scripts/required-checks-drift-issue.mjs",
      )
      // O step da issue roda SEMPRE — inclusive no run SEM drift. É o run em
      // sincronia que RECONCILIA: fecha as issues que este publicador abriu,
      // para a dívida não ficar ABERTA depois de resolvida. Condicioná-lo ao
      // drift (`if: steps.drift.outputs.exit_code != '0'`) faria o fechamento
      // sumir em silêncio, no único run que pode fechá-lo.
      const publishStep = content.slice(
        content.indexOf("Publish drift issue"),
        content.indexOf("Fail on drift"),
      )
      expect(publishStep, `${file}: o step da issue precisa rodar em sincronia também`).toMatch(
        /if: always\(\)/,
      )
      // O vermelho continua CONDICIONAL: sem drift o run fica verde — nenhum
      // dos espelhos governa corretude de CI.
      expect(content).toMatch(/if: steps\.drift\.outputs\.exit_code != '0'/)
      // A checagem precisa EXPORTAR o veredito para o step da issue.
      expect(content).toContain('echo "exit_code=${CODE}" >> "$GITHUB_OUTPUT"')
    }

    // A forja (dona do merge) não tem `gh`: o backend dela é a API do Gitea.
    const gitea = io.readFile(GITEA_DRIFT_WORKFLOW)!
    expect(gitea).toContain("--backend gitea")

    // PUBLICAR ANTES DE FALHAR: se o step da issue viesse depois do `exit 1`,
    // ele nunca rodaria no run que falha — exatamente o alerta mudo de antes.
    const publishAt = gitea.indexOf("Publish drift issue")
    const failAt = gitea.indexOf("Fail on drift")
    expect(publishAt, "o workflow do Gitea precisa publicar a issue").toBeGreaterThan(-1)
    expect(failAt).toBeGreaterThan(publishAt)
  })
})

describe("issue de drift: assinatura e dedup", () => {
  it("a assinatura é estável e independente da ordem (senão o dedup vira ruído)", () => {
    const a = driftReport()
    const b = driftReport({
      forges: {
        github: {
          workflow: PR_CHECK,
          branches: [
            {
              branch: "main",
              inSync: false,
              missing: [
                "TypeCheck (tsc --noEmit)",
                "PII Allowlist Guard (user payload projection)",
              ],
              extra: ["Legacy Check"],
            },
          ],
        },
      },
    })
    expect(signatureOf(a)).toBe(signatureOf(b))
    expect(signatureOf(a)).toContain("github:main")
  })

  it("branches em sincronia não entram na assinatura", () => {
    const synced = driftReport({
      forges: {
        github: {
          workflow: PR_CHECK,
          branches: [{ branch: "main", inSync: true, missing: [], extra: [] }],
        },
      },
    })
    expect(signatureOf(synced)).toBe("")
  })

  it("acrescenta erros de verificação à assinatura (drift imensurável alerta)", () => {
    const withError = driftReport({
      errors: [{ forge: "github", message: "HTTP 403: sem permissão" }],
    })
    expect(signatureOf(withError)).toContain("error:github")
  })

  it("o marcador é uma única linha (o corpo da issue precisa dele intacto)", () => {
    const marker = markerOf(signatureOf(driftReport()))
    expect(marker).toMatch(/^<!-- required-checks-drift:[A-Za-z0-9+/=]+ -->$/)
    expect(marker).not.toContain("\n")
  })

  it("deduplica por assinatura e não casa uma assinatura diferente", () => {
    const body = driftBody(driftReport())
    expect(hasSignature(body, signatureOf(driftReport()))).toBe(true)
    expect(
      hasSignature(
        body,
        signatureOf(driftReport({ forges: { github: { workflow: PR_CHECK, branches: [] } } })),
      ),
    ).toBe(false)
  })

  it("o corpo diz o que falta, o que sobra e como corrigir", () => {
    const body = driftBody(driftReport())
    expect(body).toContain("PII Allowlist Guard (user payload projection)")
    expect(body).toContain("Legacy Check")
    expect(body).toContain("ci:required-checks -- --apply")
    // Título estável: identifica a issue entre runs sem depender do conteúdo.
    expect(driftTitle()).toContain("ci/required-checks.json")
    expect(ISSUE_LABEL).toBe("required-checks-drift")
  })
})
