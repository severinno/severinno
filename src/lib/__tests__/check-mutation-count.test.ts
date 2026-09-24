import { describe, expect, it } from "vitest"
import { execFileSync } from "node:child_process"
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  BENCH_ACT,
  BENCH_FAMILY,
  BENCH_PATH,
  caminhosDoVeredito,
  comparaComOAto,
  run,
  runStaged,
} from "../../../scripts/check-mutation-count.mjs"
import {
  BLOCO_GUARDS,
  BLOCO_README,
  conteudoDoBloco,
  estadoDaMatriz,
  paragrafoCusto,
  tabelaSubTests,
} from "../../../scripts/bench-table.mjs"

const GUARD = join(process.cwd(), "scripts/check-mutation-count.mjs")

/**
 * Fixture mínimo: um repo com os arquivos que o guard lê — o master, o
 * pr-check.yml, o README, a doc (`docs/GUARDS.md`, opcional) e UM script
 * granular por entrada do SUBTESTS (cada um com o seu bloco `METADES`).
 *
 * defaultCount define o nº de entradas no SUBTESTS do master.
 */
interface FixtureOpts {
  count?: number
  /**
   * Sufixo do `name:` do job. O DEFAULT é vazio — o contexto do required check
   * é COUNT-FREE de propósito: um número aqui re-acopla o tamanho da matriz ao
   * contrato de merge (o branch protection exige o nome do job como contexto).
   */
  workflowNameSuffix?: string
  workflowSummary?: number | null
  workflowComment?: number | null
  masterHeader?: number | null
  readmeLive?: number | null
  readmeHistorical?: number | null
  /** omite TODAS as linhas de count do README (testa o caminho 'perdeu o count') */
  readmeOmitCount?: boolean
  /** nº de metades declaradas por suíte (o bloco METADES de cada script) */
  metadesPorSuite?: number
  /** índice da suíte que NÃO declara o bloco (fail-closed) */
  suiteSemBloco?: number | null
  /** índice da suíte com uma linha FORA do formato dentro do bloco */
  suiteIlegivel?: number | null
  /**
   * índice da suíte que declara a metade em ASPAS DUPLAS — a forma que o shell
   * expandiria (e que mata a suíte sob `set -u`, medido).
   */
  suiteAspasDuplas?: number | null
  /** o conteúdo de docs/GUARDS.md (null = a doc não existe no fixture) */
  doc?: string | null
  /** volta a entrada do SUBTESTS para o formato antigo `id|descrição|script` */
  entradaComDescricao?: boolean
  /**
   * O REGISTRO versionado do ato (`docs/benchmarks/guard-timing-baseline.json`):
   *   - `null` (default) — o arquivo não existe no fixture (a ligação matriz ↔ ato
   *     NÃO é julgada, e o veredito tem de DIZER isso em vez de inventar);
   *   - `"completo"` — a família `mutations` versiona todos os ids da matriz;
   *   - `"ilegivel"` — o arquivo está lá e não é JSON (INFRA, exit 2);
   *   - um objeto — o JSON que o teste quiser (as metades mutam a partir dele).
   */
  bench?: "completo" | "ilegivel" | Record<string, unknown> | null
  /**
   * Escreve `docs/GUARDS.md` com o BLOCO DERIVADO (os marcadores + a tabela
   * renderizada do registro). Default `false`: a doc do fixture é a que o teste
   * mandar (ou nenhuma), e a regra nova não julga a que não existe.
   */
  docDerivado?: boolean
}

/** O registro versionado COMPLETO para uma matriz de `count` sub-tests. */
function benchCompleto(count: number): Record<string, unknown> {
  return {
    meta: { tool: "bench-guard-timing", version: 6, commit: "deadbee" },
    [BENCH_FAMILY]: {
      measured: true,
      subtests: count,
      metades: count * 2,
      forms: Array.from({ length: count }, (_, i) => ({
        role: `sub-${i}`,
        ms: 100 + i,
        metades: 2,
        exit: 0,
      })),
    },
  }
}

