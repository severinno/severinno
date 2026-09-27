#!/usr/bin/env node
// =============================================================================
// fecho-imports.mjs — O FECHO DE IMPORTS de um módulo, DERIVADO do grafo
// =============================================================================
//
// Usage:
//   node scripts/fecho-imports.mjs <módulo> [<módulo>...]   # um caminho por linha
//   node scripts/fecho-imports.mjs <módulo> --root <dir>    # relativos a <dir>
//   node scripts/fecho-imports.mjs <módulo> --com-raiz      # inclui o próprio
//   node scripts/fecho-imports.mjs <módulo> --json          # o fecho como dados
//   node scripts/fecho-imports.mjs -h
//
//   Uso típico (o fixture de uma suíte de mutação, que roda o módulo COPIADO):
//     mapfile -t FECHO < <(node scripts/fecho-imports.mjs scripts/check-x.mjs)
//     for rel in "${FECHO[@]}"; do mkdir -p "$F/$(dirname "$rel")"; cp "$rel" "$F/$rel"; done
//
// Exit codes:
//   0 — o fecho foi derivado (os módulos saem um por linha, relativos à raiz)
//   1 — o fecho NÃO FECHA: uma aresta relativa não resolve, um bare de PACOTE
//       entrou no grafo, a entrada não existe (é o veredito — quem copia o fecho
//       não pode montar o fixture com um fecho incompleto)
//   2 — uso inválido (sem módulo, flag desconhecida, `--root` ausente)
//
// O DEFEITO QUE ELE FECHA (medido em 26/09/2026)
//
// Duas suítes de mutação (`test-mutation-doc-hashes.sh` e
// `test-mutation-act-origin.sh`) montam um fixture com o guard COPIADO e levavam
// os vizinhos por uma LISTA À MÃO (`FECHO_GUARD=(...)`). Quando um guard ganha uma
// aresta nova, a lista não sabe: o guard copiado morre com
// `ERR_MODULE_NOT_FOUND`, o `node` sai 1 — e o exit 1 do NODE passava por VEREDITO
// do guard (o controle de cada metade espera 1 de propósito). A bancada ficava
// vermelha por um motivo que não é o dela, ou pior: a mutação ficava "detectada"
// porque a cópia não carregava. Aconteceu de fato — o `--fix` das citações trouxe
// dois módulos novos, e a entrega do GERADO fez o `bench-table.mjs` (vizinho de
// SEGUNDO grau do `check-mutation-count.mjs`) importar o formatador do
// repositório. As listas foram corrigidas à mão naquele dia; a fragilidade
// continuou de pé, porque uma lista à mão envelhece sem aviso.
//
// A RÉGUA (uma só, e é por isso que o módulo existe): quem copia um módulo para
// um fixture DERIVA o fecho do próprio grafo de imports — a aresta é que diz o
// que a cópia precisa, e nunca uma lista paralela.
//
// O QUE ELE SEGUE: `import ... from "./x"`, `export ... from "./x"`,
// `import "./x"` (efeito), `import("./x")` com especificador LITERAL e
// `new URL("./x.mjs", import.meta.url)` — os relativos (`./`, `../`)
// transitivamente, preservando o CAMINHO relativo (um vizinho em `src/` é
// copiado para `src/`, como o importador o resolve).
//
// A forma `new URL("./x.mjs", ...)` não é decorativa: é como
// `scripts/pre-commit-remedy.mjs` referencia o guard vizinho, e era SÓ a régua
// local daquela prova que a via (regex de `from`/`new URL`) — o remédio de uma
// régua única passa a vê-la para TODO consumidor, inclusive a prova do pre-commit
// (que antes tinha a descida própria dela) e o fixture do recorte do pre-push.
//
// O QUE ELE RECUSA (fail-closed): aresta relativa que não resolve no checkout
// (não há cópia a fazer, e copiar menos é a bancada silenciosa que este módulo
// veio fechar) e bare de PACOTE — o fixture do fecho roda SEM `node_modules`, e
// um grafo que precise de pacote externo é uma montagem que não se sustenta.
// Builtins (`fs`, `node:fs`) são pulados: existem em qualquer lugar.
//
// A recusa do PACOTE tem uma saída DECLARADA (`permitirPacotes`): há fixture que
// roda COM `node_modules` (o do hook do `pre-commit`, que resolve o parser de
// YAML do repositório) — e quem declara isso mede os pacotes por outro caminho,
// nomeando-os (o `naoRelativos()` daquela prova). O default é o fail-closed: quem
// não declara continua recebendo o problema, em vez de um fecho que não fecha.
//
// LIMITES DECLARADOS (o que ele NÃO segue, e por quê):
//   - `import()` com especificador NÃO literal (o `await import(url)` do
//     `prettier-format.mjs`, que carrega o formatador do repositório): o alvo é
//     resolvido em tempo de execução, e o que o fixture tem de saber é que o
//     módulo DEGRADA com motivo quando o alvo falta — não que ele o carregue. O
//     caso fica NOMEADO em `adiados`, nunca em silêncio;
//   - a leitura não é um PARSER: comentários e literais ficam fora da conta, mas
//     uma regex que carregue aspa pode deslocar o scanner (o literal que não
//     fecha na mesma linha não é consumido, então o dano fica na linha). A
//     consequência seria uma aresta NÃO vista — e quem a pega é a execução: a
//     suíte que copia o fecho trata `ERR_MODULE_NOT_FOUND` como INFRA (exit 2),
//     jamais como veredito. A derivação é o caminho; a execução é a testemunha.
// =============================================================================

