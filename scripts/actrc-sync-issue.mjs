#!/usr/bin/env node

// =============================================================================
// actrc-sync-issue.mjs
//
// Transforma o drift dos ESPELHOS de BUN_VERSION (`.actrc`,
// `deploy/env.gitea.example` e o `deploy/.env.gitea` do host) em uma ISSUE
// ACIONÁVEL no lado GitHub.
//
// POR QUE ISSO PRECISA EXISTIR (defeito real, medido): o job semanal
// `actrc-sync` do `benchmark-weekly.yml` rodava `check-actrc-sync.mjs` sem
// `--fail`, então o drift saía como `::warning::` dentro de um run VERDE. A
// documentação (`docs/GUARDS.md` §2) e o header do job da forja diziam que "no
// GitHub o alerta acionável é a ISSUE aberta pelo job irmão" — e **não existia
// job irmão nenhum**: um alerta MUDO, exatamente o que o
// `required-checks-drift-issue.mjs` e o `readme-reverse-issue.mjs` existem para
// evitar. Ninguém abre o log de um cron que ficou verde.
//
// POR QUE O DRIFT IMPORTA (e por que ele é invisível sem este script): nenhum
// dos espelhos governa corretude de CI. O `.actrc` é a dev experience do act
// local; o env da forja alimenta a LABEL do runner. Divergir não deixa nenhum
// gate vermelho — só faz o act testar outra versão e o tier-1 (fast path de 0s)
// do setup-bun desligar na forja, com todo job voltando a pagar o download.
//
// FONTE ÚNICA DAS REGRAS: este script NÃO reimplementa a comparação — ele
// importa `mirrorDriftReport` do `check-actrc-sync.mjs`. Assim a issue e o log
// não podem discordar: quem decide o que é drift é uma função só.
//
// E O OUTRO LADO DA DÍVIDA (defeito descoberto neste turno): publicar sem
// FECHAR deixa a issue ABERTA depois de resolvida — uma dívida que mente. Quem
// abrir o board acha que o drift existe; o próximo bump é investigado duas
// vezes; e um alerta que o procedimento documentado não consegue limpar acaba
// ignorado (é o mesmo raciocínio que o `docs/GUARDS.md` §2 usa para o leitor
// sem escritor). Então, quando o diagnóstico NÃO tem aviso nenhum, este script
// RECONCILIA: comenta o que foi comparado (a prova) e fecha as issues que ELE
// abriu. A informação não se perde — se o drift voltar, a mesma regra abre uma
// issue nova com a assinatura do momento (dedup é entre as ABERTAS).
//
// Só fecha o que é NOSSO: issue que carregue o marcador deixado por este
// script. Uma issue que ganhou o label por engano é reportada no log e fica
// intocada — fechar ticket alheio por causa de um label é pior que não fechar.
//
// Fluxo:
//   1. calcula o diagnóstico (mesma função do guard);
//   2. sem avisos → RECONCILIA (fecha as dívidas abertas por este script) e sai 0;
//   3. assinatura ESTÁVEL do drift (os próprios avisos, ordenados) e dedup
//      contra issues abertas com o label — no corpo E nos COMENTÁRIOS (um drift
//      que mudou é comentado UMA vez, não toda semana): cron semanal não vira
//      ruído;
//   4. cria a issue (ou comenta numa aberta) com o que divergiu e o remédio.
//
// Usage:
//   node scripts/actrc-sync-issue.mjs --expected 1.3.14 \
//     --expected-var IMAGE_REGISTRY=ghcr.io --expected-var IMAGE_NAMESPACE=severinno
//   node scripts/actrc-sync-issue.mjs --expected 1.3.14 --gitea-env /opt/gitea/.env
//   node scripts/actrc-sync-issue.mjs --expected 1.3.14 --dry-run
//   node scripts/actrc-sync-issue.mjs --report /tmp/actrc-sync-drift.json --backend gitea
//
// Exit codes:
//   0 — sem drift (e a dívida aberta foi fechada), ou issue criada/comentada,
//       ou já reportada (ou dry-run)
//   1 — erro real: falta `--expected`, ou falha do `gh` (fail-closed nos DOIS
//       sentidos: um drift que não pôde ser publicado é o mesmo alerta mudo de
//       antes, e uma dívida resolvida que não pôde ser fechada continua mentindo
//       no board)
// =============================================================================

