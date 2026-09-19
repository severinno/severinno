#!/usr/bin/env node

// =============================================================================
// declared-debt-issue.mjs
//
// Transforma em ISSUE ACIONÁVEL a dívida DECLARADA que VENCEU a janela de
// revisão — as isenções com data (`OUT_OF_SCOPE_ALLOWLIST`,
// `THIRD_PARTY_ALLOWLIST`, `ALLOWLIST` do `check-unused-deps`) e o baseline do
// `check-pipefail-sigpipe`.
//
// POR QUE ISSO PRECISA EXISTIR (o buraco que ele fecha): cada uma dessas listas
// tem `addedAt` e uma JANELA (180 dias, do módulo compartilhado
// `allowlist-review.mjs`), e o canal que as revisa é o job semanal
// `registry-allowlist-review`, em modo `--review`: passada a janela, a decisão
// vencida vira VIOLAÇÃO. Só que esse é o ÚNICO canal — quem olha o PR, o doctor
// ou o board não sabia que a isenção que sustenta o verde estava a 179 dias. Uma
// decisão vencida que só existe como RUN VERMELHO de um cron é o alerta que o
// repositório já classificou como mudo em quatro outros lugares
// (`actrc-sync-issue`, `required-checks-drift-issue`, `readme-reverse-issue`,
// `env-mirror-drift-issue`): ninguém abre o log de um cron que ficou vermelho, e
// a issue é o canal que alguém ABRE, atribui e cobra.
//
// FONTE ÚNICA: este publicador NÃO reimplementa a medição da idade — ele consome
// o `declared-debt.mjs` (o mesmo fato que o doctor publica na seção 6/7), que por
// sua vez lê as listas dos DONOS e aplica `reviewAddedAtEntries` /
// `baselineProblems`. A issue e o veredito não podem discordar sobre a idade.
//
// O OUTRO LADO DA DÍVIDA: publicar sem FECHAR deixa a issue aberta depois de
// resolvida — uma dívida que mente. Quando nenhuma decisão está vencida (o
// `addedAt` foi atualizado, ou a isenção foi aposentada), este script RECONCILIA:
// comenta a PROVA (por lista: quantas decisões, a mais antiga, a janela) e fecha
// as issues que ELE abriu. O ciclo é o do contrato (`issue-publish.mjs`).
//
// A GUARDA DO FECHAMENTO (`resolution.when`): só uma medição COMPLETA fecha. Uma
// lista ilegível (baseline corrompido) entra como `unread` e o `main` recusa
// (exit 1) antes do ciclo — "não medido" não é evidência de "reafirmado", e
// fechar por uma leitura que falhou é o fechamento otimista que o repositório
// recusa.
//
// POR QUE `invalid` NÃO ENTRA AQUI: decisão SEM registro (data ausente,
// impossível ou no futuro) não tem como envelhecer — ela já é violação nos DOIS
// modos dos guards (fail-closed, no PR e no cron), e o doctor a trata como
// BLOQUEANTE. Abrir issue para ela criaria um SEGUNDO canal para o mesmo
// problema, com remédios diferentes; este publicador é só sobre a JANELA.
//
// Usage:
//   node scripts/declared-debt-issue.mjs                      # mede o checkout
//   node scripts/declared-debt-issue.mjs --root DIR           # outro checkout
//   node scripts/declared-debt-issue.mjs --report /tmp/declared-debt.json
//   node scripts/declared-debt-issue.mjs --backend gitea --repo org/repo
//   node scripts/declared-debt-issue.mjs --dry-run
//
// Credenciais (nunca do arquivo — só do ambiente):
//   github: GH_TOKEN | GITHUB_TOKEN  (CLI `gh`, com escrita em issues)
//   gitea:  GITEA_TOKEN + GITEA_URL  (+ GITEA_REPOSITORY | --repo)
//
// Exit codes:
//   0 — nada vencido (e a dívida aberta foi fechada), ou issue criada/comentada,
//       ou já reportada (ou dry-run)
//   1 — erro real: lista ILEGÍVEL (não medido ≠ resolvido), relatório
//       ausente/inválido, credencial ausente, ou falha do backend
// =============================================================================

