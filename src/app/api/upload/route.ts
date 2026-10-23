export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { requireUser } from "@/lib/auth"

import { assertRateLimit } from "@/lib/rate-limit"
import { uploadToS3 } from "@/lib/s3"
import { validateFileSignature } from "@/lib/file-signature"
import logger from "@/lib/logger"

import { withRoute } from "@/lib/api-route"

/**
 * POST /api/upload
 *
 * Upload a file to S3-compatible storage (R2 / MinIO / S3).
 * Requires authentication. Accepts multipart/form-data with field "file".
 *
 * Returns:
 *   { key: string, url: string, etag?: string }
 *
 * Limits:
 *   Max file size: 10 MB (configurable via MAX_UPLOAD_SIZE env var)
 *   Allowed types: images (jpg, png, gif, webp), PDF, DOC, DOCX
 *   ⚠️ SVG REMOVIDO (09/2026): XML ativo → XSS armazenado em bucket público.
 *
 * Validação em 3 camadas:
 *   1. MIME declarado na allowlist (string controlada pelo cliente)
 *   2. Extensão compatível com o MIME (anti MIME-spoofing básico)
 *   3. Magic bytes do CONTEÚDO real (file-signature.ts) — a defesa de
 *      verdade: os primeiros bytes do arquivo precisam bater com o MIME
 *      declarado. Bloqueia SVG disfarçado, polyglots e payloads arbitrários.
 */

const MAX_FILE_SIZE = parseInt(process.env.MAX_UPLOAD_SIZE || String(10 * 1024 * 1024), 10) // 10 MB

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
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
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}

const ALLOWED_EXTENSIONS = new Set(Object.keys(EXTENSION_MIME_MAP))

export const POST = withRoute(
  "api.upload.POST",
  async (request) => {
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
    if (!ALLOWED_MIME_TYPES.has(contentType)) {
      return NextResponse.json(
        {
          error:
            "Tipo de arquivo não permitido. Envie imagens (JPG, PNG, GIF, WebP), PDF ou DOC.",
        },
        { status: 415 },
      )
    }

    // 4b. Validate file extension matches MIME type (prevent MIME spoofing)
    const fileName = file.name || "unknown"
    const ext = fileName.includes(".") ? "." + fileName.split(".").pop()?.toLowerCase() : ""
    if (ext && ALLOWED_EXTENSIONS.has(ext)) {
      const expectedMime = EXTENSION_MIME_MAP[ext]
      if (expectedMime && contentType !== expectedMime) {
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
          error: `Extensão ${ext} não permitida. Envie imagens (JPG, PNG, GIF, WebP), PDF ou DOC.`,
        },
        { status: 415 },
      )
    }

    // 5. Magic bytes: o CONTEÚDO real precisa bater com o MIME declarado.
    //    Bloqueia SVG (mesmo renomeado para .jpg), polyglots e payloads.
    const buffer = Buffer.from(await file.arrayBuffer())
    const signature = validateFileSignature(buffer, contentType)
    if (!signature.ok) {
      logger.warn(
        { fileName, contentType, size: file.size, reason: signature.reason },
        "upload rejected: file signature mismatch",
      )
      return NextResponse.json({ error: signature.reason }, { status: 415 })
    }

    // 6. Upload to S3/R2
    const result = await uploadToS3(buffer, file.name, {
      contentType,
      prefix: "uploads/",
    })

    logger.info(
      { key: result.key, size: file.size, type: contentType, detected: signature.detected },
      "upload successful",
    )

    return NextResponse.json(result, { status: 201 })
  },
)

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
