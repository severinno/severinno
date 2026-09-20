#!/usr/bin/env node

// =============================================================================
// github-dependencies-issue.mjs
//
// Transforma a DEPENDENCIA NOVA do GitHub — a classe, a etapa do corte que a
// remove e o delta que entrou — numa ISSUE ACIONAVEL, e FECHA a issue quando o
// item sai do repositorio.
//
// POR QUE ISTO PRECISA EXISTIR (o ciclo que as outras dividas ja tem): o
// `check:github-dependencies` e uma CATRACA com manifesto (`ci/github-dependencies.json`)
// e roda nas DUAS pipelines de PR — ou seja, o merge de uma dependencia nova ja e
// barrado. O que o gate NAO faz e o que este publicador faz:
//
//   1. o gate julga o COMMIT proposto; o repositorio tem caminhos que escrevem na
//      branch default SEM PR — os crons que comitam e empurram a propria baseline
//      (benchmark-auto-baseline, benchmark-gist-weekly, benchmark-weekly, ci.yml,
//      release-deploy, utf8-auto-fix) e o `--no-verify` (medido pelo doctor: o
//      defeito CHEGA ao remoto e quem o barra e o CI do PR, que nao existe quando
//      o push e direto). O censo periodico e a testemunha desses caminhos;
//   2. o vermelho de um check morre com o PR. A DECISAO — em qual das 5 etapas
//      do corte aquele item sai e o que o substitui — vive na declaracao, e o
//      board e onde um humano a le. A issue leva a classe, a etapa e o delta
//      escritos, em vez de "veja o log do job";
//   3. e ela se FECHA: um item que sai do repositorio (corte feito, ou a
//      declaracao o absorvendo no mesmo commit) nao pode deixar ticket aberto —
//      divida resolvida que continua aberta mente no board, e o proximo alerta
//      daquele publicador passa a ser ignorado.
//
// A REGUA E UMA SO: os itens vem de `novasDependencias` (do proprio guard), e a
// etapa/substituto/porque vem do manifesto. O publicador NAO remede nada por
// conta propria — se ele remontasse a lista de novos por fora (filtrando medido x
// declarado aqui), a regra do canal divergiria da regra que bloqueia o merge no
// dia em que uma delas mudasse.
//
// O QUE *NAO* VIRA ISSUE (e por que): as violacoes de DECLARACAO — classe sem
// etapa/substituto, item que sumiu e o contador abaixo do declarado — sao do
// gate e se corrigem no MESMO commit (`--update` + prosa); o PR nao passa sem
// isso. Uma issue para cada uma delas transformaria o board num espelho do diff.
//
// ESCOPO: uma issue por ITEM (nao um estado unico), porque a divida e por item —
// cada um sai numa etapa diferente, com um substituto diferente. Nas classes de
// CONTAGEM (ghcr-images, actions-plane) o item nao tem nome: a assinatura e da
// CLASSE com a FAIXA do delta (ate-10, ate-100, acima-100), e nao do numero —
// um +1 legitimo (um `uses:` novo num workflow) nao pode fechar e reabrir
// ticket; uma mudanca de ordem de grandeza, sim (a severidade mudou).
//
// "NAO MEDIDO" NAO FECHA: inventario ilegivel/ausente (exit 2 do guard) e um
// medidor quebrado, nao evidencia de que o item saiu. A `resolution.when` recusa
// o fechamento e o run diz que nao reconciliou.
//
// Fluxo:
//   1. mede o inventario com a MESMA funcao que o gate usa (`inventario`) e
//      deriva as dependencias novas (`novasDependencias`);
//   2. ha item novo? cria uma issue por item (classe + etapa + delta no corpo),
//      deduplicando por assinatura contra as ABERTAS;
//   3. nao ha item novo E a medicao esta completa? RECONCILIA: comenta a prova e
//      fecha as issues que ESTE publicador abriu (o item saiu do repositorio);
//   4. `--no-reconcile` publica sem fechar (para o caminho que nao conhece todos
//      os relatorios).
//
// Usage:
//   node scripts/github-dependencies-issue.mjs
//   node scripts/github-dependencies-issue.mjs --dry-run
//   node scripts/github-dependencies-issue.mjs --backend gitea --repo org/repo
//   node scripts/github-dependencies-issue.mjs --no-reconcile
//
// Credenciais (nunca do arquivo — so do ambiente):
//   github: GH_TOKEN | GITHUB_TOKEN  (CLI `gh`, com escrita em issues)
//   gitea:  GITEA_TOKEN + GITEA_URL  (+ GITEA_REPOSITORY | --repo)
//
// Exit codes:
//   0 — divida publicada (issue criada/comentada/ja reportada), nada a fazer, ou
//       a divida foi fechada
//   1 — erro real: inventario ilegivel/ausente, credencial ausente ou falha do
//       backend — "nao medido" nao pode parecer verde
// =============================================================================

