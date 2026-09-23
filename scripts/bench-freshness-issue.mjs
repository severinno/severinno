#!/usr/bin/env node

// =============================================================================
// bench-freshness-issue.mjs
//
// Transforma em ISSUE ACIONÁVEL a régua VELHA do bench: as famílias que a
// baseline versionada declara como MEDIDAS e cujo commit de origem ficou para
// trás de mais de N commits.
//
// POR QUE ISSO PRECISA EXISTIR (o defeito medido, não hipotético): a baseline do
// `bench-guard-timing` guarda, por família, o ATO e o COMMIT da medição
// (`meta.families`), e o número dela é consumido FORA do bench — o modelo de
// latência de merge (`ci/merge-latency.json`) declara o custo do job a partir
// dele. Em 09/2026 o `mutation-guards` estava declarado em 271.755ms com a matriz
// medindo 380.700ms: **28% de divergência**, achada por acidente, porque o
// repositório media a árvore e nunca olhava QUANDO o número declarado foi
// medido. A comparação por percentual não fecha esse buraco: ela compara dois
// números e é cega para a IDADE de um deles.
//
// O CANAL é a issue, e não o run vermelho: re-medir é uma decisão DELIBERADA (o
// ato move a baseline de propósito — `bun run bench:guard-timing:baseline`), e um
// cron que ficasse vermelho por uma medição que envelheceu ensinaria a ignorar o
// vermelho. A issue tem o número, a origem e a idade de cada família, é deduplicada
// por assinatura (a FAIXA da severidade, não o número do dia) e se FECHA sozinha
// quando a régua volta a estar dentro do teto.
//
// FONTE ÚNICA: este publicador NÃO reimplementa a medição — ele consome
// `readFreshness` (`bench-freshness.mjs`), o MESMO fato que o doctor publica
// na seção 9/9 do relatório de prontidão. A issue e o veredito não podem
// discordar sobre a idade.
//
// A GUARDA DO FECHAMENTO (`resolution.when`, e ela é o coração deste arquivo):
// fechar exige que a idade tenha sido MEDIDA para TODAS as famílias julgadas —
// `state === "measured"` e nenhuma `unknown`. Uma família sem idade (clone raso,
// git ausente) NÃO é evidência de frescor: fechar por ela seria o fechamento
// otimista que o repositório recusa. E `diverged` (o commit de origem fora da
// história) também impede o fechamento, porque o número ali não se reproduz
// nesta árvore — o remédio é a mesma re-medição deliberada.
//
// Usage:
//   node scripts/bench-freshness-issue.mjs                 # publica (ou fecha)
//   node scripts/bench-freshness-issue.mjs --baseline OUTRO.json
//   node scripts/bench-freshness-issue.mjs --dry-run       # imprime, não chama a forja
//   node scripts/bench-freshness-issue.mjs --backend gitea
//   node scripts/bench-freshness-issue.mjs --no-reconcile
//   node scripts/bench-freshness-issue.mjs --help
//
// Exit codes:
//   0 — MEDIDA: publicou, comentou, fechou ou não havia nada a fazer
//   1 — NÃO MEDIDA (arquivo ausente/inválido, git incapaz de responder) ou uso
//       inválido: um cron que não mediu não pode passar por verde — e por isso o
//       passo que o chama fica vermelho
// =============================================================================

import process from "node:process"
import { pathToFileURL } from "node:url"

import {
  BASELINE_PATH,
  FRESHNESS_MAX_COMMITS_BEHIND,
  MODEL_PATH,
  REMEDY_COMMAND,
  agedDeclarations,
  anchorLabel,
  freshnessLine,
  matrixLagLine,
  readFreshness,
  tetoLine,
  unknownDeclarations,
} from "./bench-freshness.mjs"
import {
  defineDebtPublisher,
  publisherBody,
  runDebtPublisher,
  selectIssueBackend,
} from "./issue-publish.mjs"

/** Label de triagem (dedup + filtro no board). */
export const ISSUE_LABEL = "bench-freshness-drift"

/** Cor do label (hex sem `#`, o formato da CLI do `gh`). */
export const ISSUE_LABEL_COLOR = "C5DEF5"

