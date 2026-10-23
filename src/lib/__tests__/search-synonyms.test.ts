import { describe, it, expect } from "vitest"
import { matchSynonymSuggestions, POPULAR_SYNONYMS } from "../search-synonyms"

describe("search-synonyms", () => {
  it("contém lista populada com as principais demandas brasileiras", () => {
    expect(POPULAR_SYNONYMS.length).toBeGreaterThanOrEqual(10)
  })

  it("retorna sugestão para 'chuveiro'", () => {
    const results = matchSynonymSuggestions("chuveiro")
    expect(results.length).toBeGreaterThan(0)
    expect(results[0]?.targetCategorySlug).toBe("eletrica")
    expect(results[0]?.macroDomainSlug).toBe("reparos-e-instalacoes")
  })

  it("retorna sugestão para 'vazamento'", () => {
    const results = matchSynonymSuggestions("vazamento")
    expect(results.length).toBeGreaterThan(0)
    expect(results[0]?.targetCategorySlug).toBe("hidraulica")
  })

  it("retorna sugestão para emergência 'chaveiro'", () => {
    const results = matchSynonymSuggestions("chaveiro")
    expect(results.length).toBeGreaterThan(0)
    expect(results[0]?.macroDomainSlug).toBe("emergencia-24h")
  })

  it("ignora acentuação e maiúsculas ('PÓS-OBRA')", () => {
    const results = matchSynonymSuggestions("PÓS-OBRA")
    expect(results.length).toBeGreaterThan(0)
    expect(results[0]?.macroDomainSlug).toBe("limpeza-e-casa")
  })

  it("retorna array vazio para strings curtas", () => {
    expect(matchSynonymSuggestions("")).toEqual([])
    expect(matchSynonymSuggestions("a")).toEqual([])
  })
})
