/**
 * bench-freshness.test.ts
 *
 * Testes da RÉGUA da idade do bench (`scripts/bench-freshness.mjs`) e do
 * PUBLICADOR da dívida (`scripts/bench-freshness-issue.mjs`).
 *
 * O QUE PRECISA SER PROVADO (uma régua de idade pode "parecer" certa e não
 * alertar nada):
 *   1. a FRONTEIRA do teto: `behind === teto` é fresca e `teto + 1` é vencida —
 *      um `>=` no lugar de `>` transformaria toda medição no limite em dívida;
 *   2. o CONJUNTO julgado é o do dono (`FAMILY_MEASURED`): família que o arquivo
 *      não declara medida não ganha dívida de frescor;
 *   3. a PROCEDÊNCIA é dita, não presumida: `meta.families` manda; sem ela, a
 *      origem cai para o `meta.commit` do arquivo — e isso sai NOMEADO;
 *   4. "NÃO CONSEGUI MEDIR" não é fresco: objeto ausente (clone raso), git
 *      ausente, arquivo ilegível e JSON inválido devolvem estado próprio com a
 *      causa — nunca uma lista de famílias vazia que o veredito leria como "sem
 *      régua velha";
 *   5. o commit de origem FORA da história (`diverged`) é dívida: o número medido
 *      ali não se reproduz nesta árvore;
 *   6. a ASSINATURA deduplica o ruído: o `behind` que anda a cada commit não
 *      muda a assinatura; a FAIXA (quantos tetos) e o conjunto de famílias mudam;
 *   7. o CICLO completo (criar, deduplicar, COMENTAR a prova e FECHAR quando a
 *      régua volta ao teto) roda contra um backend em memória — e NÃO MEDIDO não
 *      fecha nada;
 *   8. o canal existe no cron REAL: o job semanal invoca o publicador com a
 *      história completa (`fetch-depth: 0`, sem a qual a idade sai "sem idade") e
 *      o `ci/periodic-alerts.json` classifica o canal como `issue`;
 *   9. a idade vale para QUALQUER número declarado, não só o bench: cada `ms` do
 *      modelo de latência e cada tabela de custo do README entra no MESMO fato,
 *      com a origem DERIVADA DA DATA (`rev-list -1 --before`) — e a declaração
 *      sem data de origem é `unknown` nomeado, nunca uma unidade ignorada. O
 *      teto é POR TIPO: a prosa do README publica a idade sem vencer por ela.
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it, vi } from "vitest"

import {
  BASELINE_PATH,
  BLOCK_LOOKBACK,
  FRESHNESS_CEILINGS,
  FRESHNESS_MAX_COMMITS_BEHIND,
  MODEL_PATH,
  POLITICA_DO_TETO,
  README_PATH,
  REMEDY_COMMAND,
  anchorBefore,
  anchorLabel,
  ceilingOf,
  commitAge,
  commitOfDate,
  dateAnchor,
  declarationFamilies,
  familyFreshness,
  freshnessLine,
  medirRitmoDeCommits,
  modelDeclarations,
  readBenchFreshness,
  readFreshness,
  readmeDeclarations,
  tetoDoRitmo,
  tetoLine,
} from "../../../scripts/bench-freshness.mjs"
import {
  BENCH_FRESHNESS_PUBLISHER,
  ISSUE_LABEL,
  MARKER_ID,
  agedOf,
  bandOf,
  divergedOf,
  freshnessBody,
  freshnessTitle,
  inputOf,
  isActionable,
  signatureOf,
  unknownOf,
} from "../../../scripts/bench-freshness-issue.mjs"
import { FAMILY_MEASURED } from "../../../scripts/bench-guard-timing.mjs"
import { DEBT_SUBJECTS } from "../../../scripts/forge-doctor.mjs"
import { MANIFEST_PATH, jobBlock } from "../../../scripts/check-periodic-alerts.mjs"
import { publisherSignatures, runDebtPublisher } from "../../../scripts/issue-publish.mjs"
import { getJob, loadWorkflow, readWorkflowContent } from "./helpers/workflow-execution"

const ROOT = process.cwd()
const WF = ".github/workflows/benchmark-weekly.yml"
const JOB = "guard-timing-alert"
const SCRIPT_REF = "scripts/bench-freshness-issue.mjs"

// ── 1. A régua: a sonda de git e o teto ────────────────────────────────────

/**
 * A JANELA do ritmo é uma pergunta DIFERENTE da idade em commits: o dublê só a
 * responde quando o teste DECLARA o ritmo (`ritmo`), porque "não consegui medir o
 * ritmo" é um caminho próprio do teto (a reserva declarada, com a origem
 * publicada) e um dublê que respondesse tudo apagaria os dois caminhos.
 */
function janelaDoRitmo(args: string[]): boolean {
  return args.some((a) => a.startsWith("--since="))
}

/**
 * Um git dublê: responde por SUBCOMANDO (`cat-file`, `merge-base`, `rev-list`).
 * É por ele que os três estados da idade são medidos sem repositório de verdade.
 */
function gitStub({
  existe = true,
  ancestral = true,
  count = 3,
  ritmo = null,
  erro = null,
}: {
  existe?: boolean
  ancestral?: boolean
  count?: number
  ritmo?: number | null
  erro?: Error | null
} = {}) {
  return (_cmd: string, args: string[]) => {
    if (erro) return { error: erro, status: null, stdout: "" }
    const sub = args[0]
    if (sub === "cat-file") {
      return existe
        ? { status: 0, stdout: "" }
        : { status: 128, stdout: "", stderr: "fatal: Not a valid object name" }
    }
    if (sub === "merge-base") return { status: ancestral ? 0 : 1, stdout: "" }
    if (sub === "rev-list" && janelaDoRitmo(args)) {
      return ritmo === null
        ? { status: 1, stdout: "", stderr: "dublê: o ritmo não foi declarado neste teste" }
        : { status: 0, stdout: `${ritmo}\n` }
    }
    if (sub === "rev-list") return { status: 0, stdout: `${count}\n` }
    return { status: 1, stdout: "" }
  }
}

