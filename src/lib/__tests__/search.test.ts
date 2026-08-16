import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock("server-only", () => ({}))

// Mock the OpenSearch client
// Note: vi.mock factory runs at hoist time, so mock fns must use vi.hoisted()
// to ensure they exist when the class field initializers execute.
const mocks = vi.hoisted(() => ({
  mockSearch: vi.fn(),
  mockIndex: vi.fn(),
  mockBulk: vi.fn(),
  mockDelete: vi.fn(),
  mockPing: vi.fn(),
  mockIndicesExists: vi.fn(),
  mockIndicesCreate: vi.fn(),
  mockIndicesDelete: vi.fn(),
  clientOptions: [] as unknown[],
}))

vi.mock("@opensearch-project/opensearch", () => ({
  Client: class {
    constructor(opts?: unknown) {
      // Captura as options para os testes de timeout do client
      mocks.clientOptions.push(opts)
    }
    ping = mocks.mockPing
    search = mocks.mockSearch
    index = mocks.mockIndex
    bulk = mocks.mockBulk
    delete = mocks.mockDelete
    indices = {
      exists: mocks.mockIndicesExists,
      create: mocks.mockIndicesCreate,
      delete: mocks.mockIndicesDelete,
    }
  },
}))

import * as searchModule from "../search"

const {
  searchProviders,
  searchServices,
  ensureIndices,
  deleteIndices,
  indexDocument,
  bulkIndex,
  deleteDocument,
  SHARED_ANALYSIS,
} = searchModule

// ===========================================================================
// SHARED_ANALYSIS (regressões do fluxo OpenSearch)
// ===========================================================================

// Protege contra a recorrência de dois bugs que quebraram a criação dos índices:
//  (1) filtro synonym em index time — o OpenSearch 2.19 rejeita com
//      "analyzer [severinno_index] contains filters [severinno_synonyms] that
//      are not allowed to run in index time mode";
//  (2) sem lenient — uma regra de sinônimo com stopword no meio de termo
//      multi-palavra ("orçamento sem compromisso") falhava o build inteiro com
//      "Failed to build synonyms".
describe("SHARED_ANALYSIS", () => {
  it("severinno_index NÃO contém o filtro severinno_synonyms (index time)", () => {
    const indexFilters = SHARED_ANALYSIS.analyzer.severinno_index.filter
    expect(indexFilters).not.toContain("severinno_synonyms")
  })

  it("severinno_search contém o filtro severinno_synonyms (search time)", () => {
    const searchFilters = SHARED_ANALYSIS.analyzer.severinno_search.filter
    expect(searchFilters).toContain("severinno_synonyms")
  })

  it("filtro severinno_synonyms é lenient (rede de segurança vs regras inválidas)", () => {
    const filter = SHARED_ANALYSIS.filter.severinno_synonyms
    expect(filter.type).toBe("synonym")
    expect(filter.lenient).toBe(true)
    expect(filter.updateable).toBe(true)
  })
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
  delete (globalThis as any).__opensearch
  // Default mock return for index management functions
  mocks.mockIndicesExists.mockResolvedValue({ body: false })
  mocks.mockIndicesCreate.mockResolvedValue({ body: { acknowledged: true } })
  mocks.mockIndicesDelete.mockResolvedValue({ body: { acknowledged: true } })
})

// ===========================================================================
// Client timeouts (auditoria DATA-TIMEOUTS-AUDIT)
// ===========================================================================

describe("createClient", () => {
  beforeEach(() => {
    mocks.clientOptions.length = 0
  })

  it("usa requestTimeout 10s + maxRetries 1 (nunca pendura indefinidamente)", () => {
    const prevEnv = process.env.NODE_ENV
    ;(process.env as any).NODE_ENV = "production"
    process.env.OPENSEARCH_URL = "http://localhost:9200"

    const client = searchModule.getClient()
    expect(client).not.toBeNull()

    const opts = mocks.clientOptions[0] as { requestTimeout?: number; maxRetries?: number }
    expect(opts).toBeDefined()
    // connectionTimeout NÃO existe nas ClientOptions do opensearch-js v3.6 —
    // o requestTimeout cobre a fase de connect (socket timeout do Node setado
    // antes de conectar). O que se garante aqui é o limite total do request.
    expect(opts.requestTimeout).toBe(10_000)
    expect(opts.maxRetries).toBe(1)

    Object.assign(process.env, { NODE_ENV: prevEnv })
    delete process.env.OPENSEARCH_URL
  })
})

// ===========================================================================
// searchProviders
// ===========================================================================

