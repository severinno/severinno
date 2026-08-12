import { describe, it, expect, afterAll } from "vitest"
import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import {
  parseArgs,
  buildManifestEntry,
  buildSnapshotLine,
  bumpCounts,
  buildTableRow,
  buildSection,
  insertManifestEntry,
  insertSnapshotLine,
  insertTableRow,
  insertSection,
  nextTableRow,
  currentProofCount,
  main,
} from "../proof-register.mjs"

const TEMPLATE_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "proof-register-section.txt")

// The real-repo paths (the dry-run contract reads the actual files).
const REAL_MANIFEST = path.join(process.cwd(), "scripts", "proofs-manifest.mjs")
const REAL_TEST = path.join(process.cwd(), "scripts", "__tests__", "proofs-manifest.test.ts")
const REAL_DOC = path.join(process.cwd(), "docs", "gates-proofs.md")

// ---------------------------------------------------------------------------
// Pure functions (sec 11.94)
// ---------------------------------------------------------------------------

describe("proof-register - parseArgs", () => {
  it("parses the full valid invocation (local + dry-run + no-suite)", () => {
    const a = parseArgs(["--class", "hook-proof-run", "--prova", "49", "--section", "8.44", "--what", "x", "--dry-run", "--no-suite"])
    expect(a.class).toBe("hook-proof-run")
    expect(a.prova).toBe("49")
    expect(a.section).toBe("8.44")
    expect(a.what).toBe("x")
    expect(a.run).toBeNull()
    expect(a.dryRun).toBe(true)
    expect(a.noSuite).toBe(true)
    expect(a.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(a.error).toBeNull()
  })

  it("parses --run and an explicit --date", () => {
    const a = parseArgs(["--class", "c", "--prova", "50", "--section", "8.45", "--what", "y", "--run", "12345", "--date", "2026-08-12"])
    expect(a.run).toBe("12345")
    expect(a.date).toBe("2026-08-12")
    expect(a.error).toBeNull()
  })

  it("rejects a missing required flag", () => {
    const a = parseArgs(["--class", "hook-proof-run", "--prova", "49"])
    expect(a.error).toContain("--section obrigatorio")
  })

  it("rejects a non-numeric --prova", () => {
    const a = parseArgs(["--class", "c", "--prova", "x", "--section", "8.44", "--what", "y"])
    expect(a.error).toContain("--prova deve ser numerico")
  })

  it("rejects a non-8.x --section (the sec 11.51 frontier)", () => {
    const a = parseArgs(["--class", "c", "--prova", "49", "--section", "9.1", "--what", "y"])
    expect(a.error).toContain("--section deve ser 8.x")
  })

  it("rejects a non-ASCII --what (the manifest is ASCII-gated)", () => {
    const a = parseArgs(["--class", "c", "--prova", "49", "--section", "8.44", "--what", "prova com \u00e7"])
    expect(a.error).toContain("--what deve ser ASCII")
  })

  it("rejects a leading-zero --prova (would write a strict-mode ESM SyntaxError)", () => {
    const a = parseArgs(["--class", "c", "--prova", "049", "--section", "8.44", "--what", "y"])
    expect(a.error).toContain("zero a esquerda")
  })

  it("rejects a non-numeric --run (the CI run number)", () => {
    const a = parseArgs(["--class", "c", "--prova", "49", "--section", "8.44", "--what", "y", "--run", "abc"])
    expect(a.error).toContain("--run deve ser numerico")
  })
})

describe("proof-register - buildManifestEntry / buildSnapshotLine (the generated pieces)", () => {
  it("builds the PROOF_CLASSES entry with run null (6-space indent, the real format)", () => {
    expect(
      buildManifestEntry({ class: "hook-proof-run", prova: 49, section: "8.44", run: null, what: "o registro de prova local num comando" }),
    ).toBe('      { prova: 49, section: "8.44", run: null, what: "o registro de prova local num comando" },')
  })

  it("builds the PROOF_CLASSES entry with a run", () => {
    expect(buildManifestEntry({ class: "c", prova: 50, section: "8.45", run: "12345", what: "y" })).toBe(
      '      { prova: 50, section: "8.45", run: "12345", what: "y" },',
    )
  })

  it("builds the ABS_PIN_SNAPSHOT tuple with run null -> local (the projection convention)", () => {
    expect(buildSnapshotLine({ class: "hook-proof-run", prova: 49, section: "8.44", run: null })).toBe(
      '  ["hook-proof-run", 49, "8.44", "local"],',
    )
  })

  it("builds the ABS_PIN_SNAPSHOT tuple with a run", () => {
    expect(buildSnapshotLine({ class: "c", prova: 50, section: "8.45", run: "12345" })).toBe('  ["c", 50, "8.45", "12345"],')
  })
})

describe("proof-register - bumpCounts (the count pins the Prova 48 drift class missed)", () => {
  const PINS = [
    "// sanity: 1 classes / 1 provas registradas (o numero do CLI clean).",
    "expect(PROJECTION).toHaveLength(1)",
    "expect(scanProvaSections(DOC).size).toBe(1)",
    'expect(stdout).toContain("1 provas")',
  ].join("\n")

  it("bumps the 4 count pins 1 -> 2", () => {
    const next = bumpCounts(PINS, 1, 2)
    expect(next).toContain("// sanity: 1 classes / 2 provas registradas (o numero do CLI clean).")
    expect(next).toContain("expect(PROJECTION).toHaveLength(2)")
    expect(next).toContain("expect(scanProvaSections(DOC).size).toBe(2)")
    expect(next).toContain('expect(stdout).toContain("2 provas")')
    expect(next).not.toContain("toHaveLength(1)")
  })

  it("MUTATION: a missing pin throws fail-loud (the count changed shape - update the harness)", () => {
    const broken = PINS.replace("toHaveLength(1)", "toHaveLength(2)")
    expect(() => bumpCounts(broken, 1, 2)).toThrow(/pin .* nao encontrado/)
  })
})

describe("proof-register - buildTableRow / buildSection (the doc pieces)", () => {
  it("builds the digest row with the class, what, Prova and sec (narrative cells as placeholders)", () => {
    const row = buildTableRow({ row: 48, class: "hook-proof-run", prova: 49, section: "8.44", what: "o registro" })
    expect(row).toContain("| 48 | hook-proof-run \u2014 **o registro** (Prova 49, sec 8.44) |")
    expect(row).toContain("<!-- a classe de erro protegida -->")
  })

  it("builds the section skeleton from the template with all placeholders replaced", () => {
    const template =
      "## {{SECTION}} Prova {{PROVA}} \u2014 {{WHAT}} ({{DATE}}{{RUN_CLAUSE}})\n\nRegistro: Prova {{PROVA}} (classe {{CLASS}}, sec {{SECTION}}{{RUN_CLAUSE}})."
    const s = buildSection(template, { section: "8.44", prova: 49, what: "o registro", date: "2026-08-12", class: "hook-proof-run", run: null })
    expect(s).toContain("## 8.44 Prova 49 \u2014 o registro (2026-08-12, local, sem rede)")
    expect(s).toContain("Registro: Prova 49 (classe hook-proof-run, sec 8.44, local, sem rede).")
    expect(s).not.toContain("{{")
  })

  it("builds the section skeleton with a run clause", () => {
    const template = "## {{SECTION}} ({{DATE}}{{RUN_CLAUSE}})"
    const s = buildSection(template, { section: "8.45", prova: 50, what: "y", date: "2026-08-12", class: "c", run: "12345" })
    expect(s).toContain("## 8.45 (2026-08-12, run 12345)")
  })
})

describe("proof-register - TEMPLATE PIN (the UTF-8 template on disk, the doc-revalidate-line.txt pattern)", () => {
  it("the real template has exactly the 6 placeholders (no unknown {{...}})", () => {
    const t = fs.readFileSync(TEMPLATE_PATH, "utf8")
    const known = ["{{SECTION}}", "{{PROVA}}", "{{WHAT}}", "{{DATE}}", "{{CLASS}}", "{{RUN_CLAUSE}}"]
    for (const p of known) expect(t).toContain(p)
    const unknown = [...t.matchAll(/\{\{[^}]+\}\}/g)].filter((m) => !known.includes(m[0]))
    expect(unknown).toEqual([])
  })

  it("buildSection over the real template leaves no placeholder behind (the dev fills only the narrative comments)", () => {
    const t = fs.readFileSync(TEMPLATE_PATH, "utf8")
    const s = buildSection(t, { section: "8.44", prova: 49, what: "o registro", date: "2026-08-12", class: "hook-proof-run", run: null })
    expect(s).toContain("## 8.44 Prova 49")
    expect(s).toContain("NARRATIVA MANUAL")
    expect(s).not.toMatch(/\{\{/)
  })
})

// ---------------------------------------------------------------------------
// Insertion helpers (hermetic, synthetic content)
// ---------------------------------------------------------------------------

describe("proof-register - insertManifestEntry / insertSnapshotLine / insertTableRow / insertSection", () => {
  const MANIFEST = [
    "const PROOF_CLASSES = [",
    "  {",
    '    class: "hook-proof-run",',
    '    module: "scripts/hook-proof-run.mjs",',
    "    proofs: [",
    '      { prova: 40, section: "8.35", run: null, what: "x" },',
    "    ],",
    "  },",
    "]",
  ].join("\n")

  it("insertManifestEntry appends the entry before the proofs close of the class", () => {
    const next = insertManifestEntry(MANIFEST, "hook-proof-run", '      { prova: 49, section: "8.44", run: null, what: "y" },')
    expect(next).toContain('      { prova: 40, section: "8.35", run: null, what: "x" },\n      { prova: 49, section: "8.44", run: null, what: "y" },\n    ],')
  })

  it("insertManifestEntry throws fail-loud when the class is absent", () => {
    expect(() => insertManifestEntry(MANIFEST, "ci-proof-run", "x")).toThrow(/classe 'ci-proof-run' nao encontrada/)
  })

  it("insertSnapshotLine inserts after the last tuple of the class (the projection order)", () => {
    const SNAP = [
      "const ABS_PIN_SNAPSHOT = [",
      '  ["hook-proof-run", 40, "8.35", "local"],',
      '  ["hook-proof-run", 41, "8.36", "local"],',
      '  ["scan-exit-claims", 39, "8.34", "local"],',
      "]",
    ].join("\n")
    const next = insertSnapshotLine(SNAP, "hook-proof-run", '  ["hook-proof-run", 49, "8.44", "local"],')
    expect(next).toContain('  ["hook-proof-run", 41, "8.36", "local"],\n  ["hook-proof-run", 49, "8.44", "local"],\n  ["scan-exit-claims", 39, "8.34", "local"],')
  })

  it("insertSnapshotLine inserts before the close when the class has no tuple yet", () => {
    const SNAP = ["const ABS_PIN_SNAPSHOT = [", '  ["hook-proof-run", 40, "8.35", "local"],', "]"].join("\n")
    const next = insertSnapshotLine(SNAP, "new-class", '  ["new-class", 1, "8.44", "local"],')
    expect(next).toContain('  ["hook-proof-run", 40, "8.35", "local"],\n  ["new-class", 1, "8.44", "local"],\n]')
  })

  it("insertTableRow appends after the last digest row; nextTableRow = max + 1", () => {
    const DOC = ["# X", "", "## 1. Digest", "| N | guard |", "| 1 | a |", "| 2 | b |", "", "## 2. Sec", "## 8.35 Prova 40", "## 9. Obs"].join("\n")
    expect(nextTableRow(DOC)).toBe(3)
    const next = insertTableRow(DOC, "| 3 | c |")
    expect(next).toContain("| 2 | b |\n| 3 | c |\n")
    expect(next.indexOf("## 2. Sec")).toBeGreaterThan(next.indexOf("| 3 | c |"))
  })

  it("nextTableRow is scoped to the digest (rows of OTHER tables never inflate it)", () => {
    const DOC = ["# X", "## 1. Digest", "| N | g |", "| 2 | b |", "## 8.1 Tabela", "| 99 | x |", "## 9. Obs"].join("\n")
    expect(nextTableRow(DOC)).toBe(3)
  })

  it("insertSection inserts the new 8.x before the header that follows the last 8.x", () => {
    const DOC = ["# X", "## 8.42 Prova 47", "texto", "## 8.43 Prova 48", "texto", "## 9. Obs"].join("\n")
    const next = insertSection(DOC, "## 8.44 Prova 49\n\ntexto")
    expect(next).toContain("## 8.43 Prova 48\ntexto\n## 8.44 Prova 49\n\ntexto\n## 9. Obs")
  })
})

// ---------------------------------------------------------------------------
// Hermetic E2E with fake bins (the seam: PROOF_REGISTER_SUITE_CMD)
// ---------------------------------------------------------------------------

describe("proof-register - hermetic E2E (fake manifest/test/doc + fake suite bin)", () => {
  const dirs: string[] = []

  afterAll(() => {
    delete process.env.PROOF_REGISTER_MANIFEST
    delete process.env.PROOF_REGISTER_TEST
    delete process.env.PROOF_REGISTER_DOC
    delete process.env.PROOF_REGISTER_SUITE_CMD
    delete process.env.FAKE_SUITE_EXIT
    for (const d of dirs) fs.rmSync(d, { recursive: true, force: true })
  })

  function writeFake(provaCount: number) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "proof-register-"))
    dirs.push(dir)
    const manifest = path.join(dir, "manifest.mjs")
    const test = path.join(dir, "manifest.test.ts")
    const doc = path.join(dir, "doc.md")
    const fakeBin = path.join(dir, "fake-suite.mjs")
    fs.writeFileSync(
      manifest,
      [
        "const PROOF_CLASSES = [",
        "  {",
        '    class: "hook-proof-run",',
        '    module: "scripts/hook-proof-run.mjs",',
        "    proofs: [",
        '      { prova: 40, section: "8.35", run: null, what: "x" },',
        "    ],",
        "  },",
        "]",
      ].join("\n"),
      "utf8",
    )
    fs.writeFileSync(
      test,
      [
        "// sanity: 1 classes / " + provaCount + " provas registradas (o numero do CLI clean).",
        "expect(PROJECTION).toHaveLength(" + provaCount + ")",
        "expect(scanProvaSections(DOC).size).toBe(" + provaCount + ")",
        'expect(stdout).toContain("' + provaCount + ' provas")',
        "const ABS_PIN_SNAPSHOT = [",
        '  ["hook-proof-run", 40, "8.35", "local"],',
        "]",
      ].join("\n"),
      "utf8",
    )
    fs.writeFileSync(
      doc,
      ["# X", "", "## 1. Digest", "| N | guard |", "| 1 | a |", "", "## 8.35 Prova 40", "texto", "## 9. Obs"].join("\n"),
      "utf8",
    )
    fs.writeFileSync(fakeBin, "process.exit(Number(process.env.FAKE_SUITE_EXIT ?? 0))", "utf8")
    // main() le o process.env real (o E2E muta o env de verdade, nao uma
    // copia - o seam e o mesmo do doc-revalidate/testes do hook-proof-run).
    process.env.PROOF_REGISTER_MANIFEST = manifest
    process.env.PROOF_REGISTER_TEST = test
    process.env.PROOF_REGISTER_DOC = doc
    process.env.PROOF_REGISTER_SUITE_CMD = `node ${fakeBin}`
    return { manifest, test, doc }
  }

  it("registers the prova in the 3 files with the counts bumped (exit 0)", () => {
    const files = writeFake(1)
    delete process.env.FAKE_SUITE_EXIT
    const code = main(["--class", "hook-proof-run", "--prova", "49", "--section", "8.44", "--what", "o registro", "--date", "2026-08-12"])
    expect(code).toBe(0)
    const m = fs.readFileSync(files.manifest, "utf8")
    expect(m).toContain('{ prova: 49, section: "8.44", run: null, what: "o registro" },')
    const t = fs.readFileSync(files.test, "utf8")
    expect(t).toContain("2 provas registradas")
    expect(t).toContain("toHaveLength(2)")
    expect(t).toContain('["hook-proof-run", 49, "8.44", "local"],')
    const d = fs.readFileSync(files.doc, "utf8")
    expect(d).toContain("## 8.44 Prova 49 \u2014 o registro (2026-08-12, local, sem rede)")
    expect(d).toContain("| 2 | hook-proof-run \u2014 **o registro** (Prova 49, sec 8.44) |")
  })

  it("FAIL: the suite gate failing blocks the registration and writes nothing (exit 1)", () => {
    const files = writeFake(1)
    process.env.FAKE_SUITE_EXIT = "1"
    const before = [fs.readFileSync(files.manifest, "utf8"), fs.readFileSync(files.test, "utf8"), fs.readFileSync(files.doc, "utf8")]
    const code = main(["--class", "hook-proof-run", "--prova", "49", "--section", "8.44", "--what", "o registro", "--date", "2026-08-12"])
    expect(code).toBe(1)
    const after = [fs.readFileSync(files.manifest, "utf8"), fs.readFileSync(files.test, "utf8"), fs.readFileSync(files.doc, "utf8")]
    expect(after).toEqual(before)
  })

  it("FAIL: a duplicate prova is rejected fail-loud (registrar e a decisao, nunca duplicar)", () => {
    writeFake(1)
    delete process.env.FAKE_SUITE_EXIT
    expect(main(["--class", "hook-proof-run", "--prova", "40", "--section", "8.44", "--what", "dup", "--date", "2026-08-12"])).toBe(1)
  })

  it("FAIL: a section that already exists is rejected fail-loud", () => {
    writeFake(1)
    delete process.env.FAKE_SUITE_EXIT
    expect(main(["--class", "hook-proof-run", "--prova", "49", "--section", "8.35", "--what", "dup", "--date", "2026-08-12"])).toBe(1)
  })

  it("--dry-run prints the 4 pieces and writes nothing", () => {
    const files = writeFake(1)
    delete process.env.FAKE_SUITE_EXIT
    const before = [fs.readFileSync(files.manifest, "utf8"), fs.readFileSync(files.test, "utf8"), fs.readFileSync(files.doc, "utf8")]
    const code = main(["--class", "hook-proof-run", "--prova", "49", "--section", "8.44", "--what", "o registro", "--date", "2026-08-12", "--dry-run", "--no-suite"])
    expect(code).toBe(0)
    const after = [fs.readFileSync(files.manifest, "utf8"), fs.readFileSync(files.test, "utf8"), fs.readFileSync(files.doc, "utf8")]
    expect(after).toEqual(before)
  })
})

