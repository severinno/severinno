#!/usr/bin/env node

// =============================================================================
// check-workflow-run-syntax.mjs
//
// O gate que roda `bash -n` em TODO corpo `run:` de TODO workflow das duas
// forjas: o corpo de um passo é SHELL, e um shell que não faz parsing morre no
// RUNNER — no meio do job, depois de minutos de setup, longe da causa.
//
// POR QUE ISTO EXISTE (a falha que ele converte em PR vermelho)
//
// O repositório reescreve corpo de `run:` por MÁQUINA, e faz isso de propósito:
// o `--fix` do `check-pipefail-sigpipe` troca `PRODUTOR | grep -q P` por
// `grep -q P <<< "$(PRODUTOR)"` em 216 ocorrências, e reescritas mecânicas em
// massa são exatamente onde entra um `<<<` desbalanceado, um `"` a mais, um
// heredoc sem terminador ou uma continuação (`\`) que engoliu a linha seguinte.
// Nenhuma dessas classes é vista por quem revisa o diff de 40 arquivos, nem
// pelos guards que LEEM o YAML (eles classificam TEXTO — `check-workflow-refs`,
// `check-forge-parity`, o doctor): um corpo sintaticamente quebrado continua
// sendo `run:` válido para todos eles, e o erro só aparece quando o runner
// tenta executar o passo.
//
// O QUE ELE MEDE (e o que NÃO mede)
//
//   1. cada corpo `run:` — escalar (`- run: cmd`) ou bloco (`run: |`) — passa
//      por `bash -n`, que faz o PARSING sem executar nada. Um corpo vazio não é
//      sintaxe a julgar (não roda nada) e sai da conta;
//   2. O AVISO CONTA TANTO QUANTO O ERRO — e é por isso que o gate NÃO olha só
//      o exit code: um heredoc sem terminador (`cat <<'EOF'` sem `EOF`) é
//      **aviso** para o bash, que sai 0. O corpo truncado passaria como válido
//      enquanto o runner executaria outra coisa. Medido no repositório: 0
//      avisos hoje, e o exit code não bastaria para saber disso;
//   3. o LOCALE do `bash -n` é PINADO (`LC_ALL=C`): a mensagem do parser é lida
//      por quem opera (e assertada nos testes), e "erro de sintaxe" vs
//      "syntax error" conforme o `LANG` do runner faria o diagnóstico — e o
//      teste — depender do ambiente de quem roda;
//   4. os passos vêm da MESMA leitura que os outros guards usam
//      (`workflowRunSteps`/`workflowDefaultShells`, de `check-pipefail-sigpipe`,
//      e a lista de arquivos de `forge-workflows`): um corpo que aquele extrator
//      não enxerga não vira um ponto cego silencioso aqui;
//   5. a EXPRESSÃO DO RUNNER (`${{ ... }}`) é MASCARADA antes do `bash -n`. Ela
//      não é sintaxe de shell: o runner a resolve ANTES de o bash existir, e o
//      que o bash recebe é o VALOR. Julgar as chaves seria julgar um texto que
//      nunca chega ao interpretador (e um valor que contenha `}` — `${{ a.b ||
//      'x' }}` — acusaria um corpo são). O mascaramento preserva o CONTEXTO
//      (uma palavra no lugar da expressão): um erro de sintaxe REAL em volta
//      dela continua sendo pego — há teste para os dois lados;
//   6. passo com `shell:` NÃO-bash (`python`, `pwsh`, `node`) é PULADO com o
//      motivo DITO no relatório: `bash -n` não julga o que não é bash, e um
//      passo pulado em silêncio seria a mesma mentira de um gate que varre
//      menos do que parece. Hoje o repositório não tem nenhum — e é por isso
//      que o pulo precisa aparecer: no dia em que tiver, quem lê sabe que o
//      passo não foi conferido.
//   7. o modo `--staged` julga só os workflows que o ÍNDICE tem (o que o commit
//      vai gravar), e lê o CONTEÚDO do índice (`git show :path`) — não o
//      working tree. É o recorte do pre-commit, DECLARADO em `HOOK_DECLARED`
//      (`check-hook-ci-parity`): o commit é quem introduz o corpo quebrado (a
//      reescrita mecânica em massa acontece antes de commitar) e a árvore de
//      trabalho pode carregar WIP que NÃO faz parte dele. Um defeito que só
//      exista no working tree não é deste commit — e a varredura inteira (os
//      480 corpos das duas forjas) continua sendo o veredito do CI. Sem
//      git/índice o modo é FAIL-CLOSED (exit 2): "0 violações" sem ter lido o
//      índice seria a mesma mentira de um gate que varre menos do que diz.
//   8. o SHELL declarado é julgado contra o que o RUNNER tem — a única coisa que
//      o parsing NÃO pega. `bash -n` julga o corpo, não a existência do
//      interpretador: um passo com `shell: pwsh` num runner que não tem `pwsh`
//      passa hoje com o corpo PULADO ("não é bash, não julgo") e morre no meio
//      do job com `command not found`, depois do setup. O conjunto de shells é
//      MEDIDO na imagem do runner (ver `RUNNER_IMAGE`/`RUNNER_SHELLS`: digest,
//      data e o comando que mediu — a TAG é derivada da fonte única, nunca
//      literal) — não presumido do documentado nem
//      de `command -v` da máquina de quem roda. Três desfechos: bash (o corpo
//      é parseado), shell não-bash que a MEDIÇÃO achou presente (o corpo não é
//      parseável e o motivo é o mesmo do passado: o gate não julga o que não é
//      bash) e shell que a medição achou AUSENTE (VIOLAÇÃO, com o que o runner
//      faria). A forma CUSTOM (`perl {0}`) não é um quarto desfecho: o que o
//      gate julga é o NOME que ela invoca — `perl {0}` é presente, `pwsh {0}` é
//      violação. INDETERMINADO fica para o nome que a medição NÃO cobre, onde o
//      gate não prova nem uma coisa nem outra e diz isso em vez de presumir.
//   9. `--fix` REMENDA a reescrita quebrada em vez de só acusá-la — e o que ele
//      remenda é a cicatriz MECÂNICA conhecida, não a intenção: um OPERADOR
//      PENDENTE no fim do corpo (`\`, `&&`, `||`, `|`, `<<`, `<<<`, `>`, `>>`,
//      `<`) — `&` e `;` ficam FORA: eles FECHAM comando (`sleep 1 &` é válido),
//      e remendar um deles inventaria intenção. O remendo só é gravado quando ele
//      faz o corpo VOLTAR A FAZER PARSING, medido em memória E de novo no disco
//      depois de gravar (a gravação é DESFEITA se o corpo no disco não passar) —
//      um remendo que não mede o efeito é o jeito mais fácil de o arquivo mentir.
//      Ele só toca em bloco LITERAL (`run: |`), onde a linha do arquivo É a linha
//      do corpo. As classes que ele NÃO remenda TÊM MOTIVO ESCRITO no relatório
//      (heredoc: o texto é DADO; forma dobrada `>`/escalar inline: a linha do
//      arquivo não é a linha do corpo; operador que não é cicatriz — `then` sem
//      `fi`: a intenção não é reconstruível dali). Ele NUNCA reconstrói uma linha
//      engolida — tira a cicatriz que impedia o parsing e diz que o diff é o que
//      se revisa.
//
// SEM ALLOWLIST: o repositório inteiro passa em `bash -n` hoje (480 corpos, os
// dois diretórios de forja). Um gate que nasce absoluto não tem cota para
// envelhecer — e uma cota aqui significaria declarar que um corpo quebrado pode
// ficar quebrado.
//
// Usage:
//   node scripts/check-workflow-run-syntax.mjs              # o gate
//   node scripts/check-workflow-run-syntax.mjs --staged     # só os workflows do ÍNDICE (pre-commit)
//   node scripts/check-workflow-run-syntax.mjs --fix        # REMENDA a cicatriz mecânica (LOCAL)
//   node scripts/check-workflow-run-syntax.mjs --shells     # o que a imagem do runner tem, e a prova
//   node scripts/check-workflow-run-syntax.mjs --json       # saída estruturada
//   node scripts/check-workflow-run-syntax.mjs --list       # só os corpos varridos
//   node scripts/check-workflow-run-syntax.mjs --root X     # fixture (testes)
//   node scripts/check-workflow-run-syntax.mjs --bash /bin/bash  # outro interpretador
//
// Exit codes:
//   0 — todo corpo `run:` passa em `bash -n` sem erro E sem aviso (os passos
//       não-bash são contados e nomeados) e todo `shell:` declarado existe no
//       runner medido
//   1 — violação: o corpo de um passo não faz parsing, OU o parser emitiu aviso
//       (com a mensagem do bash, o arquivo e a linha do passo), OU o passo
//       declara um `shell:` que o runner não tem
//   2 — infra: `bash` não pôde ser executado, `--root` inexistente, `--staged`
//       sem índice git (fora de um repositório), ou um workflow não pôde ser
//       lido (fail-closed: sem medição não há veredito — nunca "0 violações" por
//       não ter conseguido rodar)
//   3 — uso inválido (flag desconhecida, `--root`/`--bash` sem valor, `--fix`
//       combinado com `--staged` ou `--json` — combinações que o comando não
//       promete)
// =============================================================================

