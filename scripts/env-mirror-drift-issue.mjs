#!/usr/bin/env node

// =============================================================================
// env-mirror-drift-issue.mjs
//
// Transforma em ISSUE ACIONÁVEL o drift entre o env do HOST da forja
// (`deploy/.env.gitea`, o arquivo que o compose lê) e o template comitado
// (`deploy/env.gitea.example`).
//
// POR QUE ISSO PRECISA EXISTIR (o buraco que ele fecha): a comparação host ×
// template é o PRÉ-REQUISITO 0 do `deploy/gitea-up.sh` e um gate de PR — mas as
// duas coisas rodam em um EVENTO: o PR (antes do merge) e a subida da stack
// (quando um humano a dispara). Depois do merge, o env do VPS pode ser editado à
// mão — e AÍ não existe PR nenhum para o gate olhar. O drift de OPERAÇÃO fica
// invisível: a subida só recusaria no dia em que alguém a rodasse, e até lá o
// compose interpola outra imagem (o sintoma é o tier-1 desligado, ou a label do
// runner apontando para o registry errado).
//
// POR QUE UM CRON (e não só o pré-requisito): o `check-env-mirror` é o mesmo
// passo, mas no momento em que a stack sobe. Quem edita o arquivo do host no VPS
// não roda nada — o cron é a única testemunha periódica, e é ele que transforma o
// silêncio em ticket.
//
// FONTE ÚNICA DAS REGRAS: este script NÃO reimplementa a comparação — ele
// consome o `--json` do `check-env-mirror.mjs` (ou a MESMA função, quando não
// recebe `--report`). Quem decide o que é divergência é `compareEnvMirrorDeclarations`,
// via `checkEnvMirror` — a issue e o log do bring-up não podem discordar.
//
// O OUTRO LADO DA DÍVIDA: publicar sem FECHAR deixa a issue aberta depois de
// resolvida — uma dívida que mente. Quando o env volta a espelhar o template,
// este script RECONCILIA: comenta a PROVA (host, template e quantas variáveis o
// compose consome) e fecha as issues que ELE abriu. O ciclo é o do contrato
// (`issue-publish.mjs`) — não uma segunda implementação.
//
// Usage:
//   node scripts/env-mirror-drift-issue.mjs                       # descobre host e template no checkout
//   node scripts/env-mirror-drift-issue.mjs --host deploy/.env.gitea
//   node scripts/env-mirror-drift-issue.mjs --report /tmp/env-mirror.json --backend gitea
//   node scripts/env-mirror-drift-issue.mjs --dry-run
//
// Exit codes:
//   0 — sem drift (e a dívida aberta foi fechada), ou issue criada/comentada,
//       ou já reportada (ou dry-run)
//   1 — erro real: relatório ausente/inválido, ou falha do backend de issues
//       (fail-closed nos DOIS sentidos: um drift que não pôde ser publicado é o
//       mesmo alerta mudo de antes, e uma dívida resolvida que não pôde ser
//       fechada continua mentindo no board)
// =============================================================================

import { spawnSync } from "node:child_process"
import process from "node:process"
import { existsSync, readFileSync } from "node:fs"
import { pathToFileURL } from "node:url"

import { checkEnvMirror } from "./check-env-mirror.mjs"
import {
  bodyHasMarker,
  bodyHasSignature,
  defineDebtPublisher,
  issueBodies,
  makeGithubBackend,
  publisherBody,
  publisherHasSignature,
  publisherMarker,
  publisherMarkerPrefix,
  publisherOwns,
  reconcilePublisherDebt,
  runDebtPublisher,
  selectIssueBackend,
} from "./issue-publish.mjs"

/** Label de triagem (dedup + filtro no board). */
export const ISSUE_LABEL = "env-mirror-drift"
export const ISSUE_LABEL_COLOR = "D93F0B"
export const ISSUE_LABEL_DESCRIPTION =
  "Env do HOST da forja (deploy/.env.gitea) divergente do template comitado (deploy/env.gitea.example)"

/**
 * O identificador do marcador na issue — o dedup é POR publicador: um drift de
 * env nunca pode ser confundido com o veredito do doctor nem com os espelhos do
 * BUN_VERSION (que comparam OUTRA coisa: a repository variable).
 */
export const ENV_MIRROR_MARKER_ID = "env-mirror-drift"

/**
 * Título ESTÁVEL entre runs — de propósito NÃO inclui as variáveis que
 * divergiram (isso vai no corpo): um título que muda a cada variável abriria uma
 * issue nova por drift em vez de comentar na dívida já aberta.
 */
