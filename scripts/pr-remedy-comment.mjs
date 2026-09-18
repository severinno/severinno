#!/usr/bin/env node

// =============================================================================
// pr-remedy-comment.mjs
//
// O REMENDO vai ao PR como COMENTÁRIO. Quando o gate `bash -n` dos corpos
// `run:` (`check-workflow-run-syntax`) reprova, este script publica o PATCH
// exato do remendo no PR — em vez de deixar quem abriu o PR caçar no log do job
// QUAL linha caiu e reescrever à mão a cicatriz que o próprio repositório já
// sabe remendar (é o mesmo defeito mecânico que o `--fix` remenda e que o
// remédio do pre-commit já oferece, com confirmação, no momento do commit).
//
// A DISTÂNCIA QUE ELE FECHA (o PR é a OUTRA ponta do hook)
//
// O pre-commit oferece o remédio onde há terminal e operador. No PR não há nem
// um nem outro: quem abriu o PR está lendo o check vermelho no navegador, e a
// única coisa que o log dá é a mensagem do bash. Este script leva até ali o
// PATCH — o mesmo que o `--fix` gravaria — e o RECONCILIA: quando a cicatriz
// some, o comentário é RETIRADO sozinho, em vez de ficar aberto mentindo sobre
// um defeito que já não existe.
//
// POR QUE UM PATCH (e não um "Apply suggestion")
//
// O botão "Apply suggestion" do GitHub e do Gitea só existe em comentário de
// REVISÃO ancorado na linha do diff, e uma âncora errada aplicaria uma edição
// ERRADA com um clique — o pior modo de falha deste caminho, porque é
// silencioso. O patch (a) sai do MESMO fixer que a gravação usa
// (`remedyPatch`, de `check-workflow-run-syntax.mjs`: uma régua, dois
// consumidores), (b) se aplica IDENTICAMENTE nas duas forjas (`git apply`) e
// (c) é o que o `git apply -` do operador consome sem parsing nosso no meio.
// O botão de COPIAR do bloco de código é o clique: copiar o bloco e colar no
// terminal aplica o remendo inteiro.
//
// O QUE ELE NÃO PUBLICA
//
// O patch cobre o que o fixer remenda. As RECUSAS (heredoc, forma dobrada
// `run: >`, arquivo de shell, shell embutido) vão no MESMO comentário com o
// motivo de cada uma — um comentário que só mostrasse o patch esconderia o que
// ele não cobre. E quando a varredura NÃO conseguiu medir (sem `bash`, arquivo
// ilegível, YAML inválido), ele NÃO retira o comentário anterior: ausência de
// medição nunca vira "não há nada aqui".
//
// CANAL AUSENTE x CANAL QUEBRADO
//
// Sem token, sem número de PR ou sem forja reconhecida o canal não existe — e
// isso é AVISO nomeado (`::notice::`), não falha: o GATE é o veredito, este
// comentário é um canal A MAIS. Token sem permissão de escrita (PR de fork, por
// exemplo) é o mesmo caso, dito. Já um canal que EXISTE e a API recusou (5xx,
// 422) é publicação quebrada: vira `::error::` e o passo falha — um canal que
// existe e não publica é pior que a ausência dele, porque parece que publicou.
//
// Usage:
//   node scripts/pr-remedy-comment.mjs --backend gitea               # na forja (merge)
//   node scripts/pr-remedy-comment.mjs --backend github              # no espelho
//   node scripts/pr-remedy-comment.mjs --backend gitea --pr 123      # PR explícito
//   node scripts/pr-remedy-comment.mjs --dry-run                     # imprime o corpo e a decisão, sem tocar a API
//   node scripts/pr-remedy-comment.mjs --root X                      # outro repositório (fixture/testes)
//   node scripts/pr-remedy-comment.mjs --json                        # saída estruturada
//   node scripts/pr-remedy-comment.mjs -h                            # esta ajuda
//
// Ambiente (o MESMO dos outros publicadores): no Gitea `GITEA_TOKEN`,
// `GITEA_URL` e `GITEA_REPOSITORY`; no GitHub `GH_TOKEN` e `GH_REPOSITORY`
// (`GH_API_URL` opcional). O número do PR vem de `--pr`, de `PR_NUMBER` ou do
// payload do evento (`GITHUB_EVENT_PATH`) / de `GITHUB_REF` (`refs/pull/N/…`).
// `REMEDY_RUN_URL` é opcional e entra no rodapé do comentário.
//
// Exit codes:
//   0 — o canal foi reconciliado (comentário criado, atualizado ou RETIRADO),
//       ou não havia o que fazer; e também quando o CANAL está AUSENTE ou sem
//       permissão de escrita, dito com `::notice::` (o GATE é o veredito)
//   2 — canal presente e a API recusou (publicação quebrada), ou uso do
//       ambiente inconsistente que o script não pode contornar em silêncio
//   3 — uso inválido (`--backend` desconhecido, `--pr` sem número, flag
//       desconhecida)
// =============================================================================

