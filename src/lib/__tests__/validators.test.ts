import { describe, it, expect } from "vitest"
import {
  newsletterSchema,
  chatMessageSchema,
  checkinEscrowSchema,
  emergencyDispatchSchema,
  disputeMediationSchema,
  gtmLeadCreateSchema,
  gtmLeadUpdateSchema,
  visionDiagnosticSchema,
  routeOptimizationSchema,
  meiReportSchema,
  matrixEtaSchema,
  loginSchema,
  registerSchema,
  bookingUpdateSchema,
  settingSchema,
  availabilitySchema,
  dateBlockSchema,
  slugSchema,
  categoryUpdateSchema,
} from "@/lib/validators"

// ---------------------------------------------------------------------------
// NEWSLETTER
// ---------------------------------------------------------------------------
describe("newsletterSchema", () => {
  it("aceita email válido", () => {
    expect(newsletterSchema.parse({ email: "user@example.com" })).toEqual({
      email: "user@example.com",
    })
  })

  it("normaliza para lowercase e trim", () => {
    const result = newsletterSchema.parse({ email: "  User@Example.COM  " })
    expect(result.email).toBe("user@example.com")
  })

  it("rejeita email inválido", () => {
    expect(() => newsletterSchema.parse({ email: "not-an-email" })).toThrow()
  })

  it("rejeita string vazia", () => {
    expect(() => newsletterSchema.parse({ email: "" })).toThrow()
  })
})

// ---------------------------------------------------------------------------
// CHAT MESSAGE
// ---------------------------------------------------------------------------
describe("chatMessageSchema", () => {
  it("aceita mensagem válida", () => {
    const result = chatMessageSchema.parse({ message: "Olá!" })
    expect(result.message).toBe("Olá!")
    expect(result.history).toEqual([])
  })

  it("faz trim na mensagem", () => {
    const result = chatMessageSchema.parse({ message: "  Olá!  " })
    expect(result.message).toBe("Olá!")
  })

  it("rejeita mensagem vazia", () => {
    expect(() => chatMessageSchema.parse({ message: "" })).toThrow()
  })

  it("rejeita mensagem maior que 2000 chars", () => {
    expect(() => chatMessageSchema.parse({ message: "a".repeat(2001) })).toThrow()
  })

  it("trunca history para últimos 10 itens", () => {
    const history = Array.from({ length: 15 }, (_, i) => ({
      role: "user" as const,
      content: `msg ${i}`,
    }))
    const result = chatMessageSchema.parse({ message: "hi", history })
    expect(result.history).toHaveLength(10)
  })
})

// ---------------------------------------------------------------------------
// CHECKIN ESCROW (discriminated union)
// ---------------------------------------------------------------------------
describe("checkinEscrowSchema", () => {
  it("aceita action=checkin com todos os campos", () => {
    const result = checkinEscrowSchema.parse({
      action: "checkin",
      bookingId: "b1",
      providerLat: -23.55,
      providerLng: -46.63,
      clientAddressLat: -23.54,
      clientAddressLng: -46.62,
    })
    expect(result.action).toBe("checkin")
  })

  it("aceita action=generate-pin", () => {
    const result = checkinEscrowSchema.parse({
      action: "generate-pin",
      bookingId: "b1",
    })
    expect(result.action).toBe("generate-pin")
  })

  it("aceita action=release-escrow com pin e amount", () => {
    const result = checkinEscrowSchema.parse({
      action: "release-escrow",
      bookingId: "b1",
      pin: "1234",
      escrowAmount: 150,
    })
    expect(result.action).toBe("release-escrow")
  })

  it("rejeita action desconhecido", () => {
    expect(() => checkinEscrowSchema.parse({ action: "unknown", bookingId: "b1" })).toThrow()
  })
})

// ---------------------------------------------------------------------------
// EMERGENCY DISPATCH
// ---------------------------------------------------------------------------
describe("emergencyDispatchSchema", () => {
  it("aceita request mínimo", () => {
    const result = emergencyDispatchSchema.parse({
      request: { lat: -23.55, lng: -46.63 },
    })
    expect(result.request.lat).toBe(-23.55)
    expect(result.request.severity).toBe("EMERGENCY")
  })

  it("aceita com availableProviders", () => {
    const result = emergencyDispatchSchema.parse({
      request: { lat: -23.55, lng: -46.63, maxRadiusKm: 20 },
      availableProviders: [
        { id: "p1", name: "Prov", lat: -23.56, lng: -46.64, rating: 4.5, activeBookings: 0 },
      ],
    })
    expect(result.availableProviders).toHaveLength(1)
  })

  it("rejeita lat fora de range", () => {
    expect(() => emergencyDispatchSchema.parse({ request: { lat: 91, lng: 0 } })).toThrow()
  })
})

