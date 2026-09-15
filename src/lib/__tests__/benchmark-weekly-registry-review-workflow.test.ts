/**
 * benchmark-weekly-registry-review-workflow.test.ts
 *
 * Trava o job PERIÓDICO `registry-allowlist-review` do
 * .github/workflows/benchmark-weekly.yml — o canal acionável da REVISÃO das
 * allowlists: as decisões de escopo e de terceiros (invariante 8 do
 * check-registry-source) e a allowlist de deps de uso implícito
 * (check-unused-deps).
 *
 * POR QUE ESTE TESTE EXISTE: os guards registram QUANDO cada isenção foi tomada
 * (`addedAt`) e, passada a janela (180 dias), o run normal só AVISA
 * (`::warning::`) — mudo por desenho dentro de um run verde. Quem transforma o
 * aviso em sinal LIDO é este job: ele roda os dois guards com `--review`, que
 * escala a decisão vencida a VIOLAÇÃO (exit 1). Se o `--review` sumir de uma das
 * linhas (ou um dos passos for removido, ou o job for renomeado sem atualizar o
 * manifesto), a isenção daquela lista volta a envelhecer em silêncio — e nada no
 * CI reclamaria. Aqui as peças ficam presas juntas: o job, os comandos (um por
 * guard) e a classificação no `ci/periodic-alerts.json`.
 *
 * O comando é HERMÉTICO de propósito (`--no-compose-render`, sem rede e com as
 * vars do registry esvaziadas): a pergunta do job é só a revisão da isenção —
 * as outras invariantes do guard têm os seus próprios gates, com o ambiente
 * real. O teste trava esse recorte para o job não virar um guard genérico que
 * falha por motivo alheio à revisão.
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"
import yaml from "js-yaml"

import { MANIFEST_PATH, jobBlock } from "../../../scripts/check-periodic-alerts.mjs"
import { OUT_OF_SCOPE_REVIEW_DAYS, parseAddedAt } from "../../../scripts/check-registry-source.mjs"

const CWD = process.cwd()
const WF_PATH = ".github/workflows/benchmark-weekly.yml"
const JOB = "registry-allowlist-review"

const wfContent = (): string => readFileSync(join(CWD, WF_PATH), "utf8")

type Step = { name?: string; env?: Record<string, string>; run?: string }
type Workflow = { jobs: Record<string, { name?: string; steps: Step[] }> }

/** Os passos do job (o gate tem um por allowlist — a falha de um não cobre a outra). */
function steps(): Step[] {
  return (yaml.load(wfContent()) as Workflow).jobs[JOB]?.steps ?? []
}

/** O passo do gate do review do check-registry-source (falha se ele sumiu). */
function reviewStep(): Step {
  const step = steps().find((s) => (s.run ?? "").includes("check-registry-source.mjs"))
  expect(step, `o passo do review sumiu de ${WF_PATH} (job ${JOB})`).toBeTruthy()
  return step as Step
}

/** O passo do gate da ALLOWLIST de deps de uso implícito (o OUTRO guard). */
function depsReviewStep(): Step {
  const step = steps().find((s) => (s.run ?? "").includes("check-unused-deps.mjs"))
  expect(
    step,
    `o passo da revisão da ALLOWLIST de deps sumiu de ${WF_PATH} (job ${JOB}) — sem ele a isenção de uso implícito envelhece em silêncio`,
  ).toBeTruthy()
  return step as Step
}

describe("o job de revisão das decisões de escopo é o canal do aviso mudo", () => {
  it("roda o guard no modo --review (o aviso do run normal vira VIOLAÇÃO aqui)", () => {
    const run = reviewStep().run ?? ""
    expect(run).toContain("check-registry-source.mjs")
    expect(run).toContain("--review")
  })

  it("é hermético: sem render do compose e sem consultar o registry", () => {
    const run = reviewStep().run ?? ""
    expect(run).toContain("--no-compose-render")
    expect(run).toContain("--no-registry-probe")
  })

  it("esvazia as vars da imagem para a invariante 9 ficar fora da conta", () => {
    // Com `vars.IMAGE_REGISTRY` no env, a invariante 9 compara o valor do
    // AMBIENTE × os espelhos e o job poderia ficar vermelho por drift de
    // registry — outra pergunta, com outro gate. Aqui a pergunta é a revisão.
    const env = reviewStep().env ?? {}
    expect(env.IMAGE_REGISTRY).toBe("")
    expect(env.IMAGE_NAMESPACE).toBe("")
  })

  it("o canal está DECLARADO (fail) e a evidência existe no bloco do job", () => {
    const manifest = JSON.parse(readFileSync(join(CWD, MANIFEST_PATH), "utf8")) as {
      forges: { github: { workflow: string; job: string; channel?: string; evidence?: string }[] }
    }
    const entry = manifest.forges.github.find((e) => e.job === JOB)
    expect(entry, `${JOB} sem entrada no ${MANIFEST_PATH}`).toBeTruthy()
    expect(entry?.workflow).toBe(WF_PATH)
    expect(entry?.channel).toBe("fail")
    // A evidência precisa VIVER no bloco do job (não no arquivo): é o que o
    // check:periodic-alerts cobra — um canal declarado e não implementado é o
    // defeito que o guard existe para pegar.
    expect(jobBlock(wfContent(), JOB)).toContain(entry?.evidence ?? "\u0000")
  })

  it("a janela de revisão existe e é um número positivo de dias", () => {
    expect(Number.isInteger(OUT_OF_SCOPE_REVIEW_DAYS)).toBe(true)
    expect(OUT_OF_SCOPE_REVIEW_DAYS).toBeGreaterThan(0)
    expect(parseAddedAt("2026-09-13")).not.toBeNull()
  })

  // A segunda allowlist do repositório tem o MESMO defeito estrutural (uma dep de
  // uso implícito isenta para sempre) e o MESMO canal: se o passo sumir, a
  // entrada vencida volta a ser um `::warning::` mudo dentro de um run verde — o
  // defeito que o `check:periodic-alerts` proíbe. Por isso o passo é travado
  // aqui, junto do `--review` que o transforma em exit 1.
  it("revisa TAMBÉM a ALLOWLIST do check-unused-deps, no modo --review", () => {
    const run = depsReviewStep().run ?? ""
    expect(run).toContain("check-unused-deps.mjs")
    expect(run).toContain("--review")
  })
})
