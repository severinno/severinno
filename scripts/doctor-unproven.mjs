#!/usr/bin/env node

// =============================================================================
// doctor-unproven.mjs
//
// A IDADE do que o veredito do doctor NÃO cobre — num lugar só.
//
// POR QUE ISTO EXISTE: o doctor termina em INDETERMINADA com duas listas honestas
// e ANÔNIMAS NO TEMPO — `unproven` (o que ele não promete) e `unknowns` (o que
// não conseguiu medir). Sem data, uma lacuna nunca é reafirmada, nunca vence e
// nunca fecha: o ciclo de reconciliação das outras dívidas (issue aberta, fechada
// por MEDIÇÃO) não a alcança, e o PR/cron repete a mesma lista para sempre.
//
// O QUE ELE MEDE: cada item de `ci/unproven.json` é uma declaração DATADA, e o
// estado sai dos PRÓPRIOS FATOS do relatório (o `closedBy`, um predicado nomeado
// daqui) — não de uma segunda leitura da forja:
//
//   `proven`    — o fato que o item declarava fora de alcance FOI MEDIDO: a
//                 declaração ficou letra morta e o remédio é REMOVÊ-LA;
//   `open`      — a lacuna segue aberta, dentro da janela de revisão;
//   `aged`      — a lacuna passou a janela e ninguém a fechou nem a reafirmou
//                 (o canal é a issue do veredito, e o remédio é reafirmar a data);
//   `declarado` — um LIMITE por desenho (o histórico da forja, o smoke em
//                 runtime): não é dívida, é a fronteira da medição — e a data
//                 existe para que a fronteira seja declarada, não implícita;
//   `invalid`   — data ausente/impossível/no futuro, ou `closedBy` DESCONHECIDO
//                 (fail-closed: um item que nunca fecha em silêncio é pior que a
//                 ausência dele);
//   `unread`    — o registro não pôde ser lido: ausência de prova, JAMAIS "nada
//                 fora de alcance".
//
// A JANELA vem do próprio registro (`reviewAfterDays`) e a REGRA da data é a
// compartilhada (`allowlist-review.mjs`): uma segunda janela para a mesma
// pergunta divergiria no dia em que alguém ajustasse uma delas.
//
// O `matches` é o TRECHO da linha que o veredito publica sobre o item (uma
// string, ou uma LISTA de alternativas quando o mesmo assunto aparece em linhas
// diferentes conforme o estado medido — a falta do runner é um `unknown` quando
// não deu para ler e um BLOQUEIO quando deu). É por ele que a data chega à linha
// onde o operador lê, e o teste da suíte exige que cada item VIVO case com
// EXATAMENTE uma linha do relatório: prosa reescrita sem a data falha o PR em
// vez de envelhecer calada.
//
// Usage:
//   node scripts/doctor-unproven.mjs            # o fato em texto
//   node scripts/doctor-unproven.mjs --json     # o fato estruturado
//   node scripts/doctor-unproven.mjs --root DIR # outro checkout (testes)
//
// Exit codes:
//   0 — o fato foi medido (proven, open, aged, declarado e vazio são FATOS)
//   1 — declaração SEM registro (invalid) ou registro ilegível (unread)
//   2 — --root inexistente/não é diretório (falha de infraestrutura)
//   3 — uso inválido
// =============================================================================

import { existsSync, statSync } from "node:fs"
import { dirname, isAbsolute, join, resolve } from "node:path"
import process from "node:process"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import { MS_PER_DAY, parseAddedAt, reviewAddedAtEntries } from "./allowlist-review.mjs"

/** Exit codes declarados (o resto do repositório lê estes nomes, não os números). */
export const EXIT = { OK: 0, VIOLATIONS: 1, UNAVAILABLE: 2, USAGE: 3 }

/** A raiz do repositório (o `cwd` do comando), para o caminho relativo do registro. */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")

/** O registro DATADO — a fonte única da lista (a prosa e a data vivem no arquivo). */
export const UNPROVEN_REGISTRY_PATH = join("ci", "unproven.json")

/** As duas CLASSES de item, e o que se pode esperar de cada uma. */
export const KIND = { LACUNA: "lacuna", LIMITE: "limite" }

/**
 * OS PREDICADOS do `closedBy` — o que prova cada item, lido dos FATOS.
 *
 * Um nome que não esteja aqui é `invalid` (fail-closed): o item não fecharia
 * NUNCA, e um item que não fecha em silêncio é indistinguível de um item que
 * ninguém olha. Cada predicado é sobre o fato que o doctor já mede — nenhum
 * deles consulta a forja por conta própria (a medição é do doctor, uma só).
 */
