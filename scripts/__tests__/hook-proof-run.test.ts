/**
 * hook-proof-run.mjs - o ciclo de prova de HOOK LOCAL num comando (2026-08-11,
 * sec 11.58). O espelho do ci-proof-run.mjs para a rede LOCAL.
 *
 * WHY: o ciclo manual das Provas 37/38 (backup + scratch ci-proof/* + delta
 * commitado via HUSKY=0 + mutacao commitada + push SIMULADO via stdin no hook
 * real + revert byte-identical) rodou 2x - a regra dos 2 usos para extracao.
 * Este helper automatiza o padrao num comando; a suite pina as funcoes puras
 * (parseArgs, injectDocClaim, verifyLocalHook, planSteps) com conteudo
 * sintetico, o ciclo E2E com bins falsos (HOOK_PROOF_GIT -> o fixture
 * hook-proof-fake-bins.mjs + --hook -> o fixture hook-proof-fake-hook.sh) e
 * o REAL-REPO CONTRACT do --dry-run (o plano puro, sem executar NADA).
 *
 * HERMETICIDADE: nenhum git/hook real roda no caminho E2E - o CLI spawna o
 * fixture via os mesmos seams que o ci-proof-run (env overrides herdados pelo
 * spawnSync). O doc do --mutate-doc-claim e um temp file via HOOK_PROOF_DOC
 * (o seam hermetico - nunca toca o gates-proofs.md real em teste).
 *
 * Subprocess-heavy (os E2E spawnam node + bash) -> um timeout explicito em
 * todo it() (o scan-timeouts guard exige).
 */
import { afterEach, describe, expect, it } from "vitest"
import fs from "node:fs"
import path from "node:path"
import { EXIT_CLAIMS_CURE } from "../scan-exit-claims.mjs"
import { injectDocClaim, isManualDocRenameCmd, parseArgs, planSteps, renumberDocSection, revertLeftNote, verifyLocalHook } from "../hook-proof-run.mjs"
import { cleanupTempDirs, createTempDir, runSubprocess } from "./golden-copy-utils"

const SCRIPT = path.resolve(process.cwd(), "scripts", "hook-proof-run.mjs")
const FAKE_BINS = path.resolve(process.cwd(), "scripts", "__tests__", "fixtures", "hook-proof-fake-bins.mjs")
const FAKE_HOOK = path.resolve(process.cwd(), "scripts", "__tests__", "fixtures", "hook-proof-fake-hook.sh")

/** Um doc sintetico para o --mutate-doc-claim (a sec 11.42 registrada + a 12). */
const SYNTH_DOC = [
  "## 11.42 o CLI scan-exit-claims sai exit code 0 no doc real",
  "",
  "**Exit codes**: exit code 0 (doc coberto) / exit code 1 (violacoes listadas).",
  "",
  "## 12. Referências",
  "",
].join("\n")

/**
 * O doc do E2E de COLISAO: a secao 11.42 (a fonte) E a 11.58 (o alvo que JA
 * existe no doc). Renumerar 11.42 -> 11.58 cria um header duplicado - o par
 * ambiguo que a sec 11.59 trava (reviewer, sec 11.59). O SYNTH_DOC padrao
 * NAO serve: so tem a 11.42 e a 12, entao o --to 11.58 nao colidiria.
 */
const COLLISION_DOC = [
  "## 11.42 a fonte",
  "",
  "## 11.58 o alvo existente",
  "",
  "## 12. Referências",
  "",
].join("\n")

/** Run the CLI with the hermetic fake-bin env (same shape as the ci-proof-run E2E). */
function runCli(args: string[], env: Record<string, string> = {}) {
  return runSubprocess({
    command: process.execPath,
    args: [SCRIPT, ...args],
    env: { HOOK_PROOF_GIT: FAKE_BINS, ...env },
    timeoutMs: 60_000,
  })
}

/** Read the fake-bins invocation log (one line per git call, in order). */
function readInvocations(stateDir: string): string {
  return fs.readFileSync(path.join(stateDir, "invocations.log"), "utf8")
}

