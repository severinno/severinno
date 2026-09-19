import { describe, expect, it } from "vitest"

import {
  classifyTier,
  deriveGhcrOwner,
  documentedCiRow,
  formatBenchTable,
  parseActrcVersion,
  parseArgs,
  parseBenchRow,
} from "../../../scripts/bench-setup-bun.mjs"

// ---------------------------------------------------------------------------
// Fixtures de log (formato real do act, conforme os guards de tier)
// ---------------------------------------------------------------------------

// Imagem custom ubuntu-bun: tier-1 engaja. O setup é UM step ('Setup Bun',
// que roda scripts/setup-bun-ci.sh) — a duração dele com o tier-1 engajado É
// o fast path (o script sai na primeira checagem).
const LOG_TIER1_FAST = `
| ✅ Usando Bun pré-instalado: 1.3.14 (0s, sem download)
✅  Success - Main Setup Bun [461.9667ms]
`

// Imagem catthehacker default: act EMULA o actions/cache (~21s medido),
// tier-1 não engaja, cache MISS e o setup inteiro custa ~30.5s.
// Fixture de MISS: a linha 'Cache restored successfully' NÃO aparece (cache
// vazio no act = miss) — só o restore + a linha 'Cache not found'. O ponto da
// linha é o CUSTO EMULADO do cache; depois do miss o script cairia no tier-3
// (a linha 'URL: ...' do download é o outro fixture, LOG_TIER3_COLD).
const LOG_CATTHEHACKER_DEFAULT = `
| Cache not found for input keys: bun-1.3.14-linux-x64
✅  Success - Main Restore Bun cache [21.220s]
✅  Success - Main Setup Bun [30.51291s]
`

// Log sem qualquer evidência do setup-bun (act morreu antes do step).
const LOG_NO_EVIDENCE = `
❌  Error: Image 'ghcr.io/severinno/ubuntu-bun:1.3.14' not found
`

// Tier-3 cold-cache download: o script baixou o release (a linha 'URL: ...' é
// `echo` simples e sobrevive ao act; os títulos ::group:: não). Sem linha de
// duração do step de cache, mas o engajamento EXPLÍCITO do download conta como
// evidência (mesmo contrato do setupBunEvidence do tier-1 guard).
const LOG_TIER3_COLD = `
| Cache not found for input keys: bun-1.3.14-linux-x64
| URL: https://github.com/oven-sh/bun/releases/download/bun-v1.3.14/bun-linux-x64.zip
✅  Success - Main Setup Bun [8.412s]
`

// ---------------------------------------------------------------------------
// parseActrcVersion
// ---------------------------------------------------------------------------

describe("parseActrcVersion", () => {
  it("extrai a versão da linha --var BUN_VERSION", () => {
    expect(parseActrcVersion("--var BUN_VERSION=1.3.14")).toBe("1.3.14")
    expect(parseActrcVersion("--var foo=bar\n--var BUN_VERSION=1.3.14\n")).toBe("1.3.14")
  })

  it("retorna null quando a linha não existe", () => {
    expect(parseActrcVersion("--var FOO=bar")).toBeNull()
    expect(parseActrcVersion("")).toBeNull()
  })

  it("rejeita versão malformada (ex.: 1.3 parcial ou 1.3.14..)", () => {
    // O regex exige SEMVER X.Y.Z completo — "1.3" (parcial) e "1.3.14.."
    // (sufixo inválido) NÃO casam, ao contrário do genérico [\d.]+ que
    // aceitaria. Contrato: o .actrc pinado é sempre X.Y.Z completo.
    expect(parseActrcVersion("--var BUN_VERSION=1.3")).toBeNull()
    expect(parseActrcVersion("--var BUN_VERSION=1.3.14..")).toBeNull()
    expect(parseActrcVersion("--var BUN_VERSION=1.3.14")).toBe("1.3.14")
  })
})

// ---------------------------------------------------------------------------
// deriveGhcrOwner
// ---------------------------------------------------------------------------

