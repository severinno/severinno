import { z } from "zod"
import { isCommonPassword } from "@/lib/common-passwords"

// ---------------------------------------------------------------------------
// AUTH
// ---------------------------------------------------------------------------
const cpfCnpjRegex = /^[\d.\-/]+$/

/**
 * Reusable password schema — enforces:
 * - Minimum 8 characters
 * - At least 1 uppercase letter
 * - At least 1 number
 * - Not a common password (top 100)
 */
export const passwordSchema = z
  .string()
  .min(8, "Senha deve ter ao menos 8 caracteres")
  .regex(/[A-Z]/, "Senha deve conter ao menos 1 letra maiúscula")
  .regex(/\d/, "Senha deve conter ao menos 1 número")
  .refine((pw) => !isCommonPassword(pw), "Esta senha é muito comum. Escolha uma senha mais segura.")

export const loginSchema = z.object({
  email: z.string().email("E-mail inválido"),
  password: z.string().min(1, "Senha é obrigatória"),
})
export type LoginInput = z.infer<typeof loginSchema>

export const registerSchema = z
  .object({
    name: z.string().min(2, "Informe seu nome completo"),
    email: z.string().email("E-mail inválido"),
    password: passwordSchema,
    confirmPassword: z.string(),
    role: z.enum(["CLIENT", "PROVIDER"], {
      message: "Selecione um tipo de conta",
    }),
    cpfCnpj: z
      .string()
      .min(11, "CPF/CNPJ inválido")
      .max(18)
      .regex(cpfCnpjRegex, "CPF/CNPJ inválido")
      .optional()
      .or(z.literal("")),
    whatsapp: z.string().min(10, "WhatsApp inválido").optional().or(z.literal("")),
    phone: z.string().optional().or(z.literal("")),
    cep: z.string().optional().or(z.literal("")),
    street: z.string().optional().or(z.literal("")),
    number: z.string().optional().or(z.literal("")),
    complement: z.string().optional().or(z.literal("")),
    district: z.string().optional().or(z.literal("")),
    city: z.string().optional().or(z.literal("")),
    state: z.string().max(2).optional().or(z.literal("")),
    lat: z.coerce.number().optional(),
    lng: z.coerce.number().optional(),
    // Provider-only
    bio: z.string().max(600).optional().or(z.literal("")),
    radiusKm: z.coerce.number().min(1).max(200).optional(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: "As senhas não conferem",
    path: ["confirmPassword"],
  })
  .refine(
    (d) => d.role !== "PROVIDER" || (Boolean(d.cpfCnpj) && Boolean(d.whatsapp) && Boolean(d.city)),
    {
      message: "Prestadores devem informar CPF/CNPJ, WhatsApp e cidade",
      path: ["role"],
    },
  )
export type RegisterInput = z.infer<typeof registerSchema>

// ---------------------------------------------------------------------------
// PROFILE (provider update)
// ---------------------------------------------------------------------------
export const providerProfileSchema = z.object({
  name: z.string().min(2),
  bio: z.string().max(600).optional().or(z.literal("")),
  whatsapp: z.string().optional().or(z.literal("")),
  phone: z.string().optional().or(z.literal("")),
  avatarUrl: z.string().url().optional().or(z.literal("")),
  coverUrl: z.string().url().optional().or(z.literal("")),
  cep: z.string().optional().or(z.literal("")),
  street: z.string().optional().or(z.literal("")),
  number: z.string().optional().or(z.literal("")),
  complement: z.string().optional().or(z.literal("")),
  district: z.string().optional().or(z.literal("")),
  city: z.string().optional().or(z.literal("")),
  state: z.string().max(2).optional().or(z.literal("")),
  lat: z.coerce.number().optional(),
  lng: z.coerce.number().optional(),
  radiusKm: z.coerce.number().min(1).max(200).optional(),
  soundEnabled: z.boolean().optional(),
  vibrateEnabled: z.boolean().optional(),
})
export type ProviderProfileInput = z.infer<typeof providerProfileSchema>

// ---------------------------------------------------------------------------
// SERVICE
// ---------------------------------------------------------------------------
export const serviceUnitEnum = z.enum(["UNIDADE", "METRO_LINEAR", "METRO_QUADRADO", "METRO_CUBICO"])

export const serviceSchema = z.object({
  title: z.string().min(3, "Título muito curto").max(80),
  description: z.string().min(10, "Descreva melhor o serviço").max(1200),
  categoryId: z.string().min(1, "Selecione uma subcategoria"),
  basePrice: z.coerce.number().min(0, "Preço deve ser positivo").max(1_000_000),
  unit: serviceUnitEnum.default("UNIDADE"),
  photos: z.array(z.string().url()).max(4, "Máximo de 4 fotos").default([]),
  active: z.boolean().default(true),
})
export type ServiceInput = z.infer<typeof serviceSchema>

// ---------------------------------------------------------------------------
// CATEGORY
// ---------------------------------------------------------------------------
export const categorySchema = z.object({
  name: z.string().min(2).max(80),
  slug: z
    .string()
    .min(2)
    .max(80)
    .regex(/^[a-z0-9-]+$/, "Slug deve ter apenas letras, números e hífens"),
  parentId: z.string().optional().or(z.null()),
  level: z.number().int().min(0).max(2).default(0),
  icon: z.string().optional().or(z.literal("")),
  order: z.number().int().default(0),
  active: z.boolean().default(true),
})
export type CategoryInput = z.infer<typeof categorySchema>

// ---------------------------------------------------------------------------
// QUOTE REQUEST
// ---------------------------------------------------------------------------
export const quoteItemInputSchema = z.object({
  serviceId: z.string().min(1),
  description: z.string().min(3).max(400),
  quantity: z.coerce.number().min(0.01).max(100000),
  unit: serviceUnitEnum,
  photos: z.array(z.string().url()).max(4).default([]),
})
export type QuoteItemInput = z.infer<typeof quoteItemInputSchema>

export const quoteSchema = z.object({
  providerId: z.string().min(1),
  address: z.string().min(3, "Informe o endereço"),
  cep: z.string().min(8, "CEP inválido"),
  lat: z.coerce.number(),
  lng: z.coerce.number(),
  expiresAt: z.coerce.date().optional(),
  items: z.array(quoteItemInputSchema).min(1, "Adicione ao menos um item ao orçamento"),
})
export type QuoteInput = z.infer<typeof quoteSchema>

// Quote item response from provider
export const quoteItemResponseSchema = z.object({
  price: z.coerce.number().min(0),
  providerNote: z.string().max(500).optional().or(z.literal("")),
  status: z.enum(["QUOTED", "REJECTED"]).default("QUOTED"),
})
export type QuoteItemResponse = z.infer<typeof quoteItemResponseSchema>

// ---------------------------------------------------------------------------
// BOOKING
// ---------------------------------------------------------------------------
export const bookingSchema = z.object({
  providerId: z.string().min(1),
  serviceId: z.string().min(1),
  scheduledAt: z.coerce.date(),
  address: z.string().min(3),
  cep: z.string().min(8),
  lat: z.coerce.number(),
  lng: z.coerce.number(),
  amount: z.coerce.number().min(0).max(1_000_000),
  paymentMethod: z.enum(["CARD", "PIX"]).default("PIX"),
  notes: z
    .string()
    .max(1000)
    .optional()
    .or(z.literal(""))
    .transform((v) => {
      if (!v) return ""
      return v
        .trim()
        .replace(/<[^>]*>/g, "")
        .replace(/&[a-z]+;/gi, "")
        .slice(0, 1000)
    }),
})
export type BookingInput = z.infer<typeof bookingSchema>

// ---------------------------------------------------------------------------
// REVIEW
// ---------------------------------------------------------------------------
export const reviewSchema = z
  .object({
    bookingId: z.string().min(1),
    rating: z.coerce.number().int().min(1).max(5).optional(),
    comment: z.string().max(1000).optional().or(z.literal("")),
    // Bidirectional: provider rates the client
    providerRating: z.coerce.number().int().min(1).max(5).optional(),
    providerComment: z.string().max(1000).optional().or(z.literal("")),
  })
  .refine((data) => data.rating != null || data.providerRating != null, {
    message: "Ao menos um rating (client ou provider) é obrigatório",
  })
export type ReviewInput = z.infer<typeof reviewSchema>

// ---------------------------------------------------------------------------
// MESSAGE
// ---------------------------------------------------------------------------
export const messageSchema = z.object({
  toId: z.string().min(1),
  content: z.string().min(1).max(2000),
  bookingId: z.string().optional().or(z.literal("")),
})
export type MessageInput = z.infer<typeof messageSchema>

// ---------------------------------------------------------------------------
// GEO SEARCH (Nominatim forward geocoding)
// ---------------------------------------------------------------------------

export const geocodeSearchSchema = z.object({
  q: z.string().min(3, "Busca deve ter ao menos 3 caracteres").max(200),
  limit: z.coerce.number().int().min(1).max(10).default(5),
})
export type GeocodeSearchInput = z.infer<typeof geocodeSearchSchema>

export const geocodeSearchStructuredSchema = z.object({
  street: z.string().max(200).optional(),
  city: z.string().max(100).optional(),
  state: z.string().max(100).optional(),
  country: z.string().max(100).optional(),
  postcode: z.string().max(20).optional(),
  limit: z.coerce.number().int().min(1).max(10).default(5),
})
export type GeocodeSearchStructuredInput = z.infer<typeof geocodeSearchStructuredSchema>

// ---------------------------------------------------------------------------
// GEO CEP (ViaCEP geocoding)
// ---------------------------------------------------------------------------

export const geocodeCepSchema = z.object({
  cep: z
    .string()
    .min(8, "CEP deve ter 8 dígitos")
    .max(9)
    .transform((v) => v.replace(/\D/g, ""))
    .refine((v) => v.length === 8, "CEP deve ter 8 dígitos numéricos"),
})
export type GeocodeCepInput = z.infer<typeof geocodeCepSchema>

// ---------------------------------------------------------------------------
// SETTING (admin)
// ---------------------------------------------------------------------------
export const settingSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[A-Za-z0-9_]+$/, "Chave deve ter letras, números e _"),
  value: z.string().max(4000),
})
export type SettingInput = z.infer<typeof settingSchema>