import { spawnSync } from "node:child_process"
import process from "node:process"
import { pathToFileURL } from "node:url"
import { readFileSync, existsSync } from "node:fs"

import { MIRROR_VARIABLES, mirrorDriftReport } from "./check-actrc-sync.mjs"
import {
  bodyHasMarker,
  bodyHasSignature,
  defineDebtPublisher,
  issueBodies,
  makeGithubBackend,
  selectIssueBackend,
  publisherBody,
  publisherHasSignature,
  publisherMarker,
  publisherMarkerPrefix,
  publisherOwns,
  reconcilePublisherDebt,
  runDebtPublisher,
} from "./issue-publish.mjs"

/** Label de triagem (dedup + filtro no board). */
export const ISSUE_LABEL = "actrc-sync-drift"
export const ISSUE_LABEL_COLOR = "D93F0B"
export const ISSUE_LABEL_DESCRIPTION =
  "Drift dos espelhos de BUN_VERSION entre .actrc, env.gitea.example e repository variables"

/**
 * Título ESTÁVEL entre runs — de propósito NÃO inclui a versão nem os arquivos
 * que driftaram (isso vai no corpo): um título que muda a cada bump abriria uma
 * issue nova por drift em vez de comentar na dívida já aberta.
 */
export function driftTitle() {
  return (
    "Espelhos da imagem do runner (BUN_VERSION, IMAGE_REGISTRY, IMAGE_NAMESPACE)" +
    " fora de sincronia com as repository variables"
  )
}

/**
 * Assinatura estável do drift: os avisos, ordenados. Duas runs com o MESMO
 * drift produzem a MESMA assinatura (dedup); um drift DIFERENTE (outra versão,
 * outro arquivo) produz outra — e aí comentar é o comportamento certo, porque a
 * dívida mudou.
 *
 * @param {{warnings: string[]}} report
 * @returns {string}
 */
export function signatureOf(report) {
  return [...(report?.warnings ?? [])].sort().join("\n")
}

/**
 * O identificador do marcador na issue (o dedup é POR publicador: um drift de
 * espelhos nunca pode ser confundido com o veredito do doctor ou com o drift de
 * branch protection).
 */
export const ACTRC_MARKER_ID = "actrc-sync-drift"

/**
 * O CONTRATO deste publicador (`issue-publish.mjs`).
 *
 * POR QUE ELE EXISTE: o ciclo (publicar, deduplicar por assinatura, comentar no
 * título já aberto, criar, COMENTAR a prova antes de fechar) não mora mais
 * neste arquivo — mora no contrato, um só para todos os publicadores.
 *
 * O QUE FICA DECLARADO AQUI: a etiqueta, o FORMATO do marcador (`b64`: a
 * assinatura são os avisos, que têm quebra de linha), o título estável, a
 * assinatura (os próprios avisos, ordenados), a prosa, quando há dívida, o
 * ESCOPO (uma issue para o problema — o drift é UM estado, não um item por
 * arquivo) e o FECHAMENTO (o comentário de prova + o motivo).
 */
export const ACTRC_PUBLISHER = defineDebtPublisher({
  name: ACTRC_MARKER_ID,
  label: ISSUE_LABEL,
  labelColor: "FBCA04",
  labelDescription:
    "Espelhos (BUN_VERSION/IMAGE_REGISTRY/IMAGE_NAMESPACE) divergentes das repository variables",
  marker: { id: ACTRC_MARKER_ID, format: "b64" },
  title: () => driftTitle(),
  signature: (report) => signatureOf(report),
  body: (report) => driftProse(report),
  actionable: (report) => signatureOf(report) !== "",
  scope: { kind: "single" },
  resolution: {
    comment: (report) => resolutionComment(report),
    reason: "os espelhos voltaram a concordar (dívida caducou)",
  },
  prose: {
    actionable: (report) =>
      `⚠️  Drift detectado (${(report?.warnings ?? []).length} aviso(s)) — publicando issue acionável.`,
    inSync: (report) =>
      "✅ Sem drift: os espelhos concordam com as repository variables comparadas" +
      ` (${Object.keys(report?.expectedVars ?? {})
        .filter((n) => report.expectedVars[n] !== null && report.expectedVars[n] !== "")
        .join(", ")}).`,
    alreadyReported: (issue) =>
      `ℹ️  Drift idêntico já reportado na issue #${issue.number} — sem ruído.`,
    commented: (issue) => `✅ Comentário adicionado à issue #${issue.number} (drift novo).`,
    reconciled: (count) =>
      `🔒 Reconciliado: ${count} issue(s) de drift fechada(s) — a dívida não fica aberta depois de resolvida.`,
    dryRunTail: () => "\n(dry-run: nenhuma chamada ao gh)",
    dryRunReconcile: () =>
      `   (dry-run: nenhuma chamada ao gh — a reconciliação fecharia as issues abertas por este script, label '${ISSUE_LABEL}', com a prova no comentário)`,
  },
})