describe("searchProviders", () => {
  it("returns empty items when client is unavailable", async () => {
    // getClient returns null when process.env.OPENSEARCH_URL is not set and not in prod
    const result = await searchProviders({ q: "encanador" })
    expect(result.items).toEqual([])
    expect(result.total).toBe(0)
  })

  it("builds multi_match query for text search", async () => {
    // Temporarily pretend we're in production to get a client
    const prevEnv = process.env.NODE_ENV
    ;(process.env as any).NODE_ENV = "production"
    process.env.OPENSEARCH_URL = "http://localhost:9200"

    mocks.mockSearch.mockResolvedValue({
      body: {
        took: 5,
        hits: {
          total: { value: 2, relation: "eq" },
          hits: [
            {
              _score: 2.5,
              _source: {
                id: "prov-1",
                name: "Carlos Encanador",
                bio: "Encanador experiente",
                city: "São Paulo",
                state: "SP",
                verified: true,
                rating: 4.5,
                reviewCount: 10,
                completedBookings: 25,
                serviceTitles: ["Desentupimento", "Vazamento"],
                serviceCategories: [],
                createdAt: "2026-01-01T00:00:00.000Z",
              },
            },
          ],
        },
      },
    })

    const result = await searchProviders({ q: "encanador", page: 1, limit: 20 })

    expect(result.items).toHaveLength(1)
    expect(result.items[0].name).toBe("Carlos Encanador")
    expect(result.total).toBe(2)

    // Verify the query structure
    const searchCall = mocks.mockSearch.mock.calls[0][0]
    expect(searchCall.index).toBe("severinno-providers")
    expect(searchCall.body.query.bool.must).toEqual(
      expect.arrayContaining([
        { term: { role: "PROVIDER" } },
        { term: { active: true } },
        expect.objectContaining({ multi_match: expect.any(Object) }),
      ]),
    )

    // Cleanup
    Object.assign(process.env, { NODE_ENV: prevEnv })
    delete process.env.OPENSEARCH_URL
  })

  it("returns empty result on search error", async () => {
    const prevEnv = process.env.NODE_ENV
    ;(process.env as any).NODE_ENV = "production"
    process.env.OPENSEARCH_URL = "http://localhost:9200"

    mocks.mockSearch.mockRejectedValue(new Error("Connection refused"))

    const result = await searchProviders({ q: "encanador" })
    expect(result.items).toEqual([])
    expect(result.total).toBe(0)

    Object.assign(process.env, { NODE_ENV: prevEnv })
    delete process.env.OPENSEARCH_URL
  })
})

// ===========================================================================
// searchServices
// ===========================================================================

describe("searchServices", () => {
  it("returns empty when query is empty", async () => {
    const result = await searchServices("", 1, 20)
    expect(result.items).toEqual([])
    expect(result.total).toBe(0)
  })

  it("returns empty when client is unavailable", async () => {
    const result = await searchServices("elétrica", 1, 20)
    expect(result.items).toEqual([])
    expect(result.total).toBe(0)
  })

  it("builds service search query correctly", async () => {
    const prevEnv = process.env.NODE_ENV
    ;(process.env as any).NODE_ENV = "production"
    process.env.OPENSEARCH_URL = "http://localhost:9200"

    mocks.mockSearch.mockResolvedValue({
      body: {
        took: 3,
        hits: {
          total: { value: 1, relation: "eq" },
          hits: [
            {
              _score: 3.0,
              _source: {
                id: "svc-1",
                title: "Instalação Elétrica",
                description: "Instalação completa",
                providerName: "Ricardo",
                basePrice: 250,
                unit: "UNIDADE",
                active: true,
                createdAt: "2026-01-01T00:00:00.000Z",
              },
            },
          ],
        },
      },
    })

    const result = await searchServices("elétrica", 1, 20)

    expect(result.items).toHaveLength(1)
    expect(result.items[0].title).toBe("Instalação Elétrica")
    expect(result.took).toBe(3)

    const searchCall = mocks.mockSearch.mock.calls[0][0]
    expect(searchCall.index).toBe("severinno-services")
    expect(searchCall.body.query.bool.must).toContainEqual({ term: { active: true } })

    Object.assign(process.env, { NODE_ENV: prevEnv })
    delete process.env.OPENSEARCH_URL
  })
})

// ===========================================================================
// Index management
// ===========================================================================

describe("ensureIndices", () => {
  it("does not throw when client is unavailable", async () => {
    vi.spyOn(searchModule, "getClient").mockReturnValue(null as any)
    await expect(ensureIndices()).resolves.toBeUndefined()
  })
})

describe("deleteIndices", () => {
  it("does not throw when client is unavailable", async () => {
    vi.spyOn(searchModule, "getClient").mockReturnValue(null as any)
    await expect(deleteIndices()).resolves.toBeUndefined()
  })
})

describe("indexDocument", () => {
  it("does not throw when client is unavailable", async () => {
    vi.spyOn(searchModule, "getClient").mockReturnValue(null as any)
    await expect(indexDocument("test-index", "doc-1", { title: "test" })).resolves.toBeUndefined()
  })
})

describe("bulkIndex", () => {
  it("does not throw when client is unavailable", async () => {
    vi.spyOn(searchModule, "getClient").mockReturnValue(null as any)
    await expect(
      bulkIndex("test-index", [{ id: "doc-1", body: { title: "test" } }]),
    ).resolves.toBeUndefined()
  })
})

describe("deleteDocument", () => {
  it("does not throw when client is unavailable", async () => {
    vi.spyOn(searchModule, "getClient").mockReturnValue(null as any)
    await expect(deleteDocument("test-index", "doc-1")).resolves.toBeUndefined()
  })
})
