import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/logger", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

const mockCheckRateLimit = vi.fn().mockResolvedValue({ allowed: true, remaining: 99 });
vi.mock("@/lib/rate-limiting", () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}));

describe("edge-runtime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("edgeResponse", () => {
    it("returns JSON response with CORS and cache headers", async () => {
      const { edgeResponse } = await import("@/lib/edge-runtime");
      const response = edgeResponse({ ok: true, data: "test" });

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("application/json");
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
      expect(response.headers.get("Cache-Control")).toContain("s-maxage=60");

      const body = await response.json();
      expect(body.ok).toBe(true);
      expect(body.data).toBe("test");
    });

    it("respects custom status code", async () => {
      const { edgeResponse } = await import("@/lib/edge-runtime");
      const response = edgeResponse({ data: "partial" }, 206);
      expect(response.status).toBe(206);
    });
  });

  describe("edgeError", () => {
    it("returns error JSON with correct status", async () => {
      const { edgeError } = await import("@/lib/edge-runtime");
      const response = edgeError("Not found", 404);

      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body.error).toBe("Not found");
    });

    it("defaults to status 500", async () => {
      const { edgeError } = await import("@/lib/edge-runtime");
      const response = edgeError("Server error");
      expect(response.status).toBe(500);
    });
  });

  describe("edgeCors", () => {
    it("returns 204 with CORS headers", async () => {
      const { edgeCors } = await import("@/lib/edge-runtime");
      const response = edgeCors();

      expect(response.status).toBe(204);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
      expect(response.headers.get("Access-Control-Allow-Methods")).toBe("GET, OPTIONS");
      expect(response.headers.get("Access-Control-Max-Age")).toBe("86400");
    });
  });

  describe("getClientIp", () => {
    it("extracts IP from cf-connecting-ip first", async () => {
      const { getClientIp } = await import("@/lib/edge-runtime");
      const request = new Request("https://example.com", {
        headers: { "cf-connecting-ip": "1.2.3.4" },
      });
      expect(getClientIp(request)).toBe("1.2.3.4");
    });

    it("falls back to x-forwarded-for", async () => {
      const { getClientIp } = await import("@/lib/edge-runtime");
      const request = new Request("https://example.com", {
        headers: { "x-forwarded-for": "203.0.113.1, 70.41.3.18" },
      });
      expect(getClientIp(request)).toBe("203.0.113.1");
    });

    it("falls back to x-real-ip", async () => {
      const { getClientIp } = await import("@/lib/edge-runtime");
      const request = new Request("https://example.com", {
        headers: { "x-real-ip": "198.51.100.1" },
      });
      expect(getClientIp(request)).toBe("198.51.100.1");
    });

    it("returns null when no headers present", async () => {
      const { getClientIp } = await import("@/lib/edge-runtime");
      const request = new Request("https://example.com");
      expect(getClientIp(request)).toBeNull();
    });
  });

  describe("getEdgeGeo", () => {
    it("extracts country from cf-ipcountry", async () => {
      const { getEdgeGeo } = await import("@/lib/edge-runtime");
      const request = new Request("https://example.com", {
        headers: { "cf-ipcountry": "BR" },
      });
      const geo = getEdgeGeo(request);
      expect(geo.country).toBe("BR");
    });

    it("returns empty object when no geo headers", async () => {
      const { getEdgeGeo } = await import("@/lib/edge-runtime");
      const request = new Request("https://example.com");
      const geo = getEdgeGeo(request);
      expect(geo.country).toBeUndefined();
      expect(geo.latitude).toBeUndefined();
    });
  });
});
