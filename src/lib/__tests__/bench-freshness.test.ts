/**
 * bench-freshness.test.ts
 *
 * Testes da RÉGUA da idade do bench (`scripts/bench-freshness.mjs`).
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
 *      ali não se reproduz nesta árvore.
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
import { FAMILY_MEASURED } from "../../../scripts/bench-guard-timing.mjs"

const ROOT = process.cwd()

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
