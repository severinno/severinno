/**
 * prove-remedy-offer.test.ts
 *
 * A OFERTA do remédio do pre-commit, medida — nas duas superfícies que o job do
 * CI usa:
 *
 *   1. a CLI `--oferta` do `pre-commit-remedy.mjs`: a MESMA detecção do remédio
 *      (com o guard dono de cada classe), publicada em JSON no stdout, sem
 *      pergunta e sem escrever. A semântica dela é a da MEDIÇÃO — `0` diz "a
 *      oferta foi medida" (mesmo vazia), `2` que alguma classe não pôde ser
 *      medida, e é por isso que ela difere do remédio interativo, que sai `1`
 *      quando não há nada a remendar;
 *   2. a prova `proveRemedyOffered` (de `pre-commit-proof.mjs`): o `git commit`
 *      de verdade recusado pelo guard DONO, a OFERTA nomeando a classe e o fixer
 *      dela, o hook publicando a oferta no próprio commit e o CONTROLE entrando
 *      depois do remendo.
 *
 * As metades de FALHA são exercitadas por INJEÇÃO (`deps`): cada uma delas
 * pergunta "e se esta peça não estiver lá?" — sem isso, a prova só seria medida
 * no caminho feliz, e uma prova que só mede o caminho feliz não distingue "a
 * oferta existe" de "a oferta aconteceu por acaso".
 *
 * Usage:
 *   npx vitest run --config vitest.config.unit.ts src/lib/__tests__/prove-remedy-offer.test.ts
 */

import { spawnSync } from "node:child_process"
import { join } from "node:path"

import { afterAll, describe, expect, it } from "vitest"

import { cleanupFixtures, runGit, stage } from "@/lib/__tests__/helpers/hook-simulator"
import { NO_PROMPT_ENV, oferta } from "../../../scripts/pre-commit-remedy.mjs"
import {
  BUN_GUARD,
  MIRROR_COMPOSE,
  MIRROR_COMPOSE_COM_ARG,
  MIRROR_COMPOSE_SEM_ARG,
  REMEDY,
  mirrorFixture,
  proveRemedyOffered,
  remedyOfferOf,
} from "../../../scripts/pre-commit-proof.mjs"

afterAll(() => {
  cleanupFixtures()
})

const CLASSE = "bun-mirror-removal"
const FIXER = `node scripts/${BUN_GUARD} --fix`

/** O fixture com a REMOÇÃO do arg ainda NÃO estagiada (o estado da premissa). */
function fixtureComBase() {
  return mirrorFixture()
}

/** O fixture com a remoção JÁ no índice — o defeito que o hook tem de recusar. */
function fixtureComDefeito() {
  const dir = fixtureComBase()
  stage(dir, MIRROR_COMPOSE, MIRROR_COMPOSE_SEM_ARG)
  return dir
}

// ── a superfície medida (a CLI `--oferta`) ────────────────────────────────

