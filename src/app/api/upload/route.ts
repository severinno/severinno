export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { requireUser } from "@/lib/auth"
import { handleError } from "@/lib/api-server"
import { assertRateLimit } from "@/lib/rate-limit"
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

// Extension → MIME mapping to prevent MIME spoofing (e.g. .exe uploaded as image/jpeg)
const EXTENSION_MIME_MAP: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}

const ALLOWED_EXTENSIONS = new Set(Object.keys(EXTENSION_MIME_MAP))

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

    // 4b. Validate file extension matches MIME type (prevent MIME spoofing)
    const fileName = file.name || "unknown"
    const ext = fileName.includes(".") ? "." + fileName.split(".").pop()?.toLowerCase() : ""
    if (ext && ALLOWED_EXTENSIONS.has(ext)) {
      const expectedMime = EXTENSION_MIME_MAP[ext]
      if (expectedMime && contentType !== expectedMime && contentType !== "application/octet-stream") {
        return NextResponse.json(
          {
            error: `Extensão ${ext} incompatível com o tipo de conteúdo. Envie o arquivo com o tipo correto.`,
          },
          { status: 415 },
        )
      }
    } else if (ext && !ALLOWED_EXTENSIONS.has(ext)) {
      return NextResponse.json(
        {
          error: `Extensão ${ext} não permitida. Envie imagens (JPG, PNG, GIF, WebP, SVG), PDF ou DOC.`,
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
