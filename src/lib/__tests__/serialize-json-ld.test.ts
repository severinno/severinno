import { describe, it, expect } from "vitest"
import { serializeJsonLd } from "@/lib/sanitize"

describe("serializeJsonLd — JSON-LD seguro dentro de <script>", () => {
  it("não deixa nenhum '<' cru capaz de fechar a tag </script>", () => {
    const payload = { addressLocality: "</script><script>alert(1)</script>" }
    const out = serializeJsonLd(payload)
    expect(out).not.toContain("<")
    expect(out).not.toContain(">")
    expect(out.toLowerCase()).not.toContain("</script")
  })

  it("é reversível: JSON.parse devolve exatamente o valor original", () => {
    const payload = {
      name: "Zé & Filhos <Elétrica>",
      city: "Gov. Valadares",
      note: "linha\u2028separada\u2029aqui",
    }
    expect(JSON.parse(serializeJsonLd(payload))).toEqual(payload)
  })

  it("escapa '&' para impedir entidades HTML ambíguas", () => {
    expect(serializeJsonLd({ a: "x&y" })).toBe('{"a":"x\\u0026y"}')
  })

  it("mantém objetos sem caracteres especiais idênticos ao JSON.stringify", () => {
    const payload = { "@context": "https://schema.org", "@type": "LocalBusiness", rating: 4.8 }
    expect(serializeJsonLd(payload)).toBe(JSON.stringify(payload))
  })
})
