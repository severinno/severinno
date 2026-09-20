/**
 * github-dependencies-issue.test.ts
 *
 * Testes do `scripts/github-dependencies-issue.mjs` — o publicador que transforma
 * a DEPENDÊNCIA NOVA do GitHub (classe + etapa do corte + delta) em ISSUE
 * acionável, no job semanal `github-dependencies-audit` do benchmark-weekly.yml.
 *
 * O QUE PRECISA SER PROVADO (um publicador pode "parecer" certo e não alertar):
 *   1. a RÉGUA é a do GUARD (`novasDependencias`): o item novo, o contador acima
 *      do declarado — e NÃO a declaração envelhecida, que se corrige no mesmo
 *      commit e não vira ticket;
 *   2. a ASSINATURA é por ITEM nas classes de lista e por CLASSE+FAIXA nas de
 *      contagem: o mesmo item não abre duas issues, e um crescimento de ordem de
 *      grandeza é outra dívida (a antiga não pode continuar representando-a);
 *   3. "NÃO MEDIDO ≠ RESOLVIDO": inventário ilegível não fecha nada;
 *   4. o corpo é ACIONÁVEL: nomeia a classe, a ETAPA (id, título e entrega), o
 *      DELTA (medido × declarado) e o substituto declarado;
 *   5. o CICLO completo (criar, deduplicar, COMENTAR a prova e FECHAR quando o
 *      item sai do repositório) roda contra um backend em memória;
 *   6. o workflow REAL invoca o script e o `ci/periodic-alerts.json` classifica o
 *      job com o canal `issue` (senão o cron volta a ser alerta mudo).
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import {
  DATA_PATH,
  FAIXAS,
  GITHUB_DEPENDENCIES_PUBLISHER,
  ISSUE_LABEL,
  assinaturaDe,
  comentarioDeResolucao,
  corpoDoItem,
  faixaDoDelta,
  inputOf,
  itemBody,
  tituloDe,
} from "../../../scripts/github-dependencies-issue.mjs"
import {
  ESTAGIOS,
  novasDependencias,
  violacoesDeGitHub,
} from "../../../scripts/check-github-dependencies.mjs"
import {
  bodyHasSignature,
  publisherSignatures,
  runDebtPublisher,
} from "../../../scripts/issue-publish.mjs"
import { MANIFEST_PATH, jobBlock } from "../../../scripts/check-periodic-alerts.mjs"
import { getJob, loadWorkflow, readWorkflowContent } from "./helpers/workflow-execution"

const ROOT = process.cwd()
const WF = ".github/workflows/benchmark-weekly.yml"
const JOB = "github-dependencies-audit"
const SCRIPT_REF = "scripts/github-dependencies-issue.mjs"

// ── O fixture: um inventário sintético (a medição real é do guard, e tem suíte própria) ──

type ClasseFake = {
  id: string
  titulo: string
  kind: "lista" | "contador"
  unidade: string
  papel: string
  estagio: number
  substituto: string
  porque: string
  declarado: string[] | number
  medido: string[] | number
}

/** Uma classe de LISTA (item nomeável) — a forma da maioria das 8. */
function classeLista(over: Partial<ClasseFake> = {}): ClasseFake {
  return {
    id: "workflows",
    titulo: "workflows do GitHub",
    kind: "lista",
    unidade: "arquivo",
    papel: "a pipeline inteira do espelho",
    estagio: 5,
    substituto: "os passos nas pipelines das duas forjas da Gitea",
    porque: "sao o ESPELHO mais os crons de auditoria",
    declarado: [".github/workflows/a.yml"],
    medido: [".github/workflows/a.yml"],
    ...over,
  }
}

/** Uma classe de CONTAGEM (o que entrou é número, não nome). */
function classeContador(over: Partial<ClasseFake> = {}): ClasseFake {
  return {
    id: "ghcr-images",
    titulo: "referencias a `ghcr.io`",
    kind: "contador",
    unidade: "ocorrencia",
    papel: "o registry e proprietario",
    estagio: 1,
    substituto: "o registry OCI embutido da Gitea",
    porque: "cada referencia literal e um lugar onde o flip nao chegou",
    declarado: 50,
    medido: 50,
    ...over,
  }
}

function inventarioFake(classes: ClasseFake[]) {
  return { classes, estagios: ESTAGIOS, faltando: [] } as never
}

