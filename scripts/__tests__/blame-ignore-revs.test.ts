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
 *
 * The file intentionally has zero hash entries right now; the assertions
 * validate the format/existence rules for any entry that IS present, so
 * the gate becomes active the moment the conversion commit is appended.
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

describe(".git-blame-ignore-revs", () => {
  it("exists at repo root and still documents its purpose (stripped stub = fail)", () => {
    expect(fs.existsSync(FILE)).toBe(true)
    const content = fs.readFileSync(FILE, "utf8")
    expect(content).toContain("Mechanical banner conversion")
    expect(content).toContain("git config blame.ignoreRevsFile")
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
  })

  it("MUTATION: a fabricated hash is rejected by the existence check", () => {
    const fake = "0000000000000000000000000000000000000000"
    expect(commitExists(fake)).toBe(false)
  })
})
