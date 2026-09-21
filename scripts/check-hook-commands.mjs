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
//       fornecedor, funcao chamada e nao definida, `source` de arquivo ausente),
//       entrada de ALLOWLIST/INDETERMINATE sem data / fora da janela, ou NUMERO
//       DE PRODUCAO da prosa que nao bate com o medido (ver abaixo)
//   2 — infra: `.husky/` ou `package.json` ausente/ilegivel (fail-closed)
//   3 — uso invalido (`--fix` com `--json`/`--list`, `--yes` sem `--fix`,
//       `--root` sem valor)
//
// OS NUMEROS DE PRODUCAO DA PROSA sao DERIVADOS e CONFERIDOS: a doc publica o
// total de comandos, os resolvidos, os indeterminados, os hooks e os scripts
// descidos — e cada um e comparado com o que o `analyze()` acabou de medir (a
// forma canonica de cada um esta em `NUMEROS_DA_PROSA`, e a secao "OS NUMEROS DE
// PRODUCAO NA PROSA" explica o desenho). Eles ja estavam MENTIROSOS quando a
// regra nasceu (a prosa dizia 250 comandos / 244 resolvidos / 105 nos hooks; o
// medido era 251 / 245 / 106): um numero de doc que ninguem deriva envelhece
// sozinho, e e por ele que o leitor confere a ESCALA deste guard — um nivel
// acima do piso de cobertura, que mede o VAZIO; aqui o guard mede cheio e a doc
// pode contar outra coisa.
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
//   node|bash|sh|python3 <caminho>    o caminho tem de EXISTIR no repositorio —
//                                     e a CLASSIFICACAO do alvo e UMA so
//                                     (`classeDoAlvo`, a MESMA regua que o valor
//                                     PROVADO por variavel usa): o relativo se
//                                     PROVA no disco, o absoluto e "fora do
//                                     repositorio" (resolvido) e o padrao e
//                                     "padrao, nao um caminho" (indeterminado).
//                                     Julgar o valor provado so pela EXISTENCIA
//                                     acusava o sao: o `/etc/hosts` de uma
//                                     atribuicao era "nao existe no repositorio",
//                                     e um `scripts/*.sh` ganhava ate a sugestao
//                                     de um vizinho
//   bash|sh <script.sh>               o caminho tem de existir E o que ELE executa
//                                     por dentro e julgado recursivamente: o
//                                     hook real chama UM runner
//                                     (`bash scripts/run-encoding-guards.sh`)
//                                     que chama os outros, e sem descer uma
//                                     linha tipada DENTRO dele seria o mesmo
//                                     passo-que-nunca-roda, invisivel. A mesma
//                                     descida segue o alvo PROVADO por variavel
//                                     (`bash "$SCRIPT_DIR/x.sh"`): o interior de
//                                     um script que a resolucao acabou de provar
//                                     NAO fica sem julgamento — so desce o que E
//                                     arquivo do repositorio (o veredito do
//                                     comando diz por que, na MESMA classe de
//                                     `classeDoAlvo`: fora do repositorio ou
//                                     padrao). O ALVO de um lancador e o primeiro
//                                     token que NAO e um FLAG (`alvoDoLancador`),
//                                     e a classe do flag decide o que vem depois:
//                                     `bash -u x.sh` EXECUTA x.sh (desce),
//                                     `bash -n x.sh` so CONFERE a sintaxe (nao
//                                     desce, e o motivo DIZ isso) e `bash -o
//                                     pipefail x.sh` nao e adivinhado (o flag
//                                     pode consumir o token seguinte)
//   bun run <entrada>                 a entrada tem de existir em `scripts` do
//                                     package.json E o comando RESOLVIDO dela e
//                                     julgado recursivamente (o script que
//                                     chama `bash scripts/x.sh` responde pelo
//                                     `.sh`)
//   bun run "$ENTRADA"                a entrada MONTADA EM VARIAVEL e a MESMA
//                                     pergunta, nao uma isencao: o valor
//                                     provavel (pelas atribuicoes do arquivo)
//                                     tem de ser entrada de `scripts`, binario
//                                     de dependencia declarada ou subcomando
//                                     nativo (na forma sem `run`), e o que ele
//                                     EXECUTA e julgado recursivamente — so o
//                                     valor NAO ESTATICO segue indeterminado
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
// A ENTRADA de `bun run` montada em `$VAR` NAO entra nessa lista: a variavel
// nomeia o NOME de um script de `scripts` (ou um binario), e o valor provavel
// se PROVA contra o package.json. Deixar essa classe indeterminada custava mais
// que a decisao datada: a isencao cobre a entrada que EXISTE e a que foi
// REMOVIDA no mesmo commit com o mesmo silencio — o passo-que-nunca-roda de
// volta, agora atras de uma linha de lista que ninguem tem motivo para reler.
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
import { basename, dirname, join } from "node:path"

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

// ── A CLASSE DO FLAG DE UM LANCADOR DE SHELL ───────────────────────────────
//
// O alvo de `bash`/`sh` NAO e o primeiro token: `bash -u scripts/x.sh` executa o
// arquivo, e ler o `-u` como "o alvo" foi o que fez o guard dizer que um alvo
// que E caminho do repositorio "nao e um arquivo do repositorio". A classe do
// flag decide o que vem depois dele — a MESMA leitura para o veredito do
// comando e para a descida (`alvoDoLancador`).

/** (1) O shell EXECUTA o arquivo: o flag nao consome o token seguinte. */
export const FLAGS_DE_SHELL_EXECUTA = new Set([
  "-e",
  "-u",
  "-x",
  "-v",
  "-a",
  "-f",
  "-h",
  "-k",
  "-t",
  "-p",
  "-r",
  "-l",
  "-B",
  "-C",
  "-E",
  "-H",
  "-P",
  "-T",
  "--verbose",
  "--xtrace",
  "--errexit",
  "--nounset",
  "--noprofile",
  "--norc",
  "--posix",
  "--restricted",
  "--login",
])

/**
 * (2) O shell NAO executa arquivo nenhum: `-n` so CONFERE a sintaxe. Descer no
 * alvo afirmaria que o interior dele roda — e nao roda.
 */
export const FLAGS_DE_SHELL_NAO_EXECUTA = new Set([
  "-n",
  "--noexec",
  "--dump-strings",
  "--dump-po-strings",
])

/**
 * (3) O script vem do STDIN ou do proprio ARGUMENTO (payload inline): nao ha
 * arquivo do repositorio para julgar nem para descer.
 *
 * O `INLINE_FLAGS` e DERIVADO daqui: enquanto a lista era escrita a mao, o `-e`
 * estava nela por engano — `bash -e x.sh` e o `errexit` com o arquivo EXECUTADO
 * (`-c` e que e payload), e o veredito dizia "payload inline (bash -e)" de um
 * comando cujo alvo e um arquivo do repositorio.
 */
export const FLAGS_DE_SHELL_SEM_ARQUIVO = new Set(["-c", "--eval", "-", "-s", "-i"])

/**
 * A flag que faz o interpretador ler o payload de um ARGUMENTO: o que ele
 * executa nao existe como arquivo em lugar nenhum — e INDETERMINADO por
 * construcao, nao por limitacao do guard.
 */
