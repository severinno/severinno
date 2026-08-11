#!/usr/bin/env node
/**
 * ci-proof-run.mjs - o ciclo completo de prova-CI num comando (2026-08).
 *
 * WHY: as Provas 6-12 do gates-proofs.md eram um ciclo MANUAL de 3-5 tool
 * calls por prova (branch scratch -> aplicar mutacao -> push -> dispatch ->
 * poll -> capturar log -> reverter). Este script transforma o padrao num
 * unico comando, travando os dois CONTRATOS que o ciclo depende:
 *
 *   - TYPE E (scan-surfaces.md, secao 6): o branch DEVE ser `ci-proof/*` -
 *     o namespace que NENHUM workflow escuta (nenhum push/PR filter casa
 *     com ele; a branch de prova nunca dispara deploy sozinha). O prefixo
 *     e DERIVADO do workflow-contracts manifest (CI_PROOF_NAMESPACE) -
 *     nao hardcoded: mudar o namespace exige atualizar o manifest, nao
 *     este script. main/develop e tags v* sao RECUSADOS com o aviso dos
 *     DANGER_REFS (push a main dispara deploy.yml; v* dispara
 *     release-deploy.yml).
 *   - PROVA 7 (gates-proofs.md): dispatch via API 404 para workflows fora
 *     do DEFAULT branch. O script roda `gh workflow view <file>` ANTES do
 *     dispatch - o gh resolve contra o default branch, entao um 404 aqui
 *     e exatamente a classe da Prova 7 (workflow so existe na branch
 *     scratch = undispatchable ate merge). Falha com a nota antes de
 *     gastar um poll.
 *
 * FLUXO (espelha o ciclo manual das Provas 6-12):
 *   1. parse + validacao: --branch (ci-proof/*) + --workflow obrigatorios.
 *   2. resolver a branch atual (git rev-parse --abbrev-ref HEAD) = a branch
 *      de RETORNO no revert.
 *   3. criar/entrar na branch scratch: git checkout -b <branch> (ou
 *      checkout se ja existir - um re-run nao recria).
 *   4. --mutate <cmd> (opcional): roda o shell command da mutacao na
 *      branch scratch e commit (`git add -A` + commit com a msg
 *      "ci-proof: <branch>"). Sem --mutate, empurra a branch como esta
 *      (o caso de o dev ja ter commitado a mutacao). Use --no-verify
 *      quando a mutacao viola um gate local (Prova 16): o pre-commit
 *      hook BLOQUEIA o commit ANTES do push - a flag seta HUSKY=0 no
 *      env de todos os spawns (commit + push + push --delete).
 *      --mutate-self-delete <path> (2026-08-11, Prova 22/sec 8.17
 *      first-class): o script de mutacao e TEMP por design - o runner o
 *      remove ANTES do git add -A (o CI tree fica limpo, sem residuos de
 *      tooling da prova no commit scratch; o script NAO deve se
 *      auto-deletar - o self-delete e do runner, nao do script). Fail-loud
 *      se o path nao existir apos a mutacao.
 *   5. git push origin <branch>.
 *   6. gh workflow view <file> (o pre-check da Prova 7).
 *   7. gh workflow run <file> --ref <branch> (dispatch).
 *   8. poll: gh run list --workflow <file> --branch <branch> --limit 1 ate
 *      um run com status completed (timeout --timeout s; default 900s, ou
 *      300s com --only-jobs - o default calibrado do sec 11.20). Com *   --only-jobs <job>, o poll termina quando o JOB alvo conclui (o run
 *      pode seguir em background rodando os demais jobs) - o sinal da
 *      prova vive num job especifico (ex.: check), e esperar o run inteiro
 *      queima minutos em jobs nao relacionados (medicao 2026-08-10, sec
 *      11.20: run 31430040398 total 9:12 mas o check conclui em 2:47 -
 *      Security Headers dominava o tail com 9:08). O nome casa com o
 *      DISPLAY name do job (o name: ou o key quando nao ha name:) - ex.:
 *      --only-jobs check e --only-jobs "Fuzz Tests" funcionam, mas o key
 *      cru "fuzz" nao casaria com o display "Fuzz Tests".
 *   9. captura: gh run view <id> --log (ou --job <jobId> --log com
 *      --only-jobs) -> <os.tmpdir()>/ci-proof-<b>-<id>.log (o tmpdir
 *      mantem o repo limpo; o path e impresso).
 *   10. verify: --expect <conclusion> (success/failure/...) + --expect-log
 *       <regex> (linha obrigatoria no log capturado). Nenhum = qualquer
 *       completed passa; --expect falha se a conclusion divergir;
 *       --expect-log falha se a regex nao casar.
 *   11. revert (salvo --keep-branch): git push origin --delete <branch>,
 *       git checkout <original>, git branch -D <branch>. NOTA: rodar o
 *       helper JA estando na branch scratch (re-run) deixa original ==
 *       branch - o checkout vira no-op e o branch -D local falha (nao da
 *       pra deletar a branch em que voce esta); o AVISO de revert parcial
 *       aparece e o fluxo pretendido e rodar de uma branch base.
 *   12. summary: run id + url + conclusion + log path (para registrar a
 *       prova no gates-proofs.md).
 *
 * Exit codes: 0 = resultado esperado observado E revertido; 1 = a
 * conclusion ou o log divergiram do --expect/--expect-log (revert MESMO
 * ASSIM - a branch scratch nunca fica no remote); 2 = usage (flag
 * faltando/invalida); 3 = falha de infra (gh ausente, dispatch 404 da
 * Prova 7, timeout de poll, ou o revert do sucesso nao completou - uma
 * branch scratch deixada no remote nao pode passar como exit 0) OU o
 * --expect-local-block nao observou o trip (o batch runner do pre-commit
 * saiu 0 = a mutacao nao viola gate nenhum - o --no-verify mascararia um
 * falso positivo; a arvore fica suja na branch scratch, limpe manualmente
 * como na Prova 16).
 *
 * HERMETICIDADE (testes): os binarios git/gh sao spawnados via
 * CI_PROOF_GIT / CI_PROOF_GH (env overrides apontando para o fixture
 * ci-proof-fake-bins.mjs, invocado via process.execPath - o mesmo padrao
 * cross-platform do entry-point guard) - nenhum git/gh real roda em teste;
 * o fixture registra cada invocacao num log de estado para o teste provar
 * a ORDEM do ciclo (create -> push -> dispatch -> poll -> capture ->
 * revert). --dry-run imprime o plano (steps puros) sem executar NADA.
 *
 * PROVA 16 (2026-08): o pre-commit hook local BLOQUEIA o commit de uma
 * mutacao que viole um gate local (o batch runner inclui o scan-guard-gates;
 * um needs: no pr-check.yml trava o git commit ANTES do push - exit 3 sem
 * revert, a arvore fica suja na branch scratch). Para provar uma mutacao
 * que e exatamente a classe que os guards locais protegem, use a flag
 * --no-verify: ela seta HUSKY=0 no env de TODOS os spawns do ciclo
 * (commit + push + push --delete) - o bypass oficial do husky (o shim
 * .husky/_/h tem `[ "${HUSKY-}" = "0" ] && exit 0`) - o CI e a autoridade
 * da prova, nao o hook local. Apos o run, limpe a arvore manualmente (git
 * reset --hard + checkout da branch original + branch -D da scratch).
 *
 * --expect-local-block (2026-08-11, a contraparte do --no-verify): o
 * --no-verify sozinho NAO valida que o bypass foi necessario - um dev pode
 * usa-lo com uma mutacao que nao viola gate nenhum, e o ciclo iria ao CI
 * mascarando um FALSO POSITIVO (o hook local nunca teria bloqueado). Esta
 * flag roda o batch runner do pre-commit (run-precommit-guards.mjs - o
 * MESMO runner que o .husky/pre-commit invoca, sec 11.13) contra a working
 * tree da branch scratch ANTES do commit do ciclo: exit != 0 = o hook local
 * REALMENTE bloquearia o commit - o --no-verify mascara um trip legitimo e
 * o ciclo prossegue; exit 0 = nenhum gate violado - a flag falha com a
 * nota (exit 3, sem commit/push) provando que o --no-verify so mascara um
 * trip REAL, nunca um falso positivo. Requer --no-verify E --mutate (o
 * check so faz sentido quando o hook sera bypassado num ciclo que commita).
 * NOTA honesta (mesmo espirito da LIMITACAO RESIDUAL das outras camadas):
 * um exit != 0 do batch prova que o hook local BLOQUEARIA o commit - nao
 * necessariamente que a MUTACAO e a violadora (uma divergencia
 * pre-existente, ex.: node_modules, tambem tripa o batch). Isso e fiel a
 * semantica real do hook (ele bloquearia o commit por QUALQUER razao) -
 * o claim da flag e "o bypass mascara um bloqueio real", nao "a mutacao
 * viola um gate especifico".
 * Hermeticidade: o runner e spawnado via CI_PROOF_LOCAL_BATCH (env override
 * apontando para o fixture fake - o mesmo padrao cross-platform do
 * CI_PROOF_GIT/CI_PROOF_GH, com o papel 'batch' como arg[2]).
 * ASCII puro (gate file). Puro node, sem deps.
 */
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { CI_PROOF_NAMESPACE, DANGER_REFS } from "./workflow-contracts.mjs"

