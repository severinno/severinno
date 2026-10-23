import * as React from "react"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@/__tests__/test-utils"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { PresenceTokenDialog } from "../presence-token-dialog"

vi.mock("@/lib/haptics", () => ({
  triggerHaptic: vi.fn(),
}))

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
}))

describe("PresenceTokenDialog", () => {
  let queryClient: QueryClient

  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = vi.fn()
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
  })

  it("fetches and renders 6-digit presence code when opened", async () => {
    ;(global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: { token: "654321", expiresAt: "2026-01-01T00:15:00Z" },
      }),
    })

    render(
      <QueryClientProvider client={queryClient}>
        <PresenceTokenDialog
          open={true}
          onOpenChange={vi.fn()}
          bookingId="b-200"
          serviceTitle="Pintura de Parede"
          providerName="Marcos Pintor"
        />
      </QueryClientProvider>,
    )

    expect(screen.getByText("Código de Presença")).toBeDefined()
    expect(screen.getByText(/Marcos Pintor/)).toBeDefined()

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/bookings/checkin-escrow",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining("generate-presence-token"),
        }),
      )
      // Formatted as "654 · 321"
      expect(screen.getByText(/654 · 321/)).toBeDefined()
    })
  })
})
