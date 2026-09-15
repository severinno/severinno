#!/usr/bin/env node

// =============================================================================
// declared-debt.mjs
//
// A IDADE da dívida DECLARADA do repositório — num lugar só.
//
// POR QUE ISTO EXISTE: o repositório tem quatro decisões escritas de "não
// consertar agora" — as duas listas do `check-registry-source`
// (OUT_OF_SCOPE_ALLOWLIST e THIRD_PARTY_ALLOWLIST), a ALLOWLIST do
// `check-unused-deps` e o baseline do `check-pipefail-sigpipe` — e, em cada uma,
// a data da decisão (`addedAt` / `declaredAt`) e a JANELA de revisão (180 dias,
// do módulo compartilhado `allowlist-review.mjs`). O canal que as revisa é o job
// semanal `registry-allowlist-review`, rodando os guards em `--review`: passada a
// janela, a decisão vencida vira VIOLAÇÃO naquele run.
//
// O QUE FALTAVA: a IDADE não vivia em lugar nenhum fora daquele run. O veredito
// de prontidão media a forja inteira e não sabia que a isenção que sustenta um
// verde está a 179 dias — nem que venceu ontem. Quem lê o PR, o doctor ou o board
// via "nada a fazer"; o vencimento só existia como run vermelho semanal.
//
// FONTE ÚNICA: este módulo NÃO reimplementa a regra da data nem a janela — ele lê
// as listas dos DONOS delas (o `entries()` de cada dono, no registry abaixo) e
// aplica `reviewAddedAtEntries` / `baselineProblems`, do módulo compartilhado. A
// janela vem de cada dono (`OUT_OF_SCOPE_REVIEW_DAYS`, `THIRD_PARTY_REVIEW_DAYS`,
// `UNUSED_DEPS_REVIEW_DAYS`, `DEFAULT_REVIEW_DAYS`): uma segunda janela para a
// mesma pergunta divergiria no dia em que alguém ajustasse uma delas.
//
// ESTADOS (o vocabulário do resto do repositório):
//   proven     — as decisões existem, têm data e estão DENTRO da janela;
//   aged       — alguma passou a janela e ninguém reafirmou (o canal é a ISSUE);
//   invalid    — decisão SEM registro (data ausente/impossível/no futuro): não há
//                como envelhecer, então é violação nos DOIS modos (fail-closed);
//   unread     — a lista não pôde ser LIDA (baseline corrompido): ausência de
//                prova, JAMAIS "sem dívida";
//   sem-divida — a lista está vazia (nada declarado; ex.: o baseline do SIGPIPE,
//                aposentado quando o `--fix` fechou a classe).
//
// Usage:
//   node scripts/declared-debt.mjs               # o fato em texto
//   node scripts/declared-debt.mjs --json        # o fato estruturado
//   node scripts/declared-debt.mjs --root DIR    # outro checkout (testes)
//
// Exit codes:
//   0 — o fato foi medido (dentro da janela, vencido ou vazio são FATOS)
//   1 — decisão SEM registro (invalid) ou lista ilegível (unread): fail-closed
//   2 — --root inexistente/não é diretório (falha de infraestrutura)
//   3 — uso inválido (flag desconhecida, --root sem valor)
// =============================================================================

