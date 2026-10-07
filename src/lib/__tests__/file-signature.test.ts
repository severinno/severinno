import { describe, it, expect } from "vitest"
import { detectFileSignature, validateFileSignature } from "@/lib/file-signature"

// ── Fixtures binárias reais (assinaturas corretas) ─────────────────────────

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46])
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00]) // GIF89a + byte
const WEBP = new Uint8Array([
  0x52,
  0x49,
  0x46,
  0x46,
  0x24,
  0x00,
  0x00,
  0x00,
  0x57,
  0x45,
  0x42,
  0x50, // RIFF....WEBP
])
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]) // %PDF-1.4
const OLE2 = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]) // .doc
const ZIP = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00]) // .docx

// SVG disfarçado de .jpg — o ataque que esta camada existe para bloquear
const SVG_MASCARADO = new TextEncoder().encode(
  `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><script>alert(document.cookie)</script></svg>`,
)

// GIF polyglot com JS concatenado (GIF89a + payload)
const GIF_POLYGLOT = new Uint8Array([...GIF, ...new TextEncoder().encode(`alert(1)//`)])

describe("detectFileSignature", () => {
  it("detecta PNG", () => {
    expect(detectFileSignature(PNG)).toMatchObject({ ok: true, detected: "PNG" })
  })

  it("detecta JPEG", () => {
    expect(detectFileSignature(JPEG)).toMatchObject({ ok: true, detected: "JPEG" })
  })

  it("detecta GIF", () => {
    expect(detectFileSignature(GIF)).toMatchObject({ ok: true, detected: "GIF" })
  })

  it("detecta WebP (RIFF....WEBP)", () => {
    expect(detectFileSignature(WEBP)).toMatchObject({ ok: true, detected: "WEBP(RIFF)" })
  })

  it("detecta PDF", () => {
    expect(detectFileSignature(PDF)).toMatchObject({ ok: true, detected: "PDF" })
  })

  it("detecta DOC (OLE2)", () => {
    expect(detectFileSignature(OLE2)).toMatchObject({ ok: true, detected: "DOC(OLE2)" })
  })

  it("detecta DOCX (ZIP)", () => {
    expect(detectFileSignature(ZIP)).toMatchObject({ ok: true, detected: "DOCX(ZIP)" })
  })

  it("REJEITA SVG com motivo explícito de XSS", () => {
    const result = detectFileSignature(SVG_MASCARADO)
    expect(result.ok).toBe(false)
    expect(result.reason).toContain("SVG")
    expect(result.reason).toContain("XSS")
  })

  it("rejeita buffer vazio/pequeno", () => {
    expect(detectFileSignature(new Uint8Array(0)).ok).toBe(false)
    expect(detectFileSignature(new Uint8Array([0x00, 0x01])).ok).toBe(false)
  })

  it("rejeita payload arbitrário sem assinatura conhecida", () => {
    const exe = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]) // MZ (PE/EXE)
    expect(detectFileSignature(exe).ok).toBe(false)
  })

  it("rejeita HTML comum (não confunde comentário com conteúdo válido)", () => {
    const html = new TextEncoder().encode("<!DOCTYPE html><html><body>x</body></html>")
    const result = detectFileSignature(html)
    expect(result.ok).toBe(false)
  })

  it("GIF polyglot ainda detecta GIF (cabe ao caller não servir como script)", () => {
    // A defesa contra polyglots é servir com Content-Type correto + nosniff
    // (já configurado). A assinatura existe para bloquear MASCARAÇÃO.
    expect(detectFileSignature(GIF_POLYGLOT)).toMatchObject({ ok: true, detected: "GIF" })
  })
})

describe("validateFileSignature (MIME declarado × conteúdo real)", () => {
  it("aceita PNG declarado com conteúdo PNG", () => {
    expect(validateFileSignature(PNG, "image/png").ok).toBe(true)
  })

  it("EXIGE correspondência exata: image/jpeg com conteúdo PNG é rejeitado (estrito)", () => {
    // Decisão de design: correspondência MIME×assinatura EXATA (não por
    // família). Mínimo convenience, máxima segurança — o usuário re-envia.
    expect(validateFileSignature(PNG, "image/jpeg").ok).toBe(false)
  })

  it("REJEITA image/jpeg com conteúdo PDF (spoofing)", () => {
    const result = validateFileSignature(PDF, "image/jpeg")
    expect(result.ok).toBe(false)
    expect(result.reason).toContain("não corresponde")
  })

  it("REJEITA image/png com conteúdo SVG mascarado", () => {
    expect(validateFileSignature(SVG_MASCARADO, "image/png").ok).toBe(false)
  })

  it("REJEITA MIME não-allowlist mesmo com assinatura válida", () => {
    const result = validateFileSignature(PNG, "text/html")
    expect(result.ok).toBe(false)
    expect(result.reason).toContain("não é permitido")
  })

  it("aceita DOCX (ZIP) com MIME openxml", () => {
    expect(
      validateFileSignature(
        ZIP,
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ).ok,
    ).toBe(true)
  })

  it("REJEITA DOCX (ZIP) com MIME image — cross-family", () => {
    expect(validateFileSignature(ZIP, "image/png").ok).toBe(false)
  })
})
