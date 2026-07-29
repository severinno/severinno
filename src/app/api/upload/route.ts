import { NextResponse } from "next/server"
import { requireUser } from "@/lib/auth"
import { handleError } from "@/lib/api-server"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { uploadToS3 } from "@/lib/s3"
import logger from "@/lib/logger"

/**
 * POST /api/upload
 *
 * Upload a file to S3-compatible storage (R2 / MinIO / S3).
 * Requires authentication. Accepts multipart/form-data with field "file".
 *
 * Returns:
 *   { key: string, url: string, etag?: string }
 *
 * Headers:
 *   Content-Type: multipart/form-data
 *   Authorization: Bearer <session>
 *
 * Limits:
 *   Max file size: 10 MB (configurable via MAX_UPLOAD_SIZE env var)
 *   Allowed types: images (jpg, png, gif, webp, svg), PDF, DOC, DOCX
 */

const MAX_FILE_SIZE = parseInt(process.env.MAX_UPLOAD_SIZE || String(10 * 1024 * 1024), 10) // 10 MB

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
])

export async function POST(request: Request) {
  try {
    // 0. Rate limit (conservador — uploads são pesados)
    await assertRateLimit(request, { prefix: "upload", max: 10, windowMs: 60_000 })

    // 1. Auth
    await requireUser()

    // 2. Parse multipart form
    const formData = await request.formData()
    const file = formData.get("file")

    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { error: "Nenhum arquivo enviado. Envie um campo 'file' com o arquivo." },
        { status: 400 },
      )
    }

    // 3. Validate file size
    if (file.size > MAX_FILE_SIZE) {
      const maxMb = Math.round(MAX_FILE_SIZE / (1024 * 1024))
      return NextResponse.json(
        { error: `Arquivo muito grande. O tamanho máximo é ${maxMb} MB.` },
        { status: 413 },
      )
    }

    // 4. Validate content type
    const contentType = file.type || "application/octet-stream"
    if (!ALLOWED_MIME_TYPES.has(contentType) && contentType !== "application/octet-stream") {
      return NextResponse.json(
        {
          error:
            "Tipo de arquivo não permitido. Envie imagens (JPG, PNG, GIF, WebP, SVG), PDF ou DOC.",
        },
        { status: 415 },
      )
    }

    // 5. Upload to S3/R2
    const buffer = Buffer.from(await file.arrayBuffer())
    const result = await uploadToS3(buffer, file.name, {
      contentType,
      prefix: "uploads/",
    })

    logger.info({ key: result.key, size: file.size, type: contentType }, "upload successful")

    return NextResponse.json(result, { status: 201 })
  } catch (e) {
    return handleError(e)
  }
}

/**
 * GET /api/upload
 * Returns allowed file types and limits (informational).
 */
export async function GET() {
  return NextResponse.json({
    maxFileSize: MAX_FILE_SIZE,
    maxFileSizeMb: Math.round(MAX_FILE_SIZE / (1024 * 1024)),
    allowedTypes: Array.from(ALLOWED_MIME_TYPES),
    storage: "S3-compatible (R2 / MinIO)",
  })
}
