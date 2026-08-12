/**
 * unit-surface-contract.test.ts - pins the test:unit COMPONENT surface.
 *
 * WHY: address-autocomplete.tsx lives under src/components, which the unit
 * config blanket-excluded (the src/components test-file glob). The
 * pre-commit area mapping mapped the component to its co-located test,
 * vitest reported "No test files found", and --passWithNoTests turned that
 * into a SILENT SKIP - the component's deterministic suite (32 tests, fake
 * timers) ran only in the default config (CI test:run) and the fuzz suite,
 * NEVER in test:unit (local hooks + guard jobs). The user asked for a
 * render smoke test in test:unit; the honest fix was NOT a duplicate smoke
 * test (the deterministic suite already is one) but the re-inclusion of
 * the DETERMINISTIC vitrine tests in the unit surface.
 *
 * THE FIX (2026-08): vitest 3.1.1 does NOT honor `!` negation in
 * include/exclude (probed), but DOES honor extglob `!(...)`. The exclude
 * block now opens the WHOLE vitrine tree to test:unit (`!(vitrine)` keeps
 * every OTHER component tree excluded) and re-closes only the slow/brittle
 * vitrine kinds by suffix: fuzz (real timers + axe), a11y (axe-core),
 * accessibility (axe-core) and snapshot (golden). The resulting included
 * set is exactly the DETERMINISTIC vitrine tests - today
 * address-autocomplete.test.tsx (32) and provider-card.test.tsx (3), both
 * fast and fake-timer/pure-render. A NEW plain vitrine test auto-joins
 * test:unit by construction (the growth contract pinned below); a new
 * fuzz/a11y/accessibility/snapshot variant stays out.
 *
 * THIS SUITE makes the config's exclude block a CONTRACT: it extracts the
 * patterns from the CONFIG TEXT (importing vitest.config.unit.ts in-process
 * breaks the vite TextEncoder invariant - probed; the text is the stable
 * source of truth), applies them to the REAL component test tree with
 * picomatch (vitest's own glob engine - a transitive dependency guaranteed
 * present alongside vitest, not a direct devDep), and asserts the included
 * set is EXACTLY the deterministic vitrine tests. Mutation cases pin the
 * mechanism (a fuzz/a11y/accessibility/snapshot variant stays out; a new
 * plain vitrine test joins; a test in another component tree stays out).
 * Also pins the import-order self-containment contract and closes the
 * pre-commit silent skip (the mapped test for a component edit must NOT be
 * excluded).
 *
 * NOTE ON THE WALKER: the shared filesInDir() (fragile-range-patterns.mjs)
 * SKIPS __tests__/ directories (its SKIP_DIRS set), so it CANNOT enumerate
 * component tests - this suite walks the tree itself so the __tests__ dirs
 * are counted (the same surface vitest's include/exclude sees).
 */
import { describe, it, expect } from "vitest"
import fs from "node:fs"
import path from "node:path"
import { createRequire } from "node:module"
import { collectTestFiles } from "../pre-commit-tests.mjs"

const require = createRequire(import.meta.url)
const picomatch = require("picomatch")

const ROOT = process.cwd()
const UNIT_CONFIG = path.join(ROOT, "vitest.config.unit.ts")
const COMPONENTS_DIR = path.join(ROOT, "src", "components")

/** The deterministic vitrine suites that MUST run in test:unit today. */
const DETERMINISTIC = "src/components/vitrine/__tests__/address-autocomplete.test.tsx"
const PROVIDER_CARD = "src/components/vitrine/__tests__/provider-card.test.tsx"
const EXPECTED_INCLUDED = [DETERMINISTIC, PROVIDER_CARD].sort()

/**
 * The pinned component-exclusion contract. The config's exclude block MUST
 * declare exactly these 5 patterns (set equality - order is layout, not
 * contract): a change to the surface (a 6th tree re-included, a suffix
 * rule renamed) breaks this pin loudly and forces a conscious update.
 */
const PINNED_COMPONENT_PATTERNS = [
  "src/components/!(vitrine)/**/*.test.{ts,tsx}",
  "src/components/vitrine/__tests__/*fuzz*.test.{ts,tsx}",
  "src/components/vitrine/__tests__/*a11y*.test.{ts,tsx}",
  "src/components/vitrine/__tests__/*accessibility*.test.{ts,tsx}",
  "src/components/vitrine/__tests__/*snapshot*.test.{ts,tsx}",
]