/** O backend do GitHub com a etiqueta DESTE publicador (uma fonte: o contrato). */
function githubBackendFor(ghFn = gh) {
  return makeGithubBackend({
    gh: ghFn,
    label: ACTRC_PUBLISHER.label,
    color: ACTRC_PUBLISHER.labelColor,
    description: ACTRC_PUBLISHER.labelDescription,
  })
}

/**
 * Marcador HTML invisível que carrega a assinatura dentro do corpo da issue.
 *
 * A REGRA (formato do marcador + decisão de dedup + o ciclo de fechar quando
 * resolve) é a de `issue-publish.mjs` — aqui fica só o id deste publicador, para
 * a mecânica não ter duas cópias. Duas cópias divergem no dia em que o formato
 * mudar, e aí o fechamento automático de um publicador para de enxergar as
 * issues do outro.
 */
export function markerOf(signature) {
  return publisherMarker(ACTRC_PUBLISHER, signature)
}

/**
 * `true` se `body` (um corpo de texto) já carrega o marcador desta assinatura.
 *
 * O chamador de issue usa `issueHasSignature`, que cobre corpo + comentários.
 */
export function hasSignature(body, signature) {
  return bodyHasSignature(ACTRC_PUBLISHER, body, signature)
}

/** Prefixo de QUALQUER marcador nosso (a assinatura vem depois dos `:`). */
export const MARKER_PREFIX = publisherMarkerPrefix(ACTRC_PUBLISHER)

/**
 * `true` se o corpo foi escrito por ESTE script (carrega um marcador nosso, de
 * qualquer assinatura).
 *
 * POR QUE NÃO BASTA O LABEL: label é etiqueta de triagem — alguém pode aplicá-lo
 * numa issue que não é de drift, e fechar ticket alheio por causa de uma etiqueta
 * é pior que deixar a dívida aberta. O marcador é a assinatura de quem escreveu.
 *
 * @param {unknown} body
 * @returns {boolean}
 */
export function hasAnyMarker(body) {
  return bodyHasMarker(ACTRC_PUBLISHER, body)
}

/**
 * Os corpos que uma issue carrega: o principal MAIS os comentários.
 *
 * POR QUE OS COMENTÁRIOS CONTAM (defeito real, achado por teste de runs
 * repetidas): o marcador do drift NÃO vive só no corpo da issue. O primeiro
 * drift abre a issue (marcador no corpo); um drift DIFERENTE — outra versão,
 * outro arquivo — vira COMENTÁRIO, e o marcador fica lá. Comparar a assinatura
 * apenas com o corpo faz a run seguinte ver "assinatura desconhecida", não
 * achar o comentário da run anterior e comentar de novo: **todo cron semanal
 * repetiria o mesmo comentário para sempre**, que é exatamente o ruído que o
 * dedup existe para impedir. Pelo mesmo motivo o reconciliador precisa destes
 * corpos: uma issue nossa cujo marcador mora num comentário seria tratada como
 * ALHEIA e nunca fecharia.
 *
 * A implementação é a COMPARTILHADA (`issue-publish.mjs`) — reexportada para os
 * testes e o `main` deste script não mudarem de contrato.
 */
export { issueBodies }

/** `true` se a issue já carrega ESTA assinatura (no corpo ou num comentário). */
export function issueHasSignature(issue, signature) {
  return publisherHasSignature(issue, ACTRC_PUBLISHER, signature)
}

/** `true` se a issue foi escrita por ESTE script (marcador em qualquer corpo). */
export function issueHasAnyMarker(issue) {
  return publisherOwns(issue, ACTRC_PUBLISHER)
}