import { existsSync, readFileSync } from "node:fs"
import process from "node:process"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

import { collectDeclaredDebt, textoFonteVencida } from "./declared-debt.mjs"
import { defineDebtPublisher, runDebtPublisher, selectIssueBackend } from "./issue-publish.mjs"

/** Label de triagem (dedup + filtro no board). */
export const ISSUE_LABEL = "declared-debt-review"

/** Cor do label (hex sem `#`, o formato da CLI do `gh`). */
export const ISSUE_LABEL_COLOR = "FBCA04"

/** Descrição do label (aparece no board e explica a dívida). */
export const ISSUE_LABEL_DESCRIPTION =
  "Isenção declarada (com data e janela de revisão) que passou a janela sem ser reafirmada"

/**
 * O identificador do marcador — o dedup é POR publicador: uma isenção vencida
 * nunca pode ser confundida com o veredito do doctor (que diz que a forja não
 * está pronta) nem com os espelhos do BUN_VERSION.
 */
export const DECLARED_DEBT_MARKER_ID = "declared-debt-review"

/**
 * Título ESTÁVEL entre runs — de propósito NÃO inclui QUAL lista venceu (isso vai
 * no corpo): um título que muda a cada isenção abriria uma issue nova por
 * reafirmação em vez de comentar na dívida já aberta.
 */
export function reviewTitle() {
  return "Dívida declarada sem revisão dentro da janela (isenções com data)"
}

/**
 * A ASSINATURA do momento: quem venceu, com que data.
 *
 * Duas runs com o MESMO vencimento produzem a MESMA assinatura (dedup); uma lista
 * que vence DEPOIS muda a assinatura, e aí comentar é o comportamento certo — a
 * dívida mudou. A data entra na assinatura de propósito: reafirmar uma isenção e
 * deixar outras vencerem é um estado NOVO, não o mesmo ticket.
 *
 * @param {object} [fato] o fato do `declared-debt.mjs`
 * @returns {string}
 */
export function signatureOf(fato) {
  return [...(fato?.aged ?? [])]
    .map((e) => `${e.source?.id ?? "?"}:${e.id}:${e.addedAt}`)
    .sort()
    .join("\n")
}

/**
 * `true` quando há o que publicar: só a decisão VENCIDA abre dívida.
 *
 * A lista vazia, a lista ilegível e a lista sem nada declarado NÃO abrem ticket
 * aqui: a primeira é o estado saudável, a segunda é fail-closed do `main` (e não
 * um alerta que sempre acende), e a terceira é ausência de isenção — nenhuma
 * delas é um defeito do operador.
 *
 * @param {object} [fato]
 * @returns {boolean}
 */
export function isActionable(fato) {
  return (fato?.aged ?? []).length > 0
}

/** A janela de uma fonte, como texto (o `0 dia(s)` não existe: sem janela, omite). */
function janela(fonte) {
  return fonte?.reviewDays ? `janela de ${fonte.reviewDays} dia(s)` : "sem janela declarada"
}

/**
 * O CORPO da issue: o que venceu, onde, há quanto tempo, e o que fazer.
 *
 * O remédio é POR LISTA (o campo `remedy` do dono da lista): "reafirme a exceção"
 * significa uma coisa no escopo (`addedAt` da entrada), outra nas imagens de
 * terceiros e outra no baseline do SIGPIPE (`--update --reason`). Um remédio
 * genérico mandaria o leitor procurar — e o comando sai pronto para copiar.
 *
 * @param {object} fato
 * @returns {string}
 */
