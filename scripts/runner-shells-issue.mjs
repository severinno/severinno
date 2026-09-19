#!/usr/bin/env node

// =============================================================================
// runner-shells-issue.mjs
//
// Transforma o DRIFT dos shells da imagem do runner (o que a imagem TEM × o que
// o gate DECLARA) em uma ISSUE ACIONÁVEL — e FECHA a dívida quando a medição
// volta a bater com o declarado.
//
// POR QUE ISSO PRECISA EXISTIR: o `--shells` do `check-workflow-run-syntax.mjs`
// imprime o conjunto declarado e o comando que o mediu, mas quem RE-MEDE é uma
// pessoa — e ninguém lembra. A declaração vira presunção com data, e as duas
// direções da mentira são caras em sentidos opostos:
//
//   - declarado PRESENTE e a imagem mediu AUSENTE → o gate PASSA um passo
//     `shell:` que morre com `command not found` DEPOIS do setup (o defeito que
//     o gate existe para pegar, escondido por dentro dele);
//   - declarado AUSENTE e a imagem TEM → o gate REPROVA um passo legítimo.
//
// Nenhuma das duas deixa outro gate vermelho: o conjunto declarado não governa
// corretude de CI, só o veredito do próprio gate. O canal é este ticket.
//
// FONTE ÚNICA: este script NÃO reimplementa a medição nem a comparação — ele
// importa `measureShells`/`shellsDriftReport` do `runner-shells.mjs` (o mesmo
// módulo cujo `RUNNER_SHELLS` o gate importa). Assim a issue, o log do cron e o
// veredito do gate não podem discordar sobre o que é drift.
//
// E O OUTRO LADO DA DÍVIDA: publicar sem FECHAR deixa a issue ABERTA depois de
// resolvida — uma dívida que mente. Quando a medição não tem aviso nenhum, este
// script RECONCILIA: comenta a prova (a tabela medida) e fecha as issues que ELE
// abriu. E `unavailable` (não consegui medir: sem docker, imagem não puxável,
// `BUN_VERSION` sem valor) NÃO fecha nada — "não medido" não é evidência de
// "resolvido"; quem o torna visível é o step final do job, que falha.
//
// Usage:
//   node scripts/runner-shells-issue.mjs                        # mede e publica/fecha
//   node scripts/runner-shells-issue.mjs --report /tmp/runner-shells.json
//   node scripts/runner-shells-issue.mjs --backend gitea
//   node scripts/runner-shells-issue.mjs --dry-run
//   node scripts/runner-shells-issue.mjs --image ghcr.io/org/ubuntu-bun:<tag>
//
// Exit codes:
//   0 — publicou/comentou a dívida, OU reconciliou (a medição voltou a bater),
//       OU não havia o que publicar (e o log declara isso)
//   1 — erro real: relatório inexistente/ilegível, backend ausente/recusado, ou
//       falha do cliente de issues (fail-closed nos DOIS sentidos: um drift que
//       não pôde ser publicado é o mesmo alerta mudo de antes, e uma dívida
//       resolvida que não pôde ser fechada continua mentindo no board)
// =============================================================================

import { spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import process from "node:process"
import { pathToFileURL } from "node:url"

import {
  RUNNER_SHELLS,
  RUNNER_SHELLS_MISSING,
  measureShells,
  probeCommandText,
  runnerImageRef,
  shellsDriftReport,
} from "./runner-shells.mjs"
import {
  defineDebtPublisher,
  publisherBody,
  runDebtPublisher,
  selectIssueBackend,
} from "./issue-publish.mjs"

/** Label de triagem (dedup + filtro no board). */
export const ISSUE_LABEL = "runner-shells-drift"
export const ISSUE_LABEL_COLOR = "1D76DB"
export const ISSUE_LABEL_DESCRIPTION =
  "Drift entre os shells que a imagem do runner embarca e o que o gate declara (RUNNER_SHELLS)"

/**
 * O identificador do marcador na issue (o dedup é POR publicador: um drift de
 * shells nunca pode ser confundido com o veredito do doctor nem com o drift de
 * branch protection).
 */
export const RUNNER_SHELLS_MARKER_ID = "runner-shells-drift"

/**
 * Título ESTÁVEL entre runs — de propósito NÃO inclui a imagem nem os nomes que
 * divergiram (isso vai no corpo): um título que muda a cada rebuild abriria uma
 * issue nova por drift em vez de comentar na dívida já aberta.
 */
export function driftTitle() {
  return "Os shells da imagem do runner divergem do que o gate declara (`RUNNER_SHELLS`)"
}

/**
 * Assinatura estável do drift: os avisos, ordenados. Duas runs com a MESMA
 * divergência produzem a MESMA assinatura (dedup); uma divergência DIFERENTE
 * (outro shell, outra direção) produz outra — e aí comentar é o comportamento
 * certo, porque a dívida mudou.
 */
export function signatureOf(report) {
  return [...(report?.warnings ?? [])].sort().join("\n")
}

/**
 * `true` quando há o que publicar: só a DIVERGÊNCIA MEDIDA abre dívida.
 *
 * `unavailable` NÃO é dívida (não havia medição — abrir ticket para ele faria um
 * alerta que sempre acende) e NÃO é "em sincronia": quem decide o que fazer com
 * a ausência é o job, que FALHA com o remédio nomeado.
 */
export function isActionable(report) {
  return report?.state === "measured" && signatureOf(report) !== ""
}

/** O CONTRATO deste publicador (`issue-publish.mjs`). */
export const RUNNER_SHELLS_PUBLISHER = defineDebtPublisher({
  name: RUNNER_SHELLS_MARKER_ID,
  label: ISSUE_LABEL,
  labelColor: ISSUE_LABEL_COLOR,
  labelDescription: ISSUE_LABEL_DESCRIPTION,
  marker: { id: RUNNER_SHELLS_MARKER_ID, format: "b64" },
  title: () => driftTitle(),
  signature: (report) => signatureOf(report),
  body: (report) => driftProse(report),
  actionable: (report) => isActionable(report),
  scope: { kind: "single" },
  resolution: {
    // A GUARDA DO FECHAMENTO: só um `measured` sem aviso fecha a dívida.
    //
    // POR QUE NÃO O DEFAULT (`() => true`): o outro estado sem avisos é
    // `unavailable` — "não consegui medir". Fechar por ele apagaria a dívida com
    // base numa medição que não aconteceu (sem docker no job, imagem não
    // puxável), que é o fechamento otimista que este repositório recusa.
    when: (report) => report?.verdict === "in-sync",
    comment: (report) => resolutionComment(report),
    reason: "a medição voltou a bater com o que o gate declara",
  },
  prose: {
    actionable: (report) =>
      `⚠️  Drift de shells detectado (${(report?.warnings ?? []).length} aviso(s)) na imagem` +
      ` \`${report?.image ?? "?"}\` — publicando issue acionável.`,
    inSync: (report) =>
      report?.verdict === "in-sync"
        ? `✅ Em sincronia: a medição de \`${report.image}\` concorda com o declarado em` +
          ` RUNNER_SHELLS/RUNNER_SHELLS_MISSING (${report?.counts?.probed ?? "?"} nome(s) perguntado(s)).`
        : `· NÃO COMPARÁVEL (\`${report?.state ?? "?"}\`): ${report?.detail ?? "sem diagnóstico"}` +
          " — o cron não mediu o drift neste ambiente (sem docker, imagem não puxável ou BUN_VERSION sem valor).",
    alreadyReported: (issue) =>
      `ℹ️  Drift idêntico já reportado na issue #${issue.number} — sem ruído.`,
    commented: (issue) => `✅ Comentário adicionado à issue #${issue.number} (drift novo).`,
    reconcileDeferred: () =>
      "   (--no-reconcile: o fechamento é do job que conhece TODOS os relatórios)",
  },
})

/**
 * A TABELA do que a imagem tem × o que o gate declara — a prova, item por item.
 *
 * Ela sai nos DOIS corpos (o da abertura e o do fechamento): um ticket que só
 * listasse os avisos obrigaria quem lê a reconstruir o conjunto inteiro, e um
 * fechamento sem a tabela não provaria nada a quem chegar depois.
 */
export function comparedLines(report) {
  const lines = []
  const present = report?.present ?? {}
  const declaredPresent = report?.declared?.present ?? RUNNER_SHELLS
  const declaredMissing = report?.declared?.missing ?? RUNNER_SHELLS_MISSING
  const missing = report?.missing ?? []
  for (const nome of [...(report?.probed ?? [])]) {
    const tem = Object.prototype.hasOwnProperty.call(present, nome)
    const declaradoTem = Object.prototype.hasOwnProperty.call(declaredPresent, nome)
    const declaradoNaoTem = declaredMissing.includes(nome)
    const medido = tem
      ? `\`${present[nome]}\``
      : missing.includes(nome)
        ? "ausente"
        : "**não respondeu**"
    const declarado = declaradoTem
      ? `tem (\`${declaredPresent[nome]}\`)`
      : declaradoNaoTem
        ? "não tem"
        : "**não declarado**"
    const desfecho = tem === declaradoTem ? "—" : "**DIVERGE**"
    lines.push(`| \`${nome}\` | ${declarado} | ${medido} | ${desfecho} |`)
  }
  return lines
}

/**
 * A PROVENIÊNCIA: qual artefato foi medido, com que digest e com que comando.
 *
 * O comando é GERADO pela mesma função que a medição executa (`probeCommandText`)
 * — um comando copiado para a prosa envelheceria em silêncio.
 */
export function provenanceLines(report) {
  const lines = []
  lines.push(`- imagem medida: \`${report?.image ?? "<sem ref — BUN_VERSION não resolvido>"}\``)
  lines.push(
    `- digest: \`${report?.digest ?? "<não perguntado>"}\`` +
      (report?.digestChanged === true
        ? ` — **DIFERE do declarado** (\`${report?.declaredDigest}\`): a tag foi reconstruída.` +
          " Isso **não** é a dívida deste ticket (o conjunto pode seguir igual), mas a data da" +
          " declaração ficou velha: renove-a junto do conserto."
        : report?.digestChanged === false
          ? " — igual ao declarado."
          : " — não foi possível perguntar ao cliente de container."),
  )
  lines.push(`- declaração de referência: medida em \`${report?.declaredMeasuredAt ?? "?"}\``)
  lines.push(`- comando que mediu (re-executável):`)
  lines.push("")
  lines.push("```bash")
  lines.push(probeCommandText(report?.image ?? "<ref>"))
  lines.push("```")
  return lines
}

/**
 * A PROSA do corpo da issue — sem o marcador: quem o compõe é o contrato
 * (`publisherBody`), para não existir um publicador que esqueça de escrevê-lo e
 * publique uma dívida que o fechamento automático depois não reconheça.
 */
function driftProse(report) {
  const lines = []
  lines.push(
    `A **imagem do runner** mede um conjunto de shells diferente do que o gate` +
      " (`check-workflow-run-syntax.mjs`) declara em `RUNNER_SHELLS`/`RUNNER_SHELLS_MISSING`.",
  )
  lines.push("")
  lines.push(
    "Nenhum outro gate fica vermelho por causa disso: a declaração só governa o veredito do" +
      " **próprio gate**. E as duas direções da divergência doem em sentidos opostos —" +
      " declarar PRESENTE o que a imagem não tem faz o gate **PASSAR** um passo que morre com" +
      " `command not found` depois do setup; declarar AUSENTE o que a imagem tem faz o gate" +
      " **REPROVAR** um passo legítimo.",
  )
  lines.push("")
  lines.push("### Divergências")
  lines.push("")
  for (const warning of report?.warnings ?? []) lines.push(`- ${warning}`)
  lines.push("")
  lines.push("### O que a imagem tem × o que o gate declara")
  lines.push("")
  lines.push("| shell | declarado | medido agora | desfecho |")
  lines.push("| :---- | :-------- | :----------- | :------- |")
  lines.push(...comparedLines(report))
  lines.push("")
  lines.push("### Proveniência da medição")
  lines.push("")
  lines.push(...provenanceLines(report))
  lines.push("")
  lines.push("### Corrigir")
  lines.push("")
  lines.push(
    "A declaração e o probe vivem num arquivo só (`scripts/runner-shells.mjs`), e o gate os" +
      " importa — consertar num lugar conserta nos dois:",
  )
  lines.push("")
  lines.push("```bash")
  lines.push("node scripts/runner-shells.mjs --json   # re-mede e imprime o veredito")
  lines.push("node scripts/check-workflow-run-syntax.mjs --shells   # o que o gate declara hoje")
  lines.push("```")
  lines.push("")
  lines.push(
    "1. mova o nome para a lista certa (`RUNNER_SHELLS` com o **caminho medido**, ou" +
      " `RUNNER_SHELLS_MISSING`);",
  )
  lines.push(
    "2. atualize `RUNNER_IMAGE.digest` e `measuredAt` com o que a medição de agora imprimiu —" +
      " é a proveniência que diz QUAL artefato foi medido;",
  )
  lines.push(
    "3. rode a suíte do gate (`bunx vitest run src/lib/__tests__/check-workflow-run-syntax.test.ts`" +
      " `src/lib/__tests__/runner-shells.test.ts`) e `node scripts/runner-shells.mjs` de novo: ele" +
      " tem de sair 0 (é o mesmo comando que fecha este ticket).",
  )
  lines.push("")
  lines.push(
    "> Se o shell que sumiu/apareceu é ESPERADO (a base da imagem mudou de propósito), o" +
      " conserto acima é o certo — o que não pode é a declaração continuar afirmando uma" +
      " medição que ninguém refez.",
  )
  lines.push("")
  return lines.join("\n")
}

/** O corpo COMPLETO da issue: a prosa + o marcador, como o contrato os compõe. */
export function driftBody(report) {
  return publisherBody(RUNNER_SHELLS_PUBLISHER, report)
}

/**
 * O comentário de RESOLUÇÃO — o que a issue passa a contar quando é fechada.
 *
 * Tem de carregar a PROVA (a tabela medida, o digest, o comando), não só
 * "resolvido": quem chegar depois lê o desfecho sem reconstruir o estado do
 * mundo na data do fechamento. E tem de dizer o ESCOPO — o fechamento vale para
 * a REF medida (o artefato do registry); uma imagem local construída de outra
 * base precisa da mesma re-medição onde ela roda.
 */
export function resolutionComment(report) {
  const lines = []
  lines.push(
    "✅ **Resolvido** — a medição da imagem do runner voltou a concordar com o que o gate" +
      " declara (`RUNNER_SHELLS`/`RUNNER_SHELLS_MISSING`).",
  )
  lines.push("")
  lines.push("### A prova (medido agora)")
  lines.push("")
  lines.push("| shell | declarado | medido agora | desfecho |")
  lines.push("| :---- | :-------- | :----------- | :------- |")
  lines.push(...comparedLines(report))
  lines.push("")
  lines.push(...provenanceLines(report))
  lines.push("")
  lines.push(
    "> **Escopo deste fechamento:** a medição foi feita na ref do registry acima (a imagem que" +
      " o compose puxa). Uma imagem local construída de OUTRA base no mesmo host continua" +
      " precisando da mesma re-medição lá (`node scripts/runner-shells.mjs`).",
  )
  lines.push("")
  lines.push(
    "> Fechada automaticamente: se a imagem mudar de novo e a declaração ficar para trás, a" +
      " mesma medição abre uma issue nova com a assinatura do momento (o dedup é entre as ABERTAS).",
  )
  return lines.join("\n")
}

/**
 * O relatório: de um JSON gravado (`--report`, produzido pelo
 * `runner-shells.mjs --json`) ou MEDINDO agora com a régua compartilhada.
 *
 * O JSON é validado na forma mínima (o `state`): um arquivo truncado não pode
 * virar um relatório vazio, que o comparador leria como "sem drift".
 */
export function loadReport(options, { run = spawnSync, env = process.env } = {}) {
  if (options.report !== null && options.report !== undefined) {
    if (!existsSync(options.report)) {
      throw new Error(`relatório não encontrado: ${options.report}`)
    }
    const json = JSON.parse(readFileSync(options.report, "utf8"))
    if (!["measured", "unavailable"].includes(json?.state)) {
      throw new Error(
        `relatório inválido (${options.report}): campo 'state' ausente ou desconhecido` +
          ` (${JSON.stringify(json?.state ?? null)}) — um relatório truncado não pode passar por medição`,
      )
    }
    return json
  }
  return shellsDriftReport({
    measurement: measureShells({
      ref: options.image ?? runnerImageRef(env),
      docker: options.docker ?? "docker",
      run,
    }),
  })
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const options = {
    report: null,
    image: null,
    docker: "docker",
    backend: "github",
    dryRun: false,
    help: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--report" || arg === "--image" || arg === "--docker") {
      const value = argv[++i]
      if (value === undefined || value === "") throw new Error(`${arg} exige um valor`)
      if (arg === "--report") options.report = value
      else if (arg === "--image") options.image = value
      else options.docker = value
    } else if (arg === "--backend") {
      const value = argv[++i] ?? ""
      if (!["github", "gitea"].includes(value)) {
        throw new Error(`--backend deve ser github|gitea (recebi '${value}')`)
      }
      options.backend = value
    } else if (arg === "--dry-run") options.dryRun = true
    else if (arg === "--help" || arg === "-h") options.help = true
    else throw new Error(`Argumento desconhecido: ${arg}`)
  }
  return options
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log(
      "Uso: node scripts/runner-shells-issue.mjs [--report /path/to/runner-shells.json]\n" +
        "       [--image <ref>] [--docker <cliente>] [--backend github|gitea] [--dry-run]\n" +
        "  Com drift: publica/comenta a issue.\n" +
        "  Sem drift: FECHA as issues que este script abriu (dívida resolvida), com a prova no comentário.\n\n" +
        "  --report: lê o relatório de um JSON (produzido por runner-shells.mjs --json)\n" +
        "            em vez de medir novamente.\n" +
        "  Sem --report e sem --image, a ref vem do env (BUN_VERSION + IMAGE_REGISTRY/IMAGE_NAMESPACE).",
    )
    return 0
  }

  const report = loadReport(options)

  // O CICLO INTEIRO (label idempotente, dedup por assinatura no corpo E nos
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
    publisher: RUNNER_SHELLS_PUBLISHER,
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