/**
 * O remédio DIFERE por espelho, e a diferença é o ponto:
 *   - `.actrc` → atualizar a flag (é o act local);
 *   - template comitado → o `bump-bun.sh` escreve os dois espelhos de uma vez;
 *   - `deploy/.env.gitea` (host) → atualizar o arquivo que o compose lê **e
 *     re-registrar** o runner: os labels são estado do REGISTRO (`/data/.runner`),
 *     então `restart` não aplica a troca.
 *
 * `names` são as variáveis que driftaram NAQUELE espelho: o `bump-bun.sh` só
 * escreve a VERSÃO — para `IMAGE_REGISTRY`/`IMAGE_NAMESPACE` não há script de
 * bump, e mandá-lo resolveria uma variável e deixaria a outra.
 *
 * @param {{deployed: boolean}} mirror
 * @param {string[]} [names] variáveis divergentes no espelho (default: a versão)
 * @returns {string}
 */
export function remedyFor(mirror, names = ["BUN_VERSION"]) {
  if (mirror.deployed) {
    return (
      "`deploy/.env.gitea` é o arquivo que o compose lê (`--env-file`) — atualize-o" +
      " **e re-registre o runner** (`bash deploy/gitea-up.sh --re-register`): os labels" +
      " são estado do registro em `/data/.runner`, então um `restart` não aplica a troca."
    )
  }
  const bun =
    "`bash scripts/bump-bun.sh <versão>` escreve a variável e os dois espelhos" + " de uma vez."
  const imagem =
    "`IMAGE_REGISTRY`/`IMAGE_NAMESPACE` **não têm script de bump**: ajuste o template," +
    " mantenha o `.env.gitea` do host igual a ele (é o arquivo que o compose lê) e" +
    " alinhe a repository variable."
  const parts = [
    "`deploy/env.gitea.example` é o template comitado de onde o `.env.gitea` do VPS deriva.",
  ]
  if (names.includes("BUN_VERSION")) parts.push(bun)
  if (names.some((n) => n !== "BUN_VERSION")) parts.push(imagem)
  return parts.join(" ")
}

/**
 * As flags que REPRODUZEM a comparação desta run.
 *
 * POR QUE NÃO SÓ `--expected`: o guard compara TODAS as variáveis que o compose
 * consome. Um comando que passa apenas a versão reproduz uma comparação MENOR
 * que a que abriu a issue — quem o seguir pode não achar o drift e concluir que
 * a dívida não existe. As variáveis SEM valor ficam de fora de propósito:
 * `null` é "não perguntado", e escrevê-las como `NOME=` as apresentaria como
 * drift de variável não configurada.
 *
 * @param {{expectedVars?: Record<string, string|null>}} report
 * @returns {string} " --expected-var NOME=VALOR ..." (vazio quando não há)
 */
export function expectedVarFlags(report) {
  const flags = []
  for (const [name, value] of Object.entries(report?.expectedVars ?? {})) {
    if (name === "BUN_VERSION") continue
    if (value === null || value === undefined || value === "") continue
    flags.push(`--expected-var ${name}=${value}`)
  }
  return flags.length > 0 ? ` ${flags.join(" ")}` : ""
}

/**
 * As variáveis da imagem comparadas por VALOR, com o valor de CADA espelho (a
 * prova de que a comparação de valor deixou de ser só da versão).
 *
 * @param {object} report
 * @returns {string[]}
 */
export function comparedImageLines(report) {
  const lines = []
  for (const [name, expected] of Object.entries(report?.expectedVars ?? {})) {
    if (name === "BUN_VERSION") continue
    if (expected === null || expected === undefined || expected === "") continue
    const mirrors = (report.mirrors ?? []).map(
      (m) => `\`${m.label}\`=\`${m.values?.[name] ?? "<ausente>"}\``,
    )
    lines.push(
      `- \`${name}\`: esperado \`${expected}\` — ${
        mirrors.length > 0 ? mirrors.join(", ") : "nenhum espelho de env descoberto"
      }`,
    )
  }
  return lines
}

/**
 * O espelho diverge de ALGUMA variável com valor esperado? (decide o remédio por
 * espelho — um espelho sem divergência não ganha um passo de correção).
 *
 * @param {{values?: Record<string, string|null>, version?: string|null, deployed?: boolean}} mirror
 * @param {object} report
 * @returns {boolean}
 */