function makeFixture({
  count = 13,
  workflowNameSuffix = "",
  workflowSummary = null,
  workflowComment = null,
  masterHeader = null,
  readmeLive = null,
  readmeHistorical = null,
  readmeOmitCount = false,
  metadesPorSuite = 2,
  suiteSemBloco = null,
  suiteIlegivel = null,
  suiteAspasDuplas = null,
  doc = null,
  entradaComDescricao = false,
  bench = null,
  docDerivado = false,
}: FixtureOpts = {}) {
  const dir = mkdtempSync(join(tmpdir(), "mutation-count-"))
  mkdirSync(join(dir, "scripts"), { recursive: true })
  mkdirSync(join(dir, ".github/workflows"), { recursive: true })

  const entries = []
  for (let i = 0; i < count; i++) {
    const rel = `scripts/test-mutation-sub-${i}.sh`
    entries.push(entradaComDescricao ? `  "sub-${i}|Desc ${i}|${rel}"` : `  "sub-${i}|${rel}"`)
    // O script granular DECLARA as metades: é daqui que a descrição do
    // sub-test e a prosa da doc são derivadas.
    const linhas = []
    for (let m = 1; m <= metadesPorSuite; m++) {
      // ASPAS SIMPLES: em aspas duplas o shell expandiria a descrição antes de
      // guardá-la (a suíte `aspas_duplas` escreve essa forma de propósito).
      linhas.push(
        i === suiteAspasDuplas && m === 1
          ? `  "M${m}|o caso com echo $OUT | grep -Fq que o shell expandiria"`
          : `  'M${m}|a metade ${m} desta suíte de teste'`,
      )
    }
    if (i === suiteIlegivel) linhas.push("  linha sem o formato do bloco")
    const corpo = i === suiteSemBloco ? "" : `\nMETADES=(\n${linhas.join("\n")}\n)\n`
    writeFileSync(join(dir, rel), `#!/usr/bin/env bash\nset -euo pipefail\n${corpo}`)
  }
  const master = `#!/usr/bin/env bash
# Roda os ${masterHeader ?? count} mutation tests node-puro dos guards de CI num ÚNICO script
SUBTESTS=(
${entries.join("\n")}
)
`
  writeFileSync(join(dir, "scripts/test-mutation-guards.sh"), master)

  const prCheck = `jobs:
  mutation-guards:
    name: Mutation guards master${workflowNameSuffix}
    steps:
      - run: bash scripts/test-mutation-guards.sh
      - name: Summary
        run: echo "✅ All ${workflowSummary ?? count} node-pure mutation tests passed (...)."
`
  // comentário do job — o guard busca "Roda os N mutation tests node-puro"
  const prCheckWithComment = prCheck.replace(
    "jobs:",
    `# Roda os ${workflowComment ?? count} mutation tests node-puro dos guards de CI num JOB SÓ via`,
  )
  writeFileSync(join(dir, ".github/workflows/pr-check.yml"), prCheckWithComment)

  const live = readmeLive ?? count
  const hist = readmeHistorical ?? null
  const readme = readmeOmitCount
    ? `# Repo\nSem nenhuma ref de count aqui.\n`
    : `# Repo\n**${live} sub-tests node-puro** via \`scripts/test-mutation-guards.sh\`\n| master \`mutation-guards\` (${live} sub-tests) | x |\n${hist ? `era de ${hist} sub-tests e o timing-budget foi adicionado após a medição de ${hist}.` : ""}\n`
  writeFileSync(join(dir, "README.md"), readme)

  if (bench !== null) {
    mkdirSync(join(dir, "docs/benchmarks"), { recursive: true })
    const texto =
      bench === "ilegivel"
        ? "{ isto nao e JSON"
        : JSON.stringify(bench === "completo" ? benchCompleto(count) : bench)
    writeFileSync(join(dir, BENCH_PATH), texto)
    // O fixture com REGISTRO carrega a prosa DERIVADA dele (o bloco do README e,
    // quando pedido, o da doc): é o estado SÃO, e o teste que muta o bloco parte
    // dele — como no repositório.
    const estado = bench === "ilegivel" ? null : estadoDaMatriz(JSON.parse(texto))
    if (estado) {
      appendFileSync(
        join(dir, "README.md"),
        `\n${BLOCO_README.abre}\n${conteudoDoBloco(paragrafoCusto(estado))}\n${BLOCO_README.fecha}\n`,
      )
      if (docDerivado) {
        mkdirSync(join(dir, "docs"), { recursive: true })
        writeFileSync(
          join(dir, "docs/GUARDS.md"),
          `${BLOCO_GUARDS.abre}\n${conteudoDoBloco(tabelaSubTests(estado))}\n${BLOCO_GUARDS.fecha}\n`,
        )
      }
    }
  }
  if (doc !== null) {
    mkdirSync(join(dir, "docs"), { recursive: true })
    writeFileSync(join(dir, "docs/GUARDS.md"), doc)
  }
  return dir
}