/** Descrição do label (aparece no board e explica a dívida). */
export const ISSUE_LABEL_DESCRIPTION =
  "Uma declaração datada envelheceu: a origem (commit das famílias do bench, data dos números do modelo de latência) ficou atrás do teto de commits, ou o REGISTRO DO ATO ficou atrás da própria MATRIZ (o master e as suítes que ele cita) — o teto dela é o ritmo DELA (job semanal)"

/** Id do marcador invisível que carrega a assinatura (o dedup é por publicador). */
export const MARKER_ID = "bench-freshness-drift"

// ---------------------------------------------------------------------------
// Funções puras (exportadas para teste unitário — sem rede, sem gh)
// ---------------------------------------------------------------------------

/** A entrada do publicador É o fato da régua (uma medição, um consumidor). */
export function inputOf(fact) {
  return fact
}

/**
 * O que está VENCIDO — a dívida de agora: as declarações atrás do teto de idade
 * E o REGISTRO DO ATO atrás da matriz (a régua única é a do `bench-freshness.mjs`,
 * para o doctor, o `crossCheck` e este publicador não terem três noções do que é
 * estar fora do teto).
 */
export function agedOf(input) {
  return agedDeclarations(input)
}

/** As famílias cuja origem SAIU da história (o número não se reproduz aqui). */
export function divergedOf(input) {
  return input?.families?.filter((f) => f.state === "diverged") ?? []
}

/** As declarações SEM medição (clone raso, git ausente) — não são "frescas". */
export function unknownOf(input) {
  return unknownDeclarations(input)
}

/** `true` se ALGUMA família medida venceu o teto ou saiu da história. */
export function isActionable(input) {
  return input?.state === "measured" && agedOf(input).length + divergedOf(input).length > 0
}

/**
 * O NÚMERO do teto efetivo: o DERIVADO do ritmo (`fact.teto`, o caminho normal)
 * ou, quando o fato não traz procedência, o que o fato declara (`maxBehind`) — e
 * a reserva só como último recurso de um input antigo. Um litério aqui seria um
 * segundo teto, e o texto da issue passaria a divergir da régua.
 */
function tetoEfetivo(input) {
  return input?.teto?.teto ?? input?.maxBehind ?? FRESHNESS_MAX_COMMITS_BEHIND
}

/**
 * A FAIXA da severidade: QUANTOS tetos a família mais velha já passou.
 *
 * É a severidade em ordem de grandeza, não o número do commit — a assinatura
 * não pode carregar o `behind` exato, senão ela mudaria a CADA commit do
 * repositório e o dedup não deduplicaria nada (o ruído que ele existe para
 * impedir). A faixa muda quando a dívida DOBRA de tamanho, e aí comentar é o
 * certo.
 */
export function bandOf(input) {
  const teto = tetoEfetivo(input)
  // A faixa das declarações de IDADE (commits até `HEAD`): a unidade da matriz NÃO
  // entra nesta conta — os dois números não são comparáveis, e um `behind` de
  // matriz medido contra o teto de `HEAD` seria um número inventado.
  const pior = Math.max(
    0,
    ...agedOf(input)
      .filter((f) => (f.clock ?? "head") !== "matriz")
      .map((f) => f.behind ?? 0),
  )
  const banda = teto > 0 ? Math.floor(pior / teto) : 0
  // A faixa do RELÓGIO DA MATRIZ é contra o teto DELA: a assinatura muda quando a
  // dívida DOBRA em qualquer um dos dois relógios — comentar é o certo —, e não a
  // cada commit que a matriz andar (o ruído que o dedup existe para impedir).
  const tetoDaMatriz = input?.matrix?.teto?.teto
  const bandaMatriz =
    input?.matrix?.aged && typeof tetoDaMatriz === "number" && tetoDaMatriz > 0
      ? Math.floor((input.matrix.lag ?? 0) / tetoDaMatriz)
      : 0
  return Math.max(banda, bandaMatriz)
}

