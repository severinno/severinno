// =============================================================================
// scripts/runner-queue.mjs — a FILA PARADA: o runner da forja FORA DO AR com run
// esperando.
//
// POR QUE ESTE FATO EXISTE (medido em 24/09/2026, o dia em que ele foi escrito):
// `repos/severinno/severinno/actions/runners` respondia `hostinger-runner |
// status=offline | busy=false` e `.../actions/runs?status=queued` respondia
// `total_count: 5` — a mais antiga criada em 23/09 às 21:30. Cinco runs esperando
// e NENHUM runner para pegá-las. O repositório tinha, até então, dois fatos sobre
// o runner (os labels GRAVADOS no registro e a versão registrada × o pin) e
// nenhum sobre ele estar NO AR: o registro diz `online`/`offline`, mas quem
// olhava o registro não perguntava pela FILA, e quem olhava a fila não era
// ninguém — a fila de um self-hosted não é infinita (o GitHub descarta o run sem
// runner por volta de 24h) e o sintoma do dia era exatamente esse: PRs abertos,
// checks em `queued`, e o doctor dizendo PRONTA com a forja parada.
//
// AS DUAS METADES SÃO UMA PERGUNTA SÓ. Nem a fila sozinha nem o registro sozinho
// dizem nada:
//   · fila cheia com runner ONLINE e ocupado é a forja TRABALHANDO (não é dívida);
//   · runner offline com a fila VAZIA é um runner ocioso (não é dívida — nada
//     espera por ele);
//   · fila cheia com o runner FORA DO AR é a forja PARADA — e é isso que "nasce
//     do nada": o job fica em `queued` para sempre, nada falha, nada fica
//     vermelho, e o único lugar onde o defeito é visível é a idade do item mais
//     antigo da fila contra a saúde de quem a puxaria.
//
// O QUE O REGISTRO DIZ (e o que ele NÃO diz): o registro de cada forja responde
// sobre QUEM PUXARIA a fila — no GitHub a API devolve `status: online|offline` e
// `busy` por runner; na Gitea o registro (`/data/.runner`, seção 3 do relatório)
// só prova que o runner SE REGISTROU (labels), e quem sabe do estado dele é a
// PRÓPRIA forja: `action_runner.last_online` / `last_active`, com a régua dela
// (`models/actions/runner.go`, v1.22.6: `RunnerOfflineTime = 1 minuto`,
// `RunnerIdleTime = 10 segundos` → OFFLINE/IDLE/ACTIVE). Esta folha lê a régua da
// forja em vez de inventar um limiar.
//
// POR QUE A GITEA É LIDA PELO BANCO (e não por REST): medido em 24/09/2026 contra
// uma Gitea 1.22.6 viva — o `swagger.v1.json` dela NÃO tem rota de tarefa de
// ações (`/repos/{owner}/{repo}/actions/tasks` → HTTP 404) nem de runner de
// repositório (só `.../actions/runners/registration-token`). A fila e o estado do
// runner existem, para quem não é a interface web, só nas tabelas `action_run_job`
// (a FILA) e `action_runner` (quem a puxaria). A leitura usa o MESMO canal que a
// seção 3 já usa para o registro (o `docker exec` no container da stack, com o
// caminho do banco e o tipo DERIVADOS do compose comitado — nunca cravados aqui).
//
// A FILA DA GITEA É `action_run_job`, NUNCA `action_task` — medido ao vivo em
// 26/09/2026 numa 1.22.6 e confirmado no código dela: `InsertRun` cria UMA linha
// de job por job do workflow, com `status = waiting` (5), no push;
// `CreateTaskForRunner` só materializa a linha de `action_task` quando um runner
// PEGA o job — e ela nasce `running` (6), indo direto para um desfecho. Ler a
// fila em `action_task` leria o TRABALHO do runner (que nunca está `waiting`) e
// jamais a espera: a fila parada ficaria invisível, que é exatamente o defeito
// que este fato existe para não deixar passar.
//
// NUNCA LANÇA E NUNCA CHUTA: credencial ausente, canal ausente, container fora do
// ar, `sqlite3` ausente no container, repositório que não existe no banco da
// forja, banco que não é o sqlite que o compose declara — cada um é um estado
// NOMEADO (`unread`, com a causa), que o veredito publica como NÃO MEDIDO. Um
// fato que não deu para ler jamais vira "sem fila".
//
// Usage:
//   import { readRunnerQueue, deriveRunnerQueue } from "./runner-queue.mjs"
//   const fato = await readRunnerQueue({ cwd, env, repos, githubRunners })
//   // a METADE de uma forja, exercitável sem I/O nenhum:
//   deriveRunnerQueue({ forge, queue, pullers, nowMs })
//
// Exit codes:
//   (módulo puro — não possui CLI nem exit code próprio; quem publica o veredito
//    é o `forge-doctor.mjs`, e a leitura NUNCA lança: cada recusa sai como estado
//    `unread` nomeado dentro do próprio fato)
// =============================================================================

import { readFileSync } from "node:fs"

import { githubApi, githubReadConfig } from "./issue-publish.mjs"
import { parseYamlDocument } from "./forge-workflows.mjs"
import { GITEA_COMPOSE } from "./check-bun-mirror.mjs"

// ── As FORMAS declaradas ─────────────────────────────────────────────────────
//
// O contrato desta folha é o que os testes (`.ts`, checados pelo `tsc`) consomem:
// sem estas formas, cada acesso a um campo da metade da forja seria lido como um
// acesso a `object`, e o `bun run typecheck` só saberia da existência das funções
// — nunca do que elas devolvem.

/**
 * Um item da fila do GitHub — o que a folha lê de cada run em `queued`.
 *
 * @typedef {Object} GithubQueuedItem
 * @property {number|null} id
 * @property {string} name
 * @property {string} branch
 * @property {string} url
 * @property {string} createdAt
 * @property {number|null} ageMs
 */

/**
 * A FILA de uma forja — medida (`ok: true`) ou NÃO lida (a causa em `detail`).
 *
 * @typedef {Object} ForgeQueue
 * @property {boolean} ok
 * @property {number} waiting
 * @property {number|null} oldestMs
 * @property {boolean} [oldestFromSample]
 * @property {GithubQueuedItem[]} [items]
 * @property {string} detail
 */

