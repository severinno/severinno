/**
 * ci-proof-run.mjs - o ciclo completo de prova-CI num comando (2026-08).
 *
 * The manual Prova 6-12 cycle (branch scratch -> mutacao -> push -> dispatch
 * -> poll -> capturar log -> reverter) vira UM comando. Two test layers:
 *
 * 1. PURE (no subprocess): parseArgs (usage errors, defaults), the Type E
 *    namespace contract (isCiProofBranch - main/develop/v* RECUSADOS), the
 *    --dry-run plan order (planSteps), and the outcome check
 *    (verifyOutcome - expect conclusion + expect-log regex).
 *
 * 2. FAKE-BIN E2E (hermetic, no real git/gh): the CLI spawns git/gh via
 *    CI_PROOF_GIT / CI_PROOF_GH (pointed at the fake fixture
 *    ci-proof-fake-bins.mjs), so the FULL cycle runs against scripted
 *    responses. The fixture records every invocation to a state dir - the
 *    tests assert the CYCLE ORDER (create -> push -> dispatch -> poll ->
 *    capture -> revert) and the exit codes (0 ok, 1 expect mismatch, 3
 *    infra: Prova 7 404 / poll timeout). Nothing outside the temp dir is
 *    touched - no branch is created in the real repo, no run dispatched.
 *
 * Subprocess-heavy (every e2e test spawns the CLI via runSubprocess) ->
 * explicit timeout on every it() (the scan-timeouts guard requires it).
 */
import { afterEach, describe, expect, it } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { cleanupTempDirs, createTempDir, runSubprocess } from "./golden-copy-utils"
import { CI_PROOF_NAMESPACE, DANGER_REFS } from "../workflow-contracts.mjs"
import { isCiProofBranch, parseArgs, planSteps, verifyOutcome } from "../ci-proof-run.mjs"

const SCRIPT = path.resolve(process.cwd(), "scripts", "ci-proof-run.mjs")
const FAKE = path.resolve(process.cwd(), "scripts", "__tests__", "fixtures", "ci-proof-fake-bins.mjs")

/** Run the CLI with the fake bins pointed at a fresh state dir. */
function runCli(args: string[], extraEnv: Record<string, string> = {}) {
  const stateDir = createTempDir("ci-proof-state-")
  return {
    result: runSubprocess({
      command: process.execPath,
      args: [SCRIPT, ...args],
      env: {
        CI_PROOF_GIT: FAKE,
        CI_PROOF_GH: FAKE,
        CI_PROOF_FAKE_STATE: stateDir,
        CI_PROOF_POLL_MS: "50",
        ...extraEnv,
      },
    }),
    stateDir,
  }
}

/** The recorded git/gh invocations in order (one line per call). */
function invocations(stateDir: string): string[] {
  const f = path.join(stateDir, "invocations.log")
  return fs.existsSync(f) ? fs.readFileSync(f, "utf8").split("\n").filter(Boolean) : []
}

/**
 * Invocations joined into ONE string: toContain/indexOf become SUBSTRING
 * matches (the fake records full command lines - e.g.
 * `gh:run list --workflow x --branch y --limit 1 --json ... --jq .[0]` -
 * so an array-level toContain with a partial line would be exact-match and
 * miss).
 */
function invJoined(stateDir: string): string {
  return invocations(stateDir).join("\n")
}

/** stdout + stderr (fail() prints to console.error = stderr). */
function allOutput(r: { stdout: string; stderr: string }): string {
  return r.stdout + "\n" + r.stderr
}

