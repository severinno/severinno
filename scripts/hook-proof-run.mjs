#!/usr/bin/env node
/**
 * hook-proof-run.mjs - o ciclo de prova de HOOK LOCAL num comando (2026-08-11,
 * sec 11.58). O espelho do ci-proof-run.mjs para a rede LOCAL.
 *
 * WHY: o ciclo manual das Provas 37/38 do gates-proofs.md (backup do delta ->
 * scratch ci-proof/* -> delta materializado -> mutacao commitada via HUSKY=0
 * -> push SIMULADO via stdin no hook real -> revert byte-identical) rodou 2x -
 * a regra dos 2 usos para extracao. O ci-proof-run automatiza o lado CI (gh +
 * dispatch + poll); este helper automatiza o lado LOCAL (o hook .husky/pre-push
 * real, sem rede, sem gh) - o ciclo e DETERMINISTICO local (o push e SIMULADO
 * com o payload de refs que o git passaria, nunca vai ao remote).
 *
 * NOME (o ACHADO do gitignore, 2026-08-11): o nome `local-proof-*` foi
 * DESCARTADO - o .gitignore linha 51 tem `local-*` (a classe de artefatos
 * locais nao-commitaveis) e um helper `local-proof-run.mjs` seria
 * SILENCIOSAMENTE ignorado (nunca entraria no commit - o git status nem o
 * listaria). O nome `hook-proof-*` espelha o `ci-proof-*` do irmao e nao
 * colide com nenhuma regra de ignore.
 *
 * FLUXO (espelha o ciclo manual das Provas 37/38):
 *   1. parse + validacao: --branch (ci-proof/*, o MESMO namespace Type E do
 *      ci-proof-run - isCiProofBranch importado, nao re-derivado).
 *   2. backup (o padrao Prova 38): git diff > <tmp>/delta.patch + untracked
 *      copiados + git status --porcelain snapshot + byte-copy do doc. O
 *      --safety-diff <path> (sec 11.77) grava o MESMO diff num path EXTERNO
 *      ao backup ANTES de qualquer mutacao - a copia que sobrevive a
 *      corrupcao do delta.patch do backup (a classe da Prova 43, sec 8.38).
 *      O --apply-safety-diff-on-fail (sec 11.88) torna o REVERT auto-curativo:
 *      no apply-fail do revertCycle, se o safety diff foi salvo, o revert
 *      tenta o safety diff AUTOMATICAMENTE antes do fail - a recuperacao da
 *      Prova 43 (100% manual) vira comportamento do ciclo. O
 *      --safety-backup <dir> (sec 11.89) espelha o BACKUP INTEIRO (delta.patch
 *      + untracked/ + status-before.txt + doc-before.md) num path EXTERNO ao
 *      tmpdir - o safety do ciclo completo, nao so do diff: a recuperacao da
 *      classe de perda total nao depende do tmpdir sobreviver.
 *   3. scratch: git checkout -b <branch>; delta materializado (git add -A +
 *      commit com HUSKY=0 - SO quando a arvore tem delta: uma arvore limpa e
 *      um input legitimo - o helper prova o estado COMMITADO como esta, e um
 *      git commit vazio falharia 'nothing to commit').
 *   4. mutacao: --mutate-doc-claim <sec> injeta a claim fake no gates-proofs.md
 *      ANTES do '## 12.' (a ancora da Prova 38), OU --mutate-doc-renumber
 *      <sec> --to <nova> renomeia o header da secao (o shape da Prova 39 -
 *      a classe stale: uma entrada do manifest sem claim no doc, sec 11.55),
 *      OU --mutate <cmd> roda um shell cmd generico (todos mutuamente
 *      exclusivos). Commit com HUSKY=0 (a mutacao viola um gate local de
 *      proposito - o bypass oficial do husky) - SO quando a mutacao alterou
 *      a arvore (uma mutacao no-op nao pode falhar o ciclo).
 *
 *      A ASSIMETRIA do renumber (sec 11.59): o helper roda o HOOK real, e o
 *      guard do push (check-exit-claims-push) e direction-unique
 *      .unregistered (sec 11.49) - entao o renumber atravess do helper prova
 *      o CONTRASTE da Prova 39 (o hook falha com a CURE do unregistered da
 *      secao renumerada + 0 mencoes a stale). O par completo CURE+stale
 *      (o pointer da sec 11.55) e CLI-only - observado via EXIT_CLAIMS_DOC
 *      probe ou um futuro --cli-check, fora do escopo deste helper.
 *   5. shas do push simulado: new = HEAD (o commit da mutacao); old =
 *      --base-sha OU HEAD~1 (o commit do delta) OU all-zeros (1o push).
 *   6. push SIMULADO: printf 'refs/heads/<branch> <new> refs/heads/<branch>
 *      <old>' | bash <hook> (default .husky/pre-push) - o payload exato que o
 *      git passa ao hook no stdin. Captura exit code + stdout (o log fica em
 *      <tmp>).
 *   7. verify: --expect-exit (default 1: o hook DEVE bloquear) + --expect-cure
 *      (a saida contem a EXIT_CLAIMS_CURE - a fonte unica da sec 11.54,
 *      importada) + --expect-log <regex>. Nenhum = qualquer saida passa.
 *   8. revert (salvo --keep-branch): checkout da original + branch -D + git
 *      apply <patch> (SO quando o patch nao e vazio - um apply vazio erra
 *      'unrecognized input') + untracked restaurados + doc restaurado do
 *      byte-copy + git status identico ao snapshot (o equivalente estrutural
 *      do md5 pre=pos das Provas 37/38). O revert PARTICIPA do exit code: uma
 *      scratch deixada (revert incompleto) nao pode passar como exit 0.
 *   9. summary: exit do hook + veredito + log path (para registrar a prova).
 *
 * Exit codes: 0 = esperado observado E revertido; 1 = o exit code ou o log
 * divergiu do --expect-exit/--expect-cure/--expect-log (revert MESMO ASSIM -
 * a scratch nunca fica); 2 = usage (flag faltando/invalida); 3 = falha de
 * infra (git checkout -b falhou, commit falhou, doc ausente para
 * --mutate-doc-claim, hook nao executou, revert incompleto).
 *
 * --cleanup-on-fail (sec 11.69): os fail paths POS-scratch de infra (delta
 * commit, doc ausente, renumber THROW, --mutate shell fail, mutation commit -
 * todos os fail(3) pos-scratch da cadeia de mutacao) rodam o revertCycle
 * ANTES do fail(3) - a scratch NAO fica e os untracked do byte-copy sao
 * restaurados (o ACHADO da Prova 41, sec 8.36, fechado estruturalmente). Sem
 * a flag, o fail deixa a scratch com a scratchLeftNote (a receita manual).
 * NAO conflita com --keep-branch (o keep so vale no sucesso - o
 * cleanup-on-fail so vale no fail).
 *
 * HERMETICIDADE (testes): os binarios git sao spawnados via HOOK_PROOF_GIT
 * (env override apontando para o fixture hook-proof-fake-bins.mjs, invocado
 * via process.execPath - o mesmo padrao cross-platform do CI_PROOF_GIT); o
 * hook e spawnado via --hook (nos testes, o fixture hook-proof-fake-hook.sh
 * que ecoa uma saida roteirizada + exit code via env HOOK_PROOF_FAKE_HOOK_*);
 * o doc do --mutate-doc-claim e sobrescrito por HOOK_PROOF_DOC (o seam
 * hermetico - nunca toca o doc real em teste). --dry-run imprime o plano sem
 * executar NADA.
 * ASCII puro (gate file). Puro node, sem deps.
 */
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { isCiProofBranch } from "./ci-proof-run.mjs"
import { EXIT_CLAIMS_CURE } from "./scan-exit-claims.mjs"