/**
 * Quem PUXARIA a fila — a forma que as duas forjas compartilham (na Gitea, já com
 * a régua da própria forja traduzida para `online`/`offline` + `busy`, com o
 * estado bruto preservado em `raw`).
 *
 * @typedef {Object} QueuePuller
 * @property {string} name
 * @property {string} status `online`/`offline`
 * @property {boolean} [busy]
 * @property {string} [raw]
 */

/**
 * A metade de UMA forja — a saída de `deriveRunnerQueue`. Os cinco estados estão
 * documentados lá, incluindo a ORDEM que os separa.
 *
 * @typedef {Object} RunnerQueueHalf
 * @property {string} forge
 * @property {string} label
 * @property {"ociosa"|"drenando"|"parada"|"sem-puxador"|"unread"} state
 * @property {number} waiting
 * @property {number|null} oldestMs
 * @property {boolean} oldestFromSample
 * @property {number} online
 * @property {number} picking
 * @property {QueuePuller[]} runners
 * @property {string|null} remedy
 * @property {string} detail
 * @property {string} [where] de onde a metade da Gitea foi lida (o canal)
 */

/**
 * O FATO `runnerQueue`, como o `summarize` do doctor o consome.
 *
 * @typedef {Object} RunnerQueueFact
 * @property {"stalled"|"measured"|"unread"} state
 * @property {Record<string, RunnerQueueHalf>} forges
 * @property {number} waiting a soma que IGNORA a forja não lida
 * @property {string[]} stalled
 * @property {string[]} draining
 * @property {string[]} idle
 * @property {string[]} unsure
 * @property {string[]} unread
 * @property {{forge: string, ms: number, waiting: number, fromSample: boolean}|null} oldest
 * @property {string[]} remedies
 * @property {string} detail
 * @property {string[]} erros
 */

// ── A régua DECLARADA ────────────────────────────────────────────────────────

/** As forjas cuja fila este fato lê — a DONA DO MERGE primeiro, como no resto do relatório. */
export const RUNNER_QUEUE_FORGES = ["gitea", "github"]

/**
 * A forma DECLARADA de apontar o container da forja (o do Gitea, onde vive o
 * banco) — o irmão de `GITEA_RUNNER_CONTAINER`, pelo mesmo motivo: uma SONDA (o
 * ensaio contra uma stack de teste, que tem o banco em outro container) tem de
 * poder se declarar sem tomar o nome que a stack usa.
 */
export const GITEA_CONTAINER_ENV = "GITEA_CONTAINER"

/** O env do compose que declara ONDE está o banco da forja (e de que TIPO ele é). */
export const GITEA_DB_ENV = "GITEA__database__PATH"
export const GITEA_DB_TYPE_ENV = "GITEA__database__DB_TYPE"

/**
 * O tipo de banco que esta leitura sabe ler.
 *
 * Não é preferência: é o único que se lê com o que o container tem (o `sqlite3`
 * do próprio container da forja — medido: `/usr/bin/sqlite3` 3.45.3 na imagem
 * `gitea/gitea:1.22`). Um compose que aponte para outro banco cai em `unread`
 * DIZENDO isso, em vez de devolver zero itens e fingir uma fila vazia.
 */
export const GITEA_DB_TYPE_EXPECTED = "sqlite3"

/**
 * Os status de `action_task` da forja (Gitea v1.22.6, `models/actions/status.go`).
 *
 * Os números são da FORJA — a folha os cita para poder nomear a fila em SQL, e a
 * citação está aqui para quem for ler o banco saber de onde eles vieram.
 */
export const GITEA_TASK_STATUS = {
  UNKNOWN: 0,
  SUCCESS: 1,
  FAILURE: 2,
  CANCELLED: 3,
  SKIPPED: 4,
  WAITING: 5,
  RUNNING: 6,
  BLOCKED: 7,
}

/**
 * O que CONTA como espera para a Gitea: só `waiting` (5) — o estado que a forja
 * põe no job que nasceu e ainda não foi pego, e o filtro literal do
 * `CreateTaskForRunner` dela (`task_id = 0 AND status = waiting`). É o conjunto
 * "um runner o pegaria agora".
 *
 * `blocked` (7) NÃO conta: a v1.22.6 o usa para o job que espera `needs` ou
 * aprovação (`InsertRun`: `len(needs) > 0 || run.NeedApproval`) — re-registrar
 * runner nenhum destrava isso, e contá-lo faria o veredito publicar um remédio
 * que não é o da causa. `running` (6) também não: um job rodando é a forja
 * trabalhando, e contá-lo faria a fila parada se disfarçar de fila andando.
 */
export const GITEA_QUEUE_STATUSES = [GITEA_TASK_STATUS.WAITING]

/** A régua da forja para o estado do runner (v1.22.6, `models/actions/runner.go`). */
export const GITEA_RUNNER_OFFLINE_SECONDS = 60
export const GITEA_RUNNER_IDLE_SECONDS = 10

/** Quantos itens da fila são lidos no GitHub (a lista vem com o total ao lado). */
export const GITHUB_QUEUE_PAGE = 100

/**
 * O REMÉDIO de cada forja — o comando de RE-REGISTRO, que é o mesmo que a
 * mensagem do veredito publica.
 *
 * Os dois são re-registro e não "restart" pelo motivo que o próprio repositório
 * já documenta: o registro é ESTADO no servidor/volume — subir o serviço de novo
 * com o registro velho no lugar devolve o runner com a configuração antiga (e, no
 * `gitea-up.sh`, sem apagar o volume o registro antigo volta em silêncio).
 */
export const RUNNER_QUEUE_REMEDY = {
  gitea:
    "Remédio: `bash deploy/gitea-up.sh` no host da forja — é ele que recria o act_runner e RE-REGISTRA (o registro é estado no volume: subir o container sem o re-registro devolve o runner velho)",
  github:
    "Remédio: no host do runner, `bash deploy/setup-github-runner.sh` (o contexto completo e o `RUNNER_VERSION` pinado à versão que o serviço aceita — ver deploy/GITHUB_RUNNER.md § Troubleshooting)",
}

/** O nome humano de cada forja, para a linha do veredito. */
const FORGE_LABEL = { gitea: "Gitea", github: "GitHub" }

/** Um slug de repositório que pode ir para dentro do SQL — nada além disso. */
const SLUG_PART = /^[A-Za-z0-9._-]+$/

/**
 * O `owner/name` de um canal, validado para entrar numa consulta.
 *
 * @param {string|null} repo
 * @returns {{ok: boolean, owner?: string, name?: string, detail: string}}
 */
