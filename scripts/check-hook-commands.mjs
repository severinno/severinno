#!/usr/bin/env node

// =============================================================================
// check-hook-commands.mjs
//
// Usage:
//   node scripts/check-hook-commands.mjs
//   node scripts/check-hook-commands.mjs --root X   # fixture (testes)
//   node scripts/check-hook-commands.mjs --list     # o que julgou, com desfecho
//   node scripts/check-hook-commands.mjs --json
//   node scripts/check-hook-commands.mjs -h
//
// Exit code:
//   0 — todo comando que os hooks executam RESOLVE (arquivo do repositorio,
//       entrada do package.json, binario de dependencia declarada, funcao do
//       proprio hook, builtin do shell ou ferramenta externa DECLARADA)
//   1 — comando que NAO resolve (caminho/script que nao existe, binario sem
//       fornecedor, funcao chamada e nao definida, `source` de arquivo ausente)
//       ou entrada de ALLOWLIST/INDETERMINATE sem data / fora da janela
//   2 — infra: `.husky/` ou `package.json` ausente/ilegivel (fail-closed)
//
// POR QUE ESTE GUARD EXISTE: o hook e o unico lugar do repositorio onde um
// comando aponta para um arquivo do PROPRIO repositorio e nada o confere. Um
// caminho errado ali nao e "um script que nao roda": e um PASSO que nunca roda
// — e o sintoma nunca diz o nome dele. Os casos que este guard existe para
// impedir:
//
//   - `node scripts/check-bun-mirrorX.mjs --staged` (typo): o guard do indice
//     deixa de existir e o commit passa achando que foi verificado;
//   - um script do package.json que aponta para um arquivo RENOMEADO
//     (`"fuzz": "bash scripts/run-fuzz.sh"` com o `.sh` movido): o hook chama
//     `bun run fuzz` e o que ele executa e um caminho que nao existe mais;
//   - uma funcao do hook chamada e nao definida (`wait_all` com o corpo
//     removido num refactor): a fase inteira vira um "command not found" que o
//     `set -e` so reporta depois de metade dela ter rodado;
//   - `source scripts/x.sh` de um arquivo que sumiu: as definicoes que ele traz
//     nao existem, e cada uso delas falha em outro lugar, longe da causa.
//
// O QUE ESTE GUARD MEDE: para cada hook de `.husky/` (o diretorio `_` do husky
// fica fora — sao shims GERADOS, nao comandos nossos), ele extrai os COMANDOS
// com a regua de tokens de shell compartilhada (`shellTokens`, a mesma do gate
// de sintaxe: comentario, heredoc, quote multi-linha e operador ja resolvidos)
// e exige que cada um resolva:
//
//   node|bash|sh|python3 <caminho>    o caminho tem de EXISTIR no repositorio
//   bun run <entrada>                 a entrada tem de existir em `scripts` do
//                                     package.json E o comando RESOLVIDO dela e
//                                     julgado recursivamente (o script que
//                                     chama `bash scripts/x.sh` responde pelo
//                                     `.sh`)
//   bun|bunx x <pacote>               o binario tem de vir de dependencia
//                                     declarada (ou de um `node_modules/.bin`
//                                     real); o binario -> pacote e um mapa
//                                     DECLARADO (`tsc` <- `typescript`, que o
//                                     nome do binario nao deixa adivinhar)
//   <nome>()                          a funcao tem de ser DEFINIDA no proprio
//                                     hook (o hook nao importa nada: essa e a
//                                     unica fonte possivel)
//   source / . <caminho>              o arquivo tem de existir
//   qualquer outro token              tem de estar num dos conjuntos
//                                     DECLARADOS (keywords/builtins, ferramentas
//                                     externas, binarios de projeto) ou na
//                                     ALLOWLIST
//
// `$( ... )` e julgado: o comando de dentro da substituicao EXECUTA, e o
// tokenizador o entrega como comando proprio (o mesmo stream) — um
// `X=$(node scripts/typo.mjs)` nao escapa por estar a direita de um `=`.
//
// Comando montado em RUNTIME (`bash -c "$cmd"`, `node -e`, `python3 -c`)
// e INDETERMINADO — indice de julgamento nao se prova por leitura. Cada um
// desses precisa estar declarado em INDETERMINATE (com `addedAt`), pela mesma
// razao da ALLOWLIST: a lista diz QUEM decidiu e QUANDO, e a janela de revisao
// (`allowlist-review.mjs`) impede a decisao de virar permanente por
// esquecimento.
//
// O QUE ESTE GUARD NAO PROMETE (escopo declarado, nao esquecimento):
//
//   - ele julga o COMANDO, nao os ARGUMENTOS de ferramentas externas: um
//     `find .next/static/chunks` cita um caminho que nao existe por DESENHO (e
//     artefato de build, gitignored), e julgar argumentos exigiria uma
//     allowlist de caminhos-que-nao-existem — um guard que reclama de `.next/`
//     e desligado pela equipe. O que ele julga dos argumentos e o que INVOCA
//     algo: o script de um interpretador, a entrada de um `bun run`, o arquivo
//     de um `source`;
//   - ele nao julga se o comando tem o efeito PROMETIDO (isso e o
//     `check-hook-ci-parity`, que compara o comando do hook com o do CI);
//   - ele julga o TEXTO do hook (a arvore de trabalho), nao o indice: um hook
//     quebrado no commit e pego pelo proprio hook rodando.
// =============================================================================

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { basename, join } from "node:path"

