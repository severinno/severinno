/**
 * Admin Identity Verification Review API
 *
 * GET  — List pending identity verifications
 * POST — Approve or reject a verification
 */

import { NextResponse } from "next/server"
import { withRoute } from "@/lib/api-route"
import { db } from "@/lib/db"
import { getSession } from "@/lib/auth"
import logger from "@/lib/logger"

const log = logger.child({ module: "admin-identity" })

// ---------------------------------------------------------------------------
// GET — list pending verifications
// ---------------------------------------------------------------------------
export const GET = withRoute("api.admin.identity.GET", async (request) => {
  const session = await getSession()
  if (!session?.userId) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 })
  }

  // Check admin role
  const admin = await db.user.findUnique({
    where: { id: session.userId },
    select: { role: true },
  })
  if (admin?.role !== "ADMIN") {
    return NextResponse.json({ error: "Acesso negado" }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const status = searchParams.get("status") || "pending"

  const users = await db.user.findMany({
    where: { identityStatus: status },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      avatarUrl: true,
      identityDocUrl: true,
      identitySelfieUrl: true,
      identityStatus: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  })

  // Fetch OCR data & rejection reasons from Redis in a single batch roundtrip
  const { getClient } = await import("@/lib/redis")
  const redis = getClient()

  let ocrAndReasons: (string | null)[] = []
  if (redis && users.length > 0) {
    try {
      const keys: string[] = []
      for (const u of users) {
        keys.push(`identity:ocr:${u.id}`, `identity:reason:${u.id}`)
      }
      ocrAndReasons = await redis.mget(...keys)
    } catch {
      // ignore Redis failure, fallback gracefully
    }
  }

  const result = users.map((u, index) => {
    let ocrData = null
    let rejectionReason = null
    if (ocrAndReasons.length > index * 2) {
      const rawOcr = ocrAndReasons[index * 2]
      const rawReason = ocrAndReasons[index * 2 + 1]
      if (rawOcr) {
        try {
          ocrData = JSON.parse(rawOcr)
        } catch {
          // ignore parse error
        }
      }
      if (rawReason) rejectionReason = rawReason
    }
    return {
      ...u,
      identityOcrData: ocrData,
      identityRejectionReason: rejectionReason,
    }
  })

  return NextResponse.json({ verifications: result })
})

// ---------------------------------------------------------------------------
// POST — approve or reject
// ---------------------------------------------------------------------------
export const POST = withRoute("api.admin.identity.POST", async (request) => {
  const session = await getSession()
  if (!session?.userId) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 })
  }

  const admin = await db.user.findUnique({
    where: { id: session.userId },
    select: { role: true },
  })
  if (admin?.role !== "ADMIN") {
    return NextResponse.json({ error: "Acesso negado" }, { status: 403 })
  }

  try {
    const body = await request.json()
    const { userId, action, reason } = body as {
      userId: string
      action: "approve" | "reject"
      reason?: string
    }

    if (!userId || !action) {
      return NextResponse.json({ error: "userId e action são obrigatórios." }, { status: 400 })
    }

    const { getClient } = await import("@/lib/redis")
    const redis = getClient()

    if (action === "approve") {
      await db.user.update({
        where: { id: userId },
        data: {
          identityStatus: "approved",
          identityVerifiedAt: new Date(),
        },
      })
      if (redis) {
        await redis.del(`identity:reason:${userId}`)
      }
      log.info({ userId, adminId: session.userId }, "Identity approved by admin")
    } else {
      await db.user.update({
        where: { id: userId },
        data: {
          identityStatus: "rejected",
          identityVerifiedAt: null,
        },
      })
      if (redis) {
        await redis.set(
          `identity:reason:${userId}`,
          reason || "Documento não aprovado pela equipe.",
          "EX",
          30 * 24 * 3600,
        )
      }
      log.info({ userId, adminId: session.userId, reason }, "Identity rejected by admin")
    }

    // Send notification to user
    try {
      const { notifyIdentityResult } = await import("@/lib/notifications")
      await notifyIdentityResult(userId, action)
    } catch {
      // Best effort
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    log.error({ err }, "Failed to process identity review")
    return NextResponse.json({ error: "Erro ao processar revisão." }, { status: 500 })
  }
})