describe("comparaComOAto (a régua PURA: a matriz × o ato)", () => {
  const ids = ["a", "b", "c"]
  const familia = (over: Record<string, unknown> = {}) => ({
    [BENCH_FAMILY]: {
      measured: true,
      subtests: 3,
      forms: ids.map((role) => ({ role })),
      ...over,
    },
  })

  it("o registro AUSENTE não é violação — e o resultado DIZ que a ligação não foi julgada", () => {
    const r = comparaComOAto(null, ids)
    expect(r.present).toBe(false)
    expect(r.ok).toBe(true)
    expect(r.violations).toEqual([])
    expect(r.motivo).toContain(BENCH_PATH)
  })

  it("a matriz inteira versionada é ok, e `sobrando` lista o que saiu (sem virar violação)", () => {
    const r = comparaComOAto(
      {
        ...familia(),
        [BENCH_FAMILY]: {
          measured: true,
          subtests: 3,
          forms: [{ role: "a" }, { role: "b" }, { role: "c" }, { role: "saiu" }],
        },
      },
      ids,
    )
    expect(r.faltando).toEqual([])
    expect(r.sobrando).toEqual(["saiu"])
    expect(r.ok).toBe(false) // o count GRAVADO (3) já não bate com as 4 formas
  })

  it("um sub-test da matriz que o ato não versionou é VIOLAÇÃO nomeando o id e o remédio", () => {
    const r = comparaComOAto(
      { [BENCH_FAMILY]: { measured: true, subtests: 1, forms: [{ role: "a" }] } },
      ids,
    )
    expect(r.faltando).toEqual(["b", "c"])
    expect(r.violations.some((v) => v.includes("b") && v.includes("c"))).toBe(true)
    expect(r.violations.some((v) => v.includes(BENCH_ACT))).toBe(true)
  })

  it("`measured: false` acusa: não medido não é versionado", () => {
    const r = comparaComOAto(
      {
        [BENCH_FAMILY]: {
          measured: false,
          subtests: 3,
          forms: [{ role: "a" }, { role: "b" }, { role: "c" }],
        },
      },
      ids,
    )
    expect(r.ok).toBe(false)
    expect(r.violations.some((v) => v.includes("NÃO foi medida"))).toBe(true)
  })

  it("o count GRAVADO divergente acusa, mesmo com as formas certas", () => {
    const r = comparaComOAto(
      {
        [BENCH_FAMILY]: {
          measured: true,
          subtests: 2,
          forms: [{ role: "a" }, { role: "b" }, { role: "c" }],
        },
      },
      ids,
    )
    expect(r.ok).toBe(false)
    expect(r.violations.some((v) => v.includes("GRAVOU 2"))).toBe(true)
  })

  it("o registro sem a família do ato acusa (nenhum ato versionou a matriz)", () => {
    const r = comparaComOAto({ meta: {} }, ids)
    expect(r.ok).toBe(false)
    expect(r.faltando).toEqual(ids)
    expect(r.violations.some((v) => v.includes(BENCH_FAMILY))).toBe(true)
  })

  // ── A COLUNA DE METADES: derivada da MATRIZ, não herdada do ATO ───────────
  //
  // O caso medido (23/09/2026): a `bench-freshness` declarava 8 metades quando o
  // ato mediu o custo dela e a suíte passou a declarar 10. A forma existe, o
  // custo está medido, o count bate — e MESMO ASSIM o registro descreve a
  // unidade anterior. É esta a defasagem que a coluna herdada escondia.
  const coluna = (formas: { role: string; metades?: number }[], total: number) => ({
    [BENCH_FAMILY]: { measured: true, subtests: 3, metades: total, forms: formas },
  })
  const derivadas = [
    { id: "a", count: 2 },
    { id: "b", count: 2 },
    { id: "c", count: 3 },
  ]

  it("a unidade que entrou DEPOIS da medição é VIOLAÇÃO nomeando o id e o delta", () => {
    const r = comparaComOAto(
      coluna(
        [
          { role: "a", metades: 2 },
          { role: "b", metades: 2 },
          { role: "c", metades: 2 },
        ],
        6,
      ),
      ids,
      { metades: derivadas },
    )

    expect(r.ok).toBe(false)
    expect(r.metadesDivergentes).toEqual([{ id: "c", gravado: 2, derivado: 3 }])
    expect(
      r.violations.some(
        (v) => v.includes("'c'") && v.includes("GRAVOU 2") && v.includes("declara 3"),
      ),
    ).toBe(true)
    // O remédio é o ATO (ele reescreve a coluna a partir da matriz).
    expect(r.violations.some((v) => v.includes(BENCH_ACT))).toBe(true)
  })

  it("o CONTROLE: a coluna que a MATRIZ declara passa (a régua não acusa o são)", () => {
    const r = comparaComOAto(
      coluna(
        [
          { role: "a", metades: 2 },
          { role: "b", metades: 2 },
          { role: "c", metades: 3 },
        ],
        7,
      ),
      ids,
      { metades: derivadas },
    )

    expect(r.ok).toBe(true)
    expect(r.metadesJulgadas).toBe(true)
    expect(r.metadesDivergentes).toEqual([])
  })

  it("a forma SEM número de metades acusa: o custo entra sem o registro dizer o que protege", () => {
    const r = comparaComOAto(
      coluna([{ role: "a", metades: 2 }, { role: "b", metades: 2 }, { role: "c" }], 4),
      ids,
      {
        metades: derivadas,
      },
    )

    expect(r.ok).toBe(false)
    expect(r.metadesDivergentes).toEqual([{ id: "c", gravado: null, derivado: 3 }])
    expect(r.violations.some((v) => v.includes("NÃO declara metades"))).toBe(true)
  })

  it("o TOTAL da família que não fecha com a coluna acusa (as duas leituras da mesma medição)", () => {
    const r = comparaComOAto(
      coluna(
        [
          { role: "a", metades: 2 },
          { role: "b", metades: 2 },
          { role: "c", metades: 3 },
        ],
        5,
      ),
      ids,
      { metades: derivadas },
    )

    expect(r.ok).toBe(false)
    expect(
      r.violations.some((v) => v.includes("GRAVOU 5 metade(s)") && v.includes("somam 7")),
    ).toBe(true)
  })

  it("SEM a derivação da matriz a coluna NÃO é julgada — e o resultado DIZ que não foi", () => {
    const r = comparaComOAto(
      coluna(
        [
          { role: "a", metades: 2 },
          { role: "b", metades: 2 },
          { role: "c", metades: 2 },
        ],
        6,
      ),
      ids,
    )

    // A mesma coluna que a régua ACUSA com a derivação passa sem ela: é a
    // derivação que sustenta o vermelho (e a ausência dela fica declarada —
    // "não julguei" nunca pode ter a cara de "está certo").
    expect(r.ok).toBe(true)
    expect(r.metadesJulgadas).toBe(false)
    expect(r.metadesDivergentes).toEqual([])
  })
})

