import "server-only"
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3"
import logger from "./logger"

const ENDPOINT = process.env.S3_ENDPOINT ?? ""
const REGION = process.env.S3_REGION ?? "auto"
const ACCESS_KEY = process.env.S3_ACCESS_KEY ?? ""
const SECRET_KEY = process.env.S3_SECRET_KEY ?? ""
const BUCKET = process.env.S3_BUCKET ?? "severinno"
const PUBLIC_URL = process.env.S3_PUBLIC_URL ?? ""

function getClient(): S3Client | null {
  if (!ENDPOINT || !ACCESS_KEY || !SECRET_KEY) return null
  return new S3Client({
    endpoint: ENDPOINT,
    region: REGION,
    credentials: { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY },
    forcePathStyle: true,
  })
}

export async function uploadFile(
  buffer: Buffer,
  key: string,
  contentType: string,
): Promise<string | null> {
  const client = getClient()
  if (!client) {
    logger.warn("S3 not configured, falling back to local")
    return null
  }

  try {
    await client.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: buffer,
        ContentType: contentType,
      }),
    )
    const url = PUBLIC_URL ? `${PUBLIC_URL}/${key}` : `${ENDPOINT}/${BUCKET}/${key}`
    return url
  } catch (err) {
    logger.error({ err }, "s3 upload failed")
    return null
  }
}
