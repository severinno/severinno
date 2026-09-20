/**
 * periodic-alert-channels.test.ts
 *
 * Prova que TODO job de workflow AGENDADO tem canal acionável declarado — a
 * auditoria dos jobs periódicos, travada como código.
 *
 * O defeito que isto impede: um cron que termina VERDE por desenho e só emite
 * `::warning::` é alerta MUDO (ninguém abre o log de um run que passou). O
 * repositório já corrigiu isso em seis publicadores; sem um guard, o SÉTIMO
 * volta na próxima vez que alguém escrever `continue-on-error` ou "só avisa".
 *
 * Duas camadas:
 *   1. o repositório REAL passa (e o número de jobs auditados é travado — se
 *      alguém adicionar um cron, a contagem muda e este teste exige a decisão);
 *   2. MUTAÇÕES — cada regra do guard derruba uma violação específica:
 *      cobertura, canal inválido, evidência ausente/fora do bloco, `via`
 *      inexistente, entrada para job/workflow que não existe.
 */

import { describe, it, expect } from "vitest"

import {
  ALLOWED_CHANNELS,
  MANIFEST_PATH,
  defaultIo,
  isScheduledWorkflow,
  jobBlock,
  scheduledJobBlocks,
  validatePeriodicAlerts,
} from "../../../scripts/check-periodic-alerts.mjs"

const io = defaultIo()
const realManifest = JSON.parse(io.readFile(MANIFEST_PATH) as string)

/** Manifesto sintético + workflows em memória (mutações sem tocar a árvore). */
function fixture(entries: Record<string, unknown>[], files: Record<string, string>) {
  const ioFake = {
    listWorkflows: () => Object.keys(files).map((path) => ({ path })),
    readFile: (path: string) => files[path] ?? null,
  }
  return validatePeriodicAlerts({ version: 1, forges: { github: entries } }, ioFake)
}

const SCHEDULED = [
  "on:",
  "  schedule:",
  '    - cron: "0 6 * * 1"',
  "jobs:",
  "  medidor:",
  "    name: Mede",
  "    steps:",
  "      - name: Medir",
  "        run: node scripts/measure.mjs",
  "  alerta:",
  "    name: Alerta",
  "    needs: [medidor]",
  "    steps:",
  "      - name: Publicar",
  "        run: node scripts/algo-issue.mjs",
  "",
].join("\n")

const WF = ".github/workflows/periodic.yml"

describe("o repositório REAL passa a auditoria", () => {
  it("todo job agendado está classificado, com o canal e a evidência presentes", () => {
    expect(validatePeriodicAlerts(realManifest, io)).toEqual([])
  })

  it("o manifesto cobre TODOS os jobs agendados das duas forjas (nada fica de fora)", () => {
    const jobs = scheduledJobBlocks(io)
    // Trava o tamanho: um cron NOVO muda a contagem e este teste exige que a
    // decisão (canal + evidência) seja escrita antes de o guard passar.
    // 32 desde `github-dependencies-audit` (o inventário do GitHub é remedido e
    // uma dependência NOVA vira issue acionável, com fechamento automático
    // quando o item sai do repositório); antes dele, 31 desde `merge-gate-proof`
    // (o veredito da prova do bloqueio de merge vira issue acionável, com
    // fechamento automático quando o registro volta a bater); antes dele, 30
    // desde `runner-shells-drift` (benchmark-weekly: o conjunto de shells da
    // imagem do runner é remedido e comparado com o declarado); antes, 29 desde
    // `guard-timing-alert` (a regressão de tempo do bench-guard-timing).
    expect(jobs.map((j) => `${j.path}::${j.job}`)).toHaveLength(32)
    const covered = new Set(
      Object.values(realManifest.forges as Record<string, { workflow: string; job: string }[]>)
        .flat()
        .map((e) => `${e.workflow}::${e.job}`),
    )
    for (const { path, job } of jobs) {
      expect(covered.has(`${path}::${job}`), `${path}::${job} sem classificação`).toBe(true)
    }
  })

  it("os dois jobs de overhead apontam para o MESMO canal (o job de alerta)", () => {
    // O limiar de cada medidor é configurável; se cada um publicasse por si, o
    // mais frouxo fecharia a dívida que o mais estrito abriu. O canal é um só.
    const semanais = realManifest.forges.github.filter(
      (e: { workflow: string }) => e.workflow === ".github/workflows/benchmark-weekly.yml",
    )
    for (const job of ["mutation-coord-timing", "mutation-coord-trend"]) {
      const entry = semanais.find((e: { job: string }) => e.job === job)
      expect(entry?.channel).toBe("issue")
      expect(entry?.via).toBe("mutation-coord-alert")
    }
    expect(semanais.find((e: { job: string }) => e.job === "mutation-coord-alert")?.channel).toBe(
      "issue",
    )
  })

  it("os canais são só fail/issue/comment (não existe canal 'avisa mas não avisa')", () => {
    expect(ALLOWED_CHANNELS).toEqual(["fail", "issue", "comment"])
  })
})