export const INLINE_FLAGS = FLAGS_DE_SHELL_SEM_ARQUIVO

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
 * Os payloads de runtime ja conhecidos: o PROGRAMA a executar vive no ARGUMENTO
 * (`-c`), nao existe como arquivo em lugar nenhum e nenhuma leitura o prova — o
 * `python3 -c` do bloco advisory do `pre-push` le o JSON do `/api/health`, e os
 * quatro `python3|python -c "import sys"` dos `check-*.sh` sao o probe que
 * escolhe o interpretador. Julgar o TEXTO de um payload seria julgar uma string,
 * nao um comando: e o unico indeterminado que nao vira prova lendo mais.
 *
 * O que NAO esta mais aqui (e por que): as QUATRO decisoes que existiam para os
 * `check-*.sh` — `python3 "$PYTHON_SCRIPT"`, `node "$SCRIPT_DIR/check_utf8.mjs"`
 * e `"$PY" "$PY_SCRIPT"` — eram decisoes sobre CAMINHO, e caminho de variavel
 * agora e RESOLVIDO pelas atribuicoes do proprio arquivo (ver "As VARIAVEIS DE
 * CAMINHO"): o guard le `PYTHON_SCRIPT="$SCRIPT_DIR/check_utf8.py"`, traduz o
 * `$SCRIPT_DIR` (o idioma `dirname(BASH_SOURCE[0])` + `cd` + `pwd`) e PROVA que
 * `scripts/check_utf8.py` existe. Cada uma delas era uma promessa que so o
 * operador cumpria; hoje sao fato medido em todo commit — e `$PY` (o programa em
 * variavel) tambem, porque os tres valores dele sao interpretadores declarados.
 *
 * As DUAS entradas que sobraram sao as do probe com payload inline, e o motivo de
 * continuarem aqui e estrutural: um payload nao e um caminho. Elas sao o PISO
 * desta lista — nenhuma leitura o baixa mais.
 *
 * @type {{match: string, addedAt: string, why: string}[]}
 */
export const INDETERMINATE = [
  {
    match: "python3 -c",
    addedAt: "2026-09-17",
    why: "o payload do `python3 -c` vive no ARGUMENTO (le o JSON do /api/health do bloco advisory do pre-push e faz o probe `import sys` dos check-*.sh) e nao existe como arquivo: julgar o texto dele seria julgar uma string, nao um comando",
  },
  {
    match: "python -c",
    addedAt: "2026-09-17",
    why: 'o probe `python -c "import sys"` (check-crlf.sh e check-blob-crlf.sh escolhem o interpretador em runtime) tem o payload no ARGUMENTO, como o `python3 -c` acima — e o resultado dele e o proprio gate de disponibilidade do interpretador',
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
// As VARIAVEIS DE CAMINHO do proprio arquivo: `PYTHON_SCRIPT="$SCRIPT_DIR/x.py"`
// =============================================================================
//
// O guard julga o comando de um script descido (`python3 "$PYTHON_SCRIPT"`), e o
// alvo do interpretador esta numa VARIAVEL. Sem ler as atribuicoes do arquivo, a
// unica saida honesta era `indeterminado` + uma entrada datada em INDETERMINATE —
// a decisao dizia "o caminho existe, mas nao provei", e a prova ficava por conta
// de quem le. Ler as atribuicoes troca isso por PROVA, com duas regras que
// mantem o veredito honesto:
//
//   1. O valor tem de ser ESTATICO por leitura: literal, referencia a outra
//      variavel resolvivel, ou o idioma do "diretorio DESTE arquivo"
//      (`SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"` — o unico
//      `$( )` que o guard traduz, e o unico porque ele e um IDIOMA declarado, nao
//      uma heuristica).
//   2. FAIL-CLOSED: uma atribuicao fora dessas formas deixa a variavel
//      IRRESOLUVEL e o motivo NOMEIA a variavel e a linha — nunca "provavel pela
//      maioria": um valor que o guard nao conseguiu ler pode ser justamente o que
//      roda, e provar o resto seria provar uma parte e chamar de todo.
//
// O conjunto de valores e um CONJUNTO de verdade: uma variavel atribuida em ramos
// diferentes (`PY=python3` / `PY=python` / `PY=node`) tem os tres, e o veredito
// exige que TODOS resolvam — a leitura nao sabe qual ramo o runtime toma, e e por
// isso que o veredito fala em "provável", nunca em "e".

/**
 * O marcador do "diretorio DESTE arquivo" (o valor de `SCRIPT_DIR`).
 *
 * O caminho final e o diretorio do ARQUIVO JULGADO (relativo ao root do
 * repositorio) + o resto do token — e por isso o marcador existe: o mesmo
 * `$SCRIPT_DIR/x` vale `scripts/x` num script e `.husky/x` num hook, e a
 * substituicao tem de acontecer com o arquivo na mao.
 *
 * "Com o arquivo na mao" e o arquivo ONDE A EXPRESSAO FOI ESCRITA, e nao o que a
 * le: o idioma vira marcador no PARSE (`comDirCongelado`, que tem o diretorio do
 * arquivo) e a heranca resolve o marcador com o diretorio de QUEM EXPORTOU. Um
 * marcador que chegue ao uso veio de uma atribuicao DESTE arquivo — a substitucao
 * no uso (`caminhosProvaveis`) e a ultima ponta da mesma regra, nao outra.
 */
export const MARCA_DIR = "@DIR@"

/**
 * O marcador do "diretorio PAI deste arquivo" — o idioma com que os scripts da
 * casa chegam na RAIZ do repositorio:
 *
 *   SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"   # scripts/x.sh → a raiz
 *
 * Ele NAO e o mesmo marcador que `@DIR@`: o valor e outro diretorio, e a
 * diferenca e o que faz o alvo sair certo (`$SCRIPT_DIR/scripts/x.mjs` vale
 * `scripts/x.mjs`, enquanto `@DIR@/x.mjs` num script vale `scripts/x.mjs`).
 * Resolve-lo como `@DIR@` provaria outro caminho — e um caminho que existe por
 * acaso daria um verde que nao veio do disco.
 */
export const MARCA_DIR_PAI = "@DIRPAI@"

/**
 * Os idiomas que DIZEM "o diretorio deste arquivo" (`marca: @DIR@`) ou "o PAI
 * dele" (`marca: @DIRPAI@`). Sao QUATRO porque os scripts da casa escrevem as
 * duas formas com os dois nomes (`$0` e `${BASH_SOURCE[0]}`); qualquer outro
 * `$( )` numa atribuicao e irresolvivel.
 */
export const IDIOMAS_DIR = [
  {
    re: /^\$\(cd "\$\(dirname "\$\{?BASH_SOURCE\[0\]\}?"\)" && pwd\)$/,
    nome: "`$(cd $(dirname ${BASH_SOURCE[0]}) && pwd)`",
    marca: MARCA_DIR,
  },
  {
    re: /^\$\(cd "\$\(dirname "\$0"\)" && pwd\)$/,
    nome: "`$(cd $(dirname $0) && pwd)`",
    marca: MARCA_DIR,
  },
  {
    re: /^\$\(cd "\$\(dirname "\$\{?BASH_SOURCE\[0\]\}?"\)\/\.\." && pwd\)$/,
    nome: "`$(cd $(dirname ${BASH_SOURCE[0]})/.. && pwd)`",
    marca: MARCA_DIR_PAI,
  },
  {
    re: /^\$\(cd "\$\(dirname "\$0"\)\/\.\." && pwd\)$/,
    nome: "`$(cd $(dirname $0)/.. && pwd)`",
    marca: MARCA_DIR_PAI,
  },
]

/**
 * O teto de valores de um token (ou de uma variavel): duas referencias de tres
 * valores ja dariam nove combinacoes, e um conjunto grande demais nao e prova de
 * nada — e `indeterminado` nomeado.
 */
export const MAX_VALORES = 8

/** A profundidade maxima da cadeia `A="$B"` → `B="$C"`. */
export const MAX_PROFUNDIDADE = 4

/**
 * A atribuicao de uma linha de shell: `VAR=...`, com os prefixos que a casa usa
 * (`export`, `local`, `readonly`, `declare -x`).
 */
const ATRIBUICAO =
  /^\s*(?:export\s+|local\s+|readonly\s+|declare\s+(?:-[A-Za-z]+\s+)?)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/

/**
 * O primeiro WORD do lado direito de uma atribuicao.
 *
 * O shell corta o valor no primeiro espaco NAO citado, e o que vem depois e o
 * COMANDO da linha: `GUARD="$GUARD" ALVO="$1" python3 - <<PY` atribui `"$GUARD"`
 * a GUARD — nao a linha inteira. Sem o corte, o valor virava um texto que cita o
 * proprio nome e a regua o lia como CICLO, deixando `node "$GUARD"` sem
 * julgamento por um defeito de LEITURA (nao do arquivo). O prefixo de ambiente e
 * a forma que a casa usa para passar o caminho ao script de mutacao.
 *
 * O limite declarado: aspas ESCAPADAS (\`) nao alternam o estado — um valor
 * assim (raro, e nunca num caminho) e lido por inteiro, e um valor lido por
 * INTEIRO so pode deixar o veredito mais exigente, nunca provar um alvo que nao
 * existe.
 */
function primeiroWord(texto) {
  // A PORTAO LEXICO da casa: a substituicao de comando abre um nivel PROPRIO (o
  // shell a parsa como um comando novo), e o espaco so corta o valor no nivel de
  // FORA (`"$(cd "$(dirname "$0")/.." && pwd)"` e UM valor; `VAR="$VAR" cmd`
  // atribui so `"$VAR"`). Um scanner de aspas sem os niveis cortaria o primeiro
  // no meio — e o valor lido a menos era o proprio idioma do SCRIPT_DIR.
  /** @type {(string|null)[]} */
  const aspas = [null]
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i]
    const nivel = aspas.length - 1
    if (c === "\\" && aspas[nivel] === '"') {
      i++
      continue
    }
    if (aspas[nivel] === null && (c === '"' || c === "'")) {
      aspas[nivel] = c
      continue
    }
    if (aspas[nivel] !== null && c === aspas[nivel]) {
      aspas[nivel] = null
      continue
    }
    if (aspas[nivel] === null && c === "$" && texto[i + 1] === "(") {
      aspas.push(null)
      i++
      continue
    }
    if (aspas[nivel] === null && c === ")" && nivel > 0) {
      aspas.pop()
      continue
    }
    if (aspas[nivel] === null && nivel === 0 && /\s/.test(c)) return texto.slice(0, i)
  }
  return texto
}

/**
 * As ATRIBUICOES de texto de um arquivo: nome → valores, na ORDEM, com a linha
 * de cada um (a linha e o que o motivo cita quando um deles nao e provavel) e
 * com os valores que vao para o AMBIENTE dos filhos.
 *
 * ESSA ULTIMA LISTA e o que separa `export VAR=x` de `VAR=x`: o processo novo
 * (um `bash script.sh`) recebe o AMBIENTE, nao as variaveis do shell pai — so o
 * que foi EXPORTADO atravessa. As duas formas contam: `export VAR=x` na mesma
 * linha, e o `export VAR` SOZINHO (a atribuicao veio antes, ou veio do shell que
 * chamou) — o atributo de exportacao fica no NOME, entao a ORDEM das linhas nao
 * importa e um `export VAR` seguido de `VAR=x` exporta `x`.
 *
 * Uma linha COMENTADA nao atribui nada, e um `VAR=` dentro de um heredoc que
 * comece na coluna zero seria lido como atribuicao — este guard julga o que le, e
 * julgar a atribuicao de um heredoc daria um valor A MAIS no conjunto (nunca um
 * valor a menos), o que deixa o veredito mais exigente, nao mais frouxo.
 *
 * @param {string} content
 * @returns {Map<string, {valores: string[], linhas: number[], exportados: string[]}>}
 */
export function atribuicoesDoTexto(content) {
  /** @type {Map<string, {valores: string[], linhas: number[], exportados: string[]}>} */
  const mapa = new Map()
  const linhas = content.split(/\r?\n/)
  // O `export VAR` sozinho vale para TODAS as atribuicoes do nome, em qualquer
  // ordem (o atributo e do nome, nao da linha) — por isso a primeira passada.
  const exportadosPorNome = new Set()
  for (const linha of linhas) {
    const so = /^\s*export\s+([A-Za-z_][A-Za-z0-9_]*)\s*$/.exec(linha)
    if (so !== null) exportadosPorNome.add(so[1])
  }
  linhas.forEach((linha, i) => {
    if (/^\s*#/.test(linha)) return
    const m = ATRIBUICAO.exec(linha)
    if (m === null) return
    const valor = primeiroWord(m[2]).trim()
    const entrada = mapa.get(m[1]) ?? { valores: [], linhas: [], exportados: [] }
    entrada.valores.push(valor)
    entrada.linhas.push(i + 1)
    if (/^\s*export\s/.test(linha) || exportadosPorNome.has(m[1]))
      entrada.exportados = [...new Set([...entrada.exportados, valor])]
    mapa.set(m[1], entrada)
  })
  return mapa
}

/**
 * O MARCADOR do idioma que o texto (ja desembrulhado) escreve, ou null.
 *
 * O `@DIR@` distingue-se do `@DIRPAI@` AQUI, num lugar so: quem le o idioma
 * (o congelamento do parse, a leitura do valor e a prova do caminho) pergunta a
 * mesma funcao — uma segunda tabela de reconhecimento divergiria do `IDIOMAS_DIR`
 * no primeiro idioma novo.
 */
export function marcaDoIdioma(texto) {
  const idioma = IDIOMAS_DIR.find((i) => i.re.test(desembrulha(texto)))
  return idioma === undefined ? null : idioma.marca
}

/** O TEXTO (ja desembrulhado) e um dos idiomas de "o diretorio deste arquivo"? */
export function eIdiomaDir(texto) {
  return marcaDoIdioma(texto) !== null
}

/** Tira as aspas EXTERNAS de um valor (e o que o shell faz antes de usa-lo). */
export function desembrulha(valor) {
  const v = valor.trim()
  if (v.length < 2) return v
  const primeira = v[0]
  if ((primeira === '"' || primeira === "'") && v.endsWith(primeira)) return v.slice(1, -1)
  return v
}

/**
 * O valor de uma atribuicao com o DIRETORIO DO PROPRIO ARQUIVO congelado no lugar
 * do idioma — o congelamento acontece ONDE A EXPRESSAO ESTA ESCRITA.
 *
 * O idioma `$(cd $(dirname ${BASH_SOURCE[0]}) && pwd)` vale o diretorio do arquivo
 * que o escreveu. Resolver isso no USO (como o `valoresDoTexto` fazia sozinho)
 * estava ERRADO para o valor que atravessa a HERANCA: um
 * `SCRIPT_DIR="$(cd ... && pwd)"` exportado por `scripts/lib.sh` chegava ao filho
 * ainda com a EXPRESSAO, e o filho a re-avaliava com o DIRETORIO DELE
 * (`scripts/sub`) — provando `scripts/sub/ok.mjs`, um caminho que o processo novo
 * NUNCA pode ver (o bash exporta o VALOR, nao a expressao). Se aquele caminho
 * existisse, o guard sairia VERDE para um alvo impossivel: exatamente o falso
 * verde que a heranca existe para fechar. MEDIDO na M20 da bateria de mutacao.
 */
export function comDirCongelado(valor) {
  return marcaDoIdioma(valor) ?? valor
}

/**
 * Os valores com os MARCADORES trocados pelos diretorios do arquivo julgado.
 *
 * E a ULTIMA ponta da mesma regua: o congelamento do parse troca o idioma pelo
 * marcador (onde a expressao foi escrita) e a substituicao acontece com o arquivo
 * na mao — no valor provavel e na HERANCA (o `SCRIPT_DIR` exportado vale o
 * diretorio de quem o exportou).
 *
 * O `/` de cola de um diretorio VAZIO nao e caminho absoluto: `$SCRIPT_DIR/x`
 * com o PAI na raiz vale `x`, e nao `/x` — sem a normalizacao o valor provaria
 * outra coisa e o filtro de "caminho do repositorio" o recusaria, deixando o
 * alvo sem julgamento (que e o que a descida existe para fechar).
 *
 * @param {string[]} valores
 * @param {{dir: string, dirPai?: string}} vars
 * @returns {string[]}
 */
export function aplicaMarcas(valores, vars) {
  const dirPai = vars.dirPai ?? ""
  return valores.map((v) => {
    if (!v.includes(MARCA_DIR) && !v.includes(MARCA_DIR_PAI)) return v
    let s = v
    if (s.includes(MARCA_DIR_PAI)) {
      s = s.split(MARCA_DIR_PAI).join(dirPai)
      if (dirPai === "" && v.startsWith(MARCA_DIR_PAI) && s.startsWith("/")) s = s.slice(1)
    }
    return s.split(MARCA_DIR).join(vars.dir)
  })
}

/** O `$VAR` / `${VAR}` / parametro do shell, para varrer um texto ou um token. */
const referencia = () =>
  /\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)|\$([@*#?$!-]|\d+)/g

/**
 * O produto cartesiano de alternativas, com TETO (null quando ele estoura).
 *
 * @param {string[][]} partes
 * @param {number} teto
 * @returns {string[]|null}
 */
function produto(partes, teto) {
  let acc = [""]
  for (const alternativas of partes) {
    const proximo = []
    for (const prefixo of acc) for (const alt of alternativas) proximo.push(prefixo + alt)
    if (proximo.length > teto) return null
    acc = proximo
  }
  return acc
}

/** Um texto curto para a mensagem (o valor inteiro so poluiria). */
function encurta(texto) {
  return texto.length > 48 ? `${texto.slice(0, 48)}…` : texto
}

/**
 * Os valores PROVAVEIS do lado direito de uma atribuicao (o valor de uma
 * variavel, recursivo nas referencias).
 *
 * @param {string} bruto
 * @param {Map<string, {valores: string[], linhas: number[]}>} atribuicoes
 * @param {Set<string>} visitados
 * @param {number} profundidade
 * @returns {{ok: true, valores: string[]}|{ok: false, motivo: string}}
 */
function valoresDoTexto(bruto, atribuicoes, visitados, profundidade) {
  const texto = desembrulha(bruto)
  // O idioma tambem e reconhecido AQUI (e nao so no congelamento do parse) porque
  // um `vars` montado a mao pode trazer o texto cru — a regua de reconhecimento e
  // a mesma (`eIdiomaDir`), num lugar so.
  const marca = marcaDoIdioma(texto)
  if (marca !== null) return { ok: true, valores: [marca] }
  if (texto.includes("$(") || texto.includes("`") || texto.includes("$["))
    return {
      ok: false,
      motivo: `\`${encurta(texto)}\` é uma substituição de comando (o guard lê o arquivo, não o executa)`,
    }
  if (profundidade > MAX_PROFUNDIDADE)
    return { ok: false, motivo: `a cadeia de variáveis passa de ${MAX_PROFUNDIDADE} elos` }
  /** @type {string[][]} */
  const partes = []
  let ultimo = 0
  const re = referencia()
  for (let m; (m = re.exec(texto)) !== null;) {
    if (m.index > ultimo) partes.push([texto.slice(ultimo, m.index)])
    const nome = m[1] ?? m[2]
    if (nome === undefined)
      return {
        ok: false,
        motivo: `\`$${m[3]}\` é um parâmetro do shell (posicional ou especial), não uma variável de caminho`,
      }
    const r = valoresDaVariavel(nome, atribuicoes, visitados, profundidade)
    if (!r.ok) return r
    partes.push(r.valores)
    ultimo = re.lastIndex
  }
  if (ultimo < texto.length) partes.push([texto.slice(ultimo)])
  const valores = produto(partes, MAX_VALORES)
  if (valores === null)
    return { ok: false, motivo: `as combinações possíveis passam de ${MAX_VALORES}` }
  return { ok: true, valores: [...new Set(valores)] }
}

/**
 * O valor e a PROPRIA variavel (`GUARD="$GUARD" cmd` — o prefixo de ambiente de
 * UMA linha)?
 *
 * Ele nao acrescenta valor nenhum ao conjunto: o processo novo recebe o mesmo
 * valor que o pai ja tinha. Deixa-lo entrar fazia a regua acusar CICLO num
 * arquivo que so passa a variavel adiante — e o alvo de `node "$GUARD"` ficava
 * sem julgamento por isso. O ciclo de verdade (`A="$B"` / `B="$A"`) continua
 * sendo ciclo: ali o elo acrescenta um NOME novo a resolucao, e e isso que a
 * profundidade e o `visitados` guardam.
 */
function ehAutoReferencia(valor, nome) {
  const t = desembrulha(valor).trim()
  return t === `$${nome}` || t === `\${${nome}}`
}

/**
 * Os valores provaveis de UMA variavel: TODAS as atribuicoes dela no arquivo.
 *
 * @param {string} nome
 * @param {Map<string, {valores: string[], linhas: number[]}>} atribuicoes
 * @param {Set<string>} visitados
 * @param {number} profundidade
 * @returns {{ok: true, valores: string[]}|{ok: false, motivo: string}}
 */
function valoresDaVariavel(nome, atribuicoes, visitados, profundidade) {
  const entrada = atribuicoes.get(nome)
  if (entrada === undefined)
    return { ok: false, motivo: `a variável \`${nome}\` não é atribuída neste arquivo` }
  if (visitados.has(nome))
    return { ok: false, motivo: `a variável \`${nome}\` depende dela mesma (ciclo)` }
  const valores = []
  for (const valor of entrada.valores) {
    if (ehAutoReferencia(valor, nome)) continue
    const r = valoresDoTexto(valor, atribuicoes, new Set([...visitados, nome]), profundidade + 1)
    if (!r.ok) return { ok: false, motivo: `\`${nome}\` (${ondeAtribuida(entrada)}): ${r.motivo}` }
    valores.push(...r.valores)
  }
  return { ok: true, valores: [...new Set(valores)] }
}

/**
 * ONDE uma variavel foi atribuida — no arquivo julgado ou no processo que o
 * chamou (o `export` de quem o executa) —, para o motivo citar o lugar CERTO da
 * atribuicao.
 *
 * @param {{linhas: number[], herdadaDe?: string}} entrada
 */
function ondeAtribuida(entrada) {
  return entrada.herdadaDe === undefined
    ? `linha ${entrada.linhas.join(", ")}`
    : `herdada de \`${entrada.herdadaDe}\``
}

/**
 * Os CAMINHOS provaveis de um token que carrega `$VAR` (`$PYTHON_SCRIPT`,
 * `$SCRIPT_DIR/check_utf8.mjs`).
 *
 * @param {string} token
 * @param {{atribuicoes: Map<string, {valores: string[], linhas: number[], exportados?: string[], herdadaDe?: string}>, dir: string, dirPai?: string}} vars
 * @returns {{ok: true, valores: string[], motivo: string}|{ok: false, motivo: string}}
 */
export function caminhosProvaveis(token, vars) {
  /** @type {string[][]} */
  const partes = []
  const nomes = []
  let ultimo = 0
  const re = referencia()
  for (let m; (m = re.exec(token)) !== null;) {
    if (m.index > ultimo) partes.push([token.slice(ultimo, m.index)])
    const nome = m[1] ?? m[2]
    if (nome === undefined)
      return {
        ok: false,
        motivo: `\`$${m[3]}\` é um parâmetro do shell (posicional ou especial), não uma variável de caminho`,
      }
    const r = valoresDaVariavel(nome, vars.atribuicoes, new Set(), 0)
    if (!r.ok) return r
    nomes.push(nome)
    partes.push(r.valores)
    ultimo = re.lastIndex
  }
  if (ultimo < token.length) partes.push([token.slice(ultimo)])
  // O TETO e uma fronteira DECLARADA: o que o guard nao consegue enumerar ele
  // nao prova. Sem ele, um token com duas referencias de muitos valores vira um
  // conjunto enorme, e "provar" esse conjunto e uma leitura que nao aconteceu —
  // o verde viria do tamanho, nao do disco. MEDIDO na M19 da bateria de mutacao.
  const combinacoes = produto(partes, MAX_VALORES)
  if (combinacoes === null)
    return { ok: false, motivo: `as combinações possíveis do token passam de ${MAX_VALORES}` }
  const valores = [...new Set(aplicaMarcas(combinacoes, vars))]
  const restos = valores.filter((v) => v.includes("$"))
  if (restos.length > 0)
    return {
      ok: false,
      motivo: `\`${encurta(restos[0])}\` ainda tem uma referência que o guard não resolve`,
    }
  if (valores.length === 0)
    return { ok: false, motivo: "nenhum valor provável (as atribuições não deixaram nenhum)" }
  // O VAZIO e um ALVO, nao um valor: `""` nao e caminho nem nome, e o guard o
  // resolveria por ACIDENTE se esta regra nao estivesse aqui — `binInstalado(root,
  // "")` e o DIRETORIO `node_modules/.bin` (`join(root, "node_modules", ".bin",
  // "")`), que existe em qualquer checkout instalado, e o comando sairia VERDE.
  // MEDIDO (M18): sem a regra, `bun run "$ENTRADA"` com `ENTRADA=""` sai 0.
  if (valores.some((v) => v === ""))
    return { ok: false, motivo: "a variável pode ser VAZIA (o valor da atribuição não é fixo)" }
  // A PROVENIENCIA da atribuicao entra no motivo: um valor que veio do AMBIENTE
  // (o `export` de quem chamou) nao esta "neste arquivo", e mandar o operador
  // procurar a linha no arquivo errado e a classe de mensagem que faz perder
  // tempo exatamente onde ela devia economizar.
  const herdadas = [
    ...new Set(nomes.map((n) => vars.atribuicoes.get(n)?.herdadaDe).filter((d) => d !== undefined)),
  ]
  return {
    ok: true,
    valores,
    motivo:
      `pelas atribuições de ${nomes.map((n) => `\`$${n}\``).join(", ")}` +
      (herdadas.length === 0
        ? " neste arquivo"
        : ` herdadas de ${herdadas.map((d) => `\`${d}\``).join(", ")}`),
  }
}

/**
 * As VARIAVEIS de um arquivo, prontas para julgar os tokens dele: as atribuicoes
 * de texto, o DIRETORIO do proprio arquivo (o valor de `$SCRIPT_DIR`) e o que ele
 * HERDOU de quem o chamou.
 *
 * A HERANCA existe porque o escopo do shell nao e o arquivo: com `bash`/`sh` o
 * processo novo recebe o AMBIENTE (o que foi `export`ado), e com `source`/`.` o
 * script roda no MESMO shell e ve TUDO. O que chega aqui ja vem com o DIRETORIO
 * DE QUEM EXPORTOU substituido — um `SCRIPT_DIR` exportado vale o diretorio do
 * chamador, nao o do filho, que e o que o runtime faz. O congelamento do idioma
 * no PARSE (logo abaixo) e o que faz esse valor atravessar como DADO: sem ele o
 * filho re-avaliaria a EXPRESSAO com o diretorio dele.
 *
 * O valor herdado NAO some por causa de uma atribuicao do filho: a atribuicao
 * pode estar dentro de um ramo que nao roda, e ai o valor do ambiente e o que o
 * runtime usa. A regua e a UNIAO — herdar a menos poderia inventar um verde.
 *
 * @param {string} content
 * @param {string} arquivo caminho relativo ao root
 * @param {Map<string, {valores: string[], linhas: number[], exportados: string[], herdadaDe?: string}>} [herdadas]
 */
export function variaveisDoArquivo(content, arquivo, herdadas = new Map()) {
  const dir = dirname(arquivo)
  const atribuicoes = new Map()
  for (const [nome, entrada] of herdadas) atribuicoes.set(nome, { ...entrada })
  for (const [nome, propria0] of atribuicoesDoTexto(content)) {
    // O congelamento do `@DIR@` e AQUI, no parse: e o unico ponto onde o diretorio
    // do arquivo que ESCREVEU o idioma esta na mao. Depois daqui o valor e um
    // dado, nao uma expressao (ver `comDirCongelado`).
    const propria = {
      ...propria0,
      valores: propria0.valores.map(comDirCongelado),
      exportados: propria0.exportados.map(comDirCongelado),
    }
    const base = atribuicoes.get(nome)
    if (base === undefined) {
      atribuicoes.set(nome, propria)
      continue
    }
    const juntas = {
      valores: [...new Set([...propria.valores, ...base.valores])],
      linhas: [...new Set([...propria.linhas, ...base.linhas])].sort((a, b) => a - b),
      // A exportacao e do ARQUIVO: herdar nao exporta. O que o filho poe no
      // ambiente dos NETOS e o que ele mesmo `export`a, mais o que ja herdou.
      exportados: [...new Set([...propria.exportados, ...base.exportados])],
    }
    // A proveniencia viaja para o motivo poder dizer de ONDE veio o valor: sem
    // isso, uma violacao de um valor HERDADO citaria a linha do arquivo errado.
    if (base.herdadaDe !== undefined) juntas.herdadaDe = base.herdadaDe
    atribuicoes.set(nome, juntas)
  }
  // O `dirPai` e o idioma da RAIZ (`SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"`):
  // para os scripts da casa (`scripts/x.sh`) ele vale `""`, que e a raiz do
  // repositorio — o unico diretorio de onde `$SCRIPT_DIR/scripts/y.mjs` sai como
  // `scripts/y.mjs`.
  const dirRel = dir === "." ? "" : dir
  const pai = dirname(dirRel)
  return { atribuicoes, dir: dirRel, dirPai: pai === "." ? "" : pai }
}

/** Os caminhos citados numa mensagem (`x`, `y`). */
function citados(valores) {
  return valores.map((v) => `\`${v}\``).join(", ")
}

/** O nome JA e um programa que o guard sabe resolver sozinho? */
function programaConhecido(ctx, nome) {
  return (
    INTERPRETERS.has(nome) ||
    EXTERNAL_TOOLS.has(nome) ||
    SHELL_BUILTINS.has(nome) ||
    ctx.pacotes.has(nome) ||
    BIN_PACKAGES[nome] !== undefined ||
    ctx.funcoes.has(nome)
  )
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
 * A CLASSE de um alvo: o que ele E diante do repositorio.
 *
 * `repositorio` — um caminho relativo: a unica classe que se PROVA no disco;
 * `absoluto`    — vive FORA do repositorio (`/etc/hosts`): nao ha disco a
 *                 conferir, e acusa-lo de "nao existe no repositorio" e uma
 *                 leitura sem sentido (o literal ja o resolve como "caminho
 *                 absoluto fora do repositorio");
 * `padrao`      — um glob (`scripts/*.sh`): nomeia um CONJUNTO, nao um arquivo.
 *                 O literal ja o resolve como "padrao, nao um caminho", e a
 *                 mesma leitura vale para o valor provado — julga-lo pela
 *                 existencia era pior que inutil: `scripts/*.sh` nunca e o nome
 *                 de um arquivo, e a mensagem ainda SUGERIA um vizinho
 *                 (`a.sh`), que e a distancia entre um padrao e um nome.
 *
 * Antes desta regua a classe existia em TRES lugares e em duas formas: o alvo
 * LITERAL tinha as duas metades certas (em `scriptAlvo` e no `julgaCaminho`), a
 * DESCIDA tinha o filtro (`alvosProvaveis`) e o VEREDITO do valor PROVADO por
 * variavel nao tinha nenhuma — ele julgava todo valor pela existencia.
 */
export function classeDoAlvo(valor) {
  if (valor.startsWith("/")) return "absoluto"
  if (/[*?[]/.test(valor)) return "padrao"
  return "repositorio"
}

/** O alvo E um caminho do repositorio (a unica classe que desce e que se prova)? */
export function ehCaminhoDoRepositorio(valor) {
  return classeDoAlvo(valor) === "repositorio"
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
 * O ALVO de um lancador de shell/`source`: o primeiro token que NAO e um flag,
 * com o motivo NOMEADO quando nao da para le-lo.
 *
 * Enquanto o alvo era `tokens[0]`, um flag a frente do arquivo virava "o alvo":
 * `bash -n "$TMP/x.sh"` era lido como "o alvo e `-n`" e o limite da descida saia
 * com a afirmacao FALSA de que o alvo "nao e um arquivo do repositorio" — o
 * arquivo estava ali, na frente do guard, atras de um flag. A classe do flag
 * (`FLAGS_DE_SHELL_*`) decide o que vem depois, e as tres classes em que a
 * leitura NAO continua saem com o motivo DITO (payload inline, `-n` que so
 * confere a sintaxe, flag que pode consumir o token seguinte) — o alvo nao
 * provado nunca e um caminho chutado.
 *
 * @param {{programa: string, tokens: string[]}} comando
 * @returns {{ok: true, alvo: string}|{ok: false, motivo: string}}
 */
export function alvoDoLancador(comando) {
  for (const token of comando.tokens ?? []) {
    if (token === "") continue
    if (!token.startsWith("-")) return { ok: true, alvo: token }
    if (FLAGS_DE_SHELL_SEM_ARQUIVO.has(token))
      return {
        ok: false,
        motivo: `payload inline de \`${comando.programa} ${token}\` — o script vive no argumento/stdin, nao como arquivo`,
      }
    if (FLAGS_DE_SHELL_NAO_EXECUTA.has(token))
      return {
        ok: false,
        motivo: `\`${comando.programa} ${token}\` so CONFERE a sintaxe do alvo — o interior dele nao e executado, entao nao ha o que descer`,
      }
    if (!FLAGS_DE_SHELL_EXECUTA.has(token))
      return {
        ok: false,
        motivo: `o flag \`${token}\` de \`${comando.programa}\` pode consumir o token seguinte — o alvo nao e provado por leitura`,
      }
  }
  return { ok: false, motivo: `\`${comando.programa}\` sem alvo de arquivo` }
}

/**
 * Por que um valor NAO desce: a CLASSE dele, em palavras (`padrao`, `absoluto`,
 * `repositorio`).
 *
 * O motivo generico ("nao e um arquivo do repositorio") nao distinguia um glob
 * de um `/opt/x.sh` — e nenhum dos dois e "um arquivo que falta": o primeiro e
 * um CONJUNTO que so o runtime expande, o segundo e um caminho FORA do
 * repositorio. A classe e a mesma regua do veredito (`classeDoAlvo`), dita em
 * vez de implicita.
 */
function classeDita(valor) {
  const classe = classeDoAlvo(valor)
  if (classe === "padrao")
    return "padrao, nao um caminho (o conjunto que o runtime expande nao e provado por leitura)"
  if (classe === "absoluto")
    return "caminho absoluto, fora do repositorio (nao ha arquivo daqui a ler)"
  return "caminho do repositorio (que falta no disco)"
}

/**
 * O arquivo de SHELL que este comando manda executar, ou null.
 *
 * Um flag antes do arquivo (`bash -u scripts/x.sh`) NAO e um alvo: quem le o
 * alvo e o `alvoDoLancador`, pela classe do flag. Um ALVO MONTADO EM `$VAR`
 * (`bash "$ALVO"` — quem resolve esse e o `alvosProvaveis`, abaixo) e tudo o
 * que NAO e caminho do repositorio tambem nao descem: o primeiro nao nomeia
 * arquivo (o guard ja o diz indeterminado), e o resto e decidido pela classe do
 * alvo (`classeDoAlvo`), a MESMA regua que o veredito usa — nao uma segunda
 * leitura.
 *
 * @param {{programa: string, tokens: string[]}} comando
 * @returns {string|null}
 */
export function scriptAlvo(comando) {
  if (!SHELL_INTERPRETERS.has(comando.programa) && !SOURCE_COMMANDS.has(comando.programa))
    return null
  const lancador = alvoDoLancador(comando)
  if (!lancador.ok) return null
  const alvo = lancador.alvo
  if (alvo.startsWith("$")) return null
  if (!ehCaminhoDoRepositorio(alvo)) return null
  return alvo
}

/**
 * Os arquivos de SHELL que este comando manda executar: o LITERAL, ou — quando o
 * alvo e um `$VAR` — os valores que as ATRIBUICOES do arquivo PROVAM.
 *
 * A descida seguia so o alvo LITERAL, e o preco era exatamente o comando que a
 * resolucao acabou de provar: `bash "$SCRIPT_DIR/x.sh"` sai `resolvido` (o
 * caminho foi provado!) e o que o x.sh executa ficava sem ninguem — a metade
 * mais util deste guard (a que acha o defeito um nivel ADIANTE) desligada
 * justamente onde o caminho e mais indireto. Quem decide aqui e a MESMA regua do
 * caminho provado (`caminhosProvaveis`, as atribuicoes do PROPRIO arquivo), e
 * so o que E caminho do repositorio desce (`ehCaminhoDoRepositorio`): um valor
 * absoluto ou um padrao nao tem arquivo a ler (e o veredito do comando diz por
 * que, NA MESMA CLASSE — ver `classeDoAlvo`).
 *
 * Vario valores provaveis = varios arquivos: TODOS descem (e a mesma regra do
 * conjunto que vale para o alvo do interpretador), cada um julgado UMA vez.
 *
 * @param {{programa: string, tokens: string[]}} comando
 * @param {{atribuicoes: Map<string, {valores: string[], linhas: number[]}>, dir: string, dirPai?: string}|undefined} vars
 * @returns {{ok: true, valores: string[]}|{ok: false, motivo: string}}
 */
export function alvosProvaveis(comando, vars) {
  const doShell = SHELL_INTERPRETERS.has(comando.programa) || SOURCE_COMMANDS.has(comando.programa)
  if (!doShell)
    return { ok: false, motivo: `\`${comando.programa}\` não executa um script de shell` }
  const lancador = alvoDoLancador(comando)
  if (!lancador.ok) return { ok: false, motivo: lancador.motivo }
  const alvo = lancador.alvo
  if (!alvo.startsWith("$"))
    return ehCaminhoDoRepositorio(alvo)
      ? { ok: true, valores: [alvo] }
      : { ok: false, motivo: `o alvo de \`${comando.programa}\` é ${classeDita(alvo)}` }
  if (vars === undefined) return { ok: false, motivo: "o texto do arquivo não está no contexto" }
  const provavel = caminhosProvaveis(alvo, vars)
  if (!provavel.ok) return { ok: false, motivo: provavel.motivo }
  const valores = provavel.valores.filter(ehCaminhoDoRepositorio)
  if (valores.length === 0)
    return {
      ok: false,
      motivo: `nenhum valor provável de \`${alvo}\` é caminho do repositorio (${[...new Set(provavel.valores.map(classeDoAlvo))].join("/")})`,
    }
  return { ok: true, valores }
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
 * O que o guard NAO consegue provar por leitura (payload de runtime, valor de
 * variavel NAO ESTATICO) nao passa em silencio: ele tem de estar em INDETERMINATE,
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
  // so existe em runtime. Provar se pode pelas ATRIBUICOES do proprio arquivo
  // (`PY=python3` / `PY=python` / `PY=node`) — e nao pode, o caminho honesto e
  // `indeterminado` + a declaracao datada: acusar `$PY` de "nao ser arquivo do
  // repositorio" seria falso (nao e um nome) e um falso positivo num gate
  // bloqueante.
  if (programa.startsWith("$")) return julgaProgramaVariavel(comando, ctx)

  if (INTERPRETERS.has(programa)) {
    // O SHELL le o alvo pela classe do FLAG (`alvoDoLancador`): `bash -e x.sh`
    // EXECUTA o arquivo (o `-e` e o errexit), e quem dizia "payload inline
    // (bash -e)" de um comando cujo alvo e um arquivo do repositorio era a
    // lista de flags escrita a mao. Os interpretadores FOLHA (node, python)
    // ficam com a leitura propria: o `-e` de um `node -e` e o eval DELE, e a
    // classe dos flags nao e a mesma — unificar ali seria trocar um erro por
    // outro.
    if (SHELL_INTERPRETERS.has(programa)) {
      const lancador = alvoDoLancador(comando)
      if (!lancador.ok) return { desfecho: "indeterminado", motivo: lancador.motivo }
      return julgaCaminho(
        ctx,
        lancador.alvo,
        `script do ${programa}`,
        comando.linha,
        comando.origem,
      )
    }
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
 * O veredito de um PROGRAMA montado em `$VAR`.
 *
 * Cada valor POSSIVEL tem de resolver, porque a leitura nao sabe qual ramo o
 * runtime toma: um valor que o guard nao conhece mantem o comando indeterminado
 * (nomeando qual), e um valor cujo ALVO nao resolve e a violacao dele.
 *
 * @param {{programa: string, tokens: string[], linha: number, origem: string}} comando
 * @param {{vars?: {atribuicoes: Map<string, {valores: string[], linhas: number[]}>, dir: string, dirPai?: string}}} ctx
 * @returns {Veredito}
 */
function julgaProgramaVariavel(comando, ctx) {
  const provavel =
    ctx.vars === undefined
      ? { ok: false, motivo: "o texto do arquivo não está no contexto" }
      : caminhosProvaveis(comando.programa, ctx.vars)
  if (!provavel.ok)
    return {
      desfecho: "indeterminado",
      motivo: `programa montado em runtime (\`${comando.programa}\`) — ${provavel.motivo}`,
    }
  const valores = provavel.valores
  const desconhecidos = valores.filter((v) => !programaConhecido(ctx, v))
  if (desconhecidos.length > 0)
    return {
      desfecho: "indeterminado",
      motivo:
        `programa provável (\`${comando.programa}\` → ${citados(valores)}, ${provavel.motivo}),` +
        ` e ${citados(desconhecidos)} não é um programa que o guard resolva — nenhuma leitura prova` +
        ` que ele existe`,
    }
  const interpretadores = valores.filter((v) => INTERPRETERS.has(v))
  if (interpretadores.length > 0) {
    const alvo = comando.tokens[0]
    if (alvo === undefined || alvo.startsWith("-"))
      return {
        desfecho: "indeterminado",
        motivo:
          `programa provável (\`${comando.programa}\` → ${citados(valores)}) e o comando não nomeia` +
          ` arquivo de script`,
      }
    const doAlvo = julgaCaminho(
      ctx,
      alvo,
      `script de ${citados(interpretadores)}`,
      comando.linha,
      comando.origem,
    )
    if (doAlvo.desfecho !== "resolvido")
      return {
        desfecho: doAlvo.desfecho,
        motivo: `programa provável (\`${comando.programa}\` → ${citados(valores)}, ${provavel.motivo}): ${doAlvo.motivo}`,
      }
    return {
      desfecho: "resolvido",
      motivo: `programa provável (\`${comando.programa}\` → ${citados(valores)}, ${provavel.motivo}) e o alvo resolve`,
    }
  }
  return {
    desfecho: "resolvido",
    motivo: `programa provável (\`${comando.programa}\` → ${citados(valores)}, ${provavel.motivo})`,
  }
}

/**
 * O veredito de uma ENTRADA de `scripts` montada em `$VAR` (`bun run "$ENTRADA"`).
 *
 * A entrada de `bun run` NAO e um caminho: o que a variavel vale e o NOME de um
 * script do `package.json`, e a prova e OUTRA — que o nome EXISTE em `scripts` (e
 * que o comando dele resolve, a mesma descida da entrada LITERAL). Sem esta
 * regra a unica saida era `indeterminado` + uma decisao datada em INDETERMINATE,
 * e uma isencao NAO distingue a entrada que existe da que foi REMOVIDA no mesmo
 * commit: o passo-que-nunca-roda voltaria, agora escondido atras de uma linha de
 * lista que ninguem tem motivo para reler.
 *
 * As duas metades da entrada LITERAL valem aqui, uma a uma: o valor provavel tem
 * de ser uma entrada de `scripts`, um BINARIO de dependencia declarada (nas duas
 * formas — `bun run vitest` e o mesmo binario) ou, so na forma SEM `run`, um
 * subcomando nativo do gerenciador; sem essas alternativas uma variavel legitima
 * como `BIN=vitest` viraria violacao FALSA num gate bloqueante. E o que a entrada
 * executa e julgado recursivamente. O que NAO da para provar (valor nao estatico,
 * cadeia longa, conjunto acima do teto) segue indeterminado — e ai a decisao
 * datada continua sendo exigida, como antes.
 *
 * @param {{root: string, scripts: Record<string, unknown>, vars?: {atribuicoes: Map<string, {valores: string[], linhas: number[]}>, dir: string, dirPai?: string}}} ctx
 * @param {{linha: number, origem: string}} comando
 * @param {string} possivelEntrada
 * @param {boolean} explicito a forma era `bun run <entrada>` (e nao `bun <entrada>`)?
 * @returns {Veredito}
 */
function julgaEntradaVariavel(ctx, comando, possivelEntrada, explicito) {
  const { programa } = comando
  // O rótulo é a FORMA que o hook escreveu (`bun run $X` é uma coisa, `bun $X`
  // outra): a mensagem diz de qual delas está falando.
  const rotulo = `${programa}${explicito ? " run" : ""}`
  const provavel =
    ctx.vars === undefined
      ? { ok: false, motivo: "o texto do arquivo não está no contexto" }
      : caminhosProvaveis(possivelEntrada, ctx.vars)
  if (!provavel.ok)
    return {
      desfecho: "indeterminado",
      motivo: `${rotulo} com entrada montada em runtime (\`${possivelEntrada}\`) — ${provavel.motivo}`,
    }
  // O que o valor pode NOMEAR: a MESMA régua da entrada literal (a entrada de
  // `scripts`, o binário de dependência que ela também aceita, e o subcomando
  // nativo na forma sem `run`).
  const comoPrograma = (valor) =>
    classificaBruto(
      { linha: comando.linha, programa: valor, tokens: [], origem: comando.origem },
      ctx,
    ).desfecho === "resolvido"
  const aceita = (valor) =>
    ctx.scripts[valor] !== undefined ||
    (!explicito && PACKAGE_MANAGER_SUBCOMMANDS.has(valor)) ||
    comoPrograma(valor)
  const faltando = provavel.valores.filter((valor) => !aceita(valor))
  if (faltando.length > 0) {
    const vizinho = sugestao(faltando[0], Object.keys(ctx.scripts))
    return {
      desfecho: "violacao",
      motivo:
        `${rotulo}: entrada provável (\`${possivelEntrada}\` → ${citados(provavel.valores)}, ${provavel.motivo}) e ${citados(faltando)} não é entrada de \`scripts\` do package.json nem binário de dependência declarada` +
        (vizinho === null ? "" : ` — o mais próximo é \`${vizinho}\``),
    }
  }
  // O que as entradas EXECUTAM também é comando nosso: uma entrada que existe e
  // roda um arquivo que sumiu é o passo-que-nunca-roda, um nível adiante — e o
  // ALVO do defeito interno viaja junto, como na entrada literal.
  let executadas = 0
  for (const entrada of provavel.valores) {
    if (ctx.scripts[entrada] === undefined) continue
    executadas += 1
    const violado = comandosDeScript(ctx.root, entrada, ctx.scripts)
      .map((interno) => classify(interno, ctx))
      .find((veredito) => veredito.desfecho === "violacao")
    if (violado !== undefined)
      return {
        desfecho: "violacao",
        motivo: `entrada provável \`${possivelEntrada}\` → \`${entrada}\` (em \`scripts\`) → ${violado.motivo}`,
        remendo: violado.remendo,
      }
  }
  return {
    desfecho: "resolvido",
    motivo:
      `entrada provável (\`${possivelEntrada}\` → ${citados(provavel.valores)}, ${provavel.motivo})` +
      (executadas === 0 ? "" : ", e o que ela executa resolve"),
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
 * Um token que carrega `$VAR` e resolvido pelas ATRIBUICOES do proprio arquivo:
 * quando o conjunto de valores e PROVAVEL e todos existem, o veredito e
 * `resolvido` (o alvo foi PROVADO, nao declarado); quando algum nao existe, a
 * violacao nomeia qual e o que a variavel vale — sem `remendo`, porque nao ha
 * token de caminho a trocar (a variavel pode ter varios valores, e quem escolhe a
 * atribuicao errada e o operador).
 *
 * O conjunto e julgado INTEIRO (um ramo que falta reprova), e cada valor cai na
 * classe do alvo LITERAL (`classeDoAlvo`): o valor ABSOLUTO de uma atribuicao e
 * "caminho absoluto fora do repositorio" (resolvido, como o literal — julga-lo
 * pela existencia ACUSAVA o sao, `/etc/hosts` nunca vai estar no repositorio) e o
 * valor de PADRAO e `indeterminado` ("padrao, nao um caminho", como o literal — a
 * decisao datada continua sendo exigida, e a mensagem parou de sugerir o vizinho
 * de um padrao). A ordem e o fail-closed: caminho do repositorio que falta
 * reprova ANTES de qualquer classe; um padrao no conjunto impede o `resolvido` de
 * uma parte (ele pode ser o ramo que roda); so o conjunto sem nenhum caminho do
 * repositorio e que e um alvo absoluto.
 *
 * @param {{root: string, vars?: {atribuicoes: Map<string, {valores: string[], linhas: number[]}>, dir: string, dirPai?: string}}} ctx
 * @param {string} alvo
 * @param {string} papel
 * @param {number} linha
 * @param {string} origem
 * @returns {Veredito}
 */
function julgaCaminho(ctx, alvo, papel, linha, origem) {
  if (alvo.startsWith("$")) {
    const provavel =
      ctx.vars === undefined
        ? { ok: false, motivo: "o texto do arquivo não está no contexto" }
        : caminhosProvaveis(alvo, ctx.vars)
    if (!provavel.ok)
      return {
        desfecho: "indeterminado",
        motivo: `${papel}: caminho montado em runtime (\`${alvo}\`) — ${provavel.motivo}`,
      }
    // So o que E caminho do repositorio se prova no disco: o valor absoluto e o
    // padrao nao tem arquivo a conferir, e julga-los pela EXISTENCIA era a
    // acusacao falsa que a classe do alvo literal ja nao cometia.
    const doRepositorio = provavel.valores.filter(ehCaminhoDoRepositorio)
    const faltando = doRepositorio.filter((v) => !arquivoExiste(ctx.root, v))
    if (faltando.length === 0) {
      // A CLASSE de cada valor provado, na MESMA regua do alvo literal
      // (`classeDoAlvo`): um padrao no conjunto impede o `resolvido` (ele pode ser
      // o ramo que o runtime expande), e um conjunto que nao tem caminho NENHUM
      // do repositorio (so absolutos) e "fora do repositorio", como o literal.
      const padrao = provavel.valores.find((v) => classeDoAlvo(v) === "padrao")
      if (padrao !== undefined)
        return {
          desfecho: "indeterminado",
          motivo: `${papel} \`${alvo}\` provável (${provavel.motivo}): padrão, não um caminho (\`${padrao}\`)`,
        }
      if (doRepositorio.length === 0)
        return {
          desfecho: "resolvido",
          motivo: `${papel} \`${alvo}\` provável (${provavel.motivo}): ${citados(provavel.valores)}, caminho absoluto fora do repositório`,
        }
      return {
        desfecho: "resolvido",
        motivo: `${papel} \`${alvo}\` provável (${provavel.motivo}): ${citados(provavel.valores)}`,
      }
    }
    const vizinho = sugestao(basename(faltando[0]), irmaos(ctx.root, faltando[0]))
    return {
      desfecho: "violacao",
      motivo:
        `${papel} \`${alvo}\` provável (${provavel.motivo}) aponta para ${citados(faltando)},` +
        ` que NÃO existe no repositório` +
        (vizinho === null ? "" : ` — o mais próximo é \`${vizinho}\``),
    }
  }
  const classe = classeDoAlvo(alvo)
  if (classe === "absoluto")
    return { desfecho: "resolvido", motivo: `${papel}: caminho absoluto fora do repositório` }
  if (classe === "padrao")
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
  // A ENTRADA montada em `$VAR` entra no mesmo julgamento: ela nomeia o NOME de
  // um script do `package.json` (ou de um binario), nao um caminho — e sem esta
  // regra a unica saida era a isencao datada, que cobre a entrada existente e a
  // removida com o mesmo silencio.
  const porVariavel = possivelEntrada !== undefined && possivelEntrada.startsWith("$")
  if (explicito || porVariavel || ctx.scripts[possivelEntrada] !== undefined) {
    if (possivelEntrada === undefined)
      return { desfecho: "indeterminado", motivo: `${programa} run sem entrada` }
    if (porVariavel) return julgaEntradaVariavel(ctx, comando, possivelEntrada, explicito)
    if (possivelEntrada.startsWith("-"))
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
  /**
   * O que um script CHAMADO daqui herda das variaveis deste arquivo.
   *
   * Com `bash`/`sh` o processo novo recebe o AMBIENTE — so o que este arquivo
   * `export`ou; com `source`/`.` e o MESMO shell, e ele ve TUDO. O nome `tudo`
   * diz qual dos dois casos e, e ele vem da FORMA da chamada (a mesma regua que
   * ja decide o escopo das FUNCOES).
   *
   * Os valores saem daqui com o DIRETORIO DO CHAMADOR ja substituido: um
   * `SCRIPT_DIR` exportado vale o diretorio de QUEM o exportou, e nao o de quem
   * le — o marcador `@DIR@` e resolvido no momento da HERANCA, nao no da leitura
   * do filho (que tem outro diretorio).
   *
   * @param {{atribuicoes: Map<string, {valores: string[], linhas: number[], exportados: string[]}>, dir: string, dirPai?: string}} vars
   * @param {string} de o arquivo que esta passando as variaveis
   * @param {boolean} tudo o chamador e `source`/`.` (mesmo shell)?
   */
  const herancaPara = (vars, de, tudo) => {
    const resolvidos = (lista) => aplicaMarcas(lista, vars)
    const saida = new Map()
    for (const [nome, entrada] of vars.atribuicoes) {
      const paraOProcesso = tudo ? entrada.valores : entrada.exportados
      if (paraOProcesso.length === 0) continue
      saida.set(nome, {
        valores: resolvidos(paraOProcesso),
        linhas: entrada.linhas,
        exportados: resolvidos(entrada.exportados),
        herdadaDe: de,
      })
    }
    return saida
  }

  const julga = (arquivo, content, opcoes = {}) => {
    const {
      origem = "",
      funcoes = ctx.funcoes,
      herdadas = new Map(),
      profundidade = 0,
      cadeia = new Set(),
    } = opcoes
    // As VARIAVEIS DE CAMINHO do arquivo julgado, com o DIRETORIO dele (o valor
    // de `$SCRIPT_DIR`): sao elas que provam `$PYTHON_SCRIPT` e `$PY_SCRIPT` — o
    // alvo do interpretador deixa de ser uma decisao datada e vira fato medido.
    // As HERDADAS de quem chamou entram junto (ver `herancaPara`): o escopo do
    // shell nao e o arquivo, e ignorar o AMBIENTE acusaria um script que roda.
    const vars = variaveisDoArquivo(content, arquivo, herdadas)
    const contexto = { ...ctx, funcoes, vars }
    for (const comando of shellCommands(content, { origem })) {
      const veredito = classify(comando, contexto)
      relatorios.push({ arquivo, ...comando, ...veredito })
      // So se DESCE no que resolveu: um comando ja reprovado nao tem alvo
      // confiavel para ler (e a violacao dele e o veredito).
      if (veredito.desfecho !== "resolvido") continue
      // O alvo LITERAL e o alvo PROVADO por variavel caem no mesmo lugar: um
      // `bash "$SCRIPT_DIR/x.sh"` cujo valor o guard provou tem o INTERIOR tao
      // julgavel quanto o `bash scripts/x.sh` do lado dele. O que nao desce (um
      // valor absoluto, um glob, um alvo que o comando nem resolveu) sai nomeado
      // pelo proprio veredito do comando, nunca em silencio.
      const alvos = alvosProvaveis(comando, contexto.vars)
      if (!alvos.ok) continue
      const chamador = `${arquivo}:${comando.linha}`
      for (const alvo of alvos.valores) {
        if (!arquivoExiste(root, alvo)) continue
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
          herdadas: herancaPara(vars, arquivo, SOURCE_COMMANDS.has(comando.programa)),
          profundidade: profundidade + 1,
          cadeia: new Set([...cadeia, alvo]),
        })
      }
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

  const scriptsDescentidosOrdenados = scriptsDescentidos.sort()
  // A PROSA nao carrega numero escrito a mao: os numeros que a doc publica
  // sobre este guard sao CONFERIDOS contra o que ele acabou de medir (ver
  // `numerosDaProsa`), e as violacoes vivem em `doc` — separadas de
  // `violacoes` de proposito, porque a SOMA de desfechos dos comandos
  // (`resolvidos + indeterminados + violacoes === comandos`) mede a extracao, e
  // uma prosa desatualizada nao pode entrar nela.
  //
  // O retorno e UM literal (e nao um `report` montado antes): e essa forma que
  // mantem a uniao com o caminho `infra` redutivel pelo `tsc` — o consumidor
  // (o `forge-doctor`) le `.comandos` depois de conferir `.infra`, e um objeto
  // inferido em duas etapas deixa de ser subtipo do caminho de falha.
  const doc = numerosDaProsa({
    root,
    hooks,
    scripts: scriptsDescentidosOrdenados,
    comandos: relatorios,
    resolvidos,
    indeterminados,
  })
  return {
    infra: false,
    root,
    hooks,
    scripts: scriptsDescentidosOrdenados,
    limites,
    comandos: relatorios,
    resolvidos,
    violacoes,
    indeterminados,
    allowlistReview,
    indeterminadosReview,
    reviewDays,
    doc,
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

E as VARIÁVEIS DE CAMINHO do arquivo julgado são RESOLVIDAS: o alvo
\`python3 "$PYTHON_SCRIPT"\` é provado pelas atribuições dele (\`SCRIPT_DIR\`
incluído, pelo idioma \`$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)\`), e TODOS os
valores prováveis têm de existir no repositório — uma atribuição ilegível mantém
o comando indeterminado (o payload de \`-c\`, que não é caminho, segue exigindo a
decisão datada em \`INDETERMINATE\`).

Exit code:
  0 — todo comando resolve (e as listas de decisão estão dentro da janela, e os
      números de produção da prosa batem com o medido)
  1 — comando que não resolve, decisão sem \`addedAt\` / fora da janela, ou número
      de produção da prosa que não bate com o medido
  2 — infra: \`.husky/\` ou \`package.json\` ausente/ilegível (fail-closed)
  3 — uso inválido (\`--fix\` com \`--json\`/\`--list\`, \`--yes\` sem \`--fix\`,
      \`--root\` sem valor)

O REMENDO (\`--fix\`), em uma linha: o guard diz QUAL era o nome esperado; o
\`--fix\` troca o token por ele quando não há dúvida — até ${FIX_MAX_DISTANCE}
caracteres de diferença, UM candidato só (empate é RECUSA, quem escolhe é o
operador), arquivo de verdade e token localizável sem ambiguidade. O que ele não
sabe remendar (a entrada de \`bun run\`, a função não definida, o binário sem
fornecedor, o payload de runtime e o alvo PROVADO que não existe — a variável pode
ter vários valores e quem escolhe a atribuição errada é o operador) sai NOMEADO no
plano, com o motivo. E como
\`.husky/\` é o arquivo que o hook EXECUTA, quem remenda por dentro do pre-commit
leva o veredito de um \`git commit\` NOVO.
`

// ── OS NUMEROS DE PRODUCAO NA PROSA (derivados do medido, conferidos) ──────

/**
 * A doc que publica os numeros deste guard.
 *
 * POR QUE ESTA REGRA EXISTE: a prosa do `docs/GUARDS.md` citava os numeros de
 * producao deste guard (total, resolvidos, hooks, scripts descidos) escritos A
 * MAO — e eles JA estavam mentirosos quando a regra nasceu (a prosa dizia 250
 * comandos / 244 resolvidos / 105 nos hooks; o medido era 251 / 245 / 106). Um
 * numero de doc que ninguem deriva envelhece sozinho: o leitor confere a escala
 * do guard por ele, e a escala errada faz um guard cego parecer saudavel (a
 * mesma classe do piso de cobertura, um nivel acima: no piso o guard mede o
 * VAZIO, aqui ele mede cheio e a doc conta outra coisa).
 *
 * Os numeros NAO sao recopiados para lugar nenhum: a regra le a prosa na FORMA
 * CANONICA (abaixo), compara com o que o `analyze()` mediu e falha nomeando o
 * delta. Uma forma que sumiu da prosa e violacao (a doc parou de publicar), e
 * duas declaracoes DIFERENTES da mesma forma tambem (a regua nao escolhe uma).
 */
export const DOC_NUMEROS = "docs/GUARDS.md"

/**
 * A FORMA CANONICA de cada numero na prosa, com o que ele tem de bater.
 *
 * Cada entrada casa o texto da doc e devolve os numeros que ele DECLARA; o
 * `medido` devolve os mesmos em ORDEM, para a comparacao ser posicional sem
 * precisar de duas reguas de leitura.
 */
const NUMEROS_DA_PROSA = [
  {
    campo: "comandos",
    forma: "**<N> comandos**",
    re: /\*\*(\d+)\s+comandos\*\*/g,
    medido: (r) => [r.comandos.length],
    rotulo: "o total de comandos julgados",
  },
  {
    campo: "dentroDosHooks",
    forma: "<N> nos <N> hooks",
    re: /(\d+)\s+nos\s+(\d+)\s+hooks?\b/g,
    medido: (r) => [nosHooks(r).length, r.hooks.length],
    rotulo: "os comandos dentro dos hooks e o nº de hooks",
  },
  {
    campo: "dentroDosScripts",
    forma: "<N> dentro dos <N> scripts chamados",
    re: /(\d+)\s+dentro dos\s+(\d+)\s+scripts?\s+chamados?/g,
    medido: (r) => [nosScripts(r).length, r.scripts.length],
    rotulo: "os comandos dentro dos scripts chamados e o nº deles",
  },
  {
    campo: "resolvidos",
    forma: "**<N> resolvidos**",
    re: /\*\*(\d+)\s+resolvidos?\*\*/g,
    medido: (r) => [r.resolvidos.length],
    rotulo: "os comandos resolvidos",
  },
  {
    campo: "indeterminados",
    forma: "**<N> indeterminados",
    re: /\*\*(\d+)\s+indeterminados?\b/g,
    medido: (r) => [r.indeterminados.length],
    rotulo: "os comandos indeterminados",
  },
]

/**
 * Os comandos julgados NO PROPRIO hook (a outra metade e a descida).
 *
 * A fronteira e o ARQUIVO do comando, nao o campo `origem`: um comando que vive
 * dentro de um `$( ... )` do hook carrega `origem: "substituicao"` e o arquivo
 * continua sendo o hook — separar por `origem` moveria 27 comandos do hook para
 * a descida, que e exatamente o numero que a prosa publica (106/145).
 */
function nosHooks(report) {
  const hooks = new Set(report.hooks)
  return report.comandos.filter((c) => hooks.has(c.arquivo))
}

/** Os comandos julgados no INTERIOR de um script chamado (a descida). */
function nosScripts(report) {
  const hooks = new Set(report.hooks)
  return report.comandos.filter((c) => !hooks.has(c.arquivo))
}

/**
 * Os numeros de producao da prosa contra o medido.
 *
 * Nunca lanca: devolve `{declarado, medido, violacoes}`. Um arquivo ausente e
 * uma violacao QUANDO o root e o proprio repositorio (a doc e um arquivo deste
 * contrato) e um LIMITE DECLARADO num fixture (a arvore de teste nao carrega a
 * doc, e exigir uma doc com os numeros do fixture seria medir outra coisa).
 *
 * @param {{root?: string, hooks?: string[], scripts?: string[], comandos?: object[],
 *   resolvidos?: object[], indeterminados?: object[]}} report
 *   o que o `analyze()` mediu (o relatório inteiro, ou o mínimo que a régua lê)
 * @returns {{arquivo: string, ausente: boolean, declarado: Record<string, number[]|null>,
 *            medido: Record<string, number[]>,
 *            violacoes: {arquivo: string, linha: number, programa: string, motivo: string}[]}}
 */
export function numerosDaProsa(report) {
  const caminho = join(report.root, DOC_NUMEROS)
  const medido = {}
  for (const forma of NUMEROS_DA_PROSA) medido[forma.campo] = forma.medido(report)
  const declarado = {}
  for (const forma of NUMEROS_DA_PROSA) declarado[forma.campo] = null
  const violacoes = []

  if (!existsSync(caminho)) {
    if (report.root === ROOT) {
      violacoes.push({
        arquivo: DOC_NUMEROS,
        linha: 0,
        programa: "numerosDaProsa",
        motivo: `${DOC_NUMEROS} nao existe: a prosa dos numeros de producao deste guard nao tem onde ser publicada (e a regra que a confere fica cega).`,
      })
    }
    return { arquivo: DOC_NUMEROS, ausente: true, declarado, medido, violacoes }
  }

  const texto = readFileSync(caminho, "utf8")
  const faltando = []
  for (const forma of NUMEROS_DA_PROSA) {
    // O indice do casamento vem do `matchAll`: a LINHA da declaracao tem de
    // sair da posicao do proprio casamento (um `indexOf` dos digitos acharia o
    // primeiro "7" da doc, nao o "7 indeterminados" da linha publicada).
    const achados = [...texto.matchAll(forma.re)].map((m) => ({
      valores: m.slice(1).map(Number),
      linha: texto.slice(0, m.index).split("\n").length,
    }))
    if (achados.length === 0) {
      faltando.push(forma.forma)
      continue
    }
    const distintas = [...new Set(achados.map((a) => a.valores.join(" / ")))]
    if (distintas.length > 1) {
      violacoes.push({
        arquivo: DOC_NUMEROS,
        linha: achados[0].linha,
        programa: forma.campo,
        motivo: `a prosa declara ${forma.rotulo} de DUAS formas diferentes (${distintas.join(" | ")}) — a regua nao escolhe uma: deixe UMA declaracao na forma \`${forma.forma}\`.`,
      })
      continue
    }
    declarado[forma.campo] = achados[0].valores
    if (achados[0].valores.join(" / ") !== medido[forma.campo].join(" / ")) {
      let i = 0
      const comMedido = forma.forma.replace(/<N>/g, () => String(medido[forma.campo][i++]))
      violacoes.push({
        arquivo: DOC_NUMEROS,
        linha: achados[0].linha,
        programa: forma.campo,
        motivo: `a prosa declara ${forma.rotulo} como ${achados[0].valores.join(" / ")} e o medido e ${medido[forma.campo].join(" / ")} — o numero da doc nao e derivado do \`analyze()\`: escreva \`${comMedido}\`.`,
      })
    }
  }
  if (faltando.length > 0) {
    violacoes.push({
      arquivo: DOC_NUMEROS,
      linha: 0,
      programa: "numerosDaProsa",
      motivo: `os numeros de producao deste guard estao INCOMPLETOS na prosa: falta(m) ${faltando.map((f) => `\`${f}\``).join(", ")} (ou a forma saiu do formato canonico). A doc publica os numeros medidos do \`analyze()\` — um deles sumir nao pode virar "nao ha o que conferir".`,
    })
  }
  return { arquivo: DOC_NUMEROS, ausente: false, declarado, medido, violacoes }
}

function printReport(report, { list = false } = {}) {
  if (report.infra) {
    if (report.hooks.length === 0) console.error("❌ .husky/ sem nenhum hook — nada a julgar")
    else console.error("❌ package.json ausente ou ilegível — scripts não julgáveis")
    return EXIT.UNJUDGEABLE
  }
  const violacoes = [
    ...report.violacoes,
    ...reviewViolations(report),
    ...(report.doc?.violacoes ?? []),
  ]

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

  // Os numeros de producao que a doc publica saem do proprio medido: a linha
  // abaixo e a MESMA fonte que a regra confere, entao ler o relatorio e ler a
  // doc nao podem contar coisas diferentes.
  if (report.doc !== undefined) {
    if (report.doc.ausente)
      console.log(
        `   ⚠️  ${DOC_NUMEROS} ausente neste root — os numeros de producao da prosa nao foram conferidos (limite declarado do fixture)`,
      )
    else
      console.log(
        `📄 Prosa (${DOC_NUMEROS}): ${report.doc.medido.comandos.join(" / ")} comando(s) ` +
          `(${report.doc.medido.dentroDosHooks.join(" nos ")} hooks + ` +
          `${report.doc.medido.dentroDosScripts.join(" dentro dos ")} scripts chamados), ` +
          `${report.doc.medido.resolvidos.join(" / ")} resolvido(s), ` +
          `${report.doc.medido.indeterminados.join(" / ")} indeterminado(s) — DERIVADOS do medido`,
      )
  }

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
      const violacoes = report.infra
        ? []
        : [...report.violacoes, ...reviewViolations(report), ...(report.doc?.violacoes ?? [])]
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
            // O que a prosas publica sobre este guard, derivado do medido: o
            // mesmo par (declarado, medido) que a regra confere.
            numeros: report.doc?.medido ?? null,
            doc:
              report.doc === undefined
                ? null
                : {
                    arquivo: report.doc.arquivo,
                    ausente: report.doc.ausente,
                    declarado: report.doc.declarado,
                  },
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
