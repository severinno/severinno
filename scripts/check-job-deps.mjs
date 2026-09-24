#!/usr/bin/env node

// =============================================================================
// check-job-deps.mjs
//
// GATE: um job que RODA um comando cujo veredito exige `node_modules` tem de
// INSTALAR as dependencias — ou a isencao tem de estar DECLARADA, com data e
// janela de revisao — porque o verde de um job que nao instala nao tem causa
// no repositorio.
//
// A CLASSE (medida, nao suposta). `node scripts/check-*.mjs` PARECE "node puro"
// — os guards leem LINHA, e a prosa dos workflows diz "node puro, sem bun
// install; roda em <5s". Mas oito deles perguntam ao `js-yaml` se o YAML e
// VALIDO (`readWorkflowScan` -> `workflowYamlValidity`, a porta fail-closed que
// a classe do "nao consegui julgar" fechou), e sem o pacote eles nao cunham
// veredito. Medido num checkout SEM `node_modules`, guard por guard:
//
//   check-no-setup-bun.mjs         exit 2  ("workflow(s) NAO JULGAVEL(is)")
//   check-registry-source.mjs      exit 2
//   check-workflow-refs.mjs        exit 2
//   check-bun-mirror.mjs           exit 2
//   check-mutation-jobs.mjs        exit 2
//   check-sentinel-producer.mjs    exit 2
//   check-seed-hooks.mjs           exit 2
//   check-pipefail-sigpipe.mjs     exit 2
//   check-forge-workflow-scope.mjs exit 0  (o caminho tardio nao e alcancado)
//   check-utf8-scope.mjs           exit 0
//   check-crlf-scope.mjs           exit 0
//   test-mutation-*.sh (vitest)    exit !0 (binario do node_modules ausente)
//
// Ou seja: a mesma linha `node scripts/X.mjs` tem DOIS desfechos sem
// dependencias, e NENHUM deles esta escrito no workflow. O que esta escrito e
// prosa que ninguem confere. O custo aparece quando o runner esta limpo: o job
// fica vermelho por um motivo que nao Esta no repositorio (o workspace tinha
// `node_modules` de outro job, ou de quem roda o runner na propria maquina de
// desenvolvimento) — e o diagnostico que sai e "NAO JULGAVEL", nao "faltou
// instalar". Este guard transforma a prosa em CONTRATO.
//
// O QUE ELE DECIDE, por job:
//   - INSTALA (`bun install`, `npm ci`, ... em qualquer passo do job) -> OK. O
//     job declara de onde vem o `node_modules`;
//   - NAO INSTALA e nenhum comando exige node_modules -> OK, medido (o grafo
//     nao alcanca pacote nenhum, ou so alcanca por caminho tardio que o
//     comando nao percorre — e nesse caso a isencao e o que DIZ isso);
//   - NAO INSTALA e algum comando exige -> a isencao tem de estar DECLARADA em
//     `JOB_DEPS_ALLOWLIST`, com `addedAt` e motivo escrito; sem isso e
//     VIOLACAO;
//   - a isencao e VERIFICADA contra o grafo: `semDeps: "passa"` (o comando
//     termina 0 sem node_modules) e provadamente FALSA se o grafo tem um
//     `import` de TOPO ou um BINARIO de dependencia — os dois carregam no
//     START, sem caminho alternativo. Uma isencao que nao pode ser verdadeira
//     nao pode ser declarada;
//   - isencao SEM OBJETO (o job passou a nao exigir nada) tambem e violacao: a
//     declaracao que sobrou mente sobre o presente.
//
// O SEGUNDO CONTRATO DO MESMO JOB — em que CAMINHO o veredito dele roda. Um gate
// de LEITURA DE YAML nao usa docker, nao sobe servico e nao fala com a rede: ele
// so LE o repositorio. Preso ao runner da forja, o veredito dele passa a
// depender da infraestrutura dela (medido: com o runner auto-hospedado offline,
// os 50 jobs do `pr-check` ficaram ~35min na fila e os gates de leitura nao
// cunharam veredito nenhum — a forja ESPERA, e nada fica vermelho). A classe e
// DERIVADA (o leitor alcanca a leitura compartilhada por SPECIFIER + o job nao
// tem servico/docker/suite/shell) e o `runs-on: self-hosted` a viola: o remedio
// e o caminho hospedado com o par canonico de install, ou a excecao declarada em
// RUNNER_PATH_ALLOWLIST com data e motivo. O detalhamento — escopo, fatos que
// tiram o job da classe e o que ela mede nesta arvore — esta na secao "O SEGUNDO
// CONTRATO DO MESMO JOB", abaixo.
//
// O GRAU e um FATO, nao um detalhe: `binario` (o binario do node_modules:
// vitest, tsc), `estatico` (`import` de topo: carrega sempre, o desfecho sem deps
// e o CRASH `ERR_MODULE_NOT_FOUND`) e `tardio` (specifier alcancado so dentro de
// funcao: pode nunca ser percorrido, e por isso admite `passa`).
//
// ESCOPO: as duas forjas (`forge-workflows.mjs`), todos os jobs e todos os
// passos — com a LEITURA fail-closed de sempre (arquivo ilegivel ou YAML
// invalido NAO vira "nada a julgar") e a MESMA extracao de comandos dos hooks
// (`check-hook-commands.mjs`: `shellCommands`), para nao existir uma segunda
// regua do que e um comando. O grafo de imports usa `extractBareSpecifiers` e
// `resolveImport` do `check-no-leaked-imports.mjs` (fonte unica do que e um
// bare specifier e de como um relativo resolve).
//
// O QUE FICA FORA, declarado (e nomeado na saida, nunca escondido):
//   - comando cujo alvo o guard nao classifica (programa desconhecido, alvo
//     montado em `${{ }}`): sai em `foraDoEscopo` (com a CATEGORIA e o motivo),
//     e um job que so tem comandos fora do escopo NAO ganha isencao implicita —
//     ele e reportado como tal;
//   - `sh -c`/`node -e` (payload inline): a MESMA classe de alvo do
//     `check-hook-commands` (`alvoDoLancador` → `classeDoFlag`, por
//     interpretador) decide que nao ha alvo — e nao ha TRANSITIVIDADE de
//     dependencia a seguir num payload. O QUE MUDA NO VEREDITO com a classe no
//     lugar do `tokens[0].startsWith("-")` de antes:
//       · `node -e`/`node -`/`python3 -c` continuam `payload-inline` — agora
//         PROVADO pela classe do flag (o `-e` do node e o eval DELE; o `-e` do
//         bash e o errexit, e por isso a classe e por interpretador);
//       · `node --version` (3 no corpus) sai de `payload-inline` para
//         `sem-alvo`: o rotulo dizia "o script vive no argumento" de um comando
//         que nao le arquivo NENHUM — nomear errado e pior que nomear;
//       · e o caso que passa a ser JULGADO: `bash -u x.sh`, `node --no-warnings
//         x.mjs`, `python3 -B x.py` — um flag que NAO consome o token seguinte
//         nao e o alvo, e o arquivo atras dele entra no grafo (antes eram todos
//         "payload inline", ou seja, fora do escopo sem ninguem decidir).
//   - o estado REAL do runner (se a imagem embarca `node_modules`): o guard le
//     o repositorio. E exatamente por isso a isencao precisa de motivo: quem
//     responde "de onde vem" e quem assina a decisao.
//
// Usage:
//   node scripts/check-job-deps.mjs             # repo atual (cwd)
//   node scripts/check-job-deps.mjs --json      # saida estruturada
//   node scripts/check-job-deps.mjs --review    # isencao vencida = violacao (job semanal)
//   node scripts/check-job-deps.mjs --root X    # fixture (mutation test)
//
// Exit codes:
//   0 — todo job que exige node_modules instala, ou declara a isencao verdadeira,
//       E nenhum gate de leitura de YAML roda preso ao caminho da forja
//   1 — exige e nao instala sem isencao; isencao sem data, mentirosa, sem
//       objeto, ou (--review) vencida; leitura de YAML no caminho da forja, ou
//       excecao de caminho sem objeto/sem data/vencida
//   2 — infra: escopo NAO JULGAVEL (arquivo ilegivel, YAML invalido),
//       `--root` sem valor ou inexistente (fail-closed)
// =============================================================================

import { existsSync, readFileSync, statSync } from "node:fs"
import { basename, dirname, isAbsolute, join, resolve } from "node:path"
import { pathToFileURL } from "node:url"

import {
  agedAddedAtViolation,
  invalidAddedAtViolation,
  reviewAddedAtEntries,
  DEFAULT_REVIEW_DAYS,
} from "./allowlist-review.mjs"
import {
  BIN_PACKAGES,
  CLASSE_DO_FLAG,
  EXTERNAL_TOOLS,
  INTERPRETERS,
  PACKAGE_MANAGERS,
  alvoDoLancador,
  binInstalado,
  declaredPackages,
  shellCommands,
} from "./check-hook-commands.mjs"
import { extractBareSpecifiers, isBareSpecifier, stringRanges } from "./check-no-leaked-imports.mjs"
import { workflowRunSteps } from "./check-pipefail-sigpipe.mjs"
import {
  EXIT_UNJUDGEABLE,
  GITHUB_WORKFLOW_DIR,
  exitOnUnjudgeable,
  jobKeyName,
  jobsLayout,
  readWorkflowScan,
  reportEmptyWorkflows,
  yamlChildKey,
} from "./forge-workflows.mjs"

export const EXIT = { OK: 0, VIOLACAO: 1, NAOJULGAVEL: EXIT_UNJUDGEABLE }

