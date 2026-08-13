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
import { afterEach, beforeAll, describe, expect, it } from "vitest"
import fs from "node:fs"
import path from "node:path"
import { deriveProofHelpers } from "../scan-proof-helpers.mjs"
import { deriveWiredGuards } from "../proofs-manifest.mjs"
import { HELPER_EVIDENCE_EXCLUSIONS, derive11xCited, deriveEvidenceCited, deriveHelperEvidenceCited, helperEvidenceViolations } from "../scan-evidence-sweep.mjs"
import {
  CONSUMED_FACTS,
  LINE_NUM_RE,
  RESOLVED_PATHS,
  checkDerivedInventory,
  citesOf,
  deriveGates,
  deriveHelperStems,
  deriveNotes,
  derivePathDefs,
  lineNumField,
} from "../scan-derived-inventory.mjs"
import { cleanupTempDirs, createTempDir, runSubprocess } from "./golden-copy-utils"

const SCRIPTS = path.join(process.cwd(), "scripts")
const read = (p: string) => fs.readFileSync(path.join(SCRIPTS, p), "utf8")
const readTest = (p: string) => fs.readFileSync(path.join(SCRIPTS, "__tests__", p), "utf8")

// Os MUTATIONs da sec 11.112 criam roots sinteticos (createTempDir) - o
// cleanup pos-teste e o padrao das suites que usam golden-copy-utils.
afterEach(() => {
  cleanupTempDirs()
})
const readPkg = () => fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8")

/**
 * REGISTRIES HOISTED (sec 11.107): o CONSUMED_FACTS (11.104) e o RESOLVED_PATHS
 * (11.106) vivem no nivel do MODULO - a sec 11.107 consome os DOIS em conjunto
 * (a completude da derivacao cruza nota/gate -> CONSUMED_FACTS e path ->
 * RESOLVED_PATHS). O padrao TARGET_DIRS consumido: as derivacoes mecanicas
 * (deriveNotes/deriveGates/derivePathDefs/citesOf) sao a fonte unica; o
 * registro curado e verificado CONTRA a derivada - um fato novo no source sem
 * registro diverge (o fechamento do lado da completude do registry).
 */

// Os registries (CONSUMED_FACTS 11.104 / RESOLVED_PATHS 11.106) e as
// derivadas (deriveNotes/deriveGates/derivePathDefs/citesOf/deriveHelperStems)
// vivem NO GUARD scan-derived-inventory.mjs (a fonte unica, sec 11.112) - a
// suite importa DAQUI, nunca os redefine (a regra dos 2 usos; o mesmo padrao
// do EXIT_CLAIMS e dos regexes do scan-proof-helpers). Os ABS PINs abaixo
// pinam o CONTENT importado (um fato novo no guard diverge o pin aqui).

// A interface ResolvedPath permanece na suite (o cast `as ResolvedPath` do
// MUTATION da sec 11.108 a usa - o registro importado e JS puro, sem tipos).
// RESTAURADA em 2026-08-13 apos cleanup excessivo da 11.112 - nao remover.
interface ResolvedPath {
  helper: string
  varName: string
  defLine: number
  citedAt: number[]
  guard: string
  section: string
  kind: "pin" | "boundary"
}

// A forma LINE_NUM_RE e o predicado lineNumField (sec 11.109/11.113) vivem
// NO GUARD scan-derived-inventory.mjs desde a sec 11.114 - a regra dos 2
// usos no padrao do EXIT_CODES_RE do scan-proof-helpers: o guard EXECUTA
// a CONFINEMENT no batch (um numero fantasma no registry falha antes do
// commit), e esta suite importa DAQUI a fonte unica (nunca uma copia
// local que poderia driftar).

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