import { spawnSync } from "node:child_process"
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import process from "node:process"
import { pathToFileURL } from "node:url"

import { workflowDefaultShells, workflowRunSteps } from "./check-pipefail-sigpipe.mjs"
import { resolveImageRef } from "./ensure-runner-image.mjs"
import { allWorkflowFiles, isForgeWorkflowPath } from "./forge-workflows.mjs"

/** Exit codes — o contrato da CLI. */
export const EXIT = {
  OK: 0,
  VIOLATIONS: 1,
  UNAVAILABLE: 2,
  USAGE: 3,
}

/** O interpretador default: o `bash` do PATH (o mesmo dos runners). */
export const DEFAULT_BASH = "bash"

/**
 * A expressão do runner (`${{ ... }}`) vira uma PALAVRA.
 *
 * Não é cosmético: `${{ ... }}` não é sintaxe de shell (o runner o resolve antes
 * de o bash existir), e julgar as chaves seria julgar um texto que nunca chega
 * ao interpretador. Uma palavra preserva o CONTEXTO — `[ "X" = "y" ]` continua
 * com o mesmo número de tokens e quotes —, então um desbalanceamento REAL em
 * volta da expressão continua sendo acusado.
 *
 * Limite declarado: a expressão não pode conter `}` (as formas do repositório —
 * `vars.X`, `job.services.Y.id`, `github.event.inputs.Z || 0` — não contêm; a
 * mesma premissa da máscara do `check-pipefail-sigpipe`).
 *
 * @param {string} text
 * @returns {string}
 */
export function maskExpressions(text) {
  return String(text ?? "").replace(/\$\{\{[^}]*\}\}/g, "EXPRESSAO")
}

/**
 * O shell EFETIVO do passo é bash? `null` é a premissa do runner — em Linux,
 * `bash -e {0}` — e conta como bash; `sh` é julgado por `bash -n` de propósito
 * (o bash aceita a sintaxe POSIX de `sh`, então um corpo que o bash recusa é um
 * corpo que a premissa `bash` também recusaria no runner).
 *
 * @param {string|null|undefined} shell
 * @returns {boolean}
 */
export function isBashShell(shell) {
  if (shell === null || shell === undefined) return true
  const s = String(shell).trim()
  if (s === "") return true
  return /^(?:[\w./-]*\/)?(?:bash|sh)(?:\s|$)/.test(s)
}

/**
 * A IMAGEM DO RUNNER — e o comando que MEDIU o que ela embarca.
 *
 * O conjunto de shells abaixo é uma MEDIÇÃO, não uma presunção: a alternativa
 * (presumir do documentado, ou perguntar ao `command -v` de quem roda o guard)
 * publicaria como fato do repositório uma propriedade da MÁQUINA — a mesma
 * classe de erro que já custou caro aqui (um tamanho de heap lido do host virou
 * "o runner estoura a memória"). A ref e o digest ficam escritos para o dia em
 * que a base mudar: aí o caminho é RE-MEDIR (`--shells` imprime este bloco e o
 * comando pronto), não ajustar o número no olho.
 */
