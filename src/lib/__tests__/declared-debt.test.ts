/**
 * declared-debt.test.ts
 *
 * Testes do scripts/declared-debt.mjs — a IDADE da dívida DECLARADA do
 * repositório (as isenções com `addedAt` e o baseline do SIGPIPE).
 *
 * O que precisa ser provado (o medidor pode "parecer" certo e mentir):
 *   1. a JANELA é a do dono da lista (nada de uma segunda régua aqui) e a idade
 *      vem da DATA DA DECISÃO — com `now` INJETADO, porque uma prova de
 *      envelhecimento que dependesse do relógio da máquina mediria o dia em que a
 *      suíte roda;
 *   2. os quatro estados são distinguíveis e NÃO se confundem: `proven` (dentro),
 *      `aged` (venceu), `invalid` (sem registro — fail-closed, ganha de `aged`) e
 *      `sem-divida` (nada declarado); e a lista ILEGÍVEL é `unread`, jamais
 *      "sem dívida";
 *   3. a DECLARAÇÃO (o baseline do SIGPIPE, forma diferente das listas) mede
 *      pelas MESMAS regras: ausente = `sem-divida` (a classe foi aposentada),
 *      vencida = `aged`, JSON corrompido = `unread`;
 *   4. o agregado é o PIOR estado (uma lista vencida não some atrás de três
 *      verdes);
 *   5. a prosa diz QUAL lista, QUAL entrada, há quanto tempo e o REMÉDIO — sem
 *      isso o veredito e a issue mandariam procurar em quatro lugares.
 *
 * Node puro, sem rede: as listas sintéticas substituem as do repositório pelo
 * parâmetro `sources`, e o caso do repositório REAL entra no fim como rede de
 * segurança (nenhuma decisão sem data pode passar daqui).
 */

import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import { afterAll, describe, expect, it } from "vitest"

import {
  DECLARED_DEBT_SOURCES,
  collectDeclaredDebt,
  renderDeclaredDebt,
  sourceState,
  textoFonteVencida,
} from "../../../scripts/declared-debt.mjs"

const SCRIPT = resolve(process.cwd(), "scripts/declared-debt.mjs")
const tmpDirs: string[] = []

function makeTmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "declared-debt-"))
  tmpDirs.push(dir)
  return dir
}

