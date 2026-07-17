import { z } from "zod"

// ---------------------------------------------------------------------------
// AUTH
// ---------------------------------------------------------------------------
const cpfCnpjRegex = /^[\d.\-/]+$/

export const loginSchema = z.object({
  email: z.string().email("E-mail inválido"),
  password: z.string().min(6, "Senha deve ter ao menos 6 caracteres"),
})
export type LoginInput = z.infer<typeof loginSchema>

export const registerSchema = z
  .object({
    name: z.string().min(2, "Informe seu nome completo"),
    email: z.string().email("E-mail inválido"),
    password: z.string().min(6, "Senha deve ter ao menos 6 caracteres"),
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
    whatsapp: z
      .string()
      .min(10, "WhatsApp inválido")
      .optional()
      .or(z.literal("")),
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
    (d) =>
      d.role !== "PROVIDER" ||
      (Boolean(d.cpfCnpj) && Boolean(d.whatsapp) && Boolean(d.city)),
    {
      message:
        "Prestadores devem informar CPF/CNPJ, WhatsApp e cidade",
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
})
export type ProviderProfileInput = z.infer<typeof providerProfileSchema>

// ---------------------------------------------------------------------------
// SERVICE
// ---------------------------------------------------------------------------
export const serviceUnitEnum = z.enum([
  "UNIDADE",
  "METRO_LINEAR",
  "METRO_QUADRADO",
  "METRO_CUBICO",
])

export const serviceSchema = z.object({
  title: z.string().min(3, "Título muito curto").max(80),
  description: z.string().min(10, "Descreva melhor o serviço").max(1200),
  categoryId: z.string().min(1, "Selecione uma subcategoria"),
  basePrice: z.coerce
    .number()
    .min(0, "Preço deve ser positivo")
    .max(1_000_000),
  unit: serviceUnitEnum.default("UNIDADE"),
  photos: z
    .array(z.string().url())
    .max(4, "Máximo de 4 fotos")
    .default([]),
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
  items: z
    .array(quoteItemInputSchema)
    .min(1, "Adicione ao menos um item ao orçamento"),
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
  amount: z.coerce.number().min(0),
  paymentMethod: z.enum(["CARD", "PIX"]).default("PIX"),
  notes: z.string().max(1000).optional().or(z.literal("")),
})
export type BookingInput = z.infer<typeof bookingSchema>

// ---------------------------------------------------------------------------
// REVIEW
// ---------------------------------------------------------------------------
export const reviewSchema = z.object({
  bookingId: z.string().min(1),
  rating: z.coerce.number().int().min(1).max(5),
  comment: z.string().max(1000).optional().or(z.literal("")),
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
// SETTING (admin)
// ---------------------------------------------------------------------------
export const settingSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[A-Z0-9_]+$/, "Chave deve ter letras maiúsculas, números e _"),
  value: z.string().max(4000),
})
export type SettingInput = z.infer<typeof settingSchema>

// ---------------------------------------------------------------------------
// AVAILABILITY
// ---------------------------------------------------------------------------
export const availabilitySchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  startTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/, "Formato HH:mm"),
  endTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/, "Formato HH:mm"),
  active: z.boolean().default(true),
})
export type AvailabilityInput = z.infer<typeof availabilitySchema>