export function splitReposlug(repo) {
  const texto = String(repo ?? "").trim()
  if (texto === "") return { ok: false, detail: "sem repositório no canal desta forja" }
  const partes = texto.split("/")
  if (partes.length !== 2 || !SLUG_PART.test(partes[0]) || !SLUG_PART.test(partes[1])) {
    return {
      ok: false,
      detail: `o repositório '${texto}' não tem a forma owner/name que a leitura exige`,
    }
  }
  return { ok: true, owner: partes[0], name: partes[1], detail: texto }
}

// ── Os PARSERS (puros) ───────────────────────────────────────────────────────

/**
 * A FILA do GitHub, do payload de `GET /repos/:repo/actions/runs?status=queued`.
 *
 * O número da fila é o `total_count` da API (ela conta TODOS os runs do filtro, e
 * não os da página) e a idade vem do item mais antigo da AMOSTRA — e a amostra é
 * declarada: quando a API devolve menos itens que o total, a data da amostra deixa
 * de ser "a mais antiga da fila" e passa a ser "a mais antiga entre os lidos", e é
 * isso que o fato diz. (Medido: a API ignora `sort=created&direction=asc` neste
 * endpoint — pedir a ordenação crescente devolvia o mais NOVO primeiro, então a
 * idade exata de uma fila maior que a página não é obtível por aqui, e a folha
 * prefere dizer o que mediu a inventar a data.)
 *
 * @param {unknown} payload a resposta da API
 * @returns {{ok: boolean, waiting: number, oldestMs: number|null, oldestFromSample: boolean, items: GithubQueuedItem[], detail: string}}
 */
export function parseGithubQueuedRuns(payload) {
  const runs = payload && typeof payload === "object" ? payload.workflow_runs : null
  if (!Array.isArray(runs)) {
    return {
      ok: false,
      waiting: 0,
      oldestMs: null,
      oldestFromSample: false,
      items: [],
      detail: "a resposta da API não tem a lista 'workflow_runs'",
    }
  }
  const items = runs.map((r) => ({
    id: r?.id ?? null,
    name: String(r?.name ?? ""),
    branch: String(r?.head_branch ?? ""),
    url: String(r?.html_url ?? ""),
    createdAt: String(r?.created_at ?? ""),
    ageMs: ageFromIso(r?.created_at),
  }))
  const total = Number(payload?.total_count)
  const waiting = Number.isFinite(total) && total >= 0 ? total : items.length
  const maisAntigo = items.filter((i) => i.ageMs !== null).sort((a, b) => b.ageMs - a.ageMs)[0]
  return {
    ok: true,
    waiting,
    oldestMs: maisAntigo?.ageMs ?? null,
    oldestFromSample: waiting > items.length,
    items,
    detail: `${waiting} run(s) em \`queued\` (${items.length} lido(s))${maisAntigo ? ` — o mais antigo lido tem ${dur(maisAntigo.ageMs)}` : ""}`,
  }
}

/**
 * A FILA da Gitea, da saída do `sqlite3 -json` sobre `action_run_job` — a tabela
 * em que a forja guarda o job que espera (a linha de `action_task` só nasce
 * quando um runner pega).
 *
 * O `created` da tabela é o timestamp em SEGUNDOS da própria forja, e é dele que
 * sai a idade — a mesma unidade de `action_runner.last_online`, para as duas
 * metades da pergunta falarem a mesma língua.
 *
 * Tabela vazia devolve stdout vazio (não `[]`): isso é uma fila vazia MEDIDA, e
 * não um erro de leitura — a distinção é o que separa "nada esperando" de "não
 * consegui olhar".
 *
 * @param {string} stdout
 * @param {number} nowMs
 * @returns {{ok: boolean, waiting: number, oldestMs: number|null, detail: string}}
 */
export function parseGiteaQueueCounts(stdout, nowMs) {
  const rows = parseSqliteJson(stdout)
  if (!rows.ok) return { ok: false, waiting: 0, oldestMs: null, detail: rows.detail }
  const row = rows.rows[0] ?? {}
  const waiting = Number(row.aguardando ?? row.waiting ?? 0)
  if (!Number.isFinite(waiting) || waiting < 0) {
    return {
      ok: false,
      waiting: 0,
      oldestMs: null,
      detail: `a consulta devolveu uma contagem que não é um número (${JSON.stringify(row.aguardando)})`,
    }
  }
  const criadoEm = Number(row.mais_antiga)
  const oldestMs =
    Number.isFinite(criadoEm) && criadoEm > 0 ? Math.max(0, nowMs - criadoEm * 1000) : null
  return {
    ok: true,
    waiting,
    oldestMs,
    detail: `${waiting} tarefa(s) em espera${oldestMs !== null ? ` — a mais antiga tem ${dur(oldestMs)}` : ""}`,
  }
}

/** O id do repositório no banco da forja — a chave que escopa a fila. */
export function parseGiteaRepoId(stdout) {
  const rows = parseSqliteJson(stdout)
  if (!rows.ok) return { ok: false, id: null, detail: rows.detail }
  const id = Number(rows.rows[0]?.repo_id)
  if (!Number.isFinite(id) || id <= 0) {
    return { ok: false, id: null, detail: "o repositório não existe no banco desta forja" }
  }
  return { ok: true, id, detail: `repo_id ${id}` }
}

/**
 * Os runners REGISTRADOS na Gitea, com o estado que a PRÓPRIA régua da forja
 * deriva (`offline`/`idle`/`active`).
 *
 * @param {string} stdout
 * @param {number} nowMs
 * @returns {{ok: boolean, runners: QueuePuller[], detail: string}}
 */
export function parseGiteaRunnerRows(stdout, nowMs) {
  const rows = parseSqliteJson(stdout)
  if (!rows.ok) return { ok: false, runners: [], detail: rows.detail }
  const runners = rows.rows.map((r) => {
    const online = segundos(r.last_online)
    const ativo = segundos(r.last_active)
    return {
      name: String(r.name ?? ""),
      version: String(r.version ?? ""),
      lastOnline: online,
      lastActive: ativo,
      status: giteaRunnerStatus({ lastOnline: online, lastActive: ativo }, nowMs),
    }
  })
  return { ok: true, runners, detail: `${runners.length} runner(s) registrado(s)` }
}