import { shellTokens } from "./check-workflow-run-syntax.mjs"
import { resolveCommand } from "./check-hook-ci-parity.mjs"
import {
  DEFAULT_REVIEW_DAYS,
  agedAddedAtViolation,
  invalidAddedAtViolation,
  reviewAddedAtEntries,
} from "./allowlist-review.mjs"

export const EXIT = { OK: 0, VIOLATIONS: 1, UNJUDGEABLE: 2 }

const ROOT = process.cwd()

/** O diretorio dos hooks locais. */
export const HOOKS_DIR = ".husky"

/**
 * O diretorio `_` do husky sao os SHIMS gerados (o `pre-commit` de la faz
 * `source` do nosso): eles nao carregam comando nosso, e julga-los seria julgar
 * o husky.
 */
const HUSKY_INTERNAL_RE = /^_/

/** Os INTERPRETADORES: o proximo token nomeia o ARQUIVO que eles leem. */
export const INTERPRETERS = new Set([
  "node",
  "bash",
  "sh",
  "dash",
  "zsh",
  "python3",
  "python",
  "deno",
])

/**
 * A flag que faz o interpretador ler o payload de um ARGUMENTO: o que ele
 * executa nao existe como arquivo em lugar nenhum — e INDETERMINADO por
 * construcao, nao por limitacao do guard.
 */
export const INLINE_FLAGS = new Set(["-c", "-e", "--eval", "-"])

/** Os gerenciadores de pacote e os SUBCOMANDOS nativos deles (nao sao entradas). */
export const PACKAGE_MANAGERS = new Set(["bun", "bunx", "npm", "npx", "pnpm", "yarn"])
export const PACKAGE_MANAGER_SUBCOMMANDS = new Set([
  "x",
  "run",
  "install",
  "i",
  "add",
  "a",
  "remove",
  "rm",
  "update",
  "upgrade",
  "link",
  "unlink",
  "pm",
  "create",
  "init",
  "test",
  "build",
  "publish",
  "outdated",
  "audit",
  "dedupe",
  "prune",
  "completions",
  "why",
  "info",
  "cache",
  "exec",
])

/** Os subcomandos que executam um PACOTE (o argumento seguinte e o binario). */
export const EXEC_SUBCOMMANDS = new Set(["x", "exec", "dlx"])

/**
 * O BINARIO e fornecido por um PACOTE cujo nome nao se adivinha pelo binario. O
 * mapa e DECLARADO (e verificado contra as dependencias do package.json) em vez
 * de procurado so no `node_modules`: assim o guard responde a mesma pergunta
 * num checkout SEM dependencias instaladas (o CI instala, o pre-commit tem, o
 * fixture nao tem).
 */
export const BIN_PACKAGES = {
  tsc: "typescript",
  prettier: "prettier",
  eslint: "eslint",
  vitest: "vitest",
  "lint-staged": "lint-staged",
  prisma: "prisma",
}

/**
 * As palavras do shell que NAO sao um comando: estrutura (controle de fluxo,
 * chaves). Sao contadas e nomeadas no relatorio, nunca escondidas.
 */
export const SHELL_KEYWORDS = new Set([
  "if",
  "then",
  "else",
  "elif",
  "fi",
  "for",
  "in",
  "do",
  "done",
  "while",
  "until",
  "case",
  "esac",
  "function",
  "select",
  "{",
  "}",
  "(",
  ")",
  ";;",
])

/**
 * As ferramentas EXTERNAS ao repositorio: elas nao resolvem para arquivo
 * nenhum, e por isso sao uma lista DECLARADA — um `jq` novo no hook tem de
 * passar por aqui, e a declaracao e o que impede uma dependencia de SISTEMA de
 * entrar no caminho de CADA commit sem que ninguem veja.
 */
export const EXTERNAL_TOOLS = new Set([
  "git",
  "curl",
  "find",
  "du",
  "cut",
  "wc",
  "grep",
  "sed",
  "awk",
  "echo",
  "printf",
  "cat",
  "head",
  "tail",
  "sort",
  "uniq",
  "tr",
  "tee",
  "xargs",
  "basename",
  "dirname",
  "readlink",
  "realpath",
  "rm",
  "cp",
  "mv",
  "mkdir",
  "rmdir",
  "ln",
  "chmod",
  "touch",
  "stat",
  "date",
  "sleep",
  "seq",
  "mktemp",
  "install",
  "which",
  "command",
  "env",
  "nohup",
  "kill",
  "true",
  "false",
  "test",
  "[",
  "exit",
  "return",
  "set",
  "unset",
  "export",
  "local",
  "readonly",
  "declare",
  "trap",
  "wait",
  "shift",
  "eval",
  "exec",
  "break",
  "continue",
])

/** Os comandos que LEEM um arquivo: o alvo deles tem de existir. */
export const SOURCE_COMMANDS = new Set(["source", "."])

/**
 * Comandos que existem mas NAO resolvem dentro do repositorio — cada um e uma
 * DECISAO, com a data em que foi tomada e o motivo escrito. A janela de revisao
 * vem do modulo compartilhado (`allowlist-review.mjs`): uma isencao que ninguem
 * revisa vira permanente por esquecimento.
 *
 * @type {{match: string, addedAt: string, why: string}[]}
 */