describe("ci-proof-run.mjs - ciclo prova-CI num comando (Type E + Prova 7 travadas)", () => {
  afterEach(cleanupTempDirs)

  // ── PURE: parseArgs ────────────────────────────────────────────────────
  it("parseArgs: --branch e --workflow obrigatorios (usage error, exit 2 pelo CLI)", () => {
    expect(parseArgs([]).error).toContain("usage:")
    expect(parseArgs(["--branch", "ci-proof/x"]).error).toContain("usage:")
    expect(parseArgs(["--workflow", "pr-check.yml"]).error).toContain("usage:")
    expect(parseArgs(["--branch", "ci-proof/x", "--workflow", "pr-check.yml", "--bogus"]).error).toContain("flag desconhecida")
  })

  it("parseArgs: defaults (timeout 900, keep false, dryRun false) + flags parse", () => {
    const o = parseArgs(["--branch", "ci-proof/x", "--workflow", "pr-check.yml", "--mutate", "echo hi", "--expect", "failure", "--expect-log", "FUZZ", "--timeout", "60", "--keep-branch", "--dry-run"])
    expect(o.error).toBeNull()
    expect(o.branch).toBe("ci-proof/x")
    expect(o.workflow).toBe("pr-check.yml")
    expect(o.mutate).toBe("echo hi")
    expect(o.expect).toBe("failure")
    expect(o.expectLog).toBe("FUZZ")
    expect(o.timeout).toBe(60)
    expect(o.keep).toBe(true)
    expect(o.dryRun).toBe(true)
  })

  // ── PURE: Type E namespace contract ────────────────────────────────────
  it("isCiProofBranch: aceita ci-proof/<nome> (o namespace deriva do manifest)", () => {
    expect(CI_PROOF_NAMESPACE).toBe("ci-proof")
    expect(isCiProofBranch("ci-proof/fuzz-batch")).toBe(true)
    expect(isCiProofBranch("ci-proof/spread-live")).toBe(true)
  })

  it("isCiProofBranch: RECUSA main/develop/v*/branch sem namespace (Type E - DANGER_REFS)", () => {
    expect(isCiProofBranch("main")).toBe(false)
    expect(isCiProofBranch("develop")).toBe(false)
    expect(isCiProofBranch("v0.4.0")).toBe(false)
    expect(isCiProofBranch("ci-proof")).toBe(false)
    expect(isCiProofBranch("ci-proof/a/b")).toBe(false)
    expect(isCiProofBranch("feature/x")).toBe(false)
    expect(DANGER_REFS.map((d) => d.ref)).toContain("main")
    expect(DANGER_REFS.map((d) => d.workflow)).toContain("deploy.yml")
  })

  // ── PURE: dry-run plan order ───────────────────────────────────────────
  it("planSteps: o ciclo completo na ordem (create -> push -> dispatch -> poll -> capture -> verify -> revert)", () => {
    const steps = planSteps(
      { branch: "ci-proof/x", workflow: "pr-check.yml", mutate: null, expect: "failure", expectLog: "FUZZ JOB", keep: false },
      "main",
    )
    const joined = steps.join("\n")
    expect(joined).toContain("checkout -b ci-proof/x")
    expect(joined).toContain("push origin ci-proof/x")
    expect(joined).toContain("workflow view pr-check.yml  (Prova 7")
    expect(joined).toContain("workflow run pr-check.yml --ref ci-proof/x")
    expect(joined).toContain("run list --workflow pr-check.yml --branch ci-proof/x")
    expect(joined).toContain("run view <id> --log")
    expect(joined).toContain("conclusion==failure")
    expect(joined.indexOf("push origin ci-proof/x")).toBeLessThan(joined.indexOf("workflow run"))
    expect(joined.indexOf("workflow run")).toBeLessThan(joined.indexOf("run list"))
    expect(joined.indexOf("run list")).toBeLessThan(joined.indexOf("run view"))
    expect(joined.indexOf("run view")).toBeLessThan(joined.indexOf("push origin --delete"))
    expect(joined.indexOf("push origin --delete")).toBeLessThan(joined.indexOf("branch -D"))
  })

  it("planSteps: --keep-branch omite o revert e --mutate adiciona o commit", () => {
    const keep = planSteps({ branch: "ci-proof/x", workflow: "pr-check.yml", mutate: null, expect: null, expectLog: null, keep: true }, "main")
    expect(keep.join("\n")).not.toContain("push origin --delete")
    expect(keep.join("\n")).toContain("--keep-branch: branch scratch mantida")
    const mut = planSteps({ branch: "ci-proof/x", workflow: "pr-check.yml", mutate: "touch dirty.ts", expect: null, expectLog: null, keep: false }, "main")
    expect(mut.join("\n")).toContain("touch dirty.ts")
    expect(mut.join("\n")).toContain('commit -m "ci-proof: ci-proof/x"')
  })

  // ── PURE: outcome check ────────────────────────────────────────────────
  it("verifyOutcome: expect conclusion + expect-log regex (match e mismatch)", () => {
    expect(verifyOutcome("failure", "failure", "log FUZZ JOB line", "FUZZ JOB").ok).toBe(true)
    expect(verifyOutcome("success", null, "anything", null).ok).toBe(true)
    expect(verifyOutcome("success", "failure", "log", null).ok).toBe(false)
    expect(verifyOutcome("success", "success", "log", "NOT THERE").ok).toBe(false)
  })

  // ── FAKE-BIN E2E: full cycle success ──────────────────────────────────
  it("E2E sucesso: ciclo completo com fake bins -> exit 0, DONE com run=777, ORDEM create->push->dispatch->poll->capture->revert", () => {
    const { result, stateDir } = runCli(
      ["--branch", "ci-proof/e2e-ok", "--workflow", "pr-check.yml", "--expect", "success"],
      { CI_PROOF_FAKE_GH_LOG: "line1\nline2\n" },
    )
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("dispatched pr-check.yml on ci-proof/e2e-ok")
    expect(result.stdout).toContain("run #777 completed (success)")
    expect(result.stdout).toContain("verify: conclusion=success")
    expect(result.stdout).toContain("revertido (remote ci-proof/e2e-ok deletado")
    expect(result.stdout).toContain("DONE run=777 url=https://github.com/severinno/severinno/actions/runs/777 conclusion=success")
    // The log file was written to the tmpdir and the path printed.
    const logMatch = result.stdout.match(/log capturado em (.+\.log)/)
    expect(logMatch).not.toBeNull()
    expect(fs.existsSync(logMatch![1])).toBe(true)
    // Cycle ORDER: create -> push -> dispatch -> poll -> capture -> revert.
    // Substring matches over the joined log (the recorded lines carry the
    // full arg tails - e.g. run list appends --json ... --jq .[0]).
    const inv = invJoined(stateDir)
    for (const o of ["git:checkout -b ci-proof/e2e-ok", "git:push origin ci-proof/e2e-ok", "gh:workflow view pr-check.yml", "gh:workflow run pr-check.yml --ref ci-proof/e2e-ok", "gh:run list --workflow pr-check.yml --branch ci-proof/e2e-ok"]) {
      expect(inv).toContain(o)
    }
    expect(inv.indexOf("git:push origin ci-proof/e2e-ok")).toBeLessThan(inv.indexOf("gh:workflow run"))
    expect(inv.indexOf("gh:workflow run")).toBeLessThan(inv.indexOf("gh:run list"))
    expect(inv.indexOf("gh:run list")).toBeLessThan(inv.indexOf("gh:run view 777 --log"))
    expect(inv.indexOf("gh:run view 777 --log")).toBeLessThan(inv.indexOf("git:push origin --delete ci-proof/e2e-ok"))
    expect(inv.indexOf("git:push origin --delete ci-proof/e2e-ok")).toBeLessThan(inv.indexOf("git:branch -D ci-proof/e2e-ok"))
  }, 60000)

  // ── FAKE-BIN E2E: expect mismatch reverts anyway ──────────────────────
  it("E2E mismatch: --expect success mas conclusion=failure -> exit 1 (revert MESMO ASSIM)", () => {
    const { result } = runCli(["--branch", "ci-proof/e2e-mismatch", "--workflow", "pr-check.yml", "--expect", "success"], {
      CI_PROOF_FAKE_GH_CONCLUSION: "failure",
    })
    expect(result.status).toBe(1)
    expect(result.stdout).toContain("verify: conclusion=failure != esperado success")
    expect(result.stdout).toContain("revertido")
    expect(result.stdout).toContain("DONE run=777")
  }, 60000)

  it("E2E mutate: --mutate altera a tree (FAKE_DIRTY) -> add + commit no ciclo", () => {
    const { result, stateDir } = runCli(["--branch", "ci-proof/e2e-mut", "--workflow", "pr-check.yml", "--mutate", "echo mutation"], {
      CI_PROOF_FAKE_DIRTY: "1",
    })
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("aplicando mutacao: echo mutation")
    expect(result.stdout).toContain("mutacao commitada em ci-proof/e2e-mut")
    const inv = invJoined(stateDir)
    expect(inv).toContain("git:add -A")
    expect(inv).toContain("git:commit -m ci-proof: ci-proof/e2e-mut")
    expect(inv.indexOf("git:add -A")).toBeLessThan(inv.indexOf("git:commit"))
    expect(inv.indexOf("git:commit")).toBeLessThan(inv.indexOf("git:push origin ci-proof/e2e-mut"))
  }, 60000)

  // ── FAKE-BIN E2E: --expect-log mismatch ────────────────────────────────
  it("E2E expect-log: regex nao casa o log capturado -> exit 1", () => {
    const { result } = runCli(["--branch", "ci-proof/e2e-log", "--workflow", "pr-check.yml", "--expect-log", "NOT-THERE"], {
      CI_PROOF_FAKE_GH_LOG: "some log\nwithout the marker\n",
    })
    expect(result.status).toBe(1)
    expect(result.stdout).toContain("log nao casa /NOT-THERE/")
    expect(result.stdout).toContain("revertido")
  }, 60000)

  it("E2E dry-run: imprime o plano, SO o git rev-parse read-only roda (nenhuma mutacao/push/dispatch)", () => {
    const { result, stateDir } = runCli(["--branch", "ci-proof/e2e-dry", "--workflow", "pr-check.yml", "--dry-run"])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("PLAN (dry-run) branch=ci-proof/e2e-dry")
    expect(result.stdout).toContain("checkout -b ci-proof/e2e-dry")
    // O dry-run SO resolve a branch de retorno (git rev-parse read-only) -
    // nada de checkout/push/dispatch/revert executa.
    expect(invocations(stateDir)).toEqual(["git:rev-parse --abbrev-ref HEAD"])
  }, 60000)

  // ── FAKE-BIN E2E: Prova 7 dispatch-404 class ───────────────────────────
  it("E2E Prova 7: gh workflow view 404 (workflow fora do default branch) -> exit 3 com a nota, revert acontece", () => {
    const { result } = runCli(["--branch", "ci-proof/e2e-404", "--workflow", "dispatch-only.yml"], {
      CI_PROOF_FAKE_GH_MODE: "wf-404",
    })
    expect(result.status).toBe(3)
    // A nota da Prova 7 vai pro STDERR (fail() = console.error).
    expect(allOutput(result)).toContain("PROVA 7: dispatch 404 para workflows fora do default branch")
    expect(result.stdout).toContain("revertido")
  }, 60000)

  // ── FAKE-BIN E2E: poll timeout ─────────────────────────────────────────
  it("E2E timeout: run nunca completa (poll infinito) -> exit 3, revert acontece", () => {
    const { result } = runCli(["--branch", "ci-proof/e2e-timeout", "--workflow", "pr-check.yml", "--timeout", "1"], {
      CI_PROOF_FAKE_GH_POLL: "99999",
    })
    expect(result.status).toBe(3)
    // A msg de timeout vai pro STDERR (fail() = console.error).
    expect(allOutput(result)).toContain("timeout apos 1s")
    expect(result.stdout).toContain("revertido")
  }, 60000)

  // ── FAKE-BIN E2E: branch invalida ──────────────────────────────────────
  it("E2E branch invalida: main/develop/v* RECUSADOS antes de qualquer git/gh (exit 2, zero invocations)", () => {
    for (const bad of ["main", "develop", "v0.4.0"]) {
      const { result, stateDir } = runCli(["--branch", bad, "--workflow", "pr-check.yml"])
      expect(result.status).toBe(2)
      // O aviso do namespace vai pro STDERR (fail() = console.error).
      expect(allOutput(result)).toContain("fora do namespace ci-proof/*")
      expect(invocations(stateDir)).toEqual([])
    }
  }, 60000)

  // ── REAL-REPO CONTRACT: dry-run contra o repo real (sem env fake) ──────
  it("REAL-REPO CONTRACT: --dry-run contra o repo real (git real, read-only) -> exit 0 e plano com a branch atual", () => {
    const r = runSubprocess({ command: process.execPath, args: [SCRIPT, "--branch", "ci-proof/real", "--workflow", "pr-check.yml", "--dry-run"] })
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("PLAN (dry-run)")
    expect(r.stdout).toContain("ci-proof/real")
  }, 60000)
})
