/**
 * wired-guards-contract.test.ts - o espelho da 11.72 para a classe de GUARDS
 * wired (sec 11.78).
 *
 * WHY: a sec 11.72 pina as 3 partes do contrato de fail-loud nos helpers de
 * prova (hook-proof-run + ci-proof-run), mas os node guards wired nos hooks
 * (.husky/pre-commit, .husky/pre-push) e no registry PROOF_CLASSES nao tem
 * contrato de forma analogo - a parte 1 (entrada no manifest) vive no
 * checkWiredSurface da sec 11.60, mas as partes 2 (suite no test:guard ou
 * test:unit) e 3 (nota na sec 11.x) vivem so em prosa.
 *
 * O guard deriva os guards wired da superficie REAL (deriveWiredGuards - os
 * spawns `node|bash scripts/` dos hooks + imports do batch runner + steps
 * `--ci` dos workflows do net; 18 wired hoje, medido 2026-08-12) e pina as
 * 3 partes para CADA um:
 *   1. ENTRADA no proofs-manifest: o basename esta no PROOF_CLASSES (module)
 *      ou no WIRED_ALLOWLIST (a parte 1 da sec 11.60 reafirmada por guard);
 *   2. SUITE: o `<stem>.test.ts` existe em scripts/__tests__ E e coberto
 *      pelo include do test:unit (o glob `scripts/**` do
 *      vitest.config.unit.ts) OU esta na lista explicita do test:guard do
 *      package.json - a divisao de trabalho test:guard (push net) vs
 *      test:unit (suites de contrato) da sec 8.1;
 *   3. NOTA na sec 11.x: o stem (basename sem extensao) aparece no corpo de
 *      pelo menos uma secao `## 11.N` do doc real (a fonte da nota e o
 *      stem, nao o basename completo - a doc cita `check-docs-encoding`
 *      sem o `.sh`; medido 2026-08-12: os 18 wired tem nota por stem).
 *
 * O lado inverso do crescimento (o padrao do WIRED SURFACE da sec 11.60):
 * um guard wired NOVO nos hooks sem as 3 partes falha - os MUTATIONs provam
 * a classe (guard fake num hook sintetico; stem removido do doc; suite dir
 * vazio).
 *
 * Nao e subprocess-heavy (fs + regex puros) - timeouts explicitos por
 * convencao da suite.
 */
import { describe, expect, it } from "vitest"
import fs from "node:fs"
import path from "node:path"
import { deriveWiredGuards, PROOF_CLASSES, WIRED_ALLOWLIST } from "../proofs-manifest.mjs"
import { cleanupTempDirs, createTempDir } from "./golden-copy-utils"

const ROOT = process.cwd()
const TESTS = path.join(ROOT, "scripts", "__tests__")
const DOC = path.join(ROOT, "docs", "gates-proofs.md")
const PKG = path.join(ROOT, "package.json")
const VITEST_UNIT = path.join(ROOT, "vitest.config.unit.ts")

afterEach(() => {
  cleanupTempDirs()
})

/** O stem do guard: basename sem extensao (.mjs/.sh) - a forma da nota. */
function guardStem(g: string): string {
  return g.replace(/\.(mjs|sh)$/, "")
}

/**
 * GUARD_SUITE_MAP - as excecoes da convencao `<stem>.test.ts` (medidas
 * 2026-08-12 pela 1a rodada do contrato, que FLAGROU os 2 guards fora da
 * convencao):
 *   - run-mapped-fuzz.mjs: o contrato do runner do fuzz mapeado vive em
 *     fuzz-mapped.test.ts (sec 11.11) - o nome da suite NAO deriva do stem;
 *   - scan-lucide-icons.mjs: guard de geracao (HOOK_ALLOWLIST, sec 11.16),
 *     sem suite propria - o pin do contrato vive no scan-batch-coverage.test.ts
 *     (o teste do ALLOWLIST do batch).
 * Os demais 16 guards seguem a derivacao `<stem>.test.ts` (o fallback).
 * Adicionar um guard wired com suite fora da convencao exige entrar AQUI
 * (o mapa e o pin - o mesmo padrao do PROOF_HELPERS da sec 11.72).
 */