/**
 * Assinatura estável da dívida: QUAIS famílias estão vencidas/divergentes e a
 * FAIXA da pior.
 *
 * As declarações entram NOMEADAS (e ordenadas): duas de idades diferentes são
 * duas dívidas diferentes, e a lista é estável entre runs (ao contrário do
 * `behind`, que anda sozinho a cada commit).
 *
 * A CHAVE `families=` do marcador é CONGELADA por compatibilidade: ela nasceu
 * quando o fato só tinha as famílias do bench, e a assinatura é o contrato do
 * ciclo abrir/fechar (mudá-la faria o publicador perder a issue aberta). O que a
 * chave LISTA hoje são todas as declarações vencidas — ver o `kind` de cada uma.
 */
export function signatureOf(input) {
  const nomes = [
    ...agedOf(input).map((f) => f.family),
    ...divergedOf(input).map((f) => `${f.family}!`),
  ]
    .sort()
    .join("+")
  return `bench-freshness:families=${nomes || "none"}:band=${bandOf(input)}`
}

/**
 * Título ESTÁVEL entre runs — não leva números nem commits (isso vai no corpo).
 *
 * Ele nomeia as DUAS perguntas que este canal carrega: a idade das declarações
 * datadas (com o teto do ritmo do repositório) e o relógio da MATRIZ (com o teto
 * do ritmo DELA). Mudá-lo faria o publicador perder a issue aberta (o marcador é
 * o contrato do ciclo), então ele muda UMA vez, aqui, e não por run.
 */
export function freshnessTitle() {
  return "A idade das declarações datadas passou o teto (bench · modelo de latência · matriz)"
}

/** A tabela da medição inteira: declaração, origem, idade e ato. */
function measurementTable(input) {
  const lines = []
  lines.push("| declaração | tipo | origem | atrás de HEAD | estado | medição |")
  lines.push("| :--------- | :--- | :----- | -------------: | :----- | :------ |")
  for (const f of input.families ?? []) {
    const marca =
      f.state === "fresh"
        ? "✅ fresca"
        : f.state === "aged"
          ? "❌ **vencida**"
          : f.state === "diverged"
            ? "❌ **fora da história**"
            : "⚠️ sem idade"
    const idade = f.behind === null ? "—" : `${f.behind}`
    const ancora = f.date
      ? ` (âncora ${anchorLabel({ date: f.date, kind: f.anchorKind })})`
      : f.commitDate
        ? ` (${f.commitDate})`
        : ""
    const origem = f.commit ? `\`${f.commit}\`${ancora}` : "—"
    const ato = f.act ? `${f.act}${f.source ? ` de \`${f.source}\`` : ""}` : "—"
    lines.push(
      `| \`${f.family}\` | ${f.kind ?? "bench-family"} | ${origem} | ${idade} | ${marca} | ${ato} |`,
    )
  }
  return lines
}

/**
 * Corpo da issue em markdown: o que a régua mede, a medição inteira e o remédio.
 * Sem a tabela a issue só diz "está velha" e transfere a investigação.
 */
