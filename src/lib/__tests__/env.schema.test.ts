// @ts-nocheck
/**
 * sec 11.123 - the form guard of the REQUIRED secrets (src/lib/env.schema.ts).
 *
 * Contract (3 parts):
 *   1. DERIVATION: the required secrets are mechanically derived from the
 *      schema TEXT (the "forma" of env.schema.ts): keys whose zod definition
 *      line carries NO `.optional(` and NO `.default(` suffix. The derivation
 *      is version-independent (no zod class introspection) and survives
 *      reformatting of the block.
 *   2. ABS PIN: the derived list must equal EXACTLY
 *      ['SESSION_SECRET', 'DATABASE_URL', 'REDIS_URL'] (schema order). A new
 *      required secret, or a required secret turned optional/default, fails
 *      loudly with the diff - forcing the conscious re-registration.
 *   3. BOOT FAIL-CLOSED (behavioral): for each derived required secret, in
 *      production with that secret absent, importing src/lib/env.ts REJECTS
 *      with "Invalid environment variables" - the boot gate is the structural
 *      fail-closed of ALL consumers (routes, jobs, workers abort before any
 *      code runs). The edge runtime (middleware) does NOT run env.ts; its own
 *      SESSION_SECRET/CRON_SECRET checks are the documented layer 2 (SECURITY.md
 *      sec 3) - the frontier pinned here as "not required in the boot schema".
 *
 * Pre-commit: editing src/lib/env.schema.ts maps to THIS suite via the
 * co-location convention (src/lib/__tests__/env.schema.test.ts) - the tripwire
 * is the mapper itself (see the REAL-REPO pin in pre-commit-tests.test.ts,
 * sec 11.123).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const ROOT = process.cwd()
const SCHEMA_SRC = readFileSync(resolve(ROOT, "src/lib/env.schema.ts"), "utf8")

const ORIG_ENV = { ...process.env }

beforeEach(() => {
  vi.resetModules()
  process.env = { ...ORIG_ENV }
})

afterEach(() => {
  process.env = { ...ORIG_ENV }
})

function deriveRequiredSecrets(src: string): string[] {
  const out: string[] = []
  for (const line of src.split(/\r?\n/)) {
    const m = line.match(/^\s{2}([A-Z][A-Z0-9_]+): z\./)
    if (!m) continue
    if (line.includes(".optional(") || line.includes(".default(")) continue
    out.push(m[1])
  }
  return out
}

describe("env.schema required secrets (sec 11.123)", () => {
  it("ABS PIN: derivacao = SESSION_SECRET, DATABASE_URL, REDIS_URL (schema order)", () => {
    expect(deriveRequiredSecrets(SCHEMA_SRC)).toEqual([
      "SESSION_SECRET",
      "DATABASE_URL",
      "REDIS_URL",
    ])
  })

  it("fronteira: CRON_SECRET/VAPID NAO sao required no boot (camada 2 do edge)", () => {
    const required = deriveRequiredSecrets(SCHEMA_SRC)
    expect(required).not.toContain("CRON_SECRET")
    expect(required).not.toContain("VAPID_PRIVATE_KEY")
  })

  it("MUTATION: tornar DATABASE_URL opcional muda a derivacao (o ABS PIN do toEqual nao casaria)", () => {
    const mutated = SCHEMA_SRC.replace(
      "DATABASE_URL: z.string().url(),",
      "DATABASE_URL: z.string().url().optional(),",
    )
    expect(deriveRequiredSecrets(mutated)).not.toEqual(
      deriveRequiredSecrets(SCHEMA_SRC),
    )
  })

  it.each(deriveRequiredSecrets(SCHEMA_SRC))(
    "boot fail-closed (producao): %s ausente -> import(env) rejeita",
    async (secret) => {
      process.env = {
        ...ORIG_ENV,
        NODE_ENV: "production",
        NEXT_PUBLIC_APP_URL: "https://severinno.com.br",
        SESSION_SECRET: "a".repeat(32),
        DATABASE_URL: "postgresql://localhost:5432/test",
        REDIS_URL: "redis://localhost:6379",
      }
      delete process.env[secret]
      vi.resetModules()
      await expect(import("../env")).rejects.toThrow("Invalid environment variables")
    },
  )

  it("boot com TODAS as required presentes em producao NAO lanca", async () => {
    process.env = {
      ...ORIG_ENV,
      NODE_ENV: "production",
      NEXT_PUBLIC_APP_URL: "https://severinno.com.br",
      SESSION_SECRET: "a".repeat(32),
      DATABASE_URL: "postgresql://localhost:5432/test",
      REDIS_URL: "redis://localhost:6379",
    }
    vi.resetModules()
    const _env = await import("../env")
    expect(_env.env).toBeDefined()
  })
})
