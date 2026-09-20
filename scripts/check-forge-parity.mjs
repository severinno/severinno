#!/usr/bin/env node

// =============================================================================
// check-forge-parity.mjs
//
// Usage:
//   node scripts/check-forge-parity.mjs
//   node scripts/check-forge-parity.mjs --gates      # lista os gates descobertos
//   node scripts/check-forge-parity.mjs --root X     # fixture (mutation test)
//
// Exit code:
//   0 — classificacao completa e paridade do CORE mantida
//   1 — gate nao classificado, invariante do CORE ausente ou classificacao stale
//   2 — uma pipeline DECLARADA em PIPELINES existe mas NAO PODE SER JULGADA
//       (ilegivel, nao e UTF-8, ou nao faz parsing em YAML): sem ler o contrato
//       nao ha veredito de paridade a cunhar
//
// A LEITURA E FAIL-CLOSED pelo `readJudgedFile` (a mesma do resto do repositorio).
// O `readFileSync(..., "utf8")` cru deste guard trocava byte invalido por U+FFFD
// e julgava um texto que ninguem escreveu — e um YAML que nao faz parsing era
// lido LINHA a LINHA como se fosse um workflow. Os dois casos davam o mesmo
// desfecho: "0 violacoes de paridade" sobre um contrato que o guard nao leu.
//
// Guard da PARIDADE DE GATES entre a forja que e dona do merge (Gitea/Forgejo,
// .gitea/workflows/ci.yml) e o espelho no GitHub (.github/workflows/pr-check.yml)
// — E, principalmente, da COMPLETUDE da classificacao.
//
// POR QUE: o projeto migra o contrato de bloqueio para a forja self-hosted,
// mantendo o GitHub como espelho. Nesse desenho, um gate que existe em UMA
// pipeline e nao na outra e um BURACO SILENCIOSO: o PR passa verde pela pipeline
// que roda e ninguem percebe que a invariante nao foi verificada.
//
// A PRIMEIRA VERSAO DESTE GUARD TINHA UM DEFEITO DE RACIOCINIO, e ele vale
// ficar registrado porque e o que este arquivo passou a impedir: o guard
// comparava as pipelines contra uma lista CORE escrita A MAO. A lista tinha 10
// itens; o pr-check.yml executava ~30 gates. Os ~20 restantes eram invisiveis
// ao guard — e ele passava VERDE, dando a impressao de que a forja bloqueava o
// merge. Na pratica faltavam na forja, entre outros, a auditoria de dependencias
// (`check-bun-audit-baseline`), a baseline de segredos (`rotate-secrets --check`)
// e o guard de hooks de seed. Um guard que da falsa seguranca e pior que guard
// nenhum: converte "nao verificado" em "parece verificado".
//
// CORRECAO: o guard DESCOBRE os gates das duas pipelines e exige que cada um
// esteja classificado. Tres desfechos possiveis para um gate:
//   - CORE         → precisa rodar nas DUAS pipelines;
//   - GITHUB_ONLY  → isento, COM RAZAO ESCRITA (nao pode rodar na forja);
//   - nada         → VIOLACAO. Um gate novo adicionado ao pr-check.yml Nao
//                    consegue pular a forja em silencio: o PR falha ate alguem
//                    classifica-lo. E a mesma logica do check:required-checks
//                    (um required check inexistente nao falha, ele ESPERA).
//
// O QUE CONTA COMO GATE (regra declarada, nao lista a mao):
//   1. `scripts/<nome>` cujo basename comeca com check-, validate-, audit-,
//      test-mutation- ou run-;
//   2. qualquer comando com `--check`/`--ci` (modo de verificacao explicito) —
//      cobre `rotate-secrets.mjs --check`, que nao segue o prefixo;
//   3. `bun run <entry>` com entry check:/validate:/test-mutation:/lint/test:*;
//   4. `tsc --noEmit` (typecheck);
//   5. `uses: ./<forge>/workflows/<arquivo>.yml` (workflow reutilizavel local =
//      ponto de entrada de gates);
//   6. `bun run <x>:prove` / `node scripts/prove-*.mjs` — a familia das PROVAS
//      por EXECUCAO ("o comportamento e este", medido rodando o caminho real).
//      Entram pelo mesmo motivo das outras: uma prova que roda numa forja e nao
//      na outra deixa o PR verde por onde rodou.
// Plumbing (install, db:generate, build, docker ...) NAO e gate: nao declara
// verificacao. Se um comando de verificacao nao se encaixa, ele entra por
// `--check` ou por um novo prefixo aqui — nunca por uma excecao ad hoc.
//
// Invariantes:
//   1. Todo gate descoberto esta classificado (nada de gate invisivel).
//   2. Todo invariante do CORE roda nas DUAS pipelines.
//   3. Um gate classificado como GITHUB_ONLY nao roda na forja (classificacao
//      que envelheceu e vira ruido/mentira — tem que ser corrigida).
//   4. Comentarios sao ignorados (o guard protege o que EXECUTA).
//   5. O CANAL DO REMEDIO roda nas DUAS forjas, UMA vez cada, com o backend DA
//      forja, com a cobertura do REGISTRO (`--all` — nao uma lista de fixers a
//      mao) e com o MESMO comando canonico nas duas (o backend e o unico
//      argumento que muda).
//
// POR QUE A REGRA 5 EXISTE (o canal nao e gate, e era invisivel AQUI):
// `scripts/pr-remedy-comment.mjs` nao verifica nada — ele PUBLICA o patch do
// remendo no PR —, entao ele nao entra em `discoverGates`/`CORE_INVARIANTS` e
// nenhuma das regras 1-4 o alcancava. A cobertura dele vinha de uma lista escrita
// nos DOIS workflows (um passo por fixer): um fixer novo so chegava ao PR se
// alguem lembrasse de copiar o passo nas duas pontas, e o `--backend` errado
// (passo copiado de uma forja para a outra) publicaria no canal errado, com o
// token errado, sem nenhum veredito. Agora o passo invoca o REGISTRO
// (`--all`, o conjunto sai de `FIXERS`) e esta regra mede as duas pontas: e ela
// que faz "um fixer novo herda o passo do CI" valer como FATO, e nao como
// promessa de quem lembrar de editar dois arquivos.
// =============================================================================

import { existsSync } from "node:fs"
import { join, resolve } from "node:path"

import {
  defaultsRunLines,
  executableLine,
  executableLines,
  exitOnUnjudgeable,
  readJudgedFile,
  workflowRunBodies,
  workflowYamlValidity,
} from "./forge-workflows.mjs"

// O REGISTRO de fixers do canal do remédio — a fonte única da COBERTURA. O
// guard o importa de propósito: a régua da paridade não pode ser uma lista à mão
// de fixers (ela envelheceria no primeiro fixer novo, que é exatamente o que
// esta regra existe para impedir).
import { FIXERS } from "./pr-remedy-comment.mjs"

const ROOT = process.cwd()

/**
 * Pipelines comparadas. `mergeOwner` marca a forja que deve BLOQUEAR o merge
 * (ela e a referencia do desenho; o GitHub e espelho).
 */
export const PIPELINES = [
  {
    forge: "gitea",
    file: ".gitea/workflows/ci.yml",
    mergeOwner: true,
  },
  {
    forge: "github",
    file: ".github/workflows/pr-check.yml",
    mergeOwner: false,
  },
]

// ── Descoberta de gates ────────────────────────────────────────────────────

const SCRIPT_INVOCATION_RE =
  /\b(?:node|bun|bash|sh|python3?)\s+(scripts\/[A-Za-z0-9_./-]+\.(?:mjs|sh|py))/g
const ENTRY_RE = /\bbun\s+run\s+([a-z0-9][a-z0-9:_-]*)/g
const REUSABLE_RE = /uses:\s*(\.\/\.[A-Za-z0-9_.-]+\/workflows\/[A-Za-z0-9_.-]+\.ya?ml)/g

/** Prefixos de basename de script que declaram verificacao. */
export const GATE_SCRIPT_PREFIX_RE = /^(check|validate|audit|test-mutation|run|prove)-/

/** Prefixos de entry do package.json que declaram verificacao. */
export const GATE_ENTRY_PREFIX_RE = /^(check|validate|test-mutation):/

/**
 * Entries de PROVA POR EXECUCAO (`<contexto>:prove`).
 *
 * O prefixo NAO pode ser `check:`: `runner-image:prove` nomeia o CONTEXTO que a
 * prova exercita, nao a familia do comando — renomea-lo para caber na lista
 * anterior seria ajustar o nome ao guard, e nao o guard ao nome.
 */