function freshnessProse(input) {
  const vencidas = agedOf(input).length
  const fora = divergedOf(input).length
  const semIdade = unknownOf(input).length
  const lines = []

  lines.push(
    `A régua da idade mediu a ORIGEM de cada **declaração datada**: o commit das famílias ` +
      `MEDIDAS da baseline do bench (\`${input.file ?? BASELINE_PATH}\`), a data própria de cada ` +
      `número declarado do modelo de latência (\`${MODEL_PATH}\`) e a âncora datada de cada tabela ` +
      `de custo do README. Hoje: **${vencidas} vencida(s)**` +
      `${fora > 0 ? ` e **${fora} fora da história**` : ""} contra o teto de ` +
      `**${tetoEfetivo(input)} commits** para famílias e números ` +
      `declarados (${tetoLine(input)}; tabelas do README não têm teto: a idade delas é ` +
      `PUBLICADA — ver o \`ceiling\` de cada uma). ` +
      "A MESMA régua mede o RELÓGIO DA MATRIZ: quantos commits o master e as suítes " +
      "que ele cita andaram DEPOIS do commit de origem do ato — o teto DESSA pergunta " +
      "é o ritmo dela, não o do repositório (ver o bloco do item datado abaixo).",
  )
  lines.push("")
  lines.push("### O que venceu")
  lines.push("")
  for (const f of [...agedOf(input), ...divergedOf(input)]) {
    // O relógio de cada declaração vai DITO: a de idade conta commits até `HEAD`,
    // a da MATRIZ conta commits dela. Sem o `clock` na frase, as duas seriam a
    // mesma dívida com dois números que não se comparam.
    if (f.clock === "matriz") {
      // A frase da matriz já carrega o número, a data do primeiro commit que ela
      // ganhou depois do ato e o teto DELA (é a MESMA linha do relatório): repetir
      // aqui um segundo número seria a segunda régua do mesmo fato.
      lines.push(`- **\`${f.family}\`** — ${f.reason}`)
      continue
    }
    const origemDita = f.date
      ? `o número foi MEDIDO em \`${f.commit}\` (a âncora \`${anchorLabel({ date: f.date, kind: f.anchorKind })}\` do \`${f.source}\` resolve para ele)`
      : `o número foi medido em \`${f.commit}\``
    const porque =
      f.state === "aged"
        ? `${origemDita} e esse commit está **${f.behind} commit(s)** atrás de \`${input.head}\``
        : `o commit de origem \`${f.commit}\` **não é ancestral** de \`${input.head}\` (a história foi reescrita)`
    lines.push(`- **\`${f.family}\`** — ${porque}. ${f.reason}`)
  }
  lines.push("")
  lines.push(...matrixProse(input))
  if (semIdade > 0) {
    lines.push(
      `> ⚠️  ${semIdade} declaração(ões) ficaram SEM idade medida (${unknownOf(input)
        .map((f) => `\`${f.family}\``)
        .join(
          ", ",
        )}) — "não consegui medir" não é "está fresca" (e uma declaração sem a PRÓPRIA data responde exatamente isso), e o fechamento automático ` +
        "fica suspenso enquanto a medição não cobrir todas as declarações.",
    )
    lines.push("")
  }
  lines.push("### A medição inteira (contexto)")
  lines.push("")
  lines.push(...measurementTable(input))
  lines.push("")
  lines.push(
    `> HEAD medido: \`${input.head}\` · teto: ${tetoEfetivo(input)} commits ` +
      "para famílias do bench e números declarados · tabelas de custo do README: sem teto (a idade é publicada acima)",
  )
  lines.push("")
  lines.push(`> ${tetoLine(input)}`)
  lines.push("")
  lines.push("### Por que isto é dívida, e não ruído")
  lines.push("")
  lines.push(
    "O número da baseline é consumido FORA do bench: o modelo de latência de merge " +
      "(`ci/merge-latency.json`) e as tabelas do README declaram o custo dos jobs a partir dele. " +
      "Quando a árvore anda e a baseline não, a declaração passa a descrever um código que não " +
      "existe mais — foi exatamente assim que uma divergência de **28%** no `mutation-guards` " +
      "(271.755ms declarados × 380.700ms medidos) viveu sem que nenhum guard a nomeasse: " +
      "a comparação por percentual é cega para a IDADE dos dois números que compara.",
  )
  lines.push("")
  lines.push("### Olhar")
  lines.push("")
  lines.push("```bash")
  lines.push("bun run bench:guard-timing              # mede e imprime a medição inteira")
  lines.push(`${REMEDY_COMMAND}   # re-mede e MOVE a baseline (ato deliberado)`)
  lines.push(
    "node scripts/bench-freshness.mjs        # a idade de TODAS as declarações, sem medir nada",
  )
  lines.push("```")
  lines.push("")
  lines.push(
    "Mover a baseline é DECISÃO REGISTRADA — o ato grava o commit de origem do que mediu, " +
      "e é essa procedência que esta régua lê. Re-medir sem mover não resolve: o número declarado " +
      "continua sendo o antigo. Para as declarações datadas vale o mesmo: o número do modelo de " +
      `latência leva a \`date\` DELE (\`${MODEL_PATH}\`) e a tabela do README a âncora do bloco — ` +
      "re-medir sem atualizar a data/âncora deixa a idade contando do mesmo lugar.",
  )
  lines.push("")
  return lines.join("\n")
}

