/**
 * proof-helpers-contract.test.ts - o guard dos guards de prova (sec 11.72,
 * manifest DERIVADO desde a sec 11.79; FONTE UNICA desde a sec 11.93).
 *
 * WHY: o guard de forma da 11.65 (scratchLeftNote do hook-proof-run) e o da
 * 11.70 (stashLeftNote do ci-proof-run) derivam cada um do source do SEU
 * helper, e o ABS PIN do proofs-manifest deriva do manifest - mas nada pina
 * que TODO helper de prova tem as 3 partes do contrato de fail-loud:
 *   1. exit codes DOCUMENTADOS no docblock (0-3, nunca so no codigo);
 *   2. a nota de limpeza DEFINIDA (o LeftNote que os guards 11.65/11.70
 *      consomem - a classe do fail silencioso);
 *   3. o E2E do CAMINHO (CLI real + bins fake + assert de exit nao-zero -
 *      o fail-loud exercitado, nao so descrito em prosa).
 *
 * A sec 11.79 INVERTEU a fonte do manifest: o PROOF_HELPERS original era um
 * pin EXPLICITO (lista hardcoded - entrar manualmente ao adicionar um 3o
 * helper). Agora o manifest e DERIVADO do package.json (os scripts
 * `*-proof:run`, o padrao TARGET_DIRS/fatos consumidos): deriveProofHelpers
 * gera { script, mjs, ts, note } - e o pin e o PROOF_HELPERS_PIN (o ABS PIN
 * do CONTENT derivado, a projecao [script, mjs, ts, note]). O lado inverso
 * do crescimento virou ESTRUTURAL por construcao: todo script *-proof:run do
 * package.json ENTRA na derivada automaticamente e e checado pelas 3 partes
 * - nao ha lista para esquecer de editar. Refactor que remova qualquer parte
 * => o guard falha; adicionar um 3o helper (novo script) ou renomear uma
 * nota no source => a projecao diverge do PIN.
 *
 * A sec 11.93 fechou o ultimo elo: o contrato 11.72 agora e executado NO
 * BATCH do pre-commit (scan-proof-helpers.mjs, o 9o guard - a suite so
 * rodava via test:unit, no CI/push; a edicao acidental do bloco 'Exit
 * codes:' passava o commit local). A DERIVADA e os REGEXES das 3 partes
 * vivem no guard (a fonte unica da regra dos 2 usos) - esta suite os
 * IMPORTa de scripts/scan-proof-helpers.mjs, nunca os redefine: um guard e
 * a suite nao podem driftar (o mesmo padrao do EXIT_CLAIMS importado pelo
 * scan-exit-claims.test.ts).
 *
 * Nao e subprocess-heavy (leitura de fs + regex puros) - timeouts explicitos
 * por convencao da suite.
 */
import { describe, expect, it } from "vitest"
import fs from "node:fs"
import path from "node:path"
import { deriveProofHelpers } from "../scan-proof-helpers.mjs"
import { runSubprocess } from "./golden-copy-utils"

const SCRIPTS = path.join(process.cwd(), "scripts")
const read = (p: string) => fs.readFileSync(path.join(SCRIPTS, p), "utf8")
const readTest = (p: string) => fs.readFileSync(path.join(SCRIPTS, "__tests__", p), "utf8")
const readPkg = () => fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8")

/**
 * O ABS PIN do CONTENT derivado (sec 11.79): a projecao [script, mjs, ts,
 * note] da derivada, em ordem do mjs. A lista NAO e uma copia separada - e
 * a projecao de deriveProofHelpers; editar o package.json (novo script
 * *-proof:run) ou renomear uma nota no source exige editar ESTE snapshot
 * conscientemente (o growth contract aplicado ao conteudo, o mesmo padrao
 * do ABS_PIN_SNAPSHOT da sec 11.50).
 */
const PROOF_HELPERS_PIN: Array<[string, string, string, string]> = [
  ["ci-proof:run", "ci-proof-run.mjs", "ci-proof-run.test.ts", "stashLeftNote"],
  ["hook-proof:run", "hook-proof-run.mjs", "hook-proof-run.test.ts", "scratchLeftNote"],
]

// As 3 partes do contrato de fail-loud (sec 11.72): os regexes EXIT_CODES_RE /
// NOTE_DEF_RE / FAKE_BIN_RE / FAIL_EXIT_RE vivem no scan-proof-helpers.mjs (o
// 9o guard, sec 11.93) e sao IMPORTADOS abaixo - a fonte unica: o guard e a
// suite nunca driftam (a mesma filosofia do EXIT_CLAIMS importado).
import { EXIT_CODES_RE, FAKE_BIN_RE, FAIL_EXIT_RE, NOTE_DEF_RE } from "../scan-proof-helpers.mjs"