describe("a OFERTA como superfície medida", () => {
  it("a classe do espelho APAGADO entra na oferta, com o ofensor e o fixer do dono", () => {
    const dir = fixtureComDefeito()
    const o = oferta(dir)

    expect(o.code).toBe(0)
    const classe = o.classes.find((c: { id: string }) => c.id === CLASSE)
    expect(classe?.offenders).toEqual([MIRROR_COMPOSE])
    expect(classe?.fixer).toBe(FIXER)
    expect(classe?.violacoes).toBe(1)
    // O relatório da classe vai junto: é o que o operador lê antes de responder.
    expect(classe?.relatorio).toContain("BUN_VERSION")
  })

  it("oferta VAZIA é um fato medido (exit 0), não um veredito — quem exige a classe é quem mede", () => {
    const dir = fixtureComBase() // o arg no lugar: nada a remendar
    const o = oferta(dir)
    expect(o.code).toBe(0)
    expect(o.classes).toEqual([])
    expect(o.unmeasured).toEqual([])
  })

  it("a CLI publica o MESMO payload da função (`--oferta`), sem perguntar e sem escrever", () => {
    const dir = fixtureComDefeito()
    const antes = String(runGit(dir, ["show", `:${MIRROR_COMPOSE}`]).output ?? "")

    const r = remedyOfferOf(dir)
    expect(r.status).toBe(0)
    expect(r.json?.classes?.map((c: { id: string }) => c.id)).toContain(CLASSE)
    // Sem terminal nenhum o remédio INTERATIVO não pergunta e sai 1; a medição
    // NÃO muda o veredito do commit (ela não remenda) e não toca no índice.
    const depois = String(runGit(dir, ["show", `:${MIRROR_COMPOSE}`]).output ?? "")
    expect(depois).toBe(antes)
    expect(r.output).not.toContain("SEM TERMINAL")
  })

  it("a CLI do fixture é o MESMO arquivo que o hook executa (byte a byte)", () => {
    const dir = fixtureComBase()
    const noFixture = join(dir, "scripts", REMEDY)
    const r = spawnSync(process.execPath, [noFixture, "--root", dir, "--oferta"], {
      cwd: dir,
      encoding: "utf8",
      input: "",
      env: { ...process.env, [NO_PROMPT_ENV]: "1" },
    })
    expect(r.status).toBe(0)
    expect(JSON.parse(String(r.stdout)).classes).toEqual([])
  })

  it("classe que NÃO pôde ser medida: exit 2 e ela sai nomeada (nunca 'nada a remendar')", () => {
    const dir = fixtureComBase()
    const stub = {
      id: "stub",
      label: "stub",
      fixer: "node scripts/check-bun-mirror.mjs --fix",
      aplicavel: () => null,
      detectar: () => ({ indisponivel: "o guard dono não pôde ser medido" }),
    }
    const o = oferta(dir, { classes: [stub], problemas: [] })
    expect(o.code).toBe(2)
    expect(o.unmeasured).toEqual([{ id: "stub", reason: "o guard dono não pôde ser medido" }])
    expect(o.classes).toEqual([])
  })

  it("oferta INCOMPLETA recusa a medição (o commit não é julgado por uma oferta menor)", () => {
    const dir = fixtureComBase()
    const o = oferta(dir, {
      classes: [],
      problemas: ["declaração inválida em remedy-classes/x.mjs"],
    })
    expect(o.code).toBe(2)
    expect(o.problems).toEqual(["declaração inválida em remedy-classes/x.mjs"])
    expect(o.classes).toEqual([])
  })

  it("a classe SEM remendo sai em `semRemendo` — fora da oferta, com o motivo", () => {
    const dir = fixtureComBase()
    const stub = {
      id: "stub-sem-remendo",
      label: "stub",
      fixer: "node scripts/check-bun-mirror.mjs --fix",
      aplicavel: () => null,
      detectar: () => ({
        offenders: [],
        violacoes: 2,
        semRemendo: "divergência: não há o que restaurar",
      }),
    }
    const o = oferta(dir, { classes: [stub], problemas: [] })
    expect(o.code).toBe(0)
    expect(o.classes).toEqual([])
    expect(o.semRemendo).toEqual([
      { id: "stub-sem-remendo", reason: "divergência: não há o que restaurar" },
    ])
  })

  it("a classe que não é APLICÁVEL a este repositório é dita (não some da contagem)", () => {
    const dir = fixtureComBase()
    const stub = {
      id: "stub-inaplicavel",
      label: "stub",
      fixer: "node scripts/check-bun-mirror.mjs --fix",
      aplicavel: () => "o guard dono não existe neste repositório",
      detectar: () => ({ offenders: [] }),
    }
    const o = oferta(dir, { classes: [stub], problemas: [] })
    expect(o.code).toBe(0)
    expect(o.notApplicable).toEqual([
      { id: "stub-inaplicavel", reason: "o guard dono não existe neste repositório" },
    ])
  })
})

// ── a prova da oferta (pre-commit-proof.mjs) ──────────────────────────────

describe("a prova da OFERTA — as três metades no mesmo runtime", () => {
  it("REAL: bloqueio pelo guard dono + oferta com a classe + o fixer fechando o ciclo", () => {
    const r = proveRemedyOffered()

    expect(r.state).toBe("proven")
    expect(r.detail).toContain(CLASSE)
    expect(r.detail).toContain(FIXER)
    const ev = r.evidence as {
      defeito: { status: number; headIntacto: boolean; bloqueadoPor?: string }
      oferta: {
        exit: number
        classe: { offenders: string[]; fixer: string }
        citadaPeloHook: boolean
      }
      controle: {
        fixer: number
        guarda: number
        restauradoNoIndice: boolean
        status: number
        conteudoEmHead: string
      }
    }
    expect(ev.defeito.status).not.toBe(0)
    expect(ev.defeito.headIntacto).toBe(true)
    expect(ev.defeito.bloqueadoPor).toBe("a saída do hook cita o arquivo do defeito")
    expect(ev.oferta.exit).toBe(0)
    expect(ev.oferta.classe.offenders).toEqual([MIRROR_COMPOSE])
    expect(ev.oferta.classe.fixer).toBe(FIXER)
    expect(ev.oferta.citadaPeloHook).toBe(true)
    expect(ev.controle).toMatchObject({
      fixer: 0,
      guarda: 0,
      restauradoNoIndice: true,
      status: 0,
      conteudoEmHead: "a declaração restaurada",
    })
  }, 120_000)

  it("sem hook no checkout: INDETERMINADO nomeando o que faltou (não 'nada a provar')", () => {
    const r = proveRemedyOffered({ root: "/tmp/nao-e-um-checkout-do-remedo" })
    expect(r.state).toBe("unavailable")
    expect(r.detail).toContain("não existe neste checkout")
    expect(r.evidence).toBeNull()
  })
})