export const RUNNER_IMAGE = {
  digest: "sha256:fd027ee77b520fbc4eed1e24091bbe277cb242c1c04ea9ccfd62cc6903dbb852",
  measuredAt: "2026-09-16",
  command:
    `docker run --rm --entrypoint /bin/sh <ref> -c ` +
    `'for s in bash sh dash zsh fish ksh python python3 pwsh node cmd powershell perl ruby; do ` +
    `printf "%-12s %s\\n" "$s" "$(command -v "$s" 2>/dev/null || echo AUSENTE)"; done'`,
}

/**
 * A REF (com tag) da imagem do runner — DERIVADA, nunca literal.
 *
 * A tag é `.../ubuntu-bun:<BUN_VERSION>`: escrevê-la aqui seria um espelho de
 * `BUN_VERSION` envelhecendo em silêncio — exatamente a classe que o
 * `check:registry-source` persegue (e ele ACUSA o literal: foi assim que esta
 * linha nasceu). O resolver é o MESMO do `ensure-runner-image` e do compose
 * (`IMAGE_REGISTRY`/`IMAGE_NAMESPACE` com os defaults do compose, e
 * `BUN_VERSION` sem default).
 *
 * Sem `BUN_VERSION` no ambiente NÃO há ref: devolve `null`, e o relatório diz
 * INDETERMINADO em vez de presumir qual imagem foi medida. O que não se deriva
 * fica registrado: o DIGEST (a tag é um apelido mutável; o digest identifica o
 * artefato que a medição tocou), a data e o comando.
 *
 * @param {Record<string, string|undefined>} [env]
 * @returns {string|null}
 */
export function runnerImageRef(env = process.env) {
  const r = resolveImageRef({
    IMAGE_REGISTRY: env.IMAGE_REGISTRY,
    IMAGE_NAMESPACE: env.IMAGE_NAMESPACE,
    BUN_VERSION: env.BUN_VERSION,
  })
  return typeof r.ref === "string" ? r.ref : null
}

/**
 * Os interpretadores que a imagem do runner TEM — com o CAMINHO medido.
 *
 * O caminho não é decorativo: ele é o que o relatório cita quando o passo declara
 * o shell, e é o que prova que a medição foi feita (em vez de "deve ter").
 *
 * @type {Record<string, string>}
 */
export const RUNNER_SHELLS = {
  bash: "/usr/bin/bash",
  sh: "/usr/bin/sh",
  dash: "/usr/bin/dash",
  python: "/usr/local/bin/python",
  python3: "/usr/bin/python3",
  node: "/opt/acttoolcache/node/24.19.0/x64/bin/node",
  perl: "/usr/bin/perl",
}

/**
 * Os que a MESMA medição achou AUSENTES. Fica declarado porque é o lado que o
 * gate REPROVA: quando um passo declara `pwsh`, a mensagem precisa poder dizer
 * "medido: ausente nesta imagem" em vez de "o gate acha que não tem".
 *
 * @type {string[]}
 */
export const RUNNER_SHELLS_MISSING = ["zsh", "fish", "ksh", "pwsh", "powershell", "cmd", "ruby"]

/**
 * O COMANDO de um `shell:` declarado — e se ele é a forma CUSTOM.
 *
 * Duas formas existem no runner: o NOME de um shell conhecido (`bash`, `python`)
 * e a LINHA DE COMANDO custom, que só é custom porque traz `{0}` (o runner a
 * substitui pelo caminho do script: `perl {0}`). Sem `{0}`, o valor é um NOME —
 * e `bash -e` (espaço, sem `{0}`) não é um nome de shell: é um valor que o runner
 * procuraria como shell e não acharia.
 *
 * O caminho é reduzido ao basename (`/usr/bin/zsh` → `zsh`) porque é isso que o
 * `command -v` da medição resolveu.
 *
 * @param {string|null|undefined} shell
 * @returns {{raw: string, custom: boolean, command: string}|null}
 */
export function shellCommandOf(shell) {
  const raw = String(shell ?? "").trim()
  if (raw === "") return null
  const primeiro = raw.split(/\s+/)[0]
  return { raw, custom: raw.includes("{0}"), command: primeiro.split("/").pop() || primeiro }
}

/**
 * A CICATRIZ MECÂNICA de uma reescrita: um OPERADOR PENDENTE no fim do corpo.
 *
 * É a impressão digital que a reescrita deixa quando ENGOLE a continuação de uma
 * linha: a última linha fica esperando do outro lado (`echo "a" \`, `[ x ] &&`,
 * `cat <<`), e o bash sai com `unexpected end of file`. A lista é dos operadores
 * que PEDEM continuação — `&` e `;` ficam FORA de propósito, porque eles FECHAM
 * comando (`sleep 1 &` é um corpo válido) e remendar um deles inventaria
 * intenção. Sem operador da lista, o fixer recusa em vez de adivinhar.
 */
export const PENDING_OPERATOR = /(\\|\|\||&&|<<<|<<|>>|[|<>])\s*$/

/**
 * Remenda o corpo, EM MEMÓRIA, tirando o operador pendente da última linha.
 *
 * O que ele NÃO faz é a parte que importa: NÃO reconstrói a linha engolida. Ele
 * tira a cicatriz que impedia o parsing e devolve o corpo — o diff é o que se
 * revisa, e o relatório diz isso. As recusas TÊM MOTIVO ESCRITO (o caller o
 * imprime), porque um fixer que silenciosamente não remenda é pior que nenhum.
 *
 * @param {string} body
 * @returns {{mended: boolean, reason?: string, operador?: string, antes?: string, depois?: string, body?: string}}
 */
export function mendBody(body) {
  const texto = String(body ?? "")
  const linhas = texto.split("\n")
  let idx = -1
  for (let i = linhas.length - 1; i >= 0; i--) {
    if (linhas[i].trim() !== "") {
      idx = i
      break
    }
  }
  if (idx === -1) {
    return { mended: false, reason: "corpo vazio — não há linha para remendar" }
  }
  // Heredoc: o texto entre o marcador e ele mesmo é DADO. Tirar a cicatriz aqui
  // exigiria inventar/remover conteúdo do heredoc — a intenção não é reconstruível.
  // `<<<` (herestring, uma linha) NÃO é heredoc: é um `<<` seguido de outro `<`,
  // então `echo a <<<` é cicatriz remendável como qualquer outra.
  if (/(?<!<)<<(?!<)/.test(texto)) {
    return {
      mended: false,
      reason:
        "heredoc no corpo: o texto do heredoc é DADO, não código — remendar aqui " +
        "inventaria conteúdo. A reescrita precisa ser refeita à mão.",
    }
  }
  const linha = linhas[idx]
  const m = linha.match(PENDING_OPERATOR)
  if (!m) {
    return {
      mended: false,
      reason:
        `a última linha não termina em OPERADOR PENDENTE (\`${linha.trim().slice(0, 60)}\`) ` +
        "— a cicatriz conhecida não está aqui, e a intenção não é reconstruível deste lado",
    }
  }
  const depois = linha.replace(PENDING_OPERATOR, "").replace(/\s+$/, "")
  linhas[idx] = depois
  const novo = linhas.join("\n")
  if (novo.trim() === "") {
    return {
      mended: false,
      reason: "remendar deixaria o corpo VAZIO — o passo deixaria de rodar o que diz",
    }
  }
  return { mended: true, operador: m[1], antes: linha, depois, body: novo }
}

