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
//   node scripts/actrc-sync-issue.mjs --expected 1.3.14
//   node scripts/actrc-sync-issue.mjs --expected 1.3.14 --gitea-env /opt/gitea/.env
//   node scripts/actrc-sync-issue.mjs --expected 1.3.14 --dry-run
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

import { mirrorDriftReport } from "./check-actrc-sync.mjs"

/** Label de triagem (dedup + filtro no board). */
export const ISSUE_LABEL = "actrc-sync-drift"

/**
 * Título ESTÁVEL entre runs — de propósito NÃO inclui a versão nem os arquivos
 * que driftaram (isso vai no corpo): um título que muda a cada bump abriria uma
 * issue nova por drift em vez de comentar na dívida já aberta.
 */
export function driftTitle() {
  return "Espelhos do BUN_VERSION fora de sincronia com vars.BUN_VERSION"
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

/** Marcador HTML invisível que carrega a assinatura dentro do corpo da issue. */
export function markerOf(signature) {
  return `<!-- actrc-sync-drift:${Buffer.from(signature).toString("base64")} -->`
}

/**
 * `true` se `body` (um corpo de texto) já carrega o marcador desta assinatura.
 *
 * O chamador de issue usa `issueHasSignature`, que cobre corpo + comentários.
 */
export function hasSignature(body, signature) {
  return typeof body === "string" && body.includes(markerOf(signature))
}

/** Prefixo de QUALQUER marcador nosso (a assinatura vem depois dos `:`). */
export const MARKER_PREFIX = "<!-- actrc-sync-drift:"

/**
 * `true` se o corpo foi escrito por ESTE script (carrega um marcador nosso, de
 * qualquer assinatura).
 *
 * POR QUE NÃO BASTA O LABEL: label é etiqueta de triagem — alguém pode aplicá-lo
 * numa issue que não é de drift, e fechar ticket alheio por causa de uma etiqueta
 * é pior que deixar a dívida aberta. O marcador é a assinatura de quem escreveu.
 *
 * O tipo é `unknown` de propósito: o corpo vem do `gh` e pode não ser string
 * (campo ausente em JSON), e engolir isso em runtime sem declarar convidaria a
 * um `body.includes` que estoura no meio da reconciliação.
 *
 * @param {unknown} body
 * @returns {boolean}
 */
export function hasAnyMarker(body) {
  return typeof body === "string" && body.includes(MARKER_PREFIX)
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
 * @param {{body?: string, comments?: {body?: string}[]}|undefined} issue
 * @returns {unknown[]}
 */
export function issueBodies(issue) {
  return [issue?.body, ...((issue?.comments ?? []).map((c) => c?.body) ?? [])]
}

/** `true` se a issue já carrega ESTA assinatura (no corpo ou num comentário). */
export function issueHasSignature(issue, signature) {
  return issueBodies(issue).some((body) => hasSignature(body, signature))
}

/** `true` se a issue foi escrita por ESTE script (marcador em qualquer corpo). */
export function issueHasAnyMarker(issue) {
  return issueBodies(issue).some((body) => hasAnyMarker(body))
}

/**
 * O remédio DIFERE por espelho, e a diferença é o ponto:
 *   - `.actrc` → atualizar a flag (é o act local);
 *   - template comitado → o `bump-bun.sh` escreve os dois espelhos de uma vez;
 *   - `deploy/.env.gitea` (host) → atualizar o arquivo que o compose lê **e
 *     re-registrar** o runner: os labels são estado do REGISTRO (`/data/.runner`),
 *     então `restart` não aplica a troca.
 *
 * @param {{deployed: boolean}} mirror
 * @returns {string}
 */
export function remedyFor(mirror) {
  if (mirror.deployed) {
    return (
      "`deploy/.env.gitea` é o arquivo que o compose lê (`--env-file`) — atualize-o" +
      " **e re-registre o runner** (`bash deploy/gitea-up.sh --re-register`): os labels" +
      " são estado do registro em `/data/.runner`, então um `restart` não aplica a troca."
    )
  }
  return (
    "`deploy/env.gitea.example` é o template comitado de onde o `.env.gitea` do VPS" +
    " deriva — `bash scripts/bump-bun.sh <versão>` escreve a variável e os dois espelhos" +
    " de uma vez."
  )
}

/**
 * Corpo da issue em markdown: o que divergiu (por espelho), a consequência e o
 * comando que resolve. Sem isso a issue só diz "tem drift" e transfere a
 * investigação para quem lê.
 *
 * @param {{expected: string, actrcVersion: string|null, mirrors: {label: string, deployed: boolean, version: string|null}[], warnings: string[]}} report
 * @returns {string}
 */
export function driftBody(report) {
  const lines = []
  // Variável AUSENTE é o drift mais grave E pede remédio diferente: não há
  // "versão certa" para alinhar os espelhos (o `bump-bun.sh` com versão vazia
  // seria uma instrução sem sentido). O que falta é CRIAR a variável.
  lines.push(
    report.expected
      ? `Os espelhos do Bun divergem de **\`vars.BUN_VERSION='${report.expected}'\`**` +
          " (repository variable — a fonte única)."
      : "A repository variable **`vars.BUN_VERSION` NÃO está configurada** no repositório" +
          " — e os espelhos apontam para uma versão que ninguém declarou.",
  )
  lines.push("")
  lines.push(
    "Nenhum dos espelhos governa corretude de CI: o `.actrc` é a dev experience do" +
      " `act`, e o env da forja alimenta a **label do runner**. Divergir não deixa" +
      " nenhum gate vermelho — só faz o `act` testar outra versão e o **tier-1**" +
      " (fast path de 0s) do setup-bun **desligar** na forja, com todo job voltando a" +
      " pagar o download (~1-3s pelo mirror, ~5-10s pelo release). O sintoma aparece" +
      " longe da causa.",
  )
  lines.push("")

  lines.push("### O que foi comparado")
  lines.push("")
  lines.push(`- \`.actrc\`: \`${report.actrcVersion ?? "<sem BUN_VERSION>"}\``)
  for (const mirror of report.mirrors) {
    const kind = mirror.deployed ? "host" : "template comitado"
    lines.push(`- \`${mirror.label}\` (${kind}): \`${mirror.version ?? "<sem BUN_VERSION>"}\``)
  }
  lines.push("")

  lines.push("### Divergências")
  lines.push("")
  for (const warning of report.warnings) lines.push(`- ${warning}`)
  lines.push("")

  const drifted = report.mirrors.filter((m) => m.version !== report.expected)
  if (drifted.length > 0) {
    lines.push("### Corrigir (o remédio difere por espelho)")
    lines.push("")
    for (const mirror of drifted) {
      lines.push(`- \`${mirror.label}\`: ${remedyFor(mirror)}`)
    }
    lines.push("")
  }

  if (report.expected) {
    lines.push("```bash")
    lines.push(`bash scripts/bump-bun.sh ${report.expected}   # variável + os dois espelhos`)
    lines.push(
      "node scripts/check-actrc-sync.mjs --expected " + report.expected + "   # reexibe este drift",
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
  lines.push(markerOf(signatureOf(report)))
  return lines.join("\n")
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
 * @param {{expected: string, actrcVersion: string|null, mirrors: {label: string, deployed: boolean, version: string|null}[], warnings: string[]}} report
 * @returns {string}
 */
export function resolutionComment(report) {
  const lines = []
  lines.push(
    `✅ **Resolvido** — os espelhos voltaram a concordar com \`vars.BUN_VERSION='${report.expected}'\`.`,
  )
  lines.push("")
  lines.push("### O que foi comparado agora (a prova)")
  lines.push("")
  lines.push(`- \`.actrc\`: \`${report.actrcVersion ?? "<sem BUN_VERSION>"}\``)
  for (const mirror of report.mirrors) {
    const kind = mirror.deployed ? "host" : "template comitado"
    lines.push(`- \`${mirror.label}\` (${kind}): \`${mirror.version ?? "<sem BUN_VERSION>"}\``)
  }
  if (report.mirrors.length === 0) {
    lines.push(
      "- nenhum arquivo de env da forja foi descoberto neste checkout — só o `.actrc` entrou na comparação",
    )
  }
  lines.push("")
  lines.push("```bash")
  lines.push(
    `node scripts/check-actrc-sync.mjs --expected ${report.expected}   # exit 0 = em sincronia`,
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
 * As issues ABERTAS com o label — com corpo E comentários.
 *
 * Os comentários entram no `--json` porque é neles que mora o marcador do
 * segundo drift em diante (ver `issueBodies`): sem eles, o dedup por assinatura
 * e a identificação do que é NOSSO só enxergariam o primeiro drift.
 */
function openIssuesWithLabel(ghFn = gh) {
  const res = ghFn([
    "issue",
    "list",
    "--label",
    ISSUE_LABEL,
    "--state",
    "open",
    "--limit",
    "100",
    "--json",
    "number,title,body,comments",
  ])
  if (res.status !== 0) {
    // `status` nulo com stderr vazio significa que o `gh` NEM EXECUTOU (não
    // está no PATH). Dizer só `exit null` manda o operador procurar um erro do
    // GitHub que não existe — a causa é local.
    const why = res.error?.message
      ? ` (${res.error.message})`
      : `: ${(res.stderr ?? "").slice(0, 400)}`
    throw new Error(`gh issue list falhou (exit ${res.status})${why}`)
  }
  return JSON.parse(res.stdout || "[]")
}

/**
 * A RECONCILIAÇÃO: sem aviso nenhum, a dívida que a issue representa caducou.
 *
 * COMENTA ANTES DE FECHAR, e de propósito: o comentário é a prova, e ele entra
 * numa issue ainda aberta — se o `gh` falhar no meio, o pior caso é uma dívida
 * aberta COM a prova anexada (nada mentiu), nunca uma issue fechada em silêncio
 * sem dizer por quê.
 *
 * @param {{report: object, gh?: Function, log?: Function}} args
 * @returns {{closed: number[], foreign: number[], alreadyClear: boolean}}
 */
export function reconcileDebt({ report, gh: ghFn = gh, log = console.log } = {}) {
  const open = openIssuesWithLabel(ghFn)
  // `issueHasAnyMarker` (e não `hasAnyMarker(issue.body)`): o marcador de um
  // drift que mudou está num COMENTÁRIO, e uma issue nossa confundida com alheia
  // nunca seria fechada.
  const ours = open.filter((issue) => issueHasAnyMarker(issue))
  const foreign = open.filter((issue) => !issueHasAnyMarker(issue))

  // Um label aplicado à mão numa issue que não é de drift NÃO pode ser fechado
  // por automatismo — mas também não pode passar em silêncio, senão a dívida
  // fica aberta sem ninguém saber por quê.
  for (const issue of foreign) {
    log(
      `ℹ️  issue #${issue.number} carrega o label '${ISSUE_LABEL}' e NÃO foi aberta por este script (sem marcador) — não é fechada por automatismo; revise à mão.`,
    )
  }

  if (ours.length === 0) {
    log(
      `✅ Sem drift e nenhuma dívida aberta com o label '${ISSUE_LABEL}'${foreign.length > 0 ? ` (${foreign.length} issue(s) alheia(s) com o label, deixada(s) intocada(s))` : ""}.`,
    )
    return { closed: [], foreign: foreign.map((i) => i.number), alreadyClear: true }
  }

  const closed = []
  for (const issue of ours) {
    const comment = ghFn([
      "issue",
      "comment",
      String(issue.number),
      "--body",
      resolutionComment(report),
    ])
    if (comment.status !== 0) {
      throw new Error(
        `gh issue comment falhou na #${issue.number}: ${(comment.stderr ?? "").slice(0, 400)}`,
      )
    }
    const close = ghFn(["issue", "close", String(issue.number), "--reason", "completed"])
    if (close.status !== 0) {
      throw new Error(
        `gh issue close falhou na #${issue.number}: ${(close.stderr ?? "").slice(0, 400)}`,
      )
    }
    closed.push(issue.number)
    log(`✅ issue #${issue.number} fechada — os espelhos voltaram a concordar (dívida caducou).`)
  }

  return { closed, foreign: foreign.map((i) => i.number), alreadyClear: false }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const options = { expected: null, actrc: null, envFile: null, dryRun: false, help: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--expected") options.expected = argv[++i] ?? null
    else if (arg === "--actrc") options.actrc = argv[++i] ?? null
    else if (arg === "--gitea-env") options.envFile = argv[++i] ?? null
    else if (arg === "--dry-run") options.dryRun = true
    else if (arg === "--help" || arg === "-h") options.help = true
    else throw new Error(`Argumento desconhecido: ${arg}`)
  }
  return options
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log(
      "Uso: node scripts/actrc-sync-issue.mjs --expected <versão> [--actrc <path>] [--gitea-env <path>] [--dry-run]\n" +
        "  Com drift: publica/comenta a issue.\n" +
        "  Sem drift: FECHA as issues que este script abriu (dívida resolvida), com a prova no comentário.",
    )
    return 0
  }
  // `--expected` AUSENTE é erro de uso. VAZIO (`--expected ""`) não é: significa
  // a repository variable não criada — o drift mais grave, que vira issue.
  if (options.expected === null) {
    throw new Error(
      "falta --expected <versão> (use --expected \"\" para 'variável não configurada')",
    )
  }

  const report = mirrorDriftReport({
    expected: options.expected,
    ...(options.actrc ? { actrcPath: options.actrc } : {}),
    ...(options.envFile ? { envPath: options.envFile } : {}),
  })

  if (report.warnings.length === 0) {
    console.log(`✅ Sem drift: os espelhos concordam com vars.BUN_VERSION='${report.expected}'.`)
    // O outro lado da dívida: sem drift, o que este script abriu já não existe.
    // `--dry-run` continua sem tocar no `gh` (o contrato do modo é não ter
    // efeito nenhum) — ele DIZ o que faria.
    if (options.dryRun) {
      console.log(
        `   (dry-run: nenhuma chamada ao gh — a reconciliação fecharia as issues abertas por este script, label '${ISSUE_LABEL}', com a prova no comentário)`,
      )
      return 0
    }
    const { closed } = reconcileDebt({ report })
    if (closed.length > 0) {
      console.log(
        `🔒 Reconciliado: ${closed.length} issue(s) de drift fechada(s) — a dívida não fica aberta depois de resolvida.`,
      )
    }
    return 0
  }

  console.log(
    `⚠️  Drift detectado (${report.warnings.length} aviso(s)) — publicando issue acionável.`,
  )
  if (options.dryRun) {
    console.log(driftBody(report))
    console.log("\n(dry-run: nenhuma chamada ao gh)")
    return 0
  }

  const signature = signatureOf(report)

  // `--force` torna a criação do label idempotente (não falha se já existir).
  gh([
    "label",
    "create",
    ISSUE_LABEL,
    "--force",
    "--color",
    "FBCA04",
    "--description",
    "Espelhos do BUN_VERSION divergentes de vars.BUN_VERSION",
  ])

  const existing = openIssuesWithLabel()
  // Corpo **e comentários**: sem os comentários, um drift que mudou uma vez
  // seria comentado a cada run semanal para sempre (ver `issueBodies`).
  const alreadyReported = existing.find((issue) => issueHasSignature(issue, signature))
  if (alreadyReported) {
    console.log(`ℹ️  Drift idêntico já reportado na issue #${alreadyReported.number} — sem ruído.`)
    return 0
  }

  const title = driftTitle()
  const body = driftBody(report)
  const openWithTitle = existing.find((issue) => issue.title === title)

  if (openWithTitle) {
    const res = gh(["issue", "comment", String(openWithTitle.number), "--body", body])
    if (res.status !== 0) {
      throw new Error(`gh issue comment falhou: ${(res.stderr ?? "").slice(0, 400)}`)
    }
    console.log(`✅ Comentário adicionado à issue #${openWithTitle.number} (drift novo).`)
    return 0
  }

  const res = gh(["issue", "create", "--title", title, "--body", body, "--label", ISSUE_LABEL])
  if (res.status !== 0) {
    throw new Error(`gh issue create falhou: ${(res.stderr ?? "").slice(0, 400)}`)
  }
  console.log(`✅ Issue criada: ${(res.stdout ?? "").trim()}`)
  return 0
}

const IS_DIRECT_RUN =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (IS_DIRECT_RUN) {
  try {
    process.exit(main())
  } catch (error) {
    console.error(`❌ ${error.message}`)
    process.exit(1)
  }
}
