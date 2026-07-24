/**
 * S3-compatible storage utility.
 *
 * Works with:
 *   - Cloudflare R2 (production — free egress, low latency in Brazil)
 *   - MinIO (development — docker-compose)
 *   - AWS S3 (fallback)
 *
 * Environment:
 *   S3_ENDPOINT   — e.g. https://<account>.r2.cloudflarestorage.com
 *   S3_ACCESS_KEY — R2 token / AWS access key
 *   S3_SECRET_KEY — R2 secret / AWS secret key
 *   S3_BUCKET     — bucket name (default: severinno-uploads)
 *   S3_REGION     — region (default: auto for R2, us-east-1 for AWS)
 *
 * Public URLs can be served via Cloudflare's public bucket feature
 * or a custom domain. The upload route returns the object key; the
 * frontend constructs the URL using NEXT_PUBLIC_UPLOADS_BASE_URL.
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  type PutObjectCommandInput,
  type ObjectCannedACL,
} from "@aws-sdk/client-s3"
import logger from "./logger"

// @aws-sdk/s3-request-presigner is optional — install it if you need signed URLs.
// If not installed, getSignedUrlForObject will throw a clear error.
let getSignedUrlFn: ((client: S3Client, command: GetObjectCommand, options?: { expiresIn?: number }) => Promise<string>) | null = null
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const presigner = require("@aws-sdk/s3-request-presigner")
  if (presigner?.getSignedUrl) getSignedUrlFn = presigner.getSignedUrl
} catch {
  // Presigner not installed — signed URLs will fail with a helpful message
}

// ---------------------------------------------------------------------------
// Client singleton
// ---------------------------------------------------------------------------

let client: S3Client | null = null

function getS3Client(): S3Client {
  if (!client) {
    const endpoint = process.env.S3_ENDPOINT
    const region = process.env.S3_REGION || "auto"
    const accessKeyId = process.env.S3_ACCESS_KEY
    const secretAccessKey = process.env.S3_SECRET_KEY

    if (!accessKeyId || !secretAccessKey) {
      throw new Error("S3_ACCESS_KEY and S3_SECRET_KEY must be set")
    }

    client = new S3Client({
      endpoint,
      region,
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle: !endpoint?.includes("r2.cloudflarestorage.com"), // R2 uses virtual-hosted style
      requestHandler: {
        // 30-second timeout for uploads
        requestTimeout: 30_000,
      },
    })
  }
  return client
}

function getBucket(): string {
  return process.env.S3_BUCKET || "severinno-uploads"
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type UploadResult = {
  key: string
  url: string
  etag?: string
}

export type UploadOptions = {
  /** Content-Type of the uploaded file */
  contentType?: string
  /** ACL (default: public-read) */
  acl?: ObjectCannedACL
  /** Custom path prefix (e.g. "avatars/", "services/") */
  prefix?: string
}

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

/**
 * Upload a Buffer to S3/R2.
 * Returns the object key and a public URL.
 */
export async function uploadToS3(
  buffer: Buffer,
  fileName: string,
  options: UploadOptions = {},
): Promise<UploadResult> {
  const { contentType, acl = "public-read", prefix = "uploads/" } = options

  // Sanitize filename and prefix
  const sanitizedName = fileName
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .toLowerCase()
  const key = `${prefix}${Date.now()}-${sanitizedName}`

  const params: PutObjectCommandInput = {
    Bucket: getBucket(),
    Key: key,
    Body: buffer,
    ContentType: contentType || guessContentType(fileName),
    ACL: acl,
  }

  try {
    const cmd = new PutObjectCommand(params)
    const result = await getS3Client().send(cmd)

    // Construct URL — for R2 with public access, use the direct URL
    const baseUrl = process.env.NEXT_PUBLIC_UPLOADS_BASE_URL || getDefaultBaseUrl()
    const url = `${baseUrl}/${key}`

    logger.info({ key, size: buffer.length }, "s3 upload successful")

    return { key, url, etag: result.ETag }
  } catch (err) {
    logger.error({ err, key }, "s3 upload failed")
    throw new Error("Falha ao fazer upload do arquivo")
  }
}

/**
 * Upload from a base64 data URL.
 */
export async function uploadBase64(
  dataUrl: string,
  options: UploadOptions = {},
): Promise<UploadResult> {
  const matches = dataUrl.match(/^data:([^;]+);base64,(.+)$/)
  if (!matches) throw new Error("Invalid data URL")

  const contentType = options.contentType || matches[1]
  const ext = contentType.split("/")[1] || "bin"
  const buffer = Buffer.from(matches[2], "base64")

  return uploadToS3(buffer, `image.${ext}`, { ...options, contentType })
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

export async function deleteFromS3(key: string): Promise<void> {
  try {
    const cmd = new DeleteObjectCommand({ Bucket: getBucket(), Key: key })
    await getS3Client().send(cmd)
    logger.info({ key }, "s3 delete successful")
  } catch (err) {
    logger.error({ err, key }, "s3 delete failed")
  }
}

// ---------------------------------------------------------------------------
// Signed URL (for private files)
// ---------------------------------------------------------------------------

export async function getSignedUrlForObject(
  key: string,
  expiresInSeconds = 3600,
): Promise<string> {
  const cmd = new GetObjectCommand({ Bucket: getBucket(), Key: key })
  if (!getSignedUrlFn) {
    throw new Error(
      "Signed URLs require @aws-sdk/s3-request-presigner to be installed. " +
      "Run: bun add @aws-sdk/s3-request-presigner",
    )
  }
  return getSignedUrlFn(getS3Client(), cmd, { expiresIn: expiresInSeconds })
}

// ---------------------------------------------------------------------------
// List (for admin panels)
// ---------------------------------------------------------------------------

export async function listObjects(prefix?: string) {
  const cmd = new ListObjectsV2Command({
    Bucket: getBucket(),
    Prefix: prefix,
    MaxKeys: 100,
  })
  const result = await getS3Client().send(cmd)
  return (result.Contents || []).map((obj) => ({
    key: obj.Key!,
    size: obj.Size!,
    lastModified: obj.LastModified!,
    etag: obj.ETag,
  }))
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function guessContentType(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase()
  const types: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
    pdf: "application/pdf",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  }
  return types[ext || ""] || "application/octet-stream"
}

function getDefaultBaseUrl(): string {
  // For MinIO / local dev
  const endpoint = process.env.S3_ENDPOINT
  if (endpoint) {
    return `${endpoint}/${getBucket()}`
  }
  // For R2 with public access
  return `https://${getBucket()}.r2.cloudflarestorage.com`
}
