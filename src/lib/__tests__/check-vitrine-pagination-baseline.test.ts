/**
 * Testes do guard de CI do baseline de paginação da vitrine
 * (scripts/check-vitrine-pagination-baseline.mjs).
 *
 * O que é testado SEM browser (a rotina real de Playwright é validada pela
 * execução de CI e pela rodada local contra o dev :3100):
 *   1. Lógica pura do veredito — mediana, escala do limiar por página de walk
 *      e o fail-closed de regime sem amostra (verde por ausência não existe).
 *   2. SIMETRIA DOC↔SCRIPT — os números de THRESHOLDS têm de estar na seção
 *      "Limiar de regressão" do doc; um lado que muda sem o outro reprova
 *      aqui (a fonte da régua não pode divergir da régua citada).
 *   3. Contrato de uso — argumentos e o cabeçalho do script (Usage/Exit code),
 *      julgado pelo MESMO guard que o CI usa (check-script-headers).
 */
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

import { documentedHeader } from "../../../scripts/check-script-headers.mjs"
import {
  BASELINE_DOC,
  DEFAULT_BASE_URL,
  DEFAULT_SAMPLES,
  MEASURES,
  MIN_SAMPLES,
  THRESHOLDS,
  evaluateBaseline,
  medianOf,
  parseArgs,
  walkPaginasOf,
} from "../../../scripts/check-vitrine-pagination-baseline.mjs"

const SCRIPT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..")
const SCRIPT_PATH = join(SCRIPT_DIR, "scripts", "check-vitrine-pagination-baseline.mjs")
const DOC_PATH = join(SCRIPT_DIR, BASELINE_DOC)

// ── Fábricas de measures (mesma forma que o runner coleta do browser) ───────

/** O `detail` de cada regime é uma forma própria — o tipo é indexado porque
 *  os testes filtram por campos que nem todo regime carrega. */
type Measure = { name: string; duration: number; detail: Record<string, unknown> | null }

const clique = (
  target: number,
  dur: number,
  opts?: { warm?: boolean; inFlight?: boolean },
): Measure => ({
  name: MEASURES.pagina,
  duration: dur,
  detail: {
    kind: "pagina",
    target,
    direction: "proxima",
    warm: opts?.warm ?? true,
    inFlight: opts?.inFlight ?? false,
  },
})

const seek = (dur: number): Measure => ({
  name: MEASURES.deeplink,
  duration: dur,
  detail: { kind: "deeplink", target: 3, walked: false, warm: false },
})

const walkReverso = (dur: number, target: number): Measure => ({
  name: MEASURES.walk,
  duration: dur,
  detail: { kind: "walk-anterior", target },
})

const walkInterno = (dur: number): Measure => ({
  name: MEASURES.deeplink,
  duration: dur,
  detail: { kind: "deeplink", target: 4, walked: true, warm: false },
})

/** A rodada VERDE de referência: os números observados do doc (2026-10-04). */
function rodadaVerde() {
  return [
    clique(2, 60), // aquecimento p1→p2
    clique(3, 45),
    clique(4, 120),
    clique(5, 100),
    clique(6, 90),
    clique(7, 110),
    seek(283.2),
    seek(283.9),
    seek(300),
    walkReverso(238.6, 2), // 1 página encadeada → limiar 800
    walkInterno(489), // 3 páginas → limiar 750
  ]
}

describe("medianOf", () => {
  it("ímpar devolve o elemento central", () => {
    expect(medianOf([3, 1, 2])).toBe(2)
  })
  it("par devolve a média dos dois centrais", () => {
    expect(medianOf([4, 1, 3, 2])).toBe(2.5)
  })
  it("vazia é null — o chamador reprova (fail-closed), nunca 0", () => {
    expect(medianOf([])).toBeNull()
  })
})

describe("walkPaginasOf", () => {
  it("walk parte de p1: alvo 2 = 1 página encadeada", () => {
    expect(walkPaginasOf({ target: 2 })).toBe(1)
  })
  it("alvo 4 = 3 páginas (o regime do deep-link ?pagina=4)", () => {
    expect(walkPaginasOf({ target: 4 })).toBe(3)
  })
  it("detail malformado não gera limiar 0 (piso de 1)", () => {
    expect(walkPaginasOf(null)).toBe(1)
    expect(walkPaginasOf({ target: 1 })).toBe(1)
  })
})

