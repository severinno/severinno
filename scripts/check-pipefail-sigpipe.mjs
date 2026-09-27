#!/usr/bin/env node

// =============================================================================
// check-pipefail-sigpipe.mjs
//
// Guard que impede a VOLTA da classe SIGPIPE: num contexto com `set -o
// pipefail`, `algo | grep -q PADRAO` pode falhar com 141 MESMO quando o padrão
// é encontrado — e falha de forma INTERMITENTE.
//
// POR QUE (a mecânica, porque o defeito parece impossível):
// `grep -q` fecha o stdin no PRIMEIRO casamento (é o ponto de `-q`: parar de
// ler). Se o produtor ainda tem bytes para escrever quando o leitor some, o
// kernel entrega SIGPIPE a ele: o produtor morre com 141, e sob `pipefail` a
// soma do pipeline passa a 141. Com pouco texto não acontece nada (tudo cabe no
// buffer do pipe e o `write` termina antes de o grep sair) — e é por isso que o
// defeito sobrevive: ele depende do TAMANHO da saída (> PIPE_BUF, 4 KiB, é
// suficiente para o `write` ser fatiado). No mesmo script, uma rodada passa e a
// seguinte falha, com a mensagem apontando para a asserção que ACHOU o texto.
//
// O DEFEITO REAL (09/2026, o motivo deste arquivo): os `test-mutation-*.sh`
// capturam a saída de um `vitest`/`bash` em variável e a empurram para um
// `grep` quieto (`echo "$OUTPUT" | grep -Fq ...`). Com a suíte grande, o
// `test-mutation-coord-update.sh` era vermelho em ~1 de cada 3 execuções, e o
// diagnóstico apontava para asserções de contagem — nada a ver com SIGPIPE.
// A correção foi herestring (`grep -Fq PADRAO <<< "$OUTPUT"`): nenhum pipe,
// nenhum produtor para levar SIGPIPE, mesma asserção.
//
// O REMÉDIO (por que herestring, e não `|| true`):
// `<<< "$VAR"` entrega o texto por um descritor que o PRÓPRIO bash preenche; o
// bash trata o resultado da escrita e não existe processo produtor para levar
// SIGPIPE. Quando o produtor é um comando vivo, captura-se antes e o herestring
// recebe a variável:
//   out=$(docker ps --format '{{.Names}}'); grep -q x <<< "$out"
//
// A DÍVIDA NASCEU DECLARADA (216 em 47 arquivos) E FOI APOSENTADA (0)
//
// Quando este guard nasceu, o padrão já estava no repositório: 216 ocorrências
// em 47 arquivos (95 delas nos mutation tests). Consertar tudo de uma vez seria
// uma reescrita de ~200 linhas, então a dívida foi DECLARADA num baseline com
// cota por arquivo — o gate falhava no que passasse da cota, e o relatório
// imprimia quanto e desde quando. Era um estado intermediário honesto, não o
// destino: cota velha é allowlist com outro nome.
//
// O destino foi alcançado com o `--fix` (abaixo): o remédio mecânico reduziu as
// 216 a ZERO, o baseline foi REMOVIDO, e agora o gate é ABSOLUTO — qualquer
// ocorrência reprova o PR, em qualquer arquivo, sem exceção para revisar. O
// mecanismo de baseline continua existindo (e `--update` continua criando um),
// para o dia em que existir um caso que realmente não possa ser consertado já —
// mas só sob as TRÊS CONDIÇÕES que ele prometia em prosa e não cumpria (elas
// agora são MECANISMO, e é isto que impede a dívida de voltar por esquecimento):
//   1. DECLARADO: `--update` exige `--reason "<texto>"` quando há alguma
//      ocorrência a declarar. Sem a razão escrita, ele RECUSA e não grava nada —
//      declarar dívida é uma decisão, não um comando para deixar o gate verde;
//   2. JUSTIFICADO: a razão vai para o ARQUIVO (`reason`), não para a caixa de
//      entrada de quem rodou o comando;
//   3. VENCÍVEL: a data e a janela vêm do módulo COMPARTILHADO
//      (`allowlist-review.mjs`, 180 dias — a mesma regra das outras três
//      allowlists do repositório, e não uma segunda implementação de data).
//      Passada a janela, o run normal emite `::warning::` e o `--review` (no job
//      semanal, ao lado das outras allowlists) faz da decisão vencida VIOLAÇÃO.
//
// ESCOPO (declarado, porque gate que varre menos do que parece mente):
//   1. scripts de shell DO REPOSITÓRIO (*.sh, *.bash) que DECLARAM pipefail
//      (`set -euo pipefail` & cia) — sem pipefail a soma do pipeline é o status
//      do grep e o SIGPIPE do produtor não é observado, então não é a classe;
//      NÃO existe `set +o pipefail` no repositório: a declaração vale para o
//      arquivo inteiro. "Do repositório" é a ÁRVORE menos o que o próprio
//      repositório declara LOCAL (`semLocaisIgnorados`): o scratch de uma sessão
//      (o `.tmp/` de um checkout compartilhado) não é script dele, e o
//      VERSIONADO nunca sai — mesmo que uma regra de ignore o case, o CI o
//      carrega. O que ficou de fora sai NOMEADO no relatório (e no `--json`),
//      porque gate que varre menos sem dizer mente pelo que não diz; e git que
//      não responde devolve a lista INTEIRA, com o motivo — nunca um corte
//      inventado;
//   2. os hooks do `.husky/` (arquivos SEM extensão que o git roda: `pre-commit`,
//      `pre-push`, `post-checkout`) — são scripts de shell como os outros, e um
//      deles já tinha a classe;
//   3. os corpos `run:` dos workflows das DUAS forjas (scripts/forge-workflows.mjs,
//      a mesma lista do resto dos guards), inclusive os passos escritos com a
//      chave na própria linha do item (`- run: ...`, 36 no repositório), em
//      contexto com pipefail: `shell: bash` no passo (o runner gera
//      `bash --noprofile --norc -eo pipefail {0}`), um `defaults: run: shell:`
//      que LIGA o pipefail, ou o próprio corpo fazendo `set -o pipefail`. O passo
//      SEM pipefail não fica fora: ele reprova pelo mesmo padrão, porque a
//      segurança dele dependeria do shell default do RUNNER;
//   4. a PREMISSA do shell default é FATO, não suposição. `defaults: run: shell:`
//      (no arquivo e no job) é LIDO, e uma declaração que LIGA o pipefail FALHA o
//      gate — nomeando o escopo e quantos passos ela reclassificou DE UMA VEZ: ela
//      troca a premissa de todos os passos do escopo numa linha, sem que um passo
//      sequer mude no diff. A forma INLINE (`defaults: {run: {shell: bash}}`) sai
//      INDETERMINADA — não ler não é o mesmo que não haver. E o relatório diz,
//      passo a passo, de ONDE vem o shell: do passo, do `defaults:` do job, do
//      `defaults:` do arquivo ou do runner (a premissa que não é deste
//      repositório).
//
// APOSENTAR A DÍVIDA (--fix)
//
// O remédio é aplicável por MÁQUINA, e é o `--fix`: troca
// `PRODUTOR | grep -q PADRAO` por `grep -q PADRAO <<< "$(PRODUTOR)"` — a MESMA
// semântica (o texto do produtor vira a entrada do grep) sem o pipe que dá
// SIGPIPE ao produtor. Ele é conservador de propósito:
//   1. só toca CÓDIGO: corpo de HEREDOC é texto (nos mutation tests ele contém o
//      padrão como FIXTURE) — o `--fix` nunca reescreve o que o guard não acusa;
//   2. FAIL-CLOSED: cada reescrita tem de REDUZIR a contagem de ocorrências do
//      comando E preservar as EXPRESSÕES do runner (`${{ ... }}`) — perder,
//      duplicar ou reordenar uma muda o comando sem mudar nada que o bash veja. O
//      arquivo não é gravado se qualquer das duas não se cumprir;
//   3. continuação (`\`) é COMPRIMIDA numa linha — o `\` existia para o pipeline
//      caber, e o remédio tira o pipeline;
//   4. é uso LOCAL (como o `--update`): o PR que aposenta dívida revisa o diff.
//
// O MESMO REMÉDIO VAI AO PR (o CANAL)
//
// `--fix --dry-run` é a PREVISÃO do remédio: imprime o PATCH exato (unificado, com
// CONTEXTO em cada hunk — a MESMA construção do outro fixer mecânico,
// `unified-patch.mjs`) e NÃO grava nada. Ele sai em STDOUT LIMPO, para
// `… --fix --dry-run | git apply` aplicar: quem aplica o patch do comentário do PR
// aplica exatamente o que este comando imprimiria (é o MESMO `fixAll`; `dry` decide
// só não escrever). Nada a remendar = patch vazio, e nada é tocado. O
// `scripts/pr-remedy-comment.mjs` publica esse patch como comentário no PR
// (`--fixer pipefail-sigpipe`) e o RECONCILIA: quando a cicatriz some, o comentário
// é RETIRADO sozinho.
//
// Usage:
//   node scripts/check-pipefail-sigpipe.mjs              # o gate (usa o baseline)
//   node scripts/check-pipefail-sigpipe.mjs --json       # saída estruturada
//   node scripts/check-pipefail-sigpipe.mjs --list       # só os arquivos varridos
//   node scripts/check-pipefail-sigpipe.mjs --no-baseline # tudo é violação
//   node scripts/check-pipefail-sigpipe.mjs --fix        # aposenta o caso mecânico (LOCAL)
//   node scripts/check-pipefail-sigpipe.mjs --fix --dry-run       # o PATCH, sem gravar
//   node scripts/check-pipefail-sigpipe.mjs --fix --dry-run --json # idem, estruturado
//   node scripts/check-pipefail-sigpipe.mjs --review     # decisão VENCIDA vira violação (cron)
//   node scripts/check-pipefail-sigpipe.mjs --update --reason "<por quê>"  # declara dívida (LOCAL)
//   node scripts/check-pipefail-sigpipe.mjs --root X     # fixture (mutation test)
//
// Exit codes:
//   0 — nenhuma ocorrência NOVA (o baseline pode conter dívida declarada)
//   1 — ocorrência NOVA (com o remédio por linha), dívida SEM RAZÃO/DATA válida
//       (fail-closed, nos dois modos), ou decisão VENCIDA em `--review`
//   2 — infra: --root sem valor / diretório inexistente (fail-closed); e o
//       `--fix --dry-run` com arquivo que não abre para montar o patch (não
//       julgado NÃO vira "nada a remendar" — o arquivo sai NOMEADO)
//   3 — uso inválido (flag desconhecida, `--update` sem `--reason`, `--dry-run`
//       sem `--fix`)
//
// O exit 2 também cobre o escopo NÃO JULGÁVEL: um `.sh` do repositório ou um
// workflow de forja que não abre (ou não é UTF-8) sai NOMEADO, e o guard não
// cunha veredito — "nenhuma ocorrência nova" sobre um arquivo não lido é a
// falsa segurança que ele recusa em todas as outras dimensões.
// =============================================================================

import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { dirname, join, resolve, sep } from "node:path"
import { pathToFileURL } from "node:url"

import { DEFAULT_REVIEW_DAYS, MS_PER_DAY, parseAddedAt } from "./allowlist-review.mjs"
import { linhasDe, patchPorArquivo } from "./unified-patch.mjs"
import {
  DYNAMIC_EXPR_RE,
  defaultsBlocks,
  exitOnUnjudgeable,
  readJudgedText,
  readWorkflowScan,
  workflowRunBodies,
} from "./forge-workflows.mjs"

/** Exit codes — o contrato da CLI. */
export const EXIT = {
  OK: 0,
  VIOLATIONS: 1,
  UNAVAILABLE: 2,
  USAGE: 3,
}

/** Onde a dívida declarada mora (mesmo lugar dos outros baselines do repo). */
export const BASELINE_PATH = "docs/quality/pipefail-sigpipe-baseline.json"

/** Extensões de script de shell. */
export const SHELL_EXTENSIONS = [".sh", ".bash"]

/** Nome do diretório dos hooks (arquivos SEM extensão, e ainda assim scripts). */
export const HUSKY_DIR = ".husky"