import { readFileSync } from "node:fs"
import process from "node:process"
import { pathToFileURL } from "node:url"

import { remedyPatch as runSyntaxPatch } from "./check-workflow-run-syntax.mjs"
import { remedyPatch as sigpipePatch } from "./check-pipefail-sigpipe.mjs"
import { giteaApi, giteaIssueConfig, githubApi, githubReadConfig } from "./issue-publish.mjs"

/** Exit codes — o contrato da CLI. */
export const EXIT = {
  OK: 0,
  UNPUBLISHED: 2,
  USAGE: 3,
}

/**
 * Teto de recusas listadas no corpo (o excedente é CONTADO, nunca omitido).
 */
export const MAX_REFUSED = 20

/**
 * Os campos que a medição de QUALQUER fixer tem de devolver.
 *
 * `unread` e `yamlInvalido` são a metade honesta do contrato: sem elas, "não há
 * nada a remendar" seria uma afirmação sobre o que o fixer não leu. Um fixer que
 * esquecesse uma delas declararia um veredito que ninguém mediu — e o erro seria
 * INVISÍVEL, porque um campo ausente não estoura nada.
 */
export const FORMA_DO_RESULTADO = [
  "patch",
  "fixed",
  "refused",
  "unread",
  "yamlInvalido",
  "indisponivel",
]

/**
 * OS FIXERS MECÂNICOS que têm este canal — cada um com o SEU marcador, o seu
 * nome de gate e a SUA medição.
 *
 * Um fixer por entrada, e não um script por remédio: a mecânica é a mesma
 * (medir o que o `--fix` gravaria, publicar o patch como comentário, reconciliar
 * quando o defeito some) e o que muda é o DEFEITO e como descrevê-lo. Dois
 * scripts irmãos divergiriam na primeira correção que um recebesse — e a
 * reconciliação, a decisão e o tratamento de canal são justamente onde isso dói.
 *
 * O marcador é POR FIXER de propósito: os dois remédios podem estar no MESMO PR
 * (um passo com a cicatriz E um `| grep -q`), e um marcador comum faria a
 * reconciliação de um retirar o comentário do outro.
 *
 * `medir` sai do MESMO `remedyPatch` que o `--fix` do gate usa — um preview com
 * régua própria prometeria um remendo que a gravação recusaria. Os dois fixers
 * estão nomeados nos campos (e não por referência a um mapa externo) para o
 * registro ser lido de uma vez.
 */
