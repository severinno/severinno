/**
 * check-mutation-timing-contract.test.ts
 *
 * Testes do scripts/check-mutation-timing-contract.mjs — o guard que valida
 * que os MARKERS DE CONTRATO do step de mutation-coord estão CONSISTENTES
 * entre os QUATRO locais que os duplicam (travando o drift script↔teste):
 *
 *   1. .github/workflows/seed-guards.yml          — FONTE DA VERDADE
 *   2. scripts/measure-mutation-timing.mjs        — markers SUBSTRING (.includes())
 *   3. scripts/test-mutation-timing-budget.sh     — JOB_NAME=/STEP_NAME=
 *   4. src/lib/__tests__/measure-mutation-timing.test.ts — literais dos fixtures
 *
 * Cobre (padrão dos testes de guards — funções puras + CLI real):
 *   - extractMedidorMarkers: os exports JOB_NAME_MARKER/STEP_NAME_MARKER
 *   - extractSeedGuardsJobs: pares job→steps com ESCALA DE JOB (o seed-dev
 *     E2E também tem 'Mutation Test'/'Run mutation test' — o step do contrato
 *     é o DENTRO do job do contrato, espelho do medidor)
 *   - extractMutationTestNames: JOB_NAME=/STEP_NAME= do mutation test
 *   - extractUnitTestLiterals: literais "Mutation Test (...)"/"Run mutation
 *     test (...)" do teste unitário (incl. o fixture negativo seed-dev)
 *   - checkMutationTimingContract: cada direção de drift:
 *       • marker do medidor sem job/step real correspondente (renomeou no YML)
 *       • JOB_NAME/STEP_NAME do mutation test divergente da fonte
 *       • teste unitário sem o literal do job/step real (fixtures defasadas)
 *       • DISCRIMINAÇÃO: literal de job com o marker que não é o job do
 *         contrato (marker amplo demais — o fixture negativo casaria)
 *       • AMBIGUIDADE: 2+ jobs com o marker do job ou 2+ steps no job do
 *         contrato (o .find() do medidor pegaria o primeiro em silêncio)
 *       • medidor sem os exports (estrutura quebrada → infra-like)
 *   - CLI real: --root com fixture consistente → exit 0; drift → exit 1;
 *     arquivo ausente → exit 2; --root sem caminho → exit 2
 *   - regressão REAL do repo (ground truth — o contrato atual deve passar)
 *
 * Usage:
 *   npx vitest run --config vitest.config.unit.ts src/lib/__tests__/check-mutation-timing-contract.test.ts
 */

import { describe, it, expect } from "vitest"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  extractMedidorMarkers,
  extractSeedGuardsJobs,
  extractMutationTestNames,
  extractUnitTestLiterals,
  checkMutationTimingContract,
  isValidGitRef,
} from "../../../scripts/check-mutation-timing-contract.mjs"

const SCRIPT = join(process.cwd(), "scripts", "check-mutation-timing-contract.mjs")

// ── Nomes REAIS do seed-guards.yml (a fonte da verdade) ──────────────────

const CONTRACT_JOB = "Mutation Test (contrato coordenado — doc↔anchor↔código)"
const CONTRACT_STEP = "Run mutation test (contrato coordenado — 5 cenários, 2 elos)"
const SEED_DEV_JOB = "Mutation Test (seed dev E2E pega regressões?)"
const SEED_DEV_STEP = "Run mutation test (seed dev E2E deve FALHAR)"
const JOB_MARKER = "contrato coordenado"
const STEP_MARKER = "Run mutation test"

// ── Fixtures dos 4 arquivos do contrato ──────────────────────────────────

/** Conteúdo do seed-guards.yml com os DOIS jobs (contrato + seed-dev E2E). */
function seedGuardsContent(jobName = CONTRACT_JOB, stepName = CONTRACT_STEP) {
  return `name: Seed Guards

on:
  workflow_dispatch:

jobs:
  seed-dev-e2e:
    name: ${SEED_DEV_JOB}
    runs-on: ubuntu-latest
    steps:
      - name: Run mutation test (seed dev E2E deve FALHAR)
        run: echo seed
  mutation-coord-update:
    name: ${jobName}
    runs-on: ubuntu-latest
    steps:
      - name: ${stepName}
        run: echo coord
`
}

