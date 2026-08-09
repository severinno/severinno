/**
 * blame-ignore-revs.test.ts - guards the repo's .git-blame-ignore-revs
 * contract so the mechanical banner conversion is never blamed on the
 * conversion commit.
 *
 * Context: the 1:1 transliteration of the ops-script banners (~33 .sh:
 * box-drawing/emoji/em-dash glyphs -> pure ASCII) is UNCOMMITTED
 * working-tree state in this thread (git blame at HEAD still shows the
 * original glyphs). The file exists TODAY with only documentation and a
 * placeholder; the conversion commit hash must be appended once the
 * conversion lands on main. This suite pins the CONTRACT of the file so a
 * future hash entry cannot be a typo or reference a commit that does not
 * exist in this repo (a broken ignore-revs entry silently fails to protect
 * blame - the exact class of silent failure this repo's encoding gates
 * exist to prevent).
 *
 * Contract pinned here:
 *   1. File exists at repo root (missing = fail, not silently skipped).
 *   2. File is pure ASCII (same discipline the encoding gates enforce).
 *   3. Every non-comment line is a full 40-hex commit hash.
 *   4. Every listed hash resolves to a REAL commit (git cat-file -e) -
 *      proven by a MUTATION test where a fabricated hash is rejected.
 *   5. No listed hash resolves to the CURRENT HEAD - a self-referencing
 *      entry (the commit that would add itself to this file) silently
 *      disables the guard for every line it introduces, the exact class
 *      of error the original placeholder documented. Proven by a
 *      MUTATION test that feeds HEAD into the check and expects failure.
 *
 * The file historically held zero entries while the conversion was
 * UNCOMMITTED working-tree state; the assertions validate the
 * format/existence rules for any entry that IS present, so the gate
 * became active the moment the conversion commit was appended.
 */
import { describe, it, expect } from "vitest"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

const ROOT = process.cwd()
const FILE = path.join(ROOT, ".git-blame-ignore-revs")

/** Non-comment, non-empty entries of the ignore file (CRLF-tolerant). */
function entries(): string[] {
  const content = fs.readFileSync(FILE, "utf8")
  return content
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.trim() !== "" && !l.trim().startsWith("#"))
    .map((l) => l.trim())
}

/** True when the hash resolves to a real commit in this repo. */
function commitExists(hash: string): boolean {
  const r = spawnSync("git", ["cat-file", "-e", `${hash}^{commit}`], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 15_000,
  })
  return r.status === 0
}

/** Full 40-hex hash of the current HEAD (resolved once per run). */
function currentHead(): string {
  const r = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 15_000,
  })
  const head = (r.stdout ?? "").trim()
  if (!/^[0-9a-f]{40}$/.test(head)) {
    throw new Error("git rev-parse HEAD failed to return a 40-hex hash")
  }
  return head
}

/** Resolved once: HEAD is stable for the whole suite run. */
const HEAD = currentHead()

/** True when the hash is the commit that would write this very file. */
function isSelfReferencing(hash: string): boolean {
  return hash === HEAD
}

describe(".git-blame-ignore-revs", () => {
  it("exists at repo root and still documents its purpose (stripped stub = fail)", () => {
    expect(fs.existsSync(FILE)).toBe(true)
    const content = fs.readFileSync(FILE, "utf8")
    expect(content).toContain("Mechanical banner conversion")
    expect(content).toContain("git config blame.ignoreRevsFile")
  })

  it("setup scripts wire blame.ignoreRevsFile so new clones get the protection", () => {
    const setupSh = fs.readFileSync(path.join(ROOT, "scripts", "setup.sh"), "utf8")
    const setupPs1 = fs.readFileSync(path.join(ROOT, "scripts", "setup.ps1"), "utf8")
    const docContent = fs.readFileSync(FILE, "utf8")
    // Bash path: idempotent git config with pass/warn.
    expect(setupSh).toContain("git config blame.ignoreRevsFile .git-blame-ignore-revs")
    // PowerShell path: git config with $LASTEXITCODE + Get-Command guard (mirrors the .sh).
    expect(setupPs1).toContain("git config blame.ignoreRevsFile .git-blame-ignore-revs")
    // The command line in the ignore file doc must match the .sh wiring verbatim.
    expect(docContent).toContain("git config blame.ignoreRevsFile .git-blame-ignore-revs")
  })

  it("is pure ASCII (byte-wise: no byte >= 0x80)", () => {
    const buf = fs.readFileSync(FILE)
    for (let i = 0; i < buf.length; i++) {
      expect(buf[i]).toBeLessThan(0x80)
    }
  })

  it("every entry is a full 40-hex commit hash (no prefixes)", () => {
    const list = entries()
    for (const e of list) {
      expect(e).toMatch(/^[0-9a-f]{40}$/)
    }
  })

  it("every listed hash resolves to a real commit in this repo", () => {
    const list = entries()
    for (const h of list) {
      expect(commitExists(h)).toBe(true)
    }
  }, 60000)

  it("no listed hash is the current HEAD (a self-referencing entry would silently disable the guard)", () => {
    const list = entries()
    for (const h of list) {
      expect(isSelfReferencing(h)).toBe(false)
      expect(h).not.toBe(HEAD)
    }
  }, 60000)

  it("MUTATION: a fabricated hash is rejected by the existence check", () => {
    const fake = "0000000000000000000000000000000000000000"
    expect(commitExists(fake)).toBe(false)
  }, 60000)

  it("MUTATION: appending HEAD to the file is caught by the self-reference check", () => {
    // HEAD passes the existence check, so only the self-reference check can
    // catch it - this pins the exact error class the placeholder documented.
    expect(commitExists(HEAD)).toBe(true)
    // Real entries are clean today.
    expect(entries().some(isSelfReferencing)).toBe(false)
    // Injecting HEAD into the entry list must fire the check (a mutation that
    // would silently disable the guard for every line HEAD introduces).
    expect([...entries(), HEAD].some(isSelfReferencing)).toBe(true)
  }, 60000)
})
