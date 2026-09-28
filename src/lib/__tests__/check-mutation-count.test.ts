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
  docsDaProsa,
  linhaDaCobertura,
  run,
  runStaged,
  analisaOrdinais,
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
  /**
   * Índices das suítes que CHAMAM a régua única da prova-de-aplicação: o corpo
   * da suíte ganha o `. "$SCRIPT_DIR/scripts/mutacao-prova.sh"` e um `mutar`
   * que chama `mutacao_aplicar`.
   */
  provaSuites?: number[]
  /** Índice da suíte que carrega a CÓPIA PRIVADA do `grep` do marcador. */
  provaCopia?: number | null
  /**
   * O bloco `PROVA_DE_APLICACAO=( "id" ... )` do master: `null` (default) = o
   * bloco NÃO existe (a lista não é julgada); um array = a lista DECLARADA.
   */
  provaLista?: string[] | null
  /**
   * O bloco `FORA_DA_REGUA=( "id|motivo" ... )` do master: `null` (default) = o
   * bloco NÃO existe (a relação com a régua não é julgada); um array = as linhas
   * DECLARADAS (`id|motivo`).
   */
  foraLista?: string[] | null
  /** O bloco `SEM_MARCADOR=( "caminho|motivo" ... )` — o caminho DECLARADO. */
  semMarcadorLista?: string[] | null
  /** Índices das suítes que chamam o CAMINHO DECLARADO da régua. */
  semMarcadorSuites?: number[]
  /**
   * A COBERTURA da régua do ordinal declarada na doc — a linha
   * `**A régua do ordinal: N referência(s) JULGADA(S) e M PULADA(S) — historico
   * N · foraDeEscopo N · blocoDerivado N**`:
   *   - `"auto"` (default): a LINHA com o número REAL do próprio fixture (o
   *     teste declara o que escreveu sem contar à mão o que a régua julgou);
   *   - `{ julgadas, puladas, porClasse }`: a linha com o número que o teste
   *     mandar — é assim que os testes da TRAVA declaram o teto/piso errados (e a
   *     divisão POR CLASSE, que é a outra metade da declaração). Um total de pulos
   *     que as classes não somam LEVANTA: é fixture incoerente, não caso;
   *   - `"legada"`: a linha na forma ANTIGA, só os totais — a declaração que não
   *     carrega a classe de cada pulo (e é violação por isso);
   *   - `"sem-linha"`: a doc SEM a declaração (fail-closed).
   */
  cobertura?:
    | "auto"
    | "legada"
    | "sem-linha"
    | { julgadas: number; puladas: number; porClasse?: Record<string, number> }
}

/**
 * O MOTIVO do caminho declarado que o fixture escreve no FONTE da suíte — é o
 * texto que a chamada passa e que o bloco `SEM_MARCADOR` do master tem de
 * declarar: a justificativa da dispensa vive nos DOIS lugares.
 */