export const CLOSED_BY = {
  /** A forja dona do merge foi LIDA (qualquer veredito que não seja "não lida"). */
  "gitea-forja-lida": (facts) => forjaLida(facts, "gitea"),
  /**
   * A forja ESPELHO TEM o recurso (branch protection) — isto é, o plano e a
   * visibilidade do repositório permitem exigir status checks. MEDIDO em
   * 09/2026: `severinno/severinno` é PRIVADO num plano sem a feature e a API
   * responde 403; "não suporta" não é "não li", e nenhuma credencial resolve —
   * é o par plano × visibilidade que fecha esta declaração.
   */
  "github-protection-suportada": (facts) =>
    ["in-sync", "drift"].includes(estadoDaForja(facts, "github")),
  /** O env do HOST existe neste checkout (sem ele, imagem/tier-1/contrato não medem). */
  "host-env-presente": (facts) =>
    Boolean(facts?.image) && facts.image.state !== undefined && facts.image.state !== "no-env",
  /**
   * O registro do act_runner foi LIDO (a stack da forja está de pé).
   *
   * Fecha só o que uma LEITURA REAL produz: `proven` (lido e em sincronia com o
   * compose) e `violated` (lido e divergente — a divergência vira bloqueio
   * nomeado em outro lugar). `skipped` é a SEÇÃO PULADA (medido em 05/10/2026:
   * o perfil `--ci` publicava o item como PROVADO com o fato pulado — uma
   * medição que não aconteceu fechando dívida), `unread` é o exec que correu e
   * não devolveu registro legível, e `unavailable` é docker fora/container
   * ausente: os três são AUSÊNCIA DE PROVA — "não consegui medir" nunca fecha
   * dívida, o mesmo fail-closed dos irmãos.
   */
  "act-runner-lido": (facts) =>
    Boolean(facts?.runnerLabels) && ["proven", "violated"].includes(facts.runnerLabels.state),
  /** O runner auto-hospedado do GitHub está REGISTRADO como o setup declara. */
  "github-runner-registrado": (facts) => facts?.githubRunnerLabels?.state === "proven",
  /**
   * A VERSÃO do BINÁRIO do act_runner é a da TAG que o compose declara.
   *
   * A segunda pergunta ao mesmo container (a versão vem da IMAGEM, e o container
   * não se auto-atualiza): `proven` é "o binário reporta a versão da tag pinada".
   * `drift` (a tag declara uma versão e o container RODA outra), `unread` (o
   * binário não respondeu) e `no-image` (o render não declara imagem) NÃO fecham a
   * declaração — "não deu para julgar" nunca fecha dívida. E `floating` (a tag não
   * pina versão: `latest`) também não: é a DECLARAÇÃO PENDENTE que a lacuna nomeia.
   */
  "act-runner-na-tag-do-compose": (facts) => facts?.runnerLabels?.version?.state === "proven",
  /**
   * A VERSÃO do runner registrado é a do PIN do setup — isto é, o serviço aceitou
   * o pin (não se auto-atualizou).
   *
   * É a segunda pergunta ao MESMO registro, e ela fecha por MEDIÇÃO: um pin
   * recusado se auto-atualiza no meio do primeiro job e deixa o job preso
   * (medido: 2.320.0 → 2.337.0). `proven` aqui é "o registro responde a versão que
   * o script pina"; `drift`, `unread` e `no-pin` NÃO fecham a declaração — "não
   * deu para julgar" nunca fecha dívida.
   */
  "github-runner-na-versao-do-pin": (facts) =>
    facts?.githubRunnerLabels?.version?.state === "proven",
  /**
   * A FILA DA FORJA DONA DO MERGE (Gitea) foi MEDIDA — o banco da stack respondeu.
   *
   * A Gitea 1.22 não expõe a fila em REST (medido: `/repos/{owner}/{repo}/actions/
   * tasks` → 404, e `/actions/runners` só tem a rota do token de registro): a fila
   * (`action_task.status IN (5 waiting, 7 blocked)`) e o estado do runner
   * (`action_runner.last_online` × a régua da própria forja) só existem no BANCO, e
   * o banco só existe onde a stack está de pé. Num checkout qualquer o doctor diz
   * "não lida" — NUNCA "sem fila": um repo que não existe no banco, um container
   * fora do ar ou um banco que não é o sqlite do compose devolveriam zero itens, e
   * zero itens é o verde FALSO desta pergunta.
   */
  "fila-gitea-medida": (facts) => {
    const metade = facts?.runnerQueue?.forges?.gitea
    return Boolean(metade) && metade.state !== "unread"
  },
  /**
   * A FILA DO ESPELHO (GitHub) foi MEDIDA — o canal respondeu e o registro do
   * runner foi lido.
   *
   * São DUAS leituras com canais diferentes: a fila em si (`/actions/runs?
   * status=queued`, pela API com GH_TOKEN + GH_REPOSITORY ou pela CLI `gh`) e o
   * registro de quem puxaria (`/actions/runners`, que exige o escopo de
   * self-hosted runners). Sem qualquer uma das duas a metade é `unread`, e sem o
   * registro uma fila cheia pareceria parada (ou vazia) por falta de testemunha.
   */
  "fila-github-medida": (facts) => {
    const metade = facts?.runnerQueue?.forges?.github
    return Boolean(metade) && metade.state !== "unread"
  },
  /** O contrato da imagem publicada foi provado contra o registry. */
  "imagem-publicada-prova": (facts) => facts?.imageContract?.state === "proven",
  /** As duas variáveis da imagem têm VALOR para comparar. */
  "espelhos-com-valor": (facts) =>
    Boolean(facts?.mirrors?.expectedVars?.IMAGE_REGISTRY) &&
    Boolean(facts?.mirrors?.expectedVars?.IMAGE_NAMESPACE),
  /** As referências não versionadas da imagem foram (todas) provadas. */
  "referencias-versionadas": (facts) => facts?.imageRefs?.state === "proven",
  /**
   * TODA forma MEDIDA do bench existe no COMMIT DE ORIGEM que a baseline grava.
   *
   * É o outro lado da idade: a idade mede a DISTÂNCIA em commits, esta mede o
   * CONTEÚDO daquele commit. Foi por essa fenda que a `doc-hashes` passou: a
   * forma foi medida com a suíte no ÍNDICE e o commit de origem não a tem, então
   * o número declarado descreve uma matriz que aquele commit não carrega — e a
   * idade, sozinha, dizia "fresco". Fecha por MEDIÇÃO (`bench-freshness` derrapa
   * a régua contra o commit), e só quando o fato foi julgado E nenhuma pergunta
   * ficou sem resposta: `unavailable`, `missing` não-vazio ou `semResposta > 0`
   * NÃO fecham dívida — "não deu para perguntar" nunca é "está no commit".
   */
  "forma-no-commit-de-origem": (facts) =>
    facts?.benchFreshness?.forms?.state === "measured" &&
    (facts.benchFreshness.forms.missing?.length ?? null) === 0 &&
    (facts.benchFreshness.forms.semResposta ?? null) === 0,
  /**
   * O ITEM DATADO do relógio da MATRIZ (`bench-ato-na-matriz`, o `closedBy` que
   * o doctor publica) fecha por MEDIÇÃO: o relatório mediu o relógio e o
   * registro do ato NÃO está atrás da matriz além do teto DELA.
   *
   * É o TERCEIRO relógio do mesmo ativo, e ele existe porque as outras duas
   * réguas são de CONTEÚDO: o `check-mutation-count` compara ids/contagem/metades
   * (ele acusa quando um sub-test ENTRA na matriz) e o item das formas pergunta
   * se o commit de origem CARREGA as suítes medidas. Nenhuma das duas olha o
   * TEMPO: um sub-test cujo alvo muda ou um corpo de suíte que muda de custo
   * deixam o número declarado descrevendo uma matriz que a árvore não tem mais,
   * sem mexer em contagem nenhuma. Esta declaração é a que envelhece nesse caso.
   *
   * `unavailable` NÃO fecha (o `state === "measured"` é o primeiro termo):
   * "não consegui medir" nunca prova que o registro descreve a matriz de agora —
   * é o mesmo fail-closed do resto do registro.
   */
  "ato-na-matriz": (facts) =>
    facts?.benchFreshness?.matrix?.state === "measured" &&
    facts.benchFreshness.matrix.aged === false,
  /**
   * A FILA DE MIGRACAO do caminho da forja está VAZIA — nenhum job pede a forja
   * sem que nenhum fato exija a imagem dela.
   *
   * É o `closedBy` do item datado dos jobs que AINDA rodam presos ao runner
   * `self-hosted` lendo YAML de passagem (`ci/unproven.json`, id
   * `runner-path-migration-queue`). O fato é a AUDITORIA do guard dono
   * (`check-job-deps.mjs`, medindo pela `auditaForjas` exportada — nenhuma
   * segunda implementação do scan): a fila ENVELHECE sozinha — quando o job
   * migra (ou sai), ela esvazia e a lacuna FECHA por MEDIÇÃO; quando um job
   * novo entra na classe, ela o nomeia e a declaração volta a valer.
   *
   * `unavailable` NÃO fecha (o primeiro termo é o `state === "measured"`):
   * "não consegui varrer os workflows" nunca é "a fila está vazia" — o mesmo
   * fail-closed do resto do registro.
   */
  "fila-de-migracao-vazia": (facts) =>
    facts?.jobMigrationQueue?.state === "measured" &&
    (facts.jobMigrationQueue.queue?.length ?? -1) === 0,
}

