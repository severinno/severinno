/**
 * check-node-modules-integrity.mjs - guard de layout divergente (2026-08)
 *
 * Synthetic-root tests via NODE_MODULES_ROOT (the same env-override pattern
 * as NEXT_TYPES_ROOT / FRAGILE_SCAN_ROOT): each test builds an isolated temp
 * dir with a fake bun.lock (the bun JSON format: "react": ["react@19.2.3",
 * "https://...", {}]) and fake node_modules/react/package.json +
 * react-dom/package.json, then runs the CLI with env: { NODE_MODULES_ROOT:
 * dir }. Hermetic by construction - zero real repo surface scanned.
 *
 * The contract being pinned is the 8.5 incident class: a divergent
 * node_modules that a plain `bun install` does NOT repair ("no changes" with
 * react duplicated -> invalid hook call across the whole component suite).
 * The guard compares INSTALLED version vs LOCKED version for the react/
 * react-dom pair; divergence (or a MISSING install) must fail with exit 1
 * and the CURE command (install limpo) - never silently pass.
 *
 * The BASELINE test runs the guard against the REAL repo (no env override -
 * the default cwd) to prove the live contract: react/react-dom 19.2.3 ==
 * bun.lock 19.2.3 today, exit 0 clean.
 *
 * Subprocess-heavy (every test spawns the CLI via runSubprocess) -> an
 * EXPLICIT timeout on every it() (the scan-timeouts guard requires it: the
 * global testTimeout: 30000 is only the safety net for tests the guard does
 * NOT flag).
 */
import { afterEach, describe, expect, it } from "vitest"
import fs from "node:fs"
import path from "node:path"
import { cleanupTempDirs, createTempDir, runSubprocess } from "./golden-copy-utils"

const SCRIPT = path.resolve(process.cwd(), "scripts", "check-node-modules-integrity.mjs")
const LOCKED = "19.2.3"
const OTHER = "19.2.8"

/** The bun.lock entry shape the guard greps: "pkg": ["pkg@<ver>", "url", {}] */
function lockLine(pkg: string, ver: string) {
  return `    "${pkg}": ["${pkg}@${ver}", "https://registry.npmjs.com/${pkg}/-/x.tgz", {}],\n`
}

/** Build a synthetic repo: fake bun.lock + fake installed react/react-dom. */
function buildRoot(opts: {
  react?: string | null
  reactDom?: string | null
  lockReact?: string
  lockReactDom?: string
  noLock?: boolean
}): string {
  const dir = createTempDir("nm-integrity-")
  const lock = opts.noLock
    ? null
    : `{\n  "lockfileVersion": 1,\n  "packages": {\n${lockLine("react", opts.lockReact ?? LOCKED)}${lockLine("react-dom", opts.lockReactDom ?? LOCKED)}  }\n}\n`
  if (lock !== null) {
    fs.mkdirSync(path.join(dir, "node_modules"), { recursive: true })
    fs.writeFileSync(path.join(dir, "bun.lock"), lock)
  }
  const writePkg = (pkg: string, ver: string | null | undefined) => {
    if (ver === null) return // MISSING install
    const p = path.join(dir, "node_modules", pkg, "package.json")
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, JSON.stringify({ name: pkg, version: ver ?? LOCKED }))
  }
  writePkg("react", opts.react)
  writePkg("react-dom", opts.reactDom)
  return dir
}

function runGuard(dir?: string) {
  return runSubprocess({
    command: process.execPath,
    args: [SCRIPT],
    ...(dir ? { env: { NODE_MODULES_ROOT: dir } } : {}),
  })
}