import { readFileSync } from "node:fs"
import { join } from "node:path"
import process from "node:process"
import { pathToFileURL } from "node:url"

import {
  DATA,
  ESTAGIOS,
  inventario,
  novasDependencias,
  violacoesDeGitHub,
} from "./check-github-dependencies.mjs"
import {
  defineDebtPublisher,
  publisherItemBody,
  runDebtPublisher,
  selectIssueBackend,
} from "./issue-publish.mjs"

/** Label de triagem (dedup + filtro no board). */
export const ISSUE_LABEL = "github-dependency-new"

/** Cor do label (hex sem `#`, o formato da CLI do `gh`). */
export const ISSUE_LABEL_COLOR = "D93F0B"

/** Descricao do label (aparece no board e explica a divida). */
export const ISSUE_LABEL_DESCRIPTION =
  "Dependencia NOVA do GitHub no inventario medido (catraca do check:github-dependencies)"

/** Id do marcador invisivel que carrega a assinatura (o dedup e por publicador). */
export const MARKER_ID = "github-dependency-new"

/** A declaracao versionada que o publicador LE (e que o gate cobra). */
export const DATA_PATH = DATA

/** Titulo estavel do publicador (o titulo da issue e por ITEM, derivado dele). */
export const TITLE_PREFIX = "Dependencia NOVA do GitHub"

/** As faixas do delta nas classes de CONTAGEM (a severidade em ordem de grandeza). */
export const FAIXAS = [
  { id: "ate-10", max: 10, rotulo: "ate 10 a mais" },
  { id: "ate-100", max: 100, rotulo: "de 11 a 100 a mais" },
  { id: "acima-100", max: Number.POSITIVE_INFINITY, rotulo: "mais de 100 a mais" },
]

// ---------------------------------------------------------------------------
// Funcoes puras (exportadas para teste unitario — sem rede, sem gh)
// ---------------------------------------------------------------------------

/**
 * Monta a ENTRADA do publicador a partir do inventario medido.
 *
 * E o unico jeito de produzir a entrada: o publicador nunca recebe uma lista de
 * itens montada a mao, entao nao existe caminho em que ele publique um item que
 * a derivacao do guard nao reconhece (nem deixe de publicar um que ela achou).
 *
 * `medido` e a guarda do FECHAMENTO: `false` quando o inventario nao pode ser
 * julgado (dado ilegivel/invalido — o caminho em que o gate sai 2). Sem essa
 * bandeira, uma leitura vazia fecharia todas as issues abertas por nao ter
 * achado nada.
 *
 * @param {ReturnType<typeof inventario>|null} inv
 * @param {{medido?: boolean, motivo?: string|null}} [options]
 */