describe("CONSUMED FACTS registry (sec 11.104): todo fato consumido dos helpers de prova tem guard irmao pinado - o guard dos guards de fatos consumidos", () => {
  // O registro curado CONSUMED_FACTS vive no nivel do MODULO (sec 11.107 -
  // hoisted: a derivacao da completude consome ele e o RESOLVED_PATHS em
  // conjunto; o registro curado e o fato compartilhado, nunca uma copia).
  const suiteOf = (helper: string): string => readTest(`${helper}.test.ts`)
  const docText = () => fs.readFileSync(path.join(process.cwd(), "docs", "gates-proofs.md"), "utf8")

  it("INVARIANT: todo fato com kind 'pin' tem o guard REAL no source da suite (o guard nunca some sem a falha do registro)", () => {
    const offenders = CONSUMED_FACTS.filter((f) => f.kind === "pin" && !suiteOf(f.helper).includes(f.guard))
    expect(offenders.map((o) => `${o.helper}:${o.fact}`), `guard ausente: ${JSON.stringify(offenders)}`).toEqual([])
  }, 60000)

  it("INVARIANT: toda fronteira registrada tem guard '' E a secao documentada no doc (o RECUSADO e findavel, nunca some)", () => {
    const doc = docText()
    for (const f of CONSUMED_FACTS.filter((x) => x.kind === "boundary")) {
      expect(f.guard).toBe("")
      expect(doc.includes(`## ${f.section} `), `a fronteira ${f.helper}:${f.fact} exige a secao ## ${f.section} no doc`).toBe(true)
    }
  }, 60000)

  it("HELPERS COBERTOS: todo helper da DERIVADA (package.json *-proof:run) tem >= 1 fato registrado - um 3o helper sem fatos diverge", () => {
    const derived = deriveProofHelpers(readPkg())
    for (const h of derived) {
      const stem = h.mjs.replace(/\.mjs$/, "")
      expect(CONSUMED_FACTS.some((f) => f.helper === stem), `o helper ${h.mjs} nao tem nenhum fato consumido registrado`).toBe(true)
    }
  }, 60000)

  it("ABS PIN: o registro (helper, fact, guard, section, kind) - o growth contract: um fato novo exige edicao consciente deste snapshot", () => {
    const snapshot = CONSUMED_FACTS.map((f) => [f.helper, f.fact, f.guard, f.section, f.kind] as const)
    expect(snapshot, `facts: ${JSON.stringify(snapshot)}`).toEqual([
      ["hook-proof-run", "scratchLeftNote (a nota em todo fail pos-scratch)", "o guard de forma do fail silencioso (sec 11.65)", "11.65", "pin"],
      ["hook-proof-run", "stage (o retorno do revertCycle no dispatch)", "stageFromReturn", "11.84", "pin"],
      ["hook-proof-run", "safetyDiff (o path resolvido-uma-vez)", "safetyDiffFromVar", "11.100", "pin"],
      ["hook-proof-run", "backupDir (o path criado-uma-vez)", "backupDirFromVar", "11.101", "pin"],
      ["ci-proof-run", "stashLeftNote (o placement nos fail sites)", "o guard de forma do fail silencioso (sec 11.70)", "11.70", "pin"],
      ["ci-proof-run", "stashedDelta (o gate VARIAVEL)", "gatedOnVar", "11.102", "pin"],
      ["ci-proof-run", "logPath (resolvido-uma-vez)", "logUses", "11.102", "pin"],
      ["ci-proof-run", "inputs citados (as citacoes de opts.X/b em mensagens)", "o guard irmao do INPUT citado (sec 11.105)", "11.105", "pin"],
      ["ci-proof-run", "selfDel (resolvido-uma-vez - nao citado em output)", "", "11.102", "boundary"],
    ])
  }, 60000)

  it("ANCHOR (sec 11.109): nenhuma fact string embute numero de linha (o defLine vive no RESOLVED_PATHS - a fonte mecanica com DEF REALITY/CITED REALITY/ABS PIN; a fact string e ancora estavel: nome do const + secao como campos)", () => {
    // O ABS PIN e o backstop do CONTENT (qualquer mudanca de fact exige bump
    // consciente do snapshot); o LINE_NUM_RE (importado do guard
    // scan-derived-inventory.mjs, sec 11.114 - a fonte unica da regra dos 2
    // usos) e o tripwire das FORMAS historicas ("linha N" e ", N -") - o
    // \d+ cobre linhas de qualquer tamanho, e o contexto
    // virgula-espaco-travessao ja desambigua de numeros em prosa ("sec
    // 11.100" nao tem a moldura virgula-travessao).
    for (const f of CONSUMED_FACTS) {
      expect(LINE_NUM_RE.test(f.fact), `${f.helper}:${f.fact} - a fact string nao pode embutir numero de linha (o numero do defLine pertence ao RESOLVED_PATHS)`).toBe(false)
    }
  }, 60000)

  it("MUTATION: remover o guard do stage da suite -> o registro flagra o fato com helper+fact", () => {
    const src = suiteOf("hook-proof-run")
    const mutated = src.replaceAll("stageFromReturn", "stageFromGate")
    expect(mutated).not.toBe(src)
    const offenders = CONSUMED_FACTS.filter((f) => f.kind === "pin" && f.helper === "hook-proof-run" && !mutated.includes(f.guard))
    expect(offenders.map((o) => o.fact)).toContain("stage (o retorno do revertCycle no dispatch)")
  }, 60000)

  it("MUTATION: a fronteira selfDel perde a secao no doc -> o registro flagra (o RECUSADO documentado nunca some)", () => {
    const doc = docText()
    const mutated = doc.replace("## 11.102 O guard irmao", "## 11.XXX O guard irmao")
    expect(mutated).not.toBe(doc)
    const missing = CONSUMED_FACTS.filter((f) => f.kind === "boundary" && !mutated.includes(`## ${f.section} `))
    expect(missing.map((o) => o.fact)).toContain("selfDel (resolvido-uma-vez - nao citado em output)")
  }, 60000)
})