/** Os subcomandos de gerenciador que FORNECEM o `node_modules` do job. */
export const INSTALL_SUBCOMMANDS = new Set(["install", "i", "ci"])

/** Os subcomandos que executam um PACOTE do registry (`bun x vitest`). */
export const PACOTE_SUBCOMMANDS = new Set(["x", "exec", "dlx"])

/** Extensoes que o guard segue como JAVASCRIPT (as outras nao pedem node_modules). */
export const EXTENSOES_JS = [".mjs", ".js", ".cjs", ".ts", ".mts", ".cts"]

/** Extensoes que o guard segue como SHELL (o corpo de dentro pode chamar node). */
export const EXTENSOES_SHELL = [".sh", ".bash"]

/**
 * O teto de profundidade da resolucao (script -> `bun run` -> script -> ...): o
 * grafo do repositorio tem 2 niveis; um ciclo que passe daqui e reportado como
 * `naoJulgado` em vez de girar para sempre.
 */
export const MAX_PROFUNDIDADE = 4

/**
 * A CATEGORIA do `foraDoEscopo` a partir da CLASSE do flag (a mesma do
 * `check-hook-commands` — `classeDoFlag`).
 *
 * A categoria NOMEIA por que o comando nao entra no grafo de dependencias, e
 * uma classe tem de ter um nome: enquanto todos os flags caíam em
 * `payload-inline`, o relatorio dizia "o script vive no argumento" de um
 * `node --version` (que nao le arquivo nenhum) e de um `bash -u x.sh` (cujo alvo
 * E o arquivo — julgado agora, e por isso nao ha categoria para o caso
 * EXECUTA aqui).
 *
 * @type {Record<string, string>}
 */
export const CATEGORIA_DA_CLASSE = {
  /** o payload vem do argumento/stdin (`bash -c`, `node -e`, `python3 -c`) */
  [CLASSE_DO_FLAG.SEM_ARQUIVO]: "payload-inline",
  /** o programa so CONFERE o alvo (`bash -n`, `node --check`) */
  [CLASSE_DO_FLAG.CONFERE]: "conferencia-de-sintaxe",
  /** o programa nao le arquivo nenhum (`node --version`) */
  [CLASSE_DO_FLAG.SEM_ALVO]: "sem-alvo",
  /** o flag pode consumir o token seguinte (`bash -o pipefail x.sh`) */
  [CLASSE_DO_FLAG.DESCONHECIDA]: "flag-nao-provado",
}

/**
 * O REMEDIO canonico — o mesmo par que 65 dos 113 jobs ja usam, e o que a forja
 * que decide o merge (job `guards` da Gitea) usa. Entra na mensagem para que a
 * violacao diga o que FAZER, nao so o que esta errado.
 */
export const REMEDIO =
  "adicione o par canonico ao job (cache do `node_modules` + `bun install --frozen-lockfile`) " +
  "ou registre a isencao em JOB_DEPS_ALLOWLIST com `addedAt` e motivo"

/**
 * As ISENCOES declaradas: os jobs que rodam comandos dependentes de
 * `node_modules` SEM instalar, com a data da decisao e o motivo escrito.
 *
 * A janela de revisao vem do modulo compartilhado (`allowlist-review.mjs`,
 * `DEFAULT_REVIEW_DAYS`): passada a janela a decisao precisa ser REAFIRMADA
 * (atualizando `addedAt`) ou removida — o run normal avisa (`::warning::`) e o
 * `--review` escala para violacao, como nas outras allowlists do repositorio.
 *
 * `semDeps` e o que a isencao AFIRMA sobre o comando:
 *   - `"passa"`         — o comando termina 0 sem `node_modules` (o grafo
 *                         alcanca um pacote so por caminho tardio que ele nao
 *                         percorre). FALSA se houver `import` de topo ou
 *                         binario de dependencia no grafo;
 *   - `"falha-fechado"` — sem o pacote o comando NAO cunha veredito (sai 2 com
 *                         "NAO JULGAVEL", ou morre no binario ausente).
 *
 * TODAS as entradas abaixo sao do segundo tipo, e o motivo diz o que isso
 * significa: o verde do job depende do `node_modules` do AMBIENTE (imagem do
 * runner / workspace reusado), nao de um passo do repositorio. E o remedio
 * canonico (o par de install) que aposenta cada uma.
 *
 * @type {{job: string, addedAt: string, reason: string, semDeps: "passa"|"falha-fechado"}[]}
 */
export const JOB_DEPS_ALLOWLIST = [
  {
    // A UNICA entrada deste tipo, e a que mostra por que `semDeps` nao e
    // decorativo: o grafo ALCANCA `js-yaml` (o `check-bun-mirror.mjs`, importado
    // pelo `check-env-mirror.mjs`, o carrega em caminho tardio), mas os dois
    // comandos do job produzem o MESMO veredito com e sem `node_modules` —
    // medido num checkout sem as dependencias: `check-env-mirror --json` devolve
    // `state: diverged` com as duas violacoes e sai 1; o publicador `--dry-run`
    // monta o mesmo corpo e sai 0. O caminho tardio NAO e percorrido, entao a
    // isencao VERDADEIRA aqui e "passa" (e ela nao vale para um `import` de topo
    // ou um binario: esses nao tem caminho alternativo).
    job: ".gitea/workflows/env-mirror-drift.yml::env-mirror-drift",
    addedAt: "2026-09-17",
    semDeps: "passa",
    reason:
      "o cron roda `bun scripts/*.mjs` (a imagem da forja nao garante `node` no PATH) e os dois comandos foram MEDIDOS identicos com e sem node_modules — o `js-yaml` do grafo so aparece em caminho tardio que este job nunca percorre",
  },
  {
    job: ".github/workflows/benchmark-weekly.yml::registry-allowlist-review",
    addedAt: "2026-09-17",
    semDeps: "falha-fechado",
    reason:
      "os tres comandos julgam YAML (`check-registry-source`, `check-pipefail-sigpipe`, `declared-debt-issue`): sem `js-yaml` eles saem 2 e nenhuma decisao de escopo e publicada — o job depende do node_modules do runner",
  },
  {
    job: ".github/workflows/pr-check.yml::workflow-run-syntax",
    addedAt: "2026-09-17",
    semDeps: "falha-fechado",
    reason:
      "o gate de sintaxe e o publicador do remendo leem YAML, e o sub-test de mutacao roda `vitest` (binario do node_modules): sem as dependencias o job nao prova nem publica nada",
  },
  {
    job: ".github/workflows/utf8-check.yml::utf8-check",
    addedAt: "2026-09-17",
    semDeps: "falha-fechado",
    reason:
      "o job mistura escopo puro (`check-utf8-scope`/`check-crlf-scope`, exit 0 sem deps) com dois guards que leem YAML (`check-no-setup-bun`, `check-bun-mirror`): os dois ultimos saem 2 sem `js-yaml`",
  },
]

/** A janela de revisao das isencoes deste guard (o default do modulo compartilhado). */
export const JOB_DEPS_REVIEW_DAYS = DEFAULT_REVIEW_DAYS

// =============================================================================
// O SEGUNDO CONTRATO DO MESMO JOB: em que CAMINHO o veredito dele roda
// =============================================================================
//
// POR QUE ESTE CONTRATO EXISTE (medido em 24/09/2026). O primeiro contrato deste
// guard diz de ONDE vem o `node_modules` do job. Ele nao diz ONDE o job roda — e
// o caminho e o que decide se o veredito SAI. Um gate de LEITURA DE YAML nao usa
// docker, nao sobe servico e nao fala com a rede: ele so LE o repositorio. Preso
// ao runner da forja, o veredito dele passa a depender de a infraestrutura dela
// estar de pe — medido: com o runner auto-hospedado OFFLINE, os 50 jobs do
// `pr-check` ficaram na fila ~35min e os gates de leitura nao cunharam veredito
// nenhum (a forja nao erra: ela ESPERA, e nada fica vermelho).
//
// A CLASSE e DERIVADA, nao enumerada — e sao DOIS fatos do proprio job:
//   (1) ele LE YAML: algum passo roda um leitor (`node scripts/<X>.mjs`) cujo
//       fecho de imports RELATIVOS alcanca a leitura compartilhada
//       (`forge-workflows.mjs`, a fonte unica do YAML validado) ou importa
//       `js-yaml` direto. A deteccao e por SPECIFIER, nunca por mencao em prosa:
//       um comentario que cita o arquivo nao faz um job ler YAML;
//   (2) ele nao tem NENHUM fato que exija a imagem da forja: nada de `services:`,
//       nada de docker (comando ou `uses: docker/*`), nada de suite de mutacao,
//       nada de `bun x <pacote>` e nenhum shell alem do plumbing do Bun
//       (`scripts/setup-bun-ci.sh`). Um shell QUALQUER tira o job da classe: o
//       que o corpo dele executa este contrato nao prova — e presumir "so
//       leitura" ali seria a aposta que este repositorio nao faz. E o que a
//       `RUNNER_PATH_ALLOWLIST` declara, com o motivo, para os jobs que
//       EXECUTAM a stack (o `stack-per-commit` e o `check`).
//
// O VEREDITO: classe verdadeira + `runs-on:` que pede a forja (`self-hosted`) =
// VIOLACAO. O gate de leitura de YAML tem de ter um caminho que nao dependa
// dela; no espelho esse caminho e o hospedado (`ubuntu-latest`), que nao passa
// pela fila da forja.
//
// O ESCOPO, declarado: os workflows do ESPELHO (`.github/workflows/*`) com
// gatilho de `pull_request` — os gates do MERGE. Do lado da forja dona do merge
// o `runs-on: ubuntu-latest` E o `act_runner` dela (o label mapeia para a imagem
// `ubuntu-bun`), entao a regra nao tem o que decidir la; e um cron nao bloqueia
// merge (a decisao dele e a divida declarada, noutro canal).

