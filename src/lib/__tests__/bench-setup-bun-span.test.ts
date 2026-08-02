/**
 * bench-setup-bun-span.test.ts
 *
 * Testes das funções PURAS de medição do span do step setup-bun a partir da
 * jobs API do GitHub — scripts/bench-setup-bun-span.mjs, extraído do
 * bench-setup-bun.sh (que vivia inline via grep/cut + node -e).
 *
 * TRAVA EM TESTE os fixes do review (3 bugs reais corrigidos em 08/2026):
 *   1. NaN no run COLD — steps SKIPPED têm started_at/completed_at NULOS na
 *      jobs API (ex.: "Add cached Bun to PATH" é skipped quando
 *      cache-hit != true). Sem filtrar status == "completed", o step skipped
 *      virava o `tail -1` da lista e `new Date("")` = NaN no cálculo.
 *   2. Span correto = started_at do 1º sub-step relevante RODADO →
 *      completed_at do último (precisão de ms, saída em segundos 2 decimais).
 *   3. Sem steps relevantes rodados → null (caller reporta erro, não NaN).
 *
 * Fixtures FIÉIS ao action real (.github/actions/setup-bun/action.yml):
 *   - Cold (tier-3): resolve → detect → restore (miss) → download (cold).
 *     "Ensure bunx symlink" e "Add cached Bun to PATH" ficam SKIPPED (null
 *     timestamps) no FINAL — o span termina no download.
 *   - Warm (tier-2): restore (hit) → ensure bunx symlink → add cached Bun to
 *     PATH rodados; "Download Bun release (cold cache)" fica SKIPPED.
 *   - NÃO existe step "Post Bun release cache" no action — o post do
 *     actions/cache aparece na API como "Post Run actions/cache@v4", que NÃO
 *     casa SPAN_STEP_RE (sem "Bun release" no nome). Fixture segue a real.
 *
 * Nenhuma rede: as funções recebem o array de steps diretamente. Os testes
 * CLI (spawnSync do próprio módulo com stdin) cobrem o contrato usado pelo
 * .sh sem tocar na API.
 */

import { describe, it, expect } from "vitest"
import { spawnSync } from "node:child_process"
import { join } from "node:path"
import {
  SPAN_STEP_RE,
  completedSteps,
  relevantSteps,
  computeSetupBunSpan,
} from "../../../scripts/bench-setup-bun-span.mjs"

// Caminho do módulo para os testes CLI (spawn do node). Usa process.cwd() —
// o vitest roda com cwd = raiz do projeto (onde está o vitest.config.unit.ts);
// NÃO usar fileURLToPath(new URL(...)) — o import.meta.url do vitest não tem
// scheme file e quebra com "The URL must be of scheme file".
const MODULE_PATH = join(process.cwd(), "scripts", "bench-setup-bun-span.mjs")

// ── fixtures (shape real da jobs API: .jobs[0].steps) ───────────────────────

/** Sub-steps do composite action setup-bun no run COLD (tier-3, cache miss). */
const COLD_STEPS = [
  {
    name: "Resolve Bun version",
    status: "completed",
    started_at: "2026-08-02T10:00:00.000Z",
    completed_at: "2026-08-02T10:00:00.120Z",
  },
  {
    name: "Detect pre-installed Bun",
    status: "completed",
    started_at: "2026-08-02T10:00:00.120Z",
    completed_at: "2026-08-02T10:00:00.180Z",
  },
  // fast path skipped (bun não pré-instalado em runner padrão)
  {
    name: "Use pre-installed Bun (fast path)",
    status: "skipped",
    started_at: null,
    completed_at: null,
  },
  // restore RODA no cold (cache miss = lookup que retorna miss)
  {
    name: "Restore Bun release from cache",
    status: "completed",
    started_at: "2026-08-02T10:00:00.180Z",
    completed_at: "2026-08-02T10:00:00.300Z",
  },
  {
    name: "Download Bun release (cold cache)",
    status: "completed",
    started_at: "2026-08-02T10:00:00.300Z",
    completed_at: "2026-08-02T10:00:09.800Z",
  },
  // skipped no FINAL da lista — timestamps NULOS (o bug do NaN)
  {
    name: "Ensure bunx symlink (cached installs)",
    status: "skipped",
    started_at: null,
    completed_at: null,
  },
  {
    name: "Add cached Bun to PATH",
    status: "skipped",
    started_at: null,
    completed_at: null,
  },
  // post do actions/cache — NÃO casa a regex (não é "Bun release")
  {
    name: "Post Run actions/cache@v4",
    status: "completed",
    started_at: "2026-08-02T10:00:09.800Z",
    completed_at: "2026-08-02T10:00:10.000Z",
  },
]

