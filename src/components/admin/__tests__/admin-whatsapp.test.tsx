import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@/__tests__/test-utils"
import { AdminWhatsApp, type WhatsAppStatusResponse } from "../admin-whatsapp"
import { useQuery, useMutation } from "@tanstack/react-query"

const { MockIcon } = vi.hoisted(() => {
  const Icon = (props: any) => <span data-testid="mock-icon" {...props} />
  return { MockIcon: Icon }
})

vi.mock("lucide-react", () => ({
  MessageSquare: MockIcon,
  QrCode: MockIcon,
  CheckCircle2: MockIcon,
  AlertTriangle: MockIcon,
  RefreshCw: MockIcon,
  Send: MockIcon,
  LogOut: MockIcon,
  Smartphone: MockIcon,
  ShieldCheck: MockIcon,
  Activity: MockIcon,
  Layers: MockIcon,
  PhoneCall: MockIcon,
  Loader2: MockIcon,
  History: MockIcon,
  CheckCheck: MockIcon,
  Clock: MockIcon,
  XCircle: MockIcon,
  Megaphone: MockIcon,
  Users: MockIcon,
  FileText: MockIcon,
}))

vi.mock("@tanstack/react-query", () => ({
  useQuery: vi.fn(),
  useMutation: vi.fn(),
  useQueryClient: vi.fn(() => ({
    invalidateQueries: vi.fn(),
  })),
}))

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

describe("AdminWhatsApp Component", () => {
  const mockRefetch = vi.fn()
  const mockMutate = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    ;(useMutation as any).mockReturnValue({
      mutate: mockMutate,
      isPending: false,
    })
  })

  it("renderiza esqueleto de loading quando isLoading = true", () => {
    ;(useQuery as any).mockReturnValue({
      data: undefined,
      isLoading: true,
      isFetching: false,
      refetch: mockRefetch,
    })

    const { container } = render(<AdminWhatsApp />)
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0)
  })

  it("renderiza QR code e instruções quando status = connecting", () => {
    const mockData: WhatsAppStatusResponse = {
      instance: {
        name: "severinno",
        id: "inst-1",
        status: "connecting",
        number: null,
        profileName: null,
        profilePicUrl: null,
        integration: "WHATSAPP-BAILEYS",
        counts: { Message: 0, Contact: 0, Chat: 0 },
      },
      qrcode: {
        base64: "data:image/png;base64,mockcode",
        code: "mock-code",
        count: 5,
      },
      webhook: {
        enabled: true,
        url: "https://severinno.com/api/webhooks/evolution",
        events: ["MESSAGES_UPSERT"],
      },
      server: {
        url: "https://whatsapp.severinno.com",
        version: "v2.3.7",
      },
    }

    ;(useQuery as any).mockReturnValue({
      data: mockData,
      isLoading: false,
      isFetching: false,
      refetch: mockRefetch,
    })

    render(<AdminWhatsApp />)

    expect(screen.getByText("Aguardando Leitura do QR Code")).toBeDefined()
    expect(screen.getByText("CONNECTING")).toBeDefined()
    expect(screen.getByAltText("WhatsApp QR Code")).toBeDefined()
    expect(screen.getByText("Disparo de Mensagem de Teste")).toBeDefined()
  })

  it("renderiza status operacional e dados do telefone quando status = open", () => {
    const mockData: WhatsAppStatusResponse = {
      instance: {
        name: "severinno",
        id: "inst-1",
        status: "open",
        number: "5511999999999",
        profileName: "Severinno Oficial",
        profilePicUrl: null,
        integration: "WHATSAPP-BAILEYS",
        counts: { Message: 150, Contact: 42, Chat: 30 },
      },
      qrcode: null,
      webhook: {
        enabled: true,
        url: "https://severinno.com/api/webhooks/evolution",
        events: ["MESSAGES_UPSERT"],
      },
      server: {
        url: "https://whatsapp.severinno.com",
        version: "v2.3.7",
      },
    }

    ;(useQuery as any).mockReturnValue({
      data: mockData,
      isLoading: false,
      isFetching: false,
      refetch: mockRefetch,
    })

    render(<AdminWhatsApp />)

    expect(screen.getByText("Conectado e Operacional")).toBeDefined()
    expect(screen.getByText("OPEN")).toBeDefined()
    expect(screen.getAllByText("+5511999999999").length).toBeGreaterThan(0)
    expect(screen.getByText("Aparelho Pareado com Sucesso")).toBeDefined()
    expect(screen.getByText("150")).toBeDefined() // Messages count
  })
})