describe("RESOLVED PATHS (sec 11.106): o inventario completo dos paths resolvidos-uma-vez citados em output em TODOS os helpers de prova - a varredura ampla fechada", () => {
  // O inventario RESOLVED_PATHS e as derivacoes (derivePathDefs/citesOf)
  // vivem no nivel do MODULO (sec 11.107 - hoisted: a completude da derivacao
  // do CONSUMED_FACTS cruza nota/gate -> 11.104 e path -> 11.106 em conjunto;
  // o padrao TARGET_DIRS consumido, nunca uma copia).
  const registrySuite = () => readTest("proof-helpers-contract.test.ts")

  it("DEF REALITY: a defLine de cada entrada contem 'const <var> =' no source (a def pinada existe - nunca uma linha fantasma)", () => {
    for (const e of RESOLVED_PATHS) {
      const line = read(`${e.helper}.mjs`).split("\n")[e.defLine - 1] ?? ""
      expect(line, `${e.helper}:${e.varName} (def ${e.defLine}) deve conter 'const ${e.varName} ='`).toContain(`const ${e.varName} =`)
    }
  }, 60000)

  it("CITED REALITY: as citacoes derivadas de \${var} == citedAt registrado (por helper+var, uniao das defs - um literal numa fail REMOVE a citacao e diverge)", () => {
    for (const helper of [...new Set(RESOLVED_PATHS.map((e) => e.helper))]) {
      const src = read(`${helper}.mjs`)
      const byVar = new Map<string, number[]>()
      for (const e of RESOLVED_PATHS.filter((x) => x.helper === helper && x.kind === "pin")) {
        byVar.set(e.varName, [...(byVar.get(e.varName) ?? []), ...e.citedAt])
      }
      for (const [varName, citedAt] of byVar) {
        const expected = [...new Set(citedAt)].sort((a, b) => a - b)
        expect(citesOf(src, varName), `${helper}:${varName} - as citacoes devem ser exatamente ${JSON.stringify(expected)}`).toEqual(expected)
      }
    }
  }, 60000)

  it("COMPLETENESS (a varredura fechada): todo path-API derivado COM citacao em output esta no registro como pin - um path novo citado sem entrada diverge", () => {
    for (const helper of [...new Set(RESOLVED_PATHS.map((e) => e.helper))]) {
      const src = read(`${helper}.mjs`)
      for (const d of derivePathDefs(src)) {
        if (citesOf(src, d.varName).length === 0) continue // sem citacao em output = fora da classe
        expect(
          RESOLVED_PATHS.some((e) => e.helper === helper && e.varName === d.varName && e.defLine === d.defLine && e.kind === "pin"),
          `${helper}:${d.varName} (def ${d.defLine}) tem citacao em output mas nao esta registrado como pin`,
        ).toBe(true)
      }
    }
  }, 60000)

  it("GUARD REALITY: todo pin tem guard real (os 3 pre-pinados nas suites dos helpers; os 9 gaps no proprio registro - o ABS PIN + as MUTATIONs provam os dentes do guard)", () => {
    const reg = registrySuite()
    for (const e of RESOLVED_PATHS.filter((x) => x.kind === "pin")) {
      const inHelper = readTest(`${e.helper}.test.ts`).includes(e.guard)
      const inRegistry = reg.includes(e.guard)
      expect(inHelper || inRegistry, `${e.helper}:${e.varName} guard '${e.guard}' nao encontrado em nenhuma suite`).toBe(true)
    }
  }, 60000)

  it("BOUNDARY: o selfDel (resolvido-uma-vez, NAO citado em output - o RECUSADO da 11.102) tem guard '' + secao documentada + ZERO citacoes derivadas (se ganhar citacao, a fronteira quebra)", () => {
    const doc = fs.readFileSync(path.join(process.cwd(), "docs", "gates-proofs.md"), "utf8")
    for (const e of RESOLVED_PATHS.filter((x) => x.kind === "boundary")) {
      expect(e.guard).toBe("")
      expect(doc.includes(`## ${e.section} `), `a fronteira ${e.helper}:${e.varName} exige a secao ## ${e.section} no doc`).toBe(true)
      expect(citesOf(read(`${e.helper}.mjs`), e.varName), `${e.helper}:${e.varName} nunca pode ganhar citacao em output (o RECUSADO e boundary)`).toEqual([])
    }
  }, 60000)

  it("ABS PIN: o inventario completo (helper, var, defLine, citedAt, guard, section, kind) - o growth contract: um path novo (ou citacao nova) exige edicao consciente deste snapshot", () => {
    const snapshot = RESOLVED_PATHS.map((e) => [e.helper, e.varName, e.defLine, e.citedAt, e.guard, e.section, e.kind] as const)
    expect(snapshot, `paths: ${JSON.stringify(snapshot)}`).toEqual([
      ["hook-proof-run", "docPath", 619, [715, 719], "RESOLVED PATHS (sec 11.106)", "11.106", "pin"],
      ["hook-proof-run", "backupDir", 621, [419, 510, 512, 515, 551, 553, 567, 570, 594, 704], "backupDirFromVar", "11.101", "pin"],
      ["hook-proof-run", "safetyDiff", 625, [484, 567, 644], "safetyDiffFromVar", "11.100", "pin"],
      ["hook-proof-run", "safetyBackup", 628, [694], "RESOLVED PATHS (sec 11.106)", "11.106", "pin"],
      ["hook-proof-run", "logPath", 768, [770, 797], "RESOLVED PATHS (sec 11.106)", "11.106", "pin"],
      ["ci-proof-run", "logPath", 822, [827, 899], "logUses", "11.102", "pin"],
      ["ci-proof-run", "selfDel", 659, [], "", "11.102", "boundary"],
      ["guard-remeasure", "logPath", 282, [283], "RESOLVED PATHS (sec 11.106)", "11.106", "pin"],
      ["guard-remeasure", "logPath", 303, [304], "RESOLVED PATHS (sec 11.106)", "11.106", "pin"],
      ["doc-revalidate", "docPath", 284, [269, 285, 335, 341], "RESOLVED PATHS (sec 11.106)", "11.106", "pin"],
      ["proof-register", "manifestPath", 365, [437], "RESOLVED PATHS (sec 11.106)", "11.106", "pin"],
      ["proof-register", "testPath", 366, [437], "RESOLVED PATHS (sec 11.106)", "11.106", "pin"],
      ["proof-register", "docPath", 367, [437], "RESOLVED PATHS (sec 11.106)", "11.106", "pin"],
    ])
  }, 60000)

  it("MUTATION: um literal no lugar de \${docPath} numa fail do hook-proof-run REMOVE a citacao da derivada -> a CITED REALITY divergiria (o guard pega)", () => {
    const src = read("hook-proof-run.mjs")
    const mutated = src.replace("`doc nao encontrado: ${docPath}", "`doc nao encontrado: /tmp/literal.md")
    expect(mutated).not.toBe(src)
    expect(citesOf(mutated, "docPath")).not.toEqual([715, 719])
  }, 60000)

  it("MUTATION: remover a def do logPath do hook-proof-run (768) -> a DEF REALITY divergiria (a def pinada nunca some)", () => {
    const src = read("hook-proof-run.mjs")
    const mutated = src.replace('const logPath = path.join(backupDir, "hook.log")', 'const lp = path.join(backupDir, "hook.log")')
    expect(mutated).not.toBe(src)
    expect(mutated.split("\n")[767].includes("const logPath =")).toBe(false)
  }, 60000)

  it("MUTATION: um path-API NOVO citado em output numa copia do doc-revalidate nao esta no registro -> a COMPLETENESS divergiria", () => {
    const src = read("doc-revalidate.mjs")
    const mutated = src + '\n  const novoPath = path.resolve(process.cwd(), "novo")\n  console.log(`novo: ${novoPath}`)\n'
    expect(mutated).not.toBe(src)
    const defs = derivePathDefs(mutated).filter((d) => d.varName === "novoPath")
    expect(defs).toHaveLength(1)
    // A citacao fica na linha SEGUINTE a def (a linha do console.log) -
    // o defs[0].defLine e a linha do `const`, a citacao e a +1.
    expect(citesOf(mutated, "novoPath")).toEqual([defs[0].defLine + 1])
    expect(RESOLVED_PATHS.some((e) => e.helper === "doc-revalidate" && e.varName === "novoPath")).toBe(false)
  }, 60000)
})

