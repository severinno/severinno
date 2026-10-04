/**
 * fetch-unrestricted-results.test.ts
 *
 * Contrato de PAGINAÇÃO do caminho unrestricted da listagem /api/providers:
 *
 * 1. DETERMINISMO: a ordem da página vem EXCLUSIVAMENTE da resolução de IDs
 *    (Phase 1b, SQL bruto). Sem desempate total no ORDER BY, prestadores
 *    empatados em (avgRating, favoriteCount) — o grupo de empate do seed real
 *    tinha 54 membros — pulam de página entre requests. O desempate `u.id ASC`
 *    (chave única) fecha a ordenação.
 * 2. KEYSET: com cursor, a página seguinte vem de um predicado de linha
 *    (sem OFFSET — custo O(log n), não O(skip)); hasMore é EXATO (take+1);
 *    o nextCursor codifica a âncora do último item da página.
 */

import { describe, it, expect, vi } from "vitest"
import { fetchUnrestrictedResults } from "../fetch-unrestricted-results"
import { decodeProviderCursor, encodeProviderCursor } from "../keyset"
import type { ProviderDataItem } from "../fetch-providers-data"

vi.mock("../fetch-providers-data", () => ({
  // Stub: a Phase 2 preserva a ordem dos IDs (map idOrder) — o teste de ordem
  // não precisa do mapper real, só da sequência de ids recebida.
  fetchProvidersData: vi.fn(async (ids: string[]) =>
    ids.map((id) => ({ id, name: `p-${id}` }) as unknown as ProviderDataItem),
  ),
}))

const BASE_OPTS = {
  fbWhere: "u.role = 'PROVIDER'",
  fbParams: [],
  take: 9,
  skip: 0,
  hasGeo: false,
  latNum: null,
  lngNum: null,
}

/** queryRawUnsafe por TIPO de query: IDs (contém ORDER BY) devolve as rows; COUNT devolve o total. */
function depsWith(
  idRows: Array<{ id: string; avgRating: number | null; favoriteCount: number | null }> = [],
) {
  const queryRawUnsafe = vi.fn(async (sql: string) =>
    sql.includes("ORDER BY") ? idRows : [{ total: BigInt(idRows.length) }],
  )
  return {
    queryRawUnsafe,
    deps: {
      serviceFindMany: vi.fn(),
      bookingGroupBy: vi.fn(),
      userFindMany: vi.fn(),
      queryRawUnsafe,
    } as unknown as Parameters<typeof fetchUnrestrictedResults>[1],
  }
}

