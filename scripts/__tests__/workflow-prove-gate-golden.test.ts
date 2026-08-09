/**
 * Golden-copy guard for the LAST embedded assert program in the workflows —
 * the 'Prove budget gate blocks (zeroed budgets)' step of ci.yml (job
 * `budget`). This is the CI smoke test that proves check-js-budget REALLY
 * blocks: it re-runs the gate with zeroed budgets and asserts the failure
 * came from the expected checks (exit 1 on total AND real-transfer), failing
 * the job if the gate passes (exit 0), fails for the wrong reason (exit 2 =
 * report missing), or misses either check message.
 *
 * Same pattern as release-assert-route-gate.test.ts: the program is EXTRACTED
 * FROM THE WORKFLOW at test time (js-yaml — single source of truth), compared
 * canonically against a versioned golden copy (fixtures/ci-prove-budget-gate.sh
 * — edit one without the other → fail), and run BEHAVIORALLY through a `node()`
 * bash function mock that simulates `node scripts/check-js-budget.mjs` with a
 * controllable exit code + output per mode — covering ALL 5 assert paths:
 *
 *   - exit0    → gate "passed" → must exit 1 "not blocking!"
 *   - exit2    → report missing → must exit 1 "exit 2 (report not found)"
 *   - no-total → exit 1 without the total-size message → must exit 1
 *   - no-real  → exit 1 without the real-transfer message → must exit 1
 *   - ok       → exit 1 with BOTH messages → must exit 0 "Gate proof OK"
 *
 * The node mock is a bash FUNCTION (no PATH games, no real node, no network):
 * the extracted program's only external command is `node scripts/check-js-budget.mjs`
 * inside $(...), so a function of the same name intercepts it — same technique
 * as the curl/seq/sleep/docker shims in the health-check suite.
 *
 * Covered:
 *   - extraction wiring (step found, key markers present)
 *   - divergence guard (canonical form, diagnostics before the expect)
 *   - behavioral: all 5 assert paths behave as the workflow intends
 *   - parity: golden copy behaves IDENTICALLY to the workflow program
 *     across the 5-mode matrix (same exit code in every case)
 */
import { describe, it, expect } from "vitest"
import fs from "node:fs"
import path from "node:path"

// js-yaml has no @types in this repo (see release-assert-route-gate.test.ts).
// @ts-expect-error js-yaml is untyped in this repo; only yaml.load is used
import yaml from "js-yaml"
import { canonicalProgram, normalizeCrlf, runSubprocess } from "./golden-copy-utils"

const CI_WF = path.resolve(process.cwd(), ".github", "workflows", "ci.yml")
const GOLDEN = path.resolve(process.cwd(), "scripts", "__tests__", "fixtures", "ci-prove-budget-gate.sh")

/** Extract the ci.yml 'Prove budget gate blocks' run block (source of truth). */
function extractProveGateProgram(): string {
  const doc = yaml.load(fs.readFileSync(CI_WF, "utf8")) as {
    jobs?: { budget?: { steps?: Array<{ name?: string; run?: string }> } }
  }
  const step = (doc.jobs?.budget?.steps ?? []).find((s) => (s.name ?? "").includes("Prove budget gate blocks"))
  if (!step?.run) {
    throw new Error("step 'Prove budget gate blocks' not found in ci.yml — a rename broke this test's wiring")
  }
  return step.run.replace(/\r\n/g, "\n")
}

type NodeMode = "exit0" | "exit2" | "no-total" | "no-real" | "ok"

interface RunResult {
  status: number | null
  stdout: string
}

/**
 * Run the extracted/golden prove-gate program through `bash -c` with a
 * `node()` FUNCTION mock (no PATH games, no real node). The mock answers the
 * only external command the program runs (`node scripts/check-js-budget.mjs`)
 * with a configurable exit code + output per mode:
 *
 *   exit0    → "Total client bundle…" + "real: /…" on stdout, exit 0
 *   exit2    → "report not found" on stderr, exit 2
 *   no-total → only the real-transfer line, exit 1
 *   no-real  → only the total line, exit 1
 *   ok       → BOTH lines, exit 1 (the gate failing for the right reason)
 *
 * CRLF-tolerant: the golden copy is read RAW from disk; on a Windows checkout
 * (* text=auto → CRLF) a `\r` would break bash parsing, so normalize first
 * (shared normalizeCrlf from golden-copy-utils).
 */