describe("hook-proof-run.mjs - ciclo de prova de hook local num comando (sec 11.58)", () => {
  afterEach(cleanupTempDirs)

  describe("parseArgs", () => {
    it("defaults: expectExit 1 (o hook DEVE bloquear), hook default .husky/pre-push", () => {
      const o = parseArgs(["--branch", "ci-proof/lpr-x"])
      expect(o.error).toBeNull()
      expect(o.branch).toBe("ci-proof/lpr-x")
      expect(o.expectExit).toBe(1)
      expect(o.expectCure).toBe(false)
      expect(o.mutateDocClaim).toBeNull()
      expect(o.mutate).toBeNull()
      expect(o.hook).toBeNull()
      expect(o.keep).toBe(false)
    }, 60000)

    it("--mutate-doc-claim <sec> e --expect-cure parseiam", () => {
      const o = parseArgs(["--branch", "ci-proof/lpr-x", "--mutate-doc-claim", "11.99", "--expect-cure"])
      expect(o.error).toBeNull()
      expect(o.mutateDocClaim).toBe("11.99")
      expect(o.expectCure).toBe(true)
    }, 60000)

    it("--expect-exit 0 e preservado (a prova POSITIVA - o Number.isNaN fix do review)", () => {
      const o = parseArgs(["--branch", "ci-proof/lpr-x", "--expect-exit", "0"])
      expect(o.error).toBeNull()
      expect(o.expectExit).toBe(0)
      // ausente/nao-numerico -> default 1 (nao confunde com o 0 explicito)
      expect(parseArgs(["--branch", "ci-proof/lpr-x"]).expectExit).toBe(1)
      expect(parseArgs(["--branch", "ci-proof/lpr-x", "--expect-exit", "abc"]).expectExit).toBe(1)
    }, 60000)

    it("--expect-exit, --expect-log, --base-sha, --hook, --keep-branch, --dry-run parseiam", () => {
      const o = parseArgs([
        "--branch", "ci-proof/lpr-x",
        "--expect-exit", "2",
        "--expect-log", "CURE",
        "--base-sha", "abc123",
        "--hook", ".husky/pre-push",
        "--keep-branch",
        "--dry-run",
      ])
      expect(o.error).toBeNull()
      expect(o.expectExit).toBe(2)
      expect(o.expectLog).toBe("CURE")
      expect(o.baseSha).toBe("abc123")
      expect(o.hook).toBe(".husky/pre-push")
      expect(o.keep).toBe(true)
      expect(o.dryRun).toBe(true)
    }, 60000)

    it("--mutate-doc-renumber <sec> --to <nova> parseiam (a classe stale da Prova 39)", () => {
      const o = parseArgs(["--branch", "ci-proof/lpr-x", "--mutate-doc-renumber", "11.42", "--to", "11.98"])
      expect(o.error).toBeNull()
      expect(o.mutateDocRenumber).toBe("11.42")
      expect(o.to).toBe("11.98")
    }, 60000)

    it("as 3 mutacoes sao mutuamente exclusivas (claim | renumber | shell - uma mutacao por ciclo)", () => {
      const a = parseArgs(["--branch", "ci-proof/lpr-x", "--mutate-doc-claim", "11.99", "--mutate-doc-renumber", "11.42", "--to", "11.98"])
      expect(a.error).toContain("mutuamente exclusivos")
      const b = parseArgs(["--branch", "ci-proof/lpr-x", "--mutate-doc-renumber", "11.42", "--to", "11.98", "--mutate", "touch x"])
      expect(b.error).toContain("mutuamente exclusivos")
    }, 60000)

    it("--to sem --mutate-doc-renumber -> erro; --mutate-doc-renumber sem --to -> erro (o target da renumeracao)", () => {
      expect(parseArgs(["--branch", "ci-proof/lpr-x", "--to", "11.98"]).error).toContain("--to so faz sentido")
      expect(parseArgs(["--branch", "ci-proof/lpr-x", "--mutate-doc-renumber", "11.42"]).error).toContain("precisa de --to")
    }, 60000)

    it("--to com shape nao-secao -> erro no parse (o sinal da prova se perderia, sec 11.59)", () => {
      expect(parseArgs(["--branch", "ci-proof/lpr-x", "--mutate-doc-renumber", "11.42", "--to", "foo"]).error).toContain("nao parece uma secao")
      expect(parseArgs(["--branch", "ci-proof/lpr-x", "--mutate-doc-renumber", "11.42", "--to", "11.98"]).error).toBeNull()
    }, 60000)

    it("TRIPWIRE: --mutate citando 'sed' + '## ' (o rename manual das Provas 39/40) -> erro no parse apontando o --mutate-doc-renumber (sec 11.59)", () => {
      const o = parseArgs(["--branch", "ci-proof/lpr-x", "--mutate", "sed -i 's/## 11.58 /## 11.98 /' docs/gates-proofs.md"])
      expect(o.error).toContain("--mutate-doc-renumber")
      expect(o.error).toContain("sed")
    }, 60000)

    it("TRIPWIRE: o escape hatch NAO-doc permanece (sed sem '## ' - ex.: workflow yml) -> parse OK", () => {
      const o = parseArgs(["--branch", "ci-proof/lpr-x", "--mutate", "sed -i 's/guard-gates/guard-gates-pr/' .github/workflows/guard-gates.yml"])
      expect(o.error).toBeNull()
      expect(o.mutate).toContain("guard-gates.yml")
    }, 60000)

    it("--mutate e --mutate-doc-claim sao mutuamente exclusivos (uma mutacao por ciclo)", () => {
      const o = parseArgs(["--branch", "ci-proof/lpr-x", "--mutate-doc-claim", "11.99", "--mutate", "touch x"])
      expect(o.error).toContain("mutuamente exclusivos")
    }, 60000)

    it("--branch ausente -> usage; flag desconhecida -> erro; --help -> usage", () => {
      expect(parseArgs([]).error).toContain("usage")
      expect(parseArgs(["--branch", "ci-proof/lpr-x", "--bogus"]).error).toContain("desconhecida")
      expect(parseArgs(["--help"]).error).toContain("usage")
    }, 60000)

    it("--cleanup-on-fail parseia (o fechamento do ACHADO da Prova 41, sec 11.69)", () => {
      const o = parseArgs(["--branch", "ci-proof/lpr-x", "--cleanup-on-fail"])
      expect(o.error).toBeNull()
      expect(o.cleanupOnFail).toBe(true)
      // default: false (a limpeza manual continua o comportamento padrao)
      expect(parseArgs(["--branch", "ci-proof/lpr-x"]).cleanupOnFail).toBe(false)
    }, 60000)

    it("--apply-safety-diff-on-fail parseia (o revert auto-curativo, sec 11.88) - e so faz sentido com --safety-diff", () => {
      const o = parseArgs(["--branch", "ci-proof/lpr-x", "--apply-safety-diff-on-fail"])
      expect(o.error).toBeNull()
      expect(o.applySafetyDiffOnFail).toBe(true)
      // default: false (a recuperacao da Prova 43 continua manual por padrao)
      expect(parseArgs(["--branch", "ci-proof/lpr-x"]).applySafetyDiffOnFail).toBe(false)
      // o par flag + path: o fallback so tem o que aplicar se o safety diff
      // foi salvo - a flag sozinha e inerte (o revertCycle nao tem o path)
      const pair = parseArgs(["--branch", "ci-proof/lpr-x", "--safety-diff", "/tmp/sd.patch", "--apply-safety-diff-on-fail"])
      expect(pair.error).toBeNull()
      expect(pair.safetyDiff).toBe("/tmp/sd.patch")
      expect(pair.applySafetyDiffOnFail).toBe(true)
    }, 60000)

    it("--safety-backup <dir> parseia (o espelho do backup inteiro, sec 11.89) - e independe do --safety-diff", () => {
      const o = parseArgs(["--branch", "ci-proof/lpr-x", "--safety-backup", "/tmp/sb"])
      expect(o.error).toBeNull()
      expect(o.safetyBackup).toBe("/tmp/sb")
      // default: null (o espelho e opt-in - o backup vive so no tmpdir)
      expect(parseArgs(["--branch", "ci-proof/lpr-x"]).safetyBackup).toBeNull()
      // as 3 flags de safety coexistem (diff + auto-cura + backup inteiro)
      const all = parseArgs(["--branch", "ci-proof/lpr-x", "--safety-diff", "/tmp/sd.patch", "--apply-safety-diff-on-fail", "--safety-backup", "/tmp/sb"])
      expect(all.error).toBeNull()
      expect(all.safetyDiff).toBe("/tmp/sd.patch")
      expect(all.applySafetyDiffOnFail).toBe(true)
      expect(all.safetyBackup).toBe("/tmp/sb")
    }, 60000)
  })

  describe("injectDocClaim", () => {
    it("injeta a claim fake ANTES do '## 12.' (a ancora da Prova 38)", () => {
      const out = injectDocClaim(SYNTH_DOC, "11.99")
      expect(out).toContain("## 11.99 Claim fake da prova")
      expect(out).toContain("**Exit codes**: exit code 3.")
      // a claim fica ANTES do ## 12. e o restante do doc e preservado
      const idxClaim = out.indexOf("## 11.99")
      const idx12 = out.indexOf("## 12.")
      expect(idxClaim).toBeGreaterThan(0)
      expect(idxClaim).toBeLessThan(idx12)
      expect(out.slice(idx12)).toContain("## 12. Referências")
    }, 60000)

    it("doc sem '## 12.' -> a claim e anexada ao fim (nao perde o doc)", () => {
      const out = injectDocClaim("## 11.42 alguma coisa\n", "11.98")
      expect(out).toContain("## 11.98 Claim fake da prova")
      expect(out.endsWith("exit code 3.\n\n")).toBe(true)
    }, 60000)

    it("a claim injetada e DETECTAVEL pelo detector real da sec 11.42 (exit code 3)", () => {
      const out = injectDocClaim(SYNTH_DOC, "11.99")
      // o detector casa `exit code 3` - a claim fake e um unregistered real
      expect(out).toMatch(/exit code 3\./)
    }, 60000)
  })

  describe("isManualDocRenameCmd (o tripwire do atalho manual, sec 11.59)", () => {
    it("sed + '## ' (o shape do rename manual das Provas 39/40) -> true", () => {
      expect(isManualDocRenameCmd("sed -i 's/## 11.58 /## 11.98 /' docs/gates-proofs.md")).toBe(true)
    }, 60000)

    it("sed sem '## ' (workflow yml - o escape hatch legitimo) -> false", () => {
      expect(isManualDocRenameCmd("sed -i 's/guard-gates/guard-gates-pr/' .github/workflows/guard-gates.yml")).toBe(false)
    }, 60000)

    it("'## ' sem sed (grep/awk - outra ferramenta) -> false", () => {
      expect(isManualDocRenameCmd("grep -n '## 11.58 ' docs/gates-proofs.md")).toBe(false)
    }, 60000)

    it("sed + '## ' em OUTRO .md (README.md - o escape hatch nao-doc inclui outro markdown) -> false (a fronteira e o gates-proofs.md, review sec 11.59)", () => {
      expect(isManualDocRenameCmd("sed -i 's/## old/## new/' README.md")).toBe(false)
    }, 60000)

    it("cmd vazio/irrelevante -> false", () => {
      expect(isManualDocRenameCmd("touch x")).toBe(false)
      expect(isManualDocRenameCmd("")).toBe(false)
    }, 60000)
  })

  describe("renumberDocSection", () => {
    it("renomeia o header '## <sec> ' para '## <to> ' - o 1 rename produz o PAR stale+unregistered da Prova 39", () => {
      const out = renumberDocSection(SYNTH_DOC, "11.42", "11.98")
      expect(out).toContain("## 11.98 o CLI scan-exit-claims")
      expect(out).not.toContain("## 11.42 o CLI scan-exit-claims")
      // o corpo da secao (as claims de exit code) e preservado - a 11.98 vira
      // unregistered e a entrada 11.42 do manifest fica stale
      expect(out).toContain("**Exit codes**: exit code 0")
      expect(out).toContain("## 12. Referências")
    }, 60000)

    it("secao ausente -> THROW (o Prova 17 ACHADO, sec 8.14: a mutacao no-op silenciosa esconderia o sinal da prova)", () => {
      expect(() => renumberDocSection(SYNTH_DOC, "11.77", "11.99")).toThrow(/nao encontrada/)
    }, 60000)

    it("a ancora e o header com espaco (nao casa prefixo parcial como '## 11.4')", () => {
      const out = renumberDocSection("## 11.4 outra coisa\n## 11.42 a alvo\n", "11.42", "11.98")
      expect(out).toContain("## 11.4 outra coisa")
      expect(out).toContain("## 11.98 a alvo")
      expect(out).not.toContain("## 11.42 a alvo")
    }, 60000)

    it("target JA existente -> THROW (header duplicado - o par ambiguo, sec 11.59)", () => {
      // renumerar 11.42 -> 11.58 colide com o header 11.58 que JA existe no doc
      const doc = "## 11.42 a fonte\n## 11.58 o alvo existente\n"
      expect(() => renumberDocSection(doc, "11.42", "11.58")).toThrow(/JA existe no doc/)
    }, 60000)

    it("to === sec -> THROW (a renumeracao nao alteraria nada - o no-op silencioso da classe ACHADO, sec 11.59)", () => {
      expect(() => renumberDocSection("## 11.42 a fonte\n", "11.42", "11.42")).toThrow(/JA existe no doc/)
    }, 60000)
  })

  describe("verifyLocalHook", () => {
    it("exit code igual ao esperado + CURE presente -> ok", () => {
      const v = verifyLocalHook({ status: 1, stdout: `x\n${EXIT_CLAIMS_CURE}\n` }, { expectExit: 1, expectCure: true, expectLog: null })
      expect(v.ok).toBe(true)
      expect(v.message).toContain("+ CURE")
    }, 60000)

    it("exit code divergente -> fail com o observado vs esperado", () => {
      const v = verifyLocalHook({ status: 0, stdout: "" }, { expectExit: 1, expectCure: false, expectLog: null })
      expect(v.ok).toBe(false)
      expect(v.message).toContain("hook exit 0 != esperado 1")
    }, 60000)

    it("--expect-cure sem a CURE na saida -> fail (a secao 11.54 e o sinal)", () => {
      const v = verifyLocalHook({ status: 1, stdout: "outro texto" }, { expectExit: 1, expectCure: true, expectLog: null })
      expect(v.ok).toBe(false)
      expect(v.message).toContain("NAO contem a CURE")
    }, 60000)

    it("--expect-log sem casar -> fail; casando -> ok", () => {
      const bad = verifyLocalHook({ status: 1, stdout: "foo" }, { expectExit: 1, expectCure: false, expectLog: "CURE" })
      expect(bad.ok).toBe(false)
      const good = verifyLocalHook({ status: 1, stdout: "a CURE line" }, { expectExit: 1, expectCure: false, expectLog: "CURE" })
      expect(good.ok).toBe(true)
    }, 60000)
  })

  describe("planSteps (dry-run)", () => {
    it("plano cobre backup -> scratch -> delta -> mutacao -> shas -> hook simulado -> verify -> revert", () => {
      const steps = planSteps({ branch: "ci-proof/lpr-x", mutateDocClaim: "11.99", mutate: null, expectExit: 1, expectCure: true, expectLog: null, baseSha: null, hook: null, keep: false }, "base")
      const joined = steps.join("\n")
      expect(joined).toContain("backup: git diff")
      expect(joined).toContain("checkout -b ci-proof/lpr-x")
      expect(joined).toContain("commit -m \"hook-proof: ci-proof/lpr-x (delta)\"")
      expect(joined).toContain("--mutate-doc-claim 11.99")
      expect(joined).toContain("commit -m \"hook-proof: ci-proof/lpr-x (mutacao)\"")
      expect(joined).toContain("printf 'refs/heads/ci-proof/lpr-x <new> refs/heads/ci-proof/lpr-x <old>' | bash .husky/pre-push")
      expect(joined).toContain("verify: exit==1 + CURE")
      expect(joined).toContain("checkout base && branch -D ci-proof/lpr-x")
      expect(joined).toContain("verify-revert")
    }, 60000)

    it("--keep-branch troca o revert pelo aviso de inspecao", () => {
      const steps = planSteps({ branch: "ci-proof/lpr-x", mutateDocClaim: null, mutate: null, expectExit: 1, expectCure: false, expectLog: null, baseSha: null, hook: null, keep: true }, "base")
      expect(steps.join("\n")).toContain("--keep-branch: scratch mantida")
    }, 60000)

    it("--mutate-doc-renumber aparece no plano com o target --to (a mutacao da classe stale)", () => {
      const steps = planSteps({ branch: "ci-proof/lpr-x", mutateDocClaim: null, mutateDocRenumber: "11.42", to: "11.98", mutate: null, expectExit: 1, expectCure: false, expectLog: null, baseSha: null, hook: null, keep: false }, "base")
      const joined = steps.join("\n")
      expect(joined).toContain("--mutate-doc-renumber 11.42 --to 11.98")
      expect(joined).toContain("commit -m \"hook-proof: ci-proof/lpr-x (mutacao)\"")
    }, 60000)

    it("--cleanup-on-fail aparece no plano (os fail paths de MUTACAO rodam o revertCycle - sec 11.69)", () => {
      const steps = planSteps({ branch: "ci-proof/lpr-x", mutateDocClaim: "11.99", mutate: null, expectExit: 1, expectCure: false, expectLog: null, baseSha: null, hook: null, keep: false, cleanupOnFail: true }, "base")
      expect(steps.join("\n")).toContain("cleanup-on-fail: os fail paths POS-scratch de infra")
    }, 60000)

    it("--apply-safety-diff-on-fail aparece no plano (o revert auto-curativo tenta o safety diff no apply-fail - sec 11.88)", () => {
      const steps = planSteps({ branch: "ci-proof/lpr-x", mutateDocClaim: null, mutate: null, expectExit: 1, expectCure: false, expectLog: null, baseSha: null, hook: null, keep: false, safetyDiff: "/tmp/sd.patch", applySafetyDiffOnFail: true }, "base")
      expect(steps.join("\n")).toContain("apply-safety-diff-on-fail: no apply-fail do revert")
      // sem a flag, o passo nao aparece (o fallback e opt-in)
      const noFlag = planSteps({ branch: "ci-proof/lpr-x", mutateDocClaim: null, mutate: null, expectExit: 1, expectCure: false, expectLog: null, baseSha: null, hook: null, keep: false, safetyDiff: "/tmp/sd.patch", applySafetyDiffOnFail: false }, "base")
      expect(noFlag.join("\n")).not.toContain("apply-safety-diff-on-fail")
    }, 60000)

    it("--safety-backup aparece no plano (o espelho do backup INTEIRO num path externo - sec 11.89)", () => {
      const steps = planSteps({ branch: "ci-proof/lpr-x", mutateDocClaim: null, mutate: null, expectExit: 1, expectCure: false, expectLog: null, baseSha: null, hook: null, keep: false, safetyBackup: "/tmp/sb" }, "base")
      expect(steps.join("\n")).toContain("safety-backup: espelha o BACKUP INTEIRO")
      expect(steps.join("\n")).toContain("/tmp/sb")
      // sem a flag, o passo nao aparece (o espelho e opt-in)
      const noFlag = planSteps({ branch: "ci-proof/lpr-x", mutateDocClaim: null, mutate: null, expectExit: 1, expectCure: false, expectLog: null, baseSha: null, hook: null, keep: false, safetyBackup: null }, "base")
      expect(noFlag.join("\n")).not.toContain("safety-backup:")
    }, 60000)
  })

  describe("E2E hermetico (fake git + fake hook)", () => {
    it("ciclo completo: claim 11.99 injetada, hook bloqueia (exit 1) com a CURE, revert byte-identical -> exit 0", () => {
      const stateDir = createTempDir("hpr-e2e-")
      const docDir = createTempDir("hpr-doc-")
      const docPath = path.join(docDir, "gates-proofs.md")
      fs.writeFileSync(docPath, SYNTH_DOC, "utf8")
      const r = runCli(
        ["--branch", "ci-proof/hpr-e2e", "--mutate-doc-claim", "11.99", "--expect-cure", "--hook", FAKE_HOOK],
        {
          HOOK_PROOF_FAKE_STATE: stateDir,
          HOOK_PROOF_FAKE_HOOK_OUTPUT: EXIT_CLAIMS_CURE,
          HOOK_PROOF_FAKE_HOOK_EXIT: "1",
          HOOK_PROOF_DOC: docPath,
          // arvore SUJA: o "ciclo completo" executa os commits de delta E
          // mutacao de verdade (o nome literal; a arvore-LIMPA test cobre o
          // papel da arvore limpa, review sec 11.58)
          HOOK_PROOF_FAKE_DIRTY: "1",
        },
      )
      expect(r.status).toBe(0)
      expect(r.stdout).toContain("verify: hook exit 1 + CURE")
      expect(r.stdout).toContain("DONE")
      // o doc foi restaurado do byte-copy (o revert byte-identical)
      expect(fs.readFileSync(docPath, "utf8")).toBe(SYNTH_DOC)
    }, 60000)

    it("a ORDEM do ciclo (backup -> scratch -> delta -> mutacao -> shas -> revert) no invocations.log", () => {
      const stateDir = createTempDir("hpr-e2e-")
      const docDir = createTempDir("hpr-doc-")
      const docPath = path.join(docDir, "gates-proofs.md")
      fs.writeFileSync(docPath, SYNTH_DOC, "utf8")
      const r = runCli(
        ["--branch", "ci-proof/hpr-e2e", "--mutate-doc-claim", "11.99", "--hook", FAKE_HOOK],
        {
          HOOK_PROOF_FAKE_STATE: stateDir,
          HOOK_PROOF_FAKE_HOOK_OUTPUT: "fake hook out",
          HOOK_PROOF_FAKE_HOOK_EXIT: "1",
          HOOK_PROOF_DOC: docPath,
          // arvore SUJA no fake: o teste de ORDEM precisa do commit do delta
          // (o guard de arvore limpa o pularia - e o que o teste clean pina)
          HOOK_PROOF_FAKE_DIRTY: "1",
        },
      )
      expect(r.status).toBe(0)
      const log = readInvocations(stateDir)
      const idxRev = log.indexOf("git:rev-parse --abbrev-ref HEAD")
      const idxDiff = log.indexOf("git:diff")
      const idxCheckout = log.indexOf("git:checkout -b ci-proof/hpr-e2e")
      const idxCommitDelta = log.indexOf("git:commit -m hook-proof: ci-proof/hpr-e2e (delta)")
      const idxCommitMut = log.indexOf("git:commit -m hook-proof: ci-proof/hpr-e2e (mutacao)")
      const idxHead = log.indexOf("git:rev-parse HEAD\n")
      const idxOld = log.indexOf("git:rev-parse HEAD~1")
      const idxBack = log.indexOf("git:checkout base")
      const idxDel = log.indexOf("git:branch -D ci-proof/hpr-e2e")
      expect(idxRev).toBeGreaterThanOrEqual(0)
      expect(idxDiff).toBeGreaterThan(idxRev)
      expect(idxCheckout).toBeGreaterThan(idxDiff)
      expect(idxCommitDelta).toBeGreaterThan(idxCheckout)
      expect(idxCommitMut).toBeGreaterThan(idxCommitDelta)
      expect(idxHead).toBeGreaterThan(idxCommitMut)
      expect(idxOld).toBeGreaterThan(idxHead)
      expect(idxBack).toBeGreaterThan(idxOld)
      expect(idxDel).toBeGreaterThan(idxBack)
    }, 60000)

    it("ciclo renumber: secao 11.42 -> 11.98, hook bloqueia (exit 1) com a CURE, revert byte-identical -> exit 0", () => {
      const stateDir = createTempDir("hpr-e2e-")
      const docDir = createTempDir("hpr-doc-")
      const docPath = path.join(docDir, "gates-proofs.md")
      fs.writeFileSync(docPath, SYNTH_DOC, "utf8")
      const r = runCli(
        ["--branch", "ci-proof/hpr-e2e", "--mutate-doc-renumber", "11.42", "--to", "11.98", "--expect-cure", "--hook", FAKE_HOOK],
        {
          HOOK_PROOF_FAKE_STATE: stateDir,
          HOOK_PROOF_FAKE_HOOK_OUTPUT: EXIT_CLAIMS_CURE,
          HOOK_PROOF_FAKE_HOOK_EXIT: "1",
          HOOK_PROOF_DOC: docPath,
          HOOK_PROOF_FAKE_DIRTY: "1",
        },
      )
      expect(r.status).toBe(0)
      expect(r.stdout).toContain("verify: hook exit 1 + CURE")
      expect(r.stdout).toContain("DONE")
      // o doc foi restaurado do byte-copy (o revert byte-identical)
      expect(fs.readFileSync(docPath, "utf8")).toBe(SYNTH_DOC)
      // a mutacao renumber foi commitada (o invocations.log mostra o commit)
      expect(readInvocations(stateDir)).toContain("git:commit -m hook-proof: ci-proof/hpr-e2e (mutacao)")
    }, 60000)

    it("TRIPWIRE E2E: --mutate citando 'sed' + '## ' -> exit 2 no parse (nenhum git/hook roda - o atalho manual da Prova 39 travado, sec 11.59)", () => {
      const stateDir = createTempDir("hpr-e2e-")
      const r = runCli(
        ["--branch", "ci-proof/hpr-e2e", "--mutate", "sed -i 's/## 11.58 /## 11.98 /' docs/gates-proofs.md", "--hook", FAKE_HOOK],
        {
          HOOK_PROOF_FAKE_STATE: stateDir,
          HOOK_PROOF_FAKE_HOOK_OUTPUT: EXIT_CLAIMS_CURE,
          HOOK_PROOF_FAKE_HOOK_EXIT: "1",
          HOOK_PROOF_FAKE_DIRTY: "1",
        },
      )
      expect(r.status).toBe(2)
      expect(r.stderr).toContain("--mutate-doc-renumber")
      // o parse morre ANTES de qualquer git: o invocations.log NEM EXISTE (o
      // fake-bins so o cria no 1o record() - o tripwire e a 1a barreira,
      // antes do backup; zero invocacoes git no ciclo)
      expect(fs.existsSync(path.join(stateDir, "invocations.log"))).toBe(false)
    }, 60000)

    it("renumber de secao INEXISTENTE -> exit 3 (fail-loud: a mutacao no-op nao pode passar como prova)", () => {
      const stateDir = createTempDir("hpr-e2e-")
      const docDir = createTempDir("hpr-doc-")
      const docPath = path.join(docDir, "gates-proofs.md")
      fs.writeFileSync(docPath, SYNTH_DOC, "utf8")
      const r = runCli(
        ["--branch", "ci-proof/hpr-e2e", "--mutate-doc-renumber", "11.77", "--to", "11.99", "--hook", FAKE_HOOK],
        {
          HOOK_PROOF_FAKE_STATE: stateDir,
          HOOK_PROOF_FAKE_HOOK_OUTPUT: EXIT_CLAIMS_CURE,
          HOOK_PROOF_FAKE_HOOK_EXIT: "1",
          HOOK_PROOF_DOC: docPath,
          HOOK_PROOF_FAKE_DIRTY: "1",
        },
      )
      expect(r.status).toBe(3)
      expect(r.stderr).toContain("nao encontrada")
    }, 60000)

    it("renumber para secao JA EXISTENTE no doc -> exit 3 fail-loud com a mensagem de colisao (o par ambiguo da sec 11.59 fechado no caminho do hook)", () => {
      const stateDir = createTempDir("hpr-e2e-")
      const docDir = createTempDir("hpr-doc-")
      const docPath = path.join(docDir, "gates-proofs.md")
      fs.writeFileSync(docPath, COLLISION_DOC, "utf8")
      // renumerar 11.42 -> 11.58 colide com o header 11.58 que JA existe no
      // doc: o renumberDocSection THROW e o main() converte em exit 3
      // fail-loud (a mesma classe de infra do sec-inexistente acima). O
      // hook NUNCA roda (a mutacao morre antes do push simulado).
      const r = runCli(
        ["--branch", "ci-proof/hpr-e2e", "--mutate-doc-renumber", "11.42", "--to", "11.58", "--hook", FAKE_HOOK],
        {
          HOOK_PROOF_FAKE_STATE: stateDir,
          HOOK_PROOF_FAKE_HOOK_OUTPUT: EXIT_CLAIMS_CURE,
          HOOK_PROOF_FAKE_HOOK_EXIT: "1",
          HOOK_PROOF_DOC: docPath,
          HOOK_PROOF_FAKE_DIRTY: "1",
        },
      )
      expect(r.status).toBe(3)
      expect(r.stderr).toContain("JA existe no doc")
      expect(r.stderr).toContain("11.58")
      // o doc NAO foi mutado: o throw acontece ANTES do writeFileSync (a
      // mutacao no-op nunca chega ao disco - o mesmo espirito da sec 8.14)
      expect(fs.readFileSync(docPath, "utf8")).toBe(COLLISION_DOC)
      // o hook nao rodou: o fake-bins so loga invocacoes GIT (o hook e um
      // spawn bash direto, invisivel ao log) - o proxy observavel e a
      // AUSENCIA do commit da mutacao: a cadeia morre na etapa 4, antes da
      // etapa 6 (sem commit -> sem push simulado)
      const log = readInvocations(stateDir)
      expect(log).not.toContain("git:commit -m hook-proof: ci-proof/hpr-e2e (mutacao)")
    }, 60000)

    it("renumber no-op explicito (--to === sec, 11.42 -> 11.42) -> exit 3 fail-loud com a mensagem no-op (o 3o fail-loud do renumberDocSection fechado no caminho do hook)", () => {
      const stateDir = createTempDir("hpr-e2e-")
      const docDir = createTempDir("hpr-doc-")
      const docPath = path.join(docDir, "gates-proofs.md")
      fs.writeFileSync(docPath, SYNTH_DOC, "utf8")
      // renumerar 11.42 -> 11.42: o renumberDocSection encontra a secao
      // (o 1o test casa) mas o toRe.test casa a PROPRIa secao -> THROW
      // (o no-op silencioso da classe ACHADO, sec 11.59). O main()
      // converte em exit 3 fail-loud - o MESMO canal da colisao acima.
      const r = runCli(
        ["--branch", "ci-proof/hpr-e2e", "--mutate-doc-renumber", "11.42", "--to", "11.42", "--hook", FAKE_HOOK],
        {
          HOOK_PROOF_FAKE_STATE: stateDir,
          HOOK_PROOF_FAKE_HOOK_OUTPUT: EXIT_CLAIMS_CURE,
          HOOK_PROOF_FAKE_HOOK_EXIT: "1",
          HOOK_PROOF_DOC: docPath,
          HOOK_PROOF_FAKE_DIRTY: "1",
        },
      )
      expect(r.status).toBe(3)
      expect(r.stderr).toContain("no-op")
      expect(r.stderr).toContain("11.42")
      // o doc NAO foi mutado: o throw acontece ANTES do writeFileSync (a
      // mutacao no-op nunca chega ao disco - o mesmo espirito da sec 8.14)
      expect(fs.readFileSync(docPath, "utf8")).toBe(SYNTH_DOC)
      // o hook nao rodou: a cadeia morre na etapa 4, antes da etapa 6
      // (sem commit da mutacao -> sem push simulado)
      const log = readInvocations(stateDir)
      expect(log).not.toContain("git:commit -m hook-proof: ci-proof/hpr-e2e (mutacao)")
    }, 60000)

    it("ACHADO Prova 41 FECHADO (sec 11.69): --mutate shell FALHA com --cleanup-on-fail -> exit 3 E o revertCycle roda (checkout base + branch -D no invocations.log - a scratch NAO fica e os untracked do byte-copy sao restaurados pelo ciclo)", () => {
      const stateDir = createTempDir("hpr-e2e-")
      const docDir = createTempDir("hpr-doc-")
      const docPath = path.join(docDir, "gates-proofs.md")
      fs.writeFileSync(docPath, SYNTH_DOC, "utf8")
      // o --mutate "exit 1" e um comando shell que FALHA (status 1): o fail
      // path de mutacao dispara - COM a flag, o revertCycle roda ANTES do
      // fail(3) e a scratch nao fica (o ACHADO da Prova 41 fechado).
      const r = runCli(
        ["--branch", "ci-proof/hpr-mutfail", "--mutate", "exit 1", "--cleanup-on-fail", "--hook", FAKE_HOOK],
        {
          HOOK_PROOF_FAKE_STATE: stateDir,
          HOOK_PROOF_FAKE_HOOK_OUTPUT: EXIT_CLAIMS_CURE,
          HOOK_PROOF_FAKE_HOOK_EXIT: "1",
          HOOK_PROOF_DOC: docPath,
          HOOK_PROOF_FAKE_DIRTY: "1",
        },
      )
      expect(r.status).toBe(3)
      expect(r.stderr).toContain("--mutate falhou")
      expect(r.stderr).toContain("cleanup-on-fail")
      // o revertCycle RODOU mesmo no fail: checkout base + branch -D (a
      // scratch nao fica - a limpeza que a Prova 41 precisava fazer a mao)
      const log = readInvocations(stateDir)
      expect(log).toContain("git:checkout base")
      expect(log).toContain("git:branch -D ci-proof/hpr-mutfail")
    }, 60000)

    it("CONTRAPARTE (sec 11.69): --mutate shell FALHA SEM --cleanup-on-fail -> exit 3 COM a scratchLeftNote e SEM revertCycle (a classe aberta - a limpeza fica manual, o padrao antigo)", () => {
      const stateDir = createTempDir("hpr-e2e-")
      const docDir = createTempDir("hpr-doc-")
      const docPath = path.join(docDir, "gates-proofs.md")
      fs.writeFileSync(docPath, SYNTH_DOC, "utf8")
      const r = runCli(
        ["--branch", "ci-proof/hpr-mutfail", "--mutate", "exit 1", "--hook", FAKE_HOOK],
        {
          HOOK_PROOF_FAKE_STATE: stateDir,
          HOOK_PROOF_FAKE_HOOK_OUTPUT: EXIT_CLAIMS_CURE,
          HOOK_PROOF_FAKE_HOOK_EXIT: "1",
          HOOK_PROOF_DOC: docPath,
          HOOK_PROOF_FAKE_DIRTY: "1",
        },
      )
      expect(r.status).toBe(3)
      expect(r.stderr).toContain("--mutate falhou")
      // SEM a flag: a nota de saida manual (a receita de limpeza) aparece
      expect(r.stderr).toContain("branch scratch pode ter ficado")
      // e o revertCycle NAO rodou (nenhum checkout base / branch -D apos o fail)
      const log = readInvocations(stateDir)
      expect(log).not.toContain("git:checkout base")
      expect(log).not.toContain("git:branch -D ci-proof/hpr-mutfail")
    }, 60000)

    it("o PAR de conversao fechado (sec 11.87): --cleanup-on-fail + HOOK_PROOF_FAKE_FAIL_APPLY=1 -> o cleanupOnFailSuffix FALHA no revert e a CURE do reflog sai no MESMO canal do revert-fail do main", () => {
      const stateDir = createTempDir("hpr-e2e-")
      const docDir = createTempDir("hpr-doc-")
      const docPath = path.join(docDir, "gates-proofs.md")
      fs.writeFileSync(docPath, SYNTH_DOC, "utf8")
      // o revert-fail do main() E o cleanupOnFailSuffix (sec 11.69) usam a
      // MESMA revertLeftNote - mas o cleanup so tinha prova sintetica. Com o
      // knob FAIL_APPLY + --cleanup-on-fail + --mutate "exit 1": o fail de
      // mutacao dispara o cleanupOnFailSuffix, o revertCycle DENTRO dele roda
      // e o apply FALHA -> o sufixo vira 'cleanup-on-fail FALHOU' com a
      // revertLeftNote(rv.stage=apply) - a 2-NIVEIS do reflog - no MESMO
      // canal do revert-fail do main (o par de conversao fechado).
      const r = runCli(
        ["--branch", "ci-proof/hpr-cofapply", "--mutate", "exit 1", "--cleanup-on-fail", "--hook", FAKE_HOOK],
        {
          HOOK_PROOF_FAKE_STATE: stateDir,
          HOOK_PROOF_FAKE_HOOK_OUTPUT: EXIT_CLAIMS_CURE,
          HOOK_PROOF_FAKE_HOOK_EXIT: "1",
          HOOK_PROOF_DOC: docPath,
          HOOK_PROOF_FAKE_DIRTY: "1",
          HOOK_PROOF_FAKE_FAIL_APPLY: "1",
        },
      )
      expect(r.status).toBe(3)
      // o fail path de mutacao disparou (a causa raiz do exit 3)
      expect(r.stderr).toContain("--mutate falhou")
      // o sufixo FALHOU (nao o 'cleanup-on-fail:' de sucesso) - o revertCycle
      // dentro do cleanup nao completou
      expect(r.stderr).toContain("cleanup-on-fail FALHOU")
      // a causa exata do revertCycle interno (o apply-fail)
      expect(r.stderr).toContain("git apply delta.patch falhou")
      // o backup apontado (a informacao acionavel do fail interno)
      expect(r.stderr).toContain("backup em")
      // a CURE stage-aware NO MESMO canal do revert-fail do main: a 2-NIVEIS
      // do reflog (pos-branch-D - a scratch foi deletada com o delta dentro)
      expect(r.stderr).toContain("reflog")
      expect(r.stderr).toContain("cherry-pick")
      expect(r.stderr).not.toContain("git checkout base && git branch -D ci-proof/hpr-cofapply")
      // a ORDEM do revert DENTRO do cleanup: checkout base -> branch -D ->
      // apply falhou (o mesmo shape do revert-fail do main da sec 11.76)
      const log = readInvocations(stateDir)
      const idxCo = log.indexOf("git:checkout base")
      const idxBd = log.indexOf("git:branch -D ci-proof/hpr-cofapply")
      const idxAp = log.indexOf("git:apply")
      expect(idxCo).toBeGreaterThanOrEqual(0)
      expect(idxBd).toBeGreaterThan(idxCo)
      expect(idxAp).toBeGreaterThan(idxBd)
    }, 60000)

    it("verify divergencia: hook exit 0 mas --expect-exit 1 -> exit 1 (revert MESMO ASSIM)", () => {
      const stateDir = createTempDir("hpr-e2e-")
      const docDir = createTempDir("hpr-doc-")
      const docPath = path.join(docDir, "gates-proofs.md")
      fs.writeFileSync(docPath, SYNTH_DOC, "utf8")
      const r = runCli(
        ["--branch", "ci-proof/hpr-e2e", "--mutate-doc-claim", "11.99", "--hook", FAKE_HOOK],
        {
          HOOK_PROOF_FAKE_STATE: stateDir,
          HOOK_PROOF_FAKE_HOOK_OUTPUT: "nao bloqueou",
          HOOK_PROOF_FAKE_HOOK_EXIT: "0",
          HOOK_PROOF_DOC: docPath,
        },
      )
      expect(r.status).toBe(1)
      expect(r.stdout).toContain("hook exit 0 != esperado 1")
      // revert MESMO ASSIM: a scratch nao fica (branch -D foi chamado)
      expect(readInvocations(stateDir)).toContain("git:branch -D ci-proof/hpr-e2e")
    }, 60000)

    it("--expect-cure sem a CURE no stdout do hook -> exit 1 com o aviso da sec 11.54", () => {
      const stateDir = createTempDir("hpr-e2e-")
      const docDir = createTempDir("hpr-doc-")
      const docPath = path.join(docDir, "gates-proofs.md")
      fs.writeFileSync(docPath, SYNTH_DOC, "utf8")
      const r = runCli(
        ["--branch", "ci-proof/hpr-e2e", "--mutate-doc-claim", "11.99", "--expect-cure", "--hook", FAKE_HOOK],
        {
          HOOK_PROOF_FAKE_STATE: stateDir,
          HOOK_PROOF_FAKE_HOOK_OUTPUT: "sem a CURE",
          HOOK_PROOF_FAKE_HOOK_EXIT: "1",
          HOOK_PROOF_DOC: docPath,
        },
      )
      expect(r.status).toBe(1)
      expect(r.stdout).toContain("NAO contem a CURE")
    }, 60000)

    it("arvore LIMPA (sem delta): o ciclo roda sem commit do delta - o fix do review (git commit vazio nao pode falhar)", () => {
      const stateDir = createTempDir("hpr-clean-")
      const docDir = createTempDir("hpr-doc-")
      const docPath = path.join(docDir, "gates-proofs.md")
      fs.writeFileSync(docPath, SYNTH_DOC, "utf8")
      // HOOK_PROOF_FAKE_DIRTY NAO setado = git status sempre limpo -> o
      // guard do delta commit (so quando a arvore tem delta) pula o commit.
      const r = runCli(
        ["--branch", "ci-proof/hpr-clean", "--mutate-doc-claim", "11.99", "--hook", FAKE_HOOK],
        {
          HOOK_PROOF_FAKE_STATE: stateDir,
          HOOK_PROOF_FAKE_HOOK_OUTPUT: "fake hook out",
          HOOK_PROOF_FAKE_HOOK_EXIT: "1",
          HOOK_PROOF_DOC: docPath,
        },
      )
      expect(r.status).toBe(0)
      const log = readInvocations(stateDir)
      expect(log).not.toContain("git:commit -m hook-proof: ci-proof/hpr-clean (delta)")
      expect(log).not.toContain("git:commit -m hook-proof: ci-proof/hpr-clean (mutacao)")
      // o revert ainda roda (branch -D + apply skipado - patch vazio)
      expect(log).toContain("git:branch -D ci-proof/hpr-clean")
    }, 60000)

    it("revert-fail APPLY hermetico (sec 11.76): HOOK_PROOF_FAKE_FAIL_APPLY=1 -> exit 3 com o backup apontado + a CURE do reflog (a classe da Prova 43 que so tinha prova viva)", () => {
      const stateDir = createTempDir("hpr-e2e-")
      const docDir = createTempDir("hpr-doc-")
      const docPath = path.join(docDir, "gates-proofs.md")
      fs.writeFileSync(docPath, SYNTH_DOC, "utf8")
      // arvore SUJA (o delta.patch do backup e nao-vazio -> o apply RODA) +
      // o knob que faz o git apply FALHAR - o seam hermetico do fail path
      // que a Prova 43 (sec 8.38) so conseguiu provar ao vivo (o fake-bins
      // nunca falhava o apply). O hook passa (exit 0) - a falha e do revert.
      const r = runCli(
        ["--branch", "ci-proof/hpr-applyfail", "--mutate-doc-claim", "11.99", "--expect-exit", "0", "--hook", FAKE_HOOK],
        {
          HOOK_PROOF_FAKE_STATE: stateDir,
          HOOK_PROOF_FAKE_HOOK_OUTPUT: "fake hook out",
          HOOK_PROOF_FAKE_HOOK_EXIT: "0",
          HOOK_PROOF_DOC: docPath,
          HOOK_PROOF_FAKE_DIRTY: "1",
          HOOK_PROOF_FAKE_FAIL_APPLY: "1",
        },
      )
      // o revert-fail e o fail(3) da cadeia: exit 3 fail-loud
      expect(r.status).toBe(3)
      // a causa exata do revertCycle (o mensage interno do apply-fail)
      expect(r.stderr).toContain("git apply delta.patch falhou")
      // o backup apontado (a informacao acionavel do fail interno)
      expect(r.stderr).toContain("backup em")
      // a CURE stage-aware (sec 11.75): o apply-fail e POS-branch-D -> o
      // reflog + cherry-pick, NAO a receita generica (git checkout <orig> &&
      // git branch -D) que descreveria um estado que nao existe mais
      expect(r.stderr).toContain("reflog")
      expect(r.stderr).toContain("cherry-pick")
      expect(r.stderr).not.toContain("git checkout base && git branch -D ci-proof/hpr-applyfail")
      // a ORDEM do revert no invocations.log: checkout base -> branch -D
      // (a scratch deletada com o delta dentro) -> apply falhou - o estado
      // que a CURE do reflog descreve
      const log = readInvocations(stateDir)
      const idxCo = log.indexOf("git:checkout base")
      const idxBd = log.indexOf("git:branch -D ci-proof/hpr-applyfail")
      const idxAp = log.indexOf("git:apply")
      expect(idxCo).toBeGreaterThanOrEqual(0)
      expect(idxBd).toBeGreaterThan(idxCo)
      expect(idxAp).toBeGreaterThan(idxBd)
    }, 60000)

    it("revert-fail CHECKOUT hermetico (sec 11.85): HOOK_PROOF_FAKE_FAIL_CHECKOUT=1 -> exit 3 com o backup apontado + a receita GENERICA (a scratch AINDA existe - o branch -D nunca rodou)", () => {
      const stateDir = createTempDir("hpr-e2e-")
      const docDir = createTempDir("hpr-doc-")
      const docPath = path.join(docDir, "gates-proofs.md")
      fs.writeFileSync(docPath, SYNTH_DOC, "utf8")
      // o knob irmao (sec 11.85): o checkout SIMPLES do revert falha - a
      // scratch AINDA existe (o branch -D nunca roda) -> a receita GENERICA
      // do scratchLeftNote, nao a CURE do reflog (o contraste com o apply).
      const r = runCli(
        ["--branch", "ci-proof/hpr-cofail", "--mutate-doc-claim", "11.99", "--expect-exit", "0", "--hook", FAKE_HOOK],
        {
          HOOK_PROOF_FAKE_STATE: stateDir,
          HOOK_PROOF_FAKE_HOOK_OUTPUT: "fake hook out",
          HOOK_PROOF_FAKE_HOOK_EXIT: "0",
          HOOK_PROOF_DOC: docPath,
          HOOK_PROOF_FAKE_DIRTY: "1",
          HOOK_PROOF_FAKE_FAIL_CHECKOUT: "1",
        },
      )
      expect(r.status).toBe(3)
      // a causa exata do revertCycle (o mensage interno do checkout-fail)
      expect(r.stderr).toContain("git checkout base falhou")
      // o backup apontado (a informacao acionavel do fail interno)
      expect(r.stderr).toContain("backup em")
      // a receita GENERICA (sec 11.75: o checkout-fail e PRE-branch-D - a
      // scratch ainda existe, o git checkout <orig> && git branch -D vale)
      expect(r.stderr).toContain("git checkout base && git branch -D ci-proof/hpr-cofail")
      // SEM o reflog: a scratch NAO foi deletada - a CURE do apply nao se aplica
      expect(r.stderr).not.toContain("reflog")
      // a ORDEM do revert no invocations.log: checkout base RODOU (e falhou) - o
      // branch -D NUNCA roda (nem o apply): o estado que a receita generica descreve
      const log = readInvocations(stateDir)
      expect(log).toContain("git:checkout base")
      expect(log).not.toContain("git:branch -D ci-proof/hpr-cofail")
      expect(log).not.toContain("git:apply")
    }, 60000)

    it("revert-fail BRANCH_D hermetico (sec 11.85): HOOK_PROOF_FAKE_FAIL_BRANCH_D=1 -> exit 3 com o backup apontado + a receita GENERICA (o apply nunca rodou)", () => {
      const stateDir = createTempDir("hpr-e2e-")
      const docDir = createTempDir("hpr-doc-")
      const docPath = path.join(docDir, "gates-proofs.md")
      fs.writeFileSync(docPath, SYNTH_DOC, "utf8")
      // o knob irmao (sec 11.85): o branch -D do revert falha - a scratch
      // AINDA existe (o branch -D nao deletou) -> a receita GENERICA, nao o
      // reflog (a scratch nao foi deletada com o delta dentro).
      const r = runCli(
        ["--branch", "ci-proof/hpr-bdfail", "--mutate-doc-claim", "11.99", "--expect-exit", "0", "--hook", FAKE_HOOK],
        {
          HOOK_PROOF_FAKE_STATE: stateDir,
          HOOK_PROOF_FAKE_HOOK_OUTPUT: "fake hook out",
          HOOK_PROOF_FAKE_HOOK_EXIT: "0",
          HOOK_PROOF_DOC: docPath,
          HOOK_PROOF_FAKE_DIRTY: "1",
          HOOK_PROOF_FAKE_FAIL_BRANCH_D: "1",
        },
      )
      expect(r.status).toBe(3)
      expect(r.stderr).toContain("git branch -D ci-proof/hpr-bdfail falhou")
      expect(r.stderr).toContain("backup em")
      // a receita GENERICA (o branch -D falhou sem deletar - a scratch existe)
      expect(r.stderr).toContain("git checkout base && git branch -D ci-proof/hpr-bdfail")
      expect(r.stderr).not.toContain("reflog")
      // a ORDEM: checkout base rodou, branch -D rodou (e falhou) - o apply NUNCA
      const log = readInvocations(stateDir)
      const idxCo = log.indexOf("git:checkout base")
      const idxBd = log.indexOf("git:branch -D ci-proof/hpr-bdfail")
      expect(idxCo).toBeGreaterThanOrEqual(0)
      expect(idxBd).toBeGreaterThan(idxCo)
      expect(log).not.toContain("git:apply")
    }, 60000)

    it("revert-fail STATUS hermetico (sec 11.85): HOOK_PROOF_FAKE_FAIL_STATUS=1 -> exit 3 com o backup apontado + a CURE do SNAPSHOT (PASSou + status-before.txt - o apply do delta JA passou)", () => {
      const stateDir = createTempDir("hpr-e2e-")
      const docDir = createTempDir("hpr-doc-")
      const docPath = path.join(docDir, "gates-proofs.md")
      fs.writeFileSync(docPath, SYNTH_DOC, "utf8")
      // o knob irmao (sec 11.85): o git status do REVERT diverge do snapshot
      // (o sinal state.reverting distingue o status do backup - que roda
      // ANTES do checkout do revert - do status do revert). O apply do delta
      // JA passou -> a CURE do SNAPSHOT (reconciliar com status-before.txt),
      // nao a receita generica (o branch -D ja rodou).
      const r = runCli(
        ["--branch", "ci-proof/hpr-stfail", "--mutate-doc-claim", "11.99", "--expect-exit", "0", "--hook", FAKE_HOOK],
        {
          HOOK_PROOF_FAKE_STATE: stateDir,
          HOOK_PROOF_FAKE_HOOK_OUTPUT: "fake hook out",
          HOOK_PROOF_FAKE_HOOK_EXIT: "0",
          HOOK_PROOF_DOC: docPath,
          HOOK_PROOF_FAKE_DIRTY: "1",
          HOOK_PROOF_FAKE_FAIL_STATUS: "1",
        },
      )
      expect(r.status).toBe(3)
      expect(r.stderr).toContain("git status divergiu do snapshot pre-ciclo")
      expect(r.stderr).toContain("backup em")
      // a CURE do SNAPSHOT (sec 11.75 status-fail): o apply PASSou + o
      // snapshot status-before.txt como reconciliavel
      expect(r.stderr).toContain("PASSou")
      expect(r.stderr).toContain("status-before.txt")
      // SEM a receita generica: o branch -D ja rodou - a scratch nao existe mais
      expect(r.stderr).not.toContain("git checkout base && git branch -D ci-proof/hpr-stfail")
      // a ORDEM completa do revert: checkout base -> branch -D -> apply (o
      // delta estava no arvore) -> status do revert divergiu
      const log = readInvocations(stateDir)
      const idxCo = log.indexOf("git:checkout base")
      const idxBd = log.indexOf("git:branch -D ci-proof/hpr-stfail")
      const idxAp = log.indexOf("git:apply")
      expect(idxCo).toBeGreaterThanOrEqual(0)
      expect(idxBd).toBeGreaterThan(idxCo)
      expect(idxAp).toBeGreaterThan(idxBd)
    }, 60000)
  })

  describe("revert-fail - o PAR vivo/hermetico do apply-fail (sec 11.86): o stderr do knob = o stderr real da Prova 43", () => {
    // A mensagem do git apply REAL (verbatim do que o git imprimiu ao vivo
    // na Prova 43, sec 8.38) - o fake-bins a copiou; o teste pina que o
    // knob reproduz a MESMA mensagem do erro real, nao uma aproximacao.
    // O registro vivo (sec 8.38) e o registro do EVENTO, nao claim de
    // comportamento atual - o que o teste pina e o nucleo estavel
    // (mensagem + backup), nao o sufixo da CURE (que a 11.75 refinou).
    const GIT_APPLY_ERR = 'error: No valid patches in input (allow with "--allow-empty")'

    it("a 3-via do texto: a mensagem do knob existe VERBATIM no registro vivo da sec 8.38 (doc) E no fixture - o knob copiou o erro do git real (REAL-REPO doc read)", () => {
      const doc = fs.readFileSync(path.join(process.cwd(), "docs", "gates-proofs.md"), "utf8")
      // o pin e ESCOPADO a sec 8.38 (o bloco entre os headers 8.38 e 8.39 -
      // o registro do EVENTO da Prova 43, nao um toContain no doc inteiro):
      // a mensagem aparece 2x no doc e um toContain generico passaria mesmo
      // se o registro vivo fosse deletado (reviewer, sec 11.86). Extrair o
      // bloco e pinar DENTRO dele fecha a 3-via no alvo real.
      const secStart = doc.indexOf("## 8.38 ")
      const secEnd = doc.indexOf("## 8.39 ")
      expect(secStart).toBeGreaterThanOrEqual(0)
      expect(secEnd).toBeGreaterThan(secStart)
      const liveSec = doc.slice(secStart, secEnd)
      expect(liveSec, "o registro vivo da Prova 43 (sec 8.38) deve citar a mensagem exata do git apply").toContain(GIT_APPLY_ERR)
      const fixture = fs.readFileSync(FAKE_BINS, "utf8")
      expect(fixture, "o fixture deve copiar a mensagem do git real verbatim - nao uma aproximacao").toContain(GIT_APPLY_ERR)
    }, 60000)

    it("E2E: o stderr hermetico com o knob contem o MESMO nucleo do stderr vivo - 'git apply delta.patch falhou: <mensagem real> - backup em <dir>' (a CURE atual e a 2-NIVEIS da 11.75)", () => {
      const stateDir = createTempDir("hpr-e2e-")
      const docDir = createTempDir("hpr-doc-")
      const docPath = path.join(docDir, "gates-proofs.md")
      fs.writeFileSync(docPath, SYNTH_DOC, "utf8")
      const r = runCli(
        ["--branch", "ci-proof/hpr-eq", "--mutate-doc-claim", "11.99", "--expect-exit", "0", "--hook", FAKE_HOOK],
        {
          HOOK_PROOF_FAKE_STATE: stateDir,
          HOOK_PROOF_FAKE_HOOK_OUTPUT: "fake hook out",
          HOOK_PROOF_FAKE_HOOK_EXIT: "0",
          HOOK_PROOF_DOC: docPath,
          HOOK_PROOF_FAKE_DIRTY: "1",
          HOOK_PROOF_FAKE_FAIL_APPLY: "1",
        },
      )
      expect(r.status).toBe(3)
      // o NUCLEO estavel vivo/hermetico: o prefixo do revertCycle + a
      // mensagem do git real verbatim + o "backup em" - a forma exata que
      // a Prova 43 (sec 8.38) observou ao vivo (sem o path do backup, que
      // varia por ambiente - o nucleo e o que a equivalencia significa).
      expect(r.stderr).toContain(`git apply delta.patch falhou: ${GIT_APPLY_ERR} - backup em `)
      // a CURE atual (pos-11.75): a 2-NIVEIS do reflog - o registro vivo da
      // Prova 43 mostra a receita generica PRE-11.75 (a classe SUPERSEDED:
      // o nucleo e o estavel; o sufixo e comportamento atual ja pinado pela
      // 11.76 e refinado pela 11.75).
      expect(r.stderr).toContain("reflog")
      expect(r.stderr).toContain("cherry-pick")
    }, 60000)
  })

  describe("REAL-REPO CONTRACT", () => {
    it("--dry-run contra o repo real -> exit 0 com o plano (nenhum comando executado)", () => {
      const r = runSubprocess({
        command: process.execPath,
        args: [SCRIPT, "--branch", "ci-proof/hpr-real", "--mutate-doc-claim", "11.99", "--dry-run"],
        timeoutMs: 60_000,
      })
      expect(r.status).toBe(0)
      expect(r.stdout).toContain("PLAN (dry-run)")
      expect(r.stdout).toContain("--mutate-doc-claim 11.99")
      // o dry-run nao toca o git: nenhum checkout/commit no log (vazio)
    }, 60000)

    it("--dry-run do renumber contra o repo real -> exit 0 com o plano da classe stale", () => {
      const r = runSubprocess({
        command: process.execPath,
        args: [SCRIPT, "--branch", "ci-proof/hpr-real", "--mutate-doc-renumber", "11.58", "--to", "11.99", "--dry-run"],
        timeoutMs: 60_000,
      })
      expect(r.status).toBe(0)
      expect(r.stdout).toContain("PLAN (dry-run)")
      expect(r.stdout).toContain("--mutate-doc-renumber 11.58 --to 11.99")
    }, 60000)

    it("branch fora do namespace ci-proof/* -> exit 2 com o aviso Type E", () => {
      const r = runSubprocess({
        command: process.execPath,
        args: [SCRIPT, "--branch", "main"],
        timeoutMs: 60_000,
      })
      expect(r.status).toBe(2)
      expect(r.stderr).toContain("fora do namespace ci-proof/*")
    }, 60000)
  })

  describe("scratchLeftNote - o guard de forma do fail silencioso (sec 11.65)", () => {
    // Deriva os fail sites do SOURCE do helper (o padrao dos TARGET_DIRS /
    // fatos consumidos): toda `return fail(` com scratchLeftNote presente no
    // codigo, com a linha. A FRONTEIRA e o CHECKOUT-FAIL (a linha `if
    // (cb.status !== 0) return fail(3...` - o reviewer nit da sec 11.65: a
    // ancora NAO pode ser a linha da CHAMADA `git(["checkout", "-b", ...])`,
    // porque o checkout-fail fica na linha SEGUINTE e seria classificado
    // como POS (off-by-one que quebrou as 3 MUTATIONs). O checkout-fail
    // INCLUSIVE (<= cfIdx) e PRE: a scratch nunca foi criada - a nota NAO
    // deve existir (ruido). Tudo DEPOIS (> cfIdx: delta commit, doc
    // ausente, renumber THROW, --mutate, mutation commit, revert-fail)
    // PODEM deixar o usuario na scratch - a nota DEVE existir (a classe do
    // fail silencioso).
    const CF_ANCHOR = 'if (cb.status !== 0) return fail(3'

    function failSites(src: string) {
      const lines = src.split("\n")
      return lines
        .map((l, i) => ({ line: i + 1, text: l }))
        .filter((s) => /return fail\(/.test(s.text))
    }

    function frontier(src: string) {
      const lines = src.split("\n")
      const cfIdx = lines.findIndex((l) => l.includes(CF_ANCHOR))
      if (cfIdx < 0) throw new Error(`fronteira do checkout-fail (${CF_ANCHOR}) nao encontrada no source - o guard de forma ficou cego`)
      // O findIndex e 0-based; o failSites usa s.line 1-based (i+1). Sem a
      // conversao, o checkout-fail (linha N) cairia em pos (N <= N-1 e
      // falso) - o off-by-one que o vitest pegou (reviewer, sec 11.65).
      const cfLine = cfIdx + 1
      const all = failSites(src)
      return { pre: all.filter((s) => s.line <= cfLine), pos: all.filter((s) => s.line > cfLine) }
    }

    // O escopo da classe: so os fail paths de INFRA (exit code 3) pos-scratch
    // precisam da nota. O verify-fail (`if (!check.ok) return fail(1,
    // check.message)`, exit code 1) roda DEPOIS do revertCycle - a scratch
    // ja foi revertida - e corretamente NAO tem a nota (o topo do .mjs
    // documenta: exit 1 = divergencia de verify, revert MESMO ASSIM).
    // Escopar a assert a `fail(3` fecha a classe sem exigir nota onde a
    // scratch nao existe mais (reviewer, sec 11.65).
    const posInfra = (pos: { line: number; text: string }[]) => pos.filter((s) => /fail\(3/.test(s.text))

    it("todo fail path de infra POS-checkout-b (exit code 3) termina com uma nota LeftNote (scratchLeftNote ou revertLeftNote - o usuario nunca fica na scratch sem a receita de saida)", () => {
      const src = fs.readFileSync(path.join(process.cwd(), "scripts", "hook-proof-run.mjs"), "utf8")
      const pos = posInfra(frontier(src).pos)
      expect(pos.length).toBeGreaterThanOrEqual(6)
      for (const s of pos) {
        expect(s.text, `linha ${s.line} (pos-checkout-b, infra) deve terminar com uma nota LeftNote (scratchLeftNote | revertLeftNote)`).toContain("LeftNote")
      }
    }, 60000)

    it("nenhum fail path PRE-checkout-b tem nota LeftNote (a scratch nunca existiu - a nota seria ruido; o checkout-fail INCLUSIVE)", () => {
      const src = fs.readFileSync(path.join(process.cwd(), "scripts", "hook-proof-run.mjs"), "utf8")
      const { pre } = frontier(src)
      expect(pre.length).toBeGreaterThanOrEqual(5)
      for (const s of pre) {
        expect(s.text, `linha ${s.line} (pre-checkout-b) nao deve ter nota LeftNote`).not.toContain("LeftNote")
      }
    }, 60000)

    it("MUTATION: remover a nota LeftNote do revert-fail -> o guard de forma flagra a linha (a classe do fail silencioso nao volta)", () => {
      const src = fs.readFileSync(path.join(process.cwd(), "scripts", "hook-proof-run.mjs"), "utf8")
      // o revert-fail (o fix da sec 11.65 + a CURE stage-aware da 11.75):
      // remove a interpolacao da nota.
      const mutated = src.replace("${reverted.message}${revertLeftNote(reverted.stage, originalBranch, opts.branch, backupDir, safetyDiff)}", "${reverted.message}")
      expect(mutated).not.toBe(src)
      const pos = posInfra(frontier(mutated).pos)
      const offenders = pos.filter((s) => !s.text.includes("LeftNote"))
      // 1 offender: o revert-fail mutado (o verify-fail exit 1 fica FORA do
      // escopo posInfra - a scratch ja foi revertida quando ele roda).
      expect(offenders.length).toBe(1)
      expect(offenders[0].text).toContain("reverted.message")
    }, 60000)

    it("MUTATION: adicionar a nota num fail PRE-checkout-b -> o guard de forma flagra (a nota so e legitima pos-scratch)", () => {
      const src = fs.readFileSync(path.join(process.cwd(), "scripts", "hook-proof-run.mjs"), "utf8")
      // o checkout-fail: anexa a nota a um fail pre-scratch (a linha que a
      // propria fronteira usa como ancora - a mutacao nao move a ancora).
      const mutated = src.replace("`git checkout -b ${opts.branch} falhou: ${cb.stderr.trim()} - backup em ${backupDir}`", "`git checkout -b ${opts.branch} falhou: ${cb.stderr.trim()}${scratchLeftNote(originalBranch, opts.branch, backupDir)}`")
      expect(mutated).not.toBe(src)
      const { pre } = frontier(mutated)
      const offenders = pre.filter((s) => s.text.includes("LeftNote"))
      expect(offenders.length).toBe(1)
      expect(offenders[0].text).toContain("checkout -b ${opts.branch} falhou")
    }, 60000)
  })

  describe("revertCycle - o envelope da scratchLeftNote cobre os 4 fail paths internos (sec 11.71)", () => {
    // O pedido: o fix da 11.65 anexou a nota no revert-fail EXTERNO, mas o
    // revertCycle tem 4 fail paths internos (checkout, branch -D, apply,
    // status divergente) que citam so o backup - cada um deveria citar a
    // receita completa ou o envelope basta? O VEREDITO (sec 11.71): o
    // envelope basta e e a FONTE UNICA da receita - os internos reportam a
    // causa especifica + o backup (a informacao acionavel, o ACHADO da
    // Prova 43: a receita do template pode nem casar o estado real pos
    // branch -D, o que salva e o backup apontado) e o scratchLeftNote vive
    // so nos 2 pontos de CONVERSAO do { ok: false } (o revert-fail em 522 e
    // o cleanupOnFailSuffix em 363). Duplicar a receita nos internos criaria
    // 4 copias + citacao dupla nos envelopes - pior. O RESIDUAL honesto: o
    // acoplamento envelope e convencao, nao contrato - um 3o call site do
    // revertCycle poderia engolir o { ok: false } sem a nota (a classe do
    // fail silencioso). O guard deriva os call sites (o padrao TARGET_DIRS /
    // fatos consumidos) e pina o envelope em TODO chamador.
    const DEF_RE = /export function revertCycle/

    function callSites(src: string) {
      const lines = src.split("\n")
      return lines
        .map((l, i) => ({ line: i + 1, text: l }))
        .filter((s) => s.text.includes("revertCycle(") && !DEF_RE.test(s.text))
    }

    // O envelope do call site: a linha da chamada + as 9 seguintes (o
    // revert-fail em 522 trata o { ok: false } 7 linhas abaixo, em 529; o
    // cleanupOnFailSuffix em 363 anexa a nota 2 linhas abaixo, em 365).
    const envelope = (site: { line: number }, lines: string[]) => lines.slice(site.line - 1, site.line + 9).join("\n")

    it("os 4 fail paths internos citam o backup mas NAO a receita (a receita e do envelope - fonte unica, nunca duplicada nos internos)", () => {
      const src = fs.readFileSync(path.join(process.cwd(), "scripts", "hook-proof-run.mjs"), "utf8")
      const internals = src
        .split("\n")
        .map((l, i) => ({ line: i + 1, text: l }))
        .filter((s) => /return \{ ok: false, stage: "(checkout|branchD|apply|status)", message: `git (checkout|branch|apply|status)/.test(s.text))
      expect(internals.length).toBeGreaterThanOrEqual(4)
      for (const s of internals) {
        expect(s.text, `linha ${s.line} (fail interno do revertCycle) deve citar o backup`).toContain("backup em")
        expect(s.text, `linha ${s.line} (fail interno do revertCycle) NAO deve citar a receita - ela e do envelope`).not.toContain("LeftNote")
      }
    }, 60000)

    it("TODO call site do revertCycle tem o envelope com uma nota LeftNote (nenhum chamador pode engolir o { ok: false } sem a receita - os 2 pontos de conversao)", () => {
      const src = fs.readFileSync(path.join(process.cwd(), "scripts", "hook-proof-run.mjs"), "utf8")
      const sites = callSites(src)
      // 2 call sites: o cleanupOnFailSuffix (363) e o revert normal (522)
      expect(sites.length).toBe(2)
      for (const s of sites) {
        expect(envelope(s, src.split("\n")), `linha ${s.line} (call site do revertCycle) deve ter o envelope com uma nota LeftNote`).toContain("LeftNote")
      }
    }, 60000)

    it("MUTATION: remover a nota do envelope do cleanupOnFailSuffix -> o guard flagra (o call site de 363 engoliria o fail sem receita)", () => {
      const src = fs.readFileSync(path.join(process.cwd(), "scripts", "hook-proof-run.mjs"), "utf8")
      const mutated = src.replace("return ` | cleanup-on-fail FALHOU: ${rv.message}${revertLeftNote(rv.stage, originalBranch, branch, backupDir, safetyDiff)}`", "return ` | cleanup-on-fail FALHOU: ${rv.message}`")
      expect(mutated).not.toBe(src)
      const lines = mutated.split("\n")
      const offenders = callSites(mutated).filter((s) => !envelope(s, lines).includes("LeftNote"))
      expect(offenders.length).toBe(1)
      expect(offenders[0].text).toContain("revertCycle(")
      // o offender e o call site do cleanupOnFailSuffix (ANTES da definicao
      // do revertCycle no arquivo - o 376 era a linha da def no layout
      // original; derivar a def do source evita o offset das linhas novas)
      const defLine = lines.findIndex((l) => DEF_RE.test(l)) + 1
      expect(offenders[0].line).toBeLessThan(defLine)
    }, 60000)
  })

  describe("revertLeftNote - a CURE stage-aware do revert-fail (sec 11.75)", () => {
    // O ACHADO da Prova 43 (sec 8.38): o revertCycle roda o branch -D ANTES
    // do apply - quando o apply (ou o status) falha, a scratch JA foi
    // deletada com o commit do delta dentro (orfao no reflog) e a receita
    // generica do scratchLeftNote ("git checkout <orig> && git branch -D
    // <branch>") descreve um estado que NAO existe mais (o checkout ja
    // voltou e o branch -D falharia "no such branch"). A CURE da sec 11.75
    // despacha pelo stage: apply/status -> o reflog + cherry-pick (a
    // recuperacao real); checkout/branchD -> a receita generica (a scratch
    // AINDA existe - o branch -D nao rodou).
    it("apply-fail -> a CURE em 2 NIVEIS: PRIMEIRO o git apply do patch do backup (a receita do dia a dia, a fonte primaria quando integro) e SO como fallback o reflog (quando o patch e invalido - a classe da Prova 43)", () => {
      const n = revertLeftNote("apply", "base", "ci-proof/lpr-x", "/tmp/bk")
      expect(n).toContain("branch -D JA rodou")
      expect(n).toContain("2 NIVEIS")
      // nivel 1: o patch do backup (a fonte PRIMARIA do delta quando integro)
      expect(n).toContain("git apply /tmp/bk/delta.patch")
      // a ORDEM e pinada: o nivel 1 (patch do backup) vem ANTES do comando
      // do nivel 2 (o 'git reflog' com aspas - o 'reflog' nu do intro
      // 'orfao no reflog' aparece antes e quebraria o pin por prefixo)
      expect(n.indexOf("git apply /tmp/bk/delta.patch")).toBeLessThan(n.indexOf("'git reflog'"))
      // nivel 2: o reflog + cherry-pick (SO quando o patch for invalido)
      expect(n).toContain("reflog")
      expect(n).toContain("cherry-pick")
      expect(n).toContain("hook-proof: ci-proof/lpr-x (delta)")
      // a receita generica (checkout + branch -D) NAO pode aparecer - o
      // checkout ja voltou e o branch -D falharia ("no such branch")
      expect(n).not.toContain("git checkout base && git branch -D ci-proof/lpr-x")
    }, 60000)

    it("status-fail -> a CURE do SNAPSHOT (o apply do delta JA PASSou - o delta esta na arvore; a divergencia e do git status vs o status-before.txt, NAO do patch - a hierarquia apply-first nao se aplica)", () => {
      const n = revertLeftNote("status", "base", "ci-proof/lpr-x", "/tmp/bk")
      expect(n).toContain("PASSou")
      expect(n).toContain("status-before.txt")
      // o reflog continua como FALLBACK (se o delta faltar na arvore)
      expect(n).toContain("reflog")
      expect(n).toContain("cherry-pick")
      expect(n).not.toContain("git checkout base && git branch -D ci-proof/lpr-x")
    }, 60000)

    it("checkout-fail -> a receita generica (a scratch AINDA existe - o branch -D NAO rodou)", () => {
      const n = revertLeftNote("checkout", "base", "ci-proof/lpr-x", "/tmp/bk")
      expect(n).toContain("git checkout base && git branch -D ci-proof/lpr-x")
      // a CURE do reflog NAO se aplica - o branch -D nao rodou, nao ha
      // commit orfao (o delta ainda esta na scratch viva)
      expect(n).not.toContain("cherry-pick")
    }, 60000)

    it("branchD-fail -> a receita generica (a scratch AINDA existe - o branch -D falhou sem deletar)", () => {
      const n = revertLeftNote("branchD", "base", "ci-proof/lpr-x", "/tmp/bk")
      expect(n).toContain("git checkout base && git branch -D ci-proof/lpr-x")
      expect(n).not.toContain("cherry-pick")
    }, 60000)

    it("MUTATION: o despacho do revertLeftNote deriva do source (apply E status em branches SEPARADOS - o refinamento da hierarquia dividiu o par pos-branch-D) - apagar o branch do status flagra", () => {
      // o pin estrutural no padrao dos fatos consumidos: a divisao
      // apply/status (2 branches - a CURE em 2 niveis do apply e a CURE do
      // snapshot do status) vive no source - apagar o branch do status o
      // deixaria cair na CURE do apply (a hierarquia apply-first nao se
      // aplica ao status: re-aplicar um patch ja aplicado falharia - a
      // classe da Prova 43 volta no stage que a prova NAO cobriu ao vivo,
      // so por sintese). A matriz de stages acima e o pin COMPORTAMENTAL
      // (revertLeftNote("status", ...) contem 'status-before.txt'); este e
      // o pin ESTRUTURAL da divisao.
      const src = fs.readFileSync(path.join(process.cwd(), "scripts", "hook-proof-run.mjs"), "utf8")
      const STATUS_BRANCH = 'if (stage === "status") {'
      expect(src).toContain(STATUS_BRANCH)
      // fundir o status no apply: o branch do status some do source mutado
      // (o status passaria a receber a CURE do patch - o erro da hierarquia)
      const mutated = src.replace(STATUS_BRANCH, 'if (stage === "apply") {')
      expect(mutated).not.toBe(src)
      expect(mutated).not.toContain(STATUS_BRANCH)
    }, 60000)
  })

  describe("revertLeftNote - o guard de forma do FATO CONSUMIDO: todo uso recebe o stage do retorno do revertCycle (sec 11.84)", () => {
    // O pedido: a 11.71 deriva os call sites do revertCycle e pina o
    // envelope LeftNote, mas nada pina que TODO uso do revertLeftNote
    // recebe o stage do RETORNO do revertCycle (rv.stage / reverted.stage -
    // o fato consumido) e nao um literal hardcoded (ex.:
    // revertLeftNote("apply", ...) que travaria o dispatch stage-aware - a
    // classe da Prova 46 reabrindo no stage errado). Este guard deriva os
    // usos da funcao do SOURCE (o padrao dos TARGET_DIRS / fatos
    // consumidos) e pina que o 1o argumento e SEMPRE uma propriedade
    // .stage do retorno - nunca um literal.
    const DEF_RE = /export function revertLeftNote/

    function useSites(src: string) {
      const lines = src.split("\n")
      return lines
        .map((l, i) => ({ line: i + 1, text: l }))
        .filter((s) => s.text.includes("revertLeftNote(") && !DEF_RE.test(s.text))
    }

    // O primeiro argumento da chamada: o stage do retorno do revertCycle
    // (rv.stage / reverted.stage) - nunca um literal de string ("apply",
    // "status"...) que travaria o dispatch stage-aware da sec 11.75.
    const stageFromReturn = (s: { text: string }) => /revertLeftNote\((rv|reverted)\.stage,/.test(s.text)

    it("os 2 usos do revertLeftNote passam o stage do RETORNO do revertCycle (.stage - o fato consumido), nunca um literal hardcoded", () => {
      const src = fs.readFileSync(path.join(process.cwd(), "scripts", "hook-proof-run.mjs"), "utf8")
      const sites = useSites(src)
      // 2 usos: o cleanupOnFailSuffix (rv.stage) + o revert-fail do main (reverted.stage)
      expect(sites.length).toBe(2)
      for (const s of sites) {
        expect(stageFromReturn(s), `linha ${s.line} (uso do revertLeftNote) deve passar o stage via .stage do retorno do revertCycle - nao um literal que travaria o dispatch`).toBe(true)
      }
    }, 60000)

    it("MUTATION: hardcodar o stage do cleanupOnFailSuffix (rv.stage -> \"apply\") -> o guard flagra (o dispatch stage-aware nao pode travar)", () => {
      const src = fs.readFileSync(path.join(process.cwd(), "scripts", "hook-proof-run.mjs"), "utf8")
      const mutated = src.replace("revertLeftNote(rv.stage,", 'revertLeftNote("apply",')
      expect(mutated).not.toBe(src)
      const offenders = useSites(mutated).filter((s) => !stageFromReturn(s))
      // 1 offender: o cleanupOnFailSuffix mutado (o revert-fail do main continua rv.stage-correto)
      expect(offenders.length).toBe(1)
      expect(offenders[0].text).toContain('revertLeftNote("apply",')
    }, 60000)

    it("MUTATION: hardcodar o stage do revert-fail do main (reverted.stage -> \"status\") -> o guard flagra (o par pos-branch-D nao pode travar)", () => {
      const src = fs.readFileSync(path.join(process.cwd(), "scripts", "hook-proof-run.mjs"), "utf8")
      const mutated = src.replace("revertLeftNote(reverted.stage,", 'revertLeftNote("status",')
      expect(mutated).not.toBe(src)
      const offenders = useSites(mutated).filter((s) => !stageFromReturn(s))
      expect(offenders.length).toBe(1)
      expect(offenders[0].text).toContain('revertLeftNote("status",')
    }, 60000)
  })

  describe("--safety-diff - o delta salvo FORA do backup (sec 11.77)", () => {
    // O ACHADO da Prova 43 (sec 8.38): a mutacao corrompeu o delta.patch do
    // backup e a recuperacao do delta so foi possivel via safety diff
    // EXTERNO (git apply /tmp/prova43-safety.diff). A sec 11.77 adota o
    // --safety-diff <path>: o helper grava o MESMO diff (git diff) num path
    // externo ao backup ANTES de qualquer mutacao - a copia que sobrevive a
    // corrupcao - e a CURE do revert-fail a cita (git apply <path>).
    it("parseArgs: --safety-diff <path> parseia", () => {
      const o = parseArgs(["--branch", "ci-proof/lpr-x", "--safety-diff", "/tmp/sd.patch"])
      expect(o.error).toBeNull()
      expect(o.safetyDiff).toBe("/tmp/sd.patch")
      // default: null (sem a flag, a CURE permanece generica)
      expect(parseArgs(["--branch", "ci-proof/lpr-x"]).safetyDiff).toBeNull()
    }, 60000)

    it("revertLeftNote com safetyDiff: o apply-fail cita o git apply <path> (a copia externa sobrevive ao backup corrompido)", () => {
      const n = revertLeftNote("apply", "base", "ci-proof/lpr-x", "/tmp/bk", "/tmp/sd.patch")
      expect(n).toContain("git apply /tmp/sd.patch")
      // a forma generica ("safety diff externo") NAO aparece - a CURE e
      // especifica quando o path foi salvo
      expect(n).not.toContain("safety diff externo")
    }, 60000)

    it("revertLeftNote com safetyDiff: o status-fail tambem cita o path (o par pos-branch-D compartilha a CURE)", () => {
      const n = revertLeftNote("status", "base", "ci-proof/lpr-x", "/tmp/bk", "/tmp/sd.patch")
      expect(n).toContain("git apply /tmp/sd.patch")
    }, 60000)

    it("revertLeftNote SEM safetyDiff: a CURE cita o patch do BACKUP no nivel 1 (sempre - a fonte primaria) mas NAO o path externo do safety diff (so quando a flag foi usada - o opcional honesto)", () => {
      const n = revertLeftNote("apply", "base", "ci-proof/lpr-x", "/tmp/bk")
      expect(n).toContain("safety diff externo")
      // o nivel 1 cita o patch do backup (a fonte primaria, sempre presente)
      expect(n).toContain("git apply /tmp/bk/delta.patch")
      // o path EXTERNO do safety diff NAO aparece sem a flag
      expect(n).not.toContain("git apply /tmp/sd.patch")
    }, 60000)

    it("revertLeftNote com safetyDiff no stage checkout: a receita generica (o safety diff so entra na CURE pos-branch-D)", () => {
      const n = revertLeftNote("checkout", "base", "ci-proof/lpr-x", "/tmp/bk", "/tmp/sd.patch")
      expect(n).toContain("git checkout base && git branch -D ci-proof/lpr-x")
      expect(n).not.toContain("git apply /tmp/sd.patch")
    }, 60000)

    it("planSteps: o --safety-diff aparece no plano do dry-run (o diff externo e uma etapa do ciclo - a linha opcional da sec 11.77)", () => {
      const steps = planSteps({ branch: "ci-proof/lpr-x", mutateDocClaim: null, mutate: null, expectExit: 1, expectCure: false, expectLog: null, baseSha: null, hook: null, keep: false, safetyDiff: "/tmp/sd.patch" }, "base")
      expect(steps.join("\n")).toContain("safety-diff: git diff > /tmp/sd.patch")
      expect(steps.join("\n")).toContain("sec 11.77")
      // SEM a flag, a linha nao aparece (o opcional honesto)
      const plain = planSteps({ branch: "ci-proof/lpr-x", mutateDocClaim: null, mutate: null, expectExit: 1, expectCure: false, expectLog: null, baseSha: null, hook: null, keep: false }, "base")
      expect(plain.join("\n")).not.toContain("safety-diff:")
    }, 60000)

    it("E2E: ciclo com --safety-diff + FAIL_APPLY=1 -> exit 3, o arquivo externo salvo com o diff e a CURE cita o path absoluto", () => {
      const stateDir = createTempDir("hpr-e2e-")
      const docDir = createTempDir("hpr-doc-")
      const sdDir = createTempDir("hpr-sd-")
      const docPath = path.join(docDir, "gates-proofs.md")
      const sdPath = path.join(sdDir, "safety.diff")
      fs.writeFileSync(docPath, SYNTH_DOC, "utf8")
      const r = runCli(
        ["--branch", "ci-proof/hpr-sd", "--mutate-doc-claim", "11.99", "--expect-exit", "0", "--safety-diff", sdPath, "--hook", FAKE_HOOK],
        {
          HOOK_PROOF_FAKE_STATE: stateDir,
          HOOK_PROOF_FAKE_HOOK_OUTPUT: "fake hook out",
          HOOK_PROOF_FAKE_HOOK_EXIT: "0",
          HOOK_PROOF_DOC: docPath,
          HOOK_PROOF_FAKE_DIRTY: "1",
          HOOK_PROOF_FAKE_FAIL_APPLY: "1",
          HOOK_PROOF_FAKE_PATCH: "the safety diff content\n",
        },
      )
      expect(r.status).toBe(3)
      expect(r.stderr).toContain("git apply delta.patch falhou")
      // o arquivo externo foi salvo ANTES do ciclo (o seam da sec 11.77)
      expect(fs.existsSync(sdPath)).toBe(true)
      expect(fs.readFileSync(sdPath, "utf8")).toBe("the safety diff content\n")
      // a CURE cita o caminho ABSOLUTO (o helper resolve o path UMA vez e
      // a gravacao E a CURE citam o MESMO - o fix do reviewer: com path
      // relativo, a CURE nao citaria um caminho usavel se o cwd mudar)
      const resolved = path.resolve(sdPath)
      expect(r.stderr).toContain(`git apply ${resolved}`)
    }, 60000)

    it("fail-loud: --safety-diff num path nao-gravavel (dir pai inexistente) -> exit 3 com a mensagem (nao um ENOENT cru fora do contrato)", () => {
      const stateDir = createTempDir("hpr-e2e-")
      const docDir = createTempDir("hpr-doc-")
      const docPath = path.join(docDir, "gates-proofs.md")
      fs.writeFileSync(docPath, SYNTH_DOC, "utf8")
      // um path cujo dir pai NAO existe - o writeFileSync lancaria ENOENT;
      // o try/catch da sec 11.77 converte em fail(3) no contrato do helper
      const badPath = path.join(createTempDir("hpr-bad-"), "nao-existe", "sd.patch")
      const r = runCli(
        ["--branch", "ci-proof/hpr-sd", "--mutate-doc-claim", "11.99", "--expect-exit", "0", "--safety-diff", badPath, "--hook", FAKE_HOOK],
        {
          HOOK_PROOF_FAKE_STATE: stateDir,
          HOOK_PROOF_FAKE_HOOK_OUTPUT: "fake hook out",
          HOOK_PROOF_FAKE_HOOK_EXIT: "0",
          HOOK_PROOF_DOC: docPath,
          HOOK_PROOF_FAKE_DIRTY: "1",
          HOOK_PROOF_FAKE_FAIL_APPLY: "1",
          HOOK_PROOF_FAKE_PATCH: "the safety diff content\n",
        },
      )
      // o fail da GRAVACAO do safety diff vem antes do apply-fail (a
      // gravacao e na etapa 2, o revert na etapa 8) - o exit 3 e a
      // mensagem do try/catch, nao o ENOENT cru
      expect(r.status).toBe(3)
      expect(r.stderr).toContain("safety diff nao gravavel")
    }, 60000)

    it("AUTO-CURA (sec 11.88): --apply-safety-diff-on-fail + FAIL_APPLY_DELTA_ONLY=1 -> o patch do backup FALHA e o safety diff e aplicado AUTOMATICAMENTE -> exit 0 com o revert completo (a Prova 43 vira comportamento do ciclo, nao receita manual)", () => {
      const stateDir = createTempDir("hpr-e2e-")
      const docDir = createTempDir("hpr-doc-")
      const sdDir = createTempDir("hpr-sd-")
      const docPath = path.join(docDir, "gates-proofs.md")
      const sdPath = path.join(sdDir, "safety.diff")
      fs.writeFileSync(docPath, SYNTH_DOC, "utf8")
      // arvore SUJA (o delta.patch do backup e nao-vazio -> o apply RODA) +
      // o knob FAIL_APPLY_DELTA_ONLY: so o apply do delta.patch do backup
      // falha - o apply do safety diff (o fallback da sec 11.88) SUCCEDE. A
      // flag faz o revertCycle tentar o safety diff ANTES do fail: o revert
      // completa e o ciclo sai exit 0 (a classe da Prova 43, sec 8.38, era
      // 100% manual - o usuario aplicava o safety diff a mao via a CURE).
      const r = runCli(
        ["--branch", "ci-proof/hpr-autocura", "--mutate-doc-claim", "11.99", "--expect-exit", "0", "--safety-diff", sdPath, "--apply-safety-diff-on-fail", "--hook", FAKE_HOOK],
        {
          HOOK_PROOF_FAKE_STATE: stateDir,
          HOOK_PROOF_FAKE_HOOK_OUTPUT: "fake hook out",
          HOOK_PROOF_FAKE_HOOK_EXIT: "0",
          HOOK_PROOF_DOC: docPath,
          HOOK_PROOF_FAKE_DIRTY: "1",
          HOOK_PROOF_FAKE_FAIL_APPLY_DELTA_ONLY: "1",
          HOOK_PROOF_FAKE_PATCH: "the safety diff content\n",
        },
      )
      // a AUTO-CURA: exit 0 (nao o exit 3 do apply-fail sem fallback)
      expect(r.status).toBe(0)
      expect(r.stdout).toContain("DONE")
      // o safety diff foi salvo ANTES do ciclo (o seam da sec 11.77)
      expect(fs.existsSync(sdPath)).toBe(true)
      expect(fs.readFileSync(sdPath, "utf8")).toBe("the safety diff content\n")
      // o doc foi restaurado do byte-copy (o revert byte-identical mesmo
      // com a auto-cura - o fallback NAO interrompe a restauracao)
      expect(fs.readFileSync(docPath, "utf8")).toBe(SYNTH_DOC)
      // a ORDEM do revert no invocations.log: checkout base -> branch -D ->
      // apply do delta.patch (FALHOU) -> apply do safety diff (SUCCEDEU) -
      // o fallback automatico rodou de verdade, nao so a CURE citando
      const log = readInvocations(stateDir)
      const idxCo = log.indexOf("git:checkout base")
      const idxBd = log.indexOf("git:branch -D ci-proof/hpr-autocura")
      const idxApBk = log.indexOf("git:apply")
      const idxApSd = log.indexOf("git:apply", idxApBk + 1)
      expect(idxCo).toBeGreaterThanOrEqual(0)
      expect(idxBd).toBeGreaterThan(idxCo)
      expect(idxApBk).toBeGreaterThan(idxBd)
      expect(idxApSd).toBeGreaterThan(idxApBk)
      // o 2o apply e o do safety diff (o path EXTERNO - nao o delta.patch)
      const applyLines = log.split("\n").filter((l) => l.startsWith("git:apply"))
      expect(applyLines.length).toBe(2)
      expect(applyLines[0]).toContain("delta.patch")
      expect(applyLines[1]).toContain(path.resolve(sdPath))
    }, 60000)

    it("CONTRAPARTE (sec 11.88): --apply-safety-diff-on-fail + FAIL_APPLY=1 (o safety diff TAMBEM falha) -> exit 3 com a mensagem dos DOIS applys falhados (a auto-cura nao mascara a perda real de patch)", () => {
      const stateDir = createTempDir("hpr-e2e-")
      const docDir = createTempDir("hpr-doc-")
      const sdDir = createTempDir("hpr-sd-")
      const docPath = path.join(docDir, "gates-proofs.md")
      const sdPath = path.join(sdDir, "safety.diff")
      fs.writeFileSync(docPath, SYNTH_DOC, "utf8")
      // FAIL_APPLY (nao o DELTA_ONLY): TODO apply falha - o delta.patch do
      // backup E o safety diff. A flag nao pode mascarar a perda: quando os
      // DOIS falham, o fail-loud da sec 11.88 cita as DUAS falhas + backup.
      const r = runCli(
        ["--branch", "ci-proof/hpr-autocura2", "--mutate-doc-claim", "11.99", "--expect-exit", "0", "--safety-diff", sdPath, "--apply-safety-diff-on-fail", "--hook", FAKE_HOOK],
        {
          HOOK_PROOF_FAKE_STATE: stateDir,
          HOOK_PROOF_FAKE_HOOK_OUTPUT: "fake hook out",
          HOOK_PROOF_FAKE_HOOK_EXIT: "0",
          HOOK_PROOF_DOC: docPath,
          HOOK_PROOF_FAKE_DIRTY: "1",
          HOOK_PROOF_FAKE_FAIL_APPLY: "1",
          HOOK_PROOF_FAKE_PATCH: "the safety diff content\n",
        },
      )
      expect(r.status).toBe(3)
      // a mensagem do apply-fail agora cita as DUAS falhas (delta.patch E
      // safety diff) + o backup - a auto-cura falhou de verdade
      expect(r.stderr).toContain("git apply delta.patch falhou")
      expect(r.stderr).toContain("E o safety diff")
      expect(r.stderr).toContain(path.resolve(sdPath))
      expect(r.stderr).toContain("tambem falhou")
      expect(r.stderr).toContain("backup em")
      // a CURE stage-aware da sec 11.75 continua (o reflog/cherry-pick -
      // o usuario ainda tem a receita quando a auto-cura nao resolve)
      expect(r.stderr).toContain("reflog")
      expect(r.stderr).toContain("cherry-pick")
    }, 60000)

    it("ESPEIHO do backup inteiro (sec 11.89): --safety-backup <dir> -> o delta.patch + status-before + doc-before do backup espelhados num path EXTERNO ao tmpdir (o safety do ciclo completo, nao so do diff)", () => {
      const stateDir = createTempDir("hpr-e2e-")
      const docDir = createTempDir("hpr-doc-")
      const sbDir = createTempDir("hpr-sb-")
      const docPath = path.join(docDir, "gates-proofs.md")
      fs.writeFileSync(docPath, SYNTH_DOC, "utf8")
      // o --safety-backup aponta para um dir EXTERNO ao backupDir do ciclo:
      // o helper espelha o backup inteiro (delta.patch + status-before +
      // doc-before) antes de QUALQUER mutacao. O fixture grava o diff via
      // HOOK_PROOF_FAKE_PATCH e o status via HOOK_PROOF_FAKE_DIRTY.
      const r = runCli(
        ["--branch", "ci-proof/hpr-sb", "--mutate-doc-claim", "11.99", "--expect-exit", "0", "--safety-backup", sbDir, "--hook", FAKE_HOOK],
        {
          HOOK_PROOF_FAKE_STATE: stateDir,
          HOOK_PROOF_FAKE_HOOK_OUTPUT: "fake hook out",
          HOOK_PROOF_FAKE_HOOK_EXIT: "0",
          HOOK_PROOF_DOC: docPath,
          HOOK_PROOF_FAKE_DIRTY: "1",
          HOOK_PROOF_FAKE_PATCH: "the backup mirror content\n",
        },
      )
      expect(r.status).toBe(0)
      expect(r.stdout).toContain("DONE")
      // o espelho contem os 3 artefatos do backup (byte-identical ao que o
      // backupDir gravou - o fixture NAO conhece o path do backupDir, o
      // conteudo e a fonte do espelho)
      expect(fs.readFileSync(path.join(sbDir, "delta.patch"), "utf8")).toBe("the backup mirror content\n")
      expect(fs.readFileSync(path.join(sbDir, "status-before.txt"), "utf8")).toBe(" M mutated.ts\n")
      expect(fs.readFileSync(path.join(sbDir, "doc-before.md"), "utf8")).toBe(SYNTH_DOC)
      // o doc foi restaurado do byte-copy (o ciclo normal completa - o
      // espelho NAO interfere no revert)
      expect(fs.readFileSync(docPath, "utf8")).toBe(SYNTH_DOC)
    }, 60000)

    it("fail-loud: --safety-backup num dir nao-gravavel (dir pai inexistente) -> exit 3 com a mensagem (nao um ENOENT cru fora do contrato - o MESMO padrao do safety-diff, sec 11.77)", () => {
      const stateDir = createTempDir("hpr-e2e-")
      const docDir = createTempDir("hpr-doc-")
      const docPath = path.join(docDir, "gates-proofs.md")
      fs.writeFileSync(docPath, SYNTH_DOC, "utf8")
      // um dir cujo pai NAO existe - o mkdirSync/walk lancaria ENOENT; o
      // try/catch da sec 11.89 converte em fail(3) no contrato do helper
      const badDir = path.join(createTempDir("hpr-bad-"), "nao-existe", "sb")
      const r = runCli(
        ["--branch", "ci-proof/hpr-sb", "--mutate-doc-claim", "11.99", "--expect-exit", "0", "--safety-backup", badDir, "--hook", FAKE_HOOK],
        {
          HOOK_PROOF_FAKE_STATE: stateDir,
          HOOK_PROOF_FAKE_HOOK_OUTPUT: "fake hook out",
          HOOK_PROOF_FAKE_HOOK_EXIT: "0",
          HOOK_PROOF_DOC: docPath,
          HOOK_PROOF_FAKE_DIRTY: "1",
          HOOK_PROOF_FAKE_PATCH: "x\n",
        },
      )
      expect(r.status).toBe(3)
      expect(r.stderr).toContain("safety backup nao gravavel")
    }, 60000)
  })
})