/** O estado de UMA forja no fato `protection` (o vocabulário de lá). */
function estadoDaForja(facts, forge) {
  const forges = facts?.protection?.forges ?? []
  const achado = forges.find((f) => f?.forge === forge)
  return achado?.state ?? null
}

/**
 * A forja foi LIDA? O fato AUSENTE não é uma leitura — e `null !== "unavailable"`
 * responderia `true` para um relatório sem o fato, fechando a declaração por uma
 * medição que não aconteceu (o otimismo que este registro existe para não ter).
 */
function forjaLida(facts, forge) {
  const estado = estadoDaForja(facts, forge)
  return estado !== null && estado !== "unavailable"
}

/**
 * LÊ o registro. Fail-closed em cada passo: arquivo ausente, ilegível, sem a
 * lista ou com `items` que não é array vira `erro` NOMEADO — nunca uma lista
 * vazia, que o veredito leria como "nada fora de alcance".
 *
 * @param {{root?: string, deps?: {exists?: Function, read?: Function}}} [options]
 * @returns {{items: object[], reviewAfterDays: number|null, erro: string|null}}
 */
export function readUnprovenRegistry({ root = REPO_ROOT, deps = {} } = {}) {
  const exists = deps.exists ?? existsSync
  const read = deps.read ?? ((path) => readFileSync(path, "utf8"))
  const caminho = isAbsolute(UNPROVEN_REGISTRY_PATH)
    ? UNPROVEN_REGISTRY_PATH
    : resolve(root, UNPROVEN_REGISTRY_PATH)
  if (!exists(caminho)) {
    return {
      items: [],
      reviewAfterDays: null,
      erro: `o registro não existe: ${UNPROVEN_REGISTRY_PATH}`,
    }
  }
  let bruto
  try {
    bruto = read(caminho)
  } catch (error) {
    return {
      items: [],
      reviewAfterDays: null,
      erro: `o registro não pôde ser lido (${UNPROVEN_REGISTRY_PATH}): ${error.message}`,
    }
  }
  let json
  try {
    json = JSON.parse(bruto)
  } catch (error) {
    return {
      items: [],
      reviewAfterDays: null,
      erro: `o registro não é JSON válido (${UNPROVEN_REGISTRY_PATH}): ${error.message}`,
    }
  }
  if (
    json === null ||
    typeof json !== "object" ||
    Array.isArray(json) ||
    !Array.isArray(json.items)
  ) {
    return {
      items: [],
      reviewAfterDays: null,
      erro: `o registro não tem a forma declarada (${UNPROVEN_REGISTRY_PATH}): 'items' tem de ser um array`,
    }
  }
  const reviewAfterDays = Number.isInteger(json.reviewAfterDays) ? json.reviewAfterDays : null
  return { items: json.items, reviewAfterDays, erro: null }
}