// Literal forward-slash (nao path.join): o DEFAULT_HOOK aparece no plano do
// --dry-run e no teste (que espera `.husky/pre-push` em QUALQUER SO - o
// path.join produziria `.husky\pre-push` no Windows e quebraria o assert).
const DEFAULT_HOOK = ".husky/pre-push"
const DOC_REL = path.join("docs", "gates-proofs.md")
const ALL_ZEROS = "0000000000000000000000000000000000000000"

/** Parse CLI args. SEMPRE retorna a shape completa com error: null no sucesso. */
export function parseArgs(argv) {
  const out = {
    branch: null,
    mutate: null,
    mutateDocClaim: null,
    mutateDocRenumber: null,
    to: null,
    expectCure: false,
    expectExit: 1,
    expectLog: null,
    baseSha: null,
    hook: null,
    safetyDiff: null,
    applySafetyDiffOnFail: false,
    safetyBackup: null,
    keep: false,
    cleanupOnFail: false,
    dryRun: false,
    error: null,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--branch") { out.branch = argv[i + 1] ?? null; i++ }
    else if (a === "--mutate") { out.mutate = argv[i + 1] ?? null; i++ }
    else if (a === "--mutate-doc-claim") { out.mutateDocClaim = argv[i + 1] ?? null; i++ }
    else if (a === "--mutate-doc-renumber") { out.mutateDocRenumber = argv[i + 1] ?? null; i++ }
    else if (a === "--to") { out.to = argv[i + 1] ?? null; i++ }
    else if (a === "--expect-cure") out.expectCure = true
    // NOTE (reviewer, sec 11.58): `Number(x) || 1` mapearia --expect-exit 0 ->
    // 1 (o 0 e falsy) - e exit 0 E um valor legitimo (a prova POSITIVA de que
    // o hook passa, o padrao da Prova 30). Number.isNaN distingue
    // ausente/nao-numerico (default 1) de 0 explicito.
    else if (a === "--expect-exit") { out.expectExit = Number(argv[i + 1]); if (Number.isNaN(out.expectExit)) out.expectExit = 1; i++ }
    else if (a === "--expect-log") { out.expectLog = argv[i + 1] ?? null; i++ }
    else if (a === "--base-sha") { out.baseSha = argv[i + 1] ?? null; i++ }
    else if (a === "--hook") { out.hook = argv[i + 1] ?? null; i++ }
    else if (a === "--safety-diff") { out.safetyDiff = argv[i + 1] ?? null; i++ }
    else if (a === "--apply-safety-diff-on-fail") out.applySafetyDiffOnFail = true
    else if (a === "--safety-backup") { out.safetyBackup = argv[i + 1] ?? null; i++ }
    else if (a === "--keep-branch") out.keep = true
    else if (a === "--cleanup-on-fail") out.cleanupOnFail = true
    else if (a === "--dry-run") out.dryRun = true
    else if (a === "--help") { out.error = USAGE; break }
    else { out.error = `flag desconhecida: ${a}`; break }
  }
  if (!out.error && !out.branch) out.error = USAGE
  // As 3 mutacoes sao mutuamente exclusivas (uma mutacao por ciclo - o par
  // de flags define a MESMA etapa 4 do fluxo). --to so faz sentido com o
  // --mutate-doc-renumber (o target da renumeracao).
  if (!out.error && [out.mutateDocClaim, out.mutateDocRenumber, out.mutate].filter(Boolean).length > 1) {
    out.error = "--mutate-doc-claim, --mutate-doc-renumber e --mutate sao mutuamente exclusivos (uma mutacao por ciclo)"
  }
  if (!out.error && out.to && !out.mutateDocRenumber) {
    out.error = "--to so faz sentido com --mutate-doc-renumber <sec>"
  }
  if (!out.error && out.mutateDocRenumber && !out.to) {
    out.error = "--mutate-doc-renumber <sec> precisa de --to <nova> (a renumeracao tem target)"
  }
  // Shape do --to (reviewer, sec 11.59): um --to que nao parece secao (ex.:
  // 'foo') renomearia o header para '## foo ...' - a claim nunca viraria um
  // unregistered detectavel e o sinal da prova se perderia por razao errada.
  // Fail-loud no parse (o MESMO espirito do Prova 17 ACHADO, sec 8.14).
  if (!out.error && out.mutateDocRenumber && out.to && !/^\d+\.\d+$/.test(out.to)) {
    out.error = `--to '${out.to}' nao parece uma secao (esperado N.N, ex.: 11.99) - o sinal da prova se perderia`
  }
  // TRIPWIRE do atalho manual (sec 11.59): um --mutate shell que cita 'sed'
  // + '## ' e o RENAME MANUAL de secao do doc que o --mutate-doc-renumber
  // substituiu (o shape das Provas 39/40 - sed + header markdown). O sed cru
  // PERDE os guards da flag dedicada (shape do --to, colisao, secao ausente
  // -> no-op silencioso, Prova 17 ACHADO) e o renumber travado nao fica
  // auditavel no PROOF_CLASSES. Fail-loud no parse (exit 2) apontando a
  // flag certa - o mesmo espirito do tripwire eval+curl da sec 11.36 (a
  // fronteira decidida ganha guard barato, nao so prosa). O --mutate shell
  // CONTINUA sendo o escape hatch para mutacoes FORA do doc (workflow yml,
  // gate files...) - so a forma sed+header (o doc rename manual) e travada.
  if (!out.error && out.mutate && isManualDocRenameCmd(out.mutate)) {
    out.error = `--mutate cita 'sed' + '## ' (o rename manual de secao que o --mutate-doc-renumber da sec 11.59 substituiu): use --mutate-doc-renumber <sec> --to <nova> para renumerar o doc - o sed cru perde os guards de shape/colisao/no-op`
  }
  return out
}

