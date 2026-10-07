import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { join } from "node:path"
import { buildCsp, generateCspNonce, CSP_NONCE_HEADER } from "@/lib/csp"

/** Hash pinnado na CSP para o <style> do global-error (style-src-elem). */
const GLOBAL_ERROR_STYLE_HASH = "eqW5FnLZ2T07K7f5xhzEJOVJru1NKj1t3pH4q2urlAE="

describe("buildCsp", () => {
  const nonce = "YWJjZGVmZ2hpamtsbW5vcA=="

  /** Extrai o valor da diretriz script-src da CSP montada. */
  function scriptSrcOf(value: string): string {
    const m = value.match(/script-src ([^;]+)/)
    return m?.[1] ?? ""
  }

  it("produção: script-src TEM o nonce e strict-dynamic", () => {
    const { value } = buildCsp({ nonce, origin: "https://severinno.com.br", isProduction: true })
    expect(value).toContain(`'nonce-${nonce}'`)
    expect(value).toContain("'strict-dynamic'")
  })

  it("produção: script-src SEM unsafe-inline e SEM unsafe-eval", () => {
    const { value } = buildCsp({ nonce, origin: "https://severinno.com.br", isProduction: true })
    const scriptSrc = scriptSrcOf(value)
    expect(scriptSrc).not.toContain("'unsafe-inline'")
    expect(scriptSrc).not.toContain("'unsafe-eval'")
  })

  it("style-src SEM unsafe-inline (elementos <style>/<link> não-inline)", () => {
    const { value } = buildCsp({ nonce, origin: "https://severinno.com.br", isProduction: true })
    const styleSrc = value.match(/style-src ([^;]+)/)?.[1] ?? ""
    expect(styleSrc).not.toContain("'unsafe-inline'")
    expect(styleSrc).toContain("'self'")
  })

  it("style-src-attr mantém unsafe-inline APENAS para atributos style={{}} (não aceitam nonce)", () => {
    const { value } = buildCsp({ nonce, origin: "https://severinno.com.br", isProduction: true })
    expect(value).toContain("style-src-attr 'unsafe-inline'")
  })

  it("style-src-elem pina o hash do <style> do global-error", () => {
    const { value } = buildCsp({ nonce, origin: "https://severinno.com.br", isProduction: true })
    const styleElem = value.match(/style-src-elem ([^;]+)/)?.[1] ?? ""
    expect(styleElem).toContain(`'sha256-${GLOBAL_ERROR_STYLE_HASH}'`)
  })

  it("produção: SEM unpkg.com em nenhuma diretriz", () => {
    const { value } = buildCsp({ nonce, origin: "https://severinno.com.br", isProduction: true })
    expect(value).not.toContain("unpkg.com")
  })

  it("desenvolvimento: mantém unsafe-eval (HMR/Turbopack) mas não unsafe-inline no script-src", () => {
    const { value } = buildCsp({ nonce, origin: "http://localhost:3000", isProduction: false })
    expect(scriptSrcOf(value)).toContain("'unsafe-eval'")
    expect(scriptSrcOf(value)).not.toContain("'unsafe-inline'")
  })

  it("sempre inclui report-uri /api/csp-report", () => {
    const { value } = buildCsp({ nonce, origin: "https://severinno.com.br", isProduction: true })
    expect(value).toContain("report-uri /api/csp-report")
  })

  it("reportOnly=true usa header Report-Only", () => {
    const { header } = buildCsp({
      nonce,
      origin: "https://severinno.com.br",
      isProduction: true,
      reportOnly: true,
    })
    expect(header).toBe("Content-Security-Policy-Report-Only")
  })

  it("reportOnly=false usa header enforcer", () => {
    const { header } = buildCsp({
      nonce,
      origin: "https://severinno.com.br",
      isProduction: true,
    })
    expect(header).toBe("Content-Security-Policy")
  })

  it("mantém diretrizes de endurecimento existentes", () => {
    const { value } = buildCsp({ nonce, origin: "https://severinno.com.br", isProduction: true })
    expect(value).toContain("frame-ancestors 'none'")
    expect(value).toContain("base-uri 'self'")
    expect(value).toContain("form-action 'self'")
    expect(value).toContain("object-src 'none'")
    expect(value).toContain("worker-src 'self' blob:")
  })

  it("cada nonce diferente produz CSP diferente (nonce é por-request)", () => {
    const a = buildCsp({ nonce: "nonce-a", origin: "https://x.com", isProduction: true })
    const b = buildCsp({ nonce: "nonce-b", origin: "https://x.com", isProduction: true })
    expect(a.value).not.toBe(b.value)
  })
})

// ── Drift-guard: <style> do global-error ─────────────────────────────────────
// O global-error renderiza o próprio <html> (o layout pode ter crashado) e
// mantém um <style> autocontido, PINADO por hash em style-src-elem (csp.ts).
// Se alguém editar o CSS sem atualizar o hash, a página 500 renderiza sem
// estilo sob CSP enforcer — estes testes falham antes, no CI.

describe("drift-guard: <style> do global-error", () => {
  const GLOBAL_ERROR_PATH = join(__dirname, "..", "..", "app", "global-error.tsx")

  function extractGlobalErrorStyles(): string {
    const src = readFileSync(GLOBAL_ERROR_PATH, "utf8")
    const m = src.match(/const styles = `([\s\S]*?)`\n/)
    if (!m) throw new Error("const styles não encontrada em global-error.tsx")
    return m[1]
  }

  function sha256Base64(css: string): string {
    return createHash("sha256").update(css).digest("base64")
  }

  it("hash SHA-256 do CSS extraído do fonte bate com a const documentada", () => {
    expect(sha256Base64(extractGlobalErrorStyles())).toBe(GLOBAL_ERROR_STYLE_HASH)
  })

  it("CSP (style-src-elem) pina exatamente o hash do CSS atual do global-error", () => {
    const { value } = buildCsp({
      nonce: "YWJjZGVmZ2hpamtsbW5vcA==",
      origin: "https://severinno.com.br",
      isProduction: true,
    })
    const styleElem = value.match(/style-src-elem ([^;]+)/)?.[1] ?? ""
    expect(styleElem).toContain(`'sha256-${sha256Base64(extractGlobalErrorStyles())}'`)
  })
})

describe("generateCspNonce", () => {
  it("gera base64 de 128 bits (24 chars)", () => {
    const n = generateCspNonce()
    expect(n).toMatch(/^[A-Za-z0-9+/]{22}==$/)
  })

  it("gera valores distintos (aleatoriedade)", () => {
    const set = new Set(Array.from({ length: 50 }, () => generateCspNonce()))
    expect(set.size).toBe(50)
  })
})

describe("CSP_NONCE_HEADER", () => {
  it("é o header do contrato do Next.js (x-nonce)", () => {
    expect(CSP_NONCE_HEADER).toBe("x-nonce")
  })
})