describe("evaluateBaseline — rodada observada no doc passa", () => {
  it("todos os 4 regimes dentro dos limiares → ok, zero violações", () => {
    const r = evaluateBaseline(rodadaVerde(), THRESHOLDS, { samples: 5 })
    expect(r.ok).toBe(true)
    expect(r.violations).toEqual([])
    expect(r.resumo.paginaWarm).toBe(6) // aquecimento p2 + 5 amostras p3..p7
    expect(r.resumo.deeplinkSeek).toBe(3)
  })

  it("popstate é coletado no resumo mas não é gateado (o doc não declara limiar dele)", () => {
    const r = evaluateBaseline(
      [
        ...rodadaVerde(),
        {
          name: MEASURES.popstate,
          duration: 5_000,
          detail: { kind: "popstate", target: 2, walked: false },
        },
      ],
      THRESHOLDS,
      { samples: 5 },
    )
    expect(r.resumo.popstate).toBe(1)
    expect(r.ok).toBe(true)
  })
})

describe("evaluateBaseline — pioras reprovam", () => {
  it("mediana do clique quente acima de 250ms", () => {
    const entries = rodadaVerde().map((e) => {
      if (e.name !== MEASURES.pagina || e.duration <= 0) return e
      const alvo = typeof e.detail?.target === "number" ? e.detail.target : 3
      return clique(alvo, 300)
    })
    const r = evaluateBaseline(entries, THRESHOLDS, { samples: 5 })
    const v = r.violations.find((x) => x.tipo === "limiar" && x.regime.includes("mediana"))
    expect(v?.limiarMs).toBe(250)
    expect(v?.observadoMs).toBe(300)
  })

  it("clique ÚNICO (frio ou em voo) acima de 800ms reprova mesmo com mediana boa", () => {
    const entries = [...rodadaVerde(), clique(8, 900, { warm: false, inFlight: true })]
    const r = evaluateBaseline(entries, THRESHOLDS, { samples: 5 })
    const v = r.violations.find((x) => x.regime.includes("clique único"))
    expect(v?.limiarMs).toBe(800)
    expect(v?.observadoMs).toBe(900)
  })

  it("walk reverso: 900ms em 1 página (limiar 800) reprova", () => {
    const entries = rodadaVerde().map((e) => (e.name === MEASURES.walk ? walkReverso(900, 2) : e))
    const r = evaluateBaseline(entries, THRESHOLDS, { samples: 5 })
    const v = r.violations.find((x) => x.regime.includes(MEASURES.walk))
    expect(v?.limiarMs).toBe(800)
  })

  it("walk reverso ESCALA: 900ms em 3 páginas (limiar 2400) passa", () => {
    const entries = rodadaVerde().map((e) => (e.name === MEASURES.walk ? walkReverso(900, 4) : e))
    expect(evaluateBaseline(entries, THRESHOLDS, { samples: 5 }).ok).toBe(true)
  })

  it("deep-link seek: mediana acima de 800ms reprova", () => {
    const entries = rodadaVerde().map((e) =>
      e.name === MEASURES.deeplink && e.detail?.walked === false ? seek(900) : e,
    )
    const r = evaluateBaseline(entries, THRESHOLDS, { samples: 5 })
    const v = r.violations.find((x) => x.regime.includes("seek"))
    expect(v?.limiarMs).toBe(800)
  })

  it("walk interno: 800ms em 3 páginas (limiar 750) reprova; 700 passa", () => {
    const estourado = rodadaVerde().map((e) => (e.detail?.walked === true ? walkInterno(800) : e))
    expect(
      evaluateBaseline(estourado, THRESHOLDS, { samples: 5 }).violations.some(
        (x) => x.regime.includes("walk interno") && x.limiarMs === 750,
      ),
    ).toBe(true)

    const dentro = rodadaVerde().map((e) => (e.detail?.walked === true ? walkInterno(700) : e))
    expect(evaluateBaseline(dentro, THRESHOLDS, { samples: 5 }).ok).toBe(true)
  })
})

