/**
 * doc-revalidate.mjs - a re-validacao datada das secoes 8.x num comando
 * (2026-08-11, sec 11.61). O espelho do hook-proof-run para os registros de
 * evento: o ciclo manual da re-validacao da sec 8.34 (rodar o CLI + a suite
 * + editar a doc) vira 1 invocacao.
 *
 * WHY: a re-validacao 2026-08-11 da sec 8.34 foi manual (rodar o CLI real +
 * a suite hermetica + editar a doc) - o ciclo que o proximo dev re-derivaria
 * a cada claim nova. Este helper automatiza o padrao; a suite pina as
 * funcoes puras (parseCliCount, buildRevalidateLine, upsertRevalidateLine)
 * com conteudo sintetico, o template UTF-8 do disco (o pin dos
 * placeholders), o ciclo E2E com bins falsos (DOC_REVALIDATE_CLI_CMD /
 * DOC_REVALIDATE_SUITE_CMD -> fakes no temp dir, o seam do HOOK_PROOF_GIT)
 * e o REAL-REPO CONTRACT do --dry-run --no-suite (o count atual pinado).
 * O fake suite pina o fix do Windows (ACHADO da Prova 42, sec 8.37): falha
 * se NO_COLOR nao vier via env no spawn (nunca prefixo shell).
 *
 * HERMETICIDADE: nenhum CLI/suite REAL roda no caminho E2E - o CLI spawna
 * os fakes via os mesmos seams por env herdados pelo spawnSync. O doc do
 * --doc e um temp file (o seam hermetico - nunca toca o gates-proofs.md
 * real em teste). O REAL-REPO usa --dry-run (nada escrito) + --no-suite
 * (sem vitest real).
 *
 * Subprocess-heavy (os E2E spawnam node via shell) -> um timeout explicito
 * em todo it() (o scan-timeouts guard exige).
 */
import { afterEach, describe, expect, it } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { buildRevalidateLine, DEFAULT_CLI_CMD, DEFAULT_SUITE_CMD, parseArgs, parseCliCount, upsertRevalidateLine } from "../doc-revalidate.mjs"
import { cleanupTempDirs, createTempDir } from "./golden-copy-utils"

const SCRIPT = path.resolve(process.cwd(), "scripts", "doc-revalidate.mjs")
const TEMPLATE = path.resolve(process.cwd(), "scripts", "doc-revalidate-line.txt")

/** Um doc sintetico com a secao de controle (a linha manual acentuada) + vizinhos. */
const SYNTH_DOC = [
  "## 8.34 Prova 39 - controle sintetico (2026-08-11)",
  "",
  "Alguma prosa do controle.",
  "",
  "**Re-validação datada (2026-08-11, 28 claims)**: linha manual existente",
  "com continuação em outra linha física.",
  "",
  "## 8.35 Prova 40 - outra secao",
  "",
  "Prosa.",
  "",
].join("\n")

const CLEAN_LINE =
  "exit-claims: clean (28 claims registradas em 25 current + 1 superseded + 2 measurement - sec 11.42)"
const BREAKDOWN = " registradas em 25 current + 1 superseded + 2 measurement - sec 11.42"

function runCli(args: string[], env: Record<string, string> = {}): { status: number; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
    timeout: 30_000,
  })
  return { status: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" }
}

afterEach(() => {
  cleanupTempDirs()
})

describe("scripts/doc-revalidate.mjs - default cmds prefix-free (o fix do Windows, sec 8.37)", () => {
  it("SHAPE GUARD: nenhum default de comando spawnado comeca com prefixo de env shell ('VAR=valor cmd' - a classe que o cmd.exe rejeita, ACHADO da Prova 42)", () => {
    // o prefixo POSIX `NO_COLOR=1 cmd` quebra no Windows (cmd.exe) - o
    // fix moveu NO_COLOR para o env do spawn; este teste pina que o
    // default NUNCA volta a ter o prefixo (o E2E so cobre o override path)
    for (const cmd of [DEFAULT_CLI_CMD, DEFAULT_SUITE_CMD]) {
      expect(cmd).not.toMatch(/^[A-Z_]+=/) // sem `VAR=...` no inicio
    }
  })
})

