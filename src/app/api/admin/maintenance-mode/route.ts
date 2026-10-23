export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { z } from "zod"

import { db } from "@/lib/db"
import { requireRole } from "@/lib/auth"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { withRoute } from "@/lib/api-route"
import {
  MAINTENANCE_MODE_KEY,
  MAINTENANCE_ALLOWED_IPS_KEY,
  isMaintenanceMode,
  getAllowedMaintenanceIps,
  resetMaintenanceModeCache,
} from "@/lib/maintenance-mode"
import { getClientIp } from "@/lib/rate-limit-shared"

/** O corpo do toggle/atualização: `{ enabled: boolean, allowedIps?: string[] }` */
const maintenanceUpdateSchema = z.object({
  enabled: z.boolean(),
  allowedIps: z.array(z.string().trim()).optional(),
})

/**
 * POST /api/admin/maintenance-mode — a CHAVE de ligar/desligar o marketplace e gerenciar IPs permitidos.
 *
 * Um clique no painel admin. Com a chave LIGADA, o site INTEIRO (páginas via
 * layout raiz, APIs via withRoute) fica INACESSÍVEL ao público — tela de
 * manutenção / 503 — e apenas sessões ADMIN ou IPs autorizados atravessam.
 *
 * Persistência: tabela `Setting` (keys `maintenance_mode` e `maintenance_allowed_ips`)
 * — sobrevive a deploy e restart, sem migração nova. O cache da lib é
 * INVALIDADO aqui para propagação imediata.
 */
export const POST = withRoute("api.admin.maintenance-mode.POST", async (request) => {
  await assertRateLimit(request, RATE_LIMITS.admin)
  const session = await requireRole("ADMIN")

  const raw = (await request.json()) as unknown
  const { enabled, allowedIps } = maintenanceUpdateSchema.parse(raw)

  const value = enabled ? "true" : "false"
  await db.setting.upsert({
    where: { key: MAINTENANCE_MODE_KEY },
    update: { value, updatedBy: session.userId },
    create: { key: MAINTENANCE_MODE_KEY, value, updatedBy: session.userId },
  })

  if (allowedIps !== undefined) {
    const cleanIps = Array.from(new Set(allowedIps.map((s) => s.trim()).filter(Boolean)))
    await db.setting.upsert({
      where: { key: MAINTENANCE_ALLOWED_IPS_KEY },
      update: { value: JSON.stringify(cleanIps), updatedBy: session.userId },
      create: {
        key: MAINTENANCE_ALLOWED_IPS_KEY,
        value: JSON.stringify(cleanIps),
        updatedBy: session.userId,
      },
    })
  }

  await resetMaintenanceModeCache()

  const maintenanceMode = await isMaintenanceMode()
  const currentAllowedIps = await getAllowedMaintenanceIps()
  const currentIp = getClientIp(request)

  return NextResponse.json({
    maintenanceMode,
    allowedIps: currentAllowedIps,
    currentIp,
    message: maintenanceMode
      ? "Site em manutenção — INACESSÍVEL ao público (admins e IPs autorizados entram normalmente)."
      : "Site ACESSÍVEL — manutenção desligada.",
  })
})

/**
 * GET — o estado atual (o painel lê antes de renderizar o switch e a lista de IPs permitidos).
 */
export const GET = withRoute("api.admin.maintenance-mode.GET", async (request) => {
  const maintenanceMode = await isMaintenanceMode()
  const allowedIps = await getAllowedMaintenanceIps()
  const currentIp = getClientIp(request)

  return NextResponse.json({
    maintenanceMode,
    allowedIps,
    currentIp,
  })
})