describe("REGISTRY NUMBERS frontier (sec 11.113): todo numero embutido num ABS PIN de registry TEM derivada mecanica correspondente - o CONSUMED_FACTS deriva ZERO numeros (a ausencia e o desenho, o ANCHOR da 11.109 generalizado a todos os campos); o RESOLVED_PATHS confina os numeros a defLine/citedAt (os campos com DEF REALITY/CITED REALITY) - a classe 'numero fantasma sem derivada' fechada nos dois registries", () => {
  // A fronteira do desenho (sec 11.113): numeros so entram num ABS PIN de
  // registry quando a derivada mecanica os respalda. O CONSUMED_FACTS nao
  // tem derivada numerica (a 11.109 removeu os numeros das fact strings) -
  // a AUSENCIA e o desenho, pinada em TODOS os campos. O RESOLVED_PATHS
  // mantem defLine/citedAt PORQUE DEF REALITY (a linha contem 'const X =')
  // e CITED REALITY (citesOf produz as citacoes) os verificam contra o
  // source - os numeros sao confinados aos DOIS campos com derivada.
  it("CONFINEMENT: o CONSUMED_FACTS nao tem numero de linha em NENHUM campo de nenhuma entrada (o ANCHOR da 11.109 cobria so a fact string; aqui a fronteira e o registro inteiro - helper/fact/guard/section/kind)", () => {
    for (const f of CONSUMED_FACTS) {
      expect(lineNumField(f), `${f.helper}:${f.fact} - campo '${lineNumField(f)}' embute numero de linha (o CONSUMED_FACTS nao tem derivada numerica)`).toBeNull()
    }
  }, 60000)

  it("CONFINEMENT: o RESOLVED_PATHS confina os numeros a defLine/citedAt (os campos com DEF REALITY/CITED REALITY) - nenhum campo string (helper/varName/guard/section/kind) embute numero de linha", () => {
    for (const e of RESOLVED_PATHS) {
      expect(lineNumField(e), `${e.helper}:${e.varName} - campo '${lineNumField(e)}' embute numero de linha (os numeros vivem so em defLine/citedAt)`).toBeNull()
    }
  }, 60000)

  it("BACKSTOP: todo numero embutido tem a derivada que o respalda - cada defLine e verificado pela derivada (derivePathDefs produz (varName, defLine) nas formas path-API) OU pela DEF REALITY (as formas CURADAS done.log.replace do guard-remeasure 303 e env||DEFAULT do proof-register 365-367, sec 11.106: a linha contem 'const X ='); cada citedAt e produzido por citesOf - o numero fantasma (nem a derivada nem a linha real) diverge", () => {
    for (const helper of [...new Set(RESOLVED_PATHS.map((e) => e.helper))]) {
      const src = read(`${helper}.mjs`)
      const defs = derivePathDefs(src)
      for (const e of RESOLVED_PATHS.filter((x) => x.helper === helper && x.kind === "pin")) {
        const derivable = defs.some((d) => d.varName === e.varName && d.defLine === e.defLine)
        const line = src.split("\n")[e.defLine - 1] ?? ""
        const curated = line.includes(`const ${e.varName} =`)
        expect(derivable || curated, `${e.helper}:${e.varName} (def ${e.defLine}) - numero fantasma: nem a derivada o produz nem a linha contem a def`).toBe(true)
        const produced = citesOf(src, e.varName)
        for (const c of e.citedAt) {
          expect(produced, `${e.helper}:${e.varName} citedAt ${c} nao produzido por citesOf`).toContain(c)
        }
      }
    }
  }, 60000)

  it("MUTATION: um numero de linha injetado num campo string de um entry sintetico diverge a CONFINEMENT (o dente do predicado - a fronteira nao e so o estado atual)", () => {
    const synthetic = {
      helper: "hook-proof-run",
      varName: "docPath",
      defLine: 619,
      citedAt: [715, 719],
      guard: "RESOLVED PATHS (sec 11.106, linha 999)",
      section: "11.106",
      kind: "pin",
    }
    expect(lineNumField(synthetic)).toBe("guard")
    // Um entry limpo (sem numero de linha) retorna null - o predicado nao
    // e cegueira.
    expect(lineNumField({ ...synthetic, guard: "RESOLVED PATHS (sec 11.106)" })).toBeNull()
  }, 60000)

  it("REAL-REPO CONTRACT (sec 11.114): o guard EXECUTA a CONFINEMENT no batch - o checkDerivedInventory do scan-derived-inventory invoca lineNumField sobre os registries (um numero fantasma no registry falha antes do commit, nao so no push); o CLI real sai clean citando o confinamento", () => {
    const guard = read("scan-derived-inventory.mjs")
    // O wire nao pode sumir vago (a classe do ACHADO Prova 17): o slice do
    // checkDerivedInventory DEVE conter a invocacao da CONFINEMENT - sem
    // ela, um numero fantasma no registry passaria o commit local.
    const checkSlice = guard.slice(guard.indexOf("export function checkDerivedInventory"), guard.indexOf("export function main"))
    expect(checkSlice).toContain("lineNumField(")
    expect(checkSlice).toContain("CONSUMED_FACTS")
    expect(checkSlice).toContain("RESOLVED_PATHS")
    const res = runSubprocess({
      command: process.execPath,
      args: [path.join(process.cwd(), "scripts", "scan-derived-inventory.mjs"), "--check"],
    })
    expect(res.status).toBe(0)
    const stdout = res.stdout ?? ""
    expect(stdout).toContain("confinamento numerico - sec 11.113/11.114")
  }, 60000)
})

