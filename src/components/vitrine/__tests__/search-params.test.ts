/**
 * Tests for search-params.ts — codec URL ↔ estado da vitrine.
 *
 * Coverage:
 *   ✅ URL completa (q, categoria, raio, ordenar, nota, verificados) → filters
 *   ✅ Defaults quando a URL está vazia (anyParam=false)
 *   ✅ Valores inválidos são ignorados (raio fora de 1-100, nota inválida,
 *      categoria com caracteres proibidos, q vazio/espaços)
 *   ✅ ordenar=distancia mantido no parse (fallback para rating é do
 *      orchestrator, que conhece o estado de geo)
 *   ✅ Cursor base64url decodável entra; lixo/truncado é descartado
 *   ✅ Roundtrip serialize(parse(url)) preserva os dados
 *   ✅ Serialize omite defaults e vira "" no estado default
 */

import { describe, it, expect } from "vitest"
import { encodeProviderCursor } from "@/lib/keyset"
import { DEFAULT_FILTERS } from "../filters"
import { parseVitrineSearchParams, serializeVitrineUrlState } from "../search-params"

const CURSOR_ANCHOR = { s: "rating" as const, r: 4.5, f: 12, id: "usr_abc" }

describe("parseVitrineSearchParams — URL vazia/default", () => {
  it("returns defaults and anyParam=false for empty search", () => {
    const parsed = parseVitrineSearchParams("")
    expect(parsed.filters).toEqual(DEFAULT_FILTERS)
    expect(parsed.cursor).toBeNull()
    expect(parsed.anyParam).toBe(false)
  })

  it("returns defaults for unknown params only", () => {
    const parsed = parseVitrineSearchParams("?utm_source=x&foo=bar")
    expect(parsed.anyParam).toBe(false)
    expect(parsed.filters).toEqual(DEFAULT_FILTERS)
  })
})

describe("parseVitrineSearchParams — filtros válidos", () => {
  it("parses the full URL", () => {
    const parsed = parseVitrineSearchParams(
      "?q=encanador&categoria=cat_123&raio=30&ordenar=distancia&nota=4&verificados=1",
    )
    expect(parsed.anyParam).toBe(true)
    expect(parsed.filters.q).toBe("encanador")
    expect(parsed.filters.categoryId).toBe("cat_123")
    expect(parsed.filters.radius).toBe(30)
    expect(parsed.filters.sort).toBe("distancia" === "distancia" ? "distance" : "rating")
    expect(parsed.filters.minRating).toBe(4)
    expect(parsed.filters.verifiedOnly).toBe(true)
    expect(parsed.cursor).toBeNull()
  })

  it("trims q edges and keeps internal spaces", () => {
    const parsed = parseVitrineSearchParams("?q=%20di%C3%A1%20%20eletricista%20")
    expect(parsed.filters.q).toBe("diá  eletricista")
    expect(parsed.anyParam).toBe(true)
  })

  it("treats ordenar=avaliacao as a recognized param (default value)", () => {
    const parsed = parseVitrineSearchParams("?ordenar=avaliacao")
    expect(parsed.filters.sort).toBe("rating")
    expect(parsed.anyParam).toBe(true)
  })
})

describe("parseVitrineSearchParams — valores inválidos ignorados", () => {
  it("ignores raio fora de 1..100", () => {
    expect(parseVitrineSearchParams("?raio=0").filters.radius).toBe(DEFAULT_FILTERS.radius)
    expect(parseVitrineSearchParams("?raio=101").filters.radius).toBe(DEFAULT_FILTERS.radius)
    expect(parseVitrineSearchParams("?raio=abc").filters.radius).toBe(DEFAULT_FILTERS.radius)
    expect(parseVitrineSearchParams("?raio=15.5").filters.radius).toBe(DEFAULT_FILTERS.radius)
    // fora do range não conta como parâmetro reconhecido
    expect(parseVitrineSearchParams("?raio=999").anyParam).toBe(false)
  })

  it("ignores nota inválida", () => {
    const parsed = parseVitrineSearchParams("?nota=2")
    expect(parsed.filters.minRating).toBe(0)
    expect(parsed.anyParam).toBe(false)
  })

  it("ignores categoria com caracteres proibidos ou comprimento exagerado", () => {
    expect(parseVitrineSearchParams("?categoria=<script>").filters.categoryId).toBeNull()
    expect(parseVitrineSearchParams(`?categoria=${"a".repeat(65)}`).filters.categoryId).toBeNull()
    expect(parseVitrineSearchParams("?categoria=ok_id-9").filters.categoryId).toBe("ok_id-9")
  })

  it("ignores q vazio/espaços", () => {
    const parsed = parseVitrineSearchParams("?q=%20%20")
    expect(parsed.filters.q).toBe("")
    expect(parsed.anyParam).toBe(false)
  })
})

