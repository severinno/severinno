#!/usr/bin/env node

// =============================================================================
// issue-publish.mjs
//
// A MECÂNICA COMPARTILHADA de publicar ISSUE ACIONÁVEL numa forja: o marcador
// invisível que carrega a assinatura do problema, a DECISÃO de dedup (já
// reportado? comentar na aberta? criar?) e os BACKENDS (CLI `gh` no GitHub, API
// de issues no Gitea).
//
// POR QUE EXISTE: o repositório tem três publicadores de issue
// (`required-checks-drift-issue.mjs`, `actrc-sync-issue.mjs` e
// `forge-doctor-issue.mjs`). A prosa de cada issue é de cada script — o que NÃO
// pode divergir é a REGRA e o FIO: um publicador que casa o marcador errado
// engole o alerta, e um que decide errado abre duplicata toda semana. Um cron
// que vira ruído é desligado, e aí a dívida volta a ser invisível. Aqui é a
// única cópia dessa regra e desses dois backends.
//
// QUEM É O QUE: cada chamador é dono do LABEL, da COR, do TÍTULO, do CORPO e da
// ASSINATURA (o problema é dele). Aqui mora só como se publica.
//
// OS DOIS LADOS DA DÍVIDA: publicar sem FECHAR deixa uma issue ABERTA depois de
// resolvida — uma dívida que mente. Quem abre o board acha que o problema
// existe, e um alerta que o procedimento documentado não limpa acaba ignorado.
// Por isso a mecânica compartilhada inclui `reconcileDebt`: comenta a PROVA e
// fecha as issues que ESTE publicador abriu (identificadas pelo marcador, nunca
// pelo label — fechar ticket alheio por causa de uma etiqueta é pior que deixar
// a dívida aberta). Quem só publicava passa a fechar pelo mesmo caminho, em vez
// de cada script reinventar o ciclo (e divergir no dia em que o formato do
// marcador mudar).
//
// Usage:
//   import { decidePublication, markerOf, makeGithubBackend } from "./issue-publish.mjs"
//   await reconcileDebt({ backend, isOurs, resolutionBody })
//   await listIssuesByLabel({ forge: "gitea", label: "required-checks-drift" })
//   await runDebtPublisher({ publisher, input, backend })   // o ciclo inteiro
//
// O CONTRATO (abaixo, no fim do arquivo) é a porta de entrada de um publicador:
// ele declara etiqueta, marcador, título, assinatura, corpo, escopo e fechamento
// via `defineDebtPublisher` — e o ciclo passa a ser um só para todos.
//
// Exit codes:
//   (módulo — não possui CLI próprio; as chamadas de rede são dos backends, e
//    elas lançam em erro em vez de sair: quem decide o exit code é o publicador)
// =============================================================================

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { spawnSync } from "node:child_process"
import process from "node:process"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const REPO_ROOT = join(__dirname, "..")

// ---------------------------------------------------------------------------
// Fechamentos silenciosos (stale closures)
// ---------------------------------------------------------------------------

/**
 * Arquivo que registra fechamentos que não pegaram (o backend respondeu
 * sucesso mas a issue continua aberta). O doctor lê este arquivo para
 * surfacear fechamentos silenciosos no relatório de prontidão.
 */
const STALE_CLOSURES_FILE = join(REPO_ROOT, ".forge-doctor", "stale-closures.json")

/**
 * Registra fechamentos silenciosos (issues que deveriam ter sido fechadas
 * mas ainda estão abertas). Cada entrada tem { publisher, issueNumber,
 * detectedAt }.
 */
export function recordStaleClosures(publisher, staleNumbers) {
  if (staleNumbers.length === 0) return
  const dir = dirname(STALE_CLOSURES_FILE)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  let existing = []
  try {
    existing = JSON.parse(readFileSync(STALE_CLOSURES_FILE, "utf8"))
  } catch {
    // arquivo não existe ou inválido — começa vazio
  }

  const now = new Date().toISOString()
  for (const num of staleNumbers) {
    // Atualiza ou adiciona
    const idx = existing.findIndex((e) => e.publisher === publisher && e.issueNumber === num)
    if (idx >= 0) {
      existing[idx].detectedAt = now
      existing[idx].count = (existing[idx].count ?? 1) + 1
    } else {
      existing.push({ publisher, issueNumber: num, detectedAt: now, count: 1 })
    }
  }

  writeFileSync(STALE_CLOSURES_FILE, JSON.stringify(existing, null, 2), "utf8")
}

/**
 * Remove fechamentos silenciosos que já foram resolvidos (issue não está
 * mais aberta). Chamado pelo doctor depois de ler o arquivo.
 */
export function clearStaleClosure(publisher, issueNumber) {
  let existing = []
  try {
    existing = JSON.parse(readFileSync(STALE_CLOSURES_FILE, "utf8"))
  } catch {
    return
  }
  const filtered = existing.filter(
    (e) => !(e.publisher === publisher && e.issueNumber === issueNumber),
  )
  if (filtered.length === 0) {
    try {
      unlinkSync(STALE_CLOSURES_FILE)
    } catch {
      // arquivo já removido
    }
  } else {
    writeFileSync(STALE_CLOSURES_FILE, JSON.stringify(filtered, null, 2), "utf8")
  }
}

/**
 * Lê os fechamentos silenciosos registrados. Usado pelo doctor para
 * surfacear no relatório de prontidão.
 */