afterAll(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** Um dia em ms — a mesma unidade do módulo (e não um número solto no teste). */
const DIA = 86_400_000
const HOJE = Date.UTC(2026, 8, 15)

/** Uma lista de decisões sintética, com a janela do dono. */
function lista(entries: object[], reviewDays = 180, idOf = (e: any) => e.path): object {
  return {
    id: "sintetica",
    listName: "LISTA_SINTETICA",
    owner: "scripts/exemplo.mjs",
    kind: "entries",
    entries: () => entries,
    idOf,
    reviewDays,
    remedy: "reafirme a exceção atualizando o `addedAt`",
  }
}

const dataAtras = (dias: number): string => new Date(HOJE - dias * DIA).toISOString().slice(0, 10)

describe("sourceState — os estados não se confundem", () => {
  it("ilegível ganha de tudo (não ler não é 'sem dívida')", () => {
    expect(sourceState({ invalid: [{}], aged: [{}], unread: true, total: 5 })).toBe("unread")
  })

  it("sem registro ganha de vencida: sem data não há como envelhecer", () => {
    expect(sourceState({ invalid: [{}], aged: [{}], unread: false, total: 5 })).toBe("invalid")
  })

  it("vencida, dentro e vazia são estados distintos", () => {
    expect(sourceState({ invalid: [], aged: [{}], unread: false, total: 5 })).toBe("aged")
    expect(sourceState({ invalid: [], aged: [], unread: false, total: 5 })).toBe("proven")
    expect(sourceState({ invalid: [], aged: [], unread: false, total: 0 })).toBe("sem-divida")
  })
})

describe("collectDeclaredDebt — a IDADE vem da data da decisão", () => {
  it("decisão DENTRO da janela: `proven`, com a idade da mais antiga", () => {
    const fato = collectDeclaredDebt({
      now: HOJE,
      sources: [lista([{ path: "a.mjs", addedAt: dataAtras(10) }])],
    })
    expect(fato.state).toBe("proven")
    expect(fato.sources[0].state).toBe("proven")
    expect(fato.sources[0].total).toBe(1)
    expect(fato.sources[0].oldest).toEqual({ id: "a.mjs", addedAt: dataAtras(10), days: 10 })
  })

  it("passada a JANELA: `aged`, com os dias, o limite e o remédio do dono", () => {
    const fato = collectDeclaredDebt({
      now: HOJE,
      sources: [lista([{ path: "a.mjs", addedAt: dataAtras(200) }])],
    })
    expect(fato.state).toBe("aged")
    expect(fato.sources[0].aged).toEqual([
      { id: "a.mjs", addedAt: dataAtras(200), days: 200, limit: 180 },
    ])
    expect(fato.sources[0].remedy).toContain("reafirme a exceção")
  })

  it("a JANELA é do dono da lista (outra janela muda o veredito da MESMA decisão)", () => {
    const entrada = [{ path: "a.mjs", addedAt: dataAtras(50) }]
    expect(collectDeclaredDebt({ now: HOJE, sources: [lista(entrada, 180)] }).state).toBe("proven")
    expect(collectDeclaredDebt({ now: HOJE, sources: [lista(entrada, 30)] }).state).toBe("aged")
  })

  it("decisão SEM data válida: `invalid` (fail-closed) — e nunca contada como vencida", () => {
    const fato = collectDeclaredDebt({
      now: HOJE,
      sources: [lista([{ path: "a.mjs" }, { path: "b.mjs", addedAt: "2026-02-30" }])],
    })
    expect(fato.state).toBe("invalid")
    expect(fato.sources[0].invalid.map((i: any) => i.id).sort()).toEqual(["a.mjs", "b.mjs"])
    expect(fato.aged).toEqual([])
  })

  it("lista VAZIA é `sem-divida` (nada declarado ≠ vencido)", () => {
    const fato = collectDeclaredDebt({ now: HOJE, sources: [lista([])] })
    expect(fato.state).toBe("sem-divida")
    expect(fato.total).toBe(0)
  })

  it("o agregado é o PIOR estado (uma vencida não some atrás de verdes)", () => {
    const fato = collectDeclaredDebt({
      now: HOJE,
      sources: [
        { ...lista([{ path: "ok.mjs", addedAt: dataAtras(1) }]), id: "ok" },
        { ...lista([{ path: "velha.mjs", addedAt: dataAtras(400) }]), id: "velha" },
      ],
    })
    expect(fato.state).toBe("aged")
    expect(fato.sources.map((s: any) => s.state)).toEqual(["proven", "aged"])
    expect(fato.aged).toHaveLength(1)
    expect(fato.aged[0].source.id).toBe("velha")
  })

  it("a lista que NÃO pôde ser lida é `unread` — nunca 'sem dívida'", () => {
    const quebrada = {
      ...lista([]),
      id: "quebrada",
      entries: () => {
        throw new Error("boom")
      },
    }
    const fato = collectDeclaredDebt({ now: HOJE, sources: [quebrada] })
    expect(fato.state).toBe("unread")
    expect(fato.sources[0].state).toBe("unread")
    expect(fato.sources[0].detail).toContain("boom")
  })
})

describe("collectDeclaredDebt — a DECLARAÇÃO (o baseline) mede pelas mesmas regras", () => {
  const declaracao = (read: () => object): object => ({
    id: "baseline",
    listName: "docs/quality/exemplo-baseline.json",
    owner: "scripts/exemplo.mjs",
    kind: "declaration",
    read,
    reviewDays: null,
    remedy: "reafirme com `--update --reason`",
  })

  const baseline = (over: object = {}): object => ({
    files: { "a.mjs": 1 },
    declaredAt: dataAtras(1),
    reason: "decisão escrita",
    reviewAfterDays: 180,
    total: 1,
    ...over,
  })

  it("declaração AUSENTE (dívida aposentada) é `sem-divida`, não `proven`", () => {
    const fato = collectDeclaredDebt({
      now: HOJE,
      sources: [declaracao(() => ({ files: {}, declaredAt: null, total: 0, ausente: true }))],
    })
    expect(fato.state).toBe("sem-divida")
    expect(fato.sources[0].total).toBe(0)
  })

  it("declaração VENCIDA é `aged`, com a data e a janela do PRÓPRIO arquivo", () => {
    const fato = collectDeclaredDebt({
      now: HOJE,
      sources: [declaracao(() => baseline({ declaredAt: dataAtras(300) }))],
    })
    expect(fato.state).toBe("aged")
    expect(fato.aged).toEqual([
      {
        id: "baseline:1 ocorrência(s)",
        addedAt: dataAtras(300),
        days: 300,
        limit: 180,
        source: fato.sources[0],
      },
    ])
  })

  it("declaração SEM `reason` é `invalid` (a decisão não se pode confiar)", () => {
    const fato = collectDeclaredDebt({
      now: HOJE,
      sources: [declaracao(() => baseline({ reason: "" }))],
    })
    expect(fato.state).toBe("invalid")
    expect(fato.sources[0].invalid[0].why).toContain("reason")
  })

  it("JSON CORROMPIDO é `unread` (a leitura falhou; a dívida não desapareceu)", () => {
    const fato = collectDeclaredDebt({
      now: HOJE,
      sources: [
        declaracao(() => ({ files: {}, declaredAt: null, total: 0, erro: "Unexpected token" })),
      ],
    })
    expect(fato.state).toBe("unread")
    expect(fato.sources[0].detail).toContain("Unexpected token")
  })
})

describe("a prosa — a mesma medição contada para o veredito e para a issue", () => {
  it("a fonte vencida nomeia a lista, a entrada mais velha, a data, os dias e o remédio", () => {
    const fato = collectDeclaredDebt({
      now: HOJE,
      sources: [
        lista([
          { path: "nova.mjs", addedAt: dataAtras(200) },
          { path: "antiga.mjs", addedAt: dataAtras(400) },
        ]),
      ],
    })
    const texto = textoFonteVencida(fato.sources[0])
    expect(texto).toContain("LISTA_SINTETICA")
    expect(texto).toContain("scripts/exemplo.mjs")
    expect(texto).toContain("antiga.mjs")
    expect(texto).toContain(dataAtras(400))
    expect(texto).toContain("400 dia(s)")
    expect(texto).toContain("janela de 180")
    expect(texto).toContain("reafirme a exceção")
  })

  it("o registro AUSENTE diz o MOTIVO (a lista não é o problema: a data é)", () => {
    const fato = collectDeclaredDebt({
      now: HOJE,
      sources: [lista([{ path: "sem-data.mjs" }])],
    })
    const texto = textoFonteVencida(fato.sources[0])
    expect(texto).toContain("SEM REGISTRO")
    expect(texto).toContain("sem-data.mjs")
    expect(texto).toContain("addedAt")
  })

  it("o relatório em texto mostra uma linha por lista, com o estado e a janela", () => {
    const fato = collectDeclaredDebt({
      now: HOJE,
      sources: [
        { ...lista([{ path: "a.mjs", addedAt: dataAtras(400) }]), id: "velha" },
        { ...lista([{ path: "b.mjs", addedAt: dataAtras(1) }]), id: "ok" },
      ],
    })
    const texto = renderDeclaredDebt(fato)
    expect(texto).toContain("[aged]")
    expect(texto).toContain("[proven]")
    expect(texto).toContain("janela de 180 dia(s)")
    expect(texto).toContain("ESTADO: aged")
    expect(texto).toContain("1 SEM REVISÃO")
  })
})

describe("o repositório REAL — a rede de segurança contra uma decisão sem data", () => {
  it("mede as quatro fontes declaradas, sem nenhuma ilegível ou sem registro", () => {
    const fato = collectDeclaredDebt({ now: HOJE })
    expect(DECLARED_DEBT_SOURCES.map((s: any) => s.id)).toEqual([
      "out-of-scope",
      "third-party",
      "unused-deps",
      "sigpipe",
    ])
    expect(fato.sources).toHaveLength(4)
    // `invalid`/`unread` aqui são o MESMO fail-closed dos guards — o portão já
    // existe nos dois modos; esta linha só impede que ele passe despercebido.
    expect(fato.invalid).toEqual([])
    expect(fato.unread).toEqual([])
    expect(fato.total).toBeGreaterThan(0)
  })

  it("a lista de donos aponta para quem DECIDE (o guard), não para uma cópia", () => {
    for (const fonte of DECLARED_DEBT_SOURCES as any[]) {
      expect(fonte.owner).toMatch(/^scripts\/.+\.mjs$/)
      expect(fonte.remedy).toBeTruthy()
      if (fonte.kind === "entries") {
        expect(typeof fonte.idOf).toBe("function")
        expect(fonte.reviewDays).toBeGreaterThan(0)
      }
    }
  })
})

describe("o comando — fail-closed de infraestrutura", () => {
  it("--root inexistente sai 2 (não é uso inválido nem 'sem dívida')", () => {
    const r = spawnSync("node", [SCRIPT, "--root", "/nao/existe/mesmo"], { encoding: "utf8" })
    expect(r.status).toBe(2)
    expect(r.stderr).toContain("--root")
  })

  it("flag desconhecida sai 3", () => {
    const r = spawnSync("node", [SCRIPT, "--nao-existe"], { encoding: "utf8" })
    expect(r.status).toBe(3)
    expect(r.stderr).toContain("desconhecida")
  })

  it("--json publica o fato ESTRUTURADO (o consumidor não re-deriva a idade)", () => {
    const r = spawnSync("node", [SCRIPT, "--json"], { encoding: "utf8" })
    expect(r.status).toBe(0)
    const fato = JSON.parse(r.stdout)
    // O ESTADO do repositório pode ser `aged` (dívida vencida não bloqueia o PR:
    // quem cobra é a issue) — o que não pode é sair da vocabulário ou esconder
    // uma lista.
    expect(["proven", "aged", "sem-divida"]).toContain(fato.state)
    expect(fato.sources.map((s: { id: string }) => s.id)).toContain("unused-deps")
  })

  it("o cabeçalho documenta Usage e Exit codes (o contrato dos scripts)", () => {
    const fonte = readFileSync(SCRIPT, "utf8")
    expect(fonte).toContain("// Usage:")
    expect(fonte).toContain("// Exit codes:")
  })
})

describe("fixture em tmpdir — o `--root` mede OUTRA árvore, não o checkout", () => {
  it("mede o baseline do `--root` dado (e não o do repositório)", () => {
    const dir = makeTmpDir()
    const destino = join(dir, "docs/quality")
    mkdirSync(destino, { recursive: true })
    writeFileSync(
      join(destino, "pipefail-sigpipe-baseline.json"),
      JSON.stringify({
        files: { "a.sh": 2 },
        declaredAt: dataAtras(300),
        reason: "declarada no passado, sem revisão",
        reviewAfterDays: 180,
        total: 2,
      }),
    )
    const r = spawnSync("node", [SCRIPT, "--root", dir, "--json"], { encoding: "utf8" })
    const fato = JSON.parse(r.stdout)
    const sigpipe = fato.sources.find((s: { id: string }) => s.id === "sigpipe")
    expect(sigpipe.state).toBe("aged")
    expect(sigpipe.total).toBe(2)
  })
})