/**
 * MEDE o fato. `now` é injetável porque uma prova de ENVELHECIMENTO não pode
 * depender do relógio da máquina que roda a suíte.
 *
 * NUNCA lança: registro ilegível vira `unread` (ausência de prova), e um item sem
 * data ou com `closedBy` desconhecido vira `invalid` — os dois com a causa escrita.
 *
 * @param {{facts?: object, now?: number, root?: string, registry?: {items: object[], reviewAfterDays: number|null, erro: string|null}, deps?: object}} [options]
 * @returns {{state: string, items: Array, aged: Array, invalid: Array, proven: Array, open: Array, declarado: Array, total: number, reviewAfterDays: number|null, detail: string, reason?: string}}
 */
export function collectUnproven({
  facts = {},
  now = Date.now(),
  root = REPO_ROOT,
  registry = null,
  deps = {},
} = {}) {
  const lido = registry ?? readUnprovenRegistry({ root, deps })
  const reviewDays = lido.reviewAfterDays ?? 180
  if (lido.erro) {
    return {
      state: "unread",
      items: [],
      aged: [],
      invalid: [],
      proven: [],
      open: [],
      total: 0,
      reviewAfterDays: lido.reviewAfterDays ?? null,
      detail: lido.erro,
      reason: lido.erro,
    }
  }

  const itens = []
  for (const bruto of lido.items) {
    const item = bruto ?? {}
    const id = String(item.id ?? "?")
    const base = {
      id,
      kind: item.kind,
      subject: item.subject ?? null,
      proveWith: item.proveWith ?? null,
      remedy: item.remedy ?? null,
      closedBy: item.closedBy ?? null,
      matches: item.matches ?? null,
      declaredAt: item.declaredAt ?? null,
    }

    if (item.kind !== KIND.LACUNA && item.kind !== KIND.LIMITE) {
      itens.push({
        ...base,
        state: "invalid",
        days: null,
        limit: null,
        why: `kind '${item.kind}' desconhecido — declare 'lacuna' ou 'limite'`,
      })
      continue
    }

    const ms = parseAddedAt(item.declaredAt)
    if (ms === null) {
      itens.push({
        ...base,
        state: "invalid",
        days: null,
        limit: null,
        why: "sem `declaredAt` válido (YYYY-MM-DD): uma declaração sem data não tem como envelhecer nem ser reafirmada",
      })
      continue
    }
    const days = Math.floor((now - ms) / MS_PER_DAY)
    if (days < 0) {
      itens.push({
        ...base,
        state: "invalid",
        days,
        limit: null,
        why: `\`declaredAt\` no FUTURO (${item.declaredAt}): a janela começaria no futuro e o item nunca venceria`,
      })
      continue
    }

    // O LIMITE por desenho: datado, sem janela e sem `closedBy` — a fronteira da
    // medição não é uma dívida, e tratá-la como tal abriria issue que ninguém pode
    // fechar.
    if (item.kind === KIND.LIMITE) {
      itens.push({ ...base, state: "declarado", days, limit: null })
      continue
    }

    const pred = CLOSED_BY[item.closedBy]
    if (typeof pred !== "function") {
      itens.push({
        ...base,
        state: "invalid",
        days,
        limit: null,
        why: `\`closedBy\` desconhecido ('${item.closedBy ?? "?"}'): os nomes implementados são ${Object.keys(CLOSED_BY).join(", ")}`,
      })
      continue
    }

    let provado = false
    try {
      provado = Boolean(pred(facts))
    } catch (error) {
      itens.push({
        ...base,
        state: "invalid",
        days,
        limit: null,
        why: `o predicado '${item.closedBy}' não pôde ser avaliado: ${error.message}`,
      })
      continue
    }
    if (provado) {
      itens.push({ ...base, state: "proven", days, limit: null })
      continue
    }

    // A JANELA é a mesma régua das allowlists (uma segunda cópia divergiria).
    const { aged, invalid } = reviewAddedAtEntries([{ addedAt: item.declaredAt, id }], {
      idOf: (e) => e.id,
      now,
      reviewDays,
    })
    if (invalid.length > 0) {
      itens.push({ ...base, state: "invalid", days, limit: null, why: invalid[0].why })
      continue
    }
    itens.push(
      aged.length > 0
        ? { ...base, state: "aged", days, limit: reviewDays }
        : { ...base, state: "open", days, limit: reviewDays },
    )
  }

  const por = (estado) => itens.filter((i) => i.state === estado)
  const invalid = por("invalid")
  const aged = por("aged")
  const provados = por("proven")
  const abertos = por("open")
  const declarados = por("declarado")
  const state = invalid.length
    ? "invalid"
    : aged.length
      ? "aged"
      : abertos.length
        ? "open"
        : provados.length
          ? "proven"
          : declarados.length
            ? "declarado"
            : "sem-itens"

  const resumo =
    itens.length === 0
      ? "nenhum item declarado"
      : `${itens.length} item(ns): ${abertos.length} aberta(s) (janela ${reviewDays}d) · ${declarados.length} limite(s) · ${aged.length} VENCIDA(s) · ${provados.length} provada(s) · ${invalid.length} inválida(s)`
  return {
    state,
    items: itens,
    aged,
    invalid,
    proven: provados,
    open: abertos,
    declarado: declarados,
    total: itens.length,
    reviewAfterDays: reviewDays,
    detail: `${UNPROVEN_REGISTRY_PATH}: ${resumo}`,
  }
}