export function inputOf(inv, options = {}) {
  const medido = options.medido ?? inv !== null
  const novas = inv === null ? [] : novasDependencias(inv)
  return {
    inventario: inv,
    novas,
    medido,
    motivo: options.motivo ?? (medido ? null : "o inventario declarado nao pode ser lido"),
    violacoes: inv === null ? [] : violacoesDeGitHub(inv),
  }
}

/**
 * A FAIXA de um delta (classes de contagem). Zero quando nao ha delta.
 *
 * @param {number} delta
 */
export function faixaDoDelta(delta) {
  const n = Number(delta)
  if (!Number.isFinite(n) || n <= 0) return FAIXAS[0]
  return FAIXAS.find((f) => n <= f.max) ?? FAIXAS[FAIXAS.length - 1]
}

/**
 * A faixa SEGUINTE de um delta — a que, quando alcancada, faz este ticket
 * caducar (a severidade mudou de ordem de grandeza). `null` na ultima.
 *
 * @param {number} delta
 */
export function faixaSeguinte(delta) {
  const atual = FAIXAS.findIndex((f) => f.id === faixaDoDelta(delta).id)
  return FAIXAS[atual + 1]?.id ?? null
}

/**
 * A ASSINATURA estavel de um item — e o que o dedup e o fechamento comparam.
 *
 * Nas classes de LISTA ela carrega o NOME do item (o mesmo item que voltar a
 * entrar depois de um corte reabre a issue, e o que sai a fecha). Nas de
 * CONTAGEM carrega a CLASSE com a FAIXA do delta: o numero exato nao entra
 * (um +1 comentaria toda semana), mas uma mudanca de ordem de grandeza entra —
 * e ai a issue antiga fecha com a prova e uma nova abre, porque a divida mudou.
 *
 * @param {{classe: string, item: string|null, delta: number}} nova
 */
export function assinaturaDe(nova) {
  if (nova.item === null || nova.item === undefined) {
    return `dep:${nova.classe}|contador@${faixaDoDelta(nova.delta).id}`
  }
  return `dep:${nova.classe}|${nova.item}`
}

/**
 * Descreve uma assinatura em portugues — usado no comentario de FECHAMENTO, que
 * tem de nomear o que saiu (uma issue fechada sem dizer o que caducou transfere a
 * conferencia para quem abrir o historico).
 *
 * @param {string} assinatura
 */
export function descreverAssinatura(assinatura) {
  const resto = String(assinatura).replace(/^dep:/, "")
  const [classe, alvo = ""] = resto.split("|")
  if (alvo.startsWith("contador@")) {
    const faixa = FAIXAS.find((f) => f.id === alvo.slice("contador@".length))
    return `a classe \`${classe}\` (${faixa ? faixa.rotulo : alvo})`
  }
  return `\`${alvo}\` (classe \`${classe}\`)`
}

/**
 * O titulo da issue de um item.
 *
 * Nas classes de lista o titulo e o NOME do item (o board fica varreavel por
 * arquivo/cron/action). Nas de contagem nao ha nome a citar: o titulo diz a
 * classe e o delta QUE ABRIU o ticket — o delta dentro da faixa nao muda a
 * assinatura, e o numero atual esta no relatorio do guard (citado no corpo).
 *
 * @param {{classe: string, titulo: string, item: string|null, delta: number, unidade: string}} nova
 */
export function tituloDe(nova) {
  if (nova.item === null || nova.item === undefined) {
    return `${TITLE_PREFIX}: ${nova.titulo} — ${nova.delta} ${nova.unidade}(s) a mais`
  }
  return `${TITLE_PREFIX}: ${nova.item}`
}

/** `+3` / `1` — o delta sempre com sinal quando positivo. */
function sinal(n) {
  const v = Number(n)
  return v > 0 ? `+${v}` : `${v}`
}

/**
 * O bloco da CLASSE: o que ela e, o que ela mede e o delta que entrou.
 *
 * @param {object} nova
 */