function mirrorDiverges(mirror, report) {
  // O veredito por espelho vem DO GUARD (`mirror.drift`): recomparar aqui seria
  // a segunda comparação que este repositório recusa.
  if (Array.isArray(mirror?.drift)) return mirror.drift.length > 0
  const expected = report?.expectedVars ?? { BUN_VERSION: report?.expected ?? null }
  for (const [name, want] of Object.entries(expected)) {
    if (want === null || want === undefined || want === "") continue
    const got = mirror?.values
      ? (mirror.values[name] ?? null)
      : name === "BUN_VERSION"
        ? (mirror?.version ?? null)
        : undefined
    if (got === undefined) continue
    if (got !== want) return true
  }
  return false
}

/**
 * As variáveis que a run NÃO comparou (sem valor passado) — o escopo que o
 * fechamento e a publicação têm de declarar: "os espelhos concordam" só é prova
 * do que foi de fato comparado.
 *
 * @param {object} report
 * @returns {string[]}
 */
export function unprovenVariables(report) {
  return [...(report?.unproven ?? [])]
}

/**
 * A PROSA do corpo da issue — sem o marcador: quem o compõe é o contrato
 * (`publisherBody`), para não existir um publicador que esqueça de escrevê-lo e
 * publique uma dívida que o fechamento automático depois não reconheça.
 */
function driftProse(report) {
  const lines = []
  // Variável AUSENTE é o drift mais grave E pede remédio diferente: não há
  // "versão certa" para alinhar os espelhos (o `bump-bun.sh` com versão vazia
  // seria uma instrução sem sentido). O que falta é CRIAR a variável.
  const comparedNames = Object.entries(report?.expectedVars ?? {})
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .map(([name]) => name)
  lines.push(
    report.expected
      ? `Os espelhos do runner divergem de **\`vars.BUN_VERSION='${report.expected}'\`**` +
          (comparedNames.length > 1
            ? ` — o guard compara o VALOR de todas as variaveis que o compose consome (\`${comparedNames.join("`, `")}\`)`
            : "") +
          " (repository variables — a fonte única)."
      : "A repository variable **`vars.BUN_VERSION` NÃO está configurada** no repositório" +
          " — e os espelhos apontam para uma versão que ninguém declarou.",
  )
  lines.push("")
  lines.push(
    "Nenhum dos espelhos governa corretude de CI: o `.actrc` é a dev experience do" +
      " `act`, e o env da forja alimenta a **label do runner**. Divergir não deixa" +
      " nenhum gate vermelho — só faz o `act` testar outro caminho (versão/registry) e" +
      " a **label do runner** apontar para uma imagem que o repositório não declara:" +
      " o **tier-1** (fast path de 0s) do setup-bun desliga em silêncio (todo job" +
      " volta a pagar o download, ~1-3s pelo mirror, ~5-10s pelo release) e o pull da" +
      " imagem só falha quando um job tenta iniciar. O sintoma aparece longe da causa.",
  )
  lines.push("")

  lines.push("### O que foi comparado")
  lines.push("")
  lines.push(`- \`.actrc\`: \`${report.actrcVersion ?? "<sem BUN_VERSION>"}\``)
  for (const mirror of report.mirrors) {
    const kind = mirror.deployed ? "host" : "template comitado"
    lines.push(`- \`${mirror.label}\` (${kind}): \`${mirror.version ?? "<sem BUN_VERSION>"}\``)
  }
  // As OUTRAS variáveis que o compose consome e cujo valor foi comparado — a
  // comparação deixou de ser só da versão, e o ticket tem de mostrar isso.
  lines.push(...comparedImageLines(report))
  const unproven = unprovenVariables(report)
  if (unproven.length > 0) {
    lines.push(
      `- \u26a0\ufe0f o VALOR de \`${unproven.join("`, `")}\` **NÃO foi comparado nesta run**` +
        ` (nenhum valor passado: \`--expected-var NOME=VALOR\`) — a comparação de valor` +
        " deixaria de cobrir essas variáveis em silêncio",
    )
  }
  lines.push("")

  lines.push("### Divergências")
  lines.push("")
  for (const warning of report.warnings) lines.push(`- ${warning}`)
  lines.push("")

  const drifted = report.mirrors.filter((m) => mirrorDiverges(m, report))
  if (drifted.length > 0) {
    lines.push("### Corrigir (o remédio difere por espelho)")
    lines.push("")
    for (const mirror of drifted) {
      // Quais variáveis driftaram NAQUELE arquivo: o `bump-bun.sh` só escreve a
      // versão — mandá-lo para um drift de registry/namespace resolveria uma
      // variável e deixaria a outra.
      const names = [
        ...new Set((report.drift ?? []).filter((d) => d.label === mirror.label).map((d) => d.name)),
      ]
      lines.push(
        `- \`${mirror.label}\`: ${remedyFor(mirror, names.length > 0 ? names : ["BUN_VERSION"])}`,
      )
    }
    lines.push("")
  }

  if (report.expected) {
    lines.push("```bash")
    lines.push(`bash scripts/bump-bun.sh ${report.expected}   # variável + os dois espelhos`)
    lines.push(
      "node scripts/check-actrc-sync.mjs --expected " +
        report.expected +
        expectedVarFlags(report) +
        "   # reexibe este drift",
    )
    lines.push("```")
    lines.push("")
    lines.push(
      "> Se o valor certo é OUTRO (a variável mudou de propósito), atualize a" +
        " repository variable e rode o `bump-bun.sh` com a versão nova — não alinhe os" +
        " espelhos com uma versão que a imagem do registry não tem.",
    )
  } else {
    lines.push("### Corrigir")
    lines.push("")
    lines.push(
      "Crie a variável em **Settings → Secrets and variables → Actions → Variables →" +
        " New repository variable**, com o nome `BUN_VERSION` e o valor da versão que a" +
        " imagem do runner embarca. Depois alinhe os espelhos com ela:" +
        " `bash scripts/bump-bun.sh <versão>`.",
    )
  }
  lines.push("")
  return lines.join("\n")
}