/**
 * Diretórios que a varredura NÃO desce. `node_modules`/`.next`/`.freebuff` são
 * cache de ferramenta (nunca fonte); `_` é o runtime interno do husky;
 * `dist`/`build`/`coverage` são artefato.
 */
export const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  ".next",
  ".freebuff",
  "dist",
  "build",
  "coverage",
  "vendor",
  ".cache",
  ".turbo",
  "_",
])

/**
 * Os DELIMITADORES de heredoc ABERTOS numa linha: `<<WORD`, `<<'WORD'`, `<<-WORD`.
 *
 * `<<<` (herestring) NÃO é heredoc — é um `<<` seguido de outro `<`, e tratá-lo
 * como heredoc faria o parser engolir o resto do arquivo como texto.
 *
 * A régua mora AQUI (e não em cada leitor) porque o que é um heredoc é a mesma
 * pergunta em todos eles: o `logicalCommands` daqui usa para não julgar TEXTO
 * como código, e o `check-workflow-run-syntax` (que julga shell EMBUTIDO) usa
 * para não ler um fixture como se fosse o programa. Duas cópias divergiriam
 * exatamente no caso que importa: a quote do delimitador (`<<'EOF'`).
 *
 * @param {string} raw  a linha crua
 * @returns {string[]} os delimitadores abertos nela, na ordem
 */
export function heredocDelimiters(raw) {
  const out = []
  const re = /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/g
  let m
  while ((m = re.exec(String(raw ?? ""))) !== null) out.push(m[2])
  return out
}

/**
 * O arquivo LIGA o pipefail? A linha é um `set` (comentário não conta), tem uma
 * flag que liga o modo (`-o`, `-eo`, `-euo`, `-uo`, `-e -u -o`…) e nomeia
 * `pipefail`.
 *
 * O `set +o pipefail` (que DESLIGA) é reconhecido de propósito: um script que
 * desliga o modo não é esta classe, e o guard não pode acusá-lo.
 */
export function hasPipefail(content) {
  return content.split(/\r?\n/).some((line) => {
    const t = line.trim()
    if (t.startsWith("#") || !/^set\s/.test(t)) return false
    if (/\+\s*o\s+pipefail/.test(t)) return false
    return /(^|\s)-[A-Za-z]*o(\s|$)/.test(t) && /\bpipefail\b/.test(t)
  })
}

/** O token de flag desliga a leitura no primeiro casamento? */
export function isQuietGrepFlag(token) {
  if (token === "--quiet" || token === "--silent") return true
  return /^-[A-Za-z]*q[A-Za-z]*$/.test(token)
}

/**
 * Divide um comando lógico nos segmentos separados por `|`, respeitando quotes
 * e ignorando `||` (que é operador lógico, não pipe).
 *
 * @param {string} command
 * @returns {string[]} segmentos na ordem (o primeiro é o produtor)
 */
export function splitPipelines(command) {
  const segs = []
  let cur = ""
  let quote = null
  for (let i = 0; i < command.length; i++) {
    const ch = command[i]
    if (quote) {
      cur += ch
      if (ch === quote && command[i - 1] !== "\\") quote = null
      continue
    }
    if (ch === "'" || ch === '"') {
      quote = ch
      cur += ch
      continue
    }
    if (ch === "|" && command[i + 1] !== "|" && command[i - 1] !== "|") {
      segs.push(cur)
      cur = ""
      continue
    }
    cur += ch
  }
  segs.push(cur)
  return segs
}

/** Prefixos que não mudam QUAL comando roda. */
const COMMAND_PREFIXES = new Set(["sudo", "command", "nohup", "env"])

/** Palavras de controle que podem anteceder o comando simples. */
const LEADING_KEYWORDS = ["if", "elif", "while", "until", "then", "do", "!", "if!", "elif!"]

/**
 * Corta o texto no primeiro caractere de CONTROLE não citado (`;`, `&`, `|`,
 * `)`, `}`). É o que separa o comando grep do `; then` que vem depois dele.
 */
export function truncateAtControl(text) {
  let quote = null
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quote) {
      if (ch === quote && text[i - 1] !== "\\") quote = null
      continue
    }
    if (ch === "'" || ch === '"') {
      quote = ch
      continue
    }
    if (ch === ";" || ch === "&" || ch === "|" || ch === ")" || ch === "}") return text.slice(0, i)
  }
  return text
}

/**
 * O ÚLTIMO comando simples de um trecho (`A && B | grep -q X` → o produtor do
 * pipe é só `B`: o `&&` liga `A` ao PIPELINE, não ao produtor).
 *
 * Sem isso o remédio sai sem sentido (`<<< "$(if echo "$X")"`), e um guard cujo
 * conselho é inútil acaba com a allowlist cheia.
 */
export function lastSimpleCommand(text) {
  let quote = null
  let start = 0
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quote) {
      if (ch === quote && text[i - 1] !== "\\") quote = null
      continue
    }
    if (ch === "'" || ch === '"') {
      quote = ch
      continue
    }
    if (ch === "(" || ch === "{" || ch === ";") {
      start = i + 1
      continue
    }
    if ((ch === "&" && text[i + 1] === "&") || (ch === "|" && text[i + 1] === "|")) {
      start = i + 2
      i++
      continue
    }
  }
  let out = text.slice(start).trim()
  let mudou = true
  while (mudou) {
    mudou = false
    for (const kw of LEADING_KEYWORDS) {
      if (out === kw.replace("!", "") || out.startsWith(`${kw.replace("!", "")} `)) {
        out = out.slice(kw.replace("!", "").length).trim()
        mudou = true
      }
    }
    if (out.startsWith("! ")) {
      out = out.slice(2).trim()
      mudou = true
    }
  }
  return out
}

/**
 * Marcadores da EXPRESSÃO do GitHub (`${{ ... }}`) — caráter de controle que o
 * YAML/shell não usam, para o mascaramento ser reversível sem ambiguidade.
 */
const EXPR_OPEN = "\u0001"
const EXPR_CLOSE = "\u0002"

/**
 * Substitui cada `${{ ... }}` por um marcador SEM CHAVES.
 *
 * POR QUE ISTO EXISTE (defeito real, achado ao fechar os passos com shell
 * default): o runner do GitHub resolve a expressão ANTES de o bash existir —
 * para o shell ela é texto puro. Mas os extratores desta guarda são
 * shell-aware e leem `{`/`}`/`(` como ESTRUTURA, então
 * `docker exec ${{ job.services.postgres.id }} psql -tAc "..." | grep -qx 1`
 * era lido como dois comandos e o REMÉDIO saía sem o `docker exec`:
 * `<<< "$(job.services.postgres.id }} psql ...)"`. Um conselho que não funciona
 * — e que o `--fix` gravaria no arquivo, quebrando o workflow.
 *
 * Limite declarado: a expressão não pode conter `}` (as formas do repositório —
 * `vars.X`, `job.services.Y.id`, `github.event.inputs.Z || 0` — não contêm).
 *
 * @param {string} text
 * @returns {string}
 */
export function maskGithubExpressions(text) {
  // O PADRAO da expressao vem da fonte unica (`DYNAMIC_EXPR_RE`); o que e
  // daqui e a INTENCAO — mascarar com sentinela para poder DESMASCARAR depois
  // (o remedio impresso tem de sair com a expressao real).
  return String(text).replace(DYNAMIC_EXPR_RE, (m) => `${EXPR_OPEN}${m.slice(3, -2)}${EXPR_CLOSE}`)
}

/** Desfaz `maskGithubExpressions` (o remédio impresso sai com a expressão REAL). */
export function unmaskGithubExpressions(text) {
  return String(text).replace(
    new RegExp(`${EXPR_OPEN}([^${EXPR_CLOSE}]*)${EXPR_CLOSE}`, "g"),
    (_, inner) => `\${{${inner}}}`,
  )
}

/**
 * Colapsa espaço repetido FORA de quotes (a linha de continuação deixa a
 * indentação no meio do comando: `... -tAc "X"        2>/dev/null`). Dentro de
 * quotes o espaço é SIGNIFICATIVO — o padrão do grep não se toca.
 */
export function collapseOutsideQuotes(text) {
  let quote = null
  return String(text)
    .split("")
    .reduce((acc, ch, i, all) => {
      if (quote) {
        if (ch === quote && all[i - 1] !== "\\") quote = null
        return acc + ch
      }
      if (ch === "'" || ch === '"') {
        quote = ch
        return acc + ch
      }
      if (/\s/.test(ch) && /\s$/.test(acc)) return acc
      return acc + ch
    }, "")
    .trim()
}

/**
 * Encontra os pipes cujo leitor é um `grep` QUIETO (o único que fecha o stdin
 * antes do fim). Devolve o produtor e o texto do grep, para o remédio.
 *
 * O `command` pode trazer EXPRESSÃO do GitHub (`${{ ... }}`): ela é mascarada
 * antes da análise e o produtor é DESmascarado e reespaçado na saída, para o
 * remédio sair copiável.
 *
 * @param {string} command  um comando lógico (linhas de continuação já juntas)
 * @returns {{producer: string, grepText: string}[]}
 */
export function findQuietPipes(command) {
  const segs = splitPipelines(maskGithubExpressions(command))
  const out = []
  for (let i = 1; i < segs.length; i++) {
    const grepText = quietGrepText(segs[i])
    if (grepText === null) continue
    // O produtor é a CADEIA INTEIRA à esquerda, não só o segmento colado: em
    // `netstat -ano | grep ":$port" | grep -qi LISTEN`, o remédio só faz sentido
    // com o `netstat` dentro da captura — senão o `grep` perde a entrada.
    const produtor = lastSimpleCommand(segs.slice(0, i).join("|"))
    out.push({
      producer: unmaskGithubExpressions(collapseOutsideQuotes(produtor)),
      grepText: unmaskGithubExpressions(grepText),
    })
  }
  return out
}

/**
 * O texto do `grep` QUIETO de um SEGMENTO de pipeline, ou `null` se o segmento
 * não é um grep quieto.
 *
 * É a ÚNICA fonte do predicado: `findQuietPipes` (o relatório) e
 * `fixFirstQuietPipe` (o `--fix`) chamam esta função, para o conselho impresso e
 * a reescrita gravada não poderem divergir — duas cópias da regra divergem no
 * primeiro ajuste, e a que grava no arquivo é a que ninguém lê antes de aplicar.
 *
 * O texto do grep sai do ORIGINAL, não dos tokens rejustados: um padrão com
 * espaço SIGNIFICATIVO (`grep -Fq -- '-        run: bash scripts/x.sh'`) era
 * destruído pelo `join(" ")` e o remédio impresso apontava para outro padrão.
 *
 * @param {string} segment
 * @returns {string | null}
 */
export function quietGrepText(segment) {
  const bruto = truncateAtControl(segment)
  const raw = bruto.trim()
  const tokens = raw.split(/\s+/).filter(Boolean)
  let j = 0
  while (j < tokens.length && COMMAND_PREFIXES.has(tokens[j])) j++
  if (tokens[j] !== "grep") return null
  const flags = []
  for (let k = j + 1; k < tokens.length; k++) {
    const t = tokens[k]
    if (t.startsWith("-") && t !== "--") flags.push(t)
    else break
  }
  if (!flags.some(isQuietGrepFlag)) return null
  const inicio = raw.search(/\bgrep\b/)
  return inicio === -1 ? tokens.slice(j).join(" ") : raw.slice(inicio)
}

/**
 * As EXPRESSÕES do runner (`${{ ... }}`) de um texto, na ordem em que aparecem.
 *
 * O runner as resolve ANTES de o bash existir. Uma reescrita que perde, duplica
 * ou reordena uma delas muda o comando que roda — sem mudar nada que o shell
 * veja.
 */
export function githubExpressions(text) {
  return [...String(text).matchAll(/\$\{\{([^}]*)\}\}/g)].map((m) => m[1].trim())
}

/**
 * O remédio para UMA linha: o herestring. `echo "$X"` vira `<<< "$X"` (o caso
 * real corrigido); produtor vivo é capturado antes — `<<< "$(cmd)"` — porque
 * herestring não aceita comando, e a captura é o que tira o pipe do caminho.
 */