export const GATE_ENTRY_PROVE_RE = /^[a-z0-9][a-z0-9-]*:prove$/

/**
 * Entries estruturais (as invariantes basicas de qualquer projeto).
 *
 * `typecheck` entra aqui pelo mesmo motivo de `lint`/`test:run`: o comando tem
 * de viver em UM lugar (o script do package.json) e as duas forjas o INVOCAM —
 * um `bunx tsc --noEmit` escrito em cada pipeline e uma segunda regua, e foi
 * assim que o heap deste repositorio divergiu entre elas (o NODE_OPTIONS vivia
 * so no step do GitHub: o mesmo commit podia estourar a memoria na forja dona
 * do merge e passar no espelho).
 */
export const STRUCTURAL_ENTRIES = ["lint", "typecheck", "test:unit", "test:run", "test:ci"]

/** Modo de verificacao explicito — promove o comando a gate. */
const CHECK_FLAG_RE = /--(?:check|ci)\b/

/** Corpo de `run:` em bloco (`|`, `>`, `|-` ...) — o comando nao esta na linha. */
const BLOCK_RUN_RE = /^[|>][-+]?\d*$/

/** Typecheck: `bunx tsc --noEmit` / `tsc --noEmit`. */
const TSC_RE = /\btsc\s+--noEmit\b/

/**
 * A REGUA DE LINHA vem de `forge-workflows.mjs` — comentario (linha e fim de
 * linha) e expressao dinamica do runner (`${{ ... }}`) mascarada. Era uma
 * implementacao AQUI e outra no `check-workflow-refs`; a correcao do comentario
 * de fim de linha teve de ser aplicada duas vezes, e as duas reguas ja
 * divergiam num ponto (so o de refs mascarava `${{ }}`). Reexportada para nao
 * quebrar quem importa daqui (testes e guards) — a fonte e uma so.
 */
export { executableLines }

/**
 * As linhas EXECUTAVEIS de um workflow — a leitura unica DESTE guard.
 *
 * `defaults.run` e DECLARACAO (o shell default do arquivo ou do job), nunca
 * passo: sem excluir as linhas dela, `defaults: run: node scripts/check-x.mjs`
 * entrega o rotulo de um gate que a pipeline nao roda, e `defaults:\n  run: bash`
 * vira o COMANDO literal "bash". Um lugar so para a exclusao, porque ela era
 * repetida em cada consumidor (tres deles hoje: a descoberta de gates, a regua
 * de comando e o canal do remedio) e uma exclusao que depende de todos
 * lembrarem dela e a mesma classe de defeito que este guard persegue.
 *
 * @param {string} content
 * @returns {string[]}
 */
function linhasExecutaveis(content) {
  return executableLines(content.split(/\r?\n/), defaultsRunLines(content))
}

/**
 * Descobre os gates executados por uma pipeline. Retorna rotulos legiveis (o
 * proprio comando normalizado), que sao o que a classificacao casa.
 *
 * @param {string} content  conteudo do arquivo de workflow
 * @returns {string[]} rotulos ordenados e unicos
 */
export function discoverGates(content) {
  const gates = new Set()
  const linhas = linhasExecutaveis(content)
  for (const line of linhas) {
    for (const m of line.matchAll(SCRIPT_INVOCATION_RE)) {
      const path = m[1]
      const base = path.split("/").pop()
      // Gate por convencao de nome OU por modo de verificacao explicito.
      if (GATE_SCRIPT_PREFIX_RE.test(base) || CHECK_FLAG_RE.test(line)) gates.add(path)
    }
    for (const m of line.matchAll(ENTRY_RE)) {
      const entry = m[1]
      if (
        GATE_ENTRY_PREFIX_RE.test(entry) ||
        STRUCTURAL_ENTRIES.includes(entry) ||
        GATE_ENTRY_PROVE_RE.test(entry)
      ) {
        gates.add(`bun run ${entry}`)
      }
    }
    for (const m of line.matchAll(REUSABLE_RE)) gates.add(`uses: ${m[1]}`)
    if (TSC_RE.test(line)) gates.add("tsc --noEmit")
  }
  return [...gates].sort()
}

/**
 * Os COMANDOS que a pipeline EXECUTA — uma entrada por linha de `run:`.
 *
 * E o complemento de `discoverGates`: aquele responde "QUE gates a pipeline
 * tem?" (rotulos para classificar), este responde "COMO cada um e invocado?"
 * (o literal, argumentos inclusos). A regua de cada invariante e ancorada neste
 * segundo dado, porque e ele que decide o veredito: `node scripts/x.mjs` e
 * `node scripts/x.mjs --so-um-modo` sao o mesmo gate com recortes diferentes.
 *
 * O bloco multi-linha (`run: |`/`run: >`) NAO entra: o comando nao esta na
 * linha, e adivinhar o corpo faria a presenca ser medida por um texto que a
 * pipeline nao executa como uma linha so.
 *
 * @param {string} content  conteudo do arquivo de workflow
 * @returns {string[]} comandos, na ordem em que aparecem
 */
export function runCommands(content) {
  return runKeyCommands(content)
}

/**
 * O que a pipeline EXECUTA, linha a linha: todo corpo de `run:` — escalar
 * (com as continuacoes DOBRADAS que o YAML junta) e bloco (`|`/`>`) — com
 * comentario e expressao dinamica fora.
 *
 * E a regua do VEREDITO de invariante: `missingInvariants` pergunta "este
 * comando EXECUTA nesta pipeline?", e a resposta nao pode depender de o autor
 * ter escrito o gate em `run: cmd` ou dentro de um `run: |`.
 *
 * POR QUE ELA SUBSTITUIU `runCommands` NO VEREDITO: `runCommands` le UMA linha
 * por chave `run:` e DELIBERADAMENTE pula o indicador de bloco ("o comando nao
 * esta na linha"). O efeito medido era o mesmo YAML com dois vereditos dentro
 * deste arquivo: `discoverGates` (rotulo, varre todas as linhas executaveis)
 * via o gate DENTRO do bloco, e `runCommands` (comando) nao via — oito
 * workflows tinham gate invocado so dentro de `run: |` sem comando
 * correspondente. Uma invariante do CORE invocada ali era relatada como AUSENTE
 * (violacao falsa) enquanto o proprio arquivo ja a tinha reconhecido como
 * presente.
 *
 * `runCommands` continua existindo porque responde OUTRA pergunta ("qual e o
 * literal do `run:` deste passo?"), que e o que o `bench-guard-timing` mede por
 * comando e o que o `check-hook-ci-parity` compara com o hook.
 *
 * @param {string} content
 * @returns {string[]} linhas executaveis dos corpos de `run:`, na ordem
 */
export function executedCommands(content) {
  const out = []
  for (const passo of workflowRunBodies(content)) {
    for (const linha of passo.body.split("\n")) {
      const cmd = executableLine(linha).trim()
      if (cmd !== "") out.push(cmd)
    }
  }
  return out
}

function runKeyCommands(content) {
  const commands = []
  // Mesma leitura do `discoverGates`: a declaracao `defaults.run` nao produz
  // comando — `defaults:\n  run: bash` virava o comando literal "bash", e a
  // regua canonica de uma invariante podia vir de uma linha que nao roda nada.
  const linhas = linhasExecutaveis(content)
  for (const line of linhas) {
    // A indentacao faz parte da linha (executableLines preserva a coluna), entao
    // a chave pode vir depois de espacos — e o item de lista (`- run: cmd`) e a
    // forma que ja deixou um gate INVISIVEL para outro parser deste repositorio.
    const m = line.match(/^\s*(?:-\s*)?run:\s*(.+)$/)
    if (!m) continue
    const cmd = m[1].trim()
    if (cmd === "" || BLOCK_RUN_RE.test(cmd)) continue
    commands.push(cmd)
  }
  return commands
}

// ── Classificacao ──────────────────────────────────────────────────────────

