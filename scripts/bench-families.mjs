#!/usr/bin/env node

// =============================================================================
// bench-families.mjs
//
// A RÉGUA das FAMÍLIAS do bench e os nomes dos arquivos dele — a parte PURA do
// `bench-guard-timing.mjs`, extraída para um módulo que NÃO faz I/O no import.
//
// POR QUE ESTA EXTRAÇÃO EXISTE (defeito real, medido): o `bench-guard-timing.mjs`
// resolve, na CARGA do módulo, o comando canônico do lint a partir do
// `package.json` (`lintEntry()`) e os call sites dele nos workflows. Quem só
// precisava perguntar "quais famílias este arquivo declara medidas?" — o doctor,
// pelo fato da idade da régua — arrastava esse trabalho junto, e passava a exigir
// um `package.json` para carregar. Medido: o teste da recursão do bring-up roda o
// doctor sobre uma cópia do repositório em /tmp e o import morria com
// `ENOENT: ... /package.json`. A régua não pode depender do que ela julga: aqui
// ficam as perguntas puras sobre o relatório, e o MÓDULO do bench segue sendo o
// dono do que exige ler o repositório.
//
// A RÉGUA É UMA SÓ: o `bench-guard-timing.mjs` importa e REEXPORTA daqui (o
// contrato dele não muda), a comparação de tempo, a procedência, a idade da régua
// (`bench-freshness.mjs`) e o doctor leem a MESMA tabela. Duas noções de "família
// medida" divergiriam no dia em que alguém ajustasse uma delas, e a divergência
// apareceria como "a baseline diz que mediu e o veredito diz que não" — sem teste
// vermelho.
//
// Usage:
//   node scripts/bench-families.mjs            # as famílias e o que cada arquivo declara
//   node scripts/bench-families.mjs --json     # o mesmo, como dados
//   node scripts/bench-families.mjs --help
//
// Exit codes:
//   0 — a régua foi impressa (é uma CONSULTA: não julga repositório nenhum)
//   3 — uso inválido
// =============================================================================

import process from "node:process"
import { pathToFileURL } from "node:url"

/**
 * Os DOIS arquivos do bench (versionados em `docs/benchmarks/`).
 *
 * EXPORTADOS porque a cadeia de herança, a idade da régua e os testes precisam
 * NOMEAR a fonte de cada família — um literal repetido seria uma segunda fonte da
 * mesma verdade.
 */
export const LATEST_FILE = "guard-timing-latest.json"
export const BASELINE_FILE = "guard-timing-baseline.json"

/**
 * O ATO que mediu cada familia, como fato de primeira classe.
 *
 * Uma familia pode chegar ao relatorio por tres caminhos, e o numero so e
 * comparavel se o caminho estiver dito: `measured` (esta rodada rodou o comando
 * dela), `reused` (herdada de outra rodada por `--merge`, com a origem marcada) e
 * `not-measured` (nao rodou aqui e nao havia de onde herdar — `--only`,
 * `--no-tests`, ou um arquivo anterior que tambem nao a tinha).
 *
 * A REGUA DE "FOI MEDIDA?" E UMA SO: as mesmas perguntas que a comparacao usa
 * para dizer que falta COBERTURA (`faltantes`, em `compareTimings`). Duas nocoes
 * de "medida" divergiriam no dia em que alguem ajustasse uma delas, e a
 * divergencia apareceria como "a baseline diz que mediu e o veredito diz que nao"
 * — sem teste vermelho.
 *
 * O `hook` responde pela MEDICAO declarada (`measured: true`) e nao pela secao
 * existir: uma secao presente com as ancoras sumidas nao mediu nada, e chama-la
 * de medida seria a mesma mentira que o `null` existe para evitar.
 *
 * @type {Record<string, (report: object|null|undefined) => boolean>}
 */
export const FAMILY_MEASURED = {
  battery: (report) => (report?.guards?.length ?? 0) > 0 || report?.doctor != null,
  lint: (report) => report?.lint != null,
  typecheck: (report) => report?.rulers?.typecheck != null,
  tests: (report) => report?.rulers?.tests != null,
  hook: (report) => report?.hook?.measured === true,
  mutations: (report) => report?.mutations?.measured === true,
}

/**
 * As familias que um ARQUIVO do bench declara medidas — a régua aplicada.
 *
 * @param {object|null|undefined} report
 * @returns {string[]} os nomes, na ordem declarada da tabela
 */
export function measuredFamilies(report) {
  return Object.keys(FAMILY_MEASURED).filter((family) => FAMILY_MEASURED[family](report))
}

// ---------------------------------------------------------------------------
// Main (uma CONSULTA: não lê repositório nenhum, não tem veredito)
// ---------------------------------------------------------------------------

export const USAGE = "Uso: node scripts/bench-families.mjs [--json] [--help]"

/** SÍNCRONO de propósito: um módulo-folha com top-level await contagiaria todo
 * importador com a carga assíncrona — e esta consulta não tem o que esperar. */
function main() {
  const argv = process.argv.slice(2)
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(USAGE)
    console.log(
      '\n  Imprime a RÉGUA das famílias do bench: os nomes, o critério de "foi medida?"\n' +
        "  de cada uma e os dois arquivos do bench (latest/baseline). É a tabela que a\n" +
        "  comparação, a procedência, a idade da régua (`bench-freshness.mjs`) e o doctor\n" +
        "  leem — o comando existe para ela ser consultável em vez de reconstruída de memória.",
    )
    return 0
  }
  const desconhecido = argv.find((a) => a !== "--json")
  if (desconhecido !== undefined) {
    console.error(`❌ argumento desconhecido: ${desconhecido}`)
    console.error(USAGE)
    return 3
  }

  const familias = Object.keys(FAMILY_MEASURED).map((family) => ({
    family,
    criterio: String(FAMILY_MEASURED[family]),
  }))
  if (argv.includes("--json")) {
    console.log(
      JSON.stringify({ families: familias, latest: LATEST_FILE, baseline: BASELINE_FILE }, null, 2),
    )
    return 0
  }
  console.log("📐 Régua das famílias do bench:")
  for (const f of familias) console.log(`   · ${f.family}: ${f.criterio}`)
  console.log(`   arquivos: ${LATEST_FILE} (run) · ${BASELINE_FILE} (a régua)`)
  return 0
}

const IS_DIRECT_RUN =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (IS_DIRECT_RUN) {
  let code = 3
  try {
    code = main()
  } catch (error) {
    console.error(`❌ ${error.message}`)
    code = 3
  }
  process.exit(code)
}