const GUARD_SUITE_MAP: Record<string, string> = {
  "run-mapped-fuzz.mjs": "fuzz-mapped.test.ts",
  "scan-lucide-icons.mjs": "scan-batch-coverage.test.ts",
}

/** A suite do guard: o mapa de excecoes ou a derivacao `<stem>.test.ts`. */
function suiteOf(g: string): string {
  return GUARD_SUITE_MAP[g] ?? `${guardStem(g)}.test.ts`
}

/** Os basenames registrados: modules do PROOF_CLASSES + WIRED_ALLOWLIST. */
function registeredBasenames(): Set<string> {
  return new Set([...PROOF_CLASSES.map((c) => path.basename(c.module)), ...WIRED_ALLOWLIST])
}

/** As suites da lista explicita do test:guard no package.json (basenames). */
function testGuardSuites(): Set<string> {
  const pkg = JSON.parse(fs.readFileSync(PKG, "utf8"))
  const cmd: string = pkg.scripts["test:guard"]
  const suites = new Set<string>()
  for (const m of cmd.matchAll(/scripts\/__tests__\/([\w.-]+\.test\.ts)/g)) suites.add(m[1])
  return suites
}

/**
 * O glob include do test:unit derivado do vitest.config.unit.ts (o fato
 * consumido). Extrai as strings entre aspas do array include - NAO faz
 * split por virgula (a virgula DENTRO do brace `{ts,tsx}` quebraria o glob
 * em 4 pedacos que nao casam nada; o bug foi pego pelo reviewer e derrubou
 * a cobertura do check-docs-encoding na 2a validacao).
 */
function unitIncludeGlobs(): string[] {
  const cfg = fs.readFileSync(VITEST_UNIT, "utf8")
  const m = cfg.match(/include:\s*\[([\s\S]*?)\]/)
  expect(m, "vitest.config.unit.ts deve ter o include (o glob do test:unit)").toBeTruthy()
  return [...m![1].matchAll(/"([^"]+)"/g)].map((x) => x[1])
}

/**
 * glob -> regex (o padrao dos contratos: o glob real vira o matcher). A
 * ORDEM importa: o escape generico roda PRIMEIRO sobre o glob cru e NAO
 * escapa `{`/`}` nem `*` - a expansao do brace roda depois e casa o
 * `{a,b}` cru (escapar os braces deixaria um backslash lider e a
 * alternacao nasceria literal - o bug do glob morto que derrubou a parte
 * 2 nos 12 guards fora do test:guard na 1a validacao, pego pelo
 * reviewer); o `**`/`*` vira `.*`/`[^/]*` por ultimo.
 */
function globToRegExp(glob: string): RegExp {
  const esc = glob
    .replace(/[.+^$()|[\]\\]/g, "\\$&")
    .replace(/\{([^}]+)\}/g, (_, inner: string) => `(?:${inner.split(",").join("|")})`)
    .replace(/\*\*/g, "\u0000")
    .replace(/\*/g, "[^/]*")
    .replace(/\u0000/g, ".*")
  return new RegExp(`^${esc}$`)
}

/**
 * O corpo das secoes 11.x do doc, na ordem do doc. Fecha o corpo corrente em
 * QUALQUER header numerado de topo (`## N` - inclusive `## 12.` e `## 8.x`,
 * nao so o proximo `## 11.N`): a secao 11.x nao pode absorver o que vem
 * depois do ultimo header 11.x (um guard citado so em `## 12.` nao teria
 * nota 11.x - o reviewer flagrou a forma anterior). `### 11.x.y` NAO fecha
 * (e subsecao da corrente, `^## ` nao casa `###`).
 */