/** Extract the exclude: array string literals from the unit config TEXT. */
function unitExcludePatterns(): string[] {
  const src = fs.readFileSync(UNIT_CONFIG, "utf8")
  const m = src.match(/exclude:\s*\[([\s\S]*?)\],/)
  if (!m) {
    throw new Error(
      "unit-surface: exclude: block not found in vitest.config.unit.ts - update this extractor",
    )
  }
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1])
}

/** Extract the include: array string literals from the unit config TEXT. */
function unitIncludePatterns(): string[] {
  const src = fs.readFileSync(UNIT_CONFIG, "utf8")
  const m = src.match(/include:\s*\[([\s\S]*?)\],/)
  if (!m) {
    throw new Error(
      "unit-surface: include: block not found in vitest.config.unit.ts - update this extractor",
    )
  }
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1])
}

/**
 * True when a repo-root-relative test path survives BOTH the include globs
 * (at least one matches) AND the exclude patterns (none matches) - the
 * actual membership vitest computes for test:unit. The base of the sec
 * 11.83 presence pin.
 */
function survivesUnitSurface(rel: string, include: string[], exclude: string[]): boolean {
  return include.some((p) => picomatch(p)(rel)) && !exclude.some((p) => picomatch(p)(rel))
}

/**
 * Recursive walk of src/components INCLUDING __tests__/ dirs (unlike the
 * shared filesInDir, whose SKIP_DIRS excludes them) - the surface vitest's
 * include/exclude actually sees. Returns repo-root-relative POSIX paths.
 */
function componentTestFiles(): string[] {
  const out: string[] = []
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
      } else if (/\.test\.(ts|tsx)$/.test(entry.name)) {
        out.push(path.relative(ROOT, full).split(path.sep).join("/"))
      }
    }
  }
  walk(COMPONENTS_DIR)
  return out.sort()
}

/** Files that survive ALL exclude patterns (the test:unit included set). */
function includedBy(files: string[]): string[] {
  const patterns = unitExcludePatterns()
  return files.filter((f) => !patterns.some((p) => picomatch(p)(f))).sort()
}

// ---------------------------------------------------------------------------
// 1. Config contract - the exclude block itself
// ---------------------------------------------------------------------------

describe("unit surface - config exclude block", () => {
  it("declares EXACTLY the 5 pinned component patterns (+ node_modules/.next)", () => {
    const all = unitExcludePatterns()
    const component = all.filter((p) => p.startsWith("src/components/"))
    expect(component.sort()).toEqual([...PINNED_COMPONENT_PATTERNS].sort())
    expect(all).toContain("node_modules")
    expect(all).toContain(".next")
  })
})

// ---------------------------------------------------------------------------
// 2. Real-tree contract - what ACTUALLY runs in test:unit today
// ---------------------------------------------------------------------------

describe("unit surface - real component tree", () => {
  it("includes EXACTLY the deterministic vitrine suites", () => {
    // TENSION WITH THE GROWTH TEST (intentional): a NEW plain vitrine test
    // auto-joins test:unit (pinned by the mutation test below), so the day
    // one lands for real, THIS pin breaks loudly on purpose - update
    // EXPECTED_INCLUDED consciously, do not treat the break as a bug.
    const included = includedBy(componentTestFiles())
    expect(included).toEqual(EXPECTED_INCLUDED)
  })

  it("the deterministic files exist and carry the render smoke assertions", () => {
    const src = fs.readFileSync(path.join(ROOT, DETERMINISTIC), "utf8")
    // ASCII anchors on purpose: the describe name carries an em-dash glyph
    // in the source, but pinning that byte here would put non-ASCII in a
    // gate-file string AND break the day anyone ASCII-fies the describe.
    expect(src).toContain('describe("AddressAutocomplete')
    expect(src).toContain("rendering")
    expect(src).toContain("render(<AddressAutocomplete")

    const pc = fs.readFileSync(path.join(ROOT, PROVIDER_CARD), "utf8")
    expect(pc).toContain("ProviderCardSkeleton")
    expect(pc).toContain("renders without crashing")
  })
})

// ---------------------------------------------------------------------------
// 3. Mutation pins - the mechanism, not luck
// ---------------------------------------------------------------------------