describe("scripts/doc-revalidate.mjs - parseCliCount (sec 11.61)", () => {
  it("linha clean -> count + breakdown verbatim (com o espaco inicial)", () => {
    const p = parseCliCount(CLEAN_LINE)
    expect(p).toEqual({ count: 28, breakdown: BREAKDOWN })
  })

  it("clean sem breakdown -> count com breakdown vazio", () => {
    expect(parseCliCount("exit-claims: clean (28 claims)")).toEqual({ count: 28, breakdown: "" })
  })

  it("saida de falha do CLI (nao-clean) -> null", () => {
    expect(parseCliCount("exit-claims: 1 claim(s) de exit code SEM registro no manifest (sec 11.42)")).toBeNull()
    expect(parseCliCount("")).toBeNull()
  })
})

describe("scripts/doc-revalidate.mjs - parseArgs (sec 11.61)", () => {
  it("defaults: doc real, section 8.34, date local YYYY-MM-DD, dryRun/noSuite false", () => {
    const o = parseArgs([])
    expect(o.doc).toBe(path.resolve(process.cwd(), "docs", "gates-proofs.md"))
    expect(o.section).toBe("8.34")
    expect(o.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(o.dryRun).toBe(false)
    expect(o.noSuite).toBe(false)
    expect(o.error).toBeNull()
  })

  it("flags: --doc/--section/--date/--dry-run/--no-suite", () => {
    const o = parseArgs(["--doc", "/tmp/x.md", "--section", "8.35", "--date", "2026-08-11", "--dry-run", "--no-suite"])
    expect(o.doc).toBe("/tmp/x.md")
    expect(o.section).toBe("8.35")
    expect(o.date).toBe("2026-08-11")
    expect(o.dryRun).toBe(true)
    expect(o.noSuite).toBe(true)
  })

  it("flag desconhecida -> error (usage)", () => {
    expect(parseArgs(["--nope"]).error).toContain("flag desconhecida")
  })

  it("--date invalido -> error", () => {
    expect(parseArgs(["--date", "11/08/2026"]).error).toContain("YYYY-MM-DD")
  })

  it("--sweep: flag reconhecida (a varredura read-only das secoes 8.x - sec 11.68)", () => {
    const o = parseArgs(["--sweep"])
    expect(o.sweep).toBe(true)
    expect(o.doc).toBe(path.resolve(process.cwd(), "docs", "gates-proofs.md"))
    expect(o.error).toBeNull()
  })

  it("--sweep NAO combina com --section/--date/--dry-run/--no-suite (fail-loud no usage - a varredura cobre TODAS as secoes)", () => {
    expect(parseArgs(["--sweep", "--section", "8.35"]).error).toContain("nao combina")
    expect(parseArgs(["--sweep", "--dry-run"]).error).toContain("nao combina")
    expect(parseArgs(["--sweep", "--no-suite"]).error).toContain("nao combina")
    expect(parseArgs(["--sweep", "--date", "2026-08-11"]).error).toContain("nao combina")
  })
})

describe("scripts/doc-revalidate.mjs - template pin + buildRevalidateLine (sec 11.61)", () => {
  it("TEMPLATE PIN: o arquivo UTF-8 tem exatamente os 5 placeholders (nada mais)", () => {
    const t = fs.readFileSync(TEMPLATE, "utf8")
    for (const ph of ["{{DATE}}", "{{COUNT}}", "{{QUOTE}}", "{{SUITE_CLAUSE}}"]) {
      expect(t).toContain(ph)
    }
    // sem placeholder estranho / sem quebra de linha no meio (1 linha + eol)
    expect(t).not.toMatch(/\{\{[A-Z_]+(?<!DATE|COUNT|QUOTE|SUITE_CLAUSE)\}\}/)
    expect(t.trim().split("\n")).toHaveLength(1)
  })

  it("linha completa: data, count, quote verbatim e a suite", () => {
    const t = fs.readFileSync(TEMPLATE, "utf8")
    const line = buildRevalidateLine(t, { date: "2026-08-11", count: 28, breakdown: BREAKDOWN, suiteTotal: 21 })
    expect(line).toContain("**Re-validação (2026-08-11, 28 claims)**")
    expect(line).toContain(`\`clean (28 claims${BREAKDOWN})\` exit 0 (verbatim)`)
    expect(line).toContain("21/21 verde")
  })

  it("suiteTotal null (--no-suite) omite a clausula da suite - nunca 'null/null'", () => {
    const t = fs.readFileSync(TEMPLATE, "utf8")
    const line = buildRevalidateLine(t, { date: "2026-08-11", count: 28, breakdown: BREAKDOWN, suiteTotal: null })
    expect(line).not.toContain("verde")
    expect(line).not.toContain("null")
    expect(line).toContain("`--check` continua clean")
  })
})

describe("scripts/doc-revalidate.mjs - upsertRevalidateLine (sec 11.61)", () => {
  const DATE = "2026-08-11"
  const line = `**Re-validação (${DATE}, 30 claims)**: linha automatica`

  it("append no FIM do conteudo da secao (antes dos blanks / do proximo header)", () => {
    const next = upsertRevalidateLine(SYNTH_DOC, "8.34", DATE, line)
    const lines = next.split("\n")
    // o .mjs (allowJs, sem checkJs) nao da tipo estrutural aos retornos de
    // funcao - anotamos o lambda das cadeias derivadas (o tsc exige)
    const idx = lines.findIndex((l: string) => l.startsWith("**Re-validação (2026-08-11, 30 claims)"))
    expect(idx).toBeGreaterThan(0)
    // a linha manual 'datada' esta INTACTA (nunca tocada)
    expect(lines.filter((l: string) => l.startsWith("**Re-validação datada"))).toHaveLength(1)
    // a linha automatica ficou DEPOIS da manual, antes do header 8.35
    const manual = lines.findIndex((l: string) => l.startsWith("**Re-validação datada"))
    expect(idx).toBeGreaterThan(manual)
    expect(lines[idx + 1]).toBe("") // seguida de blank (o fim do conteudo)
    expect(lines[idx + 2]).toBe("## 8.35 Prova 40 - outra secao")
  })

  it("IDEMPOTENCIA: re-run do MESMO dia = REPLACE, nunca duplicata", () => {
    const once = upsertRevalidateLine(SYNTH_DOC, "8.34", DATE, line)
    const twice = upsertRevalidateLine(once, "8.34", DATE, "**Re-validação (2026-08-11, 31 claims)**: nova")
    // o .mjs (allowJs, sem checkJs) nao da tipo estrutural completo as
    // funcoes - anotamos o lambda das cadeias inline (o tsc exige)
    expect(twice.split("\n").filter((l: string) => l.startsWith("**Re-validação (2026-08-11"))).toHaveLength(1)
    expect(twice).toContain("31 claims")
    expect(twice).not.toContain("30 claims")
    expect(twice.split("\n").filter((l: string) => l.startsWith("**Re-validação datada"))).toHaveLength(1)
  })

  it("datas diferentes coexistem (a entrada automatica do dia anterior fica)", () => {
    // a linha deve carregar a MESMA data do argumento (o upsert chaveia a
    // idempotencia pelo date arg - o main sempre alinha as duas)
    const d1 = upsertRevalidateLine(SYNTH_DOC, "8.34", "2026-08-10", "**Re-validação (2026-08-10, 29 claims)**: ontem")
    const d2 = upsertRevalidateLine(d1, "8.34", DATE, "**Re-validação (2026-08-11, 30 claims)**: hoje")
    const auto = d2.split("\n").filter((l: string) => l.startsWith("**Re-validação (2026-08"))
    expect(auto).toHaveLength(2)
  })

  it("secao inexistente -> THROW (fail-loud, nada escrito)", () => {
    expect(() => upsertRevalidateLine(SYNTH_DOC, "8.99", DATE, line)).toThrow(/nao encontrada/)
  })

  it("CRLF preservado (o doc e CRLF no working tree)", () => {
    const crlf = SYNTH_DOC.replace(/\n/g, "\r\n")
    const next = upsertRevalidateLine(crlf, "8.34", DATE, line)
    expect(next.includes("\r\n")).toBe(true)
    expect(next).toContain(`**Re-validação (${DATE}, 30 claims)**: linha automatica`)
    // sem \n solto (toda quebra e \r\n)
    expect(next.replace(/\r\n/g, "")).not.toContain("\n")
  })
})

describe("scripts/doc-revalidate.mjs - E2E hermetico (fakes via env)", () => {
  const CLI_OUT = "exit-claims: clean (30 claims registradas em 27 current + 1 superseded + 2 measurement - sec 11.42)"

  function fakeEnv(dir: string, opts: { cliFail?: boolean; suiteFail?: boolean } = {}): Record<string, string> {
    const fakeCli = path.join(dir, "fake-cli.mjs")
    const fakeSuite = path.join(dir, "fake-suite.mjs")
    fs.writeFileSync(
      fakeCli,
      opts.cliFail
        ? 'process.stderr.write("fake-cli: falhou de proposito\\n"); process.exit(1)'
        : `console.log(${JSON.stringify(CLI_OUT)})`,
      "utf8",
    )
    fs.writeFileSync(
      fakeSuite,
      opts.suiteFail
        ? 'process.stderr.write("fake-suite: falhou de proposito\\n"); process.exit(1)'
        : 'if (process.env.NO_COLOR !== "1") { process.stderr.write("fake-suite: NO_COLOR nao veio via env (o fix do Windows, ACHADO da Prova 42/sec 8.37)\\n"); process.exit(1) } console.log(" Tests  5 passed (5)")',
      "utf8",
    )
    return {
      DOC_REVALIDATE_CLI_CMD: `node "${fakeCli}"`,
      DOC_REVALIDATE_SUITE_CMD: `node "${fakeSuite}"`,
    }
  }

  it("insert + idempotencia: 1a run upserta a linha (30 claims verbatim), re-run do mesmo dia = 1 linha", () => {
    const dir = createTempDir("drv-e2e-")
    const docPath = path.join(dir, "gates-proofs.md")
    fs.writeFileSync(docPath, SYNTH_DOC, "utf8")
    const env = fakeEnv(dir)
    const r1 = runCli(["--doc", docPath, "--section", "8.34", "--date", "2026-08-11"], env)
    expect(r1.status).toBe(0)
    let doc = fs.readFileSync(docPath, "utf8")
    expect(doc).toContain("**Re-validação (2026-08-11, 30 claims)**")
    expect(doc).toContain(`\`clean (30 claims registradas em 27 current + 1 superseded + 2 measurement - sec 11.42)\` exit 0 (verbatim)`)
    expect(doc).toContain("5/5 verde")
    expect(r1.stdout).toContain("upsertada")

    const r2 = runCli(["--doc", docPath, "--section", "8.34", "--date", "2026-08-11"], env)
    expect(r2.status).toBe(0)
    doc = fs.readFileSync(docPath, "utf8")
    expect(doc.split("\n").filter((l) => l.startsWith("**Re-validação (2026-08-11"))).toHaveLength(1)
    expect(doc.split("\n").filter((l) => l.startsWith("**Re-validação datada"))).toHaveLength(1)
  }, 60000)

  it("--dry-run: valida (CLI + suite) e NAO escreve nada", () => {
    const dir = createTempDir("drv-dry-")
    const docPath = path.join(dir, "gates-proofs.md")
    fs.writeFileSync(docPath, SYNTH_DOC, "utf8")
    const r = runCli(["--doc", docPath, "--section", "8.34", "--date", "2026-08-11", "--dry-run"], fakeEnv(dir))
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("dry-run")
    expect(r.stdout).toContain("30 claims")
    expect(fs.readFileSync(docPath, "utf8")).toBe(SYNTH_DOC)
  }, 60000)

  it("GUARD 8.x: --section 11.42 falha no usage (exit 2) antes de tocar o doc", () => {
    const dir = createTempDir("drv-guard-")
    const docPath = path.join(dir, "gates-proofs.md")
    fs.writeFileSync(docPath, SYNTH_DOC, "utf8")
    const r = runCli(["--doc", docPath, "--section", "11.42", "--date", "2026-08-11"], fakeEnv(dir))
    expect(r.status).toBe(2)
    expect(r.stderr).toContain("8.x")
    expect(fs.readFileSync(docPath, "utf8")).toBe(SYNTH_DOC)
  }, 60000)

  it("CLI falho -> fail-loud exit 1 com o stderr do CLI (nada escrito)", () => {
    const dir = createTempDir("drv-clifail-")
    const docPath = path.join(dir, "gates-proofs.md")
    fs.writeFileSync(docPath, SYNTH_DOC, "utf8")
    const r = runCli(["--doc", docPath, "--section", "8.34", "--date", "2026-08-11"], fakeEnv(dir, { cliFail: true }))
    expect(r.status).toBe(1)
    expect(r.stderr).toContain("CLI do scan-exit-claims falhou")
    expect(r.stderr).toContain("fake-cli: falhou de proposito")
    expect(fs.readFileSync(docPath, "utf8")).toBe(SYNTH_DOC)
  }, 60000)

  it("suite falha -> fail-loud exit 1 (o --no-suite e o unico escape)", () => {
    const dir = createTempDir("drv-suitefail-")
    const docPath = path.join(dir, "gates-proofs.md")
    fs.writeFileSync(docPath, SYNTH_DOC, "utf8")
    const r = runCli(["--doc", docPath, "--section", "8.34", "--date", "2026-08-11"], fakeEnv(dir, { suiteFail: true }))
    expect(r.status).toBe(1)
    expect(r.stderr).toContain("suite hermetica falhou")
    // --no-suite passa sem a suite (o caminho rapido)
    const ok = runCli(["--doc", docPath, "--section", "8.34", "--date", "2026-08-11", "--no-suite"], fakeEnv(dir, { suiteFail: true }))
    expect(ok.status).toBe(0)
  }, 60000)

  it("--date invalido -> usage exit 2", () => {
    const dir = createTempDir("drv-date-")
    const docPath = path.join(dir, "gates-proofs.md")
    fs.writeFileSync(docPath, SYNTH_DOC, "utf8")
    const r = runCli(["--doc", docPath, "--section", "8.34", "--date", "11/08/2026"], fakeEnv(dir))
    expect(r.status).toBe(2)
    expect(r.stderr).toContain("YYYY-MM-DD")
  }, 60000)
})

describe("scripts/doc-revalidate.mjs - REAL-REPO CONTRACT (sec 11.61)", () => {
  it("dry-run --no-suite no doc real: exit 0 com o count atual pinado (o BASELINE do --check)", () => {
    const r = runCli(["--dry-run", "--no-suite"])
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("dry-run")
    // o pin do count ATUAL (28): a cada claim nova no EXIT_CLAIMS, este
    // assert muda de proposito (o mesmo padrao do ABS PIN)
    expect(r.stdout).toContain("clean (28 claims")
    expect(r.stdout).toContain("**Re-validação (")
  }, 60000)
})

describe("scripts/doc-revalidate.mjs - SWEEP read-only (sec 11.68)", () => {
  it("REAL-REPO CONTRACT do CLI: --sweep no doc real -> exit 0 'clean' (as 3 dimensoes do contrato de counts verificam o doc real: checkCitedCounts + checkRevalCurrent + checkDigestCounts = [] - o pino vivo)", () => {
    const r = runCli(["--sweep"])
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("--sweep: clean")
    expect(r.stdout).toContain("nenhuma secao 8.x precisa de re-validacao")
  }, 120000)

  it("MUTATION: doc com a secao 8.99 citando count ANTIGO sem re-validacao datada (11.62) -> exit 1 com a secao exata e a CURE doc-revalidate --section", () => {
    const dir = createTempDir("drv-sweep-")
    const docPath = path.join(dir, "gates-proofs.md")
    fs.writeFileSync(
      docPath,
      [
        "## 8.99 Prova X - controle sintetico",
        "",
        "**Controle pos-ciclo**: CLI `clean (25 claims)` exit 0.",
        "",
        "## 12. Referências",
        "",
      ].join("\n"),
      "utf8",
    )
    const r = runCli(["--sweep", "--doc", docPath])
    expect(r.status).toBe(1)
    expect(r.stdout).toContain("secao 8.99")
    expect(r.stdout).toContain("node scripts/doc-revalidate.mjs --section 8.99")
    expect(r.stdout).toContain("sec 11.62")
  }, 60000)

  it("MUTATION: doc com a reval datada citando count ANTIGO (11.66) -> exit 1 com a secao exata e a CURE doc-revalidate --section", () => {
    const dir = createTempDir("drv-sweep-")
    const docPath = path.join(dir, "gates-proofs.md")
    fs.writeFileSync(
      docPath,
      [
        "## 8.99 Prova X - controle sintetico",
        "",
        "**Re-validação (2026-08-11, 27 claims)**: re-validado quando o manifest tinha 27.",
        "",
        "## 12. Referências",
        "",
      ].join("\n"),
      "utf8",
    )
    const r = runCli(["--sweep", "--doc", docPath])
    expect(r.status).toBe(1)
    expect(r.stdout).toContain("secao 8.99")
    expect(r.stdout).toContain("node scripts/doc-revalidate.mjs --section 8.99")
    expect(r.stdout).toContain("sec 11.66")
  }, 60000)

  it("MUTATION: doc com a row 99 (origem 8.99 sem reval) + a row 100 SEM origem (o branch section:null) (11.67) -> exit 1 com as 2 rows exatas: a CURE doc-revalidate --section E o fail-loud 'SEM referencia de secao de origem'", () => {
    const dir = createTempDir("drv-sweep-")
    const docPath = path.join(dir, "gates-proofs.md")
    fs.writeFileSync(
      docPath,
      [
        "## 1. Tabela resumo",
        "",
        "| # | Gate sob prova | Prova | Resultado |",
        "|---|---|---|---|",
        "| 99 | Guard X (Prova 99, sec 8.99) | `clean (25 claims)` |",
        "| 100 | Guard Y (Prova 100) | `clean (26 claims)` |",
        "",
        "## 8.99 Prova X - controle sintetico",
        "",
        "**Controle pos-ciclo**: sem counts no corpo (so as rows da tabela citam).",
        "",
        "## 12. Referências",
        "",
      ].join("\n"),
      "utf8",
    )
    const r = runCli(["--sweep", "--doc", docPath])
    expect(r.status).toBe(1)
    // row 99: o branch WITH-origin (origem 8.99 descoberta) -> a CURE doc-revalidate --section
    expect(r.stdout).toContain("row 99")
    expect(r.stdout).toContain("node scripts/doc-revalidate.mjs --section 8.99")
    expect(r.stdout).toContain("sec 11.67")
    // row 100: o branch section:null (row SEM referencia sec 8.N de origem) ->
    // fail-loud 'SEM referencia de secao de origem' (o pin do nit do reviewer, sec 11.68)
    expect(r.stdout).toContain("row 100")
    expect(r.stdout).toContain("SEM referencia de secao de origem")
  }, 60000)
})