describe("fetchUnrestrictedResults — paginação", () => {
  it("OFFSET mode: o SQL da Phase 1b fecha o ORDER BY com o desempate único u.id ASC", async () => {
    const { queryRawUnsafe, deps } = depsWith()

    await fetchUnrestrictedResults(BASE_OPTS, deps)

    const sqls = queryRawUnsafe.mock.calls.map((c) => String(c[0]))
    const idQuery = sqls.find((s) => s.includes("ORDER BY"))
    expect(idQuery).toBeDefined()
    expect(idQuery).toContain(
      'ORDER BY u."avgRating" DESC NULLS LAST, u."favoriteCount" DESC, u.id ASC',
    )
    const orderLine = idQuery!.split("\n").find((l) => l.includes("ORDER BY"))!
    expect(orderLine.trimEnd().endsWith('u."favoriteCount" DESC, u.id ASC')).toBe(true)
  })

  it("OFFSET mode: LIMIT take+1 (hasMore exato) e OFFSET parametrizados após o ORDER BY", async () => {
    const { queryRawUnsafe, deps } = depsWith()

    await fetchUnrestrictedResults({ ...BASE_OPTS, skip: 18 }, deps)

    const idCall = queryRawUnsafe.mock.calls.find((c) => String(c[0]).includes("ORDER BY"))
    expect(idCall).toBeDefined()
    expect(idCall!.slice(1)).toEqual([10, 18])
  })

  it("OFFSET mode: sem IDs a resposta é vazia com nextCursor null (não chama a Phase 2)", async () => {
    const { deps } = depsWith()

    const result = await fetchUnrestrictedResults(BASE_OPTS, deps)

    expect(result).toEqual({
      items: [],
      total: 0,
      expandedRadius: -1,
      nextCursor: null,
      hasMore: false,
    })
    expect(deps.userFindMany).not.toHaveBeenCalled()
    expect(deps.serviceFindMany).not.toHaveBeenCalled()
  })

  it("KEYSET mode: seek por predicado de linha, sem OFFSET, e nextCursor = âncora do último item", async () => {
    // 3 rows para take=2 → hasMore exato true; a página usa as 2 primeiras.
    const rows = [
      { id: "a", avgRating: 4.5, favoriteCount: 2 },
      { id: "b", avgRating: 4.5, favoriteCount: 2 },
      { id: "c", avgRating: 4, favoriteCount: 0 },
    ]
    const anchor0 = { s: "rating" as const, r: 5, f: 3, id: "z" }
    const { queryRawUnsafe, deps } = depsWith(rows)

    const result = await fetchUnrestrictedResults(
      { ...BASE_OPTS, take: 2, cursorAnchor: anchor0 },
      deps,
    )

    const idSql = String(queryRawUnsafe.mock.calls[0][0])
    // Predicado de linha com as chaves normalizadas (negação + sentinela de NULL).
    // Params float vão como STRING + cast ::float8: o Prisma serializa JS number
    // como numeric truncado a 16 dígitos significativos (ex.: -3.6666666666666665
    // chega como "-3.666666666666667"), o que reintroduzia rows de rating igual
    // à âncora (bug de duplicatas). String passa verbatim; o cast restaura o
    // double exato no lado SQL.
    expect(idSql).toContain(
      '(-COALESCE(u."avgRating", -1), -COALESCE(u."favoriteCount", 0), u.id) > ($1::float8, $2::float8, $3)',
    )
    expect(idSql).not.toContain("OFFSET")
    expect(idSql).toContain("LIMIT $4")
    // Params: âncora negada como string (-5, -3), id da âncora, take+1
    expect(queryRawUnsafe.mock.calls[0].slice(1)).toEqual(["-5", "-3", "z", 3])
    // ORDER BY normalizado (mesma semântica do DESC NULLS LAST; ASC implícito)
    expect(idSql).toContain(
      'ORDER BY -COALESCE(u."avgRating", -1), -COALESCE(u."favoriteCount", 0), u.id',
    )
    // Página: primeiras `take` rows, ordem preservada
    expect(result.items.map((i) => i.id)).toEqual(["a", "b"])
    expect(result.hasMore).toBe(true)
    // nextCursor decodifica para a âncora do ÚLTIMO item da página
    expect(result.nextCursor).not.toBeNull()
    expect(decodeProviderCursor(result.nextCursor!)).toEqual({
      s: "rating",
      r: 4.5,
      f: 2,
      d: null,
      id: "b",
    })
  })

  it("KEYSET mode: última página (rows ≤ take) → hasMore false e nextCursor null", async () => {
    const rows = [
      { id: "a", avgRating: 4, favoriteCount: 0 },
      { id: "b", avgRating: null, favoriteCount: 0 },
    ]
    const { deps } = depsWith(rows)

    const result = await fetchUnrestrictedResults(
      { ...BASE_OPTS, take: 9, cursorAnchor: { s: "rating", r: 5, f: 0, id: "z" } },
      deps,
    )

    expect(result.items.map((i) => i.id)).toEqual(["a", "b"])
    expect(result.hasMore).toBe(false)
    expect(result.nextCursor).toBeNull()
  })

  it("codec do cursor: roundtrip e rejeição de anomalias", () => {
    const anchor = { s: "distance" as const, r: 4.5, f: 0, d: 1234.567, id: "abc" }
    const raw = encodeProviderCursor(anchor)
    expect(raw).not.toContain("=")
    expect(decodeProviderCursor(raw)).toEqual(anchor)

    expect(decodeProviderCursor("lixo!!!")).toBeNull()
    expect(
      decodeProviderCursor(encodeProviderCursor({ s: "rating", r: 1, f: 0, id: "x" }) + "x"),
    ).toBeNull()
    expect(decodeProviderCursor(encodeProviderCursor({ ...anchor, s: "rating" }))).not.toBeNull()
    expect(
      decodeProviderCursor(encodeProviderCursor({ s: "distance", r: 1, f: 0, id: "x" })),
    ).toBeNull() // distance sem d
    expect(
      decodeProviderCursor(encodeProviderCursor({ s: "rating", r: 1, f: 0, id: "" })),
    ).toBeNull() // id vazio
    expect(
      decodeProviderCursor(encodeProviderCursor({ s: "rating", r: NaN, f: 0, id: "x" })),
    ).toEqual({ s: "rating", r: null, f: 0, d: null, id: "x" }) // JSON sani­­tiza NaN→null
  })
})