// ---------------------------------------------------------------------------
// DISPUTE MEDIATION
// ---------------------------------------------------------------------------
describe("disputeMediationSchema", () => {
  const validData = {
    bookingId: "b1",
    clientId: "c1",
    clientName: "João",
    providerId: "p1",
    providerName: "Maria",
    serviceTitle: "Limpeza",
    serviceDescription: "Limpeza residencial",
    totalAmount: 200,
    clientComplaint: "Serviço não foi concluído corretamente",
    chatMessageCount: 5,
    hasBeforePhotos: true,
    hasAfterPhotos: false,
    providerRating: 4,
    providerCompletedJobs: 50,
    providerDisputeRate: 5,
  }

  it("aceita dados válidos", () => {
    expect(disputeMediationSchema.parse(validData)).toBeDefined()
  })

  it("rejeita reclamação com menos de 10 caracteres", () => {
    expect(() => disputeMediationSchema.parse({ ...validData, clientComplaint: "curta" })).toThrow()
  })

  it("rejeita totalAmount negativo", () => {
    expect(() => disputeMediationSchema.parse({ ...validData, totalAmount: -1 })).toThrow()
  })
})

// ---------------------------------------------------------------------------
// GTM LEAD CREATE
// ---------------------------------------------------------------------------
describe("gtmLeadCreateSchema", () => {
  it("aceita dados mínimos", () => {
    const result = gtmLeadCreateSchema.parse({
      name: "João Silva",
      profession: "Encanador",
      phone: "11999998888",
    })
    expect(result.status).toBe("NEW")
    expect(result.city).toBe("São Paulo")
  })

  it("aceita com todos os campos", () => {
    const result = gtmLeadCreateSchema.parse({
      name: "Maria",
      profession: "Eletricista",
      phone: "11988887777",
      city: "Campinas",
      state: "SP",
      status: "CONTACTED",
      source: "INSTAGRAM_OUTREACH",
      notes: "Lead quente",
    })
    expect(result.status).toBe("CONTACTED")
  })
})

// ---------------------------------------------------------------------------
// GTM LEAD UPDATE
// ---------------------------------------------------------------------------
describe("gtmLeadUpdateSchema", () => {
  it("aceita update válido", () => {
    const result = gtmLeadUpdateSchema.parse({
      id: "lead1",
      status: "DEMO_SCHEDULED",
    })
    expect(result.id).toBe("lead1")
  })

  it("rejeita id vazio", () => {
    expect(() => gtmLeadUpdateSchema.parse({ id: "", status: "NEW" })).toThrow()
  })
})

// ---------------------------------------------------------------------------
// VISION DIAGNOSTIC
// ---------------------------------------------------------------------------
describe("visionDiagnosticSchema", () => {
  it("aceita imageBase64", () => {
    const result = visionDiagnosticSchema.parse({ imageBase64: "data:image/png;base64,abc" })
    expect(result.imageBase64).toBeDefined()
  })

  it("aceita imageUrl", () => {
    const result = visionDiagnosticSchema.parse({ imageUrl: "https://example.com/img.jpg" })
    expect(result.imageUrl).toBeDefined()
  })

  it("aceita clientDescription", () => {
    const result = visionDiagnosticSchema.parse({ clientDescription: "Rachadura na parede" })
    expect(result.clientDescription).toBeDefined()
  })

  it("rejeita objeto vazio", () => {
    expect(() => visionDiagnosticSchema.parse({})).toThrow()
  })
})

// ---------------------------------------------------------------------------
// ROUTE OPTIMIZATION
// ---------------------------------------------------------------------------
describe("routeOptimizationSchema", () => {
  it("aceita dados válidos", () => {
    const result = routeOptimizationSchema.parse({
      baseLocation: { lat: -23.55, lng: -46.63 },
      stops: [{ id: "s1", title: "Parada 1", address: "Rua A", lat: -23.56, lng: -46.64 }],
    })
    expect(result.stops).toHaveLength(1)
  })

  it("rejeita sem stops", () => {
    expect(() =>
      routeOptimizationSchema.parse({
        baseLocation: { lat: -23.55, lng: -46.63 },
        stops: [],
      }),
    ).toThrow()
  })

  it("rejeita mais de 50 stops", () => {
    const stops = Array.from({ length: 51 }, (_, i) => ({
      id: `s${i}`,
      title: `Stop ${i}`,
      address: `Address ${i}`,
      lat: -23.55,
      lng: -46.63,
    }))
    expect(() =>
      routeOptimizationSchema.parse({
        baseLocation: { lat: -23.55, lng: -46.63 },
        stops,
      }),
    ).toThrow()
  })
})

// ---------------------------------------------------------------------------
// MEI REPORT
// ---------------------------------------------------------------------------
describe("meiReportSchema", () => {
  it("aceita dados mínimos", () => {
    const result = meiReportSchema.parse({
      providerId: "p1",
      providerName: "João",
      year: 2024,
    })
    expect(result.bookings).toEqual([])
  })

  it("aceita com bookings", () => {
    const result = meiReportSchema.parse({
      providerId: "p1",
      providerName: "João",
      year: 2024,
      bookings: [{ totalAmount: 500, distanceKm: 10, materialsCost: 50 }],
    })
    expect(result.bookings).toHaveLength(1)
  })

  it("rejeita year fora de range", () => {
    expect(() =>
      meiReportSchema.parse({ providerId: "p1", providerName: "J", year: 2019 }),
    ).toThrow()
  })
})