describe("commitAge — a idade de UM commit de origem", () => {
  it("ancestral: devolve a distância em commits de HEAD", () => {
    const idade = commitAge({ commit: "aaa1111" }, { run: gitStub({ count: 12 }) as never })
    expect(idade).toMatchObject({ state: "ancestor", behind: 12 })
  })

  it("objeto AUSENTE do checkout (clone raso): `unknown` nomeando a causa — nunca fresco", () => {
    const idade = commitAge({ commit: "aaa1111" }, { run: gitStub({ existe: false }) as never })
    expect(idade.state).toBe("unknown")
    expect(idade.behind).toBeNull()
    expect(idade.reason).toContain("não está neste checkout")
    expect(idade.reason).toContain("clone raso")
  })

  it("sem git: `unknown` com a causa (não é 'sem dívida')", () => {
    const idade = commitAge(
      { commit: "aaa1111" },
      { run: gitStub({ erro: new Error("spawnSync git ENOENT") }) as never },
    )
    expect(idade.state).toBe("unknown")
    expect(idade.reason).toContain("git não pôde ser executado")
  })

  it("commit EXISTE mas não é ancestral (história reescrita): `diverged`, sem contagem", () => {
    const idade = commitAge(
      { commit: "aaa1111" },
      { run: gitStub({ ancestral: false, count: 999 }) as never },
    )
    expect(idade.state).toBe("diverged")
    expect(idade.behind).toBeNull()
    expect(idade.reason).toContain("NÃO é ancestral")
  })

  it("família sem commit declarado: `unknown` (não há idade a medir)", () => {
    const idade = commitAge({ commit: null }, { run: gitStub() as never })
    expect(idade.state).toBe("unknown")
    expect(idade.reason).toContain("não declara commit de origem")
  })
})

// ── 1.5. O TETO: derivado do ritmo, com a política declarando o que não se mede ─

describe("o teto de idade é DERIVADO do ritmo medido do repositório", () => {
  const medir = (ritmo: number | null) =>
    medirRitmoDeCommits({
      run: gitStub({ ritmo }) as never,
      agora: new Date("2026-09-21T12:00:00Z"),
    })

  it("`medirRitmoDeCommits`: conta a JANELA da política e devolve commits por ciclo", () => {
    const ritmo = medir(314)
    expect(ritmo.state).toBe("medido")
    expect(ritmo.commits).toBe(314)
    expect(ritmo.janelaDias).toBe(POLITICA_DO_TETO.janelaDias)
    expect(ritmo.desde).toContain("2026-08-24") // 28 dias antes do `agora`
    expect(ritmo.commitsPorCiclo).toBeCloseTo(314 / (POLITICA_DO_TETO.janelaDias / 7))
  })

  it("git que não responde — ou saída que não é contagem: `unknown` com a CAUSA", () => {
    const semGit = medirRitmoDeCommits({
      run: gitStub({ erro: new Error("spawnSync git ENOENT") }) as never,
    })
    expect(semGit.state).toBe("unknown")
    expect(semGit.reason).toContain("não respondeu a contagem")
    expect(semGit.commits).toBeNull()

    const lixo = medirRitmoDeCommits({
      run: (() => ({ status: 0, stdout: "não é número\n" })) as never,
    })
    expect(lixo.state).toBe("unknown")
    expect(lixo.reason).toContain("não é uma contagem de commits")

    // ZERO commits na janela também não vira "teto 0": um repositório parado é o
    // caso em que o PISO existe, e a decisão dele é outra (o desconhecido não
    // pode virar um teto por omissão).
    const parado = medirRitmoDeCommits({ run: (() => ({ status: 0, stdout: "0\n" })) as never })
    expect(parado.state).toBe("unknown")
  })

  it("o teto é `ciclos × commits por ciclo` — e o PISO declarado vence um ritmo baixo, dito no motivo", () => {
    const rapido = tetoDoRitmo(medir(600))
    expect(rapido).toMatchObject({ origem: "medido", teto: 300, commits: 600 })
    expect(rapido.commitsPorCiclo).toBeCloseTo(150)
    expect(rapido.motivo).toBeNull()

    const devagar = tetoDoRitmo(medir(8))
    expect(devagar.teto).toBe(POLITICA_DO_TETO.pisoDeCiclo * POLITICA_DO_TETO.ciclos)
    expect(devagar.motivo).toContain("PISO")
  })

  it("sem ritmo medido o teto é a RESERVA declarada — e a ORIGEM sai dita, nunca um teto silencioso", () => {
    const reserva = tetoDoRitmo(medir(null))
    expect(reserva.origem).toBe("reserva declarada")
    expect(reserva.teto).toBe(FRESHNESS_MAX_COMMITS_BEHIND)
    expect(reserva.motivo).toContain("não respondeu a contagem")
    expect(tetoLine({ maxBehind: reserva.teto, teto: reserva })).toContain("RESERVA declarada")
  })

  it("o VEREDITO segue o teto derivado: a MESMA idade é FRESCA com ritmo alto e VENCIDA com ritmo baixo", () => {
    // Load-bearing: entre as duas medições só o RITMO muda — a idade da
    // declaração é a mesma (100 commits atrás), e quem decide é o teto derivado.
    const mede = (ritmo: number) =>
      readFreshness({
        model: { jobs: { github: { job: { ms: 1, date: "2026-09-17", source: "s" } } } },
        readme: "",
        file: BASELINE_PATH,
        deps: {
          probe: () => ({ state: "ancestor", behind: 5, reason: "" }),
          run: gitDatas({ count: 100, ritmo }) as never,
        },
      })

    const rapido = mede(600)
    expect(rapido.teto).toMatchObject({ origem: "medido", teto: 300 })
    expect(rapido.aged).toEqual([])
    expect(rapido.families.find((f) => f.kind === "declared-number")!.state).toBe("fresh")

    const devagar = mede(8)
    expect(devagar.teto?.teto).toBe(POLITICA_DO_TETO.pisoDeCiclo * POLITICA_DO_TETO.ciclos)
    expect(devagar.aged).toContain("github/job")
    expect(devagar.families.find((f) => f.kind === "declared-number")!.state).toBe("aged")
  })

  it("o fato publica a PROCEDÊNCIA do número — e o teto explícito do chamador se declara como tal", () => {
    const derivado = readFreshness({
      model: { jobs: {} },
      readme: "",
      file: BASELINE_PATH,
      deps: {
        probe: () => ({ state: "ancestor", behind: 5 }),
        run: gitDatas({ ritmo: 314 }) as never,
      },
    })
    expect(derivado.teto).toMatchObject({
      origem: "medido",
      commits: 314,
      janelaDias: POLITICA_DO_TETO.janelaDias,
      ciclos: POLITICA_DO_TETO.ciclos,
      teto: 157,
    })
    expect(derivado.maxBehind).toBe(derivado.teto?.teto)
    expect(tetoLine(derivado)).toContain("derivado do ritmo — 314 commits em 28 dias")

    const doChamador = readFreshness({
      model: { jobs: {} },
      readme: "",
      file: BASELINE_PATH,
      maxBehind: 42,
      deps: { probe: () => ({ state: "ancestor", behind: 5 }), run: gitDatas() as never },
    })
    expect(doChamador.teto).toMatchObject({ teto: 42, origem: "declarado pelo chamador" })
    expect(doChamador.maxBehind).toBe(42)
    expect(tetoLine(doChamador)).toContain("declarado pelo chamador")
  })
})

// ── 2. O fato: o conjunto julgado, a fronteira e a procedência ─────────────

/** A baseline REAL, com o que cada teste quiser estragar (a forma é a do dono). */
const REAL = JSON.parse(
  readFileSync(join(ROOT, "docs/benchmarks/guard-timing-baseline.json"), "utf8"),
)

