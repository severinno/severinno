/**
 * scan-non-ascii.test.ts — unit tests for scripts/scan-non-ascii.mjs, the
 * reusable non-ASCII byte scanner that encoding gates must use instead of
 * hand-rolled grep character-class ranges (the `[^ -~]` range failed
 * SILENTLY in this repo and let an em-dash slip into a VPS-bound .sh).
 *
 * The core promise this suite pins: byte iteration is immune to the broken
 * range AND to locale — `LC_ALL=C` (which gates commonly force) must not
 * change the verdict. The MUTATION test proves the failure mode is closed:
 * a clean ASCII fixture, one injected byte >= 0x80, and the scanner finds
 * it with exact offset/line/col — exactly what the broken grep missed.
 *
 * Exported pure functions are imported directly (same pattern as
 * pre-commit-tests.test.ts); the CLI is exercised via subprocess (same
 * pattern as check-js-budget.test.ts) to pin exit codes end-to-end.
 */
import { describe, it, expect, afterEach } from "vitest"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { findNonAsciiOffsets, scanFile, scanFiles } from "../scan-non-ascii.mjs"

const SCRIPT = path.resolve(process.cwd(), "scripts", "scan-non-ascii.mjs")

const tempDirs: string[] = []
afterEach(() => {
  for (const d of tempDirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true })
  }
})

function tmpFile(name: string, content: string | Buffer): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scan-non-ascii-"))
  tempDirs.push(dir)
  const p = path.join(dir, name)
  fs.writeFileSync(p, content)
  return p
}

/** Run the CLI against files; returns status + stdout (+ optional env). */
function runCli(files: string[], env: Record<string, string> = {}) {
  return spawnSync(process.execPath, [SCRIPT, ...files], {
    env: { ...process.env, ...env },
    encoding: "utf8",
    timeout: 30_000,
  })
}

const ASCII_SH = "#!/usr/bin/env bash\necho 'ok'\n"