function assertThreeParts(h: { mjs: string; ts: string; note: string }) {
  const src = read(h.mjs)
  expect(EXIT_CODES_RE.test(src), `${h.mjs}: o docblock deve documentar os exit codes 0-3 (Exit codes: 0 = ... 1 = ... 2 = ... 3 = ...)`).toBe(true)
  expect(NOTE_DEF_RE.test(src), `${h.mjs}: deve definir a nota de limpeza (${h.note} = ... - a parte que os guards 11.65/11.70 consomem)`).toBe(true)
  const suite = readTest(h.ts)
  expect(FAKE_BIN_RE.test(suite), `${h.ts}: deve ter o seam de bins fake (CI_PROOF_GIT/HOOK_PROOF_GIT: o E2E do caminho roda o CLI real)`).toBe(true)
  expect(FAIL_EXIT_RE.test(suite), `${h.ts}: deve ter um E2E que assere exit nao-zero (.status).toBe(1|2|3) - o fail-loud exercitado, nao so em prosa`).toBe(true)
}

describe("proof-helpers-contract - as 3 partes do fail-loud em TODO helper de prova (sec 11.72, manifest derivado sec 11.79)", () => {
  it("DERIVACAO: o manifest nasce do package.json (todos os *-proof:run) - a projecao [script, mjs, ts, note] pinada pelo PROOF_HELPERS_PIN (sem lista hardcoded: adicionar um script muda a derivada)", () => {
    const derived = deriveProofHelpers(readPkg())
    // 2 helpers: ci-proof:run + hook-proof:run - a derivada E o manifest
    expect(derived).toHaveLength(2)
    expect(derived.map((h) => [h.script, h.mjs, h.ts, h.note])).toEqual(PROOF_HELPERS_PIN)
  }, 60000)

  it("todo helper da DERIVADA tem as 3 partes: exit codes 0-3 documentados, nota de limpeza definida e E2E do caminho (CLI real + bins fake + exit nao-zero)", () => {
    for (const h of deriveProofHelpers(readPkg())) assertThreeParts(h)
  }, 60000)

  it("MUTATION (a fonte): um script fake-proof:run novo num package.json sintetico muda a derivada -> a projecao diverge do PIN (o growth contract aplicado na derivada, nao na lista)", () => {
    const pkg = readPkg()
    const synthetic = pkg.replace(
      '"hook-proof:run": "node scripts/hook-proof-run.mjs"',
      '"hook-proof:run": "node scripts/hook-proof-run.mjs",\n    "fake-proof:run": "node scripts/ci-proof-run.mjs"',
    )
    expect(synthetic).not.toBe(pkg)
    const derived = deriveProofHelpers(synthetic)
    expect(derived).toHaveLength(3)
    expect(derived.some((h) => h.script === "fake-proof:run")).toBe(true)
    expect(derived.map((h) => [h.script, h.mjs, h.ts, h.note])).not.toEqual(PROOF_HELPERS_PIN)
  }, 60000)

  it("MUTATION: remover a definicao da nota de limpeza do ci-proof-run -> o guard flagra o helper (a parte 2 nunca pode sumir sem edicao consciente)", () => {
    const src = read("ci-proof-run.mjs")
    const mutated = src.replace("const stashLeftNote = ", "const stashNote = ")
    expect(mutated).not.toBe(src)
    expect(NOTE_DEF_RE.test(mutated)).toBe(false)
  }, 60000)

  it("MUTATION: remover o '3 = falha' do docblock do hook-proof-run -> o guard flagra (os exit codes 0-3 nunca podem encolher sem edicao consciente)", () => {
    const src = read("hook-proof-run.mjs")
    const mutated = src.replace("3 = falha de", "X = falha de")
    expect(mutated).not.toBe(src)
    expect(EXIT_CODES_RE.test(mutated)).toBe(false)
  }, 60000)

  it("MUTATION: remover o seam de bins fake do ci-proof-run.test.ts -> o guard flagra (o E2E do caminho roda o CLI real, nunca so a logica pura)", () => {
    const suite = readTest("ci-proof-run.test.ts")
    const mutated = suite.replace("CI_PROOF_GIT: FAKE", "CI_PROOF_GIT_OFF: FAKE")
    expect(mutated).not.toBe(suite)
    expect(FAKE_BIN_RE.test(mutated)).toBe(false)
  }, 60000)

  it("REAL-REPO CONTRACT do CLI (sec 11.93, o padrao do scan-exit-claims): node scripts/scan-proof-helpers.mjs --check no repo real -> exit 0 com os 2 helpers - o 9o guard verde no estado atual (o contrato 11.72 executado no batch nao e so hermetica)", () => {
    const res = runSubprocess({
      command: process.execPath,
      args: [path.join(process.cwd(), "scripts", "scan-proof-helpers.mjs"), "--check"],
    })
    expect(res.status).toBe(0)
    const stdout = res.stdout ?? ""
    expect(stdout).toContain("clean")
    expect(stdout).toContain("2 helpers")
    expect(stdout).toContain("sec 11.72/11.93")
  }, 60000)
})
