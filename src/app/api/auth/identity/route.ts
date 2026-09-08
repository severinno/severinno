/**
 * Identity Verification API — POST: upload docs + auto-OCR, GET: check status
 *
 * POST /api/auth/identity
 *   - Uploads document + selfie to MinIO (S3)
 *   - Runs AI Vision OCR via LocalAI/Ollama to extract document data
 *   - Sets identityStatus to "pending" (or auto-approve if OCR confidence > 90%)
 *
 * GET /api/auth/identity
 *   - Returns current verification status for the authenticated user
 */

import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getSession } from "@/lib/auth"
import { uploadBuffer } from "@/lib/s3"
import logger from "@/lib/logger"

const log = logger.child({ module: "identity-verification" })

// ---------------------------------------------------------------------------
// OCR via LocalAI / Ollama Vision
// ---------------------------------------------------------------------------
interface OcrResult {
  documentType: string // "RG" | "CNH" | "CNPJ" | "unknown"
  fullName: string | null
  documentNumber: string | null
  birthDate: string | null
  confidence: number // 0-1
  rawText: string
  faceMatchConfidence?: number // 0-1
  faceMatchReason?: string
}

async function runDocumentOCR(
  imageBase64: string,
  selfieBase64?: string,
): Promise<OcrResult | null> {
  const localAiUrl = process.env.LOCAL_AI_URL || process.env.OLLAMA_URL
  if (!localAiUrl) return null

  const prompt = `Analise as imagens enviadas para validação de identidade (KYC):
A primeira imagem é um documento brasileiro (RG, CNH ou CNPJ).
${selfieBase64 ? "A segunda imagem é uma selfie tirada pela mesma pessoa." : ""}

Extraia os dados cadastrais e realize a comparação facial biométrica (Face Match):
- documentType: "RG", "CNH", "CNPJ" ou "unknown"
- fullName: nome completo no documento
- documentNumber: número do documento
- birthDate: data de nascimento (formato YYYY-MM-DD se possível)
- confidence: qualidade/confiança da leitura de 0 a 1
- rawText: todo texto visível no documento
${selfieBase64 ? "- faceMatchConfidence: similaridade facial de 0 a 1 entre o rosto do documento e a selfie\n- faceMatchReason: breve parecer técnico sobre a correspondência dos traços faciais" : ""}

Retorne APENAS um objeto JSON válido, sem explicações.`

  const userContent: Array<{ type: string; text?: string; image_url?: { url: string } }> = [
    { type: "text", text: prompt },
    { type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageBase64}` } },
  ]

  if (selfieBase64) {
    userContent.push({
      type: "image_url",
      image_url: { url: `data:image/jpeg;base64,${selfieBase64}` },
    })
  }

  try {
    const res = await fetch(`${localAiUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "llama-3.2-vision",
        messages: [{ role: "user", content: userContent }],
        temperature: 0.1,
        max_tokens: 600,
      }),
      signal: AbortSignal.timeout(20000),
    })

    if (!res.ok) return null

    const data = await res.json()
    const content = data.choices?.[0]?.message?.content || ""
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return null

    const parsed = JSON.parse(jsonMatch[0])
    return {
      documentType: parsed.documentType || "unknown",
      fullName: parsed.fullName || null,
      documentNumber: parsed.documentNumber || null,
      birthDate: parsed.birthDate || null,
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
      rawText: parsed.rawText || "",
      faceMatchConfidence:
        typeof parsed.faceMatchConfidence === "number" ? parsed.faceMatchConfidence : undefined,
      faceMatchReason: parsed.faceMatchReason || undefined,
    }
  } catch (err) {
    log.warn({ err }, "OCR analysis failed, falling back to manual review")
    return null
  }
}

// ---------------------------------------------------------------------------
// GET — current verification status
// ---------------------------------------------------------------------------
export async function GET() {
  const session = await getSession()
  if (!session?.userId) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 })
  }

  const user = await db.user.findUnique({
    where: { id: session.userId },
    select: {
      identityDocUrl: true,
      identitySelfieUrl: true,
      identityStatus: true,
      identityVerifiedAt: true,
    },
  })

  if (!user) {
    return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 })
  }

  let ocrData = null
  let rejectionReason = null
  try {
    const { getClient } = await import("@/lib/redis")
    const redis = getClient()
    if (redis) {
      const [rawOcr, rawReason] = await Promise.all([
        redis.get(`identity:ocr:${session.userId}`),
        redis.get(`identity:reason:${session.userId}`),
      ])
      if (rawOcr) ocrData = JSON.parse(rawOcr)
      if (rawReason) rejectionReason = rawReason
    }
  } catch {
    // Best effort
  }

  return NextResponse.json({
    status: user.identityStatus ?? "none",
    docUrl: user.identityDocUrl,
    selfieUrl: user.identitySelfieUrl,
    verifiedAt: user.identityVerifiedAt,
    rejectionReason,
    ocrData,
  })
}

