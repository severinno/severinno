/**
 * proofs-manifest.test.ts - o CONTRATO do registry PROOF_CLASSES (2026-08-11,
 * sec 11.60 do gates-proofs.md).
 *
 * WHY THIS SUITE EXISTS: o pedido "avalie uma prova" re-propos 2x uma prova
 * JA registrada (Prova 39 = sec 8.34, e o caso do hook-proof-run = sec
 * 11.58). A classe: 're-derivar o que ja esta pinado'. O PROOF_CLASSES e o
 * consultavel - a suite torna o registry um CONTRATO:
 *
 *   - ABS PIN (content): o teste pina o CONTEUDO do manifest (a projecao
 *     [class, prova, section, run] das 62 provas, DERIVADA do manifest no
 *     assert - o padrao dos fatos consumidos, nao uma copia que driftara).
 *     Editar o registry (nova prova, run trocado, secao renumerada) exige
 *     editar o snapshot conscientemente - registrar e a decisao.
 *   - MANIFEST SHAPE: class/module/proofs presentes, run null ou string.
 *   - PIN REALITY (manifest-registry pattern): o module da classe existe.
 *   - RUN REALITY: todo run nao-nulo aparece no texto do doc REAL (o run
 *     nunca e inventado - a classe 'run de prova que nao existe').
 *   - DOC COVERAGE bidirecional: doc -> manifest (toda Prova detectada no
 *     doc tem entrada) E manifest -> doc (toda entrada tem secao detectada
 *     - entrada stale = drift).
 *   - CONSULTATION (o caso do pedido): a Prova 39 (o PAR CURE+stale) e o
 *     ciclo hook-proof-run JA estao no registry - o "avalie uma prova" do
 *     futuro CONSULTA antes de propor.
 *   - MUTATION: o detector/checker pegam a classe real (Prova 99 fake no
 *     doc sintetico -> unregistered; secao removida -> stale; class nova no
 *     manifest -> ABS PIN diverge).
 *   - REAL-REPO CONTRACT: o CLI real (node scripts/proofs-manifest.mjs
 *     --check) sai 0 no doc real.
 *
 * Subprocess-heavy (o CLI REAL-REPO CONTRACT + a MUTATION do ABS PIN
 * spawnam node via runSubprocess) -> timeout explicito nesses it (o
 * scan-timeouts guard exige).
 */
import { afterEach, describe, expect, it } from "vitest"
import fs from "node:fs"
import path from "node:path"
import { cleanupTempDirs, createTempDir, runSubprocess, writeModuleCopy, type ModulePatchOp } from "./golden-copy-utils"
import { PROOF_CLASSES, WIRED_ALLOWLIST, checkProofs, checkWiredSurface, deriveWiredGuards, scanProvaSections } from "../proofs-manifest.mjs"

const ROOT = process.cwd()
const DOC = path.join(ROOT, "docs", "gates-proofs.md")

/** A projecao do ABS PIN: [class, prova, section, run] em ordem do manifest. */
const PROJECTION: Array<[string, number, string, string]> = PROOF_CLASSES.flatMap((c) =>
  c.proofs.map((p) => [c.class, p.prova, p.section, p.run ?? "local"] as [string, number, string, string]),
)

/**
 * O snapshot do CONTEUDO pinado (sec 11.60): a projecao [class, prova,
 * section, run] das 62 provas, na ORDEM do manifest. A lista NAO e uma
 * copia separada no teste - e a projecao de PROOF_CLASSES; editar o
 * manifest exige editar ESTE snapshot conscientemente (o growth contract
 * aplicado ao conteudo, o mesmo padrao do ABS_PIN_SNAPSHOT da sec 11.50).
 */
