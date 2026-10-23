import * as React from "react"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, act, cleanup } from "@/__tests__/test-utils"
import { useOfflineSync } from "../use-offline-sync"

function OfflineSyncConsumer() {
  const { isOnline, summary, enqueueEvidence, isSyncing } = useOfflineSync()

  return (
    <div>
      <span data-testid="is-online">{isOnline ? "true" : "false"}</span>
      <span data-testid="is-syncing">{isSyncing ? "true" : "false"}</span>
      <span data-testid="total-pending">{summary.totalPending}</span>
      <span data-testid="photos-pending">{summary.photosPending}</span>
      <span data-testid="checkins-pending">{summary.checkinsPending}</span>
      <button
        data-testid="add-photo-btn"
        onClick={() => {
          enqueueEvidence({
            bookingId: "b-123",
            providerId: "p-456",
            type: "BEFORE_PHOTO",
            photoBase64: "data:image/jpeg;base64,abc12345",
          })
        }}
      >
        Add Photo
      </button>
      <button
        data-testid="add-checkin-btn"
        onClick={() => {
          enqueueEvidence({
            bookingId: "b-123",
            providerId: "p-456",
            type: "CHECKIN",
            latitude: -18.851,
            longitude: -41.949,
            accuracy: 5,
          })
        }}
      >
        Add Checkin
      </button>
    </div>
  )
}

describe("useOfflineSync hook", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.stubGlobal("fetch", vi.fn())
  })

  afterEach(() => {
    cleanup()
  })

  it("inicializa com status de conectividade do navegador", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true)
    await act(async () => {
      render(<OfflineSyncConsumer />)
    })
    expect(screen.getByTestId("is-online").textContent).toBe("true")
    expect(screen.getByTestId("is-syncing").textContent).toBe("false")
  })

  it("enfileira evidência de foto e atualiza o resumo da fila", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false)
    await act(async () => {
      render(<OfflineSyncConsumer />)
    })

    await act(async () => {
      screen.getByTestId("add-photo-btn").click()
    })

    expect(screen.getByTestId("total-pending").textContent).toBe("1")
    expect(screen.getByTestId("photos-pending").textContent).toBe("1")
    expect(screen.getByTestId("checkins-pending").textContent).toBe("0")
  })

  it("enfileira evidência de check-in geográfico", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false)
    await act(async () => {
      render(<OfflineSyncConsumer />)
    })

    await act(async () => {
      screen.getByTestId("add-checkin-btn").click()
    })

    expect(Number(screen.getByTestId("total-pending").textContent)).toBeGreaterThanOrEqual(1)
    expect(Number(screen.getByTestId("checkins-pending").textContent)).toBeGreaterThanOrEqual(1)
  })

  it("reage ao evento offline e online da janela", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true)
    await act(async () => {
      render(<OfflineSyncConsumer />)
    })

    await act(async () => {
      window.dispatchEvent(new Event("offline"))
    })
    expect(screen.getByTestId("is-online").textContent).toBe("false")

    await act(async () => {
      window.dispatchEvent(new Event("online"))
    })
    expect(screen.getByTestId("is-online").textContent).toBe("true")
  })
})
