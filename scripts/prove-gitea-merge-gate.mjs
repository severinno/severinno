#!/usr/bin/env node
// =============================================================================
// prove-gitea-merge-gate.mjs
//
// Usage:
//   node scripts/prove-gitea-merge-gate.mjs              # sobe o Gitea efêmero e prova a matriz
//   node scripts/prove-gitea-merge-gate.mjs --json       # mesmo veredito, formato plano
//   node scripts/prove-gitea-merge-gate.mjs --keep       # não remove o container no fim
//   node scripts/prove-gitea-merge-gate.mjs --port 3390 --image gitea/gitea:1.22
//
// Exit codes:
//   0 — PROVADO: verde mergeia, vermelho NÃO mergeia, ausente NÃO mergeia, e a
//       exigência desligada volta a mergear (a mutação que a regressão faria)
//   1 — VIOLADO: alguma célula da matriz não bateu — o gate não morde
//   2 — INDETERMINADO: sem docker, imagem ausente, API não subiu
//   3 — uso inválido
//
// POR QUE EXISTE
//
// `ci/required-checks.json` declara os checks e `apply-required-checks.mjs` os
// aplica no branch protection. Nada disso prova que o merge é BLOQUEADO: a
// exigência mora na forja, e o que a forja faz com ela só se sabe rodando. Este
// comando fecha a pergunta subindo um Gitea de verdade, aplicando o manifesto com
// o APLIADOR DE VERDADE e tentando mergear em quatro situações.
//
// A matriz (cada linha é um PR de verdade, contra a API de verdade):
//
//   | caso                          | status do check exigido | merge esperado |
//   | CONTROLE: todos verdes        | success                 | PERMITIDO      |
//   | GATE VERMELHO                 | failure                 | RECUSADO       |
//   | GATE AUSENTE                  | (nenhum)                | RECUSADO       |
//   | EXIGÊNCIA DESLIGADA (mutação) | failure                 | PERMITIDO      |
//
// A última linha é o ponto: `status_check_contexts` sozinho NÃO bloqueia — a API
// do Gitea devolve `enable_status_check: false` por default, e aí os contextos
// ficam anotados e o merge passa com o gate vermelho. Medido contra o Gitea
// 1.22: com os contextos e o booleano desligado, um PR com `Repo Guards=failure`
// mergeia (HTTP 200); com o booleano ligado, a recusa é
// `not allowed to merge [reason: Not all required status checks successful]`.
//
// Por isso a prova checa o booleano DUAS vezes: antes da matriz (o applier real
// ligou a exigência? se não, não há o que medir — `violated`) e depois da matriz
// (o `--check` do applier acusa o estado desligado?). Se alguém tirar o booleano
// do applier, a prova acusa na PRIMEIRA checagem; a última linha da matriz é a
// demonstração de POR QUE isso importa.
//
// O controle existe pelo mesmo motivo do resto da família: sem ele, um "recusado"
// poderia ser qualquer outra coisa (PR não mergeável, branch desatualizada, API
// fora) e a prova atribuiria ao gate um bloqueio que não é dele — por isso cada
// caso ESPERA a mergeability assentar antes de tentar (a primeira tentativa
// contra um PR recém-criado responde 405 "Please try again later", que não é o
// gate: é a forja calculando se o PR mergeia).
//
// O applier roda como PROCESSO (a CLI de verdade, com GITEA_URL/GITEA_TOKEN no
// ambiente), não como uma cópia da chamada: o caminho exercitado é o que o
// operador roda. Depois de aplicar, o `--check` do MESMO applier tem de
// reportar sincronia, e — com a exigência desligada — tem de reportar DRIFT. Um
// detector que não vê o modo silencioso não protege nada.
//
// E O REGISTRO É CONFERIDO, NÃO SÓ LIDO. Ligar `enable_status_check` não basta:
// o que a forja de fato EXIGE é a lista de `status_check_contexts`, e é ela que
// pode estar velha (um `name:` renomeado, ou um nome que carregava a contagem da
// matriz). A prova compara a lista registrada com a do manifesto — nome a nome,
// em `registrationDelta` — e reprova tanto o contexto a MENOS (o job roda e o
// merge passa) quanto o a MAIS (o PR trava para sempre esperando um check que
// nunca roda), bem como qualquer contexto com CONTAGEM no nome ("(24 node-pure
// mutation tests)": a string muda quando a matriz cresce, e a proteção passa a
// exigir um check inexistente). Antes desta metade a prova apenas IMPRIMIA o
// registro: uma aplicação que registrasse um subconjunto passava como verde.
//
// O que NÃO cobre: o act_runner (não há runner aqui: os status são postados pela
// API, que é o que o job faria), a forja de produção (o container é efêmero e
// local), nem o resto do branch protection (reviews, push restrito). O REGISTRO
// conferido aqui é o da seção `gitea` do manifesto: os contextos que só existem
// no GitHub (a matriz de mutation tests e o contrato coordenado são jobs de
// `pr-check.yml`) não têm como ser registrados por esta prova — quem os registra
// é a forja do GitHub, e ali o veredito é a aplicação de verdade.
//
// Onde roda: manual/operador (`bun run merge-gate:prove`), com docker — antes de
// confiar o merge à forja e em toda mudança do applier/manifesto.
// =============================================================================