export function suggestHerestring({ producer, grepText }) {
  const p = producer.trim()
  if (/^echo\s+/.test(p)) {
    const expr = p.replace(/^echo\s+/, "").trim()
    // `echo -e`/`echo -n` passariam FLAG como texto: nesse caso, captura.
    if (!expr.startsWith("-")) return `${grepText} <<< ${expr}`
  }
  const bare = p.replace(/^"|"$/g, "")
  if (/^\$[A-Za-z_][A-Za-z0-9_]*$/.test(bare)) return `${grepText} <<< "${bare}"`
  return `${grepText} <<< "$(${p})"`
}

/**
 * Reescreve O PRIMEIRO pipe quieto de um comando lógico, ou `null` se não há
 * nenhum que o remédio mecânico resolva.
 *
 * O remédio vale para QUALQUER produtor, não só `echo`:
 *   `A | grep -q y`  →  `grep -q y <<< "$(A)"`
 * porque é a MESMA semântica (o texto de A vira a entrada do grep) sem o pipe
 * que dá SIGPIPE ao produtor. O que ele NÃO faz é decidir por conta própria o
 * que é um produtor seguro — quem revisa é o humano; a máquina só propõe a
 * forma canônica que o `suggestHerestring` já imprime no gate.
 *
 * @param {string} command
 * @returns {string | null}
 */
export function fixFirstQuietPipe(command) {
  // MASCARADO, como o RELATÓRIO: o extrator é shell-aware e leria as chaves da
  // expressão (`${{ ... }}`) como estrutura, devolvendo um produtor pela METADE.
  const segs = splitPipelines(maskGithubExpressions(command))
  for (let i = 1; i < segs.length; i++) {
    const grepText = quietGrepText(segs[i])
    if (grepText === null) continue

    const cadeia = segs.slice(0, i).join("|")
    const producer = lastSimpleCommand(cadeia)
    const inicio = cadeia.lastIndexOf(producer)
    if (inicio === -1) return null
    const sugestao = suggestHerestring({
      producer: unmaskGithubExpressions(collapseOutsideQuotes(producer)),
      grepText: unmaskGithubExpressions(grepText),
    })
    // A cauda traz o que vinha DEPOIS do comando grep: o `; then`, o `&& ok` ou
    // o resto do pipeline — o remédio troca o pipeline, não o controle em volta.
    const bruto = truncateAtControl(segs[i])
    const resto = segs.slice(i + 1).join("|")
    const cauda = segs[i].slice(bruto.length) + (resto === "" ? "" : `|${resto}`)
    // `<<< "$X"` colado a `||`/`&&` é válido, mas ilegível; a `;` não precisa.
    const gap = /^[|&]/.test(cauda) ? " " : ""
    return unmaskGithubExpressions(cadeia.slice(0, inicio) + sugestao + gap + cauda)
  }
  return null
}

/**
 * O remédio para um comando lógico inteiro (pode haver mais de um pipe quieto
 * na mesma linha, ex.: `A | grep -q x || B | grep -q y`).
 *
 * FAIL-CLOSED por passo: cada reescrita tem de REDUZIR a contagem de
 * ocorrências do comando; se não reduzir, o comando original é devolvido e o
 * caso sai para revisão humana — o `--fix` nunca grava conselho que não mediu.
 *
 * @param {string} command
 * @returns {string | null}
 */
export function fixCommand(command) {
  let atual = command
  let mudou = false
  for (let n = 0; n < 50; n++) {
    const proximo = fixFirstQuietPipe(atual)
    if (proximo === null || proximo === atual) break
    const antes = findViolations(atual, { pipefail: true }).length
    const depois = findViolations(proximo, { pipefail: true }).length
    if (depois >= antes) return mudou ? atual : null
    // A EXPRESSÃO DO RUNNER É INTOCÁVEL: reduzir a contagem não prova que a
    // reescrita ainda roda o mesmo comando. As expressões são a parte do comando
    // que o RUNNER resolve antes de o bash existir, então uma reescrita que as
    // perde, duplica ou reordena muda o comando sem mudar nada que o shell veja.
    // (O defeito real dos passos com shell default — o `docker exec` fora da
    // captura — é fechado pela MASCARAGEM em `fixFirstQuietPipe`; este invariante
    // cobre a classe vizinha, que nenhuma reescrita futura pode introduzir.)
    if (githubExpressions(proximo).join("\u0000") !== githubExpressions(atual).join("\u0000"))
      return mudou ? atual : null
    atual = proximo
    mudou = true
  }
  return mudou ? atual : null
}

/**
 * Aplica o remédio mecânico a um texto de shell, pulando o que NÃO é código.
 *
 * As exclusões vêm de `logicalCommands` (a mesma fonte da varredura, para o
 * `--fix` nunca discordar do gate): corpo de HEREDOC é TEXTO — nos mutation
 * tests ele contém o padrão como FIXTURE, e reescrevê-lo mudaria o que o teste
 * mede.
 *
 * Comando que continua na linha de baixo (`\`) é reescrito COLAPSANDO a
 * continuação numa linha: o `\` existia para caber o pipeline, e o remédio tira
 * o pipeline. A indentação da primeira linha é preservada, e o CRLF do arquivo
 * também (nenhum arquivo do repositório é CRLF, mas um `--fix` que converte
 * terminador seria uma mudança que ninguém pediu).
 *
 * Cada entrada de `fixadas` carrega as DUAS formas do remendo: `before`/`after`
 * (o comando já normalizado, sem indentação — é o que o relatório e o fail-closed
 * comparam) e `linhasAntes`/`linhaDepois` (as linhas CRUAS do arquivo, com a
 * indentação — é o que o PATCH precisa para achar o texto e aplicar byte a byte).
 *
 * @param {string} source
 * @returns {{content: string, fixadas: {line: number, before: string, after: string, linhasAntes: string[], linhaDepois: string}[]}}
 */
export function fixSource(source) {
  const lines = source.split("\n")
  const comandos = logicalCommands(source)
  const fixadas = []
  // DE BAIXO PARA CIMA: a reescrita de um comando pode consumir as linhas de
  // continuação dele, e um `splice` desloca os índices seguintes — processando
  // em ordem inversa, o que já foi reescrito está ACIMA e não se mexe.
  for (let n = comandos.length - 1; n >= 0; n--) {
    const i = comandos[n].line - 1
    let fim = i
    while (/\\[ \t]*\r?$/.test(lines[fim]) && fim + 1 < lines.length) fim++
    const cr = /\r$/.test(lines[fim]) ? "\r" : ""
    const indent = /^[ \t]*/.exec(lines[i])[0]
    // A MESMA junção de `logicalCommands` (tira o `\` e emenda a linha de baixo),
    // para o `--fix` reescrever exatamente o comando que o gate acusa.
    let text = lines[i]
    let k = i
    while (/\\[ \t]*\r?$/.test(text) && k + 1 < lines.length) {
      text = text.replace(/\\[ \t]*\r?$/, "")
      k++
      text += lines[k]
    }
    const comando = text.replace(/\r/g, "").trim()
    const novo = fixCommand(comando)
    if (novo !== null) {
      // As LINHAS CRUAS do arquivo (com a indentação e sem o CRLF) e a linha
      // GRAVADA: é o que o patch precisa para achar o texto e para se aplicar
      // byte a byte — uma reescrita que COMPRIME a continuação tira N linhas e
      // põe UMA, e um diff montado só com o comando já colapsado não aplicaria.
      const linhasAntes = []
      for (let j = i; j <= fim; j++) linhasAntes.push(lines[j].replace(/\r$/, ""))
      fixadas.push({
        line: i + 1,
        before: comando,
        after: novo,
        linhasAntes,
        linhaDepois: `${indent}${novo}`,
      })
      lines.splice(i, fim - i + 1, `${indent}${novo}${cr}`)
    }
  }
  fixadas.sort((a, b) => a.line - b.line)
  return { content: lines.join("\n"), fixadas }
}

/**
 * O remédio do `--fix` decidido UMA vez, para DOIS consumidores: a GRAVAÇÃO (a
 * CLI) e o PREVIEW (o patch que vai ao PR).
 *
 * A decisão é a mesma — arquivo por arquivo, `fixSource`, e o FAIL-CLOSED do
 * "a reescrita tem de REDUZIR a contagem" —, então a mesma árvore produz o mesmo
 * veredito nos dois caminhos. Um preview com régua própria prometeria um remendo
 * que a gravação recusaria, e o defeito seria do tipo que passa: o operador
 * aplicaria o patch do comentário e o gate continuaria vermelho.
 *
 * `dry` decide só se o arquivo é GRAVADO. O que é decidido (o que entra em
 * `fixed`, o que fica em `refused`) é idêntico nos dois modos.
 *
 * O QUE NÃO É REMENDADO sai NOMEADO com o conselho da própria varredura: as
 * linhas do arquivo que nenhuma reescrita aceita cobre (o produtor vivo, a linha
 * de continuação que o fixer não colapsa) e os arquivos cuja reescrita não
 * reduziu. Um comentário que só mostrasse o patch mentiria pelo que omite.
 *
 * @param {string} root
 * @param {{dry?: boolean}} [opts]
 * @returns {{fixed: object[], refused: {file: string, line: number|null, reason: string}[], recusados: {file: string, motivo: string}[], unread: {path: string, motivo: string}[], indisponivel: string|null}}
 */
export function fixAll(root, { dry = false } = {}) {
  let scan
  try {
    scan = scanRoot(root)
  } catch (e) {
    return {
      fixed: [],
      refused: [],
      recusados: [],
      unread: [],
      indisponivel: e?.message ?? String(e),
    }
  }
  const { violations, ilegiveis, naoLidos } = scan
  const fixed = []
  const refused = []
  const recusados = []
  for (const [file, antes] of Object.entries(countsByFile(violations))) {
    let content
    try {
      content = readFileSync(join(root, file), "utf8")
    } catch (e) {
      // O arquivo entrou na varredura e agora não abre: não é "nada a julgar".
      recusados.push({ file, motivo: `ilegível na hora do remendo: ${e?.message ?? e}` })
      continue
    }
    const { content: novo, fixadas } = fixSource(content)
    const depois = fixadas.length === 0 ? antes : findViolations(novo, { pipefail: true }).length
    const aceitas = fixadas.length > 0 && depois < antes
    if (!aceitas) {
      recusados.push({
        file,
        motivo:
          fixadas.length === 0
            ? "o fixer não propõe reescrita para o que este arquivo tem (produtor vivo ou forma que pede captura à mão)"
            : `a reescrita não reduziu (${antes}→${depois}) — NÃO gravado`,
      })
      for (const v of violations.filter((x) => x.file === file)) {
        refused.push({ file, line: v.line, reason: v.suggestion ?? "revisão humana" })
      }
      continue
    }
    if (!dry) writeFileSync(join(root, file), novo)
    for (const f of fixadas) fixed.push({ file, ...f })
    // O que NENHUMA reescrita aceita cobre — com a numeração de HOJE (o arquivo
    // ainda não foi tocado no caminho do preview, e é essa a numeração que quem
    // lê o PR tem nos olhos).
    for (const v of violations) {
      if (v.file !== file) continue
      const coberto = fixadas.some(
        (f) => v.line >= f.line && v.line <= f.line + f.linhasAntes.length - 1,
      )
      if (!coberto) refused.push({ file, line: v.line, reason: v.suggestion ?? "revisão humana" })
    }
  }
  return {
    fixed,
    refused: refused.sort((a, b) => a.file.localeCompare(b.file) || (a.line ?? 0) - (b.line ?? 0)),
    recusados,
    unread: [
      // As duas fontes do NÃO LI: a declaração de `shell:` que o parser não
      // entendeu e o arquivo que não abriu. Sem elas "nada a remendar" seria uma
      // afirmação sobre o que a varredura não viu.
      ...ilegiveis.map((i) => ({
        path: i.file,
        motivo: `declaração de \`shell:\` não parseada (linha ${i.line ?? "?"})`,
      })),
      ...naoLidos,
    ],
    indisponivel: null,
  }
}