describe("check-node-modules-integrity.mjs - divergent node_modules guard (2026-08)", () => {
  afterEach(cleanupTempDirs)

  it("clean: installed react/react-dom match bun.lock -> exit 0, clean with versions", () => {
    const dir = buildRoot({ react: LOCKED, reactDom: LOCKED })
    const r = runGuard(dir)
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("clean")
    expect(r.stdout).toContain("react/react-dom match bun.lock: 19.2.3/19.2.3")
  }, 60000)

  it("DIVERGENT react: installed 19.2.8 vs locked 19.2.3 -> exit 1 + DIVERGENT line + CURE command", () => {
    const dir = buildRoot({ react: OTHER, reactDom: LOCKED })
    const r = runGuard(dir)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain("DIVERGENT react installed=19.2.8 locked=19.2.3")
    expect(r.stdout).toContain("CURE: rm -rf node_modules && bun install --frozen-lockfile")
    expect(r.stdout).toContain("o bun install comum NAO repara")
    // the healthy sibling is NOT flagged
    expect(r.stdout).not.toContain("DIVERGENT react-dom")
  }, 60000)

  it("DIVERGENT react-dom: installed 19.2.8 vs locked 19.2.3 -> exit 1 with the exact pair", () => {
    const dir = buildRoot({ react: LOCKED, reactDom: OTHER })
    const r = runGuard(dir)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain("DIVERGENT react-dom installed=19.2.8 locked=19.2.3")
  }, 60000)

  it("MISSING react install (package.json absent) -> exit 1, DIVERGENT with MISSING", () => {
    const dir = buildRoot({ react: null, reactDom: LOCKED })
    const r = runGuard(dir)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain("DIVERGENT react installed=MISSING locked=19.2.3")
    expect(r.stdout).toContain("CURE:")
  }, 60000)

  it("MUTATION flip: same fixture clean -> divergent (version swap) -> clean again (restore)", () => {
    // Clean first: both match the lock
    const dir = buildRoot({ react: LOCKED, reactDom: LOCKED })
    expect(runGuard(dir).status).toBe(0)
    // The bun-install swap path: a version change (like an orphaned store copy
    // landing at the top level) makes installed diverge from the lock.
    const reactPkg = path.join(dir, "node_modules", "react", "package.json")
    fs.writeFileSync(reactPkg, JSON.stringify({ name: "react", version: OTHER }))
    const bad = runGuard(dir)
    expect(bad.status).toBe(1)
    expect(bad.stdout).toContain(`DIVERGENT react installed=${OTHER} locked=${LOCKED}`)
    // Restore -> clean again (the guard keys on the version comparison)
    fs.writeFileSync(reactPkg, JSON.stringify({ name: "react", version: LOCKED }))
    expect(runGuard(dir).status).toBe(0)
  }, 60000)

  it("lock divergence: bun.lock declares a NEWER react than installed -> exit 1 (the 8.5 direction)", () => {
    // The incident: the lock was updated (or a foreign lock arrived) but the
    // node_modules still carries the old version - bun install reports no
    // changes and the mismatch persists silently.
    const dir = buildRoot({ react: LOCKED, reactDom: LOCKED, lockReact: OTHER })
    const r = runGuard(dir)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain(`DIVERGENT react installed=${LOCKED} locked=${OTHER}`)
  }, 60000)

  it("no bun.lock -> exit 0 skip (nothing to compare)", () => {
    const dir = buildRoot({ react: LOCKED, reactDom: LOCKED, noLock: true })
    const r = runGuard(dir)
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("skip (no bun.lock to compare)")
  }, 60000)

  it("UNVERIFIABLE: lock exists but the entry format drifted (v2-shaped line) -> exit 1, NEVER silent clean (the fail-safe direction)", () => {
    // A future bun.lock v2 changes the entry shape - the guard's regex cannot
    // locate the resolved version. The guard MUST fail (forcing an update),
    // not report a clean with the guard silently disabled. This pins the
    // fail-safe review finding as a contract.
    const dir = createTempDir("nm-integrity-")
    fs.mkdirSync(path.join(dir, "node_modules"), { recursive: true })
    fs.writeFileSync(
      path.join(dir, "bun.lock"),
      `{\n  "lockfileVersion": 2,\n  "packages": {\n    "react": { "version": "19.2.3" },\n    "react-dom": { "version": "19.2.3" }\n  }\n}\n`,
    )
    const p = path.join(dir, "node_modules", "react", "package.json")
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, JSON.stringify({ name: "react", version: LOCKED }))
    const r = runGuard(dir)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain("UNVERIFIABLE react/react-dom")
    expect(r.stdout).toContain("lock format changed? update the guard")
    expect(r.stdout).not.toContain("clean")
  }, 60000)

  it("BASELINE: real repo (no env override) -> exit 0, react/react-dom match bun.lock", () => {
    const r = runGuard()
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("clean")
    expect(r.stdout).toContain("match bun.lock")
    // The live versions today (2026-08): 19.2.3/19.2.3 - pinning the contract
    // that the environment is healthy, the state the guard exists to defend.
    expect(r.stdout).toContain("19.2.3/19.2.3")
  }, 60000)
})