import { spawnSync } from "node:child_process"
import { request as httpRequest } from "node:http"
import { createServer } from "node:net"
import { dirname, join } from "node:path"
import process from "node:process"
import { fileURLToPath, pathToFileURL } from "node:url"

import { defaultIo, loadManifest, resolveManifestContexts } from "./check-required-checks.mjs"

/** A raiz do repositório — este script mora em `scripts/`. */
export const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

/** O envio do applier que o ensaio exercita (a CLI de verdade). */
export const APPLIER = "scripts/apply-required-checks.mjs"

/** Um Gitea da mesma série que a forja roda (deploy/docker-compose.gitea.yml). */
export const DEFAULT_IMAGE = "gitea/gitea:1.22"
/**
 * O PREFIXO do container efêmero. O nome final ganha um sufixo aleatório
 * (`uniqueContainerName`) porque duas execuções concorrentes — ou uma que morreu
 * antes de limpar — colidiriam com `Conflict. The container name is already in
 * use`, e o ensaio mediria o container alheio em vez do seu.
 */
export const DEFAULT_NAME = "prova-merge-gate"
/**
 * A porta LOCAL preferida. O ensaio não depende dela: por default ele pega uma
 * porta livre (`freePort`), porque uma execução anterior que morreu antes de
 * limpar — ou outra que rode ao mesmo tempo — deixaria a porta ocupada e o
 * `docker run` falharia com `driver failed programming external connectivity`,
 * um erro que não tem nada a ver com o que a prova mede. `--port` força.
 */
export const DEFAULT_PORT = 3390

/** O usuário/repo criados DENTRO do container efêmero (nada a ver com a forja). */
export const OWNER = "prova"
export const REPO_NAME = "ensaio"

/** Exit codes — o contrato da CLI (a mesma escala da família). */
export const EXIT = { OK: 0, FAILED: 1, UNAVAILABLE: 2, USAGE: 3 }

const ADMIN_PASSWORD = "Prova!12345x"

/**
 * @typedef {{state: string, http: number|null, reason: string|null, detail: string}} MergeOutcome
 * @typedef {{id: string, expect: "merged"|"blocked", title: string, statuses: string, outcome: MergeOutcome|null, detail?: string}} GateCase
 * @typedef {{verdict: string, blockers: string[], detail: string}} GateVerdict
 * @typedef {{ok: boolean, missing: string[], extra: string[], withCount: {context: string, count: string}[]}} RegistrationDelta
 * @typedef {{verdict: string, blockers: string[], detail: string, image: string, name: string, port: number, repo: string|null, contexts: string[], cases: GateCase[], applier: object|null, enforcement: {enabled: boolean, contexts: string[]}|null, registration: RegistrationDelta|null}} GateResult
 */

// ═══════════════════════════════════════════════════════════════════════════
// 1. O plano do ensaio (puro)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * A matriz de casos. Cada um é um PR próprio, porque um merge consome o PR.
 *
 * `statuses` diz o que postar ANTES de tentar: `success`/`failure` é um mapa
 * contexto→estado aplicado ao PRIMEIRO contexto exigido (o ensaio não precisa de
 * todos os contextos por caso); `none` não posta nada; `all-success` fecha a
 * régua inteira.
 *
 * `prep` é o que muda a FORJA antes do caso — só a mutação usa: ela desliga
 * `enable_status_check` mantendo os contextos, que é exatamente o payload sem o
 * booleano. É o resultado dela que denuncia o modo silencioso.
 *
 * @param {string[]} contexts contextos exigidos, na ordem do manifesto
 * @returns {GateCase[]}
 */
export function casesPlan(contexts) {
  const first = contexts[0] ?? "Lint"
  return [
    {
      id: "controle-verde",
      title: "CONTROLE — todos os checks verdes",
      statuses: "all-success",
      prep: null,
      expect: "merged",
      outcome: null,
      detail: `fecha a régua inteira (${contexts.length} contexto(s)) antes de tentar`,
    },
    {
      id: "gate-vermelho",
      title: `GATE VERMELHO — '${first}' com failure`,
      statuses: `failure:${first}`,
      prep: null,
      expect: "blocked",
      outcome: null,
      detail: "é a linha que o usuário pede: um gate vermelho não pode mergear",
    },
    {
      id: "gate-ausente",
      title: "GATE AUSENTE — nenhum status postado",
      statuses: "none",
      prep: null,
      expect: "blocked",
      outcome: null,
      detail:
        "required check que nunca roda trava o PR — o modo que o manifesto existe para evitar",
    },
    {
      id: "exigencia-desligada",
      title: "EXIGÊNCIA DESLIGADA (mutação) — contextos anotados, enable_status_check=false",
      statuses: `failure:${first}`,
      prep: "disable-enforcement",
      expect: "merged",
      outcome: null,
      detail:
        "o mesmo gate vermelho, com o booleano desligado: se MERGEAR, o que bloqueava era o enable_status_check — " +
        "e é isso que o applier tem de enviar",
    },
  ]
}

