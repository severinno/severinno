export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { requireRole } from "@/lib/auth"

import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import logger from "@/lib/logger"

import { withRoute } from "@/lib/api-route"

const LY_BASE = process.env.LYTEX_BASE_URL ?? "https://api-pay.lytex.com.br"

let cachedToken: { token: string; expiresAt: number } | null = null

async function getToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.token

  const res = await fetch(`${LY_BASE}/v2/auth/obtain_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientId: process.env.LYTEX_CLIENT_ID ?? "",
      clientSecret: process.env.LYTEX_CLIENT_SECRET ?? "",
    }),
  })

  if (!res.ok) throw new Error(`Lytex auth error: ${res.status}`)
  const data = await res.json()
  cachedToken = { token: data.accessToken, expiresAt: Date.now() + 3500 * 1000 }
  return data.accessToken
}

export const GET = withRoute("api.admin.gateway.invoices.GET", async (request) => {
  await requireRole("ADMIN")
  await assertRateLimit(request, RATE_LIMITS.admin)
  const url = new URL(request.url)
  const page = url.searchParams.get("page") ?? "1"
  const perPage = url.searchParams.get("perPage") ?? "20"
  const search = url.searchParams.get("search") ?? ""

  const token = await getToken()
  const params = new URLSearchParams({ page, perPage })
  if (search) params.set("search", search)

  const res = await fetch(`${LY_BASE}/v2/invoices?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  if (!res.ok) {
    const text = await res.text()
    logger.error({ status: res.status, body: text }, "lytex admin list failed")
    return NextResponse.json(
      { ok: false, error: `Lytex API error: ${res.status}` },
      { status: res.status },
    )
  }

  const data = await res.json()
  return NextResponse.json({ ok: true, ...data })
})