describe("check-mutation-count — a matriz × o ATO que a versiona (na árvore)", () => {
  it("o ato versionando a matriz inteira: passa, e o resultado PUBLICA o que ele versionou", () => {
    const dir = makeFixture({ count: 13, bench: "completo" })
    const r = run(dir)
    expect(r.ok).toBe(true)
    expect(r.bench.present).toBe(true)
    expect(r.bench.versionados).toHaveLength(13)
    expect(r.bench.faltando).toEqual([])
  })

  it("a DEFASAGEM (a matriz ganhou um sub-test e o ato ficou para trás) FALHA nomeando-o", () => {
    const dir = makeFixture({ count: 13, bench: benchCompleto(12) })
    const r = run(dir)
    expect(r.ok).toBe(false)
    expect(r.bench.faltando).toEqual(["sub-12"])
    expect(
      r.violations.some(
        (v) => v.startsWith(BENCH_PATH) && v.includes("sub-12") && v.includes("não versionou"),
      ),
    ).toBe(true)
  })

  it("a COLUNA herdada do ato (a unidade entrou depois) FALHA nomeando a forma", () => {
    // A matriz versiona os 13 sub-tests e o CUSTO está medido — o único defeito é
    // a coluna da `sub-3`, que o ato gravou com 1 metade e a suíte declara 2.
    const registro = benchCompleto(13) as { [BENCH_FAMILY]: Record<string, unknown> }
    const familia = registro[BENCH_FAMILY]
    const forms = (familia.forms as { role: string; metades: number }[]).map((f) =>
      f.role === "sub-3" ? { ...f, metades: 1 } : f,
    )
    const dir = makeFixture({
      count: 13,
      bench: { ...registro, [BENCH_FAMILY]: { ...familia, metades: 25, forms } },
    })
    const r = run(dir)

    expect(r.ok).toBe(false)
    expect(r.bench.faltando).toEqual([])
    expect(r.bench.metadesDivergentes).toEqual([{ id: "sub-3", gravado: 1, derivado: 2 }])
    // O vermelho é SÓ da coluna: nenhuma forma falta e o count gravado bate —
    // senão este teste mediria outra coisa que não o assunto dele.
    expect(r.bench.versionados).toHaveLength(13)
    expect(r.violations.every((v) => !v.includes("não versionou"))).toBe(true)
    expect(r.violations.some((v) => v.includes("sub-3") && v.includes("declara 2"))).toBe(true)
  })

  it("o registro do bench AUSENTE não é violação — e a ligação não julgada fica DITA", () => {
    const dir = makeFixture({ count: 13 })
    const r = run(dir)
    expect(r.ok).toBe(true)
    expect(r.bench.present).toBe(false)
    expect(r.bench.motivo).toContain(BENCH_PATH)
  })

  it("o registro ILEGÍVEL é INFRA (exit 2), nunca 'nenhuma ligação a julgar'", () => {
    const dir = makeFixture({ count: 13, bench: "ilegivel" })
    expect(() => run(dir)).toThrow(new RegExp(`${BENCH_PATH.replace(/[/.]/g, "\\$&")} ilegível`))
  })
})

describe("check-mutation-count", () => {
  it("passa com fixture consistente (todas as refs = derivado)", () => {
    const dir = makeFixture()
    const r = run(dir)
    expect(r.ok).toBe(true)
    expect(r.derivedCount).toBe(13)
    expect(r.derivedMetades).toBe(26)
    expect(r.violations).toEqual([])
  })

  it("deriva o count de uma matriz de 5 entradas", () => {
    const dir = makeFixture({ count: 5 })
    const r = run(dir)
    expect(r.ok).toBe(true)
    expect(r.derivedCount).toBe(5)
  })

  it("passa com o name do job COUNT-FREE (o contexto do required check é estável)", () => {
    const dir = makeFixture()
    const r = run(dir)
    expect(r.ok).toBe(true)
    expect(r.refs.prCheck.context).toBe("Mutation guards master")
  })

  it("falha quando o name do job volta a carregar o count (matriz 13)", () => {
    const dir = makeFixture({ workflowNameSuffix: " (13 node-pure mutation tests)" })
    const r = run(dir)
    expect(r.ok).toBe(false)
    expect(r.derivedCount).toBe(13)
    // A violação NOMEIA o acoplamento: o contexto protegido passaria a mudar a
    // cada bump de matriz.
    expect(
      r.violations.some((v) => v.includes("name do job") && v.includes("required check")),
    ).toBe(true)
  })

  it("falha mesmo com o count CERTO no name — nenhum número pode viver ali", () => {
    // O caso que o guard antigo APROVAVA: name coerente com a matriz. O contrato
    // de merge muda do mesmo jeito quando a matriz sobe, então o número é
    // proibido independentemente de estar correto hoje.
    const dir = makeFixture({ count: 14, workflowNameSuffix: " (14 node-pure mutation tests)" })
    const r = run(dir)
    expect(r.ok).toBe(false)
    expect(r.violations.some((v) => v.includes("name do job"))).toBe(true)
  })

  it("falha quando o name do job é outro texto (contexto renomeado ou job ausente)", () => {
    const dir = makeFixture({ workflowNameSuffix: " (renomeado)" })
    const r = run(dir)
    expect(r.ok).toBe(false)
    expect(r.violations.some((v) => v.includes("name do job"))).toBe(true)
  })

  it("falha quando o summary diverge", () => {
    const dir = makeFixture({ workflowSummary: 11 })
    const r = run(dir)
    expect(r.ok).toBe(false)
    expect(r.violations.some((v) => v.includes("summary"))).toBe(true)
  })

  it("falha quando o comentário do job diverge", () => {
    const dir = makeFixture({ workflowComment: 9 })
    const r = run(dir)
    expect(r.ok).toBe(false)
    expect(r.violations.some((v) => v.includes("comentário"))).toBe(true)
  })

  it("falha quando o header do master diverge", () => {
    const dir = makeFixture({ masterHeader: 7 })
    const r = run(dir)
    expect(r.ok).toBe(false)
    expect(r.violations.some((v) => v.includes("header"))).toBe(true)
  })

  it("falha com ref viva divergente no README (12 sub-tests ≠ 13)", () => {
    const dir = makeFixture({ readmeLive: 12 })
    const r = run(dir)
    expect(r.ok).toBe(false)
    expect(r.violations.some((v) => v.includes("README.md:") && v.includes("≠ 13"))).toBe(true)
  })

  it("ignora ref HISTÓRICA no README (era de 5 sub-tests)", () => {
    const dir = makeFixture({ readmeHistorical: 5 })
    const r = run(dir)
    expect(r.ok).toBe(true)
    expect(r.refs.readmeHistorical.length).toBe(1)
    expect(r.refs.readmeHistorical[0].number).toBe(5)
  })

  it("falha quando o README perdeu toda ref viva com o count atual (SEM refs)", () => {
    const dir = makeFixture({ readmeOmitCount: true })
    const r = run(dir)
    expect(r.ok).toBe(false)
    // ISOLADO: sem refs divergentes (nenhuma linha de count existe), a ÚNICA
    // violação é a do count sumido da doc.
    expect(r.violations).toHaveLength(1)
    expect(r.violations[0]).toContain("perdeu o count")
  })

  it("exit 2 (INFRA) quando o master está ausente", () => {
    const dir = makeFixture()
    rmSync(join(dir, "scripts/test-mutation-guards.sh"), { force: true })
    expect(() => run(dir)).toThrow(/arquivo ausente: scripts\/test-mutation-guards.sh/)
  })

  it("exit 2 (INFRA) quando o array SUBTESTS não existe", () => {
    const dir = makeFixture()
    const masterPath = join(dir, "scripts/test-mutation-guards.sh")
    const master = readFileSync(masterPath, "utf8").replace("SUBTESTS=(", "NOTHING=(")
    writeFileSync(masterPath, master)
    expect(() => run(dir)).toThrow(/SUBTESTS/)
  })
})