/**
 * isManualDocRenameCmd - o TRIPWIRE do atalho manual (exported for tests):
 * true quando o cmd do --mutate cita 'sed' + '## ' + o caminho do doc
 * (gates-proofs.md) - o shape exato do rename manual de secao das Provas
 * 39/40 (ex.: sed -i 's/## 11.58 /## 11.98 /' docs/gates-proofs.md). A
 * fronteira: o --mutate shell CONTINUA legitimo para mutacoes FORA do doc
 * (workflow yml, gate files, e ate outro .md - o README.md nao e o doc do
 * contrato) - so a forma sed+header APONTANDO o gates-proofs.md (o doc
 * rename que a sec 11.59 substituiu pela flag dedicada) e travada no
 * parse. O detector e intencionalmente barato (substring, sem parse de
 * shell): um falso positivo vira um erro claro de usage, nao um no-op
 * silencioso (a classe Prova 17 ACHADO, sec 8.14).
 */
export function isManualDocRenameCmd(cmd) {
  return /\bsed\b/.test(cmd) && /## /.test(cmd) && /gates-proofs\.md/.test(cmd)
}

const USAGE = "usage: node scripts/hook-proof-run.mjs --branch ci-proof/<name> [--mutate-doc-claim <sec> | --mutate-doc-renumber <sec> --to <nova> | --mutate <cmd>] [--expect-cure] [--expect-exit <n>] [--expect-log <regex>] [--base-sha <sha>] [--hook <path>] [--safety-diff <path>] [--apply-safety-diff-on-fail] [--safety-backup <dir>] [--keep-branch] [--cleanup-on-fail] [--dry-run]"

/**
 * injectDocClaim - a mutacao pura do --mutate-doc-claim (exported for tests):
 * injeta a claim fake de exit code `## <sec> Claim fake da prova` +
 * `**Exit codes**: exit code 3.` ANTES do header '## 12.' (a ancora usada
 * nas Provas 37/38 - o fim das secoes 11.x). A secao e a 11.99 nas provas; o
 * <sec> e parametrizavel para qualquer claim fake. O texto e ASCII puro
 * (registro de prova, nunca um byte nao-ASCII num gate file).
 */
export function injectDocClaim(doc, sec) {
  const claim = `## ${sec} Claim fake da prova\n\n**Exit codes**: exit code 3.\n\n`
  const anchor = "## 12."
  const idx = doc.indexOf(anchor)
  if (idx === -1) return doc + "\n" + claim
  return doc.slice(0, idx) + claim + doc.slice(idx)
}

/**
 * renumberDocSection - a mutacao pura do --mutate-doc-renumber (exported for
 * tests): renomeia o header `## <sec> ` para `## <to> ` no doc (a classe da
 * Prova 39: a entrada do manifest <sec> fica sem claim no doc = stale, e a
 * nova secao <to> vira unregistered - 1 rename produz o PAR). A ancora e o
 * header `## <sec> ` com espaco (o numero exato, nao um prefixo parcial).
 * FAIL-LOUD (o Prova 17 ACHADO, sec 8.14): secao ausente -> THROW com o
 * caminho - uma mutacao no-op silenciosa esconderia o sinal da prova (a
 * classe que o scan-eol-anchor tambem trava). Colisao de target (sec 11.59):
 * renumerar PARA uma secao que JA existe no doc (incluindo to === sec, o
 * no-op) -> THROW - um header duplicado deixaria o par ambiguo. NOTE (sec
 * 11.59): a funcao pura NAO valida a shape do --to - o parseArgs e o gate
 * da shape (o CLI nunca chega aqui com um --to fora de N.N); chamadas
 * diretas nos testes usam valores validos.
 */