/**
 * O patch das reescritas — diff unificado com o número de linhas do ARQUIVO, o
 * formato que o `git apply` consome.
 *
 * `linhasAntes`/`linhaDepois` saem do `fixSource` (os MESMOS bytes que a gravação
 * escreveria): um diff montado com o comando já colapsado, ou sem a indentação do
 * arquivo, não acharia o texto.
 *
 * A construção (o CONTEXTO de cada hunk, um cabeçalho por arquivo, o
 * deslocamento acumulado e a fusão de janelas vizinhas) é a do `unified-patch.mjs`
 * — a MESMA do outro fixer mecânico. Uma cópia local divergiria no dia em que uma
 * das duas aprendesse a fundir hunks, e o patch do comentário deixaria de aplicar
 * em SILÊNCIO (era o caso quando o contexto não era emitido: o `git apply` recusa
 * hunk sem contexto, menos no fim do arquivo).
 *
 * @param {object[]} fixed
 * @param {{root?: string, read?: Function}} [opts]
 * @returns {string}
 */
export function shellPatch(fixed, { root = process.cwd(), read = readFileSync } = {}) {
  // O `root` é o do gate, NÃO o `cwd` de quem chamou: a CLI é executada da raiz
  // do repositório e um fixture vive em `--root X` — ler o arquivo relativo ao
  // `cwd` devolveria "nada a remendar" para um fixture cheio de defeitos.
  // (E um arquivo que não abre NÃO some: sai em `ilegiveis`.)
  return patchPorArquivo(fixed, {
    ler: (file) => linhasDe(read(join(root, file), "utf8")),
  })
}

/**
 * O PATCH do remendo do SIGPIPE — o que o `--fix` GRAVARIA, sem gravar nada.
 *
 * Ele é o que o `pr-remedy-comment.mjs` publica no PR (o mesmo módulo, e o mesmo
 * `fixAll`: um fixer, dois consumidores), e o que a CLI imprime em
 * `--fix --dry-run`. As recusas vão junto — o patch cobre o caso MECÂNICO, e
 * publicar só ele esconderia o que não foi remendado nem por quê.
 *
 * @param {string} root
 * @returns {{patch: string, fixed: object[], refused: {file: string, line: number|null, reason: string}[], recusados: {file: string, motivo: string}[], unread: {path: string, motivo: string}[], indisponivel: string|null, shellFailures: object[], embeddedFailures: object[], payloadFailures: object[], yamlInvalido: object[]}} a forma que o publicador consome (`refused` com motivo), com `patch` a mais
 */
export function remedyPatch(root) {
  const r = fixAll(root, { dry: true })
  const { patch, ilegiveis } = shellPatch(r.fixed, { root })
  return {
    ...r,
    // O publicador é compartilhado com o gate do `bash -n`: as seções que só
    // existem para as outras fontes de lá saem VAZIAS aqui, em vez de a régua
    // ser duplicada para caber na forma.
    shellFailures: [],
    embeddedFailures: [],
    payloadFailures: [],
    // O `yamlInvalido` do outro fixer (um YAML que não parseia) não tem análogo
    // aqui — este gate varre `.sh` e corpos `run:` já parseados —, mas o SLOT é
    // declarado: o publicador confere a forma do resultado antes de anunciar que
    // mediu, e uma chave ausente seria "mediu" sobre um campo que ninguém leu.
    yamlInvalido: [],
    patch,
    // Um arquivo que abriu na varredura e não abre na hora de MONTAR o patch sai
    // aqui como NÃO LIDO: o patch sairia sem ele, e o publicador anunciaria um
    // remendo que não cobre o que ele não conseguiu ler.
    unread: [...r.unread, ...ilegiveis.map((i) => ({ path: i.file, motivo: i.motivo }))],
  }
}

/**
 * Os comandos LÓGICOS de um texto, com o número da PRIMEIRA linha de cada um.
 *
 * Duas coisas que uma varredura linha-a-linha erra:
 *   1. continuação (`\` no fim da linha) — o `|` pode estar na linha de baixo,
 *      e é comum: `docker compose ps ... \` / `  | grep -qi healthy`;
 *   2. HEREDOC — o corpo de um `<<'EOF'` é TEXTO, não código; um fixture que
 *      escreve um script (o que os mutation tests fazem) contém o padrão sem
 *      executá-lo, e acusá-lo seria falso positivo.
 *
 * @param {string} source
 * @returns {{line: number, text: string}[]}
 */
export function logicalCommands(source) {
  const lines = source.split(/\r?\n/)
  const inHeredoc = new Array(lines.length).fill(false)
  const pending = []
  for (let i = 0; i < lines.length; i++) {
    if (pending.length > 0) {
      inHeredoc[i] = true
      const candidato = lines[i]
      if (candidato.trim() === pending[0] || candidato.replace(/^\t+/, "") === pending[0]) {
        pending.shift()
      }
      continue
    }
    const raw = lines[i]
    if (raw.trim().startsWith("#")) continue
    // `<<WORD` / `<<'WORD'` / `<<-WORD` — a régua vem do `heredocDelimiters`
    // (fonte única): `<<<` (herestring) NÃO é heredoc.
    for (const delim of heredocDelimiters(raw)) pending.push(delim)
  }

  const out = []
  for (let i = 0; i < lines.length; i++) {
    if (inHeredoc[i]) continue
    const start = i
    let text = lines[i]
    while (/\\\s*$/.test(text) && i + 1 < lines.length) {
      text = text.replace(/\\\s*$/, "")
      i++
      if (inHeredoc[i]) break
      text += lines[i]
    }
    const trimmed = text.trim()
    if (trimmed === "" || trimmed.startsWith("#")) continue
    out.push({ line: start + 1, text: trimmed })
  }
  return out
}

/**
 * As violações de UM texto de shell em contexto com pipefail.
 *
 * @param {string} source
 * @param {{pipefail: boolean}} opts
 * @returns {{line: number, text: string, suggestion: string}[]}
 */
export function findViolations(source, { pipefail }) {
  if (!pipefail) return []
  const out = []
  for (const cmd of logicalCommands(source)) {
    for (const pipe of findQuietPipes(cmd.text)) {
      out.push({ line: cmd.line, text: cmd.text, suggestion: suggestHerestring(pipe) })
    }
  }
  return out
}

/**
 * O `shell:` do passo liga o pipefail? `bash` sozinho liga (o runner gera
 * `bash --noprofile --norc -eo pipefail {0}`); uma string própria é usada
 * VERBATIM, então só liga se ela trouxer `-o pipefail` (em `-eo`/`-euo` também —
 * é a mesma forma do `set`).
 */
export function shellEnablesPipefail(shell) {
  if (!shell) return false
  if (/-[A-Za-z]*o\s+pipefail/.test(shell)) return true
  return shell.trim() === "bash"
}

/**
 * As DECLARAÇÕES de shell default de um workflow: `defaults: run: shell:` no
 * nível do ARQUIVO e no nível de cada JOB.
 *
 * POR QUE ISTO EXISTE: o guard trata o passo sem `shell:` como "shell default do
 * runner" — uma PREMISSA, hoje `bash -e`. Um `defaults: run: shell: bash` é a
 * única forma (do lado do repositório) de essa premissa virar pipefail: ele
 * reclassifica TODOS os passos do escopo em UMA linha, sem que nenhum passo
 * mude no diff. Sem ler a declaração, o guard (a) contaria esses passos como
 * "shell default" e (b) diria no relatório uma premissa que não é mais a do
 * runner — o diagnóstico apontaria para o lugar errado.
 *
 * A LEITURA VEM DE `forge-workflows.mjs` (`defaultsBlocks`), a fonte única do
 * que é uma declaração de `defaults:` — este guard acrescenta o que é SÓ dele:
 * se o shell declarado LIGA o pipefail. Ter a leitura em um lugar é o que
 * impede o shell default de virar passo fantasma nos OUTROS guards de workflow
 * (a classe que a extensão de `defaultsRunLines` fechou).
 *
 * @param {string} content
 * @returns {{scope: "workflow"|"job", job: string | null, shell: string, line: number, runLine: number | null, inline: boolean, unparsed?: true, pipefail: boolean}[]}
 */
export function workflowDefaultShells(content) {
  return defaultsBlocks(content).map((d) => ({
    ...d,
    pipefail: shellEnablesPipefail(d.shell),
  }))
}

/**
 * Os PASSOS de um workflow, com o corpo do `run:` e se o pipefail está ativo.
 *
 * Um passo é um item de lista (`- `); o corpo do `run:` é escalar inline ou
 * bloco (`|`/`>`). `shell: bash` é o gatilho do pipefail: o runner gera
 * `bash --noprofile --norc -eo pipefail {0}` (um `shell:` com string própria é
 * usado VERBATIM — sem `-o pipefail` nela, não há pipefail).
 *
 * A LEITURA DO PASSO (item de lista, coluna da chave, recuo do corpo, forma
 * escalar × bloco, `- run:` na mesma linha, `shell:` antes ou depois do `run:`)
 * VEM DE `forge-workflows.mjs` (`workflowRunBodies`), a fonte única do layout:
 * é ela que o `check-workflow-run-syntax`, o `check-mutation-jobs` e o
 * `check-forge-parity` consultam. O que fica AQUI é o que só este guard sabe:
 * se o shell EFETIVO do passo liga o pipefail, e de ONDE ele veio.
 *
 * @param {string} content
 * @returns {{line: number, body: string, job: string | null, shell: string | null, shellFonte: "step"|"job-default"|"workflow-default"|"runner", pipefail: boolean}[]}
 */
export function workflowRunSteps(content, defaults = workflowDefaultShells(content)) {
  const wfDefault = defaults.find((d) => d.scope === "workflow" && !d.unparsed) ?? null
  const jobDefaults = new Map(
    defaults.filter((d) => d.scope === "job" && !d.unparsed).map((d) => [d.job, d]),
  )
  return workflowRunBodies(content).map((passo) => {
    const shell = passo.shell
    const inline = hasPipefail(passo.body)
    // A DECLARAÇÃO SINTA DA FONTE do shell: o passo, o `defaults:` do job, o
    // `defaults:` do arquivo, ou o runner. O relatório diz QUAL — e é isso que
    // impede um `defaults:` novo de ser absorvido como se fosse o default do
    // runner (a premissa que o guard não controla).
    const shellFonte =
      shell !== null && shell !== ""
        ? "step"
        : jobDefaults.has(passo.job)
          ? "job-default"
          : wfDefault
            ? "workflow-default"
            : "runner"
    const shellEfetivo =
      shellFonte === "step"
        ? shell
        : shellFonte === "job-default"
          ? jobDefaults.get(passo.job).shell
          : shellFonte === "workflow-default"
            ? wfDefault.shell
            : null
    return {
      line: passo.line,
      // A ÚLTIMA linha do corpo, em número de linha 1-based (numa forma de bloco
      // `run: |` é a última linha indentada; um corpo que termina com linhas em
      // branco inclui-as). Existe para quem precisa ESCREVER de volta na linha
      // certa — o `--fix` do `check-workflow-run-syntax` remenda UMA linha do
      // corpo, e recomputar o fim do bloco aqui seria uma segunda regra de
      // layout.
      bodyEndLine: passo.bodyEndLine,
      // A PRIMEIRA linha do CORPO (num bloco `run: |` é a linha seguinte ao
      // `run:`): quem converte “linha k do corpo” em `arquivo:linha` precisa
      // dela, e o `line` acima é a da CHAVE. Repassada do parser (uma régua).
      bodyStartLine: passo.bodyStartLine,
      body: passo.body,
      job: passo.job,
      shell: shellEfetivo,
      shellFonte,
      pipefail: shellEnablesPipefail(shellEfetivo) || inline,
    }
  })
}