export function driftTitle() {
  return "Env do HOST da forja fora de sincronia com o template comitado"
}

/**
 * Assinatura estável do drift: as violações, ordenadas.
 *
 * Duas runs com o MESMO drift produzem a MESMA assinatura (dedup); um drift
 * DIFERENTE (outra variável, outro valor) produz outra — e aí comentar é o
 * comportamento certo, porque a dívida mudou.
 *
 * @param {{violations?: string[]}} [report]
 * @returns {string}
 */
export function signatureOf(report) {
  return [...(report?.violations ?? [])].sort().join("\n")
}

/**
 * `true` quando há o que publicar: só a DIVERGÊNCIA abre dívida.
 *
 * POR QUE `absent` NÃO É DÍVIDA: ele significa que NÃO havia o que comparar (o
 * env do host é gitignored e existe só onde a stack roda, OU o template não está
 * no checkout). Isso não é um defeito do operador, e abrir ticket para ele faria
 * um alerta que sempre acende — o tipo de ruído que este repositório recusa. Mas
 * ele também NÃO é "em sincronia": quem decide o que fazer com a ausência é o
 * workflow (que falha com o remédio nomeado), e a prosa abaixo diz isso.
 *
 * @param {{state?: string, violations?: string[]}} report
 * @returns {boolean}
 */
export function isActionable(report) {
  return report?.state === "diverged" && signatureOf(report) !== ""
}

/**
 * O CONTRATO deste publicador (`issue-publish.mjs`).
 *
 * O QUE FICA DECLARADO AQUI: a etiqueta, o FORMATO do marcador (`b64`: a
 * assinatura são as violações, que têm quebra de linha), o título estável, a
 * assinatura, a prosa, quando há dívida, o ESCOPO (uma issue para o problema — o
 * drift é UM estado) e o FECHAMENTO (o comentário de prova + o motivo).
 */
export const ENV_MIRROR_PUBLISHER = defineDebtPublisher({
  name: ENV_MIRROR_MARKER_ID,
  label: ISSUE_LABEL,
  labelColor: ISSUE_LABEL_COLOR,
  labelDescription: ISSUE_LABEL_DESCRIPTION,
  marker: { id: ENV_MIRROR_MARKER_ID, format: "b64" },
  title: () => driftTitle(),
  signature: (report) => signatureOf(report),
  body: (report) => driftProse(report),
  actionable: (report) => isActionable(report),
  scope: { kind: "single" },
  resolution: {
    // A GUARDA DO FECHAMENTO: só um `in-sync` EXPLÍCITO fecha a dívida.
    //
    // POR QUE NÃO O DEFAULT (`() => true`): o outro estado sem violações é
    // `absent` — "não havia o que comparar". Fechar por ele apagaria a dívida com
    // base numa medição que não aconteceu (o arquivo do host não estava visível),
    // que é o fechamento otimista que este repositório recusa: "não medido" não é
    // evidência de "normal". Com `when`, o `absent` cai em `unmeasured` — o run
    // segue vermelho pelo step do workflow, e NADA é fechado.
    when: (report) => report?.state === "in-sync",
    comment: (report) => resolutionComment(report),
    reason: "o env do host voltou a espelhar o template comitado",
  },
  prose: {
    actionable: (report) =>
      `⚠️  Drift detectado (${(report?.violations ?? []).length} violação(ões)) entre ` +
      `\`${report?.host ?? "?"}\` e \`${report?.template ?? "?"}\` — publicando issue acionável.`,
    inSync: (report) =>
      report?.state === "in-sync"
        ? `✅ Em sincronia: \`${report.host}\` espelha \`${report.template}\` ` +
          `(${report.consumed?.length ?? 0} variável(is) que o compose consome conferidas).`
        : `· NÃO COMPARADO (\`${report?.state ?? "?"}\`): ${report?.detail ?? "sem diagnóstico"}` +
          " — o cron não mede drift neste checkout; aponte o env do host com `--host`.",
    alreadyReported: (issue) =>
      `ℹ️  Drift idêntico já reportado na issue #${issue.number} — sem ruído.`,
    commented: (issue) => `✅ Comentário adicionado à issue #${issue.number} (drift novo).`,
    reconciled: (count) =>
      `🔒 Reconciliado: ${count} issue(s) de drift fechada(s) — a dívida não fica aberta depois de resolvida.`,
    dryRunTail: () => "\n(dry-run: nenhuma chamada ao backend de issues)",
    dryRunReconcile: () =>
      `   (dry-run: a reconciliação fecharia as issues abertas por este publicador, label '${ISSUE_LABEL}', com a prova no comentário)`,
  },
})

