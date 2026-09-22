/**
 * pre-push-stack-recorte-blocks.test.ts
 *
 * A prova por EXECUÇÃO do recorte da pilha no pre-push: uma pilha em que o commit
 * do MEIO nasce vermelho e o TOPO é verde — a classe medida no repositório (o
 * `eee4f65e` pôs o count na bateria local, invalidou a expectativa de outro teste
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
 * A SEGUNDA unidade é a completude do FECHO do fixture, e ela existe por um
 * achado real: a primeira execução desta prova morreu com `ERR_MODULE_NOT_FOUND`
 * (o `check-tla-closure.mjs` importa o `check-no-leaked-imports.mjs`) — e o
 * não-zero do módulo do recorte, com o hook tratando qualquer não-zero como "um
 * commit do meio é vermelho", virou uma ACUSAÇÃO ao commit. Fecho incompleto é
 * uma prova que mede o fixture; ele aparece NOMEADO aqui (derivado do grafo de
 * imports, não de uma lista conferida à mão).
 *
 * Execução focada:
 *   npx vitest run --config vitest.config.unit.ts src/lib/__tests__/pre-push-stack-recorte-blocks.test.ts
 */

import { describe, expect, it } from "vitest"

import {
  FECHO_DO_RECORTE,
  fechoDoRecorteProblemas,
  provePushBlocksMiddle,
} from "../../../scripts/pre-push-proof.mjs"
import { HOOK_SOURCE } from "@/lib/__tests__/helpers/pre-push-fixture"

describe("o fecho do fixture do recorte é COMPLETO (derivado do grafo)", () => {
  it("toda dependência relativa do módulo do recorte está copiada — e nada sobra na lista", () => {
    expect(fechoDoRecorteProblemas()).toEqual([])
    expect(FECHO_DO_RECORTE).toContain("prove-stack-per-commit.mjs")
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
    // régua dos afetados derivou (um recorte sem teste derivado mediria o ambiente).
    const quebrados = ev.defeito.medicoes.filter((m) => m.veredito === "QUEBRADO")
    expect(quebrados).toHaveLength(1)
    expect(quebrados[0].arquivos.join(" ")).toContain("medido.test.ts")

    // B: o mesmo push com o meio verde chega — a recusa não é do fixture.
    expect(ev.controle.status).toBe(0)
    expect(ev.controle.objetosNoRemoto).toBeGreaterThan(ev.defeito.objetosNoRemoto)
    expect(ev.controle.conteudoNaRef).toContain("C3: o topo conserta o meio")
  })
})