describe("DERIVED INVENTORY (sec 11.107): a completude do registry fechada pelo source - todo fato derivado mecanicamente (notas \\w+LeftNote, gates \\w+Delta ? LeftNote, paths citados em output) dos 5 helpers tem entrada no registry (CONSUMED_FACTS 11.104 / RESOLVED_PATHS 11.106) - o padrao TARGET_DIRS consumido; a fronteira dos 3 utilitarios na sec 11.111 (derivam vazio por desenho)", () => {
  // As derivadas (deriveNotes/deriveGates/derivePathDefs/citesOf) sao a fonte
  // unica (o padrao TARGET_DIRS consumido): o registro curado e verificado
  // CONTRA a derivada - um fato novo no source sem registro diverge (o
  // fechamento do lado da completude do registry, o CONSUMED_FACTS curado
  // da 11.104 nao pegava mecanicamente).
  const derivedNotes = new Map<string, { varName: string; defLine: number }[]>()
  const derivedGates = new Map<string, { varName: string; defLine: number }[]>()

  // O escopo da derivacao (sec 11.111): a UNIAO dos helpers de prova - os
  // stems do deriveProofHelpers (*-proof:run, os 2 do ciclo) + os helpers do
  // RESOLVED_PATHS (o sweep da 11.106 cobre os 5) - DERIVADA, nunca
  // hardcoded (o padrao TARGET_DIRS consumido). Os 3 irmaos utilitarios
  // (guard-remeasure, doc-revalidate, proof-register) derivam ZERO notas e
  // ZERO gates - a ausencia e o desenho, PINADA pela FRONTIER da sec 11.111
  // (um LeftNote/gate futuro num irmao divergiria o DERIVED PIN fail-loud).
  // O escopo da derivacao agora vive no GUARD (deriveHelperStems, sec 11.112
  // - a fonte unica): a suite consome a MESMA uniao que o guard roda no batch.
  const allHelperStems = (): string[] => deriveHelperStems(readPkg())

  beforeAll(() => {
    for (const stem of allHelperStems()) {
      const src = read(`${stem}.mjs`)
      derivedNotes.set(stem, deriveNotes(src))
      derivedGates.set(stem, deriveGates(src))
    }
  })

  it("DERIVED PIN: a projecao das derivadas (helper, kind, var, primeira linha) - o growth contract do lado da DERIVACAO: uma nota/gate novo no source diverge deste snapshot", () => {
    const notes = [...derivedNotes.entries()].flatMap(([helper, ns]) => ns.map((n) => [helper, "note", n.varName, n.defLine] as const))
    const gates = [...derivedGates.entries()].flatMap(([helper, gs]) => gs.map((g) => [helper, "gate", g.varName, g.defLine] as const))
    const projected = [...notes, ...gates].sort((a, b) => (a[0] + a[1] + a[2]).localeCompare(b[0] + b[1] + b[2]))
    expect(projected).toEqual([
      ["ci-proof-run", "gate", "stashedDelta", 633],
      ["ci-proof-run", "note", "stashLeftNote", 612],
      ["hook-proof-run", "note", "scratchLeftNote", 418],
    ])
  }, 60000)

  it("COMPLETENESS: todo fato derivado do source (notas + gates + paths citados em output) tem entrada no registry - um fato novo no source sem registro diverge (o fechamento do lado da completude; o escopo dos 5 helpers, sec 11.111)", () => {
    for (const stem of allHelperStems()) {
      const src = read(`${stem}.mjs`)
      for (const n of derivedNotes.get(stem) ?? []) {
        expect(CONSUMED_FACTS.some((f) => f.helper === stem && f.fact.includes(n.varName)), `a nota ${stem}:${n.varName} (def ${n.defLine}) derivada do source nao tem entrada no CONSUMED_FACTS`).toBe(true)
      }
      for (const g of derivedGates.get(stem) ?? []) {
        expect(CONSUMED_FACTS.some((f) => f.helper === stem && f.fact.includes(g.varName)), `o gate ${stem}:${g.varName} (primeiro uso ${g.defLine}) derivado do source nao tem entrada no CONSUMED_FACTS`).toBe(true)
      }
      for (const d of derivePathDefs(src)) {
        if (citesOf(src, d.varName).length === 0) continue
        expect(RESOLVED_PATHS.some((e) => e.helper === stem && e.varName === d.varName && e.defLine === d.defLine && e.kind === "pin"), `o path ${stem}:${d.varName} (def ${d.defLine}) citado em output nao esta no RESOLVED_PATHS como pin`).toBe(true)
      }
    }
  }, 60000)

  it("MUTATION: uma nota NOVA (const novoLeftNote =) numa copia do hook-proof-run entra na derivada mas nao no registry -> a COMPLETENESS divergiria", () => {
    const src = read("hook-proof-run.mjs")
    const mutated = src + "\nconst novoLeftNote = \"x\"\n"
    expect(mutated).not.toBe(src)
    expect(deriveNotes(mutated).some((n) => n.varName === "novoLeftNote")).toBe(true)
    expect(CONSUMED_FACTS.some((f) => f.helper === "hook-proof-run" && f.fact.includes("novoLeftNote"))).toBe(false)
  }, 60000)

  it("MUTATION: um gate NOVO (novoDelta ? stashLeftNote) numa copia do ci-proof-run entra na derivada mas nao no registry -> a COMPLETENESS divergiria", () => {
    const src = read("ci-proof-run.mjs")
    const mutated = src + '\n  if (x) return fail(3, `msg${novoDelta ? stashLeftNote : ""}`)\n'
    expect(mutated).not.toBe(src)
    expect(deriveGates(mutated).some((g) => g.varName === "novoDelta")).toBe(true)
    expect(CONSUMED_FACTS.some((f) => f.helper === "ci-proof-run" && f.fact.includes("novoDelta"))).toBe(false)
  }, 60000)

  it("MUTATION: um path NOVO citado em output numa copia do ci-proof-run nao esta no RESOLVED_PATHS -> a COMPLETENESS do path divergiria (o dente do lado path no scope dos 2 helpers)", () => {
    const src = read("ci-proof-run.mjs")
    const mutated = src + '\n  const novoLogPath = path.resolve(process.cwd(), "novo.log")\n  console.log(`novo: ${novoLogPath}`)\n'
    expect(mutated).not.toBe(src)
    expect(derivePathDefs(mutated).some((d) => d.varName === "novoLogPath")).toBe(true)
    expect(citesOf(mutated, "novoLogPath").length).toBeGreaterThan(0)
    expect(RESOLVED_PATHS.some((e) => e.helper === "ci-proof-run" && e.varName === "novoLogPath")).toBe(false)
  }, 60000)

  // A FRONTEIRA (sec 11.111): a derivacao cobre os 5 helpers (a UNIAO
  // derivada acima), mas os 3 irmaos utilitarios (guard-remeasure,
  // doc-revalidate, proof-register) NAO sao scripts de ciclo de prova
  // (*-proof:run) - a classe nota-de-limpeza/gate e do CICLO scratch/stash
  // (a nota protege o delta do ciclo, secs 11.65/11.70/11.102), que os
  // utilitarios nao rodam. A AUSENCIA e o desenho, PINADA: um LeftNote/gate
  // futuro num irmao divergiria o DERIVED PIN fail-loud (o growth contract
  // do lado da derivacao cobre os 5, nao so os 2).
  it("FRONTIER (sec 11.111): os 3 irmaos utilitarios derivam ZERO notas e ZERO gates - a ausencia e o desenho (a nota/gate e a classe do ciclo, nao do utilitario); um LeftNote/gate futuro num irmao divergiria o DERIVED PIN", () => {
    const cycleStems = deriveProofHelpers(readPkg()).map((h) => h.mjs.replace(/\.mjs$/, ""))
    const siblings = allHelperStems().filter((s) => !cycleStems.includes(s))
    expect(siblings).toEqual(["doc-revalidate", "guard-remeasure", "proof-register"])
    for (const stem of siblings) {
      expect(derivedNotes.get(stem) ?? [], `${stem}: o irmao utilitario nao pode ter nota de limpeza (a classe e do ciclo, sec 11.111)`).toEqual([])
      expect(derivedGates.get(stem) ?? [], `${stem}: o irmao utilitario nao pode ter gate de nota (a classe e do ciclo, sec 11.111)`).toEqual([])
    }
  }, 60000)

  it("MUTATION (sec 11.111): um LeftNote sintetico numa copia do guard-remeasure ENTRA na derivada - o dente do pin: a ausencia e DECISAO, nao cegueira do derivador", () => {
    const src = read("guard-remeasure.mjs")
    const mutated = src + "\nconst novoLeftNote = \"x\"\n"
    expect(mutated).not.toBe(src)
    expect(deriveNotes(mutated).some((n) => n.varName === "novoLeftNote")).toBe(true)
    expect(CONSUMED_FACTS.some((f) => f.helper === "guard-remeasure" && f.fact.includes("novoLeftNote"))).toBe(false)
  }, 60000)

  it("MUTATION (sec 11.112): o checkDerivedInventory num root sintetico com um helper ganhando nota nova sem registro -> flagra com helper:var exato (o dente do 11o guard exercitado, nao so a derivada)", () => {
    const dir = createTempDir("di-mut-")
    fs.mkdirSync(path.join(dir, "scripts"), { recursive: true })
    // package.json minimo com o script *-proof:run (a derivada precisa dele)
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ scripts: { "hook-proof:run": "node scripts/hook-proof-run.mjs" } }),
    )
    // O helper real com a nota nova anexada (o MESMO dente da Prova 55,
    // agora num root sintetico isolado - o guard deriva e flagra).
    const src = read("hook-proof-run.mjs")
    const mutated = src + "\nconst novoLeftNote = \"x\"\n"
    fs.writeFileSync(path.join(dir, "scripts", "hook-proof-run.mjs"), mutated)
    const violations = checkDerivedInventory(dir)
    expect(violations.some((v) => v.includes("hook-proof-run:novoLeftNote"))).toBe(true)
  }, 60000)

  it("REAL-REPO CONTRACT do CLI (sec 11.112, o padrao do scan-exit-claims/scan-proof-helpers): node scripts/scan-derived-inventory.mjs --check no repo real -> exit 0 clean - o 11o guard verde no estado atual (a completude da 11.107 executada no batch, nao so hermetica)", () => {
    const res = runSubprocess({
      command: process.execPath,
      args: [path.join(process.cwd(), "scripts", "scan-derived-inventory.mjs"), "--check"],
    })
    expect(res.status).toBe(0)
    const stdout = res.stdout ?? ""
    expect(stdout).toContain("clean")
    expect(stdout).toContain("sec 11.107/11.112")
  }, 60000)
})

