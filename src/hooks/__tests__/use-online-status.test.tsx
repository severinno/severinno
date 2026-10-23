import * as React from "react"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, act, cleanup } from "@/__tests__/test-utils"
import { useOnlineStatus } from "../use-online-status"

function OnlineStatusConsumer() {
  const isOnline = useOnlineStatus()
  return <span data-testid="status-val">{isOnline ? "online" : "offline"}</span>
}

describe("useOnlineStatus hook", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it("retorna true quando o navegador está online", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true)
    render(<OnlineStatusConsumer />)
    expect(screen.getByTestId("status-val").textContent).toBe("online")
  })

  it("reage dinamicamente aos eventos de offline e online", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true)
    render(<OnlineStatusConsumer />)
    expect(screen.getByTestId("status-val").textContent).toBe("online")

    // Simula desconexão
    act(() => {
      window.dispatchEvent(new Event("offline"))
    })
    expect(screen.getByTestId("status-val").textContent).toBe("offline")

    // Simula reconexão
    act(() => {
      window.dispatchEvent(new Event("online"))
    })
    expect(screen.getByTestId("status-val").textContent).toBe("online")
  })
})