/** O marcador HTML invisível que carrega a assinatura (a mecânica é do contrato). */
export function markerOf(signature) {
  return publisherMarker(ENV_MIRROR_PUBLISHER, signature)
}

/** `true` se `body` já carrega o marcador desta assinatura. */
export function hasSignature(body, signature) {
  return bodyHasSignature(ENV_MIRROR_PUBLISHER, body, signature)
}

/** Prefixo de QUALQUER marcador nosso (a assinatura vem depois dos `:`). */
export const MARKER_PREFIX = publisherMarkerPrefix(ENV_MIRROR_PUBLISHER)

/**
 * `true` se o corpo foi escrito por ESTE script (carrega um marcador nosso, de
 * qualquer assinatura). Label é etiqueta de triagem — fechar ticket alheio por
 * causa de um label é pior que deixar a dívida aberta; o marcador é a assinatura
 * de quem escreveu.
 */
export function hasAnyMarker(body) {
  return bodyHasMarker(ENV_MIRROR_PUBLISHER, body)
}

export { issueBodies }

/** `true` se a issue já carrega ESTA assinatura (no corpo ou num comentário). */
export function issueHasSignature(issue, signature) {
  return publisherHasSignature(issue, ENV_MIRROR_PUBLISHER, signature)
}

/** `true` se a issue foi escrita por ESTE script (marcador em qualquer corpo). */
export function issueHasAnyMarker(issue) {
  return publisherOwns(issue, ENV_MIRROR_PUBLISHER)
}

/**
 * O remédio — o MESMO par que o `deploy/gitea-up.sh` imprime quando recusa a
 * subida (uma fonte para a correção, como a comparação é uma só para o
 * diagnóstico).
 *
 * A ORDEM importa: revisar o diff ANTES de aplicar. O `--fix` é mecânico e não
 * inventa segredo, mas quem troca um valor precisa saber que o compose da forja
 * lê ESTE arquivo — e que, se a variável de imagem mudou, o runner só passa a
 * usar a imagem nova depois de um RE-REGISTRO (os labels vivem em
 * `/data/.runner`, e um `restart` não os relê).
 *
 * @returns {string}
 */
export function remedy() {
  return (
    "`bun run env-mirror:check --patch` (revisar o diff) e `bun run env-mirror:check --fix`" +
    " (aplicar — atômico, e NUNCA toca no segredo). Se o que divergiu foi uma variável de" +
    " IMAGEM (`IMAGE_REGISTRY`/`IMAGE_NAMESPACE`/`BUN_VERSION`), re-registre o runner depois:" +
    " `bash deploy/gitea-up.sh --re-register` (os labels são estado do registro em" +
    " `/data/.runner`, então um `restart` não aplica a troca)."
  )
}

/**
 * A PROSA do corpo da issue — sem o marcador: quem o compõe é o contrato
 * (`publisherBody`), para não existir um publicador que esqueça de escrevê-lo e
 * publique uma dívida que o fechamento automático depois não reconheça.
 *
 * @param {object} report
 * @returns {string}
 */
function driftProse(report) {
  const lines = []
  lines.push(
    `O env do **HOST** da forja (\`${report.host ?? "?"}\`) divergiu do **template` +
      ` comitado** (\`${report.template ?? "?"}\`) em ${(report.violations ?? []).length} ponto(s).`,
  )
  lines.push("")
  lines.push(
    "É este arquivo que o `docker compose` da forja lê (`--env-file`) para montar os" +
      " labels do runner — então divergir aqui significa que **o que o VPS interpola não é" +
      " o que o repositório declara**: namespace trocado, versão velha, variável que o" +
      " template já não declara. Nenhum gate de PR pega isso depois do merge (não há PR), e" +
      " o sintoma aparece longe da causa — o **tier-1** (fast path de 0s) do setup-bun" +
      " desliga em silêncio, ou o pull da imagem só falha quando um job tenta iniciar.",
  )
  lines.push("")
  lines.push("### O que divergiu")
  lines.push("")
  for (const v of report.violations ?? []) lines.push(`- ${v}`)
  lines.push("")
  lines.push("### O que foi comparado")
  lines.push("")
  lines.push(`- host: \`${report.host ?? "?"}\``)
  lines.push(`- template comitado: \`${report.template ?? "?"}\``)
  lines.push(
    `- ${report.consumed?.length ?? 0} variável(is) que o compose consome foram conferidas por` +
      " NOME e por VALOR (a lista sai do próprio compose, não de uma lista escrita à mão)",
  )
  lines.push("")
  lines.push("### Corrigir")
  lines.push("")
  lines.push(`- ${remedy()}`)
  lines.push("")
  lines.push("```bash")
  lines.push("bun run env-mirror:check            # reexibe este diagnóstico")
  lines.push(
    "bun run env-mirror:check --patch    # o diff que reconcilia o host (segredo mascarado)",
  )
  lines.push("bun run env-mirror:check --fix      # aplica (atômico; NUNCA toca no segredo)")
  lines.push("```")
  lines.push("")
  lines.push(
    "> O mesmo passo é o PRÉ-REQUISITO 0 do `deploy/gitea-up.sh`: enquanto ele não espelhar," +
      " a subida da stack **RECUSA** (o `ensure-runner-image` resolveria a imagem do env" +
      " divergente). Este cron existe para o defeito aparecer antes de alguém tentar subir.",
  )
  lines.push("")
  return lines.join("\n")
}

