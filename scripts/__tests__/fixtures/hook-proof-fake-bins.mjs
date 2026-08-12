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
 *   HOOK_PROOF_FAKE_FAIL_APPLY "1" = `git apply` FALHA (exit 1 + stderr) - o
 *                              seam hermetico do revert-fail apply (sec
 *                              11.76: a classe da Prova 43 que so tinha prova
 *                              viva ao vivo - agora E2E hermetico).
 *   HOOK_PROOF_FAKE_FAIL_APPLY_CHECK "1" = `git apply --check` (o
 *                              VERIFICADOR da CURE do apply-fail, sec 11.75 -
 *                              a decisao verificada no momento da nota) FALHA
 *                              (exit 1 + stderr): o patch do backup NAO
 *                              aplica na arvore atual (corrompido ou conflito
 *                              - a classe das Provas 43/50) -> a CURE cita SO
 *                              o reflog. Default (sem o knob): o check PASSA
 *                              -> a CURE cita SO o nivel 1 (o patch aplica
 *                              limpo). O FAIL_APPLY NAO afeta o --check: o
 *                              apply real pode falhar e o check passar (o
 *                              patch integro - a classe da Prova 50
 *                              invertida: o revert falha por outro motivo).
 *   HOOK_PROOF_FAKE_FAIL_APPLY_DELTA_ONLY "1" = so o `git apply` do
 *                              delta.patch do BACKUP FALHA - o apply do
 *                              safety diff (o fallback da sec 11.88) SUCCEDE.
 *                              O seam hermetico da AUTO-CURA: com
 *                              --apply-safety-diff-on-fail, o revertCycle
 *                              falha no patch do backup e tenta o safety diff
 *                              automaticamente - o ciclo completa (exit 0).
 *   HOOK_PROOF_FAKE_FAIL_CHECKOUT "1" = o `git checkout <orig>` do REVERT
 *                              FALHA (exit 1 + stderr) - o fail path
 *                              checkout (sec 11.85: a scratch AINDA existe,
 *                              o branch -D nunca roda). O checkout -b da
 *                              scratch NAO e afetado (so o simples).
 *   HOOK_PROOF_FAKE_FAIL_BRANCH_D "1" = o `git branch -D` do REVERT FALHA
 *                              (exit 1 + stderr) - o fail path branchD (sec
 *                              11.85: a scratch AINDA existe, o apply nunca
 *                              roda).
 *   HOOK_PROOF_FAKE_FAIL_STATUS "1" = o `git status --porcelain` do REVERT
 *                              diverge do snapshot (sec 11.85: o fail path
 *                              status - o apply PASSou e o delta ja esta na
 *                              arvore). O status do BACKUP roda antes do
 *                              checkout do revert (state.reverting ainda
 *                              falso -> snapshot normal) e o status do
 *                              revert roda depois (state.reverting true ->
 *                              linha extra " M stray.ts") - o sinal de
 *                              estado distingue as DUAS chamadas de status.
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
    // O knob FAIL_STATUS (sec 11.85): APOS o checkout do revert
    // (state.reverting - o status do backup roda antes e o snapshot fica
    // normal), o status reporta um arquivo extra - o git status pos-revert
    // diverge do snapshot e o revert morre no stage status (o apply do
    // delta JA passou - o delta esta na arvore).
    if (process.env.HOOK_PROOF_FAKE_FAIL_STATUS === "1" && state.reverting) {
      out(" M stray.ts\n")
      ok()
    }
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
    // O checkout SIMPLES do REVERT (o -b da scratch e tratado acima): o knob
    // FAIL_CHECKOUT e o seam hermetico do fail path checkout (sec 11.85 - a
    // scratch AINDA existe porque o branch -D nunca roda). No fluxo normal,
    // este checkout seta state.reverting = true - o sinal que o knob
    // FAIL_STATUS usa para o status do REVERT divergir do snapshot (o status
    // do backup roda ANTES deste checkout, com o sinal ainda falso -> o
    // snapshot fica normal; o status do revert roda depois -> diverge).
    if (process.env.HOOK_PROOF_FAKE_FAIL_CHECKOUT === "1") {
      process.stderr.write(`fatal: branch '${args[1]}' not found\n`)
      process.exit(1)
    }
    state.currentBranch = args[1]
    state.reverting = true
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
    // O knob FAIL_BRANCH_D (sec 11.85): o fail path branchD do revert - a
    // scratch AINDA existe (o branch -D falhou sem deletar) -> a receita
    // generica do scratchLeftNote, nao o reflog.
    if (process.env.HOOK_PROOF_FAKE_FAIL_BRANCH_D === "1") {
      process.stderr.write(`error: branch '${args[2]}' not found.\n`)
      process.exit(1)
    }
    delete state.branches[`refs/heads/${args[2]}`]
    saveState(state)
    ok()
  }
  if (args[0] === "apply" && args[1] === "--check") {
    // O VERIFICADOR da CURE (sec 11.75): o call site roda 'git apply
    // --check <backup>/delta.patch' no momento da nota - o dry-run que
    // decide se a CURE cita o nivel 1 (check passa - o patch aplica
    // limpo) ou o reflog (check falha - corrompido/conflito). O knob
    // FAIL_APPLY_CHECK e o seam: default passa, knob falha. O FAIL_APPLY
    // (o seam do apply REAL do revertCycle) NAO se aplica aqui - sao
    // invocacoes distintas com semantica distinta.
    if (process.env.HOOK_PROOF_FAKE_FAIL_APPLY_CHECK === "1") {
      process.stderr.write('error: patch does not apply (check)\n')
      process.exit(1)
    }
    ok()
  }
  if (args[0] === "apply") {
    if (process.env.HOOK_PROOF_FAKE_FAIL_APPLY === "1") {
      process.stderr.write('error: No valid patches in input (allow with "--allow-empty")\n')
      process.exit(1)
    }
    // FAIL_APPLY_DELTA_ONLY (sec 11.88): so o apply do delta.patch do backup
    // falha (args[1] e o path do patch) - o apply do safety diff (o fallback
    // auto-curativo) passa. O fixture distingue pelo SUFIXO do path: o
    // delta.patch vive no backupDir (termina em 'delta.patch'), o safety diff
    // e um path EXTERNO arbitrario.
    if (process.env.HOOK_PROOF_FAKE_FAIL_APPLY_DELTA_ONLY === "1" && args[1] && args[1].endsWith("delta.patch")) {
      process.stderr.write('error: No valid patches in input (allow with "--allow-empty")\n')
      process.exit(1)
    }
    ok()
  }
  process.stderr.write(`fake git: shape nao esperado: ${args.join(" ")}\n`)
  process.exit(9)
}

process.stderr.write(`fake bins: kind desconhecido: ${kind}\n`)
process.exit(9)
