#!/usr/bin/env node
// =============================================================================
// prove-runner-queue-cycle.mjs
//
// Usage:
//   node scripts/prove-runner-queue-cycle.mjs                  # ensaio completo
//   node scripts/prove-runner-queue-cycle.mjs --json            # mesmo veredito, plano
//   node scripts/prove-runner-queue-cycle.mjs --keep            # não derruba a stack
//   node scripts/prove-runner-queue-cycle.mjs --sem-no-new-privileges  # ver "O host"
//   node scripts/prove-runner-queue-cycle.mjs --timeout 600     # espera por prova (s)
//   # a referência que EXISTE neste host — pela fórmula da FONTE ÚNICA, nunca com
//   # um literal de versão (o `check:registry-source` recusa imagem nossa fora do
//   # escopo sem decisão escrita, e o `check-bun-mirror` recusa a versão cravada):
//   node scripts/prove-runner-queue-cycle.mjs \
//     --job-image "${IMAGE_REGISTRY:-ghcr.io}/${IMAGE_NAMESPACE:-severinno}/ubuntu-bun:${BUN_VERSION}"
//
// Exit codes:
//   0 — PROVADO: o runner fora do ar com run na fila (o SILÊNCIO), o fato da fila
//       parada acusando E publicando o comando de re-registro, o remédio, e o run
//       que esperava DRENANDO até o verde com a marca do job no log
//   1 — VIOLADO: alguma fase não deixou o desfecho positivo (a fila andou sem
//       runner, o fato não acusou, o remédio não subiu o runner, ou o run drenou
//       SEM a marca que prova que o job rodou)
//   2 — INDETERMINADO: sem docker/compose/git, imagem ausente, produção no host,
//       o Gitea não subiu, o runner não registrou ou o run não terminou a tempo —
//       ausência de prova, nunca "a fila está sã"
//   3 — uso inválido
//
// POR QUE EXISTE (o que o FATO da fila parada NÃO prova)
//
// O `runner-queue.mjs` mede o estado da fila contra quem a puxaria
// (ociosa/drenando/parada/não lida) e o veredito do doctor publica o BLOQUEIO com
// o comando de RE-REGISTRO na própria linha. O que nenhum dos dois prova é o
// CICLO: que o remédio DECLARADO tira a forja do estado parada e que o run que
// estava esperando volta. Na fila de um self-hosted nada falha, nada fica
// vermelho, e a execução é DESCARTADA por volta de 24h — quem espera perde a
// execução em silêncio (medido em 24/09/2026 e de novo em 25/09: 3 runs em
// `queued` com o `hostinger-runner` offline, a mais antiga com ~22h, e o doctor
// dizendo PRONTA).
//
// AS QUATRO FASES, todas MEDIDAS neste ensaio:
//   A. O SILÊNCIO — a stack sobe SEM o runner, o push cria a tarefa, e a tarefa
//      fica em `waiting`: nada falha, nada fica vermelho. É também o CONTROLE
//      NEGATIVO: dentro da janela, o run NÃO pode andar (uma tarefa terminal sem
//      runner nenhum seria a prova de que o que se mede não é o runner).
//   B. O FATO — o MESMO leitor do doctor (`readRunnerQueue`, com o leitor da
//      Gitea real) apontado para a stack efêmera responde `parada`, com a idade do
//      item mais antigo e a linha do BLOQUEIO — que NOMEIA o re-registro.
//   C. O REMÉDIO — o comando que o bloqueio publica, no equivalente efêmero:
//      `docker compose up -d runner` (na forja é `bash deploy/gitea-up.sh`, que é
//      o mesmo que RE-REGISTRA — o registro é estado no volume). A prova espera o
//      "Runner registered successfully." do próprio act_runner, nunca um `up` que
//      não deu erro.
//   D. O CICLO FECHADO — o fato deixa de dizer `parada` e a tarefa que esperava
//      DRENA até `success`, com a MARCA do job no log: o status sozinho não basta
//      (um status que vira sem o job rodar não é o ciclo), e é o log que prova.
//
// O QUE ESTA PROVA NÃO COBRE (declarado, não escondido):
//   - o desfecho é de uma stack EFÊMERA: ela prova o CICLO (a classe do defeito e
//     o efeito do remédio), não o estado da forja de produção. A metade do ESPELHO
//     (GitHub) segue dívida declarada em `ci/unproven.json` — o re-registro dela
//     roda no host do runner, não aqui;
//   - a Gitea 1.22 NÃO tem `workflow_dispatch` (medido: 404 nas rotas de dispatch,
//     o mesmo achado que o ensaio do smoke declara). O disparo desta prova é o
//     PUSH, como no resto do ensaio efêmero; o arquivo empurrado DECLARA o
//     `workflow_dispatch` (é o gatilho que a forja de produção usa) e o push é o
//     que a 1.22 entende;
//   - a imagem dos jobs sai dos labels do runner
//     (`<IMAGE_REGISTRY>/<IMAGE_NAMESPACE>/ubuntu-bun:<BUN_VERSION>`). O ensaio usa
//     a MESMA fórmula do compose e aceita `--job-image` para uma referência que
//     EXISTE neste host — sem imagem o job nem inicia, e o defeito medido aqui
//     seria outro (o relatório DIZ qual referência valeu).
// =============================================================================

import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"

import { GITEA_COMPOSE } from "./check-bun-mirror.mjs"
import { parseLabelEntries } from "./check-runner-labels.mjs"
import {
  DEFAULT_ENV_FILE,
  DEFAULT_TIMEOUT_S,
  EXIT,
  GITEA_SERVICE,
  OWNER,
  REPO_NAME,
  RUNNER_SERVICE,
  api,
  assertOnlyRemoval,
  composeArgs,
  dockerFacts,
  ephemeralProject,
  exitCodeFor,
  freePort,
  imagePresent,
  parseActionTasks,
  readJobLog,
  readTasks,
  removeContainers,
  renderCompose,
  renderOverrideCompose,
  repoUrl,
  safetyBlocker,
  stripRunnerHardening,
  waitForGitea,
} from "./prove-forge-smoke-ephemeral.mjs"
import {
  GITEA_QUEUE_STATUSES,
  GITEA_TASK_STATUS,
  RUNNER_QUEUE_REMEDY,
  readRunnerQueue,
  runnerQueueBlocker,
} from "./runner-queue.mjs"