import { existsSync, readFileSync } from "node:fs"
import { builtinModules } from "node:module"
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import process from "node:process"
import { pathToFileURL } from "node:url"

/** Exit codes — o contrato da CLI. */
export const EXIT = { OK: 0, FECHO_ABERTO: 1, USO: 2 }

/** Os builtins do Node nas DUAS formas (`fs` e `node:fs`): nenhum é aresta. */
export const BUILTINS = new Set([...builtinModules, ...builtinModules.map((m) => `node:${m}`)])

/** O que faz dois caracteres serem o MESMO identificador. */
const IDENTIFICADOR = /[A-Za-z0-9_$]/

/**
 * O literal de string que começa na aspa em `i` — ou `null` quando ele não FECHA
 * na mesma linha.
 *
 * O JS não tem literal de string atravessando linha, então uma aspa que não
 * fecha é sinal de que o scanner está num lugar que ele não entende (uma regex
 * que carregue aspa, por exemplo). A resposta é NÃO consumir nada — devolver
 * `null` e deixar quem chamou andar UM caractere —, em vez de engolir código até
 * a próxima aspa.
 *
 * @param {string} texto
 * @param {number} i
 * @param {string} aspas
 * @returns {{valor: string, fim: number}|null}
 */
function lerString(texto, i, aspas) {
  let valor = ""
  let j = i + 1
  while (j < texto.length) {
    const c = texto[j]
    if (c === "\\") {
      valor += texto[j + 1] ?? ""
      j += 2
      continue
    }
    if (c === "\n") return null
    if (c === aspas) return { valor, fim: j + 1 }
    valor += c
    j += 1
  }
  return null
}

/**
 * O fim do TEMPLATE que começa no backtick em `i` (índice logo depois do
 * fechamento, ou o fim do texto).
 *
 * Dentro dele nada é aresta. `${ ... }` é tratado como TEXTO: uma interpolação
 * que importe é rara neste repositório, e reconstruir um parser para ela seria
 * medir o caso que não existe — o limite está declarado no cabeçalho.
 *
 * @param {string} texto
 * @param {number} i
 * @returns {number}
 */
function fimDoTemplate(texto, i) {
  let j = i + 1
  while (j < texto.length) {
    const c = texto[j]
    if (c === "\\") {
      j += 2
      continue
    }
    if (c === "`") return j + 1
    j += 1
  }
  return texto.length
}

/**
 * Se o token em `i` abre uma chamada `new URL(`, o índice do `(`; senão `-1`.
 *
 * Exige o `new` (só espaços entre os dois) porque `URL(...)` sem ele é outra
 * coisa, e o `(` logo depois (com espaços) porque é o que separa a CHAMADA do
 * nome `URL` citado em outro contexto.
 */
function abreNewURL(texto, i) {
  if (!ehPalavra(texto, i, "URL")) return -1
  let k = i - 1
  while (k >= 0 && /\s/.test(texto[k])) k -= 1
  if (k < 2 || !ehPalavra(texto, k - 2, "new")) return -1
  let j = i + 3
  while (j < texto.length && /\s/.test(texto[j])) j += 1
  return texto[j] === "(" ? j : -1
}

/** O token em `i` é a palavra `palavra`, inteira (não pedaço de identificador)? */
function ehPalavra(texto, i, palavra) {
  if (!texto.startsWith(palavra, i)) return false
  const antes = texto[i - 1]
  const depois = texto[i + palavra.length]
  if (antes !== undefined && IDENTIFICADOR.test(antes)) return false
  if (depois !== undefined && IDENTIFICADOR.test(depois)) return false
  return true
}