const ABS_PIN_SNAPSHOT: Array<[string, number, string, string]> = [
  ["verify-encoding", 1, "2", "31298436074"],
  ["verify-encoding", 2, "3", "31306797327"],
  ["verify-encoding", 4, "5", "31312427503"],
  ["verify-encoding", 5, "6", "local"],
  ["verify-encoding", 6, "7", "31331423557"],
  ["check-js-budget", 3, "4", "local"],
  ["guard-gates-push-net", 7, "8", "31336318902"],
  ["guard-gates-push-net", 35, "8.30", "31526224328"],
  ["scan-surfaces-contract", 8, "8.2", "31342311844"],
  ["check-next-types", 9, "8.3", "local"],
  ["scan-push-full-suite", 10, "8.7", "31354308733"],
  ["run-mapped-fuzz", 11, "8.8", "local"],
  ["run-all-fuzz", 12, "8.9", "31397642499"],
  ["run-all-fuzz", 13, "8.10", "31411254090"],
  ["check-node-modules-integrity", 14, "8.11", "local"],
  ["scan-guard-gates", 15, "8.12", "local"],
  ["scan-guard-gates", 16, "8.13", "31430040398"],
  ["scan-guard-gates", 17, "8.14", "local"],
  ["scan-guard-gates", 19, "8.15", "31439238631"],
  ["scan-guard-gates", 21, "8.16", "31444762608"],
  ["scan-guard-gates", 22, "8.17", "31446588931"],
  ["scan-guard-gates", 24, "8.19", "31461526068"],
  ["scan-guard-gates", 28, "8.23", "31488081528"],
  ["scan-guard-gates", 36, "8.31", "31533234250"],
  ["scan-guard-gates", 45, "8.40", "local"],
  ["check-exit-claims-push", 37, "8.32", "local"],
  ["check-exit-claims-push", 38, "8.33", "local"],
  ["prepush-order", 18, "11.19", "local"],
  ["ci-proof-run", 20, "11.20", "31442006152"],
  ["ci-proof-run", 32, "8.27", "31511149307"],
  ["ci-proof-run", 48, "8.43", "local"],
  ["ci-proof-run", 52, "8.47", "local"],
  ["ci-proof-run", 53, "8.48", "local"],
  ["ci-proof-run", 54, "8.49", "local"],
  ["ci-proof-run", 55, "8.50", "local"],
  ["ci-proof-run", 57, "8.52", "local"],
  ["scan-prepush-batch", 23, "8.18", "local"],
  ["scan-eol-anchor", 25, "8.20", "31480438465"],
  ["scan-curl-timeouts", 26, "8.21", "31485163704"],
  ["scan-curl-timeouts", 27, "8.22", "31487497462"],
  ["scan-curl-timeouts", 29, "8.24", "31492035257"],
  ["scan-curl-timeouts", 30, "8.25", "31496492582"],
  ["scan-curl-timeouts", 31, "8.26", "31506284327"],
  ["scan-curl-timeouts", 34, "8.29", "31518328191"],
  ["scan-exit-claims", 33, "8.28", "31516054686"],
  ["scan-exit-claims", 39, "8.34", "local"],
  ["hook-proof-run", 40, "8.35", "local"],
  ["hook-proof-run", 41, "8.36", "local"],
  ["hook-proof-run", 43, "8.38", "local"],
  ["hook-proof-run", 44, "8.39", "local"],
  ["hook-proof-run", 46, "8.41", "local"],
  ["hook-proof-run", 47, "8.42", "local"],
  ["hook-proof-run", 50, "8.45", "local"],
  ["hook-proof-run", 51, "8.46", "31642157987"],
  ["doc-revalidate", 42, "8.37", "local"],
  ["scan-unit-config", 49, "8.44", "local"],
  ["scan-derived-inventory", 56, "8.51", "local"],
  ["wired-guards-contract", 58, "8.53", "local"],
  ["proof-helpers-contract", 59, "8.54", "local"],
  ["compose-valkey", 60, "8.55", "local"],
  ["middleware", 61, "8.56", "local"],
  ["db-pagination-contract", 62, "8.57", "local"],
]

/** Doc sintetico: apenas os headers passados (para MUTATIONs). */
function writeSyntheticDoc(dir: string, headers: Array<{ header: string; body: string[] }>) {
  const lines: string[] = []
  for (const s of headers) {
    lines.push(s.header)
    for (const b of s.body) lines.push(b)
  }
  const docPath = path.join(dir, "gates-proofs.md")
  fs.writeFileSync(docPath, lines.join("\n") + "\n")
  return docPath
}

afterEach(() => {
  cleanupTempDirs()
})