/** A raiz do repositório (o ensaio roda dela, como o resto da família). */
export const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

/** O workflow do ensaio: um job que só imprime a MARCA (o alvo é o ciclo). */
export const CYCLE_WORKFLOW = ".gitea/workflows/ciclo-da-fila.yml"

/**
 * O NOME que o banco guarda — e o filtro das leituras de tarefas.
 *
 * A Gitea indexa `workflow_id` como o arquivo SEM o prefixo `.gitea/workflows/`
 * (medido: o push de `.gitea/workflows/ciclo-da-fila.yml` vira `ciclo-da-fila.yml`
 * em `action_run`). Filtrar pelo caminho do repositório devolveria SEMPRE zero
 * tarefas — uma leitura verde de nada, que é o pior defeito possível aqui. É o
 * mesmo radical que o smoke passa (`forge-smoke`).
 */
export const CYCLE_WORKFLOW_STEM = CYCLE_WORKFLOW.replace(/^\.gitea\/workflows\//, "").replace(
  /\.ya?ml$/,
  "",
)

/** A branch do ensaio (o push é o gatilho que a Gitea 1.22 entende). */
export const CYCLE_BRANCH = "prova/ciclo"

/** A marca que o job imprime — é ela que prova que o JOB rodou, não só o status. */
export const GREEN_MARKER = "CICLO-DA-FILA: o runner pegou a fila"

/** O comando de RE-REGISTRO que o bloqueio da fila parada publica (a régua da fase B). */
export const REMEDIO_DECLARADO = "deploy/gitea-up.sh"

/** O prefixo dos projetos efêmeros DESTA prova (nada de adotar stack alheia). */
export const PROJECT_PREFIX = "prova-ciclo-fila"

/** A janela da fase A: dentro dela, com o runner fora do ar, NADA pode andar. */
export const DEFAULT_SILENCE_S = 20

/** O arquivo que o job escreve a marca nele (o log do Gitea é lido no fim). */
export function cycleWorkflow({ branch = CYCLE_BRANCH, marker = GREEN_MARKER } = {}) {
  return [
    "# GERADO pelo ensaio do ciclo da fila (prove-runner-queue-cycle.mjs).",
    "# O `workflow_dispatch` fica DECLARADO (é o gatilho da forja de produção) e o",
    "# `push` é o que a Gitea 1.22 entende — ela não tem dispatch (medido: 404).",
    "name: ciclo-da-fila",
    "on:",
    "  push:",
    `    branches: [${branch}]`,
    "  workflow_dispatch:",
    "jobs:",
    "  verde:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - name: marca do ciclo",
    "        shell: bash",
    "        run: |",
    `          echo "${marker}"`,
    "",
  ].join("\n")
}

/**
 * Os pedaços de uma referência de imagem de job: `<registry>/<ns>/ubuntu-bun:<bun>`.
 *
 * O partidor existe porque o `--job-image` é o que permite trocar a imagem por uma
 * que EXISTE neste host sem sair da fórmula do compose (registry + namespace +
 * versão do Bun): sem imagem o job nem inicia, e o defeito medido aqui seria
 * outro.
 *
 * @param {string} ref
 * @returns {{ok: boolean, registry: string|null, namespace: string|null, bun: string|null, detail: string}}
 */
export function jobImageParts(ref) {
  const texto = String(ref ?? "").trim()
  const m = /^([^/]+)\/(.+)\/ubuntu-bun:([^:]+)$/.exec(texto)
  if (!m)
    return {
      ok: false,
      registry: null,
      namespace: null,
      bun: null,
      detail: `'${texto}' não é uma referência de <registry>/<namespace>/ubuntu-bun:<versão> — os labels do runner saem dessa fórmula`,
    }
  return {
    ok: true,
    registry: m[1],
    namespace: m[2],
    bun: m[3],
    detail: `${m[1]}/${m[2]}/ubuntu-bun:${m[3]}`,
  }
}

/**
 * O env do ensaio: o template comitado com o token trocado e a REFERÊNCIA da
 * imagem do job trocada (as duas coisas que a stack efêmera precisa).
 *
 * O resto vai LITERAL, e o relatório diz o que foi trocado: o que não é declarado
 * vira presunção.
 *
 * @param {string} template conteúdo de `deploy/env.gitea.example`
 * @param {{token: string, jobImage: {registry: string, namespace: string, bun: string}}} args
 * @returns {{ok: boolean, text: string, trocados: string[], detail: string}}
 */
export function cycleEnvFile(template, { token, jobImage }) {
  const trocas = []
  const out = String(template)
    .split("\n")
    .map((line) => {
      if (/^\s*RUNNER_TOKEN\s*=/.test(line)) {
        trocas.push("RUNNER_TOKEN")
        return `RUNNER_TOKEN=${token}`
      }
      if (/^\s*IMAGE_REGISTRY\s*=/.test(line)) {
        trocas.push("IMAGE_REGISTRY")
        return `IMAGE_REGISTRY=${jobImage.registry}`
      }
      if (/^\s*IMAGE_NAMESPACE\s*=/.test(line)) {
        trocas.push("IMAGE_NAMESPACE")
        return `IMAGE_NAMESPACE=${jobImage.namespace}`
      }
      if (/^\s*BUN_VERSION\s*=/.test(line)) {
        trocas.push("BUN_VERSION")
        return `BUN_VERSION=${jobImage.bun}`
      }
      return line
    })
    .join("\n")
  return {
    ok: true,
    text: out,
    trocados: trocas,
    detail: `troca(s) no env do ensaio: ${trocas.join(", ")} (a imagem do job vira ${jobImage.registry}/${jobImage.namespace}/ubuntu-bun:${jobImage.bun})`,
  }
}

/**
 * Os estados das TAREFAS do ensaio, lidos do banco da forja.
 *
 * Uma linha de `action_task` só nasce quando um runner PEGA o job (o
 * `CreateTaskForRunner` da 1.22, medido ao vivo em 26/09/2026) — por isso `total`
 * é a pergunta do silêncio ("alguém pegou?") e `terminal` é a da fase D
 * ("drenou até um desfecho?"). A FILA vive em `action_run_job`, e quem a lê é o
 * `readCycleQueue` abaixo.
 *
 * @param {object[]} rows
 */