/**
 * A HERANÇA DE SHELL de UM workflow: de ONDE vem o shell de cada passo, o que as
 * declarações de `defaults:` fazem com eles, e quantos passos ficaram sob
 * pipefail.
 *
 * É A MESMA MEDIÇÃO que o gate usa (`scanRoot` chama esta função, item a item) e
 * que o `forge-doctor` publica como FATO da prontidão: duas leituras do mesmo
 * YAML divergem no primeiro ajuste — e a que ninguém confere é justamente a que
 * vai para o relatório de quem decide se pode confiar o merge.
 *
 * A conta por FONTE é a resposta à pergunta que o relatório do guard faz em
 * prosa e que o veredito de prontidão não tinha como cobrar:
 *   - `noPasso`            — o passo declara `shell:` (a classe é DITA ali);
 *   - `porDefaultDoJob`    — o shell vem do `defaults:` do JOB;
 *   - `porDefaultDoArquivo`— o shell vem do `defaults:` do ARQUIVO;
 *   - `peloRunner`         — NINGUÉM declarou: a premissa é o shell default do
 *                            runner (`bash -e`), que não é deste repositório.
 *
 * `premissas` são as declarações que LIGAM o pipefail (o guard as reprova: elas
 * reclassificam todos os passos do escopo numa linha, e nenhum passo muda no
 * diff) — cada uma com quantos passos sem `shell:` ela passou a cobrir;
 * `ilegiveis` são as que o guard não consegue LER (forma inline), onde presumir
 * "sem pipefail" seria a aposta que este arquivo existe para acabar.
 *
 * `passosVazios` são os `run:` DECLARADOS com corpo vazio: não há sintaxe a
 * julgar (não rodam nada), mas eles são CONTADOS e DEVOLVIDOS à parte em vez de
 * sumirem — um passo que a varredura esquece em silêncio é a mesma mentira de um
 * gate que varre menos do que parece.
 *
 * @param {string} content
 * @returns {{steps: object[], passosVazios: object[], declaracoes: object[], premissas: object[], ilegiveis: object[], counts: {total: number, corpoVazio: number, noPasso: number, porDefaultDoJob: number, porDefaultDoArquivo: number, porDefault: number, peloRunner: number, comPipefail: number}}}
 */
export function workflowShellInheritance(content) {
  const defaults = workflowDefaultShells(content)
  const todos = workflowRunSteps(content, defaults)
  // O passo SEM corpo não é julgado (não roda nada) — e NÃO some da conta: ele
  // sai em `passosVazios` para o relatório poder nomeá-lo.
  const steps = todos.filter((s) => s.body.trim() !== "")
  const passosVazios = todos
    .filter((s) => s.body.trim() === "")
    .map((s) => ({ line: s.line, job: s.job, shell: s.shell, shellFonte: s.shellFonte }))
  const declaracoes = defaults.map((d) => ({ ...d, passos: 0 }))
  const counts = {
    total: steps.length,
    corpoVazio: passosVazios.length,
    noPasso: 0,
    porDefaultDoJob: 0,
    porDefaultDoArquivo: 0,
    porDefault: 0,
    peloRunner: 0,
    comPipefail: 0,
  }
  for (const step of steps) {
    if (step.pipefail) counts.comPipefail++
    if (step.shellFonte === "step") counts.noPasso++
    else if (step.shellFonte === "job-default") counts.porDefaultDoJob++
    else if (step.shellFonte === "workflow-default") counts.porDefaultDoArquivo++
    else counts.peloRunner++
    // A DECLARAÇÃO QUE LIGA O PIPEFAIL RECLASSIFICOU ESTE PASSO numa linha do
    // YAML: a conta vai para ela, que é o que o guard reprova — sem isso o
    // operador teria de deduzir quantos passos mudaram de significado de uma vez.
    if (step.shellFonte !== "job-default" && step.shellFonte !== "workflow-default") continue
    const escopo = step.shellFonte === "job-default" ? "job" : "workflow"
    const dono = declaracoes.find(
      (d) => d.scope === escopo && !d.unparsed && (escopo === "workflow" || d.job === step.job),
    )
    if (dono && dono.pipefail) dono.passos++
  }
  counts.porDefault = counts.porDefaultDoJob + counts.porDefaultDoArquivo
  return {
    steps,
    passosVazios,
    declaracoes,
    premissas: declaracoes.filter((d) => !d.unparsed && d.pipefail),
    ilegiveis: declaracoes.filter((d) => d.unparsed === true),
    counts,
  }
}

/** É um script de shell pela extensão OU por ser hook do `.husky/`? */
export function isShellScript(relPath) {
  const parts = relPath.split(sep)
  const base = parts[parts.length - 1] ?? ""
  if (SHELL_EXTENSIONS.some((ext) => base.endsWith(ext))) return true
  return parts.length >= 2 && parts[parts.length - 2] === HUSKY_DIR
}

/**
 * A varredura CRUA da árvore: o que a extensão (ou o `.husky/`) diz, sem a
 * régua do git. É a metade INTERNA de `scriptsDoRepositorio` — quem chama de
 * fora pede a lista DO REPOSITÓRIO, não a da árvore.
 */
function varreduraDeShell(root, { dir = "", out = [] } = {}) {
  const abs = dir === "" ? root : join(root, dir)
  if (!existsSync(abs)) return out
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    const rel = dir === "" ? entry.name : `${dir}/${entry.name}`
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      varreduraDeShell(root, { dir: rel, out })
      continue
    }
    if (!entry.isFile()) continue
    if (isShellScript(rel.split("/").join(sep))) out.push(rel)
  }
  return out.sort()
}

/**
 * A DECLARAÇÃO do repositório sobre o que é LOCAL: tira da lista o que as
 * regras de ignore escondem do `git status` — esse caminho não é do repositório,
 * e o CI (que não o tem) varre exatamente o mesmo conjunto sem ele.
 *
 * POR QUE ISTO EXISTE (o defeito medido em 26/09/2026): a varredura é da ÁRVORE,
 * e a árvore de um checkout compartilhado carrega scratch que o `.gitignore`
 * declara local — `.tmp/mineracao/test-mutation-remedy-classes.sh` é o conteúdo
 * de um PATCH com extensão `.sh`, e o `bash -n` reprovava o DIFF (não um
 * programa), pintando o local de vermelho num defeito que o CI nunca vê. É
 * ESCOPO e não exceção: o arquivo ignorado não é um script do repositório, do
 * mesmo jeito que o que está dentro de `node_modules` não é.
 *
 * AS DUAS METADES SÃO PERGUNTADAS AO GIT — a varredura não decide sozinha:
 *   1. o ÍNDICE (`git ls-files`): um caminho VERSIONADO fica, mesmo que uma
 *      regra o case — o ignore não vale para o que já está no índice, e tirar do
 *      escopo o que o CI carrega seria varrer menos do que parece;
 *   2. o IGNORE (`git check-ignore -v`): dos que NÃO estão no índice, os que o
 *      repositório declara locais saem.
 *
 * FALLBACK DECLARADO: quando o git não responde (uma fixture que não é
 * repositório — o caso do `--root` dos testes), a lista sai INTEIRA e o
 * `indisponivel` diz por quê. A varredura fica mais AMPLA, nunca mais estreita:
 * um root sem git não pode ser confundido com um repositório limpo, e "não
 * consegui perguntar" jamais apaga arquivo do escopo.
 *
 * @param {string} root
 * @param {string[]} caminhos
 * @param {{run?: Function}} [deps]
 * @returns {{caminhos: string[], locais: string[], indisponivel: string|null}}
 */
export function semLocaisIgnorados(root, caminhos, { run = spawnSync } = {}) {
  const lista = [...caminhos]
  if (lista.length === 0) return { caminhos: lista, locais: [], indisponivel: null }
  const git = (args, opts = {}) =>
    run("git", args, {
      cwd: root,
      encoding: "utf8",
      timeout: 60_000,
      maxBuffer: 64 * 1024 * 1024,
      ...opts,
    })
  let versionados
  try {
    const r = git(["ls-files", "-z"])
    if (r?.error || r?.status !== 0) {
      return {
        caminhos: lista,
        locais: [],
        indisponivel: `git ls-files indisponível (${r?.error?.message ?? `exit ${r?.status}`})`,
      }
    }
    versionados = new Set(
      String(r.stdout ?? "")
        .split("\u0000")
        .filter((p) => p !== ""),
    )
  } catch (error) {
    return {
      caminhos: lista,
      locais: [],
      indisponivel: `git ls-files não rodou: ${error?.message ?? error}`,
    }
  }
  const candidatos = lista.filter((p) => !versionados.has(p))
  if (candidatos.length === 0) return { caminhos: lista, locais: [], indisponivel: null }
  let ignorados
  try {
    // O exit do `check-ignore` é um DESFECHO, não um erro: 0 = um ou mais
    // caminhos ignorados, 1 = nenhum. Outro código é o git que não respondeu.
    const r = git(["check-ignore", "-v", "--stdin"], { input: `${candidatos.join("\n")}\n` })
    if (r?.error || (r?.status !== 0 && r?.status !== 1)) {
      return {
        caminhos: lista,
        locais: [],
        indisponivel: `git check-ignore indisponível (${r?.error?.message ?? `exit ${r?.status}`})`,
      }
    }
    ignorados = new Set(
      String(r.stdout ?? "")
        .split("\n")
        .filter((l) => l !== "")
        .map((l) => l.slice(l.lastIndexOf("\t") + 1).trim()),
    )
  } catch (error) {
    return {
      caminhos: lista,
      locais: [],
      indisponivel: `git check-ignore não rodou: ${error?.message ?? error}`,
    }
  }
  return {
    caminhos: lista.filter((p) => !ignorados.has(p)),
    locais: candidatos.filter((p) => ignorados.has(p)).sort(),
    indisponivel: null,
  }
}

/**
 * OS SCRIPTS DE SHELL DO REPOSITÓRIO — a lista que os guards deste módulo, o
 * `check:pipefail-sigpipe` e o `check-workflow-run-syntax` consomem: a varredura
 * da árvore MENOS o que o próprio repositório declara local.
 *
 * Com a procedência do que ficou fora (`locais`), para o relatório NOMEAR o
 * corte em vez de varrer menos em silêncio.
 */
export function scriptsDoRepositorio(root, { run = spawnSync } = {}) {
  return semLocaisIgnorados(root, varreduraDeShell(root), { run })
}

/**
 * A lista de scripts do repositório, sem a procedência — o atalho dos
 * consumidores que não relatam o corte.
 *
 * @param {string} root
 * @returns {string[]}
 */
export function listShellScripts(root) {
  return scriptsDoRepositorio(root).caminhos
}

/**
 * A varredura inteira: scripts de shell + os `run:` dos workflows das forjas.
 *
 * A lista de scripts é a do REPOSITÓRIO (`scriptsDoRepositorio`): a varredura da
 * árvore MENOS o que o `.gitignore` declara local — o scratch de uma sessão não
 * é um script do repositório, e `locais` leva a procedência desse corte para o
 * relatório NOMEAR o que ficou fora.
 *
 * @param {string} root
 * @returns {{files: string[], violations: object[], foraDoEscopo: object[], premissas: object[], ilegiveis: object[], locais: string[], scanned: object}}
 */
