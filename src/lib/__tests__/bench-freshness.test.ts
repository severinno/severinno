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
 *      o `ci/periodic-alerts.json` classifica o canal como `issue`.
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it, vi } from "vitest"

import {
  BASELINE_PATH,
  FRESHNESS_MAX_COMMITS_BEHIND,
  REMEDY_COMMAND,
  commitAge,
  familyFreshness,
  freshnessLine,
  readBenchFreshness,
} from "../../../scripts/bench-freshness.mjs"
import {
  BENCH_FRESHNESS_PUBLISHER,
  ISSUE_LABEL,
  MARKER_ID,
  agedOf,
  bandOf,
  divergedOf,
  freshnessBody,
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
 * Um git dublê: responde por SUBCOMANDO (`cat-file`, `merge-base`, `rev-list`).
 * É por ele que os três estados da idade são medidos sem repositório de verdade.
 */
function gitStub({
  existe = true,
  ancestral = true,
  count = 3,
  erro = null,
}: {
  existe?: boolean
  ancestral?: boolean
  count?: number
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

  it("o commit é sondado UMA vez por valor (as seis famílias do mesmo ato custam uma pergunta)", () => {
    const probe = vi.fn(() => ({ state: "ancestor", behind: 4 }))
    const fact = familyFreshness(bench(), { probe })
    expect(fact.families.length).toBe(6)
    expect(probe).toHaveBeenCalledTimes(1)
    expect(fact.behindMax).toBe(4)
    expect(fact.aged).toEqual([])
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
    const fact = familyFreshness(bench({ commits: { lint: "ausente" } }), {
      probe: probeDe({
        [REAL.meta.commit]: { state: "ancestor", behind: 2 },
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

// ── 4. O publicador: a assinatura, o fecho e o ciclo ───────────────────────

const VELHA = {
  state: "measured",
  file: "docs/benchmarks/guard-timing-baseline.json",
  head: "HEAD",
  maxBehind: FRESHNESS_MAX_COMMITS_BEHIND,
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
    expect(backend.issues[0].title).toContain("régua do bench")
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