/**
 * AS LINHAS DATADAS: para cada linha que o veredito publica sobre um item do
 * registro, o sufixo com a DATA e a janela.
 *
 * POR QUE O CASAMENTO É POR TEXTO (e o que o protege): o veredito é escrito em
 * prosa para quem lê, e a declaração datada mora no registro — as duas nascem de
 * lugares diferentes. O `matches` é o trecho ESTÁVEL dessa prosa, e o teste exige
 * que ele case com EXATAMENTE uma linha do relatório de verdade: prosa que muda
 * sem a data quebra o PR em vez de envelhecer calada.
 *
 * POR QUE `matches` PODE SER UMA LISTA (e não uma string só): o MESMO assunto
 * aparece em linhas diferentes conforme o estado medido — a falta do runner do
 * GitHub é um `unknown` ("...nao foi comparado") quando não deu para ler e um
 * BLOQUEIO ("...NAO é o que o setup declara") quando deu. Fixar uma única
 * string faria a data sumir exatamente no estado mais grave. A lista é a lista
 * de TRECHOS ACEITOS: o primeiro que casar com EXATAMENTE uma linha é o que
 * recebe a data, e "nenhum casou" continua sendo a órfã que o teste acusa.
 *
 * AS TRÊS LISTAS, e não só duas: a falta de um runner é `unknown` quando não deu
 * para ler e BLOQUEIO quando deu (`github-self-hosted-runner`, medido). Sem datar
 * os bloqueios, a data sumiria exatamente no estado mais grave — e a declaração
 * ficaria órfã justamente quando ela mais importa.
 *
 * E A DATA VAI EM TODAS AS LINHAS QUE O ITEM DECLARA (``matches`` com mais de um
 * trecho): um assunto pode aparecer em mais de uma linha do MESMO relatório — o
 * `unproven` "o PORTÃO DE MERGE do github" e a linha agregada dos gates daquela
 * forja são a MESMA declaração, e datar só a primeira deixaria a segunda sem
 * saber desde quando existe. Cada trecho continua tendo de casar com UMA linha
 * (a ambigüidade é o que a suíte acusa), e o trecho que não casa nenhuma segue
 * sendo a declaração órfã que o teste pega.
 *
 * @param {{verdict?: {blockers?: string[], unproven?: string[], unknowns?: string[]}}} report
 * @param {object} fato o retorno de `collectUnproven`
 * @returns {{blockers: string[], unproven: string[], unknowns: string[], usados: string[]}}
 */