describe("scripts/scan-non-ascii.mjs", () => {
  it("findNonAsciiOffsets: pure ASCII buffer yields no offsets", () => {
    expect(findNonAsciiOffsets(Buffer.from(ASCII_SH, "utf8"))).toEqual([])
  })

  it("findNonAsciiOffsets: flags every byte >= 0x80 (UTF-8 em-dash = 3 bytes)", () => {
    const buf = Buffer.from("echo 'olá — ok'\n", "utf8")
    // á = 2 bytes, — = 3 bytes, both >= 0x80 → 5 flagged offsets.
    expect(findNonAsciiOffsets(buf)).toHaveLength(5)
    expect(findNonAsciiOffsets(buf).every((o) => buf[o] >= 0x80)).toBe(true)
  })

  it("findNonAsciiOffsets: single injected 0x97 byte is found (Windows-1252 em dash)", () => {
    const clean = Buffer.from(ASCII_SH, "utf8")
    const mutated = Buffer.from(clean)
    mutated[26] = 0x97 // overwrite 'o' of 'ok' (line 2, col 7) with a raw 0x97 byte
    const offsets = findNonAsciiOffsets(mutated)
    expect(offsets).toEqual([26])
    expect(mutated[offsets[0]]).toBe(0x97)
  })

  it("MUTATION: clean fixture passes, one injected byte flips scanFile to nonAscii with exact line/col", () => {
    const cleanPath = tmpFile("clean.sh", ASCII_SH)
    expect(scanFile(cleanPath).nonAscii).toBe(false)
    expect(scanFile(cleanPath).hits).toEqual([])

    // Mutate the exact byte the broken `[^ -~]` grep let through (0x97).
    const mutPath = tmpFile("mutated.sh", Buffer.from(ASCII_SH, "utf8"))
    const f = fs.readFileSync(mutPath)
    f[26] = 0x97
    fs.writeFileSync(mutPath, f)

    const r = scanFile(mutPath)
    expect(r.nonAscii).toBe(true)
    expect(r.hits).toEqual([{ offset: 26, line: 2, col: 7 }])
  })

  it("CLI: clean file exits 0 with no output", () => {
    const p = tmpFile("clean.sh", ASCII_SH)
    const r = runCli([p])
    expect(r.status).toBe(0)
    expect(r.stdout).toBe("")
  })

  it("CLI: mutated file exits 1 printing file:line:col", () => {
    const p = tmpFile("mutated.sh", Buffer.from(ASCII_SH, "utf8"))
    const f = fs.readFileSync(p)
    f[26] = 0x97
    fs.writeFileSync(p, f)

    const r = runCli([p])
    expect(r.status).toBe(1)
    expect(r.stdout).toContain(`${p}:2:7`)
  })

  it("CLI: verdict is IMMUNE to LC_ALL=C (the locale that breaks grep ranges)", () => {
    const p = tmpFile("mutated.sh", Buffer.from(ASCII_SH, "utf8"))
    const f = fs.readFileSync(p)
    f[26] = 0x97
    fs.writeFileSync(p, f)

    const r = runCli([p], { LC_ALL: "C" })
    expect(r.status).toBe(1)
    expect(r.stdout).toContain(`${p}:2:7`)
  })

  it("CLI: CRLF line endings still report the correct 1-based line", () => {
    // CRLF content — \r must NOT count as a line break (line 3, not 4).
    const content = "#!/usr/bin/env bash\r\necho 'x'\r\n# o\x97lha\r\n"
    const p = tmpFile("crlf.sh", content)
    const r = runCli([p])
    expect(r.status).toBe(1)
    expect(r.stdout).toContain(`${p}:3:`)
  })

  it("scanFiles: mixed batch reports the offender only, order preserved", () => {
    const clean = tmpFile("clean.sh", ASCII_SH)
    const dirty = tmpFile("dirty.sh", Buffer.from(ASCII_SH, "utf8"))
    const f = fs.readFileSync(dirty)
    f[26] = 0x97
    fs.writeFileSync(dirty, f)

    const results = scanFiles([clean, dirty])
    expect(results.map((r) => r.nonAscii)).toEqual([false, true])
    expect(results[1].hits[0].line).toBe(2)
  })

  it("CLI: missing file exits non-zero (read error surfaces, not silent)", () => {
    const missing = path.join(os.tmpdir(), `scan-non-ascii-missing-${Date.now()}`)
    const r = runCli([missing])
    expect(r.status).not.toBe(0)
  })

  it("CLI --report: clean batch exits 0 with one ASCII-OK line per file (tab-separated)", () => {
    const a = tmpFile("a.sh", ASCII_SH)
    const b = tmpFile("b.sh", ASCII_SH)

    const r = runCli(["--report", a, b])
    expect(r.status).toBe(0)
    expect(r.stdout).toBe(`ASCII-OK\t${a}\nASCII-OK\t${b}\n`)
  })

  it("CLI --report: dirty + missing in one batch exit 1 with per-file verdicts", () => {
    const dirty = tmpFile("dirty.sh", Buffer.from(ASCII_SH, "utf8"))
    const f = fs.readFileSync(dirty)
    f[26] = 0x97
    fs.writeFileSync(dirty, f)
    const missing = path.join(os.tmpdir(), `scan-non-ascii-missing2-${Date.now()}`)

    const r = runCli(["--report", dirty, missing])
    expect(r.status).toBe(1)
    expect(r.stdout).toContain(`VIOLATION\t${dirty}\t2:7`)
    expect(r.stdout).toContain(`ERROR\t${missing}`)
  })

  it("CLI --report: a path with spaces stays whole (tab separator, not space)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scan-non-ascii-sp-"))
    tempDirs.push(dir)
    const spaced = path.join(dir, "has space.sh")
    fs.writeFileSync(spaced, ASCII_SH)

    const r = runCli(["--report", spaced])
    expect(r.status).toBe(0)
    expect(r.stdout).toBe(`ASCII-OK\t${spaced}\n`)
  })
})