describe("scripts/proofs-manifest.mjs - ABS PIN e SHAPE (sec 11.60)", () => {
  it("ABS PIN (content): a projecao [class, prova, section, run] do PROOF_CLASSES pinada pelo snapshot - editar o registry exige editar o snapshot conscientemente", () => {
    expect(PROJECTION).toEqual(ABS_PIN_SNAPSHOT)
    // sanity: 26 classes / 62 provas registradas (o numero do CLI clean).
    expect(new Set(PROOF_CLASSES.map((c) => c.class)).size).toBe(26)
    expect(PROJECTION).toHaveLength(62)
  })

  it("MANIFEST SHAPE: class/module/proofs presentes, run null ou string, prova numerico, section presente", () => {
    for (const c of PROOF_CLASSES) {
      expect(c.class, c.class).toBeTruthy()
      expect(c.module, c.class).toBeTruthy()
      expect(c.proofs.length, c.class).toBeGreaterThan(0)
      for (const p of c.proofs) {
        expect(typeof p.prova, `${c.class} / ${p.prova}`).toBe("number")
        expect(p.section, `${c.class} / ${p.prova}`).toBeTruthy()
        expect(p.run === null || typeof p.run === "string", `${c.class} / ${p.prova}`).toBe(true)
        expect(p.what, `${c.class} / ${p.prova}`).toBeTruthy()
      }
    }
  })

  it("PIN REALITY: todo module da classe existe no disco (o padrao manifest-registry - o registry nunca aponta para o vazio)", () => {
    for (const c of PROOF_CLASSES) {
      expect(fs.existsSync(path.join(ROOT, c.module)), `${c.class}: module ${c.module} nao existe`).toBe(true)
    }
  })

  it("RUN REALITY: todo run nao-nulo aparece no texto do doc REAL (o run nunca e inventado)", () => {
    const docText = fs.readFileSync(DOC, "utf8")
    for (const c of PROOF_CLASSES) {
      for (const p of c.proofs) {
        if (p.run) expect(docText.includes(p.run), `${c.class} / Prova ${p.prova}: run ${p.run} ausente no doc`).toBe(true)
      }
    }
  })
})

describe("scripts/proofs-manifest.mjs - DOC COVERAGE bidirecional (sec 11.60)", () => {
  it("doc -> manifest: toda Prova detectada no doc REAL tem entrada no registry (nenhuma unregistered)", () => {
    const { unregistered } = checkProofs()
    expect(unregistered).toEqual([])
    // sanity: o detector acha as 62 provas reais (a Prova 20 via a linha da
    // tabela `(Prova 20, sec 11.20)` - a secao 11.20 nao tem 'Prova N' no titulo).
    expect(scanProvaSections(DOC).size).toBe(62)
  })

  it("manifest -> doc: toda entrada do registry tem secao detectada no doc REAL (entrada stale = drift)", () => {
    const { stale } = checkProofs()
    expect(stale).toEqual([])
  })

  it("checkProofs: doc real -> zero problemas, incluindo brokenPins e brokenRuns", () => {
    const { unregistered, stale, brokenPins, brokenRuns } = checkProofs()
    expect(unregistered).toEqual([])
    expect(stale).toEqual([])
    expect(brokenPins).toEqual([])
    expect(brokenRuns).toEqual([])
  })
})

describe("scripts/proofs-manifest.mjs - CONSULTATION (o caso do pedido, sec 11.60)", () => {
  it("a Prova 39 (o PAR CURE+stale que foi re-proposto 2x) JA esta no registry -> o 'avalie uma prova' consulta e encontra antes de propor", () => {
    const p39 = PROJECTION.find(([, prova]) => prova === 39)
    expect(p39).toEqual(["scan-exit-claims", 39, "8.34", "local"])
  })

  it("o ciclo hook-proof-run (as Provas 37/38 da classe CURE+stale) esta no registry pela classe check-exit-claims-push", () => {
    const pushClaims = PROOF_CLASSES.find((c) => c.class === "check-exit-claims-push")
    expect(pushClaims).toBeTruthy()
    expect(pushClaims!.proofs.map((p) => p.prova)).toEqual([37, 38])
  })

  it("toda classe de guard do repo tem pelo menos 1 prova viva registrada (nenhuma classe orfa no registry)", () => {
    const classes = PROOF_CLASSES.map((c) => c.class)
    expect(classes.length).toBe(26)
    // As classes centrais da rede de guards estao presentes (sanity das
    // principais - o ABS PIN cobre a lista completa).
    for (const key of ["scan-guard-gates", "scan-curl-timeouts", "verify-encoding", "scan-exit-claims", "check-exit-claims-push"]) {
      expect(classes).toContain(key)
    }
  })
})

