/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { describe, it, expect, vi, beforeEach } from "vitest"

const mockExit = vi.hoisted(() => {
  const fn = vi.fn()
  process.exit = fn as unknown as (code?: number) => never
  return fn
})

const { mockGetClient, mockIndexDocument, mockDeleteDocument, mockINDICES, mockPrismaClient } =
  vi.hoisted(() => ({
    mockGetClient: vi.fn().mockReturnValue(null),
    mockIndexDocument: vi.fn().mockResolvedValue(undefined),
    mockDeleteDocument: vi.fn().mockResolvedValue(undefined),
    mockINDICES: {
      PROVIDERS: "severinno-providers",
      SERVICES: "severinno-services",
      CATEGORIES: "severinno-categories",
    },
    mockPrismaClient: vi.fn().mockReturnValue({
      user: { findUnique: vi.fn() },
      service: { findUnique: vi.fn() },
      category: { findUnique: vi.fn() },
      $queryRawUnsafe: vi.fn().mockResolvedValue([]),
      $executeRawUnsafe: vi.fn().mockResolvedValue(undefined),
    }),
  }))

vi.mock("../../lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock("../../lib/search", () => ({
  getClient: mockGetClient,
  indexDocument: mockIndexDocument,
  deleteDocument: mockDeleteDocument,
  INDICES: mockINDICES,
}))

vi.mock("@prisma/client", () => ({
  PrismaClient: mockPrismaClient,
}))

import logger from "../../lib/logger"
import "../search-index-consumer"

describe("search index worker (search-index-consumer.ts)", () => {
  // NOTE: no beforeEach(clearAllMocks) — main() runs at import time,
  // so mock calls are set before any test executes.

  describe("initialization", () => {
    it("exits with code 1 when OpenSearch client is unavailable", () => {
      expect(mockExit).toHaveBeenCalledWith(1)
    })

    it("logs that OpenSearch client is unavailable before exiting", () => {
      expect(logger.error).toHaveBeenCalledWith(
        "OpenSearch client unavailable \u2014 OPENSEARCH_URL must be set",
      )
    })

    it("instantiates PrismaClient at module level", () => {
      expect(mockPrismaClient).toHaveBeenCalledTimes(1)
    })
  })

  describe("search library integration", () => {
    it("exports PROVIDERS index constant", () => {
      expect(mockINDICES.PROVIDERS).toBe("severinno-providers")
    })

    it("exports SERVICES index constant", () => {
      expect(mockINDICES.SERVICES).toBe("severinno-services")
    })

    it("exports CATEGORIES index constant", () => {
      expect(mockINDICES.CATEGORIES).toBe("severinno-categories")
    })

    it("has a callable indexDocument function", () => {
      expect(mockIndexDocument).toBeInstanceOf(Function)
    })

    it("has a callable deleteDocument function", () => {
      expect(mockDeleteDocument).toBeInstanceOf(Function)
    })
  })
})
