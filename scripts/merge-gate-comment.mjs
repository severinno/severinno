#!/usr/bin/env node

// =============================================================================
// merge-gate-comment.mjs
//
// O VEREDITO do `merge-gate:prove` vai ao PR como COMENTÁRIO RECONCILIADO.
//
// A OUTRA PONTA DO MESMO FATO. O cron semanal
// (`.github/workflows/merge-gate-proof.yml`) entrega o veredito ao
// `merge-gate-issue.mjs` — que abre/atualiza/fecha uma ISSUE. Só que o que a
// prova mede é CÓDIGO (o applier e o manifesto), e quem muda esse código está
// num PR: a issue só aparece na segunda-feira seguinte, quando o autor já
// mergeou (ou já foi interrompido por outra coisa). Aqui o MESMO veredito, do
// MESMO relatório, é publicado ONDE o autor está — no PR — e RECONCILIADO: quando
// a prova volta a ser PROVADA, o comentário é RETIRADO sozinho, em vez de ficar
// aberto mentindo sobre um delta que já não existe.
//
// UMA MEDIÇÃO, DOIS CANAIS. O corpo sai das MESMAS funções puras do relatório que
// a issue usa (`deltaOf`, `registrationOf`, `natureOf`, `registrationSummary`,
// `deltaSummary`, `mergeGateTitle`, `medido`) — uma segunda leitura do JSON
// divergiria no dia em que o campo fosse renomeado, e os dois canais passariam a
// discordar sobre o mesmo ensaio. O que muda entre eles é só a PROSA: a issue
// fala do cron e do ciclo de fechamento; este comentário fala do PR e do remédio
// na mudança.
//
// POR QUE UM CANAL SÓ PARA O VEREDITO (e não um comentário por natureza): o
// veredito é UM estado do ensaio, com UMA assinatura. Dois marcadores (registro /
// matriz) fariam um PR que corrigisse um lado e mantivesse o outro terminar com
// dois comentários dizendo metade da verdade cada — e a retirada de um apagaria o
// aviso do outro. A natureza da falha é a primeira LINHA do corpo, não um canal.
//
// O QUE ELE NÃO FAZ COM `unavailable`. Sem docker, imagem não puxável ou a API do
// ensaio fora, a prova NÃO MEDIU — e "não medido" não é evidência de "resolvido":
// o comentário anterior NÃO é retirado (apagaria o último aviso com base em nada)
// e nada é publicado. Quem transforma isso em vermelho é o CRON, onde a regra do
// repositório vale ("um cron que não mede não pode terminar verde"); no PR o caso
// é AVISO nomeado, porque ali o veredito é um canal a mais, não o gate.
//
// O canal é o MESMO do `pr-remedy-comment.mjs`, e a mecânica vive num módulo só
// (`pr-comment-channel.mjs`): o comentário de PR é um comentário de issue nas duas
// forjas, e a lista de comentários, a remoção de duplicatas e a decisão
// criar/atualizar/retirar são as mesmas — reimplementá-las aqui criaria um segundo
// jeito de reconciliar o mesmo PR. O MARCADOR é próprio, e
// isso é deliberado: os remédios do pre-commit podem viver no MESMO PR, e um
// marcador comum faria a reconciliação de um retirar o comentário do outro.
//
// Usage:
//   node scripts/merge-gate-comment.mjs --report /tmp/merge-gate.json --backend github
//   node scripts/merge-gate-comment.mjs --backend gitea --pr 123        # PR explícito
//   node scripts/merge-gate-comment.mjs --dry-run                       # imprime a decisão e o corpo, sem tocar a API
//   node scripts/merge-gate-comment.mjs --report R --json               # saída estruturada
//   node scripts/merge-gate-comment.mjs -h                              # esta ajuda
//
// Sem `--report` a prova roda agora (`merge-gate:prove --json`, exige docker):
// é o caminho do uso local, e o workflow sempre passa `--report` para publicar o
// que JÁ mediu (mesma medição do log e da issue).
//
// Ambiente (o MESMO dos outros publicadores): no Gitea `GITEA_TOKEN`, `GITEA_URL`
// e `GITEA_REPOSITORY`; no GitHub `GH_TOKEN` e `GH_REPOSITORY` (`GH_API_URL`
// opcional). O número do PR vem de `--pr`, de `PR_NUMBER` ou do payload do evento
// (`GITHUB_EVENT_PATH`) / de `GITHUB_REF` (`refs/pull/N/…`).
//
// Exit codes:
//   0 — canal reconciliado (comentário criado, atualizado ou RETIRADO), ou nada a
//       fazer; e também com o canal AUSENTE/sem permissão de escrita (aviso
//       nomeado: o comentário é um canal a mais, não o gate)
//   2 — canal presente e a API recusou (publicação quebrada)
//   3 — uso inválido (--backend desconhecido, --pr sem número, flag desconhecida)
// =============================================================================