export function reviewProse(fato) {
  const linhas = []
  linhas.push(
    "⏳ **Dívida declarada sem revisão** — uma isenção com data passou a janela de revisão.",
  )
  linhas.push("")
  linhas.push(
    'Cada lista abaixo é uma decisão ESCRITA de "não consertar agora", com a data em que foi',
  )
  linhas.push(
    "tomada. Passada a janela, a decisão precisa ser REAFIRMADA (com a data nova) ou APOSENTADA —",
  )
  linhas.push("uma isenção que ninguém revisa vira permanente por esquecimento.")
  linhas.push("")
  for (const fonte of fato.sources.filter((f) => f.state === "aged")) {
    linhas.push(`### \`${fonte.listName}\` — ${fonte.aged.length} decisão(ões) vencida(s)`)
    linhas.push("")
    // A MESMA prosa do relatório do guard e da seção 6/7 do doctor: dono, a mais
    // antiga, a idade, a janela e o remédio DO DONO da lista — uma frase, uma
    // fonte. A tabela abaixo é o detalhe POR ENTRADA (o que a frase resume).
    linhas.push(textoFonteVencida(fonte))
    linhas.push("")
    linhas.push("| entrada | declarada em | idade | janela |")
    linhas.push("| :------ | :----------- | ----: | -----: |")
    for (const e of [...fonte.aged].sort((a, b) => b.days - a.days)) {
      linhas.push(`| \`${e.id}\` | ${e.addedAt} | ${e.days} dia(s) | ${e.limit} dia(s) |`)
    }
    linhas.push("")
  }
  linhas.push("### Como reproduzir (a mesma medição desta issue)")
  linhas.push("")
  linhas.push("```bash")
  linhas.push("node scripts/declared-debt.mjs           # o fato em texto (a IDADE de cada lista)")
  linhas.push("node scripts/declared-debt.mjs --json    # o mesmo, estruturado")
  linhas.push(
    "bun run doctor                           # o fato no veredito de prontidão (seção 6/7)",
  )
  linhas.push("```")
  linhas.push("")
  linhas.push("> A janela NÃO é uma régua deste script: ela vem do módulo compartilhado")
  linhas.push("> (`allowlist-review.mjs`) e é a MESMA que o job semanal usa em `--review`.")
  return linhas.join("\n")
}

/**
 * O comentário de RESOLUÇÃO — a PROVA do fechamento.
 *
 * Carrega o estado medido (por lista: quantas decisões, a mais antiga e a janela),
 * não só "resolvido": quem chegar depois lê o desfecho sem reconstruir o mundo na
 * data do fechamento.
 *
 * @param {object} fato
 * @returns {string}
 */
export function resolutionComment(fato) {
  const linhas = []
  linhas.push("✅ **Resolvido** — nenhuma decisão declarada está fora da janela de revisão.")
  linhas.push("")
  linhas.push("### O que foi medido agora (a prova)")
  linhas.push("")
  linhas.push("| lista | decisões | a mais antiga | janela |")
  linhas.push("| :---- | -------: | :------------ | -----: |")
  for (const fonte of fato?.sources ?? []) {
    const idade = fonte.oldest ? `${fonte.oldest.addedAt} (${fonte.oldest.days} dia(s))` : "—"
    linhas.push(`| \`${fonte.listName}\` | ${fonte.total} | ${idade} | ${janela(fonte)} |`)
  }
  linhas.push("")
  linhas.push("```bash")
  linhas.push("node scripts/declared-debt.mjs   # exit 0 = nenhuma decisão fora da janela")
  linhas.push("```")
  linhas.push("")
  linhas.push(
    "> Fechada automaticamente: se uma isenção voltar a vencer a janela, a mesma regra abre uma",
  )
  linhas.push("> issue nova (o dedup é entre as ABERTAS, pela assinatura do momento).")
  return linhas.join("\n")
}