/**
 * Lê o desfecho de uma tentativa de merge.
 *
 * `blocked` exige a RECUSA do gate, não qualquer 405: a forja responde 405
 * também quando ainda está calculando a mergeability ("Please try again later"),
 * e tratar isso como "o gate morde" daria um verde falso.
 *
 * @param {{status: number|null, body: string}} res
 * @returns {MergeOutcome}
 */
export function classifyMerge({ status, body }) {
  const text = String(body ?? "")
  if (status === 200) return { state: "merged", http: status, reason: null, detail: "merge aceito" }
  if (status === 405 || status === 409) {
    const reason = /reason:\s*([^\]]+)\]/i.exec(text)?.[1]?.trim() ?? null
    if (/not allowed to merge/i.test(text)) {
      return {
        state: "blocked",
        http: status,
        reason,
        detail: reason ? `recusado pelo gate: ${reason}` : "recusado pelo gate",
      }
    }
    return {
      state: "other",
      http: status,
      reason,
      detail: `recusa que NAO e do gate (mergeability/estado): ${text.slice(0, 160)}`,
    }
  }
  if (status === null)
    return { state: "unavailable", http: null, reason: null, detail: "a API nao respondeu" }
  return {
    state: "other",
    http: status,
    reason: null,
    detail: `HTTP ${status}: ${text.slice(0, 160)}`,
  }
}

/**
 * O veredito: cada caso tem de bater com o esperado, e nenhum pode ser
 * `unavailable`/`other` — um caso que não pôde ser medido não é um caso que
 * passou.
 *
 * @param {GateCase[]} cases
 * @returns {GateVerdict}
 */
export function summarizeMatrix(cases) {
  const blockers = []
  for (const c of cases) {
    const state = c.outcome?.state
    if (state === "unavailable" || state === "other" || !state) {
      blockers.push(`[${c.id}] NAO MEDIDO: ${c.outcome?.detail ?? "sem desfecho"}`)
      continue
    }
    if (state !== c.expect) {
      blockers.push(
        state === "merged"
          ? `[${c.id}] MERGEOU quando deveria ser recusado — o gate nao morde (${c.outcome.detail})`
          : `[${c.id}] RECUSOU quando deveria mergear — o bloqueio nao e do gate (${c.outcome.detail})`,
      )
    }
  }
  if (blockers.length > 0) {
    return { verdict: "violated", blockers, detail: "a matriz de merge nao bate com o contrato" }
  }
  return {
    verdict: "proven",
    blockers: [],
    detail:
      "verde mergeia; vermelho e ausente NAO mergeiam; e a exigencia desligada volta a mergear " +
      "(prova de que e o enable_status_check que bloqueia)",
  }
}

/**
 * A CONTAGEM dentro de um contexto de status, se houver: `(24 node-pure mutation
 * tests)`, `(5 cenários)`, `(40 guards)`.
 *
 * O número é DERIVADO — cresce quando a matriz cresce — e por isso não pode
 * morar no nome de um required check: o contexto exigido pela forja é uma
 * STRING, e uma string que muda sozinha deixa a proteção exigindo um check que
 * já não existe. O PR trava esperando para sempre, sem nenhuma linha de workflow
 * parecer errada.
 *
 * A forma procurada é um número seguido de uma PALAVRA dentro dos parênteses —
 * "24 node-pure mutation tests", "5 cenários", "40 guards" — e não um número
 * qualquer: `Bring-up Gate Proof (pré-requisito 0, por execução)` tem o "0" no
 * NOME do gate (seguido de vírgula, não de palavra) e não é contagem derivada.
 * A fronteira é essa e é explícita: um número colado a uma palavra seria
 * acusado mesmo que fosse editorial, e o remédio é visível no relatório (o
 * contexto vem nomeado) — o silêncio, não.
 *
 * @param {string} context
 * @returns {string|null}  o trecho com a contagem, ou null
 */
export function countInContext(context) {
  return /\([^()]*\d+\s+[^()]*\)/.exec(String(context ?? ""))?.[0] ?? null
}

/**
 * A régua do CONTEXTO REGISTRADO: a proteção da forja tem de exigir EXATAMENTE
 * os contextos que o manifesto declara.
 *
 * Nem um a menos (o job deixa de ser required e o merge passa com ele vermelho),
 * nem um a mais (a forja trava para sempre esperando um check que o workflow já
 * não tem), e nenhum deles com CONTAGEM no nome — pelo motivo que
 * `countInContext` explica.
 *
 * Os dois lados entram na varredura de contagem: o manifesto é quem MANDA o
 * número (se ele vier daí, o defeito é de origem) e o registro é quem o EXIBE (se
 * vier daí, a proteção está velha e o applier não a corrigiu).
 *
 * @param {{expected: string[], registered: string[]}} args
 * @returns {RegistrationDelta}
 */