/** Conteúdo do medidor com os markers SUBSTRING. */
function medidorContent(jobMarker = JOB_MARKER, stepMarker = STEP_MARKER) {
  return `export const JOB_NAME_MARKER = "${jobMarker}"
export const STEP_NAME_MARKER = "${stepMarker}"
`
}

/** Conteúdo do mutation test com os nomes completos. */
function mutationTestContent(jobName = CONTRACT_JOB, stepName = CONTRACT_STEP) {
  return `#!/usr/bin/env bash
JOB_NAME="${jobName}"
STEP_NAME="${stepName}"
`
}

/** Conteúdo do teste unitário com os literais dos fixtures. */
function unitTestContent(
  jobName = CONTRACT_JOB,
  stepName = CONTRACT_STEP,
  extraJobLiterals: string[] = [],
) {
  const extras = extraJobLiterals.map((j) => `      "name": "${j}",`).join("\n")
  return `import { extractMutationStep } from "../../../scripts/measure-mutation-timing.mjs"

const payload = {
  jobs: [
    {
      name: "${SEED_DEV_JOB}",
      steps: [{ name: "${SEED_DEV_STEP}" }],
    },
    {
      name: "${jobName}",
      steps: [{ name: "${stepName}" }],
    },
    ${extras}
  ],
}
expect(extractMutationStep(payload)).not.toBeNull()
`
}

/** Monta a árvore de fixture no disco e devolve o root. */
function writeFixtureTree(opts: {
  seedGuards?: string
  medidor?: string
  mutationTest?: string
  unitTest?: string
  skip?: string
}) {
  const root = mkdtempSync(join(tmpdir(), "mt-contract-"))
  const write = (rel: string, content: string | undefined) => {
    if (content === undefined) return
    const abs = join(root, rel)
    mkdirSync(join(abs, ".."), { recursive: true })
    writeFileSync(abs, content)
  }
  write(".github/workflows/seed-guards.yml", opts.seedGuards ?? seedGuardsContent())
  write("scripts/measure-mutation-timing.mjs", opts.medidor ?? medidorContent())
  write("scripts/test-mutation-timing-budget.sh", opts.mutationTest ?? mutationTestContent())
  write("src/lib/__tests__/measure-mutation-timing.test.ts", opts.unitTest ?? unitTestContent())
  if (opts.skip) {
    rmSync(join(root, opts.skip), { recursive: true, force: true })
  }
  return root
}

function runCli(args: string[]) {
  const res = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" })
  return { status: res.status ?? -1, stdout: `${res.stdout ?? ""}${res.stderr ?? ""}` }
}

// ── isValidGitRef (modo --staged) ────────────────────────────────────────

describe("isValidGitRef", () => {
  it("aceita refs comuns (HEAD, origin/main, tags, sha)", () => {
    expect(isValidGitRef("HEAD")).toBe(true)
    expect(isValidGitRef("origin/main")).toBe(true)
    expect(isValidGitRef("v0.4.0")).toBe(true)
    expect(isValidGitRef("a1b2c3d4e5f6")).toBe(true)
  })

  it("rejeita metacharacters de shell/argumento (injeção — execFileSync sem shell, mas ref inválida falharia com mensagem confusa)", () => {
    expect(isValidGitRef("main; rm -rf /")).toBe(false)
    expect(isValidGitRef("HEAD --all")).toBe(false)
    expect(isValidGitRef("$(echo x)")).toBe(false)
    expect(isValidGitRef("refs/heads/feat~1")).toBe(false) // ~ é válido p/ git, mas fora do whitelist — fail-closed
  })

  it("rejeita vazio e whitespace", () => {
    expect(isValidGitRef("")).toBe(false)
    expect(isValidGitRef(" ")).toBe(false)
  })
})

// ── Extractors (funções puras) ───────────────────────────────────────────

describe("extractMedidorMarkers", () => {
  it("extrai os exports JOB_NAME_MARKER/STEP_NAME_MARKER", () => {
    expect(extractMedidorMarkers(medidorContent())).toEqual({
      jobMarker: JOB_MARKER,
      stepMarker: STEP_MARKER,
    })
  })

  it("retorna null quando um export está ausente (estrutura quebrada → fail-closed)", () => {
    expect(extractMedidorMarkers("export const JOB_NAME_MARKER = 'x'")).toBeNull()
    expect(extractMedidorMarkers("")).toBeNull()
  })
})

