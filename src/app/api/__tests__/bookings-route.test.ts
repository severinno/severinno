import { describe, it, expect, vi, beforeEach } from "vitest"
import { createMockRequest, parseResponse } from "@/lib/__tests__/helpers/api-test-utils"

// ── Hoisted mocks ──────────────────────────────────────────────────────────

vi.mock("@/lib/with-rate-limit", () => ({
  withRateLimit: (handler: (...args: unknown[]) => unknown) => handler,
}))

vi.mock("@/lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn().mockReturnThis() },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn().mockReturnThis() },
}))

vi.mock("@/lib/api-server", async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...(actual as any),
    handleError: vi.fn((e: unknown) => {
      console.log("handleError received:", e instanceof Error ? e.message : e)
      console.log("handleError stack:", e instanceof Error ? e.stack : "no stack")
      return (actual as any).handleError(e)
    }),
  }
})

// Auth mock with mutable session
let _mockSession: { userId: string; role: "CLIENT" | "PROVIDER" | "ADMIN" } | null = null

vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn().mockImplementation(async () => {
    const s = _mockSession
    if (!s) throw new Error("UNAUTHORIZED")
    return s
  }),
  getOptionalSession: vi.fn().mockImplementation(async () => _mockSession),
}))

vi.mock("@/lib/lytex", () => ({
  createPixCharge: vi.fn(),
  createCardCharge: vi.fn(),
  pollChargeStatus: vi.fn().mockResolvedValue({ status: "paid", paidAt: new Date().toISOString() } as any),
  lytexLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn().mockReturnThis() },
  LytexError: class LytexError extends Error { constructor(m: string) { super(m); this.name = "LytexError" } },
}))

vi.mock("@/lib/notification-queue", () => ({
  saveAndQueueNotification: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/push", () => ({
  sendPushNotification: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/realtime-client", () => ({
  emitRealtime: vi.fn().mockResolvedValue(undefined),
  sendBookingUpdate: vi.fn().mockResolvedValue(undefined),
  sendTrackingPosition: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/db", () => ({
  db: {
    service: {
      findUnique: vi.fn(),
    },
    booking: {
      create: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    payment: {
      upsert: vi.fn(),
      update: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
  },
}))

// ── Imports ────────────────────────────────────────────────────────────────

import { POST as createBooking, GET as listBookings } from "../bookings/route"
import { GET as getBooking, PATCH as updateBooking } from "../bookings/[id]/route"
import { POST as payBooking } from "../bookings/[id]/pay/route"
import { db } from "@/lib/db"
import { createPixCharge } from "@/lib/lytex"

// ── Mock data ──────────────────────────────────────────────────────────────

const mockService = {
  id: "svc-1",
  title: "Instalação Elétrica",
  description: "Descrição do serviço",
  basePrice: 150,
  categoryId: "cat-1",
  unit: "UNIDADE",
  active: true,
  providerId: "prov-1",
  photos: [],
  createdAt: new Date(),
  updatedAt: new Date(),
  provider: { id: "prov-1", verified: true, active: true },
  category: { id: "cat-1", name: "Elétrica", slug: "eletrica" },
}

const mockBooking = {
  id: "book-1",
  clientId: "client-1",
  providerId: "prov-1",
  serviceId: "svc-1",
  status: "PENDING",
  scheduledAt: new Date("2025-02-15T14:00:00Z"),
  address: "Rua Augusta, 1500",
  cep: "01304-001",
  lat: -23.55,
  lng: -46.63,
  amount: 200,
  paymentMethod: "PIX",
  paymentStatus: "PENDING",
  notes: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  service: mockService,
  provider: { id: "prov-1", name: "Carlos Prestador", avatarUrl: null, whatsapp: "11999999999" },
  client: { id: "client-1", name: "João Cliente", avatarUrl: null },
  payment: null,
  reviews: [],
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("POST /api/bookings", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    _mockSession = null
  })

  const validBody = {
    providerId: "prov-1",
    serviceId: "svc-1",
    scheduledAt: new Date("2025-02-15T14:00:00Z").toISOString(),
    address: "Rua Augusta, 1500",
    cep: "01304-001",
    lat: -23.55,
    lng: -46.63,
    amount: 200,
    paymentMethod: "PIX",
  }

  it("creates a booking and returns 201", async () => {
    _mockSession = { userId: "client-1", role: "CLIENT" } as any
    (vi.mocked(db.service.findUnique) as any).mockResolvedValue(mockService)
    (vi.mocked(db.booking.create) as any).mockResolvedValue(mockBooking)

    const req = createMockRequest({ method: "POST", body: validBody })
    const res = await createBooking(req)
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(201)
    expect((parsed.body as any).booking).toBeDefined()
    expect((parsed.body as any).booking.id).toBe("book-1")
  })

  it("returns 403 when not a client", async () => {
    _mockSession = { userId: "prov-1", role: "PROVIDER" } as any

    const req = createMockRequest({ method: "POST", body: validBody })
    const res = await createBooking(req)

    expect(res.status).toBe(403)
  })

  it("returns 404 for non-existent service", async () => {
    _mockSession = { userId: "client-1", role: "CLIENT" } as any
    (vi.mocked(db.service.findUnique) as any).mockResolvedValue(null)

    const req = createMockRequest({ method: "POST", body: validBody })
    const res = await createBooking(req)

    expect(res.status).toBe(404)
  })

  it("returns 400 when booking self-service", async () => {
    _mockSession = { userId: "prov-1", role: "CLIENT" } as any
    (vi.mocked(db.service.findUnique) as any).mockResolvedValue(mockService) // providerId = "prov-1" same as session

    const req = createMockRequest({ method: "POST", body: { ...validBody, providerId: "prov-1" } })
    const res = await createBooking(req)

    expect(res.status).toBe(400)
  })

  it("returns 400 for invalid booking data", async () => {
    _mockSession = { userId: "client-1", role: "CLIENT" } as any

    const req = createMockRequest({ method: "POST", body: {} })
    const res = await createBooking(req)

    expect(res.status).toBe(400)
  })
})