const DEFAULT_TIMEOUT_S = 900
// Default calibrado do --only-jobs (sec 11.20, medicao 2026-08-10): o sinal
// da prova vive num job que nunca passou de ~3min nas provas 13-19 (o check
// concluiu em 2:47 no run 31430040398) - um default de 900s deixaria um poll
// de --only-jobs esperar ate 15min por um job que nunca conclui. 300s = ~1.8x
// a margem do pior caso medido. Um --timeout explicito SEMPRE vence.
const DEFAULT_ONLY_JOBS_TIMEOUT_S = 300
const POLL_INTERVAL_MS = Number(process.env.CI_PROOF_POLL_MS || 10_000)

/**
 * Resolve o timeout efetivo do poll: um --timeout explicito vence; senao o
 * default e calibrado pela forma do ciclo (sec 11.20) - 300s com --only-jobs
 * (o job alvo nunca passou de ~3min nas provas 13-19), 900s para o ciclo
 * completo. Pure (exported for tests - parseArgs e planSteps compartilham a
 * MESMA resolucao, regra dos 2 usos).
 */
export function resolveTimeout(onlyJobs, explicitTimeout) {
  if (explicitTimeout !== null && explicitTimeout !== undefined) return explicitTimeout
  return onlyJobs ? DEFAULT_ONLY_JOBS_TIMEOUT_S : DEFAULT_TIMEOUT_S
}

