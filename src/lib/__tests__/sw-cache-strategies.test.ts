import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/logger", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock caches API (service worker)
const mockCacheStore = new Map<string, Map<string, string>>();
const mockCaches = {
  open: vi.fn(async (name: string) => {
    if (!mockCacheStore.has(name)) mockCacheStore.set(name, new Map());
    const store = mockCacheStore.get(name)!;
    return {
      match: vi.fn(async (req: Request) => {
        const url = typeof req === "string" ? req : req.url;
        const body = store.get(url);
        return body ? new Response(body) : undefined;
      }),
      put: vi.fn(async (req: Request, res: Response) => {
        const url = typeof req === "string" ? req : req.url;
        store.set(url, await res.text());
      }),
      keys: vi.fn(async () => [...store.keys()].map((url) => new Request(url))),
      delete: vi.fn(async (req: Request) => {
        const url = typeof req === "string" ? req : req.url;
        return store.delete(url);
      }),
    };
  }),
  keys: vi.fn(async () => [...mockCacheStore.keys()]),
  delete: vi.fn(async (name: string) => mockCacheStore.delete(name)),
};

// @ts-expect-error - caches not in Node.js types
globalThis.caches = mockCaches;

describe("sw-cache-strategies", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCacheStore.clear();
  });

  describe("cache constants", () => {
    it("defines cache version and names", async () => {
      const sw = await import("@/lib/sw-cache-strategies");
      expect(sw.CACHE_VERSION).toBeTruthy();
      expect(sw.STATIC_CACHE).toContain(sw.CACHE_VERSION);
      expect(sw.DYNAMIC_CACHE).toContain(sw.CACHE_VERSION);
      expect(sw.OFFLINE_CACHE).toContain(sw.CACHE_VERSION);
      expect(sw.IMAGE_CACHE).toContain(sw.CACHE_VERSION);
    });

    it("defines precache URLs", async () => {
      const sw = await import("@/lib/sw-cache-strategies");
      expect(sw.PRECACHE_URLS).toContain("/");
      expect(sw.PRECACHE_URLS).toContain("/offline");
      expect(sw.PRECACHE_URLS).toContain("/manifest.json");
    });

    it("defines URL patterns for all resource types", async () => {
      const sw = await import("@/lib/sw-cache-strategies");
      expect(sw.STATIC_PATTERNS.length).toBeGreaterThan(0);
      expect(sw.IMAGE_PATTERNS.length).toBeGreaterThan(0);
      expect(sw.API_PATTERNS.length).toBeGreaterThan(0);
      expect(sw.SWR_PATTERNS.length).toBeGreaterThan(0);
    });
  });

  describe("STATIC_PATTERNS", () => {
    it("matches JS and CSS files", async () => {
      const { STATIC_PATTERNS } = await import("@/lib/sw-cache-strategies");
      expect(STATIC_PATTERNS.some((p) => p.test("/app.js"))).toBe(true);
      expect(STATIC_PATTERNS.some((p) => p.test("/styles.css"))).toBe(true);
      expect(STATIC_PATTERNS.some((p) => p.test("/_next/static/chunk.js"))).toBe(true);
    });

    it("does not match images", async () => {
      const { STATIC_PATTERNS } = await import("@/lib/sw-cache-strategies");
      expect(STATIC_PATTERNS.some((p) => p.test("/photo.png"))).toBe(false);
    });
  });

  describe("API_PATTERNS", () => {
    it("matches provider and search API endpoints", async () => {
      const { API_PATTERNS } = await import("@/lib/sw-cache-strategies");
      expect(API_PATTERNS.some((p) => p.test("/api/providers"))).toBe(true);
      expect(API_PATTERNS.some((p) => p.test("/api/services"))).toBe(true);
      expect(API_PATTERNS.some((p) => p.test("/api/search?q=test"))).toBe(true);
      expect(API_PATTERNS.some((p) => p.test("/api/geo/reverse"))).toBe(true);
    });

    it("does not match auth endpoints", async () => {
      const { API_PATTERNS } = await import("@/lib/sw-cache-strategies");
      expect(API_PATTERNS.some((p) => p.test("/api/auth/session"))).toBe(false);
    });
  });

  describe("cacheFirst", () => {
    it("returns cached response when available", async () => {
      const { cacheFirst, STATIC_CACHE } = await import("@/lib/sw-cache-strategies");
      // Pre-populate cache
      const cache = await caches.open(STATIC_CACHE);
      await cache.put(new Request("https://example.com/app.js"), new Response("cached content"));

      const response = await cacheFirst(new Request("https://example.com/app.js"), STATIC_CACHE);
      expect(await response.text()).toBe("cached content");
    });

    it("fetches from network when cache miss", async () => {
      const { cacheFirst, STATIC_CACHE } = await import("@/lib/sw-cache-strategies");
      const response = await cacheFirst(new Request("https://example.com/new.js"), STATIC_CACHE);
      expect(response).toBeDefined();
    });
  });

  describe("enforceMaxCacheSize", () => {
    it("removes oldest entries when over limit", async () => {
      const { enforceMaxCacheSize, STATIC_CACHE } = await import("@/lib/sw-cache-strategies");
      const cache = await caches.open(STATIC_CACHE);

      // Add 5 entries
      for (let i = 0; i < 5; i++) {
        await cache.put(new Request(`https://example.com/file${i}.js`), new Response(`content${i}`));
      }

      await enforceMaxCacheSize(STATIC_CACHE, 3);
      const keys = await cache.keys();
      expect(keys.length).toBe(3);
    });
  });

  describe("clearAllCaches", () => {
    it("clears all caches", async () => {
      const { clearAllCaches, STATIC_CACHE } = await import("@/lib/sw-cache-strategies");
      const cache = await caches.open(STATIC_CACHE);
      await cache.put(new Request("https://example.com/test.js"), new Response("content"));

      await clearAllCaches();
      const keys = await caches.keys();
      expect(keys.length).toBe(0);
    });
  });

  describe("getCacheStorageStats", () => {
    it("returns stats for each cache store", async () => {
      const { getCacheStorageStats, STATIC_CACHE } = await import("@/lib/sw-cache-strategies");
      const cache = await caches.open(STATIC_CACHE);
      await cache.put(new Request("https://example.com/a.js"), new Response("a"));
      await cache.put(new Request("https://example.com/b.js"), new Response("b"));

      const stats = await getCacheStorageStats();
      expect(stats[STATIC_CACHE]).toBeDefined();
      expect(stats[STATIC_CACHE].entries).toBe(2);
    });
  });
});