/** O corpo COMPLETO da issue: a prosa + o marcador, como o contrato os compõe. */
export function driftBody(report) {
  return publisherBody(ENV_MIRROR_PUBLISHER, report)
}

/**
 * O comentário de RESOLUÇÃO — o que a issue passa a contar quando é fechada.
 *
 * Carrega a PROVA (host, template e quantas variáveis o compose consome), não só
 * "resolvido": quem chegar depois lê o desfecho sem reconstruir o estado do mundo
 * na data do fechamento. E diz o ESCOPO — o fechamento vale para o que foi
 * comparado.
 *
 * @param {object} report
 * @returns {string}
 */
export function resolutionComment(report) {
  const lines = []
  lines.push("✅ **Resolvido** — o env do HOST voltou a espelhar o template comitado.")
  lines.push("")
  lines.push("### O que foi comparado agora (a prova)")
  lines.push("")
  lines.push(`- host: \`${report?.host ?? "?"}\``)
  lines.push(`- template comitado: \`${report?.template ?? "?"}\``)
  lines.push(
    `- ${report?.consumed?.length ?? 0} variável(is) que o compose consome: mesmo conjunto de` +
      " nomes, mesmos valores nas que o compose usa, e o mesmo label renderizado dos dois lados",
  )
  lines.push("")
  lines.push("```bash")
  lines.push("bun run env-mirror:check   # exit 0 = em sincronia")
  lines.push("```")
  lines.push("")
  lines.push(
    "> Fechada automaticamente: se o env do host divergir de novo (uma edição no VPS, um" +
      " template bumpado sem alinhar o host), a mesma regra abre uma issue nova com a" +
      " assinatura do momento — o dedup é entre as ABERTAS.",
  )
  return lines.join("\n")
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * Lê um relatório JSON produzido por `check-env-mirror.mjs --json`.
 *
 * O JSON é o `MirrorResult` INTEIRO (`state`, `violations`, `consumed`, `host`,
 * `template`, `plan`…). A validação é mínima e de propósito: o que o ciclo
 * precisa é `violations` (array) e `state` — um relatório sem eles seria lido
 * como "sem drift", que é o falso verde que este caminho existe para não
 * produzir.
 *
 * @param {string} reportPath
 * @returns {object}
 */
export function readReportFile(reportPath) {
  if (!existsSync(reportPath)) {
    throw new Error(`relatório não encontrado: ${reportPath}`)
  }
  const json = JSON.parse(readFileSync(reportPath, "utf8"))
  if (!Array.isArray(json.violations)) {
    throw new Error(`relatório inválido: campo 'violations' não é array (${reportPath})`)
  }
  if (typeof json.state !== "string") {
    throw new Error(`relatório inválido: campo 'state' ausente (${reportPath})`)
  }
  return json
}

export function parseArgs(argv) {
  const options = {
    host: null,
    template: null,
    report: null,
    dryRun: false,
    backend: "github",
    help: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--host") options.host = argv[++i] ?? null
    else if (arg === "--template") options.template = argv[++i] ?? null
    else if (arg === "--report") options.report = argv[++i] ?? null
    else if (arg === "--dry-run") options.dryRun = true
    else if (arg === "--backend") {
      const value = argv[++i] ?? ""
      if (!["github", "gitea"].includes(value)) {
        throw new Error(`--backend deve ser github|gitea (recebi '${value}')`)
      }
      options.backend = value
    } else if (arg === "--help" || arg === "-h") options.help = true
    else throw new Error(`Argumento desconhecido: ${arg}`)
  }
  return options
}

/**
 * O diagnóstico: do arquivo (`--report`) ou rodando a MESMA função do guard.
 *
 * `--report` existe para o workflow publicar o que JÁ mediu (uma medição, um
 * consumidor) — medir de novo aqui poderia divergir do que o job logou.
 *
 * @param {{host?: string|null, template?: string|null, report?: string|null}} options
 * @returns {object}
 */
export function loadReport(options) {
  if (options.report) return readReportFile(options.report)
  return checkEnvMirror({
    ...(options.host ? { host: options.host } : {}),
    ...(options.template ? { template: options.template } : {}),
  })
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log(
      "Uso: node scripts/env-mirror-drift-issue.mjs [--host <env do host>] [--template <template>]\n" +
        "       [--report /path/to/env-mirror.json] [--backend github|gitea] [--dry-run]\n" +
        "  Com divergência: publica/comenta a issue.\n" +
        "  Sem divergência: FECHA as issues que este script abriu (dívida resolvida), com a prova no comentário.\n\n" +
        "  --report: lê o diagnóstico de um JSON (produzido por check-env-mirror.mjs --json)\n" +
        "            em vez de rodar a comparação novamente.",
    )
    return 0
  }

  const report = loadReport(options)

  // O ciclo inteiro (label idempotente, dedup por assinatura no corpo E nos
  // comentários, comentar no título já aberto, criar, e RECONCILIAR — comentando
  // a prova e fechando o que este publicador abriu quando o drift sumiu) é o do
  // contrato: uma segunda implementação seria uma regra paralela que pode
  // divergir sem nenhum teste vermelho.
  const backend = options.dryRun
    ? { name: options.backend }
    : selectIssueBackend(options, process.env, {
        label: ISSUE_LABEL,
        color: ISSUE_LABEL_COLOR,
        description: ISSUE_LABEL_DESCRIPTION,
      })
  await runDebtPublisher({
    publisher: ENV_MIRROR_PUBLISHER,
    input: report,
    backend,
    dryRun: options.dryRun,
  })
  return 0
}