describe("unit surface - mutation pins (mechanism)", () => {
  it("a NEW fuzz/a11y/accessibility/snapshot vitrine test stays OUT (suffix)", () => {
    const base = includedBy(componentTestFiles())
    for (const suffix of ["fuzz", "a11y", "accessibility", "snapshot"]) {
      const withVariant = includedBy([
        ...componentTestFiles(),
        `src/components/vitrine/__tests__/newcomp-${suffix}.test.tsx`,
      ])
      expect(withVariant).toEqual(base)
    }
  })

  it("a NEW plain vitrine test AUTO-JOINS test:unit (growth contract)", () => {
    const fresh = "src/components/vitrine/__tests__/newcomp.test.tsx"
    const withNew = includedBy([...componentTestFiles(), fresh])
    expect(withNew).toEqual([...EXPECTED_INCLUDED, fresh].sort())
  })

  it("a test in ANOTHER component tree stays OUT (!(vitrine) extglob)", () => {
    const base = includedBy(componentTestFiles())
    const withOther = includedBy([
      ...componentTestFiles(),
      "src/components/admin/__tests__/newadmin.test.tsx",
      "src/components/shared/__tests__/newshared.test.tsx",
    ])
    expect(withOther).toEqual(base)
  })
})

// ---------------------------------------------------------------------------
// 4. The silent-skip fix - pre-commit mapping vs the unit surface
// ---------------------------------------------------------------------------