import process from "node:process"
import { pathToFileURL } from "node:url"

import {
  NATURE,
  VERDICT,
  deltaOf,
  deltaSummary,
  loadReport,
  medido,
  mergeGateTitle,
  natureOf,
  registrationOf,
  registrationSummary,
  verdictOf,
} from "./merge-gate-issue.mjs"
// O CANAL vem de `pr-comment-channel.mjs` (e não do `pr-remedy-comment.mjs`, que
// RE-EXPORTA os mesmos nomes): aquele módulo traz, de carona, os dois gates com
// os seus parsers de YAML, e este publicador não mede remendo nenhum — importar
// o irmão inteiro por causa da mecânica deixaria este job dependente de
// `node_modules` sem precisar (é o que o `check-job-deps` cobra).
import {
  ChannelDenied,
  backendChannel,
  prNumberFrom,
  reconcileComment,
  selectBackend,
} from "./pr-comment-channel.mjs"

/** Exit codes — o contrato da CLI (os mesmos do irmão `pr-remedy-comment`). */
export const EXIT = {
  OK: 0,
  UNPUBLISHED: 2,
  USAGE: 3,
}

/**
 * O marcador do comentário DESTE canal.
 *
 * Próprio (e não o do remédio) de propósito: os dois canais podem viver no MESMO
 * PR, e um marcador comum faria a reconciliação de um retirar o comentário do
 * outro. Plain text, e no FIM do corpo: é por ele que a lista de comentários é
 * FILTRADA, e um marcador invisível no meio do texto seria escondido por
 * `reconcileRemedy` do jeito errado no dia em que a prosa mudasse.
 */
export const COMMENT_MARKER = "<!-- merge-gate-proof:comentario -->"

/**
 * A DECISÃO, pura: o que fazer com o comentário dado o veredito.
 *
 * Três respostas, e o `unavailable` é a que NÃO pode virar "retirar":
 *   `publicar`   — a prova é VIOLADA: o PR carrega o delta, e é aqui que o autor
 *                  precisa vê-lo (o cron da segunda-feira chega tarde);
 *   `retirar`    — a prova é PROVADA: o delta sumiu, e um comentário que ficasse
 *                  diria que o defeito ainda existe;
 *   `nao-medido` — não houve medição (sem docker/imagem/API) ou o veredito é
 *                  desconhecido: nada é publicado e o comentário anterior NÃO é
 *                  retirado ("não medido" não é evidência de "resolvido").
 *
 * @param {any} [report]
 * @returns {"publicar"|"retirar"|"nao-medido"}
 */
export function decisionOf(report) {
  const verdict = verdictOf(report)
  if (verdict === VERDICT.VIOLATED) return "publicar"
  if (verdict === VERDICT.PROVEN) return "retirar"
  return "nao-medido"
}