export const ALLOWLIST = [
  {
    // O bloco advisory do `pre-push`: so roda com servidor de pe, o pacote e
    // resolvido pela REDE em runtime (nao e dependencia do projeto) e o "nao
    // instalado" ja e um skip declarado no proprio hook.
    match: "bunx @lhci/cli",
    addedAt: "2026-09-17",
    why: "Lighthouse e ADVISORY no pre-push: nao bloqueia nada, a CLI e baixada pela rede em runtime (nao e dependencia do repositorio) e a ausencia dela ja e um skip declarado no hook — o guard registra a decisao em vez de fingir que o comando resolve localmente",
  },
]

/**
 * Os payloads de runtime ja conhecidos. O `python3 -c` do bloco advisory do
 * `pre-push` le a resposta do `/api/health`: o programa esta na linha e o
 * PROGRAMA a executar esta no argumento, que nenhuma leitura prova.
 *
 * @type {{match: string, addedAt: string, why: string}[]}
 */
export const INDETERMINATE = [
  {
    match: "python3 -c",
    addedAt: "2026-09-17",
    why: "o payload do `python3 -c` vive no ARGUMENTO (le o JSON do /api/health do bloco advisory do pre-push) e nao existe como arquivo: julgar o texto dele seria julgar uma string, nao um comando",
  },
]

/** A janela de revisao desta lista (o modulo compartilhado da o default). */
export const HOOK_COMMANDS_REVIEW_DAYS = DEFAULT_REVIEW_DAYS

// =============================================================================
// Extracao: do texto do hook para os COMANDOS
// =============================================================================

/**
 * Tira os REDIRECIONAMENTOS do stream: `> alvo`, `>> alvo`, `2> alvo`,
 * `2>&1`, `&> alvo`. O destino de um redirecionamento nao e um comando — sem
 * isto, `2>/dev/null` viraria um comando chamado `2` (ou `/dev/null`) e o
 * relatorio acusaria um programa que ninguem escreveu.
 *
 * @param {{tipo: string, raw: string, valor: string, linha: number}[]} tokens
 * @returns {typeof tokens}
 */
export function stripRedirections(tokens) {
  const saida = []
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    const op = t.tipo === "op" ? t.raw : ""
    if (op === ">" || op === "<") {
      // O destino (proxima palavra, ou `&` + numero do `2>&1`).
      if (tokens[i + 1]?.tipo === "op" && tokens[i + 1].raw === "&") i += 1
      if (tokens[i + 1]?.tipo === "palavra" && /^\d+$/.test(tokens[i + 1].valor)) i += 1
      else if (tokens[i + 1]?.tipo === "palavra") i += 1
      // O numero do descritor ANTES do `>` (`2>`, `1>`) ja entrou no stream
      // como palavra: remove do que ja foi acumulado se for o ultimo.
      const anterior = saida[saida.length - 1]
      if (anterior?.tipo === "palavra" && /^\d+$/.test(anterior.valor)) saida.pop()
      continue
    }
    saida.push(t)
  }
  return saida
}

/**
 * A MASCARA de uma substituicao no texto: um token inerte no lugar do
 * `$( ... )`. Ele existe para que a tokenizacao do resto da linha nao mude (a
 * substituicao some como PALAVRA, e o comando dela e julgado a parte) — sem
 * isso, `test_file="src/__tests__/$(basename ...).test.ts"` seria partido em
 * tres tokens pelo `$(`, e o ultimo deles (`.test.ts"`) viraria um "programa"
 * que ninguem escreveu.
 */
export const SUBSTITUICAO = "__substituicao_julgada__"

/**
 * Separa as SUBSTITUICOES (`$( ... )`) do resto do texto.
 *
 * O comando de dentro de uma substituicao EXECUTA — e por isso ele nao pode
 * escapar por estar a direita de um `=`. Em vez de tentar entender a
 * substituicao no meio da tokenizacao (o tokenizer a parte em varios tokens,
 * porque um `$(cmd args)` tem espacos), o span INTEIRO e trocado por uma
 * palavra inerte, e o miolo e tokenizado como um texto proprio, na LINHA do
 * `$(`. A contagem de linhas e preservada (as quebras do span vao para depois
 * da mascara), entao todo comando continua apontando para a linha certa.
 *
 * Aritmetica (`$(( ... ))`) nao e recursada: o miolo dela e uma EXPRESSAO, nao
 * um comando.
 *
 * @param {string} content
 * @param {number} [startLine]
 * @returns {{mascarado: string, substituicoes: {texto: string, linha: number}[]}}
 */
export function extractSubstitutions(content, startLine = 1) {
  let mascarado = ""
  let linha = startLine
  let i = 0
  const substituicoes = []
  while (i < content.length) {
    const abre = content.indexOf("$(", i)
    if (abre === -1) {
      mascarado += content.slice(i)
      break
    }
    const antes = content.slice(i, abre)
    mascarado += antes
    linha += (antes.match(/\n/g) ?? []).length
    let nivel = 0
    let j = abre + 1
    for (; j < content.length; j++) {
      if (content[j] === "(") nivel++
      else if (content[j] === ")") {
        nivel--
        if (nivel === 0) break
      }
    }
    if (j >= content.length) {
      // Substituicao nao fechada: o texto fica como esta (quem julga isso e o
      // bash, nao este guard).
      mascarado += content.slice(abre)
      break
    }
    const span = content.slice(abre, j + 1)
    const quebras = (span.match(/\n/g) ?? []).length
    if (content[abre + 2] !== "(") substituicoes.push({ texto: content.slice(abre + 2, j), linha })
    mascarado += SUBSTITUICAO + "\n".repeat(quebras)
    linha += quebras
    i = j + 1
  }
  return { mascarado, substituicoes }
}

