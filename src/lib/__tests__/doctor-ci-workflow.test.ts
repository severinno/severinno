// =============================================================================
// doctor-ci-workflow.test.ts
//
// Trava o contrato do gate que confere o VALOR das repository variables a cada
// PR: `scripts/check-doctor-ci.mjs` nos DOIS pipelines (o job `guards` da forja,
// dona do merge, e o espelho do GitHub).
//
// POR QUE ESTE TESTE EXISTE: o gate é uma LINHA de YAML, e três detalhes dela
// decidem se ele prova alguma coisa — nenhum é visível no review:
//
//   1. `run:` de UMA LINHA. O doctor executa a bateria do job `guards` por
//      lista de argumentos (`gateRunLine`/`gateCommand`), e um `run: |` com o
//      comando lá dentro é INVISÍVEL para ele: o gate existiria no YAML e
//      sumiria da bateria (e do teste que prova que todo gate é executável).
//   2. as `vars` vêm SEM FALLBACK. O env do workflow do GitHub traz
//      `IMAGE_REGISTRY || 'ghcr.io'`; comparar contra um fallback declarado no
//      YAML é comparar contra intenção, nunca contra o valor — o espelho velho
//      passaria com o default do próprio YAML.
//   3. o gate é CORE: se ele rodasse numa forja só, o PR passaria verde por
//      onde rodou e a invariante que ficou de fora ninguém veria.
//
// A lógica (montar as flags, recusar régua vazia, traduzir o veredito) tem os
// próprios testes em check-doctor-ci.test.ts.
// =============================================================================

import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"
import yaml from "js-yaml"

import {
  CORE_INVARIANTS,
  GITHUB_ONLY,
  classifyGate,
  discoverGates,
} from "../../../scripts/check-forge-parity.mjs"
import { MIRROR_VARIABLES } from "../../../scripts/check-actrc-sync.mjs"

const CWD = process.cwd()
const GATE = "check-doctor-ci.mjs"

type Step = { name?: string; env?: Record<string, string>; run?: string }
type Workflow = {
  env?: Record<string, string>
  jobs: Record<string, { name?: string; steps: Step[] }>
}

/**
 * Os pipelines comparados, com o interpretador que cada imagem garante.
 *
 * Os dois lados invocam o gate pelo MESMO literal (`node scripts/check-doctor-ci.mjs`)
 * — era `bun scripts/...` na forja e `node scripts/...` no espelho, duas formas
 * do mesmo script. `node` é garantido nas duas imagens: a base
 * `catthehacker/ubuntu:act-latest` do runner da forja já embarca node 24 (é o
 * interpretador das JS actions como actions/checkout e actions/cache — ver
 * `Dockerfile.ubuntu-bun`), e o self-hosted do espelho também o tem. `node`
 * também não depende de `bun` estar no PATH: a régua não é o lançador, é o
 * script e os argumentos.
 */
const PIPELINES = [
  { file: ".gitea/workflows/ci.yml", job: "guards", interpreter: "node" },
  { file: ".github/workflows/pr-check.yml", job: "doctor-mirrors-guard", interpreter: "node" },
] as const

const load = (file: string): Workflow =>
  yaml.load(readFileSync(join(CWD, file), "utf8")) as Workflow

/** O passo do gate naquele pipeline (falha explicitamente se ele sumiu). */
function gateStep(pipeline: (typeof PIPELINES)[number]): Step {
  const steps = load(pipeline.file).jobs[pipeline.job]?.steps ?? []
  const step = steps.find((s) => (s.run ?? "").includes(GATE))
  expect(step, `o gate ${GATE} sumiu de ${pipeline.file} (job ${pipeline.job})`).toBeTruthy()
  return step as Step
}