describe("GET /api/bookings", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    _mockSession = null
  })

  it("lists bookings for the authenticated client", async () => {
    _mockSession = { userId: "client-1", role: "CLIENT" } as any
    (vi.mocked(db.booking.findMany) as any).mockResolvedValue([mockBooking])
    (vi.mocked(db.booking.count) as any).mockResolvedValue(1)

    const req = createMockRequest()
    const res = await listBookings(req)
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    expect((parsed.body as any).items).toHaveLength(1)
    expect((parsed.body as any).total).toBe(1)
  })

  it("filters by status", async () => {
    _mockSession = { userId: "client-1", role: "CLIENT" } as any
    (vi.mocked(db.booking.findMany) as any).mockResolvedValue([])
    (vi.mocked(db.booking.count) as any).mockResolvedValue(0)

    const req = createMockRequest({ searchParams: { status: "CONFIRMED" } })
    await listBookings(req)

    expect(db.booking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "CONFIRMED" }),
      }),
    )
  })
})

describe("GET /api/bookings/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    _mockSession = null
  })

  it("returns booking for participant", async () => {
    _mockSession = { userId: "client-1", role: "CLIENT" } as any
    (vi.mocked(db.booking.findUnique) as any).mockResolvedValue(mockBooking)

    const res = await getBooking(new Request("http://localhost"), {
      params: Promise.resolve({ id: "book-1" }),
    })
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    expect((parsed.body as any).booking).toBeDefined()
  })

  it("returns 404 for non-existent booking", async () => {
    _mockSession = { userId: "client-1", role: "CLIENT" } as any
    (vi.mocked(db.booking.findUnique) as any).mockResolvedValue(null)

    const res = await getBooking(new Request("http://localhost"), {
      params: Promise.resolve({ id: "nonexistent" }),
    })

    expect(res.status).toBe(404)
  })

  it("returns 403 for non-participant", async () => {
    _mockSession = { userId: "other-user", role: "CLIENT" } as any
    (vi.mocked(db.booking.findUnique) as any).mockResolvedValue(mockBooking)

    const res = await getBooking(new Request("http://localhost"), {
      params: Promise.resolve({ id: "book-1" }),
    })

    expect(res.status).toBe(403)
  })
})

