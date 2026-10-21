import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor, cleanup } from "@/__tests__/test-utils"
import { OfflineSimulationToggle } from "../offline-simulation-toggle"
import { clearOfflineQueue, getPendingMutations } from "@/lib/offline-sync"
import { toast } from "sonner"

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}))

describe("OfflineSimulationToggle", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearOfflineQueue()
    sessionStorage.clear()
  })

  afterEach(() => {
    clearOfflineQueue()
    sessionStorage.clear()
    cleanup()
  })

  it("renderiza o estado inicial conectado com botão Simular Offline", () => {
    render(<OfflineSimulationToggle />)
    expect(screen.getByRole("button", { name: /simular offline/i })).toBeDefined()
  })

  it("alterna para modo offline ao clicar no botão de simulação", async () => {
    render(<OfflineSimulationToggle />)

    const toggleBtn = screen.getByRole("button", { name: /simular offline/i })
    fireEvent.click(toggleBtn)

    expect(screen.getByText(/offline \(simulado\)/i)).toBeDefined()
    expect(screen.getByRole("region", { name: /painel de simulação offline/i })).toBeDefined()
    expect(toast.warning).toHaveBeenCalledWith("Modo Simulação Offline Ativado", expect.any(Object))
  })

  it("permite simular ações de campo e enfileira no storage local", async () => {
    render(<OfflineSimulationToggle />)

    // Ativa simulação
    fireEvent.click(screen.getByRole("button", { name: /simular offline/i }))

    // Clica em Simular Check-in
    const checkinBtn = screen.getByText(/simular check-in gps/i)
    fireEvent.click(checkinBtn)

    const pending = getPendingMutations()
    expect(pending.length).toBe(1)
    expect(pending[0].action).toBe("CHECKIN")
    expect(pending[0].payload).toMatchObject({
      location: "Governador Valadares, MG",
    })
    expect(toast.success).toHaveBeenCalledWith(
      expect.stringContaining("Check-in Presencial"),
      expect.any(Object),
    )
  })

  it("despacha fila e notifica sucesso ao reconectar ou sincronizar", async () => {
    const onSyncComplete = vi.fn()
    render(<OfflineSimulationToggle onSyncComplete={onSyncComplete} />)

    // Ativa offline e enfileira 1 ação
    fireEvent.click(screen.getByRole("button", { name: /simular offline/i }))
    fireEvent.click(screen.getByText(/simular conclusão de serviço/i))

    expect(getPendingMutations().length).toBe(1)

    // Clica em sincronizar fila
    const syncBtn = screen.getByText(/sincronizar fila \(1\)/i)
    fireEvent.click(syncBtn)

    await waitFor(() => {
      expect(onSyncComplete).toHaveBeenCalledWith({ succeeded: 1, failed: 0 })
      expect(toast.success).toHaveBeenCalledWith("Sincronização PWA Concluída!", expect.any(Object))
    })

    expect(getPendingMutations().length).toBe(0)
  })
})