function bench(over: { commits?: Record<string, string | null>; semFamilies?: boolean } = {}) {
  const b = JSON.parse(JSON.stringify(REAL))
  if (over.semFamilies) delete b.meta.families
  for (const [fam, commit] of Object.entries(over.commits ?? {})) {
    b.meta.families[fam].commit = commit
  }
  return b
}

/** A sonda injetada: um número de commits por commit de origem. */
function probeDe(mapa: Record<string, { state: string; behind: number | null; reason?: string }>) {
  return (commit: string | null) =>
    mapa[commit ?? "null"] ?? { state: "unknown", behind: null, reason: "não mapeado no dublê" }
}

describe("familyFreshness — a régua do teto", () => {
  it("a fronteira: `behind === teto` é FRESCA e `teto + 1` é VENCIDA", () => {
    const noTeto = familyFreshness(bench({ commits: { mutations: "no-teto" } }), {
      probe: probeDe({ "no-teto": { state: "ancestor", behind: FRESHNESS_MAX_COMMITS_BEHIND } }),
    })
    expect(noTeto.families.find((f: { family: string }) => f.family === "mutations")).toMatchObject(
      { state: "fresh" },
    )
    expect(noTeto.aged).toEqual([])

    const acima = familyFreshness(bench({ commits: { mutations: "acima" } }), {
      probe: probeDe({ acima: { state: "ancestor", behind: FRESHNESS_MAX_COMMITS_BEHIND + 1 } }),
    })
    expect(acima.families.find((f: { family: string }) => f.family === "mutations")).toMatchObject({
      state: "aged",
      behind: FRESHNESS_MAX_COMMITS_BEHIND + 1,
    })
    expect(acima.aged).toEqual(["mutations"])
  })

  it("o conjunto julgado é o do DONO (`FAMILY_MEASURED`): família não medida não ganha dívida", () => {
    const b = bench()
    b.hook.measured = false
    const fact = familyFreshness(b, { probe: () => ({ state: "ancestor", behind: 999 }) })
    const nomes = fact.families.map((f: { family: string }) => f.family)
    expect(nomes).not.toContain("hook")
    expect(nomes.length).toBe(
      Object.keys(FAMILY_MEASURED).filter((k) => FAMILY_MEASURED[k](b)).length,
    )
    // E o que ENTRA está vencido: 999 > teto.
    expect(fact.aged).toEqual(nomes)
  })

  it("o commit é sondado UMA vez por VALOR (as seis famílias do mesmo ato custam uma pergunta)", () => {
    // As seis famílias de UM ato custam UMA pergunta: TODAS no mesmo commit.
    const umaOrigem = Object.fromEntries(
      Object.keys(REAL.meta.families).map((f) => [f, "mesmo-ato"]),
    )
    const probe = vi.fn(() => ({ state: "ancestor", behind: 4 }))
    const fact = familyFreshness(bench({ commits: umaOrigem }), { probe })
    expect(fact.families.length).toBe(6)
    expect(probe).toHaveBeenCalledTimes(1)

    expect(fact.behindMax).toBe(4)
    expect(fact.aged).toEqual([])

    // E DUAS procedências custam DUAS perguntas (uma por commit distinto — não
    // uma por família): é a cache por valor, não um contador de chamadas.
    const probeDois = vi.fn(() => ({ state: "ancestor", behind: 4 }))
    const doisAtos = familyFreshness(bench({ commits: { ...umaOrigem, mutations: "outro-ato" } }), {
      probe: probeDois,
    })
    expect(doisAtos.families.length).toBe(6)
    expect(probeDois).toHaveBeenCalledTimes(2)
  })

  it("a PROCEDÊNCIA é dita: sem `meta.families` a origem é o `meta.commit` do arquivo", () => {
    const fact = familyFreshness(bench({ semFamilies: true }), {
      probe: () => ({ state: "ancestor", behind: 1 }),
    })
    for (const f of fact.families) {
      expect(f.origin).toBe("meta.commit")
      expect(f.commit).toBe(REAL.meta.commit)
    }
    // Com a tabela do dono, a origem é a DA FAMÍLIA (e o ato aparece).
    const comTabela = familyFreshness(bench(), {
      probe: () => ({ state: "ancestor", behind: 1 }),
    })
    expect(comTabela.families.every((f: { origin: string }) => f.origin === "family")).toBe(true)
    expect(comTabela.families.map((f) => f.act)).toContain("measured")
  })

  it("um commit FORA da história entra como `diverged` (e não como contagem inventada)", () => {
    const fact = familyFreshness(bench({ commits: { tests: "sumiu" } }), {
      probe: probeDe({
        [REAL.meta.commit]: { state: "ancestor", behind: 2 },
        sumiu: { state: "diverged", behind: null, reason: "não é ancestral de HEAD" },
      }),
    })
    expect(fact.diverged).toEqual(["tests"])
    expect(fact.aged).toEqual([])
    expect(fact.detail).toContain("fora da história")
    expect(fact.remedies.join(" ")).toContain(REMEDY_COMMAND)
  })

  it("família SEM idade (clone raso) deixa o fato medido, mas a lista `unknown` não some", () => {
    // A baseline tem procedência POR FAMÍLIA (dois atos): o dublê mapeia cada
    // commit distinto — o de `lint`, o do ato novo — senão as famílias do outro
    // commit caíssem em `unknown` por um dublê que só conhece `meta.commit`.
    const origens = [
      ...new Set((Object.values(REAL.meta.families) as { commit: string }[]).map((f) => f.commit)),
    ]
    const fact = familyFreshness(bench({ commits: { lint: "ausente" } }), {
      probe: probeDe({
        ...Object.fromEntries(origens.map((c: string) => [c, { state: "ancestor", behind: 2 }])),
        ausente: {
          state: "unknown",
          behind: null,
          reason: "o commit de origem ausente não está neste checkout (clone raso)",
        },
      }),
    })
    expect(fact.state).toBe("measured")
    expect(fact.unknown).toEqual(["lint"])
    expect(fact.aged).toEqual([])
    expect(fact.detail).toContain("SEM idade")
  })

  it("sem família medida (ou sem sonda) o fato é `unavailable` — nunca uma lista vazia", () => {
    const b = bench()
    for (const fam of Object.keys(FAMILY_MEASURED))
      delete (b as never as Record<string, unknown>)[fam]
    // `battery` é DERIVADA de `guards`/`doctor` e `typecheck`/`tests` moram sob
    // `rulers`: o arquivo sem família medida é o que não tem os três também.
    delete (b as never as Record<string, unknown>).guards
    delete (b as never as Record<string, unknown>).doctor
    delete (b as never as Record<string, unknown>).rulers
    expect(familyFreshness(b, { probe: () => ({ state: "ancestor", behind: 0 }) }).state).toBe(
      "unavailable",
    )
    expect(familyFreshness(bench(), {}).state).toBe("unavailable")
  })

  it("freshnessLine diz o estado em uma linha (o relatório e a issue usam a MESMA)", () => {
    const fresca = familyFreshness(bench(), {
      probe: () => ({ state: "ancestor", behind: 3 }),
    })
    expect(freshnessLine(fresca)).toContain("a mais antiga 3 commit(s) atrás")
    const cega = familyFreshness(bench(), {})
    expect(freshnessLine(cega)).toContain("NÃO medida")
  })
})

