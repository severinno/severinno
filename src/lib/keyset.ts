/**
 * keyset.ts
 *
 * Paginação KEYSET (seek method) da listagem /api/providers.
 *
 * OFFSET custa O(offset): a página 47 varre e descarta centenas de rows por
 * request — e com empates de rating o plano do Postgres não é estável. O
 * keyset busca a página seguinte direto pelo predicado de linha:
 *
 *   WHERE (k0, k1, k2) > (âncora0, âncora1, âncora2)   -- chaves todas ASC
 *
 * As chaves são NORMALIZADAS para todas ASC: `avgRating DESC NULLS LAST` e
 * `favoriteCount DESC` viram negações ASC com sentinelas de NULL
 * (COALESCE(rating, -1) — rating é sempre ≥ 0, então NULL ordena por último
 * exatamente como o `NULLS LAST` atual). Com todas as chaves ASC, a comparação
 * de linha do Postgres captura a página seguinte numa ÚNICA expressão — sem
 * cascatas de OR, sem tratamento especial de NULL.
 *
 * O cursor é OPAQUE (base64url de JSON): o cliente nunca interpreta, o
 * servidor valida tudo (sort compatível, números finitos, id presente).
 * Cursor inválido ⇒ decode null ⇒ 400 na rota (contrato explícito, nunca
 * "silenciosamente volta à página 1").
 */

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export type ProviderSort = "rating" | "distance"

/** Âncora do último item da página atual (valores crus, sem negação). */
export interface ProviderCursorAnchor {
  s: ProviderSort
  /** avgRating do último item (null = sem rating → sentinela -1). */
  r: number | null
  /** favoriteCount do último item. */
  f: number | null
  /** ST_Distance em metros do último item (só sort=distance). */
  d?: number | null
  /** id do último item (chave de desempate única). */
  id: string
}

export interface KeysetPredicate {
  /** Cláusula SQL (sem `AND` — a rota concatena). */
  sql: string
  /** Parâmetros posicionais na ordem dos placeholders. */
  params: unknown[]
}

// ---------------------------------------------------------------------------
// Codec do cursor (base64url, sem Buffer — roda em node, bun e jsdom)
// ---------------------------------------------------------------------------

const MAX_CURSOR_CHARS = 512

function toBase64Url(s: string): string {
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function fromBase64Url(s: string): string | null {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/")
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4)
  try {
    return atob(padded)
  } catch {
    return null
  }
}

export function encodeProviderCursor(anchor: ProviderCursorAnchor): string {
  return toBase64Url(JSON.stringify(anchor))
}

/**
 * Decodifica e valida o cursor. Retorna null para QUALQUER anomalia
 * (tamanho, base64, JSON, campos ausentes, números não finitos) — a rota
 * responde 400, nunca re-pagina do início em silêncio.
 */
export function decodeProviderCursor(raw: string): ProviderCursorAnchor | null {
  if (!raw || raw.length > MAX_CURSOR_CHARS) return null
  const json = fromBase64Url(raw)
  if (json === null) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return null
  }
  if (typeof parsed !== "object" || parsed === null) return null
  const a = parsed as Record<string, unknown>
  if (a.s !== "rating" && a.s !== "distance") return null
  if (typeof a.id !== "string" || a.id.length === 0 || a.id.length > 64) return null
  const numOrNull = (v: unknown): number | null => {
    if (v === null || v === undefined) return null
    if (typeof v !== "number" || !Number.isFinite(v)) return null
    return v
  }
  const r = numOrNull(a.r)
  const f = numOrNull(a.f)
  const d = numOrNull(a.d)
  if (a.s === "distance" && d === null) return null
  return { s: a.s, r, f, d, id: a.id }
}

// ---------------------------------------------------------------------------
// ORDER BY normalizado (mesma semântica do OFFSET mode, chaves todas ASC)
// ---------------------------------------------------------------------------

/** Expressões das chaves (rating mode) — usadas no ORDER BY e no predicado. */
const RATING_KEYS = `-COALESCE(u."avgRating", -1), -COALESCE(u."favoriteCount", 0), u.id`

/**
 * Chaves de ordenação keyset para sort=rating (prefixar com `ORDER BY`).
 * Equivalente a `avgRating DESC NULLS LAST, favoriteCount DESC, id ASC`:
 * rating ∈ [0,5] ⇒ COALESCE(rating,-1) DESC põe NULL por último; a negação
 * inverte para ASC e habilita a comparação de linha única do seek.
 */
export const KEYSET_ORDER_KEYS_RATING = RATING_KEYS

/** Idem para sort=distance (distância ASC primeiro). */
export function keysetOrderKeysDistance(distExpr: string): string {
  return `${distExpr} ASC, ${RATING_KEYS}`
}

// ---------------------------------------------------------------------------
// Predicado de seek
// ---------------------------------------------------------------------------

/**
 * Constrói o predicado de linha que busca a página SEGUINTE a partir da
 * âncora. Os placeholders começam em `startParam` (a rota passa
 * idParams.length + 1 — os params do WHERE vêm antes).
 *
 * rating  ⇒ (k0,k1,k2) > (-(r ?? -1), -(f ?? 0), id)
 * distance ⇒ (distExpr, k0',k1',k2') > (d, -(r ?? -1), -(f ?? 0), id)
 *
 * ⚠️ PARÂMETROS FLOAT VÃO COMO STRING + CAST `::float8`:
 * o driver do Prisma serializa JS number como NUMERIC truncado a 16 dígitos
 * significativos (probe real: -3.6666666666666665 chega ao Postgres como
 * "-3.666666666666667"), então `-COALESCE(rating,-1) > $1` aceita rows de
 * rating IGUAL à âncora — duplicatas em toda troca de página. String passa
 * verbatim e o cast do lado SQL restaura o double exato; sem o cast a
 * row-comparison falha (`double precision > text` não existe). Probe:
 * `SELECT pg_typeof($1)` ⇒ numeric com dígito 16º alterado.
 */
export function buildKeysetPredicate(opts: {
  sort: ProviderSort
  anchor: ProviderCursorAnchor
  /** Expressão SQL da distância (mesma do ORDER BY). Obrigatório no modo distance. */
  distExpr?: string
  /** Índice do primeiro placeholder (1-based). */
  startParam: number
}): KeysetPredicate {
  const { sort, anchor, distExpr, startParam } = opts
  const p = (i: number) => `$${startParam + i}`
  const negR = String(-(anchor.r ?? -1))
  const negF = String(-(anchor.f ?? 0))

  if (sort === "distance") {
    if (!distExpr) throw new Error("keyset distance requer distExpr")
    if (anchor.d === null || anchor.d === undefined) {
      throw new Error("keyset distance requer âncora d")
    }
    return {
      sql: `(${distExpr}, -COALESCE(u."avgRating", -1), -COALESCE(u."favoriteCount", 0), u.id) > (${p(0)}::float8, ${p(1)}::float8, ${p(2)}::float8, ${p(3)})`,
      params: [String(anchor.d), negR, negF, anchor.id],
    }
  }

  return {
    sql: `(${RATING_KEYS}) > (${p(0)}::float8, ${p(1)}::float8, ${p(2)})`,
    params: [negR, negF, anchor.id],
  }
}