// ---------------------------------------------------------------------------
// AVAILABILITY
// ---------------------------------------------------------------------------
export const availabilitySchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  startTime: z.string().regex(/^\d{2}:\d{2}$/, "Formato HH:mm"),
  endTime: z.string().regex(/^\d{2}:\d{2}$/, "Formato HH:mm"),
  active: z.boolean().default(true),
})
export type AvailabilityInput = z.infer<typeof availabilitySchema>

// ---------------------------------------------------------------------------
// DATE BLOCK (provider blocks specific dates, e.g. vacations)
// ---------------------------------------------------------------------------
export const dateBlockSchema = z.object({
  date: z.coerce.date(),
  allDay: z.boolean().default(false),
  startTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/, "Formato HH:mm")
    .optional()
    .or(z.literal("")),
  endTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/, "Formato HH:mm")
    .optional()
    .or(z.literal("")),
  reason: z.string().max(500).optional().or(z.literal("")),
})
export type DateBlockInput = z.infer<typeof dateBlockSchema>

// ---------------------------------------------------------------------------
// SLUG
// ---------------------------------------------------------------------------
export const slugSchema = z
  .string()
  .min(2)
  .max(80)
  .regex(/^[a-z0-9-]+$/, "Slug deve ter apenas letras, números e hífens")

