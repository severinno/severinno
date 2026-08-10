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
  /** Extra top-level dirs (each gets a package.json so it looks installed). */
  extraTop?: string[]
  /** Dot dirs to create (e.g. ".bin") - skipped by design, never extraneous. */
  dotDirs?: string[]
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
  for (const name of opts.extraTop ?? []) writePkg(name, "1.0.0")
  for (const d of opts.dotDirs ?? []) fs.mkdirSync(path.join(dir, "node_modules", d), { recursive: true })
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

  it("BASELINE: real repo (no env override) -> exit 0, react/react-dom match bun.lock + 0 extraneous top-level", () => {
    const r = runGuard()
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("clean")
    expect(r.stdout).toContain("match bun.lock")
    // The live versions today (2026-08): 19.2.3/19.2.3 - pinning the contract
    // that the environment is healthy, the state the guard exists to defend.
    expect(r.stdout).toContain("19.2.3/19.2.3")
    // The live extraneous state: every top-level node_modules dir (792 today)
    // has a bun.lock key (1407 keys) - 0 installed-but-not-locked packages.
    expect(r.stdout).toContain("0 extraneous top-level packages")
  }, 60000)

  it("count-pin: the clean message names the extraneous count (0) explicitly", () => {
    const dir = buildRoot({ react: LOCKED, reactDom: LOCKED })
    const r = runGuard(dir)
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("clean (react/react-dom match bun.lock: 19.2.3/19.2.3; 0 extraneous top-level packages)")
  }, 60000)

  it("EXTRANEOUS: a top-level dir not in bun.lock (the forgot-restore 8.6 class) -> exit 1 + EXTRANEOUS line + CURE", () => {
    const dir = buildRoot({ react: LOCKED, reactDom: LOCKED, extraTop: ["leftover-pkg"] })
    const r = runGuard(dir)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain("EXTRANEOUS leftover-pkg installed at node_modules/leftover-pkg but NOT in bun.lock")
    expect(r.stdout).toContain("CURE: rm -rf node_modules && bun install --frozen-lockfile")
    // the healthy pair is NOT flagged (single-failure count-pin)
    expect(r.stdout).not.toContain("DIVERGENT")
  }, 60000)

  it("EXTRANEOUS scoped: @scope/pkg dir not in lock -> flagged with the full key", () => {
    const dir = buildRoot({ react: LOCKED, reactDom: LOCKED, extraTop: ["@scope/stray"] })
    const r = runGuard(dir)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain("EXTRANEOUS @scope/stray installed at node_modules/@scope/stray")
  }, 60000)

  it("inverse MUTATION: a top-level dir WITH a lock key (hoisted transitive like lodash) is NOT extraneous -> still clean, 0 extraneous", () => {
    // The false-positive class: a hoisted transitive lands at top-level
    // node_modules/lodash AND has a bun.lock entry (it IS locked). The guard
    // keys on the lock, so it must NOT flag it - the same reason the real
    // repo's 792 dirs / 1407 keys report 0 extraneous. buildRoot writes a
    // lodash lock entry + installed package.json; only the pair-count-pin
    // message changes (the extra entry is invisible to the pair message).
    const dir = buildRoot({ react: LOCKED, reactDom: LOCKED, extraTop: ["lodash"] })
    fs.writeFileSync(
      path.join(dir, "bun.lock"),
      `{\n  "lockfileVersion": 1,\n  "packages": {\n${lockLine("react", LOCKED)}${lockLine("react-dom", LOCKED)}${lockLine("lodash", "4.17.21")}  }\n}\n`,
    )
    const r = runGuard(dir)
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("0 extraneous top-level packages")
    expect(r.stdout).not.toContain("EXTRANEOUS")
    // The key-scan specificity the reviewer asked for: the count alone could
    // pass even if lockedKeys() silently stopped matching lodash specifically
    // (e.g. a regex narrowing) - so pin that the top-level set was actually
    // crossed against the lodash key by probing the OPPOSITE direction:
    // drop lodash's lock entry (same installed dir, key gone) -> the same
    // name now trips, proving the guard reads lodash's key, not the pair.
    fs.writeFileSync(
      path.join(dir, "bun.lock"),
      `{\n  "lockfileVersion": 1,\n  "packages": {\n${lockLine("react", LOCKED)}${lockLine("react-dom", LOCKED)}  }\n}\n`,
    )
    const bad = runGuard(dir)
    expect(bad.status).toBe(1)
    expect(bad.stdout).toContain("EXTRANEOUS lodash")
    // and the DOCUMENTED boundary: the same name REMOVED from node_modules
    // (lock keeps the key) is NOT extraneous - the guard scans INSTALLED
    // dirs, it never flags 'locked but not installed' (the pair-layer covers
    // the critical missing install; a general missing-pkg scan is out of
    // scope, the same trust boundary as the version-only proxy of 8.5).
    const stray = path.join(dir, "node_modules", "lodash", "package.json")
    fs.rmSync(path.dirname(stray), { recursive: true, force: true })
    fs.writeFileSync(
      path.join(dir, "bun.lock"),
      `{\n  "lockfileVersion": 1,\n  "packages": {\n${lockLine("react", LOCKED)}${lockLine("react-dom", LOCKED)}${lockLine("lodash", "4.17.21")}  }\n}\n`,
    )
    const absent = runGuard(dir)
    expect(absent.status).toBe(0)
    expect(absent.stdout).toContain("0 extraneous top-level packages")
  }, 60000)

  it("dot-dirs (.bin, .cache) are SKIPPED - never extraneous (bun/installer internals)", () => {
    const dir = buildRoot({ react: LOCKED, reactDom: LOCKED, dotDirs: [".bin", ".cache", ".vite"] })
    const r = runGuard(dir)
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("0 extraneous top-level packages")
  }, 60000)

  it("MUTATION flip (forgot-restore path): clean -> stray top-level dir appears -> exit 1 EXTRANEOUS -> removed -> clean again", () => {
    const dir = buildRoot({ react: LOCKED, reactDom: LOCKED })
    expect(runGuard(dir).status).toBe(0)
    // Simulate `bun add leftover-pkg --no-save` leaving node_modules/leftover-pkg
    const stray = path.join(dir, "node_modules", "leftover-pkg", "package.json")
    fs.mkdirSync(path.dirname(stray), { recursive: true })
    fs.writeFileSync(stray, JSON.stringify({ name: "leftover-pkg", version: "1.0.0" }))
    const bad = runGuard(dir)
    expect(bad.status).toBe(1)
    expect(bad.stdout).toContain("EXTRANEOUS leftover-pkg")
    expect(bad.stdout).toContain("CURE:")
    // The restore (rm -rf node_modules && bun install --frozen-lockfile)
    fs.rmSync(path.join(dir, "node_modules", "leftover-pkg"), { recursive: true, force: true })
    expect(runGuard(dir).status).toBe(0)
  }, 60000)
})

