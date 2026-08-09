/**
 * executable-surface.test.ts — pins the 2026-08 executable-surface audit:
 * which tracked EXECUTABLE files live in NO scan surface, and the decision
 * for each one (ENTER a list vs OUT BY DESIGN, documented).
 *
 * History/context: docs/scan-surfaces.md (Type A) defines the code-surface
 * contracts — gateFiles() + TARGET_DIRS for the fragile-range scan, the
 * encoding-surface manifest for the encoding gates. The 2026-08 audit ran
 * that matrix against `git ls-files` and found a gap: root executable
 * TOOLING — the .ts/.mjs/.ps1 configs (next.config.ts, eslint.config.mjs,
 * dev.ps1, vitest*.config.ts, sentry.*.config.ts), the extension-less
 * build files (Makefile, Dockerfile) and the root *.sh ops scripts — was
 * not fully covered. gateFiles() had only scanned root *.sh (plus the
 * inner gates); a fragile character-class range in next.config.ts would
 * have passed every encoding gate silently — the SAME bug class as the
 * 2026-08 em-dash in a gate script, just in a different file.
 *
 * DECISION (frozen here + documented in docs/scan-surfaces.md Type A + the
 * gateFiles() docblock in fragile-range-patterns.mjs — change the module,
 * keep this suite in sync):
 *   A. ENTERS the gate surface: every tracked root executable tooling file
 *      (ROOT_TOOLING below) is enumerated by gateFiles(), so a fragile
 *      range in any of them now fails the encoding gate like one in a gate
 *      script.
 *   B. OUT BY DESIGN: root docker-compose*.yml / pnpm-*.yaml
 *      (ROOT_YML_OUT below) are DECLARED container/package data, not
 *      executable gate logic — the same class as the config/, examples/,
 *      prisma/ tree exclusions in EXCLUDED_TREES. Not scanned; the list is
 *      frozen so a future root yml forces an explicit decision.
 *   C. NO-ORPHAN CONTRACT (derived, self-maintaining): every tracked file
 *      with an executable extension must be covered by a surface
 *      (gateFiles() ∪ TARGET_DIRS trees) or by a frozen exception
 *      (EXCLUDED_TREES / ROOT_YML_OUT / the __tests__ + fixtures
 *      exemptions that are the guard's documented fixture zone). A new
 *      tracked .ts/.mjs/.sh that nobody classifies FAILS this suite with
 *      its exact path — the audit never has to be re-run by hand.
 */
import { describe, it, expect } from "vitest"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { EXCLUDED_TREES, TARGET_DIRS, gateFiles } from "../fragile-range-patterns.mjs"

const ROOT = process.cwd()

/** Executable extension set — same class as TARGET_EXTS, plus the
 *  extension-less build files and .ya?ml (workflow/action/compose YAML is
 *  executable gate logic or declared data — the classification decides). */
const EXEC_RE = /\.(sh|mjs|js|cjs|mts|ts|tsx|jsx|py|ps1|ya?ml)$/
const BUILD_FILES = new Set(["Makefile", "Dockerfile"])

/**
 * FROZEN decision A — root executable tooling that ENTERS the gate surface.
 * Every entry must be enumerated by gateFiles(ROOT) (asserted below). A new
 * root executable must be added HERE (and nowhere else) to be classified.
 */
const ROOT_TOOLING = [
  "Dockerfile",
  "Makefile",
  "dev.ps1",
  "eslint.config.mjs",
  "keep-alive.sh",
  "next.config.ts",
  "playwright.config.ts",
  "postcss.config.mjs",
  "prisma.config.ts",
  "run-server.sh",
  "sentry.client.config.ts",
  "sentry.edge.config.ts",
  "sentry.server.config.ts",
  "start-server.sh",
  "supervisor.sh",
  "tailwind.config.ts",
  "test-prisma7.mjs",
  "vitest.config.ts",
  "vitest.config.unit.ts",
  "vitest.setup.ts",
]

/**
 * FROZEN decision B — root YAML orchestration/package data that stays OUT
 * BY DESIGN. Declared container (docker-compose) / package-manager (pnpm)
 * data, not executable gate logic; a fragile range there cannot silently
 * fail an encoding check (docker-compose does not run the gates). Same
 * rationale class as the EXCLUDED_TREES tree decisions.
 */
const ROOT_YML_OUT = [
  "docker-compose.dev.yml",
  "docker-compose.glitchtip.yml",
  "docker-compose.prod.yml",
  "docker-compose.test.yml",
  "docker-compose.yml",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
]

/** Tracked files, root-relative, forward slashes (git ls-files is
 *  separator-stable across platforms). */
function trackedRels(): string[] {
  const r = spawnSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8", timeout: 30_000 })
  expect(r.status).toBe(0)
  return (r.stdout ?? "").split("\n").filter(Boolean)
}