describe("parseVitrineSearchParams — cursor", () => {
  it("accepts a valid base64url cursor", () => {
    const cursor = encodeProviderCursor(CURSOR_ANCHOR)
    const parsed = parseVitrineSearchParams(`?cursor=${cursor}`)
    expect(parsed.cursor).toBe(cursor)
    expect(parsed.anyParam).toBe(true)
  })

  it("discards garbage cursor (not decodable)", () => {
    // base64url válido em formato, mas lixo ao decodificar/validar
    expect(parseVitrineSearchParams("?cursor=!!!!").cursor).toBeNull()
    expect(parseVitrineSearchParams("?cursor=----").cursor).toBeNull()
  })

  it("discards oversized cursor (>512 chars)", () => {
    const big = "A".repeat(600)
    const parsed = parseVitrineSearchParams(`?cursor=${big}`)
    expect(parsed.cursor).toBeNull()
    expect(parsed.anyParam).toBe(false)
  })
})

describe("serializeVitrineUrlState", () => {
  it("returns empty string for default state", () => {
    expect(
      serializeVitrineUrlState({
        filters: DEFAULT_FILTERS,
        pagina: 1,
        cursor: null,
        anyParam: true,
      }),
    ).toBe("")
  })

  it("serializes only non-defaults, in stable order", () => {
    const qs = serializeVitrineUrlState({
      filters: {
        ...DEFAULT_FILTERS,
        q: "encanador",
        minRating: 4,
        verifiedOnly: true,
        radius: 40,
        sort: "distance",
      },
      pagina: 1,
      cursor: null,
      anyParam: true,
    })
    expect(qs).toBe("q=encanador&raio=40&ordenar=distancia&nota=4&verificados=1")
  })

  it("keeps explicit default sort as no-param (serialize não emite ordenar=avaliacao)", () => {
    const qs = serializeVitrineUrlState({
      filters: DEFAULT_FILTERS,
      pagina: 1,
      cursor: null,
      anyParam: true,
    })
    expect(qs).not.toContain("ordenar")
  })

  it("roundtrips parse → serialize → parse", () => {
    const url = "?q=mec%C3%A2nico&categoria=cat_9&raio=7&ordenar=distancia&nota=3&verificados=1"
    const first = parseVitrineSearchParams(url)
    const qs = serializeVitrineUrlState(first)
    const second = parseVitrineSearchParams(`?${qs}`)
    expect(second.filters).toEqual(first.filters)
    expect(second.cursor).toBeNull()
  })

  it("roundtrips the cursor through serialize", () => {
    const cursor = encodeProviderCursor(CURSOR_ANCHOR)
    const parsed = parseVitrineSearchParams(`?q=x&cursor=${cursor}`)
    const qs = serializeVitrineUrlState(parsed)
    expect(qs).toBe(`q=x&cursor=${cursor}`)
  })

  it("truncates q over 200 chars on serialize", () => {
    const qs = serializeVitrineUrlState({
      filters: { ...DEFAULT_FILTERS, q: "a".repeat(300) },
      pagina: 1,
      cursor: null,
      anyParam: true,
    })
    expect(qs.length).toBeLessThanOrEqual("q=".length + 200 + 20)
  })
})

describe("pagina (?pagina=N)", () => {
  it("parses pagina=2+ and counts as param", () => {
    const parsed = parseVitrineSearchParams("?pagina=3")
    expect(parsed.pagina).toBe(3)
    expect(parsed.anyParam).toBe(true)
  })

  it("pagina=1 explícito é default (não conta)", () => {
    const parsed = parseVitrineSearchParams("?pagina=1")
    expect(parsed.pagina).toBe(1)
    expect(parsed.anyParam).toBe(false)
  })

  it("inválidos caem em 1 (0, negativo, não-inteiro, absurdo)", () => {
    for (const v of ["0", "-2", "2.5", "abc", "9999"]) {
      const parsed = parseVitrineSearchParams(`?pagina=${v}`)
      expect(parsed.pagina).toBe(1)
      expect(parsed.anyParam).toBe(false)
    }
  })

  it("teto MAX_PAGINA é aceito, acima disso vira 1", () => {
    expect(parseVitrineSearchParams("?pagina=500").pagina).toBe(500)
    expect(parseVitrineSearchParams("?pagina=501").pagina).toBe(1)
  })

  it("serialize emite pagina só acima de 1", () => {
    const qs = serializeVitrineUrlState({
      filters: DEFAULT_FILTERS,
      pagina: 7,
      cursor: null,
      anyParam: true,
    })
    expect(qs).toBe("pagina=7")
  })

  it("roundtrip pagina + cursor", () => {
    const cursor = encodeProviderCursor(CURSOR_ANCHOR)
    const url = `?q=x&pagina=12&cursor=${cursor}`
    const first = parseVitrineSearchParams(url)
    const qs = serializeVitrineUrlState(first)
    expect(qs).toBe(`q=x&pagina=12&cursor=${cursor}`)
    expect(parseVitrineSearchParams(`?${qs}`).pagina).toBe(12)
  })
})