export function readStaleClosures() {
  try {
    return JSON.parse(readFileSync(STALE_CLOSURES_FILE, "utf8"))
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// Marcador e decisão (puros — sem rede, sem gh)
// ---------------------------------------------------------------------------

/**
 * Marcador HTML invisível que carrega a assinatura dentro do corpo da issue.
 *
 * A assinatura pode ter quebras de linha; o marcador é uma LINHA só (base64),
 * para sobreviver ao corpo em markdown sem quebrar o HTML.
 *
 * @param {string} markerId   identificador do publicador (ex.: "forge-doctor-verdict")
 * @param {string} signature  assinatura estável do problema
 */
export function markerOf(markerId, signature) {
  return `<!-- ${markerId}:${Buffer.from(signature).toString("base64")} -->`
}

/** `true` se `body` já carrega o marcador desta assinatura. */
export function hasMarker(body, markerId, signature) {
  return typeof body === "string" && body.includes(markerOf(markerId, signature))
}

/** Prefixo de QUALQUER marcador deste publicador (a assinatura vem depois dos `:`). */
export function markerPrefix(markerId) {
  return `<!-- ${markerId}:`
}

/**
 * A DECISÃO do dedup, pura e sem rede — é o que o teste consegue exercitar sem
 * servidor: dado o que está ABERTO hoje, o que fazer com o problema de agora.
 *
 * A ORDEM IMPORTA, e é o contrato: primeiro a ASSINATURA (o mesmo problema não
 * repete — o cron semanal não vira ruído) e só então o TÍTULO (um problema NOVO
 * comenta na issue já aberta em vez de abrir uma segunda). Invertida, um problema
 * diferente viraria comentário numa issue que quem a abriu já leu e deu por
 * resolvida — e o alerta novo se perderia ali dentro.
 *
 * @param {object} params
 * @param {{number: number, title: string, body: string}[]} params.existing  issues ABERTAS com o label
 * @param {string} params.title       título estável do publicador
 * @param {string} params.signature   assinatura do problema de agora
 * @param {string} params.markerId    identificador do publicador
 * @returns {{action: "already-reported"|"comment"|"create", issue?: object}}
 */
export function decidePublication({ existing, title, signature, markerId }) {
  // `issueHasSignature` (corpo E comentários), não `hasMarker(issue.body)`:
  // um drift/veredito que MUDOU vira COMENTÁRIO, e o marcador da run anterior
  // mora lá. Olhando só o corpo, a run seguinte não reconheceria a assinatura e
  // comentaria DE NOVO a cada semana — o ruído que o dedup existe para impedir.
  const already = existing.find((issue) => issueHasSignature(issue, markerId, signature))
  if (already) return { action: "already-reported", issue: already }
  const sameTitle = existing.find((issue) => issue.title === title)
  if (sameTitle) return { action: "comment", issue: sameTitle }
  return { action: "create" }
}

/**
 * Os corpos que uma issue carrega: o principal MAIS os comentários.
 *
 * POR QUE OS COMENTÁRIOS CONTAM: o marcador de um problema que MUDOU não vive
 * só no corpo — o comentário da run anterior o carrega. Comparar a assinatura
 * apenas com o corpo faz a run seguinte comentar de novo e torna uma issue
 * NOSSA invisível para o fechamento automático (ela seria tratada como alheia).
 *
 * @param {{body?: string, comments?: {body?: string}[]}|undefined} issue
 * @returns {unknown[]}
 */
export function issueBodies(issue) {
  return [issue?.body, ...((issue?.comments ?? []).map((c) => c?.body) ?? [])]
}

/** Prefixo de QUALQUER marcador deste publicador (a assinatura vem depois dos `:`). */
export function markerPrefixOf(markerId) {
  return `<!-- ${markerId}:`
}

/**
 * `true` se `body` foi escrito por ESTE publicador (carrega um marcador dele, de
 * qualquer assinatura).
 *
 * POR QUE NÃO BASTA O LABEL: label é etiqueta de triagem — alguém pode aplicá-lo
 * numa issue que não é deste publicador, e fechar ticket alheio por causa de uma
 * etiqueta é pior que deixar a dívida aberta. O marcador é a assinatura de quem
 * escreveu.
 *
 * @param {unknown} body
 */
export function hasAnyMarker(body, markerId) {
  return typeof body === "string" && body.includes(markerPrefixOf(markerId))
}

/** `true` se a issue já carrega ESTA assinatura (no corpo ou num comentário). */
export function issueHasSignature(issue, markerId, signature) {
  return issueBodies(issue).some((body) => hasMarker(body, markerId, signature))
}

/** `true` se a issue foi escrita por ESTE publicador (marcador em qualquer corpo). */
export function issueHasAnyMarker(issue, markerId) {
  return issueBodies(issue).some((body) => hasAnyMarker(body, markerId))
}

// ---------------------------------------------------------------------------
// Backend: GitHub (CLI `gh`)
// ---------------------------------------------------------------------------

function gh(args, { input } = {}) {
  return spawnSync("gh", args, { encoding: "utf8", input, env: process.env })
}

/**
 * Backend de issues do GitHub, via a CLI `gh`.
 *
 * O `gh` é INJETÁVEL (`gh` no parâmetro) para os testes exercitarem o ciclo
 * inteiro — criar na run 1 e deduplicar na run 2 — sem tocar a rede.
 *
 * @param {{gh?: Function, label: string, color: string, description: string}} params
 */
export function makeGithubBackend(
  { gh: ghCli = gh, label, color, description } = /** @type {any} */ ({}),
) {
  return {
    name: "github",
    label,
    ensureLabel() {
      // `--force` torna a criação idempotente (não falha se já existir).
      ghCli(["label", "create", label, "--force", "--color", color, "--description", description])
    },
    openIssues() {
      const res = ghCli([
        "issue",
        "list",
        "--label",
        label,
        "--state",
        "open",
        "--limit",
        "100",
        "--json",
        // `comments` ENTRA: além do marcador, é onde mora o marcador de um
        // problema que mudou — e é o que o fechamento automático precisa ver.
        // `createdAt` entra pelo mesmo motivo: "aberta há N dias" é o que separa
        // uma dívida ATIVA de uma ESQUECIDA, e sem a data quem lê o board não
        // tem como saber qual das duas está olhando.
        "number,title,body,comments,createdAt",
      ])
      if (res.status !== 0) {
        // `status` nulo com stderr vazio significa que o `gh` NEM EXECUTOU (não
        // está no PATH). Dizer só `exit null` manda o operador procurar um erro
        // do GitHub que não existe — a causa é local.
        const why = res.error?.message
          ? ` (${res.error.message})`
          : `: ${(res.stderr ?? "").slice(0, 400)}`
        throw new Error(`gh issue list falhou (exit ${res.status})${why}`)
      }
      const parsed = JSON.parse(res.stdout || "[]")
      return (Array.isArray(parsed) ? parsed : []).map((issue) => ({
        number: issue.number,
        title: issue.title,
        body: issue.body ?? "",
        comments: issue.comments ?? [],
        createdAt: issue.createdAt ?? null,
      }))
    },
    comment(number, body) {
      const res = ghCli(["issue", "comment", String(number), "--body", body])
      if (res.status !== 0) {
        throw new Error(`gh issue comment falhou: ${(res.stderr ?? "").slice(0, 400)}`)
      }
    },
    close(number) {
      const res = ghCli(["issue", "close", String(number), "--reason", "completed"])
      if (res.status !== 0) {
        throw new Error(`gh issue close falhou: ${(res.stderr ?? "").slice(0, 400)}`)
      }
    },
    create(title, body) {
      const res = ghCli(["issue", "create", "--title", title, "--body", body, "--label", label])
      if (res.status !== 0) {
        throw new Error(`gh issue create falhou: ${(res.stderr ?? "").slice(0, 400)}`)
      }
      return (res.stdout ?? "").trim() || "(issue criada)"
    },
  }
}

// ---------------------------------------------------------------------------
// Backend: Gitea (API REST de issues)
// ---------------------------------------------------------------------------

/**
 * Resolve a configuração da API do Gitea a partir do ambiente/CLI.
 *
 * @param {{repo?: string|null}} options
 * @param {Record<string,string|undefined>} env
 */
export function giteaIssueConfig(options = {}, env = process.env) {
  const token = env.GITEA_TOKEN
  const repo = options.repo ?? env.GITEA_REPOSITORY
  const baseUrl = (env.GITEA_URL ?? "").replace(/\/$/, "")
  if (!token) throw new Error("Gitea: defina GITEA_TOKEN no ambiente (escrita em issues)")
  if (!repo) throw new Error("Gitea: defina --repo owner/name ou GITEA_REPOSITORY")
  if (!baseUrl) throw new Error("Gitea: defina GITEA_URL (ex.: https://gitea.exemplo.com)")
  return { token, repo, baseUrl }
}

/**
 * Requisição crua à API v1 do Gitea. Devolve `{ status, data }` SEM lançar em
 * 4xx: 409 (label já existe) e 404 são desfechos que o chamador trata, não
 * exceções de controle de fluxo.
 */
async function giteaApi({ token, baseUrl }, method, path, body) {
  const response = await fetch(`${baseUrl}/api/v1${path}`, {
    method,
    headers: {
      Authorization: `token ${token}`,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const text = await response.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = null
  }
  return { status: response.status, data, text }
}

/**
 * Backend de issues do Gitea.
 *
 * O label precisa do ID (a API cria issue com `labels: [id]`), então ele é
 * resolvido UMA vez, de forma idempotente: procura por nome e só cria se
 * faltar — um 409 (corrida com outro run) é sucesso, não erro.
 *
 * @param {{config: object, request?: typeof giteaApi, label: string, color: string, description: string}} params
 */
export function makeGiteaBackend(
  { config, request = giteaApi, label, color, description } = /** @type {any} */ ({}),
) {
  const base = `/repos/${config.repo}`
  const labelColor = color.startsWith("#") ? color : `#${color}`
  let cachedLabelId = null

  async function labelId() {
    if (cachedLabelId !== null) return cachedLabelId
    const list = await request(config, "GET", `${base}/labels?limit=100`)
    if (list.status !== 200 || !Array.isArray(list.data)) {
      throw new Error(
        `Gitea: listar labels → HTTP ${list.status}: ${(list.text ?? "").slice(0, 200)}`,
      )
    }
    const found = list.data.find((entry) => entry.name === label)
    if (found) {
      cachedLabelId = found.id
      return cachedLabelId
    }
    const created = await request(config, "POST", `${base}/labels`, {
      name: label,
      color: labelColor,
      description,
    })
    // 409 = outro run criou entre o GET e o POST: já existe, seguir.
    if (created.status !== 201 && created.status !== 409) {
      throw new Error(
        `Gitea: criar label → HTTP ${created.status}: ${(created.text ?? "").slice(0, 200)}`,
      )
    }
    if (created.status === 201 && created.data?.id) cachedLabelId = created.data.id
    else if (created.status === 409) {
      const again = await request(config, "GET", `${base}/labels?limit=100`)
      const race = Array.isArray(again.data)
        ? again.data.find((entry) => entry.name === label)
        : null
      if (!race) throw new Error("Gitea: label em conflito (409) mas não encontrado na listagem")
      cachedLabelId = race.id
    }
    return cachedLabelId
  }

  return {
    name: "gitea",
    label,
    ensureLabel() {
      return labelId()
    },
    async openIssues() {
      const res = await request(config, "GET", `${base}/issues?state=open&type=issues&limit=100`)
      if (res.status !== 200 || !Array.isArray(res.data)) {
        throw new Error(
          `Gitea: listar issues → HTTP ${res.status}: ${(res.text ?? "").slice(0, 200)}`,
        )
      }
      const ours = res.data.filter((issue) =>
        (issue.labels ?? []).some((entry) => entry.name === label),
      )
      // Os comentários são um GET por issue: a LISTAGEM do Gitea traz só a
      // contagem. Sem eles, o dedup de um problema que mudou e o fechamento
      // automático (o marcador está num comentário) ficariam cegos. Uma leitura
      // que falha vira lista vazia — o que não dá para ler não pode derrubar o
      // run; o pior caso é um comentário repetido, não um alerta perdido.
      return Promise.all(
        ours.map(async (issue) => {
          const comments = await request(
            config,
            "GET",
            `${base}/issues/${issue.number}/comments?limit=100`,
          )
          const bodies =
            comments.status === 200 && Array.isArray(comments.data)
              ? comments.data.map((c) => ({ body: c?.body ?? "" }))
              : []
          return {
            number: issue.number,
            title: issue.title,
            body: issue.body ?? "",
            comments: bodies,
            // ISO 8601, como no `gh` (o campo é `created_at` na API do Gitea):
            // quem lê o board precisa saber HÁ QUANTO TEMPO a dívida está aberta.
            createdAt: issue.created_at ?? null,
          }
        }),
      )
    },
    async comment(number, body) {
      const res = await request(config, "POST", `${base}/issues/${number}/comments`, { body })
      if (res.status !== 201) {
        throw new Error(
          `Gitea: comentar issue #${number} → HTTP ${res.status}: ${(res.text ?? "").slice(0, 200)}`,
        )
      }
    },
    async close(number) {
      // Editar a issue (estado) é `PATCH /issues/{index}` — a API responde 201.
      const res = await request(config, "PATCH", `${base}/issues/${number}`, { state: "closed" })
      if (res.status !== 201 && res.status !== 200) {
        throw new Error(
          `Gitea: fechar issue #${number} → HTTP ${res.status}: ${(res.text ?? "").slice(0, 200)}`,
        )
      }
    },
    async create(title, body) {
      const id = await labelId()
      const res = await request(config, "POST", `${base}/issues`, { title, body, labels: [id] })
      if (res.status !== 201) {
        throw new Error(
          `Gitea: criar issue → HTTP ${res.status}: ${(res.text ?? "").slice(0, 200)}`,
        )
      }
      return res.data?.html_url ?? `#${res.data?.number ?? "?"}`
    },
  }
}

// ---------------------------------------------------------------------------
// Leitura do board do GitHub pela API (onde a CLI `gh` não existe)
// ---------------------------------------------------------------------------

/** Teto de itens por página da API do GitHub. */
const GH_PER_PAGE = 100

/**
 * O CANAL de leitura do board do GitHub, resolvido do ambiente — e o que falta
 * quando ele não dá.
 *
 * POR QUE ESTA FUNÇÃO EXISTE (e por que o modo é explícito): a CLI `gh` é o canal
 * natural onde ela existe — é o que os publicadores do `.github/` usam para
 * abrir, comentar e fechar. Mas o cron da **forja** roda noutro runner, e lá o
 * `gh` não está instalado: sem o caminho da API, as dívidas que SÓ existem no
 * board do GitHub (a auditoria reversa do README, a tendência de mutação) ficam
 * INVISÍVEIS na prontidão — e o pior modo de falha não é o erro, é o "sem
 * dívida" dito sobre um board que nunca foi lido.
 *
 * POR QUE SÓ `GH_TOKEN`/`GH_REPOSITORY` (e nunca `GITHUB_*`): o runner da forja
 * EMULA o contexto do GitHub — `GITHUB_REPOSITORY` e `GITHUB_TOKEN` ali apontam
 * para o repositório e o token do GITEA. Aceitá-los seria apontar a leitura para
 * o board errado (ou para um token que não autentica lá), e a falha apareceria
 * como "não lida" sem dizer por quê. Os nomes `GH_*` são explícitos justamente
 * para não colidirem com o que o runner define sozinho.
 *
 * `GH_API_URL` existe para o dublê de teste (e para o GitHub Enterprise): o
 * default é a API pública.
 *
 * @param {{env?: Record<string,string|undefined>, repo?: string|null}} [args]
 * @returns {{via: "api"|"cli", token: string|null, repo: string|null, baseUrl: string, why: string|null}}
 */
export function githubReadConfig({ env = process.env, repo = null } = {}) {
  const token = env.GH_TOKEN || null
  const slug = repo ?? env.GH_REPOSITORY ?? null
  const baseUrl = (env.GH_API_URL || "https://api.github.com").replace(/\/$/, "")
  if (token && slug) return { via: "api", token, repo: slug, baseUrl, why: null }
  const missing = [!token && "GH_TOKEN", !slug && "GH_REPOSITORY"].filter(Boolean)
  return { via: "cli", token: null, repo: slug, baseUrl, why: `sem ${missing.join(" e ")}` }
}

/**
 * A descrição HUMANA do canal de leitura, para o relatório dizer COMO leu — sem
 * reimplementar a regra que decidiu.
 */
export function describeGithubRead(config) {
  return config.via === "api" ? "a API do GitHub (GH_TOKEN + GH_REPOSITORY)" : "a CLI `gh`"
}

/**
 * Requisição crua à API REST do GitHub. Mesma forma de `giteaApi`: devolve
 * `{status, data, text}` SEM lançar em 4xx — quem trata é o chamador.
 */
async function githubApi({ token, repo, baseUrl }, method, path, body) {
  const response = await fetch(`${baseUrl}/repos/${repo}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const text = await response.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = null
  }
  return { status: response.status, data, text }
}

/**
 * LEITOR do board do GitHub pela API REST — e SÓ leitura.
 *
 * A assimetria é o ponto: publicar, comentar e fechar continuam com a CLI, no
 * lugar onde ela existe (o `.github/`, onde os publicadores rodam). Aqui há
 * apenas `openIssues()`, e devolver o MESMO formato dos outros backends
 * (`number`, `title`, `body`, `comments`, `createdAt`) é o que faz o leitor e o
 * escritor enxergarem o mesmo board sem uma segunda consulta divergir da
 * primeira.
 *
 * Duas armadilhas da API que a CLI esconde, e que aqui são tratadas de propósito:
 *
 * 1. `GET /issues?labels=x` devolve também as PULL REQUESTS (no modelo do GitHub
 *    elas são issues) — o campo `pull_request` é o que as denuncia. Sem filtrar,
 *    um PR aberto com a label viraria "dívida aberta" no veredito;
 * 2. os comentários vêm numa chamada POR ISSUE (a listagem não os traz), e é neles
 *    que mora o marcador de um problema que MUDOU — sem eles o dedup do
 *    fechamento automático ficaria cego.
 *
 * @param {{config: object, request?: Function, label: string}} params
 */
export function makeGithubReader({ config, request = githubApi, label } = /** @type {any} */ ({})) {
  const base = `/issues?state=open&labels=${encodeURIComponent(label)}&per_page=${GH_PER_PAGE}`

  return {
    name: "github",
    label,
    async openIssues() {
      const res = await request(config, "GET", base)
      if (res.status !== 200 || !Array.isArray(res.data)) {
        throw new Error(
          `GitHub: listar issues → HTTP ${res.status}: ${String(res.text ?? "").slice(0, 200)}`,
        )
      }
      const issues = res.data.filter((issue) => issue?.pull_request === undefined)
      return Promise.all(
        issues.map(async (issue) => {
          const comments = await request(
            config,
            "GET",
            `/issues/${issue.number}/comments?per_page=${GH_PER_PAGE}`,
          )
          const bodies =
            comments.status === 200 && Array.isArray(comments.data)
              ? comments.data.map((c) => ({ body: c?.body ?? "" }))
              : []
          return {
            number: issue.number,
            title: issue.title ?? "",
            body: issue.body ?? "",
            comments: bodies,
            // ISO 8601, como no `gh` (o campo é `created_at` na API): quem lê o
            // board precisa saber HÁ QUANTO TEMPO a dívida está aberta.
            createdAt: issue.created_at ?? null,
          }
        }),
      )
    },
  }
}

/**
 * LISTA as issues ABERTAS com uma label, na forja escolhida — a LEITURA do
 * board, e não só a escrita.
 *
 * POR QUE ISSO MORA AQUI: quem PUBLICA e quem LÊ a dívida têm de enxergar a
 * MESMA coisa. Se o leitor (o doctor) tivesse a própria consulta, um campo ou
 * um filtro passariam a divergir dos publicadores no dia em que um deles
 * mudasse — e o modo de falha é o pior: o leitor diria "nenhuma dívida" sobre
 * um board cheio. Aqui a fonte é uma só: o mesmo `openIssues()` dos backends
 * que criam, deduplicam e fecham as issues.
 *
 * O `env` é injetável porque a forja Gitea resolve `GITEA_TOKEN`/`GITEA_URL`/
 * `GITEA_REPOSITORY` do ambiente DAQUELE run (o do cron), e não do processo do
 * teste. De quem NÃO conseguiu ler, ela DIZ o motivo — quem chama trata `unread`
 * (o doctor o reporta como fato NÃO lido, jamais como "sem dívida").
 *
 * NO GITHUB HÁ DOIS CANAIS, e a escolha é explícita (`githubReadConfig`): a API
 * com `GH_TOKEN` + `GH_REPOSITORY` quando os dois existem — que é o único canal
 * possível no runner da FORJA, onde o `gh` não está instalado — e a CLI `gh`
 * quando não existem. Se nenhum dos dois servir, o erro NOMEIA os dois em vez de
 * devolver lista vazia (o vazio passaria por "sem dívida").
 *
 * @param {{forge: string, label: string, env?: Record<string,string|undefined>, repo?: string|null, deps?: {request?: Function, cliList?: Function}}} params
 * @returns {Promise<{number: number, title: string, body: string, comments: object[], createdAt: string|null}[]>}
 */
export async function listIssuesByLabel(
  { forge, label, env = process.env, repo = null, deps = {} } = /** @type {any} */ ({}),
) {
  const { request = githubApi, cliList = null } = deps
  if (forge !== "gitea") {
    const read = githubReadConfig({ env, repo })
    if (read.via === "api") return makeGithubReader({ config: read, request, label }).openIssues()
    // `color`/`description` são do LABEL, e a criação dele não acontece no
    // caminho de leitura (só `ensureLabel` usa): estes valores não tocam a rede.
    const viaCli =
      cliList ??
      (() => makeGithubBackend({ label, color: "#cccccc", description: "" }).openIssues())
    try {
      return await viaCli()
    } catch (err) {
      // O erro da CLI (ENOENT, 401, rate limit) vem CRU e sozinho num runner sem
      // `gh`: dito assim, ele manda o operador procurar um erro do GitHub que não
      // existe. A mensagem nomeia os DOIS canais e o que falta em cada um.
      const why = String(err?.message ?? err)
        .replace(/\s+/g, " ")
        .trim()
      throw new Error(
        `sem canal para ler o board do GitHub daqui: ${read.why} para a API, e a CLI \`gh\` falhou (${why})`,
      )
    }
  }
  return makeGiteaBackend({
    config: giteaIssueConfig({ repo }, env),
    label,
    color: "#cccccc",
    description: "",
  }).openIssues()
}

/**
 * Seleciona o backend pelo `--backend` — a configuração só é exigida do alvo
 * (escolher o Gitea sem token falha ANTES de qualquer requisição).
 *
 * @param {{backend: string, repo?: string|null}} options
 * @param {Record<string, string|undefined>} env
 * @param {{label: string, color: string, description: string}} issue
 */
export function selectIssueBackend(options, env = process.env, issue) {
  return options.backend === "gitea"
    ? makeGiteaBackend({ config: giteaIssueConfig(options, env), ...issue })
    : makeGithubBackend({ ...issue })
}

// ---------------------------------------------------------------------------
// A RECONCILIAÇÃO: o outro lado da dívida
// ---------------------------------------------------------------------------

/**
 * Fecha as issues que ESTE publicador abriu e cuja dívida caducou.
 *
 * COMENTA ANTES DE FECHAR, e de propósito: o comentário é a PROVA, e ele entra
 * numa issue ainda aberta — se o backend falhar no meio, o pior caso é uma
 * dívida aberta COM a prova anexada (nada mentiu), nunca uma issue fechada em
 * silêncio sem dizer por quê.
 *
 * SÓ FECHA O QUE É NOSSO (`isOurs`, tipicamente `issueHasAnyMarker`): uma issue
 * que ganhou o label por engano é reportada no log e fica intocada. E `isExpired`
 * permite o recorte por item — um publicador que abre UMA issue por achado fecha
 * só as que já não são reportadas, sem derrubar as que continuam vivas.
 *
 * @param {object} params
 * @param {object} params.backend                backend de `issue-publish.mjs`
 * @param {{number: number}[]} [params.existing]  issues abertas já listadas (evita 2ª listagem)
 * @param {(issue: object) => boolean} params.isOurs
 * @param {(issue: object) => boolean} [params.isExpired]  `true` por padrão (fecha todas as nossas)
 * @param {string | ((issue: object) => string)} params.resolutionBody  a prova
 * @param {string} [params.reason]               por que a dívida caducou (entra no log)
 * @param {(msg: string) => void} [params.log]
 * @returns {Promise<{closed: number[], stale: number[], foreign: number[], alreadyClear: boolean}>}
 */
export async function reconcileDebt({
  backend,
  existing,
  isOurs,
  isExpired = () => true,
  resolutionBody,
  reason = "a dívida caducou",
  log = console.log,
}) {
  const open = existing ?? (await backend.openIssues())
  const ours = open.filter((issue) => isOurs(issue))
  const foreign = open.filter((issue) => !isOurs(issue))

  // Um label aplicado à mão numa issue alheia NÃO pode ser fechado por
  // automatismo — mas também não pode passar em silêncio, senão a dívida fica
  // aberta sem ninguém saber por quê.
  for (const issue of foreign) {
    log(
      `ℹ️  issue #${issue.number} carrega o label '${backend.label}' e NÃO foi aberta por este script (sem marcador) — não é fechada por automatismo; revise à mão.`,
    )
  }

  if (ours.length === 0) {
    log(
      `✅ nenhuma dívida aberta com o label '${backend.label}'${foreign.length > 0 ? ` (${foreign.length} issue(s) alheia(s) com o label, deixada(s) intocada(s))` : ""}.`,
    )
    return { closed: [], stale: [], foreign: foreign.map((i) => i.number), alreadyClear: true }
  }

  const closed = []
  for (const issue of ours) {
    if (!isExpired(issue)) continue
    await backend.comment(
      issue.number,
      typeof resolutionBody === "function" ? resolutionBody(issue) : resolutionBody,
    )
    await backend.close(issue.number)
    closed.push(issue.number)
    log(`✅ issue #${issue.number} fechada — ${reason}.`)
  }

  // VERIFICAÇÃO PÓS-FECHAMENTO: re-lista as issues abertas e detecta fechamentos
  // que não pegaram (o backend respondeu sucesso mas a issue continua aberta).
  // Sem isso, um fechamento silencioso (permissão, race condition, bug do
  // servidor) deixaria a dívida aberta sem ninguém saber — e o doctor diria
  // "pronta" quando a dívida ainda vive.
  const stale = []
  if (closed.length > 0) {
    const stillOpen = (await backend.openIssues()).map((i) => i.number)
    for (const num of closed) {
      if (stillOpen.includes(num)) {
        stale.push(num)
        log(
          `⚠️  issue #${num} deveria ter sido fechada mas AINDA ESTÁ ABERTA — o fechamento falhou em silêncio. Revise manualmente.`,
        )
      }
    }
  }

  // Registra fechamentos silenciosos em arquivo para o doctor surfacear.
  if (stale.length > 0 && backend.name) {
    recordStaleClosures(backend.name, stale)
  }

  return { closed, stale, foreign: foreign.map((i) => i.number), alreadyClear: false }
}

// ---------------------------------------------------------------------------
// O CONTRATO de um publicador de dívida
// ---------------------------------------------------------------------------
//
// POR QUE EXISTE: os backends e as primitivas acima já eram compartilhados, mas
// o CICLO não era. Cada publicador reimplementava as mesmas quatro decisões —
// quem escreveu a issue (o marcador, com o SEU formato), em que ORDEM (dedup por
// assinatura, comentar no título já aberto, criar), o que é ESCOPO seu (uma issue
// para o problema, ou uma por achado) e quando a dívida CADUCOU (fechar, com a
// prova). Quatro implementações da mesma regra divergem no primeiro dia em que
// uma delas muda — e o modo de falha é sempre o mesmo: o alerta que some, a
// duplicata semanal, ou o ticket alheio fechado por engano.
//
// O QUE UM PUBLICADOR DECLARA (e só isso): a etiqueta, o FORMATO do marcador, o
// título, a assinatura do problema, a prosa do corpo, quando há dívida, o ESCOPO
// e o FECHAMENTO (a prova do comentário + o motivo). Nada de ciclo: quem publica,
// comenta, deduplica e fecha é `runDebtPublisher`, aqui — um lugar só.

/** Os formatos de marcador aceitos. O formato é DECLARADO, nunca reimplementado. */
export const MARKER_FORMATS = ["b64", "plain"]

/**
 * Normaliza e VALIDA o contrato de um publicador.
 *
 * Falha alto e cedo (na carga do módulo) quando falta uma peça: um publicador
 * sem `resolution` seria um publicador que abre dívida e nunca a fecha — o
 * defeito que este contrato existe para não deixar passar despercebido.
 *
 * @param {object} spec
 * @returns {object} o publicador normalizado
 */
export function defineDebtPublisher(spec = {}) {
  const required = ["name", "label", "title", "signature", "body", "actionable", "scope"]
  const missing = required.filter(
    (key) => typeof spec[key] !== "function" && spec[key] === undefined,
  )
  for (const key of ["title", "signature", "body", "actionable"]) {
    if (typeof spec[key] !== "function") missing.push(key)
  }
  const uniqueMissing = [...new Set(missing)]
  if (uniqueMissing.length > 0) {
    throw new Error(`publicador '${spec.name ?? "?"}': falta ${uniqueMissing.join(", ")}`)
  }

  const marker = { id: spec.name, format: "b64", ...(spec.marker ?? {}) }
  if (!MARKER_FORMATS.includes(marker.format)) {
    throw new Error(
      `publicador '${spec.name}': marker.format '${marker.format}' desconhecido (use ${MARKER_FORMATS.join(" | ")})`,
    )
  }

  const scope = { kind: "single", ...(spec.scope ?? {}) }
  if (!["single", "per-item"].includes(scope.kind)) {
    throw new Error(`publicador '${spec.name}': scope.kind '${scope.kind}' desconhecido`)
  }
  if (scope.kind === "per-item") {
    for (const key of ["items", "signature", "title", "body"]) {
      if (typeof scope[key] !== "function") {
        throw new Error(`publicador '${spec.name}': escopo per-item sem '${key}'`)
      }
    }
  }

  const resolution = { when: () => true, ...(spec.resolution ?? {}) }
  if (typeof resolution.comment !== "function") {
    throw new Error(
      `publicador '${spec.name}': sem resolution.comment — a dívida fecharia sem a prova do fechamento`,
    )
  }
  if (typeof resolution.reason !== "string" || resolution.reason.length === 0) {
    throw new Error(
      `publicador '${spec.name}': sem resolution.reason (o log do fechamento fica mudo)`,
    )
  }

  return {
    labelColor: "FBCA04",
    labelDescription: "",
    ...spec,
    marker,
    scope,
    resolution,
    prose: { ...DEFAULT_DEBT_PROSE, ...(spec.prose ?? {}) },
  }
}

/** A prosa do ciclo, por publicador — os defaults valem para quem não tem texto próprio. */
const DEFAULT_DEBT_PROSE = {
  actionable: () => "⚠️  Dívida detectada — publicando issue acionável.",
  inSync: () => "✅ Sem dívida.",
  alreadyReported: (issue) =>
    `ℹ️  Dívida idêntica já reportada na issue #${issue.number} — sem ruído.`,
  commented: (issue) => `✅ Comentário adicionado à issue #${issue.number} (dívida nova).`,
  created: (ref) => `✅ Issue criada: ${ref}`,
  reconciled: (count) =>
    `🔒 Reconciliado: ${count} issue(s) fechada(s) — a dívida não fica aberta depois de resolvida.`,
  dryRunTail: (backendName) => `\n(dry-run: nenhuma chamada ao backend '${backendName}')`,
  dryRunReconcile: (backendName) =>
    `   (dry-run: nenhuma chamada ao backend '${backendName}' — a reconciliação fecharia as issues abertas por este publicador, com a prova no comentário)`,
  // Escopo per-item: uma issue por item, e o resumo do run.
  itemCreated: (_item, ref) => `  ✅ issue criada: ${ref}`,
  itemsCreated: (created, skipped, label) =>
    `✅ ${created} issue(s) criada(s)${skipped > 0 ? `, ${skipped} já com issue aberta` : ""} com o label ${label}.`,
  // A guarda do fechamento: não conseguir MEDIR não é evidência de resolvido.
  unmeasured: () => "⚠️  Medição ausente/incompleta — NÃO reconciliando (não medido ≠ resolvido).",
  reconcileDeferred: () =>
    "   (--no-reconcile: o fechamento é do job que conhece TODOS os relatórios)",
}

/**
 * O MARCADOR de uma assinatura, no formato DECLARADO pelo publicador.
 *
 * `b64`: a assinatura pode ter quebras de linha e vai codificada (uma linha só
 * de HTML). `plain`: a assinatura é legível e já vive no corpo de issues
 * abertas — trocar o formato de um publicador que já publicou faria o dedup e o
 * fechamento deixarem de enxergar as dívidas existentes (é por isso que o
 * formato é uma DECISÃO declarada, e não um detalhe de implementação).
 */
export function publisherMarker(publisher, signature) {
  return publisher.marker.format === "plain"
    ? `<!-- ${publisher.marker.id}:${signature} -->`
    : markerOf(publisher.marker.id, signature)
}

/** O prefixo de QUALQUER marcador deste publicador (a assinatura vem depois). */
export function publisherMarkerPrefix(publisher) {
  return `<!-- ${publisher.marker.id}:`
}

/** O regex que EXTRAI a assinatura dos corpos deste publicador. */
function markerPattern(publisher) {
  const id = publisher.marker.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return new RegExp(`<!-- ${id}:(.*?) -->`, "g")
}

/**
 * As ASSINATURAS que uma issue carrega — no corpo e nos COMENTÁRIOS.
 *
 * Os comentários contam porque é neles que mora o marcador do segundo problema
 * em diante (um título já aberto recebe comentário). Olhar só o corpo faria a
 * run seguinte comentar de novo, para sempre.
 */
export function publisherSignatures(issue, publisher) {
  const found = []
  for (const body of issueBodies(issue)) {
    if (typeof body !== "string") continue
    for (const match of body.matchAll(markerPattern(publisher))) {
      found.push(
        publisher.marker.format === "plain"
          ? match[1]
          : Buffer.from(match[1], "base64").toString("utf8"),
      )
    }
  }
  return found
}

/** `true` se a issue foi escrita por ESTE publicador (qualquer assinatura). */
export function publisherOwns(issue, publisher) {
  return issueBodies(issue).some(
    (body) => typeof body === "string" && body.includes(publisherMarkerPrefix(publisher)),
  )
}

/** `true` se a issue já carrega ESTA assinatura (corpo ou comentário). */
export function publisherHasSignature(issue, publisher, signature) {
  return publisherSignatures(issue, publisher).includes(signature)
}

/**
 * O CORPO COMPLETO de uma issue: a prosa do publicador MAIS o marcador.
 *
 * A composição é do contrato, e de propósito: era o último lugar onde cada
 * publicador escrevia o próprio marcador — e onde um deles esqueceria de
 * escrevê-lo, publicando uma dívida que o fechamento automático depois não
 * reconheceria como sua.
 */
export function publisherBody(publisher, input, signature = publisher.signature(input)) {
  return `${publisher.body(input).trimEnd()}\n\n${publisherMarker(publisher, signature)}`
}

/** O corpo COMPLETO de uma issue de escopo per-item. */
export function publisherItemBody(publisher, input, item) {
  const signature = publisher.scope.signature(item, input)
  return `${publisher.scope.body(item, input).trimEnd()}\n\n${publisherMarker(publisher, signature)}`
}

/** `true` se um TEXTO (não uma issue) carrega o marcador do publicador. */
export function bodyHasMarker(publisher, body) {
  return typeof body === "string" && body.includes(publisherMarkerPrefix(publisher))
}

/** `true` se um TEXTO carrega ESTA assinatura. */
export function bodyHasSignature(publisher, body, signature) {
  return typeof body === "string" && body.includes(publisherMarker(publisher, signature))
}

/**
 * PUBLICA a dívida de agora (ou comenta a que mudou), com dedup por assinatura.
 *
 * A ORDEM é o contrato: primeiro a ASSINATURA (o mesmo problema não repete — o
 * cron semanal não vira ruído), depois o TÍTULO (um problema NOVO comenta na
 * issue aberta em vez de abrir uma segunda). Escopo `per-item` abre uma issue por
 * item, e só as que ainda não têm marcador aberto.
 *
 * @param {{publisher: object, input: unknown, backend: object, dryRun?: boolean, log?: Function}} params
 * @returns {Promise<{status: string, ref?: string, number?: number, created?: number}>}
 */
export async function publishDebt({
  publisher,
  input,
  backend,
  dryRun = false,
  log = console.log,
}) {
  if (publisher.scope.kind === "per-item") {
    const items = publisher.scope.items(input)
    if (items.length === 0) {
      log(publisher.prose.inSync(input))
      return { status: "in-sync", created: 0 }
    }
    log(publisher.prose.actionable(input, items.length))
    if (dryRun) {
      for (const item of items) {
        log(`  [dry-run] criaria issue: ${publisher.scope.title(item, input)}`)
        log(`            body: ${publisher.scope.body(item, input).split("\n")[0]}`)
      }
      log(publisher.prose.dryRunTail(backend.name))
      return { status: "dry-run", created: 0 }
    }
    await backend.ensureLabel()
    const existing = await backend.openIssues()
    const known = new Set(existing.flatMap((issue) => publisherSignatures(issue, publisher)))
    const toCreate = items.filter((item) => !known.has(publisher.scope.signature(item, input)))
    for (const item of toCreate) {
      const title = publisher.scope.title(item, input)
      const ref = await backend.create(title, publisherItemBody(publisher, input, item))
      log(publisher.prose.itemCreated(item, ref))
    }
    log(
      publisher.prose.itemsCreated(
        toCreate.length,
        items.length - toCreate.length,
        publisher.label,
      ),
    )
    return { status: "created", created: toCreate.length }
  }

  if (!publisher.actionable(input)) {
    log(publisher.prose.inSync(input))
    return { status: "in-sync" }
  }

  const signature = publisher.signature(input)
  if (signature === "") {
    // Dívida ACIONÁVEL sem assinatura é defeito do CONTRATO: o marcador sairia
    // vazio, e um marcador vazio não deduplica nem fecha nada (casa com
    // qualquer coisa). Fail-closed, como o resto do repositório: não publicar é
    // melhor que publicar uma dívida que o ciclo não consegue reconhecer.
    throw new Error(
      `publicador '${publisher.name}': a dívida é acionável mas a assinatura veio vazia — sem assinatura não há dedup nem fechamento`,
    )
  }

  log(publisher.prose.actionable(input))
  if (dryRun) {
    log(publisherBody(publisher, input, signature))
    log(publisher.prose.dryRunTail(backend.name))
    return { status: "dry-run" }
  }

  await backend.ensureLabel()
  const title = publisher.title(input)
  const body = publisherBody(publisher, input, signature)
  const decision = decidePublication({
    existing: await backend.openIssues(),
    title,
    signature,
    markerId: publisher.marker.id,
  })

  if (decision.action === "already-reported") {
    log(publisher.prose.alreadyReported(decision.issue))
    return { status: "already-reported", number: decision.issue.number }
  }

  if (decision.action === "comment") {
    await backend.comment(decision.issue.number, body)
    log(publisher.prose.commented(decision.issue, input))
    return { status: "commented", number: decision.issue.number }
  }

  const ref = await backend.create(title, body)
  log(publisher.prose.created(ref, input))
  return { status: "created", ref }
}

/**
 * FECHA o que este publicador abriu e cuja dívida já caducou — comentando a
 * PROVA antes (numa issue ainda aberta: o pior caso passa a ser dívida aberta
 * COM a prova, nunca fechada em silêncio).
 *
 * O ESCOPO decide o que caducou: `single` fecha todas as nossas (o problema
 * único acabou); `per-item` fecha só as cuja assinatura não está mais viva — uma
 * issue por achado, e um achado por issue.
 *
 * @param {{publisher: object, input: unknown, backend: object, existing?: object[], log?: Function}} params
 */
export async function reconcilePublisherDebt({
  publisher,
  input,
  backend,
  existing,
  log = console.log,
}) {
  const live =
    publisher.scope.kind === "per-item"
      ? new Set(publisher.scope.items(input).map((item) => publisher.scope.signature(item, input)))
      : null

  const result = await reconcileDebt({
    backend,
    existing,
    isOurs: (issue) => publisherOwns(issue, publisher),
    isExpired:
      publisher.scope.kind === "per-item"
        ? (issue) => publisherSignatures(issue, publisher).every((sig) => !live.has(sig))
        : () => true,
    resolutionBody:
      publisher.scope.kind === "per-item"
        ? (issue) => publisher.resolution.comment(publisherSignatures(issue, publisher), input)
        : publisher.resolution.comment(input),
    reason: publisher.resolution.reason,
    log,
  })

  if (result.closed.length > 0) log(publisher.prose.reconciled(result.closed.length, input))
  if (result.stale.length > 0) {
    log(
      `⚠️  ${result.stale.length} issue(s) deveria(m) ter sido fechada(s) mas ainda ESTÁ(aberta(s) — o fechamento falhou em silêncio: ${result.stale.map((n) => `#${n}`).join(", ")}.`,
    )
  }
  return result
}

/**
 * O CICLO INTEIRO de um publicador de dívida: publica o que existe agora e fecha
 * o que caducou.
 *
 * A ORDEM depende do escopo, e é o que cada publicador já fazia à mão:
 *   - `single`: há dívida? publica/comenta. Não há? reconcilia (a dívida única
 *     acabou).
 *   - `per-item`: reconcilia SEMPRE (o achado que sumiu não é mais dívida) e
 *     abre só os itens que ainda não têm issue.
 *
 * `resolution.when(input)` é a guarda do fechamento: um medidor quebrado não é
 * evidência de "resolvido", então quem não conseguiu medir não fecha nada.
 *
 * @param {{publisher: object, input: unknown, backend: object, dryRun?: boolean, reconcile?: boolean, log?: Function}} params
 */
export async function runDebtPublisher({
  publisher,
  input,
  backend,
  dryRun = false,
  reconcile = true,
  log = console.log,
}) {
  if (publisher.scope.kind === "per-item") {
    if (dryRun) return publishDebt({ publisher, input, backend, dryRun, log })
    const { closed, stale } = await reconcilePublisherDebt({ publisher, input, backend, log })
    const published = await publishDebt({ publisher, input, backend, log })
    return { ...published, closed, stale }
  }

  if (publisher.actionable(input)) {
    if (dryRun) return publishDebt({ publisher, input, backend, dryRun, log })
    return publishDebt({ publisher, input, backend, log })
  }

  log(publisher.prose.inSync(input))
  if (!publisher.resolution.when(input)) {
    log(publisher.prose.unmeasured(input))
    return { status: "unmeasured" }
  }
  if (dryRun) {
    log(publisher.prose.dryRunReconcile(backend.name))
    return { status: "in-sync" }
  }
  if (!reconcile) {
    log(publisher.prose.reconcileDeferred())
    return { status: "in-sync" }
  }
  const { closed, stale } = await reconcilePublisherDebt({ publisher, input, backend, log })
  return { status: "in-sync", closed, stale }
}