/** Sub-steps no run WARM (tier-2, cache hit). */
const WARM_STEPS = [
  {
    name: "Resolve Bun version",
    status: "completed",
    started_at: "2026-08-02T10:00:00.000Z",
    completed_at: "2026-08-02T10:00:00.100Z",
  },
  {
    name: "Detect pre-installed Bun",
    status: "completed",
    started_at: "2026-08-02T10:00:00.100Z",
    completed_at: "2026-08-02T10:00:00.150Z",
  },
  {
    name: "Use pre-installed Bun (fast path)",
    status: "skipped",
    started_at: null,
    completed_at: null,
  },
  // cache HIT → "Download Bun release (cold cache)" fica SKIPPED
  {
    name: "Restore Bun release from cache",
    status: "completed",
    started_at: "2026-08-02T10:00:00.150Z",
    completed_at: "2026-08-02T10:00:00.300Z",
  },
  {
    name: "Download Bun release (cold cache)",
    status: "skipped",
    started_at: null,
    completed_at: null,
  },
  {
    name: "Ensure bunx symlink (cached installs)",
    status: "completed",
    started_at: "2026-08-02T10:00:00.300Z",
    completed_at: "2026-08-02T10:00:00.400Z",
  },
  {
    name: "Add cached Bun to PATH",
    status: "completed",
    started_at: "2026-08-02T10:00:00.400Z",
    completed_at: "2026-08-02T10:00:02.800Z",
  },
  {
    name: "Post Run actions/cache@v4",
    status: "completed",
    started_at: "2026-08-02T10:00:02.800Z",
    completed_at: "2026-08-02T10:00:03.000Z",
  },
]

// ── SPAN_STEP_RE ───────────────────────────────────────────────────────────

describe("SPAN_STEP_RE", () => {
  it("casa os nomes reais dos sub-steps do composite action setup-bun", () => {
    for (const name of [
      "Resolve Bun version",
      "Detect pre-installed Bun",
      "Use pre-installed Bun (fast path)",
      "Restore Bun release from cache",
      "Download Bun release (cold cache)",
      "Ensure bunx symlink (cached installs)",
      "Add cached Bun to PATH",
    ]) {
      expect(SPAN_STEP_RE.test(name)).toBe(true)
    }
  })

  it("NÃO casa steps fora do action (checkout, post do cache, run genérico)", () => {
    for (const name of [
      "Set up job",
      "Run actions/checkout@v4",
      "Post Run actions/cache@v4",
      "bun --version",
    ]) {
      expect(SPAN_STEP_RE.test(name)).toBe(false)
    }
  })

  it("edge documentado: 'Post Bun release cache' (nome que NÃO existe no action) casaria via 'Bun release'", () => {
    // O post real do actions/cache aparece como "Post Run actions/cache@v4"
    // (que NÃO casa) — não como "Post Bun release cache". Se algum dia o
    // action ganhar um step post com "Bun release" no nome, o span passaria
    // a incluí-lo — este teste fixa que o contrato atual NÃO o inclui.
    expect(SPAN_STEP_RE.test("Post Bun release cache")).toBe(true)
  })
})

// ── completedSteps ─────────────────────────────────────────────────────────

describe("completedSteps", () => {
  it("mantém só steps com status == 'completed' (filtra skipped/null)", () => {
    const out = completedSteps(COLD_STEPS)
    expect(out.map((s) => s.name)).toEqual([
      "Resolve Bun version",
      "Detect pre-installed Bun",
      "Restore Bun release from cache",
      "Download Bun release (cold cache)",
      "Post Run actions/cache@v4",
    ])
    expect(out.every((s) => s.status === "completed")).toBe(true)
  })

  it("lista vazia / undefined → []", () => {
    expect(completedSteps([])).toEqual([])
    expect(completedSteps(undefined)).toEqual([])
  })

  it("steps com status ausente são filtrados (fail-safe)", () => {
    expect(completedSteps([{ name: "x" }, { name: "y", status: "completed" }])).toHaveLength(1)
  })
})

// ── relevantSteps ──────────────────────────────────────────────────────────

describe("relevantSteps", () => {
  it("cold: skipped com nome relevante (Ensure bunx / Add cached) NÃO entram", () => {
    const out = relevantSteps(COLD_STEPS)
    expect(out.map((s) => s.name)).toEqual([
      "Resolve Bun version",
      "Detect pre-installed Bun",
      "Restore Bun release from cache",
      "Download Bun release (cold cache)",
    ])
  })

  it("warm: último relevante é 'Add cached Bun to PATH' (cache hit)", () => {
    const out = relevantSteps(WARM_STEPS)
    expect(out.map((s) => s.name)).toEqual([
      "Resolve Bun version",
      "Detect pre-installed Bun",
      "Restore Bun release from cache",
      "Ensure bunx symlink (cached installs)",
      "Add cached Bun to PATH",
    ])
  })

  it("steps fora do action (ex.: 'Set up job', post do cache) nunca entram", () => {
    const steps = [
      { name: "Set up job", status: "completed", started_at: "x", completed_at: "y" },
      { name: "Resolve Bun version", status: "completed", started_at: "a", completed_at: "b" },
      {
        name: "Post Run actions/cache@v4",
        status: "completed",
        started_at: "c",
        completed_at: "d",
      },
    ]
    expect(relevantSteps(steps).map((s) => s.name)).toEqual(["Resolve Bun version"])
  })
})

