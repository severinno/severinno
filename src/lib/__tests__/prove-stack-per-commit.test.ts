/**
 * prove-stack-per-commit.test.ts
 *
 * Testes de scripts/prove-stack-per-commit.mjs — a régua do commit que nasce
 * vermelho, e o RECORTE que a leva para o caminho do push.
 *
 * POR QUE o recorte precisa de prova própria: o pre-push passou a medir os
 * commits do MEIO que o push leva, e o que faz isso caber no caminho do push é a
 * AMOSTRA. Uma amostra mal escolhida não é um detalhe de custo — ela é um
 * veredito: sorteada, o MESMO push mede commits diferentes a cada vez (o vermelho
 * aparece e some sem ninguém mudar nada); sem o mais antigo, o commit que ficou
 * mais tempo na pilha — e mais longe de quem lê o diff — nunca é medido; e se ela
 * devolvesse "tudo verde" sem dizer o que pulou, "não medido" viraria "passa",
 * que é exatamente a classe de defeito que o harness existe para fechar.
 *
 * O teste trava o que decide o veredito, em três camadas:
 *
 *   1. a leitura do PROTOCOLO do pre-push (o stdin que o git escreve): linha
 *      malformada é IGNORADA e CONTADA — o parser não derruba um push por um
 *      formato inesperado, e também não inventa ref que o git não mandou;
 *   2. a derivação dos commits que o push LEVA: a união `remote_sha..local_sha`,
 *      com o ref NOVO (sha do remoto todo zero) dependendo da BASE declarada —
 *      e `null` (INDETERMINADO), nunca "a história inteira", quando não há base;
 *   3. a AMOSTRA determinística: o mais antigo sempre dentro, os pulados
 *      NOMEADOS, e `medidos + pulados = o recorte` (nada inventado, nada perdido).
 *
 * A última unidade é a CLI no caminho COMUM (um push de um commit só não tem
 * MEIO): o recorte é vazio, e "nada a medir" é um FATO medido — não um silêncio.
 *
 * Execução focada:
 *   npx vitest run --config vitest.config.unit.ts src/lib/__tests__/prove-stack-per-commit.test.ts
 */

import { spawnSync } from "node:child_process"

import { describe, expect, it } from "vitest"

import {
  AMOSTRA_PADRAO,
  EXIT,
  amostrar,
  commitsDoPush,
  recorteVazio,
  refsDoPush,
  renderRecorteVazio,
} from "../../../scripts/prove-stack-per-commit.mjs"

/** O sha que o git manda para um ref que o remoto ainda não tem. */
const ZERO = "0".repeat(40)
/** Shas de verdade de mentira: o parser exige a FORMA do sha (40 ou 64 hex). */
const A = "a".repeat(40)
const B = "b".repeat(40)
const C = "c".repeat(40)

/** Um `git` de mentira que REGISTRA os argumentos e devolve o que for dito. */
function gitStub(saida: string, registro: string[][] = []) {
  const git = (args: string[]) => {
    registro.push(args)
    return saida
  }
  return { git, registro }
}

const linha = (localSha: string, remoteSha: string) =>
  `refs/heads/x ${localSha} refs/heads/x ${remoteSha}`

describe("refsDoPush — o protocolo do pre-push", () => {
  it("lê as quatro colunas de cada ref que sai", () => {
    const { refs, ignoradas } = refsDoPush(
      `${linha(B, A)}\nrefs/heads/y ${C} refs/heads/y ${ZERO}\n`,
    )
    expect(refs).toHaveLength(2)
    expect(refs[0]).toEqual({
      localRef: "refs/heads/x",
      localSha: B,
      remoteRef: "refs/heads/x",
      remoteSha: A,
    })
    expect(refs[1].remoteSha).toBe(ZERO)
    expect(ignoradas).toEqual([])
  })

  it("linha malformada é IGNORADA e CONTADA — nunca derruba o push por formato", () => {
    const { refs, ignoradas } = refsDoPush(
      `lixo no meio\nrefs/heads/x ${B} refs/heads/x ${A}\nrefs/heads/x ${B} refs/heads/x\n`,
    )
    expect(refs).toHaveLength(1)
    expect(ignoradas).toEqual(
      ["lixo no meio", "refs/heads/x b refs/heads/x"].map((l, i) =>
        i === 1 ? l.replace(/\bb\b/, B) : l,
      ),
    )
  })

  it("quatro colunas SEM sha não são um ref — senão um dado estranho viraria 'nada a medir'", () => {
    // A linha tem quatro tokens e NENHUM sha: o git nunca manda isso, e aceitá-la
    // faria o recorte sair VAZIO (um verde por um dado que não é do protocolo).
    const { refs, ignoradas } = refsDoPush("algo com tres campos\n")
    expect(refs).toEqual([])
    expect(ignoradas).toEqual(["algo com tres campos"])
  })

  it("sem protocolo (hook rodado à mão) não há ref nenhuma — e nada é inventado", () => {
    expect(refsDoPush("").refs).toEqual([])
    expect(refsDoPush("\n   \n").refs).toEqual([])
  })
})

