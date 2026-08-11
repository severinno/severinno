/**
 * check-exit-claims-push.mjs - guard git-based do doc commitado (2026-08-11,
 * sec 11.49): fecha a classe 'commit feito com HUSKY=0 ou --no-verify
 * esconde claim nova' no push net.
 *
 * WHY: o tripwire do scan-exit-claims roda no batch runner do pre-commit
 * (8o guard, sec 11.42) contra a WORKING TREE - mas so quando o hook roda.
 * Um commit com HUSKY=0 bypassa o batch; o Gate 3 mapeado (pre-commit-tests
 * --scope push) mapeia docs/* -> NENHUMA suite, entao o pre-push local nao
 * pega a classe (o CI pega so depois do push). Este guard materializa o doc
 * COMMITADO (git show HEAD:docs/gates-proofs.md - o estado exato empurrado)
 * e roda o detector na direcao UNICA .unregistered (claim no doc sem entrada
 * no EXIT_CLAIMS). O stale e ruido de delta (um delta nao-commitado na
 * working tree false-positiva o stale contra o doc commitado - o probe da
 * sec 11.49 flagrou 'entrada 11.47 sem claim no doc atual').
 *
 * Hermetic tests (mesmo padrao dos irmaos): as funcoes puras
 * (decideExitClaimsVerdict, parseSince, isValidBase, unregisteredOf) sao
 * testadas com conteudo sintetico - NENHUM git/fs real no caminho hermetico
 * (o unregisteredOf escreve um temp file e chama o checkExitClaims REAL, o
 * detector honesto da sec 11.42). O env override CHECK_EXIT_CLAIMS_PUSH_DOC
 * (o seam documentado no header do guard) aponta um doc sintetico para o
 * CLI REAL - o REAL-REPO CONTRACT do caminho de falha (poison doc -> exit 1
 * com a secao exata) sem depender do git.
 *
 * Subprocess-heavy (o CLI REAL-REPO CONTRACT spawna node via runSubprocess)
 * -> um timeout explicito em todo it() (o scan-timeouts guard exige).
 */
import { afterEach, describe, expect, it } from "vitest"
import fs from "node:fs"
import path from "node:path"
import { decideExitClaimsVerdict, isValidBase, parseSince, unregisteredOf } from "../check-exit-claims-push.mjs"
import { cleanupTempDirs, createTempDir, runSubprocess } from "./golden-copy-utils"

const SCRIPT = path.resolve(process.cwd(), "scripts", "check-exit-claims-push.mjs")

/** Uma claim de exit code legitima (a 11.42, registrada) + a 11.99 fake. */
const CLEAN_DOC = [
  "## 11.42 o CLI scan-exit-claims sai exit code 0 no doc real",
  "",
  "**Exit codes**: exit code 0 (doc coberto) / exit code 1 (violacoes listadas).",
  "",
  "## 12. Referências",
  "",
].join("\n")

const POISON_DOC = [
  "## 11.42 o CLI scan-exit-claims sai exit code 0 no doc real",
  "",
  "**Exit codes**: exit code 0 (doc coberto) / exit code 1 (violacoes listadas).",
  "",
  "## 11.99 Claim fake da prova",
  "",
  "**Exit codes**: exit code 3 aqui.",
  "",
  "## 12. Referências",
  "",
].join("\n")