/** O publicador — o contrato do `issue-publish.mjs`, com a prosa desta dívida. */
export const DECLARED_DEBT_PUBLISHER = defineDebtPublisher({
  name: DECLARED_DEBT_MARKER_ID,
  label: ISSUE_LABEL,
  labelColor: ISSUE_LABEL_COLOR,
  labelDescription: ISSUE_LABEL_DESCRIPTION,
  marker: { id: DECLARED_DEBT_MARKER_ID, format: "b64" },
  title: () => reviewTitle(),
  signature: (fato) => signatureOf(fato),
  body: (fato) => reviewProse(fato),
  actionable: (fato) => isActionable(fato),
  scope: { kind: "single" },
  resolution: {
    // A GUARDA DO FECHAMENTO: só uma medição COMPLETA fecha. `unread` (uma lista
    // que não pôde ser lida) NÃO é evidência de reafirmação — o `main` já recusa
    // antes de chegar aqui, mas a guarda fica declarada no contrato para o
    // caminho programático não fechar por uma leitura que falhou.
    when: (fato) => (fato?.unread ?? []).length === 0 && fato?.state !== "unread",
    comment: (fato) => resolutionComment(fato),
    reason: "nenhuma decisão declarada está fora da janela de revisão",
  },
  prose: {
    actionable: (fato) =>
      `⚠️  ${(fato?.aged ?? []).length} decisão(ões) declarada(s) VENCIDA(S) em ` +
      `${fato.sources.filter((f) => f.state === "aged").length} lista(s) — publicando issue acionável.`,
    inSync: (fato) =>
      `✅ Nenhuma decisão declarada fora da janela: ${fato?.total ?? 0} decisão(ões) em ` +
      `${(fato?.sources ?? []).length} lista(s), todas dentro do prazo de revisão.`,
    alreadyReported: (issue) =>
      `ℹ️  O mesmo vencimento já está reportado na issue #${issue.number} — sem ruído.`,
    commented: (issue) => `✅ Comentário adicionado à issue #${issue.number} (vencimento novo).`,
    created: (ref) => `✅ Issue criada: ${ref}`,
    reconciled: (count) =>
      `🔒 Reconciliado: ${count} issue(s) fechada(s) — a dívida não fica aberta depois de reafirmada/aposentada.`,
    dryRunTail: () => "\n(dry-run: nenhuma chamada ao backend de issues)",
    dryRunReconcile: () =>
      `   (dry-run: a reconciliação fecharia as issues abertas por este publicador, label '${ISSUE_LABEL}', com a prova no comentário)`,
  },
})

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * Lê um relatório JSON produzido por `declared-debt.mjs --json`.
 *
 * A validação é mínima e de propósito: o que o ciclo precisa é `state`, `aged`,
 * `invalid` e `sources` — um relatório sem eles seria lido como "nada vencido",
 * que é o falso verde que este caminho existe para não produzir.
 *
 * @param {string} reportPath
 * @returns {{state: string, aged: object[], invalid: object[], sources: object[], unread?: object[], total?: number}}
 */
export function readReportFile(reportPath) {
  if (!existsSync(reportPath)) throw new Error(`relatório não encontrado: ${reportPath}`)
  const json = JSON.parse(readFileSync(reportPath, "utf8"))
  if (typeof json.state !== "string") {
    throw new Error(`relatório inválido: campo 'state' ausente (${reportPath})`)
  }
  if (!Array.isArray(json.aged) || !Array.isArray(json.invalid) || !Array.isArray(json.sources)) {
    throw new Error(
      `relatório inválido: 'aged'/'invalid'/'sources' devem ser arrays (${reportPath})`,
    )
  }
  return json
}