// ── 1. A derivação (a régua do guard) ─────────────────────────────────────

describe("novasDependencias — a dívida que o canal publica", () => {
  it("um item de LISTA que entrou vira uma dívida, com a classe e a etapa", () => {
    const inv = inventarioFake([
      classeLista({ medido: [".github/workflows/a.yml", ".github/workflows/novo.yml"] }),
    ])
    const novas = novasDependencias(inv)
    expect(novas).toHaveLength(1)
    expect(novas[0].item).toBe(".github/workflows/novo.yml")
    expect(novas[0].classe).toBe("workflows")
    expect(novas[0].delta).toBe(1)
    expect(novas[0].totalMedido).toBe(2)
    expect(novas[0].totalDeclarado).toBe(1)
    // A ETAPA é do manifesto do guard (id + título + entrega), não uma cópia local.
    expect(novas[0].etapa?.id).toBe(5)
    expect(novas[0].etapa?.titulo).toBe(ESTAGIOS.find((e) => e.id === 5)?.titulo)
    expect(novas[0].substituto).toContain("Gitea")
  })

  it("um CONTADOR acima do declarado vira UMA dívida, com o delta numérico", () => {
    const novas = novasDependencias(inventarioFake([classeContador({ medido: 63 })]))
    expect(novas).toHaveLength(1)
    expect(novas[0].item).toBeNull()
    expect(novas[0].delta).toBe(13)
    expect(novas[0].totalMedido).toBe(63)
    expect(novas[0].totalDeclarado).toBe(50)
  })

  it("o contador ABAIXO do declarado e o item que SUMIU não são dívida nova", () => {
    // O contador a menos e o item que sumiu são declaração ENVELHECIDA — ela se
    // corrige no mesmo commit (o PR não passa sem isso) e não vira ticket.
    const inv = inventarioFake([
      classeContador({ medido: 48 }),
      classeLista({ declarado: [".github/workflows/a.yml", ".github/workflows/b.yml"] }),
    ])
    expect(novasDependencias(inv)).toEqual([])
    // …e o gate continua acusando as duas (a régua do canal é um recorte da dele).
    const v = violacoesDeGitHub(inv)
    expect(v.some((x) => x.includes("declaracao ENVELHECIDA"))).toBe(true)
  })

  it("contador com dado ILEGÍVEL não é 'nenhuma dependência nova'", () => {
    // `NaN` no declarado é um dado que não dá para julgar: sai da lista de novas
    // (quem acusa é o gate, com a violação própria) — e a guarda de fechamento do
    // canal recusa reconciliar com ele (ver o teste de `resolution.when`).
    const inv = inventarioFake([classeContador({ declarado: "muitos" as never })])
    expect(novasDependencias(inv)).toEqual([])
    expect(violacoesDeGitHub(inv).some((v) => v.includes("contador declarado invalido"))).toBe(true)
  })

  it("a derivação é a MESMA que o texto do gate usa (sem segunda régua)", () => {
    const inv = inventarioFake([
      classeLista({ medido: [".github/workflows/a.yml", ".github/workflows/z.yml"] }),
      classeContador({ medido: 55 }),
    ])
    const novas = novasDependencias(inv)
    const violacoes = violacoesDeGitHub(inv)
    for (const n of novas) {
      expect(violacoes.some((v) => v.includes(String(n.item ?? n.totalMedido)))).toBe(true)
    }
    expect(violacoes.filter((v) => v.includes("dependencia NOVA do GitHub"))).toHaveLength(2)
  })
})

// ── 2. A assinatura (dedup sem ruído) ─────────────────────────────────────