// ── 3. O leitor: fail-closed em cada passo ─────────────────────────────────

describe("readBenchFreshness — o arquivo e o git", () => {
  it("arquivo AUSENTE: `unavailable` com o caminho (nunca 'sem família velha')", () => {
    const fact = readBenchFreshness({ file: "nao/existe.json", deps: { exists: () => false } })
    expect(fact.state).toBe("unavailable")
    expect(fact.reason).toContain("nao/existe.json")
    expect(fact.families).toEqual([])
    expect(fact.remedies.join(" ")).toContain("história")
  })

  it("JSON INVÁLIDO: `unavailable` com a causa", () => {
    const fact = readBenchFreshness({
      file: BASELINE_PATH,
      deps: { exists: () => true, read: () => "{ isso não é json" },
    })
    expect(fact.state).toBe("unavailable")
    expect(fact.reason).toContain("não é JSON válido")
  })

  it("leitura TRUNCADA (não-objeto): `unavailable`", () => {
    const fact = readBenchFreshness({
      file: BASELINE_PATH,
      deps: { exists: () => true, read: () => JSON.stringify([1, 2, 3]) },
    })
    expect(fact.state).toBe("unavailable")
    expect(fact.reason).toContain("não é um objeto")
  })

  it("a baseline REAL, com a sonda injetada: medida, com o arquivo citado no fato", () => {
    const fact = readBenchFreshness({
      file: BASELINE_PATH,
      deps: { probe: () => ({ state: "ancestor", behind: 5 }) },
    })
    expect(fact.state).toBe("measured")
    expect(fact.file).toBe(BASELINE_PATH)
    expect(fact.families.length).toBe(6)
    expect(fact.aged).toEqual([])
  })

  it("o CLI roda contra a baseline real e sai 0 (o default do repositório está fresco)", () => {
    const fact = readBenchFreshness({})
    expect(fact.state).toBe("measured")
    expect(fact.aged.concat(fact.diverged)).toEqual([])
  })
})

// ── 3.5. As DECLARAÇÕES datadas: o modelo de latência e as tabelas do README ─

/** Um git dublê para as TRÊS perguntas: a âncora vira commit, o commit vira idade,
 * e a janela do ritmo só responde se o teste declarar `ritmo` (ver `gitStub`). */
function gitDatas({
  commits = ["c1", "c2"],
  count = 7,
  ritmo = null,
  erro = null,
}: {
  commits?: string[]
  count?: number
  ritmo?: number | null
  erro?: Error | null
} = {}) {
  const fila = [...commits]
  return (_cmd: string, args: string[]) => {
    if (erro) return { error: erro, status: null, stdout: "" }
    if (args[0] === "rev-list" && args[1] === "-1") {
      const commit = fila.shift() ?? ""
      return { status: 0, stdout: commit ? `${commit}\n` : "" }
    }
    if (args[0] === "rev-list" && janelaDoRitmo(args)) {
      return ritmo === null
        ? { status: 1, stdout: "", stderr: "dublê: o ritmo não foi declarado neste teste" }
        : { status: 0, stdout: `${ritmo}\n` }
    }
    if (args[0] === "rev-list") return { status: 0, stdout: `${count}\n` }
    if (args[0] === "cat-file") return { status: 0, stdout: "" }
    if (args[0] === "merge-base") return { status: 0, stdout: "" }
    return { status: 1, stdout: "" }
  }
}

/**
 * A FORMA que estes testes leem das unidades e do fato.
 *
 * O módulo é JS: os tipos que o TS infere para `units`/`families` são largos
 * (`object[]`/`FamilyAge[]`) e não cobrem `kind`, `ceiling` nem `date`. A leitura
 * é tipada AQUI, uma vez, em vez de em cada asserção.
 */
type Unidade = {
  family: string
  kind: string
  date: string | null
  anchorKind?: string
  origin: string
  act: string | null
  source: string
  ceiling: number | null
  state: string
  behind: number | null
  reason: string | null
  commit: string | null
}
type Problema = { id: string; file: string; reason: string }
type Fato = {
  state: string
  families: Unidade[]
  aged: string[]
  diverged: string[]
  unknown: string[]
  detail: string
}

const unidades = (r: unknown) => (r as { units: Unidade[] }).units
const problemas = (r: unknown) => (r as { problems: Problema[] }).problems
const fato = (r: unknown) => r as Fato
const familias = (r: unknown) => (r as { families: Unidade[] }).families

/** As unidades E os problemas de uma leitura só (a fonte é lida uma vez). */
function leitura<T>(r: T) {
  return { units: unidades(r), problems: problemas(r), raw: r }
}

describe("dateAnchor — as três formas da âncora datada", () => {
  it("dd/mm/aaaa (o que o repositório escreve nas medições datadas)", () => {
    expect(dateAnchor("Medido em 17/09/2026:")).toEqual({ date: "2026-09-17", kind: "day" })
  })

  it("aaaa-mm-dd (a forma do próprio modelo)", () => {
    expect(dateAnchor("2026-09-17")).toEqual({ date: "2026-09-17", kind: "day" })
  })

  it("mm/aaaa NÃO inventa o dia: a unidade é `month` (o ÚLTIMO commit do mês)", () => {
    const anchor = dateAnchor("Custo medido em 08/2026 (Windows host)")!
    expect(anchor).toEqual({ date: "2026-08-01", kind: "month" })
    expect(anchorBefore(anchor)).toBe("2026-09-01 00:00:00")
    expect(anchorLabel(anchor)).toBe("08/2026")
  })

  it("sem data: `null` (não é meia data)", () => {
    expect(dateAnchor("medido no host local, 3 runs")).toBeNull()
  })
})