export function renumberDocSection(doc, sec, to) {
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const re = new RegExp(`^## ${esc(sec)} `, "m")
  if (!re.test(doc)) {
    throw new Error(`renumberDocSection: secao '## ${sec} ' nao encontrada no doc (Prova 17 ACHADO, sec 8.14) - a renumeracao seria um no-op silencioso`)
  }
  // COLISAO DE TARGET (reviewer, sec 11.59): renumerar PARA uma secao que JA
  // existe criaria um header duplicado - o par ficaria ambiguo (qual '## <to> '
  // e o renumerado?) e quebraria o contrato de ordenacao. Fail-loud no MESMO
  // espirito do sec-absent acima (o to === sec e um caso desta colisao: a
  // renumeracao nao alteraria nada - o no-op silencioso da classe ACHADO).
  const toRe = new RegExp(`^## ${esc(to)} `, "m")
  if (toRe.test(doc)) {
    throw new Error(`renumberDocSection: secao '## ${to} ' JA existe no doc (ou e a propria secao - no-op, sec 11.59) - a renumeracao criaria um header duplicado`)
  }
  return doc.replace(re, `## ${to} `)
}

/**
 * verifyLocalHook - a decisao pura do verify (exported for tests):
 *   - status !== expectExit -> { ok: false } (o hook nao bloqueou/passou como
 *     esperado).
 *   - expectCure e a saida NAO contem EXIT_CLAIMS_CURE -> { ok: false } (a
 *     CURE da sec 11.54 e o sinal da classe; a string e a fonte unica).
 *   - expectLog e a saida NAO casa o regex -> { ok: false }.
 * Retorna { ok, message } - a mensagem acionavel (exit observado + o que
 * divergiu).
 */
export function verifyLocalHook({ status, stdout }, opts) {
  if (status !== opts.expectExit) {
    return { ok: false, message: `hook exit ${status} != esperado ${opts.expectExit}` }
  }
  if (opts.expectCure && !(stdout ?? "").includes(EXIT_CLAIMS_CURE)) {
    return { ok: false, message: `saida do hook NAO contem a CURE (sec 11.54): ${(stdout ?? "").split("\n")[0] || "(vazia)"}` }
  }
  if (opts.expectLog) {
    const re = new RegExp(opts.expectLog)
    if (!re.test(stdout ?? "")) {
      return { ok: false, message: `log nao casa /${opts.expectLog}/ (${(stdout ?? "").split("\n").length} linhas capturadas)` }
    }
  }
  return { ok: true, message: `hook exit ${status}${opts.expectCure ? " + CURE" : ""}${opts.expectLog ? " + log casou" : ""}` }
}

/**
 * planSteps - o plano do --dry-run (pure strings, no execution). Exported for
 * tests: prova a ORDEM do ciclo (backup -> scratch -> delta -> mutacao ->
 * shas -> hook simulado -> verify -> revert) sem tocar git/hook.
 */
export function planSteps(opts, originalBranch) {
  const b = opts.branch
  const steps = [
    `git: rev-parse --abbrev-ref HEAD (branch de retorno: ${originalBranch})`,
    "backup: git diff > <tmp>/delta.patch + untracked copiados + git status --porcelain snapshot + byte-copy do doc (Prova 38)",
  ]
  if (opts.safetyDiff) {
    steps.push(`safety-diff: git diff > ${opts.safetyDiff}  (o MESMO diff num path EXTERNO ao backup - sobrevive a corrupcao do delta.patch, sec 11.77)`)
  }
  if (opts.applySafetyDiffOnFail) {
    steps.push("apply-safety-diff-on-fail: no apply-fail do revert, o safety diff e tentado AUTOMATICAMENTE antes do fail (o revert auto-curativo, sec 11.88)")
  }
  if (opts.safetyBackup) {
    steps.push(`safety-backup: espelha o BACKUP INTEIRO (delta.patch + untracked + status-before + doc-before) em ${opts.safetyBackup}  (o safety do ciclo completo - a recuperacao nao depende do tmpdir, sec 11.89)`)
  }
  steps.push(
    `git: checkout -b ${b}  (cria a branch scratch de prova)`,
    `git: add -A && HUSKY=0 commit -m "hook-proof: ${b} (delta)"  (delta materializado - so quando a arvore tem delta)`,
  )
  if (opts.mutateDocClaim) {
    steps.push(`mutacao: --mutate-doc-claim ${opts.mutateDocClaim} (claim fake injetada ANTES do '## 12.' no ${DOC_REL})`)
  } else if (opts.mutateDocRenumber) {
    steps.push(`mutacao: --mutate-doc-renumber ${opts.mutateDocRenumber} --to ${opts.to} (header renumerado no ${DOC_REL} - a classe stale da Prova 39)`)
  } else if (opts.mutate) {
    steps.push(`mutacao: shell: ${opts.mutate}`)
  } else {
    steps.push("mutacao: (nenhuma - prova o estado commitado como esta)")
  }
  if (opts.mutateDocClaim || opts.mutateDocRenumber || opts.mutate) {
    steps.push(`git: add -A && HUSKY=0 commit -m "hook-proof: ${b} (mutacao)"  (HUSKY=0 - a mutacao viola um gate de proposito)`)
  }
  steps.push(`shas: new = HEAD (mutacao), old = ${opts.baseSha ? `--base-sha ${opts.baseSha}` : "HEAD~1 (delta) ou all-zeros (1o push)"}`)
  steps.push(`hook: printf 'refs/heads/${b} <new> refs/heads/${b} <old>' | bash ${opts.hook ?? DEFAULT_HOOK}  (push SIMULADO via stdin - sem rede)`)
  steps.push(`verify: exit==${opts.expectExit}${opts.expectCure ? " + CURE (sec 11.54)" : ""}${opts.expectLog ? ` + log ~= /${opts.expectLog}/` : ""}`)
  if (!opts.keep) {
    steps.push(`git: checkout ${originalBranch} && branch -D ${b}  (revert da scratch)`)
    steps.push("git: apply <patch> + untracked restaurados + doc do byte-copy  (revert byte-identical)")
    steps.push("verify-revert: git status identico ao snapshot (o equivalente do md5 pre=pos)")
  } else {
    steps.push("git: (--keep-branch: scratch mantida para inspecao)")
  }
  if (opts.cleanupOnFail) {
    steps.push("cleanup-on-fail: os fail paths POS-scratch de infra rodam o revertCycle (a scratch nao fica - sec 11.69)")
  }
  return steps
}