describe("scripts/proofs-manifest.mjs - MUTATION (a classe real, sec 11.60)", () => {
  it("Prova 99 fake no doc sintetico -> unregistered (o growth contract: registrar e a decisao - a Prova 40 NAO serve de fake, e real desde a sec 8.35)", () => {
    const dir = createTempDir("proofs-60-")
    const docPath = writeSyntheticDoc(dir, [{ header: "## 8.99 Prova 99", body: ["linha"] }])
    const { unregistered } = checkProofs(docPath)
    expect(unregistered.some((u) => u.includes("Prova 99"))).toBe(true)
  })

  it("secao de uma entrada REMOVIDA do doc sintetico -> stale (a direcao manifest -> doc)", () => {
    const dir = createTempDir("proofs-60-")
    // Doc sem a secao 8.34 (a casa da Prova 39): o registry aponta para o vazio.
    const docPath = writeSyntheticDoc(dir, [{ header: "## 8.33 Prova 38", body: ["linha"] }])
    const { stale } = checkProofs(docPath)
    expect(stale.some((s) => s.includes("8.34"))).toBe(true)
  })

  it("detector: a linha da tabela REAL `(Prova 20, sec 11.20; ...` (com ';', nao fecha parenteses) registra a Prova 20 - a secao 11.20 nao tem 'Prova N' no titulo e o greedy para no ';'", () => {
    const dir = createTempDir("proofs-60-")
    // A FORMA REAL (reviewer nit): `(Prova 20, sec 11.20; o poll termina no
    // JOB...)` - o round-1 fix foi exatamente este greedy. Pinar a forma
    // real (nao a sintetica com ')' ) trava o fix contra regressao.
    const docPath = writeSyntheticDoc(dir, [
      { header: "## 11.20 ci-proof-run - custo real do ciclo", body: ["| 19 | ci-proof-run - **`--only-jobs` EARLY-EXIT live** (Prova 20, sec 11.20; o poll termina no JOB, nao no run) | Run [**31442006152**](https://github.com/severinno/severinno/actions/runs/31442006152) |"] },
    ])
    const sections = scanProvaSections(docPath)
    expect(sections.get("11.20")).toBe(20)
  })

  it("detector: o header e a autoridade - a tabela com secao DIVERGENTE nao sobreescreve o header (continue do cross-check, sec 11.60)", () => {
    const dir = createTempDir("proofs-60-")
    // Header diz Prova 8 na secao 8.2; a tabela cita (Prova 20, sec 8.2
    // num contexto de prosa - um cross-ref inofensivo. O header vence.
    const docPath = writeSyntheticDoc(dir, [
      { header: "## 8.2 Prova 8", body: ["linha", "... (Prova 20, sec 8.2; cross-ref em prosa) ..."] },
    ])
    const sections = scanProvaSections(docPath)
    expect(sections.get("8.2")).toBe(8)
  })

  it("ABS PIN MUTATION: um manifest PATCHADO com uma class nova diverge do ABS_PIN_SNAPSHOT (o pin le o PROOF_CLASSES vivo - nao e copia estatica)", () => {
    const dir = createTempDir("proofs-60-")
    // O scaffold compartilhado writeModuleCopy: le o modulo real, patcha na
    // ancora estrutural do fim do PROOF_CLASSES e escreve uma copia temp.
    // EOL-SAFE por gitattributes: `*.mjs text eol=lf` (o commit do
    // .gitattributes) garante checkout LF - a ancora `\n` do writeModuleCopy
    // nunca encontra CRLF aqui (o caso CRLF afeta doc/gate yml, nao .mjs).
    const ENTRY_FAKE =
      '  {\n    class: "fake-guard",\n    module: "scripts/fake-guard.mjs",\n    proofs: [{ prova: 99, section: "8.99", run: null, what: "fake" }],\n  },\n'
    const ops: ModulePatchOp[] = [
      {
        anchor: "  },\n]\n",
        replace: () => "  },\n" + ENTRY_FAKE + "]\n",
        onMissing: "ABS PIN MUTATION: fechamento do PROOF_CLASSES (entrada + colchete) nao encontrado no modulo real - atualize o harness",
      },
    ]
    const modPath = writeModuleCopy(dir, path.join(ROOT, "scripts", "proofs-manifest.mjs"), ops)
    const runnerPath = path.join(dir, "run-probe.mjs")
    fs.writeFileSync(
      runnerPath,
      [
        `import { PROOF_CLASSES } from "./proofs-manifest.mjs"`,
        `const proj = PROOF_CLASSES.flatMap((c) => c.proofs.map((p) => [c.class, p.prova, p.section, p.run ?? "local"]))`,
        `process.stdout.write(JSON.stringify(proj))`,
        "",
      ].join("\n"),
    )
    const r = runSubprocess({ command: process.execPath, args: [runnerPath] })
    expect(r.status).toBe(0)
    const triples = JSON.parse(r.stdout) as Array<[string, number, string, string]>
    expect(triples).toHaveLength(ABS_PIN_SNAPSHOT.length + 1)
    // As 41 reais continuam identicas ao snapshot (o patch so ACRESCENTA).
    expect(triples.slice(0, ABS_PIN_SNAPSHOT.length)).toEqual(ABS_PIN_SNAPSHOT)
    expect(triples).not.toEqual(ABS_PIN_SNAPSHOT)
    expect(modPath).toContain("proofs-manifest.mjs")
  }, 60000)
})