describe("o scope do RESOLVED_PATHS (sec 11.108): a varredura cobre os helpers de prova, NUNCA um guard wired - o pin dos guards e o IMPORT direto na suite deles, nao o registry (a fronteira documentada do RECUSADO)", () => {
  it("REAL-REPO: nenhum helper do RESOLVED_PATHS e um guard wired (deriveWiredGuards) - a fronteira estrutural: os paths dos guards (DOC/ROOT/UNIT_CONFIG) sao INPUTS (alvos de readFileSync), nao citacoes varridas pela 11.106; o unico path de guard citado em output (o ROOT do scan-unit-config, 139/153, a mensagem 'ausente em') e a fronteira DOCUMENTADA da classe (o sweep da 11.106 cobre os helpers de prova, nunca os guards wired)", () => {
    const wired = new Set(deriveWiredGuards())
    const offenders = RESOLVED_PATHS.map((e) => `${e.helper}.mjs`).filter((g) => wired.has(g))
    expect(offenders).toEqual([])
  }, 60000)

  it("MUTATION: um guard wired adicionado ao RESOLVED_PATHS (ex.: scan-exit-claims DOC) violaria a fronteira - o registro nunca cresce para um guard sem a decisao inversa documentada (o RECUSADO da 11.108)", () => {
    const wired = new Set(deriveWiredGuards())
    // A entrada sintetica e um guard wired generico - o citedAt e placeholder
    // ([] - o predicado so filtra por helper; a linha 139 pertence ao ROOT do
    // scan-unit-config, nao ao DOC do scan-exit-claims, e nao e exercitada).
    const synthetic = [
      ...RESOLVED_PATHS,
      { helper: "scan-exit-claims", varName: "DOC", defLine: 54, citedAt: [], guard: "RESOLVED PATHS (sec 11.106)", section: "11.106", kind: "pin" } as ResolvedPath,
    ]
    const offenders = synthetic.map((e) => `${e.helper}.mjs`).filter((g) => wired.has(g))
    expect(offenders).toEqual(["scan-exit-claims.mjs"])
  }, 60000)
})