export function datarLinhas(report, fato) {
  const blockers = [...(report?.verdict?.blockers ?? [])]
  const unproven = [...(report?.verdict?.unproven ?? [])]
  const unknowns = [...(report?.verdict?.unknowns ?? [])]
  const usados = []
  const sufixoDe = (item) =>
    item.state === "aged"
      ? ` [declarado em ${item.declaredAt}, JANELA DE ${item.limit}d VENCIDA — reafirme a data ou feche: ${item.proveWith}]`
      : item.state === "proven"
        ? ` [PROVADO em ${new Date().toISOString().slice(0, 10)} pelo próprio relatório — remova esta entrada do registro]`
        : item.kind === KIND.LIMITE
          ? ` [declarado em ${item.declaredAt} · limite por desenho: ${item.proveWith}]`
          : ` [declarado em ${item.declaredAt}, revisão até +${item.limit}d]`
  // Marca TODAS as linhas da lista que contêm o trecho (a mesma causa pode
  // aparecer repetida — a linha agregada dos gates é uma delas, e a lista de
  // linhas que carrega o assunto é o que o item declara).
  const marcar = (linhas, trecho, item) => {
    let marcou = false
    for (let i = 0; i < linhas.length; i++) {
      if (typeof linhas[i] !== "string" || !linhas[i].includes(trecho)) continue
      linhas[i] = `${linhas[i]}${sufixoDe(item)}`
      marcou = true
    }
    return marcou
  }
  for (const item of fato?.items ?? []) {
    const trechos = matchesDe(item)
    if (trechos.length === 0) continue
    let usou = false
    for (const trecho of trechos) {
      if (marcar(blockers, trecho, item)) usou = true
      if (marcar(unproven, trecho, item)) usou = true
      if (marcar(unknowns, trecho, item)) usou = true
    }
    if (usou) usados.push(item.id)
  }
  return { blockers, unproven, unknowns, usados }
}

/**
 * OS TRECHOS de um item: uma string (o caso comum) ou uma lista de alternativas.
 *
 * Um item sem `matches` não data linha nenhuma — a data dele vive no registro
 * (é o caso dos LIMITES, cuja fronteira não é uma linha do veredito).
 *
 * @param {{matches?: unknown}} item o `matches` do registro, na forma que ele vier
 * @returns {string[]}
 */
export function matchesDe(item) {
  const bruto = item?.matches
  if (typeof bruto === "string") return bruto.length > 0 ? [bruto] : []
  if (Array.isArray(bruto)) return bruto.filter((m) => typeof m === "string" && m.length > 0)
  return []
}

// ── A SEÇÃO PILHA — a dívida do veredito POR COMMIT ──────────────────────────
//
// O prover por commit (`prove-stack-per-commit.mjs`) julga cada commit SOZINHO e
// o vermelho dele tem um motivo MEDIDO. Sem um lugar que diga "este vermelho é
// CONHECIDO", o veredito da pilha trata dívida declarada e regressão nova pela
// mesma palavra — e a palavra perde o sentido: quem lê não sabe se a pilha está
// pior ou se ela sempre foi assim.
//
// A seção `pilha` do MESMO registro (`ci/unproven.json`) declara, POR ASSUNTO de
// commit, o vermelho conhecido e o motivo medido de ele existir. O ASSUNTO é a
// chave porque sobrevive a reescritas de pilha (rebase renomeia TODOS os SHAs —
// a prova de 09/2026 re-apontou 64 citações de SHAs órfãos duas vezes); o SHA
// não sobrevive. O casamento é EXATO por assunto; o caso do assunto que
// CONTINUOU (prefixo) é classificado à parte — é a mesma dívida, mas o registro
// precisa ser re-ancorado para o casamento exato voltar.
//
// FAIL-CLOSED nos DOIS lados: registro ausente/ilegível/inválido NÃO transforma
// vermelho em regressão ("não consegui ler" não é "não declarou") — fica
// NÃO CLASSIFICADO, nomeado; e um assunto declarado que a medição não alcançou
// não é dívida queimada nem regressão — é registro de outra história (ou de uma
// pilha já fechada), e é DITO.

