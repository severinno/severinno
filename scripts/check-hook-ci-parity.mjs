#!/usr/bin/env node

// =============================================================================
// check-hook-ci-parity.mjs
//
// Usage:
//   node scripts/check-hook-ci-parity.mjs
//   node scripts/check-hook-ci-parity.mjs --root X   # fixture (mutation test)
//   node scripts/check-hook-ci-parity.mjs --json
//
// Exit code:
//   0 — todo comando dos hooks locais e o MESMO comando do CI, ou um recorte/
//       comando local DECLARADO com razao escrita
//   1 — comando sem declaracao, declaracao stale, recorte sem razao, recorte
//       que nao deriva do comando canonico, invariante do CORE nem rodando no
//       hook nem declarado em HOOK_NOT_RUN
//   2 — infra: hook, package.json ou pipeline ausente (fail-closed)
//
// POR QUE ESTE GUARD EXISTE: o veredito LOCAL e o do MERGE sao dados por dois
// conjuntos de comandos escritos em dois lugares. Enquanto essa duplicacao for
// invisivel, ela diverge em silencio — e o sintoma e sempre o mesmo: "passou
// aqui e quebrou la" (ou pior, "travou aqui e nem era o gate do CI"). Os casos
// REAIS que este guard existe para impedir:
//
//   - `.husky/pre-push` rodava `bunx tsc --noEmit` SEM o heap de 4GB que o
//     script `typecheck` do package.json carrega: o tsc estourava a memoria
//     (SIGABRT exit 134) e o push ficava vermelho por um motivo que o CI nunca
//     veria. Os dois lados citavam "o typecheck" — com duas reguas;
//   - a forja rodava `bun run check:registry-source` e o espelho
//     `node scripts/check-registry-source.mjs`: mesma verificacao, dois
//     caminhos — e um terceiro no hook.
//
// O QUE O GUARD MEDE: para cada comando que um hook EXECUTA, o veredito e
// obtido resolvendo a entrada do package.json (`bun run X` -> o script real) e
// comparando com o comando CANONICO do CI (o `command` de cada invariante do
// CORE, do `check-forge-parity` — a MESMA fonte que o doctor usa):
//
//   MESMO COMANDO  o hook executa exatamente o comando do CI (apos resolver a
//                  entrada e normalizar redirecionamento/pipe). O veredito nao
//                  PODE divergir: e o mesmo comando. Nao precisa declaracao.
//   RECORTE        o hook executa o MESMO instrumento com argumentos a mais ou
//                  a menos (ex.: `--staged`). O veredito PODE divergir — e por
//                  isso a decisao tem de estar ESCRITA em HOOK_DECLARED, com a
//                  razao. Um recorte nao declarado deixa o hook reprovando (ou
//                  aprovando) onde o CI faz o contrario, em silencio.
//   LOCAL          o hook roda algo que o CI NAO roda (ou roda por outro
//                  caminho, ex.: um reusable). Tambem exige declaracao.
//
// E a COBERTURA, na direcao oposta: um invariante do CORE que o hook NAO roda
// precisa estar em HOOK_NOT_RUN com a razao. Sem isso, um gate novo do CORE
// entra no contrato de merge e o hook simplesmente nao o ve — o commit passa
// local e o PR nasce vermelho, que e o oposto do que o hook existe para fazer.
//
// E O SUB-GUARD DE UM RUNNER: quando o comando que a pipeline escreve e um
// RUNNER (`bash scripts/x.sh`), o que ele executa por DENTRO nao tinha dono
// nenhum — nem o hook, nem HOOK_NOT_RUN (que fala dos invariantes do CORE, uma
// lista declarada). Todo arquivo executado dentro dos runners das duas
// pipelines exige decisao local: o hook o executa (a BATTERIA LOCAL, medida
// tambem por descida — o hook chama runners), o invariante do CORE dele esta em
// HOOK_NOT_RUN, ou a ausencia esta escrita em RUNNER_SUBGUARD com a razao. O
// que a descida NAO consegue provar sai NOMEADO em `limitesDaDescida` ("nao
// desci" nunca e o mesmo que "nao ha nada la dentro").
//
// O QUE ESTE GUARD NAO PROMETE: o recorte declarado CONTINUA sendo um recorte
// (o hook mede menos que o CI — `--staged` ve o indice, nao a arvore inteira).
// A declaracao nao torna os dois vereditos iguais; torna a DIFERENCA VISIVEL e
// revisavel, que e o que uma decisao de escopo precisa ser.
// =============================================================================

import { existsSync, readFileSync, readdirSync } from "node:fs"
import { dirname, join, normalize, resolve } from "node:path"

import { CORE_INVARIANTS, canonicalCommandOf, executedCommands } from "./check-forge-parity.mjs"
// A SUPERFICIE DA DESCIDA mora no dono dela (`check-hook-commands`): a mesma
// regua que julga o interior dos scripts que o HOOK chama julga o interior dos
// runners que as PIPELINES chamam — uma implementacao so (ver o ciclo de
// imports declarado no bloco "O SUB-GUARD DE UM RUNNER").
import {
  MAX_SCRIPT_DEPTH,
  SHELL_INTERPRETERS,
  alvosProvaveis,
  caminhosProvaveis,
  shellCommands,
  variaveisDoArquivo,
} from "./check-hook-commands.mjs"
import {
  WORKFLOW_FILE_RE,
  existingWorkflowDirs,
  exitOnUnjudgeable,
  readJudgedText,
  readWorkflowScan,
} from "./forge-workflows.mjs"

const ROOT = process.cwd()

/** Os hooks locais cujos comandos sao comparados com o CI. */
export const HOOKS = [".husky/pre-commit", ".husky/pre-push"]

/** As pipelines do contrato de merge (o CI que decide o merge e o espelho). */
export const PIPELINES = [".gitea/workflows/ci.yml", ".github/workflows/pr-check.yml"]

/**
 * DECLARACAO dos comandos que os hooks rodam e que NAO sao o comando do CI
 * (recorte ou local). Cada entrada e um par `match` (regex ANCORADA sobre o
 * comando do hook) + o que ela e:
 *
 *   of         id de um invariante do CORE. O comando do hook tem de usar o
 *              MESMO instrumento do `command` canonico (mesmo script/binario)
 *              — um recorte de OUTRA ferramenta nao e recorte, e outro gate.
 *   ciMirror   a invocacao do CI que este comando espelha (fora das duas
 *              pipelines: um reusable). O guard exige que ela exista de fato
 *              em algum workflow — um `ciMirror` inventado nao passa.
 *   why        a razao ESCRITA. Obrigatoria sempre que o comando nao e
 *              literalmente o do CI: e ela que transforma "o hook mede outra
 *              coisa" em decisao revisavel.
 *
 * Adicionar um comando a um hook = adicionar uma entrada AQUI (ou usar o
 * comando do CI, que nao precisa declaracao nenhuma).
 *
 * @type {{match: RegExp, of: string|null, ciMirror?: string|null, why?: string}[]}
 */