/**
 * As arestas de import de UM módulo — lidas do TEXTO, com comentários e
 * literais FORA da conta (um `from "./x.mjs"` dentro de uma string é DADO, não
 * aresta: é a mesma classe que o `check-no-leaked-imports` mascara).
 *
 * @param {string} texto
 * @returns {{arestas: {spec: string, linha: number, forma: string}[],
 *            adiados: {linha: number, motivo: string}[]}}
 */
export function lerModulo(texto) {
  const arestas = []
  const adiados = []
  /** A linha (1-based) da posição — calculada só quando há aresta a registrar. */
  const linhaDe = (pos) => texto.slice(0, pos).split("\n").length

  const lerSpec = (de, forma) => {
    if (texto[de] !== '"' && texto[de] !== "'") return null
    const lit = lerString(texto, de, texto[de])
    if (lit === null) return null
    arestas.push({ spec: lit.valor, linha: linhaDe(de), forma })
    return lit.fim
  }

  let i = 0
  while (i < texto.length) {
    const c = texto[i]
    if (c === "/" && texto[i + 1] === "/") {
      const fim = texto.indexOf("\n", i)
      i = fim === -1 ? texto.length : fim
      continue
    }
    if (c === "/" && texto[i + 1] === "*") {
      const fim = texto.indexOf("*/", i + 2)
      i = fim === -1 ? texto.length : fim + 2
      continue
    }
    if (c === '"' || c === "'") {
      const lit = lerString(texto, i, c)
      i = lit === null ? i + 1 : lit.fim
      continue
    }
    if (c === "`") {
      i = fimDoTemplate(texto, i)
      continue
    }
    const abreURL = abreNewURL(texto, i)
    if (abreURL !== -1) {
      // `new URL("./x", base)`: o primeiro argumento LITERAL é a aresta. Base
      // que não seja `import.meta.url` continua valendo — a construção de uma
      // URL relativa a um vizinho é a referência que o fixture precisa ter.
      let j = abreURL + 1
      while (j < texto.length && /\s/.test(texto[j])) j += 1
      const fim = lerSpec(j, "url")
      i = fim ?? j
      continue
    }
    if (ehPalavra(texto, i, "from") || ehPalavra(texto, i, "import")) {
      const palavra = texto.startsWith("from", i) ? "from" : "import"
      const forma = palavra === "from" ? "estático" : "import"
      let j = i + palavra.length
      while (j < texto.length && /\s/.test(texto[j])) j += 1
      if (palavra === "import" && texto[j] === "(") {
        j += 1
        while (j < texto.length && /\s/.test(texto[j])) j += 1
        const fim = lerSpec(j, "dinâmico")
        if (fim === null) {
          adiados.push({
            linha: linhaDe(i),
            motivo: "import() com especificador NÃO literal (resolvido em execução)",
          })
        }
        i = fim ?? j
        continue
      }
      const fim = lerSpec(j, forma)
      i = fim ?? j
      continue
    }
    i += 1
  }
  return { arestas, adiados }
}

/**
 * O fecho de imports de `entradas`, relativo à raiz.
 *
 * `permitirPacotes` é a DECLARAÇÃO de quem roda o fixture COM `node_modules`: o
 * bare de pacote deixa de ser problema (não é cópia a fazer, e quem o resolve é a
 * instalação) — o default segue fail-closed, como os fixtures da matriz.
 *
 * @param {string[]} entradas — módulos (absolutos, ou relativos à raiz)
 * @param {{root?: string, comRaiz?: boolean, permitirPacotes?: boolean,
 *          ler?: (caminho: string) => string}} [opts]
 * @returns {{fecho: string[], adiados: {modulo: string, linha: number, motivo: string}[],
 *            problemas: string[]}}
 */
