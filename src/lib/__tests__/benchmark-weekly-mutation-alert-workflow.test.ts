/**
 * benchmark-weekly-mutation-alert-workflow.test.ts
 *
 * Trava o CONTRATO DO CANAL do overhead do mutation-coord: os dois jobs de
 * medição terminam verdes de propósito (::warning::), então o alerta precisa de
 * um job que PUBLIQUE a issue e FECHA a dívida — este é o defeito que a
 * auditoria dos jobs periódicos corrigiu (`ci/periodic-alerts.json`).
 *
 * O que é travado aqui (as mutações que este teste pega):
 *   1. o job existe, espera OS DOIS medidores (`needs`) e roda sempre
 *      (`if: always()`), senão o alerta sumiria justamente quando um deles
 *      falha;
 *   2. tem `issues: write` — sem isso o publicador não consegue abrir/comentar;
 *   3. baixa os artifacts dos DOIS relatórios (é o que permite um publicador
 *      só, com um reconciliador só: limiar aninhado não pode ser presumido);
 *   4. o step do publicador FALHA quando nenhum relatório foi baixado —
 *      "não medido" não pode passar como verde;
 *   5. o script existe (contra o check-workflow-refs) e é o MESMO que tem os
 *      testes de ciclo (dedup + fechamento).
 */

import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import yaml from "js-yaml"
import { extractScriptRefs } from "../../../scripts/check-workflow-refs.mjs"

const CWD = process.cwd()
const WF_PATH = join(CWD, ".github", "workflows", "benchmark-weekly.yml")
const JOB_KEY = "mutation-coord-alert"

const content = readFileSync(WF_PATH, "utf8")
const parsed = yaml.load(content) as {
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
const scripts = new Set(readdirSync(join(CWD, "scripts")))

describe("benchmark-weekly.yml — job mutation-coord-alert (o canal dos ::warning::)", () => {
  it("existe e parseia como YAML válido", () => {
    expect(job, `${JOB_KEY} precisa existir (o aviso não pode ficar sem canal)`).toBeDefined()
    expect(job?.name).toContain("overhead")
  })

  it("espera OS DOIS medidores e roda sempre (mede também quando um deles falha)", () => {
    expect(job?.needs).toEqual(["mutation-coord-timing", "mutation-coord-trend"])
    expect(job?.if).toBe("always()")
  })

  it("tem issues: write (sem isso o canal do aviso não existe)", () => {
    expect(job?.permissions).toMatchObject({
      contents: "read",
      actions: "read",
      issues: "write",
    })
  })

  it("baixa os artifacts dos DOIS relatórios (um publicador, um reconciliador)", () => {
    const download = steps.find((s) => s.uses?.startsWith("actions/download-artifact"))
    expect(download).toBeDefined()
    expect(download?.if).toBe("always()")
    expect(download?.with).toMatchObject({
      pattern: "mutation-coord-*",
      "merge-multiple": true,
      path: "/tmp/mutation-alert",
    })
  })

  it("publica via o publicador de issue, com GH_TOKEN e fail-closed sem relatório", () => {
    const publish = steps.find((s) => (s.run ?? "").includes("scripts/mutation-trend-issue.mjs"))
    expect(publish).toBeDefined()
    expect(publish?.if).toBe("always()")
    expect(publish?.env).toEqual({ GH_TOKEN: "${{ github.token }}" })
    const run = publish?.run ?? ""
    // Um --report por relatório encontrado (o `find` resolve o layout REAL do
    // artifact em vez de cravar um caminho).
    expect(run).toContain("mapfile -t REPORTS")
    expect(run).toContain('ARGS+=(--report "$report")')
    // Sem nenhum relatório o step FALHA: 'não medido' não pode parecer verde.
    expect(run).toContain('"${#REPORTS[@]}" -eq 0')
    expect(run).toContain("exit 1")
  })

  it("o primeiro step é o checkout", () => {
    expect(steps[0]?.uses).toBe("actions/checkout@v4")
  })

  it("o script do publicador existe (o ref não aponta para o vazio)", () => {
    const refs = extractScriptRefs(content)
    expect(refs.find((r) => r.ref === "mutation-trend-issue.mjs")).toBeDefined()
    expect(scripts.has("mutation-trend-issue.mjs")).toBe(true)
  })
})
