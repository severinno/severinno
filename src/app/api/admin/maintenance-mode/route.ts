export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { z } from "zod"

import { db } from "@/lib/db"
import { requireRole } from "@/lib/auth"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { withRoute } from "@/lib/api-route"
import {
  MAINTENANCE_MODE_KEY,
  isMaintenanceMode,
  resetMaintenanceModeCache,
} from "@/lib/maintenance-mode"

/** O corpo do toggle: `{ enabled: boolean }` — Zod recusa qualquer outra forma. */
const maintenanceToggleSchema = z.object({ enabled: z.boolean() })

/**
 * POST /api/admin/maintenance-mode — a CHAVE de ligar/desligar o marketplace.
 *
 * Um clique no painel admin. Com a chave LIGADA, o site INTEIRO (páginas via
 * layout raiz, APIs via withRoute) fica INACESSÍVEL ao público — tela de
 * manutenção / 503 — e apenas sessões ADMIN atravessam, para poder DESLIGAR.
 *
 * Persistência: tabela `Setting` (key `maintenance_mode`, value "true"/"false")
 * — sobrevive a deploy e restart, sem migração nova. O cache de 15s da lib é
 * INVALIDADO aqui para propagação imediata (o próximo request re-lê o DB).
 */
export const POST = withRoute("api.admin.maintenance-mode.POST", async (request) => {
  await assertRateLimit(request, RATE_LIMITS.admin)
  const session = await requireRole("ADMIN")

  const raw = (await request.json()) as unknown
  const { enabled } = maintenanceToggleSchema.parse(raw)

  const value = enabled ? "true" : "false"
  await db.setting.upsert({
    where: { key: MAINTENANCE_MODE_KEY },
    update: { value, updatedBy: session.userId },
    create: { key: MAINTENANCE_MODE_KEY, value, updatedBy: session.userId },
  })
  await resetMaintenanceModeCache()

  const maintenanceMode = await isMaintenanceMode()
  return NextResponse.json({
    maintenanceMode,
    message: maintenanceMode
      ? "Site em manutenção — INACESSÍVEL ao público (admins entram normalmente)."
      : "Site ACESSÍVEL — manutenção desligada.",
  })
})

/**
 * GET — o estado atual (o painel lê antes de renderizar o switch).
 */
export const GET = withRoute("api.admin.maintenance-mode.GET", async () => {
  const maintenanceMode = await isMaintenanceMode()
  return NextResponse.json({ maintenanceMode })
})