/** O caminho que NAO depende do runner da forja (no espelho: o hospedado). */
export const CAMINHO_HOSPEDADO = "ubuntu-latest"

/** O que um `runs-on:` pede quando o job roda na infraestrutura da forja. */
export const PEDE_A_FORJA = /(^|[\s,[{])self-hosted([\s,\]}]|$)/

/** A leitura COMPARTILHADA dos workflows: quem a alcanca julga YAML. */
export const LEITURA_COMPARTILHADA = "forge-workflows.mjs"

/** O unico shell que NAO tira o job da classe (e plumbing, nao veredito). */
export const SHELL_DE_PLUMBING = /setup-bun-ci\.sh$/

/**
 * O REMEDIO da classe: o caminho hospedado MAIS o par canonico de install (o
 * hospedado chega sem `node_modules` nenhum — e sem ele o leitor de YAML sai 2).
 */
export const RUNNER_PATH_REMEDIO =
  `rode o job no caminho que nao depende da forja (\`runs-on: ${CAMINHO_HOSPEDADO}\`) ` +
  "com o par canonico de install, ou registre a excecao em RUNNER_PATH_ALLOWLIST com `addedAt` e motivo"

/** A janela de revisao das excecoes deste contrato (a mesma do modulo compartilhado). */
export const RUNNER_PATH_REVIEW_DAYS = DEFAULT_REVIEW_DAYS

/**
 * As EXCECOES declaradas do contrato do caminho: jobs que o scan de passo le como
 * leitura pura mas que (provadamente) EXECUTAM a stack, com a data e o motivo.
 *
 * Cada motivo nomeia o FATO que o scan de passo nao ve — e e por isso que a
 * classe precisa de duas saidas (mover OU declarar), e nao de uma regra mais
 * esperta que adivinhe o que um script faz por dentro.
 *
 * @type {{job: string, addedAt: string, reason: string}[]}
 */
export const RUNNER_PATH_ALLOWLIST = [
  {
    job: ".github/workflows/pr-check.yml::check",
    addedAt: "2026-09-24",
    reason:
      "o job EXECUTA a stack (o `check-mirror-coverage.mjs` SPAWNA os guards do recorte em worktrees, e `bun run lint`/`bunx prisma generate` rodam de verdade): ele le YAML de passagem, nao E um gate de leitura — a classe derivada e de LEITURA, e mover este job nao muda veredito nenhum, so o lugar onde a suite inteira roda",
  },
  {
    job: ".github/workflows/pr-check.yml::pre-commit-in-runner-proof",
    addedAt: "2026-09-24",
    reason:
      "a prova roda o hook DENTRO da imagem do runner `ubuntu-bun` (o `docker pull`/`docker run` vive no corpo de `prove-pre-commit-in-runner.mjs`, fora do scan de passo): o que ela MEDE e a IMAGEM da forja com o tier-1 engajado — no caminho hospedado nao ha imagem local e a medicao passaria a medir outra coisa",
  },
]