// ---------------------------------------------------------------------------
// BOOKING UPDATE
// ---------------------------------------------------------------------------
const BOOKING_STATUSES = ["PENDING", "CONFIRMED", "IN_PROGRESS", "COMPLETED", "CANCELLED"] as const

export const bookingUpdateSchema = z.object({
  status: z.enum(BOOKING_STATUSES, {
    message: `Status inválido. Valores permitidos: ${BOOKING_STATUSES.join(", ")}`,
  }),
})

// ---------------------------------------------------------------------------
// CATEGORY UPDATE
// ---------------------------------------------------------------------------
export const categoryUpdateSchema = z.object({
  id: z.string().min(1, "ID obrigatório"),
  name: z.string().min(1).max(100).optional(),
  slug: z
    .string()
    .min(2)
    .max(80)
    .regex(/^[a-z0-9-]+$/, "Slug deve ter apenas letras, números e hífens")
    .optional(),
  parentId: z.string().nullable().optional(),
  level: z.number().int().min(0).max(3).optional(),
  icon: z.string().max(50).nullable().optional(),
  order: z.number().int().min(0).optional(),
  active: z.boolean().optional(),
})

// ---------------------------------------------------------------------------
// NEWSLETTER
// ---------------------------------------------------------------------------
export const newsletterSchema = z.object({
  email: z
    .string()
    .min(1, "E-mail é obrigatório")
    .max(254)
    .transform((v) => v.trim().toLowerCase())
    .pipe(z.string().email("E-mail inválido")),
})
export type NewsletterInput = z.infer<typeof newsletterSchema>