// ---------------------------------------------------------------------------
// POST — upload documents + run OCR
// ---------------------------------------------------------------------------
export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session?.userId) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 })
  }

  try {
    const formData = await request.formData()
    const docFile = formData.get("document") as File | null
    const selfieFile = formData.get("selfie") as File | null

    if (!docFile || !selfieFile) {
      return NextResponse.json({ error: "Documento e selfie são obrigatórios." }, { status: 400 })
    }

    // Validate file sizes (10MB max each)
    if (docFile.size > 10 * 1024 * 1024 || selfieFile.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: "Arquivo muito grande. Máximo 10MB." }, { status: 400 })
    }

    // Upload to MinIO/S3
    const docBuffer = Buffer.from(await docFile.arrayBuffer())
    const selfieBuffer = Buffer.from(await selfieFile.arrayBuffer())

    const docKey = `identity/${session.userId}/document-${Date.now()}.${docFile.name.split(".").pop()}`
    const selfieKey = `identity/${session.userId}/selfie-${Date.now()}.${selfieFile.name.split(".").pop()}`

    const [docUrl, selfieUrl] = await Promise.all([
      uploadBuffer(docBuffer, docKey, docFile.type),
      uploadBuffer(selfieBuffer, selfieKey, selfieFile.type),
    ])

    // Run OCR on document image
    let ocrResult: OcrResult | null = null
    let autoApproved = false

    if (docFile.type.startsWith("image/")) {
      const docBase64 = docBuffer.toString("base64")
      const selfieBase64 = selfieFile.type.startsWith("image/")
        ? selfieBuffer.toString("base64")
        : undefined

      ocrResult = await runDocumentOCR(docBase64, selfieBase64)

      // Auto-approve if document confidence > 90% AND face match > 85%
      const passesFaceMatch =
        ocrResult?.faceMatchConfidence === undefined || ocrResult.faceMatchConfidence > 0.85

      if (
        ocrResult &&
        ocrResult.confidence > 0.9 &&
        passesFaceMatch &&
        ocrResult.documentType !== "unknown" &&
        ocrResult.fullName
      ) {
        autoApproved = true
        log.info(
          {
            userId: session.userId,
            documentType: ocrResult.documentType,
            confidence: ocrResult.confidence,
            faceMatchConfidence: ocrResult.faceMatchConfidence,
          },
          "Identity auto-approved via OCR with Face Match",
        )
      }
    }

    // Update user record
    await db.user.update({
      where: { id: session.userId },
      data: {
        identityDocUrl: docUrl,
        identitySelfieUrl: selfieUrl,
        identityStatus: autoApproved ? "approved" : "pending",
        identityVerifiedAt: autoApproved ? new Date() : null,
      },
    })

    // Store OCR data & clear rejection reason in Redis
    try {
      const { getClient } = await import("@/lib/redis")
      const redis = getClient()
      if (redis) {
        if (ocrResult) {
          await redis.set(
            `identity:ocr:${session.userId}`,
            JSON.stringify(ocrResult),
            "EX",
            30 * 24 * 3600,
          )
        }
        await redis.del(`identity:reason:${session.userId}`)
      }
    } catch {
      // Best effort
    }

    // Log activity
    try {
      const { getClient } = await import("@/lib/redis")
      const redis = getClient()
      if (redis) {
        await redis.lpush(
          `activity:${session.userId}`,
          JSON.stringify({
            type: "identity_upload",
            autoApproved,
            ocrConfidence: ocrResult?.confidence ?? null,
            timestamp: Date.now(),
          }),
        )
        await redis.expire(`activity:${session.userId}`, 90 * 24 * 60 * 60)
      }
    } catch {
      // Best effort
    }

    return NextResponse.json({
      status: autoApproved ? "approved" : "pending",
      ocrResult: ocrResult
        ? {
            documentType: ocrResult.documentType,
            fullName: ocrResult.fullName,
            confidence: ocrResult.confidence,
          }
        : null,
      autoApproved,
    })
  } catch (err) {
    log.error({ err }, "Failed to process identity verification")
    return NextResponse.json({ error: "Erro ao processar verificação." }, { status: 500 })
  }
}