describe("modelDeclarations — cada `ms` com a SUA data", () => {
  const modelo = {
    meta: { date: "2026-09-01" },
    jobs: {
      github: {
        simples: { ms: 100, date: "2026-09-17", source: "s", provenance: "declarado" },
        semData: { ms: 200, source: "s" },
        teto: { ms: 600_000, ceiling: true, provenance: "declarado (TETO: timeout-minutes)" },
        composto: {
          steps: [
            { run: "a", ms: 10, date: "2026-09-17", source: "s" },
            { run: "b", from: { family: "mutations", form: "x" } },
            { run: "c", ms: 20, source: "s" },
          ],
        },
      },
    },
  }

  it("o job declarado e o passo medido entram NOMEADOS, com a data DE CADA UM", () => {
    const { units } = leitura(modelDeclarations(modelo))
    const ids = units.map((u) => u.family)
    expect(ids).toContain("github/simples")
    expect(ids).toContain("github/composto#1")
    expect(units.every((u) => u.kind === "declared-number")).toBe(true)
    expect(units.every((u) => u.origin === "date")).toBe(true)
  })

  it("o passo DERIVADO não vira unidade: a origem dele é a família do bench (já julgada)", () => {
    const { units } = leitura(modelDeclarations(modelo))
    expect(units.map((u) => u.family)).not.toContain("github/composto#2")
  })

  it("o TETO (`timeout-minutes`) fica FORA: limite não é medição", () => {
    const { units, problems } = leitura(modelDeclarations(modelo))
    expect(units.map((u) => u.family)).not.toContain("github/teto")
    expect(problems.map((p) => p.id)).not.toContain("github/teto")
  })

  it("`ms` SEM a própria data é PROBLEMA nomeado — o `meta.date` do ato não data o número", () => {
    const { units, problems } = leitura(modelDeclarations(modelo))
    expect(units.map((u) => u.family)).not.toContain("github/semData")
    const p = problems.find((x) => x.id === "github/semData")!
    expect(p.reason).toContain("SEM data própria")
    expect(p.reason).toContain("não a da medição")
  })

  it("o passo medido sem data também: o problema é DELE, não do job", () => {
    const { units, problems } = leitura(modelDeclarations(modelo))
    expect(units.map((u) => u.family)).not.toContain("github/composto#3")
    const p = problems.find((x) => x.id === "github/composto#3")!
    expect(p.reason).toContain("o passo 3 de github/composto")
  })
})

describe("readmeDeclarations — a tabela que declara duração precisa da âncora", () => {
  const tabela = ["| Camada | Tempo |", "| :----- | ----: |", "| Pre-commit | ~2s |"]

  it("com a âncora datada no bloco: uma unidade por TABELA, com a data do bloco", () => {
    const texto = ["Tempos como estão desde **03/08/2026**.", "", ...tabela].join("\n")
    const { units, problems } = leitura(readmeDeclarations(texto))
    expect(problems).toEqual([])
    expect(units).toHaveLength(1)
    expect(units[0]).toMatchObject({
      kind: "declared-table",
      date: "2026-08-03",
      anchorKind: "day",
    })
    expect(units[0].family).toContain(`${README_PATH}:L3`)
  })

  it("sem âncora: PROBLEMA com a linha (nunca uma tabela ignorada em silêncio)", () => {
    const { units, problems } = leitura(readmeDeclarations(tabela.join("\n")))
    expect(units).toEqual([])
    expect(problems).toHaveLength(1)
    expect(problems[0].reason).toContain(`${README_PATH}:1`)
    expect(problems[0].reason).toContain("sem âncora datada")
  })

  it("a âncora vale pelo BLOCO (até BLOCK_LOOKBACK linhas acima da tabela)", () => {
    const longe = ["Medido em 01/02/2026", ...Array(BLOCK_LOOKBACK + 1).fill("texto"), ...tabela]
    const { problems } = leitura(readmeDeclarations(longe.join("\n")))
    expect(problems).toHaveLength(1)
  })

  it("tabela que só CITA uma duração no meio da frase não é tabela de custo", () => {
    const prosa = [
      "| Arquivo | Teste | Descrição |",
      "| :------ | :---- | :-------- |",
      "| `x.test.ts` | `p95 > threshold` | Quando P95 é 500ms === 500ms o serviço não degrada |",
    ].join("\n")
    const { units, problems } = leitura(readmeDeclarations(prosa))
    expect(units).toEqual([])
    expect(problems).toEqual([])
  })
})

describe("declarationFamilies — a idade vem do commit DERIVADO da data", () => {
  const modelo = {
    jobs: { github: { job: { ms: 1, date: "2026-09-17", source: "s" } } },
  }

  it("a data vira commit (`rev-list -1 --before`) e o commit vira idade (a MESMA sonda)", () => {
    const families = familias(
      declarationFamilies({
        model: modelo,
        readme: "",
        deps: { run: gitDatas({ commits: ["achado"], count: 9 }) as never },
      }),
    )
    expect(families).toHaveLength(1)
    expect(families[0]).toMatchObject({
      family: "github/job",
      commit: "achado",
      behind: 9,
      state: "fresh",
      kind: "declared-number",
    })
    expect(families[0].ceiling).toBe(ceilingOf("declared-number"))
  })

  it("git que não responde: `unknown` com a causa — nunca 'sem idade' virando fresca", () => {
    const families = familias(
      declarationFamilies({
        model: modelo,
        readme: "",
        deps: { run: gitDatas({ erro: new Error("spawnSync git ENOENT") }) as never },
      }),
    )
    expect(families[0].state).toBe("unknown")
    expect(families[0].reason).toContain("git não pôde ser executado")
  })

  it("nenhum commit antes da âncora: `unknown` nomeando a data", () => {
    const families = familias(
      declarationFamilies({
        model: modelo,
        readme: "",
        deps: { run: gitDatas({ commits: [] }) as never },
      }),
    )
    expect(families[0].state).toBe("unknown")
    expect(families[0].reason).toContain("nenhum commit")
  })

  it("o MODELO ilegível não some: vira uma unidade `unknown` nomeando o arquivo", () => {
    const families = familias(
      declarationFamilies({
        readme: "",
        deps: {
          exists: (p: string) => p.includes("merge-latency"),
          read: () => "{ truncado",
          run: gitDatas() as never,
        },
      }),
    )
    expect(families).toHaveLength(1)
    // `fonte-ilegivel` e não `declaracao-sem-origem`: o arquivo não foi lido, e o
    // veredito distingue "não consegui ler" de "li e o dono não datou o número".
    expect(families[0].kind).toBe("fonte-ilegivel")
    expect(families[0].state).toBe("unknown")
    expect(families[0].reason).toContain("JSON válido")
  })

  it("o README ilegível também não some: `fonte-ilegivel` nomeando o arquivo", () => {
    const families = familias(
      declarationFamilies({
        model: { jobs: {} },
        deps: {
          exists: (p: string) => p.endsWith("README.md"),
          read: () => {
            throw new Error("EACCES: permission denied")
          },
          run: gitDatas() as never,
        },
      }),
    )
    expect(families).toHaveLength(1)
    expect(families[0]).toMatchObject({ kind: "fonte-ilegivel", state: "unknown" })
    expect(families[0].reason).toContain("EACCES")
  })

  it("a DECLARAÇÃO sem origem é outro `kind` (`declaracao-sem-origem`) — o dono não datou", () => {
    const families = familias(
      declarationFamilies({
        model: { jobs: { github: { job: { ms: 1, source: "s" } } } },
        readme: "",
        deps: { run: gitDatas() as never },
      }),
    )
    expect(families).toHaveLength(1)
    expect(families[0]).toMatchObject({ kind: "declaracao-sem-origem", state: "unknown" })
    expect(families[0].reason).toContain("SEM data própria")
  })

  it("`commitOfDate` dá o ÚLTIMO commit do mês numa âncora `mm/aaaa`", () => {
    const vistos: string[] = []
    const run = (_cmd: string, args: string[]) => {
      vistos.push(args[2])
      return { status: 0, stdout: "c9\n" }
    }
    commitOfDate({ anchor: { date: "2026-08-01", kind: "month" } }, { run: run as never })
    expect(vistos[0]).toBe("--before=2026-09-01 00:00:00")
  })
})

