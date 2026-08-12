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
 * `--ci` dos workflows do net; 20 wired hoje, medido 2026-08-12) e pina as
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
 *      sem o `.sh`; medido 2026-08-12: os 20 wired tem nota por stem).
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
 * A INVERSAO da 11.79 aplicada ao mapa (sec 11.92): as CHAVES sao DERIVADAS
 * do fs (os guards wired cuja suite convencional `<stem>.test.ts` NAO existe
 * em scripts/__tests__ - a convencao quebrada, medida via derivedMapKeys,
 * nunca uma lista). Os VALORES seguem um pin SEMANTICO explicito: o fs prova
 * QUEM quebra a convencao, mas nao ONDE o contrato mora (o content-scan e
 * ambiguo - run-mapped-fuzz e referenciado por 9 suites, scan-lucide-icons
 * por 3, medido 2026-08-12):
 *   - run-mapped-fuzz.mjs -> fuzz-mapped.test.ts (sec 11.11);
 *   - scan-lucide-icons.mjs -> scan-batch-coverage.test.ts (sec 11.16).
 *   - scan-proof-helpers.mjs -> proof-helpers-contract.test.ts (sec 11.93,
 *     a 3a excecao, 2026-08-12): o 9o guard do batch roda o contrato 11.72
 *     no pre-commit, e a suite onde o contrato mora e a proof-helpers-
 *     contract.test.ts (a suite da sec 11.72 que importa a fonte unica do
 *     guard) - NAO um scan-proof-helpers.test.ts convencional.
 *   - scan-unit-config.mjs -> unit-surface-contract.test.ts (sec 11.96, a
 *     4a excecao, 2026-08-12): o 10o guard do batch roda o contrato da
 *     nota do config (sec 11.80/11.95), e a suite onde o contrato mora e a
 *     unit-surface-contract.test.ts (a suite da sec 11.80/11.95 que
 *     importa a fonte unica dos extratores do guard) - NAO um
 *     scan-unit-config.test.ts convencional.
 * Um 5o guard wired com suite fora da convencao ENTRA em derivedMapKeys
 * automaticamente e a direcao D do mapContractViolations flagra a falta de
 * entrada (a lista nao existe para esquecer de editar - o padrao 11.79).
 */
const GUARD_SUITE_VALUES: Record<string, string> = {
  "run-mapped-fuzz.mjs": "fuzz-mapped.test.ts",
  "scan-lucide-icons.mjs": "scan-batch-coverage.test.ts",
  "scan-proof-helpers.mjs": "proof-helpers-contract.test.ts",
  "scan-unit-config.mjs": "unit-surface-contract.test.ts",
}

/**
 * As CHAVES do mapa DERIVADAS do fs (sec 11.92): os guards wired cuja suite
 * convencional `<stem>.test.ts` NAO existe em scripts/__tests__. Mede contra
 * o fs REAL sempre (a derivacao e um fato do repo, nao uma injecao - o
 * suiteDir dos MUTATIONs testa a EXISTENCIA das suites, nao a derivacao).
 */
function derivedMapKeys(wired: string[]): string[] {
  return wired.filter((g) => !fs.existsSync(path.join(TESTS, `${guardStem(g)}.test.ts`))).sort()
}