/**
 * Invariantes que DEVEM rodar nas duas pipelines: agnosticas de forja e capazes
 * de quebrar o software (correcao) ou a seguranca se puladas.
 *
 * CADA INVARIANTE TEM DUAS REGUAS, e elas respondem perguntas DIFERENTES:
 *
 *   `matches` — IDENTIDADE do gate. Testado contra o ROTULO que `discoverGates`
 *     devolve (`scripts/check-x.mjs`, `bun run check:x`, `tsc --noEmit`), por
 *     isso aceita as duas sintaxes. Responde "este gate esta classificado?"
 *     (`classifyGate`). E deliberadamente FROUXO: aqui nao se decide veredito
 *     de merge — so se o gate foi nomeado.
 *
 *   `command` — O COMANDO CANONICO, com argumentos, ancorado nas duas pontas.
 *     Testado contra as linhas de `run:` das DUAS pipelines (`missingInvariants`)
 *     E contra o `run:` do job exigido no manifesto (`forge-doctor.mjs`,
 *     `coreGateContracts`). E ele que faz "um comando so nas duas forjas" ser
 *     uma invariante MEDIDA e nao uma promessa: `node scripts/x.mjs` e
 *     `node scripts/x.mjs --outro-modo` sao o mesmo gate invocado com reguas
 *     diferentes — e o lado mais fraco liberava o merge.
 *
 * UM COMANDO SO, SEM REGUA POR FORJA: quando as duas pipelines divergiam
 * (`bunx tsc --noEmit` de um lado e `bun run typecheck` do outro; `test:unit`
 * numa e `test:run` na outra), o mesmo commit tinha dois vereditos. A tabela
 * `matchesByForge` existiu aqui para DESCREVER essa diferenca como se ela fosse
 * um contrato; o que ela fazia era legitima-la. Hoje a regua e um literal so —
 * o `command` — presente nas DUAS pipelines, e o job exigido no manifesto roda
 * exatamente ele.
 *
 * `jobIds` mapeia a invariante ao(s) job(s) correspondentes no manifesto de
 * merge (`ci/required-checks.json`), por forja. Quando um job e composto (ex.:
 * o `guards` da Gitea que roda varios scripts), a invariante aponta para esse
 * job e o doctor confere se o COMANDO do gate aparece na linha `run:` dele.
 * Invariantes sem `jobIds` (ex.: as que rodam so no GitHub como mutation tests)
 * sao verificadas apenas pelo classifyGate — o contrato de merge nao as lista
 * como jobs individuais.
 *
 * @type {{ id: string, matches: RegExp, command: RegExp, why: string,
 *   jobIds?: Record<string, string> }[]}
 */