describe("readFreshness — o fato completo e o teto POR TIPO", () => {
  const modelo = {
    jobs: { github: { job: { ms: 1, date: "2026-09-17", source: "s" } } },
  }

  it("a tabela do README NÃO tem teto: a idade dela é PUBLICADA, sem vencimento", () => {
    const longe = ["Medido em 01/02/2026", "", "| c | t |", "| :- | -: |", "| x | ~2s |"].join("\n")
    const fact = fato(
      readFreshness({
        model: { jobs: {} },
        readme: longe,
        file: BASELINE_PATH,
        deps: {
          probe: () => ({ state: "ancestor", behind: 3, reason: "" }),
          run: gitDatas({ count: 9999 }) as never,
        },
      }),
    )
    const tabela = fact.families.find((f) => f.kind === "declared-table")!
    expect(tabela.behind).toBe(9999)
    expect(tabela.ceiling).toBeNull()
    expect(tabela.state).toBe("fresh")
    expect(fact.aged).toEqual([])
    expect(fact.detail).toContain("sem teto (a idade é publicada)")
  })

  it("a família do bench com a MESMA idade é VENCIDA (o teto do tipo dela vale)", () => {
    const fact = fato(
      readFreshness({
        model: { jobs: {} },
        readme: "",
        file: BASELINE_PATH,
        deps: {
          probe: () => ({
            state: "ancestor",
            behind: FRESHNESS_MAX_COMMITS_BEHIND + 1,
            reason: "",
          }),
          run: gitDatas() as never,
        },
      }),
    )
    expect(fact.aged.length).toBe(fact.families.length)
    expect(fact.families.every((f) => f.kind === "bench-family")).toBe(true)
    // A tabela do tipo declara a POLÍTICA ("segue o teto derivado"), não o número:
    // um literal aqui seria o teto declarado à mão que este passo removeu.
    expect(FRESHNESS_CEILINGS["bench-family"]).toBe("idade")
    expect(FRESHNESS_CEILINGS["declared-table"]).toBeNull()
  })

  it("o número declarado do MODELO também vence com a MESMA idade (o teto dele vale)", () => {
    const fact = fato(
      readFreshness({
        model: modelo,
        readme: "",
        file: BASELINE_PATH,
        deps: {
          probe: () => ({ state: "ancestor", behind: 3, reason: "" }),
          run: gitDatas({ count: FRESHNESS_MAX_COMMITS_BEHIND + 1 }) as never,
        },
      }),
    )
    expect(fact.aged).toEqual(["github/job"])
    expect(fact.families.filter((f) => f.kind === "declared-number")).toHaveLength(1)
  })

  it("a FRONTEIRA do teto vale também para as DECLARAÇÕES: no teto é fresca, teto + 1 vence", () => {
    // O caminho das declarações tem a SUA comparação (`isAged`, com o teto do
    // TIPO): a fronteira testada nas famílias do bench não a cobre — e é ela que
    // decide se a prosa do README e os números do modelo vencem.
    const declara = (behind: number) =>
      fato(
        readFreshness({
          model: { jobs: { github: { job: { ms: 1, date: "2026-09-17", source: "s" } } } },
          readme: "",
          file: BASELINE_PATH,
          deps: {
            probe: () => ({ state: "ancestor", behind: 3, reason: "" }),
            run: gitDatas({ count: behind }) as never,
          },
        }),
      )

    const noTeto = declara(FRESHNESS_MAX_COMMITS_BEHIND)
    expect(noTeto.aged).toEqual([])
    expect(noTeto.families.find((f) => f.kind === "declared-number")!.state).toBe("fresh")

    const acima = declara(FRESHNESS_MAX_COMMITS_BEHIND + 1)
    expect(acima.aged).toEqual(["github/job"])
  })

  it("a FONTE do bench ilegível não vira 'nada a julgar': vira `fonte-ilegivel` e o fato fica SEM idade", () => {
    // A TERCEIRA fonte do fato: o arquivo do bench. Ausente, ilegível ou com JSON
    // quebrado, `readBenchFreshness` devolve `unavailable` com ZERO famílias — e é
    // este ponto que decide se esse vazio entra no fato como "não consegui ler"
    // (`fonte-ilegivel`, unknown) ou como "nada a julgar". A segunda leitura é a
    // forma cara do verde falso: o fato sai MEDIDO, sem nenhum unknown, e o doctor
    // diria PRONTA sobre um arquivo que ninguém leu.
    const contaFonte = (deps: Record<string, unknown>) =>
      fato(
        readFreshness({
          model: { jobs: { github: { job: { ms: 1, date: "2026-09-17", source: "s" } } } },
          readme: "",
          file: "docs/benchmarks/nao-existe.json",
          deps: {
            probe: () => ({ state: "ancestor", behind: 3, reason: "" }),
            run: gitDatas() as never,
            ...deps,
          },
        }),
      )

    const casos: Array<[string, Record<string, unknown>]> = [
      ["ausente", { exists: () => false }],
      ["com JSON inválido", { exists: () => true, read: () => "{ isso não é json" }],
    ]

    for (const [caso, deps] of casos) {
      const fact = contaFonte(deps)
      const fonte = fact.families.filter((f) => f.kind === "fonte-ilegivel")
      expect(fonte, `o bench ${caso} sumiu do fato`).toHaveLength(1)
      expect(fonte[0].family).toContain("nao-existe.json")
      expect(fonte[0].state).toBe("unknown")
      expect(fact.unknown).toEqual([fonte[0].family])
      // A outra fonte CONTINUA medida: a falha de uma não apaga as outras.
      expect(fact.families.some((f) => f.kind === "declared-number")).toBe(true)
      // E as famílias do bench NÃO entram: elas não foram lidas.
      expect(fact.families.some((f) => f.kind === "bench-family")).toBe(false)
      expect(fact.state).toBe("measured")
    }
  })

  it("o repositório REAL: as declarações do modelo e do README entram no fato, e nenhuma vence", () => {
    const fact = fato(readFreshness({}))
    expect(fact.state).toBe("measured")
    const tipos = new Set(fact.families.map((f) => f.kind))
    expect(tipos.has("bench-family")).toBe(true)
    expect(tipos.has("declared-number")).toBe(true)
    expect(tipos.has("declared-table")).toBe(true)
    expect(fact.aged).toEqual([])
    expect(fact.diverged).toEqual([])
    expect(fact.unknown).toEqual([])
    // As tabelas do README são julgadas (uma unidade por tabela de custo).
    expect(fact.families.filter((f) => f.kind === "declared-table").length).toBeGreaterThan(2)
  })

  it("a POLÍTICA do teto é a que a doc declara — e a doc diz que o NÚMERO é derivado", () => {
    // A régua imprime o teto (derivado) por tipo no fato, e a doc declara a
    // POLÍTICA: sem esta ligação, mudar a janela, os ciclos ou o piso deixaria a
    // doc mentindo — a mesma classe de defeito que esta régua existe para nomear.
    for (const caminho of [README_PATH, "docs/GUARDS.md"]) {
      const texto = readFileSync(join(ROOT, caminho), "utf8").replace(/\s+/g, " ")
      // Cada número da política, um a um: a doc do repositório não pode cravar o
      // teto como se fosse constante (ele sai do ritmo medido de agora).
      expect(texto, `${caminho} não declara os ciclos`).toContain(
        `${POLITICA_DO_TETO.ciclos} ciclos`,
      )
      expect(texto, `${caminho} não declara a janela`).toContain(
        `${POLITICA_DO_TETO.janelaDias} dias`,
      )
      expect(texto, `${caminho} não declara o piso`).toContain(
        `${POLITICA_DO_TETO.pisoDeCiclo}/ciclo`,
      )
      expect(texto, `${caminho} não nomeia a RESERVA do fail-closed`).toContain(
        `${FRESHNESS_MAX_COMMITS_BEHIND} commits`,
      )
      expect(texto, `${caminho} não diz que o teto é derivado`).toContain("DERIVADO do ritmo")
      expect(texto, `${caminho} não diz que a idade da prosa é publicada`).toContain(
        "sem teto (a idade é publicada)",
      )
    }
  })

  it("o arquivo do MODELO real é o que a régua lê (a fonte não é uma segunda leitura)", () => {
    const modeloReal = JSON.parse(readFileSync(join(ROOT, MODEL_PATH), "utf8"))
    const { units, problems } = leitura(modelDeclarations(modeloReal))
    expect(problems).toEqual([])
    expect(units.length).toBeGreaterThan(20)
    expect(units.every((u) => /^\d{4}-\d{2}-\d{2}$/.test(String(u.date)))).toBe(true)
  })
})