describe("PATCH /api/bookings/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    _mockSession = null
  })

  it("client cancels their own pending booking", async () => {
    _mockSession = { userId: "client-1", role: "CLIENT" } as any
    (vi.mocked(db.booking.findUnique) as any).mockResolvedValue({
      id: "book-1",
      clientId: "client-1",
      providerId: "prov-1",
      status: "PENDING",
      paymentStatus: "PENDING",
    } as any)
    (vi.mocked(db.booking.update) as any).mockResolvedValue(mockBooking)

    const req = createMockRequest({ method: "PATCH", body: { status: "CANCELLED" } })
    const res = await updateBooking(req, { params: Promise.resolve({ id: "book-1" }) })
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    expect((parsed.body as any).booking).toBeDefined()
  })

  it("returns 400 for invalid status transition", async () => {
    _mockSession = { userId: "client-1", role: "CLIENT" } as any
    (vi.mocked(db.booking.findUnique) as any).mockResolvedValue({
      id: "book-1",
      clientId: "client-1",
      providerId: "prov-1",
      status: "PENDING",
      paymentStatus: "PENDING",
    } as any)

    // Client cannot directly go PENDING -> COMPLETED
    const req = createMockRequest({ method: "PATCH", body: { status: "COMPLETED" } })
    const res = await updateBooking(req, { params: Promise.resolve({ id: "book-1" }) })

    expect(res.status).toBe(400)
  })

  it("provider confirms a pending booking", async () => {
    _mockSession = { userId: "prov-1", role: "PROVIDER" } as any
    (vi.mocked(db.booking.findUnique) as any).mockResolvedValue({
      id: "book-1",
      clientId: "client-1",
      providerId: "prov-1",
      status: "PENDING",
      paymentStatus: "PENDING",
    } as any)
    (vi.mocked(db.booking.update) as any).mockResolvedValue(mockBooking)

    const req = createMockRequest({ method: "PATCH", body: { status: "CONFIRMED" } })
    const res = await updateBooking(req, { params: Promise.resolve({ id: "book-1" }) })

    expect(res.status).toBe(200)
  })

  it("returns 403 for non-participant", async () => {
    _mockSession = { userId: "other-user", role: "CLIENT" } as any
    (vi.mocked(db.booking.findUnique) as any).mockResolvedValue({
      id: "book-1",
      clientId: "client-1",
      providerId: "prov-1",
      status: "PENDING",
      paymentStatus: "PENDING",
    } as any)

    const req = createMockRequest({ method: "PATCH", body: { status: "CANCELLED" } })
    const res = await updateBooking(req, { params: Promise.resolve({ id: "book-1" }) })

    expect(res.status).toBe(403)
  })
})

describe("POST /api/bookings/[id]/pay", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    _mockSession = null
  })

  const pixBooking = {
    id: "book-1",
    clientId: "client-1",
    status: "PENDING",
    paymentStatus: "PENDING",
    amount: 200,
    paymentMethod: "PIX",
    providerId: "prov-1",
    client: {
      id: "client-1",
      name: "Test Client",
      email: "test@test.com",
      cpfCnpj: "12345678900",
      whatsapp: "11999999999",
    },
    payment: null,
  }

  it("simulates PIX payment when lytex is not configured", async () => {
    _mockSession = { userId: "client-1", role: "CLIENT" } as any
    (vi.mocked(db.booking.findUnique) as any).mockResolvedValue(pixBooking)
    (vi.mocked(db.user.findUnique) as any).mockResolvedValue({ lytexRecipientId: null } as any)
    (vi.mocked(db.user.findUniqueOrThrow) as any).mockResolvedValue({
      name: "Test Client", email: "test@test.com", cpfCnpj: "12345678900", phone: "11999999999",
    } as any)
    (vi.mocked(db.payment.upsert) as any).mockResolvedValue({} as any)
    (vi.mocked(db.booking.update) as any).mockResolvedValue({ ...mockBooking, paymentStatus: "PAID" } as any)

    // Mock createPixCharge to return a valid charge (needed because .env has LYTEX_CLIENT_ID)
    (vi.mocked(createPixCharge) as any).mockResolvedValue({
      id: "charge-1",
      status: "waitingPayment",
      amount: 200,
      qrCode: "base64...",
      qrCodeText: "pix-copia-e-colai",
      txId: "tx-id-123",
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      linkCheckout: "https://checkout.lytex.com.br/charge-1",
      hashId: "hash-1",
      gatewayId: "gateway-1",
      gatewayHashId: "gateway-hash-1",
      checkoutUrl: "https://checkout.lytex.com.br/charge-1",
      gatewayMetadata: {},
    })

    const req = createMockRequest({ method: "POST" })
    const res = await payBooking(req, { params: Promise.resolve({ id: "book-1" }) })

    expect(res.status).toBe(200)
  })

  it("returns 403 when not the booking client", async () => {
    _mockSession = { userId: "other-user", role: "CLIENT" } as any
    (vi.mocked(db.booking.findUnique) as any).mockResolvedValue(pixBooking)

    const req = createMockRequest({ method: "POST" })
    const res = await payBooking(req, { params: Promise.resolve({ id: "book-1" }) })

    expect(res.status).toBe(403)
  })

  it("returns 400 for already paid booking", async () => {
    _mockSession = { userId: "client-1", role: "CLIENT" } as any
    (vi.mocked(db.booking.findUnique) as any).mockResolvedValue({ ...pixBooking, paymentStatus: "PAID" } as any)

    const req = createMockRequest({ method: "POST" })
    const res = await payBooking(req, { params: Promise.resolve({ id: "book-1" }) })

    expect(res.status).toBe(400)
  })

  it("returns 400 for cancelled booking", async () => {
    _mockSession = { userId: "client-1", role: "CLIENT" } as any
    (vi.mocked(db.booking.findUnique) as any).mockResolvedValue({ ...pixBooking, status: "CANCELLED" } as any)

    const req = createMockRequest({ method: "POST" })
    const res = await payBooking(req, { params: Promise.resolve({ id: "book-1" }) })

    expect(res.status).toBe(400)
  })
})