// ---------------------------------------------------------------------------
// CHAT (AI Assistant)
// ---------------------------------------------------------------------------
export const chatMessageSchema = z.object({
  message: z
    .string()
    .min(1, "Mensagem é obrigatória")
    .max(2000, "Mensagem muito longa")
    .transform((v) =>
      v
        .trim()
        .replace(/<[^>]*>/g, "")
        .replace(/&[a-z]+;/gi, "")
        .slice(0, 2000),
    )
    .refine((v) => v.length > 0, "Mensagem é obrigatória"),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(2000),
      }),
    )
    .optional()
    .default([])
    .transform((v) => v.slice(-10)),
})
export type ChatMessageInput = z.infer<typeof chatMessageSchema>

// ---------------------------------------------------------------------------
// CHECKIN ESCROW
// ---------------------------------------------------------------------------
export const checkinEscrowSchema = z.union([
  z.object({
    action: z.literal("checkin"),
    bookingId: z.string().min(1),
    providerId: z.string().optional().default("unknown"),
    providerLat: z.number().min(-90).max(90),
    providerLng: z.number().min(-180).max(180),
    clientAddressLat: z.number().min(-90).max(90),
    clientAddressLng: z.number().min(-180).max(180),
  }),
  z.object({
    action: z.literal("generate-pin"),
    bookingId: z.string().min(1),
  }),
  z.object({
    action: z.literal("release-escrow"),
    bookingId: z.string().min(1),
    pin: z.string().min(4).max(8),
    escrowAmount: z.number().min(0),
  }),
])
export type CheckinEscrowInput = z.infer<typeof checkinEscrowSchema>

// ---------------------------------------------------------------------------
// EMERGENCY DISPATCH
// ---------------------------------------------------------------------------
const emergencyProviderSchema = z.object({
  id: z.string(),
  name: z.string(),
  lat: z.number(),
  lng: z.number(),
  rating: z.number(),
  activeBookings: z.number(),
})

export const emergencyDispatchSchema = z.object({
  request: z.object({
    id: z.string().optional(),
    clientId: z.string().optional().default("unknown"),
    clientName: z.string().optional().default("Cliente"),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    category: z.string().optional().default("Emergência Geral"),
    description: z.string().max(1000).optional().default(""),
    severity: z.enum(["HIGH", "EMERGENCY"]).optional().default("EMERGENCY"),
    maxRadiusKm: z.number().min(1).max(100).optional().default(10),
    surgeMultiplier: z.number().min(1).max(5).optional(),
  }),
  availableProviders: z.array(emergencyProviderSchema).optional().default([]),
})
export type EmergencyDispatchInput = z.infer<typeof emergencyDispatchSchema>

// ---------------------------------------------------------------------------
// DISPUTE MEDIATION (admin)
// ---------------------------------------------------------------------------
export const disputeMediationSchema = z.object({
  bookingId: z.string().min(1, "bookingId é obrigatório"),
  clientId: z.string().min(1),
  clientName: z.string().min(1),
  providerId: z.string().min(1),
  providerName: z.string().min(1),
  serviceTitle: z.string().min(1),
  serviceDescription: z.string().min(1),
  totalAmount: z.number().min(0),
  clientComplaint: z.string().min(10, "Reclamação deve ter ao menos 10 caracteres").max(2000),
  providerResponse: z.string().max(2000).optional(),
  chatMessageCount: z.number().int().min(0),
  hasBeforePhotos: z.boolean(),
  hasAfterPhotos: z.boolean(),
  providerRating: z.number().min(0).max(5),
  providerCompletedJobs: z.number().int().min(0),
  providerDisputeRate: z.number().min(0).max(100),
})
export type DisputeMediationInput = z.infer<typeof disputeMediationSchema>