export function scanRoot(root) {
  const { caminhos: files, locais } = scriptsDoRepositorio(root)
  const violations = []
  // O que a varredura NÃO conseguiu ler, NOMEADO: as duas fontes do guard (o
  // `.sh` do repositório e o workflow das forjas). Antes o `readFileSync` cru
  // estourava com stack trace nas duas — fail-closed por acidente, com exit 1
  // (que aqui significa VIOLAÇÃO) e sem dizer qual arquivo nem por quê. O
  // veredito de "nenhuma ocorrência nova" sobre um arquivo não lido é a falsa
  // segurança que este guard recusa em todas as outras dimensões.
  const naoLidos = []
  let scriptsComPipefail = 0
  for (const rel of files) {
    let content
    try {
      content = readJudgedText(root, rel)
    } catch (err) {
      naoLidos.push({ path: rel, motivo: err?.motivo ?? String(err?.message ?? err) })
      continue
    }
    if (!hasPipefail(content)) continue
    scriptsComPipefail++
    for (const v of findViolations(content, { pipefail: true })) {
      violations.push({ file: rel, ...v })
    }
  }

  const workflowScan = readWorkflowScan(root)
  naoLidos.push(...workflowScan.unjudgeable)
  const workflowFiles = workflowScan.files.map((w) => w.path)
  let runStepsComPipefail = 0
  let runStepsSemPipefail = 0
  let passosDoRunner = 0
  let passosComDefaultDeclarado = 0
  let passosComShellNoPasso = 0
  let passosCorpoVazio = 0
  /**
   * Os passos DECLARADOS que a varredura NÃO julga, com o motivo. A lista existe
   * para o relatório poder dizer quantos e QUAIS — um passo fora do escopo sem
   * nome é a diferença entre "não havia o que julgar" e "o gate não olhou".
   * @type {{file: string, line: number, job: string | null, motivo: string}[]}
   */
  const foraDoEscopo = []
  /** @type {Map<string, {file: string, line: number, scope: string, job: string | null, shell: string, passos: number}>} */
  const premissas = new Map()
  const ilegiveis = []
  const chaveDe = (rel, m) => `${rel}\u0000${m.line}\u0000${m.job ?? ""}`
  for (const wf of workflowScan.files) {
    const rel = wf.path
    const conteudo = wf.text
    // A LEITURA E A CONTA SÃO DE `workflowShellInheritance` — a MESMA medição
    // que o `forge-doctor` publica como fato da prontidão. O que esta varredura
    // acrescenta é a CLASSIFICAÇÃO do texto (`findViolations`), não uma segunda
    // leitura do YAML: duas leituras do mesmo workflow divergem no primeiro
    // ajuste, e a que vai para o relatório de prontidão seria a que ninguém vê.
    const { steps, passosVazios, declaracoes, counts } = workflowShellInheritance(conteudo)
    passosCorpoVazio += counts.corpoVazio
    for (const v of passosVazios) {
      foraDoEscopo.push({
        file: rel,
        line: v.line,
        job: v.job,
        motivo: "corpo `run:` VAZIO — nada executa, nada a julgar",
      })
    }
    for (const d of declaracoes) {
      if (d.unparsed) {
        ilegiveis.push({ file: rel, ...d })
        continue
      }
      // SÓ a declaração que LIGA o pipefail é premissa mudada: as outras
      // (ex.: `shell: bash -e {0}`) declaram um default SEM pipefail — o passo
      // continua no mesmo contexto, e nomear a declaração já basta.
      if (d.pipefail)
        premissas.set(chaveDe(rel, d), {
          file: rel,
          line: d.line,
          scope: d.scope,
          job: d.job,
          shell: d.shell,
          passos: d.passos,
        })
    }
    runStepsComPipefail += counts.comPipefail
    runStepsSemPipefail += counts.total - counts.comPipefail
    passosDoRunner += counts.peloRunner
    passosComDefaultDeclarado += counts.porDefault
    passosComShellNoPasso += counts.noPasso
    for (const step of steps) {
      // O PADRÃO REPROVA NO STEP INTEIRO — com pipefail declarado E no shell
      // DEFAULT. Antes, o passo sem pipefail era apenas CONTADO e ficava fora
      // do gate: a segurança dele dependia de uma premissa que não é nossa (o
      // shell default do runner, hoje `bash -e`). Quem decide se um pipeline
      // virou 141 é o contexto do RUNNER, não o texto do passo — e o dia em que
      // um runner (ou um `defaults: run: shell: bash`) ligar pipefail por padrão,
      // TODOS os passos mudam de significado de uma vez. Congelar hoje só os
      // passos de hoje é apostar na premissa; varrer os dois contextos é ser
      // dono da pergunta. O `context` separa os TRÊS casos no diagnóstico: a
      // causa e o remédio são os mesmos, a explicação não.
      // A linha de ARQUIVO da PRIMEIRA linha do corpo: `run: |` começa na linha
      // SEGUINTE à chave, e usar a linha da chave (como era) errava por um em
      // todo bloco — o `arquivo:linha` que o gate publica apontava para a linha
      // de cima (medido: comando na 11, reportado na 10). O inline segue igual.
      const base = (step.bodyStartLine ?? step.line) - 1
      const contexto = step.pipefail
        ? "pipefail"
        : step.shellFonte === "runner"
          ? "shell-default"
          : "shell-declared"
      for (const v of findViolations(step.body, { pipefail: true })) {
        violations.push({
          file: rel,
          line: base + v.line,
          text: v.text,
          suggestion: v.suggestion,
          context: contexto,
        })
      }
    }
  }

  violations.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)
  // Os passos fora do escopo saem ORDENADOS e como FATO próprio: quem lê o
  // relatório sabe quantos passos a varredura não julgou, e por quê.
  foraDoEscopo.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)
  return {
    files: [...files, ...workflowFiles].sort(),
    violations,
    foraDoEscopo,
    premissas: [...premissas.values()].sort(
      (a, b) => a.file.localeCompare(b.file) || a.line - b.line,
    ),
    ilegiveis,
    naoLidos: naoLidos.sort((a, b) => a.path.localeCompare(b.path)),
    locais,
    scanned: {
      shellScripts: files.length,
      shellScriptsComPipefail: scriptsComPipefail,
      workflows: workflowFiles.length,
      runStepsComPipefail,
      runStepsSemPipefail,
      passosCorpoVazio,
      passosDoRunner,
      passosComDefaultDeclarado,
      passosComShellNoPasso,
      defaultShellsEmPipefail: [...premissas.values()].length,
      // O corte de ESCOPO, contado: `shellScripts` é o que foi julgado, e este é
      // o que o repositório declara local — sem ele, os dois números seriam um
      // só e o relatório não diria que houve corte.
      locais: locais.length,
    },
  }
}

/** Conta as ocorrências por arquivo (a forma do baseline). */
export function countsByFile(violations) {
  const counts = {}
  for (const v of violations) counts[v.file] = (counts[v.file] ?? 0) + 1
  return counts
}

/**
 * Compara o estado atual com o baseline.
 *
 * O baseline guarda a QUANTIDADE por arquivo (não a linha): uma linha nova acima
 * não pode fazer o gate acusar dívida que não mudou. A ocorrência além da cota é
 * reportada em ordem de linha — o remédio sai junto, então o operador corrige a
 * que quiser até a cota voltar.
 *
 * @param {{file: string, line: number, text: string, suggestion: string}[]} violations
 * @param {{files?: Record<string, number>}} baseline
 * @returns {{novas: object[], reduzidas: {file: string, baseline: number, atual: number}[]}}
 */
export function compareWithBaseline(violations, baseline) {
  const cota = baseline?.files ?? {}
  const novos = []
  const reduzidas = []
  const porArquivo = new Map()
  for (const v of violations) {
    if (!porArquivo.has(v.file)) porArquivo.set(v.file, [])
    porArquivo.get(v.file).push(v)
  }
  for (const [file, lista] of porArquivo) {
    const permitido = cota[file] ?? 0
    if (lista.length > permitido) novos.push(...lista.slice(permitido))
    else if (lista.length < permitido)
      reduzidas.push({ file, baseline: permitido, atual: lista.length })
  }
  for (const [file, permitido] of Object.entries(cota)) {
    if (permitido > 0 && !porArquivo.has(file))
      reduzidas.push({ file, baseline: permitido, atual: 0 })
  }
  reduzidas.sort((a, b) => a.file.localeCompare(b.file))
  return { novas: novos.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line), reduzidas }
}

/** Lê o baseline do disco (ausente = dívida zero: tudo é ocorrência nova). */
export function readBaseline(root) {
  const path = join(root, BASELINE_PATH)
  if (!existsSync(path)) return { files: {}, declaredAt: null, total: 0, ausente: true }
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"))
    return { ...parsed, ausente: false }
  } catch (err) {
    return { files: {}, declaredAt: null, total: 0, ausente: true, erro: String(err) }
  }
}

/**
 * Grava o baseline a partir das ocorrências atuais.
 *
 * A `reason` é OBRIGATÓRIA quando há o que declarar — o guard recusa antes de
 * chamar isto (ver `--update` no `main`), e a razão vai para o arquivo porque
 * uma justificativa que mora só na caixa de entrada de quem rodou o comando não
 * é uma decisão registrada: é o que transforma uma allowlist em permanente.
 *
 * A JANELA vem do módulo compartilhado (`allowlist-review.mjs`), a mesma das
 * outras três listas: duas janelas para a mesma pergunta divergem no dia em que
 * alguém ajustar uma delas.
 */
export function writeBaseline(
  root,
  violations,
  { hoje = new Date().toISOString().slice(0, 10), reason = "" } = {},
) {
  const counts = countsByFile(violations)
  const ordenado = Object.fromEntries(
    Object.entries(counts).sort((a, b) => a[0].localeCompare(b[0])),
  )
  const conteudo = {
    $comment: [
      "DÍVIDA DECLARADA da classe SIGPIPE (scripts/check-pipefail-sigpipe.mjs).",
      "",
      "Cada entrada é a QUANTIDADE de `| grep -q` sob pipefail naquele arquivo no dia da",
      "declaração. O guard FALHA em qualquer ocorrência acima da cota (a classe não volta",
      "por PR) e PASSA quando a cota diminui. Regenerar (`--update --reason ...`) é uso",
      "LOCAL: um PR que reduz a dívida não deve reescrever o baseline sozinho — a redução",
      "é o que se revisa.",
      "",
      "`reason` é a decisão ESCRITA (sem ela o guard recusa declarar qualquer ocorrência) e",
      "`reviewAfterDays` é a janela do módulo compartilhado allowlist-review.mjs: passada a",
      "janela, o run normal emite ::warning:: e o job semanal (--review) faz da dívida",
      "vencida uma VIOLAÇÃO. Uma cota que ninguém revisa é uma allowlist permanente.",
    ],
    version: 1,
    declaredAt: hoje,
    reason,
    reviewAfterDays: DEFAULT_REVIEW_DAYS,
    total: violations.length,
    files: ordenado,
  }
  // O diretório pode não existir no alvo (um `--root` de fixture, um checkout
  // que nunca teve baseline): sem isto o comando morre com ENOENT e um stack
  // trace do Node — o operador vê um CRASH onde deveria ver "declarado".
  const destino = join(root, BASELINE_PATH)
  mkdirSync(dirname(destino), { recursive: true })
  writeFileSync(destino, `${JSON.stringify(conteudo, null, 2)}\n`)
  return conteudo
}

/**
 * Dias desde a declaração (para a idade aparecer no relatório).
 *
 * A DATA é lida pelo parser do módulo compartilhado (`parseAddedAt`), não por um
 * `new Date(...)` local: `Date.UTC` TRANSBORDA (`2026-02-30` vira `2026-03-02`),
 * e um guard que aceita uma data que o autor não digitou está medindo outra
 * coisa. Uma data que não parseia devolve `null` — que é o estado "sem idade",
 * tratado como pendência por `baselineProblems`.
 */
export function baselineAgeDays(baseline, agora = new Date()) {
  const ms = parseAddedAt(baseline?.declaredAt)
  if (ms === null) return null
  return Math.floor((agora.getTime() - ms) / MS_PER_DAY)
}

/**
 * O VEREDITO DE DATA da dívida declarada — a regra do módulo COMPARTILHADO
 * (`allowlist-review.mjs`) aplicada à entrada única deste baseline: a
 * declaração inteira é a decisão.
 *
 * DUAS perguntas, porque as consequências diferem:
 *   - `invalid`: a decisão não pode ser CONFIADA (dívida sem razão escrita, ou
 *     `declaredAt` ausente/malformado/no futuro). É violação nos DOIS modos —
 *     fail-closed: sem razão e sem data válidas, a isenção não tem como
 *     envelhecer e "esqueci de registrar" vira o jeito de nunca revisar;
 *   - `aged`: a decisão EXISTE e VENCEU a janela. Aqui não é mentira, é dívida
 *     velha: o run normal avisa (`::warning::`) e o `--review` (job semanal)
 *     escala para violação — uma data não pode bloquear o PR de todo mundo, mas
 *     também não pode passar em silêncio num run verde.
 *
 * Dívida ZERO não tem o que revisar: um baseline vazio (`files: {}`) é inerte e
 * devolve os dois estados vazios, sem exigir razão nem data.
 *
 * @param {{files?: Record<string, number>, declaredAt?: unknown, reason?: unknown}} baseline
 * @param {{now?: number, reviewDays?: number}} [options]
 * @returns {{invalid: string[], aged: {declaredAt: string, days: number, limit: number}|null}}
 */