export function registrationDelta({ expected, registered }) {
  const exp = new Set(expected ?? [])
  const reg = new Set(registered ?? [])
  const missing = (expected ?? []).filter((c) => !reg.has(c))
  const extra = (registered ?? []).filter((c) => !exp.has(c))
  const withCount = [...new Set([...(registered ?? []), ...(expected ?? [])])]
    .map((context) => ({ context, count: countInContext(context) }))
    .filter((e) => e.count !== null)
  return {
    ok: missing.length === 0 && extra.length === 0 && withCount.length === 0,
    missing,
    extra,
    withCount,
  }
}

/** O resultado com o MESMO formato em todo desfecho (o `--json` não muda de shape). */
export function gateResult(partial = {}) {
  return {
    verdict: "unavailable",
    blockers: [],
    detail: "",
    image: DEFAULT_IMAGE,
    name: DEFAULT_NAME,
    port: DEFAULT_PORT,
    repo: null,
    contexts: [],
    cases: [],
    applier: null,
    enforcement: null,
    registration: null,
    ...partial,
  }
}

/**
 * Uma porta livre em 127.0.0.1, pedida ao SO (porta 0) e devolvida depois de
 * fechar o socket. Existe a janela entre fechar e o `docker run` abrir — na
 * prática ela é de milissegundos e o custo do pior caso é uma mensagem de erro
 * clara, não uma medida errada.
 *
 * @returns {Promise<number>}
 */
export function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.on("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      const port = typeof address === "object" && address ? address.port : DEFAULT_PORT
      server.close(() => resolve(port))
    })
  })
}

/**
 * O nome do container desta execução: prefixo estável + 4 hex. `rand` é
 * injetável porque o nome entra na asserção do teste.
 *
 * @param {() => number} [rand]
 * @returns {string}
 */
export function uniqueContainerName(rand = Math.random) {
  return `${DEFAULT_NAME}-${Math.floor(rand() * 0xffff)
    .toString(16)
    .padStart(4, "0")}`
}

/** O exit code do veredito. */
export function exitCodeFor(verdict) {
  if (verdict === "proven") return EXIT.OK
  if (verdict === "violated") return EXIT.FAILED
  return EXIT.UNAVAILABLE
}

/**
 * Os argumentos do container efêmero.
 *
 * `OFFLINE_MODE` e `DISABLE_REGISTRATION` não são detalhe: sem eles a instância
 * tenta alcançar a internet no primeiro boot (e o ensaio depende de rede que não
 * é dele) e aceita cadastro de estranhos na porta local.
 *
 * @param {{name: string, port: number, image: string}} args
 * @returns {string[]}
 */
export function containerArgs({ name, port, image }) {
  return [
    "run",
    "-d",
    "--name",
    name,
    "-p",
    `127.0.0.1:${port}:3000`,
    "-e",
    "GITEA__database__DB_TYPE=sqlite3",
    "-e",
    "GITEA__security__INSTALL_LOCK=true",
    "-e",
    "GITEA__service__DISABLE_REGISTRATION=true",
    "-e",
    `GITEA__server__ROOT_URL=http://127.0.0.1:${port}/`,
    "-e",
    "GITEA__security__SECRET_KEY=prova-merge-gate-chave-do-ensaio",
    "-e",
    "GITEA__server__OFFLINE_MODE=true",
    image,
  ]
}

/**
 * O token que o CLI do Gitea imprime ("Access token was successfully created:
 * <40 hex>"). Extraído por regex porque a frase muda entre versões e o token é a
 * parte estável.
 *
 * @param {string} stdout
 * @returns {string|null}
 */
export function parseAccessToken(stdout) {
  return /[a-f0-9]{40}/.exec(String(stdout ?? ""))?.[0] ?? null
}

export const USAGE = `prove-gitea-merge-gate — prova que um gate vermelho NAO mergeia numa forja de verdade

  node scripts/prove-gitea-merge-gate.mjs [opções]

  --json          imprime o resultado em JSON (mesmo shape em todo desfecho)
  --keep          nao remove o container efêmero no fim (para inspecao)
  --port <n>      porta local da API (default: uma porta livre, escolhida pelo SO)
  --name <nome>   nome do container (default: ${DEFAULT_NAME}-<sufixo aleatorio>)
  --image <ref>   imagem do Gitea (default: ${DEFAULT_IMAGE})
  --timeout <s>   espera da API subir (default: 90)
  -h, --help      esta ajuda

Exit codes: 0 provado · 1 violado · 2 indeterminado · 3 uso inválido`

/**
 * O uso dos argumentos — puro, para o teste exercitar o contrato da CLI.
 *
 * @param {string[]} argv
 * @returns {{error?: string, help?: boolean, json?: boolean, keep?: boolean, port?: number, name?: string, image?: string, timeoutS?: number}}
 */
