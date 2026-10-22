import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { cleanup, fireEvent, render, screen } from "@/__tests__/test-utils"
import ConvitePage, { generateMetadata } from "../page"
import { ConviteClientTracker, ConviteCodeCopyBadge } from "../convite-client-tracker"

describe("ConvitePage (/convite/[code])", () => {
  afterEach(cleanup)

  it("renders client invitation details for referral code", async () => {
    const page = await ConvitePage({
      params: Promise.resolve({ code: "SEVABC12" }),
      searchParams: Promise.resolve({}),
    })

    render(page)

    expect(screen.getByText("SEVABC12")).toBeInTheDocument()
    expect(screen.getByText(/Você foi convidado para o/i)).toBeInTheDocument()
    expect(screen.getByText("🏠 Convite VIP de Indicação GV")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /Criar Minha Conta e Contratar/i })).toHaveAttribute(
      "href",
      "/register?ref=SEVABC12&role=client",
    )
  })

  it("renders provider invitation when tipo=prestador", async () => {
    const page = await ConvitePage({
      params: Promise.resolve({ code: "SEVPRO99" }),
      searchParams: Promise.resolve({ tipo: "prestador" }),
    })

    render(page)

    expect(screen.getByText("SEVPRO99")).toBeInTheDocument()
    expect(screen.getByText(/Seja um Prestador Parceiro/i)).toBeInTheDocument()
    expect(screen.getByText("🎯 Convite Parceiro Especialista GV")).toBeInTheDocument()
    expect(
      screen.getByRole("link", { name: /Cadastrar como Prestador Parceiro/i }),
    ).toHaveAttribute("href", "/register?ref=SEVPRO99&role=provider")
  })

  it("generates correct metadata for client and provider referrals", async () => {
    const clientMeta = await generateMetadata({
      params: Promise.resolve({ code: "SEV123" }),
      searchParams: Promise.resolve({}),
    })
    expect(clientMeta.title).toBe("Convite Especial SEV123 — Severinno GV")

    const providerMeta = await generateMetadata({
      params: Promise.resolve({ code: "SEV123" }),
      searchParams: Promise.resolve({ tipo: "prestador" }),
    })
    expect(providerMeta.title).toBe("Convite Parceiro Especialista SEV123 — Severinno GV")
  })
})

describe("ConviteClientTracker", () => {
  beforeEach(() => {
    localStorage.clear()
    document.cookie = ""
  })

  it("sets localStorage and cookie with referral code and intent", () => {
    render(<ConviteClientTracker code="SEVWINNER" intentType="client" />)

    expect(localStorage.getItem("severinno_referral_code")).toBe("SEVWINNER")
    expect(localStorage.getItem("severinno_referral_intent")).toBe("client")
    expect(document.cookie).toContain("severinno_referral_code=SEVWINNER")
  })

  it("copies referral code on badge click with accessible button", () => {
    render(<ConviteCodeCopyBadge code="SEVCOPY01" isProvider={false} />)
    const btn = screen.getByRole("button", { name: /Copiar código de convite SEVCOPY01/i })
    expect(btn).toBeInTheDocument()
    fireEvent.click(btn)
    expect(screen.getByText("SEVCOPY01")).toBeInTheDocument()
  })
})
