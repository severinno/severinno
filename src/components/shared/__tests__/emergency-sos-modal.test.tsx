import * as React from "react"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, cleanup } from "@/__tests__/test-utils"

vi.mock("lucide-react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("lucide-react")>()
  const MockIcon = (props: any) => <span data-testid="mock-icon" {...props} />
  return {
    ...actual,
    Droplets: MockIcon,
    Zap: MockIcon,
    Key: MockIcon,
    ShieldAlert: MockIcon,
    Siren: MockIcon,
    MapPin: MockIcon,
    Clock: MockIcon,
    PhoneCall: MockIcon,
    CheckCircle2: MockIcon,
    Sparkles: MockIcon,
    WifiOff: MockIcon,
    MessageSquare: MockIcon,
    Smartphone: MockIcon,
    Send: MockIcon,
  }
})

vi.mock("@/lib/offline-sync", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/offline-sync")>()
  return {
    ...actual,
    queueMutation: vi.fn(),
  }
})

import { EmergencySosModal, buildSosDispatchMessage } from "../emergency-sos-modal"
import * as offlineSync from "@/lib/offline-sync"

describe("EmergencySosModal & Offline PWA SOS Mode", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  describe("buildSosDispatchMessage", () => {
    it("formata a mensagem com cabeçalho de emergência, serviço, valor e GPS", () => {
      const msg = buildSosDispatchMessage({
        emergencyTitle: "Vazamento / Cano Estourado",
        price: "R$ 140,00",
        city: "Governador Valadares",
        neighborhood: "Ilha dos Araújos",
        lat: -18.8548,
        lng: -41.9482,
      })

      expect(msg).toContain("SOS SEVERINNO 24H (EMERGÊNCIA)")
      expect(msg).toContain("Vazamento / Cano Estourado")
      expect(msg).toContain("R$ 140,00")
      expect(msg).toContain("Ilha dos Araújos, Governador Valadares")
      expect(msg).toContain("GPS: -18.85480, -41.94820")
      expect(msg).toContain("App Severinno PWA")
    })
  })

  describe("EmergencySosModal rendering & offline fallback", () => {
    it("renderiza opções de emergência quando o modal está aberto", () => {
      render(<EmergencySosModal open={true} onOpenChange={vi.fn()} />)

      expect(screen.getByText("Severinno Express — SOS 24h")).toBeDefined()
      expect(screen.getByText("Vazamento / Cano Estourado")).toBeDefined()
      expect(screen.getByText("Curto-Circuito / Queda de Energia")).toBeDefined()
      expect(screen.getByText("Chaveiro / Porta Travada")).toBeDefined()
      expect(screen.getByText("Desentupimento Urgente")).toBeDefined()
    })

    it("exibe alerta offline e botões de socorro via SMS e WhatsApp quando desconectado", () => {
      vi.spyOn(navigator, "onLine", "get").mockReturnValue(false)

      render(<EmergencySosModal open={true} onOpenChange={vi.fn()} />)

      expect(screen.getByText("MODO OFFLINE")).toBeDefined()
      expect(screen.getByText("Enviar SOS via SMS (100% Sem Internet)")).toBeDefined()
      expect(screen.getByText("WhatsApp Direto")).toBeDefined()
      expect(screen.getByText("Ligar Central 24h")).toBeDefined()
    })

    it("registra mutação no offline-sync ao acionar socorro offline", () => {
      vi.spyOn(navigator, "onLine", "get").mockReturnValue(false)

      render(<EmergencySosModal open={true} onOpenChange={vi.fn()} />)

      const smsBtn = screen.getByText("Enviar SOS via SMS (100% Sem Internet)")
      fireEvent.click(smsBtn)

      expect(offlineSync.queueMutation).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "EMERGENCY_SOS",
          payload: expect.objectContaining({
            channel: "sms",
            type: "hidraulica",
          }),
        }),
      )
    })
  })
})
