#!/usr/bin/env node
/**
 * ci-proof-fake-bins.mjs - fake git/gh for ci-proof-run.test.ts (hermetic).
 *
 * The ci-proof-run CLI spawns git/gh via the CI_PROOF_GIT / CI_PROOF_GH env
 * overrides (invoked as `node <this-file> <kind> <args...>` - the role is
 * arg[2], so ONE fixture serves both binaries, cross-platform, no shebang
 * needed). This fixture responds to the EXACT command shapes the CLI sends
 * and records every invocation to a state dir so the tests can prove the
 * CYCLE ORDER (create -> push -> dispatch -> poll -> capture -> revert)
 * without a real repo or a real GitHub.
 *
 * Behavior is scripted via env (set by the test, inherited through the
 * CLI's spawnSync env passthrough):
 *   CI_PROOF_FAKE_STATE         dir where state.json (current branch,
 *                               branch existence, poll counter) and
 *                               invocations.log (one line per call:
 *                               `git:rev-parse --abbrev-ref HEAD`) live.
 *   CI_PROOF_FAKE_GH_MODE       "ok" (default) | "wf-404" (workflow view
 *                               fails - the Prova 7 dispatch-404 class).
 *   CI_PROOF_FAKE_GH_POLL       in_progress polls before completed
 *                               (default 0 = completes on the 1st poll).
 *   CI_PROOF_FAKE_GH_CONCLUSION "success" (default) | "failure".
 *   CI_PROOF_FAKE_GH_LOG        the run log content for `gh run view --log`.
 *   CI_PROOF_FAKE_DIRTY         "1" = git status --porcelain is dirty
 *                               (the --mutate commit path).
 *
 * Puro node, sem deps, ASCII puro (o fixture vive sob scripts/__tests__/,
 * fora do MJS_GATE_PATTERNS glob de top-level, mas mantem o padrao).
 */
import fs from "node:fs"
import path from "node:path"

const kind = process.argv[2]
const args = process.argv.slice(3)

const stateDir = process.env.CI_PROOF_FAKE_STATE
if (!stateDir) {
  process.stderr.write("fake bins: CI_PROOF_FAKE_STATE nao definido\n")
  process.exit(9)
}
const stateFile = path.join(stateDir, "state.json")
const logFile = path.join(stateDir, "invocations.log")

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(stateFile, "utf8"))
  } catch {
    return { currentBranch: "base", branches: {}, pollCount: 0 }
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
  if (args[0] === "rev-parse" && args[1] === "--verify") {
    // --verify --quiet refs/heads/<b> - exit 0 when the branch exists.
    const ref = args[3] ?? ""
    if (state.branches[ref]) ok()
    process.exit(1)
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
  if (args[0] === "status") {
    out(process.env.CI_PROOF_FAKE_DIRTY === "1" ? " M mutated.ts\n" : "")
    ok()
  }
  if (args[0] === "add") {
    ok()
  }
  if (args[0] === "commit") {
    ok()
  }
  if (args[0] === "push" && args[2] === "--delete") {
    delete state.branches[`refs/heads/${args[3]}`]
    saveState(state)
    ok()
  }
  if (args[0] === "push") {
    state.branches[`refs/heads/${args[2]}`] = true
    saveState(state)
    ok()
  }
  if (args[0] === "branch" && args[1] === "-D") {
    delete state.branches[`refs/heads/${args[2]}`]
    saveState(state)
    ok()
  }
  process.stderr.write(`fake git: shape nao esperado: ${args.join(" ")}\n`)
  process.exit(9)
}

if (kind === "gh") {
  if (args[0] === "workflow" && args[1] === "view") {
    if (process.env.CI_PROOF_FAKE_GH_MODE === "wf-404") {
      process.stderr.write("HTTP 404: not found (workflow so existe na branch scratch - Prova 7)\n")
      process.exit(1)
    }
    ok()
  }
  if (args[0] === "workflow" && args[1] === "run") {
    ok()
  }
  if (args[0] === "run" && args[1] === "list") {
    state.pollCount += 1
    saveState(state)
    const poll = Number(process.env.CI_PROOF_FAKE_GH_POLL || 0)
    const done = state.pollCount > poll
    out(
      JSON.stringify({
        databaseId: 777,
        status: done ? "completed" : "in_progress",
        conclusion: done ? process.env.CI_PROOF_FAKE_GH_CONCLUSION || "success" : null,
        url: done ? "https://github.com/severinno/severinno/actions/runs/777" : "https://github.com/severinno/severinno/actions/runs/777",
      }),
    )
    ok()
  }
  if (args[0] === "run" && args[1] === "view" && args.includes("--log")) {
    out(process.env.CI_PROOF_FAKE_GH_LOG ?? "fake log line\n")
    ok()
  }
  process.stderr.write(`fake gh: shape nao esperado: ${args.join(" ")}\n`)
  process.exit(9)
}

process.stderr.write(`fake bins: kind desconhecido: ${kind}\n`)
process.exit(9)