/**
 * Run git com o override hermetico HOOK_PROOF_GIT (o fixture fake-bins,
 * invocado via process.execPath com o role 'git' como arg[2] - o mesmo padrao
 * cross-platform do CI_PROOF_GIT do ci-proof-run). Default = git real no PATH.
 */
export function runGit(args) {
  const fake = process.env.HOOK_PROOF_GIT
  const cmd = fake ? [process.execPath, fake, "git", ...args] : ["git", ...args]
  const r = spawnSync(cmd[0], cmd.slice(1), { encoding: "utf8", env: process.env, cwd: process.cwd() })
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" }
}

const git = (args) => runGit(args)

/**
 * runHook - spawna o hook REAL (bash) com o payload de refs no stdin - o
 * push SIMULADO. --hook override nos testes (o fixture fake-hook.sh); default
 * .husky/pre-push. Retorna { status, stdout, stderr }.
 */
export function runHook(payload, hookPath) {
  const r = spawnSync("bash", [hookPath], { encoding: "utf8", input: payload, env: process.env, cwd: process.cwd() })
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" }
}

function fail(code, msg) {
  console.error(`hook-proof-run: ${msg}`)
  return code
}

// O mesmo padrao do stashLeftNote do ci-proof-run (sec 11.41): os fail paths
// apos o checkout -b deixam o usuario NA branch scratch com a mutacao nao-
// commitada - a mensagem tem que dizer como sair (a nota de limpeza, nunca o
// silencio). O revert normal cobre o sucesso E a divergencia de verify; os
// fail paths de infra (commit/mutate/doc) nao chegam ao revert.
const scratchLeftNote = (originalBranch, branch, backupDir) =>
  ` - a branch scratch pode ter ficado: git checkout ${originalBranch} && git branch -D ${branch} (backup do delta em ${backupDir})`

// A CURE stage-aware do revert-fail (sec 11.75, o ACHADO da Prova 43, sec
// 8.38): o revertCycle roda o branch -D ANTES do apply - quando o apply (ou
// o status) falha, a scratch JA foi deletada com o commit do delta dentro
// (orfao no reflog) e a receita generica do scratchLeftNote ("git checkout
// <orig> && git branch -D <branch>") descreve um estado que NAO existe mais:
// o checkout ja voltou e o branch -D falharia ("no such branch"). A
// recuperacao do apply-fail e em 2 NIVEIS (o refinamento 2026-08-12): (1)
// 'git apply <backup>/delta.patch' - o patch do backup e a fonte PRIMARIA
// quando integro (a receita do dia a dia); (2) SO quando o patch for
// INVALIDO (corrompido - a classe da Prova 43): o reflog do commit orfao
// (git reflog + git cherry-pick <sha>) ou o safety diff externo - o padrao
// da CURE da sec 11.54 (o comando exato no erro, a fonte unica consumida
// pelos 2 pontos de conversao). O status-fail e DIFERENTE (o apply do ciclo
// PASSou - o delta JA esta na arvore): a CURE reconcilia o git status com o
// snapshot do backup, com o reflog como fallback. Para os fail paths onde a
// scratch AINDA existe (checkout-fail e branch-D-fail - o branch -D nao
// rodou), a receita generica continua valida: a funcao despacha pelo stage
// do revert.
export function revertLeftNote(stage, originalBranch, branch, backupDir, safetyDiff) {
  // O --safety-diff (sec 11.77): quando o path externo foi salvo, a CURE
  // cita o comando exato (git apply <path>) - a fonte que sobrevive a
  // corrupcao do delta.patch do backup (a classe da Prova 43). Sem o
  // path, a CURE permanece generica (o reflog/cherry-pick). Hoisted acima
  // dos branches (regra dos 2 usos - o apply E o status citam o mesmo
  // sufixo do safety diff).
  const sd = safetyDiff ? `: git apply ${safetyDiff}` : " externo"
  if (stage === "apply") {
    return ` - o branch -D JA rodou (a scratch ${branch} foi deletada com o commit do delta dentro, orfao no reflog): recupere em 2 NIVEIS - (1) 'git apply ${backupDir}/delta.patch' (o patch do backup e a fonte PRIMARIA quando integro - a receita do dia a dia); (2) SO quando o patch for INVALIDO (corrompido - a classe da Prova 43): 'git reflog' (procure 'hook-proof: ${branch} (delta)') + 'git cherry-pick <sha>' ou aplique o safety diff${sd} (backup em ${backupDir})`
  }
  if (stage === "status") {
    return ` - o apply do delta PASSou (o delta do ciclo JA esta na arvore - o revert so falhou na comparacao do git status vs o snapshot): compare 'git status --porcelain' com ${backupDir}/status-before.txt e reconcilie a divergencia; se o delta faltar, recupere do reflog ('git reflog' + 'git cherry-pick <sha>') ou do safety diff${sd} (backup em ${backupDir})`
  }
  return scratchLeftNote(originalBranch, branch, backupDir)
}

/**
 * cleanupOnFailSuffix - o sufixo dos fail paths de MUTACAO POS-scratch com
 * --cleanup-on-fail (sec 11.69): roda o revertCycle ANTES do fail(3) - a
 * scratch NAO fica e as etapas do byte-copy (untracked restaurados + doc do
 * byte-copy + status identico ao snapshot) sao feitas pelo MESMO codigo do
 * revert normal (a fonte unica da restauracao, nunca uma copia manual - o
 * ACHADO da Prova 41, sec 8.36: a limpeza manual precisava LEMBRAR de
 * restaurar os untracked). Um revertCycle que falha e reportado JUNTO com a
 * nota de saida (o usuario pode ter ficado na scratch - a receita nunca pode
 * faltar, o espirito da sec 11.65).
 */