export const FIXERS = {
  "run-syntax": {
    marker: "<!-- run-syntax-remedy -->",
    gateJob: "Workflow run syntax (bash -n)",
    comandoFix: "node scripts/check-workflow-run-syntax.mjs --fix",
    titulo: "🩹 Remendo mecânico — o gate `bash -n` dos corpos `run:`",
    achado: (n) =>
      `O check **Workflow run syntax (bash -n)** encontrou **${n}** corpo(s) de passo com a` +
      "\n**cicatriz mecânica** que este repositório já sabe remendar: um **operador pendente**" +
      "\nno fim do bloco `run: |` (a reescrita em massa deixou `&&`, `|`, `\\`, `<<<`…).",
    naoCobre:
      "O fixer remenda UMA linha ancorada no bloco `run: |`; estes casos têm motivo próprio e" +
      "\n**precisam de mão**:",
    rodape:
      "> O remendo tira a **cicatriz** que impedia o parsing — ele **NÃO reconstrói a linha" +
      "\n> engolida** pela reescrita: **o diff é o que se revisa**.",
    medir: (root) => runSyntaxPatch(root),
  },
  "pipefail-sigpipe": {
    marker: "<!-- pipefail-sigpipe-remedy -->",
    gateJob: "Pipefail x grep quieto (SIGPIPE)",
    comandoFix: "node scripts/check-pipefail-sigpipe.mjs --fix",
    titulo: "🩹 Remendo mecânico — o gate SIGPIPE (`| grep -q` sob pipefail)",
    achado: (n) =>
      `O check **Pipefail x grep quieto (SIGPIPE)** encontrou **${n}** linha(s) com o pipeline` +
      "\nque dá **SIGPIPE** ao produtor: sob `set -o pipefail`, `PRODUTOR | grep -q PADRAO` pode sair" +
      "\n**141 MESMO com o padrão encontrado** (o `grep -q` fecha o stdin no primeiro casamento e quem" +
      "\nainda tinha bytes para escrever leva o sinal). O remédio é o herestring — nenhum pipe, nenhum" +
      "\nprodutor para levar o sinal.",
    naoCobre:
      "O fixer troca o pipeline por herestring SÓ quando o produtor é uma forma segura de capturar" +
      '\n(`echo "$VAR"`, `printf …`); estes casos têm motivo próprio e **precisam de mão**:',
    rodape:
      "> O remendo troca o PIPELINE, não a asserção: o texto do produtor vira a entrada do `grep`." +
      "\n> Ele **não inventa** intenção onde o produtor é um comando vivo — **o diff é o que se revisa**.",
    medir: (root) => sigpipePatch(root),
  },
}

/** O fixer default — o canal nasceu com o gate do `bash -n`. */
export const DEFAULT_FIXER = "run-syntax"

/**
 * O marcador do fixer DEFAULT.
 *
 * Mantido exportado porque é o contrato de quem já lia este módulo (testes,
 * docs) — o marcador de CADA fixer está em `FIXERS`.
 */
export const MARKER = FIXERS[DEFAULT_FIXER].marker

/** O rodapé cita o job; o nome do gate é o que quem lê o PR vê no check. */
export const GATE_JOB = FIXERS[DEFAULT_FIXER].gateJob

const USAGE = `pr-remedy-comment — o patch do remendo de um gate mecânico publica-se no PR

Usage:
  node scripts/pr-remedy-comment.mjs --backend <gitea|github> [--fixer <id>] [--pr N] [--dry-run] [--json] [--root X]
  node scripts/pr-remedy-comment.mjs -h

Fixers (--fixer, default \`${DEFAULT_FIXER}\`):
${Object.entries(FIXERS)
  .map(([id, f]) => `  ${id.padEnd(18)} ${f.gateJob}`)
  .join("\n")}

O patch sai do MESMO fixer do \`--fix\` (\`remedyPatch\`) — o comentário publica o que
o \`--fix\` GRAVARIA, e o RECONCILIA: quando o defeito some, ele é retirado sozinho.
Cada fixer tem o SEU marcador, então os dois podem conviver no mesmo PR.

Exit codes:
  0 — canal reconciliado (criado/atualizado/retirado) ou nada a fazer; e também
      com o canal AUSENTE ou sem permissão de escrita, dito com \`::notice::\`
  2 — a API recusou a publicação (canal existe e não publica)
  3 — uso inválido (--backend desconhecido, --pr sem número, flag desconhecida)`

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
 * `::notice::` é o nome que falta, não \"configuração inválida\").
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
 * O corpo do comentário — ou `null` quando não há remendo a publicar.
 *
 * `null` NÃO é "nada a fazer": é o sinal de que a cicatriz sumiu, e o que existe
 * (o comentário anterior) tem de ser RETIRADO. Quem decide o que fazer com ele é
 * a reconciliação.
 *
 * As recusas entram com o motivo de cada uma, e o excedente do teto é CONTADO
 * (um comentário que omitisse 12 casos silenciosamente diria que o remendo cobre
 * tudo o que o job achou).
 *
 * @param {object} result  o retorno do `remedyPatch`
 * @param {{now?: Date, runUrl?: string|null}} [args]
 * @returns {string|null}
 */