describe("detecção de workflow agendado", () => {
  it("reconhece schedule: e ignora workflow_dispatch puro", () => {
    expect(isScheduledWorkflow(SCHEDULED)).toBe(true)
    expect(isScheduledWorkflow("on:\n  workflow_dispatch:\njobs:\n  a:\n    steps: []\n")).toBe(
      false,
    )
  })
})

describe("jobBlock — a evidência é procurada no bloco do JOB, não no arquivo", () => {
  it("recorta do job até a próxima chave de job", () => {
    const block = jobBlock(SCHEDULED, "medidor")
    expect(block).toContain("node scripts/measure.mjs")
    expect(block).not.toContain("algo-issue.mjs")
  })

  it("job inexistente → null", () => {
    expect(jobBlock(SCHEDULED, "nao-existe")).toBeNull()
  })
})

describe("mutações — cada regra derruba a violação própria", () => {
  const okEntry = {
    workflow: WF,
    job: "medidor",
    signal: "medida",
    channel: "issue",
    via: "alerta",
    evidence: "node scripts/algo-issue.mjs",
  }
  const alertaEntry = {
    workflow: WF,
    job: "alerta",
    signal: "canal",
    channel: "issue",
    evidence: "node scripts/algo-issue.mjs",
  }

  it("o fixture de controle é válido", () => {
    expect(fixture([okEntry, alertaEntry], { [WF]: SCHEDULED })).toEqual([])
  })

  it("job agendado SEM classificação → violação de cobertura", () => {
    // `alerta` também é um job agendado; sem entrada própria ele fica de fora —
    // é assim que um cron novo entraria em silêncio.
    const violations = fixture([okEntry], { [WF]: SCHEDULED })
    expect(violations.map((v: { job?: string }) => v.job)).toContain("alerta")
    expect(violations.map((v: { problem: string }) => v.problem).join(" | ")).toContain(
      "SEM classificação",
    )
  })

  it("canal fora do vocabulário → violação (é a decisão de 'avisar' sem canal)", () => {
    const violations = fixture([{ ...okEntry, channel: "notice" }], { [WF]: SCHEDULED })
    expect(violations.map((v: { problem: string }) => v.problem).join(" | ")).toContain(
      "não é aceito",
    )
  })

  it("evidência AUSENTE no bloco → violação (o canal foi declarado, não implementado)", () => {
    const violations = fixture([{ ...okEntry, evidence: "node scripts/nao-existe.mjs" }], {
      [WF]: SCHEDULED,
    })
    expect(violations.map((v: { problem: string }) => v.problem).join(" | ")).toContain(
      "evidência do canal ausente",
    )
  })

  it("evidência que só existe em OUTRO job NÃO satisfaz (o recorte é do bloco)", () => {
    // A prova do canal do `medidor` mora no job `alerta`; sem o `via`, o
    // literal do alerta não pode valer como evidência do medidor.
    const semVia = fixture([{ ...okEntry, via: undefined }], { [WF]: SCHEDULED })
    expect(semVia.map((v: { problem: string }) => v.problem).join(" | ")).toContain(
      "evidência do canal ausente",
    )
  })

  it("via inexistente → violação", () => {
    const violations = fixture([{ ...okEntry, via: "fantasma" }], { [WF]: SCHEDULED })
    expect(violations.map((v: { problem: string }) => v.problem).join(" | ")).toContain(
      "via 'fantasma' não existe",
    )
  })

  it("entrada para job/workflow que não existe → violação", () => {
    const jobInexistente = fixture([{ ...okEntry, job: "fantasma" }], { [WF]: SCHEDULED })
    expect(jobInexistente.map((v: { problem: string }) => v.problem).join(" | ")).toContain(
      "job não existe",
    )
    const wfInexistente = fixture([{ ...okEntry, workflow: ".github/workflows/nope.yml" }], {
      [WF]: SCHEDULED,
    })
    expect(wfInexistente.map((v: { problem: string }) => v.problem).join(" | ")).toContain(
      "workflow não existe",
    )
  })

  it("entrada para workflow NÃO agendado → violação (não é job periódico)", () => {
    const onDemand = "on:\n  workflow_dispatch:\njobs:\n  medidor:\n    steps:\n      - run: x\n"
    const violations = fixture([{ ...okEntry, via: undefined, evidence: "run: x" }], {
      [WF]: onDemand,
    })
    expect(violations.map((v: { problem: string }) => v.problem).join(" | ")).toContain(
      "não é agendado",
    )
  })

  it("entrada duplicada → violação", () => {
    const violations = fixture(
      [
        okEntry,
        { ...okEntry },
        {
          workflow: WF,
          job: "alerta",
          signal: "canal",
          channel: "issue",
          evidence: "node scripts/algo-issue.mjs",
        },
      ],
      { [WF]: SCHEDULED },
    )
    expect(violations.map((v: { problem: string }) => v.problem).join(" | ")).toContain("duplicada")
  })
})