/**
 * O estado de um runner pela régua DA FORJA (Gitea v1.22.6,
 * `models/actions/runner.go`): OFFLINE quando o último contato passou de
 * `RunnerOfflineTime` (1 minuto); IDLE quando está no ar e sem atividade nos
 * últimos `RunnerIdleTime` (10 segundos); ACTIVE quando esteve ativo agora — e
 * ACTIVE é o único estado em que alguém está de fato PEGANDO um job.
 *
 * @param {{lastOnline?: number|null, lastActive?: number|null}} row segundos unix
 * (as duas podem faltar: uma linha sem `last_online` é OFFLINE, nunca "no ar")
 * @param {number} nowMs
 * @returns {"offline"|"idle"|"active"}
 */
export function giteaRunnerStatus(row, nowMs) {
  const online = Number(row?.lastOnline)
  if (!Number.isFinite(online) || online <= 0) return "offline"
  const desdeOnline = nowMs / 1000 - online
  if (desdeOnline > GITEA_RUNNER_OFFLINE_SECONDS) return "offline"
  const ativo = Number(row?.lastActive)
  if (!Number.isFinite(ativo) || ativo <= 0) return "idle"
  return nowMs / 1000 - ativo > GITEA_RUNNER_IDLE_SECONDS ? "idle" : "active"
}

/**
 * A DERIVAÇÃO — a única parte que decide, e por isso a única que a mutação ataca.
 *
 * Os cinco estados existem porque as causas são diferentes e o remédio também:
 *
 *   · `ociosa`        — nada esperando (medido). Não há dívida: um runner fora do
 *                       ar com a fila vazia não para nada.
 *   · `drenando`      — fila com runner ONLINE e PEGANDO job (GitHub: `busy`;
 *                       Gitea: `active`). É a forja trabalhando.
 *   · `parada`        — fila cheia e NENHUM runner online: o job fica em `queued`
 *                       para sempre e nada falha. É a dívida, e é BLOQUEIO.
 *   · `sem-puxador`   — fila cheia, runner online e nenhum pegando job. Pode ser a
 *                       janela do poll ou os labels não casando com os `runs-on`:
 *                       NÃO é prova de uma coisa nem de outra, então é dúvida.
 *   · `unread`        — a fila ou quem a puxaria não pôde ser lido (causa nomeada).
 *
 * A ORDEM importa: a fila vazia é medida ANTES do estado do puxador, porque zero
 * espera não é dívida nem com a forja no chão — e ler o contrário faria o item
 * mais comum (a fila vazia de todo dia) abrir bloqueio.
 *
 * O `nowMs` é ACEITO para o chamador passar UM relógio só, mas esta derivação
 * não o lê: a idade já vem MEDIDA em `queue.oldestMs` (quem mede é o parser de
 * cada forja) — reler o relógio aqui criaria uma segunda idade para o mesmo item.
 *
 * @param {{forge: string, queue: object, pullers: object[]|null, nowMs?: number}} args
 * @returns {RunnerQueueHalf} a metade de uma forja
 */
export function deriveRunnerQueue({ forge, queue, pullers, nowMs: _nowMs = Date.now() }) {
  const base = {
    forge,
    label: FORGE_LABEL[forge] ?? forge,
    state: "unread",
    waiting: 0,
    oldestMs: null,
    oldestFromSample: false,
    online: 0,
    picking: 0,
    runners: [],
    remedy: RUNNER_QUEUE_REMEDY[forge] ?? null,
    detail: "",
  }
  if (!queue?.ok) {
    return { ...base, detail: `a fila não pôde ser lida: ${queue?.detail ?? "sem leitura"}` }
  }
  if (!Array.isArray(pullers)) {
    return {
      ...base,
      waiting: queue.waiting,
      oldestMs: queue.oldestMs ?? null,
      detail: "quem puxaria a fila não foi lido (o registro do runner desta forja não respondeu)",
    }
  }
  const online = pullers.filter((p) => p.status === "online")
  const picking = online.filter((p) => p.busy)
  const comum = {
    ...base,
    waiting: queue.waiting,
    oldestMs: queue.oldestMs ?? null,
    oldestFromSample: Boolean(queue.oldestFromSample),
    online: online.length,
    picking: picking.length,
    runners: pullers,
  }
  if (queue.waiting === 0) {
    return {
      ...comum,
      state: "ociosa",
      detail: `fila vazia (${pullers.length} runner(s) registrado(s), ${online.length} online)`,
    }
  }
  const idade = queue.oldestMs !== null ? ` — a mais antiga espera há ${dur(queue.oldestMs)}` : ""
  if (online.length === 0) {
    return {
      ...comum,
      state: "parada",
      detail: `${queue.waiting} item(ns) esperando e NENHUM dos ${pullers.length} runner(s) registrado(s) está online${idade}`,
    }
  }
  if (picking.length > 0) {
    return {
      ...comum,
      state: "drenando",
      detail: `${queue.waiting} item(ns) esperando com ${picking.length} de ${online.length} runner(s) online pegando job${idade}`,
    }
  }
  return {
    ...comum,
    state: "sem-puxador",
    detail: `${queue.waiting} item(ns) esperando, ${online.length} runner(s) online e NENHUM pegando job${idade} (pode ser a janela do poll, ou nenhum runner casar com os \`runs-on\` da fila)`,
  }
}

/**
 * A LINHA do veredito de uma forja PARADA — zero ou uma.
 *
 * Uma linha por forja, e não uma por item da fila: a fila é UM problema com uma
 * causa (ninguém a puxa) e dez runs esperando não são dez defeitos. O item mais
 * antigo entra como EVIDÊNCIA da idade, que é o que distingue a fila parada de
 * uma fila recém-formada.
 *
 * @param {RunnerQueueHalf} metade a saída de `deriveRunnerQueue`
 * @returns {string[]}
 */
export function runnerQueueBlocker(metade) {
  if (metade?.state !== "parada") return []
  const idade =
    metade.oldestMs !== null
      ? ` (a mais antiga espera há ${dur(metade.oldestMs)}${metade.oldestFromSample ? ", medida na amostra lida" : ""})`
      : ""
  return [
    `o runner da forja ${metade.label} está FORA DO AR com run na FILA: ${metade.waiting} item(ns) esperando e 0 de ${metade.runners.length} runner(s) online${idade} — TODO job que dependa dele fica em \`queued\` para sempre, nada falha e nada fica vermelho; a fila de um self-hosted não é infinita (o GitHub descarta o run por volta de 24h), então quem espera perde a execução em silêncio${metade.remedy ? ` ${metade.remedy}` : ""}`,
  ]
}