describe("extractSeedGuardsJobs", () => {
  it("extrai pares job→steps com ESCALA DE JOB (o step do seed-dev não vaza para o contrato)", () => {
    const jobs = extractSeedGuardsJobs(seedGuardsContent())
    expect(jobs).toEqual([
      { jobName: SEED_DEV_JOB, stepNames: [SEED_DEV_STEP] },
      { jobName: CONTRACT_JOB, stepNames: [CONTRACT_STEP] },
    ])
  })

  it("retorna [] em conteúdo sem nenhum job 'Mutation Test (...)'", () => {
    expect(extractSeedGuardsJobs("name: outro")).toEqual([])
  })

  it("extrai múltiplos steps dentro de um mesmo job (lista ordenada)", () => {
    const content = `jobs:
  mutation-coord-update:
    name: ${CONTRACT_JOB}
    steps:
      - name: Run mutation test (contrato coordenado — 5 cenários, 2 elos)
      - name: Run mutation test (seed dev E2E deve FALHAR)
      - name: Run mutation test (outro cenário)
`
    expect(extractSeedGuardsJobs(content)).toEqual([
      {
        jobName: CONTRACT_JOB,
        stepNames: [CONTRACT_STEP, SEED_DEV_STEP, "Run mutation test (outro cenário)"],
      },
    ])
  })
})

describe("extractMutationTestNames", () => {
  it("extrai JOB_NAME/STEP_NAME do mutation test", () => {
    expect(extractMutationTestNames(mutationTestContent())).toEqual({
      jobName: CONTRACT_JOB,
      stepName: CONTRACT_STEP,
    })
  })

  it("retorna null quando as vars não existem", () => {
    expect(extractMutationTestNames("#!/usr/bin/env bash\n")).toEqual({
      jobName: null,
      stepName: null,
    })
  })
})

describe("extractUnitTestLiterals", () => {
  it("extrai literais de job E step, incluindo o fixture negativo seed-dev", () => {
    const { jobNames, stepNames } = extractUnitTestLiterals(unitTestContent())
    expect(jobNames).toContain(CONTRACT_JOB)
    expect(jobNames).toContain(SEED_DEV_JOB)
    expect(stepNames).toContain(CONTRACT_STEP)
    expect(stepNames).toContain(SEED_DEV_STEP)
  })

  it("deduplica literais repetidos", () => {
    const { jobNames, stepNames } = extractUnitTestLiterals(unitTestContent())
    expect(new Set(jobNames).size).toBe(jobNames.length)
    expect(new Set(stepNames).size).toBe(stepNames.length)
  })
})

// ── checkMutationTimingContract: contrato consistente ────────────────────

describe("checkMutationTimingContract", () => {
  const consistentInput = {
    markers: { jobMarker: JOB_MARKER, stepMarker: STEP_MARKER },
    seedJobs: extractSeedGuardsJobs(seedGuardsContent()),
    mutationTestNames: { jobName: CONTRACT_JOB, stepName: CONTRACT_STEP },
    unitJobNames: extractUnitTestLiterals(unitTestContent()).jobNames,
    unitStepNames: extractUnitTestLiterals(unitTestContent()).stepNames,
  }

  it("passa com os 4 locais consistentes (fixture real)", () => {
    expect(checkMutationTimingContract(consistentInput)).toEqual([])
  })

  it("passa MESMO com o seed-dev E2E tendo 'Mutation Test'/'Run mutation test' — escopo de job isola o contrato", () => {
    // o fixture real TEM o job/step seed-dev; o guard não pode acusar (o
    // medidor também ignora por escopo de job). Este teste trava o caso.
    expect(checkMutationTimingContract(consistentInput)).toEqual([])
  })

  it("falha fail-closed quando os markers do medidor não são encontrados", () => {
    const violations = checkMutationTimingContract({ ...consistentInput, markers: null })
    expect(violations.length).toBe(1)
    expect(violations[0]).toContain("não encontrados no measure-mutation-timing.mjs")
  })
})

// ── checkMutationTimingContract: cada direção de drift ───────────────────