function runProveGateProgram(program: string, mode: NodeMode): RunResult {
  const normalized = normalizeCrlf(program)
  const nodeMock = [
    "node() {",
    '  case "$SHIM_NODE_MODE" in',
    "    exit0)",
    '      echo "Total client bundle 999.9 KB > budget 1 KB"',
    '      echo "real: / transfer 888.8 KB > budget 1 KB"',
    "      return 0",
    "      ;;",
    "    exit2)",
    '      echo "check-js-budget: analyze report missing" >&2',
    "      return 2",
    "      ;;",
    "    no-total)",
    '      echo "real: / transfer 888.8 KB > budget 1 KB"',
    "      return 1",
    "      ;;",
    "    no-real)",
    '      echo "Total client bundle 999.9 KB > budget 1 KB"',
    "      return 1",
    "      ;;",
    "    ok)",
    '      echo "Total client bundle 999.9 KB > budget 1 KB"',
    '      echo "real: / transfer 888.8 KB > budget 1 KB"',
    "      return 1",
    "      ;;",
    "  esac",
    "}",
  ].join("\n")
  const r = runSubprocess({
    command: "bash",
    args: ["-c", `${nodeMock}\n${normalized}`],
    env: { SHIM_NODE_MODE: mode },
  })
  return { status: r.status, stdout: r.stdout }
}

describe("workflow golden copy — ci.yml 'Prove budget gate blocks' (node mock, 5 assert paths)", () => {
  it("extracts the run block from the budget job (source-of-truth wiring)", () => {
    const p = extractProveGateProgram()
    expect(p).toContain("set +e")
    expect(p).toContain("out=$(node scripts/check-js-budget.mjs 2>&1)")
    expect(p).toContain("grep -q \"Total client bundle.*> budget 1 KB\"")
    expect(p).toContain("grep -qE \"real: /.* transfer.*> budget 1 KB\"")
    expect(p).toContain("Gate proof OK")
  })

  it("DIVERGENCE GUARD: the workflow program never diverges from the golden copy", () => {
    const extracted = extractProveGateProgram()
    const golden = fs.readFileSync(GOLDEN, "utf8")
    const cEx = canonicalProgram(extracted)
    const cGo = canonicalProgram(golden)
    // Diagnostics BEFORE the expect — expect().toBe() throws on a mismatch, so
    // a dump after it would be unreachable dead code.
    if (cEx !== cGo) {
      console.error(
        "\nDIVERGÊNCIA prove-gate (ci.yml):\n--- extraído do workflow ---\n" +
          cEx +
          "\n--- golden copy (fixtures/ci-prove-budget-gate.sh) ---\n" +
          cGo,
      )
    }
    expect(cEx).toBe(cGo)
  })

  it("BEHAVIORAL exit0: gate 'passed' with zeroed budgets → must fail with 'not blocking!'", () => {
    const r = runProveGateProgram(extractProveGateProgram(), "exit0")
    expect(r.status).toBe(1)
    expect(r.stdout).toContain("Budget gate PASSED with zeroed budgets")
    expect(r.stdout).toContain("the gate is not blocking!")
  })

  it("BEHAVIORAL exit2: report missing → must fail with 'exit 2 (report not found)'", () => {
    const r = runProveGateProgram(extractProveGateProgram(), "exit2")
    expect(r.status).toBe(1)
    expect(r.stdout).toContain("failed with exit 2 (report not found)")
  })

  it("BEHAVIORAL no-total: failed without the total-size message → must fail as inconclusive", () => {
    const r = runProveGateProgram(extractProveGateProgram(), "no-total")
    expect(r.status).toBe(1)
    expect(r.stdout).toContain("not on the total-size check")
  })

  it("BEHAVIORAL no-real: failed without the real-transfer message → must fail as inconclusive", () => {
    const r = runProveGateProgram(extractProveGateProgram(), "no-real")
    expect(r.status).toBe(1)
    expect(r.stdout).toContain("not on a real-transfer check")
  })

  it("BEHAVIORAL ok: exit 1 with BOTH check messages → must exit 0 'Gate proof OK'", () => {
    const r = runProveGateProgram(extractProveGateProgram(), "ok")
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("✅ Gate proof OK")
    expect(r.stdout).toContain("budget check exited 1 with zeroed budgets")
  })

  it(
    "golden copy behaves IDENTICALLY to the workflow program across the 5-mode matrix",
    // 5 modes × 2 programs = 10 bash spawns (each ~0.5-1s on Windows Git Bash)
    // — well past the 5s vitest default, so grant an explicit timeout.
    () => {
      const extracted = extractProveGateProgram()
      const golden = fs.readFileSync(GOLDEN, "utf8")
      const modes: NodeMode[] = ["exit0", "exit2", "no-total", "no-real", "ok"]
      for (const mode of modes) {
        const w = runProveGateProgram(extracted, mode)
        const g = runProveGateProgram(golden, mode)
        // The golden copy must pass/fail exactly like the workflow program:
        // same exit code AND the same signal line (the ::error:: or the
        // Gate-proof message) — not just same status, same decision.
        const signal = (s: string) => s.split("\n").find((l) => l.includes("::error::") || l.includes("Gate proof")) ?? ""
        expect(g.status).toBe(w.status)
        expect(signal(g.stdout)).toBe(signal(w.stdout))
      }
    },
    30_000,
  )
})
