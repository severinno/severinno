#!/usr/bin/env node

// =============================================================================
// merge-gate-issue.mjs
//
// Transforma o veredito do `merge-gate:prove` (`scripts/prove-gitea-merge-gate.mjs`)
// em ISSUE ACIONÁVEL — e FECHA a dívida quando o registro da proteção volta a
// bater com o manifesto.
//
// POR QUE ISSO PRECISA EXISTIR (o buraco que ele fecha): a prova sobe um Gitea
// efêmero, aplica o manifesto com o APLIADOR DE VERDADE e tenta mergear em quatro
// situações — mas ela roda SOB DEMANDA, com docker, e quem lembra de rodá-la é
// quem já desconfia. O que ela mede é o CAMINHO QUE APLICA A PROTEÇÃO: se o
// applier registrar um SUBCONJUNTO dos contextos, perder o `enable_status_check`
// (o booleano que transforma a lista em bloqueio) ou aceitar CONTAGEM no nome de
// um contexto, nada fica vermelho — o PR passa, o cron passa, e o merge passa com
// o gate vermelho. É o mesmo buraco do `required-checks-drift`, um nível antes:
// lá o que diverge é o branch protection da forja REAL; aqui é o que o APLIADOR
// registra, medido contra uma forja de verdade e descartável.
//
// POR QUE UM CRON (e não só a prova manual): uma regressão no applier é de
// CÓDIGO, e código muda em PR — mas o efeito dela só aparece quando alguém roda a
// prova com docker. O cron é a testemunha periódica: ele transforma o silêncio em
// ticket.
//
// POR QUE ISSUE (e não só o job vermelho): o precedente deste repositório
// (`required-checks-drift-issue.mjs`, `env-mirror-drift-issue.mjs`,
// `forge-doctor-issue.mjs`) — ninguém abre o log de um cron que rodou sozinho.
// O CORPO carrega o CONTEXTO e o DELTA: os contextos que o manifesto exige, os
// que o registro NÃO tem (o job roda e o merge passa), os que SOBRAM (o PR trava
// para sempre esperando um check que nunca roda) e os que carregam CONTAGEM (o
// nome muda quando a matriz cresce, e a proteção passa a exigir um check
// inexistente).
//
// O OUTRO LADO DA DÍVIDA: com o veredito de volta em PROVADO, o MESMO publicador
// RECONCILIA — comenta a PROVA (o registro batendo, a matriz verde, a imagem e a
// instância do ensaio) e fecha as issues que ELE abriu. Uma dívida resolvida que
// fica aberta mente no board; o ciclo é o do contrato (`issue-publish.mjs`), não
// uma segunda implementação.
//
// `unavailable` (sem docker, imagem não puxável, API não subiu) NÃO abre issue e
// NÃO fecha nada: não é defeito da peça, é uma medição que não aconteceu — quem
// diz o remédio é o workflow, que FALHA o run nomeando o caso. Um cron que não
// mediu não pode passar por verde, e "não medido" não é evidência de "normal"
// (por isso `resolution.when` exige `proven`, e não "não é violated").
//
// FONTE ÚNICA: aqui não há diagnóstico reimplementado. O veredito, o registro, o
// delta (`missing`/`extra`/`withCount`), a matriz e os LIMITES da prova saem do
// MESMO relatório que a CLI produz (`--json`). O que é deste publicador: o label,
// o título, a assinatura e a prosa.
//
// Usage:
//   node scripts/merge-gate-issue.mjs --report /tmp/merge-gate.json
//   node scripts/merge-gate-issue.mjs                       # roda a prova agora (docker)
//   node scripts/merge-gate-issue.mjs --backend gitea --repo owner/repo
//   node scripts/merge-gate-issue.mjs --report /tmp/merge-gate.json --dry-run
//
// Credenciais (nunca do arquivo — só do ambiente):
//   github: GH_TOKEN | GITHUB_TOKEN
//   gitea:  GITEA_TOKEN + GITEA_URL (+ GITEA_REPOSITORY | --repo)
//
// Exit codes:
//   0 — veredito PROVADO (e a dívida aberta foi fechada), ou issue
//       criada/comentada, ou já reportada (ou dry-run)
//   1 — erro real: relatório ausente/inválido, credencial ausente, backend fora,
//       ou a prova não produziu relatório — fail-closed: um alerta que não pode
//       ser publicado é o mesmo silêncio de antes, só que parecendo verde
// =============================================================================

import { spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import process from "node:process"
import { fileURLToPath, pathToFileURL } from "node:url"

import {
  defineDebtPublisher,
  publisherBody,
  runDebtPublisher,
  selectIssueBackend,
} from "./issue-publish.mjs"

/** Label de triagem (dedup + filtro no board). */
export const ISSUE_LABEL = "merge-gate-proof"

/** Cor do label (vermelho: o merge pode passar com o gate vermelho). */
export const ISSUE_LABEL_COLOR = "B60205"

/** Descrição do label (aparece no board e explica a dívida). */
export const ISSUE_LABEL_DESCRIPTION =
  "A prova do bloqueio de merge (merge-gate:prove) não é PROVADA: o registro da proteção divergiu do manifesto, ou a matriz não morde"

/** Id do marcador invisível que carrega a assinatura (dedup por publicador). */
export const MERGE_GATE_MARKER_ID = "merge-gate-proof"

/** Os vereditos da prova (o vocabulário de `prove-gitea-merge-gate.mjs`). */
export const VERDICT = {
  PROVEN: "proven",
  VIOLATED: "violated",
  /** Sem docker/imagem/API: NÃO mediu (e por isso não é dívida nem fechamento). */
  UNAVAILABLE: "unavailable",
}

/**
 * As duas NATUREZAS da falha — e por que elas têm títulos diferentes.
 *
 * A prova reprova por dois motivos independentes: o REGISTRO da proteção não bate
 * com o manifesto (o applier registrou outra coisa) ou a MATRIZ de merge não bate
 * com o contrato (o gate não morde mesmo com o registro certo). São problemas com
 * remédios diferentes — e no contrato o título é a SEGUNDA metade do dedup: com um
 * título só, uma falha de matriz que chegasse com a dívida de registro ABERTA
 * viraria COMENTÁRIO naquela issue, e o leitor concluiria que o defeito é o
 * registro. Dois títulos estáveis mantêm as duas dívidas separadas.
 */
export const NATURE = { REGISTRO: "registro", MATRIZ: "matriz" }

export const REGISTRO_TITLE =
  "Merge gate: a proteção REGISTRADA ≠ o manifesto (contexto e delta no corpo)"

export const MATRIZ_TITLE =
  "Merge gate: a matriz de merge não bate com o contrato (o gate não morde)"

/** O veredito em si (`proven` | `violated` | `unavailable`), ou "?" se ausente. */
export function verdictOf(report) {
  return report?.verdict ?? "?"
}

/** O delta do registro (`{ok, missing, extra, withCount}`), ou `null` se ausente. */
export function registrationOf(report) {
  const registration = report?.registration
  return registration ?? null
}

/** `true` quando a proteção registrada NÃO bate com o manifesto. */
export function registrationDiverges(report) {
  const registration = registrationOf(report)
  return registration !== null && registration.ok === false
}

/** A natureza da falha: registro divergente, senão a matriz. */
export function natureOf(report) {
  return registrationDiverges(report) ? NATURE.REGISTRO : NATURE.MATRIZ
}

/** Título ESTÁVEL da dívida — por natureza, nunca pelo veredito do momento. */
export function mergeGateTitle(report) {
  return natureOf(report) === NATURE.REGISTRO ? REGISTRO_TITLE : MATRIZ_TITLE
}

/**
 * As três listas do delta, sempre como arrays (o relatório pode não trazer o
 * registro: sem ele, o delta é vazio — e a prosa DIZ que não foi lido, em vez de
 * presumir que está tudo certo).
 */
export function deltaOf(report) {
  const registration = registrationOf(report)
  return {
    missing: registration?.missing ?? [],
    extra: registration?.extra ?? [],
    withCount: registration?.withCount ?? [],
  }
}

/**
 * Assinatura estável do problema: a natureza e o DELTA (o registro) ou os CASOS
 * que falharam (a matriz), tudo ORDENADO.
 *
 * Duas runs com o mesmo delta produzem a mesma assinatura (dedup: o cron semanal
 * não vira ruído); um delta diferente produz outra — e aí comentar é o
 * comportamento certo, porque a dívida mudou. Nada de timestamp aqui.
 *
 * O prefixo `registro:`/`matriz:` existe pelo mesmo motivo do título: assinaturas
 * de naturezas diferentes não podem colidir, senão uma engole a outra no dedup.
 *
 * @param {any} [report]
 * @returns {string}
 */
export function mergeGateSignature(report) {
  const parts = [`veredito:${verdictOf(report)}`]
  if (natureOf(report) === NATURE.REGISTRO) {
    parts.push(`natureza:${NATURE.REGISTRO}`)
    const { missing, extra, withCount } = deltaOf(report)
    for (const context of [...missing].sort()) parts.push(`faltam:${context}`)
    for (const context of [...extra].sort()) parts.push(`sobram:${context}`)
    for (const entry of [...withCount].sort((a, b) =>
      String(a?.context).localeCompare(String(b?.context)),
    )) {
      parts.push(`contagem:${entry?.context}=${entry?.count}`)
    }
    return parts.join("\n")
  }
  parts.push(`natureza:${NATURE.MATRIZ}`)
  for (const testCase of report?.cases ?? []) {
    const state = testCase?.outcome?.state ?? "sem-desfecho"
    if (state === testCase?.expect) continue
    parts.push(`caso:${testCase?.id}=${state}`)
  }
  return parts.join("\n")
}

/**
 * `true` quando há o que publicar: só VIOLAÇÃO abre dívida.
 *
 * `unavailable` NÃO é dívida da peça — é medição que não aconteceu (sem docker,
 * imagem não puxável, API fora). Abrir ticket para ele faria um alerta que
 * sempre acende, e o remédio deste caso não é consertar código: é dar o acesso
 * que falta. Mas ele também não é "provado": quem o torna visível é o WORKFLOW
 * (que falha nomeando o caso) e a prosa abaixo.
 *
 * @param {any} report
 * @returns {boolean}
 */
export function isActionable(report) {
  return verdictOf(report) === VERDICT.VIOLATED
}

/**
 * A GUARDA do fechamento: só um `proven` EXPLÍCITO fecha a dívida.
 *
 * O default do contrato é `() => true` — e ele estaria errado aqui: o outro
 * veredito que não abre issue é `unavailable`, e fechar por ele apagaria a dívida
 * com base numa medição que não aconteceu ("não medido" não é evidência de
 * "normal"). Com esta guarda, o `unavailable` cai em `unmeasured`: o run segue
 * vermelho pelo step do workflow, e NADA é fechado.
 *
 * @param {any} report
 * @returns {boolean}
 */
export function shouldReconcile(report) {
  return verdictOf(report) === VERDICT.PROVEN
}

/**
 * O CONTRATO deste publicador (`issue-publish.mjs`).
 *
 * ESCOPO `single`: a dívida é UM estado do registro/matriz (a assinatura é o
 * delta), não um item por achado. FECHAMENTO: o veredito voltou a PROVADO.
 */
export const MERGE_GATE_PUBLISHER = defineDebtPublisher({
  name: MERGE_GATE_MARKER_ID,
  label: ISSUE_LABEL,
  labelColor: ISSUE_LABEL_COLOR,
  labelDescription: ISSUE_LABEL_DESCRIPTION,
  marker: { id: MERGE_GATE_MARKER_ID, format: "b64" },
  title: (report) => mergeGateTitle(report),
  signature: (report) => mergeGateSignature(report),
  body: (report) => mergeGateProse(report),
  actionable: (report) => isActionable(report),
  scope: { kind: "single" },
  resolution: {
    when: (report) => shouldReconcile(report),
    comment: (report) => resolutionComment(report),
    reason: "a prova do bloqueio de merge voltou a PROVADO (o registro bate com o manifesto)",
  },
  prose: {
    actionable: (report) =>
      natureOf(report) === NATURE.REGISTRO
        ? `⚠️  FALHOU: o registro da proteção divergiu do manifesto — ${deltaSummary(report)}. Publicando issue acionável.`
        : `⚠️  FALHOU: a matriz de merge não bate com o contrato — publicando issue acionável.`,
    inSync: (report) =>
      verdictOf(report) === VERDICT.PROVEN
        ? `✅ PROVADO: ${registrationSummary(report)}, e a matriz de merge bate com o contrato.`
        : `· NÃO MEDIDO (\`${verdictOf(report)}\`): ${report?.detail ?? "sem diagnóstico"}` +
          " — o cron não mede a prova neste ambiente (docker/imagem/API); a dívida aberta NÃO é fechada por isto.",
    alreadyReported: (issue) =>
      `ℹ️  Delta idêntico já reportado na issue #${issue.number} — sem ruído.`,
    commented: (issue) => `✅ Comentário adicionado à issue #${issue.number} (delta novo).`,
    reconciled: (count) =>
      `🔒 Reconciliado: ${count} issue(s) do merge gate fechada(s) — a dívida não fica aberta depois de resolvida.`,
  },
})

/** O resumo do delta em uma linha (`faltam 2, sobram 1, com contagem 1`). */
export function deltaSummary(report) {
  const { missing, extra, withCount } = deltaOf(report)
  const parts = [
    missing.length > 0 ? `faltam ${missing.length}` : null,
    extra.length > 0 ? `sobram ${extra.length}` : null,
    withCount.length > 0 ? `com contagem ${withCount.length}` : null,
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(", ") : "sem delta declarado"
}

/** O resumo do registro em uma linha (`N/N contextos registrados, sem contagem`). */
export function registrationSummary(report) {
  const registration = registrationOf(report)
  const contexts = report?.contexts ?? []
  if (registration === null) return "o registro NÃO foi lido"
  if (registration.ok)
    return `${contexts.length}/${contexts.length} contextos registrados, sem contagem`
  return deltaSummary(report)
}

/**
 * Um booleano do relatório, RENDERIZADO com honestidade.
 *
 * A prova pode parar ANTES de medir uma das três verificações do applier (ex.:
 * o registro divergiu e ela aborta) — e um campo ausente renderizado como
 * `undefined` no corpo da issue é pior que a ausência: parece um valor. Aqui,
 * "não medido" é DITO (e é o mesmo desfecho que o resto do repositório trata
 * como não-evidência).
 *
 * @param {unknown} value
 * @returns {string}
 */
export function medido(value) {
  return typeof value === "boolean"
    ? `\`${value}\``
    : "não medido (a prova parou antes deste ponto)"
}

/**
 * A PROSA do corpo da issue — sem o marcador: quem o compõe é o contrato
 * (`publisherBody`), para não existir um publicador que esqueça de escrevê-lo e
 * publique uma dívida que o fechamento depois não reconheça.
 *
 * @param {any} report
 * @returns {string}
 */
function mergeGateProse(report) {
  const lines = []
  const registration = registrationOf(report)
  const { missing, extra, withCount } = deltaOf(report)
  const contexts = report?.contexts ?? []
  const casos = report?.cases ?? []

  lines.push(
    "A prova do bloqueio de merge (`merge-gate:prove`) subiu um **Gitea efêmero**, aplicou" +
      " `ci/required-checks.json` com o **applier de verdade** e tentou mergear em quatro" +
      " situações. Ela **NÃO é PROVADA**.",
  )
  lines.push("")
  lines.push(
    `**VEREDITO: ${String(verdictOf(report)).toUpperCase()}** — ${report?.detail ?? "sem detalhe"}`,
  )
  lines.push("")
  lines.push("| o ensaio | valor |")
  lines.push("| :-- | :-- |")
  lines.push(
    `| instância | \`${report?.name ?? "?"}\` em 127.0.0.1:\`${report?.port ?? "?"}\` (efêmera) |`,
  )
  lines.push(`| imagem | \`${report?.image ?? "?"}\` |`)
  lines.push(`| repositório do ensaio | \`${report?.repo ?? "?"}\` |`)
  lines.push(
    `| exigência (\`enable_status_check\`) | ${
      report?.enforcement?.enabled === true
        ? "`true` (a lista BLOQUEIA)"
        : "**não lida / desligada**"
    } |`,
  )
  lines.push(`| registro | ${registrationSummary(report)} |`)
  lines.push("")

  lines.push("### O REGISTRO da proteção — o CONTEXTO e o DELTA")
  lines.push("")
  lines.push(
    "O que a forja EXIGE é a **lista de contextos** (o `name:` de cada job required) — não basta" +
      " ligar a exigência. Registro a menos e o merge passa com o gate vermelho; registro a mais e o" +
      " PR trava para sempre esperando um check que nunca roda; CONTAGEM no nome e o contexto muda" +
      " sozinho quando a matriz cresce.",
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
      "> O delta **não foi lido** neste relatório. Sem ele não há como dizer o que falta — trate" +
        " esta issue como um alerta de que a prova não chegou ao fim.",
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
      for (const entry of withCount) {
        lines.push(`  - \`${entry?.context}\` → \`${entry?.count}\``)
      }
    }
    if (missing.length === 0 && extra.length === 0 && withCount.length === 0) {
      lines.push(
        "- sem delta: neste ensaio o registro **bateu** com o manifesto (o defeito está na matriz).",
      )
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
      `- \`--check\` com a exigência desligada à mão: vê o drift = ${medido(report.applier.checkSeesDisabled)} — um detector` +
        " que não vê o modo silencioso não protege nada",
    )
    lines.push("")
    lines.push("</details>")
    lines.push("")
  }

  lines.push("### Corrigir")
  lines.push("")
  lines.push(
    "- **O applier é quem registra**: `bun run ci:required-checks -- --apply` reaplica o manifesto no" +
      " branch protection. Se o defeito estiver no código do applier (`enable_status_check` não enviado," +
      " subconjunto aplicado), o conserto é nele — e a prova é o gate desta mudança.",
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

  lines.push("### Reproduzir")
  lines.push("")
  lines.push("```bash")
  lines.push(
    "bun run merge-gate:prove            # sobe o Gitea efêmero e prova a matriz (exige docker)",
  )
  lines.push("bun run merge-gate:prove --json     # o relatório que esta issue carrega")
  lines.push(
    "bun scripts/merge-gate-issue.mjs --report /tmp/merge-gate.json --dry-run   # o corpo, sem tocar o backend",
  )
  lines.push("```")
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

  lines.push(
    "> Esta issue é fechada automaticamente quando o cron voltar a **PROVAR** (o registro batendo" +
      " com o manifesto e a matriz de merge verde), pelo mesmo ciclo de reconciliação dos outros" +
      " alertas. Enquanto a prova não rodar (`unavailable`), NADA é fechado: não medido ≠ resolvido.",
  )
  lines.push("")
  return lines.join("\n")
}

/**
 * O comentário de RESOLUÇÃO — a PROVA de que o registro voltou a bater.
 *
 * Carrega o que foi medido AGORA (a instância, a imagem, o registro e a matriz),
 * não só "resolvido": quem chegar depois lê o desfecho sem reconstruir o estado
 * do mundo na data do fechamento.
 *
 * @param {any} report
 * @returns {string}
 */
export function resolutionComment(report) {
  const casos = report?.cases ?? []
  const lines = []
  lines.push("✅ **Resolvido** — a prova do bloqueio de merge voltou a **PROVADO**.")
  lines.push("")
  lines.push("### O que foi medido agora (a prova)")
  lines.push("")
  lines.push(
    `- instância: \`${report?.name ?? "?"}\` em 127.0.0.1:\`${report?.port ?? "?"}\` (efêmera, \`${report?.image ?? "?"}\`)`,
  )
  lines.push(`- exigência (\`enable_status_check\`): \`${report?.enforcement?.enabled === true}\``)
  lines.push(
    `- registro: **${registrationSummary(report)}** — a proteção registrada é exatamente o conjunto de` +
      ` contextos do manifesto (${(report?.contexts ?? []).length})`,
  )
  lines.push(`- matriz de merge: ${casos.length} caso(s), todos com o desfecho esperado`)
  for (const testCase of casos) {
    lines.push(
      `  - \`${testCase?.id ?? "?"}\`: esperado ${testCase?.expect === "merged" ? "mergeia" : "não mergeia"} →` +
        ` obtido \`${testCase?.outcome?.state ?? "?"}\``,
    )
  }
  lines.push("")
  lines.push("```bash")
  lines.push("bun run merge-gate:prove   # exit 0 = PROVADO")
  lines.push("```")
  lines.push("")
  lines.push(
    "> Fechada automaticamente: se a prova voltar a não ser PROVADA, a mesma regra abre uma issue" +
      " nova com a assinatura do momento (o dedup é entre as ABERTAS).",
  )
  return lines.join("\n")
}

/** O corpo COMPLETO da issue: a prosa + o marcador, como o contrato os compõe. */
export function mergeGateBody(report) {
  return publisherBody(MERGE_GATE_PUBLISHER, report)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const PROOF_PATH = resolve(REPO_ROOT, "scripts", "prove-gitea-merge-gate.mjs")

export function parseArgs(argv) {
  const options = { report: null, backend: "github", repo: null, dryRun: false, help: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--dry-run") options.dryRun = true
    else if (arg === "--help" || arg === "-h") options.help = true
    else if (arg === "--report") options.report = argv[++i] ?? null
    else if (arg === "--repo") options.repo = argv[++i] ?? null
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

/**
 * Lê um relatório JSON produzido por `prove-gitea-merge-gate.mjs --json`.
 *
 * A validação é mínima e de propósito: o que o ciclo precisa é `verdict` (o
 * veredito) e `contexts` — um relatório sem eles seria lido como "sem dívida",
 * que é o falso verde que este caminho existe para não produzir.
 *
 * @param {string} reportPath
 * @returns {any}
 */
export function readReportFile(reportPath) {
  if (!existsSync(reportPath)) {
    throw new Error(`relatório não encontrado: ${reportPath}`)
  }
  const json = JSON.parse(readFileSync(reportPath, "utf8"))
  if (typeof json.verdict !== "string") {
    throw new Error(`relatório inválido: campo 'verdict' ausente (${reportPath})`)
  }
  if (!Array.isArray(json.contexts)) {
    throw new Error(`relatório inválido: campo 'contexts' não é array (${reportPath})`)
  }
  return json
}

/**
 * O relatório: do arquivo (`--report`) ou rodando a prova agora.
 *
 * `--report` existe para o workflow publicar o que JÁ mediu (uma medição, um
 * consumidor) — rodar a prova de novo aqui poderia divergir do que o job logou
 * (e custaria outro Gitea efêmero). Sem `--report`, a prova roda com `--json`:
 * o caminho do uso local.
 *
 * @param {{report?: string|null}} options
 * @param {{run?: typeof spawnSync, execPath?: string}} [deps]
 * @returns {any}
 */
export function loadReport(options, { run = spawnSync, execPath = process.execPath } = {}) {
  if (options.report) return readReportFile(options.report)
  const res = run(execPath, [PROOF_PATH, "--json"], {
    encoding: "utf8",
    env: process.env,
    // O relatório carrega a matriz e os contextos: dezenas de KB, e o default de
    // 1 MB cortaria no meio de uma saída maior (com os blockers longos).
    maxBuffer: 64 * 1024 * 1024,
  })
  const stdout = (res.stdout ?? "").trim()
  if (!stdout) {
    throw new Error(
      `\`prove-gitea-merge-gate.mjs --json\` não produziu relatório (exit ${res.status}): ` +
        `${(res.stderr ?? "").slice(0, 400)}`,
    )
  }
  return JSON.parse(stdout)
}

const USAGE =
  "Uso: node scripts/merge-gate-issue.mjs [--report FILE] [--backend github|gitea] " +
  "[--repo owner/name] [--dry-run]\n" +
  "  Sem --report: roda a prova agora (`bun run merge-gate:prove --json`, exige docker).\n" +
  "  Com violação: publica/comenta a issue (o corpo traz o contexto e o delta).\n" +
  "  Provado: FECHA as issues que este script abriu, com a prova no comentário.\n" +
  "  `unavailable`: não publica nem fecha — o workflow falha nomeando o que faltou medir."

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log(USAGE)
    return 0
  }
  const report = loadReport(options)
  const backend = options.dryRun
    ? { name: options.backend }
    : selectIssueBackend(options, process.env, {
        label: ISSUE_LABEL,
        color: ISSUE_LABEL_COLOR,
        description: ISSUE_LABEL_DESCRIPTION,
      })
  await runDebtPublisher({
    publisher: MERGE_GATE_PUBLISHER,
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