export function baselineProblems(
  baseline,
  { now = Date.now(), reviewDays = DEFAULT_REVIEW_DAYS } = {},
) {
  const total = Object.values(baseline?.files ?? {}).reduce((a, b) => a + b, 0)
  if (total === 0) return { invalid: [], aged: null }

  const invalid = []
  const motivo = String(baseline?.reason ?? "").trim()
  if (motivo === "") {
    invalid.push(
      '`reason` ausente: a dívida declara ocorrências SEM a decisão escrita — declare com `--update --reason "<por que não pode ser consertado agora>"` ou conserte com `--fix`',
    )
  }
  const ms = parseAddedAt(baseline?.declaredAt)
  if (ms === null) {
    invalid.push(
      `\`declaredAt\` ausente ou invalido ('${baseline?.declaredAt ?? ""}') — use uma data civil ISO 'YYYY-MM-DD' (esta é a data que a janela de revisão mede)`,
    )
  } else if (ms > now) {
    invalid.push(
      `\`declaredAt\` no FUTURO ('${baseline.declaredAt}') — uma dívida não pode ter sido declarada depois de hoje`,
    )
  }
  if (invalid.length > 0) return { invalid, aged: null }

  const days = Math.floor((now - ms) / MS_PER_DAY)
  return {
    invalid: [],
    aged:
      days > reviewDays
        ? { declaredAt: String(baseline.declaredAt), days, limit: reviewDays }
        : null,
  }
}

/**
 * O TEXTO da dívida vencida — UMA prosa, para o `::warning::` do run normal e a
 * violação do `--review` contarem a mesma história (o remédio sai igual nos
 * dois, e um operador que viu o aviso no PR reconhece a frase no cron).
 *
 * @param {{declaredAt: string, days: number, limit: number}} aged
 * @returns {string}
 */
export function textoDividaVencida({ declaredAt, days, limit }) {
  return (
    `a dívida declarada em ${BASELINE_PATH} VENCEU a janela de revisão — decisão de ${declaredAt}, ` +
    `há ${days} dia(s), janela de ${limit} — e uma cota que ninguém revisa vira allowlist permanente`
  )
}

/** A dívida vencida como VIOLAÇÃO (o canal do `--review`, no job semanal). */
function reportarDividaVencida(aged) {
  console.error(
    `❌ dívida declarada SEM REVISÃO — ${textoDividaVencida(aged)}\n\n` +
      `   Reafirme (se o caso ainda não pode ser consertado — e diga o porquê DE NOVO):\n` +
      `     node scripts/check-pipefail-sigpipe.mjs --update --reason "<por que continua>"\n` +
      `   Ou conserte e aposente:\n` +
      `     node scripts/check-pipefail-sigpipe.mjs --fix\n`,
  )
}

/**
 * A dívida que não se pode CONFIAR (sem razão escrita, ou sem data válida) —
 * violação nos dois modos, com o remédio que conserta de verdade cada caso.
 */
function reportarDividaInvalida(invalid) {
  console.error(`❌ dívida declarada que não se pode CONFIAR (${BASELINE_PATH}):\n`)
  for (const i of invalid) console.error(`   ${i}`)
  console.error(
    `\n   O baseline é a decisão de NÃO consertar agora: sem a razão escrita e a data que a\n` +
      `   janela mede, ele é uma exceção sem autor e sem prazo.\n`,
  )
}

/**
 * A MARCA de contexto de cada ocorrência: o mesmo padrão, três leituras.
 *
 * A distinção é o valor do relatório: `pipefail declarado` e `shell default do
 * runner` pedem o MESMO remédio hoje mas por razões diferentes, e a terceira
 * (`defaults:` declarado sem pipefail) existe para o passo não ser atribuído ao
 * runner quando quem responde por ele é uma linha do repositório.
 */
function marcaContexto(context) {
  if (context === "pipefail") return "  (pipefail declarado)"
  if (context === "shell-declared")
    return "  (SHELL DEFAULT declarado por `defaults:` — sem pipefail)"
  return "  (SHELL DEFAULT do runner — premissa `bash -e`, NÃO deste repositório)"
}

/**
 * A PREMISSA MUDOU — a declaração de shell default que liga o pipefail.
 *
 * É FALHA PRÓPRIA, e não mais um passo contado, porque o efeito é de outra
 * natureza: uma linha do YAML reclassifica todos os passos do escopo de uma vez,
 * e nenhum passo muda no diff. O repositório paga essa troca DITA PASSO A PASSO
 * (`shell: bash` no passo, que é onde a classe é esperada), não herdada de uma
 * chave que quem revisa o diff de um passo não vê.
 */
function reportarPremissaMudada(premissas) {
  console.error(
    `❌ A PREMISSA DO SHELL DEFAULT MUDOU: \`defaults: run: shell:\` liga o pipefail para passos\n` +
      `   que NÃO declaram \`shell:\` — o gate trata esses passos como o default do RUNNER (\`bash -e\`),\n` +
      `   e uma declaração sua troca essa premissa para o escopo INTEIRO numa linha só:\n`,
  )
  for (const p of premissas) {
    const onde = p.scope === "workflow" ? "workflow inteiro" : `job \`${p.job ?? "?"}\``
    console.error(`     ${p.file}:${p.line}  \`shell: ${p.shell}\` (${onde})`)
    console.error(
      `           → ${p.passos} passo(s) sem \`shell:\` ${p.passos === 1 ? "passou" : "passaram"} a rodar sob pipefail de uma vez`,
    )
  }
  console.error(
    `\n   Por que isto BLOQUEIA em vez de ser contado: o default do runner não é deste repositório e o\n` +
      `   gate o trata como premissa (\`bash -e\`); uma declaração que liga o pipefail a substitui em silêncio,\n` +
      `   e o passo passa a ser a classe SIGPIPE sem que ninguém tenha declarado isso no passo.\n\n` +
      `   Conserte (o jeito de dizer que a classe É esperada ali é DIZER, no passo):` +
      `\n     declare \`shell: bash\` em cada passo afetado — aí o pipefail fica visível em quem revisa o passo;` +
      `\n     ou remova o \`defaults:\` e mantenha o default do runner.`,
  )
}

/**
 * A declaração de shell default que o guard NÃO conseguiu LER (forma inline).
 *
 * Não ler não é o mesmo que não haver: a forma inline muda o shell de todos os
 * passos do escopo, e presumir "sem pipefail" ali seria a aposta que este guard
 * existe para acabar. Fail-closed com o remédio explícito.
 */
function reportarPremissasIlegiveis(ilegiveis) {
  console.error(
    `❌ \`defaults:\` em forma INLINE (o guard só lê a forma em bloco) — a premissa do shell\n` +
      `   default fica INDETERMINADA, e presumir o default do runner ali seria uma aposta:\n`,
  )
  for (const d of ilegiveis) {
    const onde = d.scope === "workflow" ? "workflow inteiro" : `job \`${d.job ?? "?"}\``
    console.error(`     ${d.file}:${d.line}  \`${d.shell}\` (${onde})`)
  }
  console.error(
    `\n   Escreva a declaração em BLOCO, que o guard lê e classifica:` +
      `\n     defaults:` +
      `\n       run:` +
      `\n         shell: <o shell>`,
  )
}

function reportarNovas(novas) {
  console.error(
    `❌ ${novas.length} ocorrência(s) de \`| grep -q\` — o pipeline pode passar a 141 (SIGPIPE)\n   MESMO com o padrão encontrado, e de forma INTERMITENTE (depende do tamanho da saída):\n`,
  )
  let atual = null
  for (const v of novas) {
    if (v.file !== atual) {
      atual = v.file
      console.error(`   ${v.file}`)
    }
    const marca = marcaContexto(v.context)
    console.error(`     :${v.line}${marca}`)
    console.error(`           ${v.text.slice(0, 120)}`)
    console.error(`           → ${v.suggestion}`)
  }
  console.error(
    `\n   O remédio é HERESTRING (nenhum pipe, nenhum produtor para levar SIGPIPE):` +
      `\n     echo "$OUT" | grep -q X   →   grep -q X <<< "$OUT"` +
      `\n   Se o produtor é um comando vivo, capture antes: out=$(cmd); grep -q X <<< "$out"` +
      `\n\n   E POR QUE O PASSO SEM PIPEFAIL TAMBÉM REPROVA: sem pipefail a soma do pipeline é o` +
      `\n   status do grep e o SIGPIPE do produtor não é observado COMO GATE — mas isso depende do` +
      `\n   shell DEFAULT do runner, que não é deste repositório. O passo não pode depender dessa` +
      `\n   premissa: declarar \`shell: bash\` no passo continua sendo o jeito de dizer que a classe É` +
      `\n   esperada ali — e uma declaração em \`defaults:\` que ligue o pipefail FALHA este gate (a` +
      `\n   premissa não é herdada, é dita).`,
  )
}