describe("evaluateBaseline — fail-closed de regime sem amostra", () => {
  it("sem walk reverso reprova com dados-insuficientes (não é verde por ausência)", () => {
    const entries = rodadaVerde().filter((e) => e.name !== MEASURES.walk)
    const r = evaluateBaseline(entries, THRESHOLDS, { samples: 5 })
    const v = r.violations.find((x) => x.regime === MEASURES.walk)
    expect(v?.tipo).toBe("dados-insuficientes")
    expect(r.ok).toBe(false)
  })

  it("sem seek e sem walk interno reprova do mesmo jeito", () => {
    const r = evaluateBaseline(
      rodadaVerde().filter((e) => e.name !== MEASURES.deeplink),
      THRESHOLDS,
      { samples: 5 },
    )
    expect(r.violations.filter((x) => x.tipo === "dados-insuficientes").length).toBe(2)
  })

  it("menos amostras quentes que o piso do doc reprova a mediana inteira", () => {
    const entries = [
      clique(2, 60),
      clique(3, 45),
      clique(4, 50, { warm: false, inFlight: true }), // frio não conta para a mediana
      seek(283),
      seek(284),
      seek(290),
      walkReverso(238, 2),
      walkInterno(489),
    ]
    const r = evaluateBaseline(entries, THRESHOLDS, { samples: 5 })
    const v = r.violations.find((x) => x.regime.includes("warm"))
    expect(v?.tipo).toBe("dados-insuficientes")
    expect(v?.encontrado).toBe(2)
  })
})

describe("simetria doc ↔ script (a régua citada é a régua aplicada)", () => {
  const doc = readFileSync(DOC_PATH, "utf8")
  const secaoLimiar = doc.split("## Limiar de regressão")[1]?.split("\n## ")[0] ?? ""

  it("cada valor de THRESHOLDS está na seção Limiar de regressão do doc", () => {
    expect(secaoLimiar).not.toBe("")
    const numeros = new Set(secaoLimiar.match(/\d+/g) ?? [])
    for (const [nome, valor] of Object.entries(THRESHOLDS)) {
      expect(numeros.has(String(valor)), `limiar ${nome} (${valor}) ausente do doc`).toBe(true)
    }
  })

  it("a escala por página de walk está declarada no doc (limiar × páginas, não absoluto)", () => {
    expect(secaoLimiar).toMatch(/por página/i)
  })

  it("os 4 nomes de measure existem no doc e no script — as duas pontas", () => {
    for (const nome of Object.values(MEASURES)) {
      expect(doc).toContain(nome)
      expect(Object.values(MEASURES).filter((n) => n === nome).length).toBe(1)
    }
  })
})

describe("contrato de uso", () => {
  /** O erro de uso de uma linha de argumentos (null quando os args são válidos). */
  const erroDe = (argv: string[]) => {
    const r = parseArgs(argv)
    return r.ok ? null : r.error
  }
  it("cabeçalho do script satisfaz o MESMO guard que o CI roda (Usage + Exit code)", () => {
    const verdict = documentedHeader(readFileSync(SCRIPT_PATH, "utf8"), ".mjs")
    expect(verdict.ok).toBe(true)
    expect(verdict.missing).toEqual([])
  })

  it("defaults: base-url do doc (:3100), 5 cliques, sem JSON", () => {
    expect(parseArgs([])).toEqual({
      ok: true,
      baseUrl: DEFAULT_BASE_URL,
      samples: DEFAULT_SAMPLES,
      json: false,
      reportFile: null,
      help: false,
    })
  })

  it("--samples abaixo do piso do doc (≥ 3) é erro de uso", () => {
    expect(erroDe(["--samples", String(MIN_SAMPLES - 1)])).toContain("--samples")
    expect(erroDe(["--samples", "abc"])).toContain("--samples")
  })

  it("--base-url tira a barra final e argumento desconhecido é erro", () => {
    const r = parseArgs(["--base-url", "http://localhost:3100/"])
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.baseUrl).toBe("http://localhost:3100")
    expect(erroDe(["--nope"])).toContain("--nope")
    expect(erroDe(["--base-url"])).toContain("--base-url")
  })
})