// ── 4. O publicador: a assinatura, o fecho e o ciclo ───────────────────────

const VELHA = {
  state: "measured",
  file: "docs/benchmarks/guard-timing-baseline.json",
  head: "HEAD",
  maxBehind: FRESHNESS_MAX_COMMITS_BEHIND,
  // O teto vem DERIVADO (o fato real sempre traz a procedência): aqui o ritmo
  // medido dá exatamente o número da reserva, para o fixture medir o veredito e
  // não o acaso do ritmo.
  teto: {
    ciclos: POLITICA_DO_TETO.ciclos,
    cicloDias: POLITICA_DO_TETO.cicloDias,
    janelaDias: POLITICA_DO_TETO.janelaDias,
    pisoDeCiclo: POLITICA_DO_TETO.pisoDeCiclo,
    desde: "2026-08-24T00:00:00.000Z",
    commits: 314,
    commitsPorCiclo: 314 / (POLITICA_DO_TETO.janelaDias / POLITICA_DO_TETO.cicloDias),
    teto: FRESHNESS_MAX_COMMITS_BEHIND,
    origem: "medido",
    motivo: null,
  },
  families: [
    {
      family: "mutations",
      act: "measured",
      origin: "family",
      source: null,
      commit: "velho111",
      commitDate: "2026-09-01 10:00:00 -0300",
      state: "aged",
      behind: 200,
      reason: "200 commit(s) de velho111 até HEAD",
    },
    {
      family: "lint",
      act: "measured",
      origin: "family",
      source: null,
      commit: "novo222",
      commitDate: "2026-09-20 10:00:00 -0300",
      state: "fresh",
      behind: 4,
      reason: "4 commit(s) de novo222 até HEAD",
    },
  ],
  aged: ["mutations"],
  diverged: [],
  unknown: [],
  behindMax: 200,
  detail:
    "2 família(s) medida(s) e 1 VENCIDA(s): mutations a 200 commit(s) atrás (teto 150 commits)",
  reason: null,
  remedies: [REMEDY_COMMAND],
}

const FRESCA = {
  ...VELHA,
  families: VELHA.families.map((f) => ({ ...f, state: "fresh", behind: 4 })),
  aged: [],
  behindMax: 4,
  detail:
    "2 família(s) medida(s), a mais antiga 4 commit(s) atrás de HEAD (teto 150) — nenhuma vencida",
}

describe("o publicador da régua velha", () => {
  it("não há dívida quando nenhuma família passou o teto", () => {
    expect(isActionable(inputOf(FRESCA))).toBe(false)
    expect(agedOf(inputOf(FRESCA))).toEqual([])
    expect(signatureOf(inputOf(FRESCA))).toBe("bench-freshness:families=none:band=0")
  })

  it("uma família vencida é acionável, e o corpo nomeia a idade, o teto e o remédio", () => {
    expect(isActionable(inputOf(VELHA))).toBe(true)
    const corpo = freshnessBody(inputOf(VELHA))
    expect(corpo).toContain("`mutations`")
    expect(corpo).toContain("**200 commit(s)**")
    expect(corpo).toContain(String(FRESHNESS_MAX_COMMITS_BEHIND))
    expect(corpo).toContain(REMEDY_COMMAND)
    expect(corpo).toContain("28%")
    // A PROCEDÊNCIA do teto vai no corpo: quem lê a issue sabe de onde veio o
    // número (e se ele é o ritmo medido ou a reserva do fail-closed).
    expect(corpo).toContain("derivado do ritmo — 314 commits em 28 dias")
    expect(corpo).not.toContain("RESERVA declarada")
  })

  it("a assinatura NÃO carrega o `behind` (que anda a cada commit) — só o conjunto e a FAIXA", () => {
    const duasCentenas = inputOf({ ...VELHA })
    const duzentosEVinte = inputOf({
      ...VELHA,
      families: VELHA.families.map((f) => (f.family === "mutations" ? { ...f, behind: 220 } : f)),
      behindMax: 220,
    })
    // Mesma faixa (1 teto): nenhum comentário novo no cron — o ruído que o dedup
    // existe para impedir.
    expect(signatureOf(duasCentenas)).toBe(signatureOf(duzentosEVinte))
    expect(bandOf(duasCentenas)).toBe(1)
    // Uma ordem a mais é OUTRA dívida (a issue antiga não representa esta).
    const quatroCentenas = inputOf({
      ...VELHA,
      families: VELHA.families.map((f) => (f.family === "mutations" ? { ...f, behind: 400 } : f)),
    })
    expect(bandOf(quatroCentenas)).toBe(2)
    expect(signatureOf(quatroCentenas)).not.toBe(signatureOf(duasCentenas))
    // E uma família nova na lista é dívida nova.
    const comDuas = inputOf({
      ...VELHA,
      families: [
        ...VELHA.families.map((f) =>
          f.family === "lint" ? { ...f, state: "aged", behind: 300 } : f,
        ),
      ],
      aged: ["lint", "mutations"],
    })
    expect(signatureOf(comDuas)).not.toBe(signatureOf(duasCentenas))
  })

  it("o FECHAMENTO exige medição COMPLETA: sem idade em alguma família, não fecha", () => {
    const when = BENCH_FRESHNESS_PUBLISHER.resolution.when
    expect(when(inputOf(FRESCA))).toBe(true)
    expect(when(inputOf(VELHA))).toBe(false)
    expect(
      when(
        inputOf({
          ...FRESCA,
          families: [{ ...FRESCA.families[0], state: "unknown", behind: null }],
          unknown: ["mutations"],
        }),
      ),
    ).toBe(false)
    expect(
      when(
        inputOf({
          ...FRESCA,
          diverged: ["tests"],
          families: [{ ...FRESCA.families[0], state: "diverged", behind: null }],
        }),
      ),
    ).toBe(false)
    // E o fato que NÃO foi medido não fecha nem age.
    const cega = inputOf({ ...FRESCA, state: "unavailable", reason: "clone raso", families: [] })
    expect(isActionable(cega)).toBe(false)
    expect(when(cega)).toBe(false)
    expect(unknownOf(cega)).toEqual([])
    expect(divergedOf(inputOf(VELHA))).toEqual([])
  })
})

