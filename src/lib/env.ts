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

  // Queue
  RABBITMQ_URL: z.string().min(1),

  // Storage
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  S3_BUCKET: z.string().optional(),

  // Realtime
  REALTIME_URL: z.string().url().default("http://localhost:3003"),

  // OSRM
  OSRM_BASE_URL: z.string().optional(),

  // Notifications
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().optional(),
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: z.string().optional(),

  // SMTP
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),

  // Lytex (payments)
  LYTEX_ENV: z.enum(["sandbox", "production"]).default("production"),
  LYTEX_BASE_URL: z.string().optional(),
  LYTEX_CLIENT_ID: z.string().optional(),
  LYTEX_CLIENT_SECRET: z.string().optional(),
  PAYMENT_WEBHOOK_SECRET: z.string().optional(),

  // Cron
  CRON_SECRET: z.string().optional(),

  // Error Monitoring (GlitchTip / Sentry)
  NEXT_PUBLIC_GLITCHTIP_DSN: z.string().optional(),
  GLITCHTIP_DSN: z.string().optional(),
  GLITCHTIP_INTERNAL_URL: z.string().default("http://glitchtip:8000"),
  GLITCHTIP_SECRET: z.string().optional(),
  // Legacy Sentry vars (fallback)
  SENTRY_DSN: z.string().optional(),
  SENTRY_RELEASE: z.string().optional(),

  // WhatsApp
  WHATSAPP_API_URL: z.string().optional(),
  WHATSAPP_API_KEY: z.string().optional(),
  WHATSAPP_INSTANCE: z.string().default("severinno"),

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