/** O corpo COMPLETO da issue: a prosa + o marcador, como o contrato os compõe. */
/**
 * Corpo da issue em markdown: o que divergiu (por espelho), a consequência e o
 * comando que resolve. Sem isso a issue só diz "tem drift" e transfere a
 * investigação para quem lê.
 *
 * @param {import("./check-actrc-sync.mjs").MirrorDriftReport} report
 * @returns {string}
 */
export function driftBody(report) {
  return publisherBody(ACTRC_PUBLISHER, report)
}

/**
 * O comentário de RESOLUÇÃO — o que a issue passa a contar quando é fechada.
 *
 * Tem de carregar a PROVA (os espelhos comparados, com o valor de cada um), não
 * só "resolvido": quem chegar depois lê o desfecho sem ter de reconstruir o
 * estado do mundo na data do fechamento. E tem de dizer o ESCOPO, porque o
 * fechamento automático roda onde o guard roda: num runner do GitHub o
 * `deploy/.env.gitea` do VPS não existe (gitignored), então o espelho do host
 * fica fora da comparação — e isso é uma limitação do fechamento, não um
 * detalhe.
 *
 * @param {import("./check-actrc-sync.mjs").MirrorDriftReport} report
 * @returns {string}
 */
export function resolutionComment(report) {
  const lines = []
  lines.push(
    `✅ **Resolvido** — os espelhos voltaram a concordar com \`vars.BUN_VERSION='${report.expected}'\`` +
      " e com as demais variáveis listadas na prova abaixo.",
  )
  lines.push("")
  lines.push("### O que foi comparado agora (a prova)")
  lines.push("")
  lines.push(`- \`.actrc\`: \`${report.actrcVersion ?? "<sem BUN_VERSION>"}\``)
  for (const mirror of report.mirrors) {
    const kind = mirror.deployed ? "host" : "template comitado"
    lines.push(`- \`${mirror.label}\` (${kind}): \`${mirror.version ?? "<sem BUN_VERSION>"}\``)
  }
  lines.push(...comparedImageLines(report))
  if (report.mirrors.length === 0) {
    lines.push(
      "- nenhum arquivo de env da forja foi descoberto neste checkout — só o `.actrc` entrou na comparação",
    )
  }
  const unproven = unprovenVariables(report)
  if (unproven.length > 0) {
    lines.push(
      `- o VALOR de \`${unproven.join("`, `")}\` **não entrou** nesta comparação` +
        " (nenhum valor passado) — o fechamento vale para o que foi COMPARADO, e o" +
        " resto segue aberto: confira com `--expected-var NOME=VALOR`",
    )
  }
  lines.push("")
  lines.push("```bash")
  lines.push(
    `node scripts/check-actrc-sync.mjs --expected ${report.expected}${expectedVarFlags(report)}   # exit 0 = em sincronia`,
  )
  lines.push("```")
  lines.push("")
  lines.push(
    "> **Escopo deste fechamento:** num runner do GitHub o `deploy/.env.gitea` do" +
      " VPS não existe (é gitignored), então o espelho do **host** não entra na" +
      " comparação de lá — esta issue foi fechada porque OS ESPELHOS COMPARADOS" +
      " concordam. Se a dívida veio do arquivo do host, confirme no VPS:" +
      " `bun run doctor --gitea-env /opt/gitea/.env` (ou suba o runner com" +
      " `bash deploy/gitea-up.sh --re-register`).",
  )
  lines.push("")
  lines.push(
    "> Fechada automaticamente: se o drift voltar, a mesma regra abre uma issue nova" +
      " com a assinatura do momento (o dedup é entre as ABERTAS).",
  )
  return lines.join("\n")
}