describe("scripts/proofs-manifest.mjs - WIRED SURFACE: o lado inverso do growth contract (sec 11.60)", () => {
  it("WIRED ALLOWLIST ABS PIN: as 9 excecoes deliberadas (wired sem Prova dedicada, contratos suite-pinned) - editar a lista exige editar o pin (o scan-unit-config GRADUOU para classe com a Prova 49, sec 8.44; o scan-derived-inventory GRADUOU com a Prova 56, sec 8.51 - o mesmo padrao)", () => {
    expect(WIRED_ALLOWLIST).toEqual([
      "check-docs-encoding.sh",
      "check-push-deletion.mjs",
      "scan-batch-coverage.mjs",
      "scan-evidence-sweep.mjs",
      "scan-fuzz-precommit.mjs",
      "scan-lint-staged-loader.mjs",
      "scan-lucide-icons.mjs",
      "scan-proof-helpers.mjs",
      "scan-timeouts.mjs",
    ])
  })

  it("deriveWiredGuards: a superficie viva do repo real deriva os 21 guards wired (hooks + batch imports + steps do net, incl. o scan-derived-inventory da sec 11.112) - sanity da derivacao", () => {
    const wired = deriveWiredGuards()
    expect(new Set(wired).size).toBe(22)
    // Os 12 registrados (classes do PROOF_CLASSES) estao na derivacao.
    for (const g of ["verify-encoding.sh", "check-next-types.mjs", "check-node-modules-integrity.mjs", "scan-push-full-suite.mjs", "scan-guard-gates.mjs", "scan-prepush-batch.mjs", "scan-exit-claims.mjs", "check-exit-claims-push.mjs", "run-mapped-fuzz.mjs", "scan-curl-timeouts.mjs", "scan-eol-anchor.mjs", "scan-unit-config.mjs"]) {
      expect(wired).toContain(g)
    }
    // As 8 allowlisted estao na derivacao (wired de verdade, so sem Prova).
    for (const g of WIRED_ALLOWLIST) {
      expect(wired).toContain(g)
    }
  })

  it("checkWiredSurface: o repo real -> missing = [] (todo guard wired tem classe no PROOF_CLASSES ou entrada no WIRED_ALLOWLIST)", () => {
    const { missing } = checkWiredSurface()
    expect(missing).toEqual([])
  })

  it("MUTATION: um guard wired novo num hook sintetico (node scripts/fake-guard.mjs) sem classe nem allowlist -> missing com o nome exato (o growth contract no lado inverso)", () => {
    const dir = createTempDir("proofs-wired-")
    fs.mkdirSync(path.join(dir, ".husky"), { recursive: true })
    fs.writeFileSync(path.join(dir, ".husky", "pre-commit"), "node scripts/fake-guard.mjs\n")
    const { missing } = checkWiredSurface(dir)
    expect(missing).toEqual(["fake-guard.mjs"])
  })

  it("MUTATION: um guard wired JA registrado no hook sintetico -> nao e missing (a derivacao casa o module do PROOF_CLASSES)", () => {
    const dir = createTempDir("proofs-wired-")
    fs.mkdirSync(path.join(dir, ".husky"), { recursive: true })
    fs.writeFileSync(path.join(dir, ".husky", "pre-commit"), "node scripts/scan-guard-gates.mjs\n")
    const { missing } = checkWiredSurface(dir)
    expect(missing).toEqual([])
  })
})