export function taskStatuses(rows) {
  const lista = rows ?? []
  const conta = (code) => lista.filter((r) => r?.status === code).length
  const outros = lista.filter(
    (r) =>
      ![GITEA_TASK_STATUS.SUCCESS, GITEA_TASK_STATUS.FAILURE, GITEA_TASK_STATUS.WAITING].includes(
        r?.status,
      ),
  ).length
  return {
    total: lista.length,
    waiting: conta(GITEA_TASK_STATUS.WAITING),
    success: conta(GITEA_TASK_STATUS.SUCCESS),
    failure: conta(GITEA_TASK_STATUS.FAILURE),
    outros,
    terminal: conta(GITEA_TASK_STATUS.SUCCESS) + conta(GITEA_TASK_STATUS.FAILURE),
  }
}

/**
 * A FILA da forja efêmera, lida ONDE ela vive: `action_run_job`.
 *
 * POR QUE NÃO `action_task` (a leitura que este ensaio fazia): medido ao vivo em
 * 26/09/2026 — a linha de `action_task` só nasce quando um runner PEGA o job, e
 * nasce `running`. O job que espera é uma linha de `action_run_job` com
 * `task_id = 0` e `status = waiting` (5). Ler a fila em `action_task` numa janela
 * de silêncio leria a tabela VAZIA e chamaria isso de "fila vazia" — no primeiro
 * ensaio desta prova foi exatamente o que aconteceu.
 *
 * A consulta repete a da metade da Gitea do fato (`runner-queue.mjs`) DE PROPÓSITO:
 * a fase A é o controle do ensaio, e um controle que mede pelo instrumento que
 * está sendo provado não controla nada.
 *
 * @param {{container: string, dbPath: string, owner?: string, name?: string, run?: Function, nowMs?: number}} args
 * @returns {{ok: boolean, waiting: number, oldestMs: number|null, detail: string}}
 */
export function readCycleQueue({
  container,
  dbPath,
  owner = OWNER,
  name = REPO_NAME,
  run: runFn = run,
  nowMs = Date.now(),
}) {
  const sql =
    `select j.created as created from action_run_job j join repository p on p.id = j.repo_id ` +
    `where p.owner_name = '${owner}' and lower(p.lower_name) = lower('${name}') ` +
    `and j.task_id = 0 and j.status in (${GITEA_QUEUE_STATUSES.join(", ")}) order by j.id;`
  const res = runFn(
    "docker",
    ["exec", container, "sqlite3", "-cmd", ".timeout 10000", "-json", dbPath, sql],
    {
      timeout: 30_000,
    },
  )
  if (res.error || res.status !== 0) {
    return {
      ok: false,
      waiting: 0,
      oldestMs: null,
      detail: `não consegui ler a fila (${(res.stderr || res.error?.message || "").trim().split("\n")[0] || `exit ${res.status}`})`,
    }
  }
  const lido = parseActionTasks(res.stdout)
  if (!lido.ok)
    return {
      ok: false,
      waiting: 0,
      oldestMs: null,
      detail: `a fila não veio legível: ${lido.detail}`,
    }
  const criados = lido.rows
    .map((r) => Number(r?.created))
    .filter((n) => Number.isFinite(n) && n > 0)
  const maisAntiga = criados.length > 0 ? Math.min(...criados) : null
  return {
    ok: true,
    waiting: lido.rows.length,
    oldestMs: maisAntiga === null ? null : Math.max(0, nowMs - maisAntiga * 1000),
    detail: `${lido.rows.length} job(s) em \`waiting\` (task_id = 0)`,
  }
}

/**
 * O LOG de um job, lido de ONDE a forja o guarda.
 *
 * A Gitea 1.22 tem DOIS lugares, e o `log_in_storage` da `action_task` diz qual:
 *   · `0` — o log está no DBFS dela (as tabelas `dbfs_meta`/`dbfs_data` do banco),
 *     que é onde ele vive enquanto o runner não fecha o stream (`NoMore` →
 *     `TransferLogs`). Medido ao vivo em 26/09/2026: o job fechou `success` com o
 *     log INTEIRO no banco e `actions_log/<arquivo>` inexistente — ler só o
 *     arquivo diria "não consegui ler" sobre um log que existe.
 *   · `1` — transferido para o storage (`actions_log/<log_filename>`).
 *
 * O `group_concat` existe porque o DBFS guarda o log em BLOCOS de 32KB: sem ele
 * um marcador partido na fronteira de dois blocos leria como ausente.
 *
 * @param {{container: string, dbPath: string, logDir: string, filename: string, inStorage: boolean, run?: Function}} args
 * @returns {{ok: boolean, log: string, detail: string}}
 */
export function readCycleLog({ container, dbPath, logDir, filename, inStorage, run: runFn = run }) {
  if (inStorage) return readJobLog({ container, logPath: join(logDir, filename), run: runFn })
  const sql =
    `select group_concat(cast(blob_data as text), '') as log from (` +
    `select blob_data from dbfs_data where meta_id = (` +
    `select id from dbfs_meta where full_path like '%${filename}' order by id desc limit 1) ` +
    `order by blob_offset);`
  const res = runFn(
    "docker",
    ["exec", container, "sqlite3", "-cmd", ".timeout 10000", dbPath, sql],
    {
      timeout: 60_000,
    },
  )
  if (res.error || res.status !== 0) {
    return {
      ok: false,
      log: "",
      detail: `não consegui ler o log no DBFS (${(res.stderr || res.error?.message || "").trim().split("\n")[0] || `exit ${res.status}`})`,
    }
  }
  const texto = String(res.stdout ?? "")
  return { ok: true, log: texto, detail: `${texto.length} bytes (dbfs do banco)` }
}

/**
 * O VEREDITO do ciclo a partir das quatro leituras. PURA de propósito: quem mede é
 * o ensaio, quem julga é esta função — e é aqui que uma fase "quase boa" deixa de
 * virar verde (a fila que andou sem runner, o fato que não acusou, o remédio que
 * não registrou, o status que virou sem a marca do job).
 *
 * @param {{silencio: object, fato: object, remedio: object, drenagem: object}} fases
 * @returns {{state: "proven"|"violated"|"unavailable", detail: string}}
 */
