/**
 * admin-errors.test.tsx
 *
 * Verifies that AdminErrorTrends renders cleanly without runtime errors
 * (specifically verifying that MetricCard and KpiCard handle Lucide icons without
 * "Objects are not valid as a React child").
 */

import { describe, it, expect, vi, afterEach } from "vitest"
import React from "react"
import { cleanup, render, screen } from "@/__tests__/test-utils"
import { AdminErrorTrends } from "../admin-errors"

const { mockData } = vi.hoisted(() => ({
  mockData: {
    summary: {
      totalErrors: 142,
      uniqueEndpoints: 8,
      uniqueUsers: 24,
      avgErrorsPerHour: 5.9,
      peakHour: 14,
      peakCount: 22,
      changeFromPrevious: -12,
    },
    byEndpoint: [
      {
        path: "/api/bookings",
        method: "POST",
        count: 45,
        status5xx: 5,
        status4xx: 40,
        uniqueUsers: 15,
        trend: "up" as const,
      },
      {
        path: "/api/auth/login",
        method: "POST",
        count: 30,
        status5xx: 0,
        status4xx: 30,
        uniqueUsers: 12,
        trend: "stable" as const,
      },
    ],
    byUser: [
      {
        userId: "usr-1",
        userName: "Carlos Silva",
        userRole: "CLIENT",
        errorCount: 14,
        uniqueEndpoints: 3,
        lastEndpoint: "/api/bookings",
      },
    ],
    byVersion: [
      {
        version: "v1.4.2",
        count: 90,
        newErrors: 2,
        resolvedErrors: 5,
        status: "stable" as const,
        topEndpoint: "/api/bookings",
      },
    ],
    timeline: [
      { hour: "10:00", errors: 4, status5xx: 1, status4xx: 3 },
      { hour: "11:00", errors: 8, status5xx: 2, status4xx: 6 },
    ],
    topErrors: [
      {
        message: "Database connection timeout",
        type: "PrismaClientInitializationError",
        count: 18,
        users: 10,
        statusCode: 500,
      },
    ],
    sentryConfig: {
      configured: true,
      release: "1.4.2",
      environment: "production",
    },
  },
}))

vi.mock("@tanstack/react-query", () => ({
  useQuery: vi.fn(() => ({
    data: mockData,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  })),
}))

vi.mock("@/lib/api", () => ({
  apiGet: vi.fn().mockResolvedValue(mockData),
}))

// Mock recharts responsive container to avoid zero size in JSDOM
vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("recharts")>()
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div data-testid="responsive-container" style={{ width: 500, height: 300 }}>
        {children}
      </div>
    ),
  }
})

describe("AdminErrorTrends", () => {
  afterEach(() => {
    try {
      cleanup()
    } catch {
      // Container cleaned up
    }
  })

  it("renders AdminErrorTrends without throwing runtime errors", () => {
    render(<AdminErrorTrends />)

    expect(screen.getByText("Monitoramento de Erros")).toBeInTheDocument()
    expect(screen.getByText("Total de Erros")).toBeInTheDocument()
    expect(screen.getByText("Endpoints Afetados")).toBeInTheDocument()
    expect(screen.getByText("Erros por Endpoint")).toBeInTheDocument()
    expect(screen.getByText("Top Erros")).toBeInTheDocument()
    expect(screen.getByText("Usuários com Mais Erros")).toBeInTheDocument()
    expect(screen.getByText("Erros por Versão")).toBeInTheDocument()
  })

  it("handles missing sentryConfig without crashing", async () => {
    const { useQuery } = await import("@tanstack/react-query")
    const { sentryConfig: _omitted, ...dataWithoutSentry } = mockData
    vi.mocked(useQuery).mockReturnValueOnce({
      data: dataWithoutSentry as never,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as never)

    render(<AdminErrorTrends />)
    expect(screen.getByText(/Configure SENTRY_DSN no \.env/)).toBeInTheDocument()
  })
})
