import { describe, it, expect, beforeEach } from "vitest"
import { useUIStore } from "../ui"

beforeEach(() => {
  useUIStore.setState({
    quoteModal: { open: false },
    bookingModal: { open: false },
    providerModal: { open: false },
    authModal: { open: false, mode: "login", role: "CLIENT" },
    sidebarOpen: false,
  })
})

describe("useUIStore", () => {
  describe("quote modal", () => {
    it("starts closed", () => {
      expect(useUIStore.getState().quoteModal.open).toBe(false)
    })

    it("openQuote sets providerId and opens", () => {
      useUIStore.getState().openQuote({ providerId: "prov-1" })
      const state = useUIStore.getState().quoteModal
      expect(state.open).toBe(true)
      expect(state.providerId).toBe("prov-1")
    })

    it("closeQuote closes modal", () => {
      useUIStore.getState().openQuote({ providerId: "prov-1" })
      useUIStore.getState().closeQuote()
      expect(useUIStore.getState().quoteModal.open).toBe(false)
    })
  })

  describe("booking modal", () => {
    it("starts closed", () => {
      expect(useUIStore.getState().bookingModal.open).toBe(false)
    })

    it("openBooking sets provider and service", () => {
      useUIStore.getState().openBooking({ providerId: "prov-1", serviceId: "svc-1" })
      const state = useUIStore.getState().bookingModal
      expect(state.open).toBe(true)
      expect(state.providerId).toBe("prov-1")
      expect(state.serviceId).toBe("svc-1")
    })
  })

  describe("provider modal", () => {
    it("starts closed", () => {
      expect(useUIStore.getState().providerModal.open).toBe(false)
    })

    it("openProvider opens with providerId", () => {
      useUIStore.getState().openProvider("prov-1")
      const state = useUIStore.getState().providerModal
      expect(state.open).toBe(true)
      expect(state.providerId).toBe("prov-1")
    })
  })

  describe("auth modal", () => {
    it("starts closed with defaults", () => {
      const state = useUIStore.getState().authModal
      expect(state.open).toBe(false)
      expect(state.mode).toBe("login")
      expect(state.role).toBe("CLIENT")
    })

    it("openAuth sets mode and role", () => {
      useUIStore.getState().openAuth("register", "PROVIDER")
      const state = useUIStore.getState().authModal
      expect(state.open).toBe(true)
      expect(state.mode).toBe("register")
      expect(state.role).toBe("PROVIDER")
    })

    it("openAuth uses defaults when not provided", () => {
      useUIStore.getState().openAuth()
      const state = useUIStore.getState().authModal
      expect(state.open).toBe(true)
      expect(state.mode).toBe("login")
      expect(state.role).toBe("CLIENT")
    })
  })

  describe("sidebar", () => {
    it("starts closed", () => {
      expect(useUIStore.getState().sidebarOpen).toBe(false)
    })

    it("setSidebarOpen sets value", () => {
      useUIStore.getState().setSidebarOpen(true)
      expect(useUIStore.getState().sidebarOpen).toBe(true)
    })

    it("toggleSidebar toggles value", () => {
      useUIStore.getState().toggleSidebar()
      expect(useUIStore.getState().sidebarOpen).toBe(true)
      useUIStore.getState().toggleSidebar()
      expect(useUIStore.getState().sidebarOpen).toBe(false)
    })
  })
})