/**
 * A LINHA de DÚVIDA de uma forja com fila e sem quem a puxe.
 *
 * @param {RunnerQueueHalf} metade
 * @returns {string[]}
 */
export function runnerQueueUnknown(metade) {
  if (metade?.state !== "sem-puxador") return []
  return [`fila parada? ${metade.detail}`]
}

// ── As LEITURAS (a fronteira de I/O) ─────────────────────────────────────────

/**
 * A fila do GitHub: `GET /repos/:repo/actions/runs?status=queued`.
 *
 * Usa o `githubApi` do `issue-publish.mjs` (o MESMO caminho de headers/versão da
 * API que o board usa) em vez de uma segunda implementação — e nunca lança: um
 * 4xx/403 vira `ok: false` com o corpo, porque a leitura de fila exige o MESMO
 * escopo que a lista de runners, e um run de CI com `GITHUB_TOKEN` não o tem.
 *
 * @param {{token?: string|null, repo?: string|null, baseUrl?: string, api?: Function}} args
 * @returns {Promise<{ok: boolean, waiting: number, oldestMs: number|null, oldestFromSample: boolean, items: GithubQueuedItem[], detail: string}>}
 */
export async function readGithubQueue({
  token,
  repo,
  baseUrl = "https://api.github.com",
  api = githubApi,
} = {}) {
  if (!token || !repo) {
    return {
      ok: false,
      waiting: 0,
      oldestMs: null,
      oldestFromSample: false,
      items: [],
      detail: `sem o canal do GitHub (${[!token && "GH_TOKEN", !repo && "GH_REPOSITORY"].filter(Boolean).join(" e ")}): a fila do repositório não é lida, e um repo desconhecido devolveria uma fila vazia FALSA`,
    }
  }
  const caminho = `/actions/runs?status=queued&per_page=${GITHUB_QUEUE_PAGE}`
  let resposta
  try {
    resposta = await api({ token, repo, baseUrl }, "GET", caminho)
  } catch (err) {
    return {
      ok: false,
      waiting: 0,
      oldestMs: null,
      oldestFromSample: false,
      items: [],
      detail: `a API do GitHub não respondeu: ${err?.message ?? String(err)}`,
    }
  }
  if (resposta?.status !== 200) {
    const dica =
      resposta?.status === 401 || resposta?.status === 403
        ? " — a lista de runs exige leitura de Actions no repositório (PAT clássico com scope `repo`, ou fine-grained com 'Actions: read')"
        : ""
    return {
      ok: false,
      waiting: 0,
      oldestMs: null,
      oldestFromSample: false,
      items: [],
      detail: `GET ${caminho} → HTTP ${resposta?.status}${dica}`,
    }
  }
  return parseGithubQueuedRuns(resposta.data)
}

/**
 * A fila do GitHub pelo SEGUNDO canal: a CLI `gh`.
 *
 * O repositório lê o GitHub por dois canais (`githubReadConfig`: a API com
 * `GH_TOKEN` + `GH_REPOSITORY`, e a CLI `gh` quando a credencial vem do
 * `gh auth login`) — o board faz isso, e a fila não pode ser o único fato que só
 * lê num deles. Num host com `gh` autenticado e sem `GH_TOKEN` exportado (o caso
 * de qualquer checkout de quem desenvolve), o canal da API não existe e a fila
 * ficava "não lida" com a resposta disponível ao lado.
 *
 * O comando é o MESMO endpoint do canal da API (`gh api` fala a REST do GitHub),
 * e o `--jq .` só pede o JSON cru. Sem `gh` instalado, o erro do spawn vira
 * `ok: false` — nomeado, nunca "sem fila".
 *
 * @param {{repo?: string|null, run?: Function|null}} args
 * @returns {{ok: boolean, waiting: number, oldestMs: number|null, oldestFromSample: boolean, items: GithubQueuedItem[], detail: string}}
 */
export function readGithubQueueCli({ repo, run }) {
  const caminho = `/repos/${repo}/actions/runs?status=queued&per_page=${GITHUB_QUEUE_PAGE}`
  if (!run) {
    return {
      ok: false,
      waiting: 0,
      oldestMs: null,
      oldestFromSample: false,
      items: [],
      detail: "sem o canal da API e sem runner de processo para a CLI `gh`",
    }
  }
  const res = run("gh", ["api", caminho, "--jq", "."], { encoding: "utf8", timeout: 60_000 })
  if (res?.error) {
    return {
      ok: false,
      waiting: 0,
      oldestMs: null,
      oldestFromSample: false,
      items: [],
      detail: `a CLI \`gh\` falhou (${res.error.message ?? String(res.error)}) — e sem GH_TOKEN não há o canal da API (a fila do repositório exige leitura de Actions)`,
    }
  }
  if (res?.status !== 0 && res?.status !== undefined) {
    return {
      ok: false,
      waiting: 0,
      oldestMs: null,
      oldestFromSample: false,
      items: [],
      detail: `\`gh api ${caminho}\` saiu ${res.status}: ${String(res.stderr ?? "")
        .trim()
        .slice(0, 200)}`,
    }
  }
  let parsed
  try {
    parsed = JSON.parse(String(res.stdout ?? ""))
  } catch (err) {
    return {
      ok: false,
      waiting: 0,
      oldestMs: null,
      oldestFromSample: false,
      items: [],
      detail: `a saída do \`gh\` não é JSON (${err?.message ?? String(err)}): ${String(res.stdout ?? "").slice(0, 120)}`,
    }
  }
  return parseGithubQueuedRuns(parsed)
}

/**
 * ONDE está o banco da forja: o container e o caminho, DERIVADOS do compose
 * comitado (o `GITEA__database__PATH` que a própria stack declara) — e a forma
 * declarada (`GITEA_CONTAINER`) vencendo o derivado, como no container do runner.
 *
 * Nunca crava o nome `gitea` nem o caminho `/data/gitea/gitea.db`: um compose que
 * mude de serviço, de container ou de caminho entra sozinho, e um compose que não
 * declare nada é `unread` NOMEADO (não há segunda verdade sobre a stack aqui).
 *
 * @param {{cwd: string, readFile?: Function, run?: Function, declarado?: string|null, compose?: string}} args
 * @returns {{ok: boolean, container?: string, dbPath?: string, dbType?: string, service?: string, detail: string}}
 */