describe("deriveGhcrOwner", () => {
  it("deriva owner de URL SSH do GitHub", () => {
    expect(deriveGhcrOwner("git@github.com:severinno/severinno.git")).toBe("severinno")
  })

  it("deriva owner de URL HTTPS do GitHub", () => {
    expect(deriveGhcrOwner("https://github.com/outro/repo.git")).toBe("outro")
  })

  it("prioriza BENCH_OWNER (env) quando presente", () => {
    expect(deriveGhcrOwner("git@github.com:severinno/severinno.git", "org-custom")).toBe(
      "org-custom",
    )
  })

  it("fallback para 'severinno' quando não consegue derivar", () => {
    expect(deriveGhcrOwner("")).toBe("severinno")
    expect(deriveGhcrOwner("file:///tmp/repo")).toBe("severinno")
  })
})

// ---------------------------------------------------------------------------
// classifyTier
// ---------------------------------------------------------------------------

describe("classifyTier", () => {
  const fast = { markerVersion: "1.3.14" }
  const cache = {}
  const none = { tier2Engaged: false, tier3Engaged: false }

  it("tier-3 tem prioridade máxima (download explícito)", () => {
    expect(classifyTier(fast, cache, { tier2Engaged: true, tier3Engaged: true })).toBe("tier-3")
  })

  it("tier-2 (cache restore) acima do marcador tier-1", () => {
    expect(classifyTier(fast, cache, { tier2Engaged: true, tier3Engaged: false })).toBe("tier-2")
  })

  it("tier-2 pelo step de cache quando o script não deixa marcador", () => {
    // O cache é um step de primeiro nível que roda SEMPRE: sem marcador tier-1
    // e sem sinal do script, é a única camada observável (ex.: cache emulado
    // pelo act, como no cenário catthehacker default).
    expect(classifyTier({ markerVersion: null }, { cacheRestoreEngaged: true }, none)).toBe(
      "tier-2",
    )
  })

  it("tier-1 quando o marcador existe e nenhum tier inferior engajou", () => {
    expect(classifyTier(fast, cache, none)).toBe("tier-1")
  })

  it("sem evidência quando nada engajou", () => {
    expect(classifyTier({ markerVersion: null }, cache, none)).toBe("sem evidência")
  })
})

// ---------------------------------------------------------------------------
// parseBenchRow
// ---------------------------------------------------------------------------

