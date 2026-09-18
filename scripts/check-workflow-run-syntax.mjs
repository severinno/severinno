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
//      482 corpos das duas forjas) continua sendo o veredito do CI. Sem
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
//      se revisa. O MESMO fixer atende o pre-commit pelo
//      `pre-commit-remedy.mjs`, que o usa em modo PREVIEW (`fixAll`
//      com `dry`: nada é gravado) antes de perguntar e só então grava — o
//      preview decide pelo MESMO caminho, senão prometeria um remendo que a
//      gravação recusaria.
//
//  12. `--fix --dry-run` é esse MESMO preview na CLI, e o que ele imprime é o
//      PATCH exato do remendo — não um resumo: as linhas `--- a/…`, `+++ b/…` e
//      o hunk de uma linha (`-`antes/`+`depois) saem dos MESMOS bytes que a
//      gravação escreveria (as duas pontas vêm do `fixWorkflow`, não de uma
//      segunda conta — o `remedyPatch` aplica `patchOf` no que o `dry` provou).
//      O patch vai para STDOUT LIMPO (`… --fix --dry-run | git apply` aplica o
//      remendo sem arquivo intermediário) e o relatório inteiro para STDERR: em
//      `--dry-run` o STDOUT é só o patch, e um "✅" no meio dele quebraria o
//      `|`. Nada é gravado — quem grava é o `--fix`.
//
//      POR QUE O PATCH, E NÃO UM "Apply suggestion": o GitHub e o Gitea só
//      oferecem o botão em comentário de REVISÃO ancorado na linha do diff, e
//      uma âncora errada aplicaria uma edição ERRADA com um clique — o pior modo
//      de falha deste caminho, e ele seria silencioso. O patch se aplica
//      IDENTICAMENTE nas duas forjas e é byte a byte o que o `--fix` faria.
//      Quem publica o patch no PR é o `pr-remedy-comment.mjs` (o mesmo módulo,
//      nunca o texto do relatório): lá está o contrato do comentário.
//
//  10. o MESMO parser julga a SEGUNDA fonte de shell do repositório: os SCRIPTS
//      VERSIONADOS (`*.sh`, `*.bash` e os hooks sem extensão do `.husky/`), pela
//      MESMA lista que o `check:pipefail-sigpipe` usa (`listShellScripts`) — o
//      que é "script do repositório" tem UMA definição, não duas. O motivo é o
//      mesmo dos corpos: o corpo de um passo morre no runner; um script morre no
//      PASSO que o executa (`bash scripts/x.sh`), depois do setup e longe da
//      causa. Três diferenças DELIBERADAS em relação aos corpos:
//      (a) o ARQUIVO INTEIRO é o corpo, então NÃO há mascaramento de `${{ ... }}`:
//      num script não existe runner para resolvê-la ANTES do bash — o texto vai
//      ao interpretador como está, e a máscara julgaria um texto que não existe
//      no arquivo (os `${{ }}` que há em `.sh` hoje estão em comentário e dentro
//      de quote simples, onde são DADO; medido: os 124 passam sem máscara); (b) o
//      interpretador é o que o SHEBANG declara, não um `shell:` de YAML — shebang
//      bash/sh é julgado (o mesmo `isBashShell`), shebang de outra linguagem é
//      PULADO com o motivo dito, e arquivo SEM shebang usa a premissa de quem o
//      executa (`sh`, como o husky roda os hooks); (c) arquivo VAZIO não é
//      sintaxe a julgar (nada executa) e sai nomeado, como o corpo vazio.
//
//  11. a TERCEIRA fonte é o shell EMBUTIDO — o texto que não é corpo de passo nem
//      arquivo, e que por isso NENHUM parser do repositório julgava: a instrução
//      `RUN` de um Dockerfile (o shell do BUILD, entregue a `/bin/sh -c`) e o
//      payload LITERAL de um `sh -c`/`bash -c` (que, para o `bash -n` do arquivo
//      que o contém, é uma STRING — um `sh -c "if [ x ]; then"` truncado passava
//      por todos os gates). As premissas mudam por FONTE, e é essa diferença que
//      mantém o veredito honesto: o texto de um `RUN` é a instrução JUNTADA (a
//      continuação `\` faz parte, o comentário dela é descartado como o docker
//      faz, e as flags `--mount=` não chegam ao shell); um payload vindo de
//      workflow é MASCARADO (`${{ ... }}`), um vindo de compose tem o `$$`
//      DESESCAPADO (a interpolação resolve antes do shell — medido: sem isso o
//      gate acusava `RESPONSE=$$(curl ...)` em `docker-compose.prod.yml`), e num
//      script/Dockerfile o texto vai CRU. Um compose é lido por ESTRUTURA (o
//      `js-yaml`, pela mesma porta dos workflows): varrer o TEXTO leria a sintaxe
//      do YAML como programa — um `entrypoint:` em lista entregava a marca de
//      lista (`-`) e um flow não entregava nada. Um payload que só existe em
//      runtime (`bash -c "$cmd"`) sai INDETERMINADO, e o que não é shell (a forma
//      EXEC sem shell, o `-c` de um `python3`) sai PULADO e NOMEADO. A lista de
//      Dockerfiles vem da ÁRVORE (qualquer `Dockerfile*`), não de uma lista à mão:
//      um Dockerfile novo num diretório novo entra na varredura sem editar nada.
//
// SEM ALLOWLIST: o repositório inteiro passa em `bash -n` hoje — 482 corpos das
// duas forjas, os 124 scripts de shell que o `listShellScripts` enumera (121
// `*.sh` + os 3 hooks do `.husky/`) e 33 textos de shell EMBUTIDO (14 instruções
// `RUN` de Dockerfile + 19 payloads de `sh -c`, com 2 INDETERMINADOS nomeados:
// os dois `bash -c "$cmd"` dos scripts de banco, cujo texto é montado em
// execução), todos sem ERRO e sem AVISO. Um gate que nasce absoluto não tem cota
// para envelhecer — e uma cota aqui significaria declarar que um corpo quebrado
// pode ficar quebrado.
//
// Usage:
//   node scripts/check-workflow-run-syntax.mjs              # o gate
//   node scripts/check-workflow-run-syntax.mjs --staged     # só o que o ÍNDICE tem (workflows + scripts + Dockerfiles/composes)
//   node scripts/check-workflow-run-syntax.mjs --fix        # REMENDA a cicatriz mecânica (LOCAL)
//   node scripts/check-workflow-run-syntax.mjs --fix --dry-run  # o PATCH exato do remendo (NADA é gravado)
//   node scripts/check-workflow-run-syntax.mjs --shells     # o que a imagem do runner tem, e a prova
//   node scripts/check-workflow-run-syntax.mjs --json       # saída estruturada
//   node scripts/check-workflow-run-syntax.mjs --list       # só o que foi varrido (corpos, arquivos e shell embutido)
//   node scripts/check-workflow-run-syntax.mjs --root X     # fixture (testes)
//   node scripts/check-workflow-run-syntax.mjs --bash /bin/bash  # outro interpretador
//
// Exit codes:
//   0 — todo corpo `run:`, todo script de shell E todo texto de shell EMBUTIDO
//       (a instrução `RUN` de um Dockerfile e o payload de um `sh -c`) passam em
//       `bash -n` sem erro E sem aviso (os passos não-bash, os scripts de shebang
//       não-bash, o shell embutido fora do escopo e os payloads que só existem em
//       runtime são contados e nomeados) e todo `shell:` declarado existe no
//       runner medido
//   1 — violação: o corpo de um passo, um arquivo de shell OU um texto de shell
//       embutido não faz parsing, OU o parser emitiu aviso (com a mensagem do
//       bash, o arquivo e a linha do passo), OU o passo declara um `shell:` que o
//       runner não tem
//   2 — infra: `bash` não pôde ser executado, `--root` inexistente, `--staged`
//       sem índice git (fora de um repositório), ou um arquivo não pôde ser
//       lido (fail-closed: sem medição não há veredito — nunca "0 violações" por
//       não ter conseguido rodar)
//   3 — uso inválido (flag desconhecida, `--root`/`--bash` sem valor, `--fix`
//       combinado com `--staged` ou `--json`, `--dry-run` sem `--fix` —
//       combinações que o comando não promete)
// =============================================================================

import { spawnSync } from "node:child_process"
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { basename, join, resolve } from "node:path"
import process from "node:process"
import { pathToFileURL } from "node:url"

// A régua do que é um COMPOSE do repositório vem do guard que já a define
// (`check-bun-mirror`, invariante 16): uma segunda expressão aqui divergiria
// na primeira vez que um `docker-compose.*.yml` novo aparecesse.
import { COMPOSE_FILE_RE } from "./check-bun-mirror.mjs"
import { linhasDe, patchPorArquivo } from "./unified-patch.mjs"
import {
  SKIP_DIRS,
  heredocDelimiters,
  isShellScript,
  listShellScripts,
  workflowDefaultShells,
  workflowRunSteps,
} from "./check-pipefail-sigpipe.mjs"
// A DECLARAÇÃO dos shells do runner e a REF que a identifica vêm do módulo dono
// da MEDIÇÃO (`runner-shells.mjs`), que também gera o comando declarado a partir
// do MESMO probe que o cron executa. Uma cópia aqui divergiria no dia em que
// alguém ajustasse uma — e aí o `--shells` imprimiria um comando que ninguém
// roda e a issue do drift julgaria um conjunto que este gate não usa.
import {
  RUNNER_IMAGE,
  RUNNER_SHELLS,
  RUNNER_SHELLS_MISSING,
  runnerImageRef,
} from "./runner-shells.mjs"
import {
  DYNAMIC_EXPR_RE,
  allWorkflowFiles,
  isForgeWorkflowPath,
  parseYamlDocument,
  readJudgedFile,
  workflowYamlValidity,
} from "./forge-workflows.mjs"

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
/**
 * O ESCAPE do compose (`$$`) vira um `$` — a interpolação do compose resolve
 * ANTES do shell.
 *
 * É a máscara do MESMO tipo que a do `${{ ... }}` (um texto que o shell nunca
 * vê), e ela foi MEDIDA: sem esta meia-linha, o gate acusou
 * `RESPONSE=$$(curl -s ...)` em `docker-compose.prod.yml` como erro de sintaxe —
 * porque para o bash `$$` é o PID e `$$(` abre um parêntese solto. Para o shell
 * do container o que chega é `$(curl -s ...)`, que é a substituição de comando
 * que o autor escreveu: o defeito era do gate, não do compose.
 *
 * @param {string} text
 * @returns {string}
 */
export function maskComposeEscapes(text) {
  return String(text ?? "").replace(/\$\$/g, "$")
}

