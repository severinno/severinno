/**
 * scan-yaml-scalars.test.ts — regression guard for the YAML plain-scalar
 * landmine class (the bug that broke the Summary step in 2026-08).
 *
 * A `name:`/`run:` value written as an UNQUOTED plain scalar must not
 * contain `: ` (colon+space) or ` #` (space+hash):
 *   - `: ` splits the line into a nested mapping -> js-yaml throws
 *     (hard parse break, whole workflow fails)
 *   - ` #` starts a comment -> the value is SILENTLY truncated (no error,
 *     the workflow stays green while the name/command is shortened)
 * Both break CI in different ways; both are hunted by
 * scripts/scan-yaml-scalars.mjs (see its header for the full rationale).
 *
 * What this suite guards:
 *   1. REPO-WIDE — zero candidates and zero parse errors across every
 *      .github/workflows/*.yml + every composite action.yml under
 *      .github/actions/ (the class is closed TODAY; this pins that state
 *      for every PR).
 *   2. MUTATIONS — each detection path genuinely bites:
 *      a. `: ` in a plain run: value -> candidate (' : ' issue)
 *      b. `: ` in a plain name: value -> candidate
 *      c. ` #` in a plain run: value -> candidate (' #' silent truncation)
 *      d. quoted value with `: ` -> NOT flagged (safe form)
 *      e. block-scalar content with `: ` -> NOT flagged (safe form)
 *      f. colon NOT followed by space (12:30, http://host:8080, C:\path)
 *         or a value ENDING in a bare ':' (echo value:) -> NOT flagged
 *         (the false-positive guard)
 *      g. hard parse error surfaces as parseError (exit 2 class)
 */
import { describe, it, expect } from "vitest"
import fs from "node:fs"
import path from "node:path"
import {
  findPlainScalarCandidates,
  scanYamlContent,
  scanYamlFiles,
  defaultYamlPaths,
} from "../scan-yaml-scalars.mjs"

const ROOT = process.cwd()

/** All repo workflows + composite actions (the CLI default surface). */
function repoYamlPaths(): string[] {
  return defaultYamlPaths().map((p) => path.relative(ROOT, p).replace(/\\/g, "/"))
}

