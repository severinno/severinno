import { NextRequest, NextResponse } from "next/server"
import { GTMEngine, LeadStatus } from "@/lib/gtm-engine"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"

export async function GET(req: NextRequest) {
  await assertRateLimit(req, RATE_LIMITS.admin)
  try {
    const { searchParams } = new URL(req.url)
    const status = (searchParams.get("status") as LeadStatus) || undefined
    const city = searchParams.get("city") || undefined
    const search = searchParams.get("search") || undefined

    const leads = GTMEngine.listLeads({ status, city, search })
    const metrics = GTMEngine.getFunnelMetrics()

    return NextResponse.json({
      success: true,
      data: {
        leads,
        metrics,
      },
    })
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Erro ao carregar leads GTM",
      },
      { status: 500 },
    )
  }
}

export async function POST(req: NextRequest) {
  await assertRateLimit(req, RATE_LIMITS.admin)
  try {
    const body = await req.json()

    // Handle batch import or single creation
    if (Array.isArray(body)) {
      const created = body.map((item) => GTMEngine.createLead(item))
      return NextResponse.json(
        {
          success: true,
          count: created.length,
          data: created,
        },
        { status: 201 },
      )
    }

    if (!body.name || !body.profession || !body.phone) {
      return NextResponse.json(
        {
          success: false,
          error: "Campos obrigatórios: name, profession, phone",
        },
        { status: 400 },
      )
    }

    const lead = GTMEngine.createLead({
      name: body.name,
      profession: body.profession,
      phone: body.phone,
      city: body.city || "São Paulo",
      state: body.state || "SP",
      district: body.district || "",
      status: body.status || "NEW",
      source: body.source || "WHATSAPP_SCRAPING",
      notes: body.notes || "",
    })

    return NextResponse.json(
      {
        success: true,
        data: lead,
      },
      { status: 201 },
    )
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Erro ao criar lead GTM",
      },
      { status: 500 },
    )
  }
}

export async function PATCH(req: NextRequest) {
  await assertRateLimit(req, RATE_LIMITS.admin)
  try {
    const body = await req.json()

    if (!body.id || !body.status) {
      return NextResponse.json(
        {
          success: false,
          error: "Campos obrigatórios: id, status",
        },
        { status: 400 },
      )
    }

    const updated = GTMEngine.updateLeadStatus(body.id, body.status as LeadStatus, body.notes)

    if (!updated) {
      return NextResponse.json(
        {
          success: false,
          error: "Lead não encontrado",
        },
        { status: 404 },
      )
    }

    return NextResponse.json({
      success: true,
      data: updated,
    })
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Erro ao atualizar status do lead",
      },
      { status: 500 },
    )
  }
}

export async function DELETE(req: NextRequest) {
  await assertRateLimit(req, RATE_LIMITS.admin)
  try {
    const { searchParams } = new URL(req.url)
    const id = searchParams.get("id")

    if (!id) {
      return NextResponse.json(
        {
          success: false,
          error: "Parâmetro id é obrigatório",
        },
        { status: 400 },
      )
    }

    const deleted = GTMEngine.deleteLead(id)

    return NextResponse.json({
      success: true,
      deleted,
    })
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Erro ao deletar lead",
      },
      { status: 500 },
    )
  }
}