function blocoDaClasse(nova) {
  const lines = []
  lines.push(`### A classe`)
  lines.push("")
  lines.push(`- **\`${nova.classe}\`** — ${nova.titulo}`)
  lines.push(`  - o que e: ${nova.papel}`)
  lines.push(
    `  - medido agora: **${nova.totalMedido}** ${nova.unidade}(s) · declarado: **${nova.totalDeclarado}** · delta: **${sinal(nova.delta)}**`,
  )
  if (nova.item !== null && nova.item !== undefined) {
    lines.push(`  - o item que entrou: \`${nova.item}\``)
  }
  lines.push("")
  return lines
}

/**
 * O bloco da ETAPA (a decisao escrita): qual das etapas do corte remove esta
 * dependencia, o que ela entrega e o que a substitui. Uma classe SEM etapa
 * declarada aparece como tal — o gate reprova isso no PR, e o corpo nao pode
 * imprimir `undefined` no lugar da decisao.
 *
 * @param {object} nova
 */
function blocoDaEtapa(nova) {
  const lines = []
  lines.push(`### A etapa do corte que a remove`)
  lines.push("")
  if (nova.etapa) {
    lines.push(`- **etapa ${nova.etapa.id} — ${nova.etapa.titulo}**`)
    lines.push(`  - entrega: ${nova.etapa.entrega}`)
  } else {
    lines.push(
      `- ⚠️ **a classe esta SEM etapa declarada** (\`estagio\` ausente ou apontando para uma etapa que nao existe). O gate reprova isso no PR: declare QUAL das ${ESTAGIOS.length} etapas a remove.`,
    )
  }
  const substituto = typeof nova.substituto === "string" ? nova.substituto.trim() : ""
  lines.push(
    substituto === ""
      ? `- ⚠️ a classe esta SEM SUBSTITUTO declarado — o campo vazio esconde a decisao (se a dependencia nao tem equivalente, escreva isso)`
      : `- substituto declarado: ${substituto}`,
  )
  if (nova.porque) lines.push(`- por que ainda existe: ${nova.porque}`)
  lines.push("")
  return lines
}

/**
 * O bloco do DELTA: o numero que entrou, medido contra a declaracao — nos DOIS
 * sentidos (a classe e os itens), para quem le nao ter de abrir o relatorio.
 *
 * @param {object} nova
 */
function blocoDoDelta(nova) {
  const lines = []
  lines.push(`### O delta`)
  lines.push("")
  lines.push("| | medido | declarado | delta |")
  lines.push("| :---- | ------: | --------: | ----: |")
  lines.push(
    `| \`${nova.classe}\` (${nova.unidade}s) | ${nova.totalMedido} | ${nova.totalDeclarado} | ${sinal(nova.delta)} |`,
  )
  lines.push("")
  if (nova.kind === "contador") {
    const seguinte = faixaSeguinte(nova.delta)
    lines.push(
      `> A classe e de CONTAGEM: o que entrou foram ${nova.delta} ${nova.unidade}(s) a mais que a` +
        ` declaracao. A assinatura desta issue e a classe com a FAIXA do delta` +
        ` (\`${faixaDoDelta(nova.delta).id}\`) — um acrescimo dentro da faixa nao abre ticket novo;` +
        (seguinte
          ? ` ao alcancar a faixa \`${seguinte}\` a severidade muda e este ticket caduca (fecha com a prova) na proxima run do cron.`
          : ` esta ja e a faixa mais grave, entao so a reconciliacao (o item sair) a fecha.`),
    )
    lines.push("")
  }
  return lines
}

/**
 * A prosa da issue: o que entrou, a classe, a etapa, o delta e o que fazer.
 *
 * @param {object} nova
 * @param {object} input
 */