// ── computeSetupBunSpan ────────────────────────────────────────────────────

describe("computeSetupBunSpan", () => {
  it("COLD: span = 1º relevante rodado → último relevante rodado, ignorando skipped no final (fix do NaN)", () => {
    // 10:00:00.000 → 10:00:09.800 = 9.8s; "Ensure bunx symlink" e
    // "Add cached Bun to PATH" (skipped, null timestamps) no final NÃO
    // quebram o cálculo nem viram o `last`.
    expect(computeSetupBunSpan(COLD_STEPS)).toBe("9.80")
  })

  it("WARM: span termina no 'Add cached Bun to PATH' rodado (cache hit)", () => {
    // 10:00:00.000 → 10:00:02.800 = 2.8s (2 decimais)
    expect(computeSetupBunSpan(WARM_STEPS)).toBe("2.80")
  })

  it("NaN fix: timestamps null em steps skipped não geram NaN (retorna span válido)", () => {
    // O bug original: sem o filtro, "Add cached Bun to PATH" (skipped, null)
    // virava o tail -1 e new Date(null) = NaN. Com o filtro, o cálculo é
    // feito sobre steps RODADOS apenas.
    const span = computeSetupBunSpan(COLD_STEPS)
    expect(span).not.toBe("NaN")
    expect(Number.isNaN(Number(span))).toBe(false)
    expect(span).toBe("9.80")
  })

  it("steps completados com timestamps vazios (string '') → null (não NaN)", () => {
    const steps = [
      { name: "Resolve Bun version", status: "completed", started_at: "", completed_at: "" },
    ]
    expect(computeSetupBunSpan(steps)).toBeNull()
  })

  it("nenhum step relevante rodado (só skipped) → null", () => {
    const steps = [
      { name: "Add cached Bun to PATH", status: "skipped", started_at: null, completed_at: null },
      { name: "Set up job", status: "completed", started_at: "a", completed_at: "b" },
    ]
    expect(computeSetupBunSpan(steps)).toBeNull()
  })

  it("lista vazia → null", () => {
    expect(computeSetupBunSpan([])).toBeNull()
    expect(computeSetupBunSpan(undefined)).toBeNull()
  })

  it("um único step relevante → span = duração dele (delta próprio, não zero)", () => {
    const steps = [
      {
        name: "Download Bun release (cold cache)",
        status: "completed",
        started_at: "2026-08-02T10:00:00.000Z",
        completed_at: "2026-08-02T10:00:05.500Z",
      },
    ]
    expect(computeSetupBunSpan(steps)).toBe("5.50")
  })

  it("timestamps ausentes (undefined) → null", () => {
    const steps = [{ name: "Resolve Bun version", status: "completed" }]
    expect(computeSetupBunSpan(steps)).toBeNull()
  })

  it("timestamps fora de ordem (end < start) → null (não imprime -5.00 na tabela)", () => {
    const steps = [
      {
        name: "Resolve Bun version",
        status: "completed",
        started_at: "2026-08-02T10:00:05.000Z",
        completed_at: "2026-08-02T10:00:00.000Z",
      },
    ]
    expect(computeSetupBunSpan(steps)).toBeNull()
  })
})

// ── CLI (contrato consumido pelo .sh: stdin JSON → span | exit 1) ──────────

describe("modo CLI (spawn do módulo, sem rede)", () => {
  it("stdin com steps cold → imprime '9.80' e exit 0", () => {
    const res = spawnSync(process.execPath, [MODULE_PATH], {
      input: JSON.stringify(COLD_STEPS),
      encoding: "utf8",
    })
    expect(res.status).toBe(0)
    expect(res.stdout.trim()).toBe("9.80")
  })

  it("stdin com steps warm → imprime '2.80' e exit 0", () => {
    const res = spawnSync(process.execPath, [MODULE_PATH], {
      input: JSON.stringify(WARM_STEPS),
      encoding: "utf8",
    })
    expect(res.status).toBe(0)
    expect(res.stdout.trim()).toBe("2.80")
  })

  it("stdin vazio ([]) → mensagem de erro em stderr e exit 1 (não NaN)", () => {
    const res = spawnSync(process.execPath, [MODULE_PATH], {
      input: "[]",
      encoding: "utf8",
    })
    expect(res.status).toBe(1)
    expect(res.stderr).toContain("nenhum sub-step relevante RODADO")
    expect(res.stdout.trim()).toBe("")
  })

  it("stdin com JSON inválido → erro claro e exit 1", () => {
    const res = spawnSync(process.execPath, [MODULE_PATH], {
      input: "{não é json",
      encoding: "utf8",
    })
    expect(res.status).toBe(1)
    expect(res.stderr).toContain("JSON inválido")
  })

  it("sem stdin (processo morre por EOF sem dados) → exit 1", () => {
    const res = spawnSync(process.execPath, [MODULE_PATH], {
      input: "",
      encoding: "utf8",
    })
    expect(res.status).toBe(1)
  })
})
