/**
 * check-docs-encoding.test.ts — behavior tests for
 * scripts/check-docs-encoding.sh (the informational non-blocking UTF-8
 * corruption audit for the docs surface).
 *
 * The script is INFORMATIONAL (exit 0 always) — these tests prove:
 *   - Clean docs surface -> exit 0, no warnings
 *   - A corrupt byte (0x97) in a .md -> exit 0, INVALID-UTF8 in stdout,
 *     "[docs-encoding] WARNING" on stderr
 *   - Legitimate accents (UTF-8) -> exit 0, UTF8-OK, no warnings
 *
 * Fixtures are written to an isolated temp dir (shared temp-dir registry
 * from golden-copy-utils, cleaned in afterEach) so the suite never touches
 * real repo files.
 */
import { afterEach, describe, expect, it } from "vitest"
import fs from "node:fs"
import path from "node:path"
import { cleanupTempDirs, createTempDir, runSubprocess } from "./golden-copy-utils"

const SH_SCRIPT = path.join(process.cwd(), "scripts", "check-docs-encoding.sh")

/**
 * Run check-docs-encoding.sh against the given files.
 * The script always exits 0 (informational).
 */
function run(...filePaths: string[]): { stdout: string; stderr: string } {
  const r = runSubprocess({
    command: "bash",
    args: [SH_SCRIPT, ...filePaths],
  })
  return { stdout: r.stdout, stderr: r.stderr }
}

describe("check-docs-encoding.sh", () => {
  let tmpDir: string

  afterEach(() => {
    cleanupTempDirs()
  })

  it("bash -n (no syntax errors)", () => {
    const r = runSubprocess({ command: "bash", args: ["-n", SH_SCRIPT] })
    expect(r.status).toBe(0)
  })

  it("clean .md file -> exit 0, UTF8-OK, no warnings", () => {
    tmpDir = createTempDir("check-docs-encoding")
    const cleanMd = path.join(tmpDir, "clean.md")
    fs.writeFileSync(cleanMd, "# Hello World\n\nThis is pure ASCII.\n", "utf8")

    const { stdout, stderr } = run(cleanMd)
    expect(stdout).toContain("UTF8-OK")
    expect(stdout).toContain("clean.md")
    expect(stderr).not.toContain("WARNING")
  })

  it("clean .md with legitimate UTF-8 accents -> exit 0, UTF8-OK, no warnings", () => {
    tmpDir = createTempDir("check-docs-encoding")
    const accentMd = path.join(tmpDir, "accent.md")
    // Portuguese with legitimate UTF-8 encoded accents
    fs.writeFileSync(accentMd, "# Sobre\n\nAvaliação correta — acentos são UTF-8 válido.\n", "utf8")

    const { stdout, stderr } = run(accentMd)
    expect(stdout).toContain("UTF8-OK")
    expect(stdout).toContain("accent.md")
    expect(stderr).not.toContain("WARNING")
  })

  it("corrupt byte 0x97 in .md -> exit 0, INVALID-UTF8, WARNING on stderr (non-blocking)", () => {
    tmpDir = createTempDir("check-docs-encoding")
    const corruptMd = path.join(tmpDir, "corrupt.md")
    // Windows-1252 byte 0x97 (em dash) embedded in a draft line — a real
    // corruption scenario for this repo (the 2026-08 historico incident).
    const buf = Buffer.from("# Draft\n\nThis line has a 0x97 byte -> ", "utf8")
    fs.writeFileSync(corruptMd, Buffer.concat([buf, Buffer.from([0x97]), Buffer.from(" here.\n")]))

    const { stdout, stderr } = run(corruptMd)
    // Should detect the invalid sequence — 0x97 is a stray continuation byte
    expect(stdout).toContain("INVALID-UTF8")
    expect(stdout).toContain("corrupt.md")
    // Non-blocking: warning on stderr, NOT a fatal message
    expect(stderr).toContain("WARNING")
    expect(stderr).not.toContain("FATAL")
    expect(stderr).not.toContain("BLOCKING")
  })

  it("mixed: one clean, one corrupt -> both reported, WARNING for corrupt only", () => {
    tmpDir = createTempDir("check-docs-encoding")
    const cleanMd = path.join(tmpDir, "ok.md")
    fs.writeFileSync(cleanMd, "# Clean file\n", "utf8")

    const corruptMd = path.join(tmpDir, "bad.md")
    const buf = Buffer.from("# Bad\n0x97 -> ", "utf8")
    fs.writeFileSync(corruptMd, Buffer.concat([buf, Buffer.from([0x97]), Buffer.from("\n")]))

    const { stdout, stderr } = run(cleanMd, corruptMd)
    expect(stdout).toContain("UTF8-OK")
    expect(stdout).toContain("INVALID-UTF8")
    expect(stdout).toContain("ok.md")
    expect(stdout).toContain("bad.md")
    expect(stderr).toContain("WARNING")
    expect(stderr).toContain("bad.md")
  })

  it("no files -> exit 0, skip message", () => {
    tmpDir = createTempDir("check-docs-encoding")
    // Empty dir with no docs files — the script's git ls-files would find
    // nothing. We trigger this by passing zero arg files (which is the
    // default mode: git ls-files). But in a tmp dir without git, git ls-files
    // returns nothing → "no docs files to scan — skipping".
    //
    // For the test, run from the tmp dir's CWD so git sees no tracked files.
    const r = runSubprocess({
      command: "bash",
      args: [SH_SCRIPT],
      cwd: tmpDir,
    })
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("no docs files to scan")
    expect(r.stderr).not.toContain("WARNING")
  })
})