describe("check-exit-claims-push.mjs - guard git-based do doc commitado (sec 11.49)", () => {
  afterEach(cleanupTempDirs)

  it("parseSince: --since main -> 'main'; ausente -> '' (o shape do run-mapped-fuzz)", () => {
    expect(parseSince(["--since", "main"])).toBe("main")
    expect(parseSince([])).toBe("")
    expect(parseSince(["--since"])).toBe("")
  }, 60000)

  it("isValidBase: all-zeros = primeiro push (sem base real); sha valido = true", () => {
    expect(isValidBase("0000000000000000000000000000000000000000")).toBe(false)
    expect(isValidBase("")).toBe(false)
    expect(isValidBase("  ")).toBe(false)
    expect(isValidBase("abc123")).toBe(true)
  }, 60000)

  it("decideExitClaimsVerdict: doc commitado LIMPO -> { ok: true }", () => {
    const v = decideExitClaimsVerdict({ headUnreg: [], baseUnreg: [], hasBase: true })
    expect(v.ok).toBe(true)
  }, 60000)

  it("decideExitClaimsVerdict: claim nova NO HEAD ausente no base -> { ok: false, newInPush: ['11.99'] } (a classe do pedido - introduzida neste push)", () => {
    const v = decideExitClaimsVerdict({ headUnreg: ["11.99"], baseUnreg: [], hasBase: true })
    expect(v.ok).toBe(false)
    expect(v.newInPush).toEqual(["11.99"])
    expect(v.preExisting).toEqual([])
  }, 60000)

  it("decideExitClaimsVerdict: claim PRE-EXISTENTE (no base e no HEAD) -> { ok: false, newInPush: [], preExisting: ['11.99'] } (bloqueia MESMO assim - empurrar estado quebrado adiante e a classe; o fix e registrar)", () => {
    const v = decideExitClaimsVerdict({ headUnreg: ["11.99"], baseUnreg: ["11.99"], hasBase: true })
    expect(v.ok).toBe(false)
    expect(v.newInPush).toEqual([])
    expect(v.preExisting).toEqual(["11.99"])
  }, 60000)

  it("decideExitClaimsVerdict: sem base (primeiro push) -> toda claim do HEAD e 'nova' (newInPush = headUnreg)", () => {
    const v = decideExitClaimsVerdict({ headUnreg: ["11.99"], baseUnreg: [], hasBase: false })
    expect(v.ok).toBe(false)
    expect(v.newInPush).toEqual(["11.99"])
    expect(v.preExisting).toEqual([])
  }, 60000)

  it("unregisteredOf: doc LIMPO -> [] (o detector REAL da sec 11.42, nao um parse proprio)", () => {
    const dir = createTempDir("exit-claims-push-")
    const docPath = path.join(dir, "doc.md")
    fs.writeFileSync(docPath, CLEAN_DOC, "utf8")
    expect(unregisteredOf(fs.readFileSync(docPath, "utf8"))).toEqual([])
  }, 60000)

  it("unregisteredOf: doc COM a claim fake 11.99 -> ['11.99'] (a secao exata que o detector honesto acha)", () => {
    const dir = createTempDir("exit-claims-push-")
    const docPath = path.join(dir, "doc.md")
    fs.writeFileSync(docPath, POISON_DOC, "utf8")
    expect(unregisteredOf(fs.readFileSync(docPath, "utf8"))).toEqual(["11.99"])
  }, 60000)

  it("REAL-REPO CONTRACT do CLI (sec 11.49): CHECK_EXIT_CLAIMS_PUSH_DOC apontando o doc LIMPO -> exit 0 com 'clean' (o env override pula o git show - o seam hermetico do header)", () => {
    const dir = createTempDir("exit-claims-push-")
    const docPath = path.join(dir, "clean.md")
    fs.writeFileSync(docPath, CLEAN_DOC, "utf8")
    const r = runSubprocess({
      command: process.execPath,
      args: [SCRIPT],
      env: { CHECK_EXIT_CLAIMS_PUSH_DOC: docPath },
    })
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("clean")
  }, 60000)

  it("REAL-REPO CONTRACT do CLI (sec 11.49): CHECK_EXIT_CLAIMS_PUSH_DOC apontando o doc POISONADO -> exit 1 com a SECAO EXATA ('claim na secao 11.99') e o aviso HUSKY=0", () => {
    const dir = createTempDir("exit-claims-push-")
    const docPath = path.join(dir, "poison.md")
    fs.writeFileSync(docPath, POISON_DOC, "utf8")
    const r = runSubprocess({
      command: process.execPath,
      args: [SCRIPT],
      env: { CHECK_EXIT_CLAIMS_PUSH_DOC: docPath },
    })
    expect(r.status).toBe(1)
    expect(r.stdout).toContain("claim na secao 11.99")
    expect(r.stdout).toContain("HUSKY=0")
    expect(r.stdout).toContain("CURE: registre a claim no EXIT_CLAIMS") // sec 11.54: o comando de cura compartilhado
  }, 60000)

  it("CLI exit 2 (uso errado): flag desconhecida -> exit 2 com a usage message (o contrato de uso documentado no header)", () => {
    const r = runSubprocess({ command: process.execPath, args: [SCRIPT, "--bogus"] })
    expect(r.status).toBe(2)
    expect(r.stderr).toContain("usage")
  }, 60000)

  it("CLI exit 3 (infra): CHECK_EXIT_CLAIMS_PUSH_DOC apontando um arquivo inexistente -> exit 3 (o override invalido e falha de infra, nao claim)", () => {
    const dir = createTempDir("exit-claims-push-")
    const r = runSubprocess({
      command: process.execPath,
      args: [SCRIPT],
      env: { CHECK_EXIT_CLAIMS_PUSH_DOC: path.join(dir, "nao-existe.md") },
    })
    expect(r.status).toBe(3)
  }, 60000)

  it("REAL-REPO CONTRACT do CLI contra o doc REAL (sem override): o guard roda git show HEAD de verdade e o doc commitado esta limpo -> exit 0 (o pino vivo: um claim nao-registrada commitada quebraria este teste)", () => {
    const r = runSubprocess({ command: process.execPath, args: [SCRIPT] })
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("clean")
  }, 120000)
})