export function parseArgs(argv) {
  const opts = {
    json: false,
    keep: false,
    help: false,
    port: null,
    name: null,
    image: DEFAULT_IMAGE,
    timeoutS: 90,
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--json") opts.json = true
    else if (arg === "--keep") opts.keep = true
    else if (arg === "-h" || arg === "--help") opts.help = true
    else if (arg === "--port" || arg === "--timeout") {
      const value = Number(argv[++i])
      if (!Number.isInteger(value) || value <= 0) return { error: `${arg} invalido` }
      if (arg === "--port") opts.port = value
      else opts.timeoutS = value
    } else if (arg === "--name" || arg === "--image") {
      const value = argv[++i]
      if (!value) return { error: `${arg} exige um valor` }
      if (arg === "--name") opts.name = value
      else opts.image = value
    } else if (arg.startsWith("-")) return { error: `flag desconhecida: ${arg}` }
    else return { error: `argumento inesperado: ${arg}` }
  }
  return opts
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. O motor (docker + API + o applier de verdade)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Uma requisição JSON à API, por `node:http` — e NÃO por `fetch`, por um motivo
 * medido: contra uma porta recém-publicada pelo `docker run -p`, o daemon aceita
 * a conexão (é o proxy dele) antes de o Gitea escutar, e o `fetch` fica pendurado
 * SEM manter handle referenciado — o event loop esvazia e o processo morre com
 * "top-level await não resolvido" (exit 13) ANTES de medir qualquer coisa. Com o
 * `node:http` o socket é um handle vivo e o `setTimeout` do próprio request dá o
 * teto. Erro de transporte vira `status: null` (com a mensagem em `text`) para os
 * chamadores decidirem, em vez de rejeitar no meio do ensaio.
 *
 * @param {{port: number, method: string, path: string, body?: object|null, token?: string|null, timeoutMs?: number}} args
 * @returns {Promise<{status: number|null, data: any, text: string}>}
 */
export function httpJson({ port, method, path, body = null, token = null, timeoutMs = 15_000 }) {
  return new Promise((resolve) => {
    const payload = body ? JSON.stringify(body) : null
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port,
        method,
        path: `/api/v1${path}`,
        headers: {
          ...(token ? { Authorization: `token ${token}` } : {}),
          ...(payload
            ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) }
            : {}),
        },
      },
      (res) => {
        let text = ""
        res.setEncoding("utf8")
        res.on("data", (chunk) => (text += chunk))
        res.on("end", () => {
          let data = null
          try {
            data = text ? JSON.parse(text) : null
          } catch {
            data = null
          }
          resolve({ status: res.statusCode ?? 0, data, text })
        })
      },
    )
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`timeout de ${timeoutMs}ms na API`)))
    req.on("error", (error) =>
      resolve({ status: null, data: null, text: String(error?.message ?? error) }),
    )
    if (payload) req.write(payload)
    req.end()
  })
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * A prova inteira. Sempre devolve `gateResult` — nenhum caminho devolve
 * `undefined`.
 *
 * @param {{cwd?: string, image?: string, name?: string|null, port?: number|null, keep?: boolean, timeoutS?: number, docker?: string, run?: Function, request?: Function, spawn?: Function, sleepMs?: Function}} [options]
 * @returns {Promise<GateResult>}
 */
