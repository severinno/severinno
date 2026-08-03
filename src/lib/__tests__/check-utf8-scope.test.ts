/**
 * check-utf8-scope.test.ts
 *
 * Testes das funções PURAS do scripts/check-utf8-scope.mjs — guard que TRAVA
 * a decisão de escopo do check-utf8.sh: as chamadas a check-utf8.sh e
 * check_utf8.py devem SEMPRE receber `src/` como argumento de diretório.
 *
 * Espelho do check-crlf-scope.test.ts.
 *
 * Cobre:
 *   - extractUtf8CallSites: detecta chamadas com src/; ignora atribuições de
 *     variável, echos, menções em docstrings
 *   - checkUtf8Scope: escopo src/ válido → sem violações; sem argumento →
 *     violação; argumento trocado → violação; default search_dir src → ok
 *   - Integração (spawn do guard real contra o repo)
 */

import { describe, it, expect } from "vitest"
import { spawnSync } from "node:child_process"
import { resolve } from "node:path"
import {
  extractUtf8CallSites,
  checkUtf8Scope,
  ALLOWED_UTF8_SCOPE_DIR,
} from "../../../scripts/check-utf8-scope.mjs"

// ── extractUtf8CallSites ─────────────────────────────────────────────────

describe("extractUtf8CallSites", () => {
  it("detecta chamada com src/ em bash", () => {
    const content = "bash scripts/check-utf8.sh --ci src/\n"
    const sites = extractUtf8CallSites(content)
    expect(sites).toHaveLength(1)
    expect(sites[0].dir).toBe("src")
  })

  it("detecta chamada com src/ em python3", () => {
    const content = "python3 scripts/check_utf8.py --fix src/\n"
    const sites = extractUtf8CallSites(content)
    expect(sites).toHaveLength(1)
    expect(sites[0].dir).toBe("src")
  })

  it("detecta chamada direta check-utf8.sh (sem bash) com src/", () => {
    const content = "scripts/check-utf8.sh --dry-run --ci src/\n"
    const sites = extractUtf8CallSites(content)
    expect(sites).toHaveLength(1)
    expect(sites[0].dir).toBe("src")
  })

  it("detecta chamada sem diretório → dir=null", () => {
    const content = "bash scripts/check-utf8.sh --ci\n"
    const sites = extractUtf8CallSites(content)
    expect(sites).toHaveLength(1)
    expect(sites[0].dir).toBeNull()
  })

  it("detecta chamada com diretório DIFERENTE → dir alterado", () => {
    const content = "bash scripts/check-utf8.sh --ci ./\n"
    const sites = extractUtf8CallSites(content)
    expect(sites).toHaveLength(1)
    expect(sites[0].dir).toBe(".")
  })

  it("ignora atribuição de variável (PYTHON_SCRIPT=...)", () => {
    const content = 'PYTHON_SCRIPT="$SCRIPT_DIR/check_utf8.py"\n'
    expect(extractUtf8CallSites(content)).toEqual([])
  })

  it("ignora echo/printf", () => {
    const content = 'echo "check-utf8: done (all clean)"\nprintf "check_utf8.py: %s\n" "ok"\n'
    expect(extractUtf8CallSites(content)).toEqual([])
  })

  it("ignora menção em docstring de Python", () => {
    const content = '"""\nRuns check_utf8.py --fix src/\n"""\n'
    expect(extractUtf8CallSites(content)).toEqual([])
  })

  it("extrai default search_dir do Python", () => {
    const content = 'search_dir = "src"\n'
    const sites = extractUtf8CallSites(content)
    expect(sites).toHaveLength(1)
    expect(sites[0].line).toBe(0)
    expect(sites[0].dir).toBe("src")
  })

  it("chamada com || e redirect não captura token após ||", () => {
    const content =
      'python3 scripts/check_utf8.py --fix src/ || echo "FIX_EXIT=$?" >> "$GITHUB_ENV"\n'
    const sites = extractUtf8CallSites(content)
    expect(sites).toHaveLength(1)
    expect(sites[0].dir).toBe("src")
  })

  it("chamada com && e redirecionamento não captura após &&", () => {
    const content = 'python3 scripts/check_utf8.py --dry-run --ci src/ && echo "OK" > /dev/null\n'
    const sites = extractUtf8CallSites(content)
    expect(sites).toHaveLength(1)
    expect(sites[0].dir).toBe("src")
  })

  it("detecta chamada com src/ + trailing slash", () => {
    const content = "python3 scripts/check_utf8.py --fix src/\n"
    const sites = extractUtf8CallSites(content)
    expect(sites).toHaveLength(1)
    expect(sites[0].dir).toBe("src") // trailing slash removido
  })
})

// ── checkUtf8Scope ───────────────────────────────────────────────────────

describe("checkUtf8Scope", () => {
  it("escopo src/ válido → sem violações e hasSrcScoped=true", () => {
    const content = "bash scripts/check-utf8.sh --ci src/\n"
    const res = checkUtf8Scope("check-utf8.sh", content)
    expect(res.violations).toEqual([])
    expect(res.hasSrcScoped).toBe(true)
  })

  it("chamada sem diretório → violação", () => {
    const content = "bash scripts/check-utf8.sh --ci\n"
    const res = checkUtf8Scope("check-utf8.sh", content)
    expect(res.violations).toHaveLength(1)
    expect(res.violations[0]).toContain("SEM argumento de diretório")
  })

  it("diretório trocado (./) → violação", () => {
    const content = "bash scripts/check-utf8.sh --ci ./\n"
    const res = checkUtf8Scope("check-utf8.sh", content)
    expect(res.violations).toHaveLength(1)
    expect(res.violations[0]).toContain("trocado para")
    expect(res.violations[0]).toContain(".")
  })

  it("diretório trocado (scripts/) → violação", () => {
    const content = "bash scripts/check-utf8.sh --ci scripts/\n"
    const res = checkUtf8Scope("check-utf8.sh", content)
    expect(res.violations).toHaveLength(1)
    expect(res.violations[0]).toContain("scripts")
  })

  it("default search_dir = 'src' no Python → hasSrcScoped=true", () => {
    const content = 'search_dir = "src"\n'
    const res = checkUtf8Scope("check_utf8.py", content)
    expect(res.violations).toEqual([])
    expect(res.hasSrcScoped).toBe(true)
  })

  it("default search_dir alterado → violação", () => {
    const content = 'search_dir = "/"\n'
    const res = checkUtf8Scope("check_utf8.py", content)
    expect(res.violations).toHaveLength(1)
    expect(res.violations[0]).toContain("default")
  })

  it("arquivo sem chamadas → hasSrcScoped=false, sem violações", () => {
    const res = checkUtf8Scope("foo.sh", "echo hi\n")
    expect(res.hasSrcScoped).toBe(false)
    expect(res.violations).toEqual([])
  })

  it("ALLOWED_UTF8_SCOPE_DIR é 'src'", () => {
    expect(ALLOWED_UTF8_SCOPE_DIR).toBe("src")
  })
})

// ── Integração (spawn do guard real contra o repo) ────────────────────────

describe("check-utf8-scope.mjs (integração)", () => {
  it("exit 0 no repo real — escopo do check-utf8 está travado em src/", () => {
    const res = spawnSync("node", [resolve(process.cwd(), "scripts/check-utf8-scope.mjs")], {
      cwd: process.cwd(),
      encoding: "utf8",
    })
    expect(res.status).toBe(0)
    expect(res.stdout).toContain("Escopo do check-utf8 travado")
  })
})