export function cycleVerdict({ silencio, fato, remedio, drenagem }) {
  if (!silencio?.ok)
    return {
      state: "unavailable",
      detail: `fase A (o silêncio): não consegui ler a FILA da forja efêmera — ${silencio?.detail}`,
    }
  const tarefas = silencio.statuses ?? taskStatuses([])
  if (tarefas.terminal > 0)
    return {
      state: "violated",
      detail: `fase A: a fila ANDOU sem runner nenhum (${tarefas.terminal} tarefa(s) terminaram, ${tarefas.success} verde(s)) — o que se mede não é o runner: ${silencio.detail}`,
    }
  if (tarefas.total > 0)
    return {
      state: "violated",
      detail: `fase A: a fila foi PEGA sem runner nenhum (${tarefas.total} tarefa(s) de \`action_task\` nasceram, e uma tarefa só nasce quando um runner pega o job): ${silencio.detail}`,
    }
  if (silencio.waiting === 0)
    return {
      state: "unavailable",
      detail: `fase A: o push não deixou job em \`waiting\` na FILA${silencio.esperouS ? ` (${silencio.esperouS}s de espera)` : ""} — sem item na fila não há o que o runner puxe, e o ensaio não mediria o ciclo`,
    }
  if (!fato?.ok)
    return {
      state: "unavailable",
      detail: `fase B (o fato): não consegui ler a fila — ${fato?.detail}`,
    }
  if (fato.state !== "parada")
    return {
      state: "violated",
      detail: `fase B: o fato NÃO acusou a fila parada com o runner fora do ar (leu '${fato.state}': ${fato.detail}) — é este o estado que o doctor tem de publicar como BLOQUEIO`,
    }
  if (!fato.remedioDito)
    return {
      state: "violated",
      detail: `fase B: o bloqueio não NOMEIA o comando de re-registro ('${REMEDIO_DECLARADO}') — quem lê o veredito não tem o que fazer com ele: ${fato.blocker}`,
    }
  if (!remedio?.registered)
    return {
      state: "unavailable",
      detail: `fase C (o remédio): o runner não registrou — ${remedio?.detail}`,
    }
  if (!drenagem?.ok)
    return {
      state: "unavailable",
      detail: `fase D (a drenagem): não consegui ler as tarefas — ${drenagem?.detail}`,
    }
  if (drenagem.statuses.failure > 0)
    return {
      state: "violated",
      detail: `fase D: o run que esperava drenou VERMELHO (${drenagem.statuses.failure} tarefa(s) com falha) — o remédio trouxe o runner, mas o job que estava na fila não fecha verde`,
    }
  if (drenagem.statuses.success === 0)
    return {
      state: "unavailable",
      detail: `fase D: a tarefa NÃO drenou dentro da janela (${drenagem.statuses.waiting} ainda em \`waiting\`, ${drenagem.statuses.outros} em outro estado) — não deu tempo de medir o desfecho`,
    }
  if (!drenagem.marca)
    return {
      state: "violated",
      detail: `fase D: o status virou \`success\` SEM a marca do job no log ('${GREEN_MARKER}') — um status que muda sem o job imprimir o que ele fez não é o ciclo: ${drenagem.detail}`,
    }
  return {
    state: "proven",
    detail: `o ciclo fechou: o run esperou na fila com o runner fora do ar, o fato acusou \`parada\` com o re-registro na linha, o remédio registrou o runner e a tarefa drenou até \`success\` com a marca do job (${drenagem.detail})`,
  }
}

/**
 * O ambiente do FATO: sem o canal do ESPELHO.
 *
 * A prova é sobre a forja DONA DO MERGE (a stack efêmera). Deixar
 * `GH_REPOSITORY`/`GH_TOKEN` no ambiente faria o fato tentar ler a fila do GitHub
 * de verdade no meio do ensaio — rede, credencial e um segundo alvo que este
 * ensaio não controla. A metade do espelho sai DECLARADA (segue dívida em
 * `ci/unproven.json`), nunca "sem fila".
 */
export function envDoFato(env = process.env) {
  const out = { ...env }
  delete out.GH_REPOSITORY
  delete out.GH_TOKEN
  delete out.GITHUB_TOKEN
  return out
}

/** O parser das flags (o resto da família usa a mesma forma). */
export function parseArgs(argv) {
  const opts = {
    json: false,
    keep: false,
    semNoNewPrivileges: false,
    timeoutS: DEFAULT_TIMEOUT_S,
    silenceS: DEFAULT_SILENCE_S,
    jobImage: null,
    branch: CYCLE_BRANCH,
    envFile: DEFAULT_ENV_FILE,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    const valor = () => argv[++i]
    if (a === "--json") opts.json = true
    else if (a === "--keep") opts.keep = true
    else if (a === "--sem-no-new-privileges") opts.semNoNewPrivileges = true
    else if (a === "--timeout") opts.timeoutS = Number(valor())
    else if (a === "--silencio") opts.silenceS = Number(valor())
    else if (a === "--job-image") opts.jobImage = valor()
    else if (a === "--branch") opts.branch = valor()
    else if (a === "--env-file") opts.envFile = valor()
    else if (a === "--help" || a === "-h") return { ...opts, help: true }
    else return { ...opts, error: `flag desconhecida: ${a}` }
  }
  if (!Number.isFinite(opts.timeoutS) || opts.timeoutS <= 0)
    return { ...opts, error: `--timeout inválido: ${opts.timeoutS}` }
  if (!Number.isFinite(opts.silenceS) || opts.silenceS < 0)
    return { ...opts, error: `--silencio inválido: ${opts.silenceS}` }
  return opts
}