/**
 * Aplica o remendo no ARQUIVO — e só o grava depois de MEDIR o efeito.
 *
 * Três medições antes de escrever, e uma depois:
 *   1. a linha do arquivo tem de corresponder à última linha do CORPO. É o que
 *      recusa a forma NÃO-BLOCO (`run: >`, que o YAML dobra numa linha só): sem
 *      esta igualdade o fixer escreveria na linha errada;
 *   2. o corpo remendado tem de VOLTAR A FAZER PARSING (`bash -n` em memória);
 *   3. depois de gravar, o arquivo é RELIDO e re-julgado — e a gravação é
 *      DESFEITA se o corpo no disco não passar. Um remendo que não mede o efeito
 *      é o jeito mais fácil de o arquivo mentir.
 *
 * @param {string} root
 * @param {{file: string, line: number, bodyEndLine: number, body: string}} failure
 * @param {{bash?: string, run?: Function, write?: Function, read?: Function}} [deps]
 * @returns {{fixed: boolean, reason?: string, operador?: string, antes?: string, depois?: string}}
 */
export function fixWorkflow(
  root,
  failure,
  { bash = DEFAULT_BASH, run = spawnSync, write = writeFileSync, read = readFileSync } = {},
) {
  const abs = join(root, failure.file)
  let conteudo
  try {
    conteudo = read(abs, "utf8")
  } catch (err) {
    return { fixed: false, reason: `arquivo ilegível: ${err?.message ?? err}` }
  }
  const eol = conteudo.includes("\r\n") ? "\r\n" : "\n"
  const linhas = conteudo.split(/\r?\n/)
  const m = mendBody(failure.body)
  if (!m.mended) return { fixed: false, reason: m.reason }

  // (1) a linha do arquivo é MESMO a última linha do corpo?
  let idx = failure.bodyEndLine - 1
  while (idx >= 0 && String(linhas[idx] ?? "").trim() === "") idx--
  const alvo = linhas[idx]
  if (typeof alvo !== "string") {
    return { fixed: false, reason: `a linha ${failure.bodyEndLine} não existe em ${failure.file}` }
  }
  // A forma do escalar decide se a LINHA do arquivo é a linha do corpo. Um
  // bloco LITERAL (`run: |`, com indicador de chomping ou não) preserva as
  // linhas; a forma DOBRADA (`run: >`) as junta e a escalar inline as põe na
  // própria linha do `run:` — nas duas, o fixer escreveria na linha errada.
  const linhaDoRun = String(linhas[failure.line - 1] ?? "")
  if (!/:\s*\|[-+]?\s*$/.test(linhaDoRun)) {
    return {
      fixed: false,
      reason:
        `a linha ${failure.line} não declara bloco LITERAL (\`run: |\`): a forma dobrada ` +
        `(\`>\`) junta as linhas e a escalar inline as põe na linha do \`run:\` — o fixer ` +
        `escreveria na linha errada. Remende esta à mão.`,
    }
  }
  const ultimaDoCorpo = failure.body
    .split("\n")
    .filter((l) => l.trim() !== "")
    .pop()
  if (alvo.trim() !== String(ultimaDoCorpo ?? "").trim()) {
    return {
      fixed: false,
      reason:
        `a linha ${idx + 1} do arquivo não corresponde à última linha do corpo ` +
        `(forma não-BLOCO — ex.: \`run: >\`, que o YAML dobra numa linha: remendar aqui ` +
        `escreveria na linha errada)`,
    }
  }

  // (2) o remendo faz o corpo voltar a fazer parsing?
  const r = checkBody(maskExpressions(m.body), { bash, run })
  if (r.unavailable) {
    return { fixed: false, reason: `verificação impossível (${r.detail}) — nada foi gravado` }
  }
  if (!r.ok) {
    return {
      fixed: false,
      reason:
        `o remendo NÃO faz o corpo voltar a fazer parsing (${r.kind}: ` +
        `${String(r.detail).split("\n")[0]}) — nada foi gravado`,
    }
  }

  // (3) grava e RE-MEDE no disco; desfaz se o disco não passar.
  const antes = conteudo
  linhas[idx] = alvo.replace(PENDING_OPERATOR, "").replace(/\s+$/, "")
  try {
    write(abs, linhas.join(eol), "utf8")
  } catch (err) {
    return { fixed: false, reason: `não foi possível gravar: ${err?.message ?? err}` }
  }
  const depoisDoDisco = read(abs, "utf8")
  const defaults = workflowDefaultShells(depoisDoDisco)
  const passoNovo = workflowRunSteps(depoisDoDisco, defaults).find((s) => s.line === failure.line)
  if (!passoNovo) {
    write(abs, antes, "utf8")
    return {
      fixed: false,
      reason: `o passo na linha ${failure.line} não foi reencontrado depois da gravação — gravação DESFEITA`,
    }
  }
  const r2 = checkBody(maskExpressions(passoNovo.body), { bash, run })
  if (!r2.ok) {
    write(abs, antes, "utf8")
    return {
      fixed: false,
      reason:
        `o corpo NO DISCO continua sem fazer parsing (${r2.kind ?? "?"}) — ` +
        `gravação DESFEITA (o arquivo está como estava)`,
    }
  }
  return { fixed: true, operador: m.operador, antes: m.antes, depois: m.depois }
}

/**
 * Roda `git` no root (array de args, SEM shell). O `cwd` é o root: o índice
 * julgado é o do repositório em questão, não o de quem chamou o guard.
 *
 * @param {string} root
 * @param {string[]} args
 * @returns {ReturnType<typeof spawnSync>}
 */
