#!/usr/bin/env node
/**
 * hook-proof-fake-bins.mjs - fake git for hook-proof-run.test.ts (hermetic).
 *
 * The hook-proof-run CLI spawns git via the HOOK_PROOF_GIT env override
 * (invoked as `node <this-file> git <args...>` - the role is arg[2], the same
 * cross-platform pattern as CI_PROOF_GIT in ci-proof-fake-bins.mjs). This
 * fixture responds to the EXACT command shapes the CLI sends and records every
 * invocation to a state dir so the tests can prove the CYCLE ORDER (backup ->
 * scratch -> delta commit -> mutation commit -> shas -> revert) without a real
 * repo.
 *
 * Behavior is scripted via env (set by the test, inherited through the CLI's
 * spawnSync env passthrough):
 *   HOOK_PROOF_FAKE_STATE     dir where state.json (current branch, sha
 *                              counters) and invocations.log (one line per
 *                              call: `git:rev-parse --abbrev-ref HEAD`) live.
 *   HOOK_PROOF_FAKE_DIRTY     "1" = git status --porcelain is dirty (the
 *                              delta materialization path).
 *   HOOK_PROOF_FAKE_HEAD_SHA  the sha `rev-parse HEAD` reports (default
 *                              "fake-head-sha").
 *   HOOK_PROOF_FAKE_OLD_SHA   the sha `rev-parse HEAD~1` reports (default
 *                              "fake-old-sha").
 *   HOOK_PROOF_FAKE_PATCH     the git diff content (default "fake patch").
 *
 * The hook itself is NOT this fixture - the CLI spawns `bash <hook>` with the
 * refs payload on stdin; the tests point --hook at hook-proof-fake-hook.sh
 * (which echoes a scripted output + exit code via HOOK_PROOF_FAKE_HOOK_*).
 * Puro node, sem deps, ASCII puro (fora do MJS_GATE_PATTERNS glob de
 * top-level, mas mantem o padrao).
 */
import fs from "node:fs"
import path from "node:path"

const kind = process.argv[2]
const args = process.argv.slice(3)

const stateDir = process.env.HOOK_PROOF_FAKE_STATE
if (!stateDir) {
  process.stderr.write("fake bins: HOOK_PROOF_FAKE_STATE nao definido\n")
  process.exit(9)
}
const stateFile = path.join(stateDir, "state.json")
const logFile = path.join(stateDir, "invocations.log")

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(stateFile, "utf8"))
  } catch {
    return { currentBranch: "base", branches: {}, commitCount: 0 }
  }
}
function saveState(s) {
  fs.writeFileSync(stateFile, JSON.stringify(s))
}
function record() {
  fs.appendFileSync(logFile, `${kind}:${args.join(" ")}\n`)
}
function out(s) {
  process.stdout.write(s)
}
function ok() {
  process.exit(0)
}

record()

const state = loadState()

if (kind === "git") {
  if (args[0] === "rev-parse" && args[1] === "--abbrev-ref") {
    out(state.currentBranch)
    ok()
  }
  if (args[0] === "rev-parse" && args[1] === "HEAD") {
    out(process.env.HOOK_PROOF_FAKE_HEAD_SHA || "fake-head-sha")
    ok()
  }
  if (args[0] === "rev-parse" && args[1] === "HEAD~1") {
    out(process.env.HOOK_PROOF_FAKE_OLD_SHA || "fake-old-sha")
    ok()
  }
  if (args[0] === "diff") {
    out(process.env.HOOK_PROOF_FAKE_PATCH || "fake patch content\n")
    ok()
  }
  if (args[0] === "ls-files") {
    // --others --exclude-standard: untracked files (none in the hermetic
    // cycle by default; a test can script one via HOOK_PROOF_FAKE_UNTRACKED).
    out(process.env.HOOK_PROOF_FAKE_UNTRACKED || "")
    ok()
  }
  if (args[0] === "status") {
    out(process.env.HOOK_PROOF_FAKE_DIRTY === "1" ? " M mutated.ts\n" : "")
    ok()
  }
  if (args[0] === "checkout" && args[1] === "-b") {
    state.currentBranch = args[2]
    state.branches[`refs/heads/${args[2]}`] = true
    saveState(state)
    ok()
  }
  if (args[0] === "checkout") {
    state.currentBranch = args[1]
    saveState(state)
    ok()
  }
  if (args[0] === "add") {
    ok()
  }
  if (args[0] === "commit") {
    state.commitCount += 1
    saveState(state)
    ok()
  }
  if (args[0] === "branch" && args[1] === "-D") {
    delete state.branches[`refs/heads/${args[2]}`]
    saveState(state)
    ok()
  }
  if (args[0] === "apply") {
    ok()
  }
  process.stderr.write(`fake git: shape nao esperado: ${args.join(" ")}\n`)
  process.exit(9)
}

process.stderr.write(`fake bins: kind desconhecido: ${kind}\n`)
process.exit(9)
