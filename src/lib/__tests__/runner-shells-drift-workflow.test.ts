/**
 * runner-shells-drift-workflow.test.ts
 *
 * Trava o job PERIÓDICO `runner-shells-drift` do
 * .github/workflows/benchmark-weekly.yml — o canal acionável do drift entre os
 * shells que a imagem do runner embarca e o que o gate DECLARA.
 *
 * POR QUE ESTE TESTE EXISTE: a declaração (`RUNNER_SHELLS`/`RUNNER_SHELLS_MISSING`)
 * é uma medição com data, e ela só governa o veredito do PRÓPRIO gate de sintaxe
 * — se a base da imagem mudar, nenhum outro gate fica vermelho. Quem re-mede é
 * este cron. Três peças podem se soltar sem que nada no CI reclame:
 *
 *   1. a ORDEM: o passo que FALHA tem de ser o ÚLTIMO. Se ele viesse antes, o
 *      passo da issue nunca rodaria e o drift voltaria a ser cron vermelho SEM
 *      ticket — exatamente o defeito que o job existe para eliminar;
 *   2. o `always()` do publicador: ele roda nos DOIS sentidos (publicar a dívida
 *      e FECHAR quando a medição volta a bater). Condicioná-lo ao drift faria o
 *      fechamento sumir em silêncio no ÚNICO run capaz de fechá-lo;
 *   3. a MEDIÇÃO ÚNICA: o publicador lê o relatório que o passo de medição
 *      gravou (`--report`), em vez de medir de novo — duas medições poderiam
 *      discordar sobre o que é drift.
 *
 * E `--dry-run` é proibido aqui: o modo não toca no backend de propósito, e a
 * reconciliação sumiria em silêncio dentro de um run verde.
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"
import yaml from "js-yaml"

import { MANIFEST_PATH, jobBlock } from "../../../scripts/check-periodic-alerts.mjs"

const CWD = process.cwd()
const WF_PATH = ".github/workflows/benchmark-weekly.yml"
const JOB = "runner-shells-drift"
const REPORT = "/tmp/runner-shells.json"

type Step = { name?: string; env?: Record<string, string>; run?: string; if?: string; id?: string }
type Workflow = {
  jobs: Record<string, { name?: string; steps: Step[]; permissions?: Record<string, string> }>
}

const wfContent = (): string => readFileSync(join(CWD, WF_PATH), "utf8")

function steps(): Step[] {
  return (yaml.load(wfContent()) as Workflow).jobs[JOB]?.steps ?? []
}

const runOf = (needle: string): Step => {
  const step = steps().find((s) => (s.run ?? "").includes(needle))
  expect(step, `o passo que roda '${needle}' sumiu de ${WF_PATH} (job ${JOB})`).toBeTruthy()
  return step as Step
}

const measurementStep = (): Step => runOf("runner-shells.mjs --json")
const publisherStep = (): Step => runOf("runner-shells-issue.mjs")

describe("o job periódico dos shells da imagem", () => {
  it("existe, é semanal e tem a permissão de escrever issues (o canal)", () => {
    const wf = yaml.load(wfContent()) as Workflow & {
      on?: Record<string, unknown>
      permissions?: Record<string, string>
    }
    expect(wf.jobs[JOB]).toBeTruthy()
    // O cron do arquivo é semanal — o job herda a agenda do workflow.
    const agenda = (wf.on?.schedule ?? []) as Record<string, string>[]
    expect(Object.keys(agenda[0] ?? {})).toContain("cron")
    // A permissão EFETIVA é a do job, quando declarada, senão a do workflow:
    // sem `issues: write` não há ticket, e o alerta volta a ser mudo.
    expect(wf.jobs[JOB].permissions?.issues ?? wf.permissions?.issues).toBe("write")
  })

  it("puxa a imagem e mede com o MESMO script do gate (o relatório é gravado)", () => {
    const pull = steps().find((s) => (s.run ?? "").includes("docker pull"))
    expect(pull, "o pull da imagem do runner sumiu: o probe roda DENTRO dela").toBeTruthy()
    expect(pull!.run).toContain("ubuntu-bun")
    const medicao = measurementStep()
    expect(medicao.run).toContain(`--report ${REPORT}`)
    expect(medicao.id).toBeTruthy()
    // A medição NÃO falha aqui (quem falha é o último passo): ela publica o
    // `state` e o `exit_code` como saída, para o publicador e o desfecho lerem.
    expect(medicao.run).toContain("state=")
    expect(medicao.run).toContain("exit_code=")
    expect(medicao.run).toContain("report=")
    // O `state` é o que separa "mediu e divergiu" de "não consegui medir": é
    // dele que o passo final decide QUAL remédio nomear.
    const desfecho = steps()[steps().length - 1]
    expect(desfecho.run).toContain(`steps.${medicao.id}.outputs.state`)
  })

  it("o publicador roda em `always()` e lê o relatório da medição (não mede de novo)", () => {
    const publicador = publisherStep()
    expect(publicador.if).toContain("always()")
    expect(publicador.run).toContain(`--report ${REPORT}`)
    // Sem --dry-run: o modo não toca no backend, e a reconciliação sumiria.
    expect(publicador.run).not.toContain("--dry-run")
    expect(publicador.env?.GH_TOKEN).toBeTruthy()
  })

  it("o passo que FALHA é o ÚLTIMO do job (a issue é publicada ANTES)", () => {
    const nomes = steps().map((s) => s.name ?? "")
    const falha = steps().findIndex((s) => (s.run ?? "").includes("::error::"))
    expect(falha).toBeGreaterThan(-1)
    expect(falha).toBe(steps().length - 1)
    expect(nomes[falha]).toMatch(/Fail on drift/)
    // E o publicador vem antes dele.
    expect(steps().indexOf(publisherStep())).toBeLessThan(falha)
  })

  it("o job está classificado no manifesto com o canal ISSUE e a evidência presente", () => {
    const manifest = JSON.parse(readFileSync(join(CWD, MANIFEST_PATH), "utf8"))
    const entry = manifest.forges.github.find(
      (e: { workflow: string; job: string }) => e.workflow === WF_PATH && e.job === JOB,
    )
    expect(entry, `${JOB} sem classificação em ${MANIFEST_PATH}`).toBeTruthy()
    expect(entry.channel).toBe("issue")
    // A evidência tem de estar NO BLOCO do job (é o que o guard verifica).
    expect(jobBlock(wfContent(), JOB)).toContain(entry.evidence)
    expect(entry.evidence).toBe("scripts/runner-shells-issue.mjs")
    // O `why` declara a razão de o canal ser o ticket (o run vermelho é lembrança).
    expect(entry.why).toContain("não abre issue")
  })
})
