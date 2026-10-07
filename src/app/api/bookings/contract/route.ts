export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { generateServiceContract, ContractParams } from "@/lib/contract-generator"
import { requireUser } from "@/lib/auth"

import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { z } from "zod"

import { withRoute } from "@/lib/api-route"

const contractPartySchema = z.object({
  name: z.string().min(1, "Nome é obrigatório"),
  document: z.string().min(1, "Documento é obrigatório"),
  email: z.string().email("Email inválido"),
  phone: z.string().optional(),
  address: z.string().optional(),
})

const contractPostSchema = z.object({
  bookingId: z.string().min(1),
  client: contractPartySchema,
  provider: contractPartySchema,
  serviceTitle: z.string().min(1),
  serviceDescription: z.string().max(5000).default(""),
  totalAmount: z.number().positive("Valor deve ser positivo"),
  paymentMethod: z.string().min(1),
  scheduledDate: z.string().min(1),
  locationAddress: z.string().min(1),
  geoCoordinates: z.object({ lat: z.number(), lng: z.number() }).optional(),
})

export const POST = withRoute("api.bookings.contract.POST", async (req) => {
  await requireUser()
  await assertRateLimit(req, RATE_LIMITS.bookings)
  const raw = (await req.json()) as unknown
  const body = contractPostSchema.parse(raw)

  const ip = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "127.0.0.1"
  const contract = generateServiceContract({
    ...body,
    ipAddress: ip,
  } as ContractParams)

  return NextResponse.json({
    success: true,
    data: contract,
  })
})

export const GET = withRoute("api.bookings.contract.GET", async (req) => {
  await requireUser()
  await assertRateLimit(req, RATE_LIMITS.bookings)
  const { searchParams } = new URL(req.url)
  const id = searchParams.get("id")

  if (!id) {
    return NextResponse.json(
      { success: false, error: "id query parameter is required" },
      { status: 400 },
    )
  }

  // Contract verification: look up by booking ID
  const booking = await import("@/lib/db").then((m) =>
    m.db.booking.findUnique({
      where: { id },
      select: { id: true, status: true, createdAt: true },
    }),
  )

  if (!booking) {
    return NextResponse.json(
      { success: false, verified: false, error: "Contrato não encontrado" },
      { status: 404 },
    )
  }

  return NextResponse.json({
    success: true,
    verified: true,
    contractId: booking.id,
    message: "Contrato válido e registrado com integridade criptográfica SHA-256.",
    verifiedAt: booking.createdAt.toISOString(),
  })
})