/**
 * O ITEM DATADO DO REGISTRO DO ATO no corpo — o relógio da matriz.
 *
 * O que ele DATA é o primeiro commit que a matriz ganhou DEPOIS da origem do ato:
 * é ali que o registro passou a descrever uma matriz que não existe mais, e é
 * dessa data que a dívida envelhece. O teto vem do ritmo DELA (`tetoDaMatriz`),
 * com a procedência dita — um teto derivado do ritmo e um de reserva não podem
 * sair com o mesmo texto justamente onde a diferença entre veredito e dúvida é
 * decidida.
 *
 * Uma medição que NÃO aconteceu sai como SUSPENSÃO do fechamento, nunca como "a
 * matriz não andou": é a mesma disciplina do resto do canal.
 */
function matrixProse(input) {
  const m = input?.matrix
  if (!m) return []
  const lines = []
  lines.push("### O registro do ato × a MATRIZ (o relógio dela)")
  lines.push("")

  if (m.state !== "measured") {
    lines.push(
      `> ⚠️  **NÃO medido** — ${matrixLagLine(m)}. O fechamento automático fica suspenso: ` +
        "'não consegui medir' não é 'a matriz que o ato registrou é a de agora'.",
    )
    lines.push("")
    return lines
  }

  const curto = (alvo) =>
    alvo?.commit ? `\`${alvo.commit.slice(0, 12)}\`${alvo.date ? ` (${alvo.date})` : ""}` : "—"
  const teto = m.teto ?? {}
  const doRitmo =
    teto.origem === "medido"
      ? `${teto.commits} commit(s) em ${teto.janelaDias} dias = ` +
        `${Math.round((teto.commitsPorCiclo ?? 0) * 10) / 10}/ciclo × ${teto.ciclos} ciclos de ${teto.cicloDias}d`
      : `RESERVA declarada: ${teto.motivo}`

  lines.push(
    `O ato ancorou em ${curto(m.origin)} e a **matriz andou ${m.lag} commit(s)** desde então` +
      (m.since
        ? ` — o primeiro deles em ${curto(m.since)}, e é essa a data em que o registro passou a descrever uma matriz que esta árvore não tem mais`
        : ` (a matriz desta árvore é ${curto(m.matriz)}` +
          `${m.matriz?.commit === m.origin?.commit ? ", o PRÓPRIO commit do ato" : ", e nenhum commit a tocou depois do ato"})`) +
      `. O teto DESSA pergunta é o ritmo DELA: **${teto.teto} commit(s) da matriz** (${doRitmo}).`,
  )
  lines.push("")
  lines.push(
    `- Escopo julgado: \`${m.escopo?.master}\` + as **${m.escopo?.paths?.length ?? 1}** suíte(s) que ele cita, na origem e agora (as suítes entram porque é nelas que o CUSTO mora: um corpo de suíte que muda move o número declarado do job tanto quanto um sub-test novo).`,
  )
  if (m.escopo?.state !== "lido" && m.escopo?.reason) lines.push(`- ⚠️  ${m.escopo.reason}`)
  lines.push(
    `- Remédio: \`${REMEDY_COMMAND}\` — o ato re-ancora o registro na matriz DESTA árvore (é o commit de origem que ele grava que esta régua lê), com a árvore JÁ COMMITADA.`,
  )
  lines.push("")
  return lines
}

/** O corpo COMPLETO da issue: a prosa + o marcador, como o contrato os compõe. */
export function freshnessBody(input) {
  return publisherBody(BENCH_FRESHNESS_PUBLISHER, input)
}

/**
 * O comentário de RESOLUÇÃO — a prova de que a régua voltou para dentro do teto.
 * Entra na issue ANTES do fechamento.
 */