export function resolveGiteaDatabase({
  cwd,
  readFile,
  run,
  declarado = null,
  compose = GITEA_COMPOSE,
} = {}) {
  let texto
  try {
    texto = (readFile ?? ((p) => readFileSync(p, "utf8")))(`${cwd}/${compose}`)
  } catch (err) {
    return { ok: false, detail: `${compose} não pôde ser lido: ${err?.message ?? String(err)}` }
  }
  const doc = parseYamlDocument(texto)
  if (!doc.ok) return { ok: false, detail: `${compose}: ${doc.motivo}` }
  const servicos = doc.doc?.services
  if (!servicos || typeof servicos !== "object") {
    return {
      ok: false,
      detail: `${compose} não tem a chave 'services' — não sei qual serviço é a forja`,
    }
  }
  // O serviço da forja é AQUELE QUE DECLARA O BANCO (o mesmo sinal que o compose
  // usa para montá-lo): derivar pelo nome do serviço amarraria a leitura à stack.
  const achados = []
  for (const [nome, servico] of Object.entries(servicos)) {
    const env = envDoServico(servico)
    if (!(GITEA_DB_ENV in env)) continue
    achados.push({
      nome,
      servico,
      dbPath: env[GITEA_DB_ENV],
      dbType: env[GITEA_DB_TYPE_ENV] ?? null,
    })
  }
  if (achados.length === 0) {
    return {
      ok: false,
      detail: `nenhum serviço de ${compose} declara ${GITEA_DB_ENV}: não sei qual container tem o banco da forja`,
    }
  }
  if (achados.length > 1) {
    return {
      ok: false,
      detail: `${achados.length} serviços de ${compose} declaram ${GITEA_DB_ENV} (${achados.map((a) => a.nome).join(", ")}) — não sei qual é a forja`,
    }
  }
  const alvo = achados[0]
  if (String(alvo.dbPath).includes("${")) {
    return {
      ok: false,
      detail: `o ${GITEA_DB_ENV} de ${compose} é interpolado (${alvo.dbPath}) — a leitura precisa do caminho resolvido, e adivinhá-lo seria uma segunda verdade sobre a stack`,
    }
  }
  const nomeDeclarado = typeof declarado === "string" ? declarado.trim() : ""
  const container =
    nomeDeclarado !== ""
      ? nomeDeclarado
      : typeof alvo.servico?.container_name === "string" &&
          alvo.servico.container_name.trim() !== ""
        ? alvo.servico.container_name.trim()
        : null
  if (container === null) {
    const res = (run ?? (() => ({ error: new Error("sem docker") })))(
      "docker",
      ["ps", "--filter", `label=com.docker.compose.service=${alvo.nome}`, "--format", "{{.Names}}"],
      { cwd, encoding: "utf8", timeout: 30_000 },
    )
    if (res?.error)
      return {
        ok: false,
        detail: `o container da forja não pôde ser resolvido: ${res.error.message ?? String(res.error)}`,
      }
    const nomes = String(res?.stdout ?? "")
      .split("\n")
      .map((n) => n.trim())
      .filter(Boolean)
    if (nomes.length === 0) {
      return {
        ok: false,
        detail: `nenhum container do serviço '${alvo.nome}' está rodando (${compose} não declara \`container_name\`)`,
      }
    }
    return {
      ok: true,
      container: nomes[0],
      dbPath: String(alvo.dbPath).trim(),
      dbType: alvo.dbType,
      service: alvo.nome,
      detail: `container '${nomes[0]}' (service label do compose) · banco ${String(alvo.dbPath).trim()}`,
    }
  }
  return {
    ok: true,
    container,
    dbPath: String(alvo.dbPath).trim(),
    dbType: alvo.dbType,
    service: alvo.nome,
    detail: `container '${container}' (${nomeDeclarado !== "" ? `declarado por ${GITEA_CONTAINER_ENV}` : "container_name do compose"}) · banco ${String(alvo.dbPath).trim()}`,
  }
}

/**
 * A FILA e o ESTADO DOS RUNNERS da Gitea, pelas tabelas `repository` (o alvo),
 * `action_run_job` (a fila) e `action_runner` (quem a puxaria) — três consultas,
 * no MESMO canal do registro do runner (o `docker exec` no container da stack,
 * com o `sqlite3` de lá).
 *
 * A ordem é deliberada: primeiro o REPOSITÓRIO. Um slug que não existe no banco
 * devolveria `0` itens esperando — um verde FALSO de fila vazia, que é pior que a
 * leitura que não aconteceu. Ausente, a leitura para em `unread` nomeando o slug.
 *
 * @param {{cwd?: string, run?: Function|null, container: string, dbPath: string, dbType?: string|null, repo: string|null, nowMs?: number}} args
 * @returns {{ok: boolean, queue?: ForgeQueue, runners?: QueuePuller[], detail: string}}
 */
