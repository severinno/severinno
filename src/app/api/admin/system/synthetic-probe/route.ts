export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { requireRole } from "@/lib/auth"
import { withRoute } from "@/lib/api-route"
import { runSyntheticProbe } from "@/lib/synthetic-prober"

/**
 * GET /api/admin/system/synthetic-probe
 *
 * Executa uma transação sintética completa em tempo real para aferição de SLA:
 * - Leitura e cálculo no PostgreSQL + PostGIS
 * - Ciclo de escrita/leitura/deleção no Redis
 * - Simulação do desafio criptográfico OTP de custódia
 * - Aferição do motor geodésico
 *
 * Requer permissão ADMIN.
 */
export const GET = withRoute("api.admin.system.synthetic-probe.GET", async (_req) => {
  await requireRole("ADMIN")

  const report = await runSyntheticProbe()

  return NextResponse.json(report, {
    status: report.status === "FAIL" ? 503 : 200,
  })
})