export function runGit(root, args) {
  return spawnSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
}

/**
 * A mensagem de uma falha do git, em UMA linha curta.
 *
 * O `git` fora de um repositório pode despejar a ajuda inteira no stderr (medido
 * nesta máquina: fora de um repo ele cai no modo `--no-index` e imprime ~60
 * linhas de uso). O que o operador precisa é a CAUSA, não o manual.
 *
 * @param {ReturnType<typeof spawnSync>} r
 * @returns {string}
 */
function gitFailureDetail(r) {
  const raw = r.error?.message ?? String(r.stderr ?? "").trim()
  if (!raw) return `exit ${r.status}`
  const linha = raw.split("\n")[0].trim()
  return linha.length > 160 ? `${linha.slice(0, 160)}…` : linha
}

/**
 * Os workflows com conteúdo no ÍNDICE, em ordem.
 *
 * `--diff-filter=ACMR` de propósito: um workflow DELETADO não tem corpo a
 * julgar — o que entra no commit é o que entra na varredura. O filtro é de
 * caminho de forja (`isForgeWorkflowPath`, a fonte única): um YAML qualquer
 * staged não é um workflow, e julgar o que não é workflow seria ruído no commit.
 *
 * LANÇA quando o git não responde (fora de repositório, git ausente, índice
 * ilegível): o caller transforma em exit 2. Um recorte que não conseguiu ler o
 * índice NÃO é "nada a julgar".
 *
 * @param {string} root
 * @returns {string[]}
 */
export function stagedWorkflowPaths(root) {
  const r = runGit(root, ["diff", "--cached", "--name-only", "--diff-filter=ACMR"])
  if (r.error || r.status !== 0) {
    throw new Error(`git diff --cached indisponível (${gitFailureDetail(r)})`)
  }
  return String(r.stdout ?? "")
    .split(/\r?\n/)
    .filter((p) => isForgeWorkflowPath(p))
    .sort()
}

/**
 * O conteúdo de um arquivo COMO ELE ESTÁ NO ÍNDICE (`git show :path`) — o que o
 * commit vai gravar, não o working tree.
 *
 * É a diferença que faz o recorte `--staged` medir o COMMIT: um corpo quebrado
 * só na árvore não é deste commit, e um corpo já corrigido na árvore mas ainda
 * quebrado no índice É (é ele que vai para o merge).
 *
 * @param {string} root
 * @param {string} path
 * @returns {string}
 */
export function readIndexFile(root, path) {
  const r = runGit(root, ["show", `:${path}`])
  if (r.error || r.status !== 0) {
    throw new Error(`git show :${path} indisponível (${gitFailureDetail(r)})`)
  }
  return String(r.stdout ?? "")
}

/**
 * TODOS os corpos `run:` das duas forjas, com o arquivo e a linha do passo.
 *
 * A leitura vem de `workflowRunSteps` (a mesma do `check-pipefail-sigpipe` e do
 * doctor): o `defaults: run:` não é passo, o item com a chave na própria linha
 * (`- run: ...`) É, e o corpo do bloco (`|`/`>`) vem de-indentado exatamente
 * como o runner o entrega ao shell.
 *
 * Com `staged`, a lista E o conteúdo vêm do ÍNDICE (ver `stagedWorkflowPaths` e
 * `readIndexFile`) — o resto da leitura é a MESMA, para o recorte não virar uma
 * segunda régua do que é um passo.
 *
 * A CLASSIFICAÇÃO do shell mora aqui (e não no `checkBody`) porque ela é sobre o
 * PASSO, não sobre o corpo: um passo cujo shell o runner não tem é uma violação
 * mesmo que o corpo seja bash válido — é a classe que o parsing não pega.
 *
 * @param {string} root
 * @param {{staged?: boolean}} [opts]
 * @returns {{files: string[], steps: object[], skipped: object[], indeterminate: object[], shellFailures: object[], unread: object[]}}
 */
export function collectRunBodies(root, { staged = false } = {}) {
  const files = []
  const steps = []
  const skipped = []
  const indeterminate = []
  const shellFailures = []
  const unread = []
  let arquivos
  try {
    arquivos = staged ? stagedWorkflowPaths(root).map((path) => ({ path })) : allWorkflowFiles(root)
  } catch (err) {
    return {
      files,
      steps,
      skipped,
      indeterminate,
      shellFailures,
      unread: [{ file: root, detail: String(err?.message ?? err) }],
    }
  }
  for (const w of arquivos) {
    files.push(w.path)
    let conteudo
    try {
      conteudo = staged ? readIndexFile(root, w.path) : readFileSync(join(root, w.path), "utf8")
    } catch (err) {
      unread.push({ file: w.path, detail: String(err?.message ?? err) })
      continue
    }
    const defaults = workflowDefaultShells(conteudo)
    for (const step of workflowRunSteps(conteudo, defaults)) {
      // Corpo vazio não roda nada: não é sintaxe a julgar — e nem shell a julgar,
      // porque o interpretador nunca chega a ser chamado.
      if (step.body.trim() === "") continue
      const alvo = {
        file: w.path,
        line: step.line,
        bodyEndLine: step.bodyEndLine,
        job: step.job,
        shell: step.shell,
        shellFonte: step.shellFonte,
      }
      if (isBashShell(step.shell)) {
        steps.push({ ...alvo, body: step.body })
        continue
      }
      // NÃO-bash: o PARSING não julga o corpo (o bash não é o interpretador
      // dele) — mas o `shell:` declarado é uma AFIRMAÇÃO SOBRE O RUNNER, e essa o
      // gate mede. Sem esta metade, um passo com `shell: pwsh` num runner sem
      // `pwsh` saía como "pulado" e morria no meio do job.
      const info = shellCommandOf(step.shell)
      const forma = info.custom ? `CUSTOM (\`${info.raw}\`)` : `\`${info.raw}\``
      const caminho = RUNNER_SHELLS[info.command]
      if (caminho) {
        skipped.push({
          ...alvo,
          detail:
            `shell ${forma} — PRESENTE no runner (medido: \`${caminho}\`), e o ` +
            `\`bash -n\` não julga o que não é bash`,
        })
        continue
      }
      // A MEDIÇÃO cobre uma lista fechada de nomes. Fora dela não há prova em
      // NENHUMA direção — e declarar "violação" ou "presente" aqui seria
      // publicar como fato do repositório o que o gate não mediu.
      if (!RUNNER_SHELLS_MISSING.includes(info.command)) {
        indeterminate.push({
          ...alvo,
          detail:
            `shell ${forma}: o nome \`${info.command}\` não está na medição da imagem — ` +
            `o gate não prova que o runner o tem NEM que não tem (re-medir com \`--shells\`)`,
        })
        continue
      }
      shellFailures.push({
        ...alvo,
        kind: "shell",
        command: info.command,
        error:
          `o runner NÃO tem \`${info.command}\` (medido AUSENTE na imagem do runner): ` +
          `o passo declara um shell que não existe no runner e morreria com ` +
          `\`command not found\` DEPOIS do setup, no meio do job. ` +
          `A imagem tem (medido): ${Object.keys(RUNNER_SHELLS).join(", ")}.`,
      })
    }
  }
  return { files, steps, skipped, indeterminate, shellFailures, unread }
}