export function parseArgs(argv) {
  const options = {
    report: null,
    root: null,
    dryRun: false,
    backend: "github",
    noReconcile: false,
    help: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--report") options.report = argv[++i] ?? null
    else if (arg === "--root") options.root = argv[++i] ?? null
    else if (arg === "--dry-run") options.dryRun = true
    else if (arg === "--no-reconcile") options.noReconcile = true
    else if (arg === "--backend") {
      const value = argv[++i] ?? ""
      if (!["github", "gitea"].includes(value)) {
        throw new Error(`--backend deve ser github|gitea (recebi '${value}')`)
      }
      options.backend = value
    } else if (arg === "--repo") options.repo = argv[++i] ?? null
    else if (arg === "--help" || arg === "-h") options.help = true
    else throw new Error(`Argumento desconhecido: ${arg}`)
  }
  return options
}

/**
 * O diagnóstico: do arquivo (`--report`) ou medindo o checkout com a MESMA função
 * do doctor (`collectDeclaredDebt`).
 *
 * `--report` existe para o workflow publicar o que JÁ mediu (uma medição, um
 * consumidor) — medir de novo aqui poderia divergir do que o job logou.
 *
 * @param {{report?: string|null, root?: string|null}} options
 * @returns {object}
 */
export function loadReport(options) {
  if (options.report) return readReportFile(options.report)
  return collectDeclaredDebt(options.root ? { root: resolve(options.root) } : {})
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log(
      "Uso: node scripts/declared-debt-issue.mjs [--root DIR] [--report /path/declared-debt.json]\n" +
        "       [--backend github|gitea] [--repo ORG/REPO] [--dry-run] [--no-reconcile]\n" +
        "  Com isenção vencida: publica/comenta a issue (com a idade e o remédio por lista).\n" +
        "  Sem isenção vencida: FECHA as issues que este script abriu (dívida reafirmada), com a prova.\n" +
        "  Lista ILEGÍVEL: recusa (exit 1) — não medido não é evidência de reafirmado.\n",
    )
    return 0
  }

  const fato = loadReport(options)

  // FAIL-CLOSED antes do ciclo: uma lista que não pôde ser lida deixa a idade
  // INDETERMINADA, e o fechamento automático passaria a apagar dívida com base
  // numa medição que não aconteceu.
  if (fato.state === "unread" || (fato.unread ?? []).length > 0) {
    console.error(
      `❌ a dívida declarada não pôde ser MEDIDA — ${(fato.unread ?? [])
        .map((f) => `${f.listName}: ${f.detail ?? "sem detalhe"}`)
        .join("; ")}`,
    )
    console.error(
      "   Não medido ≠ reafirmado: NADA foi publicado nem fechado. Conserte a leitura (o baseline",
    )
    console.error("   corrompido é o caso comum) e rode de novo.")
    return 1
  }

  // O ciclo inteiro (label idempotente, dedup por assinatura no corpo E nos
  // comentários, comentar no título já aberto, criar, e RECONCILIAR quando nada
  // está vencido) é o do contrato: uma segunda implementação seria uma regra
  // paralela que pode divergir sem nenhum teste vermelho.
  const backend = options.dryRun
    ? { name: options.backend }
    : selectIssueBackend(options, process.env, {
        label: ISSUE_LABEL,
        color: ISSUE_LABEL_COLOR,
        description: ISSUE_LABEL_DESCRIPTION,
      })
  await runDebtPublisher({
    publisher: DECLARED_DEBT_PUBLISHER,
    input: fato,
    backend,
    dryRun: options.dryRun,
    reconcile: !options.noReconcile,
  })
  return 0
}

/**
 * A GUARDA do fechamento, exposta como função — o teste a exercita sem furar o
 * contrato (e o nome diz a regra: só o MEDIDO fecha).
 */
export function shouldReconcile(fato) {
  return DECLARED_DEBT_PUBLISHER.resolution.when(fato)
}

/** A prosa do ciclo quando NADA está vencido — asserção testável, não detalhe interno. */
export function inSyncProse(fato) {
  return DECLARED_DEBT_PUBLISHER.prose.inSync(fato)
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