/**
 * LÊ a seção `pilha` do registro. `null` sem erro = o registro existe e é
 * válido, mas não declara a seção (o caso comum de um repositório sem dívida
 * de pilha) — diferente de ilegível, que vem com `erro` nomeado.
 *
 * @param {{root?: string, deps?: {exists?: Function, read?: Function}}} [options]
 * @returns {{entrada: {base: string|null, declaredAt: string|null, reviewAfterDays: number|null, commits: Array<{subject: string, reason: string, declaredAt: string}>}|null, erro: string|null}}
 */
export function lerSecaoPilha({ root = REPO_ROOT, deps = {} } = {}) {
  const exists = deps.exists ?? existsSync
  const read = deps.read ?? ((path) => readFileSync(path, "utf8"))
  const caminho = isAbsolute(UNPROVEN_REGISTRY_PATH)
    ? UNPROVEN_REGISTRY_PATH
    : resolve(root, UNPROVEN_REGISTRY_PATH)
  if (!exists(caminho)) {
    return {
      entrada: null,
      erro: `o registro não existe: ${UNPROVEN_REGISTRY_PATH}`,
    }
  }
  let json
  try {
    json = JSON.parse(read(caminho))
  } catch (error) {
    return {
      entrada: null,
      erro: `o registro não é JSON válido (${UNPROVEN_REGISTRY_PATH}): ${error.message}`,
    }
  }
  if (json === null || typeof json !== "object" || Array.isArray(json)) {
    return {
      entrada: null,
      erro: `o registro não é um objeto (${UNPROVEN_REGISTRY_PATH})`,
    }
  }
  if (json.pilha === undefined) return { entrada: null, erro: null }
  const secao = json.pilha ?? {}
  if (typeof secao !== "object" || Array.isArray(secao)) {
    return {
      entrada: null,
      erro: `a seção 'pilha' não é um objeto (${UNPROVEN_REGISTRY_PATH})`,
    }
  }
  if (!Array.isArray(secao.commits)) {
    return {
      entrada: null,
      erro: `a seção 'pilha' não declara 'commits' como array (${UNPROVEN_REGISTRY_PATH})`,
    }
  }
  const commits = []
  for (let i = 0; i < secao.commits.length; i++) {
    const c = secao.commits[i] ?? {}
    const onde = `pilha.commits[${i}]`
    if (typeof c.subject !== "string" || c.subject.length === 0) {
      return {
        entrada: null,
        erro: `${onde} sem 'subject' (o ASSUNTO é a chave — o SHA não sobrevive a reescrita de pilha)`,
      }
    }
    if (typeof c.reason !== "string" || c.reason.length === 0) {
      return {
        entrada: null,
        erro: `${onde} sem 'reason' — um vermelho declarado sem o motivo medido é dívida anônima`,
      }
    }
    if (parseAddedAt(c.declaredAt) === null) {
      return { entrada: null, erro: `${onde} sem 'declaredAt' válido (YYYY-MM-DD)` }
    }
    if (commits.some((d) => d.subject === c.subject)) {
      return {
        entrada: null,
        erro: `${onde} declara o assunto DUAS VEZES — o casamento é por assunto e a duplicata o tornaria ambíguo`,
      }
    }
    commits.push({ subject: c.subject, reason: c.reason, declaredAt: c.declaredAt })
  }
  return {
    entrada: {
      base: typeof secao.base === "string" ? secao.base : null,
      declaredAt: typeof secao.declaredAt === "string" ? secao.declaredAt : null,
      reviewAfterDays: Number.isInteger(secao.reviewAfterDays) ? secao.reviewAfterDays : null,
      commits,
    },
    erro: null,
  }
}