export const CORE_INVARIANTS = [
  {
    id: "typecheck",
    matches: /^bun run typecheck$|tsc --noEmit/,
    command: /^bun run typecheck$/m,
    why: "tipo errado que compila e o modo classico de bug silencioso em producao",
    jobIds: { gitea: "typecheck", github: "typecheck" },
  },
  {
    id: "lint",
    // Flag `m`: o mesmo regex e testado contra o ROTULO de um gate (linha unica)
    // E contra o conteudo inteiro da pipeline (multi-linha) em missingInvariants.
    matches: /^bun run lint$/,
    command: /^bun run lint$/m,
    // UM COMANDO SO, NAS DUAS FORJAS — SEM REGUA POR FORJA.
    //
    // A regua (prettier --check + `eslint . --max-warnings 0`) vive no script
    // `lint` do package.json, e as duas forjas rodam exatamente `bun run lint`:
    // mesma entrada, um veredito so. Antes o par estava INLINE no job
    // `lint-guard` do GitHub e o `lint` do package.json era so `eslint .` (sem
    // o teto de warnings, sem prettier) — o mesmo commit passava no merge da
    // Gitea e era rejeitado no GitHub, e quem decidia o merge era o lado LAXO.
    // A tabela `matchesByForge` existia para descrever essa diferenca como se
    // ela fosse um contrato; o que ela fazia era legitimar o furo. Hoje o
    // `matches` responde "o lint esta na pipeline?" e o doctor responde "o job
    // EXIGIDO roda ESTE comando?" — sem uma segunda regua para manter em
    // sincronia (`scripts/forge-doctor.mjs`, `coreGateContracts`).
    why: "regra de lint que so existe no editor deixa o repositorio divergir do padrao",
    jobIds: { gitea: "lint", github: "lint-guard" },
  },
  {
    id: "tests",
    matches: /^bun run test:(run|unit|ci)$/,
    command: /^bun run test:run$/m,
    why: "a suite e a rede de seguranca das outras invariantes",
    jobIds: { gitea: "test", github: "check" },
  },
  {
    id: "ts-nocheck",
    matches: /check[:-]ts[:-]nocheck/,
    command: /^bun run check:ts-nocheck$/m,
    why: "@ts-nocheck desliga a verificacao de tipos do arquivo — a porta dos fundos do typecheck",
    jobIds: { gitea: "guards", github: "check" },
  },
  {
    id: "pii-allowlist",
    matches: /check[:-]pii[:-]allowlist/,
    command: /^bun run check:pii-allowlist$/m,
    why: "vazamento de campo sensivel em payload de usuario (CPF/e-mail/endereco)",
    jobIds: { gitea: "test", github: "pii-allowlist-guard" },
  },
  {
    id: "pii-gate-self-test",
    matches: /check[:-]pii[:-]gate/,
    command: /^bun run check:pii-gate$/m,
    why: "sem a auto-prova, o guard de PII pode estar verde por nunca ter disparado",
    jobIds: { gitea: "test", github: "pii-allowlist-guard" },
  },
  {
    id: "job-deps",
    // O job que roda comando dependente de `node_modules` sem INSTALAR tem o
    // verde sustentado pelo AMBIENTE (o `node_modules` da imagem do runner ou de
    // um workspace reusado): a mesma linha `node scripts/X.mjs` sai 2 ("NAO
    // JULGAVEL") num runner limpo, e oito guards do repositorio dependem de
    // `js-yaml`. E um invariante do CORE porque o defeito e ASSIMETRICO por
    // forja: a forja (dona do merge) instala no job `guards`; os jobs do espelho
    // rodavam os mesmos guards sem install, com a prosa "node puro, sem bun
    // install" que ninguem confere. O gate verific a isencao declarada contra o
    // grafo de imports do comando — uma isencao que diz "nao precisa" para um
    // `import` de topo e provadamente falsa.
    matches: /check[:-]job[:-]deps/,
    command: /^node scripts\/check-job-deps\.mjs$/m,
    why: "sem o gate, o verde de um job sem install fica sustentado por um node_modules que ninguem declarou — e a falha so aparece quando o runner esta limpo",
    jobIds: { gitea: "guards", github: "workflow-refs-guard" },
  },
  {
    id: "required-checks",
    matches: /check[:-]required[:-]checks/,
    command: /^node scripts\/check-required-checks\.mjs$/m,
    why: "required check inexistente NAO falha: faz o PR esperar para sempre",
    jobIds: { gitea: "guards", github: "workflow-refs-guard" },
  },
  {
    id: "bring-up-env-gate-proof",
    // O PRÉ-REQUISITO 0 do bring-up (o env do host espelha o template comitado),
    // provado por EXECUÇÃO: o `gitea-up.sh` real roda contra um env divergente e
    // tem de RECUSAR antes de qualquer docker. O `checkGiteaBringUp` prende a
    // ORDEM no texto do script — e texto não distingue bloquear de estar
    // quebrado (um script que aborta por qualquer motivo também não sobe nada).
    matches: /runner-image:prove|prove-runner-image-gate/,
    command: /^node scripts\/prove-runner-image-gate\.mjs$/m,
    why: "sem a prova executada, 'o passo 0 recusa' volta a ser uma afirmação sobre o TEXTO do gitea-up.sh",
    jobIds: { gitea: "bring-up-proof", github: "bring-up-proof" },
  },
  {
    id: "registry-source",
    matches: /check[:-]registry[:-]source/,
    command: /^node scripts\/check-registry-source\.mjs$/m,
    why: "registry hardcoded reacopla o projeto a um registry proprietario com cota",
    jobIds: { gitea: "guards", github: "workflow-refs-guard" },
  },
  {
    id: "mirror-coverage",
    // A COBERTURA do recorte do commit, derivada das tabelas-fonte dos espelhos
    // (`BUN_MIRRORS`, `IMAGE_MIRRORS`, `MIRROR_VARIABLE_RULES` e o `envMirrors()`
    // do `check-env-mirror`, que traz o SEGREDO para a conta). Ela é do CORE
    // porque a pergunta é sobre o COMMIT, e o commit é o mesmo nas duas forjas:
    // um espelho que só a varredura global julga passa pelo pre-commit e o
    // defeito aparece (quando aparece) no CI — e o que o commit TIRA não está em
    // linha adicionada nenhuma. E ela MEDE por execução: muta cada espelho no
    // worktree, estagia e roda os comandos do recorte, com um CONTROLE na árvore
    // intacta (um comando que falha sem mutação falha por ambiente e não pode
    // contar como detector).
    matches: /mirror[:-]coverage/,
    command: /^node scripts\/check-mirror-coverage\.mjs$/m,
    why: "sem a medição, a cobertura do recorte é uma afirmação: cada tabela declara onde o valor é espelhado, e ninguém mede se o COMMIT julga aquela linha — o espelho que só a varredura global cobre passa pelo pre-commit em silêncio",
    jobIds: { gitea: "guards", github: "check" },
  },
  {
    id: "github-dependencies",
    // A CATRACA do corte: o inventario do que o GitHub sustenta (27 workflows, 9
    // crons, 14 actions de terceiro, o GHCR, o `gh`, o plano de configuracao do
    // Actions e 7 servicos), com a ETAPA e o SUBSTITUTO declarados por classe. E
    // do CORE porque a pergunta e do REPOSITORIO, nao de uma forja: o inventario
    // e o mesmo nas duas, e uma dependencia nova do GitHub custa dinheiro
    // (registry proprietario), plano (branch protection) ou ainda mais dois
    // lugares para manter em sincronia — em qualquer lado em que ela entre.
    matches: /github[:-]dependencies/,
    command: /^node scripts\/check-github-dependencies\.mjs$/m,
    why: "sem a catraca, cada PR pode AUMENTAR a dependencia do GitHub em silencio (um workflow, um cron, uma action de marketplace, um servico novo) e o corte nao anda para tras — o inventario declarado (ci/github-dependencies.json) so vale se as duas direcoes forem cobradas",
    jobIds: { gitea: "guards", github: "workflow-refs-guard" },
  },
  {
    id: "doctor-ci",
    // O GATE de PR (`check-doctor-ci.mjs`), não o doctor em si: o doctor é o
    // motor, e o publicador da issue (`forge-doctor-issue.mjs`) é do cron.
    matches: /check[:-]doctor[:-]ci/,
    command: /^node scripts\/check-doctor-ci\.mjs$/m,
    why: "o VALOR das repository variables nos espelhos e nas referencias nao versionadas é o que um PR esquece de acompanhar: o espelho velho nao quebra nada visivel (o setup-bun funciona igual, só mais lento, e o pull da imagem só falha quando um job inicia). O doctor no perfil --ci compara esse valor a CADA PR e BLOQUEIA na divergencia, em vez de deixar a pergunta para o cron semanal",
    jobIds: { gitea: "guards", github: "doctor-mirrors-guard" },
  },
  {
    id: "runner-base",
    matches: /check[:-]runner[:-]base/,
    command: /^node scripts\/check-runner-base\.mjs$/m,
    why: "a base do Dockerfile do runner e uma tag FLUTUANTE: um rebuild troca a imagem (e o plugin `compose` que a invariante 7 usa) sem nenhuma linha do repositorio mudar",
    jobIds: { gitea: "guards", github: "workflow-refs-guard" },
  },
  {
    id: "workflow-refs",
    matches: /check[:-]workflow[:-]refs/,
    command: /^node scripts\/check-workflow-refs\.mjs --pkg-internal$/m,
    why: "referencia pendurada entre workflow e script quebra a pipeline em runtime",
    jobIds: { gitea: "guards", github: "workflow-refs-guard" },
  },
  {
    id: "forge-workflow-scope",
    matches: /check[:-]forge[:-]workflow[:-]scope/,
    command: /^node scripts\/check-forge-workflow-scope\.mjs$/m,
    why: "cravar um diretorio de forja deixa as OUTRAS forjas fora da varredura dos guards",
    jobIds: { gitea: "guards", github: "workflow-refs-guard" },
  },
  {
    id: "workflow-run-syntax",
    // O corpo de um `run:` é SHELL. Os guards que LEEM o YAML (este, o
    // `check-workflow-refs`, o doctor) classificam TEXTO: um corpo que não faz
    // mais parsing continua sendo um `run:` válido para todos eles, e o defeito
    // só aparece quando o runner tenta executá-lo — depois de minutos de setup,
    // no meio do job, longe da causa. A reescrita mecânica em massa (o `--fix`
    // do `check-pipefail-sigpipe` tocou 216 ocorrências) é onde essa classe
    // nasce, e `bash -n` a pega no PR. O MESMO gate julga as TRÊS fontes de
    // shell do repositório — o corpo `run:`, o ARQUIVO versionado que o passo
    // executa (`bash scripts/x.sh`) e o texto EMBUTIDO (a instrução `RUN` de um
    // Dockerfile e o payload literal de um `sh -c`), que nem o YAML nem o
    // `bash -n` do arquivo que o contém descem. É a mesma classe: o defeito
    // morre no runtime, longe da causa.
    matches: /check[:-]workflow[:-]run[:-]syntax/,
    command: /^node scripts\/check-workflow-run-syntax\.mjs$/m,
    why: "reescrita mecânica de corpo `run:` que deixa de ser shell válido morre no RUNNER, não no PR",
    // No GitHub é um JOB PRÓPRIO (o check DIZ o defeito em vez de derrubar um
    // job de seis invariantes); na forja é passo do `guards`, que é o gate
    // único dela por desenho. O contrato exige o mesmo COMANDO nas duas.
    jobIds: { gitea: "guards", github: "workflow-run-syntax" },
  },
  {
    id: "bun-audit",
    // Ancorado em `check-...`/`check:`: o test-mutation-bun-audit-baseline.sh é
    // o TESTE do guard (roda só onde o mutation roda), não o guard em si.
    matches: /check[:-]bun[:-]audit/,
    command: /^node scripts\/check-bun-audit-baseline\.mjs$/m,
    why: "dependencia com vulnerabilidade conhecida entrando pelo merge",
    jobIds: { gitea: "guards", github: "bun-audit-guard" },
  },
  {
    id: "forge-parity",
    matches: /check[:-]forge[:-]parity/,
    command: /^node scripts\/check-forge-parity\.mjs$/m,
    why: "o proprio contrato de merge (esta lista) precisa ser verificado onde o merge acontece, senao a forja bloqueia por um contrato que ninguem audita",
    jobIds: { gitea: "guards", github: "workflow-refs-guard" },
  },
  {
    id: "hook-ci-parity",
    // O veredito LOCAL (os hooks) e o do MERGE (esta pipeline) são dois
    // conjuntos de comandos escritos em dois lugares. Enquanto a duplicação
    // for invisível, ela diverge em SILÊNCIO — e o sintoma é sempre o mesmo:
    // "passou aqui e quebrou lá". O caso REAL: `.husky/pre-push` rodava
    // `bunx tsc --noEmit` SEM o heap de 4GB que o script `typecheck` carrega
    // (dois lados citando "o typecheck", duas réguas).
    matches: /check[:-]hook[:-]ci[:-]parity/,
    command: /^node scripts\/check-hook-ci-parity\.mjs$/m,
    why: "dois conjuntos de comandos para o mesmo veredito divergem em silencio: 'passou aqui e quebrou la' (ou 'travou aqui e nem era o gate do CI')",
    jobIds: { gitea: "guards", github: "workflow-refs-guard" },
  },
  {
    id: "hook-commands",
    // O hook e o unico lugar do repositorio onde um comando aponta para um
    // arquivo do PROPRIO repositorio e nada o confere. Um caminho errado ali
    // nao e "um script que nao roda": e um PASSO que nunca roda — e o sintoma
    // nunca diz o nome dele (o commit passa achando que foi verificado, e o
    // veredito local fica mais fraco que o do merge sem nada dizer).
    matches: /check[:-]hook[:-]commands/,
    command: /^node scripts\/check-hook-commands\.mjs$/m,
    why: "comando de hook que aponta para arquivo/entrada que nao existe e um passo que nunca roda: o veredito LOCAL fica mais fraco que o do merge em silencio",
    jobIds: { gitea: "guards", github: "workflow-refs-guard" },
  },
  {
    id: "hooks-symmetry",
    matches: /check[:-]hooks[:-]symmetry/,
    command: /^node scripts\/check-hooks-symmetry\.mjs$/m,
    why: "hook/guard documentado que nao existe no repositorio e uma protecao FANTASMA: o README promete o que o codigo nao faz",
    jobIds: { gitea: "guards", github: "hooks-symmetry-guard" },
  },
  {
    id: "merge-latency",
    // O número que o repositório PUBLICA sobre o custo dos gates. A tabela de
    // overhead lista cada gate e convida a somar — mas o PR não paga a soma: ele
    // paga o caminho crítico e a FILA. Sem este gate, um job novo entra na
    // pipeline do PR sem duração e a latência publicada passa a cobrir menos
    // pipeline do que existe, em silêncio (o denominador encolhe, e o número
    // fica MENOR justamente quando ficou mais incompleto).
    //
    // MESMO COMANDO NAS DUAS: o `--check` julga o DONO DO MERGE
    // independentemente de onde roda — a forja é quem mergeia, e um PR do
    // GitHub também edita `.gitea/workflows/ci.yml`. Julgar o espelho com
    // `--forge github` travaria o merge para sempre (o espelho declara jobs sem
    // medição de propósito).
    matches: /merge[:-]latency/,
    command: /^node scripts\/merge-latency\.mjs --check$/m,
    why: "a latência de merge publicada mede menos pipeline do que existe quando um job do PR entra sem duração — e o número fica MENOR quanto mais incompleto",
    jobIds: { gitea: "guards", github: "workflow-refs-guard" },
  },
  {
    id: "secret-leaks",
    matches: /rotate-secrets/,
    command: /^node scripts\/rotate-secrets\.mjs --check$/m,
    why: "segredo versionado por engano (.env, chave, token) — vazamento permanente no historico",
    jobIds: { gitea: "guards", github: "secrets-guard" },
  },
  {
    id: "seed-hooks",
    matches: /check[:-]seed[:-]hooks/,
    command: /^node scripts\/check-seed-hooks\.mjs$/m,
    why: "SEED_SPEC_PATCH/PROD_SEED_ALLOW_DEV sao TEST-ONLY: vazando para o caminho de DEPLOY, o seed de producao roda com spec patchado",
    jobIds: { gitea: "guards", github: "seed-hooks-guard" },
  },
  {
    id: "sentinel-producer",
    matches: /check[:-]sentinel[:-]producer/,
    command: /^node scripts\/check-sentinel-producer\.mjs$/m,
    why: "sentinel orfao cria guarda CEGA: o grep nunca acende e 'nao achou' vira falso positivo de 'limpo'",
    jobIds: { gitea: "guards", github: "sentinel-producer-guard" },
  },
  {
    id: "bun-mirror",
    matches: /check[:-]bun[:-]mirror/,
    command: /^node scripts\/check-bun-mirror\.mjs$/m,
    why: "versao do Bun com multiplos pontos de verdade faz duas pipelines construirem runtimes diferentes",
    jobIds: { gitea: "guards", github: "bun-mirror-guard" },
  },
  {
    id: "no-setup-bun",
    matches: /check[:-]no[:-]setup[:-]bun/,
    command: /^node scripts\/check-no-setup-bun\.mjs$/m,
    why: "o action externo re-baixa o release do Bun em todo job (~25-35s) — regressao ja corrigida que nao pode voltar",
    jobIds: { gitea: "guards", github: "no-setup-bun-guard" },
  },
  {
    id: "pre-commit-in-runner-proof",
    // A prova do bloqueio do pre-commit tem de rodar no RUNTIME DO CI, não na
    // máquina do operador: o mesmo `proveCommitBlocks` que o doctor executa é
    // lançado DENTRO da imagem do runner (em lugar no job da forja, onde o
    // label `docker://` põe o job no container da imagem; por `docker run` no
    // espelho, cujo runner é uma máquina com docker). O que a invariante exige
    // nas DUAS pipelines é o MESMO comando — quem escolhe o lugar e declara o
    // modo é o script, e o que ele não conseguiu medir sai INDETERMINADO
    // (exit 2) nomeando o que faltou, nunca verde.
    matches: /prove-pre-commit-in-runner/,
    command: /^node scripts\/prove-pre-commit-in-runner\.mjs$/m,
    why: "um bloqueio medido só na máquina de quem commita não é o veredito do merge: a promessa do hook vale quando um 'git commit' de verdade acontece no runtime que julga o PR",
    jobIds: { gitea: "pre-commit-in-runner-proof", github: "pre-commit-in-runner-proof" },
  },
  {
    id: "script-headers",
    matches: /check-script-headers/,
    command: /^node scripts\/check-script-headers\.mjs$/m,
    why: "script sem Usage/Exit code no cabecalho e operacao por adivinhacao: quem chama nao sabe o que ele devolve nem o que ele faz de efeito — e os gates que decidem o merge nao podem depender disso",
    jobIds: { gitea: "guards", github: "workflow-refs-guard" },
  },
  {
    id: "pipefail-sigpipe",
    // A classe que JA mordeu este repositorio: sob `set -o pipefail`,
    // `algo | grep -q PADRAO` pode terminar 141 (SIGPIPE) MESMO com o padrao
    // encontrado — `grep -q` fecha o stdin no primeiro casamento e o produtor
    // leva o sinal se ainda tiver bytes para escrever. Intermitente por
    // construcao (depende do tamanho da saida) e o sintoma aponta para a
    // assercao que ACHOU o texto. O remedio e herestring.
    matches: /check[:-]pipefail[:-]sigpipe/,
    command: /^node scripts\/check-pipefail-sigpipe\.mjs$/m,
    why: "o defeito e INTERMITENTE e se disfarca de assercao de contagem: sem o gate, a proxima correcao 'resolve' o sintoma e a classe volta — ela ja voltou uma vez, em 11 test-mutation-*.sh ao mesmo tempo",
    jobIds: { gitea: "guards", github: "workflow-refs-guard" },
  },
  {
    id: "prove-docs",
    matches: /check[:-]prove[:-]docs/,
    command: /^node scripts\/check-prove-docs\.mjs$/m,
    why: "a familia prove-*/doctor e o que responde 'a forja pode confiar o merge a este gate?': uma doc que descreve a saida de ANTES mente com aparencia de rigor, e quem opera a forja decide sobre ela — o guard e hermetico (~1s) e roda com o docker ausente de proposito nas provas que exigem docker",
    jobIds: { gitea: "guards", github: "workflow-refs-guard" },
  },
  {
    id: "mutation-matrix",
    // A MATRIZ da prova por mutacao — e o invariante que reverteu uma isencao.
    //
    // Ela estava em `GITHUB_ONLY` com a razao "os jobs de mutation test existem
    // apenas no pipeline do GitHub (custo/duracao)" — que e exatamente a razao
    // que este arquivo proibe: conveniencia. O veredito que decide o merge nao
    // e "o espelho roda a prova", e "o PR do dono do merge pode ficar verde com
    // um guard CEGO?" — podia, e a matriz e a unica coisa do repositorio que
    // mede se um guard MORDE. Na forja ela roda DENTRO do job `guards` (ja
    // required, entao bloqueia o merge sem tocar a protecao aplicada); no
    // espelho, no job proprio `mutation-guards` (o separado existe para o
    // vermelho DIZER qual gate quebrou). O comando e o MESMO nas duas.
    matches: /test-mutation-guards/,
    command: /^bash scripts\/test-mutation-guards\.sh$/m,
    why: "prova por mutacao no dono do merge: sem ela, o PR da forja mergeia com o guard cego e o merge fica com aparencia de verificado — o espelho nao pode ser o unico lugar onde se descobre que um gate nao morde",
    jobIds: { gitea: "guards", github: "mutation-guards" },
  },
  {
    id: "forge-parity-mutation",
    // A prova da REGUA de classificacao (quais gates podem pular uma forja, com
    // que forma de comando) — o sujeito dela e o contrato de merge em si. Rodar
    // so no espelho deixava o dono do merge decidir o merge com a regra que ele
    // mesmo nunca media.
    matches: /test-mutation-forge-parity/,
    command: /^bash scripts\/test-mutation-forge-parity\.sh$/m,
    why: "a regra que decide se um gate pode pular a forja e medida nas duas: a prova por mutacao das tres regras de classificacao roda onde o merge e decidido",
    jobIds: { gitea: "guards", github: "forge-parity-mutation" },
  },
]

