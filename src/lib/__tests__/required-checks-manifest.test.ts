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
    "sentinel-producer-guard",
    "no-setup-bun-guard",
    "bun-mirror-guard",
    "bun-mirror-staged-guard",
    "mutation-jobs-staged-guard",
    "mutation-guards",
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
  [GITEA_CI]: ["lint", "typecheck", "test", "build", "deploy"],
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
    "Actionlint (workflow syntax)",
    "Lint Guard (prettier + eslint zero)",
    "TypeCheck (tsc --noEmit)",
    "check",
    "Security Headers",
    "PII Allowlist Guard (user payload projection)",
  ],
  gitea: ["Lint", "TypeCheck", "Tests", "Build"],
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