/**
 * O corpo do comentário — o CONTEXTO e o DELTA, do MESMO relatório da issue.
 *
 * O fato é o que o autor precisa para consertar: os contextos que o manifesto
 * exige, o que o registro NÃO tem (o job roda e o merge passa com ele vermelho),
 * o que SOBRA (o PR trava para sempre) e o que carrega CONTAGEM (o nome muda
 * quando a matriz cresce). A matriz vem caso a caso, e os LIMITES saem do
 * relatório (`limits`), não de uma segunda lista aqui.
 *
 * Sem data e sem URL do run de propósito: um rodapé com timestamp faria duas
 * medições idênticas produzirem corpos diferentes, e a reconciliação reescreveria
 * o comentário toda vez (`noop` é o que mantém o canal quieto enquanto o delta é
 * o mesmo — a mesma razão da assinatura da issue).
 *
 * @param {any} report
 * @returns {string}
 */
export function mergeGateCommentBody(report) {
  const registration = registrationOf(report)
  const { missing, extra, withCount } = deltaOf(report)
  const contexts = report?.contexts ?? []
  const casos = report?.cases ?? []
  const lines = []

  lines.push(`## ${mergeGateTitle(report)}`)
  lines.push("")
  lines.push(
    "A prova do bloqueio de merge (`merge-gate:prove`) rodou contra esta mudança: subiu um **Gitea efêmero**," +
      " aplicou `ci/required-checks.json` com o **applier de verdade** e tentou mergear em quatro situações." +
      " Ela **NÃO é PROVADA** — e o que a corrige é a mudança deste PR, não um passo manual no host.",
  )
  lines.push("")
  lines.push(
    `**VEREDITO: ${String(verdictOf(report)).toUpperCase()}** — ${report?.detail ?? "sem detalhe"}`,
  )
  lines.push("")
  lines.push(
    `**NATUREZA:** \`${natureOf(report)}\` — ` +
      (natureOf(report) === NATURE.REGISTRO
        ? "o applier registrou uma proteção diferente do manifesto"
        : "o registro bate e a matriz de merge não morde"),
  )
  lines.push("")
  lines.push(`| o ensaio | valor |`)
  lines.push(`| :-- | :-- |`)
  lines.push(
    `| instância | \`${report?.name ?? "?"}\` em 127.0.0.1:\`${report?.port ?? "?"}\` (efêmera) |`,
  )
  lines.push(`| imagem | \`${report?.image ?? "?"}\` |`)
  lines.push(`| registro | ${registrationSummary(report)} |`)
  lines.push(
    `| exigência (\`enable_status_check\`) | ${
      report?.enforcement?.enabled === true
        ? "`true` (a lista BLOQUEIA)"
        : "**não lida / desligada**"
    } |`,
  )
  lines.push("")

  lines.push("### O REGISTRO da proteção — o contexto e o delta")
  lines.push("")
  lines.push(
    "O que a forja EXIGE é a **lista de contextos** (o `name:` de cada job required) — não basta ligar a" +
      " exigência. Registro a menos e o merge passa com o gate vermelho; registro a mais e o PR trava para" +
      " sempre esperando um check que nunca roda; CONTAGEM no nome e o contexto muda sozinho quando a matriz cresce.",
  )
  lines.push("")
  lines.push(`**Contexto exigido pelo manifesto (${contexts.length}):**`)
  lines.push("")
  if (contexts.length > 0) {
    for (const context of contexts) lines.push(`- \`${context}\``)
  } else {
    lines.push("- o relatório **não trouxe** a lista de contextos (versão anterior da prova)")
  }
  lines.push("")
  if (registration === null) {
    lines.push(
      "> O delta **não foi lido** neste relatório. Sem ele não há como dizer o que falta — trate este" +
        " comentário como o alerta de que a prova não chegou ao fim.",
    )
    lines.push("")
  } else if (missing.length === 0 && extra.length === 0 && withCount.length === 0) {
    lines.push(
      "- **sem delta no registro**: neste ensaio o registro **bateu** com o manifesto (o defeito está na matriz).",
    )
    lines.push("")
  } else {
    lines.push("**Delta (registro × manifesto):**")
    lines.push("")
    if (missing.length > 0) {
      lines.push(
        `- **faltam ${missing.length}** — a forja NÃO exige (o job roda e o merge passa com ele vermelho):`,
      )
      for (const context of missing) lines.push(`  - \`${context}\``)
    }
    if (extra.length > 0) {
      lines.push(
        `- **sobram ${extra.length}** — a forja exige check que o manifesto não declara (o PR trava esperando para sempre):`,
      )
      for (const context of extra) lines.push(`  - \`${context}\``)
    }
    if (withCount.length > 0) {
      lines.push(
        `- **com CONTAGEM ${withCount.length}** — o nome muda quando a matriz cresce (a proteção passa a exigir um check inexistente):`,
      )
      for (const entry of withCount) lines.push(`  - \`${entry?.context}\` → \`${entry?.count}\``)
    }
    lines.push("")
  }

  if (casos.length > 0) {
    lines.push("### A MATRIZ de merge (cada linha é um PR de verdade, contra a API de verdade)")
    lines.push("")
    lines.push("| caso | esperado | obtido | HTTP | motivo |")
    lines.push("| :-- | :-- | :-- | :-- | :-- |")
    for (const testCase of casos) {
      const state = testCase?.outcome?.state ?? "?"
      const ok = state === testCase?.expect ? "✅" : "❌"
      lines.push(
        `| ${ok} \`${testCase?.id ?? "?"}\` | ${
          testCase?.expect === "merged" ? "mergeia" : "NÃO mergeia"
        } | \`${state}\` | ${testCase?.outcome?.http ?? "—"} | ${(
          testCase?.outcome?.reason ??
          testCase?.outcome?.detail ??
          "—"
        )
          .toString()
          .replace(/\|/g, "\\|")} |`,
      )
    }
    lines.push("")
  }

  if (report?.blockers?.length > 0) {
    lines.push("### Os bloqueadores, como a prova os nomeia")
    lines.push("")
    for (const blocker of report.blockers) lines.push(`- ${blocker}`)
    lines.push("")
  }

  if (report?.applier) {
    lines.push("<details><summary>O que o applier fez neste ensaio</summary>")
    lines.push("")
    lines.push(`- aplicou o manifesto: ${medido(report.applier.applied)}`)
    lines.push(
      `- \`--check\` do MESMO applier, logo após aplicar: em sincronia = ${medido(report.applier.checkInSync)}`,
    )
    lines.push(
      `- \`--check\` com a exigência desligada à mão: vê o drift = ${medido(report.applier.checkSeesDisabled)}` +
        " — um detector que não vê o modo silencioso não protege nada",
    )
    lines.push("")
    lines.push("</details>")
    lines.push("")
  }

  lines.push("### Corrigir")
  lines.push("")
  lines.push(
    "- **O applier é quem registra**: `bun run ci:required-checks -- --apply` reaplica o manifesto na" +
      " branch protection. Se o defeito estiver no CÓDIGO do applier (`enable_status_check` não enviado," +
      " subconjunto aplicado), o conserto é nele — e o gate desta mudança é a própria prova.",
  )
  if (withCount.length > 0) {
    lines.push(
      "- **CONTAGEM no contexto**: o número sai do `name:` do job (ele vai no summary/comentário/README)." +
        " Quem cobra é o `bun run check:mutation-count`.",
    )
  }
  if (extra.length > 0) {
    lines.push(
      "- **Contexto a mais**: ou o manifesto está velho (o job foi renomeado/removido) ou a proteção" +
        " ficou para trás. Os dois lados são derivados — `bun run check:required-checks` diz qual.",
    )
  }
  if (missing.length > 0) {
    lines.push(
      "- **Contexto a menos**: um required check que a forja não exige é um gate decorativo — o PR passa" +
        " com ele vermelho.",
    )
  }
  if (casos.some((c) => (c?.outcome?.state ?? "") === "merged" && c?.expect !== "merged")) {
    lines.push(
      "- **A matriz mergeou onde devia recusar**: a exigência está SEM efeito. Confira o booleano" +
        " (`enable_status_check`) no applier — é ele que transforma a lista em bloqueio.",
    )
  }
  lines.push("")

  const limits = report?.limits ?? []
  if (limits.length > 0) {
    lines.push("<details><summary>O que esta prova NÃO cobre (por desenho)</summary>")
    lines.push("")
    for (const limit of limits) lines.push(`- ${limit}`)
    lines.push("")
    lines.push("</details>")
    lines.push("")
  }

  lines.push("### Reproduzir")
  lines.push("")
  lines.push("```bash")
  lines.push(
    "bun run merge-gate:prove            # sobe o Gitea efêmero e prova a matriz (exige docker)",
  )
  lines.push("bun run merge-gate:prove --json     # o relatório que este comentário carrega")
  lines.push("```")
  lines.push("")
  lines.push(
    "> Este comentário é **RECONCILIADO**: quando a prova voltar a **PROVADO** (o registro batendo com o" +
      " manifesto e a matriz de merge verde), ele é retirado sozinho. Enquanto a prova não medir" +
      " (`unavailable`), ele NÃO é retirado — não medido ≠ resolvido.",
  )
  lines.push("")
  lines.push(COMMENT_MARKER)
  lines.push("")
  return lines.join("\n")
}

