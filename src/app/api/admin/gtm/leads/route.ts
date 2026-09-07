export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { requireRole } from "@/lib/auth"
import { GTMEngine, LeadStatus } from "@/lib/gtm-engine"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { gtmLeadCreateSchema, gtmLeadUpdateSchema } from "@/lib/validators"

export async function GET(req: NextRequest) {
  await requireRole("ADMIN")
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
  await requireRole("ADMIN")
  await assertRateLimit(req, RATE_LIMITS.admin)
  try {
    const body = await req.json()

    // Handle batch import or single creation
    if (Array.isArray(body)) {
      const schema = gtmLeadCreateSchema
      const created = body.map((item) => {
        const parsed = schema.parse(item)
        return GTMEngine.createLead(parsed)
      })
      return NextResponse.json(
        {
          success: true,
          count: created.length,
          data: created,
        },
        { status: 201 },
      )
    }

    const parsed = gtmLeadCreateSchema.parse(body)
    const lead = GTMEngine.createLead(parsed)

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
  await requireRole("ADMIN")
  await assertRateLimit(req, RATE_LIMITS.admin)
  try {
    const body = await req.json()
    const parsed = gtmLeadUpdateSchema.parse(body)

    const updated = GTMEngine.updateLeadStatus(parsed.id, parsed.status, parsed.notes)

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
  await requireRole("ADMIN")
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
