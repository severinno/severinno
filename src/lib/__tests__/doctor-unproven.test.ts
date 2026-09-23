/**
 * A RÉGUA do registro datado do que o veredito NÃO cobre (`scripts/doctor-unproven.mjs`).
 *
 * O que esta suíte protege, em uma frase: uma declaração de lacuna tem de ser
 * DATADA e julGADA pelos próprios fatos do relatório — e o que o registro não
 * consegue julgar (data ausente, `closedBy` desconhecido, arquivo ilegível)
 * NUNCA pode virar "nada fora de alcance".
 *
 * Cada teste abaixo estraga UMA coisa no registro e mede o veredito do coletor:
 * o registro é DADO (um JSON), então o teste o injeta direto — sem tocar o disco
 * e sem depender do relógio da máquina (o `now` é sempre explícito).
 */

import { describe, expect, it } from "vitest"

import { MATRIX_CLOSED_BY, MATRIX_ITEM_ID } from "../../../scripts/bench-freshness.mjs"
import {
  CLOSED_BY,
  EXIT,
  KIND,
  UNPROVEN_REGISTRY_PATH,
  collectUnproven,
  datarLinhas,
  matchesDe,
  parseArgs,
  readUnprovenRegistry,
} from "../../../scripts/doctor-unproven.mjs"

const HOJE = Date.parse("2026-09-22T12:00:00Z")

/** Um item do registro, com os defaults de uma LACUNA aberta e datada hoje. */
function item(over: Record<string, unknown> = {}) {
  return {
    id: "gitea-token",
    kind: KIND.LACUNA,
    declaredAt: "2026-09-22",
    subject: "a forja dona do merge não é lida sem token",
    proveWith: "GITEA_TOKEN=<token> bun run doctor --gitea-env deploy/.env.gitea",
    remedy: "rode o doctor com o token",
    closedBy: "gitea-forja-lida",
    matches: "a branch protection REGISTRADA nao foi lida",
    ...over,
  }
}

/** O coletor sobre um registro INJETADO (sem disco) e um relógio explícito. */
function medir(itens: unknown[], over: { days?: number; facts?: object; erro?: string } = {}) {
  return collectUnproven({
    facts: over.facts ?? {},
    now: HOJE,
    registry: {
      items: itens as object[],
      reviewAfterDays: over.days ?? 90,
      erro: over.erro ?? null,
    },
  })
}

/** O fato de um item pelo id (o coletor devolve o mesmo objeto nas listas e em `items`). */
function fato(fato: ReturnType<typeof medir>, id: string) {
  return fato.items.find((i: { id: string }) => i.id === id)
}

describe("readUnprovenRegistry — fail-closed em cada passo", () => {
  it("arquivo ausente é ERRO NOMEADO, nunca uma lista vazia", () => {
    const lido = readUnprovenRegistry({
      root: "/caminho/que/nao/existe",
      deps: { exists: () => false },
    })
    expect(lido.items).toEqual([])
    expect(lido.erro).toContain(UNPROVEN_REGISTRY_PATH)
    expect(lido.erro).toContain("não existe")
  })

  it("arquivo ilegível diz o caminho e o motivo", () => {
    const lido = readUnprovenRegistry({
      deps: {
        exists: () => true,
        read: () => {
          throw new Error("EACCES")
        },
      },
    })
    expect(lido.erro).toContain("não pôde ser lido")
    expect(lido.erro).toContain("EACCES")
  })

  it("JSON inválido é erro nomeado (não uma lista vazia)", () => {
    const lido = readUnprovenRegistry({
      deps: { exists: () => true, read: () => "{ isso não é json" },
    })
    expect(lido.erro).toContain("não é JSON válido")
  })

  it("a forma declarada é exigida: `items` tem de ser um array", () => {
    const lido = readUnprovenRegistry({
      deps: { exists: () => true, read: () => JSON.stringify({ items: { a: 1 } }) },
    })
    expect(lido.erro).toContain("'items' tem de ser um array")
  })

  it("a JANELA vem do próprio registro, e é o que o coletor aplica", () => {
    const lido = readUnprovenRegistry({
      deps: { exists: () => true, read: () => JSON.stringify({ reviewAfterDays: 30, items: [] }) },
    })
    expect(lido.reviewAfterDays).toBe(30)
    expect(medir([item({ declaredAt: "2026-08-01" })], { days: 30 }).aged).toHaveLength(1)
  })
})