function section11Bodies(docText: string): string[] {
  const out: string[] = []
  const lines = docText.split(/\r?\n/)
  let cur: string[] | null = null
  for (const line of lines) {
    if (/^## \d/.test(line)) {
      if (cur) out.push(cur.join("\n"))
      cur = /^## 11\.\d+/.test(line) ? [] : null
    } else if (cur) {
      cur.push(line)
    }
  }
  if (cur) out.push(cur.join("\n"))
  return out
}

/** Parte 3: o stem aparece no corpo de alguma secao 11.x? */
function nota11x(stem: string, docText: string): boolean {
  const re = new RegExp(`\\b${stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`)
  return section11Bodies(docText).some((body) => re.test(body))
}

/**
 * As violacoes das 3 partes por guard wired: retorna [guard, partes
 * faltantes] para cada guard que nao tem as 3. Com injecao de docText (a
 * parte 3 e testada contra o texto passado - o MUTATION do doc usa uma copia
 * mutada) e suiteDir (a parte 2 - o MUTATION do suite dir vazio).
 */
function contractViolations(opts: { wired: string[]; docText: string; suiteDir?: string }): Array<[string, string[]]> {
  const registered = registeredBasenames()
  const guardSuites = testGuardSuites()
  const globs = unitIncludeGlobs()
  const suitesDir = opts.suiteDir ?? TESTS
  const viol: Array<[string, string[]]> = []
  for (const g of opts.wired) {
    const missing: string[] = []
    if (!registered.has(g)) missing.push("entrada no proofs-manifest")
    const stem = guardStem(g)
    const suite = suiteOf(g)
    const suitePath = path.join(suitesDir, suite)
    const covered =
      fs.existsSync(suitePath) && (globs.some((gl) => globToRegExp(gl).test(`scripts/__tests__/${suite}`)) || guardSuites.has(suite))
    if (!covered) missing.push("suite no test:guard/test:unit")
    if (!nota11x(stem, opts.docText)) missing.push("nota na sec 11.x")
    if (missing.length) viol.push([g, missing])
  }
  return viol
}

/**
 * O guard de forma do GUARD_SUITE_MAP (sec 11.90): o mapa das excecoes da
 * convencao `<stem>.test.ts` fechado nos DOIS sentidos - a suite mapeada DEVE
 * existir E o mapa NAO pode ter entrada orfa. Para CADA entrada do mapa:
 *   A. entrada -> suite: (1) o guard do mapa precisa estar wired HOJE (uma
 *      entrada de guard destituido dos hooks e orfa - o mapa so existe para
 *      guards wired, sec 11.78) E (2) a suite mapeada precisa EXISTIR em
 *      scripts/__tests__ (uma suite renomeada/removida deixa o mapa
 *      apontando pro vazio - o crescimento do mapa so vale para suites
 *      reais);
 *   B. suite -> entrada: a suite mapeada precisa ser a suite resolvida de
 *      pelo menos UM guard wired (uma suite que nenhum guard wired resolve e
 *      orfa - o mapa nao pode apontar para suite de ninguem).
 * Retorna [guard, partes faltantes] por entrada violada. Com injecao de
 * map (o MUTATION da direcao B passa um mapa mutado), wired (o MUTATION
 * filtra um guard) e suiteDir (o MUTATION do dir vazio).
 */
function mapContractViolations(opts: {
  map?: Record<string, string>
  wired: string[]
  suiteDir?: string
}): Array<[string, string[]]> {
  const map = opts.map ?? GUARD_SUITE_MAP
  const wiredSet = new Set(opts.wired)
  const suitesDir = opts.suiteDir ?? TESTS
  // As suites que os guards wired RESOLVEM hoje (mapa + fallback) - o
  // conjunto-fato da direcao B: a suite mapeada precisa pertencer a ele.
  const resolvedSuites = new Set(opts.wired.map((g) => suiteOf(g)))
  const viol: Array<[string, string[]]> = []
  for (const [guard, suite] of Object.entries(map)) {
    const missing: string[] = []
    if (!wiredSet.has(guard)) missing.push("guard nao wired (entrada orfa)")
    if (!fs.existsSync(path.join(suitesDir, suite))) missing.push("suite mapeada inexistente")
    if (!resolvedSuites.has(suite)) missing.push("suite orfa (nenhum guard wired resolve)")
    if (missing.length) viol.push([guard, missing])
  }
  return viol
}