/**
 * O relatório publicado pelo canal: o corpo a publicar, ou `null` (o sinal de
 * RETIRAR). `nao-medido` NUNCA chega aqui — quem o trata é a CLI, que não toca a
 * API nesse caso.
 *
 * @param {any} [report]
 * @returns {string|null}
 */
export function bodyOf(report) {
  return decisionOf(report) === "publicar" ? mergeGateCommentBody(report) : null
}

const USAGE = `merge-gate-comment — o veredito do \`merge-gate:prove\` vai ao PR como comentário reconciliado

Usage:
  node scripts/merge-gate-comment.mjs [--backend gitea|github] [--report FILE] [--pr N] [--repo owner/name] [--dry-run] [--json] [--root X]
  node scripts/merge-gate-comment.mjs -h

Sem --report a prova roda agora (\`merge-gate:prove --json\`, exige docker). O workflow
sempre passa --report para publicar a MESMA medição do log e da issue.

violado     → publica/atualiza o comentário (o corpo traz o contexto, o delta e a matriz)
provado     → RETIRA o comentário (o delta sumiu)
unavailable → não publica e NÃO retira (não medido ≠ resolvido); o cron é quem falha por isso

Exit codes:
  0 — canal reconciliado (criado/atualizado/retirado) ou nada a fazer; e também com o
      canal AUSENTE ou sem permissão de escrita, dito com \`::notice::\`
  2 — a API recusou a publicação (canal existe e não publica)
  3 — uso inválido (--backend desconhecido, --pr sem número, flag desconhecida)`

