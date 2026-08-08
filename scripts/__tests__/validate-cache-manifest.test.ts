/**
 * Unit tests for the validate-cache-manifest pure helpers — CRLF line-ending
 * tolerance (the same `.gitattributes text=auto` failure mode the bundle-report
 * fix addressed: a line split on "\n" keeps its trailing "\r", breaking any
 * `$`-anchored or end-of-line-sensitive parsing).
 *
 * extractTtlFromFile and PUBLIC_CACHE_CONTROL_FORMAT are exported pure; the
 * CLI flow (main) runs only when the script is the entry point, so importing
 * it in vitest has no side effects (no route scan).
 *
 * Covered scenarios:
 *   1. Simple cacheControlPublic call parsed from CRLF route content
 *   2. Wrapped NextResponse.json form parsed from CRLF content
 *   3. cacheControlPrivate parsed from CRLF content
 *   4. Header format regex matches a CRLF cacheControlPublic body
 *   5. LF control — same body still matches (no false positive)
 */
import { describe, it, expect } from "vitest"
import { extractTtlFromFile, PUBLIC_CACHE_CONTROL_FORMAT } from "../validate-cache-manifest"

describe("validate-cache-manifest CRLF tolerance", () => {
  it("extractTtlFromFile parses a simple cacheControlPublic from CRLF content", () => {
    const crlf = "export async function GET() {\r\n  return cacheControlPublic(res, 120, 600)\r\n}\r\n"
    const ttl = extractTtlFromFile(crlf, "/api/test")
    expect(ttl).toEqual({ type: "public", maxAge: 120, sMaxage: 600 })
  })

  it("extractTtlFromFile parses the wrapped NextResponse.json form from CRLF content", () => {
    const crlf =
      "export async function GET() {\r\n" +
      "  return cacheControlPublic(\r\n" +
      "    NextResponse.json({ ok: true }),\r\n" +
      "    120,\r\n" +
      "    600\r\n" +
      "  )\r\n" +
      "}\r\n"
    const ttl = extractTtlFromFile(crlf, "/api/test")
    expect(ttl).toEqual({ type: "public", maxAge: 120, sMaxage: 600 })
  })

  it("extractTtlFromFile parses cacheControlPrivate from CRLF content", () => {
    const crlf = "export async function GET() {\r\n  return cacheControlPrivate(res, 120)\r\n}\r\n"
    const ttl = extractTtlFromFile(crlf, "/api/test")
    expect(ttl).toEqual({ type: "private", maxAge: 120, sMaxage: null })
  })

  it("PUBLIC_CACHE_CONTROL_FORMAT matches a CRLF cacheControlPublic body", () => {
    // The directive lives in ONE place (src/lib/api-server.ts) — a CRLF
    // checkout must not make this format check silently pass/fail on Windows.
    const crlfBody =
      "export function cacheControlPublic(res, maxAge, swr) {\r\n" +
      "  res.headers.set(\r\n" +
      '    "Cache-Control",\r\n' +
      "    `public, max-age=${maxAge}, s-maxage=${swr}, stale-while-revalidate=${swr}`,\r\n" +
      "  )\r\n" +
      "}\r\n"
    expect(PUBLIC_CACHE_CONTROL_FORMAT.test(crlfBody)).toBe(true)
  })

  it("PUBLIC_CACHE_CONTROL_FORMAT still matches the LF body (control)", () => {
    const lfBody =
      "export function cacheControlPublic(res, maxAge, swr) {\n" +
      '  res.headers.set(\n    "Cache-Control",\n    `public, max-age=${maxAge}, s-maxage=${swr}, stale-while-revalidate=${swr}`,\n  )\n' +
      "}\n"
    expect(PUBLIC_CACHE_CONTROL_FORMAT.test(lfBody)).toBe(true)
  })
})
