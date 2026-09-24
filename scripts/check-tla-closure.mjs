#!/usr/bin/env node
// =============================================================================
// check-tla-closure.mjs — Guard da régua que só vivia em PROSA: nenhum módulo
// com top-level await pode ser ALCANÇÁVEL a partir de uma declaração (de classe
// ou de canal) do remédio.
// =============================================================================
//
// Usage:
//   node scripts/check-tla-closure.mjs
//   node scripts/check-tla-closure.mjs --root X   # fixture (testes/mutação)
//   node scripts/check-tla-closure.mjs --json     # payload estruturado
//   node scripts/check-tla-closure.mjs --trace    # onde a régua mordeu (linha)
//   node scripts/check-tla-closure.mjs -h
//
// Exit codes:
//   0 — nenhuma declaração alcança módulo com TLA e o conjunto TLA derivado é o
//       DECLARADO (as duas metades verdes) ✅
//   1 — violação: uma declaração alcança um TLA (com a CADEIA nomeada e o
//       veredito de ciclo), ou o conjunto TLA derivado divergiu do declarado ❌
//   2 — infra: não deu para MEDIR (diretório ilegível, loader ausente, JSON
//       inválido) — fail-closed: "não consegui julgar" nunca vira verde
//
// A RÉGUA. O remédio do pre-commit carrega as suas declarações por `await
// import()` (a descoberta é assíncrona por natureza): `remedy-classes.mjs`
// importa `remedy-classes/<id>.mjs` e `pr-fixers.mjs` importa
// `remedy-canal/<id>.mjs`. Se QUALQUER módulo alcançável por import ESTÁTICO a
// partir de uma dessas declarações tiver top-level await, o carregamento fecha
// um ciclo entre módulos ASSÍNCRONOS. A régua estava escrita na prosa de
// `docs/GUARDS.md` (seção do canal do remédio), no cabeçalho do
// `scripts/remedy-canal.mjs` e no do `scripts/pr-fixers.mjs` — três parágrafos
// que um commit novo não é obrigado a ler. Aqui ela vira veredito.
//
// O FATO MEDIDO (por execução, não por leitura — 21/09/2026). Injetando
// `import "../pr-fixers.mjs"` numa declaração REAL de classe:
//
//   node -e 'await import("./scripts/remedy-classes.mjs")'  → rc=13, ZERO bytes
//   node scripts/pre-commit-remedy.mjs                      → rc=13, stdout 0B
//                                                             stderr 0B
//
// Ou seja: o hook morre em SILÊNCIO — a fase A do pre-commit é justamente quem
// oferece o remédio, e ela deixa de rodar sem imprimir nada. É essa morte muda
// que a régua existe para impedir. (`unsettled top-level await` só aparece com
// `--trace-*`; o operador vê o hook falhar sem causa.)
//
// O QUE É CONSERVADOR DE PROPÓSITO (medido). O que mata é o CICLO. Um TLA
// alcançável que NÃO volta ao loader carrega normal:
//
//   import "../check-env-mirror.mjs"  (TLA, sem aresta de volta) → rc=0
//   import "../pr-fixers.mjs"         (TLA, com aresta de volta) → rc=13
//
// A régua RECUSA os dois (é a forma escrita na prosa: "nenhum módulo com TLA pode
// ser alcançável"), e o veredito NOMEIA qual dos dois é o caso — a diferença
// entre eles é UMA aresta que ninguém revisa: a próxima importação dentro do
// módulo TLA fecha o ciclo, e é o commit seguinte que paga. Recusar o caso ainda
// são custa uma decisão declarada; deixar o fatal passar custa o hook.
//
// A CATRACA (a segunda metade, e a que impede a régua de cegar em silêncio). Se
// nenhuma declaração alcança TLA, a metade acima tem ZERO achados hoje — e uma
// régua sem achado não prova que ela ainda VÊ. Por isso o conjunto de módulos
// com TLA em `scripts/` é DERIVADO a cada rodada e classificado contra as
// classes de `TLA_CLASSES` (abaixo), nos DOIS sentidos: um módulo TLA em forma
// não declarada é violação, e um declarado que a régua deixou de ver (a
// detecção cegou) também. Um TLA nasce de um `if (IS_DIRECT_RUN) await main()`
// copiado — e quem o copia não lê esta régua; aqui ele passa pela classe, e o
// que NÃO for o padrão é obrigado a ser declarado por nome, com o motivo.
//
// LIMITES DECLARADOS (o que a régua NÃO vê, dito para não virar verde por
// omissão):
//   - o grafo segue imports ESTÁTICOS (`import ... from`, `import "..."`,
//     `export ... from`). `import()` DINÂMICO (com literal ou não) não é
//     seguido: ele é preguiçoso por construção — quem o executa já está num
//     corpo de função — e o caso que interessa (o `await import()` da própria
//     descoberta) está do outro lado, na carga da declaração.
//   - a detecção de TLA é LÉXICA (sem parser): um `await` de nível de módulo é
//     `await` fora de um corpo de função/classe, reconhecido por CHAVES + a
//     forma da cabeça do bloco (`=>`, `function`, `class`, método) e pelo `=>`
//     que precede o `await` (arrow de expressão). Um `await` de topo escondido
//     atrás de uma forma que a régua não conhece seria um falso NEGATIVO — e é
//     por isso que as CLASSES DECLARADAS são a segunda metade: um declarado que
//     a régua deixa de ver é violação, não silêncio.
//   - só caminhos RELATIVOS são seguidos (`.`, `..`). Um specifier BARE
//     (builtin do node ou pacote) é folha: ele não pode importar de volta um
//     módulo do repositório, então não fecha este ciclo.
//   - um specifier relativo que não resolve para arquivo existente é CONTADO no
//     relatório (nunca presumido existente nem presumido importável).
// =============================================================================

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { basename, dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { maskStrings, stringRanges, stripComments } from "./check-no-leaked-imports.mjs"
import { CANAL_DIR, SUFIXO } from "./remedy-canal.mjs"

/** O diretório das declarações de CLASSE — o irmão do diretório do canal. */
export const CLASSES_DIR = join(dirname(CANAL_DIR), "remedy-classes")

// Os NOMES dos diretórios vêm do leitor folha (`remedy-canal.mjs` é quem declara
// onde as declarações do canal moram): o guard monta os caminhos a partir do
// `--root` para poder julgar um FIXTURE, mas o nome de cada diretório é derivado
// — não uma segunda declaração do caminho.
const NOME_DIR_SCRIPTS = basename(dirname(CANAL_DIR))
const NOME_DIR_CANAL = basename(CANAL_DIR)
const NOME_DIR_CLASSES = basename(CLASSES_DIR)

/** O carregador (loader) das classes, relativo à raiz: quem faz `await import()` de cada declaração. */
export const LOADER_CLASSES = join(NOME_DIR_SCRIPTS, "remedy-classes.mjs")

/** O carregador (loader) do canal, relativo à raiz: a DESCOBERTA dos fixers. */
export const LOADER_CANAL = join(NOME_DIR_SCRIPTS, "pr-fixers.mjs")

/**
 * Os nomes que o repositório usa para o guard de ENTRADA direta — as duas formas
 * vivas hoje (`if (IS_DIRECT_RUN) …` e `const isMain = …; if (isMain) …`), mais
 * os dois equivalentes do runtime do node. É o que separa "o módulo só executa
 * quando é o arquivo chamado" de "o módulo executa na CARGA".
 */
export const GUARDS_DE_ENTRADA = /(?:IS_DIRECT_RUN|isMain|import\.meta\.main|process\.argv\[1\])/

/**
 * AS CLASSES DE TOP-LEVEL AWAIT QUE O REPOSITÓRIO ACEITA. A classificação é
 * DERIVADA (a forma do `await` em cada módulo decide) e comparada com esta
 * tabela nos DOIS sentidos: um módulo que não caia em classe nenhuma é
 * violação, e um `declarados` que a régua deixou de ver também (a segunda
 * direção é a que denuncia uma detecção que cegou).
 *
 * POR QUE UMA TABELA DE CLASSES, e não de 27 módulos à mão: 23 dos 27 são o
 * MESMO padrão (entrada de CLI) e entram nele por derivação — uma lista à mão
 * deles envelheceria a cada script novo. O que exige DECLARAÇÃO nomeada é o que
 * não é padrão: as duas descobertas (async por natureza) e os dois módulos que
 * EXECUTAM na carga.
 *
 * @type {{id: string, motivo: string, declarados?: string[]}[]}
 */
export const TLA_CLASSES = [
  {
    id: "entrada-cli",
    motivo:
      "o `await` está atrás do guard de ENTRADA (`if (IS_DIRECT_RUN) …` ou `if (isMain) { … }`): o módulo só executa quando é o arquivo chamado. CLASSE DERIVADA: um módulo novo com esta forma entra nela sem editar a régua — o risco dele é o ALCANCE, e o alcance é a primeira metade deste guard.",
  },
  {
    id: "descoberta",
    motivo:
      "a DESCOBERTA do remédio — `await import()` de caminhos que só existem em runtime (as declarações de `remedy-classes/` e as de `remedy-canal/`): avaliação assíncrona por natureza, e o par que FECHA CICLO com uma declaração",
    declarados: ["scripts/remedy-classes.mjs", "scripts/pr-fixers.mjs"],
  },
  {
    id: "carga",
    motivo:
      "o módulo EXECUTA na CARGA: o `await` de nível de módulo NÃO está atrás de guard de entrada nenhum. Entra por DECLARAÇÃO nomeada de propósito — é esta a forma que paga o ciclo (exit 13, ZERO bytes) no dia em que for alcançável de uma declaração, e quem a cria tem de dizer que a criou.",
    declarados: ["scripts/apply-required-checks.mjs", "scripts/rotate-secrets.mjs"],
  },
]

/**
 * OS ALCANCES DECLARADOS — a dívida, nomeada e datada. A régua recusa QUALQUER
 * TLA alcançável de uma declaração (é a forma escrita na prosa), e uma recusa
 * que o repositório decide CONVIVER tem de estar aqui, com motivo e data: o
 * par (declaração → módulo com TLA) que não fecha ciclo HOJE não mata (medido:
 * rc=0) e mata no dia em que uma aresta de volta ao loader aparecer dentro
 * dele — e ninguém revisa essa aresta.
 *
 * O par é (declaração, módulo alcançado), e não o módulo sozinho, de propósito:
 * uma aresta NOVA a partir de outra declaração é um caso novo e tem de ser
 * declarada. E a declaração envelhece como as outras do repositório: se o
 * alcance sumir (a importação saiu ou o módulo deixou de ser TLA), ela vira
 * violação — dívida paga não fica no papel.
 *
 * @type {{de: string, para: string, motivo: string, data: string}[]}
 */
export const ALCANCE_DECLARADO = [
  {
    de: "scripts/remedy-classes/hook-commands.mjs",
    para: "scripts/runner-shells.mjs",
    motivo:
      "o guard dono da classe (`check-hook-commands.mjs`) fala com o `runner-shells` para saber quais shells o runner tem; o TLA do `runner-shells` é de ENTRADA (`if (IS_DIRECT_RUN) { … await main() }`) e não volta ao loader — medido rc=0 ao carregar a descoberta",
    data: "2026-09-21",
  },
  {
    de: "scripts/remedy-classes/run-syntax.mjs",
    para: "scripts/runner-shells.mjs",
    motivo:
      "mesma cadeia pelo dono da classe de sintaxe (`check-workflow-run-syntax.mjs`): o TLA do `runner-shells` é de entrada e não fecha ciclo",
    data: "2026-09-21",
  },
  {
    de: "scripts/remedy-classes/doc-hashes.mjs",
    para: "scripts/check-doc-hashes.mjs",
    motivo:
      "a classe IMPORTA o `fixAll` do guard dono (a régua do remendo é uma só) e o TLA do guard é de ENTRADA (`if (IS_DIRECT_RUN) { … await confirma() }`, uma única ocorrência classificada `entrada-cli`): a carga da declaração NÃO executa o CLI — medido rc=0 ao carregar a descoberta — e nenhuma aresta de volta ao loader existe hoje; a régua recusa o caso conservador de propósito",
    data: "2026-09-22",
  },
]

/** As extensões que o node CARREGA de fato e que a resolução tenta, em ordem. */
export const EXTENSOES = ["", ".mjs", ".js", ".cjs", "/index.mjs", "/index.js"]

/** As palavras que a cabeça de um bloco pode ter e NÃO ser corpo de função. */
const PALAVRAS_DE_BLOCO = new Set([
  "if",
  "else",
  "for",
  "while",
  "do",
  "switch",
  "try",
  "catch",
  "finally",
  "with",
  "case",
  "default",
  "return",
  "typeof",
  "delete",
  "void",
  "in",
  "of",
  "new",
  "await",
  "yield",
  "throw",
  "var",
  "let",
  "const",
  "import",
  "export",
  "from",
  "as",
])

/**
 * O fonte SEM comentários e com as strings MASCARADAS — as duas réguas do
 * `check-no-leaked-imports.mjs`, a MESMA que o resto do repositório usa (uma
 * régua, um lugar): sem os comentários, um `await`/`import` citado em doc não
 * conta; com as strings mascaradas, um `await` dentro de um texto (SQL, fixture,
 * mensagem) não vira veredito. Aquele módulo é node-puro (só builtins), então
 * importá-lo não põe dependência no caminho deste guard.
 *
 * @param {string} src
 * @returns {string}
 */
export function semComentarioNemString(src) {
  return maskStrings(stripComments(src))
}

/**
 * A CABEÇA de um bloco é corpo de FUNÇÃO/CLASSE? Decide se um `{` abre um corpo
 * onde `await` é legítimo (async function/método) ou um BLOCO de instrução
 * transparente (`if`, `for`, `try`, objeto literal) — onde um `await` de nível
 * de módulo continua sendo TLA.
 *
 * Um `function f() { await x }` sem `async` nem sequer compila, então tratar
 * toda cabeça de função como "dentro de função" é seguro.
 *
 * O CRITÉRIO NÃO É A FORMA DA CABEÇA (que pode chegar mutilada aqui) e sim a
 * PALAVRA antes do `(` que casa com o `)` final: `f(` é função, `if (`/`for (`/
 * `while (`/`catch (`/`switch (` é bloco. A diferença não é cosmética — um bloco
 * de instrução é TRANSPARENTE para a régua (um `await` dentro de um `if` de
 * nível de módulo É top-level await: `if (IS_DIRECT_RUN) { … await main() }`),
 * e foi essa classe que o `scripts/runner-shells.mjs` usa de verdade.
 *
 * @param {string} cabeca o texto entre o último separador de nível 0 e o `{`
 * @returns {boolean}
 */
export function cabecaEhCorpoDeFuncao(cabeca) {
  const h = cabeca.replace(/\s+$/, "")
  if (h === "") return false
  if (/=>$/.test(h)) return true
  if (/\b(function|class)\b/.test(h)) return true
  if (!h.endsWith(")")) return false
  // A cabeça pode ser um FRAGMENTO: um `{` de padrão desestruturado dentro dos
  // parênteses (`function f({ token }, a, b) {`) RESETA o segmento, e o corpo
  // chega como `, a, b) `. Contar do fim para trás até o `(` que casa é o que
  // sobrevive a isso — a palavra imediatamente antes do parêntese é a que diz se
  // o bloco é de FUNÇÃO (`f(`) ou de INSTRUÇÃO (`if (`, `for (`, `catch (`).
  let prof = 0
  let i = h.length - 1
  for (; i >= 0; i--) {
    const c = h[i]
    if (c === ")") prof++
    else if (c === "(") {
      prof--
      if (prof === 0) break
    }
  }
  if (i <= 0) return false // `(` sem nada antes: bloco, IIFE sem `=>` ou literal
  const palavra = (h.slice(0, i).match(/([\w$]+)\s*$/) ?? [])[1] ?? ""
  if (palavra === "") return false
  return !PALAVRAS_DE_BLOCO.has(palavra)
}

/**
 * O módulo tem TOP-LEVEL AWAIT? (detecção léxica, com os limites declarados no
 * cabeçalho: formas que a régua não conhece seriam falso NEGATIVO, e por isso a
 * tabela `TLA_DECLARADOS` é comparada nos dois sentidos.)
 *
 * @param {string} src
 * @returns {boolean}
 */
export function temTLA(src) {
  return ocorrenciasTLA(src).length > 0
}

/**
 * ONDE a régua mordeu: uma ocorrência por `await` de nível de módulo, com a
 * linha e um trecho do que vem ANTES — é o que o `--trace` imprime e o que os
 * testes comparam, para o veredito não ser um booleano sem lastro.
 *
 * @param {string} src
 * @returns {{indice: number, linha: number, antes: string, entrada: boolean}[]}
 */
export function ocorrenciasTLA(src) {
  const code = semComentarioNemString(src)
  const achados = []
  /** @type {("funcao"|"bloco")[]} */
  const pilha = []
  let paren = 0
  let bracket = 0
  // DOIS CURSORES, de propósito: `segStart` (o do trecho de INSTRUÇÃO) reseta a
  // cada linha, e é ele que responde "há um `=>` antes deste await?".
  // `cabecaStart` (o da CABEÇA do bloco) NÃO reseta em linha nova — uma
  // assinatura multi-linha (prettier: `}) {`) deixaria o `(` de fora do trecho e
  // a função viraria "bloco", contando os `await` do corpo como TLA.
  let segStart = 0
  let cabecaStart = 0
  let segInicioLinha = 0
  for (let i = 0; i < code.length; i++) {
    const c = code[i]
    if (c === "\n") {
      segStart = i + 1
      segInicioLinha = i + 1
      continue
    }
    if (c === "(") {
      paren++
      continue
    }
    if (c === ")") {
      paren = Math.max(0, paren - 1)
      continue
    }
    if (c === "[") {
      bracket++
      continue
    }
    if (c === "]") {
      bracket = Math.max(0, bracket - 1)
      continue
    }
    if (c === "{") {
      // O `{` de DENTRO dos parênteses/colchetes é literal de objeto ou padrão
      // desestruturado (`function f({ token }, a) {`): ele NÃO reseta a cabeça —
      // se resetasse, o corpo da função chegava aqui como o fragmento
      // `, a) ` e um `await` legitimamente dentro da função era lido como TLA
      // (medido: 27 acusações falsas antes desta linha).
      const cabeca = code.slice(cabecaStart, i)
      pilha.push({
        tipo: cabecaEhCorpoDeFuncao(cabeca) ? "funcao" : "bloco",
        // O bloco é o GUARD DE ENTRADA? É o que a classificação do achado lê.
        entrada: GUARDS_DE_ENTRADA.test(cabeca),
      })
      if (paren === 0 && bracket === 0) {
        segStart = i + 1
        cabecaStart = i + 1
      }
      continue
    }
    if (c === "}") {
      pilha.pop()
      if (paren === 0 && bracket === 0) {
        segStart = i + 1
        cabecaStart = i + 1
      }
      continue
    }
    if (c === ";") {
      segStart = i + 1
      cabecaStart = i + 1
      continue
    }
    if (pilha.some((f) => f.tipo === "funcao")) continue
    if (c !== "a" || !code.startsWith("await", i)) continue
    if (/[\w$.]/.test(code[i - 1] ?? " ")) continue
    if (/[\w$]/.test(code[i + 5] ?? " ")) continue
    // arrow de EXPRESSÃO (`=> await x`) não é TLA — nem na mesma linha nem numa
    // quebra de linha logo depois do `=>`.
    if (code.slice(segStart, i).includes("=>")) continue
    const linhaAnterior = code
      .slice(0, segInicioLinha)
      .split("\n")
      .filter((l) => l.trim() !== "")
      .pop()
    if (linhaAnterior !== undefined && /=>\s*$/.test(linhaAnterior)) continue
    achados.push({
      indice: i,
      linha: code.slice(0, i).split("\n").length,
      antes: code.slice(Math.max(0, i - 100), i).replace(/\s+/g, " "),
      // O achado está atrás do guard de entrada? Ou por um BLOCO que o guarda
      // (`if (isMain) { … }`) ou na própria instrução (`if (IS_DIRECT_RUN) await …`).
      entrada: pilha.some((f) => f.entrada) || GUARDS_DE_ENTRADA.test(code.slice(segStart, i)),
    })
  }
  return achados
}

/**
 * Os specifiers de módulo de um arquivo, com o tipo: `estatico` (o grafo de
 * carga) ou `dinamico` (`import()`, preguiçoso). O `import`/`export`/`from` é
 * buscado FORA das strings — o literal é a string, a âncora não pode estar
 * dentro de uma.
 *
 * @param {string} src
 * @returns {{spec: string, tipo: "estatico"|"dinamico"}[]}
 */
export function specsDoModulo(src) {
  const code = stripComments(src)
  const ranges = stringRanges(code)
  const dentroDeString = (pos) => ranges.some(([a, b]) => pos >= a && pos < b)
  const out = []
  for (const [a, b] of ranges) {
    if (dentroDeString(a - 1)) continue
    const antes = code.slice(Math.max(0, a - 400), a)
    let tipo = null
    if (/import\s*\(\s*$/.test(antes)) tipo = "dinamico"
    else if (/import\s*$/.test(antes)) tipo = "estatico"
    else if (/\bfrom\s*$/.test(antes)) tipo = "estatico"
    if (!tipo) continue
    const spec = code.slice(a + 1, b - 1)
    if (spec.includes("\n")) continue
    out.push({ spec, tipo })
  }
  return out
}

/**
 * Resolve um specifier RELATIVO para um arquivo que o node carrega. `null` para
 * bare (folha do grafo) e para o que não existe (contado no relatório).
 *
 * @param {string} importer caminho absoluto do arquivo que importa
 * @param {string} spec
 * @returns {string|null}
 */
export function resolverLocal(importer, spec) {
  if (!spec.startsWith(".")) return null
  const base = resolve(dirname(importer), spec)
  for (const ext of EXTENSOES) {
    const p = base + ext
    // Só ARQUIVO: um specifier que resolve para um DIRETÓRIO não é módulo — o
    // node procura o `index` (a extensão anterior na lista), e tratar o
    // diretório como alvo faria o fecho ler um diretório e PARAR em silêncio.
    if (ehArquivo(p)) return p
  }
  return null
}

/**
 * O caminho é um ARQUIVO comum (não diretório, não socket)?
 *
 * @param {string} p
 * @returns {boolean}
 */
function ehArquivo(p) {
  try {
    return statSync(p).isFile()
  } catch {
    return false
  }
}

/**
 * O FECHO ESTÁTICO de um módulo: os arquivos alcançáveis por import estático
 * (inclui a própria entrada) + o mapa de pais, para a cadeia de cada achado.
 *
 * @param {string} entrada caminho absoluto
 * @returns {{arquivos: string[], pais: Map<string, string>, naoResolvidos: string[]}}
 */
export function fechoEstatico(entrada) {
  const arquivos = [entrada]
  const vistos = new Set([entrada])
  const pais = new Map()
  const naoResolvidos = []
  const pilha = [entrada]
  while (pilha.length > 0) {
    const atual = pilha.pop()
    let src
    try {
      src = readFileSync(atual, "utf8")
    } catch {
      continue // ilegível: o fecho para aqui; quem acusa é o `julgar` (fail-closed)
    }
    for (const { spec, tipo } of specsDoModulo(src)) {
      if (tipo !== "estatico") continue
      if (!spec.startsWith(".")) continue
      const alvo = resolverLocal(atual, spec)
      if (alvo === null) {
        naoResolvidos.push(`${relative(process.cwd(), atual)} → ${spec}`)
        continue
      }
      if (vistos.has(alvo)) continue
      vistos.add(alvo)
      pais.set(alvo, atual)
      arquivos.push(alvo)
      pilha.push(alvo)
    }
  }
  return { arquivos, pais, naoResolvidos }
}

/**
 * A CADEIA de uma entrada até um módulo, pelo mapa de pais.
 *
 * @param {Map<string, string>} pais
 * @param {string} alvo
 * @returns {string[]}
 */
export function cadeiaDe(pais, alvo) {
  const caminho = [alvo]
  let atual = alvo
  while (pais.has(atual)) {
    atual = pais.get(atual)
    caminho.unshift(atual)
  }
  return caminho
}

/**
 * As declarações do remédio: as de CLASSE (uma por arquivo de
 * `remedy-classes/`) e as de CANAL (`remedy-canal/`, pelo leitor folha). Cada
 * uma com o seu LOADER — quem a carrega por `await import()`.
 *
 * @param {{root: string}} opts
 * @returns {{declaracoes: {tipo: "classe"|"canal", id: string, arquivo: string, loader: string}[], problemas: string[]}}
 */
export function declaracoesDoRemedio({ root }) {
  const problemas = []
  const declaracoes = []
  const dirs = [
    {
      tipo: /** @type {"classe"} */ ("classe"),
      dir: join(root, NOME_DIR_SCRIPTS, NOME_DIR_CLASSES),
    },
    { tipo: /** @type {"canal"} */ ("canal"), dir: join(root, NOME_DIR_SCRIPTS, NOME_DIR_CANAL) },
  ]
  for (const { tipo, dir } of dirs) {
    let arquivos
    try {
      arquivos = readdirSync(dir)
        .filter((f) => f.endsWith(SUFIXO))
        .sort()
    } catch (e) {
      problemas.push(
        `${relative(root, dir)}: não consegui listar as declarações (${e?.message ?? e})`,
      )
      continue
    }
    if (arquivos.length === 0) {
      problemas.push(
        `${relative(root, dir)}: nenhuma declaração (*${SUFIXO}) — o canal/ofertão vazio não é "nada a julgar"`,
      )
      continue
    }
    for (const arquivo of arquivos) {
      const loader = join(root, tipo === "classe" ? LOADER_CLASSES : LOADER_CANAL)
      declaracoes.push({
        tipo,
        id: arquivo.slice(0, -SUFIXO.length),
        arquivo: join(dir, arquivo),
        loader,
      })
    }
  }
  return { declaracoes, problemas }
}

/**
 * Os módulos com TLA sob um diretório (recursivo, fora de `node_modules`). O
 * valor do mapa são as OCORRÊNCIAS (onde a régua mordeu), e não um booleano:
 * um veredito que não diz ONDE mordeu é um relatório, não uma medição.
 *
 * @param {{root: string, dir: string}} opts
 * @returns {{modulos: Map<string, {indice: number, linha: number, antes: string}[]>, problemas: string[]}}
 */
export function modulosComTLA({ root, dir }) {
  const modulos = new Map()
  const problemas = []
  const andar = (d) => {
    let entradas
    try {
      entradas = readdirSync(d, { withFileTypes: true })
    } catch (e) {
      problemas.push(`${relative(root, d)}: não consegui listar (${e?.message ?? e})`)
      return
    }
    for (const e of entradas) {
      if (e.name === "node_modules" || e.name === ".git") continue
      const p = join(d, e.name)
      if (e.isDirectory()) {
        andar(p)
        continue
      }
      if (!/\.(mjs|cjs|js)$/.test(e.name)) continue
      let src
      try {
        src = readFileSync(p, "utf8")
      } catch (err) {
        problemas.push(`${relative(root, p)}: não consegui ler (${err?.message ?? err})`)
        continue
      }
      const achados = ocorrenciasTLA(src)
      if (achados.length > 0) modulos.set(p, achados)
    }
  }
  andar(dir)
  return { modulos, problemas }
}

/**
 * O JULGAMENTO inteiro: as duas metades (o alcance a partir das declarações e a
 * catraca do conjunto TLA).
 *
 * As duas tabelas são INJETÁVEIS (`classes`, `alcance`) porque as duas metades
 * são julgadas contra árvores de FIXTURE nos testes — e uma fixture que
 * precisasse das tabelas reais do repositório mediria a árvore, não a régua.
 *
 * @param {{root: string, classes?: {id: string, motivo: string, declarados?: string[]}[], alcance?: {de: string, para: string, motivo: string, data: string}[]}} opts
 * @returns {{
 *   declaracoes: {tipo: string, id: string, arquivo: string, loader: string, fecho: number, alcancados: {caminho: string, cadeia: string[], fechaCiclo: boolean, loaderCaminho: string|null}[]}[],
 *   tlaDerivado: string[],
 *   tlaDeclarado: string[],
 *   classes: {caminho: string, classe: string|null, achados: {indice: number, linha: number, antes: string}[]}[],
 *   naoResolvidos: string[],
 *   violacoes: string[],
 *   problemas: string[],
 *   tolerados: {de: string, para: string}[],
 *   classesTabela: {id: string, motivo: string, declarados?: string[]}[],
 *   alcanceTabela: {de: string, para: string, motivo: string, data: string}[],
 *   root: string,
 * }}
 */
export function julgar({ root, classes = TLA_CLASSES, alcance = ALCANCE_DECLARADO }) {
  const rel = (p) => relative(root, p).split("\\").join("/")
  const violacoes = []
  const problemas = []

  const { declaracoes, problemas: pDecl } = declaracoesDoRemedio({ root })
  problemas.push(...pDecl)

  const { modulos, problemas: pScan } = modulosComTLA({
    root,
    dir: join(root, NOME_DIR_SCRIPTS),
  })

  problemas.push(...pScan)

  const naoResolvidos = []
  const tolerados = []
  const julgadas = []
  for (const d of declaracoes) {
    if (!existsSync(d.loader)) {
      problemas.push(
        `${rel(d.loader)}: o LOADER da declaração '${d.id}' não existe — sem ele não há ciclo a medir (fail-closed)`,
      )
      continue
    }
    const { arquivos, pais, naoResolvidos: nr } = fechoEstatico(d.arquivo)
    if (!existsSync(d.arquivo)) {
      problemas.push(`${rel(d.arquivo)}: declaração ilegível (fail-closed)`)
      continue
    }
    naoResolvidos.push(...nr)
    const alcancados = []
    for (const arquivo of arquivos) {
      if (arquivo === d.arquivo) continue
      if (!modulos.has(arquivo)) continue
      // Fecha CICLO? a aresta de volta: o TLA alcança o loader (que está
      // esperando esta declaração) — ou é o próprio loader.
      const fechoDoTla = arquivo === d.loader ? { arquivos: [d.loader] } : fechoEstatico(arquivo)
      const fechaCiclo = arquivo === d.loader || fechoDoTla.arquivos.includes(d.loader)
      alcancados.push({
        caminho: rel(arquivo),
        cadeia: cadeiaDe(pais, arquivo).map(rel),
        fechaCiclo,
        loaderCaminho: rel(d.loader),
      })
    }
    for (const a of alcancados) {
      const par = { de: rel(d.arquivo), para: a.caminho }
      const tolerado = alcance.some((t) => t.de === par.de && t.para === par.para)
      a.tolerado = tolerado
      if (tolerado) {
        tolerados.push(par)
        continue
      }
      violacoes.push(
        `ALCANCE: a declaração de ${d.tipo} '${d.id}' (${rel(d.arquivo)}) alcança ${a.caminho}, que tem top-level await\n` +
          `           cadeia: ${a.cadeia.join(" → ")}\n` +
          `           ${a.fechaCiclo ? `CICLO FECHADO com ${a.loaderCaminho} (que carrega esta declaração por await import()): o node sai 13 SEM IMPRIMIR NADA — este é o caso que a régua existe para impedir` : `o TLA ainda NÃO volta para ${a.loaderCaminho}: não mata hoje (medido rc=0). A régua o recusa porque a próxima aresta dentro dele fecha o ciclo — se a convivência for deliberada, declare o par em ALCANCE_DECLARADO com motivo e data`}`,
      )
    }
    julgadas.push({
      tipo: d.tipo,
      id: d.id,
      arquivo: rel(d.arquivo),
      loader: rel(d.loader),
      fecho: arquivos.length,
      alcancados,
    })
  }

  // ── A CATRACA: cada módulo com TLA tem de cair numa CLASSE declarada ─────
  const declaradaDe = (caminho) =>
    classes.find((c) => (c.declarados ?? []).includes(caminho))?.id ?? null
  const classificados = []
  for (const [caminhoAbs, achados] of modulos) {
    const caminho = rel(caminhoAbs)
    // A classe DERIVADA: todos os achados atrás do guard de entrada.
    const derivada = achados.every((a) => a.entrada) ? "entrada-cli" : null
    const declarada = declaradaDe(caminho)
    classificados.push({ caminho, classe: derivada ?? declarada, derivada, declarada, achados })
    if (declarada !== null && derivada !== null && declarada !== derivada) {
      violacoes.push(
        `CATRACA: ${caminho} está declarado como '${declarada}' e a régua o classifica como '${derivada}' — a forma do await MUDOU: ou o guard de entrada entrou (tire a declaração) ou saiu (a declaração tem de dizer por quê)`,
      )
    }
    if (declarada === null && derivada === null) {
      const onde = achados.map((a) => `linha ${a.linha}: …${a.antes}⟨await⟩`).join(" | ")
      violacoes.push(
        `CATRACA: ${caminho} tem top-level await em uma forma NÃO declarada — nem 'entrada-cli' (nenhum dos achados está atrás de um guard de entrada) nem as classes declaradas por nome. Achados: ${onde}\n` +
          `           Declare-o em TLA_CLASSES com o motivo (e diga POR QUE a carga o justifica), ou tire o await do topo. Um módulo TLA que seja alcançável de uma declaração mata o hook — e o alcance muda num commit que não é este.`,
      )
    }
  }
  // E a direção contrária: um declarado que a régua deixou de ver.
  for (const classe of classes) {
    for (const declarado of classe.declarados ?? []) {
      if (!modulos.has(join(root, declarado))) {
        violacoes.push(
          `CATRACA: ${declarado} está declarado como '${classe.id}' e a régua NÃO o vê como TLA — ou o await saiu (atualize a tabela) ou a DETECÇÃO cegou (é o caso que esta metade existe para não deixar passar em silêncio)`,
        )
      }
    }
  }
  // A direção contrária da dívida: uma declaração de ALCANCE que não descreve
  // mais nada (a aresta saiu, ou o módulo deixou de ser TLA) é dívida paga no
  // papel — e o papel tem de acompanhar.
  for (const t of alcance) {
    const ainda = tolerados.some((p) => p.de === t.de && p.para === t.para)
    if (!ainda) {
      violacoes.push(
        `ALCANCE DECLARADO: o par '${t.de} → ${t.para}' está declarado (${t.data}) e o alcance NÃO existe mais — ou a importação saiu, ou o módulo deixou de ser TLA: tire a declaração (dívida paga não fica no papel)`,
      )
    }
  }

  const tlaDerivado = [...modulos.keys()].map(rel).sort()
  const tlaDeclarado = classes.flatMap((c) => c.declarados ?? []).sort()

  return {
    root,
    declaracoes: julgadas,
    tlaDerivado,
    tlaDeclarado,
    tolerados,
    classesTabela: classes,
    alcanceTabela: alcance,
    classes: classificados.map(({ caminho, classe, achados }) => ({
      caminho,
      classe,
      achados,
    })),
    ocorrencias: [...modulos.entries()].map(([p, a]) => [rel(p), a]),
    naoResolvidos,
    violacoes,
    problemas,
  }
}

/**
 * O relatório em texto (o que o CI e o operador leem).
 *
 * @param {ReturnType<typeof julgar>} r
 * @returns {string}
 */
export function renderRelatorio(r) {
  const linhas = []
  linhas.push(
    `check-tla-closure: ${r.declaracoes.length} declaração(ões) do remédio · ${r.tlaDerivado.length} módulo(s) com TLA em scripts/`,
  )
  const porTipo = (tipo) => r.declaracoes.filter((d) => d.tipo === tipo)
  for (const tipo of ["classe", "canal"]) {
    for (const d of porTipo(tipo)) {
      const marca =
        d.alcancados.length === 0 ? "✅" : d.alcancados.every((a) => a.tolerado) ? "⚠️ " : "❌"
      const detalhe =
        d.alcancados.length === 0
          ? "nenhum TLA alcançado"
          : d.alcancados.every((a) => a.tolerado)
            ? `${d.alcancados.length} TLA alcançado(s), DECLARADO(S)`
            : `${d.alcancados.length} TLA alcançado(s)`
      linhas.push(
        `  ${marca} ${tipo} ${d.id}: fecho de ${d.fecho} arquivo(s) — ${detalhe} (loader ${d.loader})`,
      )
      for (const a of d.alcancados) {
        linhas.push(`       ${a.fechaCiclo ? "CICLO" : "sem volta"} · ${a.cadeia.join(" → ")}`)
      }
    }
  }
  // As CLASSES com a contagem derivada e os declarados nome a nome.
  for (const classe of r.classesTabela ?? TLA_CLASSES) {
    const quantos = r.classes.filter((c) => c.classe === classe.id).length
    linhas.push(`  · classe '${classe.id}': ${quantos} módulo(s) — ${classe.motivo}`)
    for (const declarado of classe.declarados ?? []) {
      linhas.push(`       declarado: ${declarado}`)
    }
  }
  for (const t of r.alcanceTabela ?? ALCANCE_DECLARADO) {
    const ativo = (r.tolerados ?? []).some((p) => p.de === t.de && p.para === t.para)
    linhas.push(
      `  ${ativo ? "⚠️ " : "❌"} alcance declarado (${t.data}): ${t.de} → ${t.para}${ativo ? "" : " — NÃO existe mais, tire a declaração"}`,
    )
  }
  const semClasse = r.classes.filter((c) => c.classe === null).map((c) => c.caminho)
  if (semClasse.length > 0) {
    linhas.push(
      `  ❌ ${semClasse.length} módulo(s) com TLA em forma NÃO declarada: ${semClasse.join(", ")}`,
    )
  }
  if (r.naoResolvidos.length > 0) {
    linhas.push(
      `  ⚠️  ${r.naoResolvidos.length} specifier(s) relativo(s) que NÃO resolvem para arquivo (contados, nunca presumidos): ${r.naoResolvidos.slice(0, 5).join(" · ")}${r.naoResolvidos.length > 5 ? " · …" : ""}`,
    )
  }
  return linhas.join("\n")
}

/** O usage da CLI (o `-h`). */
const USAGE = `check-tla-closure — nenhum módulo com TLA alcançável de uma declaração do remédio

Usage:
  node scripts/check-tla-closure.mjs [--root DIR] [--json] [--trace]

Args:
  --root DIR   raiz a julgar (default: o repositório)
  --json       saída estruturada
  --trace      onde a régua mordeu em cada módulo derivado (linha + contexto)
  -h, --help   esta ajuda

Exit codes:
  0 — as duas metades verdes (alcance vazio + catraca em dia)
  1 — violação (alcance ou catraca), nomeada
  2 — infra: não deu para medir (fail-closed)
`

function main() {
  const args = process.argv.slice(2)
  if (args.includes("-h") || args.includes("--help")) {
    console.log(USAGE)
    process.exit(0)
  }
  const iRoot = args.indexOf("--root")
  const root = resolve(
    iRoot === -1 ? join(dirname(fileURLToPath(import.meta.url)), "..") : args[iRoot + 1],
  )
  const json = args.includes("--json")
  const trace = args.includes("--trace")

  const r = julgar({ root })

  if (json) {
    console.log(JSON.stringify(r, null, 2))
  } else {
    console.log(renderRelatorio(r))
  }

  // `--trace`: ONDE a régua mordeu em cada módulo derivado (o operador precisa do
  // lugar, não da contagem — e o teste unitário compara exatamente isto).
  if (trace) {
    console.log("\nOnde a régua mordeu, por módulo derivado:")
    for (const [caminho, achados] of r.ocorrencias ?? []) {
      console.log(`  ${caminho}: ${achados.length} await de nível de módulo`)
      for (const a of achados) console.log(`     linha ${a.linha}: …${a.antes}⟨await⟩`)
    }
  }

  if (r.problemas.length > 0) {
    if (!json) {
      console.error(
        "\n❌ check-tla-closure: NÃO JULGÁVEL (fail-closed — 'não consegui medir' não é verde):",
      )
      for (const p of r.problemas) console.error(`   · ${p}`)
    }
    process.exit(2)
  }
  if (r.violacoes.length > 0) {
    if (!json) {
      console.error("\n❌ check-tla-closure: VIOLAÇÃO")
      for (const v of r.violacoes) console.error(`   · ${v}`)
      console.error(
        "\n   O remédio do pre-commit carrega as declarações por `await import()`: um TLA alcançável fecha o ciclo e o node sai 13 sem imprimir nada (o hook perde a oferta do remédio).",
      )
    }
    process.exit(1)
  }
  if (!json) {
    const divida =
      (r.tolerados ?? []).length > 0
        ? ` ${r.tolerados.length} alcance(s) DECLARADO(s) em ALCANCE_DECLARADO (nomeados no relatório).`
        : ""
    console.log(
      `✅ Nenhum módulo com TLA é alcançável a partir das declarações do remédio (classe e canal) fora das declarações datadas, e o conjunto TLA derivado é o das CLASSES declaradas — os dois sentidos da catraca conferidos.${divida}`,
    )
  }
}

if (process.argv[1] && process.argv[1].endsWith("check-tla-closure.mjs")) main()
