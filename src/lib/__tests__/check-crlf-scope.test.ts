/**
 * check-crlf-scope.test.ts
 *
 * Testes das funções PURAS do scripts/check-crlf-scope.mjs — guard que TRAVA
 * a decisão de escopo dos guards CRLF: check-crlf.sh e check-blob-crlf.sh
 * (e seus detectores .py) devem escanear APENAS *.sh/*.bash via `git
 * ls-files` — NUNCA .ts/.tsx.
 *
 * Decisão travada (ESCOPO INTENCIONAL, header do check-crlf.sh): .sh/.bash
 * com CRLF quebram bash em containers Linux (act/CI); .ts/.tsx com CRLF NÃO
 * quebram nada (tsc/bun/vitest aceitam CRLF, blobs 100% LF via
 * .gitattributes, prettier+lint-staged normalizam). Um guard de working
 * tree para .ts/.tsx falharia em CADA checkout Windows sem proteger nada.
 *
 * Cobre:
 *   - extractLsFilesScopes: detecta invocações `git ls-files` com as
 *     extensões glob, com número de linha; ignora comentários (#) e
 *     menções em prosa (`git ls-files --eol -z` em docstring)
 *   - checkCrlfScope: escopo legítimo *.sh/*.bash → sem violações e
 *     hasShellScoped=true
 *   - extensão .ts adicionada ao pathspec → violação
 *   - extensão .tsx adicionada ao pathspec → violação
 *   - extensão .py (qualquer não-.sh/.bash) → violação (trava TOTAL)
 *   - `git ls-files` sem filtro de extensão → violação (fail-closed)
 *   - menção em comentário/docstring → NÃO é invocação (sem falso positivo)
 */

import { describe, it, expect } from "vitest"
import { spawnSync } from "node:child_process"
import { resolve } from "node:path"
import {
  extractLsFilesScopes,
  checkCrlfScope,
  ALLOWED_CRLF_SCOPE_EXTENSIONS,
} from "../../../scripts/check-crlf-scope.mjs"

// ── extractLsFilesScopes ─────────────────────────────────────────────────

describe("extractLsFilesScopes", () => {
  it("detecta invocação legítima do check-crlf.sh (git ls-files '*.sh' '*.bash')", () => {
    const content = `mapfile -t FILES < <(git ls-files '*.sh' '*.bash')\n`
    const scopes = extractLsFilesScopes(content)
    expect(scopes).toHaveLength(1)
    expect(scopes[0]).toMatchObject({ line: 1 })
    expect(scopes[0].extensions).toEqual(["sh", "bash"])
  })

  it("detecta invocação do check_blob_crlf.py (ls-files --eol -z)", () => {
    const content = `        ["git", "ls-files", "--eol", "-z", "--", "*.sh", "*.bash"],\n`
    const scopes = extractLsFilesScopes(content)
    expect(scopes).toHaveLength(1)
    expect(scopes[0].extensions).toEqual(["sh", "bash"])
  })

  it("extrai extensões adicionadas (ex.: *.ts) com número de linha", () => {
    const content = `a\nmapfile -t FILES < <(git ls-files '*.sh' '*.bash' '*.ts')\n`
    const scopes = extractLsFilesScopes(content)
    expect(scopes).toHaveLength(1)
    expect(scopes[0].line).toBe(2)
    expect(scopes[0].extensions).toEqual(["sh", "bash", "ts"])
  })

  it("ignora menção em comentário (#)", () => {
    const content = `# This guard complements check-utf8.sh and runs in utf8-check.yml\n# (git ls-files --eol -z) parses the i/ column\n`
    expect(extractLsFilesScopes(content)).toEqual([])
  })

  it("ignora menção em prosa dentro de docstring de Python", () => {
    const content = `"""\nDetection: \`git ls-files --eol -z\` prints i/<eol> w/<eol> per file.\n"""\n`
    expect(extractLsFilesScopes(content)).toEqual([])
  })

  it("docstring aberta com aspas triplas não fecha em linha interna com a outra variante", () => {
    // A menção a `git ls-files` após a variante interna NÃO pode virar
    // invocação: o bloco só fecha na MESMA aspas tripla que abriu.
    const content = `"""\nMenciona ''' aqui (prosa)\ngit ls-files --eol -z (ainda dentro da docstring)\n"""\n`
    expect(extractLsFilesScopes(content)).toEqual([])
  })

  it("pathspec de diretório (git ls-files 'scripts/') NÃO é bare", () => {
    // Escopo estrito por diretório não é remoção de filtro — só o BARE
    // (zero pathspecs) é fail-closed.
    const scopes = extractLsFilesScopes(`git ls-files 'scripts/'\n`)
    expect(scopes).toHaveLength(1)
    expect(scopes[0].bare).toBe(false)
  })

  it("git ls-files BARE (sem pathspecs) marca bare=true", () => {
    const scopes = extractLsFilesScopes(`mapfile -t FILES < <(git ls-files)\n`)
    expect(scopes).toHaveLength(1)
    expect(scopes[0].bare).toBe(true)
  })

  it("arquivo sem invocação de ls-files → []", () => {
    expect(extractLsFilesScopes("echo hi\n")).toEqual([])
  })
})

