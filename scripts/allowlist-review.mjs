#!/usr/bin/env node

// =============================================================================
// allowlist-review.mjs
//
// A REGRA ÚNICA do registro da decisão (`addedAt`) e da JANELA DE REVISÃO das
// allowlists do repositório.
//
// POR QUE EXISTE (e por que não pode ser copiada em cada guard): o repositório
// tem três allowlists com o MESMO defeito estrutural — uma isenção concedida
// hoje pode não valer mais amanhã, e "isento" não tem prazo por natureza:
//
//   · `OUT_OF_SCOPE_ALLOWLIST` (check-registry-source, invariante 8) — arquivo
//     fora do escopo que referencia imagem nossa;
//   · `THIRD_PARTY_ALLOWLIST` (check-registry-source) — consumo consciente de
//     uma imagem de TERCEIROS no GHCR;
//   · `ALLOWLIST` (check-unused-deps) — dep de uso IMPLÍCITO, que nunca aparece
//     como import (`sharp`, `@types/*`, CLIs).
//
// A defesa é a mesma nas três: cada entrada registra QUANDO a decisão foi
// tomada e, passada a janela, ela precisa ser REAFIRMADA (atualizando a data)
// ou REMOVIDA. O que não pode ser copiado é a REGRA — três cópias do parser
// divergem no dia em que uma delas aceitar `2026-02-30` (o `Date.UTC`
// TRANSBORDA para 2026-03-02) ou uma data no FUTURO. Um guard que aceita uma
// data que o autor não digitou está medindo outra coisa.
//
// O QUE ESTA REGRA NÃO DECIDE: o que fazer com o resultado. Cada guard é dono do
// seu canal e da sua prosa — o modo `--review` do `check-registry-source` e do
// `check-unused-deps` roda no job semanal, onde a decisão vencida vira VIOLAÇÃO
// (exit 1); no run normal ela é `::warning::`, porque uma data não pode bloquear
// o commit e o PR de todo mundo. Aqui mora só o FATO (a data é válida? está
// dentro da janela?), que é o que não pode divergir entre as três listas.
//
// Usage:
//   import { parseAddedAt, reviewAddedAtEntries, DEFAULT_REVIEW_DAYS } from "./allowlist-review.mjs"
//   const { invalid, aged } = reviewAddedAtEntries(ALLOWLIST, { idOf: (e) => e.pkg })
//
// Exit codes:
//   (módulo puro — não possui CLI nem exit code próprio; quem decide o exit é o
//    guard que consome `invalid`/`aged`, e cada um o faz na sua prosa)
// =============================================================================

/** Milissegundos de um dia civil — a unidade da janela de revisão. */
export const MS_PER_DAY = 86_400_000

/**
 * A janela de REVISÃO default, em dias (180 ≈ 6 meses).
 *
 * É o número que cada guard usa como default do seu próprio nome exportado
 * (`OUT_OF_SCOPE_REVIEW_DAYS`, `THIRD_PARTY_REVIEW_DAYS`,
 * `UNUSED_DEPS_REVIEW_DAYS`): uma lista que precise de outra janela muda UMA
 * linha, e o nome no guard continua dizendo a que pergunta ele responde.
 */
export const DEFAULT_REVIEW_DAYS = 180

/**
 * `addedAt` (`YYYY-MM-DD`) → epoch ms em UTC, ou `null` se ausente/malformada.
 *
 * Compara os componentes de volta com a data construída porque `Date.UTC`
 * TRANSBORDA (`2026-02-30` vira `2026-03-02`): aceitar o transbordo deixaria
 * passar uma data que o autor jamais digitou.
 *
 * @param {unknown} value
 * @returns {number|null}
 */
export function parseAddedAt(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const [y, m, d] = value.split("-").map(Number)
  const ms = Date.UTC(y, m - 1, d)
  const dt = new Date(ms)
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null
  return ms
}

/**
 * O veredito de DATA de uma lista de decisões: o que está SEM REGISTRO (data
 * ausente/malformada/no futuro — fail-closed, violação nos dois modos) e o que
 * está SEM REVISÃO (passou a janela).
 *
 * `idOf` diz qual campo IDENTIFICA a entrada naquela lista (`path` no escopo,
 * `prefix` na de terceiros, `match` na de deps): a regra é a mesma, o rótulo é
 * do dono — e é ele que aparece no relatório.
 *
 * `now`/`reviewDays` são injetáveis porque uma prova de envelhecimento não pode
 * depender do relógio da máquina que roda a suíte (nem do dia em que ela roda).
 *
 * @param {{addedAt?: unknown}[]} entries
 * @param {{idOf?: (entry: any) => string, now?: number, reviewDays?: number}} [options]
 * @returns {{invalid: {id: string, why: string}[], aged: {id: string, addedAt: string, days: number, limit: number}[]}}
 */
export function reviewAddedAtEntries(
  entries,
  { idOf = (entry) => entry.path, now = Date.now(), reviewDays = DEFAULT_REVIEW_DAYS } = {},
) {
  const invalid = []
  const aged = []
  for (const entry of entries ?? []) {
    const id = idOf(entry)
    const raw = entry?.addedAt
    if (raw === undefined || raw === null || raw === "") {
      invalid.push({ id, why: "sem `addedAt` (a data em que a decisao foi tomada)" })
      continue
    }
    const ms = parseAddedAt(raw)
    if (ms === null) {
      invalid.push({
        id,
        why: `\`addedAt\` invalido ('${raw}') — use uma data civil ISO 'YYYY-MM-DD'`,
      })
      continue
    }
    if (ms > now) {
      invalid.push({
        id,
        why: `\`addedAt\` no FUTURO ('${raw}') — uma decisao nao pode ter sido tomada depois de hoje`,
      })
      continue
    }
    const days = Math.floor((now - ms) / MS_PER_DAY)
    if (days > reviewDays) aged.push({ id, addedAt: raw, days, limit: reviewDays })
  }
  return { invalid, aged }
}

/**
 * A violação de uma entrada SEM o registro da data. O `listName` é da lista (o
 * dono), e `why` vem de `reviewAddedAtEntries` — a prosa é uma só, para as três
 * allowlists não contarem a mesma história de três jeitos.
 *
 * @param {{label: string, listName: string, why: string}} args
 * @returns {string}
 */
export function invalidAddedAtViolation({ label, listName, why }) {
  return `${label}: esta em ${listName} mas ${why} — sem o registro da data a isencao nao tem como envelhecer, e "esqueci de registrar" viraria o jeito de nunca precisar revisar.`
}

/**
 * A violação de uma entrada SEM REVISÃO (passou a janela). `listName` é da
 * lista (o dono) e `remedy` é o que ela considera "reafirmar" — o resto da
 * frase é comum: uma isenção que ninguém revisa vira permanente por
 * esquecimento. O nome da LISTA entra na mensagem porque o `label` sozinho nem
 * sempre diz de onde a isenção veio (o prefixo de uma imagem de terceiros é um
 * repositório, não o nome da allowlist) — e uma violação que não diz QUAL lista
 * revisar manda o leitor procurar.
 *
 * @param {{label: string, listName: string, addedAt: string, days: number, limit: number, remedy: string}} args
 * @returns {string}
 */
export function agedAddedAtViolation({ label, addedAt, days, limit, remedy, listName }) {
  return `${label}: esta em ${listName} e a decisao foi tomada em ${addedAt} (ha ${days} dia(s), janela de revisao de ${limit}) — SEM REVISAO. ${remedy}. Uma isencao que ninguem revisa vira permanente por esquecimento.`
}
