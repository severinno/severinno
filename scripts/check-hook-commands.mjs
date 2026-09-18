#!/usr/bin/env node

// =============================================================================
// check-hook-commands.mjs
//
// Usage:
//   node scripts/check-hook-commands.mjs
//   node scripts/check-hook-commands.mjs --root X   # fixture (testes)
//   node scripts/check-hook-commands.mjs --list     # o que julgou, com desfecho
//   node scripts/check-hook-commands.mjs --json
//   node scripts/check-hook-commands.mjs --fix      # REMENDA o caminho tipado pelo VIZINHO mais próximo (PERGUNTA antes)
//   node scripts/check-hook-commands.mjs --fix --yes  # a confirmação já foi dada por quem chama
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
//   3 — uso invalido (`--fix` com `--json`/`--list`, `--yes` sem `--fix`,
//       `--root` sem valor)
//
// O REMENDO (`--fix`): a mensagem já diz QUAL era o caminho esperado ("o mais
// próximo é `X`"); o `--fix` fecha a distância entre a DIAGNOSE e o CONSERTO,
// com o antes/depois na tela e uma PERGUNTA antes de gravar. A régua dele é mais
// ESTRITA que a da mensagem (que sugere com teto 4): ele só grava com UM
// candidato a até 2 caracteres de diferença, arquivo de verdade e token
// localizável sem ambiguidade. O que ele NÃO remenda (a entrada de `bun run`, a
// função não definida, o binário sem fornecedor, o payload de runtime) sai
// NOMEADO no plano, com o motivo — nunca em silêncio. `.husky/` é o arquivo que
// o hook EXECUTA: quem remenda por dentro do pre-commit leva o veredito de um
// `git commit` novo (ver `exigeRelancamento` no `pre-commit-remedy.mjs`).
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
//   bash|sh <script.sh>               o caminho tem de existir E o que ELE executa
//                                     por dentro e julgado recursivamente: o
//                                     hook real chama UM runner
//                                     (`bash scripts/run-encoding-guards.sh`)
//                                     que chama os outros, e sem descer uma
//                                     linha tipada DENTRO dele seria o mesmo
//                                     passo-que-nunca-roda, invisivel
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
//     quebrado no commit e pego pelo proprio hook rodando;
//   - a descida cobre o SHELL, nao o que um programa compilado/interpretado faz
//     por dentro: um `node scripts/x.mjs` tem o caminho conferido, e o que ele
//     roda internamente fica para os guards que leem o grafo de imports.
//     Descer so no que um interpretador de SHELL le e uma superficie DECLARADA,
//     nao uma lista de arquivos escolhidos a mao.
// =============================================================================

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { basename, join } from "node:path"

import { shellTokens } from "./check-workflow-run-syntax.mjs"
import { resolveCommand } from "./check-hook-ci-parity.mjs"
import {
  DEFAULT_REVIEW_DAYS,
  agedAddedAtViolation,
  invalidAddedAtViolation,
  reviewAddedAtEntries,
} from "./allowlist-review.mjs"
// A PERGUNTA (terminal de CONTROLE, default NÃO, teto da espera, desligamento
// declarado) mora num módulo PRÓPRIO: a mesma pergunta é feita pelo remédio do
// pre-commit, e duas cópias da régua divergiriam. Ela NÃO pode vir do
// `pre-commit-remedy.mjs` (o grafo dele é o do hook inteiro, e este guard roda
// em fase paralela do hook e no CI) — daí o módulo embaixo dos dois.
import {
  OFFER_MARKER,
  TIMEOUT,
  TTY_WAIT_MS,
  ask,
  isAffirmative,
  noPromptEnv,
  openTerminal,
} from "./confirm-prompt.mjs"

export const EXIT = { OK: 0, VIOLATIONS: 1, UNJUDGEABLE: 2, USAGE: 3 }

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

/**
 * Os comandos do PROPRIO SHELL: nao resolvem para arquivo nenhum, nao sao
 * dependencia de sistema e nao existem "no repositorio" — sao a LINGUAGEM. A
 * lista e DECLARADA (como EXTERNAL_TOOLS, e pelo mesmo motivo): sem ela um `cd`
 * dentro de um script que o hook chama viraria uma violacao FALSA num gate
 * bloqueante, e a lista cresceria por reacao a cada falso positivo em vez de
 * dizer o que ela e.
 *
 * O `cd` e o caso que merece a frase: ele troca o DIRETORIO CORRENTE, e um
 * caminho relativo depois dele depende de onde ele parou — o guard julga o
 * COMANDO (o `cd` existe), nao a semantica do argumento (para ONDE ele aponta).
 */