export function remedyBody(result, { now = new Date(), runUrl = null } = {}) {
  return corpoDoFixer(DEFAULT_FIXER, result, { now, runUrl })
}

/**
 * O corpo do comentário de UM fixer — ou `null` quando não há remendo a publicar
 * (o sinal de RETIRAR, ver `remedyBody`).
 *
 * O esqueleto é o mesmo para os dois fixers (marcador, o que o gate achou, o
 * patch, o bloco de aplicação, as recusas, o rodapé reconciliado) e o que muda é
 * a PROSA de cada um — o defeito, o que ele não cobre e o que o diff significa.
 * O que NÃO muda: o patch sai do `medir` do próprio fixer, e a linha do arquivo
 * no cabeçalho das recusas é `f.line`, que o `fixAll` de cada gate preenche.
 *
 * @param {string} fixerId
 * @param {object} result  o retorno do `remedyPatch` do fixer
 * @param {{now?: Date, runUrl?: string|null}} [args]
 * @returns {string|null}
 */
export function corpoDoFixer(fixerId, result, { now = new Date(), runUrl = null } = {}) {
  const fixer = fixerOf(fixerId)
  const patch = String(result?.patch ?? "")
  if (patch.trim() === "") return null
  const remendados = result.fixed ?? []
  const recusas = result.refused ?? []
  const shell = result.shellFailures ?? []
  const embutido = [...(result.embeddedFailures ?? []), ...(result.payloadFailures ?? [])]
  const data = now.toISOString().replace("T", " ").slice(0, 16)
  const onde = (f) => `${f.file}:${f.linhaArquivo ?? f.line}`

  const linhas = [
    fixer.marker,
    `## ${fixer.titulo}`,
    "",
    fixer.achado(remendados.length),
    "",
    `O patch abaixo é **exatamente** o que \`${fixer.comandoFix}\``,
    "gravaria — ele sai do MESMO fixer (`remedyPatch`), e **nada foi gravado**.",
    "",
    `**Arquivos (${new Set(remendados.map((f) => f.file)).size}):** ${[...new Set(remendados.map(onde))].join(", ")}`,
    "",
    "### Aplicar (copiar o bloco, colar no terminal)",
    "",
    "```bash",
    "git apply - <<'REMEDY_PATCH'",
    patch.replace(/\n$/, ""),
    "REMEDY_PATCH",
    "```",
    "",
    `Alternativa sem copiar patch: \`${fixer.comandoFix}\` —`,
    "ele grava na árvore e **prova o efeito** (relê e re-julga; não grava o que não reduz).",
    "",
    fixer.rodape,
  ]

  if (recusas.length > 0) {
    const listadas = recusas.slice(0, MAX_REFUSED)
    linhas.push(
      "",
      `### O que este comentário NÃO cobre (${recusas.length} recusa(s))`,
      "",
      fixer.naoCobre,
      "",
      "| onde | por que não é remendado |",
      "| :-- | :-- |",
      ...listadas.map(
        (f) =>
          `| \`${f.line ? `${f.file}:${f.line}` : f.file}\` | ${String(f.reason ?? "")
            .replace(/\|/g, "\\|")
            .replace(/\n/g, " ")} |`,
      ),
    )
    if (recusas.length > listadas.length) {
      linhas.push(
        "",
        `… e mais **${recusas.length - listadas.length}** caso(s) — rode o gate localmente para a lista inteira.`,
      )
    }
  }

  const outras = [
    ...shell.map((f) => `${f.file}:${f.line} — ${f.error}`),
    ...embutido.map((f) => `${f.line ? `${f.file}:${f.line}` : f.file} — ${f.error}`),
  ]
  if (outras.length > 0) {
    linhas.push(
      "",
      `### Violações que NÃO são cicatriz remendável (${outras.length})`,
      "",
      ...outras.slice(0, MAX_REFUSED).map((l) => `- \`${l}\``),
      ...(outras.length > MAX_REFUSED
        ? ["", `… e mais **${outras.length - MAX_REFUSED}** caso(s).`]
        : []),
    )
  }

  linhas.push(
    ...[
      "",
      "---",
      "",
      `<sub>Comentário **reconciliado** pelo job \`${fixer.gateJob}\`: quando o defeito sumir, ele`,
      `é **retirado sozinho** — o ciclo é fechado, não deixado aberto. Gerado em ${data}.`,
      runUrl ? `Rodada: ${runUrl}.` : null,
      "</sub>",
    ].filter((l) => l !== null),
  )
  return linhas.join("\n")
}