/**
 * Parse CLI args. SEMPRE retorna a shape completa { branch, workflow,
 * mutate, expect, expectLog, timeout, keep, dryRun, error } com error:
 * null no sucesso (string | null - NUNCA ausente, o union `{...opts} |
 * {error}` quebrava o acesso a props nos testes TS). Pure (exported).
 */
export function parseArgs(argv) {
  // SEMPRE retorna a shape completa com error: null no sucesso - o tipo
  // uniao `{...opts} | {error}` quebraria o acesso a propriedades nos
  // testes (TS2339) e o `if (opts.error)` do main() continua valido.
  const out = { branch: null, workflow: null, mutate: null, mutateSelfDelete: null, expect: null, expectLog: null, timeout: null, keep: false, dryRun: false, noVerify: false, expectLocalBlock: false, onlyJobs: null, error: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--branch") { out.branch = argv[i + 1] ?? null; i++ }
    else if (a === "--workflow") { out.workflow = argv[i + 1] ?? null; i++ }
    else if (a === "--mutate") { out.mutate = argv[i + 1] ?? null; i++ }
    else if (a === "--mutate-self-delete") { out.mutateSelfDelete = argv[i + 1] ?? null; i++ }
    else if (a === "--expect") { out.expect = argv[i + 1] ?? null; i++ }
    else if (a === "--expect-log") { out.expectLog = argv[i + 1] ?? null; i++ }
    // NOTA (pre-existente, intencional): `--timeout 0` cai no || e vira
    // DEFAULT_TIMEOUT_S (900) - o 0 nao e respeitado. Quirk mantido (um
    // timeout de 0s nao faz sentido); o resolveTimeout so ve numeros > 0
    // ou null (default calibrado do sec 11.20).
    else if (a === "--timeout") { out.timeout = Number(argv[i + 1]) || DEFAULT_TIMEOUT_S; i++ }
    else if (a === "--only-jobs") { out.onlyJobs = argv[i + 1] ?? null; i++ }
    else if (a === "--keep-branch") out.keep = true
    else if (a === "--dry-run") out.dryRun = true
    else if (a === "--no-verify") out.noVerify = true
    else if (a === "--expect-local-block") out.expectLocalBlock = true
    else if (a === "--help") { out.error = "usage: node scripts/ci-proof-run.mjs --branch ci-proof/<name> --workflow <file> [--mutate <cmd>] [--mutate-self-delete <path>] [--expect <conclusion>] [--expect-log <regex>] [--timeout <s>] [--only-jobs <job>] [--keep-branch] [--no-verify] [--expect-local-block] [--dry-run]"; break }
    else { out.error = `flag desconhecida: ${a}`; break }
  }
  if (!out.error && (!out.branch || !out.workflow)) {
    out.error = "usage: node scripts/ci-proof-run.mjs --branch ci-proof/<name> --workflow <file> [--mutate <cmd>] [--mutate-self-delete <path>] [--expect <conclusion>] [--expect-log <regex>] [--timeout <s>] [--only-jobs <job>] [--keep-branch] [--no-verify] [--expect-local-block] [--dry-run]"
  }
  // --expect-local-block (2026-08-11): so faz sentido com o bypass (o check
  // prova que o --no-verify mascara um trip REAL) E com --mutate (roda
  // contra a working tree da mutacao ANTES do commit do ciclo).
  if (!out.error && out.expectLocalBlock && !out.noVerify) {
    out.error = "--expect-local-block requer --no-verify (o check so prova o trip quando o hook local sera bypassado no ciclo)"
  }
  if (!out.error && out.expectLocalBlock && !out.mutate) {
    out.error = "--expect-local-block requer --mutate (o check roda contra a mutacao na working tree ANTES do commit)"
  }
  // --mutate-self-delete (2026-08-11, Prova 22/sec 8.17 first-class): so faz
  // sentido com --mutate (o self-delete remove o script TEMP da mutacao
  // ANTES do git add -A - sem mutacao nao ha script TEMP a remover).
  if (!out.error && out.mutateSelfDelete && !out.mutate) {
    out.error = "--mutate-self-delete requer --mutate (o self-delete remove o script TEMP da mutacao ANTES do git add -A)"
  }
  // Resolve o default calibrado (sec 11.20): SEMPRE retorna um numero - o
  // timeout nunca fica null (a shape completa promete timeout numerico). O
  // --timeout explicito (parseado no loop) vence o default calibrado.
  out.timeout = resolveTimeout(out.onlyJobs, out.timeout)
  return out
}