// ── checkCrlfScope ───────────────────────────────────────────────────────

describe("checkCrlfScope", () => {
  it("escopo legítimo *.sh/*.bash → sem violações e hasShellScoped=true", () => {
    const content = `mapfile -t FILES < <(git ls-files '*.sh' '*.bash')\n`
    const res = checkCrlfScope("scripts/check-crlf.sh", content)
    expect(res.violations).toEqual([])
    expect(res.hasShellScoped).toBe(true)
  })

  it("extensão .ts adicionada ao pathspec → violação com file:line", () => {
    const content = `mapfile -t FILES < <(git ls-files '*.sh' '*.bash' '*.ts')\n`
    const res = checkCrlfScope("scripts/check-crlf.sh", content)
    expect(res.violations).toHaveLength(1)
    expect(res.violations[0]).toContain("scripts/check-crlf.sh:1")
    expect(res.violations[0]).toContain("'*.ts'")
    expect(res.violations[0]).toContain("*.sh/*.bash")
  })

  it("extensão .tsx adicionada → violação (o caso exato da decisão)", () => {
    const content = `        ["git", "ls-files", "--eol", "-z", "--", "*.sh", "*.bash", "*.tsx"],\n`
    const res = checkCrlfScope("scripts/check_blob_crlf.py", content)
    expect(res.violations).toHaveLength(1)
    expect(res.violations[0]).toContain("'*.tsx'")
  })

  it("qualquer extensão fora de .sh/.bash é violação (trava TOTAL)", () => {
    const content = `git ls-files '*.sh' '*.py'\n`
    const res = checkCrlfScope("scripts/check-crlf.sh", content)
    expect(res.violations).toHaveLength(1)
    expect(res.violations[0]).toContain("'*.py'")
  })

  it("git ls-files BARE (sem pathspecs) → violação fail-closed", () => {
    const content = `mapfile -t FILES < <(git ls-files)\n`
    const res = checkCrlfScope("scripts/check-crlf.sh", content)
    expect(res.violations).toHaveLength(1)
    expect(res.violations[0]).toContain("BARE (sem pathspec)")
    expect(res.hasShellScoped).toBe(false)
  })

  it("pathspec de diretório ('scripts/') NÃO gera violação — escopo estrito, não remoção", () => {
    const content = `mapfile -t FILES < <(git ls-files 'scripts/')\n`
    const res = checkCrlfScope("scripts/check-crlf.sh", content)
    expect(res.violations).toEqual([])
    expect(res.hasShellScoped).toBe(false) // sem *.sh/*.bash explícito
  })

  it("invocação com .sh/.bash + violação ainda marca hasShellScoped=true", () => {
    const content = `git ls-files '*.sh' '*.bash' '*.ts'\n`
    const res = checkCrlfScope("scripts/check-crlf.sh", content)
    expect(res.hasShellScoped).toBe(true)
    expect(res.violations).toHaveLength(1)
  })

  it("arquivo sem nenhum ls-files → hasShellScoped=false, sem violações", () => {
    const res = checkCrlfScope("scripts/check_crlf.py", "#!/usr/bin/env python3\nimport sys\n")
    expect(res.hasShellScoped).toBe(false)
    expect(res.violations).toEqual([])
  })

  it("ALLOWED_CRLF_SCOPE_EXTENSIONS contém apenas sh e bash", () => {
    expect(ALLOWED_CRLF_SCOPE_EXTENSIONS).toEqual(["sh", "bash"])
  })
})

// ── Integração (spawn do guard real contra o repo) ────────────────────────

describe("check-crlf-scope.mjs (integração)", () => {
  it("exit 0 no repo real — escopo dos guards CRLF está travado em *.sh/*.bash", () => {
    // Trava o WIRING (lista CRLF_SCOPE_FILES + main() fail-closed): se um
    // guard CRLF ganhar um pathspec .ts/.tsx ou perder o filtro, este teste
    // quebra mesmo que as funções puras continuem passando isoladamente.
    const res = spawnSync("node", [resolve(process.cwd(), "scripts/check-crlf-scope.mjs")], {
      cwd: process.cwd(),
      encoding: "utf8",
    })
    expect(res.status).toBe(0)
    expect(res.stdout).toContain("Escopo dos guards CRLF travado")
  })
})