export const HOOK_DECLARED = [
  {
    match: /^node scripts\/check-bun-mirror\.mjs --staged$/,
    of: "bun-mirror",
    why: "recorte --staged: a ARVORE de trabalho pode carregar WIP que NAO faz parte deste commit; o indice e o conteudo do commit. O CI roda o comando inteiro sobre o conteudo mergeado — a diferenca e de ESCOPO, e o comando (mesmo script, mesmos argumentos obrigatorios) e o do CI.",
  },
  {
    match: /^node scripts\/check-mutation-jobs\.mjs --staged$/,
    of: null,
    ciMirror: "node scripts/check-mutation-jobs.mjs --staged --base origin/main",
    why: "recorte sem o `--base`: no pre-commit o diff relevante e o do INDICE, e `origin/main` pode nao existir (clone novo, branch sem upstream). O CI tem a base garantida e compara contra ela.",
  },
  {
    match: /^node scripts\/check-unused-deps\.mjs --staged$/,
    of: null,
    ciMirror: "node scripts/check-unused-deps.mjs",
    why: "recorte --staged: mesmo motivo do bun-mirror (o indice e o commit). O comando inteiro roda no job unused-deps-guard do pr-check.yml.",
  },
  {
    match: /^node scripts\/check-mutation-timing-contract\.mjs --staged$/,
    of: null,
    ciMirror: "node scripts/check-mutation-timing-contract.mjs",
    why: "recorte --staged: o contrato e do repo, mas a violacao tem de estar no COMMIT para bloquea-lo. O comando inteiro roda no reusable utf8-check.yml.",
  },
  {
    match: /^node scripts\/check-required-checks\.mjs --staged$/,
    of: "required-checks",
    why: "recorte --staged: o veredito e o MESMO do CI (o mesmo script, sem flag), lido do INDICE (`git show :path`) e so quando o commit toca o contrato de merge — o manifesto, a declaracao da reaplicacao ou um workflow; nos outros commits ele sai 0 com um aviso, e o custo e um `git diff --cached --name-only` (~30ms). O alcance da comparacao e o repo inteiro nos dois casos (a relacao workflow <-> declaracao e global, e um contexto orfao na declaracao nao tem pedaco para recortar): o recorte e da RELEVANCIA do commit, nao do escopo da comparacao.",
  },
  {
    match: /^node scripts\/check-workflow-run-syntax\.mjs --staged$/,
    of: "workflow-run-syntax",
    why: "recorte --staged: julga o INDICE (com o CONTEUDO do commit, via `git show :path`), nao a arvore de trabalho — os workflows, os scripts de shell E o shell embutido (o `RUN` de um Dockerfile e o payload de um `sh -c`) que o commit carrega. O corpo quebrado nasce de uma reescrita mecanica em massa ANTES do commit e e o commit que o carrega; a arvore pode ter WIP que nao faz parte dele. O CI roda o comando inteiro sobre o conteudo mergeado (482 corpos, 124 scripts e 33 textos embutidos das duas forjas) — a diferenca e de ESCOPO, e o instrumento (o mesmo script) e o do CI.",
  },
  {
    // A cauda e o CAPTURA do veredito (`&& REMEDIO=0`): o hook precisa
    // distinguir o remedio que provou o indice da chamada que sumiu, e o
    // extrator nao descarta o `&&` — entao a declaracao o reconhece em vez de
    // fingir que o comando e outro.
    match: /^node scripts\/pre-commit-remedy\.mjs(?: && REMEDIO=0)?$/,
    of: null,
    ciMirror: null,
    why: "LOCAL: o remedio INTERATIVO do commit — quando um gate do hook reprova por um defeito MECANICO (a cicatriz de `run:` da sintaxe, o CRLF/CR-do-blob do encoding, o byte 0x97 do utf8), ele OFERECE o remendo com confirmacao explicita (o fixer do guard dono ja o prova antes de gravar), re-estagia os arquivos e REVALIDA com o guard dono. Nao existe no CI porque la nao ha operador para confirmar: a pergunta exige um TERMINAL DE CONTROLE (o git liga o fd 0 do hook em /dev/null e o remedio abre o /dev/tty por isso) e no CI o /dev/tty nao abre — sem terminal ele nao pergunta e o commit segue bloqueado (fail-closed). O CI cobra o MESMO veredito pelo gate de sintaxe; este comando nao acrescenta gate nenhum, so o caminho de quem opera.",
  },
  {
    match: /^bash scripts\/run-encoding-guards\.sh$/,
    of: null,
    ciMirror: null,
    why: "LOCAL: e o runner compartilhado dos dois hooks (fonte unica da lista). Os guards que ele executa rodam no CI pelo reusable utf8-check.yml; o RUNNER nao existe no CI porque la cada guard e um step com o seu proprio nome.",
  },
  {
    match: /^bun run barrel-lint$/,
    of: null,
    ciMirror: "node scripts/barrel-lint.mjs",
    why: "MESMO COMANDO do CI (job barrel-lint do reusable quality-gate.yml), fora das duas pipelines — por isso nao aparece no `--gates` do check-forge-parity, e por isso a declaracao nomeia o espelho.",
  },
  {
    match: /^bun x prettier --check --ignore-unknown \$(?:STAGED_FORMAT|\{?STAGED)/,
    of: "lint",
    why: "recorte do lint: o CI roda o invariante `lint` inteiro (prettier --check + eslint --max-warnings 0) sobre a ARVORE; aqui e so o prettier, so do que esta no indice, para o feedback ser antes do lint-staged (que conserta). O eslint do commit e feito pelo lint-staged.",
  },
  {
    match: /^bun x lint-staged$/,
    of: null,
    ciMirror: null,
    why: "LOCAL e MUTANTE: roda prettier --write + eslint --fix sobre o indice. Nao tem espelho no CI porque o CI nao conserta — ele REPROVA (`bun run lint`). Roda aqui para o commit ja sair formatado.",
  },
  {
    match: /^bun run check:direct-rtl-import$/,
    of: null,
    ciMirror: null,
    why: "LOCAL: import direto de @testing-library/react em arquivo .test (em vez de @/__tests__/test-utils) so aparece no trabalho em andamento; o CI cobre a classe pelo typecheck e pelo lint do commit. Nao existe gate equivalente nas duas pipelines.",
  },
  {
    match: /^bun test:snapshots$/,
    of: "tests",
    why: "recorte CONDICIONAL do `tests` (so quando .snap/snapshot testes mudam): roda o subconjunto de snapshots, nao a suite. O CI roda `bun run test:run` inteiro — o hook antecipa o unico caso em que o commit deixa um snapshot obsoleto.",
  },
  {
    match: /^bun run vitest run --reporter=verbose \$(?:AFFECTED_TESTS|\{?AFFECTED)/,
    of: "tests",
    why: "recorte por ARQUIVOS AFETADOS (smart-skip do pre-push): roda os testes mapeados dos arquivos que mudaram, nao a suite. E o caminho rapido do push; o CI roda `bun run test:run` inteiro.",
  },
  {
    match: /^bun run fuzz:ci$/,
    of: null,
    ciMirror: "bun run fuzz:ci",
    why: "MESMO COMANDO do job fuzz do pr-check.yml, declarado porque o hook o roda apenas sob `CI=1` (o fuzz e longo demais para todo push local).",
  },
  {
    match: /^bun run fuzz$/,
    of: null,
    ciMirror: null,
    why: "LOCAL: fuzz interativo de longa duracao (scripts/run-fuzz.sh). O CI roda a variante `fuzz:ci` (JSON, com teto) — a interativa fica para quem esta depurando.",
  },
]

/**
 * Os SUB-GUARDS DE RUNNER que a bateria local NAO executa — a ausencia
 * DECLARADA, com a razao escrita.
 *
 * A regra 4 (`analyze`) deriva, das duas pipelines, os runners que elas chamam
 * e DESCE neles: todo arquivo executado por dentro de um runner exige decisao
 * local. As formas de decidir sao tres: (a) o hook executa o arquivo — direto ou
 * por um runner dele (medido pela mesma descida); (b) o arquivo e o comando
 * canonico de um invariante do CORE ja declarado em HOOK_NOT_RUN; (c) esta
 * tabela. Um sub-guard sem nenhuma das tres e violacao, porque ele roda no
 * contrato de merge e o veredito local nao o ve.
 *
 * POR QUE UMA TABELA (e nao um `if` no guard): a entrada nomeia UM arquivo
 * (caminho literal, sem glob — um curinga esconderia o proximo sub-guard dentro
 * dele) e o guard confere as DUAS direcoes: sub-guard sem decisao E declaracao
 * que nao casa com sub-guard nenhum (stale).
 *
 * HOJE ESTA VAZIA, e isso e um FATO MEDIDO, nao um esquecimento: a descida das
 * pipelines alcanca `scripts/check_utf8.py` e `scripts/check_utf8.mjs` (dentro
 * do `check-utf8.sh`, que a pipeline chama direto) e a bateria local os executa
 * pelos dois runners do pre-commit (`run-encoding-guards.sh` → `check-utf8.sh`).
 * O primeiro sub-guard que NAO for alcancado localmente cai aqui (ou vira um
 * comando do hook) — a escolha passa a ser explicitamente escrita.
 *
 * @type {{file: string, why: string}[]}
 */
export const RUNNER_SUBGUARD = []

/**
 * Invariantes do CORE que os HOOKS NAO rodam, cada grupo com a razao escrita.
 *
 * Regra (a mesma do `GITHUB_ONLY` e do `HOOK_NOT_RUN` do doctor): um invariante
 * do CORE que nao roda no hook precisa de DECISAO ESCRITA — senao um gate novo
 * do contrato de merge entra em silencio e o commit local passa sem ele.
 *
 * @type {{ids: string[], why: string}[]}
 */
export const HOOK_NOT_RUN = [
  {
    ids: ["bring-up-env-gate-proof", "runner-base", "prove-docs", "pre-commit-in-runner-proof"],
    why: "exigem DOCKER e/ou REDE (a imagem do runner, o registry, a execucao real do bring-up): nao cabem num hook local. Rodam nas DUAS pipelines (jobs bring-up-proof e workflow-refs-guard). O `pre-commit-in-runner-proof` entra por aqui pelo motivo mais literal do grupo: ele mede o bloqueio do pre-commit DENTRO do runtime que julga o PR (o `proveCommitBlocks` lancado na imagem do runner) — o hook nao pode rodar a propria prova dentro de uma imagem, e quem prova o hook no runtime do merge e o job `pre-commit-in-runner-proof` das duas forjas.",
  },
  {
    ids: ["bun-audit"],
    why: "`bun audit` consulta o registry de advisory (rede) e leva 10-30s por execucao. O hook roda `check:unused-deps` (le package.json + codigo, sem rede) no lugar do audit completo.",
  },
  {
    ids: ["doctor-ci"],
    why: "compara os espelhos com as repository variables: `vars.*` SO existem no runner do CI — localmente nao ha valor contra o que comparar (e o doctor sai INDETERMINADA, nunca verde).",
  },
  // AQUI ESTAVA o `pipefail-sigpipe` — a entrada saiu porque o hook passou a
  // rodar o guard, e nao porque a decisao foi esquecida. A razao antiga era de
  // CUSTO ("~1s no CI, ruido no caminho de cada commit") e de ESCOPO ("o defeito
  // nao muda por commit de codigo"). As duas foram medidas de novo: o guard
  // custa **0,14s** nesta arvore (129 scripts + 33 workflows), e o defeito MUDA
  // por commit sim — ele nasce de uma reescrita mecanica de scripts/corpos
  // `run:`, que e um commit de codigo. O que mudou de verdade foi a OFERTA: o
  // guard dono ja tinha o remendo (`--fix` -> herestring) e o hook nao o
  // invocava, entao quem introduzia a cicatriz corrigia a mao exatamente a linha
  // que a maquina remenda. Com o comando na fase B, a classe
  // `pipefail-sigpipe` do remedio do pre-commit passa a ser ALCANCAVEL no momento
  // do defeito. O CI continua rodando a varredura inteira (as duas forjas).
  {
    ids: ["job-deps"],
    why: "o veredito e do ESTADO do repositorio inteiro (os 33 workflows das duas forjas e o grafo de imports de cada comando que um job roda): ele muda com um commit de WORKFLOW e tambem com um commit que muda o GRAFO de um script que um job ja rodava — nao existe recorte --staged que cubra as duas metades (um recorte sobre os workflows tocados ficaria cego no import novo de um script). O hook ja roda `bun run check:forge-parity` em TODO commit, que e quem exige a CLASSIFICACAO de um gate novo — e o CI roda o gate em todo PR, nas duas forjas.",
  },
  {
    ids: ["mirror-coverage"],
    why: "mede o commit MUTANDO cada espelho num worktree temporario e rodando os comandos do RECORTE (e o CONTROLE na arvore intacta): custa ~6s e SPAWNA os guards do recorte, entao ele exige as dependencias instaladas — no hook isso poria uma suite de 80 invocacoes no caminho de cada commit, e um `node_modules` faltando viraria INDETERMINADO (exit 2) em vez de veredito. A pergunta que ele responde e sobre o CONTRATO DE MERGE (o commit julga esta linha?), e quem a responde a cada PR sao as duas pipelines: o job `guards` (forja dona do merge) e o job `check` (espelho), os dois com install.",
  },
  {
    ids: ["github-dependencies"],
    why: "mede o INVENTARIO do repositorio inteiro (as 8 classes, das fontes: os 27 workflows, os crons, os `uses:`, as referencias a ghcr.io, os scripts que chamam o `gh`, o plano de configuracao do Actions e os servicos) contra a declaracao em `ci/github-dependencies.json`. O veredito e o do ESTADO da arvore, nao de um commit: um commit que nao toca em nada disso nao muda o numero, e o que muda (um workflow, um cron, uma action, um servico) e um commit de CI/configuracao. Ele e node puro e barato (<0,5s), entao a lacuna e de ESCOPO declarada, nao de custo — e quem a cobre em cada PR sao as duas pipelines (job `guards` na forja dona do merge e `workflow-refs-guard` no espelho).",
  },
  {
    ids: ["merge-latency"],
    why: "mede a pipeline INTEIRA (o grafo de `needs:` + o modelo de duracao), nao o commit: um commit que nao toca a pipeline nem o modelo nao muda o veredito — e nao existe recorte dele, porque o `--check` le os dois arquivos fixos de qualquer jeito. Quem muda o veredito e exatamente o commit de CI/pipeline, e esse o hook ja cobre pelo gate de paridade de gates.",
  },
  {
    ids: ["workflow-refs"],
    why: "relacao entre WORKFLOWS e scripts/package.json (referencia pendurada): so um commit de CI a muda — e nesse caso o hook ja roda o check de PARIDADE DE GATES, que e o gate que pega o efeito.",
  },
  {
    ids: [
      "ts-nocheck",
      "script-headers",
      "hooks-symmetry",
      "secret-leaks",
      "seed-hooks",
      "sentinel-producer",
      "no-setup-bun",
      "pii-gate-self-test",
    ],
    why: "LACUNA DECLARADA, nao impossibilidade: sao node-puros e baratos (<1s cada) e o CI os roda em TODO PR. O hook nao os roda porque esta no caminho de CADA commit — ele e um FILTRO RAPIDO do que o commit muda, nao uma copia do CI. Estar escrito aqui e o que torna a lacuna uma decisao revisavel em vez de um esquecimento.",
  },
]

/** Launchers reconhecidos na extracao (o comando comeca por um deles). */
const LAUNCHER_RE = /^(?:node|bash|sh|bun|bunx|npx|pnpm|yarn|python3?|tsc|prettier|eslint|vitest)\b/

/**
 * Normaliza um comando: tira redirecionamento (`2>&1`, `> arquivo`) e o resto
 * de um pipe. O CI escreve `bun run fuzz:ci > fuzz-results.json` e o hook
 * `bun run fuzz:ci`: sem normalizar, seriam "comandos diferentes" quando sao o
 * mesmo comando com a saida redirecionada.
 *
 * @param {string} command
 * @returns {string}
 */
export function normalizeCommand(command) {
  return command
    .replace(/\s*\d?>\s*\S+/g, " ") // 2>&1, > fuzz-results.json, >> log
    .replace(/\s*\|\s*.*$/, "") // | tail -5, | head -5
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * Os comandos que um hook EXECUTA, normalizados. Ignora comentario, linha
 * vazia e continuacao de shell que nao chama ferramenta (`if`, `for`, `echo`,
 * `local`, atribuicao) — o alvo e o comando, nao o controle de fluxo.
 *
 * @param {string} content  conteudo do hook
 * @returns {string[]}
 */
export function hookCommands(content) {
  const commands = []
  for (const raw of content.split(/\r?\n/)) {
    const trimmed = raw.trim()
    if (trimmed === "" || trimmed.startsWith("#")) continue
    // `( ... ) &` (subshell em background) e `cmd &` → o comando esta dentro.
    const core = trimmed
      .replace(/^\(\s*/, "")
      .replace(/\)\s*&$/, "")
      .replace(/\s*&\s*$/, "")
      .trim()
    if (core === "" || !LAUNCHER_RE.test(core)) continue
    const cmd = normalizeCommand(core)
    if (cmd !== "") commands.push(cmd)
  }
  return commands
}

/**
 * Resolve a ENTRADA do package.json de um comando (`bun run X` / `bun X` -> o
 * script real). E o que torna `bun run check:registry-source` comparavel com
 * `node scripts/check-registry-source.mjs`: sem resolver, os dois lados
 * pareceriam diferentes e a unica saida seria exigir a mesma sintaxe no hook
 * (que tem custo de leitura, nao de veredito — a entrada e um alias).
 *
 * `bun x <pkg>` / `bunx <pkg>` NAO sao entradas (executam um binario): ficam
 * como estao. Profundidade limitada a 3 para uma entrada que aponte para outra
 * nao virar laco.
 *
 * @param {string} command
 * @param {Record<string, string>} scripts  scripts do package.json
 * @param {number} [depth]
 * @returns {string}
 */
export function resolveCommand(command, scripts, depth = 0) {
  const cmd = normalizeCommand(command)
  if (depth > 3) return cmd
  if (/^bun(x)?\s+x\s/.test(cmd)) return cmd
  const m = cmd.match(/^bun\s+(?:run\s+)?([a-z0-9][a-z0-9:_-]*)(\s+.*)?$/)
  if (!m) return cmd
  const alias = scripts[m[1]]
  if (!alias || alias === cmd) return cmd
  return resolveCommand(`${alias}${m[2] ?? ""}`, scripts, depth + 1)
}

/**
 * O INSTRUMENTO de um comando resolvido: o binario ou o script que ele executa
 * (`scripts/check-bun-mirror.mjs`, `prettier`, `vitest`, `tsc`). E o que
 * permite dizer "este recorte e do MESMO gate" — dois comandos com
 * instrumentos diferentes sao dois gates, nao um recorte do outro.
 *
 * @param {string} command  ja resolvido
 * @returns {string}
 */
export function subjectOf(command) {
  const withoutEnv = command.replace(/^[A-Z_][A-Z0-9_]*=\S+\s+/, "")
  const tokens = withoutEnv.split(/\s+/).filter((t) => t !== "")
  if (tokens.length === 0) return ""
  // `bun x <pkg>` e `bunx <pkg>` executam um binario: o instrumento e o pacote.
  if (tokens[0] === "bun" && tokens[1] === "x") return tokens[2] ?? "bun"
  if (tokens[0] === "bunx") return tokens[1] ?? "bunx"
  const LAUNCHERS = new Set([
    "node",
    "bash",
    "sh",
    "bun",
    "bunx",
    "npx",
    "pnpm",
    "yarn",
    "python3",
    "python",
  ])
  let rest = LAUNCHERS.has(tokens[0]) ? tokens.slice(1) : tokens
  // `bun run <binario>`: `run` e o lancador, nao o instrumento. Sem pular os
  // dois, `bun run vitest run` teria por instrumento "run" — e o canonico
  // `vitest run` teria "vitest", o que faria dois comandos do MESMO gate
  // parecerem gates diferentes.
  if (rest[0] === "run") rest = rest.slice(1)
  return rest[0] ?? tokens[0]
}

/** Le um arquivo do root, ou null quando ausente. */
function readOrNull(root, path) {
  const full = join(root, path)
  return existsSync(full) ? readFileSync(full, "utf8") : null
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. O SUB-GUARD DE UM RUNNER — a descida nos scripts que as pipelines chamam
// ═══════════════════════════════════════════════════════════════════════════
//
// O DEFEITO QUE ISTO MEDE: a cobertura local era derivada do comando que a
// pipeline ESCREVE. Quando esse comando e um RUNNER (`bash scripts/x.sh`), tudo
// o que ele executa por dentro ficava sem ninguem: o guard que roda dentro do
// runner entra no contrato de merge e o veredito local nao o ve — nem a decisao
// de nao roda-lo existe. A regra 3 pergunta isso para os invariantes do CORE
// (que sao uma lista declarada, em `check-forge-parity`); aqui a pergunta e
// feita ao que as DUAS pipelines REALMENTE executam, incluindo um nivel (ou
// mais) abaixo do runner — entao um `node scripts/check-novo.mjs` escondido
// dentro de um `.sh` deixa de ser um gate sem dono.
//
// A SUPERFICIE DA DESCIDA E A DO `check-hook-commands` (uma regua so, os mesmos
// primitivos: `SHELL_INTERPRETERS`, `alvosProvaveis`, `variaveisDoArquivo`,
// `MAX_SCRIPT_DEPTH`). O que este guard ACRESCENTA e a EXIGENCIA: todo arquivo
// alcancado tem de ter DECISAO LOCAL — ou o hook o executa (a bateria local,
// medida TAMBEM por descida: o runner `run-encoding-guards.sh` do hook roda os
// guards de encoding, e sem descer o hook nao cobriria o que ele mesmo roda),
// ou o invariante do CORE dele esta declarado em HOOK_NOT_RUN, ou a ausencia
// esta escrita em RUNNER_SUBGUARD com a razao.
//
// O CICLO DE IMPORTS (declarado, e por que ele nao morde): o
// `check-hook-commands.mjs` importa `resolveCommand` DAQUI. Os dois lados so
// chamam as funcoes do outro DEPOIS do init do modulo — nenhum dos dois le o
// outro no topo do arquivo —, entao a ordem de carga nao muda nenhum veredito.
// Uma segunda implementacao da descida seria a divergencia garantida; o ciclo e
// de modulo, o custo de duplica-la seria de veredito.

/**
 * Os interpretadores cujo alvo e um ARQUIVO FOLHA: o guard roda nele e a
 * superficie acaba ali (o que um `.mjs` executa por dentro e o parser de JS, nao
 * o desta descida — a mesma fronteira declarada pelo `check-hook-commands`).
 */
export const LEAF_INTERPRETERS = new Set([
  "node",
  "python3",
  "python",
  "vitest",
  "tsc",
  "prettier",
  "eslint",
])

/**
 * O ARQUIVO que um comando executa — folha (node/python) ou runner (shell) —,
 * ou o motivo de nao dar para prova-lo.
 *
 * `alvosProvaveis` e a regua do SHELL (dono: `check-hook-commands`): ele resolve
 * `bash "$SCRIPT_DIR/x.sh"` pelas atribuicoes do PROPRIO arquivo e ja devolve o
 * caminho relativo a raiz. Para os interpretadores folha a resolucao e a mesma
 * (`$VAR` pelas atribuicoes), com a diferenca de que nao ha descida depois.
 *
 * @param {{programa: string, tokens: string[], linha: number}} comando
 * @param {{atribuicoes: Map<string, {valores: string[]}>, dir: string}} vars
 * @returns {{ok: true, valores: string[]}|{ok: false, motivo: string}}
 */
export function fileTargetOf(comando, vars) {
  if (SHELL_INTERPRETERS.has(comando.programa)) return alvosProvaveis(comando, vars)
  if (!LEAF_INTERPRETERS.has(comando.programa))
    return {
      ok: false,
      motivo: `\`${comando.programa}\` nao executa um arquivo do repositorio (funcao, payload de prova ou binario externo)`,
    }
  const alvo = (comando.tokens ?? []).find((t) => t !== "" && !t.startsWith("-"))
  if (alvo === undefined)
    return { ok: false, motivo: `\`${comando.programa}\` sem alvo: nao ha arquivo a julgar` }
  if (!alvo.startsWith("$")) return { ok: true, valores: [alvo] }
  const provavel = caminhosProvaveis(alvo, vars)
  if (!provavel.ok) return { ok: false, motivo: provavel.motivo }
  return { ok: true, valores: provavel.valores }
}

/**
 * A DESCIDA: os arquivos que um conjunto de scripts de shell executa por dentro.
 *
 * `alcancados` mapeia arquivo → o runner que o executa (a procedencia sai no
 * relatorio: "qual runner trouxe este sub-guard"). `limites` e o outro lado, e
 * ele NAO some: quando o alvo nao da para provar (`bash "$ALVO"` sem atribuicao
 * que o determine, teto de profundidade, runner que nao existe), o que ficou por
 * julgar sai NOMEADO — "nao fui olhar la dentro" nunca e o mesmo que "nao ha
 * nada la dentro".
 *
 * @param {string} root
 * @param {string[]} raizes  runners de partida (relativos ao root)
 * @param {{maxDepth?: number}} [opcoes]
 * @returns {{alcancados: Map<string,string>, limites: {arquivo: string, linha: number,
 *            programa: string, motivo: string}[]}}
 */
export function descendScripts(root, raizes, { maxDepth = MAX_SCRIPT_DEPTH } = {}) {
  const alcancados = new Map()
  const limites = []
  const fila = [...raizes].map((rel) => ({ rel, d: 1 }))
  const vistos = new Set(raizes)
  while (fila.length > 0) {
    const { rel, d } = fila.shift()
    const content = readOrNull(root, rel)
    if (content === null) {
      limites.push({
        arquivo: rel,
        linha: 0,
        programa: "",
        motivo: "o arquivo nao existe neste checkout — nao ha o que descer nele",
      })
      continue
    }
    const vars = variaveisDoArquivo(content, rel)
    for (const comando of shellCommands(content, { origem: rel })) {
      // A superficie e a de um LANCADOR de arquivo: `echo`, `cd`, `cat`, `sed`
      // e as funcoes do proprio script nao escondem guard nenhum — entrar em
      // `limites` seria ruido onde nada se le (e um limite que ninguem le nao e
      // um limite declarado).
      const lancador =
        SHELL_INTERPRETERS.has(comando.programa) || LEAF_INTERPRETERS.has(comando.programa)
      if (!lancador) continue
      const primeiro = (comando.tokens ?? []).find((t) => t !== "" && !t.startsWith("-")) ?? ""
      const apontaParaArquivo =
        primeiro.startsWith("$") ||
        primeiro.startsWith("scripts/") ||
        /\.(?:sh|mjs|py|js|cjs)$/.test(primeiro)
      const r = fileTargetOf(comando, vars)
      if (!r.ok) {
        if (apontaParaArquivo)
          limites.push({
            arquivo: rel,
            linha: comando.linha,
            programa: comando.programa,
            motivo: r.motivo,
          })
        continue
      }
      for (const valor of r.valores) {
        const alvo = valor.startsWith("scripts/")
          ? valor
          : normalize(join(vars.dir || dirname(rel), valor))
        if (alvo.startsWith("..") || !existsSync(join(root, alvo))) continue
        if (!alcancados.has(alvo)) alcancados.set(alvo, rel)
        if (SHELL_INTERPRETERS.has(comando.programa) && alvo.endsWith(".sh") && !vistos.has(alvo)) {
          if (d >= maxDepth) {
            limites.push({
              arquivo: rel,
              linha: comando.linha,
              programa: comando.programa,
              motivo: `teto de profundidade da descida (${maxDepth}) em \`${alvo}\` — o interior dele NAO foi julgado`,
            })
            continue
          }
          vistos.add(alvo)
          fila.push({ rel: alvo, d: d + 1 })
        }
      }
    }
  }
  return { alcancados, limites }
}

/**
 * Os RUNNERS que as duas pipelines chamam — derivados, nunca uma lista a mao.
 *
 * A derivacao passa pela entrada do package.json (`bun run test:mutation-guards`
 * → `bash scripts/test-mutation-guards.sh`): sem ela, o runner mais chamado do
 * contrato de merge nem apareceria como script, e a descida comecaria do lugar
 * errado.
 *
 * @param {string} root
 * @param {Record<string,string>} scripts  scripts do package.json
 * @returns {Map<string,string>} runner → comando da pipeline (o primeiro)
 */
export function pipelineRunners(root, scripts) {
  const runners = new Map()
  for (const file of PIPELINES) {
    const content = readOrNull(root, file)
    if (content === null) continue
    for (const bruto of executedCommands(content)) {
      const resolved = resolveCommand(bruto, scripts)
      const tokens = resolved.split(/\s+/)
      if (!SHELL_INTERPRETERS.has(tokens[0])) continue
      const alvo = tokens[1]
      if (alvo === undefined || !alvo.endsWith(".sh") || alvo.startsWith("/") || alvo.includes("$"))
        continue
      if (!runners.has(alvo)) runners.set(alvo, resolved)
    }
  }
  return runners
}

/**
 * A BATERIA LOCAL: o que os HOOKS executam — e a descida nos runners que eles
 * chamam, pela MESMA regua da descida das pipelines.
 *
 * Sem esta metade a regra seria falsa no caso mais comum: o pre-commit nao roda
 * os 12 guards de encoding um a um, ele chama `run-encoding-guards.sh`. Julgar o
 * caminho do runner e parar ali faria de cada guard que ele executa um "sem
 * decisao local" — e a correcao errada seria DECLARAR de fora o que a bateria
 * local roda de dentro.
 *
 * @param {string} root
 * @param {Record<string,string>} scripts
 * @returns {{arquivos: Map<string,string>, runners: Map<string,string>, limites: object[]}}
 */
export function localBattery(root, scripts) {
  const arquivos = new Map()
  const runners = new Map()
  const raizes = []
  for (const hook of HOOKS) {
    const content = readOrNull(root, hook)
    if (content === null) continue
    for (const cmd of hookCommands(content)) {
      const resolved = resolveCommand(cmd, scripts)
      arquivos.set(subjectOf(resolved), `executado direto por ${hook}`)
      const tokens = resolved.split(/\s+/)
      if (
        SHELL_INTERPRETERS.has(tokens[0]) &&
        tokens[1]?.endsWith(".sh") &&
        !tokens[1].startsWith("$")
      ) {
        if (!runners.has(tokens[1])) runners.set(tokens[1], resolved)
        raizes.push(tokens[1])
      }
    }
  }
  const descida = descendScripts(root, [...new Set(raizes)])
  for (const [arquivo, via] of descida.alcancados) {
    if (!arquivos.has(arquivo)) arquivos.set(arquivo, `pelo runner ${via} (chamado pelo hook)`)
  }
  return { arquivos, runners, limites: descida.limites }
}

/** Os scripts do package.json do root. */
function readScripts(root) {
  const raw = readOrNull(root, "package.json")
  if (raw === null) return null
  try {
    return JSON.parse(raw).scripts ?? {}
  } catch {
    return null
  }
}

/**
 * Todos os comandos de `run:` dos workflows do root (inclui os reusables, que
 * nao estao nas duas pipelines). Usado para PROVAR um `ciMirror`: um espelho
 * declarado que nao existe em workflow nenhum e uma afirmacao sem lastro.
 *
 * @param {string} root
 * @returns {string[]}
 */
export function allWorkflowCommands(root) {
  const commands = []
  // Os diretorios vem da FONTE UNICA (scripts/forge-workflows.mjs): cravar um
  // literal aqui deixaria as outras forjas fora da varredura — foi assim que a
  // pipeline dona do merge ficou fora da cobertura dos guards.
  for (const dir of existingWorkflowDirs(root)) {
    const full = join(root, dir)
    for (const name of readdirSync(full)) {
      if (!WORKFLOW_FILE_RE.test(name)) continue
      // Leitura fail-closed (fonte única): o arquivo que não abre LANÇA com o
      // nome dele, em vez de contribuir zero comando para a comparação.
      const content = readJudgedText(root, `${dir}/${name}`)
      commands.push(...executedCommands(content))
    }
  }
  return commands
}

/**
 * Analisa a paridade hook ↔ CI. Pura em relacao ao filesystem (recebe o root),
 * para poder ser testada contra um fixture.
 *
 * Os campos da regra 4 (`runners`, `subguards`, `limitesDaDescida`,
 * `bateriaLocal`) sao MEDICAO, e nao so relatorio: e por eles que o `--json`
 * publica quais sub-guards de runner existem, de qual runner cada um veio e qual
 * foi a decisao local — um sub-guard decidido por engano e um limite que sumiu
 * ficam visiveis sem ler prosa.
 *
 * @typedef {{file: string, via: string, decision: string|null, invariant: string|null}} Subguard
 * @typedef {{arquivo: string, linha: number, programa: string, motivo: string}} LimiteDaDescida
 * @param {{root?: string}} [args]
 * @returns {{rows: object[], violations: string[], notRun: string[], missing: string[],
 *            subguards: Subguard[], runners: {file: string, command: string}[],
 *            limitesDaDescida: LimiteDaDescida[],
 *            bateriaLocal: {arquivos: string[], runners: {file: string, command: string}[],
 *                           limites: LimiteDaDescida[]}}}
 */
export function analyze({ root = ROOT } = {}) {
  const violations = []
  const scripts = readScripts(root)
  if (scripts === null) {
    return {
      rows: [],
      violations: ["package.json ausente/ilegivel — sem ele nao da para resolver `bun run X`"],
      notRun: [],
      missing: [],
      subguards: [],
      runners: [],
      limitesDaDescida: [],
      bateriaLocal: { arquivos: [], runners: [], limites: [] },
    }
  }

  // ── Os comandos REAIS dos hooks ────────────────────────────────────────
  const occurrences = new Map() // comando → hooks onde aparece
  for (const hook of HOOKS) {
    const content = readOrNull(root, hook)
    if (content === null) {
      violations.push(`${hook}: hook declarado nao existe — se ele foi removido, remova de HOOKS`)
      continue
    }
    for (const cmd of hookCommands(content)) {
      const arr = occurrences.get(cmd) ?? []
      arr.push(hook)
      occurrences.set(cmd, arr)
    }
  }

  // ── Os comandos CANONICOS do CI (as duas pipelines) ───────────────────
  // Duas formas do MESMO comando: o LITERAL (como o workflow o escreve) e a
  // ENTRADA RESOLVIDA. A comparacao tem de ser feita na MESMA base dos dois
  // lados — comparar o comando do hook JA resolvido contra o workflow ainda
  // nao resolvido faz `bun run check:pii-allowlist` (hook) parecer diferente
  // de `bun run check:pii-allowlist` (CI), que sao a mesma linha.
  const rawPipeline = new Set()
  for (const file of PIPELINES) {
    const content = readOrNull(root, file)
    if (content === null) {
      violations.push(`${file}: pipeline do contrato ausente — sem ela nao ha com o que comparar`)
      continue
    }
    for (const c of executedCommands(content).map(normalizeCommand)) rawPipeline.add(c)
  }
  const resolvedPipeline = new Set([...rawPipeline].map((c) => resolveCommand(c, scripts)))
  const isPipeline = (raw, resolved) => rawPipeline.has(raw) || resolvedPipeline.has(resolved)

  const rows = []
  const coveredIds = new Set()

  const canonicalOf = (id) => {
    const inv = CORE_INVARIANTS.find((i) => i.id === id)
    if (!inv) return null
    return resolveCommand(canonicalCommandOf(inv), scripts)
  }

  // Cobertura por IGUALDADE: um invariante cujo comando canonico e executado
  // (resolvido) por algum hook esta coberto sem precisar de declaracao — e a
  // forma mais forte de paridade, porque nao ha dois comandos para divergir.
  const hookResolved = new Set([...occurrences.keys()].map((c) => resolveCommand(c, scripts)))
  for (const inv of CORE_INVARIANTS) {
    if (hookResolved.has(canonicalOf(inv.id))) coveredIds.add(inv.id)
  }

  // 1. Todo comando do hook tem a sua decisao (declaracao OU o comando do CI).
  const matched = new Set()
  for (const [cmd, hooks] of occurrences) {
    const resolved = resolveCommand(cmd, scripts)
    const entry = HOOK_DECLARED.find((d) => d.match.test(cmd))
    const isPipelineCommand = isPipeline(cmd, resolved)

    if (entry) {
      matched.add(entry)
      const why = (entry.why ?? "").trim()
      let status = "local"
      let of = null

      if (entry.of) {
        const inv = CORE_INVARIANTS.find((i) => i.id === entry.of)
        if (!inv) {
          violations.push(
            `${cmd}: declarado como recorte do invariante '${entry.of}', que NAO existe no CORE — a declaracao aponta para o vazio`,
          )
        } else {
          coveredIds.add(inv.id)
          of = inv.id
          const canonical = canonicalOf(inv.id)
          if (resolved === canonical) {
            status = "mesmo-comando"
          } else if (subjectOf(resolved) === subjectOf(canonical)) {
            status = "recorte"
          } else {
            violations.push(
              `${cmd}: declarado como recorte de '${inv.id}', mas o INSTRUMENTO e outro — o canonico e \`${canonical}\` (${subjectOf(canonical)}) e este comando usa ${subjectOf(resolved)}. Um recorte executa o MESMO instrumento com outro escopo; outro instrumento e outro gate.`,
            )
          }
        }
      } else if (entry.ciMirror) {
        const mirror = resolveCommand(entry.ciMirror, scripts)
        const exists = allWorkflowCommands(root)
          .map(normalizeCommand)
          .some((c) => c.includes(entry.ciMirror))
        if (!exists) {
          violations.push(
            `${cmd}: ciMirror '${entry.ciMirror}' nao aparece como comando em workflow nenhum — espelho declarado sem lastro`,
          )
        }
        if (resolved === mirror) status = "mesmo-comando"
        else if (subjectOf(resolved) === subjectOf(mirror)) status = "recorte"
        else
          violations.push(
            `${cmd}: ciMirror '${entry.ciMirror}' usa outro instrumento (${subjectOf(mirror)} vs ${subjectOf(resolved)}) — nao e o mesmo gate`,
          )
      }

      if (status !== "mesmo-comando") {
        if (why.length < 40) {
          violations.push(
            `${cmd}: ${status} SEM razao escrita (ou curta demais) — o hook mede outra coisa que o CI e ninguem sabe por que. Escreva o por que no campo 'why' de HOOK_DECLARED.`,
          )
        }
        if (status === "local" && isPipelineCommand) {
          violations.push(
            `${cmd}: declarado como LOCAL, mas o CI executa EXATAMENTE este comando — a declaracao mente. Use o comando do CI (sem declaracao) ou declare o invariante.`,
          )
        }
      }
      rows.push({ cmd, hooks, resolved, status, of, why: entry.why ?? null })
    } else if (isPipelineCommand) {
      // O hook roda o MESMO comando do CI: nao ha veredito a divergir.
      rows.push({ cmd, hooks, resolved, status: "mesmo-comando", of: null, why: null })
    } else {
      rows.push({ cmd, hooks, resolved, status: "nao-declarado", of: null, why: null })
      violations.push(
        `${cmd} (${hooks.join(", ")}): comando NAO DECLARADO e diferente do CI. Um hook que roda outra coisa que o CI tem dois vereditos: declare em HOOK_DECLARED (recorte com razao) ou use o comando do CI.`,
      )
    }
  }

  // 2. Declaracao STALE: entrada que nao casa com nenhum comando do hook.
  for (const entry of HOOK_DECLARED) {
    if (matched.has(entry)) continue
    violations.push(
      `${entry.match}: entrada de HOOK_DECLARED que NAO casa com nenhum comando dos hooks — ou o comando saiu do hook (remova a decisao), ou mudou de forma (a declaracao envelheceu e nao mede mais nada)`,
    )
  }

  // 3. COBERTURA: invariante do CORE no hook ou em HOOK_NOT_RUN — nunca nos dois.
  const notRunIds = new Set()
  for (const group of HOOK_NOT_RUN) {
    for (const id of group.ids) {
      if (!CORE_INVARIANTS.some((i) => i.id === id)) {
        violations.push(`HOOK_NOT_RUN: id '${id}' nao existe no CORE`)
        continue
      }
      if (notRunIds.has(id)) {
        violations.push(`HOOK_NOT_RUN: id '${id}' listado duas vezes`)
        continue
      }
      notRunIds.add(id)
      if (coveredIds.has(id)) {
        violations.push(
          `HOOK_NOT_RUN: '${id}' esta declarado como NAO rodando no hook, mas um comando do hook o executa — a classificacao mente`,
        )
      }
    }
  }

  const missing = []
  for (const inv of CORE_INVARIANTS) {
    if (!coveredIds.has(inv.id) && !notRunIds.has(inv.id)) missing.push(inv.id)
  }
  for (const id of missing) {
    violations.push(
      `invariante do CORE '${id}' nao roda em nenhum hook e nao esta declarado em HOOK_NOT_RUN — decida: o hook roda este gate (HOOK_DECLARED) ou nao roda (HOOK_NOT_RUN, com a razao). Um gate do contrato de merge nao pode entrar em silencio.`,
    )
  }

  // ── 4. O SUB-GUARD DE UM RUNNER ─────────────────────────────────────────
  //
  // A cobertura local ate aqui e dos comandos que a pipeline ESCREVE. Quando o
  // comando e um runner, o que ele executa por dentro nao tinha dono: nem o
  // hook, nem HOOK_NOT_RUN, nem HOOK_DECLARED falavam dele. A descida (mesma
  // regua do `check-hook-commands`) fecha isso: todo arquivo alcancado dentro
  // dos runners das DUAS pipelines exige decisao local.
  const runners = pipelineRunners(root, scripts)
  const descida = descendScripts(root, [...runners.keys()])
  const local = localBattery(root, scripts)
  // O nome do invariante pelo INSTRUMENTO (o mesmo subject do resto do guard):
  // e por ele que "este arquivo e o gate X" pode ser afirmado sem uma segunda
  // tabela de correspondencia.
  const invarianteDoArquivo = new Map()
  for (const inv of CORE_INVARIANTS) {
    const canonica = canonicalOf(inv.id)
    if (canonica !== null) invarianteDoArquivo.set(subjectOf(canonica), inv.id)
  }
  const declarados = new Set()
  const subguards = []
  for (const [arquivo, via] of [...descida.alcancados].sort()) {
    const inv = invarianteDoArquivo.get(arquivo) ?? null
    const localmente = local.arquivos.get(arquivo) ?? null
    let decisao = null
    if (localmente) decisao = `hook: ${localmente}`
    else if (inv !== null && notRunIds.has(inv)) decisao = `HOOK_NOT_RUN: '${inv}'`
    else if (RUNNER_SUBGUARD.some((e) => e.file === arquivo)) decisao = "RUNNER_SUBGUARD"
    subguards.push({ file: arquivo, via, decision: decisao, invariant: inv })
    if (decisao === null) {
      const comando = runners.get(via) ?? via
      violations.push(
        `${arquivo}: SUB-GUARD do runner \`${via}\` (o CI o executa por \`${comando}\`) NAO tem decisao local — o veredito do merge o roda e o veredito local nao o ve. Decida: rode-o no hook (uma entrada em HOOK_DECLARED), ou declare a ausencia em RUNNER_SUBGUARD com a razao.`,
      )
    }
    if (decisao === "RUNNER_SUBGUARD") declarados.add(arquivo)
  }
  // A declaracao STALE, na outra direcao: uma entrada de RUNNER_SUBGUARD que
  // nenhum sub-guard alcancado usa e uma decisao que envelheceu (o arquivo saiu
  // do runner, ou o runner saiu da pipeline) — e ela continuaria autorizando a
  // ausencia de um sub-guard que ja nao existe.
  for (const entrada of RUNNER_SUBGUARD) {
    if (declarados.has(entrada.file)) continue
    violations.push(
      `RUNNER_SUBGUARD: '${entrada.file}' nao e sub-guard de nenhum runner das pipelines — ou ele saiu do runner, ou o runner saiu do contrato: remova a declaracao (ela nao mede mais nada).`,
    )
  }
  // Uma declaracao sem razao escrita e uma ausencia autorizada por ninguem.
  for (const entrada of RUNNER_SUBGUARD) {
    if ((entrada.why ?? "").trim().length < 40) {
      violations.push(
        `RUNNER_SUBGUARD: '${entrada.file}' sem razao escrita (ou curta demais) — a ausencia de um sub-guard no veredito local precisa dizer POR QUE ele fica de fora.`,
      )
    }
  }

  return {
    rows,
    violations,
    notRun: [...notRunIds].sort(),
    missing,
    subguards,
    runners: [...runners.entries()].map(([file, command]) => ({ file, command })),
    limitesDaDescida: descida.limites,
    bateriaLocal: {
      arquivos: [...local.arquivos.keys()].sort(),
      runners: [...local.runners.entries()].map(([file, command]) => ({ file, command })),
      limites: local.limites,
    },
  }
}

// ── modo CLI (so quando invocado diretamente, nao quando importado) ────────
const isMain =
  !!process.argv[1] && process.argv[1].split(/[\\/]/).pop() === "check-hook-ci-parity.mjs"

if (isMain) {
  const rootIdx = process.argv.indexOf("--root")
  if (rootIdx !== -1 && !process.argv[rootIdx + 1]) {
    console.error("check-hook-ci-parity: ❌ --root exige um diretorio (fail-closed)")
    process.exit(2)
  }
  const root = rootIdx !== -1 ? resolve(process.argv[rootIdx + 1]) : ROOT
  // Um workflow que não abre NÃO vira "nenhum comando": a varredura é a
  // compartilhada (fonte única), o arquivo sai NOMEADO e o guard para com 2
  // antes de comparar hook × CI — comparar contra um escopo que não foi lido
  // produziria "comando não encontrado no CI" por um motivo que não é do autor.
  exitOnUnjudgeable(readWorkflowScan(root).unjudgeable)
  const json = process.argv.includes("--json")
  const report = analyze({ root })

  if (json) {
    console.log(JSON.stringify({ ...report, hookCount: HOOKS.length }, null, 2))
    process.exit(report.violations.length === 0 ? 0 : 1)
  }

  const ICON = {
    "mesmo-comando": "✅",
    recorte: "◐",
    local: "○",
    "nao-declarado": "❌",
  }
  console.log("\n  Hooks locais x CI — o veredito de cada comando:\n")
  for (const row of report.rows) {
    const tag = row.of ? ` [${row.of}]` : ""
    console.log(`  ${ICON[row.status] ?? "?"} ${row.status.padEnd(14)}${tag.padEnd(18)} ${row.cmd}`)
    for (const h of row.hooks) console.log(`        em ${h}`)
  }
  console.log(
    `\n  ${CORE_INVARIANTS.length - report.missing.length - report.notRun.length}/${CORE_INVARIANTS.length} invariantes do CORE rodam no hook (os demais declarados em HOOK_NOT_RUN).`,
  )

  // ── O SUB-GUARD DE UM RUNNER ──────────────────────────────────────────
  console.log("\n  O SUB-GUARD DE UM RUNNER — a descida nos scripts que as pipelines chamam:\n")
  console.log(
    `  ${report.runners.length} runner(s) chamado(s) pelo CI · ${report.subguards.length} sub-guard(s) alcancado(s) · ${report.bateriaLocal.arquivos.length} arquivo(s) na bateria local (com descida)`,
  )
  for (const s of report.subguards) {
    const marca = s.decision === null ? "❌" : "✅"
    console.log(`  ${marca} ${s.file}   ← ${s.via}`)
    console.log(`        decisao local: ${s.decision ?? "NENHUMA — violacao"}`)
  }
  for (const l of report.limitesDaDescida) {
    console.log(
      `  ⚠️  NAO DESCENDIDO ${l.arquivo}${l.linha ? `:${l.linha}` : ""} (${l.programa || "arquivo"}) — ${l.motivo}`,
    )
  }

  if (report.violations.length === 0) {
    console.log(
      "check-hook-ci-parity: ✅ todo comando dos hooks e o MESMO do CI, ou um recorte/local com decisao escrita.\n",
    )
    process.exit(0)
  }
  console.error("check-hook-ci-parity: ❌ os comandos dos hooks divergem do CI:")
  for (const v of report.violations) console.error(`  - ${v}`)
  console.error(
    "\nDois conjuntos de comandos para o mesmo merge divergem em silencio: o sintoma e 'passou aqui e quebrou la' — ou 'travou aqui e nem era o gate do CI'.",
  )
  process.exit(1)
}