/**
 * The Type E namespace contract: the branch MUST be `ci-proof/<segment>`.
 * `ci-proof` (sem barra) e `ci-proof/a/b` (aninhado) sao recusados - o
 * template e UMA branch de prova simples, e o namespace aninhado nao e o
 * que a matriz de risco documenta. Pure (exported for tests).
 *
 * PROBE BOUNDARY (2026-08-10): o CI_PROOF_PROBE do manifest
 * (`ci-proof/proof-branch`) e ACEITO por este regex - deliberado. O probe
 * e um FIXTURE do Type E (a string que o invariant usa para provar que
 * nenhum workflow casa `ci-proof/*`), NAO uma branch reservada: ele esta
 * DENTRO do namespace provadamente filter-safe (Type E) e FORA dos
 * DANGER_REFS (main/develop/v*). Rejeita-lo adicionaria zero seguranca
 * (nenhum workflow o escuta) e rejeitaria a branch MAIS provada do repo.
 * O limite correto e o namespace: qualquer `ci-proof/<segment>` e segura
 * por construcao, incluindo o probe. Travado pelo E2E de aceitacao em
 * ci-proof-run.test.ts (o runner roda o ciclo completo com --branch =
 * CI_PROOF_PROBE e sai 0).
 */
export function isCiProofBranch(branch, namespace = CI_PROOF_NAMESPACE) {
  return new RegExp(`^${namespace}/[^/]+$`).test(branch)
}

/**
 * The step plan for --dry-run (pure strings, no execution). Exported for
 * tests: proves the cycle order without touching git/gh.
 */
export function planSteps(opts, originalBranch) {
  const b = opts.branch
  // O timeout RENDERIZADO e o resolvido (o mesmo resolveTimeout do
  // parseArgs - o plano e honesto sobre o default calibrado do sec 11.20
  // mesmo quando o teste passa opts parcial sem timeout).
  const timeoutS = resolveTimeout(opts.onlyJobs, opts.timeout)
  const steps = [
    `git: rev-parse --abbrev-ref HEAD (branch de retorno: ${originalBranch})`,
    `git: checkout -b ${b}  (cria a branch scratch de prova)`,
  ]
  if (opts.mutate) {
    steps.push(`shell: ${opts.mutate}  (a mutacao da prova, na branch scratch)`)
    if (opts.mutateSelfDelete) {
      steps.push(`self-delete: ${opts.mutateSelfDelete}  (--mutate-self-delete: removido ANTES do git add -A - o CI tree fica limpo, Prova 22/sec 8.17)`)
    }
    if (opts.expectLocalBlock) {
      steps.push(`local-check: node scripts/run-precommit-guards.mjs  (--expect-local-block: o batch runner do pre-commit DEVE trip - exit != 0, ANTES do commit)`)
    }
    steps.push(`git: add -A && commit -m "ci-proof: ${b}"`)
  } else {
    steps.push(`git: (sem --mutate - empurra a branch scratch como esta)`)
  }
  if (opts.noVerify) {
    steps.push(`env: HUSKY=0 (--no-verify: bypass do husky local no commit/push - Prova 16)`)
  }
  steps.push(`git: push origin ${b}`)
  steps.push(`gh: workflow view ${opts.workflow}  (Prova 7: resolve contra o DEFAULT branch - 404 = undispatchable)`)
  steps.push(`gh: workflow run ${opts.workflow} --ref ${b}`)
  if (opts.onlyJobs) {
    steps.push(`gh: run list --workflow ${opts.workflow} --branch ${b} --limit 1  (poll do JOB '${opts.onlyJobs}', timeout ${timeoutS}s - o ciclo termina quando o JOB conclui, nao o run)`)
    steps.push(`gh: run view <id> --json jobs  (resolve o jobId do '${opts.onlyJobs}')`)
  } else {
    steps.push(`gh: run list --workflow ${opts.workflow} --branch ${b} --limit 1  (poll, timeout ${timeoutS}s)`)
  }
  if (opts.onlyJobs) {
    steps.push(`gh: run view <id> --job <jobId> --log > <tmp>/ci-proof-${b}-<id>.log`)
  } else {
    steps.push(`gh: run view <id> --log > <tmp>/ci-proof-${b}-<id>.log`)
  }
  steps.push(`verify: conclusion==${opts.expect ?? "qualquer completed"}${opts.expectLog ? `, log ~= /${opts.expectLog}/` : ""}`)
  if (!opts.keep) {
    steps.push(`git: push origin --delete ${b}`)
    steps.push(`git: checkout ${originalBranch}`)
    steps.push(`git: branch -D ${b}`)
  } else {
    steps.push(`git: (--keep-branch: branch scratch mantida para inspecao)`)
  }
  return steps
}

