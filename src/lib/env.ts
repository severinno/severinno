import "server-only"
import { z } from "zod"

const envSchema = z.object({
  // App
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  NEXT_PUBLIC_APP_URL: z.string().url().default("https://severinno.com.br"),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error"]).default("info"),

  // Database
  DATABASE_URL: z.string().url(),

  // Cache
  REDIS_URL: z.string().min(1),

  // Queue (opcional em dev — necessário apenas para workers de email/notificação)
  RABBITMQ_URL: z.string().min(1).optional(),

  // Storage (S3-compatible: Cloudflare R2 / MinIO / AWS S3)
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_PUBLIC_URL: z.string().optional(),
  NEXT_PUBLIC_UPLOADS_BASE_URL: z.string().optional(),
  MAX_UPLOAD_SIZE: z.coerce.number().default(10 * 1024 * 1024), // 10 MB

  // Realtime
  REALTIME_URL: z.string().url().default("http://localhost:3003"),

  // OpenSearch (full-text search)
  OPENSEARCH_URL: z.string().default("http://localhost:9200"),
  OPENSEARCH_USERNAME: z.string().optional(),
  OPENSEARCH_PASSWORD: z.string().optional(),

  // OSRM (routing)
  OSRM_BASE_URL: z.string().optional(),

  // Notifications - Web Push (VAPID)
  // Default to empty string — push.ts already degrades gracefully when keys are missing.
  // In production, set these via .env (see .env.production.example).
  VAPID_PUBLIC_KEY: z.string().default(""),
  VAPID_PRIVATE_KEY: z.string().default(""),
  VAPID_SUBJECT: z.string().default("mailto:admin@severinno.com.br"),
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: z.string().default(""),

  // SMTP
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),

  // Lytex (payments)
  LYTEX_ENV: z.enum(["sandbox", "production"]).default("production"),
  LYTEX_BASE_URL: z.string().optional(),
  LYTEX_API_URL: z.string().default("https://api.lytex.com.br/v1"),
  LYTEX_SANDBOX_URL: z.string().default("https://sandbox-api.lytex.com.br/v1"),
  LYTEX_CLIENT_ID: z.string().optional(),
  LYTEX_CLIENT_SECRET: z.string().optional(),
  PAYMENT_WEBHOOK_SECRET: z.string().optional(),

  // Cron
  CRON_SECRET: z.string().optional(),

  // Error Monitoring (GlitchTip / Sentry)
  NEXT_PUBLIC_GLITCHTIP_DSN: z.string().optional(),
  GLITCHTIP_DSN: z.string().optional(),
  GLITCHTIP_INTERNAL_URL: z.string().default("http://glitchtip-web:8000"),
  GLITCHTIP_SECRET: z.string().optional(),
  // Legacy Sentry vars (fallback)
  SENTRY_DSN: z.string().optional(),
  SENTRY_RELEASE: z.string().optional(),

  // WhatsApp (Evolution API)
  WHATSAPP_API_URL: z.string().optional(),
  WHATSAPP_API_KEY: z.string().optional(),
  WHATSAPP_INSTANCE: z.string().default("severinno"),
  EVOLUTION_API_URL: z.string().optional(),
  EVOLUTION_API_KEY: z.string().optional(),
  EVOLUTION_INSTANCE: z.string().default("severinno"),

  // Search index consumer (queue workers)
  POLL_INTERVAL_MS: z.coerce.number().default(5000),
  BATCH_SIZE: z.coerce.number().default(50),

  // Docker
  DB_PASSWORD: z.string().optional(),
})

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  console.error("❌ Invalid environment variables:")
  const flat = parsed.error.flatten()
  for (const [key, errors] of Object.entries(flat.fieldErrors)) {
    for (const err of errors) {
      console.error(`   ${key}: ${err}`)
    }
  }
  if (flat.formErrors.length > 0) {
    for (const err of flat.formErrors) {
      console.error(`   ${err}`)
    }
  }
  if (process.env.NODE_ENV !== "test") {
    throw new Error("Invalid environment variables — aborting")
  }
}

export const env = parsed.data
