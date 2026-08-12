/**
 * proof-helpers-contract.test.ts - o guard dos guards de prova (sec 11.72,
 * manifest DERIVADO desde a sec 11.79).
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
 * Nao e subprocess-heavy (leitura de fs + regex puros) - timeouts explicitos
 * por convencao da suite.
 */
import { describe, expect, it } from "vitest"
import fs from "node:fs"
import path from "node:path"

const SCRIPTS = path.join(process.cwd(), "scripts")
const read = (p: string) => fs.readFileSync(path.join(SCRIPTS, p), "utf8")
const readTest = (p: string) => fs.readFileSync(path.join(SCRIPTS, "__tests__", p), "utf8")
const readPkg = () => fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8")

/**
 * O manifesto dos helpers DERIVADO do package.json (sec 11.79): cada script
 * `*-proof:run` vira { script, mjs, ts, note } - script (o nome no
 * package.json), mjs (o runner), ts (a suite por convencao <stem>.test.ts)
 * e note (o PRIMEIRO const `\w+LeftNote = (` do source do helper - a nota
 * que os guards 11.65/11.70 consomem; o revertLeftNote da 11.75 e function
 * declaration, nao casa o regex). NAO ha lista hardcoded: a derivada E o
 * manifest (o padrao TARGET_DIRS/fatos consumidos - a fonte unica).
 */
function deriveProofHelpers(pkg: string): Array<{ script: string; mjs: string; ts: string; note: string }> {
  return [...pkg.matchAll(/"([a-z0-9-]+-proof:run)"\s*:\s*"node scripts\/([a-z0-9_.-]+\.mjs)"/g)]
    .map((m) => {
      const mjs = m[2]
      const ts = mjs.replace(/\.mjs$/, ".test.ts")
      const note = read(mjs).match(/(\w+LeftNote)\s*=\s*(\(|")/)?.[1] ?? ""
      return { script: m[1], mjs, ts, note }
    })
    .sort((a, b) => a.mjs.localeCompare(b.mjs))
}

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

// As 3 partes do contrato de fail-loud (sec 11.72):
// 1. Exit codes documentados: o docblock "Exit codes:" cobre 0, 1, 2 e 3 na
//    ordem (o shape dos dois helpers: "0 = ...; 1 = ...; 2 = ...; 3 = ..." -
//    os codigos podem continuar em linhas seguintes, dai o [\s\S]).
const EXIT_CODES_RE = /Exit codes?:?\s*0\s*=[\s\S]*?1\s*=[\s\S]*?2\s*=[\s\S]*?3\s*=/
// 2. Nota de limpeza definida: o const do LeftNote (arrow com params ou string).
const NOTE_DEF_RE = /\w+LeftNote\s*=\s*(\(|")/
// 3. E2E do caminho: a suite tem o seam de bins fake (o env override) E um
//    assert de exit nao-zero num subprocess (o fail-loud exercitado pelo
//    CLI real - `r.status` no hook, `result.status` no ci).
const FAKE_BIN_RE = /(CI_PROOF_GIT|HOOK_PROOF_GIT)\s*:/
const FAIL_EXIT_RE = /\.status\)\.toBe\([123]/

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
})