/**
 * The outcome check: the observed conclusion must match --expect (when
 * given) and the captured log must match --expect-log (when given). Returns
 * { ok, message } - pure, exported for tests.
 */
export function verifyOutcome(conclusion, expectConcl, log, expectLog) {
  if (expectConcl && conclusion !== expectConcl) {
    return { ok: false, message: `conclusion=${conclusion} != esperado ${expectConcl}` }
  }
  if (expectLog) {
    const re = new RegExp(expectLog)
    if (!re.test(log)) {
      return { ok: false, message: `log nao casa /${expectLog}/ (${(log || "").split("\n").length} linhas capturadas)` }
    }
  }
  return { ok: true, message: `conclusion=${conclusion}${expectLog ? " + log casou" : ""}` }
}

/**
 * Run a binary with the CI_PROOF_* fake-bin override (the hermetic-test
 * seam): CI_PROOF_GIT/CI_PROOF_GH point at the fake fixture (invoked via
 * process.execPath with the role as arg[2] - cross-platform, no shebang
 * needed). Defaults to the real git/gh on PATH. Returns
 * { status, stdout, stderr }.
 */
export function runBin(kind, args) {
  const fake = process.env[kind === "git" ? "CI_PROOF_GIT" : "CI_PROOF_GH"]
  const cmd = fake ? [process.execPath, fake, kind, ...args] : [kind, ...args]
  const r = spawnSync(cmd[0], cmd.slice(1), { encoding: "utf8", env: process.env, cwd: process.cwd() })
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" }
}

const git = (args) => runBin("git", args)
const gh = (args) => runBin("gh", args)

/**
 * Run the pre-commit batch runner (run-precommit-guards.mjs - the SAME
 * runner the .husky/pre-commit invokes, sec 11.13) against the current
 * working tree. Used by --expect-local-block (2026-08-11): exit != 0 = the
 * local hook would REALLY block the mutation - the --no-verify masks a real
 * trip; exit 0 = no gate violated - the bypass would mask a false positive.
 * Hermetic seam: CI_PROOF_LOCAL_BATCH points at the fake fixture (role
 * 'batch' as arg[2], the same cross-platform pattern as CI_PROOF_GIT/GH);
 * defaults to `node scripts/run-precommit-guards.mjs` in the repo.
 */
export function runLocalBatch() {
  const fake = process.env.CI_PROOF_LOCAL_BATCH
  const cmd = fake
    ? [process.execPath, fake, "batch"]
    : [process.execPath, path.resolve(process.cwd(), "scripts", "run-precommit-guards.mjs")]
  const r = spawnSync(cmd[0], cmd.slice(1), { encoding: "utf8", env: process.env, cwd: process.cwd() })
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" }
}

function fail(code, msg) {
  console.error(`ci-proof-run: ${msg}`)
  return code
}

/**
 * Main flow. Returns the exit code (async only for the poll sleep - the
 * entry-point guard sets process.exitCode from it).
 */