export function corpoDoItem(nova, input) {
  const lines = []
  lines.push(
    `O guard **\`check:github-dependencies\`** mediu o inventario de \`${DATA_PATH}\` e encontrou` +
      ` **${input.novas.length} dependencia(s) NOVA(s) do GitHub** que ainda nao estao na declaracao.` +
      ` Esta issue e sobre uma delas.`,
  )
  lines.push("")
  lines.push(...blocoDaClasse(nova))
  lines.push(...blocoDaEtapa(nova))
  lines.push(...blocoDoDelta(nova))
  lines.push(`### O que fazer`)
  lines.push("")
  lines.push(
    "A catraca so anda para baixo: a decisao e (a) **cortar** o item na etapa" +
      " declarada, ou (b) **registrar** o item com a decisao escrita, se ele fica.",
  )
  lines.push("")
  lines.push("```bash")
  lines.push(`bun run check:github-dependencies                    # o inventario inteiro, medido`)
  lines.push(`node scripts/check-github-dependencies.mjs --only ${nova.classe}   # so esta classe`)
  lines.push(
    `node scripts/check-github-dependencies.mjs --json     # os numeros, para outro script`,
  )
  lines.push(
    `node scripts/check-github-dependencies.mjs --update  # o ATO: congela o medido no dado`,
  )
  lines.push("```")
  lines.push("")
  lines.push(
    `> \`--update\` reescreve SO os campos medidos (\`declarado\`), preservando a prosa` +
      ` (\`estagio\`, \`substituto\`, \`porque\`) — uma classe nova continua sendo decisao humana.`,
  )
  lines.push("")
  lines.push(
    `> O gate roda nas DUAS pipelines de PR: enquanto o item novo nao estiver declarado (ou` +
      ` cortado), o merge e recusado. Este ticket e a MESMA verdade escrita onde um humano a le,` +
      ` e ele se FECHA sozinho quando o item sai do repositorio.`,
  )
  lines.push("")
  if (input.violacoes.length > 0) {
    lines.push(
      `> ⚠️ O inventario tem ${input.violacoes.length} violacao(oes) alem desta (declaracao` +
        ` envelhecida/classe sem etapa/servico divergente) — rodar o gate mostra todas.`,
    )
    lines.push("")
  }
  return lines.join("\n")
}

/**
 * O comentario de RESOLUCAO — a PROVA de que o item saiu do repositorio.
 *
 * Ele nomeia o que caducou (a assinatura decodificada), mostra a medicao de
 * agora da(s) classe(s) envolvida(s) e diz o comando que mediu. Sem isso, um
 * fechamento automatico vira "sumiu do board" sem que ninguem saiba por que.
 *
 * @param {string[]} assinaturas  as que a issue carrega (o contrato as passa)
 * @param {object} input
 */
export function comentarioDeResolucao(assinaturas, input) {
  const lines = []
  const nomes = assinaturas.map((s) => descreverAssinatura(s))
  lines.push(
    `✅ **Resolvido** — ${nomes.length === 1 ? "o item" : "os itens"} desta issue nao esta(o)` +
      ` mais entre as dependencias NOVAS do GitHub: ${nomes.join(", ")}.`,
  )
  lines.push("")
  lines.push(`### A prova (medicao de agora, contra a declaracao)`)
  lines.push("")
  const classesTocadas = new Set(
    assinaturas.map((s) => String(s).replace(/^dep:/, "").split("|")[0] ?? ""),
  )
  if (input.inventario) {
    const envolvidas = input.inventario.classes.filter((c) =>
      assinaturas.some((s) => s.startsWith(`dep:${c.id}|`)),
    )
    lines.push("| classe | medido | declarado | estado |")
    lines.push("| :---- | -----: | --------: | :---- |")
    for (const c of envolvidas) {
      const medido = c.kind === "lista" ? c.medido.length : Number(c.medido)
      const declarado = c.kind === "lista" ? (c.declarado ?? []).length : Number(c.declarado)
      lines.push(
        `| \`${c.id}\` | ${medido} | ${declarado} | ${medido > declarado ? "AINDA acima" : "dentro do declarado"} |`,
      )
    }
    if (envolvidas.length === 0) {
      lines.push("| (a classe saiu da medicao) | — | — | o item nao existe mais no repositorio |")
    }
  } else {
    lines.push(
      "> (o inventario nao pode ser relido nesta run: a prova e a ausencia do item na medicao)",
    )
  }
  lines.push("")
  lines.push(
    `> Fechada automaticamente: ${assinaturas.length} assinatura(s) conferida(s) em` +
      ` ${classesTocadas.size} classe(s). Se o MESMO item voltar a entrar no repositorio, a assinatura` +
      ` e a mesma e uma issue nova abre na proxima run — o dedup e entre as ABERTAS, entao a divida` +
      ` reabre sem que ninguem precise lembrar.`,
  )
  lines.push("")
  lines.push("```bash")
  lines.push("bun run check:github-dependencies   # a medicao que fechou esta issue")
  lines.push("```")
  lines.push("")
  return lines.join("\n")
}