export const SHELL_BUILTINS = new Set([
  "cd",
  "pwd",
  "read",
  "readarray",
  "mapfile",
  ":",
  "alias",
  "unalias",
  "bg",
  "fg",
  "jobs",
  "hash",
  "type",
  "ulimit",
  "umask",
  "times",
  "getopts",
  "let",
  "pushd",
  "popd",
  "dirs",
  "history",
  "help",
  "enable",
  "caller",
  "compgen",
  "complete",
  "disown",
  "suspend",
  "logout",
  "fc",
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
  // As QUATRO decisoes abaixo nasceram da descida nos scripts que os hooks
  // chamam (`bash scripts/run-encoding-guards.sh` → os quatro `check-*.sh`). Sem
  // elas o guard reprovava o repositorio por comando que existe e RODA — o que
  // ele nao consegue e PROVAR por leitura. Cada uma e uma decisao datada, com a
  // revisao da janela, e nao um silencio.
  {
    match: "python -c",
    addedAt: "2026-09-17",
    why: 'o probe `python -c "import sys"` (check-crlf.sh e check-blob-crlf.sh escolhem o interpretador em runtime) tem o payload no ARGUMENTO, como o `python3 -c` acima — e o resultado dele e o proprio gate de disponibilidade do interpretador',
  },
  {
    match: "python3 $PYTHON_SCRIPT",
    addedAt: "2026-09-17",
    why: 'o caminho vem da VARIAVEL `PYTHON_SCRIPT` (= `$SCRIPT_DIR/check_utf8.py`, um arquivo que existe): o guard nao resolve variaveis (escopo declarado), e o proprio script confere `[ ! -f "$PYTHON_SCRIPT" ]` antes de executar',
  },
  {
    match: "node $SCRIPT_DIR/check_utf8.mjs",
    addedAt: "2026-09-17",
    why: '`$SCRIPT_DIR` e derivado da LOCALIZACAO do script em runtime; o valor real e `scripts/check_utf8.mjs` (existe) e o `elif [ -f "$SCRIPT_DIR/check_utf8.mjs" ]` do check-utf8.sh confere o arquivo antes de usa-lo',
  },
  {
    match: "$PY $PY_SCRIPT",
    addedAt: "2026-09-17",
    why: "o PROGRAMA e uma variavel (`PY` = python3|python|node, escolhido por probe em runtime) e o script dele tambem (`PY_SCRIPT` = `$SCRIPT_DIR/check_{crlf,blob_crlf}.{py,mjs}`): nenhuma leitura prova qual executavel roda, e a escolha E o fallback declarado dos dois scripts",
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
      // `<( ... )` e `>( ... )` NAO tem destino: sao substituicoes de PROCESSO, e
      // o comando de dentro DELAS executa. O token lexico comeca com `(`
      // (`(git`), e comer esse token como "destino do redirecionamento" era o que
      // fazia o `git ls-files` de um `mapfile -t X < <(git ls-files ...)`
      // desaparecer do julgamento em silencio.
      const proximo = tokens[i + 1]
      if (proximo?.tipo === "palavra" && proximo.valor.startsWith("(")) {
        saida.push(t)
        continue
      }
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
  /** Dentro de aspas DUPLAS: ali `$(` EXECUTA (e o `#` nao abre comentario). */
  let aspasDuplas = false

  /** Copia um trecho CRU, contando as quebras de linha dele. */
  const copia = (texto) => {
    linha += (texto.match(/\n/g) ?? []).length
    mascarado += texto
  }

  while (i < content.length) {
    const c = content[i]
    // ESCAPE: `\$(` nao e uma substituicao — e o TEXTO `$(`. Sem esta regra, o
    // regex de uma linha (`out=\$\([^)]*\)`) virava uma substituicao ABERTA e o
    // mascaramento engolia o resto do arquivo.
    if (c === "\\" && i + 1 < content.length) {
      copia(content.slice(i, i + 2))
      i += 2
      continue
    }
    // ASPAS SIMPLES: nada dentro delas executa — nem `$(`, nem `#`.
    if (!aspasDuplas && c === "'") {
      const fim = content.indexOf("'", i + 1)
      const trecho = fim === -1 ? content.slice(i) : content.slice(i, fim + 1)
      copia(trecho)
      i += trecho.length
      continue
    }
    if (c === '"') aspasDuplas = !aspasDuplas
    // COMENTARIO: o `#` so abre um quando INICIA uma palavra (a mesma regua do
    // tokenizador). O texto dele NAO executa, e um `$(` citado dentro dele nao e
    // uma substituicao — foi assim que a descida nos scripts revelou o defeito:
    // um comentario explicando `out=$(...)` virava um comando fantasma.
    if (!aspasDuplas && c === "#" && (i === 0 || /[\s;|&(]/.test(content[i - 1]))) {
      const fim = content.indexOf("\n", i)
      const trecho = fim === -1 ? content.slice(i) : content.slice(i, fim)
      copia(trecho)
      i += trecho.length
      continue
    }
    if (c === "$" && content[i + 1] === "(") {
      let nivel = 0
      let j = i + 1
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
        copia(content.slice(i))
        break
      }
      const span = content.slice(i, j + 1)
      const quebras = (span.match(/\n/g) ?? []).length
      if (content[i + 2] !== "(") substituicoes.push({ texto: content.slice(i + 2, j), linha })
      mascarado += SUBSTITUICAO + "\n".repeat(quebras)
      linha += quebras
      i = j + 1
      continue
    }
    copia(c)
    i += 1
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
/**
 * O token esta na posicao em que um COMANDO comeca (onde `case` e palavra-chave)?
 *
 * Sem isto, um `case` usado como ARGUMENTO (`echo case`) abriria um bloco de
 * padroes que nao existe, e o guard ignoraria o resto do arquivo em silencio.
 */
function emPosicaoDeComando(indice, tokens) {
  const anterior = tokens[indice - 1]
  if (anterior === undefined) return true
  if (anterior.tipo === "op" && [";", "|", "&"].includes(anterior.raw)) return true
  if (tokens[indice].linha > anterior.linha) return true
  return ["do", "then", "else", "elif", "in", "("].includes(anterior.valor)
}

/**
 * Os indices dos tokens que sao PADROES de um `case` (o `|` entre padroes
 * incluido): eles NAO sao comandos.
 *
 * O `case` e a unica construcao do shell em que uma PALAVRA aparece onde um
 * comando apareceria sem ser um comando — e os scripts que os hooks chamam usam
 * `case` em TODO parsing de argumento (`case "$arg" in --ci) ... ;; -h|--help)
 * ... ;; esac`). Sem este estado, a descida reprovava o `--ci)` e o `-h|--help)`
 * de um script bem escrito: o defeito estava na regua, nao no script.
 *
 * Estados: fora → (`case`) cabecalho → (`in`) padrao → (token terminado em `)`)
 * corpo → (`;;`) padrao → (`esac`) fora. O `;;` chega como DOIS `;` (o
 * tokenizador nao tem `;;`), entao a volta ao estado de padrao e detectada no
 * PAR de operadores.
 *
 * @param {{tipo: string, raw: string, valor: string, linha: number}[]} tokens
 * @returns {Set<number>}
 */
function padroesDeCase(tokens) {
  const ignorar = new Set()
  let estado = "fora"
  let profundidade = 0
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    const valor = token.valor
    const chamadaDeCase = valor === "case" && emPosicaoDeComando(i, tokens)
    if (estado === "fora") {
      if (chamadaDeCase) {
        profundidade++
        estado = "cabecalho"
      }
      continue
    }
    if (estado === "cabecalho") {
      if (valor === "in") estado = "padrao"
      continue
    }
    if (estado === "padrao") {
      ignorar.add(i)
      // O `esac` chega AQUI (depois do `;;` do ultimo ramo nao ha padrao
      // nenhum): sem esta saida o estado de padrao seguiria ate o fim do
      // arquivo, e o guard pularia em SILENCIO tudo o que vem depois do `case`.
      if (valor === "esac") {
        profundidade--
        estado = profundidade > 0 ? "corpo" : "fora"
        continue
      }
      if (valor.endsWith(")")) estado = "corpo"
      continue
    }
    if (chamadaDeCase) {
      profundidade++
      estado = "cabecalho"
      continue
    }
    if (valor === "esac") {
      profundidade--
      ignorar.add(i)
      estado = profundidade > 0 ? "corpo" : "fora"
      continue
    }
    if (
      token.tipo === "op" &&
      valor === ";" &&
      tokens[i - 1]?.tipo === "op" &&
      tokens[i - 1]?.valor === ";"
    ) {
      ignorar.add(i)
      estado = "padrao"
    }
  }
  return ignorar
}

function segmenta(texto, startLine, origem) {
  const comandos = []
  const tokens = stripRedirections(shellTokens(texto, { startLine }))
  // Os PADROES de um `case` saem do julgamento AQUI, antes de virarem comando:
  // `--ci)` e `-h|--help)` sao padroes, nao programas (ver `padroesDeCase`).
  const padroes = padroesDeCase(tokens)
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
    // O `(` COLADO no inicio do programa (`(git ls-files ...`): ele abre uma
    // subshell / substituicao de PROCESSO, e o programa e o que vem DEPOIS dele.
    // Sem este descolamento, o `(git` virava o nome de um programa que ninguem
    // escreveu (e o `git ls-files` de dentro do `<( ... )` deixava de ser julgado).
    let nome = programa.valor
    while (nome.startsWith("(")) nome = nome.slice(1)
    if (nome === "") return
    // Um programa terminado em `)` NAO e um comando: em shell isso e erro de
    // sintaxe (o `)` fecha o padrao de um `case` ou o parentese de um processo /
    // substituicao `<( ... )`), e o tokenizador nao separa `)` porque ele nao e um
    // OPERADOR (`true)` chega colado). Julgar `true)` seria julgar um nome que o
    // shell nunca executa — e a regra e o que sobrou de legitimo para os `)` que
    // o `case` nao explica.
    if (programa.valor.endsWith(")")) return
    comandos.push({
      linha: programa.linha,
      programa: nome,
      tokens: atual
        .slice(programa.indice + 1)
        .filter((t) => t.tipo !== "op")
        .map((t) => t.valor),
      origem,
    })
  }
  for (const [indice, token] of tokens.entries()) {
    if (padroes.has(indice)) continue
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
    // O `(` COLADO no inicio de uma palavra abre uma subshell / substituicao de
    // processo: o buffer ANTERIOR fecha e o token comeca o proximo comando. Sem
    // isto, `mapfile -t FILES < <(git ls-files ...)` tinha o `(git` como
    // ARGUMENTO do `mapfile`, e o `git ls-files` de dentro do `<( ... )` nunca era
    // julgado (a mesma cegueira, um nivel abaixo).
    if (token.valor.startsWith("(")) {
      fecha()
      buffer.push(token)
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

// =============================================================================
// A DESCIDA: o que os scripts de shell que o hook CHAMA executam por dentro
// =============================================================================
//
// O hook real nao lista os 17 guards de encoding: ele chama UM script
// (`bash scripts/run-encoding-guards.sh`) que chama os outros. Sem descer, o
// guard julgaria o CAMINHO do runner — e uma linha tipada DENTRO dele (`bash
// scripts/check-utf8-sh`, ou `node scripts/check-utf8-scope.mjs` renomeado)
// seria um passo que NUNCA roda, invisivel para o gate, num arquivo que roda em
// todo commit. Parar no alvo do `bash` era exatamente essa cegueira.
//
// A superficie da descida e DECLARADA: so o que um INTERPRETADOR DE SHELL (ou
// um `source`) le como texto de shell. Um `node scripts/x.mjs` NAO desce — o que
// um programa em JS executa por dentro e outra superficie (imports, spawn), e
// julga-la aqui seria inventar um parser de JS neste guard.

/** Os interpretadores que leem o alvo como TEXTO DE SHELL (a superficie da descida). */
export const SHELL_INTERPRETERS = new Set(["bash", "sh", "dash", "zsh"])

/**
 * O teto de profundidade da descida: hook (0) → script (1) → script (2)...
 *
 * Existe para uma cadeia longa (ou um ciclo) nao virar recursao sem fim; quando
 * ele morde, o guard NOMEIA onde parou (`limites`) em vez de fingir que julgou.
 */
export const MAX_SCRIPT_DEPTH = 4

/**
 * O arquivo de SHELL que este comando manda executar, ou null.
 *
 * Um flag no lugar do arquivo (`bash -c`, `bash -e`), um caminho montado em
 * runtime (`bash "$ALVO"`), um padrao de glob e um caminho absoluto NAO descem:
 * o primeiro nao nomeia arquivo (o guard ja o diz indeterminado), o segundo nao
 * existe como texto, o terceiro e um conjunto e o quarto vive fora do repositorio.
 *
 * @param {{programa: string, tokens: string[]}} comando
 * @returns {string|null}
 */
export function scriptAlvo(comando) {
  const alvo = comando.tokens[0]
  if (alvo === undefined || alvo === "") return null
  if (alvo.startsWith("-") || alvo.startsWith("$") || alvo.startsWith("/")) return null
  if (/[*?[]/.test(alvo)) return null
  if (SHELL_INTERPRETERS.has(comando.programa)) return alvo
  if (SOURCE_COMMANDS.has(comando.programa)) return alvo
  return null
}

/** Todos os arquivos que um `source`/`.` do hook carrega (e que tem de existir). */
function comandosDeScript(root, entrada, scripts, profundidade = 0) {
  const texto = scripts[entrada]
  if (typeof texto !== "string" || profundidade > 3) return []
  const resolvido = resolveCommand(`bun run ${entrada}`, scripts, profundidade)
  if (resolvido === `bun run ${entrada}`) return []
  return shellCommands(resolvido, { origem: `package.json scripts.${entrada}` })
} /**
 * O ALVO que o remendo troca: o token que não existe, a linha e o papel dele na
 * linha (é o que a mensagem do plano mostra).
 *
 * @typedef {{de: string, linha: number, papel: string, origem: string}} AlvoDoRemendo
 * @typedef {{desfecho: "resolvido"|"violacao"|"indeterminado", motivo: string, remendo?: AlvoDoRemendo}} Veredito
 * @typedef {{arquivo: string, linha: number, de: string, para: string, papel: string, distancia: number}} ItemDoPlano
 * @typedef {{arquivo: string, linha: number, programa: string, motivo: string}} RecusaDoRemendo
 */

/**
 * O veredito de UM comando.
 *
 * O que o guard NAO consegue provar por leitura (payload de runtime, caminho
 * montado em `$VAR`) nao passa em silencio: ele tem de estar em INDETERMINATE,
 * com a data e o motivo. `indeterminado` no relatorio significa "DECLARADO e
 * nao provavel", nunca "nao olhei".
 *
 * @returns {Veredito}
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

/**
 * O veredito antes da regra do "indeterminado tem de estar declarado".
 *
 * @returns {Veredito}
 */
function classificaBruto(comando, ctx) {
  const { programa, tokens } = comando
  const texto = [programa, ...tokens].join(" ")

  for (const entrada of ctx.allowlist) {
    if (texto.startsWith(entrada.match))
      return { desfecho: "resolvido", motivo: `allowlist (${entrada.addedAt})` }
  }
  if (ctx.funcoes.has(programa)) return { desfecho: "resolvido", motivo: "função do próprio hook" }

  // O PROGRAMA que e uma VARIAVEL (`"$PY" "$PY_SCRIPT"`): o nome do executavel
  // so existe em runtime, e nenhuma leitura o prova — o mesmo argumento que o
  // guard ja aplica ao CAMINHO de um interpretador. Acusar `$PY` de "nao ser
  // arquivo do repositorio" seria falso duas vezes (nao e um nome) e um falso
  // positivo num gate bloqueante; o caminho honesto e `indeterminado` + a
  // declaracao datada, como qualquer outro payload de runtime.
  if (programa.startsWith("$"))
    return {
      desfecho: "indeterminado",
      motivo: `programa montado em runtime (\`${programa}\`)`,
    }

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
    return julgaCaminho(ctx, alvo, `script do ${programa}`, comando.linha, comando.origem)
  }

  if (SOURCE_COMMANDS.has(programa)) {
    const alvo = tokens[0]
    if (alvo === undefined) return { desfecho: "indeterminado", motivo: `${programa} sem arquivo` }
    return julgaCaminho(ctx, alvo, `${programa} de`, comando.linha, comando.origem)
  }

  if (PACKAGE_MANAGERS.has(programa)) return julgaGerenciador(ctx, comando)

  if (programa.includes("/"))
    return julgaCaminho(ctx, programa, "execução direta", comando.linha, comando.origem)

  if (EXTERNAL_TOOLS.has(programa))
    return { desfecho: "resolvido", motivo: "ferramenta externa declarada" }

  if (SHELL_BUILTINS.has(programa))
    return { desfecho: "resolvido", motivo: "comando do próprio shell (builtin)" }

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

/**
 * O caminho citado existe? (o alvo do guard)
 *
 * A violação carrega o `remendo`: o TOKEN que o `--fix` troca e a linha dele.
 * Essa é a única coisa que o remendo precisa para agir — sem ela o `--fix`
 * teria de REDESCOBRIR qual token era, e uma segunda descoberta divergiria da
 * diagnose (o defeito clássico: o gate acusa um caminho e o conserto mexe em
 * outro).
 *
 * O `origem` viaja junto com o TOKEN (e não só com a linha do relatório): um
 * comando interno de `bun run` tem a LINHA do texto do script do package.json e a
 * origem dele — é essa dupla que diz ao remendo que este token NÃO vive no hook.
 *
 * @param {{root: string}} ctx
 * @param {string} alvo
 * @param {string} papel
 * @param {number} linha
 * @param {string} origem
 * @returns {Veredito}
 */
function julgaCaminho(ctx, alvo, papel, linha, origem) {
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
    remendo: { de: alvo, linha, papel, origem },
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

/** `bun run <entrada>` / `bun <entrada>` / `bun x <pacote>`.
 *
 * @returns {Veredito}
 */
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
        // O ALVO do defeito INTERNO viaja junto: assim o relatório diz QUAL token
        // e de ONDE ele veio, e o remendo consegue RECUSAR pelo nome (o token vive
        // no package.json; a linha que o hook acusa é outra) em vez de procurá-lo
        // na linha errada do hook. Sem esta propagação, "não é um caminho" seria
        // a única resposta possível — verdadeira, mas inútil para quem conserta.
        remendo: violado.remendo,
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
  /** Os scripts de shell cujo INTERIOR foi julgado (a descida). */
  const scriptsDescentidos = []
  /** Os mesmos scripts, para nao julgar o MESMO arquivo duas vezes. */
  const descidos = new Set()
  /**
   * Onde a descida PAROU (ciclo ou teto de profundidade). A linha NAO fica
   * muda: um limite nomeado e a diferenca entre "nao ha o que julgar la dentro"
   * e "nao fui olhar la dentro".
   */
  const limites = []
  // As FUNCOES de TODOS os hooks primeiro: o pre-commit define `wait_all` e o
  // pre-push poderia chama-la — a fonte e o texto do hook, nao uma lista a mao.
  for (const rel of hooks) {
    const content = readFileSync(join(root, rel), "utf8")
    for (const nome of definedFunctions(content)) ctx.funcoes.add(nome)
  }

  /**
   * Julga os comandos de UM texto de shell e DESCE nos scripts de shell que ele
   * manda executar (recursivo, com ciclo e teto declarados).
   *
   * As FUNCOES VISIVEIS mudam de acordo com a FORMA da chamada, e isso e a
   * semantica do shell, nao um detalhe: um `bash script.sh` cria um processo
   * NOVO (o script ve so as funcoes que ele mesmo define), enquanto um `source`
   * executa no MESMO shell (herda as do chamador). Herdar as do hook no caso do
   * `bash` deixaria um nome que nao existe la dentro passar como resolvido —
   * exatamente o falso verde que a descida existe para fechar.
   *
   * @param {string} arquivo
   * @param {string} content
   * @param {{origem?: string, funcoes?: Set<string>, profundidade?: number, cadeia?: Set<string>}} [opcoes]
   */
  const julga = (arquivo, content, opcoes = {}) => {
    const { origem = "", funcoes = ctx.funcoes, profundidade = 0, cadeia = new Set() } = opcoes
    const contexto = funcoes === ctx.funcoes ? ctx : { ...ctx, funcoes }
    for (const comando of shellCommands(content, { origem })) {
      const veredito = classify(comando, contexto)
      relatorios.push({ arquivo, ...comando, ...veredito })
      // So se DESCE no que resolveu: um comando ja reprovado nao tem alvo
      // confiavel para ler (e a violacao dele e o veredito).
      if (veredito.desfecho !== "resolvido") continue
      const alvo = scriptAlvo(comando)
      if (alvo === null || !arquivoExiste(root, alvo)) continue
      const chamador = `${arquivo}:${comando.linha}`
      if (cadeia.has(alvo) || profundidade >= MAX_SCRIPT_DEPTH) {
        limites.push({
          arquivo,
          linha: comando.linha,
          programa: comando.programa,
          alvo,
          motivo: cadeia.has(alvo)
            ? `CICLO: \`${alvo}\` ja esta na cadeia (${[...cadeia].join(" → ")} → ${alvo}) — o que ele executa NAO foi julgado`
            : `PROFUNDIDADE: \`${alvo}\` passa do teto de ${MAX_SCRIPT_DEPTH} niveis a partir do hook — o que ele executa NAO foi julgado`,
        })
        continue
      }
      // Um script JA julgado nao e julgado de novo. O runner dos guards de
      // encoding e chamado pelos DOIS hooks: julgar de novo daria o MESMO texto,
      // os MESMOS comandos e a MESMA violacao duas vezes — a contagem dobraria e
      // cada defeito apareceria duplicado por um motivo que nao e dele. O que o
      // `descidos` descarta e a SEGUNDA leitura do mesmo arquivo, nunca uma
      // cobertura: o `scripts` do relatorio lista cada script UMA vez.
      if (descidos.has(alvo)) continue
      const texto = readFileSync(join(root, alvo), "utf8")
      if (!scriptsDescentidos.includes(alvo)) scriptsDescentidos.push(alvo)
      descidos.add(alvo)
      julga(alvo, texto, {
        origem: chamador,
        funcoes: SOURCE_COMMANDS.has(comando.programa)
          ? new Set([...funcoes, ...definedFunctions(texto)])
          : new Set(definedFunctions(texto)),
        profundidade: profundidade + 1,
        cadeia: new Set([...cadeia, alvo]),
      })
    }
  }

  for (const rel of hooks) {
    const content = readFileSync(join(root, rel), "utf8")
    julga(rel, content)
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
    scripts: scriptsDescentidos.sort(),
    limites,
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

// =============================================================================
// O REMENDO: o caminho tipado, corrigido pelo VIZINHO mais próximo
// =============================================================================
//
// O guard responde "este caminho NÃO existe no repositório — o mais próximo é
// `X`". O remendo fecha a distância entre a DIAGNOSE e o CONSERTO: troca o token
// pelo vizinho, mostra o antes/depois e PERGUNTA antes de gravar.
//
// POR QUE ELE É MAIS ESTRITO QUE A MENSAGEM (decisão, não descuido): a mensagem
// SUGERE com teto de distância 4 — ela é um aviso, e um aviso errado custa uma
// leitura. O remendo GRAVA, e um remendo errado num hook muda o que roda em TODO
// commit. Então ele só grava quando não há dúvida: distância de até
// `FIX_MAX_DISTANCE` caracteres, UM único candidato nessa distância (empate é
// recusa: quem decide é o operador), candidato é ARQUIVO (um diretório não é
// alvo de `node`/`source`) e token localizado SEM ambiguidade na linha.
//
// O QUE ELE NÃO REMENDA (escopo declarado, não esquecimento): a entrada de `bun
// run` que não existe em `scripts` (trocar uma entrada por outra MUDA o que o
// hook executa — `bun run <binário>` e `bun run <script>` não são a mesma coisa,
// e o vizinho de um nome de script não é uma correção), a função chamada e não
// definida, o binário sem fornecedor, o payload de runtime não declarado e o
// token que vive num SCRIPT CHAMADO pelo hook (o remendo escreve em `.husky/`,
// não no script — e quem edita o script é quem o conhece). Cada uma dessas sai
// NOMEADA no plano, com o motivo — nunca em silêncio.
//
// O `.husky/` É O ARQUIVO QUE O HOOK EXECUTA, e por isso quem remenda por dentro
// do pre-commit não pode continuar a MESMA execução depois do remendo. MEDIDO
// (casca de 12.957 bytes reescrita no meio da própria execução, `sh -e` como o
// husky usa): exit 127 com `B39: not found` numa linha POSTERIOR — o
// interpretador lê por deslocamento, e mudar o tamanho do arquivo desalinha o
// que ele ainda vai ler. Sem a reescrita, o MESMO arquivo sai 0. É por isso que
// a classe do remédio carrega `exigeRelancamento`: o remendo vai para a ÁRVORE e
// para o ÍNDICE, e o veredito do commit é dado por um `git commit` NOVO.

/** O teto de DISTÂNCIA de edição que o remendo aceita (a mensagem do guard usa 4). */
export const FIX_MAX_DISTANCE = 2

/**
 * O vizinho ACEITO pelo remendo: o ÚNICO candidato a até `FIX_MAX_DISTANCE` de
 * distância. Empate não é escolha — é recusa (dois nomes plausíveis = o remendo
 * estaria adivinhando), e nenhum candidato perto o bastante também não é.
 *
 * @param {string} procurado
 * @param {string[]} candidatos
 * @returns {{aceito: {nome: string, distancia: number}|null, ambiguos: string[]}}
 */
export function vizinhoAceito(procurado, candidatos) {
  const teto = FIX_MAX_DISTANCE + 1
  /** @type {string[]} */
  let melhores = []
  let melhor = teto
  for (const candidato of candidatos) {
    const d = distancia(procurado, candidato, teto)
    if (d < melhor) {
      melhor = d
      melhores = [candidato]
    } else if (d === melhor) {
      melhores.push(candidato)
    }
  }
  if (melhor > FIX_MAX_DISTANCE) return { aceito: null, ambiguos: [] }
  if (melhores.length > 1) return { aceito: null, ambiguos: melhores }
  return { aceito: { nome: melhores[0], distancia: melhor }, ambiguos: [] }
}

/**
 * ONDE o token está, em OFFSETS absolutos do texto do arquivo.
 *
 * A varredura é da LINHA LÓGICA (a linha do comando MAIS as continuações `\`):
 * num `node \` com a quebra logo depois, o caminho está na linha SEGUINTE e o
 * relatório aponta a linha do COMANDO. Devolve `null` quando não achou, quando
 * achou mais de uma vez, ou quando o achado está colado a outros caracteres de
 * caminho (`check-x.mjs.bak` não é `check-x.mjs`) — nos três casos o remendo NÃO
 * adivinha, e a recusa é dita.
 *
 * @param {string} fonte
 * @param {number} linha
 * @param {string} alvo
 * @returns {{inicio: number, fim: number}|null}
 */
export function localizaToken(fonte, linha, alvo) {
  const linhas = fonte.split("\n")
  const i = linha - 1
  if (i < 0 || i >= linhas.length || alvo === "") return null
  let inicio = 0
  for (let k = 0; k < i; k++) inicio += linhas[k].length + 1
  let texto = linhas[i]
  for (let j = i; j + 1 < linhas.length && /\\\s*$/.test(linhas[j]); j++) {
    texto += "\n" + linhas[j + 1]
  }
  const deCaminho = /[A-Za-z0-9_./-]/
  /** @type {number[]} */
  const achados = []
  for (let p = texto.indexOf(alvo); p !== -1; p = texto.indexOf(alvo, p + 1)) {
    const antes = p === 0 ? "" : texto[p - 1]
    const depois = texto[p + alvo.length] ?? ""
    if (antes !== "" && deCaminho.test(antes)) continue
    if (depois !== "" && deCaminho.test(depois)) continue
    achados.push(p)
  }
  if (achados.length !== 1) return null
  return { inicio: inicio + achados[0], fim: inicio + achados[0] + alvo.length }
}

/** O número da linha FÍSICA que contém um offset do texto (1-based). */
function linhaFisica(fonte, offset) {
  let linha = 1
  for (let i = 0; i < offset && i < fonte.length; i++) if (fonte[i] === "\n") linha++
  return linha
}

/** Os ARQUIVOS do mesmo diretório do alvo (a fonte do vizinho). */
function irmaosArquivos(root, alvo) {
  const partes = alvo.split("/")
  partes.pop()
  const dir = join(root, partes.join("/"))
  if (partes.length === 0 || !existsSync(dir) || !statSync(dir).isDirectory()) return []
  return readdirSync(dir).filter((nome) => {
    try {
      return statSync(join(dir, nome)).isFile()
    } catch {
      return false
    }
  })
}

/**
 * O PLANO do remendo: o token que sai e o vizinho que entra, por arquivo.
 *
 * Nada é gravado aqui — o plano é o que se MOSTRA e o que a pergunta autoriza.
 * Toda violação que o remendo não conserta entra em `recusas` com o motivo: é o
 * que separa "nada a remendar nesta árvore" de "há violação e ela não é desta
 * classe mecânica" (o remédio do pre-commit mantém o commit BLOQUEADO no
 * segundo caso, em vez de deixar o defeito da entrada de `bun run` passar por
 * não ser remendável).
 *
 * @param {string} [root]
 * @param {{now?: number, reviewDays?: number, report?: object|null}} [opts]
 * @returns {{infra: boolean, plano: ItemDoPlano[], recusas: RecusaDoRemendo[], report: object}}
 */
export function planoDeRemendo(
  root = ROOT,
  { now = Date.now(), reviewDays = HOOK_COMMANDS_REVIEW_DAYS, report = null } = {},
) {
  const rel = /** @type {ReturnType<typeof analyze>} */ (
    report ?? analyze({ root, now, reviewDays })
  )
  if (rel.infra) return { infra: true, plano: [], recusas: [], report: rel }
  // Os arquivos que o remendo ESCREVE: os HOOKS. Um comando de dentro de um
  // script chamado (`bash scripts/run-encoding-guards.sh`) tem o token no SCRIPT
  // — é lá que a linha do relatório aponta — e o remendo deste guard não escreve
  // fora de `.husky/`. A recusa é NOMEADA (nunca um silêncio que se lê como
  // "não havia nada a fazer").
  const hooksDoRoot = new Set(rel.hooks)
  /** @type {Map<string, string>} */
  const cache = new Map()
  const fonte = (arquivo) => {
    if (!cache.has(arquivo)) cache.set(arquivo, readFileSync(join(root, arquivo), "utf8"))
    return cache.get(arquivo) ?? ""
  }
  /** @type {ItemDoPlano[]} */
  const plano = []
  /** @type {RecusaDoRemendo[]} */
  const recusas = []
  for (const v of rel.violacoes) {
    const onde = { arquivo: v.arquivo, linha: v.linha, programa: v.programa }
    if (v.remendo === undefined) {
      recusas.push({
        ...onde,
        motivo: `o remendo troca CAMINHO por vizinho, e esta violação não é um caminho — ${v.motivo}`,
      })
      continue
    }
    // O TOKEN TEM DE ESTAR NO ARQUIVO DO HOOK. A linha de um comando INTERNO (o
    // que uma entrada de `bun run` executa) é a linha do TEXTO DO SCRIPT do
    // package.json, não a linha do hook — e o `arquivo` da linha do relatório é o
    // hook. Sem esta regra, o remendo procuraria o token no hook pela linha do
    // OUTRO arquivo: no melhor caso não o achava (uma recusa confusa), no pior
    // achava uma ocorrência que nada tem a ver (um comentário, por exemplo) e
    // reescrevia o hook por causa de um defeito que vive no package.json. O dono
    // daquele token é outro arquivo, e o remendo deste guard não escreve nele.
    // A LINHA DO TOKEN é a do `remendo`, não a da linha do relatório: num comando
    // interno as duas divergem (a linha do relatório é a do hook; a do token é a
    // do TEXTO do script) — e é na linha do token que a troca acontece.
    const { de, papel, origem, linha: linhaDoToken } = v.remendo
    if (!hooksDoRoot.has(v.arquivo)) {
      recusas.push({
        ...onde,
        motivo:
          `\`${v.arquivo}\` não é um hook: é um SCRIPT que o hook executa` +
          (v.origem === "" ? "" : ` (chamado em \`${v.origem}\`)`) +
          ` — o remendo só escreve em \`${HOOKS_DIR}/\`, então este token se corrige` +
          ` no próprio script`,
      })
      continue
    }
    if (origem !== "" && origem !== "substituição") {
      recusas.push({
        ...onde,
        motivo:
          `\`${de}\` é de \`${origem}\` — o token não vive neste hook, e o remendo só troca o que` +
          ` ele consegue conferir na linha que acusa (a linha de um comando interno é a do TEXTO` +
          ` do script, não a do hook)`,
      })
      continue
    }
    const nome = basename(de)
    // O diretório como o hook o ESCREVEU (é ele que o remendo preserva no
    // destino): a recusa cita os candidatos com o MESMO prefixo, para a mensagem
    // ser copiável em vez de deixar o operador adivinhar em que pasta eles estão.
    const pasta = de.slice(0, de.length - nome.length)
    const { aceito, ambiguos } = vizinhoAceito(nome, irmaosArquivos(root, de))
    if (ambiguos.length > 1) {
      recusas.push({
        ...onde,
        motivo:
          `EMPATE: ${ambiguos.map((a) => `\`${pasta}${a}\``).join(", ")} estão à MESMA distância de` +
          ` \`${de}\` — quem escolhe é o operador, não o remendo`,
      })
      continue
    }
    if (aceito === null) {
      recusas.push({
        ...onde,
        motivo:
          `sem vizinho a até ${FIX_MAX_DISTANCE} caractere(s) de diferença de \`${de}\` (a mensagem` +
          ` do guard sugere com teto maior; o remendo não grava sugestão)`,
      })
      continue
    }
    if (localizaToken(fonte(v.arquivo), linhaDoToken, de) === null) {
      recusas.push({
        ...onde,
        motivo:
          `\`${de}\` não é localizável sem ambiguidade em ${v.arquivo}:${linhaDoToken} — corrija à` +
          ` mão (o remendo não escolhe QUAL ocorrência é, nem procura o token em outra linha)`,
      })
      continue
    }
    plano.push({
      arquivo: v.arquivo,
      linha: linhaDoToken,
      de,
      para: pasta + aceito.nome,
      papel,
      distancia: aceito.distancia,
    })
  }
  return { infra: false, plano, recusas, report: rel }
}

/**
 * Os caminhos que o remendo escreve — o que o remédio do pre-commit re-estagia.
 *
 * @param {ItemDoPlano[]} plano
 * @returns {string[]}
 */
export function arquivosDoRemendo(plano) {
  return [...new Set(plano.map((p) => p.arquivo))].sort()
}

/**
 * O TEXTO do plano — o que se mostra ANTES da pergunta: cada troca com a linha
 * de ANTES e a de DEPOIS, e cada recusa com o motivo.
 *
 * @param {string} root
 * @param {{plano?: ItemDoPlano[], recusas?: RecusaDoRemendo[]}} plano
 * @returns {string}
 */
export function renderPlano(root, { plano = [], recusas = [] } = {}) {
  /** @type {string[]} */
  const linhas = []
  for (const p of plano) {
    linhas.push(
      `   · ${p.arquivo}:${p.linha}  \`${p.de}\` → \`${p.para}\` (distância ${p.distancia} — ${p.papel})`,
    )
    const fonte = readFileSync(join(root, p.arquivo), "utf8")
    const span = localizaToken(fonte, p.linha, p.de)
    if (span === null) continue
    const n = linhaFisica(fonte, span.inicio)
    const depois = fonte.slice(0, span.inicio) + p.para + fonte.slice(span.fim)
    linhas.push(`     antes:  ${(fonte.split("\n")[n - 1] ?? "").trim()}`)
    linhas.push(`     depois: ${(depois.split("\n")[n - 1] ?? "").trim()}`)
  }
  for (const r of recusas) linhas.push(`   ⛔ ${r.arquivo}:${r.linha} — ${r.motivo}`)
  return linhas.join("\n")
}

/**
 * Aplica o plano: re-localiza TUDO (o plano pode ter esperado a resposta do
 * operador — e o arquivo pode ter mudado nesse meio) e grava.
 *
 * A escrita é CIRÚRGICA: só o token troca, no lugar dele — o hook é um arquivo
 * de centenas de linhas com comentários que EXPLICAM decisões, e uma reescrita
 * que passasse por um formatador destruiria justamente o que não se reconstrói.
 * As trocas de um arquivo são aplicadas do FIM para o COMEÇO, de modo que os
 * offsets localizados no texto original continuem válidos.
 *
 * É all-or-nothing POR ARQUIVO: se uma das trocas daquele arquivo não localiza
 * mais, NENHUMA outra dele é gravada — meia correção é pior que nenhuma, porque
 * deixaria o arquivo num estado que ninguém autorizou.
 *
 * @param {string} root
 * @param {ItemDoPlano[]} plano
 * @returns {{aplicados: ItemDoPlano[], recusados: {arquivo: string, motivo: string}[]}}
 */
export function aplicarRemendo(root, plano) {
  /** @type {ItemDoPlano[]} */
  const aplicados = []
  /** @type {{arquivo: string, motivo: string}[]} */
  const recusados = []
  /** @type {Map<string, ItemDoPlano[]>} */
  const porArquivo = new Map()
  for (const item of plano) {
    const lista = porArquivo.get(item.arquivo) ?? []
    lista.push(item)
    porArquivo.set(item.arquivo, lista)
  }
  for (const [arquivo, itens] of porArquivo) {
    const caminho = join(root, arquivo)
    const fonte = readFileSync(caminho, "utf8")
    /** @type {{item: ItemDoPlano, span: {inicio: number, fim: number}}[]} */
    const localizados = []
    /** @type {ItemDoPlano|null} */
    let faltou = null
    for (const item of itens) {
      const span = localizaToken(fonte, item.linha, item.de)
      if (span === null) {
        faltou = item
        break
      }
      localizados.push({ item, span })
    }
    if (faltou !== null) {
      recusados.push({
        arquivo,
        motivo:
          `\`${faltou.de}\` (linha ${faltou.linha}) sumiu ou ficou ambíguo desde o plano —` +
          ` este arquivo NÃO foi tocado`,
      })
      continue
    }
    let saida = fonte
    for (const l of [...localizados].sort((a, b) => b.span.inicio - a.span.inicio)) {
      saida = saida.slice(0, l.span.inicio) + l.item.para + saida.slice(l.span.fim)
      aplicados.push({ ...l.item })
    }
    writeFileSync(caminho, saida, "utf8")
  }
  return { aplicados, recusados }
}

/**
 * A PERGUNTA que autoriza o remendo, com a MESMA régua do remédio do pre-commit
 * (`confirm-prompt.mjs`): terminal de CONTROLE quando o stdin não é um terminal,
 * default NÃO, teto da espera e o desligamento declarado. Sem terminal nenhum
 * ela NÃO acontece: o plano é impresso, o caminho à mão é dito e nada é gravado
 * (fail-closed). `--yes` é a confirmação DECLARADA por quem chama.
 *
 * @param {string} pergunta
 * @param {{isTTY?: boolean, askFn?: Function|null, openTty?: Function, noPrompt?: boolean,
 *   ttyWaitMs?: number, yes?: boolean, log?: Function}} [deps]
 * @returns {Promise<{autorizado: boolean, motivo: string|null}>}
 */
export async function confirma(
  pergunta,
  {
    isTTY = Boolean(process.stdin.isTTY),
    askFn = null,
    openTty = openTerminal,
    noPrompt = noPromptEnv(),
    ttyWaitMs = TTY_WAIT_MS,
    yes = false,
    log = (m) => process.stderr.write(`${m}\n`),
  } = {},
) {
  if (yes) return { autorizado: true, motivo: "--yes: a confirmação já foi dada por quem chama" }
  // Sem `askFn` injetado e com o stdin não-terminal, quem pergunta é o TERMINAL
  // DE CONTROLE — o caso MEDIDO do `git commit` (o git liga o fd 0 em
  // `/dev/null`). Não abriu: não há a quem perguntar, e aí NÃO se pergunta.
  const tty = !isTTY && askFn === null && !noPrompt ? openTty() : null
  if (!isTTY && askFn === null && tty === null) {
    log(
      `\n❌ SEM TERMINAL: o remendo exige confirmação explícita, e aqui não há a quem perguntar\n` +
        (noPrompt
          ? `   (a pergunta está DESLIGADA pelo ambiente)\n`
          : `   (/dev/tty não abriu: esta sessão não tem terminal de controle).\n`),
    )
    return { autorizado: false, motivo: "sem terminal" }
  }
  const alvo = { input: tty?.input ?? process.stdin, output: tty?.output ?? process.stderr }
  const resposta = await (
    askFn ?? ((q) => ask(q, { ...alvo, waitMs: tty === null ? 0 : ttyWaitMs }))
  )(pergunta)
  if (tty !== null) {
    tty.input.destroy()
    tty.output.destroy()
  }
  if (resposta === TIMEOUT) {
    log(
      `   ⏱  SEM RESPOSTA em ${Math.round(ttyWaitMs / 1000)}s — o remendo assume NÃO (o default).\n`,
    )
    return { autorizado: false, motivo: "tempo esgotado (o default é NÃO)" }
  }
  if (!isAffirmative(resposta)) {
    const dita = String(resposta).trim() === "" ? "<vazio>" : String(resposta).trim()
    log(`   ⛔ recusado (resposta: "${dita}") — NADA foi gravado.`)
    return { autorizado: false, motivo: `recusa ("${dita}")` }
  }
  return { autorizado: true, motivo: null }
}

/**
 * O `--fix`: o plano, a pergunta e a aplicação — com a REVALIDAÇÃO contando.
 *
 * O veredito do remendo não é "eu escrevi": é a SOMA do guard rodado de novo.
 * Depois de gravar, o guard é re-analisado e a conta tem de FECHAR: as violações
 * que existiam têm de cair EXATAMENTE no número de trocas aplicadas. Se cair
 * menos (uma troca que não resolveu) ou mais (uma troca que criou defeito novo),
 * o remendo diz o número e NÃO se declara verde.
 *
 * @param {string} [root]
 * @param {{yes?: boolean, isTTY?: boolean, askFn?: Function|null, openTty?: Function,
 *   noPrompt?: boolean, ttyWaitMs?: number, log?: Function, write?: Function}} [deps]
 * @returns {Promise<{code: number, aplicados: ItemDoPlano[], recusas: RecusaDoRemendo[],
 *   antes: number, depois: number|null, arquivos: string[], motivo: string|null}>}
 */
export async function fix(root = ROOT, deps = {}) {
  const {
    yes = false,
    isTTY = Boolean(process.stdin.isTTY),
    askFn = null,
    openTty = openTerminal,
    noPrompt = noPromptEnv(),
    ttyWaitMs = TTY_WAIT_MS,
    log = (m) => process.stderr.write(`${m}\n`),
    write = (t) => process.stderr.write(String(t ?? "")),
  } = deps
  const { infra, plano, recusas, report } = planoDeRemendo(root)
  if (infra) {
    log(
      `❌ ${HOOKS_DIR}/ ou package.json ausente/ilegível — sem medição não há remendo (o guard não julga esta árvore)`,
    )
    return {
      code: EXIT.UNJUDGEABLE,
      aplicados: [],
      recusas,
      antes: 0,
      depois: null,
      arquivos: [],
      motivo: null,
    }
  }
  const antes = report.violacoes.length
  log(
    `🔧 Remendo do caminho tipado: ${antes} violação(ões), ${plano.length} com vizinho inequívoco, ` +
      `${recusas.length} fora do alcance do remendo`,
  )
  if (plano.length > 0) log(`\n${renderPlano(root, { plano })}`)
  // As recusas são o que o remendo NÃO faz: mostradas sempre, para "não
  // remendei" nunca poder ser lido como "não havia nada".
  for (const r of recusas) log(`   ⛔ ${r.arquivo}:${r.linha} — ${r.motivo}`)

  const mao = () =>
    `   · o caminho à mão (o remendo só troca VIZINHO inequívoco): corrija o token\n` +
    `     apontado acima e rode \`node scripts/check-hook-commands.mjs\` de novo.`

  if (plano.length === 0) {
    if (antes === 0) {
      log(`\n✅ nada a remendar: todo comando dos hooks resolve.`)
      return {
        code: EXIT.OK,
        aplicados: [],
        recusas,
        antes,
        depois: antes,
        arquivos: [],
        motivo: null,
      }
    }
    log(
      `\n❌ há ${antes} violação(ões) e NENHUMA é remendável por vizinho — o arquivo NÃO foi tocado:\n` +
        mao(),
    )
    return {
      code: EXIT.VIOLATIONS,
      aplicados: [],
      recusas,
      antes,
      depois: antes,
      arquivos: [],
      motivo: null,
    }
  }

  log(
    `\n   O "sim" TROCA o token pelo vizinho, um por um, e REVALIDA com o próprio guard.\n` +
      `   O diff é o que se revisa.`,
  )
  const { autorizado, motivo } = await confirma(`\n   ${OFFER_MARKER} `, {
    yes,
    isTTY,
    askFn,
    openTty,
    noPrompt,
    ttyWaitMs,
    log,
  })
  if (!autorizado) {
    log(`   NADA foi gravado. O commit segue BLOQUEADO; o caminho à mão:\n${mao()}`)
    return {
      code: EXIT.VIOLATIONS,
      aplicados: [],
      recusas,
      antes,
      depois: null,
      arquivos: [],
      motivo,
    }
  }

  const { aplicados, recusados } = aplicarRemendo(root, plano)
  for (const r of recusados) log(`   ⛔ ${r.arquivo} — ${r.motivo}`)
  for (const a of aplicados) log(`✔ ${a.arquivo}:${a.linha} — \`${a.de}\` → \`${a.para}\``)

  // ── A REVALIDAÇÃO: a MESMA régua, com a CONTA fechando ────────────
  const depoisReport = analyze({ root })
  const depois = depoisReport.infra ? null : depoisReport.violacoes.length
  const arquivos = arquivosDoRemendo(aplicados)
  if (depois === null) {
    log(
      `❌ o guard não pôde ser re-medido depois do remendo (infra) — sem veredito: o remendo está\n` +
        `   na ÁRVORE e o commit segue BLOQUEADO.`,
    )
    return { code: EXIT.UNJUDGEABLE, aplicados, recusas, antes, depois, arquivos, motivo: null }
  }
  if (depois !== antes - aplicados.length) {
    log(
      `❌ a conta NÃO fechou: ${antes} violação(ões) antes, ${aplicados.length} troca(s) aplicada(s) e\n` +
        `   ${depois} depois (esperado ${antes - aplicados.length}) — o remendo NÃO se declara verde.\n` +
        `   Revise o diff: uma troca pode não resolver o que prometia ou ter revelado outro defeito.`,
    )
    write(depoisReport.violacoes.map((v) => `   • ${v.arquivo}:${v.linha} ${v.motivo}\n`).join(""))
    return { code: EXIT.VIOLATIONS, aplicados, recusas, antes, depois, arquivos, motivo: null }
  }
  if (depois === 0) {
    log(
      `✅ remendo aplicado e revalidado: ${aplicados.length} troca(s) em ${arquivos.join(", ") || "—"},\n` +
        `   e o guard voltou a ZERO violação. O remendo está na ÁRVORE — o COMMIT carrega o ÍNDICE:\n` +
        `   \`git add ${arquivos.join(" ")}\` (dentro do pre-commit quem faz isso é o remédio).`,
    )
  } else {
    log(
      `⚠️  remendo aplicado: ${aplicados.length} troca(s), e o guard caiu de ${antes} para ${depois}\n` +
        `   violação(ões) — o que SOBRA não é remendável por vizinho (o plano acima diz por quê).\n` +
        `   O commit segue BLOQUEADO.`,
    )
  }
  return {
    code: depois === 0 ? EXIT.OK : EXIT.VIOLATIONS,
    aplicados,
    recusas,
    antes,
    depois,
    arquivos,
    motivo: null,
  }
}

export const USAGE = `check-hook-commands — todo comando que os hooks executam tem de RESOLVER

Usage:
  node scripts/check-hook-commands.mjs [opções]

Opções:
  --root <dir>      raiz do repositório (fixture dos testes; default: cwd)
  --list            imprime o desfecho de CADA comando julgado
  --json            saída estruturada (consumível por outro script) — inclui o
                    PLANO do remendo (\`remendos\`), o que ele RECUSA
                    (\`remendosRecusados\`), os scripts de shell DESCENTIDOS
                    (\`scripts\`) e onde a descida PAROU (\`limites\`)
  --fix             REMENDA o caminho tipado pelo VIZINHO mais próximo: mostra o
                    antes/depois, PERGUNTA no terminal de controle e só escreve
                    com o "sim" (sem terminal nenhum: plano + caminho à mão,
                    NADA gravado)
  --yes             a confirmação já foi dada por quem chama (o remédio do
                    pre-commit pergunta UMA vez e passa esta flag); exige \`--fix\`
  -h, --help        esta ajuda

O que ele julga: os COMANDOS de \`.husky/\` (o diretório \`_\` do husky fica fora —
são shims gerados). Caminho de interpretador (\`node scripts/x.mjs\`), entrada de
\`bun run\`, binário de \`bun x\`, função do próprio hook, arquivo de \`source\` e
ferramenta externa declarada. \`$( ... )\` executa e é julgado junto.

Exit code:
  0 — todo comando resolve (e as listas de decisão estão dentro da janela)
  1 — comando que não resolve, ou decisão sem \`addedAt\` / fora da janela
  2 — infra: \`.husky/\` ou \`package.json\` ausente/ilegível (fail-closed)
  3 — uso inválido (\`--fix\` com \`--json\`/\`--list\`, \`--yes\` sem \`--fix\`,
      \`--root\` sem valor)

O REMENDO (\`--fix\`), em uma linha: o guard diz QUAL era o nome esperado; o
\`--fix\` troca o token por ele quando não há dúvida — até ${FIX_MAX_DISTANCE}
caracteres de diferença, UM candidato só (empate é RECUSA, quem escolhe é o
operador), arquivo de verdade e token localizável sem ambiguidade. O que ele não
sabe remendar (a entrada de \`bun run\`, a função não definida, o binário sem
fornecedor, o payload de runtime) sai NOMEADO no plano, com o motivo. E como
\`.husky/\` é o arquivo que o hook EXECUTA, quem remenda por dentro do pre-commit
leva o veredito de um \`git commit\` NOVO.
`

function printReport(report, { list = false } = {}) {
  if (report.infra) {
    if (report.hooks.length === 0) console.error("❌ .husky/ sem nenhum hook — nada a julgar")
    else console.error("❌ package.json ausente ou ilegível — scripts não julgáveis")
    return EXIT.UNJUDGEABLE
  }
  const violacoes = [...report.violacoes, ...reviewViolations(report)]

  const descidos = report.scripts ?? []
  const limites = report.limites ?? []
  console.log(
    `🔗 Comandos dos hooks: ${report.comandos.length} comando(s) em ${report.hooks.length} hook(s)` +
      (descidos.length === 0
        ? ""
        : ` + ${descidos.length} script(s) de shell chamado(s) pelo hook`) +
      ` — ${report.resolvidos.length} resolvido(s), ${report.indeterminados.length} indeterminado(s), ` +
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

  // O LIMITE da descida e dito SEMPRE (não só no `--list`): uma cadeia que
  // parou no teto ou num ciclo tem de aparecer na saída normal, senão o silêncio
  // faria "não fui olhar" passar por "não há o que julgar la dentro".
  for (const l of limites)
    console.log(`   ⚠️  ${l.arquivo}:${l.linha} \`${l.programa} ${l.alvo}\` — ${l.motivo}`)

  if (violacoes.length === 0) {
    console.log(
      `✅ Todo comando dos hooks resolve` +
        (descidos.length === 0
          ? ""
          : ` (inclui o interior de ${descidos.length} script(s) chamado(s))`) +
        ` — janela de revisão das decisões: ${report.reviewDays} dias`,
    )
    return EXIT.OK
  }
  console.error(`\n❌ ${violacoes.length} comando(s)/decisão(ões) sem resolução:`)
  for (const v of violacoes)
    console.error(`   • ${v.arquivo}:${v.linha} \`${v.programa}\` — ${v.motivo}`)
  return EXIT.VIOLATIONS
}

/**
 * As opções da CLI, com o USO INVALIDO dito em vez de interpretado.
 *
 * Uma combinação que o comando não promete não pode virar "ele quis dizer
 * outra coisa": `--fix` escreve na ÁRVORE e relata em texto — combinado com
 * `--json` (um retrato) o relatório não sairia, e com `--list` o plano do
 * remendo não seria mostrado antes da pergunta. Quem chama errado recebe exit 3.
 *
 * @param {string[]} argv
 * @returns {{root: string, list: boolean, json: boolean, fix: boolean, yes: boolean, erro: string|null}}
 */
function parseArgs(argv) {
  const opts = { root: ROOT, list: false, json: false, fix: false, yes: false, erro: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--root") {
      const v = argv[++i]
      if (v === undefined || v.startsWith("--")) {
        opts.erro = "--root exige um valor"
        return opts
      }
      opts.root = v
    } else if (a === "--list") opts.list = true
    else if (a === "--json") opts.json = true
    else if (a === "--fix") opts.fix = true
    else if (a === "--yes") opts.yes = true
    else if (a === "-h" || a === "--help") {
      console.log(USAGE)
      process.exit(EXIT.OK)
    } else if (a.startsWith("--")) {
      opts.erro = `flag desconhecida: ${a}`
      return opts
    }
  }
  for (const [condicao, motivo] of [
    [
      opts.fix && opts.json,
      "`--fix` grava na ÁRVORE e relata em TEXTO (antes/depois); `--json` é o retrato do veredito",
    ],
    [
      opts.fix && opts.list,
      "`--fix` mostra o PLANO do remendo antes da pergunta, não a lista de cada comando julgado",
    ],
    [opts.yes && !opts.fix, "`--yes` confirma um remendo: sem `--fix` não há o que confirmar"],
  ]) {
    if (condicao === true) {
      opts.erro = motivo
      return opts
    }
  }
  return opts
}

const invokedDirectly = process.argv[1]?.endsWith("check-hook-commands.mjs")
if (invokedDirectly) {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.erro !== null) {
    console.error(`❌ ${opts.erro}\n${USAGE}`)
    process.exit(EXIT.USAGE)
  }
  if (opts.fix) {
    // O remendo é ASSÍNCRONO (ele pergunta), e o exit code é o veredito dele:
    // `process.exit` depois da resposta, para o terminal não fechar a pergunta.
    fix(opts.root, { yes: opts.yes })
      .then((r) => process.exit(r.code))
      .catch((err) => {
        console.error(`❌ remendo indisponível: ${err?.message ?? err}`)
        process.exit(EXIT.UNJUDGEABLE)
      })
  } else {
    const report = analyze({ root: opts.root })
    if (opts.json) {
      const violacoes = report.infra ? [] : [...report.violacoes, ...reviewViolations(report)]
      // O PLANO entra no JSON porque um consumidor (o remédio do pre-commit)
      // precisa dos MESMOS alvos que o `--fix` usaria sem re-derivá-los por
      // conta própria — duas derivações divergiriam no dia em que uma mudasse.
      const remendo = report.infra
        ? { plano: [], recusas: [] }
        : planoDeRemendo(opts.root, { report })
      console.log(
        JSON.stringify(
          {
            ok: !report.infra && violacoes.length === 0,
            root: report.root,
            hooks: report.hooks ?? [],
            scripts: report.scripts ?? [],
            limites: report.limites ?? [],
            total: report.comandos?.length ?? 0,
            resolvidos: report.resolvidos?.length ?? 0,
            indeterminados: report.indeterminados ?? [],
            violacoes,
            remendos: remendo.plano ?? [],
            remendosRecusados: remendo.recusas ?? [],
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
}
