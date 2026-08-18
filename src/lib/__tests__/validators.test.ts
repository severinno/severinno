/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { describe, it, expect } from "vitest"
import {
  loginSchema,
  registerSchema,
  serviceSchema,
  categorySchema,
  bookingSchema,
  reviewSchema,
  messageSchema,
  availabilitySchema,
} from "../validators"

describe("loginSchema", () => {
  it("accepts valid login data", () => {
    const result = loginSchema.safeParse({
      email: "user@example.com",
      password: "12345678",
    })
    expect(result.success).toBe(true)
  })

  it("rejects invalid email", () => {
    const result = loginSchema.safeParse({
      email: "not-an-email",
      password: "12345678",
    })
    expect(result.success).toBe(false)
  })

  it("rejects short password", () => {
    const result = loginSchema.safeParse({
      email: "user@example.com",
      password: "1234567",
    })
    expect(result.success).toBe(false)
  })

  it("rejects missing fields", () => {
    const result = loginSchema.safeParse({})
    expect(result.success).toBe(false)
  })
})

describe("registerSchema", () => {
  const validClient = {
    name: "João Silva",
    email: "joao@example.com",
    password: "12345678",
    confirmPassword: "12345678",
    role: "CLIENT" as const,
  }

  it("accepts valid client registration", () => {
    const result = registerSchema.safeParse(validClient)
    expect(result.success).toBe(true)
  })

  it("rejects mismatched passwords", () => {
    const result = registerSchema.safeParse({
      ...validClient,
      confirmPassword: "654321",
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.path).toContain("confirmPassword")
    }
  })

  it("rejects short name", () => {
    const result = registerSchema.safeParse({
      ...validClient,
      name: "A",
    })
    expect(result.success).toBe(false)
  })

  it("requires cpfCnpj, whatsapp and city for providers", () => {
    const result = registerSchema.safeParse({
      ...validClient,
      role: "PROVIDER",
      cpfCnpj: "",
      whatsapp: "",
      city: "",
    })
    expect(result.success).toBe(false)
  })

  it("accepts valid provider registration with required fields", () => {
    const result = registerSchema.safeParse({
      name: "Carlos Prestador",
      email: "carlos@example.com",
      password: "12345678",
      confirmPassword: "12345678",
      role: "PROVIDER",
      cpfCnpj: "123.456.789-00",
      whatsapp: "11999999999",
      city: "São Paulo",
    })
    expect(result.success).toBe(true)
  })
})

describe("serviceSchema", () => {
  const validService = {
    title: "Instalação Elétrica",
    description: "Instalação completa de tomadas e fiação elétrica residencial.",
    categoryId: "cat-123",
    basePrice: 150,
    unit: "UNIDADE" as const,
  }

  it("accepts valid service", () => {
    const result = serviceSchema.safeParse(validService)
    expect(result.success).toBe(true)
  })

  it("rejects short title", () => {
    const result = serviceSchema.safeParse({ ...validService, title: "Ab" })
    expect(result.success).toBe(false)
  })

  it("rejects negative price", () => {
    const result = serviceSchema.safeParse({ ...validService, basePrice: -10 })
    expect(result.success).toBe(false)
  })

  it("rejects too many photos", () => {
    const result = serviceSchema.safeParse({
      ...validService,
      photos: Array.from({ length: 5 }, (_, i) => `https://example.com/${i}.jpg`),
    })
    expect(result.success).toBe(false)
  })

  it("accepts valid unit enum values", () => {
    for (const unit of ["UNIDADE", "METRO_LINEAR", "METRO_QUADRADO", "METRO_CUBICO"] as const) {
      const result = serviceSchema.safeParse({ ...validService, unit })
      expect(result.success).toBe(true)
    }
  })
})

