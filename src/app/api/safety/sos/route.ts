import { NextRequest, NextResponse } from "next/server"
import { triggerEmergencySOS, getSOSIncident, updateSOSStatus } from "@/lib/emergency-sos"

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const {
      userId,
      userName,
      userRole,
      bookingId,
      latitude,
      longitude,
      accuracy,
      triggerType,
      emergencyContacts,
      notes,
    } = body

    if (!userId || !userName || !userRole || latitude === undefined || longitude === undefined) {
      return NextResponse.json(
        { error: "Dados incompletos para acionamento do SOS" },
        { status: 400 },
      )
    }

    const incident = triggerEmergencySOS({
      userId,
      userName,
      userRole,
      bookingId,
      latitude: Number(latitude),
      longitude: Number(longitude),
      accuracy: accuracy ? Number(accuracy) : undefined,
      triggerType,
      emergencyContacts,
      notes,
    })

    return NextResponse.json({
      success: true,
      message: "Protocolo SOS de Emergência acionado com sucesso",
      incident,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao acionar protocolo SOS"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get("id")

  if (!id) {
    return NextResponse.json({ error: "ID do incidente é obrigatório" }, { status: 400 })
  }

  const incident = getSOSIncident(id)
  if (!incident) {
    return NextResponse.json({ error: "Incidente não encontrado" }, { status: 404 })
  }

  return NextResponse.json({ success: true, incident })
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json()
    const { sosId, status, operatorId, resolutionNotes } = body

    if (!sosId || !status || !operatorId) {
      return NextResponse.json(
        { error: "sosId, status e operatorId são obrigatórios" },
        { status: 400 },
      )
    }

    const updated = updateSOSStatus(sosId, status, operatorId, resolutionNotes)
    return NextResponse.json({ success: true, incident: updated })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao atualizar status do SOS"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