describe("assinaturaDe — por ITEM na lista, por classe+FAIXA no contador", () => {
  it("o mesmo item do repositório produz a MESMA assinatura", () => {
    const a = novasDependencias(
      inventarioFake([
        classeLista({ medido: [".github/workflows/a.yml", ".github/workflows/n.yml"] }),
      ]),
    )[0]
    const b = novasDependencias(
      inventarioFake([
        classeLista({
          medido: [".github/workflows/a.yml", ".github/workflows/n.yml", ".github/workflows/x.yml"],
        }),
      ]),
    )[0]
    expect(assinaturaDe(a)).toBe("dep:workflows|.github/workflows/n.yml")
    expect(assinaturaDe(b)).toBe(assinaturaDe(a))
  })

  it("um contador que cresce DENTRO da faixa não muda a assinatura", () => {
    const um = novasDependencias(inventarioFake([classeContador({ medido: 51 })]))[0]
    const tres = novasDependencias(inventarioFake([classeContador({ medido: 53 })]))[0]
    expect(faixaDoDelta(1).id).toBe("ate-10")
    expect(faixaDoDelta(3).id).toBe("ate-10")
    expect(assinaturaDe(tres)).toBe(assinaturaDe(um))
    expect(assinaturaDe(um)).toBe("dep:ghcr-images|contador@ate-10")
  })

  it("uma mudança de ORDEM de grandeza muda a assinatura (a dívida mudou)", () => {
    const leve = novasDependencias(inventarioFake([classeContador({ medido: 55 })]))[0]
    const grave = novasDependencias(inventarioFake([classeContador({ medido: 160 })]))[0]
    expect(FAIXAS.map((f) => f.id)).toEqual(["ate-10", "ate-100", "acima-100"])
    expect(assinaturaDe(grave)).not.toBe(assinaturaDe(leve))
  })
})

// ── 3. O corpo é acionável ────────────────────────────────────────────────

describe("corpoDoItem — a classe, a etapa e o delta escritos", () => {
  const inv = inventarioFake([
    classeLista({ medido: [".github/workflows/a.yml", ".github/workflows/novo.yml"] }),
  ])
  const input = inputOf(inv)

  it("o título nomeia o item e não tem número solto", () => {
    expect(tituloDe(input.novas[0])).toBe("Dependencia NOVA do GitHub: .github/workflows/novo.yml")
  })

  it("o corpo nomeia a CLASSE, a ETAPA (id, título e entrega) e o DELTA", () => {
    const body = corpoDoItem(input.novas[0], input)
    expect(body).toContain("### A classe")
    expect(body).toContain("`workflows`")
    expect(body).toContain("medido agora: **2** arquivo(s) · declarado: **1** · delta: **+1**")
    expect(body).toContain("### A etapa do corte que a remove")
    expect(body).toContain("**etapa 5 —")
    expect(body).toContain("entrega:")
    expect(body).toContain("substituto declarado:")
    expect(body).toContain("### O delta")
    expect(body).toContain("| `workflows` (arquivos) | 2 | 1 | +1 |")
    // O remédio: o comando que MEDE e o que REGISTRA (o ATO).
    expect(body).toContain("--only workflows")
    expect(body).toContain("--update")
  })

  it("classe SEM etapa declarada: o corpo diz que falta (e não imprime undefined)", () => {
    const semEtapa = inventarioFake([
      classeLista({
        medido: [".github/workflows/a.yml", ".github/workflows/novo.yml"],
        estagio: 99 as never,
        substituto: "",
      }),
    ])
    const entrada = inputOf(semEtapa)
    const body = corpoDoItem(entrada.novas[0], entrada)
    expect(body).toContain("SEM etapa declarada")
    expect(body).toContain("SEM SUBSTITUTO declarado")
    expect(body).not.toContain("undefined")
    expect(body).not.toContain("estagio 99")
  })

  it("o corpo COMPLETO carrega o marcador do contrato (dedup e fechamento o leem)", () => {
    const nova = input.novas[0]
    const body = itemBody(input, nova)
    expect(body).toContain(corpoDoItem(nova, input).split("\n")[0])
    expect(bodyHasSignature(GITHUB_DEPENDENCIES_PUBLISHER, body, assinaturaDe(nova))).toBe(true)
    expect(publisherSignatures({ body, comments: [] }, GITHUB_DEPENDENCIES_PUBLISHER)).toContain(
      assinaturaDe(nova),
    )
  })

  it("o body do contrato é o do ITEM (a prosa não pode vir vazia por engano)", () => {
    // A armadilha do escopo per-item: um `body` de item vazio publica uma issue
    // sem nada. O contrato compõe prosa + marcador; a prosa tem de existir.
    const body = itemBody(input, input.novas[0])
    expect(body.length).toBeGreaterThan(200)
    expect(body).not.toMatch(/^\s*\n/)
  })
})

// ── 4. As guardas do contrato ─────────────────────────────────────────────