/** O relatório humano do ensaio (as quatro fases, ditas uma por uma). */
export function renderReport(result, { emit = console.log } = {}) {
  const L = []
  L.push("")
  L.push("  O CICLO DA FILA PARADA — offline → online, com o run que esperava")
  L.push("  ──────────────────────────────────────────────────────────────────────────")
  L.push(`  projeto: ${result.project ?? "—"} · Gitea efêmero em 127.0.0.1:${result.port ?? "—"}`)
  L.push(`  imagem do job: ${result.jobImage ?? "—"}`)
  L.push("")
  for (const s of result.steps ?? []) L.push(`  ${s.ok ? "✅" : "❌"} ${s.name}: ${s.detail}`)
  const f = result.fases ?? {}
  if (f.silencio)
    L.push(
      `  A · o SILÊNCIO: ${f.silencio.statuses.waiting} tarefa(s) em \`waiting\` com 0 runner(s) online, ${f.silencio.statuses.terminal} terminal(is) na janela de ${result.silenceS}s`,
    )
  if (f.fato) L.push(`  B · o FATO: estado '${f.fato.state}' · ${f.fato.blocker ?? f.fato.detail}`)
  if (f.remedio) L.push(`  C · o REMÉDIO: ${f.remedio.detail}`)
  if (f.drenagem)
    L.push(
      `  D · a DRENAGEM: ${f.drenagem.statuses.success} verde(s), ${f.drenagem.statuses.failure} falha(s), marca no log: ${f.drenagem.marca ? "sim" : "NÃO"}`,
    )
  L.push("")
  L.push(
    `  VEREDITO: ${result.verdict === "proven" ? "PROVADO ✅" : result.verdict === "violated" ? "VIOLADO ❌" : "INDETERMINADO ◐"}`,
  )
  L.push(`  ${result.detail}`)
  L.push("")
  L.push(
    `  remédio de PRODUÇÃO desta forja (o que o bloqueio publica): ${RUNNER_QUEUE_REMEDY.gitea}`,
  )
  L.push(
    `  remédio do ESPELHO (segue dívida declarada: roda no host do runner): ${RUNNER_QUEUE_REMEDY.github}`,
  )
  if (result.residue?.length)
    L.push(`  ⚠️  resíduo que este host não deixou remover: ${result.residue.join(", ")}`)
  emit(L.join("\n"))
}