describe("commitsDoPush — os commits que ESTE push leva", () => {
  it("é a união `remote_sha..local_sha`, do mais antigo ao mais novo", () => {
    const { git, registro } = gitStub("c1\nc2\nc3")
    const r = commitsDoPush({ git, refs: refsDoPush(linha(B, A)).refs, base: null })
    expect(r.commits).toEqual(["c1", "c2", "c3"])
    expect(r.origem).toBe("remote_sha..local_sha")
    // O `--not` NEGATIVA o que o remoto já tem: é a diferença entre "a pilha do
    // push" e "a história do branch".
    expect(registro[0]).toEqual(["rev-list", "--reverse", "--topo-order", B, "--not", A])
  })

  it("ref NOVO: a base DECLARADA delimita (o remoto não tem o que negativar)", () => {
    const { git, registro } = gitStub("c1")
    const r = commitsDoPush({
      git,
      refs: refsDoPush(linha(B, ZERO)).refs,
      base: { ref: "origin/main", origem: "--base" },
    })
    expect(r.commits).toEqual(["c1"])
    expect(r.origem).toContain("1 ref(s) NOVO(s): base origin/main")
    expect(registro[0]).toEqual([
      "rev-list",
      "--reverse",
      "--topo-order",
      B,
      "--not",
      "origin/main",
    ])
  })

  it("ref NOVO SEM base resolvida: INDETERMINADO (`null`), nunca a história inteira", () => {
    const { git } = gitStub("c1\nc2")
    const r = commitsDoPush({
      git,
      refs: refsDoPush(linha(B, ZERO)).refs,
      base: { ref: null, origem: "nenhuma" },
    })
    expect(r.commits).toBeNull()
    expect(r.origem).toBe("ref NOVO sem base resolvida")
  })

  it("push de remoção (só o sha do local zerado) não tem o que medir", () => {
    const { git, registro } = gitStub("")
    const r = commitsDoPush({ git, refs: refsDoPush(linha(ZERO, A)).refs, base: null })
    expect(r.commits).toEqual([])
    expect(r.origem).toContain("só remoções")
    expect(registro).toHaveLength(0)
  })

  it("git que não responde devolve lista VAZIA — e não um verde inventado", () => {
    const { git } = gitStub("")
    expect(commitsDoPush({ git, refs: refsDoPush(linha(B, A)).refs, base: null }).commits).toEqual(
      [],
    )
  })
})

describe("amostrar — o RECORTE que cabe no push", () => {
  const commits = Array.from({ length: 12 }, (_, i) => `c${String(i).padStart(2, "0")}`)

  it("amostra maior que o recorte mede TUDO (não há o que cortar)", () => {
    const { medidos, pulados } = amostrar(commits, 12)
    expect(medidos).toEqual(commits)
    expect(pulados).toEqual([])
    expect(amostrar(commits, 99).medidos).toEqual(commits)
  })

  it("12 commits com amostra 6: o mais ANTIGO dentro, os outros espaçados, os pulados NOMEADOS", () => {
    const { medidos, pulados } = amostrar(commits, 6)
    // As posições são as do arredondamento da fração (0, 2,4, 6,6→7, 8,8→9, 11):
    // a régua é determinística, e é ela que o teste trava — não uma lista escolhida.
    expect(medidos).toEqual(["c00", "c02", "c04", "c07", "c09", "c11"])
    expect(pulados).toEqual(["c01", "c03", "c05", "c06", "c08", "c10"])
    // NADA inventado e nada perdido: o recorte é exatamente a união das duas listas.
    expect([...medidos, ...pulados].sort()).toEqual([...commits].sort())
  })

  it("a amostra é DETERMINÍSTICA — o mesmo push mede os MESMOS commits", () => {
    expect(amostrar(commits, 5)).toEqual(amostrar(commits, 5))
    expect(AMOSTRA_PADRAO).toBe(6)
  })

  it("amostra 1 mede só o MAIS ANTIGO — o commit que ficou mais tempo na pilha", () => {
    const { medidos, pulados } = amostrar(commits, 3)
    expect(medidos[0]).toBe("c00")
    expect(amostrar(commits, 1)).toEqual({ medidos: ["c00"], pulados: commits.slice(1) })
  })

  it("amostra inválida (0, negativa, não-inteira) não corta nada — nunca um recorte vazio por acidente", () => {
    expect(amostrar(commits, 0).medidos).toEqual(commits)
    expect(amostrar(commits, -3).medidos).toEqual(commits)
    expect(amostrar(commits, 2.5).medidos).toEqual(commits)
  })
})

describe("o recorte VAZIO — o caminho comum, MEDIDO", () => {
  it("diz por que não havia o que medir, e que isso foi medido (não presumido)", () => {
    const texto = renderRecorteVazio({
      recorte: {
        refs: 1,
        ignoradas: 0,
        noRecorte: 1,
        semTopo: true,
        amostra: AMOSTRA_PADRAO,
        medidos: 0,
        pulados: [],
        origem: "remote_sha..local_sha",
        negativos: ["aaa"],
      },
    })
    expect(texto).toContain("NADA A MEDIR")
    expect(texto).toContain("MEDIDO, não presumido")
    expect(texto).toContain("refs: 1")
  })

  it("o JSON do recorte vazio tem a MESMA forma do relatório cheio (um parser, não dois)", () => {
    const j = recorteVazio({ pulados: [], noRecorte: 0 }, "remote_sha..local_sha", "bbb")
    expect(j.commits).toBe(0)
    expect(j.veredito).toBe("ok")
    expect(j.resultados).toEqual([])
    expect(j.recorte.noRecorte).toBe(0)
  })

  it("a CLI sai 0 com o recorte vazio (um push de um commit não tem MEIO)", () => {
    const head = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim()
    const cli = spawnSync(
      "node",
      ["scripts/prove-stack-per-commit.mjs", "--pushed", "--sem-topo", "--refs", linha(head, head)],
      { encoding: "utf8" },
    )
    expect(cli.status).toBe(EXIT.OK)
    expect(cli.stdout).toContain("NADA A MEDIR")
  })
})