describe("checkMutationTimingContract — drift de markers", () => {
  const base = {
    markers: { jobMarker: JOB_MARKER, stepMarker: STEP_MARKER },
    seedJobs: extractSeedGuardsJobs(seedGuardsContent()),
    mutationTestNames: { jobName: CONTRACT_JOB, stepName: CONTRACT_STEP },
    unitJobNames: extractUnitTestLiterals(unitTestContent()).jobNames,
    unitStepNames: extractUnitTestLiterals(unitTestContent()).stepNames,
  }

  it("job do contrato renomeado no seed-guards (nenhum job casa o marker) → falha", () => {
    // renomeia o job do contrato para algo SEM o marker 'contrato coordenado'
    const input = {
      ...base,
      seedJobs: extractSeedGuardsJobs(
        seedGuardsContent("Mutation Test (validação da doc — 5 cenários)"),
      ),
    }
    const violations = checkMutationTimingContract(input)
    expect(violations.length).toBeGreaterThan(0)
    expect(violations[0]).toContain("nenhum job 'Mutation Test (...)'")
    expect(violations[0]).toContain(JOB_MARKER)
  })

  it("step do contrato renomeado (nenhum step no job casa o marker) → falha", () => {
    const input = {
      ...base,
      seedJobs: extractSeedGuardsJobs(
        seedGuardsContent(CONTRACT_JOB, "Run validação da doc (5 cenários)"),
      ),
    }
    const violations = checkMutationTimingContract(input)
    expect(violations.length).toBeGreaterThan(0)
    expect(violations[0]).toContain("nenhum step 'Run mutation test (...)'")
  })

  it("AMBIGUIDADE: 2+ jobs casam o marker do job → falha (o .find() pegaria o primeiro)", () => {
    const content = `jobs:
  a:
    name: Mutation Test (contrato coordenado — doc↔anchor↔código)
    steps:
      - name: Run mutation test (contrato coordenado — 5 cenários, 2 elos)
  b:
    name: Mutation Test (contrato coordenado — outro bloco)
    steps:
      - name: Run mutation test (outro)
`
    const violations = checkMutationTimingContract({
      ...base,
      seedJobs: extractSeedGuardsJobs(content),
    })
    expect(violations.length).toBe(1)
    expect(violations[0]).toContain("AMBIGUIDADE")
    expect(violations[0]).toContain("2 jobs")
  })

  it("AMBIGUIDADE: 2+ steps dentro do job do contrato casam o marker do step → falha", () => {
    const content = `jobs:
  a:
    name: ${CONTRACT_JOB}
    steps:
      - name: Run mutation test (contrato coordenado — 5 cenários, 2 elos)
      - name: Run mutation test (segundo cenário do contrato)
`
    const violations = checkMutationTimingContract({
      ...base,
      seedJobs: extractSeedGuardsJobs(content),
    })
    expect(violations.length).toBe(1)
    expect(violations[0]).toContain("AMBIGUIDADE")
    expect(violations[0]).toContain("2 steps")
  })
})

describe("checkMutationTimingContract — drift do mutation test vs fonte", () => {
  const base = {
    markers: { jobMarker: JOB_MARKER, stepMarker: STEP_MARKER },
    seedJobs: extractSeedGuardsJobs(seedGuardsContent()),
    mutationTestNames: { jobName: CONTRACT_JOB, stepName: CONTRACT_STEP },
    unitJobNames: extractUnitTestLiterals(unitTestContent()).jobNames,
    unitStepNames: extractUnitTestLiterals(unitTestContent()).stepNames,
  }

  it("JOB_NAME do mutation test divergente → falha citando os dois lados", () => {
    const violations = checkMutationTimingContract({
      ...base,
      mutationTestNames: { jobName: "Mutation Test (nome antigo)", stepName: CONTRACT_STEP },
    })
    expect(violations.length).toBe(1)
    expect(violations[0]).toContain("JOB_NAME do mutation test")
    expect(violations[0]).toContain("nome antigo")
    expect(violations[0]).toContain(CONTRACT_JOB)
  })

  it("STEP_NAME do mutation test divergente → falha", () => {
    const violations = checkMutationTimingContract({
      ...base,
      mutationTestNames: { jobName: CONTRACT_JOB, stepName: "Run mutation test (antigo)" },
    })
    expect(violations.length).toBe(1)
    expect(violations[0]).toContain("STEP_NAME do mutation test")
  })
})