// ---------------------------------------------------------------------------
// Publicacao
// ---------------------------------------------------------------------------

/**
 * O CONTRATO deste publicador (`issue-publish.mjs`): o ciclo (publicar,
 * deduplicar por assinatura, COMENTAR a prova antes de fechar) mora no contrato,
 * um so para todos os publicadores.
 *
 * O QUE FICA DECLARADO AQUI: a etiqueta, o formato do marcador (`b64`), o titulo
 * por item, a assinatura por ITEM (ou por classe+faixa, nas classes de contagem),
 * a prosa, quando ha divida (`items`, que deriva do guard), o ESCOPO
 * (`per-item`: a divida e por dependencia, cada uma com a sua etapa) e o
 * FECHAMENTO (a prova do comentario + o motivo).
 *
 * A GUARDA DO FECHAMENTO e `input.medido`: um inventario ilegivel nao e evidencia
 * de que o item saiu.
 */
export const GITHUB_DEPENDENCIES_PUBLISHER = defineDebtPublisher({
  name: MARKER_ID,
  label: ISSUE_LABEL,
  labelColor: ISSUE_LABEL_COLOR,
  labelDescription: ISSUE_LABEL_DESCRIPTION,
  marker: { id: MARKER_ID, format: "b64" },
  scope: {
    kind: "per-item",
    items: (input) => input.novas,
    signature: (nova) => assinaturaDe(nova),
    title: (nova) => tituloDe(nova),
    body: (nova, input) => corpoDoItem(nova, input),
  },
  title: () => TITLE_PREFIX,
  signature: () => "",
  body: () => "",
  actionable: (input) => input.novas.length > 0,
  resolution: {
    when: (input) => input?.medido === true,
    comment: (assinaturas, input) => comentarioDeResolucao(assinaturas, input),
    reason: "a dependencia nova saiu do inventario medido (cortada ou declarada)",
  },
  prose: {
    actionable: (input, total) =>
      `⚠️  ${input.novas.length} dependencia(s) NOVA(s) do GitHub${total ? ` (de ${total} no run)` : ""} — publicando issue acionavel por item.`,
    inSync: (input) =>
      input?.medido
        ? "✅ Nenhuma dependencia nova do GitHub no inventario medido."
        : `ℹ️  Inventario nao julgavel neste run (${input?.motivo ?? "motivo nao declarado"}).`,
    itemCreated: (nova, ref) => `  ✅ issue criada: ${ref} (${nova.classe})`,
    itemsCreated: (created, skipped, label) =>
      `✅ ${created} issue(s) criada(s)${skipped > 0 ? `, ${skipped} ja com issue aberta` : ""} com o label ${label}.`,
    reconciled: (count) =>
      `🔒 Reconciliado: ${count} issue(s) de dependencia nova fechada(s) — o item saiu do repositorio e o ticket nao ficou para tras.`,
    unmeasured: () => "⚠️  Inventario nao julgavel — NAO reconciliando (nao medido ≠ resolvido).",
    dryRunTail: (backendName) => `\n(dry-run: nenhuma chamada ao backend '${backendName}')`,
    dryRunReconcile: (backendName) =>
      `   (dry-run: nenhuma chamada ao backend '${backendName}' — a reconciliacao fecharia as issues abertas por este publicador)`,
  },
})