function cleanupOnFailSuffix(originalBranch, branch, backupDir, docPath, safetyDiff, applySafetyDiffOnFail) {
  const rv = revertCycle(branch, originalBranch, backupDir, docPath, safetyDiff, applySafetyDiffOnFail)
  if (rv.ok) return ` | cleanup-on-fail: ${rv.message}`
  return ` | cleanup-on-fail FALHOU: ${rv.message}${revertLeftNote(rv.stage, originalBranch, branch, backupDir, safetyDiff)}`
}

/**
 * revertCycle - o revert byte-identical (Prova 38): checkout da original +
 * branch -D + git apply <patch> (SO quando o patch nao e vazio - um apply
 * vazio erra 'unrecognized input' exit 128 numa arvore limpa) + untracked
 * restaurados + doc restaurado do byte-copy + git status identico ao
 * snapshot. Retorna { ok, message } - o revert PARTICIPA do exit code do
 * sucesso (uma scratch deixada nao passa como exit 0).
 */
export function revertCycle(branch, originalBranch, backupDir, docPath, safetyDiff = null, applySafetyDiffOnFail = false) {
  const co = git(["checkout", originalBranch])
  if (co.status !== 0) return { ok: false, stage: "checkout", message: `git checkout ${originalBranch} falhou: ${co.stderr.trim()} - backup em ${backupDir}` }
  const bd = git(["branch", "-D", branch])
  if (bd.status !== 0) return { ok: false, stage: "branchD", message: `git branch -D ${branch} falhou: ${bd.stderr.trim()} - backup em ${backupDir}` }
  const patchPath = path.join(backupDir, "delta.patch")
  if (fs.readFileSync(patchPath, "utf8").trim() !== "") {
    const ap = git(["apply", patchPath])
    if (ap.status !== 0) {
      // --apply-safety-diff-on-fail (sec 11.88): o revert vira AUTO-CURATIVO -
      // se o safety diff foi salvo, tenta-o ANTES de falhar (a classe da
      // Prova 43, sec 8.38, era 100% manual: a CURE citava o caminho e o
      // usuario aplicava a mao). O exit code do CICLO passa a refletir a
      // auto-cura: com o safety diff valido, o revert completa e o ciclo
      // sai exit 0 (o sinal muda de 'perda de delta' para 'ciclo normal').
      if (applySafetyDiffOnFail && safetyDiff) {
        const sd = git(["apply", safetyDiff])
        if (sd.status !== 0) {
          return { ok: false, stage: "apply", message: `git apply delta.patch falhou: ${ap.stderr.trim()} E o safety diff ${safetyDiff} tambem falhou: ${sd.stderr.trim()} - backup em ${backupDir}` }
        }
      } else {
        return { ok: false, stage: "apply", message: `git apply delta.patch falhou: ${ap.stderr.trim()} - backup em ${backupDir}` }
      }
    }
  }
  // untracked restaurados (byte-copy do backup).
  const untDir = path.join(backupDir, "untracked")
  if (fs.existsSync(untDir)) {
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const src = path.join(dir, e.name)
        const rel = path.relative(untDir, src)
        if (e.isDirectory()) walk(src)
        else fs.copyFileSync(src, path.join(process.cwd(), rel))
      }
    }
    walk(untDir)
  }
  // doc restaurado do byte-copy (o arquivo que a mutacao tocou).
  const docBk = path.join(backupDir, "doc-before.md")
  if (fs.existsSync(docBk)) fs.copyFileSync(docBk, docPath)
  // git status identico ao snapshot (o equivalente estrutural do md5 pre=pos).
  const st = git(["status", "--porcelain"])
  const before = fs.readFileSync(path.join(backupDir, "status-before.txt"), "utf8")
  if ((st.stdout ?? "") !== before) {
    return { ok: false, stage: "status", message: `git status divergiu do snapshot pre-ciclo - backup em ${backupDir}` }
  }
  return { ok: true, message: `revertido (${originalBranch}, scratch deletada, status identico)` }
}

/**
 * Main flow. Retorna o exit code (entry-point guard seta process.exitCode).
 */
