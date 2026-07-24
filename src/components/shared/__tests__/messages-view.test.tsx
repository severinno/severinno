import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"

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
}))

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
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
    render(
      <MessagesView
        emptyTitle="Suas conversas"
        emptyDescription="Test description"
      />,
    )
    expect(screen.getByText("Suas conversas")).toBeDefined()
    expect(screen.getByText("Test description")).toBeDefined()
  })

  it("hides connection status by default", async () => {
    const { MessagesView } = await import("../messages-view")
    render(<MessagesView />)
    expect(screen.queryByText("Online")).toBeNull()
  })
})
