import { describe, it, expect } from "vitest"
import { passwordChangedHtml, bookingCompletedHtml } from "../mail"

// ===========================================================================
// passwordChangedHtml
// ============================================================================

describe("passwordChangedHtml", () => {
  const defaultOpts = {
    userName: "João Silva",
    email: "joao@example.com",
  }

  it("retorna string HTML não vazia", () => {
    const html = passwordChangedHtml(defaultOpts)
    expect(html).toBeTruthy()
    expect(html.length).toBeGreaterThan(100)
  })

  it("contém DOCTYPE e estrutura HTML completa", () => {
    const html = passwordChangedHtml(defaultOpts)
    expect(html).toContain("<!DOCTYPE html>")
    expect(html).toContain("<html")
    expect(html).toContain("</html>")
  })

  it("contém o nome do usuário", () => {
    const html = passwordChangedHtml(defaultOpts)
    expect(html).toContain("João Silva")
  })

  it("contém o email do usuário", () => {
    const html = passwordChangedHtml(defaultOpts)
    expect(html).toContain("joao@example.com")
  })

  it("contém o título 'Senha alterada' com ícone 🔐", () => {
    const html = passwordChangedHtml(defaultOpts)
    expect(html).toContain("Senha alterada")
    expect(html).toContain("🔐")
  })

  it("contém o texto de confirmação da alteração", () => {
    const html = passwordChangedHtml(defaultOpts)
    expect(html).toContain("foi alterada com sucesso")
  })

  it("contém o alerta de segurança 'Não foi você?'", () => {
    const html = passwordChangedHtml(defaultOpts)
    expect(html).toContain("Não foi você?")
    expect(html).toContain("⚠️")
  })

  it("contém o texto de conta comprometida no alerta", () => {
    const html = passwordChangedHtml(defaultOpts)
    expect(html).toContain("conta pode estar comprometida")
  })

  it("contém o texto de contato com suporte", () => {
    const html = passwordChangedHtml(defaultOpts)
    expect(html).toContain("suporte")
  })

  it("contém a marca Severinno no header", () => {
    const html = passwordChangedHtml(defaultOpts)
    expect(html).toContain("Severinno")
    expect(html).toContain("Marketplace de serviços")
  })

  it("contém o footer com copyright", () => {
    const html = passwordChangedHtml(defaultOpts)
    expect(html).toContain("© 2026 Severinno Marketplace")
    expect(html).toContain("Dúvidas?")
  })

  it("contém a mensagem 'mensagem automática de segurança'", () => {
    const html = passwordChangedHtml(defaultOpts)
    expect(html).toContain("mensagem automática de segurança")
  })

  it("usa o wrapper com gradiente verde (emerald)", () => {
    const html = passwordChangedHtml(defaultOpts)
    expect(html).toContain("#059669") // BRAND_PRIMARY
    expect(html).toContain("#047857") // gradient end
  })

  it("contém o alerta em caixa vermelha (bg #fef2f2)", () => {
    const html = passwordChangedHtml(defaultOpts)
    expect(html).toContain("#fef2f2") // vermelho claro
    expect(html).toContain("#fecaca") // borda vermelha
  })

  it("lida com nome contendo caracteres especiais", () => {
    const html = passwordChangedHtml({
      userName: "João & Maria <3",
      email: "joao@example.com",
    })
    expect(html).toContain("João")
    expect(html).toContain("Maria")
  })

  it("lida com email contendo pontos e símbolos", () => {
    const html = passwordChangedHtml({
      userName: "Teste",
      email: "test.name+tag@sub.domain.com.br",
    })
    expect(html).toContain("test.name+tag@sub.domain.com.br")
  })
})

// ===========================================================================
// bookingCompletedHtml
// ============================================================================