/**
 * Gates que NAO devem rodar na forja, cada um com a razao escrita. A razao tem
 * que ser sobre a FORJA (o gate depende de um servico/API que so o GitHub tem),
 * nunca sobre conveniencia — "da trabalho" nao e razao.
 *
 * @type {{ id: string, matches: RegExp, reason: string }[]}
 */
export const GITHUB_ONLY = [
  {
    id: "actionlint",
    matches: /actionlint/,
    reason:
      "valida a SINTAXE dos workflows do GitHub com o binario actionlint — a forja tem o proprio validador de YAML",
  },
  {
    id: "dependency-review",
    matches: /dependency-review/,
    reason:
      "action do GitHub que consulta o advisory database da plataforma pelo diff do PR; a CAPACIDADE equivalente na forja e o bun-audit (CORE)",
  },
  {
    id: "gist-crossover",
    matches: /gist[:-]crossover/,
    reason: "gist e recurso exclusivo do GitHub — o gate inteiro nao tem equivalente fora dele",
  },
  {
    id: "github-script",
    matches: /github-script/,
    reason: "usa actions/github-script (API do GitHub) para comentar/resumir no PR",
  },
  {
    id: "mutation-coord-timing-act",
    matches: /mutation-coord-timing-act/,
    reason:
      "mede o tempo do mutation test SOB o act com a imagem ubuntu-bun — benchmarking do runner do GitHub, nao uma invariante de codigo",
  },
  {
    // A classe mudou de lado: a MATRIZ e a prova do contrato de gates sao CORE
    // (`mutation-matrix`, `forge-parity-mutation`) e rodam no dono do merge. O
    // que sobra aqui e o que o `matches` DESCREVE — e a razao voltou a ser
    // sobre o sujeito, nao sobre conveniencia:
    //   (a) os ROTULOS DEDICADOS das suites que a matriz ja cobre (o job proprio
    //       existe no espelho para o vermelho dizer QUAL gate quebrou);
    //   (b) as tres suites que provam guards do espelho fora do contrato de
    //       merge (jsdom drift, unused deps, bun audit: os jobs deles nao sao
    //       required checks de forja nenhuma);
    //   (c) os dois guards cujo SUJEITO e o pipeline do GitHub (os jobs de
    //       mutation test e o nome/summary/comentario do job `mutation-guards`).
    id: "mutation-suite",
    matches: /test-mutation-(?!guards(?:\.sh)?$)|check[:-]mutation[:-](count|jobs)/,
    reason:
      "o sujeito e o pipeline do ESPELHO, nao a forja: os rotulos dedicados de suites que a matriz CORE ja prova nas duas forjas, as tres que provam guards sem contrato de merge (jsdom drift/unused deps/bun audit — os jobs deles nao sao required checks) e os dois guards que conferem os jobs de mutation test e o nome/summary/comentario count-free do job `mutation-guards` — jobs que existem so la",
  },
  {
    id: "e2e-counts",
    matches: /check[:-]e2e[:-]counts/,
    reason:
      "confere os counts de checks DOCUMENTADOS nos comentarios de pr-check.yml/seed-guards.yml — o sujeito e o proprio pipeline do GitHub",
  },
  {
    id: "seed-count-literals",
    matches: /check[:-]seed[:-]count[:-]literals/,
    reason:
      "confere literais de contagem nos arquivos de seed/CI do pipeline do GitHub (sujeito = pipeline, nao o produto)",
  },
  {
    id: "seed-e2e",
    matches: /Seed E2E|seed-guards/,
    reason:
      "E2E de seed (prod+dev) com PostGIS efemero — so roda no GitHub self-hosted com service containers; a forja nao tem o cenario",
  },
  {
    id: "jsdom-baseline",
    matches: /check[:-]jsdom[:-]baseline/,
    reason:
      "roda a suite jsdom de componentes (que o test:unit EXCLUI) e compara com um BASELINE de falhas: mede DRIFT, nao bloqueia defeito novo — e a forja já roda o test:run, mais amplo",
  },
  {
    id: "unused-deps",
    matches: /check[:-]unused[:-]deps/,
    reason:
      "dependencia nao usada e DIVIDA de manutencao, nao defeito que chega ao main; fica no pipeline que tem folga de tempo",
  },
  {
    id: "readme-integrity",
    matches: /check[:-]readme/,
    reason:
      "integridade de links/anchors/TOC da DOCUMENTACAO — nao e o que entra no main; roda onde a documentacao e publicada",
  },
  {
    id: "seed-guards-reusable",
    matches: /uses:.*seed-guards\.yml/,
    reason:
      "workflow reutilizavel dos E2Es de seed: depende da topologia de servicos efemeros (PostGIS) provisionada pelo runner do GitHub",
  },
  {
    id: "tier1-fastpath",
    matches: /tier1[:-]fastpath|check-tier1/,
    reason:
      "mede o fastpath do setup-bun sob o act; a forja roda o mesmo composite, mas a medicao e do runner do GitHub (nao bloqueia correcao)",
  },
  {
    id: "tier2-cache-restore",
    matches: /tier2[:-]cache|check-tier2/,
    reason:
      "mede o restore do actions/cache — a forja nao usa actions/cache (o cache e do runner), entao o gate nao tem o que medir la",
  },
  {
    id: "benchmark",
    matches: /^bun run bench|bench|validate-gist/,
    reason:
      "jobs de benchmark/cron publicam no GitHub (gist, comentario de PR) — saida especifica da plataforma",
  },
  {
    id: "security-headers",
    matches: /security-headers/,
    reason:
      "verifica as headers de seguranca via actions/upload-artifact + resumo do PR; a assercao e GitHub-flavored (a forja valida o mesmo via teste de codigo)",
  },
  {
    id: "all-text-alert",
    matches: /validate-all-text-alert|all-text-alert/,
    reason:
      "valida o alerta automatico de texto puro, que existe nos workflows do GitHub (deprecacao da plataforma)",
  },
  {
    id: "blob-crlf-history",
    matches: /blob-crlf-history/,
    reason:
      "varre o HISTORICO de blobs do repositorio do GitHub (API/historico remoto); o equivalente local roda no pre-commit de quem tem o clone",
  },
  {
    id: "fuzz",
    matches: /(^|\s)fuzz|fuzz[:-]ci/,
    reason: "job de fuzz de longa duracao agendado como cron/reusable no GitHub",
  },
  {
    id: "encoding-recheck",
    matches: /check-utf8\.sh|audit-blob-crlf-history\.sh|check-blob-crlf\.sh/,
    reason:
      "roteiro de encoding que o pre-commit ja roda em TODO commit local (barato); a forja cobre a invariante pelo run-encoding-guards do proprio commit",
  },
]

