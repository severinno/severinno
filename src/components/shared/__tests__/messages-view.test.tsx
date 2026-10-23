import { describe, it, expect, vi, afterEach } from "vitest"
import { cleanup, render, screen } from "@/__tests__/test-utils"

vi.mock("lucide-react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("lucide-react")>()
  const MockIcon = (props: React.SVGProps<SVGSVGElement>) => (
    <svg data-testid="mock-icon" {...props} />
  )
  return {
    ...actual,
    Send: MockIcon,
    MessagesSquare: MockIcon,
    Loader2: MockIcon,
  }
})

vi.mock("@/store/auth", () => ({
  useAuthStore: vi.fn((selector) => {
    const state = { user: null, status: "unauthenticated" }
    return selector ? selector(state) : state
  }),
}))

vi.mock("@/hooks/use-realtime", () => ({
  useRealtime: () => ({
    isConnected: true,
    on: vi.fn(() => vi.fn()),
    join: vi.fn(),
  }),
}))

vi.mock("@tanstack/react-query", () => ({
  useQuery: vi.fn().mockReturnValue({ data: [], isLoading: false }),
  useQueryClient: vi.fn().mockReturnValue({ invalidateQueries: vi.fn() }),
}))

vi.mock("@/lib/api", () => ({
  apiGet: vi.fn().mockResolvedValue({ items: [] }),
  apiPost: vi.fn().mockResolvedValue({}),
}))

vi.mock("@/lib/format", () => ({
  formatRelative: vi.fn(() => "há 1 dia"),
  formatBRL: vi.fn((val: number | string) => `R$ ${Number(val).toFixed(2).replace(".", ",")}`),
}))

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))

afterEach(cleanup)

describe("MessagesView", () => {
  it("renders empty state with default title", async () => {
    const { MessagesView } = await import("../messages-view")
    render(<MessagesView />)
    expect(screen.getByText("Suas mensagens")).toBeDefined()
  })

  it("renders with custom empty title and description", async () => {
    const { MessagesView } = await import("../messages-view")
    render(<MessagesView emptyTitle="Suas conversas" emptyDescription="Test description" />)
    expect(screen.getByText("Suas conversas")).toBeDefined()
    expect(screen.getByText("Test description")).toBeDefined()
  })

  it("hides connection status by default", async () => {
    const { MessagesView } = await import("../messages-view")
    render(<MessagesView />)
    expect(screen.queryByText("Online")).toBeNull()
  })

  it("parses and serializes chat proposals accurately", async () => {
    const { parseChatProposal, serializeChatProposal } = await import("../messages-view")
    const sampleProposal = {
      title: "Instalação de Tomada 20A",
      amount: 120,
      description: "Material incluso e teste de carga.",
      estimatedTime: "1 hora",
    }
    const serialized = serializeChatProposal(sampleProposal)
    expect(serialized).toContain("[SEVERINNO_PROPOSAL:")
    expect(serialized).toContain("Instalação de Tomada 20A")

    const parsed = parseChatProposal(serialized)
    expect(parsed).not.toBeNull()
    expect(parsed?.title).toBe("Instalação de Tomada 20A")
    expect(parsed?.amount).toBe(120)
    expect(parsed?.estimatedTime).toBe("1 hora")
    expect(parsed?.status).toBe("PENDING")
  })

  it("exports valid FIELD_QUICK_REPLIES shortcuts", async () => {
    const { FIELD_QUICK_REPLIES } = await import("../messages-view")
    expect(FIELD_QUICK_REPLIES).toHaveLength(5)
    expect(FIELD_QUICK_REPLIES[0].label).toContain("A caminho")
    expect(FIELD_QUICK_REPLIES[1].label).toContain("Cheguei")
    expect(FIELD_QUICK_REPLIES[2].label).toContain("Iniciando")
    expect(FIELD_QUICK_REPLIES[3].label).toContain("Fotos registradas")
    expect(FIELD_QUICK_REPLIES[4].label).toContain("Concluído")
  })

  it("passes axe accessibility checks with 0 violations", async () => {
    const { axe } = await import("vitest-axe")
    const { MessagesView } = await import("../messages-view")
    const { container } = render(<MessagesView />)
    const results = await axe(container)
    expect(results.violations).toHaveLength(0)
  })
})