describe("scan-yaml-scalars — YAML plain-scalar landmine guard", () => {
  it("REPO-WIDE: no workflow or composite action carries a ': ' or ' #' plain-scalar candidate", () => {
    const reports = scanYamlFiles(defaultYamlPaths())
    const offenders: string[] = []
    for (const r of reports) {
      if (r.parseError) {
        offenders.push(`${path.relative(ROOT, r.path)}: PARSE ERROR — ${r.parseError}`)
      }
      for (const c of r.candidates) {
        for (const issue of c.issues) {
          offenders.push(`${path.relative(ROOT, r.path)}:${c.line}: ${c.key} '${c.value}' -> ${issue}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it("REPO-WIDE: the default scan surface actually covers every workflow + composite", () => {
    const files = repoYamlPaths()
    const wf = fs.readdirSync(path.join(ROOT, ".github", "workflows")).filter((f) => f.endsWith(".yml"))
    expect(files.length).toBeGreaterThanOrEqual(wf.length + 2) // 2 composite actions
    for (const f of wf) {
      expect(files).toContain(`.github/workflows/${f}`)
    }
    expect(files).toContain(".github/actions/severinno-ssh/action.yml")
    expect(files).toContain(".github/actions/severinno-scp/action.yml")
  })

  it("MUTATION: ': ' in a plain run: value is flagged (hard parse break class)", () => {
    const content = "steps:\n  - name: step\n    run: echo value: with colon\n"
    const hits = findPlainScalarCandidates(content)
    expect(hits).toHaveLength(1)
    expect(hits[0].key).toBe("run")
    expect(hits[0].issues.some((i) => i.includes("': '"))).toBe(true)
  })

  it("MUTATION: ': ' in a plain name: value is flagged (the 2026-08 Summary bug class)", () => {
    const content = "steps:\n  - name: strict: every check\n    run: echo hi\n"
    const hits = findPlainScalarCandidates(content)
    expect(hits).toHaveLength(1)
    expect(hits[0].key).toBe("name")
    expect(hits[0].issues.some((i) => i.includes("': '"))).toBe(true)
  })

  it("MUTATION: ' #' in a plain run: value is flagged (silent truncation class)", () => {
    const content = "steps:\n  - name: step\n    run: echo hi # comment swallows the rest\n"
    const hits = findPlainScalarCandidates(content)
    expect(hits).toHaveLength(1)
    expect(hits[0].key).toBe("run")
    expect(hits[0].issues.some((i) => i.includes("' #'"))).toBe(true)
  })

  it("SAFE: a QUOTED value containing ': ' is NOT flagged", () => {
    const content = 'steps:\n  - name: "step"\n    run: "echo value: with colon"\n'
    expect(findPlainScalarCandidates(content)).toEqual([])
  })

  it("SAFE: BLOCK-SCALAR content containing ': ' and ' #' is NOT flagged", () => {
    const content = [
      "steps:",
      "  - name: step",
      "    run: |",
      "      echo value: inside block", // ': ' safe inside literal block
      "      echo hi # inside block", // ' #' safe inside literal block
    ].join("\n")
    expect(findPlainScalarCandidates(content)).toEqual([])
  })

  it("SAFE: BLOCK-SCALAR with explicit indent + chomp modifiers (|2-) is NOT flagged", () => {
    // YAML allows the explicit-indentation digit BEFORE the chomping
    // indicator (`|2-`, `|2+`) — the opener regex must not under-detect
    // these, or real block content would be scanned as plain scalars.
    // Two separate steps (a step cannot carry two run: keys — the fixture
    // must stay valid YAML so a future refactor to scanYamlContent keeps
    // passing): literal |2- and folded >2+ both with explicit indent + chomp.
    const content = [
      "steps:",
      "  - name: literal",
      "    run: |2-",
      "      echo value: inside block", // ': ' safe inside literal block
      "      echo hi # inside block", // ' #' safe inside literal block
      "  - name: folded",
      "    run: >2+",
      "      echo another: value", // same for the folded variant
    ].join("\n")
    expect(findPlainScalarCandidates(content)).toEqual([])
  })

  it("SAFE: colons NOT followed by space (times, URLs, Windows paths) are NOT flagged", () => {
    const content = [
      "steps:",
      "  - name: step at 12:30", // time — colon followed by digit
      "    run: curl http://host:8080/api", // URL — colon followed by non-space
      "  - name: windows C:\\path\\x", // backslash — no ': ' sequence
    ].join("\n")
    expect(findPlainScalarCandidates(content)).toEqual([])
  })

  it("SAFE: a value ending in a bare ':' (valid YAML, no space after) is NOT flagged", () => {
    // A plain scalar may end with ':' in block context — the spec only
    // excludes ':' followed by space or '#'. Flagging it would be a false
    // positive on legitimate run:/name: values (e.g. a shell token `foo:`).
    // Two separate steps (a step cannot carry two run: keys).
    const content = [
      "steps:",
      "  - name: step a",
      "    run: grep -q marker: file", // ':' followed by space IS still the landmine
      "  - name: step b",
      "    run: echo value:", // trailing colon — valid, NOT flagged
    ].join("\n")
    const hits = findPlainScalarCandidates(content)
    expect(hits).toHaveLength(1) // only the ': ' case
    expect(hits[0].value).toContain("grep -q marker:")
  })

  it("PARSE ERROR: a hard YAML break surfaces as parseError (exit 2 class)", () => {
    const { parseError } = scanYamlContent("steps:\n  - name: strict: every\n")
    expect(parseError).not.toBeNull()
  })
})