export function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.error) return fail(2, opts.error)
  if (!isCiProofBranch(opts.branch)) {
    return fail(2, `branch '${opts.branch}' fora do namespace ci-proof/* (Type E, scan-surfaces.md secao 6) - use ci-proof/<nome>`)
  }

  const head = git(["rev-parse", "--abbrev-ref", "HEAD"])
  if (head.status !== 0) return fail(3, `git rev-parse falhou: ${head.stderr.trim()}`)
  const originalBranch = head.stdout.trim() || "HEAD"

  if (opts.dryRun) {
    console.log(`hook-proof-run: PLAN (dry-run) branch=${opts.branch} (nenhum comando executado)`)
    for (const s of planSteps(opts, originalBranch)) console.log(`  ${s}`)
    return 0
  }

  const docPath = process.env.HOOK_PROOF_DOC || path.join(process.cwd(), DOC_REL)
  const hookPath = opts.hook ? path.resolve(process.cwd(), opts.hook) : path.resolve(process.cwd(), DEFAULT_HOOK)
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "hook-proof-"))
  // --safety-diff (sec 11.77): o path resolvido UMA vez - a gravacao E a
  // CURE citam o MESMO caminho absoluto (o recipe vale mesmo se o cwd mudar
  // entre a gravacao e a recuperacao - o fix do reviewer, sec 11.77).
  const safetyDiff = opts.safetyDiff ? path.resolve(opts.safetyDiff) : null
  // --safety-backup (sec 11.89): o dir resolvido UMA vez (o MESMO padrao do
  // safety-diff - o espelho e citado na mensagem com o caminho absoluto).
  const safetyBackup = opts.safetyBackup ? path.resolve(opts.safetyBackup) : null

  // 2. BACKUP (o padrao Prova 38 - o delta NAO-COMMITADO da working tree).
  const patch = git(["diff"])
  if (patch.status !== 0) return fail(3, `git diff falhou: ${patch.stderr.trim()}`)
  fs.writeFileSync(path.join(backupDir, "delta.patch"), patch.stdout, "utf8")
  // --safety-diff (sec 11.77): o MESMO diff gravado num path EXTERNO ao
  // backup, ANTES de qualquer mutacao - a copia que sobrevive a corrupcao
  // do delta.patch do backup (o ACHADO da Prova 43, sec 8.38: a mutacao
  // corrompeu o patch do backup e a recuperacao so via safety diff externo).
  // Fail-loud no path nao-gravavel (o dir pai inexistente lancaria ENOENT
  // fora do contrato de exit code - o fix do reviewer, sec 11.77).
  if (safetyDiff) {
    try {
      fs.writeFileSync(safetyDiff, patch.stdout, "utf8")
    } catch (e) {
      return fail(3, `safety diff nao gravavel em ${safetyDiff}: ${e.message}`)
    }
  }
  const untracked = git(["ls-files", "--others", "--exclude-standard"])
  if (untracked.status !== 0) return fail(3, `git ls-files falhou: ${untracked.stderr.trim()}`)
  const untDir = path.join(backupDir, "untracked")
  for (const rel of (untracked.stdout ?? "").split("\n").filter((l) => l.trim() !== "")) {
    const src = path.join(process.cwd(), rel)
    if (!fs.existsSync(src)) continue
    const dst = path.join(untDir, rel)
    fs.mkdirSync(path.dirname(dst), { recursive: true })
    fs.copyFileSync(src, dst)
  }
  const st = git(["status", "--porcelain"])
  fs.writeFileSync(path.join(backupDir, "status-before.txt"), st.stdout ?? "", "utf8")
  if (fs.existsSync(docPath)) fs.copyFileSync(docPath, path.join(backupDir, "doc-before.md"))
  // --safety-backup (sec 11.89): o espelho EXTERNO do backup INTEIRO
  // (delta.patch + untracked/ + status-before.txt + doc-before.md) num path
  // fora do tmpdir. O safety-diff (11.77) cobre SO o diff; este cobre o
  // ciclo completo: a recuperacao manual da classe de perda total nao
  // depende do tmpdir sobreviver. Fail-loud no dir nao-gravavel (o MESMO
  // padrao do safety-diff, sec 11.77 - o ENOENT/EEXIST cru fora do contrato
  // de exit code). O espelho roda APOS o backup completo (a etapa 2 inteira)
  // e ANTES de qualquer mutacao (a copia do estado PRE-mutacao).
  if (safetyBackup) {
    try {
      // O contrato do espelho (sec 11.89): o PAI do dir deve EXISTIR - o
      // MESMO do safety-diff (sec 11.77: o writeFileSync nao cria parents a
      // deriva; o ENOENT/EEXIST cru vira fail(3) no contrato). mkdirSync
      // NAO-recursivo so cria o dir FOLHA: ENOENT se o pai falta (o fail-loud
      // do teste 'dir pai inexistente'); se um ARQUIVO ocupa o path, o
      // existsSync pula o mkdir e o walk (copyFileSync em path.join(file,
      // name)) lanca ENOTDIR - os dois viram fail(3) no try/catch. Um mkdir
      // recursive criaria os pais em silencio e o fail-loud nunca dispararia
      // (o vitest pegou ao vivo).
      if (!fs.existsSync(safetyBackup)) fs.mkdirSync(safetyBackup)
      const walk = (srcDir, dstDir) => {
        for (const e of fs.readdirSync(srcDir, { withFileTypes: true })) {
          const s = path.join(srcDir, e.name)
          const d = path.join(dstDir, e.name)
          if (e.isDirectory()) {
            fs.mkdirSync(d, { recursive: true })
            walk(s, d)
          } else {
            fs.copyFileSync(s, d)
          }
        }
      }
      walk(backupDir, safetyBackup)
    } catch (e) {
      return fail(3, `safety backup nao gravavel em ${safetyBackup}: ${e.message}`)
    }
  }

  // 3. SCRATCH + delta materializado (HUSKY=0 - o commit do estado verde
  // local, igual ao ciclo manual das Provas 37/38). SO quando a arvore tem
  // delta: uma arvore LIMPA e um input legitimo (o helper prova o estado
  // commitado como esta) e um git commit vazio falharia 'nothing to commit'.
  process.env.HUSKY = "0"
  const cb = git(["checkout", "-b", opts.branch])
  if (cb.status !== 0) return fail(3, `git checkout -b ${opts.branch} falhou: ${cb.stderr.trim()} - backup em ${backupDir}`)
  const stDelta = git(["status", "--porcelain"])
  if ((stDelta.stdout ?? "").trim() !== "") {
    git(["add", "-A"])
    const cm1 = git(["commit", "-m", `hook-proof: ${opts.branch} (delta)`])
    if (cm1.status !== 0) return fail(3, `git commit do delta falhou: ${cm1.stderr.trim()}${opts.cleanupOnFail ? cleanupOnFailSuffix(originalBranch, opts.branch, backupDir, docPath, safetyDiff, opts.applySafetyDiffOnFail) : scratchLeftNote(originalBranch, opts.branch, backupDir)}`)
  }

  // 4. MUTACAO (--mutate-doc-claim | --mutate) + commit HUSKY=0 (SO quando a
  // mutacao alterou a arvore - uma mutacao no-op nao pode falhar o ciclo).
  if (opts.mutateDocClaim) {
    if (!fs.existsSync(docPath)) return fail(3, `doc nao encontrado: ${docPath} (--mutate-doc-claim precisa do gates-proofs.md)${opts.cleanupOnFail ? cleanupOnFailSuffix(originalBranch, opts.branch, backupDir, docPath, safetyDiff, opts.applySafetyDiffOnFail) : scratchLeftNote(originalBranch, opts.branch, backupDir)}`)
    const doc = fs.readFileSync(docPath, "utf8")
    fs.writeFileSync(docPath, injectDocClaim(doc, opts.mutateDocClaim), "utf8")
  } else if (opts.mutateDocRenumber) {
    if (!fs.existsSync(docPath)) return fail(3, `doc nao encontrado: ${docPath} (--mutate-doc-renumber precisa do gates-proofs.md)${opts.cleanupOnFail ? cleanupOnFailSuffix(originalBranch, opts.branch, backupDir, docPath, safetyDiff, opts.applySafetyDiffOnFail) : scratchLeftNote(originalBranch, opts.branch, backupDir)}`)
    const doc = fs.readFileSync(docPath, "utf8")
    try {
      fs.writeFileSync(docPath, renumberDocSection(doc, opts.mutateDocRenumber, opts.to), "utf8")
    } catch (e) {
      return fail(3, `${e.message}${opts.cleanupOnFail ? cleanupOnFailSuffix(originalBranch, opts.branch, backupDir, docPath, safetyDiff, opts.applySafetyDiffOnFail) : scratchLeftNote(originalBranch, opts.branch, backupDir)}`)
    }
  } else if (opts.mutate) {
    const m = spawnSync(opts.mutate, { shell: true, encoding: "utf8", cwd: process.cwd() })
    if (m.status !== 0) {
      return fail(3, `--mutate falhou (exit ${m.status}): ${(m.stderr ?? m.stdout ?? "").trim()}${opts.cleanupOnFail ? cleanupOnFailSuffix(originalBranch, opts.branch, backupDir, docPath, safetyDiff, opts.applySafetyDiffOnFail) : scratchLeftNote(originalBranch, opts.branch, backupDir)}`)
    }
  }
  if (opts.mutateDocClaim || opts.mutateDocRenumber || opts.mutate) {
    const stMut = git(["status", "--porcelain"])
    if ((stMut.stdout ?? "").trim() !== "") {
      git(["add", "-A"])
      const cm2 = git(["commit", "-m", `hook-proof: ${opts.branch} (mutacao)`])
      if (cm2.status !== 0) return fail(3, `git commit da mutacao falhou: ${cm2.stderr.trim()}${opts.cleanupOnFail ? cleanupOnFailSuffix(originalBranch, opts.branch, backupDir, docPath, safetyDiff, opts.applySafetyDiffOnFail) : scratchLeftNote(originalBranch, opts.branch, backupDir)}`)
    } else {
      console.log("hook-proof-run: a mutacao nao alterou a arvore - sem commit da mutacao")
    }
  }

  // 5. SHAS do push simulado: new = HEAD (mutacao); old = --base-sha OU
  // HEAD~1 (delta) OU all-zeros (1o push - o mesmo fallback do runner).
  const newR = git(["rev-parse", "HEAD"])
  const newSha = newR.status === 0 && newR.stdout.trim() ? newR.stdout.trim() : ALL_ZEROS
  let oldSha = opts.baseSha
  if (!oldSha) {
    const oldR = git(["rev-parse", "HEAD~1"])
    oldSha = oldR.status === 0 && oldR.stdout.trim() ? oldR.stdout.trim() : ALL_ZEROS
  }

  // 6. PUSH SIMULADO: o payload de refs no stdin do hook (o mesmo shape da
  // Prova 38: printf 'refs/heads/<b> <new> refs/heads/<b> <old>').
  const payload = `refs/heads/${opts.branch} ${newSha} refs/heads/${opts.branch} ${oldSha}\n`
  const hook = runHook(payload, hookPath)
  const logPath = path.join(backupDir, "hook.log")
  fs.writeFileSync(logPath, hook.stdout ?? "", "utf8")
  console.log(`hook-proof-run: hook exit ${hook.status} - log em ${logPath} (${(hook.stdout ?? "").split("\n").length} linhas)`)

  // 7. VERIFY.
  const check = verifyLocalHook({ status: hook.status, stdout: hook.stdout ?? "" }, opts)
  console.log(`hook-proof-run: verify: ${check.message}`)

  // 8. REVERT (a scratch NAO fica - salvo --keep-branch). O resultado do
  // revert PARTICIPA do exit code do sucesso.
  const reverted = opts.keep ? { ok: true } : revertCycle(opts.branch, originalBranch, backupDir, docPath, safetyDiff, opts.applySafetyDiffOnFail)
  // O revert-fail e um fail path POS-scratch (sec 11.65 + 11.75): o
  // revertCycle pode ter falhado ANTES de completar a limpeza (checkout /
  // branch -D / apply / status) - o usuario pode ter ficado na scratch OU
// com a arvore parcial. A nota de saida e stage-aware (revertLeftNote): a
// scratch pode TER ficado (checkout/branch-D fail - a receita generica) ou
// ja pode ter sido DELETADA com o delta orfao no reflog (apply fail - a
// CURE em 2 niveis, sec 11.75; status fail - a CURE do snapshot - o ACHADO
// da Prova 43). O silencio seria a classe do fail silencioso.
  if (!reverted.ok) return fail(3, `${reverted.message}${revertLeftNote(reverted.stage, originalBranch, opts.branch, backupDir, safetyDiff)}`)

  // 9. SUMMARY.
  if (!check.ok) return fail(1, check.message)
  console.log(`hook-proof-run: DONE branch=${opts.branch} hook_exit=${hook.status}${opts.expectCure ? " + CURE" : ""} - log em ${logPath}`)
  return 0
}

// Entry-point guard: so roda o CLI quando executado direto (vitest importa as
// funcoes puras para os testes sem efeitos colaterais).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main()
}
