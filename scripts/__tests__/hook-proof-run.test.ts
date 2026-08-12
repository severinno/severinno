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
import { injectDocClaim, isManualDocRenameCmd, parseArgs, planSteps, renumberDocSection, verifyLocalHook } from "../hook-proof-run.mjs"
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

  describe("scratchLeftNote — o guard de forma do fail silencioso (sec 11.65)", () => {
    // Deriva os fail sites do SOURCE do helper (o padrao dos TARGET_DIRS /
    // fatos consumidos): toda `return fail(` com scratchLeftNote presente no
    // codigo, com a linha. A FRONTEIRA e o CHECKOUT-FAIL (a linha `if
    // (cb.status !== 0) return fail(3...` — o reviewer nit da sec 11.65: a
    // ancora NAO pode ser a linha da CHAMADA `git(["checkout", "-b", ...])`,
    // porque o checkout-fail fica na linha SEGUINTE e seria classificado
    // como POS (off-by-one que quebrou as 3 MUTATIONs). O checkout-fail
    // INCLUSIVE (<= cfIdx) e PRE: a scratch nunca foi criada — a nota NAO
    // deve existir (ruido). Tudo DEPOIS (> cfIdx: delta commit, doc
    // ausente, renumber THROW, --mutate, mutation commit, revert-fail)
    // PODEM deixar o usuario na scratch — a nota DEVE existir (a classe do
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
      if (cfIdx < 0) throw new Error(`fronteira do checkout-fail (${CF_ANCHOR}) nao encontrada no source — o guard de forma ficou cego`)
      // O findIndex e 0-based; o failSites usa s.line 1-based (i+1). Sem a
      // conversao, o checkout-fail (linha N) cairia em pos (N <= N-1 e
      // falso) — o off-by-one que o vitest pegou (reviewer, sec 11.65).
      const cfLine = cfIdx + 1
      const all = failSites(src)
      return { pre: all.filter((s) => s.line <= cfLine), pos: all.filter((s) => s.line > cfLine) }
    }

    // O escopo da classe: so os fail paths de INFRA (exit code 3) pos-scratch
    // precisam da nota. O verify-fail (`if (!check.ok) return fail(1,
    // check.message)`, exit code 1) roda DEPOIS do revertCycle — a scratch
    // ja foi revertida — e corretamente NAO tem a nota (o topo do .mjs
    // documenta: exit 1 = divergencia de verify, revert MESMO ASSIM).
    // Escopar a assert a `fail(3` fecha a classe sem exigir nota onde a
    // scratch nao existe mais (reviewer, sec 11.65).
    const posInfra = (pos: { line: number; text: string }[]) => pos.filter((s) => /fail\(3/.test(s.text))

    it("todo fail path de infra POS-checkout-b (exit code 3) termina com a scratchLeftNote (o usuario nunca fica na scratch sem a receita de saida)", () => {
      const src = fs.readFileSync(path.join(process.cwd(), "scripts", "hook-proof-run.mjs"), "utf8")
      const pos = posInfra(frontier(src).pos)
      expect(pos.length).toBeGreaterThanOrEqual(6)
      for (const s of pos) {
        expect(s.text, `linha ${s.line} (pos-checkout-b, infra) deve terminar com a scratchLeftNote`).toContain("scratchLeftNote")
      }
    }, 60000)

    it("nenhum fail path PRE-checkout-b tem a scratchLeftNote (a scratch nunca existiu — a nota seria ruido; o checkout-fail INCLUSIVE)", () => {
      const src = fs.readFileSync(path.join(process.cwd(), "scripts", "hook-proof-run.mjs"), "utf8")
      const { pre } = frontier(src)
      expect(pre.length).toBeGreaterThanOrEqual(5)
      for (const s of pre) {
        expect(s.text, `linha ${s.line} (pre-checkout-b) nao deve ter a scratchLeftNote`).not.toContain("scratchLeftNote")
      }
    }, 60000)

    it("MUTATION: remover a scratchLeftNote do revert-fail -> o guard de forma flagra a linha (a classe do fail silencioso nao volta)", () => {
      const src = fs.readFileSync(path.join(process.cwd(), "scripts", "hook-proof-run.mjs"), "utf8")
      // o revert-fail (o fix da sec 11.65): remove a interpolacao da nota.
      const mutated = src.replace("${reverted.message}${scratchLeftNote(originalBranch, opts.branch, backupDir)}", "${reverted.message}")
      expect(mutated).not.toBe(src)
      const pos = posInfra(frontier(mutated).pos)
      const offenders = pos.filter((s) => !s.text.includes("scratchLeftNote"))
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
      const offenders = pre.filter((s) => s.text.includes("scratchLeftNote"))
      expect(offenders.length).toBe(1)
      expect(offenders[0].text).toContain("checkout -b ${opts.branch} falhou")
    }, 60000)
  })
})