describe("o gate do doctor existe nos DOIS pipelines (invariante CORE)", () => {
  it("os dois lados chamam o MESMO script (uma régua, duas forjas)", () => {
    for (const pipeline of PIPELINES) {
      expect(gateStep(pipeline).run).toContain(GATE)
    }
  })

  it("a linha é `run:` de UMA linha, com o interpretador da imagem", () => {
    for (const pipeline of PIPELINES) {
      const run = gateStep(pipeline).run ?? ""
      // Sem `|`/`>` e sem quebra: é o que faz o doctor conseguir executá-la por
      // lista de argumentos na bateria.
      expect(run.includes("\n"), `${pipeline.file}: o gate virou bloco`).toBe(false)
      expect(run.trim().split(/\s+/)[0]).toBe(pipeline.interpreter)
    }
  })

  it("o comando é IDÊNTICO nas duas forjas (não só o script)", () => {
    // A metade que escapava: os dois lados citavam o mesmo script, mas um pelo
    // caminho e outro pela entrada do package.json. A régua agora é o LITERAL.
    const runs = PIPELINES.map((p) => (gateStep(p).run ?? "").trim())
    expect(runs[0]).toBe(runs[1])
  })

  it("a classificação é CORE (e não uma isenção GitHub-only escondida)", () => {
    expect(classifyGate(`scripts/${GATE}`)).toBe("core")
    expect(GITHUB_ONLY.some((g) => g.matches.test(`scripts/${GATE}`))).toBe(false)
    expect(discoverGates(readFileSync(join(CWD, PIPELINES[0].file), "utf8"))).toContain(
      `scripts/${GATE}`,
    )
  })

  it("a invariante do CORE tem razão escrita (o porquê sobrevive ao código)", () => {
    const inv = CORE_INVARIANTS.find((i) => i.id === "doctor-ci")
    expect(inv, "a invariante doctor-ci sumiu do CORE").toBeTruthy()
    expect(inv?.matches.test(`scripts/${GATE}`)).toBe(true)
    // O `why` é o que o guard imprime quando o gate falta numa pipeline: sem ele
    // o diagnóstico seria "faltou" e não "por que isso importa".
    expect(inv?.why ?? "").toContain("VALOR")
    expect((inv?.why ?? "").length).toBeGreaterThan(80)
  })
})

describe("as repository variables descem SEM FALLBACK", () => {
  it("cada variável comparada chega ao gate pelo env, resolvida de `vars.*`", () => {
    for (const pipeline of PIPELINES) {
      const step = gateStep(pipeline)
      const wfEnv = load(pipeline.file).env ?? {}
      for (const name of MIRROR_VARIABLES) {
        // O passo SOBRESCREVE o env do workflow quando o declara (é o caso do
        // GitHub, cujo env traz fallback); na forja o `BUN_VERSION` já vem do
        // env do workflow — a MESMA variável que o setup-bun usou.
        const resolved = step.env?.[name] ?? wfEnv[name]
        expect(resolved, `${pipeline.file}: '${name}' não chega ao gate`).toBe(
          `\${{ vars.${name} }}`,
        )
        // O veneno: um `|| 'ghcr.io'` (o default histórico do env do workflow)
        // faria o gate comparar contra o fallback — e o espelho desatualizado
        // passaria verde, porque o valor declarado É o fallback. Uma linha com
        // fallback NÃO passa por aqui, venha ela do passo ou do workflow.
        const line = (step.run ?? "").includes("||") ? "o run do passo" : resolved
        expect(line).not.toContain("||")
      }
    }
  })

  it("o env do WORKFLOW do GitHub tem fallback — é por isso que o passo o sobrescreve", () => {
    // Sem esta asserção o teste acima poderia estar provando o nada: se o env do
    // workflow já fosse o valor cru, o override do passo seria decoração.
    const wfEnv = load(PIPELINES[1].file).env ?? {}
    expect(wfEnv.IMAGE_REGISTRY).toContain("||")
    expect(wfEnv.IMAGE_NAMESPACE).toContain("||")
    expect(gateStep(PIPELINES[1]).env?.IMAGE_REGISTRY).toBe("${{ vars.IMAGE_REGISTRY }}")
  })
})