describe("parseBenchRow", () => {
  it("imagem custom → tier-1, fast-path medido, restore nulo, evidência", () => {
    const row = parseBenchRow({
      ambiente: "act + custom",
      imagem: "ghcr.io/x/ubuntu-bun:1.3.14",
      logText: LOG_TIER1_FAST,
    })
    expect(row.tier).toBe("tier-1")
    expect(row.markerVersion).toBe("1.3.14")
    expect(row.fastPathSeconds).toBeCloseTo(0.4619667, 6)
    expect(row.restoreSeconds).toBeNull()
    // Um só step: o total do setup É o mesmo número do fast path.
    expect(row.compositeSeconds).toBeCloseTo(0.4619667, 6)
    expect(row.hasEvidence).toBe(true)
  })

  it("catthehacker default → tier-2 emulado, restore medido, cache MISS", () => {
    const row = parseBenchRow({
      ambiente: "act + default",
      imagem: "catthehacker/ubuntu:act-latest",
      logText: LOG_CATTHEHACKER_DEFAULT,
    })
    expect(row.tier).toBe("tier-2")
    expect(row.markerVersion).toBeNull()
    // Sem o marcador tier-1 o step 'Setup Bun' NÃO é fast path (o script usa
    // cache/download) — a duração fica só no total (compositeSeconds).
    expect(row.fastPathSeconds).toBeNull()
    expect(row.compositeSeconds).toBeCloseTo(30.51291, 3)
    expect(row.restoreSeconds).toBeCloseTo(21.22, 3)
    expect(row.cacheMiss).toBe(true)
    expect(row.cacheHit).toBe(false)
    expect(row.hasEvidence).toBe(true)
  })

  it("log sem evidência → hasEvidence false (act morreu antes do setup-bun)", () => {
    const row = parseBenchRow({ ambiente: "x", imagem: "y", logText: LOG_NO_EVIDENCE })
    expect(row.tier).toBe("sem evidência")
    expect(row.hasEvidence).toBe(false)
  })

  it("tier-3 cold-cache → hasEvidence true mesmo sem duração capturada (engajamento explícito conta)", () => {
    const row = parseBenchRow({ ambiente: "act + cold", imagem: "z", logText: LOG_TIER3_COLD })
    expect(row.tier).toBe("tier-3")
    expect(row.restoreSeconds).toBeNull()
    expect(row.compositeSeconds).toBeCloseTo(8.412, 3)
    expect(row.fastPathSeconds).toBeNull()
    expect(row.cacheMiss).toBe(true)
    expect(row.hasEvidence).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// documentedCiRow
// ---------------------------------------------------------------------------

describe("documentedCiRow", () => {
  it("linha documentada do CI real com a versão do bun", () => {
    const row = documentedCiRow("1.3.14")
    expect(row.ambiente).toContain("CI real")
    expect(row.documented).toContain("bun 1.3.14")
    expect(row.hasEvidence).toBe(false)
    expect(row.compositeSeconds).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// formatBenchTable
// ---------------------------------------------------------------------------

describe("formatBenchTable", () => {
  it("imprime header + corpo com '-' para nulos e HIT/MISS para cache", () => {
    const rows = [
      documentedCiRow("1.3.14"),
      parseBenchRow({ ambiente: "act + custom", imagem: "x", logText: LOG_TIER1_FAST }),
      parseBenchRow({ ambiente: "act + default", imagem: "y", logText: LOG_CATTHEHACKER_DEFAULT }),
    ]
    const table = formatBenchTable(rows)
    const lines = table.split("\n")
    expect(lines[0]).toContain("| Ambiente | Tier | composite | fast-path | restore | cache |")
    expect(lines.length).toBe(5) // 2 header + 3 linhas
    // Linha documentada: coluna composite carrega o texto documented
    expect(lines[2]).toContain("CI real")
    expect(lines[2]).toContain("~1-2s warm")
    // Linha custom: fast-path em segundos, cache '-'
    expect(lines[3]).toContain("tier-1")
    expect(lines[3]).toContain("0.462s")
    expect(lines[3]).toContain("| - |")
    // Linha default: restore medido, cache MISS
    expect(lines[4]).toContain("tier-2")
    expect(lines[4]).toContain("21.220s")
    expect(lines[4]).toContain("MISS")
  })
})

// ---------------------------------------------------------------------------
// parseArgs
// ---------------------------------------------------------------------------

describe("parseArgs", () => {
  it("defaults: runs 1, timeout 240, sem json/custom-tag", () => {
    const args = parseArgs([])
    expect(args.runs).toBe(1)
    expect(args.timeout).toBe(240)
    expect(args.json).toBeNull()
    expect(args.customTag).toBeNull()
    expect(args.error).toBeNull()
  })

  it("--runs e --timeout inteiros positivos", () => {
    expect(parseArgs(["--runs", "3", "--timeout", "120"])).toMatchObject({
      runs: 3,
      timeout: 120,
      error: null,
    })
  })

  it("--json e --custom-tag recebem valores", () => {
    expect(
      parseArgs(["--json", "out.json", "--custom-tag", "ghcr.io/x/ubuntu-bun:1.3.14"]),
    ).toMatchObject({
      json: "out.json",
      customTag: "ghcr.io/x/ubuntu-bun:1.3.14",
    })
  })

  it("rejeita --runs inválido (0, negativo, não-numérico, ausente)", () => {
    expect(parseArgs(["--runs", "0"]).error).toContain(">= 1")
    expect(parseArgs(["--runs", "abc"]).error).toContain(">= 1")
    expect(parseArgs(["--runs"]).error).toContain(">= 1")
  })

  it("rejeita --timeout inválido (0, não-numérico, ausente)", () => {
    expect(parseArgs(["--timeout", "0"]).error).toContain("> 0")
    expect(parseArgs(["--timeout", "xyz"]).error).toContain("> 0")
    expect(parseArgs(["--timeout"]).error).toContain("> 0")
  })

  it("--json e --custom-tag exigem valor", () => {
    expect(parseArgs(["--json"]).error).toContain("--json exige")
    expect(parseArgs(["--custom-tag"]).error).toContain("--custom-tag exige")
  })

  it("-h/--help marcam help e argumento desconhecido vira erro", () => {
    expect(parseArgs(["-h"]).help).toBe(true)
    expect(parseArgs(["--help"]).help).toBe(true)
    expect(parseArgs(["--bogus"]).error).toContain("desconhecido")
  })
})
