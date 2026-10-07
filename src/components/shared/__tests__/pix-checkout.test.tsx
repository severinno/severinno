/**
 * Tests for PixCheckout — tratamento dos erros 409 de idempotência na UI.
 *
 * Cenários:
 *   - IDEMPOTENCY_IN_FLIGHT → NÃO mostra erro: recupera via status endpoint
 *     (a 1ª tentativa pode ter criado a cobrança antes de perder a resposta)
 *     e volta para "awaiting" com o QR existente.
 *   - IN_FLIGHT persistente → card "Pagamento ainda em andamento" após as
 *     tentativas de recuperação.
 *   - IDEMPOTENCY_FAILED / CONFLICT → card amigável; retry regenera a chave
 *     (a chamada seguinte vai com Idempotency-Key NOVA).
 *   - Erro genérico (ex. Lytex 400) → mostra a mensagem do servidor.
 *
 * Mocks LOCAIS sobrescrevem o setup global da vitrine (que mocka @/lib/api
 * só com funções de geo).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import React from "react"

// ── Hoisted mocks ──────────────────────────────────────────────────────────

const { payBooking, apiGet, toast, playCoinSound } = vi.hoisted(() => ({
  payBooking: vi.fn(),
  apiGet: vi.fn(),
  toast: { error: vi.fn(), success: vi.fn() },
  playCoinSound: vi.fn(),
}))

vi.mock("@/lib/api", () => ({
  apiGet,
  payBooking,
  newIdempotencyKey: () => `key-${Math.random().toString(36).slice(2, 10)}`,
}))

vi.mock("sonner", () => ({ toast }))
vi.mock("@/lib/sounds", () => ({ playCoinSound }))

// O setup global da vitrine mocka lucide-react com lista fixa (sem os ícones
// do checkout) — mock local com os que o PixCheckout importa.
vi.mock("lucide-react", () => ({
  QrCode: () => <svg data-testid="icon-qr" />,
  Copy: () => <svg />,
  Check: () => <svg />,
  Loader2: () => <svg data-testid="icon-loading" />,
  CheckCircle2: () => <svg />,
  Clock: () => <svg />,
  AlertTriangle: () => <svg />,
  RefreshCw: () => <svg />,
  Smartphone: () => <svg />,
}))

// ── Imports ────────────────────────────────────────────────────────────────

import { PixCheckout } from "../pix-checkout"
import { render, screen, fireEvent, cleanup, waitFor } from "@/__tests__/test-utils"

afterEach(() => cleanup())

function apiErr(status: number, body: unknown): unknown {
  return {
    status,
    message:
      typeof body === "object" && body !== null && "error" in body
        ? String((body as { error: string }).error)
        : `Erro ${status}`,
    data: body,
  }
}

function renderCheckout(): void {
  render(React.createElement(PixCheckout, { bookingId: "book-1", amount: 200 }))
}

function startCheckout(): void {
  fireEvent.click(screen.getByRole("button", { name: /Gerar QR Code PIX/i }))
}

async function clickStart(): Promise<void> {
  renderCheckout()
  startCheckout() // fireEvent já é act-wrapped; promises resolvem no waitFor
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ── IN_FLIGHT com recuperação automática ───────────────────────────────────

describe("PixCheckout — IDEMPOTENCY_IN_FLIGHT", () => {
  it("recupera via status endpoint e volta ao awaiting com o QR existente", async () => {
    payBooking.mockRejectedValueOnce(
      apiErr(409, { error: "Pagamento já em processamento", code: "IDEMPOTENCY_IN_FLIGHT" }),
    )
    apiGet.mockResolvedValueOnce({
      paymentStatus: "PENDING",
      payment: { status: "PENDING", qrCode: "pix-qr-original", qrCodeImage: "img://qr" },
    })

    await clickStart()

    // O QR reaproveitado aparece na <img> (o código cru não é texto renderizado)
    await waitFor(() => {
      expect(screen.getByAltText("QR Code PIX").getAttribute("src")).toBe("img://qr")
    })
    // NÃO mostra card de erro
    expect(screen.queryByText("Pagamento já em andamento")).toBeNull()
    // Volta ao fluxo normal de aguardar pagamento
    expect(screen.getByText(/Aguardando confirmação automática/)).toBeTruthy()
  })

  it("IN_FLIGHT persistente → card amigável 'Pagamento ainda em andamento'", async () => {
    payBooking.mockRejectedValue(
      apiErr(409, { error: "Pagamento já em processamento", code: "IDEMPOTENCY_IN_FLIGHT" }),
    )
    // Recuperação nunca acha QR (status sem payment)
    apiGet.mockResolvedValue({ paymentStatus: "PENDING", payment: null })

    await clickStart()
    // Avança os 3 retries de recuperação (2s cada, em setTimeout reais do jsdom)
    await vi.waitFor(
      () => {
        expect(screen.getByText("Pagamento ainda em andamento")).toBeTruthy()
      },
      { timeout: 10_000 },
    )
    expect(toast.error).not.toHaveBeenCalledWith(
      expect.stringContaining("IDEMPOTENCY"),
      expect.anything(),
    )
  })

  it("status confirma PAID durante a recuperação → estado confirmed", async () => {
    payBooking.mockRejectedValueOnce(apiErr(409, { error: "x", code: "IDEMPOTENCY_IN_FLIGHT" }))
    apiGet.mockResolvedValueOnce({ paymentStatus: "PAID", payment: { status: "PAID" } })

    await clickStart()

    await waitFor(() => {
      expect(screen.getByText("Pagamento confirmado!")).toBeTruthy()
    })
    expect(playCoinSound).toHaveBeenCalled()
    expect(toast.success).toHaveBeenCalled()
  })
})

// ── FAILED / CONFLICT → retry com chave nova ───────────────────────────────

describe("PixCheckout — IDEMPOTENCY_FAILED / CONFLICT", () => {
  it("FAILED → card amigável com a mensagem específica", async () => {
    payBooking.mockRejectedValueOnce(
      apiErr(409, { error: "Tentativa anterior falhou: Lytex caiu", code: "IDEMPOTENCY_FAILED" }),
    )

    await clickStart()

    await waitFor(() => {
      expect(screen.getByText("A tentativa anterior falhou")).toBeTruthy()
    })
    expect(screen.getByText(/nova tentativa de pagamento/i)).toBeTruthy()
    expect(screen.getByRole("button", { name: /Tentar novamente/i })).toBeTruthy()
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("A tentativa anterior falhou"))
  })

  it("CONFLICT → retry regenera a chave (nova intenção de pagamento)", async () => {
    payBooking.mockRejectedValueOnce(
      apiErr(409, { error: "Idempotency-Key já usada", code: "IDEMPOTENCY_CONFLICT" }),
    )
    payBooking.mockResolvedValueOnce({
      paymentMethod: "PIX",
      status: "PENDING",
      qrCode: "pix-novo",
      qrCodeImage: "img://novo",
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    })

    await clickStart()
    await waitFor(() => {
      expect(screen.getByText("Tentativa de pagamento inválida")).toBeTruthy()
    })

    // Retry: paga o botão "Iniciar nova tentativa"
    fireEvent.click(screen.getByRole("button", { name: /Iniciar nova tentativa/i }))

    await waitFor(() => {
      expect(screen.getByAltText("QR Code PIX").getAttribute("src")).toBe("img://novo")
    })
    expect(screen.getByText(/Aguardando confirmação automática/)).toBeTruthy()
  })

  it("erro genérico do Lytex mostra a mensagem do servidor (não mais 'instanceof Error')", async () => {
    payBooking.mockRejectedValueOnce(apiErr(400, { error: "Lytex: Saldo insuficiente na conta" }))

    await clickStart()

    await waitFor(() => {
      expect(screen.getByText(/Lytex: Saldo insuficiente na conta/)).toBeTruthy()
    })
    expect(screen.getByRole("button", { name: /Tentar novamente/i })).toBeTruthy()
  })
})