export async function proveGiteaMergeGate({
  cwd = REPO_ROOT,
  image = DEFAULT_IMAGE,
  name = null,
  port = null,
  keep = false,
  timeoutS = 90,
  docker = "docker",
  run = spawnSync,
  request = httpJson,
  spawn = spawnSync,
  sleepMs = sleep,
} = {}) {
  const repo = `${OWNER}/${REPO_NAME}`
  const container = name ?? uniqueContainerName()
  const resolvedPort = port ?? (await freePort())
  const base = `http://127.0.0.1:${resolvedPort}`
  const result = gateResult({ image, name: container, port: resolvedPort, repo })

  // ── O manifesto é a fonte dos contextos (não uma lista paralela) ────────
  const manifest = loadManifest(cwd, defaultIo(cwd))
  const resolved = resolveManifestContexts(manifest, defaultIo(cwd))
  const contexts = (resolved.gitea?.contexts ?? []).map((c) => c.context)
  result.contexts = contexts
  if (contexts.length === 0) {
    return gateResult({ ...result, detail: "o manifesto nao resolve contexto nenhum para o gitea" })
  }

  // ── Sobe o container efêmero ────────────────────────────────────────────
  const started = run(docker, containerArgs({ name: container, port: resolvedPort, image }), {
    encoding: "utf8",
    timeout: 120_000,
  })
  if (started?.error) {
    return gateResult({
      ...result,
      detail: `o docker nao rodou o container: ${started.error.message}`,
    })
  }
  if (started.status !== 0) {
    return gateResult({
      ...result,
      detail: `o container nao subiu (exit ${started.status}): ${String(started.stderr ?? "")
        .trim()
        .slice(0, 200)}`,
    })
  }

  // A camada HTTP é injetável (`request`), e o default é `httpJson` — nunca
  // `fetch`: ver o cabeçalho de `httpJson` para o motivo medido (handle não
  // referenciado enquanto a porta recém-publicada aceita sem responder).
  const requestTimeoutMs = 15_000
  const api = (method, path, body, token = null) =>
    request({
      port: resolvedPort,
      method,
      path,
      body: body ?? null,
      token,
      timeoutMs: requestTimeoutMs,
    })

  try {
    // ── Espera a API ──────────────────────────────────────────────────────
    let version = null
    for (let i = 0; i < Math.max(1, Math.round(timeoutS / 2)); i++) {
      try {
        const probe = await api("GET", "/version")
        if (probe.status === 200 && probe.data?.version) {
          version = probe.data.version
          break
        }
      } catch {
        // ainda subindo
      }
      await sleepMs(2000)
    }
    if (!version) {
      return gateResult({
        ...result,
        detail: `a API do Gitea nao subiu em ${timeoutS}s em ${base} (docker logs ${container})`,
      })
    }

    // ── Usuário admin + token, pelo CLI da própria instância ──────────────
    spawn(
      docker,
      [
        "exec",
        "-u",
        "git",
        container,
        "gitea",
        "admin",
        "user",
        "create",
        "--username",
        OWNER,
        "--password",
        ADMIN_PASSWORD,
        "--email",
        `${OWNER}@local.test`,
        "--admin",
        "--must-change-password=false",
      ],
      { encoding: "utf8", timeout: 120_000 },
    )
    const tokenRun = spawn(
      docker,
      [
        "exec",
        "-u",
        "git",
        container,
        "gitea",
        "admin",
        "user",
        "generate-access-token",
        "--username",
        OWNER,
        "--token-name",
        "ensaio",
        "--scopes",
        "all",
      ],
      { encoding: "utf8", timeout: 120_000 },
    )
    const token = parseAccessToken(`${tokenRun?.stdout ?? ""}${tokenRun?.stderr ?? ""}`)
    if (!token) {
      return gateResult({
        ...result,
        detail: "nao consegui gerar o token de acesso da instancia efemera",
      })
    }

    // ── Repositório com um commit inicial ─────────────────────────────────
    const created = await api(
      "POST",
      "/user/repos",
      { name: REPO_NAME, auto_init: true, default_branch: "main" },
      token,
    )
    if (created.status !== 201) {
      return gateResult({
        ...result,
        detail: `nao criei o repo (HTTP ${created.status}): ${created.text.slice(0, 200)}`,
      })
    }

    // ── Aplica o manifesto com o APLIADOR DE VERDADE ──────────────────────
    const applierEnv = {
      ...process.env,
      GITEA_URL: base,
      GITEA_TOKEN: token,
      GITEA_REPOSITORY: repo,
    }
    const applied = spawn(
      process.execPath,
      [join(cwd, APPLIER), "--forge", "gitea", "--apply", "--repo", repo],
      { cwd, env: applierEnv, encoding: "utf8", timeout: 120_000 },
    )
    result.applier = {
      applied: applied?.status === 0,
      output: `${applied?.stdout ?? ""}${applied?.stderr ?? ""}`.trim().slice(-400),
    }

    const protection = await api("GET", `/repos/${repo}/branch_protections`, null, token)
    const mainProtection = (Array.isArray(protection.data) ? protection.data : []).find(
      (p) => p.branch_name === "main",
    )
    const enforced = mainProtection?.enable_status_check === true
    const configured = mainProtection?.status_check_contexts ?? []
    result.enforcement = { enabled: enforced, contexts: configured }
    // A proteção existe mas NÃO exige: isto é VIOLAÇÃO, não indeterminação —
    // dá para ler o estado e ele está errado. Reportar `unavailable` aqui faria
    // a regressão do applier parecer "não deu para medir", que é o oposto do
    // que ela é: medida e reprovada.
    if (!enforced) {
      return gateResult({
        ...result,
        verdict: "violated",
        blockers: [
          "[applier] o branch protection NAO esta exigindo os status (`enable_status_check` ausente/false): " +
            "os contextos ficam anotados e o merge passa com o gate vermelho — medido contra Gitea 1.22",
        ],
        detail: `o applier aplicou ${configured.length} contexto(s) sem ligar a exigencia`,
      })
    }

    // ── A proteção REGISTRA o manifesto? ──────────────────────────────────
    // Ligar a exigência não basta: o que a forja EXIGE é a LISTA de contextos, e
    // ela pode estar anotada com nomes que já não existem (um `name:` renomeado,
    // ou um nome que carregava a contagem da matriz). Era a metade que esta
    // prova apenas LIA e reportava: um registro a menos ou um registro velho
    // passava como verde. Aqui ele é comparado com o manifesto, nome a nome.
    const registration = registrationDelta({ expected: contexts, registered: configured })
    result.registration = registration
    if (!registration.ok) {
      const blockers = []
      if (registration.missing.length > 0) {
        blockers.push(
          `[applier] a protecao NAO registrou ${registration.missing.length} contexto(s) do manifesto ` +
            `(o job roda e o merge passa): ${registration.missing.map((c) => `'${c}'`).join(", ")}`,
        )
      }
      if (registration.extra.length > 0) {
        blockers.push(
          `[applier] a protecao exige ${registration.extra.length} contexto(s) que o manifesto NAO declara ` +
            `(o PR trava esperando um check que nunca roda): ${registration.extra.map((c) => `'${c}'`).join(", ")}`,
        )
      }
      if (registration.withCount.length > 0) {
        blockers.push(
          "[applier] um contexto de status carrega CONTAGEM — o nome muda quando a matriz cresce e a " +
            `protecao passa a exigir um check que ja nao existe: ${registration.withCount
              .map((e) => `'${e.context}' (${e.count})`)
              .join(", ")}`,
        )
      }
      return gateResult({
        ...result,
        verdict: "violated",
        blockers,
        detail:
          `o applier aplicou a exigencia (enable_status_check=true), mas o registro nao bate com o manifesto ` +
          `(registrado: ${configured.length}, exigido: ${contexts.length})`,
      })
    }

    // Logo apos aplicar (com a exigencia LIGADA), o `--check` do mesmo applier
    // tem de reportar sincronia — senao o simples aplicar+verificar acusa drift.
    const inSync = spawn(
      process.execPath,
      [join(cwd, APPLIER), "--forge", "gitea", "--check", "--repo", repo],
      { cwd, env: applierEnv, encoding: "utf8", timeout: 120_000 },
    )
    result.applier.checkInSync = inSync?.status === 0

    // ── A matriz ──────────────────────────────────────────────────────────
    const cases = casesPlan(contexts)
    result.cases = cases
    for (const [index, testCase] of cases.entries()) {
      // A mutação prepara a FORJA antes do próprio caso: desliga a exigência
      // mantendo os contextos — é o payload SEM o booleano.
      if (testCase.prep === "disable-enforcement") {
        await api(
          "PATCH",
          `/repos/${repo}/branch_protections/main`,
          { status_check_contexts: contexts, enable_status_check: false },
          token,
        )
      }
      const branch = `prova/caso-${index + 1}`
      const started2 = await api(
        "POST",
        `/repos/${repo}/branches`,
        { new_branch_name: branch, old_branch_name: "main" },
        token,
      )
      if (started2.status !== 201 && started2.status !== 409) {
        testCase.outcome = {
          state: "unavailable",
          http: started2.status,
          reason: null,
          detail: "nao criei a branch",
        }
        continue
      }
      await api(
        "POST",
        `/repos/${repo}/contents/caso${index + 1}.txt`,
        {
          content: Buffer.from(`${testCase.id}\n`).toString("base64"),
          message: testCase.id,
          branch,
        },
        token,
      )
      const pr = await api(
        "POST",
        `/repos/${repo}/pulls`,
        { title: testCase.title, head: branch, base: "main" },
        token,
      )
      if (pr.status !== 201 || !pr.data?.number) {
        testCase.outcome = {
          state: "unavailable",
          http: pr.status,
          reason: null,
          detail: `nao criei o PR: ${pr.text.slice(0, 140)}`,
        }
        continue
      }
      const number = pr.data.number
      const sha = pr.data.head?.sha

      // A mergeability é calculada em background: tentar antes disso devolve 405
      // "Please try again later", que NAO e o gate. Esperar é o que permite
      // atribuir a recusa ao check.
      let mergeable = false
      for (let i = 0; i < 30; i++) {
        const view = await api("GET", `/repos/${repo}/pulls/${number}`, null, token)
        if (view.data?.mergeable === true) {
          mergeable = true
          break
        }
        await sleepMs(1000)
      }
      if (!mergeable) {
        testCase.outcome = {
          state: "unavailable",
          http: null,
          reason: null,
          detail: "a mergeability nao assentou — sem isso a recusa nao e atribuivel ao gate",
        }
        continue
      }

      // Os status: a régua inteira, ou só o primeiro contexto, ou nada.
      if (testCase.statuses === "all-success" || testCase.statuses.startsWith("failure:")) {
        const [state, only] = testCase.statuses.startsWith("failure:")
          ? ["failure", testCase.statuses.split(":")[1]]
          : ["success", null]
        for (const context of only ? [only] : contexts) {
          await api(
            "POST",
            `/repos/${repo}/statuses/${sha}`,
            {
              state: state === "failure" ? "failure" : "success",
              context,
              description: testCase.id,
            },
            token,
          )
        }
      }

      testCase.sha = sha
      // A tentativa é REPETIDA até sair um desfecho definitivo: postar status
      // invalida o cálculo de mergeability, e a forja responde 405 "Please try
      // again later" enquanto recalcula — uma recusa que NÃO é do gate. Tratar a
      // primeira resposta como veredito daria um vermelho falso (no caso que
      // deve mergear) E um verde falso (num caso que deve ser barrado).
      let outcome = null
      for (let attempt = 0; attempt < 5; attempt++) {
        const merged = await api(
          "POST",
          `/repos/${repo}/pulls/${number}/merge`,
          { Do: "merge" },
          token,
        )
        outcome = classifyMerge({ status: merged.status, body: merged.text })
        if (outcome.state !== "other") break
        await sleepMs(2500)
      }
      testCase.outcome = outcome
    }

    // ── O detector vê o modo silencioso? ──────────────────────────────────
    // A exigência ficou DESLIGADA pelo último caso (a mutação), com os contextos
    // anotados: o `--check` tem de acusar. Um detector que não vê este estado
    // não protege nada — é ele que impede a regressão de voltar em silêncio.
    const drifted = spawn(
      process.execPath,
      [join(cwd, APPLIER), "--forge", "gitea", "--check", "--repo", repo],
      { cwd, env: applierEnv, encoding: "utf8", timeout: 120_000 },
    )
    const driftedOutput = `${drifted?.stdout ?? ""}${drifted?.stderr ?? ""}`
    result.applier.checkSeesDisabled =
      drifted?.status === 1 && /enable_status_check/.test(driftedOutput)

    const verdict = summarizeMatrix(cases)
    const blockers = [...verdict.blockers]
    if (!result.applier.applied)
      blockers.push("[applier] o applier real terminou != 0 — nao aplicou o manifesto")
    if (result.applier.checkInSync !== true) {
      blockers.push(
        "[applier] o --check nao reportou sincronia logo apos aplicar (a aplicacao nao e idempotente)",
      )
    }
    if (result.applier.checkSeesDisabled !== true) {
      blockers.push(
        "[applier] com `enable_status_check=false` o --check NAO acusou drift: o modo silencioso passa pelo detector",
      )
    }
    return gateResult({
      ...result,
      verdict: blockers.length > 0 ? "violated" : "proven",
      blockers,
      detail:
        blockers.length > 0
          ? "a matriz de merge ou o detector do applier nao fecharam"
          : verdict.detail,
    })
  } finally {
    if (!keep) {
      const removed = run(docker, ["rm", "-f", container], { encoding: "utf8", timeout: 120_000 })
      if (removed?.status !== 0) {
        console.error(
          `prove-gitea-merge-gate: o container '${container}' NAO foi removido — remova à mão ` +
            `(\`docker rm -f ${container}\`)`,
        )
      }
    }
  }
}