/**
 * Roda `bash -n` num corpo (parsing SEM execução).
 *
 * O AVISO CONTA: `ok` exige exit 0 **E** stderr vazio. Não é rigor gratuito —
 * `bash -n` sai **0** para um heredoc sem terminador (aviso, não erro), e um
 * corpo truncado é um passo que roda OUTRA coisa. Sem isto, a classe que a
 * reescrita mecânica mais produz (`<<'EOF'` sem `EOF`) passaria como válida.
 *
 * FAIL-CLOSED em falha de INFRA: um `bash` que não existe (ENOENT) ou que não
 * terminou (timeout/sinal) NÃO é "sintaxe válida" — devolve `unavailable`, e o
 * `main` o transforma em exit 2. A única coisa que este guard não pode fazer é
 * dizer "0 violações" sem ter julgado nada.
 *
 * @param {string} body
 * @param {{bash?: string, run?: Function}} [deps]
 * @returns {{ok: boolean, unavailable?: boolean, status: number|null, kind: "erro"|"aviso"|null, detail: string}}
 */
export function checkBody(body, { bash = DEFAULT_BASH, run = spawnSync } = {}) {
  // `LC_ALL=C` PINADO: a mensagem do parser vai para o relatório e para os
  // testes, e "erro de sintaxe"/"syntax error" conforme o `LANG` do runner faria
  // o diagnóstico (e a asserção) depender do ambiente de quem roda.
  const r = run(bash, ["-n"], {
    input: body,
    encoding: "utf8",
    env: { ...process.env, LC_ALL: "C", LANG: "C" },
  })
  if (r?.error || r?.status === null || r?.status === undefined) {
    return {
      ok: false,
      unavailable: true,
      status: r?.status ?? null,
      kind: null,
      detail: `\`${bash}\` não pôde ser executado: ${r?.error?.message ?? "sem status (timeout/sinal)"}`,
    }
  }
  const stderr = String(r.stderr ?? "").trim()
  return {
    ok: r.status === 0 && stderr === "",
    status: r.status,
    kind: stderr === "" ? null : r.status === 0 ? "aviso" : "erro",
    detail: stderr === "" ? `exit ${r.status}` : stderr,
  }
}

/** A varredura inteira: coleta + `bash -n` em cada corpo. */
export function scan(root, { bash = DEFAULT_BASH, run = spawnSync, staged = false } = {}) {
  const { files, steps, skipped, indeterminate, shellFailures, unread } = collectRunBodies(root, {
    staged,
  })
  const failures = []
  let indisponivel = null
  for (const step of steps) {
    const r = checkBody(maskExpressions(step.body), { bash, run })
    if (r.unavailable) {
      indisponivel = r.detail
      break
    }
    if (!r.ok) failures.push({ ...step, kind: r.kind ?? "erro", error: r.detail })
  }
  return { files, steps, skipped, indeterminate, shellFailures, unread, failures, indisponivel }
}

const USAGE = `check-workflow-run-syntax — todo corpo \`run:\` dos workflows faz parsing em \`bash -n\`,
e todo \`shell:\` declarado existe no runner medido

Usage:
  node scripts/check-workflow-run-syntax.mjs              # o gate
  node scripts/check-workflow-run-syntax.mjs --staged     # só os workflows do ÍNDICE (pre-commit)
  node scripts/check-workflow-run-syntax.mjs --fix        # REMENDA a cicatriz mecânica (LOCAL)
  node scripts/check-workflow-run-syntax.mjs --shells     # o que a imagem do runner tem, e a prova
  node scripts/check-workflow-run-syntax.mjs --json       # saída estruturada
  node scripts/check-workflow-run-syntax.mjs --list       # só os corpos varridos
  node scripts/check-workflow-run-syntax.mjs --root X     # fixture (testes)
  node scripts/check-workflow-run-syntax.mjs --bash CMD   # outro interpretador

Exit codes:
  0 — todo corpo passa SEM erro e SEM aviso; os passos não-bash saem NOMEADOS e
      os de shell fora da medição saem como INDETERMINADO
  1 — violação: um corpo não faz parsing (erro) ou o parser avisou (ex.: heredoc
      sem terminador, que o bash reporta como AVISO e sai 0), OU um passo declara
      um \`shell:\` que o runner NÃO tem (\`command not found\` no meio do job)
  2 — infra: bash não executou, --root inexistente, --staged fora de um repo
      git (sem índice não há recorte), ou workflow ilegível
  3 — uso inválido (\`--fix\` com \`--staged\`/\`--json\`, flag desconhecida,
      \`--root\`/\`--bash\` sem valor)
`