describe("unit surface - pre-commit mapping (silent skip closed)", () => {
  it("mapping a vitrine component edit yields tests that are NOT excluded", () => {
    const mapped = collectTestFiles([
      "src/components/vitrine/address-autocomplete.tsx",
      "src/components/vitrine/provider-card.tsx",
    ])
    expect(mapped).toContain(DETERMINISTIC)
    expect(mapped).toContain(PROVIDER_CARD)
    const stillIncluded = includedBy(mapped)
    // Before the fix: the mapped tests were excluded -> "No test files
    // found" + --passWithNoTests = silent skip. Now they RUN.
    expect(stillIncluded).toEqual(mapped)
  })

  it("mapping a NON-vitrine component edit still skips (documented)", () => {
    const mapped = collectTestFiles(["src/components/admin/admin-dashboard.tsx"])
    expect(mapped.length).toBeGreaterThan(0)
    const stillIncluded = includedBy(mapped)
    // Admin tests stay excluded -> the mapping remains a silent skip there.
    // This is the DOCUMENTED residual (only vitrine is unit-visible); the
    // scan-surfaces.md section 7 calls it out explicitly.
    expect(stillIncluded).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 5. Self-containment - the import-order contract that makes the suite run
//    under unit config (where the vitrine setup is NOT a setupFile)
// ---------------------------------------------------------------------------

describe("unit surface - import order (self-containment)", () => {
  it("test-utils (mocks) is imported BEFORE the component", () => {
    const src = fs.readFileSync(path.join(ROOT, DETERMINISTIC), "utf8")
    const mockIdx = src.indexOf('from "./test-utils"')
    const compIdx = src.indexOf('from "../address-autocomplete"')
    expect(mockIdx).toBeGreaterThanOrEqual(0)
    expect(compIdx).toBeGreaterThan(mockIdx)
  })
})

// ---------------------------------------------------------------------------
// 6. The pool serialization note (singleFork) - WHY test:unit is serialized
// ---------------------------------------------------------------------------

/**
 * True when the config carries the dated singleFork rationale note (sec
 * 8.1 re-mediacao (5) + sec 11.48 no-op probe). The note is the guard
 * against a reader "fixing" the serialized pool believing parallelism is
 * lost - removing it must break a test, not silently drift.
 */
function poolNotePresent(src: string): boolean {
  const m = src.match(/\/\/ SERIALIZED POOL[\s\S]*?singleFork: true\s*}\s*},/)
  if (!m) return false
  return (
    m[0].includes("sec 8.1") &&
    m[0].includes("2026-08") &&
    m[0].includes('DO NOT "parallelize"')
  )
}

describe("unit surface - pool serialization note (singleFork)", () => {
  const CONFIG = fs.readFileSync(UNIT_CONFIG, "utf8")

  it("REAL-REPO: the config declares the serialized pool AND the dated note", () => {
    expect(CONFIG).toContain('pool: "forks"')
    expect(CONFIG).toContain("singleFork: true")
    expect(poolNotePresent(CONFIG)).toBe(true)
  })

  it("MUTATION: stripping the rationale note fails the pin (drift is loud)", () => {
    const noNote = CONFIG.replace(/\/\/ SERIALIZED POOL[\s\S]*?pool: "forks",/, 'pool: "forks",')
    expect(poolNotePresent(noNote)).toBe(false)
  })

  it("MUTATION: removing singleFork fails the pin (parallelism cannot return silently)", () => {
    // the literal appears TWICE (the note's backticked mention + the real
    // pool block) - target the BLOCK uniquely so the mutation hits the
    // decision, not the prose
    const noFork = CONFIG.replace("singleFork: true } },", "singleFork: false } },")
    expect(poolNotePresent(noFork)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 7. The PRESENCE of the contract suites in the test:unit glob (sec 11.83 -
//    the positive of 11.73 on the OTHER side of the division)
// ---------------------------------------------------------------------------

/**
 * The contract suites that MUST run in test:unit (sec 11.83): the proof
 * helpers (hook-proof-run, ci-proof-run, guard-remeasure) and their guard
 * contracts (proof-helpers-contract, wired-guards-contract, proofs-manifest,
 * scan-exit-claims, check-exit-claims-push, scan-cures-contract,
 * unit-surface-contract, gates-proofs-ordering). The sec 11.73 negative pins
 * they are NOT in test:guard (the curated 14); this pin closes the pair -
 * they MUST be PRESENT in the test:unit glob channel (the local guard
 * channel the pre-commit/pre-push hooks run). A refactor that adds an
 * exclude for one of them, or narrows the scripts glob, silently drops the
 * contract suite from every local guard run - this pin fails LOUDLY there.
 * The list is a projection snapshot (the ABS PIN pattern): adding a new
 * contract suite must edit this list consciously.
 */
const TEST_UNIT_CONTRACT_PIN = [
  "scripts/__tests__/check-exit-claims-push.test.ts",
  "scripts/__tests__/ci-proof-run.test.ts",
  "scripts/__tests__/gates-proofs-ordering.test.ts",
  "scripts/__tests__/guard-remeasure.test.ts",
  "scripts/__tests__/hook-proof-run.test.ts",
  "scripts/__tests__/proof-helpers-contract.test.ts",
  "scripts/__tests__/proofs-manifest.test.ts",
  "scripts/__tests__/scan-cures-contract.test.ts",
  "scripts/__tests__/scan-exit-claims.test.ts",
  "scripts/__tests__/unit-surface-contract.test.ts",
  "scripts/__tests__/wired-guards-contract.test.ts",
]

describe("unit surface - contract-suite PRESENCE in the test:unit glob (sec 11.83, the positive of 11.73)", () => {
  it("REAL-REPO: TODAS as suites de contrato do pin estao PRESENTES na superficie test:unit (o include casa + nenhum exclude derruba - o canal local dos guards)", () => {
    const include = unitIncludePatterns()
    const exclude = unitExcludePatterns()
    // A premissa base: o glob de scripts existe no include (a parte que o
    // scan-guard-gates ja pina na 11.73, aqui re-derivada do TEXTO do config).
    expect(include).toContain("scripts/**/*.test.{ts,tsx}")
    // O pin de PRESENCA: cada suite de contrato sobrevive include + exclude -
    // a derivacao de fato do que vitest roda em test:unit (o mesmo motor
    // picomatch da secao 2, aplicado ao glob de scripts agora).
    for (const suite of TEST_UNIT_CONTRACT_PIN) {
      expect(survivesUnitSurface(suite, include, exclude), suite).toBe(true)
    }
    // A PRESENCA LITERAL: o arquivo da suite EXISTE no repo (o pin e sobre
    // uma suite que roda, nao sobre um padrao que casaria um caminho
    // inexistente - uma entrada stale do pin (suite deletada/renomeada)
    // falha aqui, nao so o glob).
    for (const suite of TEST_UNIT_CONTRACT_PIN) {
      expect(fs.existsSync(path.join(ROOT, suite)), `${suite}: arquivo ausente no repo`).toBe(true)
    }
  })

  it("MUTATION: um exclude novo para uma suite de contrato DERRUBA a suite do canal -> o pin falha (a classe: adicionar um exclude que silencia uma suite de contrato local)", () => {
    const include = unitIncludePatterns()
    const exclude = [...unitExcludePatterns(), "scripts/__tests__/hook-proof-run.test.ts"]
    expect(
      survivesUnitSurface("scripts/__tests__/hook-proof-run.test.ts", include, exclude),
    ).toBe(false)
  })

  it("MUTATION: estreitar o glob de scripts (remover o include scripts) DERRUBA TODAS as suites de contrato -> o pin falha (a classe: o glob do canal nunca encolhe)", () => {
    const include = unitIncludePatterns().filter((p) => !p.includes("scripts"))
    const exclude = unitExcludePatterns()
    for (const suite of TEST_UNIT_CONTRACT_PIN) {
      expect(survivesUnitSurface(suite, include, exclude), suite).toBe(false)
    }
  })
})