const MOTIVO_SEM_MARCADOR = "o payload é uma remoção: não há texto novo onde o marcador caiba"

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
  provaSuites = [],
  provaCopia = null,
  provaLista = null,
  foraLista = null,
  semMarcadorLista = null,
  semMarcadorSuites = [],
  cobertura = "auto",
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
    // A PROVA-DE-APLICAÇÃO: a suíte que chama a régua única carrega o SOURCE
    // dela, e a que carrega a cópia privada escreve o `grep` do marcador.
    const chamaRegua = (provaSuites ?? []).includes(i)
    const chamaSemMarcador = (semMarcadorSuites ?? []).includes(i)
    const prova = chamaRegua
      ? '\n# shellcheck source=scripts/mutacao-prova.sh\n. "$SCRIPT_DIR/scripts/mutacao-prova.sh"\nmutar() { mutacao_aplicar "$1" "$2" "$3" "$4"; }\n'
      : chamaSemMarcador
        ? `\n# shellcheck source=scripts/mutacao-prova.sh\n. "$SCRIPT_DIR/scripts/mutacao-prova.sh"\n# O MOTIVO da dispensa é a JUSTIFICATIVA da chamada (o mesmo texto do master).\nMOTIVO_SEM_MARCADOR='${MOTIVO_SEM_MARCADOR}'\nmutar() { mutacao_aplicar_sem_marcador "$1" "$2" "$3" "$4" "$MOTIVO_SEM_MARCADOR"; }\n`
        : i === provaCopia
          ? "\nmutar() { if ! grep -qF 'MUTACAO M' \"$1\"; then exit 1; fi }\n"
          : ""
    writeFileSync(join(dir, rel), `#!/usr/bin/env bash\nset -euo pipefail\n${corpo}${prova}`)
  }
  const provaBloco =
    provaLista === null || provaLista === undefined
      ? ""
      : `PROVA_DE_APLICACAO=(\n${provaLista.map((id) => `  "${id}"`).join("\n")}\n)\n`
  const foraBloco =
    foraLista === null || foraLista === undefined
      ? ""
      : `FORA_DA_REGUA=(\n${foraLista.map((l) => `  "${l}"`).join("\n")}\n)\n`
  const semMarcadorBloco =
    semMarcadorLista === null || semMarcadorLista === undefined
      ? ""
      : `SEM_MARCADOR=(\n${semMarcadorLista.map((l) => `  "${l}"`).join("\n")}\n)\n`
  const master = `#!/usr/bin/env bash
# Roda os ${masterHeader ?? count} mutation tests node-puro dos guards de CI num ÚNICO script
SUBTESTS=(
${entries.join("\n")}
)
${provaBloco}${foraBloco}${semMarcadorBloco}`
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

  // A DECLARAÇÃO da cobertura da régua do ordinal (a linha que o
  // `check-mutation-count` confere): o `"auto"` a escreve com o número REAL do
  // fixture — a régua do ordinal RODADA sobre ele —, e os testes da TRAVA passam
  // o número que quiserem. A ausência da linha é do teste que a pedir.
  const docFixture = join(dir, "docs/GUARDS.md")
  if (cobertura !== "sem-linha" && existsSync(docFixture)) {
    const medida = analisaOrdinais(
      dir,
      Array.from({ length: count }, (_, i) => ({
        id: `sub-${i}`,
        script: `scripts/test-mutation-sub-${i}.sh`,
      })),
    ).cobertura
    // A FORMA ANTIGA da linha (só os totais) existe para o teste que mede a
    // declaração SEM a classe de cada pulo — e ela é escrita com o número REAL,
    // para o defeito medido ser UM (a classe ausente), e não dois.
    const legada = (c: { julgadas: number; puladas: number }) =>
      `**A régua do ordinal: ${c.julgadas} referência(s) JULGADA(S) e ${c.puladas} PULADA(S)**`
    if (cobertura === "auto" || cobertura === "legada") {
      appendFileSync(
        docFixture,
        `\n${cobertura === "legada" ? legada(medida) : linhaDaCobertura(medida)}\n`,
      )
    } else {
      const porClasse = cobertura.porClasse ?? {}
      const soma = ["historico", "foraDeEscopo", "blocoDerivado"].reduce(
        (acc, nome) => acc + (porClasse[nome] ?? 0),
        0,
      )
      if (soma !== cobertura.puladas) {
        throw new Error(
          `fixture incoerente: a cobertura declara ${cobertura.puladas} pulo(s) e as classes somam ${soma} — declare a divisão inteira (porClasse)`,
        )
      }
      appendFileSync(docFixture, `\n${linhaDaCobertura({ ...cobertura, porClasse })}\n`)
    }
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
// OS ORDINAIS DA MATRIZ — a suíte identificada pela POSIÇÃO na prosa. O guard
// confere o número contra a ORDEM real do SUBTESTS (a posição de HOJE) e é
// FAIL-CLOSED quando a referência não NOMEIA a suíte. O CONTROLE (a ordem de um
// ato passado, que não diz `da matriz`) passa com `violations: []`.
// ────────────────────────────────────────────────────────────────────────────

describe("check-mutation-count — o ORDINAL da suíte × a ordem real do SUBTESTS", () => {
  const daMatriz = (v: string) => /ordinal|entrada da matriz|matriz tem \d+ entradas/.test(v)

  it("o ordinal que BATE com a ordem passa (a suíte é nomeada ao lado do número)", () => {
    const dir = makeFixture({
      count: 5,
      doc: "# Guards\n\nA suíte é a 3.ª entrada da matriz (`sub-2`), e por isso roda em job próprio.\n",
    })
    const r = run(dir)
    expect(r.violations.filter(daMatriz)).toEqual([])
    expect(r.ok).toBe(true)
    // O relatório PUBLICA a referência e o que a régua derivou dela (a suíte que
    // a frase nomeia), para o drift ser auditável sem reler a doc.
    expect(r.ordinais).toEqual([
      expect.objectContaining({ arquivo: "docs/GUARDS.md", ordinal: 3, candidatos: ["sub-2"] }),
    ])
  })

  it("o ordinal ERRADO acusa, nomeando a posição REAL da suíte citada", () => {
    // O defeito medido: a `stack-per-commit` era a 38.ª quando a doc a escreveu e
    // é a 40.ª hoje — a prosa identificava a suíte errada e nada acusava.
    const dir = makeFixture({
      count: 5,
      doc: "# Guards\n\nA suíte é a 9.ª entrada da matriz (`sub-2`).\n",
    })
    const r = run(dir)
    expect(r.ok).toBe(false)
    const v = r.violations.find((x) => x.includes("9.ª entrada da matriz"))!
    expect(v).toContain("`sub-2` é a 3.ª")
  })

  it("FAIL-CLOSED: um ordinal SEM a suíte ao lado é violação, nunca omissão", () => {
    // Um número que ninguém consegue conferir é assim que ele envelhece: o guard
    // exige a âncora (o `id` ou o caminho do script) na mesma frase.
    const dir = makeFixture({
      count: 5,
      doc: "# Guards\n\nA suíte é a 3.ª entrada da matriz.\n",
    })
    const r = run(dir)
    expect(r.ok).toBe(false)
    expect(r.violations.some((v) => v.includes("NÃO nomeia a suíte"))).toBe(true)
  })

  it("o ordinal POR EXTENSO que BATE com a ordem passa (a mesma régua, a outra grafia)", () => {
    // A posição escrita em palavras NÃO é um caso à parte: `quadragésima primeira
    // entrada da matriz` é a 41.ª, e o relatório publica o número que a régua
    // derivou do texto.
    const dir = makeFixture({
      count: 41,
      doc: "# Guards\n\nA suíte é a quadragésima primeira entrada da matriz (`sub-40`).\n",
    })
    const r = run(dir)
    expect(r.violations.filter(daMatriz)).toEqual([])
    expect(r.ok).toBe(true)
    expect(r.ordinais).toEqual([
      expect.objectContaining({
        arquivo: "docs/GUARDS.md",
        ordinal: 41,
        citada: "quadragésima primeira entrada da matriz",
        candidatos: ["sub-40"],
      }),
    ])
  })

  it("o ordinal POR EXTENSO ERRADO acusa, nomeando a posição REAL da suíte citada", () => {
    // O extenso envelhece IGUAL ao `<N>ª`: a mesma prosa fica errada no dia em
    // que uma entrada nasce antes — e é essa a razão de a régua lê-lo.
    const dir = makeFixture({
      count: 41,
      doc: "# Guards\n\nA suíte é a quadragésima entrada da matriz (`sub-2`).\n",
    })
    const r = run(dir)
    expect(r.ok).toBe(false)
    const v = r.violations.find((x) => x.includes("quadragésima entrada da matriz"))!
    expect(v).toContain("`sub-2` é a 3.ª")
  })

  it("FAIL-CLOSED também no EXTENSO: sem a suíte ao lado é violação, nunca omissão", () => {
    const dir = makeFixture({
      count: 41,
      doc: "# Guards\n\nA suíte é a quadragésima entrada da matriz.\n",
    })
    expect(run(dir).violations.some((v) => v.includes("NÃO nomeia a suíte"))).toBe(true)
  })

  it("o CONTROLE: uma palavra que NÃO é ordinal antes do `da matriz` não é referência", () => {
    // A janela do extenso são PALAVRAS antes do `da matriz` — quem diz se o
    // trecho é uma posição é o dicionário, não a regex: `última metade` e uma
    // dezena seguida de outra (`vigésima trigésima`) não são número nenhum, e
    // inventá-lo acusaria prosa que não fala de posição.
    const dir = makeFixture({
      count: 41,
      doc: "# Guards\n\nA última metade da matriz descreve o histórico do ato.\n",
    })
    const r = run(dir)
    expect(r.violations.filter(daMatriz)).toEqual([])
    expect(r.ordinais).toEqual([])
  })

  it("o ESCOPO é a PROSA: uma referência num TERCEIRO doc entra na régua", () => {
    // Enquanto o escopo era um par escrito no fonte (`docs/GUARDS.md` e
    // `README.md`), uma referência posicional em qualquer OUTRO doc era
    // invisível — e uma referência que a régua não lê envelhece como a que ela
    // lê: em silêncio.
    const dir = makeFixture({ count: 5, doc: "# Guards\n\nnada aqui.\n" })
    const outro = join(dir, "docs/TESTING.md")
    writeFileSync(outro, "# Testes\n\nA régua é a 3.ª entrada da matriz (`sub-2`).\n")
    expect(run(dir).violations.filter(daMatriz)).toEqual([])

    writeFileSync(outro, "# Testes\n\nA régua é a 9.ª entrada da matriz (`sub-2`).\n")
    const v = run(dir).violations.find((x) => x.includes("docs/TESTING.md"))!
    expect(v).toContain("9.ª entrada da matriz")
    expect(v).toContain("`sub-2` é a 3.ª")
  })

  it("o recorte --staged materializa a PROSA da árvore (e o doc fora dela não é julgado)", () => {
    const dir = makeFixture({ count: 5, doc: "# Guards\n\nnada aqui.\n" })
    writeFileSync(
      join(dir, "docs/TESTING.md"),
      "# Testes\n\nA régua é a 9.ª entrada da matriz (`sub-2`).\n",
    )
    // O `.md` da RAIZ que não é o README fica fora: o escopo é a árvore de docs
    // mais o README, e ele é DECLARADO — não o que a varredura alcançar por acaso.
    writeFileSync(
      join(dir, "NOTAS.md"),
      "# Notas\n\nA régua é a 9.ª entrada da matriz (`sub-2`).\n",
    )

    const r = runStaged(dir, { ler: indiceDe(dir) })
    expect(r.violations.some((v) => v.includes("docs/TESTING.md"))).toBe(true)
    expect(r.violations.some((v) => v.includes("NOTAS.md"))).toBe(false)
  })

  it("docsDaProsa varre a árvore de docs, ordenada, e ignora o que não é prosa", () => {
    const dir = makeFixture({ count: 3, doc: "# Guards\n" })
    mkdirSync(join(dir, "docs/audit"), { recursive: true })
    writeFileSync(join(dir, "docs/audit/nota.md"), "# nota\n")
    writeFileSync(join(dir, "docs/ignorado.txt"), "não é markdown\n")
    mkdirSync(join(dir, "docs/.oculto"), { recursive: true })
    writeFileSync(join(dir, "docs/.oculto/x.md"), "# oculto\n")

    const rels = docsDaProsa(dir)
    expect(rels).toContain("README.md")
    expect(rels).toContain("docs/GUARDS.md")
    expect(rels).toContain("docs/audit/nota.md")
    expect(rels).not.toContain("docs/ignorado.txt")
    expect(rels).not.toContain("docs/.oculto/x.md")
    expect([...rels].sort()).toEqual(rels)
  })

  it("as âncoras `do master` e `de número` afirmam a posição de HOJE", () => {
    // As OUTRAS formas de ancorar a posição de agora: o master É a matriz, e o
    // `de número` afirma o número sem rodeio. As duas são julgadas como o
    // `da matriz` — a régua é uma só.
    const certo = makeFixture({
      count: 5,
      doc: "# Guards\n\nA suíte é a 3.ª do master (`sub-2`), e a suíte de número 3 é a mesma (`scripts/test-mutation-sub-2.sh`).\n",
    })
    expect(run(certo).violations.filter(daMatriz)).toEqual([])

    const errado = makeFixture({
      count: 5,
      doc: "# Guards\n\nA suíte é a 9.ª do master (`sub-2`).\n",
    })
    const v1 = run(errado).violations.find((x) => x.includes("9.ª do master"))!
    expect(v1).toContain("`sub-2` é a 3.ª")

    const errado2 = makeFixture({
      count: 5,
      doc: "# Guards\n\nA suíte de número 9 é a `sub-2`.\n",
    })
    const v2 = run(errado2).violations.find((x) => x.includes("suíte de número 9"))!
    expect(v2).toContain("`sub-2` é a 3.ª")
  })

  it("a forma NUA é julgada com o CONTEXTO da matriz — e o sem-suíte é fail-closed", () => {
    // `a 42.ª entrada`, sem âncora nenhuma: a régua a julga quando a MESMA frase
    // diz que é da matriz (senão o número é de outra lista) e a suíte está lá.
    const certo = makeFixture({
      count: 5,
      doc: "# Guards\n\nO `sub-2` é a 3.ª entrada na matriz.\n",
    })
    expect(run(certo).violations.filter(daMatriz)).toEqual([])

    const errado = makeFixture({
      count: 5,
      doc: "# Guards\n\nO `sub-2` é a 9.ª entrada na matriz.\n",
    })
    const v = run(errado).violations.find((x) => x.includes("9.ª entrada"))!
    expect(v).toContain("`sub-2` é a 3.ª")

    const semSuite = makeFixture({
      count: 5,
      doc: "# Guards\n\nA suíte é a 9.ª entrada na matriz.\n",
    })
    expect(run(semSuite).violations.some((x) => x.includes("NÃO nomeia a suíte"))).toBe(true)
  })

  it("o ATO PASSADO da forma nua é PULADO — e sai DITO no relatório", () => {
    // A ordem daquele momento é história do instrumento: a matriz de hoje não é a
    // de então, e conferir o número contra ela seria a acusação ao que não foi
    // medido. A referência pula — e o relatório DIZ que pulou, e por quê.
    const dir = makeFixture({
      count: 5,
      doc: "# Guards\n\nO `sub-2` era a 9.ª entrada na matriz (medido em 22/09/2026).\n",
    })
    const r = run(dir)
    expect(r.violations.filter(daMatriz)).toEqual([])
    expect(r.ordinais).toEqual([
      expect.objectContaining({ ordinal: 9, candidatos: ["sub-2"], forma: "nua" }),
    ])
    expect(r.ordinais[0].historico).toBeDefined()
  })

  it("a forma nua SEM o contexto da matriz fica FORA do escopo, e também sai DITA", () => {
    // `a 9.ª entrada da lista de jobs` não fala da matriz: o escopo é declarado, e
    // uma referência que a régua não julga não pode sumir do relatório.
    const r = run(
      makeFixture({
        count: 5,
        doc: "# Guards\n\nO `sub-2` é a 9.ª entrada da lista de jobs.\n",
      }),
    )
    expect(r.violations.filter(daMatriz)).toEqual([])
    expect(r.ordinais[0].foraDeEscopo).toBe(true)
  })

  it("o CAMINHO do script também ancora (não só o `id` entre crases)", () => {
    const dir = makeFixture({
      count: 5,
      doc: "# Guards\n\n(`scripts/test-mutation-sub-2.sh`) é a 3.ª sub-test da matriz.\n",
    })
    expect(run(dir).violations.filter(daMatriz)).toEqual([])
  })

  it("o CONTROLE: a ordem de um ATO passado (sem o `da matriz`) NÃO é julgada", () => {
    // O histórico de custo do README descreve o TAMANHO da matriz daquele ato
    // ("a 33ª custava 9.0s", num ato de 33 sub-tests): é um instantâneo daquele
    // momento, não a posição de hoje — e a régua não o cobra.
    const dir = makeFixture({
      count: 5,
      doc: "# Guards\n\nNo ato de 33, a 33ª custava 9.0s sozinha (`canal-fixers`) — um instantâneo.\n",
    })
    expect(run(dir).violations.filter(daMatriz)).toEqual([])
  })

  it("a MESMA prosa fica ERRADA quando uma entrada nasce ANTES da suíte", () => {
    // A prova do defeito, medida: o número era verdadeiro e deixa de ser sem que
    // a prosa mude uma vírgula — o `sub-2` era a 3.ª e passa a ser a 4.ª quando
    // um sub-test entra ANTES dele na matriz.
    const doc = "# Guards\n\nA suíte é a 3.ª entrada da matriz (`sub-2`).\n"
    expect(run(makeFixture({ count: 5, doc })).violations.filter(daMatriz)).toEqual([])

    const depois = makeFixture({ count: 5, doc })
    const master = join(depois, "scripts/test-mutation-guards.sh")
    writeFileSync(
      master,
      readFileSync(master, "utf8").replace(
        "SUBTESTS=(\n",
        'SUBTESTS=(\n  "nova|scripts/test-mutation-nova.sh"\n',
      ),
    )
    writeFileSync(
      join(depois, "scripts/test-mutation-nova.sh"),
      "#!/usr/bin/env bash\nset -euo pipefail\n\nMETADES=(\n  'M1|a metade de ensaio'\n)\n",
    )
    expect(run(depois).violations.some((v) => v.includes("`sub-2` é a 4.ª"))).toBe(true)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// A COBERTURA DA RÉGUA DO ORDINAL — publicada e TRAVADA, e travada POR CLASSE.
// A doc declara quantas referências são JULGADAS e quantas são PULADAS, e a
// divisão de cada pulo (`historico` · `foraDeEscopo` · `blocoDerivado`); o
// veredito verde publica os números e o pulo só pode DIMINUIR: um pulo que sobe é
// a cobertura piorando, e um pulo que desce é o teto que envelheceu (a declaração
// tem de baixar junto). O TOTAL sozinho não basta: um pulo que MIGRA de classe
// mantém o total e mudava o que a régua pode julgar — é o caso que a declaração
// por classe (e o aviso de TOTAL IGUAL) existe para pegar. Sem a linha, uma
// referência que caia no pulo encolhe a régua — e o veredito continua verde sobre
// uma régua menor.
// ────────────────────────────────────────────────────────────────────────────

describe("check-mutation-count — a COBERTURA da régua do ordinal (publicada e travada)", () => {
  const daCobertura = (v: string) => /cobertura da régua do ordinal/i.test(v)
  /** A mesma doc, com a referência PULADA (a forma nua de um ato passado). */
  const DOC_PULADA = "# Guards\n\nO `sub-2` era a 9.ª entrada na matriz (medido em 22/09/2026).\n"
  const DOC_JULGADA = "# Guards\n\nA suíte é a 3.ª entrada da matriz (`sub-2`).\n"

  it("a declaração com o número REAL publica a cobertura (e o veredito fica verde)", () => {
    // O `"auto"` do fixture escreve a linha com o número que a régua DERIVOU: a
    // doc declara o que a prosa carrega, e o veredito verde publica os dois
    // números com a classe de cada pulo.
    const r = run(makeFixture({ count: 5, doc: DOC_JULGADA }))
    expect(r.violations.filter(daCobertura)).toEqual([])
    expect(r.ok).toBe(true)
    expect(r.ordinaisCobertura).toEqual({
      julgadas: 1,
      puladas: 0,
      porClasse: { historico: 0, foraDeEscopo: 0, blocoDerivado: 0 },
      declarado: {
        julgadas: 1,
        puladas: 0,
        porClasse: { historico: 0, foraDeEscopo: 0, blocoDerivado: 0 },
      },
    })
  })

  it("o PULO que SOBE é a cobertura PIORANDO — e a violação NOMEIA a classe que ganhou", () => {
    // O defeito: uma referência nova escrita de um jeito que CAI no pulo (a forma
    // nua de um ato passado) encolhe a régua — o veredito seguiria verde se o
    // pulo não fosse conferido contra uma declaração.
    const r = run(
      makeFixture({ count: 5, doc: DOC_PULADA, cobertura: { julgadas: 0, puladas: 0 } }),
    )
    expect(r.ok).toBe(false)
    const v = r.violations.find(daCobertura)!
    expect(v).toContain("`historico`")
    expect(v).toContain("GANHOU 1 pulo(s) — 1 contra 0 declarada(s)")
    expect(v).toContain("docs/GUARDS.md:3 (historico")
    expect(v).toContain("atualize a declaração")
    // O total MUDOU (0 → 1): o aviso da migração é do outro caso, e não pode
    // aparecer aqui (a mensagem não acusa o que não aconteceu).
    expect(v).not.toContain("MIGRAÇÃO")
  })

  it("o PULO que DESCE é o TETO que envelheceu NAQUELA classe — a declaração tem de BAIXAR", () => {
    // NÃO pode haver folga: um teto declarado acima do medido é exatamente o que
    // deixa a próxima piora passar sem vermelho.
    const r = run(
      makeFixture({
        count: 5,
        doc: DOC_PULADA,
        cobertura: { julgadas: 0, puladas: 2, porClasse: { historico: 2 } },
      }),
    )
    expect(r.ok).toBe(false)
    const v = r.violations.find(daCobertura)!
    expect(v).toContain("`historico`")
    expect(v).toContain("PERDEU 1 pulo(s) — 1 contra 2 declarada(s): a declaração ENVELHECEU ali")
    expect(v).toContain(
      linhaDaCobertura({
        julgadas: 0,
        puladas: 1,
        porClasse: { historico: 1, foraDeEscopo: 0, blocoDerivado: 0 },
      }),
    )
  })

  it("o TOTAL IGUAL com a classe TROCADA é MIGRAÇÃO — o caso que a declaração antiga não via", () => {
    // O defeito que a cauda por classe fecha: a MESMA quantidade de pulos, outra
    // origem. A régua do ORDINAL não muda de tamanho (o total bate), mas o que
    // ela PODE julgar muda — o que é pulado por `historico` nunca volta para o
    // julgamento, e o que é pulado por `foraDeEscopo` é candidato a voltar. Com os
    // totais sozinhos este caso saía VERDE.
    const dir = makeFixture({
      count: 3,
      bench: "completo",
      docDerivado: true,
      cobertura: { julgadas: 0, puladas: 1, porClasse: { historico: 1 } },
    })
    try {
      // A referência vive DENTRO do bloco derivado: a régua a pula como
      // `blocoDerivado` (o ato reescreve aquele bloco do registro).
      const p = join(dir, "docs/GUARDS.md")
      writeFileSync(
        p,
        readFileSync(p, "utf8").replace(
          `${BLOCO_GUARDS.abre}\n`,
          `${BLOCO_GUARDS.abre}\n\nA suíte é a 3.ª entrada da matriz (\`sub-2\`).\n`,
        ),
      )
      const r = run(dir)
      expect(r.ok).toBe(false)
      // A classe que RECEBEU o pulo e a que o PERDEU, cada uma pelo nome.
      const ganhou = r.violations.find((x) => daCobertura(x) && x.includes("`blocoDerivado`"))!
      const perdeu = r.violations.find((x) => daCobertura(x) && x.includes("`historico`"))!
      for (const classe of [ganhou, perdeu]) {
        expect(classe).toBeTruthy()
        // A informação que a declaração antiga não tinha como dar: o total NÃO
        // mudou — o pulo migrou.
        expect(classe).toContain("O TOTAL não mudou")
        expect(classe).toContain("MIGRAÇÃO")
      }
      expect(ganhou).toContain("GANHOU 1 pulo(s) — 1 contra 0 declarada(s)")
      expect(ganhou).toContain("docs/GUARDS.md:3 (blocoDerivado)")
      expect(perdeu).toContain("PERDEU 1 pulo(s) — 0 contra 1 declarada(s)")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("FAIL-CLOSED: a declaração SEM a classe de cada pulo é violação (o total sozinho não trava a migração)", () => {
    // A forma ANTIGA da linha, com o número REAL: o defeito medido é UM (a cauda
    // ausente), e o remédio sai na própria mensagem. Sem esta metade, uma
    // referência que passasse a cair numa classe nova manteria o total e o
    // veredito seguiria verde.
    const r = run(makeFixture({ count: 5, doc: DOC_JULGADA, cobertura: "legada" }))
    expect(r.ok).toBe(false)
    const v = r.violations.find(daCobertura)!
    expect(v).toContain("NÃO carrega a CLASSE de cada pulo")
    expect(v).toContain("MIGRA")
    expect(v).toContain(linhaDaCobertura({ julgadas: 1, puladas: 0, porClasse: {} }))
    // O declarado lido: os TOTAIS da forma antiga, e nenhuma classe (a cauda
    // ausente é o defeito — e é por isso que a violação acima tem remédio próprio).
    expect(r.ordinaisCobertura.declarado).toEqual({
      julgadas: 1,
      puladas: 0,
      porClasse: null,
    })
  })

  it("na declaração ANTIGA o TOTAL continua travado nas duas direções", () => {
    // O outro lado da linha sem a cauda: ela não declara a classe, e ainda assim
    // o total dela é conferido — a piora não passa enquanto a declaração não for
    // reescrita na forma inteira.
    const dir = makeFixture({ count: 5, doc: DOC_PULADA, cobertura: "legada" })
    try {
      const p = join(dir, "docs/GUARDS.md")
      writeFileSync(
        p,
        readFileSync(p, "utf8").replace(
          /\*\*A régua do ordinal:.*\*\*/,
          "**A régua do ordinal: 0 referência(s) JULGADA(S) e 0 PULADA(S)**",
        ),
      )
      const r = run(dir)
      expect(r.ok).toBe(false)
      const v = r.violations.filter(daCobertura).join(" | ")
      expect(v).toContain("NÃO carrega a CLASSE")
      expect(v).toContain("PIOROU")
      expect(v).toContain("1 referência(s) PULADA(S) contra 0 declarada(s)")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("as JULGADAS são um PISO: julgar MAIS passa, julgar MENOS acusa", () => {
    // Mais: uma referência nova na prosa é bem-vinda (o declarado é o que NÃO se
    // perde, não um teto).
    const mais = run(
      makeFixture({ count: 5, doc: DOC_JULGADA, cobertura: { julgadas: 0, puladas: 0 } }),
    )
    expect(mais.violations.filter(daCobertura)).toEqual([])
    expect(mais.ordinaisCobertura.julgadas).toBe(1)
    expect(mais.ordinaisCobertura.declarado).toEqual({
      julgadas: 0,
      puladas: 0,
      porClasse: { historico: 0, foraDeEscopo: 0, blocoDerivado: 0 },
    })

    // Menos: perder julgamento é perder cobertura — a perda tem de estar numa
    // decisão (a referência que saiu, o doc que sumiu, o escopo que estreitou).
    const menos = run(
      makeFixture({ count: 5, doc: DOC_JULGADA, cobertura: { julgadas: 3, puladas: 0 } }),
    )
    expect(menos.ok).toBe(false)
    const v = menos.violations.find(daCobertura)!
    expect(v).toContain("PERDEU JULGAMENTO")
    expect(v).toContain("julgaria 3 referência(s) e julga 1")
  })

  it("FAIL-CLOSED: a doc SEM a declaração é violação, nunca omissão", () => {
    // Sem a linha não há o que travar: "a régua encolheu" e "a régua nunca mediu
    // isso" seriam a mesma coisa, e o remédio (a linha com o número de agora) sai
    // na própria mensagem.
    const r = run(makeFixture({ count: 5, doc: DOC_JULGADA, cobertura: "sem-linha" }))
    expect(r.ok).toBe(false)
    const v = r.violations.find(daCobertura)!
    expect(v).toContain("não DECLARA a cobertura da régua do ordinal")
    expect(v).toContain(linhaDaCobertura({ julgadas: 1, puladas: 0 }))
    expect(r.ordinaisCobertura.declarado).toBeNull()
  })

  it("o BLOCO DERIVADO é uma classe de pulo CONTADA (a régua daquela prosa é a derivação)", () => {
    // A referência dentro do bloco derivado não é julgada aqui (o ato reescreve o
    // bloco do registro), mas ela foi VISTA: entra na contagem e sai DITA — o
    // `continue` mudo de antes deixava essa classe fora da cobertura.
    const dir = makeFixture({
      count: 3,
      bench: "completo",
      docDerivado: true,
      cobertura: { julgadas: 0, puladas: 1, porClasse: { blocoDerivado: 1 } },
    })
    try {
      const p = join(dir, "docs/GUARDS.md")
      writeFileSync(
        p,
        readFileSync(p, "utf8").replace(
          `${BLOCO_GUARDS.abre}\n`,
          `${BLOCO_GUARDS.abre}\n\nA suíte é a 3.ª entrada da matriz (\`sub-2\`).\n`,
        ),
      )
      const r = run(dir)
      expect(r.violations.filter(daCobertura)).toEqual([])
      expect(r.ordinais.filter((x) => x.blocoDerivado === true)).toHaveLength(1)
      expect(r.ordinaisCobertura).toEqual({
        julgadas: 0,
        puladas: 1,
        porClasse: { historico: 0, foraDeEscopo: 0, blocoDerivado: 1 },
        declarado: {
          julgadas: 0,
          puladas: 1,
          porClasse: { historico: 0, foraDeEscopo: 0, blocoDerivado: 1 },
        },
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("sem a doc não há onde declarar — e o relatório DIZ isso em vez de inventar", () => {
    const r = run(makeFixture({ count: 3 }))
    expect(r.violations.filter(daCobertura)).toEqual([])
    expect(r.ordinaisCobertura.declarado).toBeNull()
  })
})

// ────────────────────────────────────────────────────────────────────────────
// A PROVA-DE-APLICAÇÃO — a régua ÚNICA (`scripts/mutacao-prova.sh`) e a lista
// DECLARADA das suítes que a chamam. O que estes testes medem é o que impede a
// suíte de PERDER a prova (e passar a medir o alvo íntegro) em silêncio: a cópia
// privada do `grep` do marcador, a lista conferida nos DOIS sentidos e o número
// declarado na doc. O CONTROLE (o fixture coerente) passa com `violations: []`.
// ────────────────────────────────────────────────────────────────────────────

describe("check-mutation-count — a PROVA-DE-APLICAÇÃO (a régua única × a lista)", () => {
  /** O fixture COERENTE: duas suítes chamam a régua, a lista e a doc as declaram. */
  const comProva = (over: Partial<FixtureOpts> = {}) =>
    makeFixture({
      provaSuites: [0, 1],
      provaLista: ["sub-0", "sub-1"],
      doc: `# Guards\n\n**2 suítes** provam a aplicação pela régua única (\`scripts/mutacao-prova.sh\`).\n`,
      ...over,
    })

  it("o CONTROLE: a lista declarada, a doc e as suítes que chamam a régua batem", () => {
    const r = run(comProva())
    expect(r.violations).toEqual([])
    expect(r.prova.comProva).toEqual(["sub-0", "sub-1"])
  })

  it("a cópia PRIVADA do `grep` do marcador é violação, com a linha e o remédio", () => {
    const dir = comProva({ provaCopia: 2 })
    const r = run(dir)
    const v = r.violations.find((x) => x.includes("cópia PRIVADA"))
    expect(v).toContain("scripts/test-mutation-sub-2.sh")
    expect(v).toContain("mutacao_aplicar")
    // E o CONTROLE na direção oposta: sem a cópia, o MESMO fixture não a acusa.
    expect(run(comProva()).violations.some((x) => x.includes("cópia PRIVADA"))).toBe(false)
  })

  it("uma suíte que CHAMA a régua e não está na lista é violação (a prova que ninguém declara)", () => {
    const r = run(comProva({ provaSuites: [0, 1, 2] }))
    expect(
      r.violations.some((v) => v.includes("'sub-2'") && v.includes("PROVA_DE_APLICACAO")),
    ).toBe(true)
  })

  it("uma entrada da lista cuja suíte NÃO chama a régua é violação (a prova que se perdeu)", () => {
    // É a metade que pega a suíte que VOLTOU a mutar por conta própria: a linha
    // da lista fica órfã, e a suíte perdeu a prova sem que nada o dissesse.
    const r = run(comProva({ provaSuites: [0] }))
    expect(r.violations.some((v) => v.includes("'sub-1'") && v.includes("NÃO chama"))).toBe(true)
  })

  it("o NÚMERO declarado na doc tem de bater com a lista (a contagem que envelhece)", () => {
    const r = run(
      comProva({
        doc: `# Guards\n\n**3 suítes** provam a aplicação pela régua única.\n`,
      }),
    )
    expect(r.violations.some((v) => v.includes("declara 3 suíte") && v.includes("2"))).toBe(true)
  })

  it("a doc que NÃO declara o número é violação (fail-closed), nunca omissão", () => {
    const r = run(comProva({ doc: `# Guards\n\nA prova-de-aplicação é uma só.\n` }))
    expect(r.violations.some((v) => v.includes("não declara quantas suítes"))).toBe(true)
  })

  it("sem o bloco no master e com suíte chamando a régua: a lista ausente é violação", () => {
    const r = run(comProva({ provaLista: null }))
    expect(r.violations.some((v) => v.includes("não DECLARA as suítes"))).toBe(true)
    // O CONTROLE: sem o bloco e SEM ninguém chamando a régua, não há lista a
    // exigir (é o caso das suítes que mutam por conta própria).
    expect(run(makeFixture()).violations.some((v) => v.includes("não DECLARA"))).toBe(false)
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

  it("materializa o CHAMADOR do caminho declarado que NÃO é sub-test (SEM_MARCADOR)", () => {
    // O `forge-parity` não é sub-test da matriz: quem o cita é só o bloco
    // `SEM_MARCADOR`. Sem materializá-lo, a conferência do índice lia um diretório
    // onde o arquivo não existe e acusava "o script NÃO chama" sobre um fonte que
    // ela nunca leu — medido: o pre-commit recusou o commit da régua por isso.
    const motivo = "o payload é uma remoção: não há texto novo onde o marcador caiba"
    const fora = "scripts/test-mutation-forge-parity.sh"
    const dir = makeFixture({
      count: 3,
      semMarcadorSuites: [1],
      semMarcadorLista: [`scripts/test-mutation-sub-1.sh|${motivo}`, `${fora}|${motivo}`],
    })
    writeFileSync(
      join(dir, fora),
      `#!/usr/bin/env bash\nset -euo pipefail\n. "$SCRIPT_DIR/scripts/mutacao-prova.sh"\nMOTIVO_SEM_MARCADOR='${motivo}'\nmutar() { mutacao_aplicar_sem_marcador "$1" "$2" "$3" "$4" "$MOTIVO_SEM_MARCADOR"; }\n`,
    )

    const masterSrc = readFileSync(join(dir, "scripts/test-mutation-guards.sh"), "utf8")
    expect(caminhosDoVeredito(masterSrc)).toContain(fora)
    expect(runStaged(dir, { ler: indiceDe(dir) }).ok).toBe(true)
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

// ────────────────────────────────────────────────────────────────────────────
// A RELAÇÃO COM A RÉGUA É DECLARADA — `FORA_DA_REGUA` (com o MOTIVO) e o
// `SEM_MARCADOR` (o caminho declarado, o payload que não pode carregar o
// marcador). Toda suíte da matriz DIZ o que ela é para a régua; e quem dispensa
// o MARCADOR é declarado com o porquê. Sem estas duas listas, "não usa a régua"
// e "perdeu a régua" seriam a mesma coisa em silêncio.
// ────────────────────────────────────────────────────────────────────────────

describe("check-mutation-count — a DECLARAÇÃO de quem fica fora da régua", () => {
  /** O CONTROLE: a sub-0 chama a régua; a sub-1 e a sub-2 estão FORA, com motivo. */
  const comFora = (over: Partial<FixtureOpts> = {}) =>
    makeFixture({
      count: 3,
      provaSuites: [0],
      provaLista: ["sub-0"],
      foraLista: [
        "sub-1|o alvo é a CÓPIA do fixture no scratch, não a árvore",
        "sub-2|a mutação é a CONSTRUÇÃO do fixture",
      ],
      ...over,
    })

  it("o CONTROLE: toda suíte da matriz declara a sua relação com a régua", () => {
    const r = run(comFora())
    expect(r.violations).toEqual([])
  })

  it("uma suíte que NÃO está em nenhuma das duas listas é violação", () => {
    const r = run(comFora({ foraLista: ["sub-1|o alvo é a cópia do fixture"] }))
    const v = r.violations.find((x) => x.includes("'sub-2'") && x.includes("NÃO declara"))
    expect(v).toBeDefined()
    expect(v).toContain("FORA_DA_REGUA")
    // O CONTROLE na direção oposta: a sub-2 declarada não é acusada.
    expect(r.violations.some((x) => x.includes("'sub-1'"))).toBe(false)
  })

  it("uma linha de FORA_DA_REGUA SEM o motivo é violação (a lista sem o porquê)", () => {
    const r = run(comFora({ foraLista: ["sub-1", "sub-2|a mutação é a CONSTRUÇÃO do fixture"] }))
    expect(r.violations.some((v) => v.includes("'sub-1'") && v.includes("MOTIVO"))).toBe(true)
  })

  it("o mesmo id nas DUAS listas é violação (as listas dizem coisas opostas)", () => {
    const r = run(comFora({ provaLista: ["sub-0", "sub-1"] }))
    expect(
      r.violations.some((v) => v.includes("'sub-1'") && v.includes("as duas listas dizem")),
    ).toBe(true)
  })

  it("uma suíte declarada FORA que JÁ chama a régua é violação (a lista envelheceu)", () => {
    const r = run(comFora({ provaSuites: [0, 1] }))
    expect(r.violations.some((v) => v.includes("'sub-1'") && v.includes("envelheceu"))).toBe(true)
  })

  it("sem o bloco no master a relação NÃO é julgada (é o master anterior às listas)", () => {
    const r = run(makeFixture({ count: 3, provaSuites: [0], provaLista: ["sub-0"] }))
    expect(r.violations).toEqual([])
  })

  it("quem chama o CAMINHO DECLARADO sem estar em SEM_MARCADOR é violação", () => {
    const r = run(makeFixture({ count: 3, semMarcadorSuites: [1] }))
    expect(
      r.violations.some(
        (v) => v.includes("scripts/test-mutation-sub-1.sh") && v.includes("SEM_MARCADOR"),
      ),
    ).toBe(true)
  })

  it("SEM_MARCADOR declara o caminho com o motivo — e nos DOIS sentidos", () => {
    const linha = `scripts/test-mutation-sub-1.sh|${MOTIVO_SEM_MARCADOR}`
    const ok = run(makeFixture({ count: 3, semMarcadorSuites: [1], semMarcadorLista: [linha] }))
    expect(ok.violations).toEqual([])

    const semMotivo = run(
      makeFixture({
        count: 3,
        semMarcadorSuites: [1],
        semMarcadorLista: ["scripts/test-mutation-sub-1.sh"],
      }),
    )
    expect(
      semMotivo.violations.some((v) => v.includes("SEM_MARCADOR") && v.includes("MOTIVO")),
    ).toBe(true)

    const orfa = run(
      makeFixture({
        count: 3,
        semMarcadorLista: [`scripts/test-mutation-sub-1.sh|${MOTIVO_SEM_MARCADOR}`],
      }),
    )
    expect(orfa.violations.some((v) => v.includes("NÃO chama"))).toBe(true)
  })

  it("o MOTIVO declarado tem de estar no FONTE da suíte — a lista não justifica sozinha", () => {
    // A dispensa da prova do marcador é justificada ONDE ela acontece: o texto
    // declarado no master é o mesmo que a suíte carrega (entre aspas, é ele que a
    // chamada passa). Uma declaração que o fonte não carrega é uma razão que
    // envelhece num lugar onde nada acontece.
    const r = run(
      makeFixture({
        count: 3,
        semMarcadorSuites: [1],
        semMarcadorLista: ["scripts/test-mutation-sub-1.sh|o payload é uma remoção"],
      }),
    )
    expect(
      r.violations.some(
        (v) => v.includes("scripts/test-mutation-sub-1.sh") && v.includes("NÃO carrega"),
      ),
    ).toBe(true)
    // O CONTROLE: com o motivo que a suíte carrega, nada é acusado.
    const ok = run(
      makeFixture({
        count: 3,
        semMarcadorSuites: [1],
        semMarcadorLista: [`scripts/test-mutation-sub-1.sh|${MOTIVO_SEM_MARCADOR}`],
      }),
    )
    expect(ok.violations).toEqual([])
  })

  it("quem CITA o caminho declarado num comentário não é tomado por quem o chama", () => {
    // O próprio master CITA `mutacao_aplicar_sem_marcador` na prosa do bloco: a
    // conferência é da CHAMADA, não da menção.
    const dir = makeFixture({ count: 3 })
    try {
      const p = join(dir, "scripts/test-mutation-sub-0.sh")
      writeFileSync(
        p,
        `${readFileSync(p, "utf8")}\n# o caminho mutacao_aplicar_sem_marcador é declarado no master\n`,
      )
      expect(run(dir).violations).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