/**
 * Classifica um gate descoberto.
 *
 * @param {string} gate  rotulo retornado por discoverGates
 * @returns {"core"|"github-only"|null} null = NAO CLASSIFICADO (violacao)
 */
export function classifyGate(gate) {
  if (CORE_INVARIANTS.some((i) => i.matches.test(gate))) return "core"
  if (GITHUB_ONLY.some((g) => g.matches.test(gate))) return "github-only"
  return null
}

/**
 * A forma IMPRESSA do comando canonico de uma invariante. O `source` de um
 * regex ancorado (`^node scripts\/check-x\.mjs$`) nao se le num diagnostico;
 * o que quem opera a forja precisa ver e a linha de `run:` que falta.
 *
 * @param {{ command: RegExp }} inv
 * @returns {string}
 */
export function canonicalCommandOf(inv) {
  return inv.command.source
    .replace(/\^/g, "")
    .replace(/\$/g, "")
    .replace(/\\\//g, "/")
    .replace(/\\\./g, ".")
}

/**
 * Invariantes do CORE ausentes numa pipeline.
 *
 * PRESENCA = O COMANDO CANONICO, medido nas linhas de `run:` — o MESMO dado que
 * o doctor usa (`readGateContract`, que testa a regua contra o `run:` do job).
 * A versao anterior media pelo ROTULO do gate descoberto (`scripts/check-x.mjs`,
 * sem argumentos) com uma regua FROUXA (`/check[:-]registry[:-]source/`), e por
 * isso tres divergencias passavam por ela: a invocacao indireta
 * (`bun run check:registry-source`), a invocacao com argumentos DIFERENTES
 * (`node scripts/check-workflow-refs.mjs` sem o `--pkg-internal`) e o comando
 * trocado por outro que ainda casasse a substring. Com o `command` ancorado nas
 * duas pontas, um gate so esta presente se a linha EXECUTAR exatamente o
 * comando canonico — e as duas forjas passam a ter um veredito so.
 *
 * @param {string} content
 * @param {{ id: string, command: RegExp }[]} invariants
 * @returns {string[]} ids ausentes
 */
export function missingInvariants(content, invariants = CORE_INVARIANTS) {
  // A PRESENCA e medida no que EXECUTA (`executedCommands`), nao no que a
  // chave `run:` tem na propria linha: um `run: |` que invoca o comando
  // canonico EXECUTA a invariante, e o veredito tem de concordar com o
  // `discoverGates` do MESMO arquivo (que ja le o corpo do bloco).
  const commands = executedCommands(content)
  return invariants
    .filter((inv) => !commands.some((cmd) => inv.command.test(cmd)))
    .map((inv) => inv.id)
}

// ── O canal do remédio: derivado do REGISTRO, um passo por pipeline ─────────

/**
 * O script do canal do remédio e as flags que descrevem uma invocação dele.
 *
 * O canal NÃO é um gate (não verifica nada: publica o patch do remédio no PR), e
 * por isso ele não entra em `discoverGates`/`CORE_INVARIANTS` — mas ele é uma
 * RÉGUA que existe nas duas forjas, e é isso que esta seção mede: a cobertura
 * dele vinha de uma lista escrita nos DOIS workflows (um passo por fixer), e um
 * fixer novo só chegava ao PR se alguém lembrasse de copiar o passo nas duas
 * pontas. O que a pipeline invoca agora é o REGISTRO (`--all`), e a régua daqui
 * é a que faz isso valer.
 */
export const REMEDY_CHANNEL = {
  script: "scripts/pr-remedy-comment.mjs",
  allFlag: "--all",
  fixerFlag: "--fixer",
  backendFlag: "--backend",
}

/** Os fixers que o REGISTRO declara — a fonte única da cobertura esperada. */
export function remedyFixers() {
  return Object.keys(FIXERS)
}

/**
 * Os passos de uma pipeline que invocam o canal do remédio.
 *
 * Cada passo é UMA linha de `run:` — a mesma regua de linha das outras secoes
 * deste guard (comentario e fim de linha fora, expressao do runner mascarada, e
 * a declaracao `defaults.run` descartada), para um passo COMENTADO nao contar
 * como canal existente.
 *
 * @param {string} content  conteudo do arquivo de workflow
 * @returns {{comando: string, backend: string|null, todos: boolean, fixers: string[]}[]}
 */
export function remedyChannelSteps(content) {
  const linhas = linhasExecutaveis(content)
  const passos = []
  for (const linha of linhas) {
    if (!linha.includes(REMEDY_CHANNEL.script)) continue
    const tokens = linha.trim().split(/\s+/)
    const valorDe = (flag) => {
      const i = tokens.indexOf(flag)
      return i === -1 || tokens[i + 1] === undefined ? null : tokens[i + 1]
    }
    const fixers = []
    for (let i = 0; i < tokens.length; i += 1) {
      if (tokens[i] === REMEDY_CHANNEL.fixerFlag && tokens[i + 1] !== undefined)
        fixers.push(tokens[i + 1])
    }
    passos.push({
      comando: linha.trim(),
      backend: valorDe(REMEDY_CHANNEL.backendFlag),
      todos: tokens.includes(REMEDY_CHANNEL.allFlag),
      fixers,
    })
  }
  return passos
}

/**
 * A forma do comando SEM o valor do `--backend`: e o que as duas forjas tem de
 * ter igual (uma so regua, com o backend da vez).
 *
 * @param {string} comando
 * @returns {string}
 */
export function canonicalRemedyCommand(comando) {
  return String(comando).replace(/--backend\s+\S+/, `--backend <forja>`)
}

/**
 * As violacoes do canal do remédio (vazio = ok).
 *
 * Cinco regras, todas DERIVADAS — nenhuma delas é uma lista de fixers escrita
 * aqui:
 *
 *   1. cada pipeline tem EXATAMENTE UM passo do canal. Zero é o canal ausente
 *      numa forja (o PR de lá não recebe o remédio); mais de um é a ENUMERAÇÃO
 *      que esta regra aposentou (dois passos são dois lugares para um esquecer);
 *   2. a cobertura é a do REGISTRO: com `--all` é o registro inteiro; com
 *      `--fixer <id>` é a lista DITA na linha, e compara-se com o registro —
 *      um fixer que o registro tem e a pipeline não publica sai NOMEADO (é o
 *      buraco que um `--all` trocado por uma lista à mão abriria em silêncio);
 *   3. um id que o registro NÃO tem é violação (o CLI sairia 3 no PR, depois de
 *      o pior lugar para se descobrir isso: quem abre o PR);
 *   4. o `--backend` tem de ser o DA FORJA: a copia do passo de uma forja para
 *      a outra publica no canal errado (um PR da Gitea comentado no espelho, com
 *      o token da outra) e nenhum outro guard veria isso;
 *   5. o comando canonico (sem o valor do backend) tem de ser IGUAL nas duas —
 *      presenca do passo nas duas nao basta: `--all` numa e `--fixer x` na outra
 *      e a mesma classe de divergencia que a regua do `canonicalCommandOf` pega
 *      nos gates.
 *
 * @param {(path: string) => string|null} readFile
 * @param {{ forge: string, file: string, mergeOwner: boolean }[]} pipelines
 * @param {string[]} fixers  os ids do REGISTRO
 * @returns {string[]}
 */
export function findRemedyChannelViolations(
  readFile,
  pipelines = PIPELINES,
  fixers = remedyFixers(),
) {
  const violations = []
  const porForja = new Map()
  for (const pipeline of pipelines) {
    const content = readFile(pipeline.file)
    if (content === null) continue // pipeline ausente já é violação em findParityViolations
    const role = pipeline.mergeOwner ? "dona do merge" : "espelho"
    const passos = remedyChannelSteps(content)
    porForja.set(pipeline.forge, passos)
    if (passos.length === 0) {
      violations.push(
        `${pipeline.file} (${pipeline.forge}, ${role}): o CANAL DO REMEDIO nao roda aqui — nenhum passo invoca '${REMEDY_CHANNEL.script}'. O remendo mecanico dos gates tem de chegar ao PR das DUAS forjas; sem este passo, quem abre o PR por aqui reescreve a mao o que o fixer remenda.`,
      )
      continue
    }
    if (passos.length > 1) {
      violations.push(
        `${pipeline.file} (${pipeline.forge}, ${role}): ${passos.length} passos do canal do remedio — ele e DERIVADO do registro (${REMEDY_CHANNEL.allFlag}), nao enumerado: um passo por fixer e um lugar a mais para esquecer um fixer novo. Passos: ${passos.map((p) => `\`${p.comando}\``).join(", ")}`,
      )
    }
    for (const passo of passos) {
      if (passo.backend === null) {
        violations.push(
          `${pipeline.file} (${pipeline.forge}, ${role}): o passo do canal do remedio nao declara ${REMEDY_CHANNEL.backendFlag} — sem ele o publicador nao sabe em qual forja comentar (esperado: \`${pipeline.forge}\`).`,
        )
      } else if (passo.backend !== pipeline.forge) {
        violations.push(
          `${pipeline.file} (${pipeline.forge}, ${role}): o passo do canal do remedio esta com ${REMEDY_CHANNEL.backendFlag} ${passo.backend} — e o backend de OUTRA forja (esperado: \`${pipeline.forge}\`). Copiar o passo de uma pipeline para a outra publica no canal errado, com o token errado.`,
        )
      }
      if (!passo.todos) {
        const faltando = fixers.filter((f) => !passo.fixers.includes(f))
        if (faltando.length > 0) {
          violations.push(
            `${pipeline.file} (${pipeline.forge}, ${role}): o canal do remedio NAO publica ${faltando.length} fixer(s) do registro: ${faltando.join(", ")} — a linha lista os fixers a mao; use ${REMEDY_CHANNEL.allFlag} (o conjunto sai do REGISTRO e um fixer novo passa a herdar este passo sem edicao de workflow).`,
          )
        }
      }
      for (const id of passo.fixers) {
        if (!fixers.includes(id)) {
          violations.push(
            `${pipeline.file} (${pipeline.forge}, ${role}): o canal do remedio cita o fixer '${id}', que o REGISTRO nao tem (validos: ${fixers.join(", ")}) — o CLI sairia 3 no PR, depois de o PR ja estar aberto.`,
          )
        }
      }
    }
  }

  const canonicos = [...porForja.entries()]
    .filter(([, passos]) => passos.length > 0)
    .map(([forge, passos]) => ({ forge, canonico: canonicalRemedyCommand(passos[0].comando) }))
  if (canonicos.length > 1 && new Set(canonicos.map((c) => c.canonico)).size > 1) {
    violations.push(
      `o comando do canal do remedio DIVERGE entre as forjas: ${canonicos.map((c) => `${c.forge} \`${c.canonico}\``).join(" · ")} — a regua e uma so (o backend e o unico argumento que muda).`,
    )
  }
  return violations
}

/**
 * Compara as pipelines declaradas e devolve as violacoes (vazio = ok).
 * Pura em relacao ao filesystem: recebe um leitor para poder ser testada sem
 * tocar o disco.
 *
 * @param {(path: string) => string|null} readFile
 * @param {{ forge: string, file: string, mergeOwner: boolean }[]} pipelines
 * @returns {string[]}
 */
export function findParityViolations(readFile, pipelines = PIPELINES) {
  const violations = []
  const discovered = new Map()

  for (const pipeline of pipelines) {
    const content = readFile(pipeline.file)
    if (content === null) {
      violations.push(
        `${pipeline.file}: pipeline declarada nao existe — se a forja foi removida, remova-a de PIPELINES (nao deixe o guard cobrindo um arquivo fantasma)`,
      )
      continue
    }
    const role = pipeline.mergeOwner ? "dona do merge" : "espelho"
    const gates = discoverGates(content)
    discovered.set(pipeline.forge, gates)

    // 1. Completude: nenhum gate pode ficar sem classificacao.
    for (const gate of gates) {
      const kind = classifyGate(gate)
      if (kind === null) {
        violations.push(
          `${pipeline.file} (${pipeline.forge}, ${role}): gate '${gate}' NAO CLASSIFICADO — decida e registre: CORE (roda nas duas pipelines) ou GITHUB_ONLY (isento, com razao escrita em GITHUB_ONLY). Um gate novo nao pode pular a forja em silencio.`,
        )
      }
      if (kind === "github-only" && pipeline.mergeOwner) {
        const entry = GITHUB_ONLY.find((g) => g.matches.test(gate))
        violations.push(
          `${pipeline.file} (${pipeline.forge}, ${role}): gate '${gate}' esta classificado como GITHUB_ONLY mas RODA aqui — classificacao stale (razao registrada: ${entry?.reason ?? "?"}). O gate roda na forja ou a classificacao mente: escolha um.`,
        )
      }
    }

    // 2. Obrigacao: todo invariante do CORE roda aqui COM O COMANDO CANONICO.
    //    A linha esperada vai no diagnostico: sem ela, "nao roda aqui" faz quem
    //    le procurar um gate que ESTA la (so invocado por outra forma).
    for (const id of missingInvariants(content)) {
      const inv = CORE_INVARIANTS.find((i) => i.id === id)
      const expected = inv ? canonicalCommandOf(inv) : "?"
      violations.push(
        `${pipeline.file} (${pipeline.forge}, ${role}): invariante do CORE '${id}' NAO roda aqui com o comando canonico — esperado: \`${expected}\` (a regua e uma so nas duas forjas; a invocacao indireta ou com outros argumentos conta como divergencia) — ${inv?.why ?? "invariante do CORE"}`,
      )
    }
  }

  // O canal do remédio tem a sua própria régua (e é DERIVADO do registro):
  // sem esta linha, o passo que publica o remédio no PR poderia divergir entre
  // as forjas sem nenhum veredito — ele não é um gate, e o `discoverGates`
  // (por desenho) não o vê.
  violations.push(...findRemedyChannelViolations(readFile, pipelines))

  return violations
}

