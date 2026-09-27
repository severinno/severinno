/**
 * pre-push-stack-recorte-blocks.test.ts
 *
 * A prova por EXECUÇÃO do recorte da pilha no pre-push: uma pilha em que o commit
 * do MEIO nasce vermelho e o TOPO é verde — a classe medida no repositório (o
 * `2757e3a5` pôs o count na bateria local, invalidou a expectativa de outro teste
 * e o vermelho viajou 12 commits; o topo estava verde, o PR estava verde, e o
 * commit que quebrou o invariante nunca foi julgado).
 *
 * POR QUE a prova é de EXECUÇÃO e não estrutural: o que se mede não é "o hook
 * chama o recorte" (isso um teste de texto veria), é que o `git push` de verdade
 * é RECUSADO ANTES do pack — o remoto é o único lugar onde "nada chegou" pode ser
 * medido, e ele já tinha a BASE (senão a metade do defeito seria "o remoto estava
 * vazio", indistinguível de um fixture que não empurra).
 *
 * O CONTROLE é o MESMO fixture com o meio verde: sem ele, a recusa poderia ser de
 * outro gate ou de um fixture quebrado — e a prova estaria medindo o bloqueio de
 * um gate que já não funcionava.
 *
 * A SEGUNDA unidade é o FECHO do fixture, e ela existe por um achado real: a
 * primeira execução desta prova morreu com `ERR_MODULE_NOT_FOUND` (o
 * `check-tla-closure.mjs` importa o `check-no-leaked-imports.mjs`) — e o não-zero
 * do módulo do recorte, com o hook tratando qualquer não-zero como "um commit do
 * meio é vermelho", virou uma ACUSAÇÃO ao commit. Fecho incompleto é uma prova
 * que mede o fixture. Aqui o fixture COPIA a lista DERIVADA do grafo
 * (`fechoDoRecorte`, a régua única das suítes de mutação): não há lista declarada
 * para envelhecer, e o que esta unidade prova é que a derivação continua vendo o
 * grafo que a prova mede.
 *
 * Execução focada:
 *   npx vitest run --config vitest.config.unit.ts src/lib/__tests__/pre-push-stack-recorte-blocks.test.ts
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import {
  RECORTE_MODULO,
  fechoDoRecorte,
  provePushBlocksMiddle,
} from "../../../scripts/pre-push-proof.mjs"
import { HOOK_SOURCE } from "@/lib/__tests__/helpers/pre-push-fixture"

describe("o fecho do fixture do recorte é o DERIVADO do grafo", () => {
  it("a derivação vê o módulo do recorte e as arestas que a prova mede", () => {
    // O que o fixture copia é esta lista — e ela não é conferida contra uma lista
    // declarada (não há mais uma): a derivação LEVANTA quando o fecho não fecha, e
    // o `catch` da prova o publica como `unavailable`.
    const fecho = fechoDoRecorte()
    expect(fecho).toContain(RECORTE_MODULO)
    // As arestas que o fixture precisa ter, nomeadas uma a uma: a que o achado de
    // 26/09 mediu (`check-tla-closure` → `check-no-leaked-imports`) e as folhas do
    // módulo do recorte.
    expect(fecho).toContain("check-tla-closure.mjs")
    expect(fecho).toContain("check-no-leaked-imports.mjs")
    expect(fecho).toContain("remedy-canal.mjs")
    expect(fecho).toContain("doctor-unproven.mjs")
    expect(fecho).toContain("allowlist-review.mjs")
  })

  it("um fecho que NÃO fecha LEVANTA o problema: meio fecho nunca vira fixture", () => {
    // O grafo é lido de `root`, então a árvore do caso é um tmpdir com uma aresta
    // por vez: a que não resolve e a que é PACOTE (este fixture roda sem
    // `node_modules`). O desfecho é uma EXCEÇÃO com o problema NOMEADO — o
    // `catch` do `provePushBlocksMiddle` (e o do `readPrePushBlock`) a publica
    // como `unavailable`, e é por isso que a prova nunca mede o fixture.
    const monta = (conteudo: string) => {
      const dir = mkdtempSync(join(tmpdir(), "fecho-recorte-"))
      mkdirSync(join(dir, "scripts"), { recursive: true })
      writeFileSync(join(dir, "scripts", RECORTE_MODULO), conteudo, "utf8")
      return dir
    }
    const arestaQuebrada = monta('import { x } from "./faltando.mjs"\n')
    const comPacote = monta('import { z } from "zod"\n')

    try {
      expect(() => fechoDoRecorte(arestaQuebrada)).toThrow(/NÃO FECHA/)
      expect(() => fechoDoRecorte(arestaQuebrada)).toThrow(/faltando\.mjs/)
      expect(() => fechoDoRecorte(comPacote)).toThrow(/zod/)
    } finally {
      for (const dir of [arestaQuebrada, comPacote]) rmSync(dir, { recursive: true, force: true })
    }
  })

  it("o hook REAL está ligado no recorte, e o bloqueio exige o VEREDITO (não só o exit)", () => {
    expect(HOOK_SOURCE).toContain(
      'node scripts/prove-stack-per-commit.mjs --pushed --amostra "${PILHA_PUSH_MAX:-6}" --sem-topo',
    )
    // O marcador que separa "um commit do meio é vermelho" de "o recorte não
    // chegou a um veredito" (crash/uso): sem ele, um fecho incompleto viraria
    // acusação ao commit — foi o que a primeira execução da prova mediu.
    expect(HOOK_SOURCE).toContain("Veredito do recorte do push: ")
  })
})

describe("o recorte da pilha no caminho do push", () => {
  it("recusa o push da pilha com o MEIO vermelho, sem deixar objeto novo no remoto — e o controle verde CHEGA", () => {
    const r = provePushBlocksMiddle()

    expect(r.state).toBe("proven")
    const ev = r.evidence as {
      defeito: {
        status: number | null
        objetosNoRemoto: number
        objetosAntes: number
        refMudou: boolean
        meio: string
        nomeouOMeio: boolean
        medicoes: Array<{ veredito: string; arquivos: string[] }>
      }
      controle: { status: number | null; objetosNoRemoto: number; conteudoNaRef: string }
    }

    // A: o defeito é do COMMIT, e o gate barra ANTES do pack.
    expect(ev.defeito.status).not.toBe(0)
    expect(ev.defeito.objetosNoRemoto).toBe(ev.defeito.objetosAntes)
    expect(ev.defeito.refMudou).toBe(false)
    expect(ev.defeito.nomeouOMeio).toBe(true)

    // O rastro: o meio foi MEDIDO, com o veredito do CONTEÚDO e com o teste que a
    // régua dos afetados derivou (um recorte sem teste derivado mediria o
    // ambiente) — e foi medido DUAS vezes, que é a RE-MEDIÇÃO DECLARADA do
    // vermelho. O único commit que o recorte mede aqui é o MEIO (a base está no
    // remoto e o topo sai por `--sem-topo`), então duas invocações do vitest do
    // fixture são as DUAS TENTATIVAS do mesmo commit. O vermelho do fixture é do
    // CONTEÚDO versionado (o payload do vitest lê o arquivo), então as duas
    // tentativas CONCORDAM: é o caso REPETÍVEL, e é por isso que o push continua
    // recusado aqui — um flake seria a 2ª discordar e sair declarado como flake.
    const quebrados = ev.defeito.medicoes.filter((m) => m.veredito === "QUEBRADO")
    expect(quebrados).toHaveLength(2)
    for (const m of quebrados) expect(m.arquivos.join(" ")).toContain("medido.test.ts")

    // B: o mesmo push com o meio verde chega — a recusa não é do fixture.
    expect(ev.controle.status).toBe(0)
    expect(ev.controle.objetosNoRemoto).toBeGreaterThan(ev.defeito.objetosNoRemoto)
    expect(ev.controle.conteudoNaRef).toContain("C3: o topo conserta o meio")
  })
})