export function resolutionComment(input) {
  const lines = []
  lines.push(
    `✅ **Resolvido** — as ${(input.families ?? []).length} declaração(ões) julgadas estão dentro do teto de ` +
      `${tetoEfetivo(input)} commits (${tetoLine(input)}; as tabelas de custo do README não têm teto: a idade delas é publicada), e nenhuma saiu da história.`,
  )
  lines.push("")
  lines.push(
    input?.matrix?.state === "measured"
      ? `O REGISTRO DO ATO também voltou: ${matrixLagLine(input.matrix)}.`
      : `O relógio da MATRIZ NÃO foi medido nesta run (${matrixLagLine(input?.matrix)}) — o fechamento sai pela idade das declarações, com essa falta dita.`,
  )
  lines.push("")
  lines.push("### A prova (a idade de agora, contra o mesmo HEAD)")
  lines.push("")
  lines.push(...measurementTable(input))
  lines.push("")
  lines.push(`> HEAD medido: \`${input.head}\``)
  lines.push("")
  lines.push(
    "> Fechada automaticamente: a régua voltou a ser re-medida num commit que está na história " +
      "de HEAD (o ato de mover a baseline grava essa origem). Se ela envelhecer de novo, a mesma " +
      "regra abre uma issue nova com a assinatura do momento (o dedup é entre as ABERTAS).",
  )
  lines.push("")
  return lines.join("\n")
}

/**
 * O CONTRATO deste publicador (`issue-publish.mjs`): o ciclo (publicar,
 * deduplicar por assinatura, comentar no título já aberto, criar, COMENTAR a
 * prova antes de fechar) mora no contrato, um só para todos os publicadores.
 *
 * O QUE FICA DECLARADO AQUI: a etiqueta, o formato do marcador (`b64`), o título
 * estável, a assinatura por FAMÍLIAS+FAIXA, a prosa, quando há dívida
 * (`isActionable`), o ESCOPO (uma issue — a régua velha é UM estado do bench, não
 * um item por família) e o FECHAMENTO (a prova do comentário + o motivo).
 *
 * A GUARDA DO FECHAMENTO exige as TRÊS condições: a idade foi MEDIDA
 * (`state === "measured"`), nenhuma família vencida/divergente e nenhuma família
 * SEM idade. As duas primeiras são o motivo de a issue existir; a terceira é o
 * que impede o fechamento otimista — um clone raso devolveria "nenhuma vencida" e
 * fecharia a dívida com base numa medição que não aconteceu.
 */
export const BENCH_FRESHNESS_PUBLISHER = defineDebtPublisher({
  name: MARKER_ID,
  label: ISSUE_LABEL,
  labelColor: ISSUE_LABEL_COLOR,
  labelDescription: ISSUE_LABEL_DESCRIPTION,
  marker: { id: MARKER_ID, format: "b64" },
  title: () => freshnessTitle(),
  signature: (input) => signatureOf(input),
  body: (input) => freshnessProse(input),
  actionable: (input) => isActionable(input),
  scope: { kind: "single" },
  resolution: {
    when: (input) =>
      input?.state === "measured" &&
      agedOf(input).length === 0 &&
      divergedOf(input).length === 0 &&
      unknownOf(input).length === 0,
    comment: (input) => resolutionComment(input),
    reason: "a régua do bench voltou a ser medida num commit dentro do teto da história de HEAD",
  },
  prose: {
    actionable: (input) =>
      `⚠️  Declaração datada VENCIDA em ${agedOf(input).length + divergedOf(input).length} unidade(s)` +
      ` (teto ${tetoEfetivo(input)} commits para famílias e números ` +
      "declarados; tabelas do README sem teto) — publicando issue acionável.",
    // O MOTIVO nomeia as unidades sem idade: "não medido" sozinho deixa quem lê sem
    // saber o que refazer (o checkout precisa da história? o arquivo sumiu? o dono
    // do número não declarou a própria data?).
    inSync: (input) =>
      input?.state !== "measured"
        ? `ℹ️  Idade das declarações NÃO medida neste run (${input?.reason ?? "motivo não declarado"}) — o fechamento fica suspenso.`
        : unknownOf(input).length > 0
          ? `ℹ️  ${unknownOf(input).length} declaração(ões) sem idade (${unknownOf(input)
              .map((f) => f.family)
              .join(", ")}) — o fechamento fica suspenso.`
          : `✅ ${freshnessLine(input)}`,
    alreadyReported: (issue) =>
      `ℹ️  A mesma dívida já está reportada na issue #${issue.number} — sem ruído.`,
    commented: (issue) => `✅ Comentário adicionado à issue #${issue.number} (dívida nova).`,
    created: (ref) => `✅ Issue criada: ${ref}`,
    reconciled: (count) =>
      `🔒 Reconciliado: ${count} issue(s) de régua velha fechada(s) — a dívida não fica aberta depois de resolvida.`,
    dryRunTail: (backendName) => `\n(dry-run: nenhuma chamada ao backend '${backendName}')`,
    dryRunReconcile: (backendName) =>
      `   (dry-run: nenhuma chamada ao backend '${backendName}' — a reconciliação fecharia as issues abertas por este publicador)`,
  },
})