describe("GITHUB_DEPENDENCIES_PUBLISHER — as guardas", () => {
  const PUB = GITHUB_DEPENDENCIES_PUBLISHER as unknown as {
    actionable: (input: unknown) => boolean
    scope: { kind: string }
    resolution: { when: (input: unknown) => boolean }
  }

  it("o escopo é PER-ITEM (cada dependência tem a sua etapa e o seu substituto)", () => {
    expect(PUB.scope.kind).toBe("per-item")
  })

  it("acionável só quando há dependência nova medida", () => {
    const comNova = inputOf(
      inventarioFake([
        classeLista({ medido: [".github/workflows/a.yml", ".github/workflows/n.yml"] }),
      ]),
    )
    const semNova = inputOf(inventarioFake([classeLista()]))
    expect([PUB.actionable(comNova), PUB.actionable(semNova)]).toEqual([true, false])
  })

  it("resolution.when NÃO fecha sem medição completa (não medido ≠ resolvido)", () => {
    const medido = inputOf(inventarioFake([classeLista()]))
    expect(PUB.resolution.when(medido)).toBe(true)
    // O caso real: o dado do inventário não pôde ser lido (o guard sai 2).
    const naoMedido = inputOf(null, { medido: false, motivo: "dado ilegivel" })
    expect(PUB.resolution.when(naoMedido)).toBe(false)
    expect(naoMedido.novas).toEqual([])
    expect(naoMedido.medido).toBe(false)
  })

  it("o comentário de resolução nomeia o que saiu e mostra a medição de agora", () => {
    const inv = inventarioFake([classeLista()])
    const comment = comentarioDeResolucao(
      ["dep:workflows|.github/workflows/novo.yml"],
      inputOf(inv),
    )
    expect(comment).toContain("Resolvido")
    expect(comment).toContain("`.github/workflows/novo.yml` (classe `workflows`)")
    expect(comment).toContain("| `workflows` | 1 | 1 | dentro do declarado |")
    expect(comment).toContain("check:github-dependencies")
  })
})

// ── 5. O ciclo completo contra um backend em memória ──────────────────────

type Issue = {
  number: number
  title: string
  body: string
  state: "open" | "closed"
  comments: { body: string }[]
}

/** Um backend de issues em memória — o mesmo contrato que o `gh`/a API cumprem. */
function backendFake() {
  const issues: Issue[] = []
  let next = 1
  return {
    issues,
    name: "fake",
    label: ISSUE_LABEL,
    ensureLabel: () => undefined,
    openIssues: () => issues.filter((i) => i.state === "open"),
    comment: (number: number, body: string) => {
      const issue = issues.find((i) => i.number === number)
      if (!issue) throw new Error(`issue #${number} nao existe`)
      issue.comments.push({ body })
    },
    close: (number: number) => {
      const issue = issues.find((i) => i.number === number)
      if (!issue) throw new Error(`issue #${number} nao existe`)
      issue.state = "closed"
    },
    create: (title: string, body: string) => {
      const issue: Issue = { number: next++, title, body, state: "open", comments: [] }
      issues.push(issue)
      return `#${issue.number}`
    },
  }
}