/**
 * O fixer do id — ou LANÇA com os ids válidos na mensagem.
 *
 * Um id desconhecido é erro de USO (exit 3), e não "sem canal": quem escreveu
 * `--fixer pipefail` quer publicar AQUELE remédio, e seguir com o default
 * publicaria o comentário de outro gate num PR sobre este — o modo de falha que
 * a mensagem tem de tornar impossível.
 */
export function fixerOf(id) {
  const fixer = FIXERS[id]
  if (!fixer) {
    throw new Error(`fixer desconhecido: ${id} (válidos: ${Object.keys(FIXERS).join(", ")})`)
  }
  return fixer
}

/**
 * A DECISÃO, pura: o que fazer com o comentário anterior dado o corpo novo.
 *
 * Separada do efeito para ser julgável sem dublê de HTTP — e porque as quatro
 * respostas são as que importam: `remove` (a cicatriz sumiu: retirar é o que
 * fecha o ciclo), `create` (primeira vez), `update` (o patch mudou) e `noop`
 * (idêntico: reescrever o mesmo texto gastaria uma chamada e mudaria a data do
 * rodapé sem motivo).
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
 * `marker` é o marcador do fixer da vez (default: o do `bash -n`): é por ele que
 * a lista é FILTRADA — os dois remédios podem viver no mesmo PR, e reconciliar
 * um deles pelo marcador do outro retiraria um aviso que ainda vale.
 *
 * @param {{request: Function, config: object, kind?: string, pr: number, body: (string|null), marker?: string, log?: Function}} args
 * @returns {Promise<{action: string, id: (number|null), detail: string}>}
 */