/** A suite do guard: os valores do mapa ou a derivacao `<stem>.test.ts`. */
function suiteOf(g: string): string {
  return GUARD_SUITE_VALUES[g] ?? `${guardStem(g)}.test.ts`
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
 * O guard de forma do mapa das excecoes da convencao `<stem>.test.ts`
 * (sec 11.90 + a INVERSAO das chaves da sec 11.92). As direcoes da 11.90
 * fecham o mapa nos dois sentidos - a suite mapeada DEVE existir E o mapa
 * NAO pode ter entrada orfa. Para CADA entrada do mapa:
 *   A. entrada -> suite: (1) o guard do mapa precisa estar wired HOJE (uma
 *      entrada de guard destituido dos hooks e orfa - o mapa so existe para
 *      guards wired, sec 11.78) E (2) a suite mapeada precisa EXISTIR em
 *      scripts/__tests__ (uma suite renomeada/removida deixa o mapa
 *      apontando pro vazio - o crescimento do mapa so vale para suites
 *      reais);
 *   B. suite -> entrada: a suite mapeada precisa ser a suite resolvida de
 *      pelo menos UM guard wired (uma suite que nenhum guard wired resolve e
 *      orfa - o mapa nao pode apontar para suite de ninguem).
 * As direcoes da sec 11.92 (a inversao da 11.79 nas CHAVES): o fs e a fonte
 * da lista de excecoes, nao um pin hardcoded. Para CADA guard wired:
 *   C. chave derivada -> entrada: todo guard wired cuja suite convencional
 *      `<stem>.test.ts` NAO existe em scripts/__tests__ (derivedMapKeys)
 *      DEVE ter entrada no mapa (a convencao quebrada medida no fs precisa
 *      da suite onde o contrato mora - um 3o exception que nascer nos hooks
 *      sem entrada falha);
 *   D. entrada -> chave derivada: toda entrada cujo guard TEM a suite
 *      convencional existente e DESNECESSARIA (se `<stem>.test.ts` existe,
 *      o fallback resolve - a excecao morreu e a entrada e orfa por excesso,
 *      o espelho do ABANDONO da excecao).
 * Retorna [guard, partes faltantes] por violacao. Com injecao de values (o
 * MUTATION da direcao B passa um mapa mutado), wired (o MUTATION filtra um
 * guard) e suiteDir (o MUTATION do dir vazio - a existencia das suites
 * mapeadas; as chaves derivadas SEMPRE medem o fs real).
 */
function mapContractViolations(opts: {
  values?: Record<string, string>
  wired: string[]
  suiteDir?: string
}): Array<[string, string[]]> {
  const values = opts.values ?? GUARD_SUITE_VALUES
  const wiredSet = new Set(opts.wired)
  const suitesDir = opts.suiteDir ?? TESTS
  // As suites que os guards wired RESOLVEM hoje (mapa + fallback) - o
  // conjunto-fato da direcao B: a suite mapeada precisa pertencer a ele.
  const resolvedSuites = new Set(opts.wired.map((g) => suiteOf(g)))
  const viol: Array<[string, string[]]> = []
  for (const [guard, suite] of Object.entries(values)) {
    const missing: string[] = []
    if (!wiredSet.has(guard)) missing.push("guard nao wired (entrada orfa)")
    if (!fs.existsSync(path.join(suitesDir, suite))) missing.push("suite mapeada inexistente")
    if (!resolvedSuites.has(suite)) missing.push("suite orfa (nenhum guard wired resolve)")
    if (missing.length) viol.push([guard, missing])
  }
  // Sec 11.92: a convencao quebrada medida no fs (derivedMapKeys) precisa
  // de entrada (C) e a entrada com a suite convencional existente e
  // desnecessaria (D) - a lista de excecoes e derivada, nao editada.
  const derived = derivedMapKeys(opts.wired)
  for (const g of derived) {
    if (!(g in values)) viol.push([g, ["convencao quebrada sem entrada no mapa"]])
  }
  for (const [guard] of Object.entries(values)) {
    if (fs.existsSync(path.join(TESTS, `${guardStem(guard)}.test.ts`))) {
      viol.push([guard, ["entrada desnecessaria (a suite convencional existe)"]])
    }
  }
  return viol
}

describe("wired-guards-contract - as 3 partes em TODO guard wired (sec 11.78)", () => {
  it("REAL-REPO: os 20 guards wired derivados dos hooks reais tem as 3 partes - entrada no manifest, suite no test:guard/test:unit e nota na sec 11.x", () => {
    const wired = deriveWiredGuards()
    expect(new Set(wired).size).toBe(20)
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

  it("MUTATION (partes 1+2+3): um guard fake num hook sintetico -> todas as 3 partes faltam (o crescimento inverso: um guard wired novo sem as 3 partes falha; o stem fake-guard-abc e GARANTIDAMENTE ausente do doc real - a parte 3 exige que a nota nao exista, e o stem usado no MUTATION nao pode colidir com a prosa da sec 11.92)", () => {
    const dir = createTempDir("wgc-fake-")
    fs.mkdirSync(path.join(dir, ".husky"), { recursive: true })
    fs.writeFileSync(path.join(dir, ".husky", "pre-commit"), "node scripts/fake-guard-abc.mjs\n")
    const wired = deriveWiredGuards(dir)
    expect(wired).toEqual(["fake-guard-abc.mjs"])
    const docText = fs.readFileSync(DOC, "utf8")
    expect(docText.includes("fake-guard-abc")).toBe(false)
    const viol = contractViolations({ wired, docText })
    expect(viol).toHaveLength(1)
    expect(viol[0][0]).toBe("fake-guard-abc.mjs")
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

describe("o mapa das excecoes da convencao fechado - suite existe + sem entrada orfa (sec 11.90) e as CHAVES derivadas do fs (sec 11.92)", () => {
  it("REAL-REPO: as 2 excecoes do mapa - a suite mapeada EXISTE e pertence a um guard wired (nenhuma violacao nos dois sentidos)", () => {
    const wired = deriveWiredGuards()
    expect(mapContractViolations({ wired })).toEqual([])
  }, 60000)

  it("o ABS PIN da INVERSAO (sec 11.92): as chaves do mapa == as chaves DERIVADAS do fs (derivedMapKeys = os 4 guards wired sem suite convencional, incl. o scan-unit-config da sec 11.96) - a lista de excecoes nasce do fs real, nao de uma copia editada a mao", () => {
    const derived = derivedMapKeys(deriveWiredGuards())
    expect(derived).toEqual([
      "run-mapped-fuzz.mjs",
      "scan-lucide-icons.mjs",
      "scan-proof-helpers.mjs",
      "scan-unit-config.mjs",
    ])
    expect(Object.keys(GUARD_SUITE_VALUES).sort()).toEqual(derived)
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

  it("MUTATION (direcao A, suite inexistente): um suite dir vazio -> toda suite mapeada flagra 'suite mapeada inexistente' (o mapa nunca aponta pro vazio; as chaves derivadas medem o fs REAL, nao o dir injetado)", () => {
    const dir = createTempDir("wgc-map-")
    const wired = deriveWiredGuards()
    const viol = mapContractViolations({ wired, suiteDir: dir })
    expect(viol.length).toBe(Object.keys(GUARD_SUITE_VALUES).length)
    for (const [, missing] of viol) expect(missing).toContain("suite mapeada inexistente")
  }, 60000)

  it("MUTATION (direcao B, suite orfa isolada): um mapa mutado apontando para uma suite REAL de outro guard -> 'suite orfa' SEM 'suite mapeada inexistente' nem 'guard nao wired' (a suite que nenhum guard wired resolve e flagrada isolada)", () => {
    // O mapa mutado troca a suite do run-mapped-fuzz por fragile-range-guard.test.ts
    // (uma suite REAL que EXISTE no fs mas nenhum guard wired resolve - o
    // run-mapped-fuzz segue wired e a suite existe, entao so a direcao B
    // flagra).
    const mutated = { ...GUARD_SUITE_VALUES, "run-mapped-fuzz.mjs": "fragile-range-guard.test.ts" }
    const wired = deriveWiredGuards()
    expect(fs.existsSync(path.join(TESTS, "fragile-range-guard.test.ts"))).toBe(true)
    const viol = mapContractViolations({ values: mutated, wired })
    expect(viol).toHaveLength(1)
    expect(viol[0][0]).toBe("run-mapped-fuzz.mjs")
    expect(viol[0][1]).toEqual(["suite orfa (nenhum guard wired resolve)"])
  }, 60000)

  it("MUTATION (direcao C, sec 11.92): um 3o guard wired com suite FORA da convencao (sem suite convencional no fs) e SEM entrada no mapa -> flagra 'convencao quebrada sem entrada no mapa' (a lista de excecoes e DERIVADA do fs - o guard novo nasce na derivada sozinho)", () => {
    // fake-guard.mjs e seguro AQUI (ao contrario do fake-guard-abc da parte
    // 3): o mapContractViolations NAO checa a nota por stem - so as
    // direcoes do mapa - entao a mencao do stem na prosa da sec 11.92 nao
    // interfere (o mesmo stem no contractViolations flagraria a parte 3
    // como satisfeita - o caso que exigiu o fake-guard-abc).
    const wired = [...deriveWiredGuards(), "fake-guard.mjs"]
    expect(fs.existsSync(path.join(TESTS, "fake-guard.test.ts"))).toBe(false)
    const viol = mapContractViolations({ wired })
    expect(viol).toHaveLength(1)
    expect(viol[0][0]).toBe("fake-guard.mjs")
    expect(viol[0][1]).toEqual(["convencao quebrada sem entrada no mapa"])
  }, 60000)

  it("MUTATION (direcao D, sec 11.92): uma entrada cujo guard TEM a suite convencional existente no fs -> flagra 'entrada desnecessaria (a suite convencional existe)' (o espelho do ABANDONO da excecao - se <stem>.test.ts nasceu, o fallback resolve e a entrada morreu)", () => {
    const wired = deriveWiredGuards()
    const withDead = { ...GUARD_SUITE_VALUES, "scan-batch-coverage.mjs": "scan-batch-coverage.test.ts" }
    expect(fs.existsSync(path.join(TESTS, "scan-batch-coverage.test.ts"))).toBe(true)
    const viol = mapContractViolations({ values: withDead, wired })
    expect(viol).toHaveLength(1)
    expect(viol[0][0]).toBe("scan-batch-coverage.mjs")
    expect(viol[0][1]).toEqual(["entrada desnecessaria (a suite convencional existe)"])
  }, 60000)
})
