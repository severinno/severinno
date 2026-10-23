import { describe, it, expect, vi } from "vitest"
import React from "react"

const { payBooking, apiGet } = vi.hoisted(() => ({ payBooking: vi.fn(), apiGet: vi.fn() }))

vi.mock("@/lib/api", () => ({ apiGet, payBooking, newIdempotencyKey: () => "key-12345678" }))
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock("@/lib/sounds", () => ({ playCoinSound: vi.fn() }))
vi.mock("lucide-react", () => ({
  QrCode: () => <svg />,
  Copy: () => <svg />,
  Check: () => <svg />,
  Loader2: () => <svg />,
  CheckCircle2: () => <svg />,
  Clock: () => <svg />,
  AlertTriangle: () => <svg />,
  RefreshCw: () => <svg />,
  Smartphone: () => <svg />,
}))

import { render, screen, cleanup } from "@/__tests__/test-utils"
import { PixCheckout } from "../pix-checkout"

afterEach(() => cleanup())

describe("debug2", () => {
  it("monta o botão inicial", () => {
    render(React.createElement(PixCheckout, { bookingId: "book-1", amount: 200 }))
    console.log("BODY:", document.body.innerHTML.slice(0, 300))
    expect(screen.getByRole("button", { name: /Gerar QR Code PIX/i })).toBeTruthy()
  })
})