describe("scripts/proofs-manifest.mjs - a ASSIMETRIA registry -> wired: guard real deriva, helper nao (sec 11.91)", () => {
  // A fronteira documentada no header do manifest (sec 11.60): a direcao
  // registry -> wired NAO existe por desenho - classes helper (ci-proof-run,
  // hook-proof-run, doc-revalidate, run-all-fuzz) tem Prova mas NAO sao
  // guard de hook (check-js-budget e a excecao de COMPOSICAO: guard real
  // dentro do pre-commit-tests.mjs, fora da superficie derivada sem
  // recursao). Este guard pina a fronteira nos DOIS lados: toda classe cujo
  // module e guard de hook REAL (referencia NAO-comentada nas fontes wired)
  // ESTA na derivacao; os helpers NAO estao - e a lista da exclusao e
  // DERIVADA das fontes (o padrao TARGET_DIRS consumido) e pinada por
  // conteudo (editar a fronteira exige edicao consciente).

  /** As fontes wired (hooks + batch runner + net), so linhas nao-comentadas. */
  function wiredSourcesRealText(root = ROOT): string {
    const files = [
      ".husky/pre-commit",
      ".husky/pre-push",
      "scripts/run-precommit-guards.mjs",
      ".github/workflows/guard-gates.yml",
      ".github/workflows/pr-check.yml",
    ]
    return files
      .filter((f) => fs.existsSync(path.join(root, f)))
      .map((f) =>
        fs
          .readFileSync(path.join(root, f), "utf8")
          .split(/\r?\n/)
          .filter((l) => !/^\s*#/.test(l))
          .join("\n"),
      )
      .join("\n")
  }

  /** As classes excluidas da derivacao (script modules SEM referencia real). */
  function excludedHelperClasses(root = ROOT): string[] {
    const realText = wiredSourcesRealText(root)
    return PROOF_CLASSES.map((c) => path.basename(c.module))
      .filter((base) => /\.(mjs|sh)$/.test(base))
      .filter((base) => !realText.includes(base))
      .sort()
  }

  /**
   * As violacoes da assimetria: [module, lado] para cada classe cujo module
   * e script (.mjs/.sh) que quebra a fronteira - referenciada nas fontes
   * wired mas NAO derivada (o positivo) ou derivada SEM referencia (o
   * negativo). As classes estruturais (yml/hook/suite) ficam fora por shape.
   */
  function asymmetryViolations(root = ROOT): Array<[string, string]> {
    const wired = new Set(deriveWiredGuards(root))
    const realText = wiredSourcesRealText(root)
    const viol: Array<[string, string]> = []
    for (const c of PROOF_CLASSES) {
      const base = path.basename(c.module)
      if (!/\.(mjs|sh)$/.test(base)) continue
      const referenced = realText.includes(base)
      if (referenced && !wired.has(base)) viol.push([base, "referenciado nas fontes wired mas NAO derivado"])
      if (!referenced && wired.has(base)) viol.push([base, "derivado wired mas SEM referencia nas fontes"])
    }
    return viol
  }

  it("REAL-REPO: a assimetria vale - toda classe com referencia REAL nas fontes wired esta na derivacao (zero violacoes nos dois lados)", () => {
    expect(asymmetryViolations()).toEqual([])
  }, 60000)

  it("o ABS PIN da exclusao DERIVADA: as 5 classes helper/composicao fora da derivacao (as 4 helpers do header + o check-js-budget da composicao) - editar a fronteira exige edicao consciente", () => {
    expect(excludedHelperClasses()).toEqual([
      "check-js-budget.mjs",
      "ci-proof-run.mjs",
      "doc-revalidate.mjs",
      "hook-proof-run.mjs",
      "run-all-fuzz.mjs",
    ])
    const wired = new Set(deriveWiredGuards())
    for (const e of excludedHelperClasses()) expect(wired.has(e)).toBe(false)
  }, 60000)

  it("MUTATION (positivo): uma classe referenciada nas fontes wired num form que o regex da derivacao NAO pega (./scripts/ fora do WIRED_SPAWN_RE) -> flagra 'referenciado mas NAO derivado' (o guard pina o lado positivo da assimetria)", () => {
    const dir = createTempDir("proofs-asym-")
    fs.mkdirSync(path.join(dir, ".husky"), { recursive: true })
    fs.writeFileSync(path.join(dir, ".husky", "pre-commit"), "./scripts/scan-guard-gates.mjs\n")
    const viol = asymmetryViolations(dir)
    expect(viol).toHaveLength(1)
    expect(viol[0]).toEqual(["scan-guard-gates.mjs", "referenciado nas fontes wired mas NAO derivado"])
  }, 60000)

  it("MUTATION (negativo): um helper spawnado num hook sintetico (node scripts/ci-proof-run.mjs) -> a derivacao o pega E a classe some da exclusao (a fronteira so e rompida por edicao consciente do hook, nunca por shape)", () => {
    const dir = createTempDir("proofs-asym-")
    fs.mkdirSync(path.join(dir, ".husky"), { recursive: true })
    fs.writeFileSync(path.join(dir, ".husky", "pre-commit"), "node scripts/ci-proof-run.mjs\n")
    const wired = deriveWiredGuards(dir)
    expect(wired).toContain("ci-proof-run.mjs")
    expect(excludedHelperClasses(dir)).not.toContain("ci-proof-run.mjs")
  }, 60000)
})

describe("scripts/proofs-manifest.mjs - REAL-REPO CONTRACT do CLI (sec 11.60)", () => {
  // HERMETICO contra o shell do dev: se PROOFS_DOC estiver setado no
  // ambiente, o exit-0 real falharia confusamente. O env do subprocesso
  // exclui a chave explicitamente (o mesmo padrao do cliEnv da sec 11.42).
  function cliEnv(): Record<string, string> {
    const env: Record<string, string> = {}
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined && k !== "PROOFS_DOC") env[k] = v
    }
    return env
  }

  it("node scripts/proofs-manifest.mjs --check no repo real -> exit 0 com a contagem das classes e provas", () => {
    const res = runSubprocess({
      command: process.execPath,
      args: [path.join(ROOT, "scripts", "proofs-manifest.mjs"), "--check"],
      env: cliEnv(),
    })
    expect(res.status).toBe(0)
    const stdout = res.stdout ?? ""
    expect(stdout).toContain("proofs-manifest: clean")
    expect(stdout).toContain("26 classes")
    expect(stdout).toContain("62 provas")
  }, 60000)

  it("CLI exit 1 REAL: PROOFS_DOC aponta o doc sintetico com Prova 99 (a 40 e real desde a sec 8.35) -> exit 1 com a secao listada no stderr (o CLI real le o doc via override)", () => {
    const dir = createTempDir("proofs-60-")
    const docPath = writeSyntheticDoc(dir, [{ header: "## 8.99 Prova 99", body: ["linha"] }])
    const res = runSubprocess({
      command: process.execPath,
      args: [path.join(ROOT, "scripts", "proofs-manifest.mjs"), "--check"],
      env: { ...cliEnv(), PROOFS_DOC: docPath },
    })
    expect(res.status).toBe(1)
    const stderr = res.stderr ?? ""
    expect(stderr).toContain("Prova 99")
    expect(stderr).toContain("PROOF_CLASSES")
  }, 60000)

  it("flag desconhecida -> exit 2 com a usage (nao ha superficie --print-* - o OUT OF SHAPE do manifest-registry)", () => {
    const res = runSubprocess({
      command: process.execPath,
      args: [path.join(ROOT, "scripts", "proofs-manifest.mjs"), "--bogus"],
      env: cliEnv(),
    })
    expect(res.status).toBe(2)
    expect(res.stderr ?? "").toContain("usage:")
  }, 60000)
})
