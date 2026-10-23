import * as React from "react"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, act, cleanup } from "@/__tests__/test-utils"
import { usePWAInstall, type BeforeInstallPromptEvent } from "../use-pwa-install"

function TestPWAComponent() {
  const { canInstall, isInstalled, isIOS, isDismissed, promptInstall, dismiss, resetDismiss } =
    usePWAInstall({ storageKey: "test_pwa_dismiss" })

  return (
    <div>
      <span data-testid="can-install">{canInstall ? "yes" : "no"}</span>
      <span data-testid="is-installed">{isInstalled ? "yes" : "no"}</span>
      <span data-testid="is-ios">{isIOS ? "yes" : "no"}</span>
      <span data-testid="is-dismissed">{isDismissed ? "yes" : "no"}</span>
      <button data-testid="install-btn" onClick={() => promptInstall()}>
        Install
      </button>
      <button data-testid="dismiss-btn" onClick={() => dismiss()}>
        Dismiss
      </button>
      <button data-testid="reset-btn" onClick={() => resetDismiss()}>
        Reset
      </button>
    </div>
  )
}

describe("usePWAInstall", () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.restoreAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it("initializes with default non-installed and non-installable state", () => {
    render(<TestPWAComponent />)
    expect(screen.getByTestId("can-install").textContent).toBe("no")
    expect(screen.getByTestId("is-installed").textContent).toBe("no")
    expect(screen.getByTestId("is-dismissed").textContent).toBe("no")
  })

  it("handles beforeinstallprompt event and triggers promptInstall", async () => {
    render(<TestPWAComponent />)
    expect(screen.getByTestId("can-install").textContent).toBe("no")

    const mockPrompt = vi.fn().mockResolvedValue(undefined)
    const promptEvent = new Event("beforeinstallprompt") as BeforeInstallPromptEvent
    promptEvent.prompt = mockPrompt
    promptEvent.userChoice = Promise.resolve({ outcome: "accepted" })

    act(() => {
      window.dispatchEvent(promptEvent)
    })

    expect(screen.getByTestId("can-install").textContent).toBe("yes")

    await act(async () => {
      screen.getByTestId("install-btn").click()
    })

    expect(mockPrompt).toHaveBeenCalledOnce()
    expect(screen.getByTestId("can-install").textContent).toBe("no")
  })

  it("manages dismissal and localStorage persistence", () => {
    render(<TestPWAComponent />)
    expect(screen.getByTestId("is-dismissed").textContent).toBe("no")

    act(() => {
      screen.getByTestId("dismiss-btn").click()
    })

    expect(screen.getByTestId("is-dismissed").textContent).toBe("yes")
    expect(window.localStorage.getItem("test_pwa_dismiss")).toBeTruthy()

    act(() => {
      screen.getByTestId("reset-btn").click()
    })

    expect(screen.getByTestId("is-dismissed").textContent).toBe("no")
    expect(window.localStorage.getItem("test_pwa_dismiss")).toBeNull()
  })

  it("detects standalone mode", () => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      configurable: true,
      value: vi.fn().mockImplementation((query) => ({
        matches: query === "(display-mode: standalone)",
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    })

    render(<TestPWAComponent />)
    expect(screen.getByTestId("is-installed").textContent).toBe("yes")
    expect(screen.getByTestId("can-install").textContent).toBe("no")
  })

  it("tracks engagement visits and requires 2+ visits when configured", () => {
    function EngagementTestComponent() {
      const { hasEngagement, visitCount } = usePWAInstall({ minVisits: 2 })
      return (
        <div>
          <span data-testid="has-engagement">{hasEngagement ? "yes" : "no"}</span>
          <span data-testid="visit-count">{visitCount}</span>
        </div>
      )
    }

    // First visit
    window.localStorage.clear()
    window.sessionStorage.clear()
    const { unmount } = render(<EngagementTestComponent />)
    expect(screen.getByTestId("visit-count").textContent).toBe("1")
    expect(screen.getByTestId("has-engagement").textContent).toBe("no")
    unmount()

    // Second visit (new session)
    window.sessionStorage.clear()
    render(<EngagementTestComponent />)
    expect(screen.getByTestId("visit-count").textContent).toBe("2")
    expect(screen.getByTestId("has-engagement").textContent).toBe("yes")
  })
})