/**
 * Leitor padrão do guard — fail-closed, e com DOIS desfechos que não se
 * confundem:
 *
 *   · `null`  → a pipeline NAO EXISTE. É uma violação NOMEADA do contrato (a
 *     forja foi removida e PIPELINES ficou apontando para um arquivo fantasma),
 *     então o `null` preserva a mensagem que já existia.
 *   · `nomeado em unjudgeable` → a pipeline EXISTE e NÃO PODE SER JULGADA
 *     (permissão, não é UTF-8, YAML que não faz parsing). O arquivo sai da
 *     conta e o guard NÃO cunha veredito: um `null` aqui seria lido como
 *     "pipeline ausente" — o diagnóstico apontaria para o lugar errado.
 *
 * @param {string} [root]
 * @param {{path: string, motivo: string}[]} [unjudgeable] coletor do que não pôde ser julgado
 * @returns {(path: string) => string | null}
 */
export function defaultReadFile(root = ROOT, unjudgeable = []) {
  return (path) => {
    const full = join(root, path)
    if (!existsSync(full)) return null
    let text
    try {
      text = readJudgedFile(full, path)
    } catch (err) {
      unjudgeable.push({ path, motivo: err?.motivo ?? String(err?.message ?? err) })
      return null
    }
    const yaml = workflowYamlValidity(text)
    if (!yaml.ok) {
      unjudgeable.push({ path, motivo: yaml.motivo })
      return null
    }
    return text
  }
}

