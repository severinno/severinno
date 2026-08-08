import "server-only"
// Schema lives in ./env.schema.ts (no server-only import) so that plain Node
// scripts (scripts/validate-env.ts) can validate .env files with the SAME
// source of truth — see the NOTE at the top of env.schema.ts.
import { envSchema } from "./env.schema"

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