describe("categorySchema", () => {
  it("accepts valid category", () => {
    const result = categorySchema.safeParse({
      name: "Reparos",
      slug: "reparos",
      level: 0,
    })
    expect(result.success).toBe(true)
  })

  it("rejects invalid slug (uppercase)", () => {
    const result = categorySchema.safeParse({
      name: "Reparos",
      slug: "Reparos",
      level: 0,
    })
    expect(result.success).toBe(false)
  })

  it("rejects level > 2", () => {
    const result = categorySchema.safeParse({
      name: "Deep",
      slug: "deep",
      level: 3,
    })
    expect(result.success).toBe(false)
  })
})

describe("bookingSchema", () => {
  it("accepts valid booking", () => {
    const result = bookingSchema.safeParse({
      providerId: "prov-1",
      serviceId: "svc-1",
      scheduledAt: new Date().toISOString(),
      address: "Rua Augusta, 1500",
      cep: "01304-001",
      lat: -23.55,
      lng: -46.63,
      amount: 200,
      paymentMethod: "PIX",
    })
    expect(result.success).toBe(true)
  })

  it("rejects missing required fields", () => {
    const result = bookingSchema.safeParse({})
    expect(result.success).toBe(false)
  })

  it("rejects invalid payment method", () => {
    const result = bookingSchema.safeParse({
      providerId: "prov-1",
      serviceId: "svc-1",
      scheduledAt: new Date().toISOString(),
      address: "Rua Augusta, 1500",
      cep: "01304-001",
      lat: -23.55,
      lng: -46.63,
      amount: 200,
      paymentMethod: "BITCOIN",
    })
    expect(result.success).toBe(false)
  })
})

describe("reviewSchema", () => {
  it("accepts valid review", () => {
    const result = reviewSchema.safeParse({
      bookingId: "book-1",
      rating: 5,
      comment: "Excelente serviço!",
    })
    expect(result.success).toBe(true)
  })

  it("accepts review without comment", () => {
    const result = reviewSchema.safeParse({
      bookingId: "book-1",
      rating: 4,
    })
    expect(result.success).toBe(true)
  })

  it("rejects rating < 1", () => {
    const result = reviewSchema.safeParse({
      bookingId: "book-1",
      rating: 0,
    })
    expect(result.success).toBe(false)
  })

  it("rejects rating > 5", () => {
    const result = reviewSchema.safeParse({
      bookingId: "book-1",
      rating: 6,
    })
    expect(result.success).toBe(false)
  })

  it("rejects non-integer rating", () => {
    const result = reviewSchema.safeParse({
      bookingId: "book-1",
      rating: 3.5,
    })
    expect(result.success).toBe(false)
  })
})

describe("messageSchema", () => {
  it("accepts valid message", () => {
    const result = messageSchema.safeParse({
      toId: "user-2",
      content: "Olá, tudo bem?",
    })
    expect(result.success).toBe(true)
  })

  it("rejects empty content", () => {
    const result = messageSchema.safeParse({
      toId: "user-2",
      content: "",
    })
    expect(result.success).toBe(false)
  })

  it("rejects content over 2000 chars", () => {
    const result = messageSchema.safeParse({
      toId: "user-2",
      content: "a".repeat(2001),
    })
    expect(result.success).toBe(false)
  })
})

describe("availabilitySchema", () => {
  it("accepts valid availability", () => {
    const result = availabilitySchema.safeParse({
      dayOfWeek: 1,
      startTime: "08:00",
      endTime: "18:00",
      active: true,
    })
    expect(result.success).toBe(true)
  })

  it("rejects invalid time format", () => {
    const result = availabilitySchema.safeParse({
      dayOfWeek: 1,
      startTime: "8:00",
      endTime: "18:00",
    })
    expect(result.success).toBe(false)
  })

  it("rejects invalid dayOfWeek", () => {
    const result = availabilitySchema.safeParse({
      dayOfWeek: 7,
      startTime: "08:00",
      endTime: "18:00",
    })
    expect(result.success).toBe(false)
  })
})
