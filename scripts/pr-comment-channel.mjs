#!/usr/bin/env node

// =============================================================================
// pr-comment-channel.mjs
//
// O CANAL de comentário no PR, sem dono de assunto: resolver a forja, achar o
// número do PR, listar os comentários NOSSOS (pelo marcador), remover duplicatas
// e criar/atualizar/RETIRAR conforme a decisão.
//
// POR QUE ELE EXISTE SEPARADO. A mecânica nasceu dentro do
// `pr-remedy-comment.mjs` (o remendo do pre-commit vai ao PR como comentário). O
// VEREDITO do `merge-gate:prove` precisa EXATAMENTE da mesma mecânica — e um
// segundo jeito de reconciliar comentários no mesmo PR divergiria na primeira
// correção que um recebesse (a duplicata, o 403 de PR de fork, a decisão
// `noop`). Só que `pr-remedy-comment.mjs` importa os DOIS GATES para medir o
// patch (`remedyPatch`), e os gates importam `forge-workflows` → `js-yaml`; um
// consumidor que só quer o CANAL herdaria essa dependência — e o
// `check-job-deps` está certo em tratar isso como custo real (\`node_modules\`
// no job).
//
// Aqui não há gate nenhum: as dependências são os builtins do node e o
// `issue-publish.mjs` (o cliente das duas forjas). Quem quiser o canal do
// remédio continua chamando `pr-remedy-comment.mjs`, que RE-EXPORTA tudo daqui —
// a API pública daquele módulo não mudou, e os testes dele seguem valendo.
//
// O MARCADOR É OBRIGATÓRIO (e fail-closed). Não existe default: um marcador
// ausente filtraria a lista por `"undefined"` e não acharia comentário nenhum —
// o script criaria uma cópia nova a cada run e a reconciliação viraria ruído.
// Quem chama diz QUAL canal é; cada assunto tem o seu, para que a retirada de um
// não apague o aviso do outro no MESMO PR.
//
// Usage:
//   (módulo — o ciclo é contado pelos publicadores; não há CLI próprio)
//
// Exit codes:
//   (módulo — as funções devolvem/levantam em vez de sair: quem decide o exit
//    code é o publicador)
// =============================================================================

import { readFileSync } from "node:fs"
import process from "node:process"

import { giteaApi, giteaIssueConfig, githubApi, githubReadConfig } from "./issue-publish.mjs"

/**
 * O número do PR, resolvido do que a forja der — e `null` quando nada dá.
 *
 * A ordem é a da CONFIANÇA: `--pr` (quem chamou disse), `PR_NUMBER` (o workflow
 * disse), o payload do evento (a forja disse) e, por último, `GITHUB_REF`
 * (`refs/pull/N/…`, que é o que sobra num evento que não traz o payload). Um
 * número inventado publicaria num PR que não é este — preferimos não publicar.
 *
 * @param {{env?: Record<string,string|undefined>, flag?: string|null, readFile?: Function}} [args]
 * @returns {number|null}
 */
