/**
 * Unit tests for the barrel-lint pure helpers — CRLF line-ending tolerance.
 *
 * `.gitattributes` has `* text=auto`, so on Windows checkouts source files
 * land on disk as CRLF. The bundle-report bug proved the failure mode: a
 * line split on "\n" keeps its trailing "\r", and any regex anchored to the
 * END of the line silently never matches. hasMinimalHeader / hasViolation
 * must therefore tolerate CRLF content — these tests lock that behavior.
 *
 * Covered scenarios:
 *   1. hasMinimalHeader detects "Usage:" + "Exit code" in a CRLF header
 *   2. hasMinimalHeader still works on LF (control — no false positive from
 *      the CRLF tolerance)
 *   3. hasMinimalHeader rejects content missing the sections (CRLF)
 *   4. hasViolation flags a forbidden barrel import on a CRLF line
 *   5. hasViolation ignores commented CRLF lines
 *   6. hasViolation still flags on LF (control)
 */
import { describe, it, expect } from "vitest"
import { hasMinimalHeader, hasViolation } from "../barrel-lint.mjs"

describe("barrel-lint CRLF tolerance", () => {
  it("hasMinimalHeader detects Usage + Exit code in a CRLF header", () => {
    const crlf =
      "#!/usr/bin/env node\r\n" +
      "/**\r\n" +
      " * Usage:\r\n" +
      " *   node scripts/foo.mjs\r\n" +
      " *\r\n" +
      " * Exit code:\r\n" +
      " *   0 - ok\r\n" +
      " */\r\n"
    expect(hasMinimalHeader(crlf)).toBe(true)
  })

  it("hasMinimalHeader still works on LF content (control)", () => {
    const lf =
      "#!/usr/bin/env node\n" +
      "/**\n" +
      " * Usage:\n" +
      " *   node scripts/foo.mjs\n" +
      " *\n" +
      " * Exit code:\n" +
      " *   0 - ok\n" +
      " */\n"
    expect(hasMinimalHeader(lf)).toBe(true)
  })

  it("hasMinimalHeader rejects CRLF content missing the sections", () => {
    const crlf = "#!/usr/bin/env node\r\n// no Usage or Exit code here\r\n"
    expect(hasMinimalHeader(crlf)).toBe(false)
  })

  it("hasViolation flags a forbidden barrel import on a CRLF line", () => {
    const crlf = 'import { x } from "@/lib/distance-fallback"\r\n'
    expect(hasViolation(crlf)).toBe(true)
  })

  it("hasViolation ignores commented CRLF lines", () => {
    const crlf = '// import { x } from "@/lib/distance-fallback"\r\n'
    expect(hasViolation(crlf)).toBe(false)
  })

  it("hasViolation still flags on LF (control)", () => {
    const lf = 'import { x } from "@/lib/distance-fallback"\n'
    expect(hasViolation(lf)).toBe(true)
  })
})