export async function reconcileRemedy({
  request,
  config,
  kind = "github",
  pr,
  body,
  marker = MARKER,
  log = () => {},
}) {
  // A paginação tem nome diferente em cada forja: mandar os dois parâmetros
  // seria pedir o que a outra não conhece (e um 400 aqui viraria "canal
  // quebrado" sem ser).
  const pagina = kind === "gitea" ? "?limit=100" : "?per_page=100"
  const list = await request(config, "GET", `/issues/${pr}/comments${pagina}`)
  guardStatus(list, 200, `listar comentários do PR #${pr}`)
  const todos = Array.isArray(list.data) ? list.data : []
  // O filtro é pelo marcador DO FIXER: os dois remédios podem viver no mesmo PR,
  // e listar/tirar o comentário do outro seria apagar um aviso que ainda vale.
  const nossos = todos.filter((c) => String(c?.body ?? "").includes(marker))

  // Duplicata é resíduo de dois runs concorrentes: o marcador é único por PR, e
  // deixar duas cópias faria a reconciliação seguinte escolher uma ao acaso.
  for (const extra of nossos.slice(1)) {
    const del = await request(config, "DELETE", `/issues/comments/${extra.id}`)
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
          ? "sem cicatriz e sem comentário nosso — nada a fazer"
          : "o comentário já estava com este patch",
    }
  }
  if (acao === "remove") {
    const del = await request(config, "DELETE", `/issues/comments/${anterior.id}`)
    guardStatus(del, 204, `retirar comentário #${anterior.id}`, 200)
    return {
      action: "removed",
      id: anterior.id,
      detail: "a cicatriz sumiu: o comentário foi RETIRADO",
    }
  }
  if (acao === "create") {
    const created = await request(config, "POST", `/issues/${pr}/comments`, { body })
    guardStatus(created, 201, `comentar o PR #${pr}`)
    return {
      action: "created",
      id: created.data?.id ?? null,
      detail: `comentário publicado no PR #${pr}`,
    }
  }
  const updated = await request(config, "PATCH", `/issues/comments/${anterior.id}`, { body })
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