/**
 * Publica as dependencias novas (ou reconcilia quando o item saiu).
 *
 * A ORDEM e a do contrato (`runDebtPublisher`): no escopo per-item ele reconcilia
 * SEMPRE (o item que sumiu nao e mais divida) e abre so o que ainda nao tem issue.
 *
 * @param {{input: object, backend: object, dryRun?: boolean, reconcile?: boolean, log?: Function}} params
 */
export async function publishGithubDependencies({
  input,
  backend,
  dryRun = false,
  reconcile = true,
  log = console.log,
}) {
  return runDebtPublisher({
    publisher: GITHUB_DEPENDENCIES_PUBLISHER,
    input,
    backend,
    dryRun,
    reconcile,
    log,
  })
}

/**
 * O corpo COMPLETO de um item, pela composicao do CONTRATO (prosa + marcador) —
 * exposto para o teste conferir o que a issue carrega sem remontar o marcador.
 */
export function itemBody(input, nova) {
  return publisherItemBody(GITHUB_DEPENDENCIES_PUBLISHER, input, nova)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const USAGE =
  "Uso: node scripts/github-dependencies-issue.mjs [--backend github|gitea] " +
  "[--repo owner/name] [--no-reconcile] [--dry-run]"

export function parseArgs(argv) {
  const options = {
    backend: "github",
    repo: null,
    reconcile: true,
    dryRun: false,
    help: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--backend") {
      const value = argv[++i]
      if (value === undefined) throw new Error("--backend exige um valor")
      options.backend = value
    } else if (arg === "--repo") {
      const value = argv[++i]
      if (value === undefined) throw new Error("--repo exige um valor")
      options.repo = value
    } else if (arg === "--no-reconcile") options.reconcile = false
    else if (arg === "--dry-run") options.dryRun = true
    else if (arg === "--help" || arg === "-h") options.help = true
    else throw new Error(`Argumento desconhecido: ${arg}`)
  }
  if (!["github", "gitea"].includes(options.backend)) {
    throw new Error(`--backend deve ser github|gitea (recebido: ${options.backend})`)
  }
  return options
}

/**
 * Le a declaracao versionada. Dado AUSENTE ou ILEGIVEL e ERRO (exit 1): o guard
 * trata isso como `exit 2` (nao da para julgar) e o publicador nao pode
 * transformar "nao consegui medir" em "nao ha dependencia nova" — que fecharia
 * todas as issues abertas com base em nada.
 *
 * @param {{root?: string, exists?: Function, medida?: Function}} [deps]
 */
export function carregarInventario({ root = process.cwd(), medida = inventario } = {}) {
  return medida({ root })
}

/** A mensagem de erro do dado, lida do arquivo — para o log dizer o QUE falta. */
export function descreverDadoAusente({ root = process.cwd(), read = readFileSync } = {}) {
  try {
    JSON.parse(read(join(root, DATA_PATH), "utf8"))
    return null
  } catch (err) {
    return `${DATA_PATH}: ${err?.message ?? err}`
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log(USAGE)
    return 0
  }
  let inv = null
  let motivo = null
  try {
    inv = carregarInventario({ root: process.cwd() })
  } catch (err) {
    motivo = `${DATA_PATH}: ${err?.message ?? err}`
  }
  const input = inputOf(inv, { medido: inv !== null, motivo })
  await publishGithubDependencies({
    input,
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
  if (inv === null) {
    throw new Error(
      `inventario nao julgavel (${motivo ?? descreverDadoAusente()}) — rode o guard para ver o dado`,
    )
  }
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