describe("collectUnproven — o julgamento de cada item", () => {
  it("o predicado do `closedBy` é lido dos FATOS: provado → letra morta", () => {
    const fato = medir([item()], {
      facts: { protection: { forges: [{ forge: "gitea", state: "in-sync" }] } },
    })
    expect(fato.state).toBe("proven")
    expect(fato.proven.map((i: { id: string }) => i.id)).toEqual(["gitea-token"])
  })

  it("o FATO AUSENTE não fecha a declaração (um relatório sem o fato não é uma leitura)", () => {
    const fato = medir([item()], { facts: {} })
    expect(fato.state).toBe("open")
  })

  it("a forja `unavailable` NÃO fecha a declaração (não ler não é o mesmo que não haver)", () => {
    const fato = medir([item()], {
      facts: { protection: { forges: [{ forge: "gitea", state: "unavailable" }] } },
    })
    expect(fato.state).toBe("open")
  })

  it("a VERSÃO do runner fecha a declaração SÓ quando ela é a do pin do setup", () => {
    // O predicado `github-runner-na-versao-do-pin`: a segunda pergunta ao MESMO
    // registro. Um serviço que RECUSOU o pin (drift) é o defeito medido — o runner
    // se auto-atualiza no meio do primeiro job e o job fica preso —, e nem ele nem
    // "não deu para julgar" (unread/no-pin) podem fechar a declaração.
    const versao = (state: string | null) => ({
      githubRunnerLabels: {
        state: "violated",
        version: state === null ? null : { state, pin: "2.337.0", registered: "2.337.0" },
      },
    })
    const doPin = medir(
      [item({ id: "github-runner-version", closedBy: "github-runner-na-versao-do-pin" })],
      {
        facts: versao("proven"),
      },
    )
    expect(doPin.state).toBe("proven")
    expect(doPin.proven.map((i: { id: string }) => i.id)).toEqual(["github-runner-version"])
    expect(fato(doPin, "github-runner-version")?.state).toBe("proven")

    for (const state of ["drift", "unread", "no-pin", null]) {
      const ainda = medir(
        [item({ id: "github-runner-version", closedBy: "github-runner-na-versao-do-pin" })],
        { facts: versao(state) },
      )
      expect(ainda.state, `versao=${state}`).toBe("open")
    }
  })

  it("a versão do BINÁRIO do act_runner fecha a declaração SÓ na tag que o compose pina", () => {
    // O predicado `act-runner-na-tag-do-compose`: a segunda pergunta ao MESMO
    // container, do lado da forja. Aqui o guard anterior (`act-runner-lido`)
    // responde "o registro foi lido" — e isso NÃO diz nada sobre a versão que o
    // binário roda: a versão vem da IMAGEM, e o container não se auto-atualiza.
    const versao = (state: string | null) => ({
      runnerLabels: {
        state: "proven",
        version: state === null ? null : { state, tag: "0.6.1", reported: "0.6.1" },
      },
    })
    const naTag = medir(
      [item({ id: "act-runner-version", closedBy: "act-runner-na-tag-do-compose" })],
      { facts: versao("proven") },
    )
    expect(naTag.state).toBe("proven")
    expect(fato(naTag, "act-runner-version")?.state).toBe("proven")

    // E os quatro estados que NÃO fecham: o drift (a tag declara uma versão e o
    // que RODA é outra), a tag flutuante (`latest` — a declaração pendente que a
    // lacuna nomeia), o binário mudo e o render sem imagem. Mais o `null` (nenhum
    // container resolvido): não julgar nunca fecha dívida.
    for (const state of ["drift", "floating", "unread", "no-image", "digest", null]) {
      const ainda = medir(
        [item({ id: "act-runner-version", closedBy: "act-runner-na-tag-do-compose" })],
        { facts: versao(state) },
      )
      expect(ainda.state, `versao=${state}`).toBe("open")
    }
  })

  it("o predicado `forma-no-commit-de-origem`: só a MEDIÇÃO completa fecha (o outro lado da idade)", () => {
    // A idade mede a DISTÂNCIA em commits; este predicado mede o CONTEÚDO do
    // commit de origem — a fenda por onde a `doc-hashes` passou (medida com a
    // suíte no ÍNDICE, com o commit de origem sem ela).
    const comFormas = (forms: unknown) => ({ benchFreshness: { state: "measured", forms } })
    const medido = (forms: unknown) =>
      medir([item({ id: "bench-forma-fora-do-commit", closedBy: "forma-no-commit-de-origem" })], {
        facts: comFormas(forms),
      })

    const vazio = medido({ state: "measured", missing: [], semResposta: 0 })
    expect(vazio.state).toBe("proven")
    expect(fato(vazio, "bench-forma-fora-do-commit")?.state).toBe("proven")

    // Os estados que NÃO fecham — e cada um por um motivo DIFERENTE: a forma que
    // o commit não tem (a dívida), a pergunta que não pôde ser feita e o fato
    // não julgado. "Não deu para julgar" nunca fecha dívida.
    const naoFecham: [string, unknown][] = [
      ["uma forma fora do commit", { state: "measured", missing: [{}], semResposta: 0 }],
      ["uma pergunta sem resposta", { state: "measured", missing: [], semResposta: 1 }],
      ["o fato não julgado", { state: "unavailable", missing: [], semResposta: 0 }],
    ]
    for (const [motivo, forms] of naoFecham) {
      expect(medido(forms).state, motivo).toBe("open")
    }

    // E o FATO AUSENTE (o relatório sem a leitura) também NÃO fecha: sem ele não
    // há medição nenhuma — o otimismo que este registro existe para não ter.
    expect(medir([item({ closedBy: "forma-no-commit-de-origem" })], { facts: {} }).state).toBe(
      "open",
    )
    expect(
      medir([item({ closedBy: "forma-no-commit-de-origem" })], {
        facts: { benchFreshness: { state: "measured" } },
      }).state,
    ).toBe("open")
  })

  it("o predicado `ato-na-matriz`: o ITEM DATADO do relógio da matriz fecha por MEDIÇÃO — e a medição que NÃO aconteceu não fecha", () => {
    // O item que o doctor ABRE quando o registro do ato fica atrás da matriz além
    // do teto DELA (`matrixItem`, do dono da régua). Ele é declarável como
    // qualquer outra dívida datada: o nome do predicado vem do MESMO lugar que o
    // doctor publica (`MATRIX_CLOSED_BY`), então a declaração colável não pode
    // divergir do que está implementado aqui.
    const comMatriz = (matrix: unknown) => ({ benchFreshness: { state: "measured", matrix } })
    const declarado = () =>
      medir([item({ id: MATRIX_ITEM_ID, closedBy: MATRIX_CLOSED_BY })], {
        facts: comMatriz({ state: "measured", aged: false }),
      })

    // O nome publicado pelo doctor É o implementado: um `closedBy` com nome
    // diferente cairia no fail-closed do desconhecido.
    expect(typeof CLOSED_BY[MATRIX_CLOSED_BY]).toBe("function")

    const fechado = declarado()
    expect(fechado.state).toBe("proven")
    expect(fato(fechado, MATRIX_ITEM_ID)?.state).toBe("proven")

    // Os estados que NÃO fecham, cada um por um motivo diferente: o relógio
    // vencido (a dívida que o item existe para declarar) e a medição que não
    // aconteceu (clone raso) — "não deu para julgar" nunca é "está na matriz".
    const naoFecham: [string, unknown][] = [
      ["o relógio vencido", { state: "measured", aged: true }],
      ["a medição indisponível", { state: "unavailable", aged: false }],
    ]
    for (const [motivo, matrix] of naoFecham) {
      const aberto = medir([item({ id: MATRIX_ITEM_ID, closedBy: MATRIX_CLOSED_BY })], {
        facts: comMatriz(matrix),
      })
      expect(aberto.state, motivo).toBe("open")
    }

    // E o FATO AUSENTE (um relatório sem o relógio, ou de um publicador chamado
    // com `--report` antigo) também NÃO fecha: sem medição não há prova.
    expect(
      medir([item({ id: MATRIX_ITEM_ID, closedBy: MATRIX_CLOSED_BY })], { facts: {} }).state,
    ).toBe("open")
  })

  it("SEM DATA → inválido, com o motivo (uma declaração sem data não envelhece)", () => {
    const fato = medir([item({ declaredAt: undefined })])
    expect(fato.state).toBe("invalid")
    expect(fato.invalid[0].why).toContain("declaredAt")
  })

  it("data no FUTURO → inválido (a janela começaria no futuro e o item nunca venceria)", () => {
    const fato = medir([item({ declaredAt: "2027-01-01" })])
    expect(fato.state).toBe("invalid")
    expect(fato.invalid[0].why).toContain("FUTURO")
  })

  it("`kind` desconhecido → inválido (o item diz o que se espera dele e o registro não sabe)", () => {
    const fato = medir([item({ kind: "achismo" })])
    expect(fato.state).toBe("invalid")
    expect(fato.invalid[0].why).toContain("kind 'achismo'")
  })

  it("`closedBy` DESCONHECIDO → inválido, nomeando os implementados (fail-closed)", () => {
    const fato = medir([item({ closedBy: "fecha-sozinho" })])
    expect(fato.state).toBe("invalid")
    expect(fato.invalid[0].why).toContain("closedBy")
    expect(fato.invalid[0].why).toContain(Object.keys(CLOSED_BY)[0])
  })

  it("um predicado que ESTOURA é inválido, com a mensagem do erro (nunca 'aberto')", () => {
    // O nome EXISTE (o item é julgado) e é o predicado que não consegue rodar: o
    // fato traz `forges` numa forma que o predicado não sabe ler.
    const fato = medir([item()], { facts: { protection: { forges: "não-é-array" } } })
    expect(fato.state).toBe("invalid")
    expect(fato.invalid[0].why).toContain("não pôde ser avaliado")
  })

  it("a forja ESPELHO fecha a declaração quando o RECURSO existe (in-sync/drift), não quando não foi lida", () => {
    const pred = (estado: string) =>
      medir([item({ closedBy: "github-protection-suportada" })], {
        facts: { protection: { forges: [{ forge: "github", state: estado }] } },
      }).state
    expect(pred("in-sync")).toBe("proven")
    expect(pred("drift")).toBe("proven")
    // MEDIDO em 09/2026: o espelho é privado num plano sem a feature (403).
    // "não suporta" NÃO fecha a declaração — ele é o motivo dela existir.
    expect(pred("unsupported")).toBe("open")
    expect(pred("unavailable")).toBe("open")
  })

  it("`kind: limite` é DECLARADO: datado, sem janela, e não precisa de `closedBy`", () => {
    const fato = medir([item({ kind: KIND.LIMITE, closedBy: undefined })])
    expect(fato.state).toBe("declarado")
    expect(fato.declarado).toHaveLength(1)
    // Sem janela: um limite por desenho não vence — não há o que revisar, há o
    // que declarar (é a fronteira da medição, não uma dívida).
    expect(fato.declarado[0].limit).toBeNull()
    expect(fato.declarado[0].days).toBe(0)
  })

  it("a JANELA vencida diz há quantos dias (o número que muda a decisão)", () => {
    const fato = medir([item({ declaredAt: "2026-06-01" })])
    expect(fato.state).toBe("aged")
    expect(fato.aged[0].days).toBe(113)
    expect(fato.aged[0].limit).toBe(90)
  })

  it("o estado do conjunto tem PRECEDÊNCIA: inválido > vencido > aberto > provado > declarado", () => {
    const dois = medir([item({ id: "a", declaredAt: "2026-06-01" }), item({ id: "b" })])
    expect(dois.state).toBe("aged")
    const invalido = medir([item({ id: "a" }), item({ id: "b", declaredAt: undefined })])
    expect(invalido.state).toBe("invalid")
  })

  it("registro ILEGÍVEL → `unread`, com o motivo (ausência de prova, nunca lista vazia)", () => {
    const fato = collectUnproven({
      now: HOJE,
      registry: { items: [], reviewAfterDays: null, erro: "não é JSON válido" },
    })
    expect(fato.state).toBe("unread")
    expect(fato.reason).toContain("não é JSON válido")
    expect(fato.total).toBe(0)
  })

  it("registro vazio é um FATO (nada declarado), e o detalhe diz isso", () => {
    const fato = medir([])
    expect(fato.state).toBe("sem-itens")
    expect(fato.detail).toContain("nenhum item declarado")
  })

  it("o resumo conta os estados que importam para quem lê", () => {
    const fato = medir([
      item({ id: "a" }),
      item({ id: "b", declaredAt: "2026-06-01" }),
      item({ id: "c", kind: KIND.LIMITE }),
    ])
    expect(fato.detail).toContain("1 aberta(s)")
    expect(fato.detail).toContain("1 VENCIDA(s)")
    expect(fato.detail).toContain("1 limite(s)")
  })
})