export function printShells(log = console.log, env = process.env) {
  const ref = runnerImageRef(env)
  log(
    ref
      ? `runner medido: ${ref}`
      : `runner medido: INDETERMINADO — defina BUN_VERSION (IMAGE_REGISTRY/IMAGE_NAMESPACE\n` +
          `               completam a ref). A tag é a fonte única: sem ela o gate não sabe QUAL\n` +
          `               imagem foi medida, e presumi-la publicaria um fato que ninguém mediu.`,
  )
  log(`digest:        ${RUNNER_IMAGE.digest}`)
  log(`medido em:     ${RUNNER_IMAGE.measuredAt}`)
  log(`\nTEM (${Object.keys(RUNNER_SHELLS).length}):`)
  for (const [nome, caminho] of Object.entries(RUNNER_SHELLS))
    log(`  ${nome.padEnd(12)} ${caminho}`)
  log(`\nNÃO TEM (${RUNNER_SHELLS_MISSING.length}):`)
  log(`  ${RUNNER_SHELLS_MISSING.join(", ")}`)
  log(`\nComo isto foi medido (o mesmo comando re-mede):\n  ${RUNNER_IMAGE.command}`)
  log(
    `\nO gate REPROVA um passo que declara shell AUSENTE e PULA (com nome) um que existe.\n` +
      `A forma CUSTOM (\`perl {0}\`) é julgada pelo NOME que invoca: \`perl {0}\` passa,\n` +
      `\`pwsh {0}\` é violação. Fora da medição, o desfecho é INDETERMINADO — nunca presumido.`,
  )
}

/**
 * O `--fix` sobre a ÁRVORE inteira: roda o gate, remenda o que tem cicatriz, e
 * relata o que NÃO remendou com o motivo.
 *
 * `fixed` e `refused` são disjuntos e cobrem TODA falha de parsing: um fixer que
 * não remenda em silêncio seria o pior dos dois mundos.
 *
 * @param {string} root
 * @param {{bash?: string, run?: Function, write?: Function, read?: Function}} [deps]
 */
export function fixAll(root, { bash = DEFAULT_BASH, run = spawnSync, write, read } = {}) {
  const resultado = scan(root, { bash, run })
  const fixed = []
  const refused = []
  for (const f of resultado.failures) {
    const r = fixWorkflow(root, f, { bash, run, write, read })
    if (r.fixed) fixed.push({ ...f, ...r })
    else refused.push({ ...f, ...r })
  }
  return { ...resultado, fixed, refused }
}

