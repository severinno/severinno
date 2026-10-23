import { NextResponse } from "next/server"
import { withRoute } from "@/lib/api-route"
import { requireUser } from "@/lib/auth"
import { assertRateLimit } from "@/lib/rate-limit"
import {
  triggerEmergencySOS,
  getSOSIncident,
  updateSOSStatus,
  type SOSStatus,
  type SOSTriggerType,
} from "@/lib/emergency-sos"
import { forbidden, badRequest, notFound } from "@/lib/api-server"

export const dynamic = "force-dynamic"

export const POST = withRoute("api.safety.sos.POST", async (req) => {
  await assertRateLimit(req, { prefix: "sos-trigger", max: 5, windowMs: 60_000 })
  const session = await requireUser()

  const body = await req.json()
  const {
    userName,
    bookingId,
    latitude,
    longitude,
    accuracy,
    triggerType,
    emergencyContacts,
    notes,
  } = body

  if (latitude === undefined || longitude === undefined) {
    throw badRequest("Coordenadas de latitude e longitude são obrigatórias para acionamento do SOS")
  }

  const incident = triggerEmergencySOS({
    userId: session.userId,
    userName:
      typeof userName === "string" && userName.trim()
        ? userName.trim()
        : session.role === "PROVIDER"
          ? "Prestador"
          : "Cliente",
    userRole: session.role === "PROVIDER" ? "PROVIDER" : "CLIENT",
    bookingId: typeof bookingId === "string" ? bookingId : undefined,
    latitude: Number(latitude),
    longitude: Number(longitude),
    accuracy: accuracy ? Number(accuracy) : undefined,
    triggerType: triggerType as SOSTriggerType,
    emergencyContacts: Array.isArray(emergencyContacts) ? emergencyContacts : undefined,
    notes: typeof notes === "string" ? notes : undefined,
  })

  return NextResponse.json({
    success: true,
    message: "Protocolo SOS de Emergência acionado com sucesso",
    incident,
  })
})

export const GET = withRoute("api.safety.sos.GET", async (req) => {
  await assertRateLimit(req, { prefix: "sos-get", max: 30, windowMs: 60_000 })
  const session = await requireUser()

  const { searchParams } = new URL(req.url)
  const id = searchParams.get("id")

  if (!id) {
    throw badRequest("ID do incidente é obrigatório")
  }

  const incident = getSOSIncident(id)
  if (!incident) {
    throw notFound("Incidente não encontrado")
  }

  // Apenas o usuário que acionou ou administradores podem consultar o incidente
  if (incident.userId !== session.userId && session.role !== "ADMIN") {
    throw forbidden("Acesso não autorizado ao incidente")
  }

  return NextResponse.json({ success: true, incident })
})

export const PATCH = withRoute("api.safety.sos.PATCH", async (req) => {
  await assertRateLimit(req, { prefix: "sos-update", max: 20, windowMs: 60_000 })
  const session = await requireUser()

  const body = await req.json()
  const { sosId, status, resolutionNotes } = body

  if (!sosId || !status) {
    throw badRequest("sosId e status são obrigatórios")
  }

  const incident = getSOSIncident(sosId)
  if (!incident) {
    throw notFound("Incidente não encontrado")
  }

  // Regra de autorização:
  // - Administrador pode atualizar qualquer status
  // - O próprio usuário pode marcar como RESOLVED ou FALSE_ALARM
  const isOwner = incident.userId === session.userId
  const isAdmin = session.role === "ADMIN"

  if (!isAdmin && !isOwner) {
    throw forbidden("Apenas o autor do chamado ou administradores podem atualizar o incidente")
  }

  const operatorId = isAdmin ? session.userId : "owner-self-resolve"
  const updated = updateSOSStatus(sosId, status as SOSStatus, operatorId, resolutionNotes)
  return NextResponse.json({ success: true, incident: updated })
})
