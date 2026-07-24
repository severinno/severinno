import { NextResponse } from "next/server"
import { requireRole } from "@/lib/auth"
import { getBusinessMetrics } from "@/lib/metrics"
import { handleError } from "@/lib/api-server"

export async function GET() {
  try {
    await requireRole("ADMIN")
    const metrics = await getBusinessMetrics(30)
    return NextResponse.json(metrics)
  } catch (e) {
    return handleError(e)
  }
}