async function main() {
  const argv = process.argv.slice(2)
  const conhecidas = [
    "--backend",
    "--fixer",
    "--pr",
    "--root",
    "--dry-run",
    "--json",
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
  const backendFlag = valor("--backend")
  if (backendFlag !== null && backendFlag !== "gitea" && backendFlag !== "github") {
    console.error(`❌ --backend desconhecido: ${backendFlag} (use gitea ou github)`)
    console.error(USAGE)
    process.exit(EXIT.USAGE)
  }
  // O FIXER: o default é o gate do `bash -n` (o canal nasceu com ele). Um id
  // desconhecido é erro de USO e para aqui — cair no default publicaria o
  // comentário de OUTRO gate, que é pior que não publicar nada.
  const fixerFlag = valor("--fixer") ?? DEFAULT_FIXER
  let fixer
  try {
    fixer = fixerOf(fixerFlag)
  } catch (e) {
    console.error(`❌ ${e.message}`)
    console.error(USAGE)
    process.exit(EXIT.USAGE)
  }
  const prFlag = valor("--pr")
  // `--pr` com valor não-numérico é erro de USO e não "sem PR": quem escreveu
  // `--pr abc` quis publicar em algum PR, e tratar isso como "sem canal" faria o
  // passo seguir verde sobre um número que ninguém leu.
  if (prFlag !== null && prNumberFrom({ flag: prFlag }) === null) {
    console.error(`❌ --pr exige um número de PR: ${prFlag}`)
    console.error(USAGE)
    process.exit(EXIT.USAGE)
  }
  const root = valor("--root") ?? process.cwd()
  const dryRun = argv.includes("--dry-run")
  const json = argv.includes("--json")
  // (o fixer resolvido acima decide a medição, o marcador e o corpo)

  // ── 1. A MEDIÇÃO: o patch, pelo MESMO módulo do `--fix` DO FIXER ─────────
  const result = fixer.medir(root)
  const body = corpoDoFixer(fixerFlag, result, {
    runUrl: process.env.REMEDY_RUN_URL ?? null,
  })
  // A FORMA do resultado é conferida antes de ser lida: um fixer que devolvesse
  // `unread`/`yamlInvalido` AUSENTE faria `medido` dizer "mediu" sobre campos que
  // ninguém preencheu — a mesma falsa segurança que o `unread` existe para não
  // ter. Um slot faltando é "NÃO MEDIU", nomeado.
  const faltando = FORMA_DO_RESULTADO.filter((k) => !(k in result))
  const medido =
    faltando.length === 0 &&
    !result.indisponivel &&
    result.unread.length === 0 &&
    result.yamlInvalido.length === 0
  const resumo = {
    fixer: fixerFlag,
    gate: fixer.gateJob,
    medido,
    remendados: (result.fixed ?? []).length,
    recusas: (result.refused ?? []).length,
    indeterminado:
      result.indisponivel ??
      (faltando.length > 0 ? `a medição do fixer não devolveu: ${faltando.join(", ")}` : null),
  }

  // ── 2. O CANAL ────────────────────────────────────────────────────────────
  const canal = selectBackend({ flag: backendFlag, env: process.env })
  const pr = prNumberFrom({ env: process.env, flag: prFlag })
  const channel = canal.backend ? backendChannel(canal.backend, { env: process.env }) : null

  const semCanal = () => {
    const why = channel?.unavailable ?? canal.why ?? "canal indisponível"
    console.error(
      `::notice::pr-remedy-comment: ${why} — o remendo NÃO foi publicado (o GATE segue sendo o veredito; este comentário é um canal a mais)`,
    )
  }

  if (dryRun) {
    const decisaoDizivel =
      body === null
        ? "o comentário seria RETIRADO (sem cicatriz) ou nada havia a fazer"
        : `o comentário seria criado/atualizado com ${resumo.remendados} remendo(s)`
    if (json) {
      console.log(
        JSON.stringify(
          { ...resumo, backend: canal.backend, pr, dryRun: true, decisao: decisaoDizivel, body },
          null,
          2,
        ),
      )
    } else {
      console.error(
        `── pré-visualização (--dry-run): ${decisaoDizivel}; NADA foi gravado e a API não foi tocada`,
      )
      process.stdout.write((body ?? "(sem remendo: o comentário seria retirado)\n") + "\n")
    }
    process.exit(EXIT.OK)
  }

  if (!medido) {
    // Não medir não é \"não há nada aqui\": retirar o comentário com a varredura
    // quebrada apagaria o último aviso de um defeito que ninguém conseguiu ler.
    console.error(
      `::warning::pr-remedy-comment: a varredura NÃO mediu (${resumo.indeterminado ?? "arquivo ilegível ou YAML inválido"}) — o comentário anterior NÃO é retirado e nada é publicado`,
    )
    process.exit(EXIT.OK)
  }
  if (!canal.backend) {
    semCanal()
    process.exit(EXIT.OK)
  }
  if (!pr) {
    console.error(
      "::notice::pr-remedy-comment: sem número de PR (--pr, PR_NUMBER, payload do evento ou GITHUB_REF) — nada a publicar",
    )
    process.exit(EXIT.OK)
  }
  if (channel.unavailable) {
    semCanal()
    process.exit(EXIT.OK)
  }

  try {
    const out = await reconcileRemedy({
      request: channel.request,
      config: channel.config,
      kind: channel.kind,
      pr,
      body,
      marker: fixer.marker,
      log: (l) => console.error(l),
    })
    if (json)
      console.log(JSON.stringify({ ...resumo, backend: canal.backend, pr, ...out }, null, 2))
    else console.log(`✅ pr-remedy-comment (${canal.backend}, PR #${pr}): ${out.detail}`)
    process.exit(EXIT.OK)
  } catch (e) {
    if (e instanceof ChannelDenied) {
      console.error(`::warning::pr-remedy-comment: ${e.message}`)
      process.exit(EXIT.OK)
    }
    console.error(`::error::pr-remedy-comment: ${e?.message ?? e}`)
    process.exit(EXIT.UNPUBLISHED)
  }
}

// True apenas quando executado diretamente — permite importar as funções puras
// nos testes unitários sem disparar a medição nem a publicação.
const IS_DIRECT_RUN =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (IS_DIRECT_RUN) {
  main().catch((e) => {
    console.error(`::error::pr-remedy-comment: ${e?.stack ?? e}`)
    process.exit(EXIT.UNPUBLISHED)
  })
}
