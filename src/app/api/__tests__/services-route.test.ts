import { describe, it, expect, vi, beforeEach } from "vitest"
import { GET } from "../services/route"
import { GET as GET_DETAIL } from "../services/[id]/route"
import { createMockRequest } from "@/lib/__tests__/helpers/api-test-utils"

const { mockServices, mockServiceDetail } = vi.hoisted(() => ({
  mockServices: [
    {
      id: "svc-1",
      title: "Limpeza Residencial",
      description: "Limpeza completa",
      priceCents: 10000,
      active: true,
      categoryId: "cat-1",
      providerId: "prov-1",
      createdAt: new Date("2026-07-01"),
      category: { id: "cat-1", name: "Doméstico", slug: "domestico" },
      provider: { id: "prov-1", name: "Maria", avatarUrl: null, city: "São Paulo", state: "SP", verified: true },
    },
    {
      id: "svc-2",
      title: "Pintura",
      description: "Pintura de paredes",
      priceCents: 20000,
      active: true,
      categoryId: "cat-2",
      providerId: "prov-2",
      createdAt: new Date("2026-06-15"),
      category: { id: "cat-2", name: "Reforma", slug: "reforma" },
      provider: { id: "prov-2", name: "João", avatarUrl: null, city: "São Paulo", state: "SP", verified: true },
    },
  ],
  mockServiceDetail: {
    id: "svc-1",
    title: "Limpeza Residencial",
    description: "Limpeza completa",
    priceCents: 10000,
    active: true,
    categoryId: "cat-1",
    providerId: "prov-1",
    category: { id: "cat-1", name: "Doméstico", slug: "domestico" },
    provider: { id: "prov-1", name: "Maria", avatarUrl: null, city: "São Paulo", state: "SP", verified: true, whatsapp: "11999999999" },
  },
}))

const mockDb = vi.hoisted(() => ({
  service: { findMany: vi.fn(), findUnique: vi.fn() },
}))

vi.mock("@/lib/redis", () => ({
  withCache: vi.fn((_key: string, fn: () => Promise<unknown>) => fn()),
  cacheInvalidate: vi.fn(),
}))

vi.mock("@/lib/api-server", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...(actual as Record<string, unknown>),
    cacheControlPublic: vi.fn((response: Response) => response),
    syncServiceSearch: vi.fn(),
  }
})

vi.mock("@/lib/db", () => ({ default: mockDb, db: mockDb }))
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn() }))
vi.mock("@/lib/validators", () => ({ serviceSchema: { parse: vi.fn() } }))
vi.mock("@/lib/logger", () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn().mockReturnThis() }, logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn().mockReturnThis() } }))

beforeEach(() => {
  vi.clearAllMocks()
})

describe("GET /api/services (list)", () => {
  it("returns all active services", async () => {
    mockDb.service.findMany.mockResolvedValue(mockServices)
    const response = await GET(createMockRequest())
    const data = await response.json()
    expect(response.status).toBe(200)
    expect(data).toHaveLength(2)
  })

  it("filters by categoryId", async () => {
    mockDb.service.findMany.mockResolvedValue([mockServices[0]])
    const req = createMockRequest({ searchParams: { categoryId: "cat-1" } })
    await GET(req)
    expect(mockDb.service.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ categoryId: "cat-1" }),
      }),
    )
  })

  it("filters by providerId", async () => {
    mockDb.service.findMany.mockResolvedValue([mockServices[0]])
    const req = createMockRequest({ searchParams: { providerId: "prov-1" } })
    await GET(req)
    expect(mockDb.service.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ providerId: "prov-1" }),
      }),
    )
  })

  it("searches by text query (contains, case-sensitive in dev)", async () => {
    mockDb.service.findMany.mockResolvedValue([mockServices[0]])
    const req = createMockRequest({ searchParams: { q: "limpeza" } })
    await GET(req)
    expect(mockDb.service.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { title: { contains: "limpeza" } },
            { description: { contains: "limpeza" } },
          ],
        }),
      }),
    )
  })

  it("orders by createdAt desc", async () => {
    mockDb.service.findMany.mockResolvedValue(mockServices)
    await GET(createMockRequest())
    expect(mockDb.service.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { createdAt: "desc" } }),
    )
  })

  it("only returns active services", async () => {
    mockDb.service.findMany.mockResolvedValue(mockServices)
    await GET(createMockRequest())
    expect(mockDb.service.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ active: true }) }),
    )
  })
})

describe("GET /api/services/[id] (detail)", () => {
  it("returns service detail with provider info", async () => {
    mockDb.service.findUnique.mockResolvedValue(mockServiceDetail)
    const response = await GET_DETAIL(createMockRequest(), { params: Promise.resolve({ id: "svc-1" }) })
    const data = await response.json()
    expect(response.status).toBe(200)
    // Route returns { service } wrapper
    expect(data.service.id).toBe("svc-1")
    expect(data.service.provider).toHaveProperty("whatsapp")
  })

  it("returns 404 for non-existent service", async () => {
    mockDb.service.findUnique.mockResolvedValue(null)
    const response = await GET_DETAIL(createMockRequest(), { params: Promise.resolve({ id: "not-found" }) })
    expect(response.status).toBe(404)
  })
})