// ── 5. O ciclo contra um backend em memória ────────────────────────────────

type Issue = {
  number: number
  title: string
  body: string
  state: "open" | "closed"
  comments: { body: string }[]
}

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

describe("o ciclo: abre na régua velha, FECHA quando ela volta ao teto", () => {
  it("a régua vencida cria UMA issue, com o marcador do publicador", async () => {
    const backend = backendFake()
    const res = await runDebtPublisher({
      publisher: BENCH_FRESHNESS_PUBLISHER,
      input: inputOf(VELHA),
      backend,
      log: () => {},
    })
    expect(res.status).toBe("created")
    expect(String(res.ref)).toContain("#1")
    expect(backend.issues).toHaveLength(1)
    // O título é ESTÁVEL entre runs (sem número nem commit) e agora nomeia o que a
    // régua julga: as DECLARAÇÕES datadas, não só as famílias do bench.
    expect(backend.issues[0].title).toBe(freshnessTitle())
    expect(backend.issues[0].title).toContain("declarações datadas")
    expect(publisherSignatures(backend.issues[0], BENCH_FRESHNESS_PUBLISHER).length).toBe(1)
  })

  it("a run seguinte com a MESMA dívida não abre duplicata nem comenta", async () => {
    const backend = backendFake()
    for (const _ of [0, 1]) {
      await runDebtPublisher({
        publisher: BENCH_FRESHNESS_PUBLISHER,
        input: inputOf(VELHA),
        backend,
        log: () => {},
      })
    }
    expect(backend.issues).toHaveLength(1)
    expect(backend.issues[0].comments).toEqual([])
  })

  it("a régua re-medida: COMENTA a prova e FECHA", async () => {
    const backend = backendFake()
    await runDebtPublisher({
      publisher: BENCH_FRESHNESS_PUBLISHER,
      input: inputOf(VELHA),
      backend,
      log: () => {},
    })
    const reconciliada = await runDebtPublisher({
      publisher: BENCH_FRESHNESS_PUBLISHER,
      input: inputOf(FRESCA),
      backend,
      log: () => {},
    })
    expect(reconciliada.closed).toEqual([1])
    expect(backend.issues[0].state).toBe("closed")
    expect(backend.issues[0].comments).toHaveLength(1)
    expect(backend.issues[0].comments[0].body).toContain("Resolvido")
    expect(backend.issues[0].comments[0].body).toContain("`mutations`")
  })

  it("NÃO MEDIDO não fecha (é o fechamento que a falta de medição não prova)", async () => {
    const backend = backendFake()
    await runDebtPublisher({
      publisher: BENCH_FRESHNESS_PUBLISHER,
      input: inputOf(VELHA),
      backend,
      log: () => {},
    })
    const cego = await runDebtPublisher({
      publisher: BENCH_FRESHNESS_PUBLISHER,
      input: inputOf({
        ...FRESCA,
        state: "unavailable",
        reason: "o arquivo do bench não existe",
        families: [],
      }),
      backend,
      log: () => {},
    })
    expect(cego.status).toBe("unmeasured")
    expect(cego.closed).toBeUndefined()
    expect(backend.issues[0].state).toBe("open")
  })
})

// ── 6. O canal: o cron real e o manifesto ──────────────────────────────────

describe("o job semanal e o manifesto", () => {
  it("o workflow REAL invoca o publicador no job nomeado", () => {
    expect(() => readFileSync(join(ROOT, SCRIPT_REF), "utf8")).not.toThrow()
    const wf = loadWorkflow(WF)
    expect(getJob(wf, JOB)).toBeTruthy()
    const content = readWorkflowContent(WF)
    const bloco = jobBlock(content, JOB)
    expect(bloco).toContain(SCRIPT_REF)
    expect(bloco).toContain("GH_TOKEN")
  })

  it("o checkout do job traz a HISTÓRIA: sem `fetch-depth: 0` a idade sai 'sem idade'", () => {
    const bloco = jobBlock(readWorkflowContent(WF), JOB) ?? ""
    expect(bloco).toContain("fetch-depth: 0")
  })

  it("o manifesto classifica o job com o canal `issue` e nomeia a régua velha", () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, MANIFEST_PATH), "utf8"))
    const entrada = manifest.forges.github.find(
      (e: { workflow: string; job: string }) => e.workflow === WF && e.job === JOB,
    )
    expect(entrada).toBeTruthy()
    expect(entrada.channel).toBe("issue")
    expect(entrada.evidence).toBe("scripts/guard-timing-issue.mjs")
    expect(entrada.signal).toContain("RÉGUA do bench")
  })

  it("a dívida está no registro do doctor (a label nova não nasce invisível)", () => {
    const entrada = DEBT_SUBJECTS.find((s: { label: string }) => s.label === ISSUE_LABEL)
    expect(entrada).toBeTruthy()
    expect(entrada?.markerId).toBe(MARKER_ID)
    // O doctor mede o MESMO assunto: é o cruzamento mais forte (a issue diz que
    // alguém foi avisado, o fato diz se a régua ainda está velha).
    expect(entrada?.crossCheck).toBe("benchFreshness")
    expect(entrada?.forges).toEqual(["github"])
  })
})