function main() {
  const argv = process.argv.slice(2)
  const conhecidas = [
    "--json",
    "--list",
    "--root",
    "--bash",
    "--staged",
    "--fix",
    "--shells",
    "-h",
    "--help",
  ]
  const desconhecida = argv.find((a) => a.startsWith("--") && !conhecidas.includes(a))
  if (desconhecida) {
    console.error(`❌ flag desconhecida: ${desconhecida}`)
    console.error(USAGE)
    process.exit(EXIT.USAGE)
  }
  if (argv.includes("-h") || argv.includes("--help")) {
    console.log(USAGE)
    process.exit(EXIT.OK)
  }
  // A MEDIÇÃO em si: não depende de root nem de índice — é o que o repositório
  // declara sobre a imagem, para re-medir quando a base mudar.
  if (argv.includes("--shells")) {
    printShells()
    process.exit(EXIT.OK)
  }
  const valor = (flag) => {
    const i = argv.indexOf(flag)
    if (i === -1) return null
    const v = argv[i + 1]
    if (v === undefined || v.startsWith("--")) {
      console.error(`❌ ${flag} exige um valor`)
      console.error(USAGE)
      process.exit(EXIT.USAGE)
    }
    return v
  }
  const rootArg = valor("--root")
  const root = rootArg === null ? process.cwd() : resolve(rootArg)
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    console.error(`❌ --root inexistente: ${root}`)
    process.exit(EXIT.UNAVAILABLE)
  }
  const bash = valor("--bash") ?? DEFAULT_BASH
  // Recorte do pre-commit: julga os workflows do ÍNDICE (o commit), com o
  // conteúdo do índice. Vem declarado em HOOK_DECLARED do check-hook-ci-parity.
  const staged = argv.includes("--staged")
  const json = argv.includes("--json")
  const fix = argv.includes("--fix")
  // Combinações que o comando NÃO promete: `--fix` escreve na ÁRVORE e relata
  // em texto (antes/depois), e `--staged` julga o ÍNDICE — remendar o índice
  // mexeria no commit que o operador já montou.
  for (const [outra, motivo] of [
    ["--staged", "`--fix` remenda a ÁRVORE; `--staged` julga o ÍNDICE (o commit já montado)"],
    ["--json", "`--fix` relata em texto (antes/depois do remendo), não em JSON"],
  ]) {
    if (fix && argv.includes(outra)) {
      console.error(`❌ ${outra} com --fix: ${motivo}`)
      console.error(USAGE)
      process.exit(EXIT.USAGE)
    }
  }

  if (fix) {
    const r = fixAll(root, { bash })
    if (r.indisponivel) {
      console.error(
        `❌ ${r.indisponivel}\n   Sem interpretador não há parsing: nenhum corpo foi julgado.`,
      )
      process.exit(EXIT.UNAVAILABLE)
    }
    if (r.unread.length > 0) {
      console.error(
        `❌ workflow(s) ILEGÍVEL(is) — não ler um corpo não é o mesmo que ele ser válido:`,
      )
      for (const u of r.unread) console.error(`     ${u.file}: ${u.detail}`)
      process.exit(EXIT.UNAVAILABLE)
    }
    for (const f of r.fixed) {
      console.log(
        `✔ ${f.file}:${f.line} — remendo aplicado: operador pendente \`${f.operador}\` removido`,
      )
      console.log(`     antes:  ${f.antes}`)
      console.log(`     depois: ${f.depois}`)
    }
    for (const f of r.shellFailures) {
      console.error(`✖ ${f.file}:${f.line} — ${f.error}`)
    }
    for (const f of r.refused) {
      console.error(`⛔ ${f.file}:${f.line} — NÃO remendado: ${f.reason}`)
      console.error(`     ${String(f.body).split("\n").pop()?.slice(0, 120) ?? ""}`)
    }
    if (r.fixed.length > 0) {
      console.log(
        `\n   O remendo tira a CICATRIZ que impedia o parsing — ele NÃO reconstrói a linha engolida:\n` +
          `   o diff é o que se revisa. O corpo voltou a fazer \`bash -n\` em memória E no disco.`,
      )
    }
    if (r.refused.length === 0 && r.shellFailures.length === 0) {
      console.log(
        r.fixed.length === 0
          ? `✅ nenhum corpo reprovado — não há cicatriz para remendar.`
          : `✅ ${r.fixed.length} corpo(s) remendado(s) — rode o gate de novo para o veredito da árvore.`,
      )
      process.exit(EXIT.OK)
    }
    process.exit(EXIT.VIOLATIONS)
  }

  const { files, steps, skipped, indeterminate, shellFailures, unread, failures, indisponivel } =
    scan(root, { bash, staged })

  if (argv.includes("--list")) {
    for (const s of steps) console.log(`${s.file}:${s.line}`)
    process.exit(EXIT.OK)
  }

  if (json) {
    console.log(
      JSON.stringify(
        {
          root,
          bash,
          staged,
          arquivos: files,
          passos: steps.length,
          skipped,
          indeterminate,
          shellFailures,
          unread,
          failures: failures.map((f) => ({
            file: f.file,
            line: f.line,
            job: f.job,
            kind: f.kind,
            error: f.error,
          })),
          indisponivel,
        },
        null,
        2,
      ),
    )
    const falhou =
      failures.length > 0 || shellFailures.length > 0 || unread.length > 0 || indisponivel !== null
    process.exit(falhou ? EXIT.VIOLATIONS : EXIT.OK)
  }

  // INFRA primeiro: sem `bash` executável, "0 violações" seria uma afirmação
  // sobre nada — e é justamente o veredito que este guard não pode cunhar.
  if (indisponivel) {
    console.error(
      `❌ ${indisponivel}\n   Sem interpretador não há parsing: nenhum corpo foi julgado.`,
    )
    process.exit(EXIT.UNAVAILABLE)
  }
  if (unread.length > 0) {
    console.error(
      staged
        ? `❌ o recorte --staged não conseguiu ler o ÍNDICE (git diff --cached / git show) — sem o índice\n` +
            `   não há commit a julgar, e "0 violações" seria uma afirmação sobre nada:\n`
        : `❌ workflow(s) ILEGÍVEL(is) — não ler um corpo não é o mesmo que ele ser válido:\n`,
    )
    for (const u of unread) console.error(`     ${u.file}: ${u.detail}`)
    process.exit(EXIT.UNAVAILABLE)
  }

  if (failures.length > 0) {
    const graves = failures.filter((f) => f.kind === "erro").length
    console.error(
      `❌ ${failures.length} corpo(s) \`run:\` NÃO passam em \`bash -n\` — ${graves} com ERRO de sintaxe,\n` +
        `   ${failures.length - graves} com AVISO (o bash sai 0; o corpo truncado roda outra coisa):\n`,
    )
    if (staged) {
      console.error(
        `   (recorte --staged: ${files.length} workflow(s) do ÍNDICE, lidos do commit)\n`,
      )
    }
    for (const f of failures) {
      const onde = f.job ? ` (job \`${f.job}\`)` : ""
      console.error(`   ${f.kind === "aviso" ? "⚠" : "✖"} ${f.file}:${f.line}${onde}`)
      console.error(`     ${f.error.split("\n").join("\n     ")}`)
      console.error(`     ${f.body.split("\n")[0].slice(0, 120)}`)
    }
    console.error(
      `\n   O parsing é do TEXTO que o shell recebe (a expressão \`\${{ ... }}\` é mascarada: o runner a\n` +
        `   resolve antes de o bash existir). Corrija a reescrita — a causa costuma estar a poucas\n` +
        `   linhas de onde o bash apontou, e vale conferir o passo INTEIRO, não só a linha.\n`,
    )
    process.exit(EXIT.VIOLATIONS)
  }

  // A classe que NENHUM parser pega: o corpo é válido, mas o interpretador que o
  // passo pede não existe no runner. Sem esta metade, o passo saía como
  // "pulado" e morria com `command not found` DEPOIS do setup, no meio do job.
  if (shellFailures.length > 0) {
    console.error(
      `❌ ${shellFailures.length} passo(s) declaram um \`shell:\` que o runner NÃO tem — esta classe\n` +
        `   não aparece no parsing: \`bash -n\` julga o CORPO, não a existência do interpretador, e o\n` +
        `   passo morreria com \`command not found\` depois do setup:\n`,
    )
    for (const f of shellFailures) {
      const onde = f.job ? ` (job \`${f.job}\`)` : ""
      console.error(`   ✖ ${f.file}:${f.line}${onde}`)
      console.error(`     ${f.error}`)
    }
    console.error(
      `\n   A imagem do runner é a MEDIÇÃO em RUNNER_IMAGE (\`--shells\` imprime a ref, o digest e o\n` +
        `   comando que mediu). Se a base mudou, o caminho é RE-MEDIR — não ajustar o conjunto no olho.\n`,
    )
    process.exit(EXIT.VIOLATIONS)
  }

  if (skipped.length > 0) {
    console.log(
      `⏭ ${skipped.length} passo(s) com shell NÃO-bash PRESENTE no runner — pulado(s) (o \`bash -n\` não julga o que não é bash):`,
    )
    for (const s of skipped) console.log(`     ${s.file}:${s.line}  ${s.detail}`)
  }
  if (indeterminate.length > 0) {
    console.log(
      `◐ ${indeterminate.length} passo(s) com shell FORA DA MEDIÇÃO — INDETERMINADO (o gate não prova nem que o runner o tem, nem que não tem):`,
    )
    for (const s of indeterminate) console.log(`     ${s.file}:${s.line}  ${s.detail}`)
  }
  if (staged) {
    if (files.length === 0) {
      console.log(
        "   (nenhum workflow no ÍNDICE — nada a julgar neste commit; este recorte NÃO é a varredura do repo)",
      )
    }
    console.log(
      `✅ ${steps.length} corpo(s) \`run:\` DO ÍNDICE (${files.length} workflow(s) do commit) passam em \`${bash} -n\`: ` +
        `sem erro E sem aviso. O recorte é o COMMIT; a varredura inteira (todas as forjas) é o veredito do CI.`,
    )
    process.exit(EXIT.OK)
  }
  console.log(
    `✅ ${steps.length} corpo(s) \`run:\` passam em \`${bash} -n\` (as duas forjas, sem allowlist): ` +
      `sem erro E sem aviso — e todo \`shell:\` declarado existe no runner medido. ` +
      `O gate prova que o passo faz PARSING e que o interpretador existe; NÃO prova que o corpo faz o que diz.`,
  )
  process.exit(EXIT.OK)
}

// True apenas quando executado diretamente — permite importar as funções puras
// nos testes unitários sem disparar a varredura.
const IS_DIRECT_RUN =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (IS_DIRECT_RUN) main()