// ── modo CLI (so quando invocado diretamente, nao quando importado) ────────
const isMain =
  !!process.argv[1] && process.argv[1].split(/[\\/]/).pop() === "check-forge-parity.mjs"

if (isMain) {
  // `--root X` roda o guard contra um diretório (fixture dos mutation tests) em
  // vez do cwd: a evidência do mutation test passa a ser o exit code do GUARD
  // real contra o fixture, e não uma sondagem da função pura.
  const rootIdx = process.argv.indexOf("--root")
  if (rootIdx !== -1 && !process.argv[rootIdx + 1]) {
    console.error("check-forge-parity: ❌ --root exige um diretório (fail-closed)")
    process.exit(2)
  }
  /**
   * O que a varredura NAO conseguiu julgar, NOMEADO. Vive fora do leitor porque
   * o veredito tem de ser barrado ANTES de ser cunhado.
   * @type {{path: string, motivo: string}[]}
   */
  const unjudgeable = []
  const read =
    rootIdx !== -1
      ? defaultReadFile(resolve(process.argv[rootIdx + 1]), unjudgeable)
      : defaultReadFile(ROOT, unjudgeable)

  // A SONDA do escopo declarado: nenhum veredito (nem o inventario do --gates)
  // existe antes de LER as duas pipelines. Sem esta passada, um arquivo que
  // existe e nao abre era apenas "mais uma leitura" — e o guard respondia sobre
  // um contrato que nao leu. `exitOnUnjudgeable` sai 2 e nomeia o arquivo: nada
  // de "verde por nao saber".
  for (const pipeline of PIPELINES) read(pipeline.file)
  exitOnUnjudgeable(unjudgeable)

  // Modo inventario: mostra o que o guard enxerga, para a classificacao ser
  // revisavel de fato (e nao um ato de fe).
  if (process.argv.includes("--gates")) {
    for (const pipeline of PIPELINES) {
      const content = read(pipeline.file)
      if (content === null) continue
      const gates = discoverGates(content)
      console.log(`\n${pipeline.file} (${pipeline.forge}) — ${gates.length} gate(s):`)
      for (const gate of gates) {
        const kind = classifyGate(gate)
        console.log(`  [${kind ?? "NAO CLASSIFICADO"}] ${gate}`)
      }
    }
    process.exit(0)
  }

  const violations = findParityViolations(read)
  if (violations.length === 0) {
    console.log(
      `check-forge-parity: ✅ ${CORE_INVARIANTS.length} invariantes do CORE nas ${PIPELINES.length} pipelines e todos os gates classificados (${GITHUB_ONLY.length} isencoes GitHub-only com razao).`,
    )
    console.log(
      `check-forge-parity: ✅ o canal do remedio roda nas ${PIPELINES.length} forjas, uma vez cada, com a cobertura do REGISTRO (${remedyFixers().length} fixer(s): ${remedyFixers().join(", ")}) e o backend de cada forja.`,
    )
    process.exit(0)
  }
  console.error("check-forge-parity: ❌ contrato de merge divergente:")
  for (const v of violations) console.error(`  - ${v}`)
  console.error(
    "\nUm gate que roda em UMA pipeline e nao na outra e um buraco silencioso: o PR passa verde por onde rodou e ninguem ve a invariante que ficou de fora.",
  )
  process.exit(1)
}