/**
 * O PROGRAMA de uma lista de tokens: o primeiro que nao e atribuicao
 * (`A=1 cmd` executa o `cmd`), com a linha dele e o INDICE no buffer (os
 * argumentos sao os tokens depois do programa).
 *
 * @param {{tipo: string, valor: string, linha: number}[]} tokens
 * @returns {{valor: string, linha: number, indice: number}|null}
 */
export function programOf(tokens) {
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (t.tipo === "op") continue
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t.valor)) continue // atribuicao
    return { valor: t.valor, linha: t.linha, indice: i }
  }
  return null
}

/**
 * Um PADRAO de `case` (`src/lib/*.ts)`, `*)`) nao e um comando: e a etiqueta de
 * um ramo. Sem isto o relatorio acusaria um programa chamado `src/lib/*.ts`.
 *
 * @param {string} programa
 * @returns {boolean}
 */
export function isCasePattern(programa) {
  return programa.endsWith(")") && /[*?[]/.test(programa)
}

/**
 * As FUNCOES definidas no proprio hook (`nome() {` e `function nome {`). E a
 * unica fonte possivel: o hook nao importa nada, entao uma funcao chamada e
 * ausente daqui e um "command not found" garantido.
 *
 * @param {string} content
 * @returns {Set<string>}
 */
export function definedFunctions(content) {
  const nomes = new Set()
  for (const linha of content.split(/\r?\n/)) {
    const m = linha.match(/^\s*(?:function\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*\(\s*\)\s*\{?\s*$/)
    if (m) nomes.add(m[1])
  }
  return nomes
}

/**
 * Segmenta um texto JA SEM substituicoes nos comandos dele. As fronteiras sao
 * os operadores de lista (`|`, `&`, `;`), os parenteses e o fim de uma
 * substituicao (`... )`), que o tokenizador cola no token anterior.
 *
 * @param {string} texto
 * @param {number} startLine
 * @param {string} origem
 * @returns {{linha: number, programa: string, tokens: string[], origem: string}[]}
 */
function segmenta(texto, startLine, origem) {
  const comandos = []
  const tokens = stripRedirections(shellTokens(texto, { startLine }))
  // A QUEBRA DE LINHA e um separador de comando: sem isto o corpo de uma funcao, a
  // linha seguinte e o `then` do bloco viravam o ARGUMENTO de um comando so — e o
  // comando que estava na linha seguinte deixava de existir no relatorio. A
  // excecao e a CONTINUACAO de linha (`\` no fim), onde a quebra nao separa nada.
  const continuadas = new Set()
  texto.split(/\r?\n/).forEach((linha, i) => {
    if (/\\\s*$/.test(linha)) continuadas.add(startLine + i)
  })
  let anterior = null
  let buffer = []
  const fecha = () => {
    if (buffer.length === 0) return
    const atual = buffer
    buffer = []
    const programa = programOf(atual)
    if (programa === null || programa.valor === "") return
    if (programa.valor === SUBSTITUICAO) return // a mascara nao e um programa
    if (SHELL_KEYWORDS.has(programa.valor) || isCasePattern(programa.valor)) return
    if (/\(\)$/.test(programa.valor)) return // a DEFINICAO da funcao, nao uma chamada
    comandos.push({
      linha: programa.linha,
      programa: programa.valor,
      tokens: atual
        .slice(programa.indice + 1)
        .filter((t) => t.tipo !== "op")
        .map((t) => t.valor),
      origem,
    })
  }
  for (const token of tokens) {
    if (anterior !== null && token.linha > anterior.linha && !continuadas.has(anterior.linha))
      fecha()
    anterior = token
    if (token.tipo === "op" && ["|", "&", ";"].includes(token.raw)) {
      fecha()
      continue
    }
    if (token.valor === "(" || token.valor === ")") {
      fecha()
      continue
    }
    buffer.push(token)
    // O `)` de uma substituicao FECHA o comando: o que vem depois pode ser
    // outro comando na mesma linha (`X=$(git a) B=$(node b)`).
    if (token.valor.endsWith(")") && !token.valor.includes("(") && !isCasePattern(token.valor))
      fecha()
  }
  fecha()
  return comandos
}

/**
 * Os COMANDOS de um texto de shell, com a linha de cada um.
 *
 * `origem` diz de ONDE o comando veio quando ele nao esta no corpo do hook:
 * `substituição` (dentro de um `$( )`) ou `package.json scripts.<entrada>` (o
 * `bun run` resolvido) — e o que permite a mensagem apontar para o lugar certo.
 *
 * @param {string} content
 * @param {{startLine?: number, origem?: string}} [opts]
 * @returns {{linha: number, programa: string, tokens: string[], origem: string}[]}
 */
export function shellCommands(content, { startLine = 1, origem = "" } = {}) {
  const { mascarado, substituicoes } = extractSubstitutions(content, startLine)
  const comandos = segmenta(mascarado, startLine, origem)
  for (const sub of substituicoes) {
    comandos.push(
      ...shellCommands(sub.texto, {
        startLine: sub.linha,
        origem: origem === "" ? "substituição" : origem,
      }),
    )
  }
  return comandos.sort((a, b) => a.linha - b.linha)
}

// =============================================================================
// Resolucao: cada comando resolve, ou a violacao diz por que nao
// =============================================================================

/** Le um arquivo do root, ou null. */
function readOrNull(root, rel) {
  const full = join(root, rel)
  return existsSync(full) ? readFileSync(full, "utf8") : null
}

function readScripts(root) {
  const raw = readOrNull(root, "package.json")
  if (raw === null) return null
  try {
    return JSON.parse(raw).scripts ?? {}
  } catch {
    return null
  }
}

/** Os nomes de pacote DECLARADOS (deps + devDeps + optionalDeps). */
export function declaredPackages(root) {
  const raw = readOrNull(root, "package.json")
  if (raw === null) return new Set()
  try {
    const pkg = JSON.parse(raw)
    return new Set([
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.devDependencies ?? {}),
      ...Object.keys(pkg.optionalDependencies ?? {}),
    ])
  } catch {
    return new Set()
  }
}

/**
 * O `binario` existe no `node_modules` de verdade? E a prova ESTRUTURAL (o
 * simlink do `.bin`), disponivel quando as dependencias estao instaladas — o CI
 * e o pre-commit tem, o fixture nao tem (por isso o mapa DECLARADO acima existe
 * em paralelo).
 */
export function binInstalado(root, binario) {
  return existsSync(join(root, "node_modules", ".bin", binario))
}

/** O arquivo existe (e nao e diretorio)? */
function arquivoExiste(root, rel) {
  const full = join(root, rel)
  return existsSync(full) && statSync(full).isFile()
}

/**
 * Os hooks julgados: todo arquivo de `.husky/` que nao seja o diretorio interno
 * do husky. A lista e LIDA do diretorio (nao cravada) de proposito: um hook
 * novo entra no julgamento sozinho, e esquecer uma lista a mao e exatamente a
 * classe de erro que este guard existe para pegar.
 *
 * @param {string} root
 * @returns {string[]} caminhos relativos, ordenados
 */
export function hookFiles(root) {
  const dir = join(root, HOOKS_DIR)
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && !HUSKY_INTERNAL_RE.test(entry.name))
    .map((entry) => `${HOOKS_DIR}/${entry.name}`)
    .sort()
}

/**
 * Os comandos de TODOS os hooks, com a proveniencia de cada um.
 *
 * @param {string} root
 * @returns {{arquivo: string, linha: number, programa: string, tokens: string[], origem: string}[]}
 */
export function hookCommands(root) {
  const comandos = []
  for (const rel of hookFiles(root)) {
    const content = readFileSync(join(root, rel), "utf8")
    for (const comando of shellCommands(content)) comandos.push({ arquivo: rel, ...comando })
  }
  return comandos
}

/** Todos os arquivos que um `source`/`.` do hook carrega (e que tem de existir). */
function comandosDeScript(root, entrada, scripts, profundidade = 0) {
  const texto = scripts[entrada]
  if (typeof texto !== "string" || profundidade > 3) return []
  const resolvido = resolveCommand(`bun run ${entrada}`, scripts, profundidade)
  if (resolvido === `bun run ${entrada}`) return []
  return shellCommands(resolvido, { origem: `package.json scripts.${entrada}` })
} /**
 * O veredito de UM comando.
 *
 * O que o guard NAO consegue provar por leitura (payload de runtime, caminho
 * montado em `$VAR`) nao passa em silencio: ele tem de estar em INDETERMINATE,
 * com a data e o motivo. `indeterminado` no relatorio significa "DECLARADO e
 * nao provavel", nunca "nao olhei".
 *
 * @returns {{desfecho: "resolvido"|"violacao"|"indeterminado", motivo: string}}
 */
export function classify(comando, ctx) {
  const bruto = classificaBruto(comando, ctx)
  if (bruto.desfecho !== "indeterminado") return bruto
  const texto = [comando.programa, ...comando.tokens].join(" ")
  const declarado = ctx.indeterminados.find((entrada) => texto.startsWith(entrada.match))
  if (declarado !== undefined)
    return { desfecho: "indeterminado", motivo: `declarado (${declarado.addedAt})` }
  return {
    desfecho: "violacao",
    motivo: `${bruto.motivo} — e uma decisão nao declarada: registre-a em INDETERMINATE (com \`addedAt\` e motivo) ou torne o comando provável`,
  }
}

/** O veredito antes da regra do "indeterminado tem de estar declarado". */
function classificaBruto(comando, ctx) {
  const { programa, tokens } = comando
  const texto = [programa, ...tokens].join(" ")

  for (const entrada of ctx.allowlist) {
    if (texto.startsWith(entrada.match))
      return { desfecho: "resolvido", motivo: `allowlist (${entrada.addedAt})` }
  }
  if (ctx.funcoes.has(programa)) return { desfecho: "resolvido", motivo: "função do próprio hook" }

  if (INTERPRETERS.has(programa)) {
    const alvo = tokens[0]
    if (alvo === undefined || alvo.startsWith("-")) {
      if (alvo !== undefined && INLINE_FLAGS.has(alvo))
        return { desfecho: "indeterminado", motivo: `payload inline (${programa} ${alvo})` }
      return {
        desfecho: "indeterminado",
        motivo: `sem arquivo de script (${programa} ${alvo ?? ""})`.trim(),
      }
    }
    return julgaCaminho(ctx, alvo, `script do ${programa}`)
  }

  if (SOURCE_COMMANDS.has(programa)) {
    const alvo = tokens[0]
    if (alvo === undefined) return { desfecho: "indeterminado", motivo: `${programa} sem arquivo` }
    return julgaCaminho(ctx, alvo, `${programa} de`)
  }

  if (PACKAGE_MANAGERS.has(programa)) return julgaGerenciador(ctx, comando)

  if (programa.includes("/")) return julgaCaminho(ctx, programa, "execução direta")

  if (EXTERNAL_TOOLS.has(programa))
    return { desfecho: "resolvido", motivo: "ferramenta externa declarada" }

  if (BIN_PACKAGES[programa] !== undefined) {
    const pacote = BIN_PACKAGES[programa]
    if (ctx.pacotes.has(pacote))
      return { desfecho: "resolvido", motivo: `binário de ${pacote} (dependência declarada)` }
    return {
      desfecho: "violacao",
      motivo: `binário \`${programa}\` mapeado para \`${pacote}\`, que NÃO está declarado no package.json`,
    }
  }
  if (ctx.pacotes.has(programa) || binInstalado(ctx.root, programa))
    return { desfecho: "resolvido", motivo: `binário de dependência (${programa})` }

  return {
    desfecho: "violacao",
    motivo: `programa \`${programa}\` não é arquivo do repositório, entrada do package.json, binário de dependência, função do hook nem ferramenta externa declarada`,
  }
}

/** O caminho citado existe? (o alvo do guard) */
function julgaCaminho(ctx, alvo, papel) {
  if (alvo.startsWith("$"))
    return {
      desfecho: "indeterminado",
      motivo: `${papel}: caminho montado em runtime (\`${alvo}\`)`,
    }
  if (alvo.startsWith("/"))
    return { desfecho: "resolvido", motivo: `${papel}: caminho absoluto fora do repositório` }
  if (/[*?[]/.test(alvo))
    return { desfecho: "indeterminado", motivo: `${papel}: padrão, não um caminho (\`${alvo}\`)` }
  if (arquivoExiste(ctx.root, alvo))
    return { desfecho: "resolvido", motivo: `${papel} \`${alvo}\`` }
  // A sugestao do vizinho mais proximo e o que faz o erro de digitacao se
  // corrigir sozinho: a mensagem ja diz QUAL nome era o esperado.
  const vizinho = sugestao(basename(alvo), irmaos(ctx.root, alvo))
  return {
    desfecho: "violacao",
    motivo:
      `${papel} \`${alvo}\` NÃO existe no repositório` +
      (vizinho === null ? "" : ` — o mais próximo é \`${vizinho}\``),
  }
}

/** Os arquivos do MESMO diretorio do alvo (a fonte da sugestao). */
function irmaos(root, alvo) {
  const partes = alvo.split("/")
  partes.pop()
  const dir = join(root, partes.join("/"))
  if (partes.length === 0 || !existsSync(dir) || !statSync(dir).isDirectory()) return []
  return readdirSync(dir)
}

/**
 * O vizinho mais proximo de um nome (a sugestao que faz o erro de digitacao se
 * corrigir sozinho). Distancia de edicao com TETO: uma string sem parentesco
 * nao vira sugestao — a mensagem tem de ser util, nao barulhenta.
 *
 * @param {string} procurado
 * @param {string[]} candidatos
 * @returns {string|null}
 */
export function sugestao(procurado, candidatos) {
  let melhor = null
  let melhorDistancia = 4
  for (const candidato of candidatos) {
    const d = distancia(procurado, candidato, melhorDistancia)
    if (d < melhorDistancia) {
      melhorDistancia = d
      melhor = candidato
    }
  }
  return melhor
}

/** Distancia de edicao com teto (acima do teto devolve o proprio teto). */
function distancia(a, b, teto) {
  if (Math.abs(a.length - b.length) >= teto) return teto
  const colunas = b.length + 1
  let anterior = Array.from({ length: colunas }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const atual = [i]
    for (let j = 1; j < colunas; j++) {
      atual[j] = Math.min(
        anterior[j] + 1,
        atual[j - 1] + 1,
        anterior[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
    }
    anterior = atual
  }
  return anterior[colunas - 1]
}

/** `bun run <entrada>` / `bun <entrada>` / `bun x <pacote>`. */
function julgaGerenciador(ctx, comando) {
  const { programa, tokens } = comando
  const primeiro = tokens[0]
  if (primeiro === undefined)
    return { desfecho: "indeterminado", motivo: `${programa} sem argumento` }

  // `bunx <pacote>` / `npx <pacote>` (o binario E o argumento 0) e
  // `bun x <pacote>` (o subcomando E o argumento 0).
  const execDireto = programa === "bunx" || programa === "npx"
  if (execDireto || EXEC_SUBCOMMANDS.has(primeiro)) {
    const pacote = execDireto ? primeiro : tokens[1]
    if (pacote === undefined)
      return { desfecho: "indeterminado", motivo: `${programa} executa um pacote em runtime` }
    if (ctx.pacotes.has(pacote) || binInstalado(ctx.root, basename(pacote)))
      return { desfecho: "resolvido", motivo: `binário de dependência (${pacote})` }
    return {
      desfecho: "violacao",
      motivo: `\`${pacote}\` não é dependência declarada nem binário instalado — declare a dependência ou a decisão na ALLOWLIST`,
    }
  }

  // `bun run <entrada>` e `bun <entrada>`, quando a entrada E um script.
  const explicito = primeiro === "run"
  const possivelEntrada = explicito ? tokens[1] : primeiro
  if (explicito || ctx.scripts[possivelEntrada] !== undefined) {
    if (possivelEntrada === undefined)
      return { desfecho: "indeterminado", motivo: `${programa} run sem entrada` }
    if (possivelEntrada.startsWith("-") || possivelEntrada.startsWith("$"))
      return {
        desfecho: "indeterminado",
        motivo: `${programa} run com entrada em runtime (\`${possivelEntrada}\`)`,
      }
    if (ctx.scripts[possivelEntrada] === undefined) {
      // `bun run <binario>` tambem resolve um BINARIO (o hook roda
      // `bun run vitest`, e `vitest` NAO e uma entrada de `scripts`): quem
      // decide e a MESMA regua de binario do resto do guard, em vez de uma
      // segunda regra so para esta forma.
      const veredito = classify(
        { linha: comando.linha, programa: possivelEntrada, tokens: [], origem: comando.origem },
        ctx,
      )
      if (veredito.desfecho !== "resolvido") {
        const vizinho = sugestao(possivelEntrada, Object.keys(ctx.scripts))
        return {
          desfecho: "violacao",
          motivo:
            `\`${possivelEntrada}\` não é entrada de \`scripts\` do package.json nem binário de dependência declarada` +
            (vizinho === null ? "" : ` — o mais próximo é \`${vizinho}\``),
        }
      }
      return { desfecho: "resolvido", motivo: `binário de dependência (\`${possivelEntrada}\`)` }
    }
    // O que a entrada EXECUTA tambem e um comando nosso: o caminho dela responde.
    const internos = comandosDeScript(ctx.root, possivelEntrada, ctx.scripts)
    const violado = internos
      .map((interno) => classify(interno, ctx))
      .find((veredito) => veredito.desfecho === "violacao")
    if (violado !== undefined)
      return {
        desfecho: "violacao",
        motivo: `\`${possivelEntrada}\` (em \`scripts\`) → ${violado.motivo}`,
      }
    return {
      desfecho: "resolvido",
      motivo: `entrada \`${possivelEntrada}\` do package.json, e o que ela executa resolve`,
    }
  }

  if (PACKAGE_MANAGER_SUBCOMMANDS.has(primeiro))
    return { desfecho: "resolvido", motivo: `subcomando nativo do ${programa}` }

  return {
    desfecho: "violacao",
    motivo: `\`${possivelEntrada}\` não é subcomando nativo do ${programa} nem entrada de \`scripts\` do package.json`,
  }
}

// =============================================================================
// Relatorio
// =============================================================================

/**
 * O veredito do guard.
 *
 * @param {{root?: string, now?: number, reviewDays?: number}} [opts]
 */
export function analyze({
  root = ROOT,
  now = Date.now(),
  reviewDays = HOOK_COMMANDS_REVIEW_DAYS,
} = {}) {
  const scripts = readScripts(root)
  const hooks = hookFiles(root)
  if (hooks.length === 0 || scripts === null) return { infra: true, hooks, root }

  const ctx = {
    root,
    scripts,
    pacotes: declaredPackages(root),
    allowlist: ALLOWLIST,
    indeterminados: INDETERMINATE,
    funcoes: new Set(),
  }

  const relatorios = []
  // As FUNCOES de TODOS os hooks primeiro: o pre-commit define `wait_all` e o
  // pre-push poderia chama-la — a fonte e o texto do hook, nao uma lista a mao.
  for (const rel of hooks) {
    const content = readFileSync(join(root, rel), "utf8")
    for (const nome of definedFunctions(content)) ctx.funcoes.add(nome)
  }
  for (const rel of hooks) {
    const content = readFileSync(join(root, rel), "utf8")
    for (const comando of shellCommands(content)) {
      const veredito = classify(comando, ctx)
      relatorios.push({ arquivo: rel, ...comando, ...veredito })
    }
  }

  const violacoes = relatorios.filter((r) => r.desfecho === "violacao")
  const indeterminados = relatorios.filter((r) => r.desfecho === "indeterminado")
  const resolvidos = relatorios.filter((r) => r.desfecho === "resolvido")

  // A DATA das duas listas de decisao: sem `addedAt` a isencao nao tem autor
  // nem epoca; fora da janela ela e uma decisao que ninguem revisou.
  const allowlistReview = reviewAddedAtEntries(ALLOWLIST, { idOf: (e) => e.match, now, reviewDays })
  const indeterminadosReview = reviewAddedAtEntries(INDETERMINATE, {
    idOf: (e) => e.match,
    now,
    reviewDays,
  })

  return {
    infra: false,
    root,
    hooks,
    comandos: relatorios,
    resolvidos,
    violacoes,
    indeterminados,
    allowlistReview,
    indeterminadosReview,
    reviewDays,
  }
}

/** As violações de DATA das listas de decisão. */
export function reviewViolations(report) {
  const violacoes = []
  for (const [listName, review] of [
    ["ALLOWLIST", report.allowlistReview],
    ["INDETERMINATE", report.indeterminadosReview],
  ]) {
    for (const entrada of review.invalid)
      violacoes.push({
        arquivo: "scripts/check-hook-commands.mjs",
        linha: 0,
        programa: entrada.id,
        motivo: invalidAddedAtViolation({ label: entrada.id, listName, why: entrada.why }),
      })
    for (const entrada of review.aged)
      violacoes.push({
        arquivo: "scripts/check-hook-commands.mjs",
        linha: 0,
        programa: entrada.id,
        motivo: agedAddedAtViolation({
          label: entrada.id,
          listName,
          addedAt: entrada.addedAt,
          days: entrada.days,
          limit: entrada.limit,
          remedy:
            "reafirme a decisão atualizando `addedAt` (se ela continua valendo) ou remova a entrada",
        }),
      })
  }
  return violacoes
}

export const USAGE = `check-hook-commands — todo comando que os hooks executam tem de RESOLVER

Usage:
  node scripts/check-hook-commands.mjs [opções]

Opções:
  --root <dir>      raiz do repositório (fixture dos testes; default: cwd)
  --list            imprime o desfecho de CADA comando julgado
  --json            saída estruturada (consumível por outro script)
  -h, --help        esta ajuda

O que ele julga: os COMANDOS de \`.husky/\` (o diretório \`_\` do husky fica fora —
são shims gerados). Caminho de interpretador (\`node scripts/x.mjs\`), entrada de
\`bun run\`, binário de \`bun x\`, função do próprio hook, arquivo de \`source\` e
ferramenta externa declarada. \`$( ... )\` executa e é julgado junto.

Exit code:
  0 — todo comando resolve (e as listas de decisão estão dentro da janela)
  1 — comando que não resolve, ou decisão sem \`addedAt\` / fora da janela
  2 — infra: \`.husky/\` ou \`package.json\` ausente/ilegível (fail-closed)
`

function printReport(report, { list = false } = {}) {
  if (report.infra) {
    if (report.hooks.length === 0) console.error("❌ .husky/ sem nenhum hook — nada a julgar")
    else console.error("❌ package.json ausente ou ilegível — scripts não julgáveis")
    return EXIT.UNJUDGEABLE
  }
  const violacoes = [...report.violacoes, ...reviewViolations(report)]

  console.log(
    `🔗 Comandos dos hooks: ${report.comandos.length} comando(s) em ${report.hooks.length} hook(s) — ` +
      `${report.resolvidos.length} resolvido(s), ${report.indeterminados.length} indeterminado(s), ` +
      `${violacoes.length} violação(ões)`,
  )
  // A SOMA: cada comando julgado tem UM desfecho, e o total tem de fechar com
  // as partes. Sem esta conta, um comando que escapasse da classificacao (um
  // `continue` novo, um filtro a mais) sumiria do relatorio em silencio — que e
  // o modo de falha que este guard existe para impedir.
  const soma = report.resolvidos.length + report.indeterminados.length + report.violacoes.length
  if (soma !== report.comandos.length) {
    console.error(
      `❌ SOMA inconsistente: ${report.comandos.length} comando(s) julgado(s), mas ` +
        `${soma} desfecho(s) — ${report.resolvidos.length} resolvido(s), ` +
        `${report.indeterminados.length} indeterminado(s), ${report.violacoes.length} violação(ões)`,
    )
    return EXIT.UNJUDGEABLE
  }

  if (list) {
    for (const c of report.comandos)
      console.log(
        `   ${c.desfecho === "resolvido" ? "✅" : c.desfecho === "violacao" ? "❌" : "⚠️ "} ${c.arquivo}:${c.linha}  ${c.programa} ${c.tokens.join(" ")}  — ${c.motivo}${c.origem ? ` (${c.origem})` : ""}`,
      )
  } else {
    for (const c of report.indeterminados)
      console.log(`   ⚠️  ${c.arquivo}:${c.linha} \`${c.programa}\` — ${c.motivo}`)
  }

  if (violacoes.length === 0) {
    console.log(
      `✅ Todo comando dos hooks resolve (janela de revisão das decisões: ${report.reviewDays} dias)`,
    )
    return EXIT.OK
  }
  console.error(`\n❌ ${violacoes.length} comando(s)/decisão(ões) sem resolução:`)
  for (const v of violacoes)
    console.error(`   • ${v.arquivo}:${v.linha} \`${v.programa}\` — ${v.motivo}`)
  return EXIT.VIOLATIONS
}

function parseArgs(argv) {
  const opts = { root: ROOT, list: false, json: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--root") opts.root = argv[++i] ?? ROOT
    else if (a === "--list") opts.list = true
    else if (a === "--json") opts.json = true
    else if (a === "-h" || a === "--help") {
      console.log(USAGE)
      process.exit(EXIT.OK)
    }
  }
  return opts
}

const invokedDirectly = process.argv[1]?.endsWith("check-hook-commands.mjs")
if (invokedDirectly) {
  const opts = parseArgs(process.argv.slice(2))
  const report = analyze({ root: opts.root })
  if (opts.json) {
    const violacoes = report.infra ? [] : [...report.violacoes, ...reviewViolations(report)]
    console.log(
      JSON.stringify(
        {
          ok: !report.infra && violacoes.length === 0,
          root: report.root,
          hooks: report.hooks ?? [],
          total: report.comandos?.length ?? 0,
          resolvidos: report.resolvidos?.length ?? 0,
          indeterminados: report.indeterminados ?? [],
          violacoes,
          reviewDays: report.reviewDays ?? HOOK_COMMANDS_REVIEW_DAYS,
        },
        null,
        2,
      ),
    )
    process.exit(
      report.infra ? EXIT.UNJUDGEABLE : violacoes.length === 0 ? EXIT.OK : EXIT.VIOLATIONS,
    )
  }
  process.exit(printReport(report, { list: opts.list }))
}