describe("datarLinhas — a data na linha onde o operador lê", () => {
  const report = () => ({
    verdict: {
      unproven: ["o LIMITE do gate LOCAL: o hook não barra quem o desliga"],
      unknowns: ["a branch protection REGISTRADA nao foi lida: sem token", "outra linha qualquer"],
    },
  })

  it("casa por TRECHO estável e data a linha (aberta)", () => {
    const fato = medir([item()])
    const datado = datarLinhas(report(), fato)
    expect(datado.unproven).toEqual(report().verdict.unproven)
    expect(datado.unknowns[0]).toContain("a branch protection REGISTRADA nao foi lida")
    expect(datado.unknowns[0]).toContain("[declarado em 2026-09-22")
    expect(datado.unknowns[1]).toBe("outra linha qualquer")
    expect(datado.usados).toContain("gitea-token")
  })

  it("a linha VENCIDA diz a janela e o que fecha", () => {
    const fato = medir([item({ declaredAt: "2026-06-01" })])
    const datado = datarLinhas(report(), fato)
    expect(datado.unknowns[0]).toContain("JANELA DE 90d VENCIDA")
    expect(datado.unknowns[0]).toContain("reafirme a data")
  })

  it("a linha da LETRA MORTA também é datada — pelo ID, o trecho que ela publica do item", () => {
    // Um item que a medição de AGORA fecha vira uma linha nova no veredito
    // ("a declaração 'X' ficou LETRA MORTA ... remova a entrada"), e ela tem de
    // carregar a data como qualquer outra: o `matches` do item pode declarar o
    // PRÓPRIO id, porque é ele que a linha nomeia. Sem isto, a declaração conta
    // lacuna que já não existe E some do tempo ao mesmo tempo.
    const fato = medir(
      [
        item({
          id: "github-runner-version",
          closedBy: "github-runner-na-versao-do-pin",
          matches: "'github-runner-version' ficou LETRA MORTA",
        }),
      ],
      { facts: { githubRunnerLabels: { version: { state: "proven" } } } },
    )
    expect(fato.state).toBe("proven")
    const r = datarLinhas(
      {
        verdict: {
          unknowns: [
            "a declaração 'github-runner-version' ficou LETRA MORTA: remova a entrada de ci/unproven.json",
          ],
        },
      },
      fato,
    )
    expect(r.unknowns[0]).toContain("[PROVADO em")
    expect(r.usados).toContain("github-runner-version")
  })

  it("a linha PROVADA manda REMOVER a entrada (o registro não pode contar lacuna que já não existe)", () => {
    const fato = medir([item()], {
      facts: { protection: { forges: [{ forge: "gitea", state: "in-sync" }] } },
    })
    const datado = datarLinhas(report(), fato)
    expect(datado.unknowns[0]).toContain("PROVADO")
    expect(datado.unknowns[0]).toContain("remova esta entrada")
  })

  it("o `matches` da lista `unproven` também é datado (as duas listas, não só os unknowns)", () => {
    const fato = medir([item({ matches: "o LIMITE do gate LOCAL" })])
    const datado = datarLinhas(report(), fato)
    expect(datado.unproven[0]).toContain("o LIMITE do gate LOCAL")
    expect(datado.unproven[0]).toContain("[declarado em 2026-09-22")
    expect(datado.usados).toContain("gitea-token")
  })

  it("DOIS itens na MESMA linha: as duas datas aparecem (uma por declaração)", () => {
    const fato = medir([item(), item({ id: "github-repo-identity" })])
    const datado = datarLinhas(report(), fato)
    expect(datado.unknowns[0].match(/\[declarado em 2026-09-22/g)).toHaveLength(2)
    expect(datado.usados).toEqual(["gitea-token", "github-repo-identity"])
  })

  it("sem `matches` o item não toca linha nenhuma (a data dele vive no registro)", () => {
    const fato = medir([item({ matches: null })])
    const datado = datarLinhas(report(), fato)
    expect(datado.unknowns).toEqual(report().verdict.unknowns)
    expect(datado.usados).toEqual([])
  })

  it("um `matches` que NÃO casa deixa a linha órfã: nada é datado e `usados` fica vazio", () => {
    const fato = medir([item({ matches: "prosa que já não existe" })])
    const datado = datarLinhas(report(), fato)
    expect(datado.unknowns).toEqual(report().verdict.unknowns)
    expect(datado.usados).toEqual([])
  })

  it("o relatório sem listas é neutro (nenhuma linha inventada)", () => {
    const datado = datarLinhas({}, medir([item()]))
    expect(datado).toEqual({ blockers: [], unproven: [], unknowns: [], usados: [] })
  })

  it("o BLOQUEIO também é datado (o mesmo assunto muda de lista conforme o estado medido)", () => {
    const bloqueio = {
      verdict: {
        blockers: ["o registro do runner do GITHUB NAO é o que o setup declara (violado): nada"],
        unproven: [],
        unknowns: [],
      },
    }
    const fato = medir([
      item({
        id: "github-self-hosted-runner",
        matches: "o registro do runner do GITHUB NAO é o que o setup declara",
      }),
    ])
    const datado = datarLinhas(bloqueio, fato)
    expect(datado.blockers[0]).toContain("[declarado em 2026-09-22")
    expect(datado.usados).toEqual(["github-self-hosted-runner"])
  })

  it("uma LISTA de trechos cobre os DOIS estados: não lido (unknown) e violado (bloqueio)", () => {
    const trechos = [
      "o registro do runner do GitHub nao foi comparado",
      "o registro do runner do GITHUB NAO é o que o setup declara",
    ]
    const semLeitura = {
      verdict: {
        blockers: [],
        unproven: [],
        unknowns: [
          "o registro do runner do GitHub nao foi comparado com deploy/setup (unavailable): sem token",
        ],
      },
    }
    const violado = {
      verdict: {
        blockers: ["o registro do runner do GITHUB NAO é o que o setup declara (violado): nada"],
        unproven: [],
        unknowns: [],
      },
    }
    const fato = medir([item({ id: "runner", matches: trechos })])
    expect(datarLinhas(semLeitura, fato).usados).toEqual(["runner"])
    expect(datarLinhas(violado, fato).usados).toEqual(["runner"])
    // Uma lista VAZIA é o mesmo que não ter `matches`: nada a datar.
    expect(datarLinhas(semLeitura, medir([item({ matches: [] })])).usados).toEqual([])
  })

  it("o LIMITE ganha o sufixo próprio na linha (limite por desenho, com o que o exercita)", () => {
    const fato = medir([item({ kind: KIND.LIMITE, matches: "o LIMITE do gate LOCAL" })])
    const datado = datarLinhas(
      { verdict: { unproven: ["o LIMITE do gate LOCAL: o hook não barra"] } },
      fato,
    )
    expect(datado.unproven[0]).toContain("limite por desenho")
    expect(datado.unproven[0]).toContain("GITEA_TOKEN=<token>")
  })

  it("`matchesDe` normaliza as três formas (string, lista e ausência)", () => {
    expect(matchesDe({ matches: "a" })).toEqual(["a"])
    expect(matchesDe({ matches: ["a", "b"] })).toEqual(["a", "b"])
    expect(matchesDe({ matches: null })).toEqual([])
    expect(matchesDe({ matches: ["", 42, "b"] })).toEqual(["b"])
    expect(matchesDe({ matches: "" })).toEqual([])
  })
})

describe("CLI do coletor", () => {
  it("o parse aceita --json e --root, e recusa o desconhecido", () => {
    expect(parseArgs(["--json", "--root", "/tmp"]).json).toBe(true)
    expect(parseArgs(["--root", "/tmp"]).root).toBe("/tmp")
    expect(parseArgs(["--root"]).error).toContain("--root exige")
    expect(parseArgs(["--x"]).error).toContain("desconhecido")
  })

  it("os exit codes são os declarados (violação 1, infra 2, uso 3)", () => {
    expect(EXIT.VIOLATIONS).toBe(1)
    expect(EXIT.UNAVAILABLE).toBe(2)
    expect(EXIT.USAGE).toBe(3)
  })
})