describe("check-mutation-count — as METADES de cada suíte (a descrição derivada)", () => {
  it("deriva as metades de cada suíte (2 por suíte × 13 sub-tests)", () => {
    const dir = makeFixture()
    const r = run(dir)
    expect(r.ok).toBe(true)
    expect(r.metades.every((m) => m.count === 2)).toBe(true)
    expect(r.metades[0].ids).toEqual(["M1", "M2"])
  })

  it("FALHA (fail-closed) quando uma suíte não declara o bloco METADES", () => {
    // A classe que este guard veio fechar: a descrição do sub-test (e a prosa da
    // doc) derivam do bloco — sem ele, "não li" viraria "não há metade".
    const dir = makeFixture({ suiteSemBloco: 3 })
    const r = run(dir)
    expect(r.ok).toBe(false)
    expect(
      r.violations.some((v) => v.includes("sub-3") && v.includes("não DECLARA as metades")),
    ).toBe(true)
  })

  it("FALHA quando o bloco tem uma linha fora do formato (não é 'nenhuma metade')", () => {
    const dir = makeFixture({ suiteIlegivel: 2 })
    const r = run(dir)
    expect(r.ok).toBe(false)
    expect(r.violations.some((v) => v.includes("fora do formato"))).toBe(true)
  })

  it("FALHA quando a metade é declarada em ASPAS DUPLAS (o shell expandiria)", () => {
    // A classe é MEDIDA: com o bloco em aspas duplas o shell expande a descrição
    // ANTES de guardá-la, e uma descrição que cita o código da mutação mata a
    // suíte com 'variável não associada' sob `set -u`. Recusar a FORMA, com a
    // razão, é o que impede o defeito de voltar como 'formato errado' genérico.
    const dir = makeFixture({ suiteAspasDuplas: 1 })
    const r = run(dir)
    expect(r.ok).toBe(false)
    expect(
      r.violations.some((v) => v.includes("ASPAS DUPLAS") && v.includes("aspas SIMPLES")),
    ).toBe(true)
    // A violação NOMEIA a suíte dona da linha — o remédio é naquele arquivo.
    expect(r.violations.some((v) => v.includes("test-mutation-sub-1.sh"))).toBe(true)
  })

  it("FALHA quando a entrada do SUBTESTS volta a ter descrição escrita à mão", () => {
    // A prosa do master não pode renascer: a descrição do sub-test é derivada do
    // bloco da suíte (é o que faz uma mutação nova não deixar o master para trás).
    const dir = makeFixture({ entradaComDescricao: true })
    const r = run(dir)
    expect(r.ok).toBe(false)
    expect(
      r.violations.some((v) => v.includes("descrição escrita à mão") && v.includes("id|script")),
    ).toBe(true)
  })

  it("passa quando a doc declara o total CERTO e cita ids declarados", () => {
    const dir = makeFixture({
      metadesPorSuite: 3,
      doc: `# Guards\n\n**Prova por mutação:** \`scripts/test-mutation-sub-0.sh\` declara 3 metades\n(M1, M2 e M3) e o controle M2 segue verde.\n`,
    })
    const r = run(dir)
    expect(r.ok).toBe(true)
  })

  it("FALHA quando a doc declara um total que não bate com o bloco", () => {
    const dir = makeFixture({
      metadesPorSuite: 3,
      doc: `# Guards\n\n**Prova por mutação:** \`scripts/test-mutation-sub-0.sh\` declara 4 metades no bloco.\n`,
    })
    const r = run(dir)
    expect(r.ok).toBe(false)
    expect(r.violations.some((v) => v.includes("≠ 3") && v.includes("declara 4 metades"))).toBe(
      true,
    )
  })

  it("FALHA quando a doc declara o total por extenso e ele não bate", () => {
    const dir = makeFixture({
      metadesPorSuite: 4,
      doc: `# Guards\n\n**Prova por mutação:** \`scripts/test-mutation-sub-0.sh\` muta o próprio guard em DUAS direções.\n`,
    })
    const r = run(dir)
    expect(r.ok).toBe(false)
    expect(r.violations.some((v) => v.includes("DUAS direções") && v.includes("≠ 4"))).toBe(true)
  })

  it("FALHA quando a doc cita um id da mesma família que o bloco não declara", () => {
    const dir = makeFixture({
      metadesPorSuite: 3,
      doc: `# Guards\n\nA suíte \`scripts/test-mutation-sub-0.sh\` cobre M1, M2, M3 e o M7.\n`,
    })
    const r = run(dir)
    expect(r.ok).toBe(false)
    expect(r.violations.some((v) => v.includes("M7") && v.includes("NÃO declara"))).toBe(true)
  })

  it("IGNORA o id de um CONTROLE citado na doc (limite declarado da régua)", () => {
    // A doc nomeia os dois lados — a metade e o controle que a cerca. Cobrar o
    // controle como se fosse metade seria falso positivo em texto correto.
    const dir = makeFixture({
      metadesPorSuite: 3,
      doc: `# Guards\n\nA suíte \`scripts/test-mutation-sub-0.sh\` cita M1/M2 no CONTROLE (H3 com o guard intacto) e M4 é o controle oposto.\n`,
    })
    const r = run(dir)
    expect(r.ok).toBe(true)
  })

  it("IGNORA uma contagem de SUBCONJUNTO na prosa (limite declarado da régua)", () => {
    const dir = makeFixture({
      metadesPorSuite: 5,
      doc: `# Guards\n\nA suíte \`scripts/test-mutation-sub-0.sh\` mede as duas direções do commit e depois a mutação.\n`,
    })
    const r = run(dir)
    expect(r.ok).toBe(true)
  })

  // A ÊNFASE DO MARKDOWN não é cosmética aqui: com o negrito entre o verbo e o
  // número, a contagem escrita na doc saía do alcance do parser e a prosa ficava
  // velha EM SILÊNCIO — o caso MEDIDO no repositório: a doc dizia
  // "a suíte declara **8 metades**" com a suíte declarando dez, e o guard passava.
  it("FALHA quando a contagem está em NEGRITO (a ênfase é retirada antes de ler)", () => {
    const dir = makeFixture({
      metadesPorSuite: 3,
      doc: `# Guards\n\n**Prova por mutação:** \`scripts/test-mutation-sub-0.sh\` declara **4 metades** no bloco.\n`,
    })
    const r = run(dir)
    expect(r.ok).toBe(false)
    expect(r.violations.some((v) => v.includes("≠ 3") && v.includes("declara 4 metades"))).toBe(
      true,
    )
  })

  it("o CONTROLE: a contagem em negrito com o total CERTO passa (a régua não acusa o são)", () => {
    const dir = makeFixture({
      metadesPorSuite: 3,
      doc: `# Guards\n\n**Prova por mutação:** \`scripts/test-mutation-sub-0.sh\` declara **3 metades** no bloco.\n`,
    })
    const r = run(dir)
    expect(r.ok).toBe(true)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// O MODO --staged: o veredito é do ÍNDICE, não do working tree.
//
// O `ler` é INJETÁVEL de propósito: a orquestração (o que é julgado, o que é
// materializado, o que é violação por ausência) é medida sem repositório git —
// e o caminho REAL do `git show :path` é medido no último teste, com um repo de
// verdade, para a injeção não esconder o `git` de mentira.
// ────────────────────────────────────────────────────────────────────────────

/**
 * Um leitor de ÍNDICE a partir de um diretório de fixture (com overrides por
 * caminho) — o mapa do que o "índice" tem, sem tocar em git.
 */
function indiceDe(
  dir: string,
  {
    overrides = {},
    ausentes = [],
  }: { overrides?: Record<string, string>; ausentes?: string[] } = {},
) {
  return (_root: string, rel: string) => {
    if (ausentes.includes(rel))
      return { ok: false as const, motivo: `path '${rel}' não está no índice` }
    const caminho = join(dir, rel)
    if (overrides[rel] === undefined && !existsSync(caminho))
      return { ok: false as const, motivo: `path '${rel}' não está no índice` }
    return { ok: true as const, conteudo: overrides[rel] ?? readFileSync(caminho, "utf8") }
  }
}

describe("check-mutation-count --staged (a árvore do índice)", () => {
  it("julga o ÍNDICE: o WIP partido da árvore não entra no veredito", () => {
    // O CASO REAL: a árvore tem a matriz bumpada e as refs ainda não (WIP do
    // desenvolvedor), e o índice tem o commit consistente. O veredito da ÁRVORE
    // falha (o WIP é inconsistente), o do ÍNDICE passa (é o que o commit carrega).
    const arvore = makeFixture({ count: 14 })
    const indice = makeFixture({ count: 13 })

    expect(run(arvore).ok).toBe(true) // a árvore do fixture é COERENTE consigo mesma
    const r = runStaged(arvore, { ler: indiceDe(indice) })
    expect(r.ok).toBe(true)
    expect(r.derivedCount).toBe(13)

    // E a outra metade: a ÁRVORE partida (matriz 15, refs 13) falha, o ÍNDICE
    // consistente segue verde — a diferença entre os dois é o ESCOPO.
    const arvorePartida = makeFixture({ count: 15, readmeLive: 13, workflowSummary: 13 })
    expect(run(arvorePartida).ok).toBe(false)
    const r2 = runStaged(arvorePartida, { ler: indiceDe(indice) })
    expect(r2.ok).toBe(true)
  })

  it("RECUSA o count partido entre dois commits (a matriz no índice, as refs não)", () => {
    // O DEFEITO QUE ESTE RECORTE FECHA: a árvore já está consertada (matriz 14 e
    // TODAS as refs 14 — o `run()` passa), mas só a MATRIZ foi estagiada; o
    // índice carrega 14 na matriz e 13 nas refs. Sem este recorte, o commit sai
    // partido e o defeito só aparece no CI (ou num rebase/cherry-pick do primeiro).
    const arvore = makeFixture({ count: 14 })
    expect(run(arvore).ok).toBe(true)

    const refsAntigas = makeFixture({ count: 14 })
    const overrides = {
      "README.md": readFileSync(join(makeFixture({ count: 13 }), "README.md"), "utf8"),
      ".github/workflows/pr-check.yml": readFileSync(
        join(makeFixture({ count: 13 }), ".github/workflows/pr-check.yml"),
        "utf8",
      ),
    }
    const r = runStaged(refsAntigas, { ler: indiceDe(refsAntigas, { overrides }) })
    expect(r.ok).toBe(false)
    expect(r.derivedCount).toBe(14)
    expect(r.violations.some((v) => v.includes("README.md") && v.includes("≠ 14"))).toBe(true)
    expect(r.violations.some((v) => v.includes("summary") || v.includes("comentário"))).toBe(true)
  })

  it("arquivo que o master cita e o ÍNDICE não tem é VIOLAÇÃO nomeada (fail-closed)", () => {
    // A suíte nova do sub-test novo, escrita na árvore e ainda não estagiada: o
    // commit da matriz apontaria para um arquivo que ele não carrega.
    const dir = makeFixture({ count: 13 })
    const suíte = "scripts/test-mutation-sub-3.sh"
    expect(
      caminhosDoVeredito(readFileSync(join(dir, "scripts/test-mutation-guards.sh"), "utf8")),
    ).toContain(suíte)

    const r = runStaged(dir, { ler: indiceDe(dir, { ausentes: [suíte] }) })
    expect(r.ok).toBe(false)
    expect(r.ausentesNoIndice).toHaveLength(1)
    expect(
      r.violations.some(
        (v) => v.includes(suíte) && v.includes("o ÍNDICE não o tem") && v.includes("git add"),
      ),
    ).toBe(true)
  })

  it("o master ausente do índice é INFRA (exit 2 pelo CLI), nunca 'nada a julgar'", () => {
    const dir = makeFixture({ count: 13 })
    expect(() =>
      runStaged(dir, { ler: indiceDe(dir, { ausentes: ["scripts/test-mutation-guards.sh"] }) }),
    ).toThrow(/não consegui ler o master/)
  })

  it("caminhosDoVeredito deriva o master, o pr-check, o README, a doc e CADA suíte citada", () => {
    const dir = makeFixture({ count: 3 })
    const rels = caminhosDoVeredito(
      readFileSync(join(dir, "scripts/test-mutation-guards.sh"), "utf8"),
    )
    expect(rels).toEqual([
      "scripts/test-mutation-guards.sh",
      ".github/workflows/pr-check.yml",
      "README.md",
      "docs/GUARDS.md",
      BENCH_PATH,
      "scripts/test-mutation-sub-0.sh",
      "scripts/test-mutation-sub-1.sh",
      "scripts/test-mutation-sub-2.sh",
    ])
  })

  it("o ATO do ÍNDICE é o que o commit carrega: o sub-test novo que ele não versiona ACUSA", () => {
    // O caso real do pre-commit: a matriz bumpada já estagiada e o registro do
    // bench ainda com as formas do ato anterior. O veredito do ÍNDICE reprova
    // (o commit não pode sair com a defasagem), e a árvore COERENTE passa — a
    // diferença entre os dois continua sendo o ESCOPO.
    const arvore = makeFixture({ count: 14, bench: "completo" })
    expect(run(arvore).ok).toBe(true)

    const indice = makeFixture({ count: 14, bench: benchCompleto(13) })
    const r = runStaged(arvore, { ler: indiceDe(indice) })
    expect(r.ok).toBe(false)
    expect(r.violations.some((v) => v.startsWith(BENCH_PATH) && v.includes("sub-13"))).toBe(true)
  })

  it("o CLI julga o ÍNDICE de um repositório git DE VERDADE (git show :path)", () => {
    // A fixture vira um repositório: o que está commitado é o estado COERENTE.
    const dir = makeFixture({ count: 13 })
    const git = (...args: string[]) =>
      execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
    git("init", "-q")
    git("config", "user.email", "count@test")
    git("config", "user.name", "count test")
    git("add", "-A")
    git("commit", "-qm", "base")

    const roda = () => {
      try {
        return {
          rc: 0,
          saida: execFileSync(process.execPath, [GUARD, "--staged"], {
            cwd: dir,
            encoding: "utf8",
          }),
        }
      } catch (e) {
        const err = e as { status?: number; stderr?: string; stdout?: string }
        return { rc: err.status ?? -1, saida: `${err.stdout ?? ""}${err.stderr ?? ""}` }
      }
    }

    // 1. WIP na ÁRVORE (matriz 14 sem as refs) SEM estagiar: o commit não mudou,
    //    e o índice é o que vai ser commitado — passa.
    writeFileSync(
      join(dir, "scripts/test-mutation-guards.sh"),
      readFileSync(join(dir, "scripts/test-mutation-guards.sh"), "utf8").replace(
        "SUBTESTS=(",
        'SUBTESTS=(\n  "sub-novo|scripts/test-mutation-sub-0.sh"',
      ),
    )
    const wip = roda()
    expect(wip.rc).toBe(0)
    expect(wip.saida).toContain("13 sub-tests da matriz")

    // 2. A MATRIZ ESTAGIADA com as refs ainda em 13: é o count PARTIDO entre dois
    //    commits — o commit que sai daqui está inconsistente, e o veredito é 1.
    git("add", "scripts/test-mutation-guards.sh")
    const partido = roda()
    expect(partido.rc).toBe(1)
    expect(partido.saida).toContain("no ÍNDICE")
    expect(partido.saida).toContain("14 sub-tests")
  })
})

describe("a PROSA DERIVADA (a tabela do GUARDS e o parágrafo do README) × o registro", () => {
  /** As violações da família nova — as que falam do bloco derivado. */
  const daFamilia = (vs: string[]) =>
    vs.filter((v) => v.includes("DIVERGE") || v.includes("marcadores"))

  it("o fixture SÃO passa: o bloco vivo é o que o registro renderiza", () => {
    const dir = makeFixture({ count: 3, bench: "completo", docDerivado: true })
    try {
      const r = run(dir)
      expect(daFamilia(r.violations).map((v) => v.slice(0, 300))).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("um número trocado à mão no parágrafo do README é recusado, com a linha e o renderizado", () => {
    const dir = makeFixture({ count: 3, bench: "completo" })
    try {
      const p = join(dir, "README.md")
      const antes = readFileSync(p, "utf8")
      // 3 formas × 2 metades = 6: o arquivo diz 7
      writeFileSync(p, antes.replace("**6 metades**", "**7 metades**"))
      expect(readFileSync(p, "utf8")).not.toBe(antes)

      const v = run(dir).violations.find((x) => x.includes("DIVERGE"))
      expect(v).toBeDefined()
      expect(v).toContain("README.md:")
      expect(v).toContain("o parágrafo de custo DIVERGE do registro versionado")
      expect(v).toContain("**6 metades**") // o RENDERIZADO
      expect(v).toContain("**7 metades**") // o vivo
      expect(v).toContain(BENCH_ACT) // o remédio é o mesmo ato de sempre
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("a TABELA da doc também é recusada quando o número dela não é o do registro", () => {
    const dir = makeFixture({ count: 3, bench: "completo", docDerivado: true })
    try {
      const p = join(dir, "docs/GUARDS.md")
      const antes = readFileSync(p, "utf8")
      writeFileSync(p, antes.replace("**soma dos 3 sub-tests**", "**soma dos 4 sub-tests**"))

      const v = run(dir).violations.find((x) => x.includes("DIVERGE"))
      expect(v).toBeDefined()
      expect(v).toContain("docs/GUARDS.md:")
      expect(v).toContain("a tabela por sub-test DIVERGE")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("o marcador apagado tira a prosa do julgamento — e isso é violação, não silêncio", () => {
    const dir = makeFixture({ count: 3, bench: "completo" })
    try {
      const p = join(dir, "README.md")
      writeFileSync(p, readFileSync(p, "utf8").replace(BLOCO_README.abre, ""))

      const v = run(dir).violations.find((x) => x.includes("marcadores"))
      expect(v).toBeDefined()
      expect(v).toContain("README.md: o bloco de o parágrafo de custo não está entre os marcadores")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("um marcador DUPLICADO também é recusado (o bloco existe UMA vez)", () => {
    const dir = makeFixture({ count: 3, bench: "completo" })
    try {
      const p = join(dir, "README.md")
      writeFileSync(p, readFileSync(p, "utf8") + `\n${BLOCO_README.abre}\n`)
      expect(daFamilia(run(dir).violations).length).toBeGreaterThan(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("sem o REGISTRO não há prosa derivada a julgar (a régua da ligação matriz ↔ ato)", () => {
    const dir = makeFixture({ count: 3 })
    try {
      expect(daFamilia(run(dir).violations)).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("a doc das metades é o único opcional: sem ela, só o parágrafo do README é julgado", () => {
    const dir = makeFixture({ count: 3, bench: "completo" })
    try {
      expect(existsSync(join(dir, "docs/GUARDS.md"))).toBe(false)
      expect(daFamilia(run(dir).violations)).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