describe("as metades de FALHA da prova da oferta", () => {
  it("bloqueio CEGO (o defeito entra): VIOLADO, nomeando o que passou", () => {
    const r = proveRemedyOffered({
      deps: { runCommit: () => ({ status: 0, output: "" }) },
    })
    expect(r.state).toBe("violated")
    expect(r.detail).toContain("NÃO bloqueou")
    expect(r.detail).toContain(MIRROR_COMPOSE)
  })

  it("a recusa veio de OUTRO lugar (a saída não cita o guard dono): INDETERMINADO", () => {
    const r = proveRemedyOffered({
      deps: { runCommit: () => ({ status: 1, output: "recusado por outra coisa" }) },
    })
    expect(r.state).toBe("unavailable")
    expect(r.detail).toContain("o não-zero veio de outro lugar")
  })

  it("a OFERTA sem a classe: VIOLADO (o operador corrigiria à mão o que a máquina remenda)", () => {
    const r = proveRemedyOffered({
      deps: { offerOf: () => ({ status: 0, json: { classes: [] }, output: "" }) },
    })
    expect(r.state).toBe("violated")
    expect(r.detail).toContain("a OFERTA não tem a classe")
    expect(r.detail).toContain(CLASSE)
  })

  it("a classe existe na oferta mas o HOOK não a publica: VIOLADO (o vínculo é medido)", () => {
    // A recusa cita o ARQUIVO (o guard dono recusou) mas não o NOME da classe: a
    // oferta existe medida de fora do hook, e quem a deveria publicar é ele.
    const r = proveRemedyOffered({
      deps: { runCommit: () => ({ status: 1, output: MIRROR_COMPOSE }) },
    })
    expect(r.state).toBe("violated")
    expect(r.detail).toContain("recusou sem entregar a oferta")
  })

  it("o fixer do dono falha: VIOLADO — a oferta aponta para um remendo que não fecha", () => {
    const r = proveRemedyOffered({
      deps: { cli: () => ({ status: 1, output: "" }) },
    })
    expect(r.state).toBe("violated")
    expect(r.detail).toContain("não restaurou a declaração")
  })

  it("o fixer roda e o `--staged` do dono continua vermelho: VIOLADO", () => {
    const r = proveRemedyOffered({
      deps: {
        cli: (_dir: string, _script: string, args: string[]) =>
          args.includes("--fix")
            ? { status: 0, output: "" }
            : { status: 1, output: "ainda vermelho" },
      },
    })
    expect(r.state).toBe("violated")
    expect(r.detail).toContain("continua vermelho")
  })

  it("o fixer 'passa' sem devolver a declaração ao ÍNDICE: VIOLADO (não é o remendo da classe)", () => {
    const r = proveRemedyOffered({
      deps: { cli: () => ({ status: 0, output: "" }) },
    })
    expect(r.state).toBe("violated")
    expect(r.detail).toContain("não devolveu ao ÍNDICE")
  })

  it("o CONTROLE não entra e a recusa cita o dono: VIOLADO", () => {
    // A recusa cita o ARQUIVO e a CLASSE nas DUAS metades: no defeito (é o
    // caminho real) e no CONTROLE, que continua recusando — e é ele que esta
    // metade mede, com o remendo já aplicado.
    const r = proveRemedyOffered({
      deps: {
        cli: () => ({ status: 0, output: "" }),
        git: (dir: string, args: string[]) =>
          args[0] === "show" ? { status: 0, output: MIRROR_COMPOSE_COM_ARG } : runGit(dir, args),
        runCommit: () => ({ status: 1, output: `${MIRROR_COMPOSE} ${CLASSE}` }),
      },
    })
    expect(r.state).toBe("violated")
    expect(r.detail).toContain("o guard dono continua vermelho")
  })

  it("o CONTROLE não entra e a recusa NÃO cita o dono: INDETERMINADO (a recusa veio de outro lugar)", () => {
    let n = 0
    const r = proveRemedyOffered({
      deps: {
        cli: () => ({ status: 0, output: "" }),
        git: (dir: string, args: string[]) =>
          args[0] === "show" ? { status: 0, output: MIRROR_COMPOSE_COM_ARG } : runGit(dir, args),
        runCommit: () => {
          n += 1
          return {
            status: 1,
            output: n === 1 ? `${MIRROR_COMPOSE} ${CLASSE}` : "outra coisa recusou",
          }
        },
      },
    })
    expect(r.state).toBe("unavailable")
    expect(r.detail).toContain("a recusa veio de outro lugar")
  })
})