// ---------------------------------------------------------------------------
// gh CLI
// ---------------------------------------------------------------------------

function gh(args, { input } = {}) {
  return spawnSync("gh", args, { encoding: "utf8", input, env: process.env })
}

/** O backend do GitHub com a etiqueta DESTE publicador (uma fonte: o contrato). */
function githubBackendFor(ghFn = gh) {
  return makeGithubBackend({
    gh: ghFn,
    label: ENV_MIRROR_PUBLISHER.label,
    color: ENV_MIRROR_PUBLISHER.labelColor,
    description: ENV_MIRROR_PUBLISHER.labelDescription,
  })
}

/**
 * A RECONCILIÇÃO isolada — exportada para o teste exercitar o fechamento sem
 * passar pelo CLI.
 *
 * COMENTA ANTES DE FECHAR, e de propósito (o contrato faz o mesmo): o comentário
 * é a prova, e ele entra numa issue ainda aberta — se o backend falhar no meio,
 * o pior caso é uma dívida aberta COM a prova anexada (nada mentiu), nunca uma
 * issue fechada em silêncio sem dizer por quê.
 */
/**
 * A GUARDA do fechamento, exposta como função — o teste a exercita sem furar o
 * contrato do publisher (e o nome diz a regra: só o resolvido fecha).
 *
 * @param {object} report
 * @returns {boolean}
 */
export function shouldReconcile(report) {
  return ENV_MIRROR_PUBLISHER.resolution.when(report)
}

/**
 * A prosa do ciclo quando NÃO há drift — exportada pelo mesmo motivo: o texto
 * que o log imprime é uma asserção testável, não detalhe interno.
 *
 * @param {object} report
 * @returns {string}
 */
export function inSyncProse(report) {
  return ENV_MIRROR_PUBLISHER.prose.inSync(report)
}

/**
 * @param {{report: object, gh?: Function, backend?: object, log?: Function}} [args]
 * @returns {Promise<{closed: number[], foreign: number[], stale: number[]}>}
 */
export function reconcileDebt({ report, gh: ghFn = gh, backend, log = console.log } = {}) {
  return reconcilePublisherDebt({
    publisher: ENV_MIRROR_PUBLISHER,
    input: report,
    backend: backend ?? githubBackendFor(ghFn),
    log,
  })
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