/** O relatório humano — uma linha por caso, com o HTTP e o motivo. */
export function renderReport(result, { emit = console.log } = {}) {
  const line = (s = "") => emit(s)
  // O resumo do REGISTRO em uma linha: o que falta, o que sobra e a contagem.
  const registrarResumo = (d) =>
    [
      d.missing.length > 0 ? `faltam ${d.missing.length}` : null,
      d.extra.length > 0 ? `sobram ${d.extra.length}` : null,
      d.withCount.length > 0 ? `com contagem ${d.withCount.length}` : null,
    ]
      .filter(Boolean)
      .join(", ")
  line()
  line(`prove-gitea-merge-gate — o merge bloqueia mesmo? (${result.image})`)
  line(`  instancia: ${result.name} em 127.0.0.1:${result.port} (efemera)`)
  line(`  repo     : ${result.repo}`)
  line(`  contexto : ${result.contexts.join(", ")}`)
  line(`  exigencia: ${result.enforcement?.enabled ? "enable_status_check=true" : "<nao lida>"}`)
  line(
    `  registro : ${result.registration === null ? "<nao lido>" : result.registration.ok ? `${result.contexts.length}/${result.contexts.length} contextos registrados, sem contagem` : registrarResumo(result.registration)}`,
  )
  line()
  for (const c of result.cases) {
    const expected = c.expect === "merged" ? "mergeia" : "NAO mergeia"
    const got = c.outcome?.state ?? "?"
    const ok = got === c.expect ? "✅" : "❌"
    line(
      `  ${ok} ${c.id.padEnd(22)} esperado: ${expected.padEnd(11)} obtido: ${got} (HTTP ${c.outcome?.http ?? "-"})`,
    )
    if (c.outcome?.reason) line(`       motivo: ${c.outcome.reason}`)
    if (c.outcome?.state === "other" || c.outcome?.state === "unavailable") {
      line(`       ${c.outcome.detail}`)
    }
  }
  line()
  line(
    `  applier  : aplicou=${result.applier?.applied} · --check em sincronia=${result.applier?.checkInSync} · --check ve exigencia desligada=${result.applier?.checkSeesDisabled}`,
  )
  line()
  line(
    `  ${result.verdict === "proven" ? "✅" : result.verdict === "violated" ? "❌" : "·"} ${result.verdict.toUpperCase()}: ${result.detail}`,
  )
  for (const b of result.blockers) line(`     - ${b}`)
  line()
  line(
    `  NAO cobre: o act_runner (aqui os status sao postados pela API), a forja de producao e o resto do branch protection.`,
  )
  line()
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.error) {
    console.error(`prove-gitea-merge-gate: ${opts.error}`)
    console.error(USAGE)
    process.exit(EXIT.USAGE)
  }
  if (opts.help) {
    console.log(USAGE)
    process.exit(EXIT.OK)
  }

  const result = await proveGiteaMergeGate(opts)
  if (opts.json) {
    console.log(JSON.stringify({ ...result, exitCode: exitCodeFor(result.verdict) }, null, 2))
  } else {
    renderReport(result)
  }
  process.exit(exitCodeFor(result.verdict))
}

const IS_DIRECT_RUN =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (IS_DIRECT_RUN) await main()