describe("wired-guards-contract - as 3 partes em TODO guard wired (sec 11.78)", () => {
  it("REAL-REPO: os 18 guards wired derivados dos hooks reais tem as 3 partes - entrada no manifest, suite no test:guard/test:unit e nota na sec 11.x", () => {
    const wired = deriveWiredGuards()
    expect(new Set(wired).size).toBe(18)
    const docText = fs.readFileSync(DOC, "utf8")
    expect(contractViolations({ wired, docText })).toEqual([])
  }, 60000)

  it("a divisao de trabalho test:guard vs test:unit: as suites dos 8 guards de push-net/runner estao na lista explicita do test:guard; o resto e coberto pelo glob do test:unit (o snapshot da divisao - editar exige edicao consciente)", () => {
    const wired = deriveWiredGuards()
    const guardSuites = testGuardSuites()
    const inGuard = wired.filter((g) => guardSuites.has(suiteOf(g))).sort()
    expect(inGuard).toEqual([
      "run-mapped-fuzz.mjs",
      "scan-batch-coverage.mjs",
      "scan-fuzz-precommit.mjs",
      "scan-guard-gates.mjs",
      "scan-lint-staged-loader.mjs",
      "scan-lucide-icons.mjs",
      "scan-prepush-batch.mjs",
      "scan-push-full-suite.mjs",
    ])
    const globs = unitIncludeGlobs()
    for (const g of wired) {
      const suite = suiteOf(g)
      expect(fs.existsSync(path.join(TESTS, suite)), `${g}: a suite ${suite} deve existir em scripts/__tests__`).toBe(true)
      expect(
        globs.some((gl) => globToRegExp(gl).test(`scripts/__tests__/${suite}`)) || guardSuites.has(suite),
        `${g}: a suite ${suite} deve ser coberta pelo test:unit (glob do vitest.config.unit.ts) ou pelo test:guard`,
      ).toBe(true)
    }
  }, 60000)

  it("MUTATION (partes 1+2+3): um guard fake num hook sintetico -> todas as 3 partes faltam (o crescimento inverso: um guard wired novo sem as 3 partes falha)", () => {
    const dir = createTempDir("wgc-fake-")
    fs.mkdirSync(path.join(dir, ".husky"), { recursive: true })
    fs.writeFileSync(path.join(dir, ".husky", "pre-commit"), "node scripts/fake-guard.mjs\n")
    const wired = deriveWiredGuards(dir)
    expect(wired).toEqual(["fake-guard.mjs"])
    const docText = fs.readFileSync(DOC, "utf8")
    const viol = contractViolations({ wired, docText })
    expect(viol).toHaveLength(1)
    expect(viol[0][0]).toBe("fake-guard.mjs")
    expect(viol[0][1].sort()).toEqual(["entrada no proofs-manifest", "nota na sec 11.x", "suite no test:guard/test:unit"])
  }, 60000)

  it("MUTATION (parte 3): remover o stem de um guard de TODAS as secoes 11.x do doc -> a nota flagra (a nota nunca pode sumir sem edicao consciente)", () => {
    const docText = fs.readFileSync(DOC, "utf8")
    const mutated = docText.replaceAll("scan-timeouts", "scan-timouts")
    expect(mutated).not.toBe(docText)
    const wired = deriveWiredGuards()
    const viol = contractViolations({ wired, docText: mutated })
    // exatamente o guard cujo stem sumiu e flagrado (a mutacao e localizada)
    expect(viol.some(([g]) => g === "scan-timeouts.mjs")).toBe(true)
    for (const [g] of viol) expect(g).toBe("scan-timeouts.mjs")
  }, 60000)

  it("MUTATION (parte 2): um suite dir vazio -> todos os guards flagram a suite (a parte 2 e derivada do fs real, nunca assumida em prosa)", () => {
    const dir = createTempDir("wgc-empty-")
    const wired = deriveWiredGuards()
    const docText = fs.readFileSync(DOC, "utf8")
    const viol = contractViolations({ wired, docText, suiteDir: dir })
    expect(viol.length).toBe(wired.length)
    for (const [, missing] of viol) expect(missing).toContain("suite no test:guard/test:unit")
  }, 60000)
})