// ---------------------------------------------------------------------------
// gh CLI
// ---------------------------------------------------------------------------

function gh(args, { input } = {}) {
  return spawnSync("gh", args, { encoding: "utf8", input, env: process.env })
}

/**
 * A RECONCILIAÇÃO: sem aviso nenhum, a dívida que a issue representa caducou.
 *
 * COMENTA ANTES DE FECHAR, e de propósito: o comentário é a prova, e ele entra
 * numa issue ainda aberta — se o `gh` falhar no meio, o pior caso é uma dívida
 * aberta COM a prova anexada (nada mentiu), nunca uma issue fechada em silêncio
 * sem dizer por quê.
 *
 * @param {{report: object, gh?: Function, backend?: object, log?: Function}} args
 * @returns {{closed: number[], foreign: number[], alreadyClear: boolean}}
 */
export function reconcileDebt({ report, gh: ghFn = gh, backend, log = console.log } = {}) {
  // O ciclo (listar, separar o que é NOSSO do que é alheio, COMENTAR a prova,
  // fechar, fail-closed nos dois passos) é do CONTRATO: quem define o que é
  // nosso (o marcador declarado), o que caducou (o escopo: `single` fecha todas
  // as minhas quando o drift sumiu) e a prova é o `ACTRC_PUBLISHER`. O `gh`
  // continua injetável porque os testes do ciclo o dublam.
  return reconcilePublisherDebt({
    publisher: ACTRC_PUBLISHER,
    input: report,
    backend: backend ?? githubBackendFor(ghFn),
    log,
  })
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * Lê um relatório JSON produzido por `check-actrc-sync.mjs --json`.
 *
 * O formato espelha `MirrorDriftReport` mas pode ter campos extras do JSON
 * (como `hasDrift`, `exitCode`). Extraímos só o que o ciclo de issue precisa.
 *
 * @param {string} reportPath
 * @returns {import("./check-actrc-sync.mjs").MirrorDriftReport}
 */
function readReportFile(reportPath) {
  if (!existsSync(reportPath)) {
    throw new Error(`relatório não encontrado: ${reportPath}`)
  }
  const raw = readFileSync(reportPath, "utf8")
  const json = JSON.parse(raw)
  // Validação mínima: o relatório precisa ter a forma de MirrorDriftReport
  if (!Array.isArray(json.warnings)) {
    throw new Error(`relatório inválido: campo 'warnings' não é array (${reportPath})`)
  }
  return json
}

function parseArgs(argv) {
  const options = {
    expected: null,
    expectedVars: {},
    actrc: null,
    envFile: null,
    dryRun: false,
    backend: "github",
    report: null,
    help: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--expected") options.expected = argv[++i] ?? null
    else if (arg === "--expected-var") {
      // O mesmo formato/validação do guard: um nome fora do conjunto comparado
      // seria uma variável "conferida" que ninguém lê de espelho nenhum.
      const raw = argv[++i] ?? ""
      const eq = raw.indexOf("=")
      const name = eq > 0 ? raw.slice(0, eq) : ""
      if (!MIRROR_VARIABLES.includes(name)) {
        throw new Error(
          `--expected-var exige NOME=VALOR com NOME em ${MIRROR_VARIABLES.join(", ")} (recebi '${raw}')`,
        )
      }
      if (name === "BUN_VERSION") {
        throw new Error("--expected-var: BUN_VERSION entra por --expected")
      }
      options.expectedVars[name] = raw.slice(eq + 1)
    } else if (arg === "--backend") {
      const value = argv[++i] ?? ""
      if (!["github", "gitea"].includes(value)) {
        throw new Error(`--backend deve ser github|gitea (recebi '${value}')`)
      }
      options.backend = value
    } else if (arg === "--actrc") options.actrc = argv[++i] ?? null
    else if (arg === "--gitea-env") options.envFile = argv[++i] ?? null
    else if (arg === "--dry-run") options.dryRun = true
    else if (arg === "--report") options.report = argv[++i] ?? null
    else if (arg === "--help" || arg === "-h") options.help = true
    else throw new Error(`Argumento desconhecido: ${arg}`)
  }
  return options
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log(
      "Uso: node scripts/actrc-sync-issue.mjs --expected <versão> [--expected-var NOME=VALOR]...\n" +
        "       [--actrc <path>] [--gitea-env <path>] [--backend github|gitea] [--dry-run]\n" +
        "       [--report /path/to/report.json]\n" +
        "  Com drift: publica/comenta a issue.\n" +
        "  Sem drift: FECHA as issues que este script abriu (dívida resolvida), com a prova no comentário.\n\n" +
        "  --report: lê o diagnóstico de um JSON (produzido por check-actrc-sync.mjs --json)\n" +
        "            em vez de rodar a comparação novamente.",
    )
    return 0
  }

  // `--report` lê o diagnóstico de um JSON já pronto (produzido pelo
  // `check-actrc-sync.mjs --json`). `--expected` é OBRIGATÓRIO quando NÃO há
  // `--report` (é a régua da comparação).
  let report
  if (options.report) {
    report = readReportFile(options.report)
    // `--expected` pode ser passado junto com `--report` para que o
    // re-execute (--expected "1.3.14 --json /tmp/r.json") use o mesmo
    // diagnóstico. Mas o report já carrega o `expected` original.
    if (options.expected === null && report.expected !== undefined) {
      options.expected = report.expected
    }
    if (options.expected === null) {
      throw new Error("--report requer --expected ou o relatório deve conter o campo 'expected'")
    }
  } else {
    // `--expected` AUSENTE é erro de uso. VAZIO (`--expected ""`) não é: significa
    // a repository variable não criada — o drift mais grave, que vira issue.
    if (options.expected === null) {
      throw new Error(
        "falta --expected <versão> (use --expected \"\" para 'variável não configurada')",
      )
    }
    report = mirrorDriftReport({
      expected: options.expected,
      expectedVars: options.expectedVars,
      ...(options.actrc ? { actrcPath: options.actrc } : {}),
      ...(options.envFile ? { envPath: options.envFile } : {}),
    })
  }

  // O CICLO INTEIRO (label idempotente, dedup por assinatura no corpo E nos
  // comentários, comentar no título já aberto, criar, e RECONCILIAR — comentando
  // a prova e fechando o que este publicador abriu quando o drift sumiu) é o do
  // contrato. Antes ele era reimplementado aqui, e essa era a única cópia que
  // não passava por `decidePublication`: o dedup e o fechamento dos dois lados
  // eram regras paralelas que podiam divergir sem nenhum teste vermelho.
  const backend = options.dryRun
    ? { name: options.backend }
    : selectIssueBackend(options, process.env, {
        label: ISSUE_LABEL,
        color: ISSUE_LABEL_COLOR,
        description: ISSUE_LABEL_DESCRIPTION,
      })
  await runDebtPublisher({
    publisher: ACTRC_PUBLISHER,
    input: report,
    backend,
    dryRun: options.dryRun,
  })
  return 0
}

const IS_DIRECT_RUN =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (IS_DIRECT_RUN) {
  let code = 1
  try {
    code = await main()
  } catch (error) {
    console.error(`❌ ${error.message}`)
    code = 1
  }
  process.exit(code)
}