describe("o ciclo: cria na dependência nova, FECHA quando o item sai do repositório", () => {
  it("run com item novo cria UMA issue por item, com o corpo do item", async () => {
    const backend = backendFake()
    const input = inputOf(
      inventarioFake([
        classeLista({ medido: [".github/workflows/a.yml", ".github/workflows/n1.yml"] }),
        classeLista({
          id: "crons",
          titulo: "crons agendados pelo GitHub",
          unidade: "entrada `- cron:`",
          declarado: ["x#0 3 * * 0"],
          medido: ["x#0 3 * * 0", "y#0 4 * * 1"],
        }),
      ]),
    )
    const res = await runDebtPublisher({
      publisher: GITHUB_DEPENDENCIES_PUBLISHER,
      input,
      backend,
      log: () => {},
    })
    expect(res.created).toBe(2)
    expect(backend.issues).toHaveLength(2)
    expect(backend.issues[0].title).toContain(".github/workflows/n1.yml")
    expect(backend.issues[1].title).toContain("y#0 4 * * 1")
    for (const issue of backend.issues) {
      expect(publisherSignatures(issue, GITHUB_DEPENDENCIES_PUBLISHER).length).toBe(1)
    }
  })

  it("a run seguinte com o MESMO item não abre duplicata", async () => {
    const backend = backendFake()
    const inv = inventarioFake([
      classeLista({ medido: [".github/workflows/a.yml", ".github/workflows/n1.yml"] }),
    ])
    await runDebtPublisher({
      publisher: GITHUB_DEPENDENCIES_PUBLISHER,
      input: inputOf(inv),
      backend,
      log: () => {},
    })
    const segunda = await runDebtPublisher({
      publisher: GITHUB_DEPENDENCIES_PUBLISHER,
      input: inputOf(inv),
      backend,
      log: () => {},
    })
    expect(backend.issues).toHaveLength(1)
    expect(segunda.created).toBe(0)
    expect(backend.issues[0].comments).toEqual([])
  })

  it("o item que SAI do repositório: comenta a prova e FECHA (o ticket não fica para trás)", async () => {
    const backend = backendFake()
    await runDebtPublisher({
      publisher: GITHUB_DEPENDENCIES_PUBLISHER,
      input: inputOf(
        inventarioFake([
          classeLista({ medido: [".github/workflows/a.yml", ".github/workflows/n1.yml"] }),
        ]),
      ),
      backend,
      log: () => {},
    })
    expect(backend.issues[0].state).toBe("open")
    // O corte aconteceu (ou a declaração absorveu o item no mesmo commit): a
    // medição volta a bater e o item não está mais entre os novos.
    const reconciliada = await runDebtPublisher({
      publisher: GITHUB_DEPENDENCIES_PUBLISHER,
      input: inputOf(inventarioFake([classeLista()])),
      backend,
      log: () => {},
    })
    expect(reconciliada.closed).toEqual([1])
    expect(backend.issues[0].state).toBe("closed")
    // A PROVA entrou ANTES do fechamento (numa issue aberta: o pior caso é dívida
    // aberta COM a prova, nunca fechada em silêncio).
    expect(backend.issues[0].comments).toHaveLength(1)
    expect(backend.issues[0].comments[0].body).toContain("Resolvido")
    expect(backend.issues[0].comments[0].body).toContain(".github/workflows/n1.yml")
  })

  it("o inventário ILEGÍVEL não fecha nada (é o fechamento que ele não prova)", async () => {
    const backend = backendFake()
    await runDebtPublisher({
      publisher: GITHUB_DEPENDENCIES_PUBLISHER,
      input: inputOf(
        inventarioFake([
          classeLista({ medido: [".github/workflows/a.yml", ".github/workflows/n1.yml"] }),
        ]),
      ),
      backend,
      log: () => {},
    })
    const cego = await runDebtPublisher({
      publisher: GITHUB_DEPENDENCIES_PUBLISHER,
      input: inputOf(null, { medido: false, motivo: "dado ilegivel" }),
      backend,
      log: () => {},
    })
    expect(cego.status).toBe("unmeasured")
    expect(cego.closed).toBeUndefined()
    expect(backend.issues[0].state).toBe("open")
  })
})

// ── 6. A ligação no cron (o canal declarado) ──────────────────────────────

describe("o job do cron e o manifesto", () => {
  it("o workflow REAL invoca o publicador no job nomeado", () => {
    expect(() => readFileSync(join(ROOT, SCRIPT_REF), "utf8")).not.toThrow()
    const wf = loadWorkflow(WF)
    const job = getJob(wf, JOB)
    expect(job).toBeTruthy()
    const content = readWorkflowContent(WF)
    expect(jobBlock(content, JOB)).toContain(SCRIPT_REF)
    expect(jobBlock(content, JOB)).toContain("GH_TOKEN")
    // O cron tem de ser AGENDADO: o canal só existe se o job roda sozinho.
    expect(content).toMatch(/schedule:/)
  })

  it("o manifesto classifica o job com o canal `issue` (senão o cron é alerta mudo)", () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, MANIFEST_PATH), "utf8"))
    const entrada = manifest.forges.github.find(
      (e: { workflow: string; job: string }) => e.workflow === WF && e.job === JOB,
    )
    expect(entrada).toBeTruthy()
    expect(entrada.channel).toBe("issue")
    expect(entrada.evidence).toBe(SCRIPT_REF)
  })

  it("o dado que o publicador LÊ é o mesmo que o gate cobra", () => {
    expect(DATA_PATH).toBe("ci/github-dependencies.json")
    expect(() => readFileSync(join(ROOT, DATA_PATH), "utf8")).not.toThrow()
  })
})