/**
 * Publica a régua velha (ou reconcilia quando ela voltou para dentro do teto).
 *
 * A ORDEM é a do contrato (`runDebtPublisher`): ação quando há dívida;
 * reconciliação quando não há E a medição permite provar que voltou.
 */
export async function publishFreshnessIssue({
  input,
  backend,
  dryRun = false,
  reconcile = true,
  log = console.log,
}) {
  return runDebtPublisher({
    publisher: BENCH_FRESHNESS_PUBLISHER,
    input,
    backend,
    dryRun,
    reconcile,
    log,
  })
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export const USAGE =
  "Uso: node scripts/bench-freshness-issue.mjs [--baseline FILE] [--head REF] " +
  "[--backend github|gitea] [--repo owner/name] [--no-reconcile] [--dry-run] [--help]"

export function parseArgs(argv) {
  const options = {
    baseline: BASELINE_PATH,
    head: "HEAD",
    backend: "github",
    repo: null,
    reconcile: true,
    dryRun: false,
    help: false,
    error: null,
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--baseline" || arg === "--head" || arg === "--backend" || arg === "--repo") {
      const value = argv[++i]
      if (value === undefined || value === "") {
        options.error = `${arg} exige um valor`
        return options
      }
      if (arg === "--baseline") options.baseline = value
      else if (arg === "--head") options.head = value
      else if (arg === "--backend") options.backend = value
      else options.repo = value
    } else if (arg === "--no-reconcile") options.reconcile = false
    else if (arg === "--dry-run") options.dryRun = true
    else if (arg === "--help" || arg === "-h") options.help = true
    else {
      options.error = `argumento desconhecido: ${arg}`
      return options
    }
  }
  if (!["github", "gitea"].includes(options.backend)) {
    options.error = `--backend deve ser github|gitea (recebido: ${options.backend})`
  }
  return options
}

/**
 * A leitura do arquivo, fail-closed: um arquivo ausente ou ilegível NÃO é um fato
 * vazio (o comparador o leria como "sem família velha").
 */
export function loadFreshness(options, { deps = {} } = {}) {
  return readFreshness({ file: options.baseline, head: options.head, deps })
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.error) {
    console.error(`❌ ${options.error}`)
    console.error(USAGE)
    return 1
  }
  if (options.help) {
    console.log(USAGE)
    console.log(
      "\n  Mede a idade do commit de ORIGEM das famílias da baseline do bench e:\n" +
        "    · com alguma vencida/fora da história → abre (ou comenta) a issue;\n" +
        "    · sem nenhuma            → COMENTA a prova e FECHA o que este publicador abriu.\n\n" +
        "  --baseline: outro arquivo do bench (default: docs/benchmarks/guard-timing-baseline.json).\n" +
        "  --head: mede contra outra ref (default: HEAD).\n" +
        "  --dry-run: imprime o que faria, sem chamar a forja.",
    )
    return 0
  }

  const fact = loadFreshness(options)
  // NÃO MEDIDO não passa por verde: sem idade não há como publicar nem fechar, e
  // um passo que sai 0 sem ter medido é o alerta mudo que esta issue evita.
  if (fact.state !== "measured") {
    console.error(`❌ régua do bench NÃO medida: ${fact.reason}`)
    for (const r of fact.remedies) console.error(`   → ${r}`)
    return 1
  }

  await publishFreshnessIssue({
    input: inputOf(fact),
    backend: options.dryRun
      ? { name: options.backend }
      : selectIssueBackend(options, process.env, {
          label: ISSUE_LABEL,
          color: ISSUE_LABEL_COLOR,
          description: ISSUE_LABEL_DESCRIPTION,
        }),
    dryRun: options.dryRun,
    reconcile: options.reconcile,
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