export function prNumberFrom({ env = process.env, flag = null, readFile = readFileSync } = {}) {
  const fromFlag = Number.parseInt(String(flag ?? ""), 10)
  if (Number.isInteger(fromFlag) && fromFlag > 0) return fromFlag
  const fromEnv = Number.parseInt(String(env.PR_NUMBER ?? ""), 10)
  if (Number.isInteger(fromEnv) && fromEnv > 0) return fromEnv
  const eventPath = env.GITHUB_EVENT_PATH
  if (eventPath) {
    try {
      const payload = JSON.parse(readFile(eventPath, "utf8"))
      const n = Number.parseInt(String(payload?.pull_request?.number ?? ""), 10)
      if (Number.isInteger(n) && n > 0) return n
    } catch {
      // Payload ausente/ilegível não é veredito: caímos no `GITHUB_REF` abaixo.
    }
  }
  const ref = String(env.GITHUB_REF ?? "")
  const m = ref.match(/refs\/pull\/(\d+)\//)
  if (m) {
    const n = Number.parseInt(m[1], 10)
    if (Number.isInteger(n) && n > 0) return n
  }
  return null
}

/**
 * Qual forja recebe o comentário.
 *
 * `--backend` manda quando dado (é o que os workflows passam, um por pipeline);
 * sem ele, a presença do TOKEN decide — e sem nenhum dos dois o canal não
 * existe, com os nomes das variáveis na resposta (o remédio de quem lê o
 * `::notice::` é o nome que falta, não "configuração inválida").
 *
 * @param {{flag?: string|null, env?: Record<string,string|undefined>}} [args]
 * @returns {{backend: "gitea"|"github"|null, why: string|null}}
 */
export function selectBackend({ flag = null, env = process.env } = {}) {
  if (flag) return { backend: flag === "gitea" || flag === "github" ? flag : null, why: null }
  if (env.GITEA_TOKEN) return { backend: "gitea", why: null }
  if (env.GH_TOKEN) return { backend: "github", why: null }
  return { backend: null, why: "sem --backend e sem GITEA_TOKEN/GH_TOKEN no ambiente" }
}

/**
 * O canal de ESCRITA resolvido do ambiente — config + a função que fala com a
 * API — ou o motivo NOMEADO de não haver canal.
 *
 * As duas forjas passam pelo mesmo `*Api` de `issue-publish.mjs`: um comentário
 * de PR é um comentário de issue nas duas, e um segundo cliente divergiria dos
 * headers/da versão da API do primeiro.
 *
 * @param {"gitea"|"github"} backend
 * @param {{env?: Record<string,string|undefined>, repo?: string|null}} [args]
 * @returns {{request: Function, config: object, kind: string}|{unavailable: string}}
 */
export function backendChannel(backend, { env = process.env, repo = null } = {}) {
  if (backend === "gitea") {
    try {
      return { request: giteaApi, config: giteaIssueConfig({ repo }, env), kind: "gitea" }
    } catch (e) {
      return { unavailable: e?.message ?? String(e) }
    }
  }
  const read = githubReadConfig({ env, repo })
  if (read.via !== "api") {
    return {
      unavailable: `GitHub: ${read.why ?? "sem canal de escrita"} (defina GH_TOKEN + GH_REPOSITORY)`,
    }
  }
  return { request: githubApi, config: read, kind: "github" }
}

/**
 * A DECISÃO, pura: o que fazer com o comentário anterior dado o corpo novo.
 *
 * Separada do efeito para ser julgável sem dublê de HTTP — e porque as quatro
 * respostas são as que importam: `remove` (o defeito sumiu: retirar é o que
 * fecha o ciclo), `create` (primeira vez), `update` (o corpo mudou) e `noop`
 * (idêntico: reescrever o mesmo texto gastaria uma chamada e mudaria o rodapé
 * sem motivo).
 *
 * @param {{hasPrevious: boolean, previousBody?: (string|null), body: (string|null)}} args
 * @returns {"create"|"update"|"noop"|"remove"}
 */
export function decideComment({ hasPrevious, previousBody = null, body = null }) {
  if (body === null) return hasPrevious ? "remove" : "noop"
  if (!hasPrevious) return "create"
  return String(previousBody ?? "").trim() === body.trim() ? "noop" : "update"
}

/**
 * Erro de canal que EXISTE mas não aceita escrita (401/403): PR de fork, token
 * sem escopo. É aviso nomeado, não publicação quebrada.
 */
export class ChannelDenied extends Error {}

/**
 * Reconcilia o comentário no PR: lista os nossos (pelo marcador), retira
 * duplicatas, e então cria/atualiza/retira conforme a decisão.
 *
 * `request` é injetável (`(config, method, path, body)`) para os testes
 * exercitarem o ciclo inteiro — criar na run 1, atualizar na 2, retirar na 3 —
 * sem tocar a rede.
 *
 * `marker` é OBRIGATÓRIO (o docstring do módulo diz por quê): é por ele que a
 * lista é FILTRADA — dois canais podem viver no mesmo PR, e reconciliar um pelo
 * marcador do outro retiraria um aviso que ainda vale.
 *
 * @param {{request: Function, config: object, kind?: string, pr: number, body: (string|null), marker: string, log?: Function}} args
 * @returns {Promise<{action: string, id: (number|null), detail: string}>}
 */
export async function reconcileComment({
  request,
  config,
  kind = "github",
  pr,
  body,
  marker,
  log = () => {},
}) {
  if (typeof marker !== "string" || marker === "") {
    throw new Error("reconcileComment exige um marcador (o canal é identificado por ele)")
  }
  // A paginação tem nome diferente em cada forja: mandar os dois parâmetros
  // seria pedir o que a outra não conhece (e um 400 aqui viraria "canal
  // quebrado" sem ser).
  const pagina = kind === "gitea" ? "?limit=100" : "?per_page=100"
  // O ESCOPO DO PATH também é diferente: o `githubApi` injeta `/repos/{repo}`
  // em TODO path (e o `issue-publish` do Gitea monta o base com o repo à mão,
  // base = `/repos/${config.repo}` — medido no run 348, que comentou e fechou a
  // #4). O canal de PR passa paths NUS — e no Gitea ninguém injeta: o GET
  // `/api/v1/issues/N/comments` volta `404 page not found` (run 350, PR #6 — os
  // 3 fixers QUEBRADOS com todos os guards verdes). O base é do kind: só o
  // Gitea precisa dele aqui, e o config do Gitea sempre carrega `repo`.
  if (kind === "gitea" && !config?.repo) {
    throw new Error(
      "canal gitea exige config.repo (GITEA_REPOSITORY) — o path da API é repo-escopo",
    )
  }
  const base = kind === "gitea" ? `/repos/${config.repo}` : ""
  const list = await request(config, "GET", `${base}/issues/${pr}/comments${pagina}`)
  guardStatus(list, 200, `listar comentários do PR #${pr}`)
  const todos = Array.isArray(list.data) ? list.data : []
  // O filtro é pelo marcador DO CANAL: dois assuntos podem viver no mesmo PR, e
  // listar/tirar o comentário do outro seria apagar um aviso que ainda vale.
  const nossos = todos.filter((c) => String(c?.body ?? "").includes(marker))

  // Duplicata é resíduo de dois runs concorrentes: o marcador é único por PR, e
  // deixar duas cópias faria a reconciliação seguinte escolher uma ao acaso.
  for (const extra of nossos.slice(1)) {
    const del = await request(config, "DELETE", `${base}/issues/comments/${extra.id}`)
    guardStatus(del, 204, `retirar comentário duplicado #${extra.id}`, 200)
    log(`🧹 comentário duplicado #${extra.id} retirado`)
  }

  const anterior = nossos[0] ?? null
  const acao = decideComment({ hasPrevious: anterior !== null, previousBody: anterior?.body, body })

  if (acao === "noop") {
    return {
      action: "noop",
      id: anterior?.id ?? null,
      detail:
        body === null
          ? "nada a publicar e sem comentário nosso — nada a fazer"
          : "o comentário já estava com este corpo",
    }
  }
  if (acao === "remove") {
    const del = await request(config, "DELETE", `${base}/issues/comments/${anterior.id}`)
    guardStatus(del, 204, `retirar comentário #${anterior.id}`, 200)
    return {
      action: "removed",
      id: anterior.id,
      detail: "o defeito sumiu: o comentário foi RETIRADO",
    }
  }
  if (acao === "create") {
    const created = await request(config, "POST", `${base}/issues/${pr}/comments`, { body })
    guardStatus(created, 201, `comentar o PR #${pr}`)
    return {
      action: "created",
      id: created.data?.id ?? null,
      detail: `comentário publicado no PR #${pr}`,
    }
  }
  const updated = await request(config, "PATCH", `${base}/issues/comments/${anterior.id}`, { body })
  guardStatus(updated, 200, `atualizar comentário #${anterior.id}`, 201)
  return { action: "updated", id: anterior.id, detail: `comentário #${anterior.id} atualizado` }
}

/**
 * Um status fora do esperado vira erro — com 401/403 nomeados como CANAL SEM
 * ESCRITA (aviso) e o resto como publicação quebrada (falha).
 */
function guardStatus(res, expected, what, also = null) {
  if (res?.status === expected || (also !== null && res?.status === also)) return
  const detail = String(res?.text ?? "").slice(0, 200)
  const msg = `${what} → HTTP ${res?.status}: ${detail}`
  if (res?.status === 401 || res?.status === 403) {
    throw new ChannelDenied(`${msg} (o token não escreve neste PR — PR de fork ou sem escopo)`)
  }
  throw new Error(msg)
}
