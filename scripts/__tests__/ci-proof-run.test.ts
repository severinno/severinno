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
import { CI_PROOF_NAMESPACE, CI_PROOF_PROBE, DANGER_REFS } from "../workflow-contracts.mjs"
import { isCiProofBranch, parseArgs, planSteps, verifyOutcome, verifyParseReject } from "../ci-proof-run.mjs"

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
        CI_PROOF_LOCAL_BATCH: FAKE, // --expect-local-block: o batch runner do pre-commit via o MESMO fixture (papel 'batch')
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

  it("parseArgs: defaults (timeout 900, keep false, dryRun false, noVerify false) + flags parse", () => {
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
    expect(o.noVerify).toBe(false)
  })

  it("parseArgs: --no-verify parseia e o usage lista a flag (Prova 16 first-class)", () => {
    const o = parseArgs(["--branch", "ci-proof/x", "--workflow", "pr-check.yml", "--no-verify"])
    expect(o.error).toBeNull()
    expect(o.noVerify).toBe(true)
    expect(parseArgs(["--help"]).error).toContain("--no-verify")
  })

  it("parseArgs: --expect-local-block parseia e o usage lista a flag (a contraparte do --no-verify - 2026-08-11)", () => {
    const o = parseArgs(["--branch", "ci-proof/x", "--workflow", "pr-check.yml", "--no-verify", "--mutate", "echo m", "--expect-local-block"])
    expect(o.error).toBeNull()
    expect(o.expectLocalBlock).toBe(true)
    expect(parseArgs(["--help"]).error).toContain("--expect-local-block")
  })

  it("parseArgs: --expect-local-block requer --no-verify (o check so prova o trip quando o hook sera bypassado)", () => {
    const o = parseArgs(["--branch", "ci-proof/x", "--workflow", "pr-check.yml", "--mutate", "echo m", "--expect-local-block"])
    expect(o.error).toContain("--expect-local-block requer --no-verify")
  })

  it("parseArgs: --expect-local-block requer --mutate (o check roda contra a mutacao na working tree)", () => {
    const o = parseArgs(["--branch", "ci-proof/x", "--workflow", "pr-check.yml", "--no-verify", "--expect-local-block"])
    expect(o.error).toContain("--expect-local-block requer --mutate")
  })

  it("parseArgs: --mutate-self-delete parseia e o usage lista a flag (Prova 22/sec 8.17 - self-delete do script TEMP no runner)", () => {
    const o = parseArgs(["--branch", "ci-proof/x", "--workflow", "pr-check.yml", "--mutate", "node s.mjs", "--mutate-self-delete", "scripts/s.mjs"])
    expect(o.error).toBeNull()
    expect(o.mutateSelfDelete).toBe("scripts/s.mjs")
    expect(parseArgs(["--help"]).error).toContain("--mutate-self-delete")
  })

  it("parseArgs: --mutate-self-delete requer --mutate (sem mutacao nao ha script TEMP a remover)", () => {
    const o = parseArgs(["--branch", "ci-proof/x", "--workflow", "pr-check.yml", "--mutate-self-delete", "scripts/s.mjs"])
    expect(o.error).toContain("--mutate-self-delete requer --mutate")
  })

  it("parseArgs: --only-jobs parseia e o usage lista a flag (sec 11.20 - poll por job, nao pelo run)", () => {
    const o = parseArgs(["--branch", "ci-proof/x", "--workflow", "pr-check.yml", "--only-jobs", "check"])
    expect(o.error).toBeNull()
    expect(o.onlyJobs).toBe("check")
    // Sem a flag, onlyJobs fica null (default).
    expect(parseArgs(["--branch", "ci-proof/x", "--workflow", "pr-check.yml"]).onlyJobs).toBeNull()
    expect(parseArgs(["--help"]).error).toContain("--only-jobs")
  })

  it("parseArgs: --expect-parse-reject parseia e o usage lista a flag (a classe Prova 24/sec 8.19 - workflow rejeitado no parse)", () => {
    const o = parseArgs(["--branch", "ci-proof/x", "--workflow", "pr-check.yml", "--expect-parse-reject"])
    expect(o.error).toBeNull()
    expect(o.expectParseReject).toBe(true)
    expect(parseArgs(["--help"]).error).toContain("--expect-parse-reject")
  })

  it("parseArgs: --expect-parse-reject e incompativel com --expect (a flag define o resultado esperado POR INTEIRO: conclusion=failure + 0 jobs)", () => {
    const o = parseArgs(["--branch", "ci-proof/x", "--workflow", "pr-check.yml", "--expect-parse-reject", "--expect", "failure"])
    expect(o.error).toContain("--expect-parse-reject e incompativel com --expect")
  })

  it("parseArgs: --expect-parse-reject e incompativel com --expect-log (nao ha log para casar - 0 jobs, nenhum job rodou)", () => {
    const o = parseArgs(["--branch", "ci-proof/x", "--workflow", "pr-check.yml", "--expect-parse-reject", "--expect-log", "FUZZ"])
    expect(o.error).toContain("--expect-parse-reject e incompativel com --expect-log")
  })

  it("parseArgs: --expect-parse-reject e incompativel com --only-jobs (0 jobs = nao ha job alvo para o poll por job)", () => {
    const o = parseArgs(["--branch", "ci-proof/x", "--workflow", "pr-check.yml", "--expect-parse-reject", "--only-jobs", "check"])
    expect(o.error).toContain("--expect-parse-reject e incompativel com --only-jobs")
  })

  it("parseArgs: default de --timeout calibrado (sec 11.20) - 300s com --only-jobs, 900s sem; --timeout explicito vence", () => {
    // Sem --only-jobs, o default continua 900s (o ciclo completo pode
    // incluir jobs lentos - Security Headers 9:08 no run 31430040398).
    expect(parseArgs(["--branch", "ci-proof/x", "--workflow", "pr-check.yml"]).timeout).toBe(900)
    // Com --only-jobs e sem --timeout, o default cai para 300s (o job alvo
    // nunca passou de ~3min nas provas 13-19 - check 2:47 no mesmo run).
    expect(parseArgs(["--branch", "ci-proof/x", "--workflow", "pr-check.yml", "--only-jobs", "check"]).timeout).toBe(300)
    // Um --timeout explicito SEMPRE vence o default calibrado.
    expect(parseArgs(["--branch", "ci-proof/x", "--workflow", "pr-check.yml", "--only-jobs", "check", "--timeout", "60"]).timeout).toBe(60)
    expect(parseArgs(["--branch", "ci-proof/x", "--workflow", "pr-check.yml", "--timeout", "120"]).timeout).toBe(120)
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

  it("planSteps: --expect-local-block adiciona o passo local-check ANTES do commit (o batch runner do pre-commit DEVE trip - exit != 0)", () => {
    const withFlag = planSteps({ branch: "ci-proof/x", workflow: "pr-check.yml", mutate: "touch dirty.ts", expect: null, expectLog: null, keep: false, noVerify: true, expectLocalBlock: true }, "main")
    const joined = withFlag.join("\n")
    expect(joined).toContain("local-check: node scripts/run-precommit-guards.mjs  (--expect-local-block: o batch runner do pre-commit DEVE trip")
    expect(joined.indexOf("shell: touch dirty.ts")).toBeLessThan(joined.indexOf("local-check:"))
    expect(joined.indexOf("local-check:")).toBeLessThan(joined.indexOf('git: add -A && commit'))
    const without = planSteps({ branch: "ci-proof/x", workflow: "pr-check.yml", mutate: "touch dirty.ts", expect: null, expectLog: null, keep: false }, "main")
    expect(without.join("\n")).not.toContain("local-check:")
  })

  it("planSteps: --mutate-self-delete adiciona o passo self-delete ENTRE o shell e o git add -A (a ordem da Prova 22/sec 8.17 - remover antes do commit)", () => {
    const withFlag = planSteps({ branch: "ci-proof/x", workflow: "pr-check.yml", mutate: "node s.mjs", mutateSelfDelete: "scripts/s.mjs", expect: null, expectLog: null, keep: false }, "main")
    const joined = withFlag.join("\n")
    expect(joined).toContain("self-delete: scripts/s.mjs")
    expect(joined.indexOf("shell: node s.mjs")).toBeLessThan(joined.indexOf("self-delete:"))
    expect(joined.indexOf("self-delete:")).toBeLessThan(joined.indexOf("git: add -A && commit"))
    const without = planSteps({ branch: "ci-proof/x", workflow: "pr-check.yml", mutate: "node s.mjs", expect: null, expectLog: null, keep: false }, "main")
    expect(without.join("\n")).not.toContain("self-delete:")
  })

  it("planSteps: --no-verify adiciona o passo HUSKY=0 (bypass do husky local)", () => {
    const withFlag = planSteps({ branch: "ci-proof/x", workflow: "pr-check.yml", mutate: null, expect: null, expectLog: null, keep: false, noVerify: true }, "main")
    const joined = withFlag.join("\n")
    expect(joined).toContain("env: HUSKY=0 (--no-verify: bypass do husky local no commit/push - Prova 16)")
    expect(joined.indexOf("HUSKY=0")).toBeLessThan(joined.indexOf("push origin ci-proof/x"))
    const without = planSteps({ branch: "ci-proof/x", workflow: "pr-check.yml", mutate: null, expect: null, expectLog: null, keep: false }, "main")
    expect(without.join("\n")).not.toContain("HUSKY=0")
  })

  it("planSteps: --only-jobs troca o poll do run pelo poll do JOB + captura --job (sec 11.20)", () => {
    const withJob = planSteps({ branch: "ci-proof/x", workflow: "pr-check.yml", mutate: null, expect: null, expectLog: null, keep: false, onlyJobs: "check" }, "main")
    const joined = withJob.join("\n")
    expect(joined).toContain("poll do JOB 'check'")
    expect(joined).toContain("gh: run view <id> --json jobs  (resolve o jobId do 'check')")
    expect(joined).toContain("gh: run view <id> --job <jobId> --log")
    expect(joined).not.toContain("gh: run view <id> --log >")
    // Sem a flag, o poll/captura continuam os do run inteiro (a ordem antiga
    // preservada - os asserts de ciclo existentes nao quebram).
    const without = planSteps({ branch: "ci-proof/x", workflow: "pr-check.yml", mutate: null, expect: null, expectLog: null, keep: false }, "main")
    const plain = without.join("\n")
    expect(plain).toContain("poll, timeout")
    expect(plain).toContain("gh: run view <id> --log >")
    expect(plain).not.toContain("poll do JOB")
  })

  it("planSteps: o plano renderiza o timeout RESOLVIDO (300s com --only-jobs, 900s sem - o default calibrado do sec 11.20, nao um numero pendente)", () => {
    const withJob = planSteps({ branch: "ci-proof/x", workflow: "pr-check.yml", mutate: null, expect: null, expectLog: null, keep: false, onlyJobs: "check" }, "main")
    expect(withJob.join("\n")).toContain("timeout 300s")
    const plain = planSteps({ branch: "ci-proof/x", workflow: "pr-check.yml", mutate: null, expect: null, expectLog: null, keep: false }, "main")
    expect(plain.join("\n")).toContain("timeout 900s")
    // Um --timeout explicito renderiza o valor explicitado, nao o default.
    const explicit = planSteps({ branch: "ci-proof/x", workflow: "pr-check.yml", mutate: null, expect: null, expectLog: null, keep: false, onlyJobs: "check", timeout: 60 }, "main")
    expect(explicit.join("\n")).toContain("timeout 60s")
  })

  // ── PURE: outcome check ────────────────────────────────────────────────
  it("verifyOutcome: expect conclusion + expect-log regex (match e mismatch)", () => {
    expect(verifyOutcome("failure", "failure", "log FUZZ JOB line", "FUZZ JOB").ok).toBe(true)
    expect(verifyOutcome("success", null, "anything", null).ok).toBe(true)
    expect(verifyOutcome("success", "failure", "log", null).ok).toBe(false)
    expect(verifyOutcome("success", "success", "log", "NOT THERE").ok).toBe(false)
  })

  it("verifyParseReject: failure + 0 jobs = ok (a classe Prova 24/sec 8.19 - workflow rejeitado no parse); qualquer outro par = nao ok", () => {
    expect(verifyParseReject("failure", 0).ok).toBe(true)
    expect(verifyParseReject("failure", 1).ok).toBe(false)
    expect(verifyParseReject("success", 0).ok).toBe(false)
    expect(verifyParseReject("success", 1).ok).toBe(false)
    // A mensagem pina a contagem de jobs (o sinal verificavel), nao o log.
    expect(verifyParseReject("failure", 1).message).toContain("jobs=1 != 0 esperado")
    expect(verifyParseReject("failure", 0).message).toContain("0 jobs")
  })

  it("planSteps: --expect-parse-reject troca o verify pelo parse-reject (jobs query + conclusao fixa - sem linha de log para casar)", () => {
    const withFlag = planSteps({ branch: "ci-proof/x", workflow: "pr-check.yml", mutate: null, expect: null, expectLog: null, keep: false, expectParseReject: true }, "main")
    const joined = withFlag.join("\n")
    expect(joined).toContain("gh: run view <id> --json jobs")
    expect(joined).toContain("verify: parse-reject (conclusion=failure + 0 jobs")
    expect(joined).not.toContain("conclusion==")
    const without = planSteps({ branch: "ci-proof/x", workflow: "pr-check.yml", mutate: null, expect: null, expectLog: null, keep: false }, "main")
    expect(without.join("\n")).not.toContain("parse-reject")
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

  // ── FAKE-BIN E2E: o probe CI_PROOF_PROBE e aceito (PROBE BOUNDARY) ────
  it("E2E PROBE BOUNDARY: --branch = CI_PROOF_PROBE (ci-proof/proof-branch) e ACEITO -> exit 0 com o ciclo completo (o probe e fixture do Type E, NAO branch reservada - rejeita-lo nao adicionaria seguranca; o limite e o namespace, travado pelo header do isCiProofBranch)", () => {
    const { result, stateDir } = runCli(["--branch", CI_PROOF_PROBE, "--workflow", "pr-check.yml", "--expect", "success"])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain(`dispatched pr-check.yml on ${CI_PROOF_PROBE}`)
    expect(result.stdout).toContain("DONE run=777")
    // O ciclo completo roda com a branch do probe - o runner nao a recusa.
    const inv = invJoined(stateDir)
    expect(inv).toContain(`git:checkout -b ${CI_PROOF_PROBE}`)
    expect(inv).toContain(`gh:workflow run pr-check.yml --ref ${CI_PROOF_PROBE}`)
    expect(inv.indexOf(`git:push origin ${CI_PROOF_PROBE}`)).toBeLessThan(inv.indexOf("gh:workflow run"))
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

  it("E2E --mutate-self-delete: a mutacao cria um script TEMP e o runner o deleta ANTES do git add -A (exit 0, commit acontece SEM o script - o CI tree fica limpo)", () => {
    // O mutate cria um script TEMP real (via env target num tmpdir hermetico)
    // e a flag o remove - o commit scratch nunca carrega o script (Prova
    // 22/sec 8.17). A arvore suja (FAKE_DIRTY) vem da MUTACAO, nao do script.
    const tmpDir = createTempDir("ci-proof-selfdel-")
    const scriptPath = path.join(tmpDir, "mutate-script.mjs")
    const { result, stateDir } = runCli(
      ["--branch", "ci-proof/e2e-selfdel", "--workflow", "pr-check.yml", "--mutate", `node -e "require('fs').writeFileSync(process.env.MUT_TARGET, 'x')"`, "--mutate-self-delete", scriptPath],
      { CI_PROOF_FAKE_DIRTY: "1", MUT_TARGET: scriptPath },
    )
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("--mutate-self-delete: removido")
    // O script TEMP foi removido pelo runner (nao existe mais apos o run).
    expect(fs.existsSync(scriptPath)).toBe(false)
    // O commit da mutacao aconteceu na ordem (o script NAO entrou no add).
    const inv = invJoined(stateDir)
    expect(inv).toContain("git:add -A")
    expect(inv).toContain("git:commit -m ci-proof: ci-proof/e2e-selfdel")
    expect(inv.indexOf("git:add -A")).toBeLessThan(inv.indexOf("git:commit"))
    expect(inv.indexOf("git:commit")).toBeLessThan(inv.indexOf("git:push origin ci-proof/e2e-selfdel"))
  }, 60000)

  it("E2E --mutate-self-delete: path que nao existe apos a mutacao -> exit 3 com a nota fail-loud (um path errado deixaria o script no commit), SEM add/commit/push", () => {
    // Fail-loud: o path passado nao foi criado pela mutacao (path errado) -
    // o no-op silencioso e a classe que o flag fecha (o script TEMP real
    // escaparia para o commit scratch).
    const tmpDir = createTempDir("ci-proof-selfdel-missing-")
    const missingPath = path.join(tmpDir, "never-created.mjs")
    const { result, stateDir } = runCli(
      ["--branch", "ci-proof/e2e-selfdel-missing", "--workflow", "pr-check.yml", "--mutate", "echo mutation", "--mutate-self-delete", missingPath],
      { CI_PROOF_FAKE_DIRTY: "1" },
    )
    expect(result.status).toBe(3)
    // A mensagem real e `--mutate-self-delete: <path> nao existe apos a
    // mutacao` - o path fica ENTRE os dois trechos (asserts separados).
    expect(allOutput(result)).toContain("--mutate-self-delete:")
    expect(allOutput(result)).toContain("nao existe apos a mutacao")
    // Nenhum git de escrita rodou (a falha e ANTES do status/add -A).
    const inv = invocations(stateDir)
    expect(inv).not.toContain("git:add -A")
    expect(inv).not.toContain("git:commit")
    expect(inv).not.toContain("git:push origin ci-proof/e2e-selfdel-missing")
  }, 60000)

  it("E2E --mutate-self-delete sem --mutate: usage error (exit 2) ANTES de qualquer spawn", () => {
    const { result, stateDir } = runCli(["--branch", "ci-proof/e2e-selfdel-usage", "--workflow", "pr-check.yml", "--mutate-self-delete", "scripts/s.mjs"], {
      CI_PROOF_FAKE_DIRTY: "1",
    })
    expect(result.status).toBe(2)
    expect(allOutput(result)).toContain("--mutate-self-delete requer --mutate")
    expect(invocations(stateDir)).toEqual([])
  }, 60000)

  it("E2E self-delete SCRIPT-OWNED (Prova 22/sec 8.17): um mutate script REAL que se auto-deleta como ultima linha NAO aparece no git status pos-ciclo - o script some no spawn do mutate (antes do add -A), o ciclo commita so a mutacao e o tree fica limpo SEM a flag do runner", () => {
    // O padrao ORIGINAL da Prova 22 (anterior a 11.27): o script de mutacao
    // TEMP se auto-deleta como ultima linha (fs.rmSync de si mesmo via
    // fileURLToPath(import.meta.url)) - SEM nenhuma flag. A 11.27 travou o
    // caminho do RUNNER (--mutate-self-delete + fail-loud: flag + script
    // auto-deletado = exit 3, o path sumiu antes do runner olhar); este pina
    // o caminho do SCRIPT (o lado positivo do par mutuamente exclusivo). O
    // observavel hermetico: o script EXISTE antes do ciclo, o spawn do mutate
    // o roda (escreve o marcador) e o self-delete o remove DURANTE o spawn -
    // o git status/add -A do ciclo (sequencial, DEPOIS do spawn) nunca o ve.
    const tmpDir = createTempDir("ci-proof-selfdel-script-")
    const scriptPath = path.join(tmpDir, "mutate-script.mjs")
    const markerPath = path.join(tmpDir, "mutated.txt")
    // O script REAL: escreve o marcador (a mutacao) E se auto-deleta.
    fs.writeFileSync(
      scriptPath,
      [
        'import fs from "node:fs"',
        'import { fileURLToPath } from "node:url"',
        'fs.writeFileSync(process.env.MUT_MARKER, "mutated")',
        'fs.rmSync(fileURLToPath(import.meta.url))',
      ].join("\n"),
      "utf8",
    )
    const { result, stateDir } = runCli(
      ["--branch", "ci-proof/e2e-selfdel-script", "--workflow", "pr-check.yml", "--mutate", `node "${scriptPath}"`],
      { CI_PROOF_FAKE_DIRTY: "1", MUT_MARKER: markerPath },
    )
    expect(result.status).toBe(0)
    // O script RODOU (o marcador existe) E se auto-deletou durante o spawn do
    // mutate - o git status/add -A do ciclo (sequencial, apos o spawn) nunca
    // o viu: o CI tree fica limpo sem a flag do runner.
    expect(fs.existsSync(markerPath)).toBe(true)
    expect(fs.existsSync(scriptPath)).toBe(false)
    // A remocao foi do SCRIPT, nao do runner: o runner NAO emitiu a msg de
    // remocao (a flag nao foi passada) e o script sumiu sozinho.
    expect(result.stdout).not.toContain("--mutate-self-delete: removido")
    // A mutacao foi commitada normalmente (a sujeira veio do FAKE_DIRTY
    // scriptado - o contrato aqui e o SUMICO do script, nao o conteudo do
    // commit; o commit acontece DEPOIS do spawn, quando o script ja sumiu).
    expect(result.stdout).toContain("mutacao commitada em ci-proof/e2e-selfdel-script")
    const inv = invJoined(stateDir)
    expect(inv).toContain("git:status --porcelain")
    expect(inv).toContain("git:add -A")
    expect(inv).toContain("git:commit -m ci-proof: ci-proof/e2e-selfdel-script")
    expect(inv.indexOf("git:status --porcelain")).toBeLessThan(inv.indexOf("git:add -A"))
    expect(inv.indexOf("git:add -A")).toBeLessThan(inv.indexOf("git:commit"))
  }, 60000)

  it("CONTRACT (sec 11.27/11.28): o par mutuamente exclusivo num UNICO lugar - o MESMO script auto-deletado com flag -> exit 3 fail-loud (o path sumiu ANTES do runner olhar, SEM add/commit/push) e sem flag -> ciclo exit 0 (SCRIPT-OWNED, o script some no spawn e o commit acontece)", () => {
    // A fronteira runner-owned (11.27) vs SCRIPT-OWNED (11.28) provada como
    // par com a MESMA arma nos dois lados: o script TEMP que se auto-deleta
    // como ultima linha. Com a flag, o runner olha o path DEPOIS do spawn e
    // o acha sumido -> fail-loud exit 3 (a contradicao documentada: flag +
    // script auto-deletado = o path sumiu antes do runner olhar, e um no-op
    // silencioso deixaria o script no commit scratch). Sem a flag, o
    // self-delete acontece DURANTE o spawn do mutate e o git status/add -A
    // sequencial nunca o ve -> ciclo exit 0 com o tree limpo. As duas
    // ownerships sao MUTUAMENTE EXCLUSIVAS: o mesmo script, resultados
    // opostos conforme a flag.
    const tmpDir = createTempDir("ci-proof-selfdel-contract-")
    const scriptPath = path.join(tmpDir, "mutate-script.mjs")
    const markerA = path.join(tmpDir, "mutated-a.txt")
    const scriptBody = [
      'import fs from "node:fs"',
      'import { fileURLToPath } from "node:url"',
      'fs.writeFileSync(process.env.MUT_MARKER, "mutated")',
      'fs.rmSync(fileURLToPath(import.meta.url))',
    ].join("\n")

    // Lado A (runner-owned): flag + script auto-deletado -> exit 3 fail-loud.
    fs.writeFileSync(scriptPath, scriptBody, "utf8")
    const a = runCli(
      ["--branch", "ci-proof/contract-runner", "--workflow", "pr-check.yml", "--mutate", `node "${scriptPath}"`, "--mutate-self-delete", scriptPath],
      { CI_PROOF_FAKE_DIRTY: "1", MUT_MARKER: markerA },
    )
    expect(a.result.status).toBe(3)
    expect(allOutput(a.result)).toContain("--mutate-self-delete:")
    expect(allOutput(a.result)).toContain("nao existe apos a mutacao")
    // O script RODOU e se auto-deletou (o marcador existe, o path sumiu) - o
    // que distingue este caso do teste do path NUNCA-criado: aqui a
    // contradicao documentada (flag + script auto-deletado = o path sumiu
    // ANTES do runner olhar) e provada, nao so um path errado.
    expect(fs.existsSync(markerA)).toBe(true)
    expect(fs.existsSync(scriptPath)).toBe(false)
    // Nenhum git de escrita rodou (a falha e ANTES do status/add -A).
    expect(invocations(a.stateDir)).not.toContain("git:add -A")
    expect(invocations(a.stateDir)).not.toContain("git:commit")

    // Lado B (SCRIPT-OWNED): o MESMO script sem flag -> exit 0, o script
    // some no spawn (nunca chega ao add -A) e a mutacao e commitada.
    fs.writeFileSync(scriptPath, scriptBody, "utf8") // o lado A sumiu com o script
    const markerB = path.join(tmpDir, "mutated-b.txt")
    const b = runCli(
      ["--branch", "ci-proof/contract-script", "--workflow", "pr-check.yml", "--mutate", `node "${scriptPath}"`],
      { CI_PROOF_FAKE_DIRTY: "1", MUT_MARKER: markerB },
    )
    expect(b.result.status).toBe(0)
    expect(fs.existsSync(markerB)).toBe(true) // o script RODOU (a mutacao aconteceu)
    expect(fs.existsSync(scriptPath)).toBe(false) // e se auto-deletou durante o spawn
    expect(b.result.stdout).not.toContain("--mutate-self-delete: removido") // a remocao foi do SCRIPT
    expect(b.result.stdout).toContain("mutacao commitada em ci-proof/contract-script")
    const invB = invJoined(b.stateDir)
    expect(invB).toContain("git:add -A")
    expect(invB).toContain("git:commit -m ci-proof: ci-proof/contract-script")
    expect(invB.indexOf("git:add -A")).toBeLessThan(invB.indexOf("git:commit"))
  }, 60000)

  // ── FAKE-BIN E2E: --only-jobs (sec 11.20 - poll por JOB, nao pelo run) ─
  it("E2E --only-jobs: o poll termina quando o JOB alvo conclui (o run pode seguir in_progress) - captura via --job, verify contra a conclusao do JOB -> exit 0", () => {
    const { result, stateDir } = runCli(["--branch", "ci-proof/e2e-onlyjobs", "--workflow", "pr-check.yml", "--only-jobs", "check", "--expect", "failure"], {
      CI_PROOF_FAKE_GH_JOBS: "1",
      CI_PROOF_FAKE_GH_JOB_NAME: "check",
      CI_PROOF_FAKE_GH_JOB_STATUS: "completed",
      CI_PROOF_FAKE_GH_JOB_CONCLUSION: "failure",
      CI_PROOF_FAKE_GH_LOG: "real-repo contract line\n",
    })
    expect(result.status).toBe(0)
    // A mensagem do ciclo identifica o JOB (nao o run) como o sinal.
    expect(result.stdout).toContain("run #777 job 'check' completed (failure)")
    expect(result.stdout).toContain("verify: conclusion=failure")
    expect(result.stdout).toContain("DONE run=777 url=https://github.com/severinno/severinno/actions/runs/777 conclusion=failure")
    expect(result.stdout).toContain("revertido")
    // O ciclo agora consulta os jobs do run (poll por job) e captura o log
    // do JOB (--job 42 --log) - nao o do run inteiro.
    const inv = invJoined(stateDir)
    expect(inv).toContain("gh:run view 777 --json jobs")
    expect(inv).toContain("gh:run view 777 --job 42 --log")
    expect(inv).not.toContain("gh:run view 777 --log")
    expect(inv.indexOf("gh:run view 777 --json jobs")).toBeLessThan(inv.indexOf("gh:run view 777 --job 42 --log"))
  }, 60000)

  it("E2E --only-jobs EARLY-EXIT: o run fica in_progress PARA SEMPRE (POLL=99999, o caso Security Headers do sec 11.20) mas o JOB alvo conclui -> exit 0 no 1o poll do job (o ciclo NAO espera o run inteiro - o coracao do lever)", () => {
    const { result, stateDir } = runCli(["--branch", "ci-proof/e2e-oj-early", "--workflow", "pr-check.yml", "--only-jobs", "check", "--expect", "failure"], {
      CI_PROOF_FAKE_GH_POLL: "99999", // run list NUNCA completa (Security Headers seguindo em background)
      CI_PROOF_FAKE_GH_JOBS: "1",
      CI_PROOF_FAKE_GH_JOB_NAME: "check",
      CI_PROOF_FAKE_GH_JOB_STATUS: "completed", // o JOB alvo ja concluiu no 1o poll
      CI_PROOF_FAKE_GH_JOB_CONCLUSION: "failure",
    })
    expect(result.status).toBe(0)
    // O ciclo termina pelo JOB, nao pelo run - a mensagem identifica o
    // job completed enquanto o run segue in_progress.
    expect(result.stdout).toContain("run #777 job 'check' completed (failure)")
    expect(result.stdout).toContain("DONE run=777 url=https://github.com/severinno/severinno/actions/runs/777 conclusion=failure")
    expect(result.stdout).toContain("revertido")
    // O poll consultou os jobs do run (a fonte do early-exit) - o run list
    // nunca chegou a completed, mas o ciclo nao esperou por ele.
    const inv = invJoined(stateDir)
    expect(inv).toContain("gh:run view 777 --json jobs")
    expect(inv).toContain("gh:run view 777 --job 42 --log")
  }, 60000)

  it("E2E --only-jobs: job alvo NAO existe no run (run completou sem ele) -> exit 3 com a lista de jobs, revert acontece", () => {
    // CI_PROOF_FAKE_GH_JOBS nao setado = jobs vazio (o fixture responde
    // { jobs: [] } ao poll) - o run completou (poll default 0) mas o job
    // 'check' nunca aparece: a classe "nome de job errado" nao pode virar
    // poll infinito ate o timeout.
    const { result } = runCli(["--branch", "ci-proof/e2e-oj-missing", "--workflow", "pr-check.yml", "--only-jobs", "check", "--timeout", "5"], {
      CI_PROOF_FAKE_GH_JOBS: "0",
    })
    expect(result.status).toBe(3)
    expect(allOutput(result)).toContain("job 'check' nao encontrado no run #777")
    expect(result.stdout).toContain("revertido")
  }, 60000)

  it("E2E --only-jobs: job alvo fica in_progress ate o timeout -> exit 3 (o poll nao mente sobre a conclusao do run)", () => {
    const { result } = runCli(["--branch", "ci-proof/e2e-oj-timeout", "--workflow", "pr-check.yml", "--only-jobs", "check", "--timeout", "1"], {
      CI_PROOF_FAKE_GH_JOBS: "1",
      CI_PROOF_FAKE_GH_JOB_NAME: "check",
      CI_PROOF_FAKE_GH_JOB_STATUS: "in_progress",
    })
    expect(result.status).toBe(3)
    expect(allOutput(result)).toContain("job 'check' nao completou no run #777")
    expect(result.stdout).toContain("revertido")
  }, 60000)

  // ── FAKE-BIN E2E: --no-verify (Prova 16 first-class) ───────────────────
  it("E2E --no-verify: a flag seta HUSKY=0 no env de TODOS os spawns git (commit + push + push --delete) - husky.log registra o wiring", () => {
    const { result, stateDir } = runCli(["--branch", "ci-proof/e2e-noverify", "--workflow", "pr-check.yml", "--no-verify", "--mutate", "echo mutation"], {
      CI_PROOF_FAKE_DIRTY: "1",
    })
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("--no-verify - HUSKY=0 (bypass do husky local no ciclo")
    const huskyLog = path.join(stateDir, "husky.log")
    expect(fs.existsSync(huskyLog)).toBe(true)
    const h = fs.readFileSync(huskyLog, "utf8")
    // O triplo git de escrita do ciclo herda HUSKY=0 (commit bloqueado pelo
    // pre-commit, push e push --delete bloqueados pelo pre-push - Prova 16).
    expect(h).toContain("git:commit -m ci-proof: ci-proof/e2e-noverify")
    expect(h).toContain("git:push origin ci-proof/e2e-noverify")
    expect(h).toContain("git:push origin --delete ci-proof/e2e-noverify")
    // O invocations.log segue intacto para os asserts de ordem existentes.
    const inv = invJoined(stateDir)
    expect(inv.indexOf("git:commit")).toBeLessThan(inv.indexOf("git:push origin ci-proof/e2e-noverify"))
    expect(inv.indexOf("git:push origin ci-proof/e2e-noverify")).toBeLessThan(inv.indexOf("git:push origin --delete"))
  }, 60000)

  it("E2E sem --no-verify: NENHUM spawn recebe HUSKY=0 (husky.log ausente) - o bypass e opt-in", () => {
    const { result, stateDir } = runCli(["--branch", "ci-proof/e2e-plain", "--workflow", "pr-check.yml", "--mutate", "echo mutation"], {
      CI_PROOF_FAKE_DIRTY: "1",
    })
    expect(result.status).toBe(0)
    expect(result.stdout).not.toContain("--no-verify")
    expect(fs.existsSync(path.join(stateDir, "husky.log"))).toBe(false)
  }, 60000)

  // ── FAKE-BIN E2E: --expect-local-block (a contraparte do --no-verify) ──
  it("E2E --expect-local-block TRIP: o batch runner do pre-commit sai 1 (um gate REAL tripou) -> o ciclo prossegue com o --no-verify -> exit 0 (o bypass mascara um trip legitimo)", () => {
    const { result, stateDir } = runCli(["--branch", "ci-proof/e2e-elb-trip", "--workflow", "pr-check.yml", "--no-verify", "--mutate", "echo mutation", "--expect-local-block"], {
      CI_PROOF_FAKE_DIRTY: "1",
      CI_PROOF_FAKE_LOCAL_BATCH_EXIT: "1",
    })
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("--expect-local-block OK - o batch runner do pre-commit tripou (exit 1)")
    expect(result.stdout).toContain("mutacao commitada em ci-proof/e2e-elb-trip")
    // O local-check rodou ANTES do commit do ciclo (o batch via fake bins).
    const inv = invJoined(stateDir)
    expect(inv).toContain("batch:")
    expect(inv.indexOf("batch:")).toBeLessThan(inv.indexOf("git:add -A"))
    expect(inv.indexOf("git:add -A")).toBeLessThan(inv.indexOf("git:commit"))
    // O batch tambem herda o HUSKY=0 (o check local roda sob o MESMO env do
    // ciclo - o wiring do --no-verify cobre o papel batch, nao so o git).
    const huskyLog = path.join(stateDir, "husky.log")
    expect(fs.existsSync(huskyLog)).toBe(true)
    expect(fs.readFileSync(huskyLog, "utf8")).toContain("batch:")
  }, 60000)

  it("E2E --expect-local-block NO-TRIP: o batch runner sai 0 (nenhum gate violado) -> exit 3 com a nota de FALSO POSITIVO, SEM commit e SEM push (o --no-verify so deve mascarar um trip real)", () => {
    const { result, stateDir } = runCli(["--branch", "ci-proof/e2e-elb-notrip", "--workflow", "pr-check.yml", "--no-verify", "--mutate", "echo mutation", "--expect-local-block"], {
      CI_PROOF_FAKE_DIRTY: "1",
      CI_PROOF_FAKE_LOCAL_BATCH_EXIT: "0", // default = clean tree
    })
    expect(result.status).toBe(3)
    expect(allOutput(result)).toContain("--expect-local-block: o batch runner do pre-commit NAO tripou (exit 0")
    expect(allOutput(result)).toContain("FALSO POSITIVO")
    // O ciclo PAROU antes do commit: nenhum add/commit/push rodou.
    const inv = invJoined(stateDir)
    expect(inv).toContain("batch:")
    expect(inv).not.toContain("git:add -A")
    expect(inv).not.toContain("git:commit")
    expect(inv).not.toContain("git:push origin ci-proof/e2e-elb-notrip")
  }, 60000)

  it("E2E --expect-local-block sem --no-verify: usage error (exit 2) ANTES de qualquer spawn - o check so faz sentido com o bypass", () => {
    const { result, stateDir } = runCli(["--branch", "ci-proof/e2e-elb-usage", "--workflow", "pr-check.yml", "--mutate", "echo m", "--expect-local-block"], {
      CI_PROOF_FAKE_DIRTY: "1",
    })
    expect(result.status).toBe(2)
    expect(allOutput(result)).toContain("--expect-local-block requer --no-verify")
    expect(invocations(stateDir)).toEqual([])
  }, 60000)

  // ── REAL-REPO CONTRACT: a cadeia do trip do hook local (Prova 16) ──────
  it("REAL-REPO CONTRACT (Prova 16 ACHADO): a mutacao de um gate file TRIPA o hook local - pre-commit roda o batch (run-precommit-guards) que importa scan-guard-gates (o guard de gate file); o bypass e o HUSKY=0 do --no-verify", () => {
    const preCommit = fs.readFileSync(path.resolve(process.cwd(), ".husky", "pre-commit"), "utf8")
    const batch = fs.readFileSync(path.resolve(process.cwd(), "scripts", "run-precommit-guards.mjs"), "utf8")
    // O pre-commit invoca o batch runner dos guards node (sec 11.13/11.16).
    expect(preCommit).toContain("node scripts/run-precommit-guards.mjs")
    // O batch inclui o scan-guard-gates - o guard que falha quando um gate
    // file (pr-check.yml/guard-gates.yml) muda de forma errada (regras 1-9).
    // Logo, um commit que mute um gate file e bloqueado pelo hook local
    // ANTES do push - o ACHADO da Prova 16 (needs: check travou o commit).
    expect(batch).toContain('from "./scan-guard-gates.mjs"')
    // O bypass oficial (shim .husky/_/h) NAO e rastreado (husky regenera no
    // install) - o contrato pina o HUSKY=0 via env wiring no E2E acima
    // (husky.log) E, quando o shim estiver presente, o conteudo do bypass
    // (o teste REAL-REPO CONTRACT do shim abaixo fecha o elo GERADO).
  }, 60000)

  it("REAL-REPO CONTRACT (shim .husky/_/h GERADO, quando presente): o bypass [ \"${HUSKY-}\" = \"0\" ] && exit 0 existe no shim que o husky regenera no install - skip gracioso se ausente (o elo so vale em ambientes com husky instalado)", () => {
    // O shim e regenerado pelo husky a cada install e NAO e git-tracked -
    // por isso o contrato e CONDICIONAL: quando presente (ambiente local com
    // husky instalado), o bypass DEVE estar la; quando ausente (ex.: CI sem
    // husky), o elo nao existe para pinar e o env wiring do E2E (husky.log)
    // ja cobre a semantica do HUSKY=0 em qualquer ambiente.
    const shimPath = path.resolve(process.cwd(), ".husky", "_", "h")
    if (!fs.existsSync(shimPath)) {
      // Skip gracioso: nenhum ambiente local tem o shim para verificar.
      return
    }
    const shim = fs.readFileSync(shimPath, "utf8")
    expect(shim).toContain('[ "${HUSKY-}" = "0" ] && exit 0')
    // O shim e um script shell (nao JS) - o bypass e uma condicao de saida
    // ANTES de qualquer hook real rodar (o guard [ ! -f "$s" ] para hook
    // ausente vem antes, mas o HUSKY=0 e o primeiro bypass de gate), o que
    // o .husky/_/h do husky v15.x garante ao executar o binario.
  }, 60000)

  it("REAL-REPO CONTRACT (--expect-local-block): o runLocalBatch() spawna o MESMO runner do .husky/pre-commit (run-precommit-guards.mjs) - o check local e o hook real, nao um gate paralelo", () => {
    const cli = fs.readFileSync(path.resolve(process.cwd(), "scripts", "ci-proof-run.mjs"), "utf8")
    const preCommit = fs.readFileSync(path.resolve(process.cwd(), ".husky", "pre-commit"), "utf8")
    // O check local usa o MESMO binario do hook (a cadeia Prova 16 completa:
    // pre-commit -> batch -> guards). O seam de teste e env-only
    // (CI_PROOF_LOCAL_BATCH) - o default real e o runner do repo.
    expect(preCommit).toContain("node scripts/run-precommit-guards.mjs")
    expect(cli).toContain("run-precommit-guards.mjs")
    expect(cli).toContain("CI_PROOF_LOCAL_BATCH")
  }, 60000)

  it("REAL-REPO CONTRACT (Prova 22/sec 8.17): o self-delete do script TEMP e do RUNNER - o CLI remove o path ANTES do git status/add -A (rmSync antes do add) e a flag aparece no usage", () => {
    const cli = fs.readFileSync(path.resolve(process.cwd(), "scripts", "ci-proof-run.mjs"), "utf8")
    // O runner e o dono do self-delete (nao o script): rmSync + fail-loud.
    expect(cli).toContain("fs.rmSync(selfDel")
    // A ordem: rmSync acontece ANTES do git status/add -A (o commit scratch
    // nunca carrega o script TEMP - o ACHADO da sec 8.17).
    expect(cli.indexOf("fs.rmSync(selfDel")).toBeLessThan(cli.indexOf('git(["status", "--porcelain"])'))
    // A flag e first-class (usage + parseArgs + validador requer --mutate).
    expect(cli).toContain("--mutate-self-delete <path>")
    expect(cli).toContain("--mutate-self-delete requer --mutate")
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

  // ── FAKE-BIN E2E: --expect-parse-reject (sec 11.35, a classe Prova 24) ─
  it("E2E parse-reject: run failure + 0 jobs + log vazio -> exit 0 (o workflow rejeitado no parse e o resultado ESPERADO, nao uma falha - a classe Prova 24/sec 8.19)", () => {
    const { result, stateDir } = runCli(["--branch", "ci-proof/e2e-parse-reject", "--workflow", "ci.yml", "--expect-parse-reject"], {
      CI_PROOF_FAKE_GH_CONCLUSION: "failure",
      CI_PROOF_FAKE_GH_LOG: "", // 0 jobs = nenhum job rodou = sem log
    })
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("run #777 completed (failure)")
    expect(result.stdout).toContain("parse-reject: 0 job(s) no run #777 (esperado 0)")
    expect(result.stdout).toContain("verify: conclusion=failure + 0 jobs (workflow rejeitado no parse")
    expect(result.stdout).toContain("DONE run=777 url=https://github.com/severinno/severinno/actions/runs/777 conclusion=failure")
    expect(result.stdout).toContain("revertido")
    // O ciclo consulta os jobs do run (o sinal verificavel da classe) -
    // e NAO casa regex de log (nao ha log para casar).
    const inv = invJoined(stateDir)
    expect(inv).toContain("gh:run view 777 --json jobs")
    expect(inv).toContain("gh:run view 777 --log")
    expect(inv.indexOf("gh:run view 777 --json jobs")).toBeLessThan(inv.indexOf("git:push origin --delete ci-proof/e2e-parse-reject"))
  }, 60000)

  it("E2E parse-reject NEGATIVO: run failure MAS com jobs (o workflow NAO foi rejeitado no parse) -> exit 1 com 'jobs=1 != 0 esperado' (a contagem de jobs e o sinal, nao a conclusao)", () => {
    const { result } = runCli(["--branch", "ci-proof/e2e-parse-reject-jobs", "--workflow", "ci.yml", "--expect-parse-reject"], {
      CI_PROOF_FAKE_GH_CONCLUSION: "failure",
      CI_PROOF_FAKE_GH_JOBS: "1", // 1 job rodou = nao foi rejeitado no parse
      CI_PROOF_FAKE_GH_JOB_NAME: "check",
      CI_PROOF_FAKE_GH_JOB_STATUS: "completed",
      CI_PROOF_FAKE_GH_JOB_CONCLUSION: "failure",
    })
    expect(result.status).toBe(1)
    expect(result.stdout).toContain("parse-reject: 1 job(s) no run #777 (esperado 0)")
    expect(result.stdout).toContain("verify: jobs=1 != 0 esperado")
    expect(result.stdout).toContain("revertido")
  }, 60000)

  it("E2E parse-reject usage: --expect-parse-reject --expect failure -> exit 2 ANTES de qualquer spawn (a flag define o resultado por inteiro)", () => {
    const { result, stateDir } = runCli(["--branch", "ci-proof/e2e-parse-reject-usage", "--workflow", "ci.yml", "--expect-parse-reject", "--expect", "failure"])
    expect(result.status).toBe(2)
    expect(allOutput(result)).toContain("--expect-parse-reject e incompativel com --expect")
    expect(invocations(stateDir)).toEqual([])
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

  // ── REAL-REPO CONTRACT: o wiring do --expect-parse-reject (sec 11.35) ──
  it("REAL-REPO CONTRACT (sec 11.35): o CLI consulta os jobs do run (--json jobs) e verifica a classe parse-reject (failure + 0 jobs) - o log vazio e consequencia de 0 jobs, o sinal e a contagem", () => {
    const cli = fs.readFileSync(path.resolve(process.cwd(), "scripts", "ci-proof-run.mjs"), "utf8")
    // A flag e first-class (usage + parseArgs + validadores de exclusividade).
    expect(cli).toContain("--expect-parse-reject")
    expect(cli).toContain("--expect-parse-reject e incompativel com --expect")
    expect(cli).toContain("--expect-parse-reject e incompativel com --expect-log")
    expect(cli).toContain("--expect-parse-reject e incompativel com --only-jobs")
    // O verify dedicado: consulta os jobs (o sinal verificavel) e pina 0.
    expect(cli).toContain("verifyParseReject")
    expect(cli).toContain('gh(["run", "view", String(runInfo.databaseId), "--json", "jobs"])')
    expect(cli).toContain("parse-reject: ")
  }, 60000)

  // ── REAL-REPO CONTRACT: dry-run contra o repo real (sem env fake) ──────
  it("REAL-REPO CONTRACT: --dry-run contra o repo real (git real, read-only) -> exit 0 e plano com a branch atual", () => {
    const r = runSubprocess({ command: process.execPath, args: [SCRIPT, "--branch", "ci-proof/real", "--workflow", "pr-check.yml", "--dry-run"] })
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("PLAN (dry-run)")
    expect(r.stdout).toContain("ci-proof/real")
  }, 60000)
})
