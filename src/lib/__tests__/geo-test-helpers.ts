import { vi } from "vitest"

export function createMockLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }
}

export function createMockRedisStore() {
  const store = new Map<string, unknown>()

  return {
    store,
    cacheGet: vi.fn(async (key: string) => store.get(key) ?? null),
    cacheSet: vi.fn(async (key: string, value: unknown, _ttl?: number) => {
      store.set(key, value)
    }),
    cacheInvalidate: vi.fn(async (key: string) => {
      store.delete(key)
    }),
  }
}

export function createMockBooking(overrides: Record<string, unknown> = {}) {
  return {
    id: "booking-1",
    clientId: "client-1",
    providerId: "provider-1",
    serviceLat: -23.5505,
    serviceLng: -46.6333,
    geofenceRadiusMeters: 200,
    status: "CONFIRMED",
    geofenceAlertSentAt: null,
    client: { name: "Cliente Teste" },
    provider: { name: "João Silva" },
    service: { title: "Encanador" },
    ...overrides,
  }
}