export function maskExpressions(text) {
  // O PADRAO da expressao dinamica vem da fonte unica (`DYNAMIC_EXPR_RE`). O
  // que muda aqui e a INTENCAO: remover (`executableLine`) deixa a linha como o
  // shell a veria; MASCARAR com um placeholder preserva a linha para o `bash -n`
  // (um `${{ }}` cru no meio de um comando viraria erro de sintaxe do bash, e o
  // gate acusaria o autor por uma expressao do runner).
  return String(text ?? "").replace(DYNAMIC_EXPR_RE, "EXPRESSAO")
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
 * A IMAGEM DO RUNNER — a MEDIÇÃO (digest, data e o comando que a produziu).
 *
 * O conjunto de shells é uma MEDIÇÃO, não uma presunção: a alternativa
 * (presumir do documentado, ou perguntar ao `command -v` de quem roda o guard)
 * publicaria como fato do repositório uma propriedade da MÁQUINA — a mesma
 * classe de erro que já custou caro aqui (um tamanho de heap lido do host virou
 * "o runner estoura a memória"). A ref e o digest ficam escritos para o dia em
 * que a base mudar: aí o caminho é RE-MEDIR, e agora quem re-mede é um CRON
 * (`runner-shells.mjs`, que também gera o `command` abaixo — não há cópia dele
 * aqui), com issue acionável quando a medição diverge desta declaração.
 *
 * RE-EXPORTADO do dono da medição: os testes e o `--shells` continuam lendo
 * daqui, mas a fonte é uma só.
 */
export { RUNNER_IMAGE, RUNNER_SHELLS, RUNNER_SHELLS_MISSING, runnerImageRef }

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
 * `dry` é o PREVIEW: devolve `fixed: true, applied: false` sem tocar no arquivo.
 * Ele prova tudo o que (1) e (2) provam em memória — é o que um chamador que
 * precisa da CONFIRMAÇÃO do operador antes de gravar (o remédio do pre-commit)
 * mostra. Julgar o preview por outra régua prometeria um remendo que a gravação
 * recusaria; por isso o caminho de decisão é este, o mesmo.
 *
 * @param {string} root
 * @param {{file: string, line: number, bodyEndLine: number, body: string}} failure
 * @param {{bash?: string, run?: Function, write?: Function, read?: Function, dry?: boolean}} [deps]
 * @returns {{fixed: boolean, applied?: boolean, reason?: string, operador?: string, antes?: string, depois?: string, linhaArquivo?: number, linhaAntes?: string, linhaDepois?: string}}
 */
export function fixWorkflow(
  root,
  failure,
  {
    bash = DEFAULT_BASH,
    run = spawnSync,
    write = writeFileSync,
    read = readFileSync,
    dry = false,
  } = {},
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

  // A LINHA DO ARQUIVO, antes e depois — a conta que a gravação faz, feita UMA
  // vez. É dela que sai o patch do `--dry-run` (uma régua, dois consumidores):
  // `m.antes`/`m.depois` são as linhas do CORPO, e a indentação do arquivo pode
  // diferir da do bloco — um diff construído com a linha do corpo não acharia o
  // texto no arquivo e o `git apply` recusaria o patch que o preview mostrou.
  const linhaAntes = alvo
  const linhaDepois = linhaAntes.replace(PENDING_OPERATOR, "").replace(/\s+$/, "")

  // (2b) PREVIEW: sem gravar, o remendo está provado até onde se pode provar em
  // memória (o alvo existe, é bloco literal, a linha é a do corpo, o corpo
  // remendado faz parsing). O que falta — a releitura do disco — é exatamente o
  // que só a gravação pode medir, e é por isso que ela não é pulada depois.
  if (dry) {
    return {
      fixed: true,
      applied: false,
      operador: m.operador,
      antes: m.antes,
      depois: m.depois,
      linhaArquivo: idx + 1,
      linhaAntes,
      linhaDepois,
    }
  }

  // (3) grava e RE-MEDE no disco; desfaz se o disco não passar.
  const antes = conteudo
  linhas[idx] = linhaDepois
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
  return {
    fixed: true,
    applied: true,
    operador: m.operador,
    antes: m.antes,
    depois: m.depois,
    linhaArquivo: idx + 1,
    linhaAntes,
    linhaDepois,
  }
}

/**
 * O patch de UM remendo — diff unificado de uma linha, o formato que o
 * `git apply` consome.
 *
 * `linhaAntes`/`linhaDepois` vêm do `fixWorkflow` (os MESMOS bytes que a
 * gravação escreveria) e a indentação é a do ARQUIVO, que é o que faz o patch
 * ACHAR o texto: um diff montado com a linha do corpo (sem a indentação do
 * YAML) não aplicaria.
 *
 * @param {{file: string, linhaArquivo: number, linhaAntes: string, linhaDepois: string}} f
 * @returns {string}
 */
export function patchOf(f) {
  return (
    `--- a/${f.file}\n` +
    `+++ b/${f.file}\n` +
    `@@ -${f.linhaArquivo},1 +${f.linhaArquivo},1 @@\n` +
    `-${f.linhaAntes}\n` +
    `+${f.linhaDepois}\n`
  )
}

/**
 * O patch das cicatrizes com CONTEXTO — a construção do `unified-patch.mjs`, a
 * MESMA do outro fixer mecânico (`check-pipefail-sigpipe`).
 *
 * O `patchOf` acima (hunk sem contexto) foi a primeira forma, e ela só aplica
 * quando a cicatriz cai no FIM do arquivo: o `git apply` recusa hunk sem
 * contexto, e a única exceção é o hunk ancorado no fim do arquivo (medido nesta
 * máquina, git 2.43: `@@ -1,1 +1,1 @@` e `@@ -3,1 +3,1 @@` num arquivo de 5
 * linhas falham com "patch does not apply"; o mesmo patch na linha 5 aplica).
 * Um passo quebrado no MEIO do workflow — o caso comum, com passos depois dele —
 * gerava um patch que o operador colava no terminal e o `git apply` recusava:
 * o remendo publicado no PR não era um remendo.
 *
 * @param {object[]} fixed  as entradas de `fixAll` (`linhaArquivo`/`linhaAntes`/`linhaDepois`)
 * @param {{root?: string, read?: Function}} [opts]
 * @returns {string}
 */
export function workflowPatch(fixed, { root = process.cwd(), read = readFileSync } = {}) {
  const { patch } = patchPorArquivo(
    fixed.map((f) => ({
      file: f.file,
      line: f.linhaArquivo,
      linhasAntes: [f.linhaAntes],
      linhaDepois: f.linhaDepois,
    })),
    { ler: (file) => linhasDe(read(join(root, file), "utf8")) },
  )
  return patch
}

/**
 * O PATCH do remendo — o que o `--fix` GRAVARIA, como diff que o `git apply`
 * aceita, sem gravar nada.
 *
 * TRÊS DECISÕES, e o motivo de cada uma:
 *
 *   1. ele sai do MESMO `fixWorkflow` que a gravação usa (`fixAll` com `dry`,
 *      o mesmo caminho de decisão do remédio do pre-commit) — um preview que
 *      julgasse por outra régua prometeria um remendo que a gravação recusaria;
 *   2. ele é um PATCH e não um "Apply suggestion": o botão das duas forjas só
 *      existe em comentário de REVISÃO ancorado na linha do diff, e uma âncora
 *      errada aplicaria uma edição errada com um clique — silenciosamente. O
 *      patch se aplica IDENTICAMENTE nas duas forjas;
 *   3. as RECUSAS vão junto (`refused`, `shellFailures`, `embeddedFailures`,
 *      `payloadFailures`): o patch cobre o que o fixer remenda, e publicar só
 *      ele esconderia o que não foi remendado nem por quê.
 *
 * @param {string} root
 * @param {{bash?: string, run?: Function, read?: Function}} [deps]
 * @returns {{patch: string, fixed: object[], refused: object[], shellFailures: object[], embeddedFailures: object[], payloadFailures: object[], unread: object[], yamlInvalido: object[], indisponivel?: string|null}} o resultado do `fixAll` em modo preview, com `patch` a mais
 */
export function remedyPatch(root, { bash = DEFAULT_BASH, run = spawnSync, read } = {}) {
  const r = fixAll(root, { bash, run, read, dry: true })
  return { ...r, patch: workflowPatch(r.fixed, { root, read }) }
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
 * Os caminhos com conteúdo no ÍNDICE, em ordem — a lista crua do `--staged`.
 *
 * `--diff-filter=ACMR` de propósito: um arquivo DELETADO não tem corpo a julgar
 * — o que entra no commit é o que entra na varredura. Os DOIS filtros de escopo
 * (workflow de forja e script de shell) são aplicados sobre esta lista, para o
 * recorte não virar uma segunda régua do que é um arquivo.
 *
 * LANÇA quando o git não responde (fora de repositório, git ausente, índice
 * ilegível): o caller transforma em exit 2. Um recorte que não conseguiu ler o
 * índice NÃO é "nada a julgar".
 *
 * @param {string} root
 * @returns {string[]}
 */
export function stagedPaths(root) {
  const r = runGit(root, ["diff", "--cached", "--name-only", "--diff-filter=ACMR"])
  if (r.error || r.status !== 0) {
    throw new Error(`git diff --cached indisponível (${gitFailureDetail(r)})`)
  }
  return String(r.stdout ?? "")
    .split(/\r?\n/)
    .filter((p) => p !== "")
    .sort()
}

/**
 * Os WORKFLOWS no ÍNDICE. O filtro é de caminho de forja (`isForgeWorkflowPath`,
 * a fonte única): um YAML qualquer staged não é um workflow, e julgar o que não
 * é workflow seria ruído no commit.
 *
 * @param {string} root
 * @returns {string[]}
 */
export function stagedWorkflowPaths(root) {
  return stagedPaths(root).filter((p) => isForgeWorkflowPath(p))
}

/**
 * Os SCRIPTS DE SHELL no ÍNDICE. O filtro é o `isShellScript` da varredura
 * inteira (`*.sh`/`*.bash` + os hooks do `.husky/`): o recorte do pre-commit vê
 * exatamente a mesma definição de "script do repositório" que o CI.
 *
 * @param {string} root
 * @returns {string[]}
 */
export function stagedShellScriptPaths(root) {
  return stagedPaths(root).filter((p) => isShellScript(p))
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
 * O INTERPRETADOR que o SHEBANG declara — a fonte única do "é bash?" de um
 * arquivo (o análogo do `shell:` de um passo, que não existe num arquivo).
 *
 * A forma do repositório é `#!/usr/bin/env <prog>` ou `#!<caminho>/<prog>`; o
 * `env` é desembrulhado porque quem o kernel executa depois dele é o PROGRAMA, e
 * é ele que decide se o `bash -n` julga o arquivo. O `command` é o basename
 * (mesma identidade que o `shellCommandOf` usa).
 *
 * LIMITE DECLARADO: opções do `env` que consomem valor (`-u FOO`, `-i`) não são
 * interpretadas — não há nenhuma no repositório, e adivinhar ali seria pior que
 * dizer o limite. Sem shebang, `command` é `null` e o arquivo cai na PREMISSA do
 * `isBashShell` (como o passo sem `shell:` cai na premissa do runner).
 *
 * @param {string} content
 * @returns {{raw: string|null, command: string|null, declared: boolean}}
 */
export function interpreterOf(content) {
  const primeira = String(content ?? "").split(/\r?\n/, 1)[0] ?? ""
  const m = primeira.match(/^#!\s*(\S+)(?:\s+(.*))?$/)
  if (!m) return { raw: null, command: null, declared: false }
  let prog = m[1]
  const resto = (m[2] ?? "").trim()
  if (/(^|\/)env$/.test(prog)) {
    prog = resto.split(/\s+/).filter((p) => p !== "" && !p.startsWith("-"))[0] ?? ""
  }
  const command = prog === "" ? null : (prog.split("/").pop() ?? prog)
  return { raw: primeira.trim(), command, declared: true }
}

// =============================================================================
// A TERCEIRA FONTE: o shell EMBUTIDO
// =============================================================================
//
// As duas primeiras fontes julgam o texto INTEIRO de alguma coisa: um corpo
// `run:` e um arquivo de script. Esta julga o texto que não é nenhum dos dois —
// o shell que vive DENTRO de outro artefato e só existe quando ele roda:
//
//   · a instrução `RUN` de um Dockerfile (o shell do BUILD, entregue a
//     `/bin/sh -c`: um `&& \` engolido por uma reescrita só aparece no meio de
//     um build de minutos, e nenhum guard que LÊ o Dockerfile vê isso — o
//     Dockerfile continua sendo um Dockerfile válido);
//   · o payload LITERAL de um `sh -c`/`bash -c` — num script, num corpo `run:`
//     ou num `entrypoint:` de compose. Para o parser do arquivo que o contém,
//     esse payload é uma STRING: o `bash -n` não desce nele, e um
//     `sh -c "if [ x ]; then"` truncado passa por TODOS os gates do repositório.
//
// Três desfechos, e nenhum é silencioso: o payload LITERAL é julgado; o payload
// que só existe em RUNTIME (`bash -c "$cmd"`, cujo texto é montado em execução)
// sai INDETERMINADO com o motivo; e o que não é shell (a forma EXEC de um `RUN`
// sem shell, um `python3 -c`) sai PULADO e NOMEADO.

export const SHELL_INTERPRETERS = ["sh", "bash", "dash", "zsh", "ksh", "ash"]

/**
 * O payload de `-c` que NÃO é literal no texto: um `$VAR`, `${VAR}` ou `$(...)`
 * que ocupa o argumento inteiro. O texto dele só existe em runtime — julgá-lo
 * aqui seria julgar o vazio, e chamá-lo de "válido" seria a mentira do gate que
 * conta o que não olhou.
 */
export const RUNTIME_PAYLOAD_RE = /^\$(?:[A-Za-z_][A-Za-z0-9_]*|\{[^}]*\}|\([\s\S]*\))$/

/** É um Dockerfile — em QUALQUER diretório? */
export const DOCKERFILE_RE = /(^|\/)Dockerfile[^/]*$/

/** O que SEPARA tokens de shell (operador — `#` não está aqui de propósito). */
const SHELL_OPERATORS = ["|", "&", ";", "<", ">"]

/**
 * O VALOR de uma palavra: as quotes fora e os escapes desfeitos.
 *
 * É uma aproximação declarada — ela existe para responder UMA pergunta (o nome
 * que o token invoca é um shell? e o payload começa em `$`?), e não para
 * reconstituir o que o shell faria com `\` dentro de quote dupla.
 *
 * @param {string} raw
 * @returns {string}
 */
export function tokenValue(raw) {
  return String(raw ?? "")
    .replace(/['"]/g, "")
    .replace(/\\(.)/g, "$1")
}

/**
 * Os TOKENS de um texto de shell, cada um com a LINHA onde começa.
 *
 * Um token é uma PALAVRA (com quotes dentro, possivelmente multi-linha — o shell
 * aceita quote aberta por várias linhas, e um payload de `-c` é escrito assim)
 * ou um OPERADOR. O que o scanner NÃO pode fazer é olhar dentro de strings: por
 * isso a detecção do shell embutido é feita entre TOKENS (o token do payload é
 * o VIZINHO da flag `-c`), e um exemplo dentro de uma quote
 * (`echo "use sh -c 'x'"`) não vira um alvo — ele é UM token, e o token anterior
 * não é uma flag.
 *
 * Duas coisas que uma varredura linha-a-linha erraria, e que aqui valem porque
 * são a MESMA régua que o `check-pipefail-sigpipe` usa (`heredocDelimiters`):
 *   · COMENTÁRIO (`#` só comença comentário no INÍCIO de uma palavra, como no
 *     shell) — um `# sh -c "exemplo quebrado"` num script não é código;
 *   · HEREDOC — o corpo de um `<<'EOF'` é DADO. Os mutation tests do repositório
 *     escrevem fixtures de shell DENTRO de heredoc de propósito; lê-los como
 *     programa viraria uma violação falsa em cima de quem prova o gate.
 *
 * @param {string} text
 * @param {{startLine?: number}} [opts]
 * @returns {{tipo: "palavra"|"citada"|"op", raw: string, valor: string, linha: number, quote?: "'"|"\"", inner?: string, fechada?: boolean}[]}
 */
export function shellTokens(text, { startLine = 1 } = {}) {
  const src = String(text ?? "")
  const out = []
  let i = 0
  let line = startLine
  /** Os delimitadores de heredoc ABERTOS: o corpo deles é DADO, não programa. */
  const heredocs = []
  /** O próximo token é o DELIMITADOR de um `<<`? */
  let esperaDelim = false

  const consome = (n) => {
    for (const ch of src.slice(i, i + n)) if (ch === "\n") line++
    i += n
  }
  // Pula o CORPO de um heredoc aberto (as linhas de dado, até o delimitador).
  const pulaHeredoc = () => {
    while (heredocs.length > 0 && i < src.length) {
      const fim = src.indexOf("\n", i)
      const linha = src.slice(i, fim === -1 ? src.length : fim)
      consome(linha.length)
      if (fim !== -1) consome(1)
      if (linha.trim() === heredocs[0] || linha.replace(/^\t+/, "") === heredocs[0])
        heredocs.shift()
    }
  }

  const lePalavra = (linhaIni) => {
    let raw = ""
    /** A quote que envolve a palavra INTEIRA (só ela) — o caso do payload. */
    let somenteQuote = null
    while (i < src.length) {
      const c = src[i]
      if (c === " " || c === "\t" || c === "\n" || c === "\r" || SHELL_OPERATORS.includes(c)) break
      if (c === "\\" && i + 1 < src.length && src[i + 1] !== "\n") {
        raw += src.slice(i, i + 2)
        consome(2)
        continue
      }
      if (c === "'" || c === '"') {
        const abre = raw.length
        raw += c
        consome(1)
        let fechou = false
        while (i < src.length) {
          const d = src[i]
          if (d === c) {
            raw += d
            consome(1)
            fechou = true
            break
          }
          if (d === "\\" && c === '"' && i + 1 < src.length) {
            raw += src.slice(i, i + 2)
            consome(2)
            continue
          }
          raw += d
          consome(1)
        }
        // A quote não fecha dentro do texto lido: o que resta é o conteúdo dela.
        if (!fechou) {
          return {
            tipo: "citada",
            raw,
            valor: raw.slice(1),
            inner: raw.slice(1),
            quote: c,
            linha: linhaIni,
            fechada: false,
          }
        }
        if (abre === 0 && somenteQuote === null) somenteQuote = { quote: c, fim: raw.length }
        continue
      }
      raw += c
      consome(1)
    }
    if (somenteQuote !== null && raw.length === somenteQuote.fim) {
      return {
        tipo: "citada",
        raw,
        valor: raw.slice(1, -1),
        inner: raw.slice(1, -1),
        quote: somenteQuote.quote,
        linha: linhaIni,
        fechada: true,
      }
    }
    return { tipo: "palavra", raw, valor: tokenValue(raw), linha: linhaIni }
  }

  while (i < src.length) {
    const c = src[i]
    if (c === "\n") {
      consome(1)
      if (heredocs.length > 0) pulaHeredoc()
      continue
    }
    if (c === " " || c === "\t" || c === "\r") {
      consome(1)
      continue
    }
    if (c === "\\" && src[i + 1] === "\n") {
      consome(2)
      continue
    }
    // Comentário: POSIX, o `#` só abre um quando INICIA uma palavra.
    if (c === "#") {
      const fim = src.indexOf("\n", i)
      consome((fim === -1 ? src.length : fim) - i)
      continue
    }
    const linhaIni = line
    if (SHELL_OPERATORS.includes(c)) {
      let raw = c
      consome(1)
      if (c === "<" && src[i] === "<") {
        raw += "<"
        consome(1)
      }
      if (c === "<" && raw === "<<" && src[i] === "-") {
        raw += "-"
        consome(1)
      }
      if (c === "<" && raw === "<<" && src[i] === "<") {
        raw += "<"
        consome(1)
      }
      if (raw === "<<" || raw === "<<-") esperaDelim = true
      out.push({ tipo: "op", raw, valor: raw, linha: linhaIni })
      continue
    }
    const t = lePalavra(linhaIni)
    out.push(t)
    if (esperaDelim) {
      heredocs.push(tokenValue(t.raw))
      esperaDelim = false
    }
  }
  return out
}

/**
 * O shell EMBUTIDO de um texto: os payloads de `sh -c`/`bash -c` com TEXTO
 * LITERAL, o que só existe em runtime e o que não é shell.
 *
 * A detecção é entre TOKENS (ver `shellTokens`): um token cujo valor é um shell
 * conhecido, seguido de uma flag com `c` (`-c`, `-ec`), seguido do payload. A
 * flag é procurada adiante porque `bash --norc -c "..."` existe; e o `--` fecha
 * a busca (depois dele vem comando, não opção).
 *
 * @param {string} text
 * @param {{startLine?: number}} [opts]
 * @returns {{payloads: {linha: number, body: string, fonte: string}[], pular: {linha: number, detail: string}[], indeterminado: {linha: number, detail: string}[]}}
 */
export function embeddedPayloads(text, { startLine = 1 } = {}) {
  const toks = shellTokens(text, { startLine })
  const payloads = []
  const pular = []
  const indeterminado = []
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k]
    if (t.tipo === "op") continue
    if (!SHELL_INTERPRETERS.includes(basename(t.valor))) continue
    let flag = -1
    for (let j = k + 1; j < toks.length && toks[j].tipo === "palavra"; j++) {
      const v = toks[j].valor
      if (v === "--" || !v.startsWith("-")) break
      if (/^-[A-Za-z]*c[A-Za-z]*$/.test(v)) {
        flag = j
        break
      }
    }
    if (flag === -1) continue
    const alvo = toks[flag + 1]
    if (!alvo || alvo.tipo === "op") {
      indeterminado.push({
        linha: t.linha,
        detail: `\`${t.valor} -c\` SEM o texto adiante — a flag está lá e o payload não`,
      })
      k = flag
      continue
    }
    k = flag + 1
    if (alvo.tipo === "citada") {
      if (!alvo.fechada) {
        indeterminado.push({
          linha: t.linha,
          detail:
            `\`${t.valor} -c\`: a quote do payload não fecha no texto lido — o gate não ` +
            `consegue delimitar o que julgar (e o \`bash -n\` do arquivo que o contém não desce nele)`,
        })
        continue
      }
      const trim = alvo.inner.trim()
      if (alvo.quote === "'") {
        if (trim === "") {
          pular.push({
            linha: t.linha,
            detail: `\`${t.valor} -c ''\` — payload VAZIO, nada executa`,
          })
          continue
        }
        payloads.push({ linha: t.linha, body: alvo.inner, fonte: "quote simples (literal)" })
        continue
      }
      if (trim === "") {
        pular.push({
          linha: t.linha,
          detail: `\`${t.valor} -c ""\` — payload VAZIO, nada executa`,
        })
        continue
      }
      if (RUNTIME_PAYLOAD_RE.test(trim)) {
        indeterminado.push({
          linha: t.linha,
          detail:
            `\`${t.valor} -c\`: o payload é \`${trim}\` — o TEXTO só existe em runtime ` +
            `(o gate julga TEXTO, e presumir o valor publicaria um fato que ninguém mediu)`,
        })
        continue
      }
      payloads.push({ linha: t.linha, body: alvo.inner, fonte: "quote dupla" })
      continue
    }
    if (alvo.valor === "") {
      pular.push({ linha: t.linha, detail: `\`${t.valor} -c\` — payload vazio, nada executa` })
      continue
    }
    if (alvo.valor.startsWith("$") || alvo.valor.includes("$(") || alvo.valor.includes("`")) {
      indeterminado.push({
        linha: t.linha,
        detail:
          `\`${t.valor} -c ${alvo.valor}\` — o payload é RESOLVIDO em runtime (variável ou ` +
          `substituição), e o texto que o shell vai julgar não está escrito aqui`,
      })
      continue
    }
    payloads.push({ linha: t.linha, body: alvo.valor, fonte: "palavra" })
  }
  return { payloads, pular, indeterminado }
}

/**
 * A LINHA de um texto DENTRO de um arquivo, achada pelo seu primeiro trecho não
 * vazio.
 *
 * O `js-yaml` entrega VALORES, não marcas: um payload extraído de um escalar não
 * sabe em que linha do arquivo ele está. A busca é pela primeira linha não vazia
 * do texto, e o desfecho AMBÍGUO é `null` — apontar a linha errada é pior que
 * dizer que não se sabe, porque manda o operador procurar no lugar errado (e o
 * relatório imprime só o arquivo quando a linha é `null`).
 *
 * @param {string} raw
 * @param {string} texto
 * @returns {number|null}
 */
export function lineOfText(raw, texto) {
  const linhas = String(raw ?? "").split(/\r?\n/)
  // Tenta as linhas do texto UMA a uma: a primeira costuma ser a certa, mas uma
  // linha genérica (`set -euo pipefail` aparece 5x num workflow) não é pista de
  // nada — e a PRIMEIRA linha que casa uma vez só já localiza o trecho (todas
  // as linhas tentadas pertencem ao texto, então a linha achada é dele).
  for (const candidata of String(texto ?? "").split(/\r?\n/)) {
    const alvo = candidata.trim()
    if (alvo === "") continue
    const achados = []
    linhas.forEach((l, i) => {
      if (l.trim().includes(alvo)) achados.push(i + 1)
    })
    if (achados.length === 1) return achados[0]
  }
  return null
}

/**
 * O payload de um `-c` que chega por ARGV (a forma EXEC de um `RUN`, uma lista
 * do YAML): aqui o texto é LITERAL por CONSTRUÇÃO.
 *
 * É a diferença que separa este caminho do tokenizador, e ela não é sutil: no
 * TEXTO de shell, `sh -c "$cmd"` tem o `$cmd` expandido pelo shell EXTERNO antes
 * de o interno existir (logo, o texto julgado não está escrito em lugar nenhum);
 * num ARGV, o `$cmd` é o TEXTO que o shell interno vai receber e expandir — ele
 * está escrito, é literal, e julga-se ele.
 *
 * @param {string[]} argv
 * @returns {{payload?: {body: string, fonte: string}, pular?: string, indeterminado?: string}|null}
 */
export function argvPayload(argv) {
  for (let i = 0; i < argv.length; i++) {
    if (typeof argv[i] !== "string") continue
    if (!SHELL_INTERPRETERS.includes(basename(argv[i]))) continue
    const nome = basename(argv[i])
    for (let j = i + 1; j < argv.length; j++) {
      if (typeof argv[j] !== "string" || argv[j] === "--") break
      if (!/^-[A-Za-z]*c[A-Za-z]*$/.test(argv[j])) continue
      const payload = argv[j + 1]
      if (typeof payload !== "string") {
        return { indeterminado: `\`${nome} -c\` sem o texto no argumento seguinte` }
      }
      if (payload.trim() === "") return { pular: `\`${nome} -c ""\` — payload VAZIO, nada executa` }
      return { payload: { body: payload, fonte: `argv de \`${nome} -c\`` } }
    }
  }
  return null
}

/**
 * O shell embutido de um YAML (workflow de forja ou compose): o payload
 * LITERAL de um `sh -c`, pela ESTRUTURA do documento — nunca pela sintaxe.
 *
 * POR QUE PELA ESTRUTURA: varrer o texto de um YAML como se fosse shell lê a
 * sintaxe do YAML como se fosse programa. Medido neste repositório antes desta
 * versão: um `entrypoint:` em lista
 * (`- /bin/sh` / `- -c` / `- |` + o script) entregou um payload `-` (a marca de
 * lista) e um flow (`["CMD", "python3", "-c", "import urllib..."]`) não
 * entregou payload nenhum — nos dois casos o gate diria "0 violações" sobre um
 * texto que ele nunca julgou.
 *
 * Três formas, e as três são shell de verdade:
 *   · ESCALAR (`entrypoint: >` num compose, o corpo de um `run:`) — o compose
 *     roda a forma string via `sh -c`, e o corpo de um `run:` é um arquivo de
 *     script: nos dois há um shell EXTERNO, então o texto é julgado como texto
 *     de shell (o `"$cmd"` do meio é um valor que o externo resolve);
 *   · LISTA (`["/bin/sh", "-c", "..."]`, em flow ou em bloco) — o argv vai
 *     direto ao `execve`, e o texto do `-c` é literal (ver `argvPayload`);
 *   · `CMD-SHELL` (`test: ["CMD-SHELL", "pg_isready ..."]`) — o docker roda o
 *     elemento seguinte via `sh -c` por DEFINIÇÃO: é o mesmo shell embutido,
 *     dito por um rótulo em vez de por um binário.
 *
 * @param {any} doc  o documento YAML já parseado
 * @param {string} raw  o TEXTO do arquivo (para LOCALIZAR a linha do payload)
 * @returns {{payloads: {linha: number|null, body: string, fonte: string}[], pular: {linha: number|null, detail: string}[], indeterminado: {linha: number|null, detail: string}[]}}
 */
export function yamlEmbeddedPayloads(doc, raw) {
  const payloads = []
  const pular = []
  const indeterminado = []
  const add = (destino, p) => destino.push({ ...p, linha: lineOfText(raw, p.body ?? "") })
  const visitar = (no) => {
    if (typeof no === "string") {
      // ESCALAR: texto de shell (o shell externo existe nas duas formas).
      const e = embeddedPayloads(no)
      for (const p of e.payloads) add(payloads, p)
      for (const p of e.pular) add(pular, p)
      for (const p of e.indeterminado) add(indeterminado, p)
      return
    }
    if (Array.isArray(no)) {
      const strs = no.filter((x) => typeof x === "string")
      if (strs.length === no.length && strs.length > 1) {
        const r = argvPayload(strs)
        if (r?.payload) add(payloads, r.payload)
        else if (r?.pular) add(pular, { detail: r.pular })
        else if (r?.indeterminado) add(indeterminado, { detail: r.indeterminado })
        if (strs[0] === "CMD-SHELL" && strs.length > 1) {
          add(payloads, {
            body: strs[1],
            fonte: "`CMD-SHELL` (o docker roda o texto do elemento seguinte via `sh -c`)",
          })
        }
      }
      for (const el of no) visitar(el)
      return
    }
    if (no !== null && typeof no === "object") {
      for (const v of Object.values(no)) visitar(v)
    }
  }
  visitar(doc)
  return { payloads, pular, indeterminado }
}

/**
 * As instruções `RUN` de um Dockerfile, com o texto de shell que cada uma
 * entrega — e os desfechos que NÃO são shell, nomeados.
 *
 * O que esta leitura precisa acertar (e o que uma regex por linha erraria):
 *   · CONTINUAÇÃO (`\` no fim): o Dockerfile junta as linhas ANTES de entregar
 *     o texto a `/bin/sh -c`. Julgar linha a linha julgaria um programa que não
 *     existe — e `&& \` no fim é a forma mais comum de todas;
 *   · COMENTÁRIO dentro de uma continuação: o Dockerfile o DESCARTA (não faz
 *     parte do comando), então ele não pode virar texto de shell aqui;
 *   · FLAGS do docker (`--mount=`, `--network=`, `--security=`) vêm ANTES do
 *     comando e NÃO chegam ao shell — sem tirá-las, o `bash -n` receberia
 *     `--mount=type=cache,...` como se fosse um comando;
 *   · forma EXEC (`RUN ["bash", "-c", "..."]`): o argv vai direto ao `execve`,
 *     sem shell — MAS um `-c` de shell ali é o MESMO texto embutido, e ele é
 *     julgado (o JSON já resolveu as quotes); sem shell, o desfecho é PULADO;
 *   · forma HEREDOC do BuildKit (`RUN <<'EOF'`): o corpo do heredoc É o script
 *     que roda — é shell embutido no sentido mais literal, e é julgado.
 *
 * @param {string} content  o Dockerfile inteiro
 * @param {{file?: string}} [opts]
 * @returns {{units: {file: string, line: number, body: string, fonte: string}[], skipped: {file: string, line: number, detail: string}[], indeterminate: {file: string, line: number, detail: string}[]}}
 */
export function dockerfileRunUnits(content, { file = "Dockerfile" } = {}) {
  const linhas = String(content ?? "").split(/\r?\n/)
  const units = []
  const skipped = []
  const indeterminate = []
  for (let i = 0; i < linhas.length; i++) {
    const m = /^[ \t]*RUN\b(.*)$/.exec(linhas[i])
    if (!m) continue
    const linhaIni = i + 1
    let corpo = (m[1] ?? "").replace(/^\s+/, "")
    // (1) continuação: o texto do shell é a SOMA das linhas, não a primeira.
    while (/\\\s*$/.test(corpo) && i + 1 < linhas.length) {
      corpo = corpo.replace(/\\\s*$/, "")
      i++
      let prox = linhas[i]
      // O Dockerfile descarta linhas de COMENTÁRIO dentro de uma continuação.
      while (/^[ \t]*#/.test(prox) && i + 1 < linhas.length) prox = linhas[++i]
      corpo += ` ${prox.trim()}`
    }
    corpo = corpo.trim()
    if (corpo === "") {
      skipped.push({ file, line: linhaIni, detail: "`RUN` sem comando — nada executa" })
      continue
    }
    // (2) heredoc do BuildKit: o CORPO é o script.
    if (corpo.startsWith("<<")) {
      const delim = heredocDelimiters(corpo)[0]
      if (!delim) {
        indeterminate.push({
          file,
          line: linhaIni,
          detail: "`RUN <<` sem delimitador legível — o gate não sabe onde o script termina",
        })
        continue
      }
      const linhasDoCorpo = []
      let achou = false
      for (i++; i < linhas.length; i++) {
        if (linhas[i].trim() === delim || linhas[i].replace(/^\t+/, "") === delim) {
          achou = true
          break
        }
        linhasDoCorpo.push(linhas[i])
      }
      if (!achou) {
        indeterminate.push({
          file,
          line: linhaIni,
          detail: `heredoc \`<<${delim}\` sem o terminador — o script não fecha e o gate não tem o texto inteiro`,
        })
        continue
      }
      units.push({
        file,
        line: linhaIni,
        body: linhasDoCorpo.join("\n"),
        fonte: `heredoc <<${delim}`,
      })
      continue
    }
    // (3) forma EXEC (JSON).
    if (corpo.startsWith("[")) {
      let argv = null
      try {
        argv = JSON.parse(corpo)
      } catch {
        argv = null
      }
      if (!Array.isArray(argv) || argv.some((a) => typeof a !== "string")) {
        indeterminate.push({
          file,
          line: linhaIni,
          detail:
            "a forma EXEC (JSON) não faz parsing — o gate não sabe o que o docker `execve`aria",
        })
        continue
      }
      const r = argvPayload(argv)
      if (r?.payload) {
        units.push({
          file,
          line: linhaIni,
          body: r.payload.body,
          fonte: `EXEC — ${r.payload.fonte}`,
        })
      } else if (r?.pular) {
        skipped.push({ file, line: linhaIni, detail: r.pular })
      } else if (r?.indeterminado) {
        indeterminate.push({ file, line: linhaIni, detail: r.indeterminado })
      } else {
        skipped.push({
          file,
          line: linhaIni,
          detail:
            `forma EXEC (JSON): o argv vai direto ao \`execve\`, sem shell e sem \`-c\` de shell ` +
            `(primeiro elemento: \`${basename(String(argv[0] ?? ""))}\`) — não há texto de shell a julgar`,
        })
      }
      continue
    }
    // (4) forma shell: as flags do docker saem da frente, o resto é o comando.
    const mFlag = /^(?:--[A-Za-z][A-Za-z-]*(?:=\S*)?\s+)+/.exec(corpo)
    const texto = mFlag ? corpo.slice(mFlag[0].length).trim() : corpo
    if (texto === "") {
      skipped.push({
        file,
        line: linhaIni,
        detail: "`RUN` só com flags do docker — nada chega ao shell",
      })
      continue
    }
    units.push({ file, line: linhaIni, body: texto, fonte: "RUN (forma shell)" })
  }
  return { units, skipped, indeterminate }
}

/**
 * Os arquivos que carregam shell EMBUTIDO: os Dockerfiles (por NOME, em qualquer
 * diretório) e os composes do repositório.
 *
 * A enumeração caminha a ÁRVORE em vez de ler uma lista à mão: um `Dockerfile`
 * novo num diretório novo entra na varredura sem editar nada aqui — a lista
 * fixa é justamente como um alvo fica invisível (o `DOCKERFILES` do
 * `check-bun-mirror` é uma lista de OUTRO assunto, e este gate não depende dela).
 *
 * @param {string} root
 * @returns {string[]}
 */
export function embeddedPaths(root) {
  const out = []
  const walk = (dir) => {
    const abs = dir === "" ? root : join(root, dir)
    if (!existsSync(abs)) return
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      const rel = dir === "" ? entry.name : `${dir}/${entry.name}`
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue
        walk(rel)
        continue
      }
      if (!entry.isFile()) continue
      if (DOCKERFILE_RE.test(rel) || COMPOSE_FILE_RE.test(rel)) out.push(rel)
    }
  }
  walk("")
  return out.sort()
}

/**
 * A terceira fonte inteira: o shell embutido dos Dockerfiles, dos composes, dos
 * corpos `run:` e dos scripts de shell.
 *
 * Os DOIS primeiros conjuntos trazem texto de shell PRÓPRIO (a instrução `RUN`);
 * os quatro são varridos por `sh -c` LITERAL — o payload que o parser do arquivo
 * que o contém não desce. Com `staged`, tudo vem do ÍNDICE, como as outras
 * fontes: o recorte do commit julga o COMMIT.
 *
 * `donos` são os arquivos que TÊM texto de shell próprio (os Dockerfiles e os
 * composes lidos por estrutura); `files` são TODOS os arquivos em que a terceira
 * fonte procurou (donos + workflows + scripts), porque um `sh -c` literal pode
 * viver em qualquer um deles. Os dois números são diferentes e o relatório os
 * nomeia pelo que cada um é — chamar os dois de "Dockerfiles" seria publicar uma
 * contagem que não mede o que o rótulo diz.
 *
 * Os campos de cada unidade e de cada payload são NOMEADOS na assinatura pelo
 * mesmo motivo das outras duas fontes: o `embeddedFailures`/`payloadFailures` do
 * `scan()` é este tipo somado a `kind`/`error`.
 *
 * @param {string} root
 * @param {{staged?: boolean}} [opts]
 * @returns {{files: string[], donos: string[], units: {file: string, line: number, body: string, fonte: string}[], payloads: {file: string, line: number|null, body: string, fonte: string, mascara: "runner"|"compose"|null}[], skipped: {file: string, line: number|null, detail: string}[], indeterminate: {file: string, line: number|null, detail: string}[], unread: {file: string, detail: string}[]}}
 */
export function collectEmbeddedShell(root, { staged = false } = {}) {
  const files = []
  const donos = []
  const units = []
  const payloads = []
  const skipped = []
  const indeterminate = []
  const unread = []
  let alvos
  try {
    const donosVarridos = staged ? embeddedStagedPaths(root) : embeddedPaths(root)
    donos.push(...donosVarridos)
    const workflows = staged ? stagedWorkflowPaths(root) : allWorkflowFiles(root).map((w) => w.path)
    const scripts = staged ? stagedShellScriptPaths(root) : listShellScripts(root)
    alvos = [...new Set([...donosVarridos, ...workflows, ...scripts])].sort()
  } catch (err) {
    return {
      files,
      donos,
      units,
      payloads,
      skipped,
      indeterminate,
      unread: [{ file: root, detail: String(err?.message ?? err) }],
    }
  }
  for (const rel of alvos) {
    let conteudo
    try {
      conteudo = staged ? readIndexFile(root, rel) : readJudgedFile(join(root, rel), rel)
    } catch (err) {
      unread.push({ file: rel, detail: err?.motivo ?? String(err?.message ?? err) })
      continue
    }
    files.push(rel)
    if (DOCKERFILE_RE.test(rel)) {
      const r = dockerfileRunUnits(conteudo, { file: rel })
      units.push(...r.units)
      skipped.push(...r.skipped)
      indeterminate.push(...r.indeterminate)
    }
    // A MÁSCARA é a do que o shell REALMENTE recebe, e ela muda por FONTE:
    //   · workflow — `${{ ... }}` é resolvido pelo runner ANTES de o shell existir;
    //   · compose — `$$` é o escape da interpolação do compose, que também
    //     resolve antes (o shell do container recebe `$`);
    //   · script e Dockerfile — não há nada entre o texto e o shell: o que está
    //     escrito é o que o interpretador julga (o `$VAR` de um `RUN` é
    //     substituído pelo BUILDER, mas o que chega ao shell é um VALOR, e a
    //     gramática não muda por isso).
    const mascara = isForgeWorkflowPath(rel)
      ? "runner"
      : COMPOSE_FILE_RE.test(rel)
        ? "compose"
        : null
    let emb
    if (mascara || COMPOSE_FILE_RE.test(rel)) {
      const parsed = parseYamlDocument(conteudo)
      if (!parsed.ok) {
        // Um workflow que não faz parsing em YAML já é FATO do outro coletor
        // (`yamlInvalido`, exit 2): repetir aqui só duplicaria a mensagem. Num
        // COMPOSE ninguém mais responde por ele — e "não consegui ler" não pode
        // virar "nenhum payload" em silêncio.
        if (!mascara) {
          indeterminate.push({
            file: rel,
            line: null,
            detail: `YAML que não faz parsing (${parsed.motivo}) — o shell embutido deste arquivo não pôde ser lido`,
          })
        }
        continue
      }
      emb = yamlEmbeddedPayloads(parsed.doc, conteudo)
    } else {
      emb = embeddedPayloads(conteudo)
    }
    for (const p of emb.payloads) {
      payloads.push({ file: rel, line: p.linha, body: p.body, fonte: p.fonte, mascara })
    }
    for (const s of emb.pular) skipped.push({ file: rel, line: s.linha, detail: s.detail })
    for (const s of emb.indeterminado) {
      indeterminate.push({ file: rel, line: s.linha, detail: s.detail })
    }
  }
  return { files, donos, units, payloads, skipped, indeterminate, unread }
}

/**
 * Os Dockerfiles e composes do ÍNDICE — o recorte do commit para a terceira
 * fonte. Dockerfile é reconhecido por NOME em qualquer diretório (a mesma régua
 * da varredura inteira); compose, pela régua compartilhada do `check-bun-mirror`.
 *
 * @param {string} root
 * @returns {string[]}
 */
export function embeddedStagedPaths(root) {
  return stagedPaths(root).filter((p) => DOCKERFILE_RE.test(p) || COMPOSE_FILE_RE.test(p))
}

/**
 * Os SCRIPTS DE SHELL que o repositório versiona, com o desfecho de cada um.
 *
 * A LISTA vem de `listShellScripts` — a MESMA do `check:pipefail-sigpipe`: o que
 * é "script do repositório" (`*.sh`, `*.bash`, os hooks sem extensão do
 * `.husky/`) tem UMA definição, e a varredura que a usa já nasceu escopada (não
 * desce em `node_modules`, artefato de build nem no runtime interno do husky).
 * Com `staged`, a lista E o conteúdo vêm do ÍNDICE, como os workflows.
 *
 * Três desfechos, e NENHUM é silencioso:
 *   · JULGADO — o interpretador declarado (ou a premissa, quando não há shebang)
 *     é bash/sh: o arquivo INTEIRO vai ao `bash -n`;
 *   · PULADO — shebang de outra linguagem, com o motivo DITO (o gate não julga o
 *     que não é bash, e um script de `python3` com nome `.sh` não é esta classe);
 *   · VAZIO — nomeado: nada executa, então não há sintaxe a julgar.
 *
 * Os campos de cada script (arquivo, corpo, interpretador e a FONTE dele) são
 * NOMEADOS na assinatura pelo mesmo motivo do `collectRunBodies`: o
 * `scriptFailures` do `scan()` é este tipo somado a `kind`/`error`, e `object[]`
 * apagaria de onde veio a violação.
 *
 * @param {string} root
 * @param {{staged?: boolean}} [opts]
 * @returns {{files: string[], scripts: {file: string, body: string, interpreter: string, fonte: string}[], skipped: {file: string, detail: string}[], unread: {file: string, detail: string}[]}}
 */
export function collectShellScripts(root, { staged = false } = {}) {
  const files = []
  const scripts = []
  const skipped = []
  const unread = []
  let lista
  try {
    lista = staged ? stagedShellScriptPaths(root) : listShellScripts(root)
  } catch (err) {
    return {
      files,
      scripts,
      skipped,
      unread: [{ file: root, detail: String(err?.message ?? err) }],
    }
  }
  for (const rel of lista) {
    files.push(rel)
    let conteudo
    try {
      // `readJudgedFile` (a leitura fail-closed do repositório) no lugar do
      // `readFileSync(..., "utf8")`: o segundo NÃO falha com byte inválido — ele
      // o troca por U+FFFD, e o arquivo entrava no `bash -n` como mojibake. Um
      // script cujo texto ninguém escreveu não é "um script que faz parsing".
      conteudo = staged ? readIndexFile(root, rel) : readJudgedFile(join(root, rel), rel)
    } catch (err) {
      unread.push({ file: rel, detail: err?.motivo ?? String(err?.message ?? err) })
      continue
    }
    if (conteudo.trim() === "") {
      skipped.push({ file: rel, detail: "arquivo VAZIO — nada executa, nada a julgar" })
      continue
    }
    const interp = interpreterOf(conteudo)
    if (!isBashShell(interp.command)) {
      skipped.push({
        file: rel,
        detail:
          `shebang \`${interp.raw}\` — \`${interp.command}\` NÃO é bash, e o \`bash -n\` não julga o ` +
          `que não é bash (a declaração do ARQUIVO é a fonte, como o \`shell:\` de um passo)`,
      })
      continue
    }
    scripts.push({
      file: rel,
      body: conteudo,
      interpreter: interp.command ?? "sh",
      fonte: interp.declared ? "shebang" : "premissa",
    })
  }
  return { files, scripts, skipped, unread }
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
 * Os campos de cada passo são NOMEADOS na assinatura (e não `object`): o
 * `failures` do `scan()` é este tipo somado ao `kind`/`error`, e um `object[]`
 * aqui apagaria a única coisa que quem consome o resultado precisa saber — de
 * qual passo veio a violação.
 *
 * @param {string} root
 * @param {{staged?: boolean}} [opts]
 * @returns {{files: string[], steps: {file: string, line: number, bodyEndLine: number, job: string|null, shell: string|null, shellFonte: string, body: string}[], skipped: {file: string, line: number, bodyEndLine: number, job: string|null, shell: string|null, shellFonte: string, detail: string}[], indeterminate: {file: string, line: number, bodyEndLine: number, job: string|null, shell: string|null, shellFonte: string, detail: string}[], shellFailures: {file: string, line: number, bodyEndLine: number, job: string|null, shell: string|null, shellFonte: string, kind: string, command: string, error: string}[], unread: {file: string, detail: string}[], yamlInvalido: {file: string, detail: string}[]}}
 */
export function collectRunBodies(root, { staged = false } = {}) {
  const files = []
  const steps = []
  const skipped = []
  const indeterminate = []
  const shellFailures = []
  const unread = []
  /**
   * Os workflows que EXISTEM e não fazem parsing em YAML — o segundo jeito de
   * "não consegui julgar". Eles são SEPARADOS do `unread` porque o motivo é
   * outro (o texto foi lido inteiro), e a mensagem de cada um tem de dizer a
   * classe certa: um YAML inválido não é um arquivo ilegível.
   * @type {{file: string, detail: string}[]}
   */
  const yamlInvalido = []
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
      yamlInvalido,
    }
  }
  for (const w of arquivos) {
    files.push(w.path)
    let conteudo
    try {
      conteudo = staged ? readIndexFile(root, w.path) : readJudgedFile(join(root, w.path), w.path)
    } catch (err) {
      unread.push({ file: w.path, detail: err?.motivo ?? String(err?.message ?? err) })
      continue
    }
    // O YAML inválido é a MESMA classe do ilegível, por outra porta: as linhas
    // existem, mas nenhum passo delas chega ao runner — então `bash -n` sobre
    // elas não mede nada. Declarado, nunca presumido: um workflow que não é
    // workflow não pode sair do gate como "0 corpos reprovados".
    const yaml = workflowYamlValidity(conteudo)
    if (!yaml.ok) {
      yamlInvalido.push({ file: w.path, detail: yaml.motivo })
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
  return { files, steps, skipped, indeterminate, shellFailures, unread, yamlInvalido }
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

/**
 * A varredura inteira: coleta + `bash -n` em cada corpo, cada script e cada
 * texto de shell EMBUTIDO.
 *
 * TRÊS fontes, UM parser e UM veredito. O que MUDA entre elas é o texto julgado,
 * e a diferença é a razão de a máscara existir de um lado e não do outro:
 *   · corpo `run:` — vai MASCARADO (`${{ ... }}` é resolvido pelo runner ANTES de
 *     o bash existir; julgar as chaves seria julgar texto que nunca chega lá);
 *   · arquivo de shell — vai CRU (não há runner entre o arquivo e o bash: o texto
 *     que o interpretador recebe é o DO ARQUIVO, byte a byte);
 *   · shell EMBUTIDO — a instrução `RUN` de um Dockerfile vai CRUA (o BUILD não
 *     tem template de runner), e o payload de um `sh -c` segue a fonte que o
 *     contém: num workflow, mascarado; num script/Dockerfile/compose, cru.
 *
 * O exit code e o relatório SOMAM as três: um script quebrado é a mesma classe
 * que um corpo quebrado, e separá-los em vereditos separados deixaria o CI verde
 * por metade.
 */
export function scan(root, { bash = DEFAULT_BASH, run = spawnSync, staged = false } = {}) {
  const { files, steps, skipped, indeterminate, shellFailures, unread, yamlInvalido } =
    collectRunBodies(root, { staged })
  const arquivos = collectShellScripts(root, { staged })
  const embutido = collectEmbeddedShell(root, { staged })
  const failures = []
  const scriptFailures = []
  const embeddedFailures = []
  const payloadFailures = []
  let indisponivel = null
  for (const step of steps) {
    const r = checkBody(maskExpressions(step.body), { bash, run })
    if (r.unavailable) {
      indisponivel = r.detail
      break
    }
    if (!r.ok) failures.push({ ...step, kind: r.kind ?? "erro", error: r.detail })
  }
  if (!indisponivel) {
    for (const script of arquivos.scripts) {
      const r = checkBody(script.body, { bash, run })
      if (r.unavailable) {
        indisponivel = r.detail
        break
      }
      if (!r.ok) scriptFailures.push({ ...script, kind: r.kind ?? "erro", error: r.detail })
    }
  }
  if (!indisponivel) {
    for (const unidade of embutido.units) {
      const r = checkBody(unidade.body, { bash, run })
      if (r.unavailable) {
        indisponivel = r.detail
        break
      }
      if (!r.ok) embeddedFailures.push({ ...unidade, kind: r.kind ?? "erro", error: r.detail })
    }
  }
  if (!indisponivel) {
    for (const payload of embutido.payloads) {
      const textoDoPayload =
        payload.mascara === "runner"
          ? maskExpressions(payload.body)
          : payload.mascara === "compose"
            ? maskComposeEscapes(payload.body)
            : payload.body
      const r = checkBody(textoDoPayload, { bash, run })
      if (r.unavailable) {
        indisponivel = r.detail
        break
      }
      if (!r.ok) payloadFailures.push({ ...payload, kind: r.kind ?? "erro", error: r.detail })
    }
  }
  // O `unread` das três fontes é o MESMO arquivo lido por dois coletores (um
  // workflow é lido pelos corpos e pela varredura de embutido): a mensagem de
  // "não consegui ler" sai UMA vez por arquivo, senão a lista infla e o operador
  // procura dois problemas onde há um.
  const unreadTodos = []
  const visto = new Set()
  for (const u of [...unread, ...arquivos.unread, ...embutido.unread]) {
    if (visto.has(u.file)) continue
    visto.add(u.file)
    unreadTodos.push(u)
  }
  return {
    files,
    steps,
    skipped,
    indeterminate,
    shellFailures,
    unread: unreadTodos,
    yamlInvalido,
    shellFiles: arquivos.files,
    shellScripts: arquivos.scripts,
    scriptSkipped: arquivos.skipped,
    embeddedFiles: embutido.files,
    embeddedDonos: embutido.donos,
    embeddedUnits: embutido.units,
    embeddedPayloads: embutido.payloads,
    embeddedSkipped: embutido.skipped,
    embeddedIndeterminate: embutido.indeterminate,
    failures,
    scriptFailures,
    embeddedFailures,
    payloadFailures,
    indisponivel,
  }
}

const USAGE = `check-workflow-run-syntax — o shell do repositório faz parsing em \`bash -n\`:
todo corpo \`run:\`, todo script versionado E todo texto de shell EMBUTIDO (o
\`RUN\` de um Dockerfile e o payload de um \`sh -c\`), e todo \`shell:\` declarado
existe no runner medido

Usage:
  node scripts/check-workflow-run-syntax.mjs              # o gate
  node scripts/check-workflow-run-syntax.mjs --staged     # só o que o ÍNDICE tem (workflows + scripts + Dockerfiles/composes)
  node scripts/check-workflow-run-syntax.mjs --fix        # REMENDA a cicatriz mecânica (LOCAL)
  node scripts/check-workflow-run-syntax.mjs --fix --dry-run  # o PATCH exato (STDOUT limpo); NADA é gravado
  node scripts/check-workflow-run-syntax.mjs --shells     # o que a imagem do runner tem, e a prova
  node scripts/check-workflow-run-syntax.mjs --json       # saída estruturada
  node scripts/check-workflow-run-syntax.mjs --list       # só o que foi varrido (corpos, arquivos e shell embutido)
  node scripts/check-workflow-run-syntax.mjs --root X     # fixture (testes)
  node scripts/check-workflow-run-syntax.mjs --bash CMD   # outro interpretador

Em \`--fix --dry-run\` os códigos são os MESMOS do \`--fix\`: o que muda é que NADA é
gravado — o patch sai em STDOUT (limpo, para \`| git apply\`) e o relatório em STDERR.

Exit codes:
  0 — todo corpo de passo, todo script de shell E todo texto de shell embutido
      passam SEM erro e SEM aviso; os passos não-bash saem NOMEADOS, os scripts
      de shebang não-bash também, os payloads que só existem em runtime saem como
      INDETERMINADO (nomeados) e o shell embutido fora do escopo sai PULADO
  1 — violação: um corpo, um script OU um texto embutido não faz parsing (erro),
      ou o parser avisou (ex.: heredoc sem terminador, que o bash reporta como
      AVISO e sai 0), OU um passo declara um \`shell:\` que o runner NÃO tem
      (\`command not found\`)
  2 — infra: bash não executou, --root inexistente, --staged fora de um repo
      git (sem índice não há recorte), arquivo ilegível, ou workflow que NÃO faz
      parsing em YAML (um arquivo que não é workflow não tem corpo a julgar)
  3 — uso inválido (\`--fix\` com \`--staged\`/\`--json\`, \`--dry-run\` sem \`--fix\`,
      flag desconhecida, \`--root\`/\`--bash\` sem valor)
`

/**
 * O `--shells`: o que a imagem do runner tem, a prova e o canal do CRON.
 *
 * O relatório aponta o comando de RE-MEDIÇÃO e o script que publica a
 * divergência: `--shells` responde "o que está declarado hoje"; quem responde
 * "isso ainda é verdade?" é o job periódico (`runner-shells.mjs`), e quem lê a
 * resposta é a issue.
 *
 * @param {Function} [log]
 * @param {Record<string, string|undefined>} [env]
 */
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
  log(
    `\nESTA declaração é RE-MEDIDA pelo cron semanal (\`scripts/runner-shells.mjs\`, job\n` +
      `\`runner-shells-drift\`): ele roda o mesmo comando dentro da imagem, compara com o que\n` +
      `este bloco declara e abre issue acionável quando diverge (fechando quando voltar a\n` +
      `bater). Rodar o comando acima à mão continua valendo — mas o verde deixou de\n` +
      `depender de alguém lembrar.`,
  )
}

/**
 * O `--fix` sobre a ÁRVORE inteira: roda o gate, remenda o que tem cicatriz, e
 * relata o que NÃO remendou com o motivo.
 *
 * `fixed` e `refused` são disjuntos e cobrem TODA falha de parsing: um fixer que
 * não remenda em silêncio seria o pior dos dois mundos.
 *
 * `staged` escolhe a FONTE das falhas: por padrão a ÁRVORE (o `--fix` da CLI),
 * e com `staged` os corpos que falham no ÍNDICE — que é o conjunto do remédio do
 * pre-commit (`pre-commit-remedy.mjs`): o alvo é desbloquear o COMMIT,
 * e o commit carrega o índice. A falha vem do índice e o arquivo remendado é o da
 * árvore: quando os dois divergem, o `fixWorkflow` recusa sozinho (a linha do
 * arquivo não é a do corpo) em vez de gravar na linha errada.
 *
 * `dry` repassa o PREVIEW ao `fixWorkflow` (nada é gravado).
 *
 * @param {string} root
 * @param {{bash?: string, run?: Function, write?: Function, read?: Function, staged?: boolean, dry?: boolean}} [deps]
 */
export function fixAll(
  root,
  { bash = DEFAULT_BASH, run = spawnSync, write, read, staged = false, dry = false } = {},
) {
  const resultado = scan(root, { bash, run, staged })
  const fixed = []
  const refused = []
  for (const f of resultado.failures) {
    const r = fixWorkflow(root, f, { bash, run, write, read, dry })
    if (r.fixed) fixed.push({ ...f, ...r })
    else refused.push({ ...f, ...r })
  }
  // Os ARQUIVOS DE SHELL não são remendados por este fixer, e o motivo é
  // ESCRITO em vez de omitido: a cicatriz que ele conhece é "uma linha, ancorada
  // no bloco `run: |`" — um modelo de WORKFLOW. Num arquivo a reescrita pode ter
  // engolido QUALQUER linha, e remendar a última sem ver a causa inventaria
  // intenção. A recusa é veredito (exit 1): um "✓" aqui esconderia um script
  // quebrado que o operador acharia ter consertado.
  for (const f of resultado.scriptFailures) {
    refused.push({
      ...f,
      fixed: false,
      reason:
        "arquivo de shell: este fixer remenda UMA linha ancorada no bloco `run: |` (linha + " +
        "corpo). Num arquivo, a reescrita pode ter engolido QUALQUER linha, e remendar a " +
        "última sem ver a causa inventaria intenção — remende à mão (o diff é o que se revisa)",
    })
  }
  // O shell EMBUTIDO tem recusa PRÓPRIA, e escrita: um `RUN` é uma instrução com
  // continuação (`\`) — emendar a última linha dela mexeria em DUAS linhas do
  // arquivo —, e um payload de `sh -c` pode viver em qualquer coluna (num
  // `entrypoint:` de compose, num `test:` de healthcheck): o modelo do fixer
  // (uma linha, ancorada no bloco `run: |`) não vale ali, e remendar sem ver a
  // causa inventaria intenção.
  for (const f of [...resultado.embeddedFailures, ...resultado.payloadFailures]) {
    refused.push({
      ...f,
      fixed: false,
      reason:
        `shell embutido (${f.fonte}): o remendo do fixer é de UMA linha ancorada no bloco ` +
        "`run: |` de um workflow. Aqui o texto é uma instrução com continuação ou um payload " +
        "dentro de outro artefato — remende à mão (o diff é o que se revisa)",
    })
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
    "--dry-run",
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
  const dryRun = argv.includes("--dry-run")
  // O preview DESCREVE o que o `--fix` gravaria — sozinho ele não tem o que
  // pré-visualizar, e aceitá-lo em silêncio faria o operador achar que mediu um
  // remendo que ninguém calculou.
  if (dryRun && !fix) {
    console.error("❌ --dry-run sem --fix: o preview descreve o que o `--fix` GRAVARIA")
    console.error(USAGE)
    process.exit(EXIT.USAGE)
  }
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
    // O preview passa pelo MESMO caminho de decisão (`fixAll` com `dry`) — não
    // por uma régua paralela: um preview que prometesse um remendo que a gravação
    // recusaria seria pior que nenhum preview.
    const r = dryRun ? remedyPatch(root, { bash }) : fixAll(root, { bash })
    if (r.indisponivel) {
      console.error(
        `❌ ${r.indisponivel}\n   Sem interpretador não há parsing: nenhum corpo NEM arquivo foi julgado.`,
      )
      process.exit(EXIT.UNAVAILABLE)
    }
    if (r.unread.length > 0) {
      console.error(
        `❌ arquivo(s) ILEGÍVEL(is) — não ler um corpo/script não é o mesmo que ele ser válido:`,
      )
      for (const u of r.unread) console.error(`     ${u.file}: ${u.detail}`)
      process.exit(EXIT.UNAVAILABLE)
    }
    // YAML inválido TRAVA o `--fix` antes de remendar: a cicatriz que ele
    // remenda é a ÚLTIMA linha de um bloco `run: |`, e o bloco de um arquivo que
    // não é workflow tem linha e corpo que o parser do YAML nunca entregaria ao
    // runner. Remendar ali gravaria texto num arquivo que nenhum gate julga — e
    // o "✓" esconderia exatamente isso.
    if (r.yamlInvalido.length > 0) {
      console.error(
        `❌ workflow(s) que NÃO fazem parsing em YAML — não há corpo de ` +
          "`run:` a remendar num arquivo que não é workflow:",
      )
      for (const y of r.yamlInvalido) console.error(`     ${y.file}: ${y.detail}`)
      process.exit(EXIT.UNAVAILABLE)
    }
    // Em `--dry-run` o STDOUT é SÓ o patch (o `| git apply` depende disso, e um
    // "✅" no meio dele quebraria o `|`): o relatório inteiro vai para STDERR.
    const relato = dryRun ? console.error : console.log
    if (dryRun) process.stdout.write(r.patch)
    for (const f of r.fixed) {
      if (dryRun) {
        relato(
          `◦ ${f.file}:${f.linhaArquivo} — pré-visualizado: o operador pendente \`${f.operador}\` seria removido`,
        )
        continue
      }
      relato(
        `✔ ${f.file}:${f.line} — remendo aplicado: operador pendente \`${f.operador}\` removido`,
      )
      relato(`     antes:  ${f.antes}`)
      relato(`     depois: ${f.depois}`)
    }
    for (const f of r.shellFailures) {
      console.error(`✖ ${f.file}:${f.line} — ${f.error}`)
    }
    // As duas fontes de shell EMBUTIDO também saem no relatório do `--fix`:
    // nenhuma delas é remendada (o fixer recusa, e a recusa vai para `refused`).
    for (const f of [...r.embeddedFailures, ...r.payloadFailures]) {
      console.error(`✖ ${f.line ? `${f.file}:${f.line}` : f.file} — ${f.error}`)
    }
    for (const f of r.refused) {
      console.error(`⛔ ${f.line ? `${f.file}:${f.line}` : f.file} — NÃO remendado: ${f.reason}`)
      // A última linha COM CONTEÚDO: num arquivo inteiro a última linha costuma
      // ser vazia, e imprimir o vazio não mostra a linha que o bash apontou.
      const ultima = String(f.body)
        .split("\n")
        .filter((l) => l.trim() !== "")
        .pop()
      console.error(`     ${String(ultima ?? "").slice(0, 120)}`)
    }
    if (r.fixed.length > 0) {
      relato(
        dryRun
          ? `\n   O patch acima é o que o \`--fix\` GRAVARIA — NADA foi gravado. Aplicar:\n` +
              `   \`node scripts/check-workflow-run-syntax.mjs --fix --dry-run | git apply\` (o patch sai em STDOUT)\n` +
              `   ou o \`--fix\` direto. O remendo tira a CICATRIZ que impedia o parsing — ele NÃO\n` +
              `   reconstrói a linha engolida: o diff é o que se revisa.`
          : `\n   O remendo tira a CICATRIZ que impedia o parsing — ele NÃO reconstrói a linha engolida:\n` +
              `   o diff é o que se revisa. O corpo voltou a fazer \`bash -n\` em memória E no disco.`,
      )
    }
    const embutidoReprovado = r.embeddedFailures.length + r.payloadFailures.length
    if (r.refused.length === 0 && r.shellFailures.length === 0 && embutidoReprovado === 0) {
      relato(
        r.fixed.length === 0
          ? `✅ nenhum corpo reprovado — não há cicatriz para remendar.`
          : dryRun
            ? `✅ ${r.fixed.length} remendo(s) pré-visualizado(s) — NADA foi gravado.`
            : `✅ ${r.fixed.length} corpo(s) remendado(s) — rode o gate de novo para o veredito da árvore.`,
      )
      process.exit(EXIT.OK)
    }
    process.exit(EXIT.VIOLATIONS)
  }

  const {
    files,
    steps,
    skipped,
    indeterminate,
    shellFailures,
    unread,
    yamlInvalido,
    shellFiles,
    shellScripts,
    scriptSkipped,
    embeddedFiles,
    embeddedDonos,
    embeddedUnits,
    embeddedPayloads,
    embeddedSkipped,
    embeddedIndeterminate,
    failures,
    scriptFailures,
    embeddedFailures,
    payloadFailures,
    indisponivel,
  } = scan(root, { bash, staged })

  if (argv.includes("--list")) {
    for (const s of steps) console.log(`${s.file}:${s.line}`)
    for (const s of shellScripts) console.log(s.file)
    for (const u of embeddedUnits) console.log(`${u.file}:${u.line}`)
    for (const p of embeddedPayloads) console.log(p.line ? `${p.file}:${p.line}` : p.file)
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
          yamlInvalido,
          arquivosDeShell: shellFiles,
          scripts: shellScripts.length,
          scriptSkipped,
          arquivosEmbutidos: embeddedFiles,
          donosEmbutidos: embeddedDonos,
          instrucoesEmbutidas: embeddedUnits.map((u) => ({
            file: u.file,
            line: u.line,
            fonte: u.fonte,
          })),
          embeddedPayloads: embeddedPayloads.map((p) => ({
            file: p.file,
            line: p.line,
            fonte: p.fonte,
            mascara: p.mascara,
          })),
          embeddedSkipped,
          embeddedIndeterminate,
          embeddedFailures: embeddedFailures.map((f) => ({
            file: f.file,
            line: f.line,
            fonte: f.fonte,
            kind: f.kind,
            error: f.error,
          })),
          payloadFailures: payloadFailures.map((f) => ({
            file: f.file,
            line: f.line,
            fonte: f.fonte,
            kind: f.kind,
            error: f.error,
          })),
          scriptFailures: scriptFailures.map((f) => ({
            file: f.file,
            interpreter: f.interpreter,
            fonte: f.fonte,
            kind: f.kind,
            error: f.error,
          })),
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
      failures.length > 0 ||
      scriptFailures.length > 0 ||
      shellFailures.length > 0 ||
      embeddedFailures.length > 0 ||
      payloadFailures.length > 0 ||
      unread.length > 0 ||
      yamlInvalido.length > 0 ||
      indisponivel !== null
    process.exit(falhou ? EXIT.VIOLATIONS : EXIT.OK)
  }

  // INFRA primeiro: sem `bash` executável, "0 violações" seria uma afirmação
  // sobre nada — e é justamente o veredito que este guard não pode cunhar.
  if (indisponivel) {
    console.error(
      `❌ ${indisponivel}\n   Sem interpretador não há parsing: nenhum corpo, arquivo NEM shell embutido foi julgado.`,
    )
    process.exit(EXIT.UNAVAILABLE)
  }
  // O YAML inválido tem mensagem PRÓPRIA: dizer "ilegível" para um arquivo lido
  // inteiro mandaria o autor procurar permissão/encoding onde o defeito é o
  // texto. As duas classes bloqueiam igual (UNAVAILABLE), mas nomeiam o motivo.
  if (yamlInvalido.length > 0) {
    console.error(
      `❌ workflow(s) que NÃO fazem parsing em YAML — um arquivo que não é workflow não tem corpo\n` +
        `   a julgar, e "0 corpos reprovados" sobre ele seria uma afirmação sobre nada:\n`,
    )
    for (const y of yamlInvalido) console.error(`     ${y.file}: ${y.detail}`)
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
        `   (recorte --staged: ${files.length} workflow(s) + ${shellFiles.length} script(s) + ${embeddedDonos.length} Dockerfile(s)/compose(s) do ÍNDICE, lidos do commit)\n`,
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
  }

  // A SEGUNDA fonte: o ARQUIVO de shell. As duas são o MESMO veredito, e o
  // relatório das duas sai ANTES do exit — uma execução com as duas classes não
  // pode esconder a segunda (o operador consertaria os corpos, rodaria de novo e
  // só então veria os arquivos). O gate diz tudo o que ele mediu, numa passada.
  if (scriptFailures.length > 0) {
    const graves = scriptFailures.filter((f) => f.kind === "erro").length
    console.error(
      `❌ ${scriptFailures.length} arquivo(s) de shell NÃO passam em \`bash -n\` — ${graves} com ERRO de\n` +
        `   sintaxe, ${scriptFailures.length - graves} com AVISO (o bash sai 0; o arquivo truncado roda\n` +
        `   outra coisa):\n`,
    )
    for (const f of scriptFailures) {
      console.error(
        `   ${f.kind === "aviso" ? "⚠" : "✖"} ${f.file}  (interpretador: \`${f.interpreter}\`, ${f.fonte})`,
      )
      console.error(`     ${f.error.split("\n").join("\n     ")}`)
    }
    console.error(
      `\n   O arquivo INTEIRO é o corpo, e vai CRU ao parser: num script não há runner para resolver\n` +
        `   \`\${{ ... }}\` antes de o bash existir. Corrija a reescrita — a causa costuma estar a poucas\n` +
        `   linhas de onde o bash apontou. É a MESMA classe que morre no passo que executa o script.\n`,
    )
  }
  // A TERCEIRA fonte: o shell EMBUTIDO. O `RUN` de um Dockerfile e o payload de
  // um `sh -c` são a MESMA classe das outras duas (texto de shell que morre no
  // runtime, longe da causa) — e o relatório deles sai antes do exit, como os
  // das outras, para uma execução com as três classes não esconder duas.
  if (embeddedFailures.length > 0) {
    const graves = embeddedFailures.filter((f) => f.kind === "erro").length
    console.error(
      `❌ ${embeddedFailures.length} instrução(ões) EMBUTIDA(s) (\`RUN\` de Dockerfile) NÃO passam em \`bash -n\` —\n` +
        `   ${graves} com ERRO de sintaxe, ${embeddedFailures.length - graves} com AVISO (o build deixa de rodar o\n` +
        `   que o texto diz, e o Dockerfile continua sendo um Dockerfile válido):\n`,
    )
    for (const f of embeddedFailures) {
      console.error(`   ${f.kind === "aviso" ? "⚠" : "✖"} ${f.file}:${f.line}  (${f.fonte})`)
      console.error(`     ${f.error.split("\n").join("\n     ")}`)
    }
    console.error(
      `\n   O shell do BUILD é o texto da instrução JUNTADO (a continuação \`\\\` faz parte) e entregue a\n` +
        `   \`/bin/sh -c\`: a causa costuma estar a poucas linhas de onde o shell apontou.\n`,
    )
  }
  if (payloadFailures.length > 0) {
    const graves = payloadFailures.filter((f) => f.kind === "erro").length
    console.error(
      `❌ ${payloadFailures.length} payload(s) de \`sh -c\`/\`bash -c\` NÃO passam em \`bash -n\` — ${graves} com ERRO\n` +
        `   de sintaxe, ${payloadFailures.length - graves} com AVISO (o shell interno morre ao ser invocado, e o\n` +
        `   arquivo que o contém é válido: nem o YAML nem o \`bash -n\` do arquivo descem no payload):\n`,
    )
    for (const f of payloadFailures) {
      const onde = f.line ? `${f.file}:${f.line}` : f.file
      console.error(`   ${f.kind === "aviso" ? "⚠" : "✖"} ${onde}  (${f.fonte})`)
      console.error(`     ${f.error.split("\n").join("\n     ")}`)
    }
    console.error(
      `\n   O payload é o TEXTO que o shell INTERNO recebe; para o parser do arquivo que o contém ele é uma\n` +
        `   STRING (é por isso que ele passava por todos os outros gates). Corrija a reescrita.\n`,
    )
  }
  if (failures.length > 0 || scriptFailures.length > 0) process.exit(EXIT.VIOLATIONS)
  if (embeddedFailures.length > 0 || payloadFailures.length > 0) process.exit(EXIT.VIOLATIONS)

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
  if (scriptSkipped.length > 0) {
    console.log(
      `⏭ ${scriptSkipped.length} arquivo(s) de shell fora do parsing — NOMEADO(s) (o \`bash -n\` não julga o que não é bash, e arquivo VAZIO não executa nada):`,
    )
    for (const s of scriptSkipped) console.log(`     ${s.file}  ${s.detail}`)
  }
  if (indeterminate.length > 0) {
    console.log(
      `◐ ${indeterminate.length} passo(s) com shell FORA DA MEDIÇÃO — INDETERMINADO (o gate não prova nem que o runner o tem, nem que não tem):`,
    )
    for (const s of indeterminate) console.log(`     ${s.file}:${s.line}  ${s.detail}`)
  }
  if (embeddedSkipped.length > 0) {
    console.log(
      `⏭ ${embeddedSkipped.length} texto(s) de shell EMBUTIDO fora do parsing — NOMEADO(s) (o gate não julga o que não é shell, e payload VAZIO não executa nada):`,
    )
    for (const s of embeddedSkipped) {
      console.log(`     ${s.line ? `${s.file}:${s.line}` : s.file}  ${s.detail}`)
    }
  }
  if (embeddedIndeterminate.length > 0) {
    console.log(
      `◐ ${embeddedIndeterminate.length} texto(s) de shell EMBUTIDO INDETERMINADO(s) (o gate não prova o que o shell vai receber, e presumir seria publicar o que ninguém mediu):`,
    )
    for (const s of embeddedIndeterminate) {
      console.log(`     ${s.line ? `${s.file}:${s.line}` : s.file}  ${s.detail}`)
    }
  }
  if (staged) {
    if (files.length === 0 && shellFiles.length === 0 && embeddedUnits.length === 0) {
      console.log(
        "   (nenhum workflow, script NEM Dockerfile/compose no ÍNDICE — nada a julgar neste commit; este recorte NÃO é a varredura do repo)",
      )
    }
    console.log(
      `✅ ${steps.length} corpo(s) \`run:\`, ${shellScripts.length} arquivo(s) de shell e ${embeddedUnits.length + embeddedPayloads.length} texto(s) de shell EMBUTIDO DO ÍNDICE ` +
        `(${files.length} workflow(s) + ${shellFiles.length} script(s) + ${embeddedDonos.length} Dockerfile(s)/compose(s) do commit; o texto embutido foi procurado em ${embeddedFiles.length} arquivo(s)) passam em \`${bash} -n\`: sem erro E ` +
        `sem aviso. O recorte é o COMMIT; a varredura inteira (as duas forjas + todos os scripts + o shell embutido) é o veredito do CI.`,
    )
    process.exit(EXIT.OK)
  }
  console.log(
    `✅ ${steps.length} corpo(s) \`run:\`, ${shellScripts.length} arquivo(s) de shell E ${embeddedUnits.length + embeddedPayloads.length} texto(s) de shell EMBUTIDO ` +
      `(${embeddedUnits.length} instrução(ões) \`RUN\` de Dockerfile + ${embeddedPayloads.length} payload(s) de \`sh -c\`) passam em \`${bash} -n\` ` +
      `(as duas forjas + os scripts versionados + os Dockerfiles e composes, sem allowlist): sem erro E sem aviso — e todo \`shell:\` ` +
      `declarado existe no runner medido. O gate prova que o corpo, o arquivo e o texto embutido fazem PARSING, e que o ` +
      `interpretador existe; NÃO prova que eles fazem o que dizem.`,
  )
  process.exit(EXIT.OK)
}

// True apenas quando executado diretamente — permite importar as funções puras
// nos testes unitários sem disparar a varredura.
const IS_DIRECT_RUN =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (IS_DIRECT_RUN) main()