// ---------------------------------------------------------------------------
// MATRIX ETA
// ---------------------------------------------------------------------------
describe("matrixEtaSchema", () => {
  it("aceita dados válidos", () => {
    const result = matrixEtaSchema.parse({
      origin: { lat: -23.55, lng: -46.63 },
      destinations: [{ id: "d1", lat: -23.56, lng: -46.64 }],
    })
    expect(result.destinations).toHaveLength(1)
  })

  it("rejeita sem destinations", () => {
    expect(() =>
      matrixEtaSchema.parse({
        origin: { lat: -23.55, lng: -46.63 },
        destinations: [],
      }),
    ).toThrow()
  })
})

// ---------------------------------------------------------------------------
// LOGIN
// ---------------------------------------------------------------------------
describe("loginSchema", () => {
  it("aceita credenciais válidas", () => {
    expect(loginSchema.parse({ email: "a@b.com", password: "123" })).toBeDefined()
  })

  it("rejeita email inválido", () => {
    expect(() => loginSchema.parse({ email: "x", password: "123" })).toThrow()
  })
})

// ---------------------------------------------------------------------------
// REGISTER
// ---------------------------------------------------------------------------
describe("registerSchema", () => {
  it("aceita registro válido com role CLIENT", () => {
    const result = registerSchema.parse({
      name: "João Silva",
      email: "joao@test.com",
      password: "Senha123",
      confirmPassword: "Senha123",
      role: "CLIENT",
    })
    expect(result.role).toBe("CLIENT")
  })

  it("rejeita senhas diferentes", () => {
    expect(() =>
      registerSchema.parse({
        name: "João",
        email: "j@t.com",
        password: "Senha123",
        confirmPassword: "Senha456",
        role: "CLIENT",
      }),
    ).toThrow()
  })

  it("rejeita role inválido", () => {
    expect(() =>
      registerSchema.parse({
        name: "João",
        email: "j@t.com",
        password: "Senha123",
        confirmPassword: "Senha123",
        role: "ADMIN",
      }),
    ).toThrow()
  })
})

// ---------------------------------------------------------------------------
// BOOKING UPDATE
// ---------------------------------------------------------------------------
describe("bookingUpdateSchema", () => {
  it("aceita status válido", () => {
    expect(bookingUpdateSchema.parse({ status: "CONFIRMED" })).toBeDefined()
  })

  it("rejeita status inválido", () => {
    expect(() => bookingUpdateSchema.parse({ status: "INVALID" })).toThrow()
  })
})

// ---------------------------------------------------------------------------
// SETTING
// ---------------------------------------------------------------------------
describe("settingSchema", () => {
  it("aceita key e value", () => {
    expect(settingSchema.parse({ key: "SITE_NAME", value: "Severinno" })).toBeDefined()
  })

  it("rejeita key com caracteres especiais", () => {
    expect(() => settingSchema.parse({ key: "site-name!", value: "x" })).toThrow()
  })
})

// ---------------------------------------------------------------------------
// AVAILABILITY
// ---------------------------------------------------------------------------
describe("availabilitySchema", () => {
  it("aceita dados válidos", () => {
    const result = availabilitySchema.parse({
      dayOfWeek: 1,
      startTime: "09:00",
      endTime: "18:00",
    })
    expect(result.active).toBe(true)
  })

  it("rejeita dayOfWeek fora de range", () => {
    expect(() =>
      availabilitySchema.parse({ dayOfWeek: 7, startTime: "09:00", endTime: "18:00" }),
    ).toThrow()
  })

  it("rejeita formato de hora inválido", () => {
    expect(() =>
      availabilitySchema.parse({ dayOfWeek: 1, startTime: "9am", endTime: "6pm" }),
    ).toThrow()
  })
})

// ---------------------------------------------------------------------------
// DATE BLOCK
// ---------------------------------------------------------------------------
describe("dateBlockSchema", () => {
  it("aceita dados mínimos", () => {
    const result = dateBlockSchema.parse({ date: "2024-12-25" })
    expect(result.allDay).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// SLUG
// ---------------------------------------------------------------------------
describe("slugSchema", () => {
  it("aceita slug válido", () => {
    expect(slugSchema.parse("minha-pagina")).toBe("minha-pagina")
  })

  it("rejeita slug com espaços", () => {
    expect(() => slugSchema.parse("minha pagina")).toThrow()
  })

  it("rejeita slug com maiúsculas", () => {
    expect(() => slugSchema.parse("MinhaPagina")).toThrow()
  })
})

// ---------------------------------------------------------------------------
// CATEGORY UPDATE
// ---------------------------------------------------------------------------
describe("categoryUpdateSchema", () => {
  it("aceita update com id", () => {
    expect(categoryUpdateSchema.parse({ id: "c1" })).toBeDefined()
  })

  it("aceita update com name", () => {
    const result = categoryUpdateSchema.parse({ id: "c1", name: "Nova" })
    expect(result.name).toBe("Nova")
  })
})