describe("checkMutationTimingContract — drift do teste unitário vs fonte", () => {
  const base = {
    markers: { jobMarker: JOB_MARKER, stepMarker: STEP_MARKER },
    seedJobs: extractSeedGuardsJobs(seedGuardsContent()),
    mutationTestNames: { jobName: CONTRACT_JOB, stepName: CONTRACT_STEP },
    unitJobNames: extractUnitTestLiterals(unitTestContent()).jobNames,
    unitStepNames: extractUnitTestLiterals(unitTestContent()).stepNames,
  }

  it("teste unitário SEM o literal do job real → falha (fixtures defasadas)", () => {
    const unit = unitTestContent("Mutation Test (contrato coordenado — antigo)")
    const violations = checkMutationTimingContract({
      ...base,
      unitJobNames: extractUnitTestLiterals(unit).jobNames,
      unitStepNames: extractUnitTestLiterals(unit).stepNames,
    })
    expect(violations.some((v) => v.includes("não contém o job real"))).toBe(true)
    expect(violations.some((v) => v.includes(CONTRACT_JOB))).toBe(true)
  })

  it("teste unitário SEM o literal do step real → falha (fixtures defasadas)", () => {
    const unit = unitTestContent(CONTRACT_JOB, "Run mutation test (contrato — antigo)")
    const violations = checkMutationTimingContract({
      ...base,
      unitStepNames: extractUnitTestLiterals(unit).stepNames,
    })
    expect(violations.some((v) => v.includes("não contém o step real"))).toBe(true)
    expect(violations.some((v) => v.includes(CONTRACT_STEP))).toBe(true)
  })

  it("DISCRIMINAÇÃO: literal de job do teste com o marker que não é o job do contrato → falha", () => {
    // se o marker virar amplo demais (ex.: 'Mutation Test'), o fixture
    // negativo seed-dev casaria no medidor — o guard acusa o marker amplo
    const unit = unitTestContent(CONTRACT_JOB, CONTRACT_STEP, [
      "Mutation Test (contrato coordenado — bloco duplicado)",
    ])
    const violations = checkMutationTimingContract({
      ...base,
      unitJobNames: extractUnitTestLiterals(unit).jobNames,
    })
    expect(violations.some((v) => v.includes("marker amplo demais"))).toBe(true)
    expect(violations.some((v) => v.includes("bloco duplicado"))).toBe(true)
  })

  it("NÃO acusa o fixture negativo seed-dev como discriminação quebrada (escopo de job)", () => {
    // o literal 'Mutation Test (seed dev E2E pega regressões?)' NÃO contém o
    // marker 'contrato coordenado' — o seed-dev é IRRELEVANTE para a
    // discriminação do marker do contrato
    const violations = checkMutationTimingContract(base)
    expect(violations.filter((v) => v.includes("marker amplo demais"))).toEqual([])
  })
})

// ── CLI real (spawn) ─────────────────────────────────────────────────────

describe("check-mutation-timing-contract.mjs CLI", () => {
  it("--root com fixture consistente → exit 0", () => {
    const root = writeFixtureTree({})
    try {
      const { status, stdout } = runCli(["--root", root])
      expect(status).toBe(0)
      expect(stdout).toContain("Contrato de markers do mutation-coord consistente")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("--root com drift (JOB_NAME do mutation test divergente) → exit 1 com mensagem", () => {
    const root = writeFixtureTree({
      mutationTest: mutationTestContent("Mutation Test (nome divergente)"),
    })
    try {
      const { status, stdout } = runCli(["--root", root])
      expect(status).toBe(1)
      expect(stdout).toContain("inconsistente entre os 4 locais")
      expect(stdout).toContain("JOB_NAME do mutation test")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("--root com arquivo do contrato AUSENTE → exit 2 (infra fail-closed)", () => {
    const root = writeFixtureTree({ skip: "scripts/measure-mutation-timing.mjs" })
    try {
      const { status, stdout } = runCli(["--root", root])
      expect(status).toBe(2)
      expect(stdout).toContain("ausente")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("--root sem caminho → exit 2 (uso inválido)", () => {
    const { status, stdout } = runCli(["--root"])
    expect(status).toBe(2)
    expect(stdout).toContain("--root exige um caminho")
  })
})

// ── Regressão REAL do repo (ground truth) ────────────────────────────────

describe("checkMutationTimingContract — regressão real do repo", () => {
  it("o contrato atual do repo (4 locais) está consistente", () => {
    const { status, stdout } = runCli([])
    expect(status).toBe(0)
    expect(stdout).toContain("Contrato de markers do mutation-coord consistente")
    expect(stdout).toContain(CONTRACT_JOB)
    expect(stdout).toContain(CONTRACT_STEP)
  })
})