// ---------------------------------------------------------------------------
// GTM LEAD (admin)
// ---------------------------------------------------------------------------
export const gtmLeadCreateSchema = z.object({
  name: z.string().min(1, "Nome é obrigatório").max(200),
  profession: z.string().min(1, "Profissão é obrigatória").max(200),
  phone: z.string().min(10, "Telefone inválido").max(20),
  city: z.string().max(100).optional().default("São Paulo"),
  state: z.string().max(2).optional().default("SP"),
  district: z.string().max(100).optional().default(""),
  status: z
    .enum(["NEW", "CONTACTED", "DEMO_SCHEDULED", "ONBOARDED", "FIRST_SERVICE", "REJECTED"])
    .optional()
    .default("NEW"),
  source: z
    .enum([
      "WHATSAPP_SCRAPING",
      "INSTAGRAM_OUTREACH",
      "STORE_PARTNERSHIP",
      "ORGANIC_LANDING",
      "REFERRAL",
    ])
    .optional()
    .default("WHATSAPP_SCRAPING"),
  notes: z.string().max(2000).optional().default(""),
})
export type GtmLeadCreateInput = z.infer<typeof gtmLeadCreateSchema>

export const gtmLeadUpdateSchema = z.object({
  id: z.string().min(1, "ID é obrigatório"),
  status: z.enum(["NEW", "CONTACTED", "DEMO_SCHEDULED", "ONBOARDED", "FIRST_SERVICE", "REJECTED"]),
  notes: z.string().max(2000).optional(),
})
export type GtmLeadUpdateInput = z.infer<typeof gtmLeadUpdateSchema>

// ---------------------------------------------------------------------------
// VISION DIAGNOSTIC
// ---------------------------------------------------------------------------
export const visionDiagnosticSchema = z
  .object({
    imageBase64: z.string().max(10_000_000, "Imagem muito grande").optional(),
    imageUrl: z.string().url("URL inválida").optional(),
    clientDescription: z.string().max(2000).optional(),
  })
  .refine((data) => data.imageBase64 || data.imageUrl || data.clientDescription, {
    message: "Forneça imageBase64, imageUrl ou clientDescription",
  })
export type VisionDiagnosticInput = z.infer<typeof visionDiagnosticSchema>

// ---------------------------------------------------------------------------
// ROUTE OPTIMIZATION (provider)
// ---------------------------------------------------------------------------
export const routeOptimizationSchema = z.object({
  baseLocation: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
  }),
  stops: z
    .array(
      z.object({
        id: z.string().min(1),
        title: z.string().min(1).max(200),
        address: z.string().min(1).max(300),
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
        clientName: z.string().max(200).optional(),
        scheduledTime: z.string().max(20).optional(),
      }),
    )
    .min(1, "Adicione ao menos uma parada")
    .max(50, "Máximo de 50 paradas"),
})
export type RouteOptimizationInput = z.infer<typeof routeOptimizationSchema>

// ---------------------------------------------------------------------------
// MEI REPORT (provider)
// ---------------------------------------------------------------------------
export const meiReportSchema = z.object({
  providerId: z.string().min(1),
  providerName: z.string().min(1),
  year: z.coerce.number().int().min(2020).max(2030),
  bookings: z
    .array(
      z.object({
        completedAt: z.coerce.date().optional(),
        totalAmount: z.number().min(0).optional().default(0),
        distanceKm: z.number().min(0).optional().default(0),
        materialsCost: z.number().min(0).optional().default(0),
      }),
    )
    .optional()
    .default([]),
  cnpj: z.string().max(18).optional(),
})
export type MeiReportInput = z.infer<typeof meiReportSchema>

// ---------------------------------------------------------------------------
// MATRIX ETA (geo)
// ---------------------------------------------------------------------------
export const matrixEtaSchema = z.object({
  origin: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
  }),
  destinations: z
    .array(
      z.object({
        id: z.string().min(1),
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
      }),
    )
    .min(1, "Adicione ao menos um destino")
    .max(50, "Máximo de 50 destinos por requisição"),
})
export type MatrixEtaInput = z.infer<typeof matrixEtaSchema>