export async function main() {
  const opts = parseArgs(process.argv.slice(2))
  // parseArgs SEMPRE retorna a shape completa (error: string | null) - o
  // guard abaixo estreita para null e o resto do fluxo acessa os campos.
  if (opts.error) return fail(2, opts.error)
  if (!isCiProofBranch(opts.branch)) {
    return fail(
      2,
      `branch '${opts.branch}' fora do namespace ${CI_PROOF_NAMESPACE}/* (Type E, scan-surfaces.md secao 6) - ` +
        `main/develop e v* disparam ${DANGER_REFS.map((d) => d.workflow).join(" + ")}; use ci-proof/<nome>`,
    )
  }

  // Resolve a branch atual (o destino do revert).
  const head = git(["rev-parse", "--abbrev-ref", "HEAD"])
  if (head.status !== 0) return fail(3, `git rev-parse falhou: ${head.stderr.trim()}`)
  const originalBranch = head.stdout.trim() || "HEAD"

  if (opts.dryRun) {
    console.log(`ci-proof-run: PLAN (dry-run) branch=${opts.branch} workflow=${opts.workflow} (nenhum comando executado)`)
    for (const s of planSteps(opts, originalBranch)) console.log(`  ${s}`)
    return 0
  }

  // PROVA 16 (2026-08): --no-verify = HUSKY=0 first-class. O pre-commit
  // hook local bloqueia o commit de mutacao de gate file (batch runner com
  // scan-guard-gates) - o env HUSKY=0 em todos os spawns abaixo (git/gh via
  // runBin, mutate via spawnSync) e o bypass oficial do husky. O CI e a
  // autoridade da prova, nao o hook local. Setado no process.env para os
  // subprocessos herdarem (o mesmo efeito de rodar `HUSKY=0 node ...`).
  // (Depois do dry-run early-return: --dry-run --no-verify imprime o plano
  // com o passo HUSKY=0 mas NAO muta o env - pureza do dry-run.)
  if (opts.noVerify) {
    process.env.HUSKY = "0"
    console.log("ci-proof-run: --no-verify - HUSKY=0 (bypass do husky local no ciclo - CI = autoridade, Prova 16)")
  }

  // 3. Cria/entra na branch scratch.
  const exists = git(["rev-parse", "--verify", "--quiet", `refs/heads/${opts.branch}`])
  if (exists.status === 0) {
    const co = git(["checkout", opts.branch])
    if (co.status !== 0) return fail(3, `git checkout ${opts.branch} falhou: ${co.stderr.trim()}`)
    console.log(`ci-proof-run: branch ${opts.branch} ja existia - checkout (re-run)`)
  } else {
    const cb = git(["checkout", "-b", opts.branch])
    if (cb.status !== 0) return fail(3, `git checkout -b ${opts.branch} falhou: ${cb.stderr.trim()}`)
    console.log(`ci-proof-run: branch scratch ${opts.branch} criada de HEAD`)
  }

  // 4. Mutacao (opcional) + commit.
  if (opts.mutate) {
    console.log(`ci-proof-run: aplicando mutacao: ${opts.mutate}`)
    const mut = spawnSync(opts.mutate, { shell: true, encoding: "utf8", cwd: process.cwd() })
    if (mut.status !== 0) {
      return fail(3, `--mutate falhou (exit ${mut.status}): ${(mut.stderr ?? mut.stdout ?? "").trim()}`)
    }
    // --mutate-self-delete (2026-08-11, Prova 22/sec 8.17 first-class): o
    // script de mutacao e TEMP por design (nunca deve entrar no commit
    // scratch - um .mjs solto poluiria a superficie de executaveis e o CI
    // tree, o ACHADO da sec 8.17). O runner assume o self-delete: remove o
    // path ANTES do git status/add -A (o script NAO deve se auto-deletar -
    // o contrato e do runner, nao do script). Fail-loud se o path nao
    // existir apos a mutacao (path errado = um temp script real escaparia
    // no commit - o no-op silencioso e a classe que o flag fecha).
    if (opts.mutateSelfDelete) {
      const selfDel = path.resolve(process.cwd(), opts.mutateSelfDelete)
      // Guard de ARQUIVO (review nit, sec 11.27): existsSync sozinho passaria
      // num DIRETORIO e o rmSync lancaria ERR_FS_EISDIR nao tratado (stack
      // trace em vez do fail-loud limpo). lstatSync + isFile no try/catch
      // cobre inexistente E diretorio com a MESMA mensagem de contrato.
      let isFile = false
      try {
        isFile = fs.lstatSync(selfDel).isFile()
      } catch {
        isFile = false // inexistente (ou lstat quebrou) = fail-loud abaixo
      }
      if (!isFile) {
        return fail(
          3,
          `--mutate-self-delete: ${opts.mutateSelfDelete} nao existe apos a mutacao (ou nao e um arquivo) - o self-delete e do runner (Prova 22/sec 8.17): o script TEMP deve existir para ser removido; um path errado deixaria o script no commit scratch. Ajuste o path ou remova o self-delete do proprio script`,
        )
      }
      fs.rmSync(selfDel, { force: true })
      console.log(`ci-proof-run: --mutate-self-delete: removido ${opts.mutateSelfDelete} antes do git add -A (CI tree limpo - Prova 22/sec 8.17)`)
    }
    const st = git(["status", "--porcelain"])
    const dirty = (st.stdout ?? "").trim() !== ""
    if (dirty) {
      // --expect-local-block (2026-08-11): ANTES do commit, roda o batch
      // runner do pre-commit contra a working tree da mutacao (o MESMO
      // runner que o .husky/pre-commit invoca, sec 11.13). exit != 0 = o
      // hook local REALMENTE bloquearia - o --no-verify mascara um trip
      // legitimo e o ciclo prossegue. exit 0 = nenhum gate violado - o
      // bypass mascararia um FALSO POSITIVO: falha (exit 3) SEM commit/push
      // (a arvore fica suja na branch scratch, limpe manualmente).
      if (opts.expectLocalBlock) {
        const lb = runLocalBatch()
        if (lb.status === null) {
          return fail(3, `--expect-local-block: batch runner do pre-commit nao encontrado (spawnSync ENOENT)`)
        }
        if (lb.status === 0) {
          return fail(
            3,
            `--expect-local-block: o batch runner do pre-commit NAO tripou (exit 0: ${(lb.stdout || "").trim().split("\n")[0] || "clean"}) - a mutacao nao viola nenhum gate local; o --no-verify mascararia um FALSO POSITIVO, nao um trip real (Prova 16). Revise a mutacao - a arvore ficou suja na branch scratch (git reset --hard + checkout da branch original + branch -D)`,
          )
        }
        console.log(`ci-proof-run: --expect-local-block OK - o batch runner do pre-commit tripou (exit ${lb.status}) - o --no-verify mascara um trip real`)
      }
      git(["add", "-A"])
      const cm = git(["commit", "-m", `ci-proof: ${opts.branch}`])
      if (cm.status !== 0) return fail(3, `git commit falhou: ${cm.stderr.trim()}`)
      console.log(`ci-proof-run: mutacao commitada em ${opts.branch}`)
    } else {
      console.log(`ci-proof-run: --mutate nao alterou nada - sem commit`)
    }
  }

  // 5. Push da branch scratch.
  const push = git(["push", "origin", opts.branch])
  if (push.status !== 0) return fail(3, `git push origin ${opts.branch} falhou: ${push.stderr.trim()}`)
  console.log(`ci-proof-run: pushed origin/${opts.branch}`)

  // 6. Pre-check da Prova 7 (gh workflow view resolve contra o DEFAULT branch).
  const wf = gh(["workflow", "view", opts.workflow])
  if (wf.status !== 0) {
    // Revert antes de sair - a branch scratch nao pode ficar no remote.
    if (!opts.keep) revert(opts.branch, originalBranch)
    // status === null = spawnSync nao achou o binario (ENOENT) - NAO e um
    // 404 da Prova 7: a mensagem tem que ser acionavel (instalar o gh).
    if (wf.status === null) {
      return fail(3, `gh nao encontrado no PATH (spawnSync ENOENT) - o ciclo de prova precisa do GitHub CLI (gh)`)
    }
    return fail(
      3,
      `gh workflow view ${opts.workflow} falhou (exit ${wf.status}) - PROVA 7: dispatch 404 para workflows fora do ` +
        `default branch (${wf.stderr.trim()}); o workflow so existe na branch scratch = undispatchable ate merge`,
    )
  }

  // 7. Dispatch.
  const run = gh(["workflow", "run", opts.workflow, "--ref", opts.branch])
  if (run.status !== 0) {
    if (!opts.keep) revert(opts.branch, originalBranch)
    return fail(3, `gh workflow run falhou (exit ${run.status}): ${run.stderr.trim()}`)
  }
  console.log(`ci-proof-run: dispatched ${opts.workflow} on ${opts.branch}`)

  // 8. Poll ate completed (ou timeout). Com --only-jobs, o poll termina
  // quando o JOB alvo conclui (o run pode seguir em background rodando os
  // demais jobs) - o sinal da prova vive num job especifico, e esperar o
  // run inteiro queima minutos em jobs nao relacionados (medicao 2026-08-10,
  // sec 11.20: run 31430040398 total 9:12, check conclui em 2:47, Security
  // Headers dominava o tail com 9:08). A conclusao verificada passa a ser
  // a do JOB (nao a do run) - o run pode nem ter terminado quando o job
  // alvo ja concluiu.
  const deadline = Date.now() + opts.timeout * 1000
  let runInfo = null
  let onlyJobInfo = null // { id, conclusion } quando --only-jobs resolve o job
  while (Date.now() < deadline) {
    const list = gh(["run", "list", "--workflow", opts.workflow, "--branch", opts.branch, "--limit", "1", "--json", "databaseId,status,conclusion,url", "--jq", ".[0]"])
    const line = list.stdout.trim()
    if (list.status === 0 && line && line !== "null") {
      try {
        runInfo = JSON.parse(line)
      } catch {
        runInfo = null
      }
    }
    if (runInfo) {
      if (opts.onlyJobs) {
        // Poll do JOB: gh run view <id> --json jobs -> o jobId do alvo e a
        // sua conclusao. O run pode continuar in_progress - o que importa
        // e o job terminar.
        const jv = gh(["run", "view", String(runInfo.databaseId), "--json", "jobs"])
        let jobs = []
        if (jv.status === 0 && jv.stdout.trim()) {
          try {
            const parsed = JSON.parse(jv.stdout.trim())
            jobs = parsed.jobs || []
          } catch {
            jobs = []
          }
        }
        const target = jobs.find((j) => j.name === opts.onlyJobs)
        if (target && target.status === "completed") {
          onlyJobInfo = { id: target.databaseId, conclusion: target.conclusion }
          break
        }
        if (runInfo.status === "completed" && !target) {
          // O run completou sem o job alvo = nome errado (o poll nao pode
          // ficar em loop ate o timeout com um nome que nunca casa).
          if (!opts.keep) revert(opts.branch, originalBranch)
          return fail(3, `job '${opts.onlyJobs}' nao encontrado no run #${runInfo.databaseId} (jobs: ${jobs.map((j) => j.name).join(", ") || "nenhum"})`)
        }
      } else if (runInfo.status === "completed") {
        break
      }
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
  }
  if (!runInfo) {
    if (!opts.keep) revert(opts.branch, originalBranch)
    return fail(3, `timeout apos ${opts.timeout}s - nenhum run encontrado para ${opts.workflow} em ${opts.branch}`)
  }
  if (opts.onlyJobs && !onlyJobInfo) {
    if (!opts.keep) revert(opts.branch, originalBranch)
    return fail(3, `timeout apos ${opts.timeout}s - job '${opts.onlyJobs}' nao completou no run #${runInfo.databaseId} para ${opts.workflow} em ${opts.branch}`)
  }
  if (!opts.onlyJobs && runInfo.status !== "completed") {
    if (!opts.keep) revert(opts.branch, originalBranch)
    return fail(3, `timeout apos ${opts.timeout}s - nenhum run completed para ${opts.workflow} em ${opts.branch}`)
  }
  // A conclusao verificada: a do JOB quando --only-jobs (o run pode nem ter
  // terminado); a do run caso contrario.
  const observedConclusion = opts.onlyJobs ? onlyJobInfo.conclusion : runInfo.conclusion
  console.log(
    opts.onlyJobs
      ? `ci-proof-run: run #${runInfo.databaseId} job '${opts.onlyJobs}' completed (${observedConclusion}) - ${runInfo.url}`
      : `ci-proof-run: run #${runInfo.databaseId} completed (${observedConclusion}) - ${runInfo.url}`,
  )

  // 9. Captura do log (tmpdir mantem o repo limpo). O nome do arquivo
  // SLUGIFICA o branch (o "/" do ci-proof/<nome> viraria um subdir
  // inexistente no tmpdir e o writeFileSync falharia com ENOENT em TODO
  // run - o review pegou esse bug antes do 1o uso real). Com --only-jobs,
  // o log e o do JOB (`--job <jobId>`) - nao o run inteiro (que pode
  // seguir rodando e cujo log misturaria jobs alheios ao sinal).
  const logSlug = opts.branch.replace(/[^A-Za-z0-9_.-]+/g, "-")
  const logPath = path.join(os.tmpdir(), `ci-proof-${logSlug}-${runInfo.databaseId}.log`)
  const log = opts.onlyJobs
    ? gh(["run", "view", String(runInfo.databaseId), "--job", String(onlyJobInfo.id), "--log"])
    : gh(["run", "view", String(runInfo.databaseId), "--log"])
  fs.writeFileSync(logPath, log.stdout, "utf8")
  console.log(`ci-proof-run: log capturado em ${logPath} (${(log.stdout || "").split("\n").length} linhas)`)

  // 10. Verify (contra a conclusao do job quando --only-jobs).
  const check = verifyOutcome(observedConclusion, opts.expect, log.stdout, opts.expectLog)
  console.log(`ci-proof-run: verify: ${check.message}`)

  // 11. Revert (a branch scratch NAO fica no remote - salvo --keep-branch).
  // O resultado do revert PARTICIPA do exit code do sucesso: uma branch
  // scratch deixada no remote (push --delete falhou) nao pode passar como
  // exit 0 - o docblock promete "esperado observado E revertido".
  const reverted = opts.keep ? true : revert(opts.branch, originalBranch)

  // 12. Summary (para registrar no gates-proofs.md). A conclusao e a
  // observada (do job quando --only-jobs - o run pode nao ter terminado).
  console.log(`ci-proof-run: DONE run=${runInfo.databaseId} url=${runInfo.url} conclusion=${observedConclusion} log=${logPath}`)
  if (!check.ok) return 1
  return reverted ? 0 : 3
}

/** Revert the scratch branch: delete remote, checkout original, delete local. */
function revert(branch, originalBranch) {
  const del = git(["push", "origin", "--delete", branch])
  const co = git(["checkout", originalBranch])
  const bd = git(["branch", "-D", branch])
  const ok = del.status === 0 && co.status === 0 && bd.status === 0
  console.log(
    ok
      ? `ci-proof-run: revertido (remote ${branch} deletado, de volta em ${originalBranch}, local deletado)`
      : `ci-proof-run: AVISO revert parcial - push --delete=${del.status} checkout=${co.status} branch -D=${bd.status}`,
  )
  return ok
}

// Entry-point guard: only run the CLI when executed directly (vitest imports
// the module for unit tests of parseArgs/isCiProofBranch/planSteps/verifyOutcome
// without side effects). main() is async (the poll sleep), so the exit code
// is set from the resolved value - never from the Promise itself.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => {
    process.exitCode = code
  })
}