/** O spawn padrão (injetável nos testes, como no resto da família). */
export function run(cmd, args, options = {}) {
  return spawnSync(cmd, args, { encoding: "utf8", ...options })
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const now = () => Date.now()

/**
 * O ENSAIO. As quatro fases, em ordem, com o teardown REPORTADO (nunca presumido).
 *
 * @param {{opts?: object, run?: Function, sleep?: Function, deps?: object}} deps
 */
export async function proveRunnerQueueCycle(deps = {}) {
  const opts = deps.opts ?? parseArgs([])
  const runFn = deps.run ?? run
  const dormir = deps.sleep ?? sleep
  const apiFn = deps.api ?? api
  const steps = []
  const step = (name, ok, detail) => steps.push({ name, ok, detail })
  const result = {
    verdict: "unavailable",
    detail: "",
    steps,
    fases: {},
    project: null,
    port: null,
    jobImage: null,
    silenceS: opts.silenceS,
    timeoutS: opts.timeoutS,
    residue: [],
  }
  const finish = (verdict, detail, extra = {}) => {
    Object.assign(result, extra)
    result.verdict = verdict
    result.detail = detail
    return result
  }

  // ── 1. o ambiente ─────────────────────────────────────────────────────────
  const facts = dockerFacts({ run: runFn })
  if (!facts.ok)
    return finish("unavailable", `docker/compose indisponível neste host: ${facts.detail}`)
  const composePath = join(REPO_ROOT, GITEA_COMPOSE)
  if (!existsSync(composePath))
    return finish(
      "unavailable",
      `${GITEA_COMPOSE} não existe neste checkout — sem a stack não há o que medir`,
    )
  const envTemplate = join(REPO_ROOT, opts.envFile)
  if (!existsSync(envTemplate))
    return finish(
      "unavailable",
      `${opts.envFile} não existe — o ensaio precisa do template do env da stack`,
    )

  const project = `${PROJECT_PREFIX}-${ephemeralProject().split("-").pop()}`
  const port = await freePort()
  result.project = project
  result.port = port
  const giteaContainer = `${project}-${GITEA_SERVICE}`

  // O RENDER do compose comitado: é dele que saem as três coisas que o ensaio
  // precisa saber sem cravar nada — o nome do container do RUNNER (o compose o
  // fixa em `gitea-runner`), a imagem/versão declaradas e o caminho do banco.
  const renderedBase = renderCompose({
    project,
    files: [composePath],
    envFile: envTemplate,
    run: runFn,
  })
  if (!renderedBase.ok) return finish("unavailable", renderedBase.detail)
  const volumesKeys = Object.keys(renderedBase.config.volumes ?? {})
  const declarado = renderedBase.config.services?.[GITEA_SERVICE]?.environment ?? {}
  // A IMAGEM DO JOB sai do RUNNER, não do serviço da Gitea: quem declara as
  // referências é o `GITEA_RUNNER_LABELS` dele (`<label>:docker://<imagem>`), e a
  // régua que as lê é a MESMA do guard dos labels (`parseLabelEntries`). Antes
  // daqui saíam referências COMPOSTAS à mão com a versão do Bun cravada como
  // default — e o `check-bun-mirror` recusa literal de versão do Bun por desenho:
  // ele envelhece sem ninguém ver, e o default inventado fazia o ensaio procurar
  // uma imagem que composição nenhuma declarou (o BUN_VERSION da stack mora no
  // serviço do RUNNER, não no da Gitea).
  const labelsDoRunner =
    renderedBase.config.services?.[RUNNER_SERVICE]?.environment?.GITEA_RUNNER_LABELS ?? ""
  const jobRefs = [
    opts.jobImage,
    ...new Set(
      parseLabelEntries(labelsDoRunner)
        .map((e) => e.image)
        .filter((i) => typeof i === "string" && i.trim() !== ""),
    ),
  ].filter(Boolean)

  // ── 2. a segurança: nada de produção, nada de container alheio ────────────
  const listContainers = () => {
    const ps = runFn(
      "docker",
      ["ps", "-a", "--format", '{{.Names}}\t{{.State}}\t{{.Label "com.docker.compose.project"}}'],
      { timeout: 30_000 },
    )
    return String(ps.stdout ?? "")
      .split("\n")
      .map((line) => line.split("\t"))
      .filter((parts) => parts[0])
      .map((parts) => ({
        name: parts[0].trim(),
        running: (parts[1] ?? "").trim() === "running",
        project: (parts[2] ?? "").trim(),
      }))
  }
  const runnerService = renderedBase.config.services?.[RUNNER_SERVICE] ?? {}
  const runnerName =
    typeof runnerService.container_name === "string" && runnerService.container_name !== ""
      ? runnerService.container_name
      : RUNNER_SERVICE
  const leftovers = listContainers().filter((c) =>
    String(c.project ?? "").startsWith(PROJECT_PREFIX),
  )
  if (leftovers.length > 0) {
    const stuck = removeContainers({
      names: leftovers.map((c) => c.name),
      run: runFn,
      sleep: dormir,
    })
    if (stuck.length > 0)
      return finish(
        "unavailable",
        `há resíduo do ensaio anterior que este host não deixa remover (${stuck.map((s) => s.name).join(", ")}) — sem isso o nome do runner não está livre`,
      )
  }
  const prodProject = dirname(GITEA_COMPOSE).split("/").filter(Boolean).pop() ?? "deploy"
  const blocker = safetyBlocker({
    containers: listContainers(),
    runnerName,
    ownPrefix: PROJECT_PREFIX,
    prodProject,
  })
  if (blocker) return finish("unavailable", blocker)
  step(
    "segurança",
    "ok",
    `'${runnerName}' livre e nenhuma stack de '${prodProject}' rodando neste host`,
  )

  // ── 3. o material do ensaio (efêmero, fora do repositório) ────────────────
  const work = mkdtempSync(join(tmpdir(), `${PROJECT_PREFIX}-`))
  const repoDir = join(work, "ensaio")
  const overridePath = join(work, "override.compose.yml")
  const stackComposePath = join(work, "compose.sem-hardening.yml")
  const envPath = join(work, "env.gitea")
  let stackBase = { path: composePath, detail: "compose comitado, sem alteração" }
  if (opts.semNoNewPrivileges) {
    const original = readFileSync(composePath, "utf8")
    const strip = stripRunnerHardening(original)
    if (!strip.ok) return finish("unavailable", strip.detail)
    const only = assertOnlyRemoval(original, strip.text, strip.removal)
    if (!only.ok) return finish("unavailable", only.detail)
    writeFileSync(stackComposePath, strip.text)
    stackBase = { path: stackComposePath, detail: `${strip.detail} (${only.detail})` }
  }
  const stackFiles = [stackBase.path, overridePath]

  const cleanupFn = () => {
    if (opts.keep) return
    runFn(
      "docker",
      composeArgs({
        project,
        files: stackFiles,
        envFile: envPath,
        rest: ["down", "-v", "--remove-orphans"],
      }),
      { timeout: 180_000 },
    )
    const jobNames = String(
      runFn("docker", ["ps", "-a", "--format", "{{.Names}}"], { timeout: 30_000 }).stdout ?? "",
    )
      .split("\n")
      .map((n) => n.trim())
      .filter((n) => n.startsWith("GITEA-ACTIONS-TASK-"))
    const meus = listContainers()
      .filter((c) => c.project === project || String(c.name).startsWith(`${project}-`))
      .map((c) => c.name)
    const stuck = removeContainers({ names: [...meus, ...jobNames], run: runFn, sleep: dormir })
    if (stuck.length > 0) result.residue = stuck.map((c) => c.name)
    rmSync(work, { recursive: true, force: true })
  }

  try {
    // A imagem do job: a fórmula do compose, resolvida para algo que EXISTE aqui.
    const jobRef = jobRefs.find((ref) => imagePresent(ref, { run: runFn }))
    if (!jobRef)
      return finish(
        "unavailable",
        `nenhuma imagem de job existe neste host (tentado: ${jobRefs.join(", ")}) — sem ela o job nem inicia; passe --job-image <ref> para a que você tem`,
      )
    const parts = jobImageParts(jobRef)
    if (!parts.ok) return finish("unavailable", parts.detail)
    result.jobImage = jobRef

    writeFileSync(
      overridePath,
      renderOverrideCompose({
        project,
        port,
        volumeKeys: volumesKeys,
        giteaContainerName: giteaContainer,
      }),
    )
    const baseEnv = cycleEnvFile(readFileSync(envTemplate, "utf8"), {
      token: "PLACEHOLDER",
      jobImage: parts,
    })
    writeFileSync(envPath, `${baseEnv.text}\n`)
    mkdirSync(repoDir, { recursive: true })
    mkdirSync(join(repoDir, dirname(CYCLE_WORKFLOW)), { recursive: true })
    writeFileSync(join(repoDir, CYCLE_WORKFLOW), cycleWorkflow({ branch: opts.branch }))
    const gitEnv = {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
      GIT_AUTHOR_NAME: "prova",
      GIT_AUTHOR_EMAIL: "prova@example.com",
      GIT_COMMITTER_NAME: "prova",
      GIT_COMMITTER_EMAIL: "prova@example.com",
    }
    for (const args of [
      ["init", "-q", "-b", opts.branch, "."],
      ["add", "-A"],
      ["commit", "-q", "-m", "ensaio do ciclo da fila"],
    ]) {
      const res = runFn("git", args, { cwd: repoDir, env: gitEnv, timeout: 120_000 })
      if (res.error || res.status !== 0)
        return finish(
          "unavailable",
          `git ${args[0]} falhou: ${(res.stderr || res.error?.message || "").trim().split("\n")[0]}`,
        )
    }
    step("material", "ok", `${stackBase.detail}; imagem do job ${jobRef}; ${baseEnv.detail}`)

    // ── 4. a stack SEM o runner (a fase A depende disso) ──────────────────────
    const upGitea = runFn(
      "docker",
      composeArgs({
        project,
        files: stackFiles,
        envFile: envPath,
        rest: ["up", "-d", GITEA_SERVICE],
      }),
      {
        timeout: 300_000,
      },
    )
    if (upGitea.error || upGitea.status !== 0)
      return finish(
        "unavailable",
        `docker compose up -d ${GITEA_SERVICE} falhou: ${(upGitea.stderr || upGitea.stdout || "").trim().split("\n").slice(-1)[0]}`,
      )
    const healthy = await waitForGitea({ port, timeoutS: 180, sleep: dormir })
    if (!healthy.ok) return finish("unavailable", healthy.detail)
    const createUser = runFn(
      "docker",
      [
        "exec",
        "-u",
        "git",
        giteaContainer,
        "gitea",
        "admin",
        "user",
        "create",
        "--username",
        OWNER,
        "--password",
        "Prova!12345x",
        "--email",
        `${OWNER}@example.com`,
        "--admin",
        "--must-change-password=false",
      ],
      { timeout: 120_000 },
    )
    if (createUser.error || createUser.status !== 0)
      return finish(
        "unavailable",
        `não consegui criar o admin do ensaio: ${(createUser.stderr || "").trim().split("\n")[0]}`,
      )
    const tokenRes = runFn(
      "docker",
      ["exec", "-u", "git", giteaContainer, "gitea", "actions", "generate-runner-token"],
      {
        timeout: 120_000,
      },
    )
    const token =
      String(tokenRes.stdout ?? "")
        .trim()
        .split("\n")
        .filter(Boolean)
        .pop() ?? ""
    if (tokenRes.error || tokenRes.status !== 0 || token === "")
      return finish(
        "unavailable",
        `não consegui gerar o token do runner: ${(tokenRes.stderr || "").trim().split("\n")[0] || "saída vazia"}`,
      )
    const comToken = cycleEnvFile(readFileSync(envTemplate, "utf8"), { token, jobImage: parts })
    writeFileSync(envPath, `${comToken.text}\n`)
    const createRepo = await apiFn({
      port,
      method: "POST",
      path: "/api/v1/user/repos",
      body: { name: REPO_NAME, auto_init: false, default_branch: opts.branch },
    })
    if (!createRepo.ok)
      return finish(
        "unavailable",
        `não consegui criar o repositório do ensaio: ${createRepo.detail} ${createRepo.text.slice(0, 200)}`,
      )
    const push = runFn("git", ["push", "-q", repoUrl({ port }), `HEAD:refs/heads/${opts.branch}`], {
      cwd: repoDir,
      env: gitEnv,
      timeout: 300_000,
    })
    if (push.error || push.status !== 0)
      return finish(
        "unavailable",
        `git push falhou: ${(push.stderr || "").trim().split("\n").slice(-1)[0]}`,
      )
    step(
      "stack sem runner",
      "ok",
      `Gitea em 127.0.0.1:${port}, ${OWNER}/${REPO_NAME} com a branch '${opts.branch}' empurrada (runner NÃO subiu)`,
    )

    const giteaService = renderedBase.config.services?.[GITEA_SERVICE] ?? {}
    const dbPath = String(giteaService.environment?.GITEA__database__PATH ?? "/data/gitea/gitea.db")
    const logDir = join(dirname(dbPath), "actions_log")
    const lerTarefas = () =>
      readTasks({
        container: giteaContainer,
        dbPath,
        workflowFile: CYCLE_WORKFLOW_STEM,
        run: runFn,
      })

    // ── FASE A — o SILÊNCIO (o controle negativo) ─────────────────────────────
    //
    // A ESPERA. O push é ASSÍNCRONO: o Gitea cria o run fora do request, e o job
    // entra na fila quando isso acontece (medido: ~20s depois do push). A janela
    // do silêncio só mede alguma coisa quando HÁ o que esperar — sem a espera, "0
    // em `waiting`" mede que a fila ainda não existia, e não que ela esperou.
    const inicioEspera = now()
    const esperaAte = inicioEspera + Math.min(120, Math.round(opts.timeoutS / 3)) * 1000
    let apareceu = false
    for (;;) {
      const lido = readCycleQueue({ container: giteaContainer, dbPath, run: runFn })
      if (lido.ok && lido.waiting > 0) {
        apareceu = true
        break
      }
      if (now() > esperaAte) break
      await dormir(2_000)
    }
    const esperouS = ((now() - inicioEspera) / 1000).toFixed(1)

    // A JANELA. Duas leituras, porque o silêncio tem de valer nos DOIS lados: o
    // job continua na FILA (`action_run_job`, ninguém o pegou) e NENHUMA linha de
    // `action_task` nasceu (uma tarefa só nasce quando um runner pega o job).
    const janela = now() + opts.silenceS * 1000
    let silencio = {
      ok: false,
      waiting: 0,
      oldestMs: null,
      detail: "não li a fila",
      statuses: taskStatuses([]),
    }
    for (;;) {
      const fila = readCycleQueue({ container: giteaContainer, dbPath, run: runFn })
      const tarefas = lerTarefas()
      silencio = {
        ok: fila.ok,
        waiting: fila.waiting,
        oldestMs: fila.oldestMs,
        detail: `${fila.detail}; ${tarefas.ok ? tarefas.detail : "não li as tarefas"}`,
        statuses: taskStatuses(tarefas.ok ? tarefas.rows : []),
      }
      if (now() > janela) break
      await dormir(2_000)
    }
    silencio = {
      ...silencio,
      apareceu,
      esperouS,
      detail: apareceu
        ? `a fila apareceu em ${esperouS}s e continuou parada por ${opts.silenceS}s: ${silencio.detail}`
        : `o push não criou job em \`waiting\` em ${esperouS}s: ${silencio.detail}`,
    }
    result.fases.silencio = silencio
    step(
      "fase A · silêncio",
      silencio.ok &&
        silencio.statuses.total === 0 &&
        silencio.waiting > 0 &&
        silencio.statuses.terminal === 0,
      `${silencio.waiting} job(s) em waiting, ${silencio.statuses.total} tarefa(s) de runner em ${opts.silenceS}s com 0 runner(s) online (a fila apareceu em ${esperouS}s)`,
    )

    // ── FASE B — o FATO (o mesmo leitor do doctor) ────────────────────────────
    let fato = { ok: false, detail: "não li o fato" }
    try {
      const lido = await readRunnerQueue({
        cwd: REPO_ROOT,
        env: envDoFato(),
        repos: { gitea: `${OWNER}/${REPO_NAME}` },
        // O ALVO é o da stack efêmera (o resto do canal é o do doctor: o leitor da
        // Gitea é o REAL, e o `run` é o mesmo `docker exec` do fato em produção).
        deps: {
          run: runFn,
          resolveDb: () => ({
            ok: true,
            container: giteaContainer,
            dbPath,
            dbType: "sqlite3",
            detail: `stack efêmera ${project}`,
          }),
        },
      })
      const metade = lido.forges?.gitea ?? null
      const blocker = metade ? runnerQueueBlocker(metade) : []
      fato = {
        ok: metade !== null,
        state: metade?.state ?? "unread",
        waiting: metade?.waiting ?? 0,
        oldestMs: metade?.oldestMs ?? null,
        blocker: blocker[0] ?? "",
        remedioDito: (blocker[0] ?? "").includes(REMEDIO_DECLARADO),
        detail: metade?.detail ?? lido.detail,
      }
    } catch (error) {
      fato = {
        ok: false,
        state: "unread",
        detail: String(error?.message ?? error),
        remedioDito: false,
      }
    }
    result.fases.fato = fato
    step(
      "fase B · fato",
      fato.ok && fato.state === "parada" && fato.remedioDito,
      `estado '${fato.state}'; o bloqueio publica o re-registro: ${fato.remedioDito ? "sim" : "NÃO"}`,
    )

    // ── FASE C — o REMÉDIO ────────────────────────────────────────────────────
    const upRunner = runFn(
      "docker",
      composeArgs({
        project,
        files: stackFiles,
        envFile: envPath,
        rest: ["up", "-d", RUNNER_SERVICE],
      }),
      {
        timeout: 300_000,
      },
    )
    let remedio = { registered: false, detail: "não subi o runner" }
    if (upRunner.error || upRunner.status !== 0) {
      remedio = {
        registered: false,
        detail: `docker compose up -d ${RUNNER_SERVICE} falhou: ${(upRunner.stderr || upRunner.stdout || "").trim().split("\n").slice(-1)[0]}`,
      }
    } else {
      const deadline = now() + Math.max(60, Math.round(opts.timeoutS / 3)) * 1000
      for (;;) {
        const inspect = runFn("docker", ["inspect", runnerName, "--format", "{{.State.Status}}"], {
          timeout: 30_000,
        })
        const estado = inspect.status === 0 ? String(inspect.stdout).trim() : null
        const logs = runFn("docker", ["logs", runnerName], { timeout: 30_000 })
        const tail = `${logs.stderr ?? ""}${logs.stdout ?? ""}`
        if (tail.includes("Runner registered successfully.")) {
          remedio = {
            registered: true,
            detail: `'${runnerName}' registrou (estado '${estado}') — o mesmo efeito do \`bash ${REMEDIO_DECLARADO}\``,
          }
          break
        }
        if (estado !== null && !["running", "created", "restarting"].includes(estado)) {
          const ultima = tail.trim().split("\n").filter(Boolean).slice(-1)[0] ?? "<sem log>"
          const hint = /operation not permitted/i.test(tail)
            ? ` A causa medida neste host é o hardening 'no-new-privileges:true' do serviço ${RUNNER_SERVICE}: rode com --sem-no-new-privileges (o compose do ensaio perde UMA linha, verificada e declarada).`
            : ""
          remedio = {
            registered: false,
            detail: `o runner '${runnerName}' não ficou no ar (estado '${estado}'): ${ultima}.${hint}`,
          }
          break
        }
        if (now() > deadline) {
          remedio = {
            registered: false,
            detail: `o runner '${runnerName}' não registrou em ${Math.round(opts.timeoutS / 3)}s (estado '${estado}')`,
          }
          break
        }
        await dormir(3_000)
      }
    }
    result.fases.remedio = remedio
    step("fase C · remédio", remedio.registered, remedio.detail)

    // ── FASE D — a DRENAGEM (o run que esperava, verde) ───────────────────────
    const deadlineD = now() + opts.timeoutS * 1000
    let drenagem = {
      ok: false,
      detail: "não li as tarefas",
      statuses: taskStatuses([]),
      marca: false,
    }
    let lidos = []
    for (;;) {
      const lido = lerTarefas()
      if (lido.ok) {
        lidos = lido.rows
        drenagem = {
          ok: true,
          detail: lido.detail,
          statuses: taskStatuses(lido.rows),
          marca: false,
        }
        if (drenagem.statuses.terminal > 0) break
      }
      if (now() > deadlineD) break
      await dormir(3_000)
    }
    // A MARCA: o log do job que drenou (o status sozinho não prova que ele rodou).
    const linha = lidos.find((r) => r?.status === GITEA_TASK_STATUS.SUCCESS && r?.log_filename)
    if (linha) {
      const noStorage = Number(linha.log_in_storage) === 1
      const log = readCycleLog({
        container: giteaContainer,
        dbPath,
        logDir,
        filename: String(linha.log_filename),
        inStorage: noStorage,
        run: runFn,
      })
      drenagem = {
        ...drenagem,
        onde: noStorage ? "actions_log" : "dbfs",
        marca: log.ok && String(log.log).includes(GREEN_MARKER),
        detail: log.ok ? `${log.detail} lido do job ${linha.log_filename}` : log.detail,
      }
    }
    result.fases.drenagem = drenagem
    step(
      "fase D · drenagem",
      drenagem.ok && drenagem.statuses.success > 0 && drenagem.marca,
      `${drenagem.statuses.success} verde(s), ${drenagem.statuses.failure} falha(s), marca no log: ${drenagem.marca ? "sim" : "NÃO"}`,
    )

    // ── o estado do fato DEPOIS do remédio (o ciclo não deixa o fato dizendo parada)
    try {
      const depois = await readRunnerQueue({
        cwd: REPO_ROOT,
        env: envDoFato(),
        repos: { gitea: `${OWNER}/${REPO_NAME}` },
        deps: {
          run: runFn,
          resolveDb: () => ({
            ok: true,
            container: giteaContainer,
            dbPath,
            dbType: "sqlite3",
            detail: "stack efêmera",
          }),
        },
      })
      result.fases.fatoDepois = {
        state: depois.forges?.gitea?.state ?? "unread",
        online: depois.forges?.gitea?.online ?? 0,
        detail: depois.forges?.gitea?.detail ?? depois.detail,
      }
    } catch (error) {
      result.fases.fatoDepois = { state: "unread", detail: String(error?.message ?? error) }
    }

    const veredito = cycleVerdict({ silencio, fato, remedio, drenagem })
    cleanupFn()
    return finish(veredito.state, veredito.detail)
  } catch (error) {
    cleanupFn()
    return finish("unavailable", `o ensaio morreu no meio: ${error?.message ?? error}`)
  }
}

// ── a CLI ─────────────────────────────────────────────────────────────────────
const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])
if (invokedDirectly) {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.help) {
    console.log(
      "uso: node scripts/prove-runner-queue-cycle.mjs [--json] [--keep] [--sem-no-new-privileges] [--timeout N] [--silencio N] [--job-image <ref>]",
    )
    process.exit(EXIT.USAGE)
  }
  if (opts.error) {
    console.error(`❌ ${opts.error}`)
    process.exit(EXIT.USAGE)
  }
  const result = await proveRunnerQueueCycle({ opts })
  if (opts.json) console.log(JSON.stringify(result, null, 2))
  else renderReport(result)
  process.exit(exitCodeFor(result.verdict))
}