// ---------------------------------------------------------------------------
// REAL-REPO CONTRACT (the dry-run on the actual files - the derivation pin)
// ---------------------------------------------------------------------------

describe("proof-register - REAL-REPO CONTRACT (dry-run on the real files, nothing written)", () => {
  it("derives the count from the ABS PIN suite equals the CLI count (the source-of-truth agreement)", () => {
    const derived = currentProofCount(fs.readFileSync(REAL_TEST, "utf8"))
    const cli = spawnSync("node scripts/proofs-manifest.mjs --check", { shell: true, encoding: "utf8", cwd: process.cwd() })
    expect(cli.status).toBe(0)
    const m = cli.stdout.match(/(\d+) provas registradas/)
    expect(m).not.toBeNull()
    if (!m) throw new Error("CLI count not parsed from stdout")
    expect(derived).toBe(Number(m[1]))
  }, 60000)

  it("dry-run on the real files exits 0, prints the pieces with the current count, and writes nothing", () => {
    process.env.PROOF_REGISTER_MANIFEST = REAL_MANIFEST
    process.env.PROOF_REGISTER_TEST = REAL_TEST
    process.env.PROOF_REGISTER_DOC = REAL_DOC
    const before = [fs.readFileSync(REAL_MANIFEST, "utf8"), fs.readFileSync(REAL_TEST, "utf8"), fs.readFileSync(REAL_DOC, "utf8")]
    const out: string[] = []
    const origLog = console.log
    console.log = (...a: unknown[]) => out.push(a.join(" "))
    let code = -1
    try {
    // Exemplo nao-colidente com o registro real: a Prova 49/sec 8.44 JA
    // existem (o scan-unit-config graduou com a Prova 49) e a Prova 50/sec
    // 8.45 agora e REAL (o revert-fail apply com patch integro, registrada
    // em 2026-08-12) - o dry-run usaria 51/8.46 para nao esbarrar no
    // "Prova N ja existe".
    code = main(["--class", "hook-proof-run", "--prova", "51", "--section", "8.46", "--what", "o registro de prova local num comando", "--dry-run", "--no-suite"])
    } finally {
      console.log = origLog
      delete process.env.PROOF_REGISTER_MANIFEST
      delete process.env.PROOF_REGISTER_TEST
      delete process.env.PROOF_REGISTER_DOC
    }
    expect(code).toBe(0)
    const joined = out.join("\n")
    expect(joined).toContain("classe hook-proof-run / Prova 51 / secao 8.46")
    expect(joined).toContain("provas")
    expect(joined).toContain("NADA FOI ESCRITO (dry-run)")
    const after = [fs.readFileSync(REAL_MANIFEST, "utf8"), fs.readFileSync(REAL_TEST, "utf8"), fs.readFileSync(REAL_DOC, "utf8")]
    expect(after).toEqual(before)
  })
})