export function fechoDeImports(
  entradas,
  {
    root = process.cwd(),
    comRaiz = false,
    permitirPacotes = false,
    ler = (caminho) => readFileSync(caminho, "utf8"),
  } = {},
) {
  const ordem = []
  const visto = new Set()
  const problemas = []
  const adiados = []
  const raizes = []

  const relativizar = (caminho) => relative(root, resolve(root, caminho)).split(sep).join("/")

  const anda = (rel, de, spec) => {
    if (visto.has(rel)) return
    visto.add(rel)
    ordem.push(rel)
    const absoluto = join(root, rel)
    if (!existsSync(absoluto)) {
      problemas.push(
        de === null
          ? `${rel} — ausente do checkout`
          : `${rel} — ausente do checkout (a aresta "${spec}" vem de ${de})`,
      )
      return
    }
    let texto
    try {
      texto = ler(absoluto)
    } catch (e) {
      problemas.push(`${rel} — ilegível: ${e?.message ?? e}`)
      return
    }
    const { arestas, adiados: naoLidas } = lerModulo(texto)
    for (const a of naoLidas) adiados.push({ modulo: rel, ...a })
    for (const { spec, linha } of arestas) {
      if (!spec.startsWith("./") && !spec.startsWith("../")) {
        if (BUILTINS.has(spec)) continue
        if (permitirPacotes) continue
        problemas.push(
          `${rel}:${linha} importa "${spec}" — bare de PACOTE: o fixture do fecho roda SEM node_modules`,
        )
        continue
      }
      const alvo = relativizar(join(dirname(rel), spec))
      if (alvo.startsWith("..")) {
        problemas.push(`${rel}:${linha} → "${spec}" sai da raiz ${root}`)
        continue
      }
      anda(alvo, `${rel}:${linha}`, spec)
    }
  }

  for (const entrada of entradas) {
    const rel = relativizar(entrada)
    if (rel.startsWith("..") || isAbsolute(rel)) {
      problemas.push(`${entrada} — fora da raiz ${root}`)
      continue
    }
    raizes.push(rel)
    anda(rel, null, null)
  }

  const fecho = comRaiz ? ordem : ordem.filter((rel) => !raizes.includes(rel))
  return { fecho, adiados, problemas }
}

const USAGE = `
 Uso: node scripts/fecho-imports.mjs <módulo> [<módulo>...] [--root <dir>] [--com-raiz] [--json]

   --root <dir>   a raiz de que os caminhos saem (default: o cwd)
   --com-raiz     inclui os próprios módulos de entrada no fecho
   --json         o fecho como dados (\`fecho\`, \`adiados\`, \`problemas\`)
   -h, --help     esta ajuda

 A RÉGUA: o fecho sai do GRAFO (as arestas do próprio módulo), nunca de uma lista
 à mão. Quem copia um módulo para um fixture copia o que o importador importa.
`

/**
 * A CLI. Um caminho por linha na saída PADRÃO (o que o shell consome); os
 * problemas vão para o ERRO — quem captura os dois (o fixture que deriva o
 * fecho) imprime o diagnóstico junto do exit, e quem captura só a saída padrão
 * nunca recebe caminho nenhum com veredito vermelho.
 */
function main() {
  const argv = process.argv.slice(2)
  if (argv.includes("-h") || argv.includes("--help")) {
    console.log(USAGE)
    process.exit(EXIT.OK)
  }
  const entradas = []
  const opts = { root: process.cwd(), comRaiz: false, json: false }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === "--root") {
      const dir = argv[i + 1]
      if (dir === undefined) {
        console.error(`❌ --root sem valor\n${USAGE}`)
        process.exit(EXIT.USO)
      }
      if (!existsSync(dir)) {
        console.error(`❌ --root não existe: ${dir}`)
        process.exit(EXIT.USO)
      }
      opts.root = resolve(dir)
      i += 1
      continue
    }
    if (a === "--com-raiz") {
      opts.comRaiz = true
      continue
    }
    if (a === "--json") {
      opts.json = true
      continue
    }
    if (a.startsWith("-")) {
      console.error(`❌ argumento inválido: ${a}\n${USAGE}`)
      process.exit(EXIT.USO)
    }
    entradas.push(a)
  }
  if (entradas.length === 0) {
    console.error(`❌ informe ao menos um módulo\n${USAGE}`)
    process.exit(EXIT.USO)
  }

  const { fecho, adiados, problemas } = fechoDeImports(entradas, opts)
  if (opts.json) {
    console.log(
      JSON.stringify(
        {
          raiz: opts.root,
          comRaiz: opts.comRaiz,
          fecho,
          adiados,
          problemas,
          ok: problemas.length === 0,
        },
        null,
        2,
      ),
    )
  } else if (problemas.length === 0) {
    for (const rel of fecho) console.log(rel)
  }
  if (problemas.length > 0) {
    if (!opts.json) {
      for (const p of problemas) console.error(`❌ fecho de imports ABERTO — ${p}`)
      console.error(
        "   (o fixture não pode ser montado com um fecho incompleto: ele rodaria o guard COPIADO e o exit 1 do NODE passaria por veredito — a aresta nova precisa resolver, ou o fixture precisa declarar por que não a leva)",
      )
    }
    process.exit(EXIT.FECHO_ABERTO)
  }
  process.exit(EXIT.OK)
}

// True apenas quando executado diretamente — permite importar as funções puras
// (o scanner e a derivação) sem disparar a CLI.
const IS_DIRECT_RUN =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (IS_DIRECT_RUN) main()