describe("o sweep irmao da 11.117 no registry de helpers (sec 11.118): toda citacao de helper em secao 11.x com evidencia datada tem entrada no PROOF_HELPERS (derivado) ou exclusao documentada", () => {
  it("REAL-REPO: 0 citacoes de helper em secoes de evidencia (o ABS PIN da superficie; o probe 2026-08-13 mediu 0 - as 5 citacoes de helper vivem em secoes de DECISAO, evidencia=nao) e 0 violacoes (as exclusoes estao citadas em 11.81/11.94)", () => {
    const docText = fs.readFileSync(path.join(process.cwd(), "docs", "gates-proofs.md"), "utf8")
    const cited = deriveHelperEvidenceCited(docText)
    expect(cited).toEqual([])
    expect(helperEvidenceViolations({ docText })).toEqual([])
  }, 60000)

  it("MUTATION (o registry derivado e o home): um helper do PROOF_HELPERS (ci-proof-run) citado em evidencia sintetica resolve SEM exclusao - a entrada derivada do package.json basta (o manifest e o home, nao uma lista)", () => {
    const docText = fs.readFileSync(path.join(process.cwd(), "docs", "gates-proofs.md"), "utf8")
    const mutated = docText + "\n## 11.999 placeholder (2026-08-13)\n**prova viva (2026-08-13)**: o `scripts/ci-proof-run.mjs` rodou e o guard pegou.\n"
    expect(mutated).not.toBe(docText)
    expect(helperEvidenceViolations({ docText: mutated })).toEqual([])
  }, 60000)

  it("MUTATION (a exclusao e load-bearing): um helper suite-pinned (guard-remeasure) citado em evidencia sintetica resolve COM a exclusao e flagra SEM ela (remover a exclusao -> a citacao correspondente viola)", () => {
    const docText = fs.readFileSync(path.join(process.cwd(), "docs", "gates-proofs.md"), "utf8")
    const mutated = docText + "\n## 11.999 placeholder (2026-08-13)\n**prova viva (2026-08-13)**: o `scripts/guard-remeasure.mjs` rodou e o guard pegou.\n"
    expect(mutated).not.toBe(docText)
    expect(helperEvidenceViolations({ docText: mutated })).toEqual([])
    const { ["scripts/guard-remeasure.mjs"]: _dropped, ...exclusions } = HELPER_EVIDENCE_EXCLUSIONS
    const viol = helperEvidenceViolations({ docText: mutated, exclusions })
    expect(viol).toHaveLength(1)
    expect(viol[0][0]).toBe("scripts/guard-remeasure.mjs")
    expect(viol[0][1]).toEqual(["entrada no PROOF_HELPERS (o manifest derivado) nem exclusao documentada"])
  }, 60000)

  it("MUTATION (a exclusao orfa, a direcao B da 11.90 aplicada): uma exclusao cujo modulo NAO e citado em nenhuma secao 11.x -> flagra 'exclusao orfa' (a lista nao pode acumular lixo em silencio)", () => {
    const docText = fs.readFileSync(path.join(process.cwd(), "docs", "gates-proofs.md"), "utf8")
    const exclusions = { ...HELPER_EVIDENCE_EXCLUSIONS, "scripts/fake-orphan.mjs": "lixo de teste" }
    const viol = helperEvidenceViolations({ docText, exclusions })
    expect(viol).toHaveLength(1)
    expect(viol[0][0]).toBe("scripts/fake-orphan.mjs")
    expect(viol[0][1]).toEqual(["exclusao orfa (o modulo nao e citado em nenhuma secao 11.x)"])
  }, 60000)
})