/**
 * SEPARA os vermelhos medidos entre DÍVIDA DECLARADA e REGRESSÃO — a leitura do
 * registro que o veredito da pilha publica.
 *
 * Os BALDES, cada um nomeado no veredito:
 *   `divida`     — o assunto do vermelho é EXATAMENTE um assunto declarado;
 *   `reancorar`  — o assunto do vermelho COMEÇA com um assunto declarado (o
 *                  commit continuou e o assunto mudou): a MESMA dívida, mas o
 *                  registro precisa do casamento exato de volta;
 *   `regressao`  — nenhum assunto declarado alcança o vermelho: é o que o
 *                  veredito nomeia como regressão de verdade;
 *   `alheios`    — assuntos declarados que a medição não alcançou (outra
 *                  história, pilha já fechada): nem dívida queimada nem
 *                  regressão — e o silêncio sobre eles seria o verde falso do
 *                  registro;
 *   `naoClassificados` — quando o registro não pôde julgar (ausente, ilegível,
 *                  inválido): "não consegui ler" NUNCA vira "não declarou" —
 *                  virar regressão seria o falso positivo que esta separação
 *                  existe para não cuspir.
 *
 * @param {{vermelhos: Array<{sha: string, assunto: string, motivo: string|null}>, secao: {entrada: object|null, erro: string|null}|null}} p
 * @returns {{estado: "medido"|"sem-registro"|"registro-ilegivel", divida: Array, reancorar: Array, regressao: Array, alheios: string[], naoClassificados: Array, erro: string|null}}
 */
export function separarDividaDeRegressao({ vermelhos = [], secao = null }) {
  const limpo = Array.isArray(vermelhos)
    ? vermelhos.filter((v) => v && typeof v.assunto === "string")
    : []
  if (!secao || secao.erro) {
    return {
      estado: "registro-ilegivel",
      divida: [],
      reancorar: [],
      regressao: [],
      alheios: [],
      naoClassificados: limpo,
      erro: secao?.erro ?? "a seção `pilha` não pôde ser lida",
    }
  }
  if (!secao.entrada) {
    return {
      estado: "sem-registro",
      divida: [],
      reancorar: [],
      regressao: [],
      alheios: [],
      naoClassificados: limpo,
      erro: null,
    }
  }
  const declarados = secao.entrada.commits
  const divida = []
  const reancorar = []
  const regressao = []
  const usados = new Set()
  for (const v of limpo) {
    const exato = declarados.find((d) => d.subject === v.assunto)
    if (exato) {
      divida.push({ ...v, declaredAt: exato.declaredAt, reason: exato.reason })
      usados.add(exato.subject)
      continue
    }
    const prefixo = declarados.find((d) => v.assunto.startsWith(d.subject))
    if (prefixo) {
      reancorar.push({ ...v, declaredAt: prefixo.declaredAt, reason: prefixo.reason })
      usados.add(prefixo.subject)
      continue
    }
    regressao.push({
      ...v,
      pista: "nenhuma dívida da seção `pilha` do registro declara este assunto",
    })
  }
  const alheios = declarados.filter((d) => !usados.has(d.subject)).map((d) => d.subject)
  return {
    estado: "medido",
    divida,
    reancorar,
    regressao,
    alheios,
    naoClassificados: [],
    erro: null,
  }
}

// ── CLI ────────────────────────────────────────────────────────────────────

export function parseArgs(argv) {
  const opts = { root: REPO_ROOT, json: false, error: null }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--json") opts.json = true
    else if (arg === "--root") {
      const valor = argv[++i]
      if (valor === undefined) opts.error = "--root exige um diretório"
      else opts.root = valor
    } else opts.error = `argumento desconhecido: ${arg}`
  }
  return opts
}

function main(argv) {
  const opts = parseArgs(argv)
  if (opts.error) {
    console.error(`❌ ${opts.error}`)
    process.exit(EXIT.USAGE)
  }
  if (!existsSync(opts.root) || !statSync(opts.root).isDirectory()) {
    console.error(`❌ --root não é um diretório: ${opts.root}`)
    process.exit(EXIT.UNAVAILABLE)
  }
  const fato = collectUnproven({ root: opts.root })
  if (opts.json) console.log(JSON.stringify(fato, null, 2))
  else {
    console.log(`  ${fato.detail}`)
    for (const item of fato.items) {
      const marca =
        item.state === "aged"
          ? "⚠️ "
          : item.state === "invalid"
            ? "❌"
            : item.state === "proven"
              ? "✅"
              : "·"
      console.log(
        `  ${marca} ${item.id.padEnd(26)} ${item.state.padEnd(10)} ${item.declaredAt ?? "?"}${item.kind === KIND.LIMITE ? " (limite)" : ""}`,
      )
      if (item.subject) console.log(`      ${item.subject}`)
      if (item.state === "aged") console.log(`      ➜ ${item.remedy} · prova: ${item.proveWith}`)
      if (item.state === "proven")
        console.log("      ➜ a declaração ficou letra morta: remova a entrada do registro")
      if (item.why) console.log(`      ➜ ${item.why}`)
    }
  }
  process.exit(fato.state === "invalid" || fato.state === "unread" ? EXIT.VIOLATIONS : EXIT.OK)
}

const IS_DIRECT_RUN =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
if (IS_DIRECT_RUN) main(process.argv.slice(2))