export function readGiteaQueue({
  cwd,
  run,
  container,
  dbPath,
  dbType = null,
  repo,
  nowMs = Date.now(),
}) {
  if (dbType !== null && String(dbType) !== GITEA_DB_TYPE_EXPECTED) {
    return {
      ok: false,
      detail: `o compose declara o banco '${dbType}' e esta leitura só sabe o '${GITEA_DB_TYPE_EXPECTED}' (o \`sqlite3\` do container da forja)`,
    }
  }
  const slug = splitReposlug(repo)
  if (!slug.ok) return { ok: false, detail: slug.detail }

  const consulta = (sql) =>
    run("docker", ["exec", container, "sqlite3", "-json", dbPath, sql], {
      cwd,
      encoding: "utf8",
      timeout: 30_000,
    })

  const idSql = `select id as repo_id from repository where owner_name = '${slug.owner}' and lower_name = lower('${slug.name}');`
  const idRes = consulta(idSql)
  if (idRes?.error) {
    return {
      ok: false,
      detail: `a forja não pôde ser consultada (\`docker exec ${container} sqlite3\`): ${idRes.error.message ?? String(idRes.error)}`,
    }
  }
  if (idRes?.status !== 0 && idRes?.status !== undefined) {
    return {
      ok: false,
      detail: `a consulta da forja falhou (exit ${idRes.status}): ${String(idRes.stderr ?? "")
        .trim()
        .slice(0, 200)}`,
    }
  }
  const repoId = parseGiteaRepoId(idRes.stdout)
  if (!repoId.ok) return { ok: false, detail: `${repoId.detail} (${slug.detail})` }

  // `task_id = 0` é o mesmo predicado do `CreateTaskForRunner` da forja: a linha
  // de `action_run_job` é a FILA, e o `task_id` só sai do zero quando um runner
  // pega o job (e ele vira `running`, que já não conta) — o filtro separa
  // "esperando" de "na mão de alguém" mesmo se um estado intermediário escapar.
  const filaSql = `select count(*) as aguardando, min(created) as mais_antiga from action_run_job where repo_id = ${repoId.id} and task_id = 0 and status in (${GITEA_QUEUE_STATUSES.join(", ")});`
  const filaRes = consulta(filaSql)
  if (filaRes?.error) {
    return {
      ok: false,
      detail: `a fila da forja não pôde ser consultada: ${filaRes.error.message ?? String(filaRes.error)}`,
    }
  }
  if (filaRes?.status !== 0 && filaRes?.status !== undefined) {
    return {
      ok: false,
      detail: `a consulta da fila falhou (exit ${filaRes.status}): ${String(filaRes.stderr ?? "")
        .trim()
        .slice(0, 200)}`,
    }
  }
  const fila = parseGiteaQueueCounts(filaRes.stdout, nowMs)
  if (!fila.ok) return { ok: false, detail: fila.detail }

  // QUEM PUXARIA A FILA: os runners VIVOS que alcançam este repositório — o do
  // repo, o do dono (org/usuário) e o global (system, que serve a todos). Um
  // runner de outro repositório não pega estes jobs, e contá-lo faria uma fila
  // parada parecer drenada.
  // O SQLITE3 CLI do container da forja devolve a coluna `deleted` (NOT NULL
  // com default 0, e criada antes do NOT NULL existir) como texto/NULL em
  // linhas antigas — o literal `deleted = 0` exclui o runner VIVO do mundo real
  // (medido: vps-runner, deleted=NULL, sumia da contagem e o doctor dizia
  // "0 runners online" com a fila de pé). O COALESCE normaliza o mundo real:
  // ausente/NULL conta como vivo (fail-open na leitura, que é o lado seguro —
  // o falso "sem runners" é o verde mentiroso desta pergunta).
  const runnersSql = `select name, version, last_online, last_active from action_runner where coalesce(deleted, 0) = 0 and (repo_id = ${repoId.id} or owner_id = (select owner_id from repository where id = ${repoId.id}) or (repo_id = 0 and owner_id = 0));`
  const runnersRes = consulta(runnersSql)
  if (runnersRes?.error) {
    return {
      ok: false,
      detail: `os runners da forja não puderam ser consultados: ${runnersRes.error.message ?? String(runnersRes.error)}`,
    }
  }
  if (runnersRes?.status !== 0 && runnersRes?.status !== undefined) {
    return {
      ok: false,
      detail: `a consulta dos runners falhou (exit ${runnersRes.status}): ${String(
        runnersRes.stderr ?? "",
      )
        .trim()
        .slice(0, 200)}`,
    }
  }
  const runners = parseGiteaRunnerRows(runnersRes.stdout, nowMs)
  if (!runners.ok) return { ok: false, detail: runners.detail }

  return {
    ok: true,
    queue: {
      ok: true,
      waiting: fila.waiting,
      oldestMs: fila.oldestMs,
      oldestFromSample: false,
      items: [],
      detail: fila.detail,
    },
    // A forma dos pullers é a MESMA das duas forjas (`status`/`busy`): a
    // derivação não pode ter uma régua por forja, senão as duas metades do fato
    // discordariam no dia em que uma mudasse.
    runners: runners.runners.map((r) => ({
      name: r.name,
      version: r.version,
      status: r.status === "offline" ? "offline" : "online",
      busy: r.status === "active",
      raw: r.status,
    })),
    detail: `${container} · ${repoId.detail} · ${fila.detail} · ${runners.detail}`,
  }
}

/**
 * O FATO: a fila parada das DUAS forjas.
 *
 * Cada forja responde com as suas duas metades (a fila e quem a puxaria) — e o
 * GitHub recebe a lista de runners JÁ LIDA pelo fato do registro (o doctor a
 * passa): ler a API de runners duas vezes seria a segunda verdade sobre o mesmo
 * registro, e é justamente o que a leitura de fila não deve introduzir.
 *
 * @param {{cwd?: string, env?: object, repos?: object, githubRunners?: object[]|null, declarado?: string|null, deps?: object, nowMs?: number}} args
 * @returns {Promise<RunnerQueueFact>} o fato `runnerQueue`
 */