import { existsSync, statSync } from "node:fs"
import process from "node:process"
import { dirname, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import { MS_PER_DAY, parseAddedAt, reviewAddedAtEntries } from "./allowlist-review.mjs"
import {
  OUT_OF_SCOPE_ALLOWLIST,
  OUT_OF_SCOPE_REVIEW_DAYS,
  THIRD_PARTY_ALLOWLIST,
  THIRD_PARTY_REVIEW_DAYS,
} from "./check-registry-source.mjs"
import { ALLOWLIST, UNUSED_DEPS_REVIEW_DAYS } from "./check-unused-deps.mjs"
import { BASELINE_PATH, baselineProblems, readBaseline } from "./check-pipefail-sigpipe.mjs"

/** Exit codes declarados (o resto do repositório lê estes nomes, não os números). */
export const EXIT = { OK: 0, VIOLATIONS: 1, UNAVAILABLE: 2, USAGE: 3 }

/** A raiz do repositório (o `cwd` do comando), para os caminhos relativos. */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")

/**
 * AS LISTAS de dívida declarada do repositório — a FONTE ÚNICA.
 *
 * Cada item diz: quem é o DONO (o guard que decide sobre a lista), como a lista é
 * LIDA (`entries()`, para não duplicar o dado em disco) e qual campo IDENTIFICA a
 * entrada (`idOf` — `path` no escopo, `prefix` nas imagens de terceiros, `match`
 * nas deps). As três listas em memória têm a MESMA forma, e é isso que permite
 * uma regra só; o baseline é uma DECLARAÇÃO única (data + razão + contagem por
 * arquivo), e por isso tem leitor próprio.
 */
export const DECLARED_DEBT_SOURCES = [
  {
    id: "out-of-scope",
    listName: "OUT_OF_SCOPE_ALLOWLIST",
    owner: "scripts/check-registry-source.mjs",
    kind: "entries",
    entries: () => OUT_OF_SCOPE_ALLOWLIST,
    idOf: (entry) => entry.path,
    reviewDays: OUT_OF_SCOPE_REVIEW_DAYS,
    remedy: "reafirme a exceção atualizando `addedAt`, ou tire o arquivo do escopo",
  },
  {
    id: "third-party",
    listName: "THIRD_PARTY_ALLOWLIST",
    owner: "scripts/check-registry-source.mjs",
    kind: "entries",
    entries: () => THIRD_PARTY_ALLOWLIST,
    idOf: (entry) => entry.prefix,
    reviewDays: THIRD_PARTY_REVIEW_DAYS,
    remedy: "reafirme a exceção atualizando `addedAt`, ou pare de consumir a imagem de terceiros",
  },
  {
    id: "unused-deps",
    listName: "ALLOWLIST",
    owner: "scripts/check-unused-deps.mjs",
    kind: "entries",
    entries: () => ALLOWLIST,
    idOf: (entry) => entry.match,
    reviewDays: UNUSED_DEPS_REVIEW_DAYS,
    remedy: "reafirme a exceção atualizando `addedAt`, ou remova a dep de uso implícito",
  },
  {
    id: "sigpipe",
    listName: BASELINE_PATH,
    owner: "scripts/check-pipefail-sigpipe.mjs",
    kind: "declaration",
    read: (root) => readBaseline(root),
    reviewDays: null, // vem do PRÓPRIO arquivo (`reviewAfterDays`), como as outras do módulo
    remedy: "reafirme com `--update --reason`, ou aposente a dívida com `--fix`",
  },
]

/**
 * A ordem de GRAVIDADE dos estados (o agregado é o PIOR deles).
 *
 * `sem-divida` fica ABAIXO de `proven`: uma lista vazia não é um estado melhor
 * que uma decisão dentro da janela — é a ausência de declaração, e só o conjunto
 * INTEIRO vazio dá `sem-divida` no agregado (uma lista aposentada ao lado de
 * três com decisões não pode rebaixar o fato geral).
 */
const SEVERITY = { "sem-divida": -1, proven: 0, aged: 1, unread: 2, invalid: 3 }

/**
 * O estado de UMA fonte, do veredito de data para o vocabulário do relatório.
 *
 * `invalid` ganha de `aged` de propósito: uma decisão sem data não tem como
 * envelhecer, então "vencida" seria uma leitura otimista do problema.
 */
export function sourceState({ invalid, aged, unread, total }) {
  if (unread) return "unread"
  if (invalid.length > 0) return "invalid"
  if (aged.length > 0) return "aged"
  return total > 0 ? "proven" : "sem-divida"
}

/** A entrada MAIS ANTIGA de uma lista (é ela que dá a idade do conjunto). */
function oldestEntry(entries, idOf, now) {
  let maisVelha = null
  for (const entry of entries) {
    const ms = parseAddedAt(entry.addedAt)
    if (ms === null) continue
    const days = Math.floor((now - ms) / MS_PER_DAY)
    if (maisVelha === null || days > maisVelha.days) {
      maisVelha = { id: idOf(entry), addedAt: String(entry.addedAt), days }
    }
  }
  return maisVelha
}

/**
 * MEDE a dívida declarada do repositório.
 *
 * `now`/`sources` são injetáveis porque uma prova de ENVELHECIMENTO não pode
 * depender do relógio da máquina que roda a suíte — e porque o doctor e o
 * publicador têm de medir a MESMA coisa pelo mesmo caminho.
 *
 * NUNCA lança: uma lista que não pôde ser lida vira `unread` na fonte (a leitura
 * de um baseline corrompido não é evidência de que a dívida acabou).
 *
 * @param {{root?: string, now?: number, sources?: object[]}} [options]
 *
 * O tipo de retorno é ESCRITO por inteiro (e não `object[]`): quem consome lê
 * `sources[i].total`, `aged[i].days` e `invalid[i].why` direto, e `object[]`
 * obrigaria um cast em cada leitura — o consumidor passaria a mentir sobre a
 * forma em vez de o produtor declará-la.
 * @returns {{state: string, sources: Array<{
 *   id: string, listName: string, owner: string, kind: string, remedy: string,
 *   reviewDays: number|null, where: string, state: string, total: number,
 *   declaredAt?: string|null, reason?: string|null,
 *   aged: Array<{id: string, addedAt: string, days: number, limit?: number}>,
 *   invalid: Array<{id: string, why: string}>,
 *   oldest: {id: string, addedAt: string, days: number}|null,
 *   detail: string,
 * }>, aged: Array<{id: string, addedAt: string, days: number, limit?: number, source: {id: string}}>,
 *   invalid: Array<{id: string, why: string, source: {id: string}}>,
 *   unread: Array<{id: string, state: string, detail: string}>,
 *   total: number}}
 */
export function collectDeclaredDebt({
  root = REPO_ROOT,
  now = Date.now(),
  sources = DECLARED_DEBT_SOURCES,
} = {}) {
  const medidas = []
  for (const src of sources) {
    const base = {
      id: src.id,
      listName: src.listName,
      owner: src.owner,
      kind: src.kind,
      remedy: src.remedy,
      reviewDays: src.reviewDays,
      where: src.kind === "declaration" ? src.listName : src.owner,
    }
    if (src.kind === "declaration") {
      let baseline
      try {
        baseline = src.read(root)
      } catch (err) {
        medidas.push({
          ...base,
          state: "unread",
          total: 0,
          aged: [],
          invalid: [],
          oldest: null,
          detail: `${base.where}: não pôde ser lido (${String(err?.message ?? err)})`,
        })
        continue
      }
      // O baseline AUSENTE é um fato (a classe foi aposentada), o CORROMPIDO não:
      // `readBaseline` devolve `erro` quando o JSON não parseia.
      const unread = Boolean(baseline?.erro)
      const problemas = unread
        ? { invalid: [], aged: null }
        : baselineProblems(baseline, { now, reviewDays: baseline?.reviewAfterDays ?? 180 })
      const total = Number(baseline?.total ?? 0)
      const aged = problemas.aged
        ? [
            {
              id: `${base.id}:${total} ocorrência(s)`,
              addedAt: problemas.aged.declaredAt,
              days: problemas.aged.days,
              limit: problemas.aged.limit,
            },
          ]
        : []
      const invalid = problemas.invalid.map((why) => ({ id: baseline?.declaredAt ?? "?", why }))
      medidas.push({
        ...base,
        reviewDays: baseline?.reviewAfterDays ?? base.reviewDays,
        state: sourceState({ invalid, aged, unread, total }),
        total,
        declaredAt: baseline?.declaredAt ?? null,
        reason: baseline?.reason ?? null,
        aged,
        invalid,
        oldest: aged[0] ?? null,
        detail: unread
          ? `${base.where}: não pôde ser lido (${baseline.erro})`
          : `${base.where}: ${total} ocorrência(s) declarada(s)${baseline?.declaredAt ? ` em ${baseline.declaredAt}` : ""}`,
      })
      continue
    }

    let entradas
    try {
      entradas = src.entries()
    } catch (err) {
      medidas.push({
        ...base,
        state: "unread",
        total: 0,
        aged: [],
        invalid: [],
        oldest: null,
        detail: `${base.where}: a lista não pôde ser lida (${String(err?.message ?? err)})`,
      })
      continue
    }
    const { invalid, aged } = reviewAddedAtEntries(entradas, {
      idOf: src.idOf,
      now,
      reviewDays: src.reviewDays,
    })
    const total = entradas.length
    medidas.push({
      ...base,
      state: sourceState({ invalid, aged, unread: false, total }),
      total,
      aged,
      invalid,
      oldest: oldestEntry(entradas, src.idOf, now),
      detail: `${base.where}: ${total} decisão(ões) na ${src.listName}`,
    })
  }

  // O agregado é o PIOR estado (a gravidade de `sem-divida` é a menor delas):
  // só o conjunto TODO vazio é `sem-divida`, e uma lista aposentada ao lado de
  // três com decisões não rebaixa o fato geral.
  const state = medidas.reduce(
    (acc, m) => (SEVERITY[m.state] > SEVERITY[acc] ? m.state : acc),
    "sem-divida",
  )
  return {
    state,
    sources: medidas,
    // As entradas ACHATADAS (com a fonte junto) são o que o publicador de issue
    // consome: uma linha por decisão vencida/sem registro, sem ele re-derivar o
    // vínculo com a lista — que é o que faria as duas leituras divergirem.
    aged: medidas.flatMap((m) => m.aged.map((e) => ({ ...e, source: m }))),
    invalid: medidas.flatMap((m) => m.invalid.map((e) => ({ ...e, source: m }))),
    unread: medidas.filter((m) => m.state === "unread"),
    total: medidas.reduce((n, m) => n + m.total, 0),
  }
}

/**
 * A PROSA de uma fonte vencida — uma só, para o relatório, o veredito e a issue
 * não contarem a mesma história de dois jeitos.
 *
 * O REMÉDIO vem do DONO da lista (`remedy`), e entra como "Remédio: <a frase do
 * dono>": compor um segundo imperativo aqui ("Reafirme (reafirme a exceção...)")
 * dava dois comandos para a mesma ação, e o dono da lista é quem sabe qual é.
 */
export function textoFonteVencida(fonte) {
  if (fonte.aged.length > 0) {
    const [maisVelha] = [...fonte.aged].sort((a, b) => b.days - a.days)
    return (
      `${fonte.listName} (${fonte.owner}): ${fonte.aged.length} decisão(ões) SEM REVISÃO — ` +
      `a mais velha é '${maisVelha.id}', de ${maisVelha.addedAt} (há ${maisVelha.days} dia(s), janela de ${maisVelha.limit} dia(s)). ` +
      `Remédio: ${fonte.remedy}.`
    )
  }
  return (
    `${fonte.listName} (${fonte.owner}): ${fonte.invalid.length} decisão(ões) SEM REGISTRO — ` +
    `${fonte.invalid.map((i) => `${i.id}: ${i.why}`).join("; ")}.`
  )
}

/** O FATO em texto (o `--json` sai do objeto cru). */
export function renderDeclaredDebt(fato) {
  const linhas = []
  for (const fonte of fato.sources) {
    const marca =
      fonte.state === "proven" || fonte.state === "sem-divida"
        ? "✅"
        : fonte.state === "aged"
          ? "⏳"
          : "❌"
    const idade = fonte.oldest ? ` — a mais antiga há ${fonte.oldest.days} dia(s)` : ""
    linhas.push(
      `${marca} ${fonte.listName} [${fonte.state}]${idade}: ${fonte.detail}${fonte.reviewDays ? ` (janela de ${fonte.reviewDays} dia(s))` : ""}`,
    )
    if (fonte.state === "aged" || fonte.state === "invalid")
      linhas.push(`     ${textoFonteVencida(fonte)}`)
  }
  linhas.push(
    `ESTADO: ${fato.state} — ${fato.total} decisão(ões) declarada(s) em ${fato.sources.length} lista(s)` +
      (fato.aged.length > 0 ? `; ${fato.aged.length} SEM REVISÃO` : "") +
      (fato.invalid.length > 0 ? `; ${fato.invalid.length} SEM REGISTRO` : "") +
      (fato.unread.length > 0 ? `; ${fato.unread.length} lista(s) ILEGÍVEL(IS)` : ""),
  )
  return linhas.join("\n")
}

function main() {
  const argv = process.argv.slice(2)
  const conhecidas = ["--json", "--root"]
  const desconhecida = argv.find((a) => a.startsWith("--") && !conhecidas.includes(a))
  if (desconhecida) {
    console.error(`❌ flag desconhecida: ${desconhecida}`)
    process.exit(EXIT.USAGE)
  }
  const rootIdx = argv.indexOf("--root")
  if (rootIdx !== -1 && !argv[rootIdx + 1]) {
    console.error("❌ --root exige um diretório (fail-closed)")
    process.exit(EXIT.USAGE)
  }
  const root = rootIdx !== -1 ? resolve(argv[rootIdx + 1]) : REPO_ROOT
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    console.error(`❌ --root inexistente ou não é diretório: ${root}`)
    process.exit(EXIT.UNAVAILABLE)
  }
  const fato = collectDeclaredDebt({ root })
  if (argv.includes("--json")) console.log(JSON.stringify(fato, null, 2))
  else console.log(renderDeclaredDebt(fato))
  process.exit(fato.state === "invalid" || fato.state === "unread" ? EXIT.VIOLATIONS : EXIT.OK)
}

const IS_DIRECT_RUN =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (IS_DIRECT_RUN) main()
