import { describe, it, expect, vi, beforeEach } from "vitest"
import { GET, checkOsrmBackendHealth } from "../metrics/geo-telemetry/route"
import { requireRole } from "@/lib/auth"

vi.mock("@/lib/auth", () => ({
  requireRole: vi.fn().mockImplementation(async (role: string) => {
    if (role !== "ADMIN") {
      const err = new Error("Acesso proibido")
      ;(err as any).name = "AuthError"
      ;(err as any).code = "FORBIDDEN"
      ;(err as any).status = 403
      throw err
    }
  }),
  requireAuth: vi.fn().mockResolvedValue({ id: "admin-1", role: "ADMIN" }),
  getSession: vi.fn().mockResolvedValue({ id: "admin-1", role: "ADMIN" }),
}))

describe("GET /api/admin/metrics/geo-telemetry", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
  })

  it("retorna telemetria geo completa com status 200 para admin", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 200,
    } as any)

    const req = new Request("http://localhost:3000/api/admin/metrics/geo-telemetry")
    const res = await GET(req as any)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
    expect(json.data).toBeDefined()
    expect(json.data.osrm.status).toBe("UP")
    expect(json.data.osrm.routingAlgorithm).toBe("Multi-Level Dijkstra (MLD)")
    expect(json.data.osrm.dataset.region).toBe("governador-valadares")
    expect(json.data.cnefeRooftop.city).toBe("Governador Valadares")
    expect(json.data.geofencePerimeter.strictArrivalMeters).toBe(50)
    expect(json.data.geofencePerimeter.maxTrustedAccuracyMeters).toBe(35)
  })

  it("bloqueia acesso se usuário não for ADMIN", async () => {
    vi.mocked(requireRole).mockRejectedValueOnce(
      Object.assign(new Error("Acesso proibido"), {
        name: "AuthError",
        code: "FORBIDDEN",
        status: 403,
      }),
    )

    const req = new Request("http://localhost:3000/api/admin/metrics/geo-telemetry")
    const res = await GET(req as any)
    expect(res.status).toBe(403)
  })

  it("trata health probe quando o OSRM está indisponível", async () => {
    vi.spyOn(global, "fetch").mockRejectedValueOnce(new Error("ECONNREFUSED"))

    const health = await checkOsrmBackendHealth("http://127.0.0.1:9999")
    expect(health.status).toBe("DOWN")
    expect(health.details).toContain("ECONNREFUSED")
  })
})