export async function readRunnerQueue({
  cwd,
  env = process.env,
  repos = {},
  githubRunners = null,
  declarado = null,
  deps = {},
  nowMs = Date.now(),
} = {}) {
  const {
    // O CANAL do GitHub é o MESMO resolvedor do board (`githubReadConfig`): ele
    // decide entre a API (GH_TOKEN) e a CLI (gh auth), e o ambiente já vem SEM o
    // contexto compartilhado da forja — no runner da Gitea o `GITHUB_REPOSITORY`
    // aponta para a FORJA, e ler a fila do repositório errado seria o defeito de
    // origem que a régua do canal existe para impedir.
    channel = githubReadConfig,
    api = githubApi,
    run = null,
    readFile = null,
    resolveDb = resolveGiteaDatabase,
    readGitea = readGiteaQueue,
    readGithubCli = readGithubQueueCli,
  } = deps
  const forges = {}
  const erros = []

  // ── A DONA DO MERGE primeiro, como no resto do relatório ──────────────────
  try {
    const db = resolveDb({ cwd, run, readFile, declarado })
    if (!db.ok) {
      forges.gitea = deriveRunnerQueue({
        forge: "gitea",
        queue: { ok: false, detail: db.detail },
        pullers: null,
        nowMs,
      })
      erros.push(`gitea: ${db.detail}`)
    } else {
      const lido = readGitea({
        cwd,
        run,
        container: db.container,
        dbPath: db.dbPath,
        dbType: db.dbType ?? null,
        repo: repos.gitea ?? null,
        nowMs,
      })
      forges.gitea = lido.ok
        ? {
            ...deriveRunnerQueue({
              forge: "gitea",
              queue: lido.queue,
              pullers: lido.runners,
              nowMs,
            }),
            where: lido.detail,
          }
        : deriveRunnerQueue({
            forge: "gitea",
            queue: { ok: false, detail: lido.detail },
            pullers: null,
            nowMs,
          })
      if (!lido.ok) erros.push(`gitea: ${lido.detail}`)
    }
  } catch (err) {
    forges.gitea = deriveRunnerQueue({
      forge: "gitea",
      queue: { ok: false, detail: String(err?.message ?? err) },
      pullers: null,
      nowMs,
    })
    erros.push(`gitea: ${err?.message ?? String(err)}`)
  }

  // ── O espelho ─────────────────────────────────────────────────────────────
  try {
    const cfg = channel({ env, repo: repos.github ?? null })
    const fila = !cfg?.repo
      ? {
          ok: false,
          waiting: 0,
          oldestMs: null,
          oldestFromSample: false,
          items: [],
          detail: `sem o canal do GitHub (GH_REPOSITORY): a fila de um repositório desconhecido devolveria o vazio FALSO de uma fila limpa`,
        }
      : cfg.via === "api"
        ? await readGithubQueue({ token: cfg.token, repo: cfg.repo, baseUrl: cfg.baseUrl, api })
        : readGithubCli({ repo: cfg.repo, run })
    forges.github = deriveRunnerQueue({
      forge: "github",
      queue: fila,
      pullers: githubRunners,
      nowMs,
    })
    if (!fila.ok) erros.push(`github: ${fila.detail}`)
  } catch (err) {
    forges.github = deriveRunnerQueue({
      forge: "github",
      queue: { ok: false, detail: String(err?.message ?? err) },
      pullers: null,
      nowMs,
    })
    erros.push(`github: ${err?.message ?? String(err)}`)
  }

  const metades = RUNNER_QUEUE_FORGES.map((f) => forges[f]).filter(Boolean)
  const paradas = metades.filter((m) => m.state === "parada")
  const drenando = metades.filter((m) => m.state === "drenando")
  const ociosas = metades.filter((m) => m.state === "ociosa")
  const duvidas = metades.filter((m) => m.state === "sem-puxador")
  const naoLidas = metades.filter((m) => m.state === "unread")
  const oldest = metades
    .filter((m) => m.waiting > 0 && m.oldestMs !== null)
    .sort((a, b) => b.oldestMs - a.oldestMs)[0]

  // O ESTADO do fato: ele é DÍVIDA quando alguma forja está parada; MEDIDO quando
  // todas responderam (parada/ociosa/drenando são todas medições, e as três dizem
  // algo); `unread` só quando NENHUMA forja respondeu — uma forja lida com a fila
  // vazia continua sendo uma medição, e a que não foi lida sai dita na `detail`
  // (o veredito a publica como dúvida, nunca como sincronia).
  const state =
    paradas.length > 0 ? "stalled" : naoLidas.length === metades.length ? "unread" : "measured"
  return {
    state,
    forges,
    waiting: metades.reduce((soma, m) => soma + (m.state === "unread" ? 0 : m.waiting), 0),
    stalled: paradas.map((m) => m.forge),
    draining: drenando.map((m) => m.forge),
    idle: ociosas.map((m) => m.forge),
    unsure: duvidas.map((m) => m.forge),
    unread: naoLidas.map((m) => m.forge),
    oldest: oldest
      ? {
          forge: oldest.forge,
          ms: oldest.oldestMs,
          waiting: oldest.waiting,
          fromSample: oldest.oldestFromSample,
        }
      : null,
    remedies: metades.map((m) => m.remedy).filter(Boolean),
    detail:
      paradas.length > 0
        ? paradas.map((m) => `${m.label}: ${m.detail}`).join(" · ")
        : metades.map((m) => `${m.label}: ${m.detail}`).join(" · "),
    erros,
  }
}

// ── Utilitários ──────────────────────────────────────────────────────────────

/** Uma duração legível ("14h03", "9min", "48s") — a idade da fila. */
export function dur(ms) {
  const total = Math.max(0, Math.round(Number(ms) / 1000))
  if (total < 60) return `${total}s`
  const min = Math.floor(total / 60)
  if (min < 60) return `${min}min`
  const horas = Math.floor(min / 60)
  const resto = min % 60
  if (horas < 24) return `${horas}h${String(resto).padStart(2, "0")}`
  return `${Math.floor(horas / 24)}d${String(horas % 24).padStart(2, "0")}h`
}

/** A idade de um `created_at` ISO (null quando não é uma data). */
function ageFromIso(valor) {
  const t = Date.parse(String(valor ?? ""))
  return Number.isFinite(t) ? Math.max(0, Date.now() - t) : null
}

/** Um timestamp em segundos que pode vir como number ou string. */
function segundos(valor) {
  const n = Number(valor)
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * O `sqlite3 -json` do container como lista de objetos.
 *
 * Tabela VAZIA devolve stdout vazio (medido: o `-json` não imprime `[]`), e isso
 * é uma leitura BEM-SUCEDIDA de zero linhas — a diferença para "não consegui
 * olhar" é o que o fato inteiro existe para preservar.
 */
function parseSqliteJson(stdout) {
  const texto = String(stdout ?? "").trim()
  if (texto === "") return { ok: true, rows: [], detail: "0 linha(s)" }
  let parsed
  try {
    parsed = JSON.parse(texto)
  } catch (err) {
    return {
      ok: false,
      rows: [],
      detail: `a saída do sqlite3 não é JSON (${err?.message ?? String(err)}): ${texto.slice(0, 120)}`,
    }
  }
  if (!Array.isArray(parsed))
    return { ok: false, rows: [], detail: "a saída do sqlite3 não é uma lista" }
  return { ok: true, rows: parsed, detail: `${parsed.length} linha(s)` }
}

/** O `environment` de um serviço do compose, nas três formas que o YAML aceita. */
function envDoServico(servico) {
  const env = servico?.environment
  if (Array.isArray(env)) {
    const mapa = {}
    for (const item of env) {
      const texto = String(item ?? "")
      const igual = texto.indexOf("=")
      if (igual === -1) mapa[texto.trim()] = ""
      else mapa[texto.slice(0, igual).trim()] = texto.slice(igual + 1).trim()
    }
    return mapa
  }
  if (env && typeof env === "object") {
    const mapa = {}
    for (const [k, v] of Object.entries(env)) mapa[k] = v === null ? "" : String(v)
    return mapa
  }
  return {}
}