/** A linha de uma CHAVE filha direta de um job (delega ao `forge-workflows`). */
function valorDeChaveDoJob(lines, headerIdx, jobIndent, key) {
  const idx = yamlChildKey(lines, headerIdx, jobIndent, key)
  if (idx === null) return null
  const m = /^\s*[A-Za-z_][A-Za-z0-9_.-]*:\s*(.*?)\s*$/.exec(lines[idx])
  return m === null ? "" : m[1].replace(/^["']|["']$/g, "").trim()
}

/**
 * O fecho dos imports RELATIVOS de um modulo alcanca a leitura de YAML?
 *
 * Verdadeiro quando algum arquivo do fecho importa `js-yaml` (bare specifier — a
 * MESMA regua de `extractBareSpecifiers`/`isBareSpecifier`) ou a leitura
 * compartilhada (`forge-workflows.mjs`). A resolucao relativa e a do repositorio
 * (`resolveRelativo`), e o teto de profundidade e o mesmo do grafo de deps.
 *
 * @param {string} abs
 * @param {{visto?: Set<string>, profundidade?: number}} [opts]
 * @returns {boolean}
 */
export function leYaml(abs, { visto = new Set(), profundidade = 0 } = {}) {
  if (profundidade > MAX_PROFUNDIDADE || visto.has(abs) || !existsSync(abs)) return false
  visto.add(abs)
  let texto
  try {
    texto = readFileSync(abs, "utf8")
  } catch {
    return false
  }
  if (extractBareSpecifiers(texto).some((s) => isBareSpecifier(s) && s === "js-yaml")) return true
  const relRe = /(?:from\s*|require\s*\(\s*|import\s*\(\s*)["'](\.[^"']+)["']/g
  for (const m of texto.matchAll(relRe)) {
    const alvo = resolveRelativo(m[1], abs)
    if (alvo === null) continue
    if (basename(alvo) === LEITURA_COMPARTILHADA) return true
    if (leYaml(alvo, { visto, profundidade: profundidade + 1 })) return true
  }
  return false
}

/** O workflow dispara em `pull_request` (o gate do merge)? */
export function disparaEmPullRequest(lines) {
  const i = lines.findIndex((l) => /^on:/.test(l))
  if (i === -1) return false
  const inline = lines[i].replace(/^on:\s*/, "")
  if (inline !== "") return /pull_request/.test(inline)
  for (let k = i + 1; k < lines.length; k++) {
    const l = lines[k]
    if (l.trim() === "" || l.trim().startsWith("#")) continue
    if (!/^\s/.test(l)) return false
    if (/^\s*pull_request:/.test(l)) return true
  }
  return false
}

/**
 * A CLASSE derivada + os FATOS de cada job do espelho que dispara em PR.
 *
 * @param {{files: {path: string, text: string}[]}} scan
 * @param {{root?: string}} [opts]
 * @returns {{
 *   jobs: {id: string, arquivo: string, job: string, caminho: string|null, servicos: boolean,
 *          leitores: {linha: number, alvo: string, leYaml: boolean}[], fatos: string[],
 *          classe: boolean, prende: boolean}[],
 *   foraDoEscopo: {arquivo: string, job: string, motivo: string}[],
 * }}
 */
export function auditaLeituraDeYaml(scan, { root = ROOT } = {}) {
  const jobs = []
  const foraDoEscopo = []
  for (const w of scan.files) {
    if (!w.path.startsWith(`${GITHUB_WORKFLOW_DIR}/`)) continue
    if (!w.path.endsWith(".yml") && !w.path.endsWith(".yaml")) continue
    const lines = w.text.split(/\r?\n/)
    if (!disparaEmPullRequest(lines)) continue
    const { jobsIdx, jobIndent } = jobsLayout(lines)
    if (jobIndent === null) {
      foraDoEscopo.push({
        arquivo: w.path,
        job: "(todos)",
        motivo: "o `jobs:` do workflow nao pode ser lido (o recuo dos jobs nao foi medido)",
      })
      continue
    }
    const cabecalhos = []
    for (let k = jobsIdx + 1; k < lines.length; k++) {
      const l = lines[k]
      if (l.trim() === "" || l.trim().startsWith("#")) continue
      const ind = l.match(/^[ \t]*/)[0].length
      if (ind < jobIndent) break
      if (ind !== jobIndent) continue
      const nome = jobKeyName(l, jobIndent)
      if (nome !== null) cabecalhos.push({ nome, idx: k })
    }
    const passosPorJob = new Map()
    for (const passo of workflowRunSteps(w.text)) {
      const job = passo.job ?? "(sem job)"
      if (!passosPorJob.has(job)) passosPorJob.set(job, [])
      passosPorJob.get(job).push(passo)
    }
    for (let i = 0; i < cabecalhos.length; i++) {
      const { nome, idx } = cabecalhos[i]
      const fim = i + 1 < cabecalhos.length ? cabecalhos[i + 1].idx : lines.length
      const corpo = lines.slice(idx, fim)
      const caminho = valorDeChaveDoJob(lines, idx, jobIndent, "runs-on")
      if (caminho === null || caminho === "") {
        foraDoEscopo.push({
          arquivo: w.path,
          job: nome,
          motivo: "o job nao declara `runs-on:` (o caminho nao e provado por leitura)",
        })
        continue
      }
      const servicos = yamlChildKey(lines, idx, jobIndent, "services") !== null
      const usaDocker = corpo.some((l) => {
        const t = l.trim()
        return !t.startsWith("#") && /^-?\s*uses:\s*docker\//.test(t)
      })
      const leitores = []
      const fatos = []
      if (servicos) fatos.push("declara `services:` (servico da forja)")
      if (usaDocker) fatos.push("usa uma action `docker/*`")
      for (const passo of passosPorJob.get(nome) ?? []) {
        for (const comando of shellCommands(passo.body, { startLine: passo.line })) {
          const alvo = alvoDoLancador(comando)
          const primeiro = alvo.ok ? alvo.alvo : null
          if (
            comando.programa === "node" &&
            /^scripts\/[A-Za-z0-9_./-]+\.mjs$/.test(primeiro ?? "")
          ) {
            const abs = join(root, primeiro)
            leitores.push({ linha: comando.linha, alvo: primeiro, leYaml: leYaml(abs) })
            continue
          }
          if (comando.programa === "docker" || comando.programa === "docker-compose")
            fatos.push(`roda \`${comando.programa}\` (L${comando.linha})`)
          else if (
            comando.programa === "bash" ||
            comando.programa === "sh" ||
            comando.programa === "."
          ) {
            const shell = (comando.tokens ?? []).find((t) => /\.(sh|bash)$/.test(t))
            if (shell !== undefined && !SHELL_DE_PLUMBING.test(shell))
              fatos.push(`roda o shell \`${shell}\` (L${comando.linha})`)
          } else if (PACKAGE_MANAGERS.has(comando.programa) && PACOTE_SUBCOMMANDS.has(primeiro))
            fatos.push(`executa um pacote (\`${comando.programa} ${primeiro}\`)`)
          else if (comando.programa === "act") fatos.push("roda `act` (precisa de docker)")
        }
      }
      const le = leitores.filter((l) => l.leYaml)
      jobs.push({
        id: `${w.path}::${nome}`,
        arquivo: w.path,
        job: nome,
        caminho,
        servicos,
        leitores,
        fatos: [...new Set(fatos)].sort(),
        classe: le.length > 0 && fatos.length === 0,
        prende: le.length > 0 && fatos.length === 0 && PEDE_A_FORJA.test(caminho),
      })
    }
  }
  return { jobs, foraDoEscopo }
}

const ROOT = process.cwd()

// =============================================================================
// O grafo de dependencias de um comando
// =============================================================================

/**
 * Os `import`/`export ... from` ESTATICOS de um conteudo — os que carregam no
 * START do modulo, sem caminho alternativo.
 *
 * A distincao importa porque o desfecho sem `node_modules` e DIFERENTE: um
 * `import` de topo derruba o processo (`ERR_MODULE_NOT_FOUND`) antes de
 * qualquer veredito; um specifier alcancado dentro de funcao (`require(...)`,
 * `await import(...)`) so falha se aquele caminho for percorrido — que e o que
 * os guards de YAML fazem, e por isso a isencao `semDeps: "passa"` existe.
 *
 * "De topo" e medido por SINTAXE (declaracao `import`/`export from` fora de
 * qualquer bloco): `{`/`(`, `}`/`)` e as STRINGS sao contados para descobrir se
 * a declaracao esta aninhada — uma declaracao dentro de uma funcao nao existe
 * em ESM, mas o mesmo texto pode aparecer dentro de uma string, e contar string
 * como codigo seria medir texto, nao programa.
 *
 * O filtro de `isBareSpecifier` (do `check-no-leaked-imports`) e o que faz isto
 * ser DEPENDENCIA DE `node_modules` e nao "todo specifier": `node:fs`, um alias
 * de tsconfig e um caminho relativo nao pedem pacote nenhum.
 *
 * @param {string} content
 * @returns {Set<string>} os bare specifiers carregados no start
 */
export function importsEstaticos(content) {
  const especs = new Set()
  const strings = stringRanges(content)
  const dentroDeString = (idx) => strings.some(([s, e]) => idx >= s && idx < e)
  const re =
    /(?:^|[\s;{}()])(?:import\s+(?:[^"'`\n]*?\s+from\s*)?|export\s+[^"'`\n]*?\s+from\s*|export\s*\*\s*from\s*)["']([^"']+)["']/g
  for (const m of content.matchAll(re)) {
    const idx = m.index + m[0].indexOf("import", 0)
    const marca = m[0].includes("export") ? m.index + m[0].indexOf("export") : idx
    if (dentroDeString(marca)) continue
    if (profundidadeDeBloco(content, marca, strings) !== 0) continue
    if (isBareSpecifier(m[1])) especs.add(m[1])
  }
  return especs
}

/**
 * A profundidade de aninhamento (`{`, `(`, `[`) ANTES de um indice, ignorando o
 * que esta dentro de strings e comentarios — o que separa "declaracao de topo"
 * de "dentro de funcao".
 *
 * @param {string} content
 * @param {number} idx
 * @param {[number, number][]} strings
 * @returns {number}
 */
function profundidadeDeBloco(content, idx, strings) {
  let nivel = 0
  const dentroDeString = (i) => strings.some(([s, e]) => i >= s && i < e)
  for (let i = 0; i < idx; i++) {
    if (dentroDeString(i)) continue
    const ch = content[i]
    if (ch === "/" && content[i + 1] === "/") {
      while (i < idx && content[i] !== "\n") i++
      continue
    }
    if (ch === "/" && content[i + 1] === "*") {
      i += 2
      while (i < idx && !(content[i] === "*" && content[i + 1] === "/")) i++
      i++
      continue
    }
    if (ch === "{" || ch === "(" || ch === "[") nivel++
    else if (ch === "}" || ch === ")" || ch === "]") nivel--
  }
  return nivel
}

/**
 * O grafo de um MODULO: os bare specifiers que ele carrega no start
 * (`estatico`) e os que so aparecem em caminho tardio (`tardio`), seguindo os
 * imports RELATIVOS (o grafo do repositorio inteiro — um guard que importa
 * `forge-workflows.mjs`, que por sua vez alcanca `js-yaml`, depende do pacote
 * tanto quanto se o importasse direto).
 *
 * @param {string} abs         caminho absoluto do modulo
 * @param {{visto?: Set<string>, profundidade?: number}} [opts]
 * @returns {{estatico: string[], tardio: string[], arquivos: number}}
 */
export function grafoDoModulo(abs, { visto = new Set(), profundidade = 0 } = {}) {
  const estatico = new Set()
  const tardio = new Set()
  const fila = [[abs, profundidade]]
  let arquivos = 0
  while (fila.length > 0) {
    const [atual, nivel] = fila.shift()
    if (visto.has(atual) || !existsSync(atual) || nivel > MAX_PROFUNDIDADE) continue
    visto.add(atual)
    let texto
    try {
      texto = readFileSync(atual, "utf8")
    } catch {
      continue
    }
    arquivos++
    const deTopo = importsEstaticos(texto)
    for (const spec of extractBareSpecifiers(texto)) {
      if (deTopo.has(spec)) estatico.add(spec)
      else tardio.add(spec)
    }
    // Os RELATIVOS: o `./x.mjs`/`./x.js`/`./x/index.mjs` do repositorio. O que
    // NAO resolve fica de fora (nao ha o que seguir) — a classe do import
    // relativo quebrado e do `check-no-leaked-imports`, nao deste guard.
    const relRe = /(?:from\s*|require\s*\(\s*|import\s*\(\s*)["'](\.[^"']+)["']/g
    for (const m of texto.matchAll(relRe)) {
      const alvo = resolveRelativo(m[1], atual)
      if (alvo !== null) fila.push([alvo, nivel + 1])
    }
  }
  return {
    estatico: [...estatico].sort(),
    tardio: [...tardio].sort(),
    arquivos,
  }
}

/**
 * Resolve um import RELATIVO para um arquivo do repositorio, ou `null`.
 *
 * A escada e a do ESM neste repositorio (o specifier literal, as extensoes que
 * ele usa e o `index` do diretorio). `require.resolve` do Node NAO serve aqui:
 * ele ancora a resolucao no modulo que CHAMA, e nao no arquivo de onde o
 * specifier veio — que e a pergunta deste guard.
 *
 * @param {string} spec
 * @param {string} deAbs
 * @returns {string|null}
 */
export function resolveRelativo(spec, deAbs) {
  const base = resolve(dirname(deAbs), spec)
  for (const suf of ["", ...EXTENSOES_JS, ...EXTENSOES_SHELL]) {
    const p = base + suf
    if (existsSync(p) && statSync(p).isFile()) return p
  }
  for (const suf of EXTENSOES_JS) {
    const p = join(base, `index${suf}`)
    if (existsSync(p) && statSync(p).isFile()) return p
  }
  return null
}

/**
 * O veredito de UM comando: ele exige `node_modules`, e de que grau.
 *
 * O desfecho e um FATO do repositorio (o grafo e estatico), nunca uma suposicao
 * sobre o runner:
 *   - `grau: "binario"` — o comando E um binario do `node_modules` (`vitest`,
 *     `tsc`, `prisma`), ou o executa por um gerenciador (`bunx vitest`). Sem
 *     `node_modules` ele nem existe;
 *   - `grau: "estatico"` — o alvo carrega um pacote no START (crash garantido);
 *   - `grau: "tardio"`  — o alvo so alcanca o pacote dentro de funcao (o
 *     desfecho depende do caminho: por isso a isencao pode dizer `passa`).
 *
 * @param {{programa: string, tokens: string[], linha?: number}} comando
 * @param {{root: string, pacotes: Set<string>, scripts?: Record<string, string>, profundidade?: number, visto?: Set<string>}} ctx
 * @returns {{precisa: boolean, grau: "nenhum"|"binario"|"estatico"|"tardio", pacotes: string[], ferramentas: string[], alvo?: string, internos?: {linha: number, programa: string, tokens: string[], texto: string, deps: object}[], foraDoEscopo?: {categoria: string, motivo: string}}}
 */
export function exigeDeps(comando, ctx) {
  const prof = ctx.profundidade ?? 0
  const { programa, tokens } = comando
  const alvo = tokens?.[0]

  if (PACKAGE_MANAGERS.has(programa)) {
    if (INSTALL_SUBCOMMANDS.has(alvo)) return { precisa: false, grau: "nenhum" }
    if (alvo === "run" || alvo === undefined) return exigeDepsDeEntrada(comando, ctx)
    if (PACOTE_SUBCOMMANDS.has(alvo)) {
      const pacote = tokens[1]
      if (pacote === undefined)
        return {
          precisa: false,
          grau: "nenhum",
          foraDoEscopo: { categoria: "gerenciador", motivo: `${programa} ${alvo} sem pacote` },
        }
      return {
        precisa: true,
        grau: "binario",
        pacotes: [pacote.replace(/@[\d^~].*$/, "")],
        ferramentas: [`${programa} ${alvo}`],
      }
    }
    const arquivo = tokens.find((t) => EXTENSOES_JS.some((e) => t.endsWith(e)))
    if (arquivo !== undefined) return exigeDepsDeAlvo(resolve(ctx.root, arquivo), ctx, programa)
    // `npx <pacote>`/`bunx <pacote>`: o pacote DECLARADO e um binario do
    // node_modules; um pacote NAO declarado e resolvido pela REDE em runtime
    // (nao e dependencia do repositorio — a mesma leitura do ALLOWLIST do
    // `check-hook-commands` para o `bunx @lhci/cli`).
    if (programa === "npx" || programa === "bunx" || programa === "pnpx") {
      const pacote = tokens?.[0]
      if (pacote === undefined || pacote.startsWith("-")) return { precisa: false, grau: "nenhum" }
      const limpo = pacote.replace(/@[\d^~].*$/, "")
      if (ctx.pacotes.has(limpo))
        return { precisa: true, grau: "binario", pacotes: [limpo], ferramentas: [programa] }
      return {
        precisa: false,
        grau: "nenhum",
        ...(prof === 0
          ? {
              foraDoEscopo: {
                categoria: "resolvido-pela-rede",
                motivo: `${programa} ${pacote} nao e dependencia do repositorio`,
              },
            }
          : {}),
      }
    }
    // `bun --version`, `bun pm ls`: o gerenciador sem entrada de repositorio nao
    // executa nada que o guard possa seguir — e' um fato, nao uma duvida.
    if (alvo === undefined || alvo.startsWith("-")) return { precisa: false, grau: "nenhum" }
    return {
      precisa: false,
      grau: "nenhum",
      ...(prof === 0
        ? {
            foraDoEscopo: {
              categoria: "gerenciador",
              motivo: `${programa} ${tokens.join(" ")}`.trim(),
            },
          }
        : {}),
    }
  }

  if (INTERPRETERS.has(programa)) {
    // O ALVO pela CLASSE do flag — a MESMA regua do `check-hook-commands`
    // (`alvoDoLancador` → `classeDoFlag`, por interpretador). Enquanto a leitura
    // era `alvo === undefined || alvo.startsWith("-")`, TODO flag na frente do
    // programa virava "payload inline": `node --version` (que nao le arquivo
    // nenhum) ganhava um rotulo falso, e `bash -u x.sh`/`node --no-warnings
    // x.mjs`/`python3 -B x.py` (o alvo E o arquivo) saiam do escopo sem ninguem
    // decidir. A classe diz qual e o caso, e o motivo vem DITO por ela.
    const lancador = alvoDoLancador(comando)
    if (!lancador.ok) {
      return {
        precisa: false,
        grau: "nenhum",
        ...(prof === 0
          ? {
              foraDoEscopo: {
                categoria: CATEGORIA_DA_CLASSE[lancador.classe] ?? "flag-nao-provado",
                motivo: lancador.motivo,
              },
            }
          : {}),
      }
    }
    const alvoDoScript = lancador.alvo
    // `python3 scripts/check_crlf.py`: fora do escopo DECLARADO deste guard (as
    // dependencias dele nao vivem no `node_modules`) — fato, nao duvida.
    if (programa.startsWith("python"))
      return {
        precisa: false,
        grau: "nenhum",
        alvo: alvoDoScript,
        ...(prof === 0
          ? {
              foraDoEscopo: {
                categoria: "fora-do-node",
                motivo: `${programa} ${alvoDoScript} (dependencias fora do node_modules)`,
              },
            }
          : {}),
      }
    // `bash scripts/x.sh`/`sh .husky/pre-commit`: o CORPO do script e' relido com
    // a mesma extracao de comandos — um `bash scripts/x.sh` que chama `node
    // scripts/y.mjs` depende do que `y.mjs` alcanca.
    return exigeDepsDeAlvo(absoluto(ctx.root, alvoDoScript), ctx, programa)
  }

  if (programa.startsWith("./") || programa.startsWith("../") || programa.startsWith("/")) {
    const abs = absoluto(ctx.root, programa)
    if (existsSync(abs)) return exigeDepsDeAlvo(abs, ctx, "execucao direta")
    if (/node_modules\/\.bin\//.test(programa))
      return {
        precisa: true,
        grau: "binario",
        pacotes: [programa.split("/").pop()],
        ferramentas: [programa],
      }
    return {
      precisa: false,
      grau: "nenhum",
      foraDoEscopo: {
        categoria: "caminho-ausente",
        motivo: `caminho direto ausente (${programa})`,
      },
    }
  }

  // Um `scripts/x.mjs` SEM `./` NAO e uma invocacao do shell: o que existe e o
  // NOME dentro de uma lista (o `EXPECTED_SCRIPTS=(...)` dos benchmarks), e
  // seguir esse texto como comando acusaria dependencia de um arquivo que o job
  // nunca executa. E fato, nomeado — nao um achado.
  if (programa.includes("/"))
    return {
      precisa: false,
      grau: "nenhum",
      foraDoEscopo: {
        categoria: "nome-em-lista",
        motivo: `nome de arquivo em lista (${programa})`,
      },
    }

  if (EXTERNAL_TOOLS.has(programa)) return { precisa: false, grau: "nenhum" }

  const pacote = BIN_PACKAGES[programa] ?? (ctx.pacotes.has(programa) ? programa : null)
  if (pacote !== null || binInstalado(ctx.root, programa))
    return {
      precisa: true,
      grau: "binario",
      pacotes: [pacote ?? programa],
      ferramentas: [programa],
    }

  // sem classificacao: NOMEADO (nunca escondido) — mas so na SUPERFICIE que o
  // leitor do workflow ve (o comando do proprio passo). Dentro dos scripts a
  // mesma pergunta tem outro dono (`check-workflow-refs`/`check-hook-commands`,
  // que julgam comando por arquivo), e nomear cada palavra de shell do corpo
  // deles encheria o relatorio de ruido ate esconder o achado de verdade.
  return {
    precisa: false,
    grau: "nenhum",
    ...(prof === 0
      ? {
          foraDoEscopo: {
            categoria: "ferramenta-do-sistema",
            motivo: `programa nao classificado (${programa})`,
          },
        }
      : {}),
  }
}

/**
 * O veredito do alvo de um interpretador: arquivo JS (grafo) ou script shell
 * (o corpo dele e relido com a MESMA extracao de comandos).
 *
 * @param {string} abs
 * @param {object} ctx
 * @param {string} papel
 * @returns {object}
 */
function exigeDepsDeAlvo(abs, ctx, papel) {
  if (!existsSync(abs))
    return {
      precisa: false,
      grau: "nenhum",
      ...((ctx.profundidade ?? 0) === 0
        ? { foraDoEscopo: { categoria: "caminho-ausente", motivo: `${papel}: ${abs} ausente` } }
        : {}),
    }
  if (EXTENSOES_JS.some((e) => abs.endsWith(e))) {
    const grafo = grafoDoModulo(abs, {
      visto: ctx.visto ?? new Set(),
      profundidade: ctx.profundidade ?? 0,
    })
    if (grafo.estatico.length > 0)
      return { precisa: true, grau: "estatico", pacotes: grafo.estatico, alvo: abs }
    if (grafo.tardio.length > 0)
      return { precisa: true, grau: "tardio", pacotes: grafo.tardio, alvo: abs }
    return { precisa: false, grau: "nenhum", alvo: abs }
  }
  if (ehShell(abs)) {
    if ((ctx.profundidade ?? 0) >= MAX_PROFUNDIDADE)
      return {
        precisa: false,
        grau: "nenhum",
        foraDoEscopo: { categoria: "profundidade", motivo: `profundidade maxima em ${abs}` },
      }
    let texto
    try {
      texto = readFileSync(abs, "utf8")
    } catch {
      return {
        precisa: false,
        grau: "nenhum",
        foraDoEscopo: { categoria: "caminho-ausente", motivo: `${papel}: ${abs} ilegivel` },
      }
    }
    const interna = comandosDeTexto(texto, {
      root: ctx.root,
      origem: abs,
      profundidade: (ctx.profundidade ?? 0) + 1,
    })
    // O CORPO do script agrega como a entrada do package.json: um `bash x.sh`
    // que chama `node y.mjs` (com `pg` de topo) depende de `pg` — devolver
    // `precisa: false` aqui faria o grau do script de shell MENTIR sobre o que
    // ele executa.
    return { ...agregaInternos(interna), alvo: abs, internos: interna }
  }
  return { precisa: false, grau: "nenhum", alvo: abs }
}

/**
 * O arquivo e' um SCRIPT DE SHELL? Pela extensao OU pelo shebang: os hooks
 * (`.husky/pre-commit`) e alguns scripts do repositorio nao tem extensao, e sem
 * o shebang eles sairiam do escopo — o corpo deles chama `node scripts/*.mjs`
 * como qualquer outro.
 *
 * @param {string} abs
 * @returns {boolean}
 */
export function ehShell(abs) {
  if (EXTENSOES_SHELL.some((e) => abs.endsWith(e))) return true
  try {
    const primeira = readFileSync(abs, "utf8").split("\n", 1)[0]
    return /^#!.*\b(?:ba)?sh\b/.test(primeira)
  } catch {
    return false
  }
}

/**
 * O veredito de um `bun run <entrada>`: a entrada do `package.json` e o que
 * executa — o guard segue o TEXTO dela (a mesma extracao de comandos), porque um
 * `bun run check:x` que chama `node scripts/y.mjs` depende do que `y.mjs`
 * alcança.
 *
 * @param {{programa: string, tokens: string[]}} comando
 * @param {object} ctx
 * @returns {object}
 */
function exigeDepsDeEntrada(comando, ctx) {
  const entrada = comando.tokens?.[1]
  const scripts = ctx.scripts ?? {}
  const texto = entrada === undefined ? undefined : scripts[entrada]
  if (typeof texto !== "string")
    return {
      precisa: false,
      grau: "nenhum",
      foraDoEscopo: {
        categoria: "entrada-do-package",
        motivo: `${comando.programa} run ${entrada ?? ""}`.trim(),
      },
    }
  const internos = comandosDeTexto(texto, {
    root: ctx.root,
    profundidade: (ctx.profundidade ?? 0) + 1,
  })
  return { ...agregaInternos(internos), alvo: `package.json scripts.${entrada}`, internos }
}

/**
 * O veredito AGREGADO de uma arvore de comandos (`bun run <entrada>` ou o corpo
 * de um script de shell): o grau mais forte que qualquer comando interno exige.
 *
 * A hierarquia e do desfecho concreto: `binario` e `estatico` derrubam o
 * processo sem alternativa (`passa` seria uma isencao falsa); `tardio` e o unico
 * que admite "nao percorri esse caminho".
 *
 * @param {{deps: object}[]} internos
 * @returns {{precisa: boolean, grau: string, pacotes: string[], ferramentas: string[]}}
 */
function agregaInternos(internos) {
  const deps = internos.map((i) => i.deps).filter((d) => d.precisa)
  const graus = new Set(deps.map((d) => d.grau))
  return {
    precisa: deps.length > 0,
    grau: graus.has("binario")
      ? "binario"
      : graus.has("estatico")
        ? "estatico"
        : deps.length > 0
          ? "tardio"
          : "nenhum",
    pacotes: [...new Set(deps.flatMap((d) => d.pacotes ?? []))].sort(),
    ferramentas: [...new Set(deps.flatMap((d) => d.ferramentas ?? []))].sort(),
  }
}

/**
 * Os comandos de um TEXTO (corpo de passo do workflow, entrada do package.json
 * ou script shell), com o veredito de dependencia de cada um. A extracao e a
 * MESMA dos hooks (`shellCommands`, do `check-hook-commands.mjs`).
 *
 * @param {string} texto
 * @param {{root: string, startLine?: number, origem?: string, profundidade?: number}} ctx
 * @returns {{linha: number, programa: string, tokens: string[], texto: string, deps: object}[]}
 */
export function comandosDeTexto(texto, ctx) {
  const base = {
    root: ctx.root,
    pacotes: ctx.pacotes ?? declaredPackages(ctx.root),
    scripts: ctx.scripts ?? lerScripts(ctx.root),
    profundidade: ctx.profundidade ?? 0,
  }
  const out = []
  for (const comando of shellCommands(texto, {
    startLine: ctx.startLine ?? 1,
    origem: ctx.origem ?? "",
  })) {
    const deps = exigeDeps(comando, base)
    out.push({ ...comando, texto: [comando.programa, ...comando.tokens].join(" "), deps })
  }
  return out
}

/** As entradas do `package.json` (a fonte de `bun run <entrada>`). */
export function lerScripts(root) {
  const full = join(root, "package.json")
  if (!existsSync(full)) return {}
  try {
    return JSON.parse(readFileSync(full, "utf8")).scripts ?? {}
  } catch {
    return {}
  }
}

/** O caminho absoluto de um alvo citado por um comando. */
function absoluto(root, alvo) {
  return isAbsolute(alvo) ? alvo : resolve(root, alvo)
}

// =============================================================================
// O veredito por JOB
// =============================================================================

/**
 * O veredito de UM job: ele INSTALA as dependencias? Quais comandos exigem
 * `node_modules`, e de que grau?
 *
 * @param {{arquivo: string, job: string, passos: {line: number, body: string}[]}} entrada
 * @param {{root: string}} ctx
 * @returns {{id: string, arquivo: string, job: string, instala: boolean, exige: object[], foraDoEscopo: object[], graus: string[]}}
 */
export function auditaJob(entrada, ctx) {
  const exige = []
  const foraDoEscopo = []
  let instala = false
  for (const passo of entrada.passos) {
    for (const comando of comandosDeTexto(passo.body, {
      root: ctx.root,
      startLine: passo.line,
      origem: entrada.job,
    })) {
      const ehInstall = (c) =>
        PACKAGE_MANAGERS.has(c.programa) && INSTALL_SUBCOMMANDS.has(c.tokens?.[0])
      if (ehInstall(comando)) instala = true
      // O INSTALL pode estar DENTRO de um script que o passo chama (um
      // `bash scripts/ci-setup.sh` que roda `bun install`): e a arvore que
      // responde de onde vem o `node_modules` do job.
      for (const interno of comandosInternos(comando)) if (ehInstall(interno)) instala = true
      // A EXIGENCIA vem da agregação: o comando do passo ja carrega o grau do que
      // ele alcanca (o corpo do script, a entrada do `package.json`). Reportar os
      // internos SEPARADOS duplicaria o mesmo achado — e o que o operador ve no
      // workflow e a linha do passo.
      if (comando.deps.precisa)
        exige.push({ linha: comando.linha, texto: comando.texto, ...comando.deps })
      if (comando.deps.foraDoEscopo !== undefined)
        foraDoEscopo.push({
          linha: comando.linha,
          texto: comando.texto,
          ...comando.deps.foraDoEscopo,
        })
    }
  }
  return {
    id: `${entrada.arquivo}::${entrada.job}`,
    arquivo: entrada.arquivo,
    job: entrada.job,
    instala,
    exige,
    foraDoEscopo,
    graus: [...new Set(exige.map((e) => e.grau))].sort(),
  }
}

/**
 * A arvore de um comando: o comando e o que ele alcanca em profundidade
 * (`bun run <entrada>` -> o texto da entrada; `bash scripts/x.sh` -> o corpo do
 * script; e o que ESSES alcancam, ate o teto de profundidade).
 *
 * @param {object} comando
 * @returns {object[]}
 */
export function comandosInternos(comando) {
  const out = []
  for (const interno of comando.deps?.internos ?? []) {
    out.push(interno, ...comandosInternos(interno))
  }
  return out
}

/**
 * O veredito de UM job — a forma que o relatorio, o `--json` e a suite leem.
 *
 * @typedef {{id: string, arquivo: string, job: string, instala: boolean, exige: object[], foraDoEscopo: object[], graus: string[]}} JobAuditado
 */

/**
 * A auditoria das duas forjas: o veredito de todo job + as violacoes da regra.
 *
 * As formas do retorno sao DECLARADAS (nao `object[]`): quem consome o
 * veredito — o relatorio, o `--json` e a suite unitaria em TypeScript — le
 * `violacao.job.id`, `isencoes.aged[0].days` e `isencoes.mentirosas[0].motivos`
 * direto, e um `object[]` transformaria cada leitura num cast.
 *
 * @param {string} root
 * @param {{isencoes?: object[], excecoesDeCaminho?: object[], now?: number}} [opts]
 * @returns {{
 *   jobs: JobAuditado[],
 *   violacoes: {tipo: string, job: JobAuditado}[],
 *   isencoes: {
 *     invalid: {id: string, why: string}[],
 *     aged: {id: string, addedAt: string, days: number, limit: number}[],
 *     semObjeto: {entrada: object, motivo: string}[],
 *     mentirosas: {entrada: object, motivos: string[]}[],
 *   },
 *   caminho: {
 *     jobs: JobDeLeitura[],
 *     foraDoEscopo: {arquivo: string, job: string, motivo: string}[],
 *     violacoes: JobDeLeitura[],
 *     filaMigracao: {id: string, caminho: string|null, leitores: {linha: number, alvo: string}[]}[],
 *     excecoes: {
 *       invalid: {id: string, why: string}[],
 *       aged: {id: string, addedAt: string, days: number, limit: number}[],
 *       semObjeto: {entrada: object, motivo: string}[],
 *       semPrender: {entrada: object, motivo: string}[],
 *     },
 *   },
 *   unjudgeable: object[],
 *   vazios: object[],
 * }}
 *
 * `JobDeLeitura` é o veredito do SEGUNDO contrato (o caminho): a classe derivada
 * e os fatos que a sustentam.
 *
 * @typedef {{id: string, arquivo: string, job: string, caminho: string|null,
 *   servicos: boolean, leitores: {linha: number, alvo: string, leYaml: boolean}[],
 *   fatos: string[], classe: boolean, prende: boolean}} JobDeLeitura
 */
export function auditaForjas(
  root,
  {
    isencoes = JOB_DEPS_ALLOWLIST,
    excecoesDeCaminho = RUNNER_PATH_ALLOWLIST,
    now = Date.now(),
  } = {},
) {
  const scan = readWorkflowScan(root)
  const jobs = []
  for (const w of scan.files) {
    const porJob = new Map()
    for (const passo of workflowRunSteps(w.text)) {
      const job = passo.job ?? "(sem job)"
      if (!porJob.has(job)) porJob.set(job, [])
      porJob.get(job).push(passo)
    }
    for (const [job, passos] of porJob)
      jobs.push(auditaJob({ arquivo: w.path, job, passos }, { root }))
  }

  const porId = new Map(jobs.map((j) => [j.id, j]))
  const declaradas = new Map(isencoes.map((e) => [e.job, e]))
  // O ESCOPO VARBIDO: um workflow que nao esta no conjunto lido nao sustenta
  // veredito nenhum sobre a declaracao que aponta para ele. Sem isto, rodar o
  // guard num FIXTURE (testes e prova por mutacao) acusaria as 14 isencoes reais
  // do repositorio como "sem objeto" — uma violacao sobre arquivo que aquele
  // escopo nao contem. No run real o conjunto e o repositorio inteiro, e toda
  // entrada e julgada.
  const varrridos = new Set(scan.files.map((f) => f.path))

  const violacoes = []
  for (const job of jobs) {
    if (job.instala || job.exige.length === 0) continue
    if (declaradas.has(job.id)) continue
    violacoes.push({ tipo: "sem-install", job })
  }

  // A regra de DATA e JANELA vem do modulo compartilhado (fonte unica das
  // allowlists): sem `addedAt` a isencao nao envelhece — fail-closed.
  const { invalid, aged } = reviewAddedAtEntries(isencoes, {
    idOf: (e) => e.job,
    now,
    reviewDays: JOB_DEPS_REVIEW_DAYS,
  })

  const semObjeto = []
  const mentirosas = []
  for (const entrada of isencoes) {
    if (!varrridos.has(String(entrada.job).split("::")[0])) continue
    const job = porId.get(entrada.job)
    if (job === undefined) {
      semObjeto.push({
        entrada,
        motivo: "o job declarado nao existe em nenhum workflow das forjas",
      })
      continue
    }
    if (job.instala)
      semObjeto.push({
        entrada,
        motivo: `o job INSTALA as dependencias (${REMEDIO}) — a isencao nao tem objeto`,
      })
    else if (job.exige.length === 0)
      semObjeto.push({
        entrada,
        motivo: "o job nao roda nenhum comando que exija node_modules (medido no grafo)",
      })
    if (entrada.semDeps === "passa") {
      const impossivel = job.exige.filter((e) => e.grau === "estatico" || e.grau === "binario")
      if (impossivel.length > 0)
        mentirosas.push({
          entrada,
          motivos: impossivel
            .slice(0, 3)
            .map((e) => `L${e.linha} ${e.texto} -> ${e.grau}: ${e.pacotes.join(", ")}`),
        })
    } else if (entrada.semDeps !== "falha-fechado") {
      mentirosas.push({
        entrada,
        motivos: [
          `\`semDeps\` invalido ('${entrada.semDeps ?? ""}') — use "passa" ou "falha-fechado"`,
        ],
      })
    }
  }

  // ── O segundo contrato: o CAMINHO em que o veredito do gate de leitura roda ─
  const leitura = auditaLeituraDeYaml(scan, { root })
  const { invalid: caminhoInvalid, aged: caminhoAged } = reviewAddedAtEntries(excecoesDeCaminho, {
    idOf: (e) => e.job,
    now,
    reviewDays: RUNNER_PATH_REVIEW_DAYS,
  })
  const declaradasNoCaminho = new Map(excecoesDeCaminho.map((e) => [e.job, e]))
  const caminhoIds = new Set(leitura.jobs.map((j) => j.id))
  const caminhoArquivos = new Set(leitura.jobs.map((j) => j.arquivo))
  const caminho = {
    jobs: leitura.jobs,
    foraDoEscopo: leitura.foraDoEscopo,
    violacoes: leitura.jobs.filter((j) => j.prende && !declaradasNoCaminho.has(j.id)),
    // A FILA DE MIGRACAO: quem AINDA pede a forja sem que nenhum fato exija a
    // imagem dela — a excecao declarada incluida. A publicação é o substituto
    // da varredura manual: o proximo a migrar le a fila do veredito em vez de
    // vasculhar workflows à mão (e a fila ENVELHECE sozinha: quando o job sai,
    // ela fica vazia; quando um entra, ela o nomeia).
    filaMigracao: leitura.jobs
      .filter((j) => j.prende)
      .map((j) => ({
        id: j.id,
        caminho: j.caminho,
        // SEM duplicata: o mesmo leitor em dois passos do MESMO job (medido:
        // `prove-pre-commit-in-runner.mjs` roda em L622 e L639 do pr-check) é
        // um arquivo na fila — quem migra lê o CONJUNTO, não a contagem de
        // invocações (o fato cru, com as duas linhas, segue inteiro em
        // `caminho.jobs[].leitores`).
        leitores: [
          ...new Map(
            j.leitores
              .filter((l) => l.leYaml)
              .map((l) => [l.alvo, { linha: l.linha, alvo: l.alvo }]),
          ).values(),
        ],
      }))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    excecoes: {
      invalid: caminhoInvalid,
      aged: caminhoAged,
      semObjeto: excecoesDeCaminho
        .filter((e) => caminhoArquivos.has(String(e.job).split("::")[0]) && !caminhoIds.has(e.job))
        .map((entrada) => ({
          entrada,
          motivo:
            "o job declarado nao esta no escopo deste contrato (ele nao existe, ou o workflow dele nao dispara em PR)",
        })),
      semPrender: excecoesDeCaminho
        .filter((e) => {
          const job = leitura.jobs.find((j) => j.id === e.job)
          return job !== undefined && !job.prende
        })
        .map((entrada) => {
          const job = leitura.jobs.find((j) => j.id === entrada.job)
          return {
            entrada,
            motivo:
              job.classe === false
                ? `o job saiu da classe (o scan de passo nao o le como leitura pura: ${job.fatos.join("; ")})`
                : `o job ja roda no caminho que nao depende da forja (\`${job.caminho}\`) — a excecao nao tem objeto`,
          }
        }),
    },
  }

  return {
    jobs,
    violacoes,
    isencoes: { invalid, aged, semObjeto, mentirosas },
    caminho,
    unjudgeable: scan.unjudgeable,
    vazios: scan.vazios,
  }
}

// =============================================================================
// CLI
// =============================================================================

/** O grau do comando, em portugues, para o relatorio. */
function grauTexto(grau) {
  if (grau === "binario") return "binario do node_modules (sem install ele nem existe)"
  if (grau === "estatico")
    return "import de TOPO (sem install o processo morre com ERR_MODULE_NOT_FOUND)"
  return "import TARDIO (o desfecho depende do caminho: pode nao ser percorrido)"
}

function relatorio(auditoria, { review = false } = {}) {
  const linhas = []
  for (const v of auditoria.violacoes) {
    linhas.push(`   - ${v.job.id}`)
    for (const e of v.job.exige.slice(0, 6)) linhas.push(`       L${e.linha} ${e.texto}`)
    for (const e of v.job.exige.slice(0, 3))
      linhas.push(
        `         -> ${e.pacotes.join(", ") || e.ferramentas.join(", ")} — ${grauTexto(e.grau)}`,
      )
    linhas.push(`       Remedio: ${REMEDIO}`)
  }
  for (const inv of auditoria.isencoes.invalid)
    linhas.push(
      `   - ${inv.id}: ${invalidAddedAtViolation({ label: inv.id, listName: "JOB_DEPS_ALLOWLIST", why: inv.why })}`,
    )
  for (const e of auditoria.isencoes.semObjeto)
    linhas.push(`   - ${e.entrada.job}: isencao SEM OBJETO — ${e.motivo}`)
  for (const e of auditoria.isencoes.mentirosas) {
    linhas.push(
      `   - ${e.entrada.job}: isencao que NAO pode ser verdadeira (afirmou semDeps: "${e.entrada.semDeps}")`,
    )
    for (const m of e.motivos) linhas.push(`       ${m}`)
  }
  for (const e of auditoria.caminho.violacoes) {
    linhas.push(
      `   - ${e.id}: LEITURA DE YAML presa ao caminho da forja (\`runs-on: ${e.caminho}\`)`,
    )
    for (const l of e.leitores.filter((x) => x.leYaml).slice(0, 4))
      linhas.push(`       L${l.linha} ${l.alvo} (le YAML pela leitura compartilhada)`)
    linhas.push(`       Remedio: ${RUNNER_PATH_REMEDIO}`)
  }
  for (const inv of auditoria.caminho.excecoes.invalid)
    linhas.push(
      `   - ${inv.id}: ${invalidAddedAtViolation({ label: inv.id, listName: "RUNNER_PATH_ALLOWLIST", why: inv.why })}`,
    )
  for (const e of auditoria.caminho.excecoes.semObjeto)
    linhas.push(`   - ${e.entrada.job}: excecao de CAMINHO SEM OBJETO — ${e.motivo}`)
  for (const e of auditoria.caminho.excecoes.semPrender)
    linhas.push(`   - ${e.entrada.job}: excecao de CAMINHO SEM OBJETO — ${e.motivo}`)
  if (review)
    for (const a of auditoria.caminho.excecoes.aged)
      linhas.push(
        `   - ${agedAddedAtViolation({
          label: a.id,
          listName: "RUNNER_PATH_ALLOWLIST",
          addedAt: a.addedAt,
          days: a.days,
          limit: a.limit,
          remedy: RUNNER_PATH_REMEDIO,
        })}`,
      )
  if (review)
    for (const a of auditoria.isencoes.aged)
      linhas.push(
        `   - ${agedAddedAtViolation({
          label: a.id,
          listName: "JOB_DEPS_ALLOWLIST",
          addedAt: a.addedAt,
          days: a.days,
          limit: a.limit,
          remedy: REMEDIO,
        })}`,
      )
  return linhas
}

function main() {
  const argv = process.argv.slice(2)
  const rootIdx = argv.indexOf("--root")
  if (rootIdx !== -1 && !argv[rootIdx + 1]) {
    console.error("❌ --root exige um diretorio (fail-closed)")
    process.exit(EXIT.NAOJULGAVEL)
  }
  const root = rootIdx !== -1 ? resolve(argv[rootIdx + 1]) : ROOT
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    console.error(`❌ --root inexistente ou nao e um diretorio: ${root}`)
    process.exit(EXIT.NAOJULGAVEL)
  }
  const review = argv.includes("--review")
  const json = argv.includes("--json")

  const auditoria = auditaForjas(root, { now: Date.now() })
  // A ordem do contrato: NAO JULGAVEL primeiro (sem ler todo o escopo, "nenhum
  // job exige dependencias" seria uma afirmacao sobre o que o guard nao leu).
  if (!json) {
    exitOnUnjudgeable(auditoria.unjudgeable)
    reportEmptyWorkflows(auditoria.vazios)
  } else if (auditoria.unjudgeable.length > 0) {
    console.log(
      JSON.stringify(
        { version: 1, naoJulgavel: auditoria.unjudgeable, exit: EXIT.NAOJULGAVEL },
        null,
        2,
      ),
    )
    process.exit(EXIT.NAOJULGAVEL)
  }

  const violacoes = [
    ...auditoria.violacoes.map((v) => ({ tipo: "sem-install", job: v.job.id })),
    ...auditoria.isencoes.invalid.map((i) => ({ tipo: "isencao-sem-data", job: i.id, why: i.why })),
    ...auditoria.isencoes.semObjeto.map((e) => ({
      tipo: "isencao-sem-objeto",
      job: e.entrada.job,
      why: e.motivo,
    })),
    ...auditoria.isencoes.mentirosas.map((e) => ({
      tipo: "isencao-mentirosa",
      job: e.entrada.job,
      why: e.motivos.join("; "),
    })),
    ...auditoria.caminho.violacoes.map((j) => ({
      tipo: "caminho-da-forja",
      job: j.id,
      caminho: j.caminho,
      why: `leitura de YAML no caminho da forja (${RUNNER_PATH_REMEDIO})`,
    })),
    ...auditoria.caminho.excecoes.semObjeto.map((e) => ({
      tipo: "excecao-caminho-sem-objeto",
      job: e.entrada.job,
      why: e.motivo,
    })),
    ...auditoria.caminho.excecoes.semPrender.map((e) => ({
      tipo: "excecao-caminho-sem-objeto",
      job: e.entrada.job,
      why: e.motivo,
    })),
    ...(review
      ? [...auditoria.isencoes.aged, ...auditoria.caminho.excecoes.aged].map((a) => ({
          tipo: "isencao-vencida",
          job: a.id,
          dias: a.days,
          limite: a.limit,
        }))
      : []),
  ]

  const comExigencia = auditoria.jobs.filter((j) => j.exige.length > 0)
  const isentos = comExigencia.filter((j) => !j.instala).length
  const foraDoEscopo = auditoria.jobs.flatMap((j) =>
    j.foraDoEscopo.map((n) => ({ job: j.id, ...n })),
  )
  const porCategoria = new Map()
  for (const f of foraDoEscopo)
    porCategoria.set(f.categoria, (porCategoria.get(f.categoria) ?? 0) + 1)

  if (json) {
    console.log(
      JSON.stringify(
        {
          version: 1,
          resumo: {
            jobs: auditoria.jobs.length,
            exigemDeps: comExigencia.length,
            instalam: comExigencia.length - isentos,
            isentosDeclarados: isentos,
            isencoes: JOB_DEPS_ALLOWLIST.length,
            foraDoEscopo: foraDoEscopo.length,
            foraDoEscopoPorCategoria: Object.fromEntries([...porCategoria].sort()),
            vencidas: auditoria.isencoes.aged.length,
            leituraDeYaml: auditoria.caminho.jobs.filter((j) => j.classe).length,
            leituraPresa: auditoria.caminho.jobs.filter((j) => j.prende).length,
            excecoesDeCaminho: RUNNER_PATH_ALLOWLIST.length,
            caminhoForaDoEscopo: auditoria.caminho.foraDoEscopo.length,
            filaMigracao: auditoria.caminho.filaMigracao.length,
            violacoes: violacoes.length,
          },
          caminho: {
            jobs: auditoria.caminho.jobs.map((j) => ({
              id: j.id,
              caminho: j.caminho,
              classe: j.classe,
              prende: j.prende,
              fatos: j.fatos,
              leitores: j.leitores.map((l) => ({ linha: l.linha, alvo: l.alvo, leYaml: l.leYaml })),
            })),
            foraDoEscopo: auditoria.caminho.foraDoEscopo,
            filaMigracao: auditoria.caminho.filaMigracao,
          },
          jobs: auditoria.jobs.map((j) => ({
            id: j.id,
            instala: j.instala,
            graus: j.graus,
            exige: j.exige.map((e) => ({
              linha: e.linha,
              texto: e.texto,
              grau: e.grau,
              pacotes: e.pacotes,
            })),
            isento: JOB_DEPS_ALLOWLIST.some((i) => i.job === j.id),
          })),
          foraDoEscopo,
          violacoes,
          exit: violacoes.length > 0 ? EXIT.VIOLACAO : EXIT.OK,
        },
        null,
        2,
      ),
    )
    process.exit(violacoes.length > 0 ? EXIT.VIOLACAO : EXIT.OK)
  }

  if (auditoria.isencoes.aged.length > 0 && !review) {
    console.warn(
      `::warning:: ${auditoria.isencoes.aged.length} isencao(oes) de JOB_DEPS_ALLOWLIST passaram a janela de revisao de ${JOB_DEPS_REVIEW_DAYS} dias — reafirme (atualizando \`addedAt\`) ou remova (o modo --review as escala a violacao no job semanal)`,
    )
  }

  if (auditoria.caminho.excecoes.aged.length > 0 && !review) {
    console.warn(
      `::warning:: ${auditoria.caminho.excecoes.aged.length} excecao(oes) de RUNNER_PATH_ALLOWLIST passaram a janela de revisao de ${RUNNER_PATH_REVIEW_DAYS} dias — reafirme (atualizando \`addedAt\`) ou remova (o modo --review as escala a violacao no job semanal)`,
    )
  }

  if (violacoes.length > 0) {
    console.error(`❌ ${violacoes.length} violacao(oes) no contrato de dependencias dos jobs:\n`)
    for (const linha of relatorio(auditoria, { review })) console.error(linha)
    console.error(
      `\n   O verde de um job que NAO instala nao tem causa no repositorio: ele depende do\n` +
        `   \`node_modules\` do ambiente (imagem do runner, workspace reusado). Sem o pacote, os\n` +
        `   guards de YAML saem 2 ("NAO JULGAVEL") e a mensagem que o operador ve nao diz isto.`,
    )
    process.exit(EXIT.VIOLACAO)
  }

  const venceram = auditoria.isencoes.aged.length
  const classe = auditoria.caminho.jobs.filter((j) => j.classe)
  console.log(
    `✅ Nenhum job roda comando dependente de node_modules sem install nem isencao declarada ` +
      `(${auditoria.jobs.length} jobs: ${comExigencia.length} exigem dependencias — ` +
      `${comExigencia.length - isentos} instalam, ${isentos} com isencao declarada${venceram > 0 ? `, ${venceram} com a janela vencida (aviso)` : ""}).`,
  )
  console.log(
    `✅ Nenhum gate de LEITURA DE YAML roda preso ao caminho da forja ` +
      `(${classe.length} job(s) da classe derivada, ${classe.filter((j) => j.caminho === CAMINHO_HOSPEDADO).length} no caminho hospedado, ` +
      `${auditoria.caminho.excecoes.semPrender.length} com excecao declarada e ` +
      `${auditoria.caminho.foraDoEscopo.length} fora do escopo — os dois NOMEADOS em \`--json\`).`,
  )
  // A FILA DE MIGRACAO, publicada no PROPRIO veredito: quem AINDA pede a forja
  // sem precisar dela — a excecao declarada incluida. Publicar aqui é o que
  // dispensa a varredura manual: o proximo a migrar le a fila onde o guard
  // cunha veredito, não num cruzamento que ninguem faz. Ordem DETERMINISTICA
  // (por id), para o texto ser comparavel entre rodadas; e a fila vazia NAO
  // imprime linha — verde absoluto é verde sem fila.
  if (auditoria.caminho.filaMigracao.length > 0) {
    console.log(
      `ℹ️  A fila de migracao do caminho da forja tem ${auditoria.caminho.filaMigracao.length} job(s) ` +
        `que AINDA pedem a forja sem que nenhum fato exija a imagem dela (a excecao declarada incluida) — ` +
        `em ordem, os proximos a migrar:`,
    )
    for (const f of auditoria.caminho.filaMigracao)
      console.log(
        `     - ${f.id} (\`runs-on: ${f.caminho}\`, le YAML por ${f.leitores.map((l) => l.alvo).join(", ")}) — ${RUNNER_PATH_REMEDIO}`,
      )
  }
  if (foraDoEscopo.length > 0) {
    const detalhe = [...porCategoria]
      .sort((a, b) => b[1] - a[1])
      .map(([c, n]) => `${n} ${c}`)
      .join(", ")
    console.log(
      `ℹ️  ${foraDoEscopo.length} comando(s) dos PASSOS fora do escopo do grafo de node_modules ` +
        `(${detalhe}) — contados, nomeados e disponiveis por inteiro em \`--json\`; o guard nao lhes cunha isencao`,
    )
    for (const f of foraDoEscopo.slice(0, 3))
      console.log(`     ex.: ${f.job} L${f.linha} ${f.texto}: ${f.motivo}`)
  }
  process.exit(EXIT.OK)
}

// True apenas quando executado diretamente (node ...) — as funcoes puras sao
// importadas pelos testes e pela prova por mutacao.
const IS_DIRECT_RUN =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (IS_DIRECT_RUN) main()
