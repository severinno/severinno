/**
 * search-params.ts
 *
 * Codec URL ↔ estado da vitrine — buscas compartilháveis por link.
 *
 * Responsável por DUAS coisas, e só elas:
 *   1. Ler `?q=…&categoria=…&raio=…&ordenar=…&nota=…&verificados=1&pagina=N&cursor=…`
 *      e hidratar filters + página navegável + cursor-âncora (deep-link).
 *   2. Serializar o estado corrente de volta para a query string (omitindo
 *      defaults), para o espelhamento na barra de endereço.
 *
 * Decisões de desenho:
 *   - Módulo PURO (sem React): parse/serialize são testáveis em isolamento.
 *   - A URL é a fonte dos FILTROS no load; a PÁGINA (`?pagina=N`) é
 *     navegação real (back/forward funcionam). O `cursor` é a ÂNCORA keyset
 *     da página hidratada — sem ela, um link ?pagina=N fundo não pode dar
 *     seek: o orchestrator caminha (walk) de página em página a partir da
 *     âncora conhecida mais próxima. Qualquer mudança de filtro zera página
 *     e cursor (a ordem do keyset muda e ambos perdem o sentido).
 *   - `lat`/`lng` NUNCA vão para a URL: compartilhar a localização do usuário
 *     é vazamento de privacidade. Quem abre o link sem geo e com
 *     ordenar=distancia cai no fallback rating (mesmo contrato da UI).
 *   - Qualquer valor inválido é IGNORADO (cai no default) — a URL suja de
 *     terceiros nunca quebra a página; só o `cursor`, que o próprio
 *     decodeProviderCursor valida (inválido ⇒ 400 explícito da rota, contrato
 *     do keyset), é mantido.
 *   - Nomes curtos e sem acento (`ordenar`, `nota`, `raio`) para URLs limpas.
 */

import { decodeProviderCursor } from "@/lib/keyset"
import { DEFAULT_FILTERS, type FiltersState } from "./filters"

// ---------------------------------------------------------------------------
// Parse: URL → estado
// ---------------------------------------------------------------------------

export interface VitrineUrlState {
  filters: FiltersState
  /** Página navegável (1-based, param ?pagina=N). 1 = omitido na URL. */
  pagina: number
  /** Cursor-âncora do deep-link (âncora keyset da página hidratada). */
  cursor: string | null
  /** true se a URL trouxe pelo menos um parâmetro reconhecido e válido. */
  anyParam: boolean
}

const MAX_Q_CHARS = 200
const MAX_CATEGORY_ID_CHARS = 64
const CATEGORY_ID_RE = /^[A-Za-z0-9_-]+$/
const CURSOR_RE = /^[A-Za-z0-9_-]+$/ // base64url (o codec do keyset não emite '=')
const MAX_CURSOR_CHARS = 512
/** Teto defensivo de ?pagina=N (deep-links absurdos são clampados pelo orchestrator). */
export const MAX_PAGINA = 500

export function parseVitrineSearchParams(search: string): VitrineUrlState {
  const params = new URLSearchParams(search)
  const filters: FiltersState = { ...DEFAULT_FILTERS }
  let pagina = 1
  let anyParam = false

  const q = (params.get("q") ?? "").trim()
  if (q) {
    filters.q = q.slice(0, MAX_Q_CHARS)
    anyParam = true
  }

  const categoria = params.get("categoria")
  if (categoria && categoria.length <= MAX_CATEGORY_ID_CHARS && CATEGORY_ID_RE.test(categoria)) {
    filters.categoryId = categoria
    anyParam = true
  }

  const raio = Number(params.get("raio"))
  if (Number.isInteger(raio) && raio >= 1 && raio <= 100) {
    filters.radius = raio
    anyParam = true
  }

  const ordenar = params.get("ordenar")
  if (ordenar === "distancia" || ordenar === "distance") {
    // Sem geo o orchestrator cai para rating (mesmo contrato da UI) — aqui só
    // registramos a intenção; a permissão de geolocalização é do browser.
    filters.sort = "distance"
    anyParam = true
  } else if (ordenar === "avaliacao") {
    anyParam = true // default explícito: conta como parâmetro, não muda valor
  }

  const nota = Number(params.get("nota"))
  if (nota === 3 || nota === 4 || nota === 5) {
    filters.minRating = nota
    anyParam = true
  }

  if (params.get("verificados") === "1") {
    filters.verifiedOnly = true
    anyParam = true
  }

  // Página navegável: inteiro 1..MAX_PAGINA. pagina=1 explícito é default
  // (não conta como parâmetro); inválido vira 1.
  const paginaRaw = Number(params.get("pagina"))
  if (Number.isInteger(paginaRaw) && paginaRaw >= 2 && paginaRaw <= MAX_PAGINA) {
    pagina = paginaRaw
    anyParam = true
  }

  // Cursor: valida formato (base64url) E decodabilidade (o decode do keyset
  // rejeita lixo). Inválido é descartado — sem cursor a vitrine abre na
  // página 1, comportamento correto para link truncado/manipulado.
  let cursor: string | null = null
  const rawCursor = params.get("cursor")
  if (rawCursor && rawCursor.length <= MAX_CURSOR_CHARS && CURSOR_RE.test(rawCursor)) {
    if (decodeProviderCursor(rawCursor) !== null) {
      cursor = rawCursor
      anyParam = true
    }
  }

  return { filters, pagina, cursor, anyParam }
}

// ---------------------------------------------------------------------------
// Serialize: estado → query string (defaults omitidos)
// ---------------------------------------------------------------------------

/** Serializa o estado corrente; string vazia quando tudo é default. */
export function serializeVitrineUrlState(state: VitrineUrlState): string {
  const { filters, pagina, cursor } = state
  const params = new URLSearchParams()

  const q = filters.q.trim()
  if (q) params.set("q", q.slice(0, MAX_Q_CHARS))
  if (filters.categoryId) params.set("categoria", filters.categoryId)
  if (filters.radius !== DEFAULT_FILTERS.radius) params.set("raio", String(filters.radius))
  // Mesmo token aceito no parse (`distancia`): links compartilhados ficam
  // estáveis sob roundtrip parse → serialize → parse.
  if (filters.sort !== DEFAULT_FILTERS.sort) params.set("ordenar", "distancia")
  if (filters.minRating !== DEFAULT_FILTERS.minRating) params.set("nota", String(filters.minRating))
  if (filters.verifiedOnly) params.set("verificados", "1")
  if (pagina > 1) params.set("pagina", String(pagina))
  if (cursor) params.set("cursor", cursor)

  return params.toString()
}