function gateRels(): Set<string> {
  return new Set(
    gateFiles(ROOT).map((f) => path.relative(ROOT, f).split(path.sep).join("/")),
  )
}

/** A tracked rel is executable if its name matches the executable class. */
function isExecutable(rel: string): boolean {
  const base = rel.split("/").pop() ?? ""
  return EXEC_RE.test(rel) || BUILD_FILES.has(base)
}

describe("executable surface (2026-08 audit: no tracked executable in NO surface)", () => {
  it("DECISION A (frozen ROOT_TOOLING): every root executable tooling file ENTERS the gate surface (gateFiles())", () => {
    const gate = gateRels()
    // The frozen decision list itself: each entry must be enumerated by
    // gateFiles() — a fragile range in next.config.ts fails the encoding
    // gate exactly like one in a gate script.
    for (const f of ROOT_TOOLING) {
      expect(gate.has(f), `${f} must be a gate file (root executable tooling)`).toBe(true)
    }
    // No drift in the OTHER direction either: every tracked root
    // executable must be CLASSIFIED — either in ROOT_TOOLING (enters) or
    // in ROOT_YML_OUT (out by design). A new root .ts/.mjs/.ps1/.sh that
    // nobody classifies fails here with its exact path.
    const rootRels = trackedRels().filter((r) => !r.includes("/") && isExecutable(r))
    const unclassified = rootRels.filter((r) => !ROOT_TOOLING.includes(r) && !ROOT_YML_OUT.includes(r))
    expect(unclassified, `root executables missing from ROOT_TOOLING / ROOT_YML_OUT:\n${unclassified.join("\n")}`).toEqual([])
  })

  it("DECISION B (frozen ROOT_YML_OUT): docker-compose / pnpm root YAML is NOT a gate file (declared data, out by design)", () => {
    const gate = gateRels()
    for (const f of ROOT_YML_OUT) {
      expect(gate.has(f), `${f} must NOT be a gate file (declared container/package data)`).toBe(false)
    }
    // And every tracked entry of the frozen list is really tracked — a
    // deleted file that stays on the list would silently rot the contract.
    const tracked = new Set(trackedRels())
    for (const f of ROOT_YML_OUT) {
      expect(tracked.has(f), `${f} is frozen on ROOT_YML_OUT but no longer tracked`).toBe(true)
    }
  })

  it("EXCLUDED_TREES executables (config/, examples/, prisma/, ...) never enter gateFiles()", () => {
    const gate = gateRels()
    for (const tree of EXCLUDED_TREES) {
      const leaks = [...gate].filter((r) => r.startsWith(`${tree}/`))
      expect(leaks, `files under excluded tree ${tree}/ leaked into gateFiles():\n${leaks.join("\n")}`).toEqual([])
    }
  })

  it("NO-ORPHAN CONTRACT (derived from git ls-files): every tracked executable is covered by a surface or a frozen exception", () => {
    // The audit's punchline, re-run automatically on every test pass: take
    // the FULL tracked file list, keep only executable-class files, and
    // classify each one. Covered = gateFiles() (incl. root tooling +
    // workflows + actions) or a TARGET_DIRS tree (e2e/, src/,
    // mini-services/, .zscripts/ — scanned by scanExecutableCode).
    // Exempt = EXCLUDED_TREES (tree-level decision), ROOT_YML_OUT
    // (decision B), or the documented fixture zone (__tests__ trees,
    // .test.* specs, fixtures/) — where the guard's own immunity proofs
    // legitimately carry the very patterns it hunts. Anything left over is
    // an ORPHAN: executable, tracked, and invisible to every gate — the
    // exact gap this audit exists to close.
    const gate = gateRels()
    const orphans: string[] = []
    for (const rel of trackedRels()) {
      if (!isExecutable(rel)) continue
      if (gate.has(rel)) continue
      if (TARGET_DIRS.some((d) => rel === d || rel.startsWith(`${d}/`))) continue
      if (EXCLUDED_TREES.some((t) => rel.startsWith(`${t}/`))) continue
      if (ROOT_YML_OUT.includes(rel)) continue
      if (rel.includes("__tests__") || rel.includes(".test.") || rel.includes("/fixtures/")) continue
      orphans.push(rel)
    }
    expect(orphans, `tracked executable files in NO scan surface:\n${orphans.join("\n")}`).toEqual([])
  })

  it("DOC CONTRACT: docs/scan-surfaces.md documents the root executable tooling decision (Type A)", () => {
    const doc = fs.readFileSync(path.join(ROOT, "docs", "scan-surfaces.md"), "utf8")
    expect(doc).toContain("Root executable tooling")
    expect(doc).toContain("OUT BY DESIGN")
  })
})