describe("o GUARD_SUITE_MAP fechado nos dois sentidos - suite existe + sem entrada orfa (sec 11.90)", () => {
  it("REAL-REPO: as 2 excecoes do mapa - a suite mapeada EXISTE e pertence a um guard wired (nenhuma violacao nos dois sentidos)", () => {
    const wired = deriveWiredGuards()
    expect(mapContractViolations({ wired })).toEqual([])
  }, 60000)

  it("o ABS PIN do mapa: as 2 entradas exatas (run-mapped-fuzz + scan-lucide-icons) - editar a lista exige edicao consciente", () => {
    expect(Object.keys(GUARD_SUITE_MAP).sort()).toEqual(["run-mapped-fuzz.mjs", "scan-lucide-icons.mjs"])
  }, 60000)

  it("MUTATION (direcao A, guard destituido): um guard do mapa removido do wired -> a entrada vira orfa (guard nao wired) E a suite sai do conjunto resolvido (suite orfa)", () => {
    const wired = deriveWiredGuards()
    const withoutFuzz = wired.filter((g) => g !== "run-mapped-fuzz.mjs")
    expect(withoutFuzz.length).toBe(wired.length - 1)
    const viol = mapContractViolations({ wired: withoutFuzz })
    expect(viol).toHaveLength(1)
    expect(viol[0][0]).toBe("run-mapped-fuzz.mjs")
    expect(viol[0][1].sort()).toEqual(["guard nao wired (entrada orfa)", "suite orfa (nenhum guard wired resolve)"])
  }, 60000)

  it("MUTATION (direcao A, suite inexistente): um suite dir vazio -> toda suite mapeada flagra 'suite mapeada inexistente' (o mapa nunca aponta pro vazio)", () => {
    const dir = createTempDir("wgc-map-")
    const wired = deriveWiredGuards()
    const viol = mapContractViolations({ wired, suiteDir: dir })
    expect(viol.length).toBe(Object.keys(GUARD_SUITE_MAP).length)
    for (const [, missing] of viol) expect(missing).toContain("suite mapeada inexistente")
  }, 60000)

  it("MUTATION (direcao B, suite orfa isolada): um mapa mutado apontando para uma suite REAL de outro guard -> 'suite orfa' SEM 'suite mapeada inexistente' nem 'guard nao wired' (a suite que nenhum guard wired resolve e flagrada isolada)", () => {
    // O mapa mutado troca a suite do run-mapped-fuzz por fragile-range-guard.test.ts
    // (uma suite REAL que EXISTE no fs mas nenhum guard wired resolve - o
    // run-mapped-fuzz segue wired e a suite existe, entao so a direcao B
    // flagra).
    const mutated = { ...GUARD_SUITE_MAP, "run-mapped-fuzz.mjs": "fragile-range-guard.test.ts" }
    const wired = deriveWiredGuards()
    expect(fs.existsSync(path.join(TESTS, "fragile-range-guard.test.ts"))).toBe(true)
    const viol = mapContractViolations({ map: mutated, wired })
    expect(viol).toHaveLength(1)
    expect(viol[0][0]).toBe("run-mapped-fuzz.mjs")
    expect(viol[0][1]).toEqual(["suite orfa (nenhum guard wired resolve)"])
  }, 60000)
})