describe("check-node-modules-integrity.mjs --check-lock - ALL direct packages vs bun.lock (2026-08)", () => {
  afterEach(cleanupTempDirs)

  /** Synthetic root with a package.json (deps) + bun.lock + installed set. */
  function buildCheckLockRoot(opts: {
    pkgJson?: Record<string, string> // package.json "dependencies"
    lock?: Record<string, string> // lock entry name -> resolved version
    installed?: Record<string, string | null> // name -> installed version (null = MISSING)
    noPkgJson?: boolean
    noLock?: boolean
  }): string {
    const dir = createTempDir("nm-integrity-")
    if (!opts.noPkgJson) {
      fs.writeFileSync(
        path.join(dir, "package.json"),
        JSON.stringify({ name: "synthetic", dependencies: opts.pkgJson ?? {} }),
      )
    }
    if (!opts.noLock) {
      const lines = Object.entries(opts.lock ?? {})
        .map(([pkg, ver]) => lockLine(pkg, ver))
        .join("")
      fs.mkdirSync(path.join(dir, "node_modules"), { recursive: true })
      fs.writeFileSync(
        path.join(dir, "bun.lock"),
        `{\n  "lockfileVersion": 1,\n  "packages": {\n${lines}  }\n}\n`,
      )
    }
    for (const [pkg, ver] of Object.entries(opts.installed ?? {})) {
      if (ver === null) continue // MISSING install
      const p = path.join(dir, "node_modules", pkg, "package.json")
      fs.mkdirSync(path.dirname(p), { recursive: true })
      fs.writeFileSync(p, JSON.stringify({ name: pkg, version: ver }))
    }
    return dir
  }

  function runCheckLock(dir?: string) {
    return runSubprocess({
      command: process.execPath,
      args: [SCRIPT, "--check-lock"],
      ...(dir ? { env: { NODE_MODULES_ROOT: dir } } : {}),
    })
  }

  it("clean: every direct pkg matches the lock -> exit 0, count-pin of the verified set", () => {
    const dir = buildCheckLockRoot({
      pkgJson: { react: "^19.0.0", lodash: "^4.17.0" },
      lock: { react: LOCKED, lodash: "4.17.21" },
      installed: { react: LOCKED, lodash: "4.17.21" },
    })
    const r = runCheckLock(dir)
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("--check-lock clean (2 direct packages match bun.lock; 0 skipped non-registry)")
  }, 60000)

  it("DIVERGENT: one direct pkg (lodash) installed wrong version -> exit 1 + DIVERGENT line + CURE, sibling NOT flagged (single-failure count-pin)", () => {
    const dir = buildCheckLockRoot({
      pkgJson: { react: "^19.0.0", lodash: "^4.17.0" },
      lock: { react: LOCKED, lodash: "4.17.21" },
      installed: { react: LOCKED, lodash: "4.17.20" },
    })
    const r = runCheckLock(dir)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain("DIVERGENT lodash installed=4.17.20 locked=4.17.21")
    expect(r.stdout).toContain("CURE: rm -rf node_modules && bun install --frozen-lockfile")
    // the healthy sibling is NOT flagged (only lodash diverged)
    expect(r.stdout).not.toContain("DIVERGENT react")
  }, 60000)

  it("MISSING install of a direct pkg -> exit 1 DIVERGENT with MISSING", () => {
    const dir = buildCheckLockRoot({
      pkgJson: { react: "^19.0.0" },
      lock: { react: LOCKED },
      installed: { react: null },
    })
    const r = runCheckLock(dir)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain("DIVERGENT react installed=MISSING locked=")
  }, 60000)

  it("MUTATION flip (the bun-install no-repair path): swap one installed version -> fail -> restore -> clean again", () => {
    const dir = buildCheckLockRoot({
      pkgJson: { react: "^19.0.0", lodash: "^4.17.0" },
      lock: { react: LOCKED, lodash: "4.17.21" },
      installed: { react: LOCKED, lodash: "4.17.21" },
    })
    expect(runCheckLock(dir).status).toBe(0)
    const lodashPkg = path.join(dir, "node_modules", "lodash", "package.json")
    fs.writeFileSync(lodashPkg, JSON.stringify({ name: "lodash", version: "4.17.20" }))
    const bad = runCheckLock(dir)
    expect(bad.status).toBe(1)
    expect(bad.stdout).toContain("DIVERGENT lodash installed=4.17.20 locked=4.17.21")
    fs.writeFileSync(lodashPkg, JSON.stringify({ name: "lodash", version: "4.17.21" }))
    expect(runCheckLock(dir).status).toBe(0)
  }, 60000)

  it("scoped direct pkg (@scope/pkg) validated via the same lock entry format -> clean", () => {
    const dir = buildCheckLockRoot({
      pkgJson: { "@scope/pkg": "^1.0.0" },
      lock: { "@scope/pkg": "1.2.3" },
      installed: { "@scope/pkg": "1.2.3" },
    })
    const r = runCheckLock(dir)
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("--check-lock clean (1 direct packages match bun.lock; 0 skipped non-registry)")
  }, 60000)

  it("non-registry spec (workspace:*) -> SKIP line, exit 0, excluded from the count (documented exclusion, never silent)", () => {
    const dir = buildCheckLockRoot({
      pkgJson: { react: "^19.0.0", "@repo/shared": "workspace:*" },
      lock: { react: LOCKED },
      installed: { react: LOCKED },
    })
    const r = runCheckLock(dir)
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("SKIP @repo/shared (spec 'workspace:*') - non-registry")
    expect(r.stdout).toContain("--check-lock clean (1 direct packages match bun.lock; 1 skipped non-registry)")
  }, 60000)

  it.each([
    ["git@github.com:org/repo.git"],
    ["git+ssh://git@github.com/org/repo.git"],
    ["github:org/repo"],
    ["http://example.com/repo.tgz"],
    ["https://example.com/repo.tgz"],
    ["file:../shared"],
    ["link:../shared"],
  ])("non-registry boundary SKIP: spec '%s' -> exit 0, SKIP line with the EXACT spec, excluded from the count", (spec) => {
    // Cada alternativo da fronteira lockKeyFor
    // (/^(workspace:|link:|file:|git(?:[+:@]|$)|github:|http)/) DEVE cair no
    // SKIP explicito - nunca virar chave registry greppable (que quebraria com
    // o UNVERIFIABLE fail-safe e a mensagem ERRADA "lock format changed?") nem
    // contar como registry. O workspace:* e pinado pelo teste acima; esta
    // tabela parametrizada pina cada OUTRO ramo do regex: git@ (ssh-style),
    // git+ (git+ssh://), github:, http (cobre http:// E https://), file:, link:.
    const dir = buildCheckLockRoot({
      pkgJson: { react: "^19.0.0", "@repo/shared": spec },
      lock: { react: LOCKED },
      installed: { react: LOCKED },
    })
    const r = runCheckLock(dir)
    expect(r.status).toBe(0)
    expect(r.stdout).toContain(`SKIP @repo/shared (spec '${spec}') - non-registry`)
    expect(r.stdout).toContain("--check-lock clean (1 direct packages match bun.lock; 1 skipped non-registry)")
  }, 60000)

  it("npm: alias -> resolved against the REAL lock entry, installed read from the alias folder", () => {
    const dir = buildCheckLockRoot({
      pkgJson: { alias: "npm:real-pkg@2.0.0" },
      lock: { "real-pkg": "2.0.0" },
      installed: { alias: "2.0.0" },
    })
    const r = runCheckLock(dir)
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("--check-lock clean (1 direct packages match bun.lock; 0 skipped non-registry)")
    // flip the alias install -> DIVERGENT naming the alias key
    const p = path.join(dir, "node_modules", "alias", "package.json")
    fs.writeFileSync(p, JSON.stringify({ name: "real-pkg", version: "1.9.0" }))
    const bad = runCheckLock(dir)
    expect(bad.status).toBe(1)
    expect(bad.stdout).toContain("DIVERGENT alias installed=1.9.0 locked=2.0.0")
  }, 60000)

  it("UNVERIFIABLE (v2-shaped lock): a direct pkg's entry is not grep-able -> exit 1 NEVER silent clean (the fail-safe direction)", () => {
    const dir = createTempDir("nm-integrity-")
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "synthetic", dependencies: { react: "^19.0.0" } }),
    )
    fs.mkdirSync(path.join(dir, "node_modules"), { recursive: true })
    fs.writeFileSync(
      path.join(dir, "bun.lock"),
      `{\n  "lockfileVersion": 2,\n  "packages": {\n    "react": { "version": "19.2.3" }\n  }\n}\n`,
    )
    const r = runCheckLock(dir)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain("--check-lock UNVERIFIABLE react")
    expect(r.stdout).toContain("lock format changed? update the guard")
    expect(r.stdout).not.toContain("clean")
  }, 60000)

  it("no package.json -> --check-lock skip exit 0 (nothing to derive)", () => {
    const dir = buildCheckLockRoot({ noPkgJson: true, lock: { react: LOCKED }, installed: { react: LOCKED } })
    const r = runCheckLock(dir)
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("--check-lock skip (no package.json to derive direct deps)")
  }, 60000)

  it("no bun.lock -> exit 0 skip (same as the default mode)", () => {
    const dir = buildCheckLockRoot({ pkgJson: { react: "^19.0.0" }, noLock: true })
    const r = runCheckLock(dir)
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("skip (no bun.lock to compare)")
  }, 60000)

  it("BASELINE: real repo (no env override) --check-lock -> exit 0, ALL 98 direct packages match bun.lock (count-pin of the live manifest)", () => {
    const r = runCheckLock()
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("--check-lock clean (98 direct packages match bun.lock; 0 skipped non-registry)")
  }, 60000)

  it("SPEC-FORMAT contract: every direct dep spec today is registry (98/98, 0 weird) and any format outside the lockKeyFor boundary trips - the SKIP-vs-include decision must be explicit", () => {
    // The boundary pinned is the lockKeyFor non-registry skip in the module:
    // /^(workspace:|link:|file:|git(?:[+:@]|$)|github:|http)/ - any spec NOT
    // matching that regex AND not a bare registry name is an UNDECIDED format:
    // it would silently fall into the UNVERIFIABLE fail-safe (or worse, be
    // grepped as a lock key that does not exist). Reading the regex from the
    // module source (not duplicating it here) keeps the contract drift-proof.
    const src = fs.readFileSync(SCRIPT, "utf8")
    // Match the literal source line: /^(workspace:|link:|file:|git(?:[+:@]|$)|github:|http)/.test(spec)
    // (slashes escaped as \/, the `^` is a LITERAL in the source (simple
    // group, no `?:`), and the `$` inside the git alternation as \$).
    const m = src.match(
      /\/\^\(workspace:\|link:\|file:\|git\(\?:\[\+:@\]\|\$\)\|github:\|http\)\/\.test\(spec\)/,
    )
    expect(m).not.toBeNull()
    const nonRegistryRe = new RegExp("^(workspace:|link:|file:|git(?:[+:@]|$)|github:|http)")
    const pkgJson = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "package.json"), "utf8"))
    const weird = []
    let registry = 0
    for (const section of ["dependencies", "devDependencies", "optionalDependencies"]) {
      for (const [name, spec] of Object.entries(pkgJson[section] || {})) {
        if (typeof spec !== "string") {
          weird.push(`${name}=[non-string ${typeof spec}]`)
        } else if (nonRegistryRe.test(spec) || spec.startsWith("npm:")) {
          // known non-registry (SKIP boundary) or alias - both explicitly handled
        } else {
          registry++
        }
      }
    }
    // 0 undecided formats today (98 registry + 0 known-skip + 0 alias).
    expect(weird).toEqual([])
    expect(registry).toBe(98)
    // MUTATION (classifier guard): a NEW unknown spec format is NOT caught by
    // the SKIP boundary - it would be treated as a registry name and grepped
    // against the lock. Proving the classifier here pins the detection;
    // the CLI-level consequence is proven by the synthetic-root test below.
    expect(
      ["custom:foo@1.0.0", "tarball:https://x/y.tgz"].filter(
        (s) => nonRegistryRe.test(s) || s.startsWith("npm:"),
      ),
    ).toEqual([])
  }, 60000)

  it("SPEC-FORMAT mutation (CLI level): an undecided spec format in a synthetic root -> exit 1 UNVERIFIABLE, NEVER silent clean", () => {
    // The '0 weird' contract is about the REAL repo today; this synthetic root
    // proves the CONSEQUENCE of an undecided format appearing: lockKeyFor
    // treats 'custom:foo@1.0.0' as a registry name (no SKIP boundary match),
    // greps the lock for a key that does not exist -> the UNVERIFIABLE
    // fail-safe fires with exit 1 - the honest loud failure, never a silent
    // clean with the guard effectively bypassed. Deciding to include a new
    // non-registry format means extending the lockKeyFor boundary; this test
    // forces that decision to be made explicitly.
    const dir = buildCheckLockRoot({
      pkgJson: { "custom-pkg": "custom:foo@1.0.0", react: "^19.0.0" },
      lock: { react: LOCKED },
      installed: { react: LOCKED },
    })
    const r = runCheckLock(dir)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain("--check-lock UNVERIFIABLE custom-pkg")
    expect(r.stdout).toContain("lock format changed? update the guard")
    expect(r.stdout).not.toContain("clean")
  }, 60000)

  it("MANIFEST SURFACE: every TRACKED package.json is 100% registry (0 non-registry) - the audit 2026-08-10 closes 'quem protege os manifests' beyond the root", () => {
    // AUDIT 2026-08-10 (user question: o mono-repo packages/ do pnpm poderia
    // ter workspace: deps?): NAO existe dir packages/, os lockfiles pnpm
    // foram REMOVIDOS (28ab2c8, Type F single-package-manager bun) e os
    // unicos manifests rastreados sao o root package.json (98 deps registry)
    // + mini-services/realtime/package.json (1 dep registry: socket.io@^4.8.1
    // - unidade SEPARADA de deploy com Dockerfile/bun.lock proprios,
    // documentada fora do surface do --check-lock no scan-surfaces.md). ZERO
    // specs workspace:/file:/link: em qualquer manifest rastreado.
    // Este teste PINA essa superficie: enumera TODOS os package.json
    // rastreados via git ls-files (cwd = ROOT, o mesmo padrao do
    // executable-surface.test.ts) e asserta o set exato + 0 non-registry em
    // CADA um - um spec workspace:/file: adicionado a QUALQUER manifest
    // (root, mini-services ou um futuro packages/) trip aqui e forca a
    // decisao explicita SKIP-vs-include. O SPEC-FORMAT contract acima so
    // cobre o root; este fecha a classe para a superficie completa.
    const r = runSubprocess({
      command: "git",
      args: ["ls-files"],
      cwd: path.resolve(process.cwd()),
    })
    expect(r.status).toBe(0)
    const manifests = r.stdout
      .split("\n")
      .filter((f) => f.endsWith("package.json") && f !== "")
      .sort()
    // O set exato hoje: root + a unidade separada de deploy. Um novo manifest
    // (ex.: packages/foo/package.json) quebra este pin - forcando a decisao.
    expect(manifests).toEqual(["mini-services/realtime/package.json", "package.json"])
    // Drift-proof: a fronteira precisa existir verbatim no modulo (o regex
    // abaixo e uma copia; este assert pina que o modulo ainda a usa).
    const src = fs.readFileSync(SCRIPT, "utf8")
    expect(src).toContain("/^(workspace:|link:|file:|git(?:[+:@]|$)|github:|http)/.test(spec)")
    const nonRegistryRe = new RegExp("^(workspace:|link:|file:|git(?:[+:@]|$)|github:|http)")
    const weird = []
    const registryByManifest: Record<string, number> = {}
    for (const rel of manifests) {
      const pkgJson = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), rel), "utf8"))
      for (const section of ["dependencies", "devDependencies", "optionalDependencies"]) {
        for (const [name, spec] of Object.entries(pkgJson[section] || {})) {
          if (typeof spec !== "string") {
            weird.push(`${rel}:${name}=[non-string ${typeof spec}]`)
          } else if (nonRegistryRe.test(spec) || spec.startsWith("npm:")) {
            // known non-registry (SKIP boundary) or alias - both explicitly handled
          } else {
            registryByManifest[rel] = (registryByManifest[rel] ?? 0) + 1
          }
        }
      }
    }
    expect(weird).toEqual([])
    // count-pin POR manifest (mais forte que o agregado 99): um spec
    // workspace:/file: num manifest (a) reduz o count dele -> trip, e mesmo
    // que venha acompanhado de uma dep registry nova (count agregado
    // mantido), o pin individual ainda trip - o edge de mascaramento do
    // count agregado. Hoje: root 98 (SPEC-FORMAT) + mini-services 1 (socket.io).
    expect(registryByManifest["package.json"]).toBe(98)
    expect(registryByManifest["mini-services/realtime/package.json"]).toBe(1)
  }, 60000)
})