/** O parser das opções (as mesmas do irmão `merge-gate-issue`, mais `--pr`). */
export function parseArgs(argv) {
  const options = {
    report: null,
    backend: null,
    pr: null,
    repo: null,
    root: null,
    dryRun: false,
    json: false,
    help: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--dry-run") options.dryRun = true
    else if (arg === "--json") options.json = true
    else if (arg === "--help" || arg === "-h") options.help = true
    else if (arg === "--report") options.report = argv[++i] ?? null
    else if (arg === "--pr") options.pr = argv[++i] ?? null
    else if (arg === "--repo") options.repo = argv[++i] ?? null
    else if (arg === "--root") options.root = argv[++i] ?? null
    else if (arg === "--backend") {
      const value = argv[++i] ?? ""
      if (!["github", "gitea"].includes(value)) {
        throw new Error(`--backend deve ser github|gitea (recebi '${value}')`)
      }
      options.backend = value
    } else throw new Error(`Argumento desconhecido: ${arg}`)
  }
  return options
}

async function main() {
  // Uso inválido é exit 3 (e não 2): quem escreveu `--backend tgz` errou a linha
  // de comando, e tratar isso como "publicação quebrada" mandaria o operador
  // procurar um token que está certo. O texto do erro é o remédio.
  let options
  try {
    options = parseArgs(process.argv.slice(2))
  } catch (error) {
    console.error(`❌ ${error.message}`)
    console.error(USAGE)
    return EXIT.USAGE
  }
  if (options.help) {
    console.log(USAGE)
    return EXIT.OK
  }
  const report = loadReport({ report: options.report })
  const decisao = decisionOf(report)
  const body = bodyOf(report)
  const resumo = {
    decisao,
    verdict: verdictOf(report),
    natureza: natureOf(report),
    delta: deltaSummary(report),
  }

  const canal = selectBackend({ flag: options.backend, env: process.env })
  const pr = prNumberFrom({ env: process.env, flag: options.pr })
  const channel = canal.backend
    ? backendChannel(canal.backend, { env: process.env, repo: options.repo })
    : null

  if (options.dryRun) {
    const decisaoDizivel =
      decisao === "publicar"
        ? "o comentário seria criado/atualizado com o delta"
        : decisao === "retirar"
          ? "o comentário seria RETIRADO (a prova é PROVADA)"
          : "NADA seria feito: a prova não mediu, e o comentário anterior não é retirado"
    if (options.json) {
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
      process.stdout.write((body ?? "(nada a publicar)\n") + "\n")
    }
    return EXIT.OK
  }

  // NÃO MEDIDO: retirar o comentário com uma medição que não aconteceu apagaria o
  // último aviso de um delta que ninguém conseguiu ler. Aqui é AVISO — quem FALHA
  // por não medir é o cron (a prova precisa de docker e o PR não o garante).
  if (decisao === "nao-medido") {
    console.error(
      `::warning::merge-gate-comment: a prova NÃO mediu (\`${verdictOf(report)}\`): ${
        report?.detail ?? "sem diagnóstico"
      } — o comentário anterior NÃO é retirado e nada é publicado`,
    )
    return EXIT.OK
  }

  if (!canal.backend) {
    console.error(
      `::notice::merge-gate-comment: ${canal.why ?? "canal indisponível"} — o veredito NÃO foi publicado no PR (o cron semanal segue sendo o canal)`,
    )
    return EXIT.OK
  }
  if (!pr) {
    console.error(
      "::notice::merge-gate-comment: sem número de PR (--pr, PR_NUMBER, payload do evento ou GITHUB_REF) — nada a publicar",
    )
    return EXIT.OK
  }
  if (channel.unavailable) {
    console.error(
      `::notice::merge-gate-comment: ${channel.unavailable} — o veredito NÃO foi publicado no PR`,
    )
    return EXIT.OK
  }

  try {
    const out = await reconcileComment({
      request: channel.request,
      config: channel.config,
      kind: channel.kind,
      pr,
      body,
      marker: COMMENT_MARKER,
      log: (line) => console.error(line),
    })
    if (options.json)
      console.log(JSON.stringify({ ...resumo, backend: canal.backend, pr, ...out }, null, 2))
    else console.log(`✅ merge-gate-comment (${canal.backend}, PR #${pr}): ${out.detail}`)
    return EXIT.OK
  } catch (error) {
    if (error instanceof ChannelDenied) {
      console.error(`::warning::merge-gate-comment: ${error.message}`)
      return EXIT.OK
    }
    console.error(`::error::merge-gate-comment: ${error?.message ?? error}`)
    return EXIT.UNPUBLISHED
  }
}

const IS_DIRECT_RUN =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (IS_DIRECT_RUN) {
  main()
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error(`::error::merge-gate-comment: ${error?.stack ?? error}`)
      process.exit(EXIT.UNPUBLISHED)
    })
}