function main() {
  const argv = process.argv.slice(2)
  const conhecidas = [
    "--root",
    "--json",
    "--list",
    "--update",
    "--no-baseline",
    "--fix",
    "--dry-run",
    "--review",
    "--reason",
  ]
  const desconhecida = argv.find((a) => a.startsWith("--") && !conhecidas.includes(a))
  if (desconhecida) {
    console.error(`❌ flag desconhecida: ${desconhecida}`)
    process.exit(EXIT.USAGE)
  }
  // `--dry-run` é a PREVISÃO do remédio: ele existe para mostrar o que o `--fix`
  // faria. Sem o `--fix` ele não tem o que prever — tratar isso como uso válido
  // devolveria o veredito do gate com uma flag que ninguém leu.
  if (argv.includes("--dry-run") && !argv.includes("--fix")) {
    console.error("❌ --dry-run só tem efeito com --fix (é a previsão do remédio)")
    process.exit(EXIT.USAGE)
  }
  const rootIdx = argv.indexOf("--root")
  if (rootIdx !== -1 && !argv[rootIdx + 1]) {
    console.error("❌ --root exige um diretório (fail-closed)")
    process.exit(EXIT.UNAVAILABLE)
  }
  const reasonIdx = argv.indexOf("--reason")
  if (reasonIdx !== -1 && !argv[reasonIdx + 1]) {
    console.error("❌ --reason exige o TEXTO da decisão (fail-closed)")
    process.exit(EXIT.USAGE)
  }
  const reason = reasonIdx !== -1 ? argv[reasonIdx + 1] : ""
  // O modo do CRON: aqui a decisão vencida é VIOLAÇÃO. No run normal ela é
  // `::warning::` (ver `reportarDividaVencida`) — uma data não pode bloquear o
  // PR de todo mundo, mas também não pode passar em silêncio num run verde.
  const review = argv.includes("--review")
  const root = rootIdx !== -1 ? resolve(argv[rootIdx + 1]) : process.cwd()
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    console.error(`❌ --root inexistente: ${root}`)
    process.exit(EXIT.UNAVAILABLE)
  }

  const { files, violations, foraDoEscopo, premissas, ilegiveis, naoLidos, locais, scanned } =
    scanRoot(root)
  // NÃO SEI JULGAR vem primeiro, em qualquer modo de saída: sem ter lido todo o
  // escopo, "nenhuma ocorrência nova" (e o JSON que o doctor publica) seria uma
  // afirmação sobre o que o guard não viu.
  exitOnUnjudgeable(naoLidos)
  const json = argv.includes("--json")

  if (argv.includes("--list")) {
    console.log(files.join("\n"))
    process.exit(EXIT.OK)
  }

  // `--fix` aposenta o caso MECÂNICO. Roda antes do gate porque o efeito dele é
  // sobre o FONTE, não sobre o veredito; reler a árvore no fim é o que reporta o
  // que sobrou para revisão humana.
  if (argv.includes("--fix")) {
    const dryRun = argv.includes("--dry-run")
    const previa = fixAll(root, { dry: dryRun })
    if (previa.indisponivel) {
      console.error(`❌ --fix indisponível: ${previa.indisponivel}`)
      process.exit(EXIT.UNAVAILABLE)
    }
    // ── PREVIEW: o patch que a gravação faria, e NADA é gravado ──────────
    // É o MESMO `fixAll` do caminho de gravação (`dry: true` só decide não
    // escrever): quem aplica o patch do comentário do PR aplica exatamente o que
    // este comando imprimiria.
    if (dryRun) {
      const { patch, ilegiveis } = shellPatch(previa.fixed, { root })
      // Um arquivo que não abre na hora de montar o patch não vira "nada a
      // remendar": o patch sairia sem ele e quem aplicasse o comentário acharia
      // que cobriu tudo. É exit 2 (não julguei), com o arquivo nomeado.
      if (ilegiveis.length > 0) {
        console.error(
          `❌ --fix --dry-run: não consegui ler para montar o patch: ` +
            ilegiveis.map((i) => `${i.file} (${i.motivo})`).join(", "),
        )
        process.exit(EXIT.UNAVAILABLE)
      }
      if (json) {
        console.log(
          JSON.stringify(
            {
              root,
              dryRun: true,
              patch,
              fixed: previa.fixed.map(({ file, line, before, after }) => ({
                file,
                line,
                before,
                after,
              })),
              refused: previa.refused,
              recusados: previa.recusados,
              unread: previa.unread,
            },
            null,
            2,
          ),
        )
        process.exit(EXIT.OK)
      }
      if (patch === "") {
        console.error(
          "── preview (--fix --dry-run): nada a remendar; NADA foi gravado e nenhum arquivo foi tocado",
        )
        for (const r of previa.recusados) console.error(`   ⚠️  ${r.file}: ${r.motivo}`)
        process.exit(EXIT.OK)
      }
      console.error(
        `── preview (--fix --dry-run): ${previa.fixed.length} linha(s) em ` +
          `${new Set(previa.fixed.map((f) => f.file)).size} arquivo(s); NADA foi gravado`,
      )
      if (previa.refused.length > 0) {
        console.error(
          `   ${previa.refused.length} ocorrência(s) NÃO cobertas pelo patch (pedem captura e revisão humana)`,
        )
      }
      process.stdout.write(patch)
      process.exit(EXIT.OK)
    }
    const arquivos = new Set(previa.fixed.map((f) => f.file)).size
    const linhas = previa.fixed.length
    for (const [file, n] of Object.entries(countsByFile(violations))) {
      const recusado = previa.recusados.find((r) => r.file === file)
      if (recusado) {
        console.log(`ℹ️  ${file}: ${recusado.motivo}`)
        continue
      }
      console.log(
        `✅ ${file}: ${n} ocorrência(s) do caso mecânico, ${previa.fixed.filter((f) => f.file === file).length} linha(s)`,
      )
    }
    console.log(
      `\n--fix: ${linhas} linha(s) reescrita(s) em ${arquivos} arquivo(s) — mesma asserção, sem produtor para levar SIGPIPE.`,
    )
    const sobraram = scanRoot(root).violations
    if (sobraram.length > 0) {
      console.log(
        `\n   ${sobraram.length} ocorrência(s) NÃO são o caso mecânico (produtor vivo ou linha de continuação) — pedem captura e revisão humana:`,
      )
      let atual = null
      for (const v of sobraram) {
        if (v.file !== atual) {
          atual = v.file
          console.log(`   ${v.file}`)
        }
        console.log(`     :${v.line}  ${v.text.slice(0, 120)}`)
        console.log(`           → ${v.suggestion}`)
      }
    }
    console.log(
      `\n   Revise o diff e rode \`--update\` (LOCAL) para registrar o quanto sobrou: ` +
        `a redução é o que se revisa no PR.`,
    )
    process.exit(EXIT.OK)
  }

  if (argv.includes("--update")) {
    // FAIL-CLOSED: declarar dívida é uma DECISÃO. Sem a razão escrita, o comando
    // não grava NADA — o arquivo não nasce, e o gate segue absoluto. A
    // alternativa barata (consertar) vem antes na mensagem de propósito: quem
    // quer só "deixar verde" tem de escolher entre consertar e dizer o porquê.
    if (violations.length > 0 && String(reason).trim() === "") {
      console.error(
        `❌ --update RECUSA sem --reason: há ${violations.length} ocorrência(s) a declarar.\n\n` +
          `   Declarar dívida é uma DECISÃO REGISTRADA, não um jeito de o gate ficar verde: quem lê o\n` +
          `   baseline depois tem de saber POR QUE aquele caso não foi consertado agora.\n\n` +
          `   Conserte:   node scripts/check-pipefail-sigpipe.mjs --fix\n` +
          `   Ou declare: node scripts/check-pipefail-sigpipe.mjs --update --reason "<por que não pode agora>"\n`,
      )
      process.exit(EXIT.USAGE)
    }
    const gravado = writeBaseline(root, violations, { reason })
    console.log(
      `✅ baseline regenerado em ${BASELINE_PATH}: ${gravado.total} ocorrência(s) em ` +
        `${Object.keys(gravado.files).length} arquivo(s), declaradas em ${gravado.declaredAt}, ` +
        `janela de revisão de ${gravado.reviewAfterDays} dia(s).`,
    )
    if (gravado.total > 0) console.log(`   razão registrada: ${gravado.reason}`)
    process.exit(EXIT.OK)
  }

  const semBaseline = argv.includes("--no-baseline")
  const baseline = semBaseline ? { files: {}, declaredAt: null, total: 0 } : readBaseline(root)
  const { novas, reduzidas } = semBaseline
    ? { novas: violations, reduzidas: [] }
    : compareWithBaseline(violations, baseline)
  const idade = baselineAgeDays(baseline)
  const problemas = semBaseline ? { invalid: [], aged: null } : baselineProblems(baseline)

  const totalDeclarado = Object.values(baseline.files ?? {}).reduce((a, b) => a + b, 0)
  const divida =
    totalDeclarado === 0
      ? "sem dívida declarada — QUALQUER ocorrência reprova o gate"
      : `dívida declarada: ${totalDeclarado} ocorrência(s) em ${Object.keys(baseline.files ?? {}).length} arquivo(s)` +
        (baseline.declaredAt
          ? ` (declarada em ${baseline.declaredAt}${idade === null ? "" : `, ${idade} dia(s) atrás`})`
          : "") +
        (problemas.aged ? ` — VENCIDA (janela de ${problemas.aged.limit} dia(s))` : "") +
        (problemas.invalid.length > 0 ? " — SEM RAZÃO ou SEM DATA válida" : "") +
        (baseline.ausente ? " — baseline AUSENTE (tudo é ocorrência nova)" : "")

  if (json) {
    console.log(
      JSON.stringify(
        {
          root,
          scanned,
          baseline: { ...baseline, idadeDias: idade },
          problemas,
          // A PREMISSA sai como FATO próprio, e não dentro de `novas`: quem lê o
          // relatório (o doctor, o publisher de issue) tem de poder distinguir
          // "um passo novo tem o padrão" de "uma linha do YAML reclassificou N
          // passos de uma vez" — o remédio de cada uma é outro.
          premissas,
          ilegiveis,
          naoLidos,
          // O CORTE DE ESCOPO, nomeado: o que o repositório declara LOCAL não é
          // script dele (o scratch de uma sessão, o cache) — sem esta lista, o
          // `scanned.shellScripts` não distingue "o repositório não tem mais
          // scripts" de "o gate tirou alguns do escopo".
          locais,
          // O QUE A VARREDURA NÃO JULGOU, nomeado: sem esta lista, "N passos" no
          // relatório não distingue "não havia o que julgar" de "o gate não olhou".
          foraDoEscopo,
          novas,
          reduzidas,
          total: violations.length,
        },
        null,
        2,
      ),
    )
    const falha =
      novas.length > 0 ||
      premissas.length > 0 ||
      ilegiveis.length > 0 ||
      problemas.invalid.length > 0 ||
      (review && Boolean(problemas.aged))
    process.exit(falha ? EXIT.VIOLATIONS : EXIT.OK)
  }

  // A DECLARAÇÃO ILEGÍVEL vem primeiro: ela é sobre NÃO SABER, e um veredito de
  // "nenhuma ocorrência nova" com a premissa em aberto seria a falsa segurança
  // que o guard recusa.
  if (ilegiveis.length > 0) {
    reportarPremissasIlegiveis(ilegiveis)
    console.error(`\n   ${divida}`)
    process.exit(EXIT.VIOLATIONS)
  }

  // A PREMISSA MUDADA é falha PRÓPRIA — e as ocorrências que ela RECLASSIFICOU
  // saem na sequência: o operador vê o todo (a declaração E o que ela passou a
  // valer) em UM run, em vez de descobrir os dois em runs separados.
  if (premissas.length > 0) {
    reportarPremissaMudada(premissas)
    if (novas.length > 0) {
      console.error("")
      reportarNovas(novas)
    }
    console.error(`\n   ${divida}`)
    process.exit(EXIT.VIOLATIONS)
  }

  // Dívida que não se pode CONFIIAR (sem razão escrita, ou sem data válida):
  // violação nos DOIS modos. Sem isso, apagar o campo `reason` do arquivo seria
  // o jeito silencioso de declarar dívida sem decidir nada.
  if (problemas.invalid.length > 0) {
    reportarDividaInvalida(problemas.invalid)
    console.error(`\n   ${divida}`)
    process.exit(EXIT.VIOLATIONS)
  }

  if (novas.length > 0) {
    reportarNovas(novas)
    console.error(`\n   ${divida}`)
    process.exit(EXIT.VIOLATIONS)
  }

  // Dívida declarada que VENCEU a janela: o canal é o run VERMELHO do semanal
  // (`--review`, ao lado das outras allowlists); no run normal é `::warning::`
  // — visível no log do run e no relatório, sem bloquear o PR de quem não tem
  // nada a ver com a cota.
  if (problemas.aged) {
    if (review) {
      reportarDividaVencida(problemas.aged)
      process.exit(EXIT.VIOLATIONS)
    }
    console.log(`::warning::check-pipefail-sigpipe: ${textoDividaVencida(problemas.aged)}`)
  }

  if (reduzidas.length > 0) {
    console.log(
      `ℹ️  ${reduzidas.length} arquivo(s) com MENOS ocorrências que o baseline (${reduzidas
        .map((r) => `${r.file}: ${r.baseline}→${r.atual}`)
        .join(", ")}) — a dívida diminuiu; rode \`--update\` (local) para registrar.`,
    )
  }

  // O CORTE DE ESCOPO, nomeado: o que o repositório declara LOCAL não é script
  // dele (o scratch de uma sessão, o cache), e o corte sai DITO — um gate que
  // varre menos do que parece mente pelo que NÃO diz.
  if (locais.length > 0) {
    console.log(
      `ℹ️  ${locais.length} arquivo(s) de shell FORA da varredura — o repositório os declara LOCAIS ` +
        `(regra de ignore, medida agora):`,
    )
    for (const l of locais) console.log(`     ${l}`)
  }

  // O ESCOPO DECLARADO: os passos que a varredura NÃO julgou, um a um. Um gate
  // que varre menos do que parece mente pelo que NÃO diz — e o passo com
  // `run:` vazio é o caso em que há um passo declarado e nada a julgar.
  if (foraDoEscopo.length > 0) {
    console.log(
      `ℹ️  ${foraDoEscopo.length} passo(s) DECLARADO(s) fora do escopo da varredura (nada a julgar):`,
    )
    for (const f of foraDoEscopo) {
      console.log(`     ${f.file}:${f.line}${f.job ? ` (job \`${f.job}\`)` : ""} — ${f.motivo}`)
    }
  }

  console.log(
    `✅ Nenhuma ocorrência NOVA de \`| grep -q\` — o padrão é varrido nos DOIS contextos: ` +
      `${scanned.shellScriptsComPipefail}/${scanned.shellScripts} script(s) com pipefail + ` +
      `${scanned.runStepsComPipefail} passo(s) de workflow com pipefail (shell: bash, \`defaults:\` ou set -o pipefail) + ` +
      `${scanned.runStepsSemPipefail} passo(s) de ${scanned.workflows} workflow(s) SEM pipefail` +
      (scanned.passosCorpoVazio > 0
        ? ` (+ ${scanned.passosCorpoVazio} passo(s) de corpo VAZIO, FORA do escopo: nada executa) `
        : ". ") +
      `A FONTE do shell está dita passo a passo: ${scanned.passosComShellNoPasso} no próprio passo, ` +
      `${scanned.passosComDefaultDeclarado} por \`defaults:\` do repositório (nenhuma ligando pipefail — as que ` +
      `ligam FALHAM o gate), ${scanned.passosDoRunner} pelo default do RUNNER (\`bash -e\`, que não é deste ` +
      `repositório). O passo sem pipefail não fica FORA: ele reprova pelo mesmo padrão. ${divida}.`,
  )
  process.exit(EXIT.OK)
}

// True apenas quando executado diretamente — permite importar as funções puras
// nos testes unitários sem disparar a varredura.
const IS_DIRECT_RUN =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (IS_DIRECT_RUN) main()
