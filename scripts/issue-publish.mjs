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
//
// Exit codes:
//   (módulo — não possui CLI próprio; as chamadas de rede são dos backends, e
//    elas lançam em erro em vez de sair: quem decide o exit code é o publicador)
// =============================================================================

import { spawnSync } from "node:child_process"
import process from "node:process"

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
 * teste. Nunca lança: quem chama trata `unread` (o doctor o reporta como fato
 * NÃO lido, jamais como "sem dívida").
 *
 * @param {{forge: string, label: string, env?: Record<string,string|undefined>, repo?: string|null}} params
 * @returns {Promise<{number: number, title: string, body: string, comments: object[], createdAt: string|null}[]>}
 */
export async function listIssuesByLabel({ forge, label, env = process.env, repo = null }) {
  // `color`/`description` são do LABEL, e a criação dele não acontece no caminho
  // de leitura (só `ensureLabel` usa) — os valores abaixo nunca chegam à forja.
  const backend =
    forge === "gitea"
      ? makeGiteaBackend({
          config: giteaIssueConfig({ repo }, env),
          label,
          color: "#cccccc",
          description: "",
        })
      : makeGithubBackend({ label, color: "#cccccc", description: "" })
  return backend.openIssues()
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
 * @returns {Promise<{closed: number[], foreign: number[], alreadyClear: boolean}>}
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
    return { closed: [], foreign: foreign.map((i) => i.number), alreadyClear: true }
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

  return { closed, foreign: foreign.map((i) => i.number), alreadyClear: false }
}