describe("bookingCompletedHtml", () => {
  const defaultOpts = {
    clientName: "Maria Oliveira",
    providerName: "João Silva",
    serviceName: "Limpeza Residencial",
    reviewUrl: "https://severinno.com.br/?view=client.reviews",
  }

  it("retorna string HTML não vazia", () => {
    const html = bookingCompletedHtml(defaultOpts)
    expect(html).toBeTruthy()
    expect(html.length).toBeGreaterThan(100)
  })

  it("contém DOCTYPE e estrutura HTML completa", () => {
    const html = bookingCompletedHtml(defaultOpts)
    expect(html).toContain("<!DOCTYPE html>")
    expect(html).toContain("<html")
    expect(html).toContain("</html>")
  })

  it("contém o título 'Serviço concluído! ✅'", () => {
    const html = bookingCompletedHtml(defaultOpts)
    expect(html).toContain("Serviço concluído!")
    expect(html).toContain("✅")
  })

  it("contém o nome do cliente", () => {
    const html = bookingCompletedHtml(defaultOpts)
    expect(html).toContain("Maria Oliveira")
  })

  it("contém o nome do prestador", () => {
    const html = bookingCompletedHtml(defaultOpts)
    expect(html).toContain("João Silva")
  })

  it("contém o nome do serviço", () => {
    const html = bookingCompletedHtml(defaultOpts)
    expect(html).toContain("Limpeza Residencial")
  })

  it("contém o texto 'concluído com sucesso'", () => {
    const html = bookingCompletedHtml(defaultOpts)
    expect(html).toContain("concluído com sucesso")
  })

  it("contém o texto pedindo avaliação", () => {
    const html = bookingCompletedHtml(defaultOpts)
    expect(html).toContain("Sua opinião é muito importante")
    expect(html).toContain("Avalie o serviço")
  })

  it("contém o link de avaliação (reviewUrl) no botão CTA", () => {
    const html = bookingCompletedHtml(defaultOpts)
    expect(html).toContain("https://severinno.com.br/?view=client.reviews")
  })

  it("contém o texto do botão 'Avaliar serviço'", () => {
    const html = bookingCompletedHtml(defaultOpts)
    expect(html).toContain("Avaliar serviço")
  })

  it("contém a mensagem sobre exibição pública da avaliação", () => {
    const html = bookingCompletedHtml(defaultOpts)
    expect(html).toContain("exibida publicamente")
    expect(html).toContain("perfil do prestador")
  })

  it("contém a marca Severinno no header", () => {
    const html = bookingCompletedHtml(defaultOpts)
    expect(html).toContain("Severinno")
    expect(html).toContain("Marketplace de serviços")
  })

  it("contém o footer com copyright", () => {
    const html = bookingCompletedHtml(defaultOpts)
    expect(html).toContain("© 2026 Severinno Marketplace")
    expect(html).toContain("Dúvidas?")
  })

  it("usa o wrapper com gradiente verde (emerald)", () => {
    const html = bookingCompletedHtml(defaultOpts)
    expect(html).toContain("#059669") // BRAND_PRIMARY
    expect(html).toContain("#047857") // gradient end
  })

  it("lida com nome de cliente contendo caracteres especiais", () => {
    const html = bookingCompletedHtml({
      clientName: "João & Maria <3",
      providerName: "Prestador & Cia <Teste>",
      serviceName: "Design Gráfico",
      reviewUrl: "https://severinno.com.br/?view=client.reviews",
    })
    expect(html).toContain("João")
    expect(html).toContain("Maria")
    expect(html).toContain("Prestador")
  })

  it("lida com reviewUrl contendo query params complexos", () => {
    const html = bookingCompletedHtml({
      clientName: "Teste",
      providerName: "Prestador",
      serviceName: "Serviço X",
      reviewUrl: "https://severinno.com.br/?view=client.reviews&bookingId=abc-123&rating=5",
    })
    expect(html).toContain("bookingId=abc-123")
    expect(html).toContain("rating=5")
  })

  it("não contém placeholders não substituídos", () => {
    const html = bookingCompletedHtml(defaultOpts)
    expect(html).not.toContain("${opts.")
    expect(html).not.toContain("undefined")
  })
})
