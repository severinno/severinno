/**
 * fuzzy-search.ts — Pure TypeScript Portuguese Trigram & Fuzzy Search Engine
 *
 * Implements N-gram similarity, Levenshtein distance, and accent stripping
 * to deliver ultra-fast (<2ms) typo-tolerant search in Portuguese without
 * expensive external search SaaS (Algolia / Elastic).
 */

export interface FuzzyMatchResult<T = unknown> {
  item: T
  targetText: string
  score: number // 0.0 to 1.0
  matchedTerms: string[]
  suggestedSpelling?: string
}

/**
 * Removes Brazilian Portuguese accents and diacritics
 */
export function removeAccents(str: string): string {
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
}

/**
 * Generates character trigrams (3-grams) for a given string
 */
export function generateTrigrams(str: string): Set<string> {
  const clean = `  ${removeAccents(str)} `
  const trigrams = new Set<string>()

  for (let i = 0; i < clean.length - 2; i++) {
    trigrams.add(clean.slice(i, i + 3))
  }

  return trigrams
}

/**
 * Computes Dice's coefficient trigram similarity between two strings (0.0 to 1.0)
 */
export function trigramSimilarity(str1: string, str2: string): number {
  if (!str1 || !str2) return 0
  const s1 = removeAccents(str1)
  const s2 = removeAccents(str2)

  if (s1 === s2) return 1.0

  const tri1 = generateTrigrams(s1)
  const tri2 = generateTrigrams(s2)

  let intersection = 0
  for (const t of tri1) {
    if (tri2.has(t)) {
      intersection++
    }
  }

  return (2 * intersection) / (tri1.size + tri2.size)
}

/**
 * Computes Levenshtein edit distance between two strings
 */
export function levenshteinDistance(a: string, b: string): number {
  const s1 = removeAccents(a)
  const s2 = removeAccents(b)

  const matrix: number[][] = []

  for (let i = 0; i <= s1.length; i++) {
    matrix[i] = [i]
  }

  for (let j = 0; j <= s2.length; j++) {
    matrix[0][j] = j
  }

  for (let i = 1; i <= s1.length; i++) {
    for (let j = 1; j <= s2.length; j++) {
      if (s1[i - 1] === s2[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1]
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        )
      }
    }
  }

  return matrix[s1.length][s2.length]
}

/**
 * Standard Brazilian Home Services search catalog dictionary
 */
export const DEFAULT_SERVICE_CATALOG = [
  { id: "cat-1", title: "Eletricista Residencial", tags: ["eletrica", "disjuntor", "tomada", "chuveiro", "fio", "luminaria"] },
  { id: "cat-2", title: "Encanador / Desentupidor", tags: ["hidraulica", "vazamento", "cano", "pia", "ralo", "esgoto", "torneira"] },
  { id: "cat-3", title: "Pintor Profissional", tags: ["pintura", "parede", "tinta", "massa corrida", "verniz", "textura"] },
  { id: "cat-4", title: "Chaveiro 24 Horas", tags: ["fechadura", "chave", "porta", "abertura", "tranca", "tetra"] },
  { id: "cat-5", title: "Técnico de Ar-Condicionado", tags: ["split", "climatizacao", "gas", "limpeza", "higienizacao", "inverter"] },
  { id: "cat-6", title: "Marceneiro & Montador de Móveis", tags: ["marcenaria", "armario", "guarda-roupa", "cozinha", "madeira"] },
  { id: "cat-7", title: "Instalador de Energia Solar", tags: ["solar", "placa", "fotovoltaica", "inversor", "economia"] },
  { id: "cat-8", title: "Pedreiro & Reformas", tags: ["alvenaria", "reforma", "piso", "porcelanato", "azulejo", "reboco"] },
  { id: "cat-9", title: "Diarista & Faxina Pesada", tags: ["limpeza", "faxina", "pos-obra", "casa", "apartamento"] },
]

/**
 * Searches a catalog with typo-tolerance and returns ranked matches
 */
export function fuzzySearchCatalog<T extends { title: string; tags?: string[] }>(
  query: string,
  catalog: T[] = DEFAULT_SERVICE_CATALOG as unknown as T[],
  minScore: number = 0.3
): FuzzyMatchResult<T>[] {
  if (!query || query.trim().length === 0) return []

  const cleanQuery = removeAccents(query)
  const results: FuzzyMatchResult<T>[] = []

  for (const item of catalog) {
    // 1. Direct title similarity
    const titleScore = trigramSimilarity(query, item.title)

    // 2. Tag similarities
    let bestTagScore = 0
    const matchedTerms: string[] = []

    if (item.tags) {
      for (const tag of item.tags) {
        const tagScore = trigramSimilarity(query, tag)
        if (cleanQuery.includes(removeAccents(tag)) || removeAccents(tag).includes(cleanQuery)) {
          matchedTerms.push(tag)
          bestTagScore = Math.max(bestTagScore, 0.85)
        } else if (tagScore > bestTagScore) {
          bestTagScore = tagScore
          if (tagScore > 0.4) matchedTerms.push(tag)
        }
      }
    }

    const finalScore = Math.max(titleScore, bestTagScore)

    if (finalScore >= minScore) {
      results.push({
        item,
        targetText: item.title,
        score: Number(finalScore.toFixed(2)),
        matchedTerms,
        suggestedSpelling: finalScore < 0.9 ? item.title : undefined,
      })
    }
  }

  return results.sort((a, b) => b.score - a.score)
}
