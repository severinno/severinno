/**
 * run-all-fuzz.test.ts - suite do runner batchado (secao 11.12 do
 * gates-proofs.md, 2026-08-10): scripts/run-all-fuzz.mjs agora executa as 6
 * suites fuzz em UMA invocacao vitest (~15s vs ~60s de 6 spawns) e re-splita
 * o doc JSON unico em docs por-suite no formato antigo do formatter.
 *
 * O QUE ESTA TRAVADO AQUI:
 *  1. SPLITTER (splitPerSuiteResults): o re-split preserva o shape do
 *     formatter por suite - numTotalTests/numPassedTests/numFailedTests
 *     contados dos assertionResults da suite, duration = endTime-startTime
 *     (o doc unico do vitest 3.1.1 NAO tem duration no top-level),
 *     testResults:[suite] intacto. Suite vazia = doc zero, nunca crash.
 *  2. REAL-REPO CONTRACT: o runner real com --only (1 suite) sai exit 0 e
 *     emite no stdout (--json) um ARRAY com 1 entrada shape-identica a do
 *     runner antigo - provando a fiação spawn->split->formatter sem rodar as
 *     6 suites (~6s vs ~15s).
 *
 * Hermetico: os testes de split sao puros (sem fs, sem spawn); o contract
 * spawna o CLI real via runSubprocess. Subprocess-heavy -> timeout explicito
 * em todo it().
 */
import { afterEach, describe, expect, it } from "vitest"
import path from "node:path"
import { cleanupTempDirs, runSubprocess } from "./golden-copy-utils"
import { splitPerSuiteResults } from "../run-all-fuzz.mjs"

const RUNNER = path.resolve(process.cwd(), "scripts", "run-all-fuzz.mjs")

// The splitter is JS (mjs) — no type inference across the boundary, so the
// synthetic fixtures carry explicit structural types (the vitest 3.1.1 JSON
// shape, only the fields the splitter/formatter read).
interface Assertion {
  fullName?: string
  title?: string
  status?: string
  duration?: number
}

interface Suite {
  name?: string
  status?: string
  startTime?: number
  endTime?: number
  assertionResults?: Assertion[]
}

/** Synthetic vitest JSON doc (the shape vitest 3.1.1 emits for a batch). */
function makeDoc(suites: Suite[]) {
  return {
    numTotalTestSuites: suites.length,
    numPassedTestSuites: suites.length,
    numFailedTestSuites: 0,
    numTotalTests: suites.reduce((n: number, s: Suite) => n + (s.assertionResults ?? []).length, 0),
    success: true,
    testResults: suites,
  }
}

function makeSuite(name: string, assertions: Assertion[]) {
  return {
    name,
    status: "passed",
    startTime: 1000,
    endTime: 2500,
    assertionResults: assertions,
  }
}

const PASS: Assertion = { fullName: "x > passes", title: "passes", status: "passed", duration: 10 }
const FAIL: Assertion = { fullName: "x > fails", title: "fails", status: "failed", duration: 20 }

describe("run-all-fuzz.mjs - splitPerSuiteResults (re-split do doc batchado no shape do formatter)", () => {
  afterEach(cleanupTempDirs)

  it("re-splita 2 suites em 2 docs com counts por suite e duration = endTime-startTime", () => {
    const doc = makeDoc([
      makeSuite("C:/repo/src/lib/__tests__/a-fuzz.test.ts", [PASS, PASS]),
      makeSuite("C:/repo/src/lib/__tests__/b-fuzz.test.ts", [PASS, FAIL]),
    ])
    const out = splitPerSuiteResults(doc)
    expect(out.length).toBe(2)
    expect(out[0]).toMatchObject({ numTotalTests: 2, numPassedTests: 2, numFailedTests: 0, duration: 1500 })
    expect(out[1]).toMatchObject({ numTotalTests: 2, numPassedTests: 1, numFailedTests: 1, duration: 1500 })
    // the suite entry itself is preserved untouched (the formatter reads
    // assertionResults from testResults[0])
    expect(out[1].testResults[0]).toEqual(doc.testResults[1])
  }, 60000)

  it("doc sem testResults -> [] (nunca crash)", () => {
    expect(splitPerSuiteResults({})).toEqual([])
    expect(splitPerSuiteResults(undefined)).toEqual([])
    expect(splitPerSuiteResults({ testResults: [] })).toEqual([])
  }, 60000)

  it("duration nunca negativa (endTime ausente/atrasado -> 0, nao negativo)", () => {
    const doc = makeDoc([
      {
        name: "C:/repo/src/lib/__tests__/no-times-fuzz.test.ts",
        status: "passed",
        assertionResults: [PASS],
      },
      {
        name: "C:/repo/src/lib/__tests__/neg-fuzz.test.ts",
        status: "passed",
        startTime: 3000,
        endTime: 1000,
        assertionResults: [PASS],
      },
    ])
    const out = splitPerSuiteResults(doc)
    expect(out[0].duration).toBe(0)
    expect(out[1].duration).toBe(0)
  }, 60000)

  it("suite sem assertionResults -> counts zero (suite vazia)", () => {
    const doc = makeDoc([
      { name: "C:/repo/src/lib/__tests__/empty-fuzz.test.ts", status: "passed", startTime: 1, endTime: 2, assertionResults: [] },
    ])
    const out = splitPerSuiteResults(doc)
    expect(out[0]).toMatchObject({ numTotalTests: 0, numPassedTests: 0, numFailedTests: 0 })
  }, 60000)

  it("REAL-REPO CONTRACT: runner real --only (1 suite) sai 0 e emite o ARRAY shape do formatter (spawn->split->formatter)", () => {
    const r = runSubprocess({
      command: process.execPath,
      args: [RUNNER, "--only", "radius-expansion", "--json"],
    })
    expect(r.status).toBe(0)
    let parsed
    try {
      parsed = JSON.parse(r.stdout)
    } catch {
      expect.fail(`stdout nao e JSON valido: ${r.stdout.slice(0, 200)}`)
    }
    // the CI contract: fuzz:ci > fuzz-results.json is an ARRAY of per-suite
    // results with the exact formatter shape
    expect(Array.isArray(parsed)).toBe(true)
    expect(parsed.length).toBe(1)
    expect(parsed[0]).toMatchObject({
      file: expect.stringContaining("radius-expansion"),
      numFailedTests: 0,
    })
    expect(typeof parsed[0].numTotalTests).toBe("number")
    expect(Array.isArray(parsed[0].tests)).toBe(true)
  }, 120000)
})
