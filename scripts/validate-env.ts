#!/usr/bin/env tsx
/**
 * Validate a .env file against the Zod env schema (src/lib/env.schema.ts).
 *
 * The schema is the single source of truth used at runtime by src/lib/env.ts.
 * This script lets you validate a .env file (e.g. .env.production) in plain
 * Node — WITHOUT importing src/lib/env.ts, which pulls in `server-only` and
 * throws outside the Next.js runtime.
 *
 * Usage:
 *   npx tsx scripts/validate-env.ts                      # validates .env.production
 *   npx tsx scripts/validate-env.ts --file .env          # any file
 *   npx tsx scripts/validate-env.ts --file .env.production --ci
 *
 * Flags:
 *   --file <path>   File to validate (default: .env.production)
 *   --ci            Minimal output; exit code only (for CI gates)
 *
 * Exit code:
 *   0 - all schema-required vars valid (missing optional vars are allowed;
 *       extra vars not in the schema only produce warnings)
 *   1 - validation failed (missing required vars, invalid values, bad file)
 */

import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { envSchema } from "../src/lib/env.schema"

// Project root (repo convention — see validate-cache-manifest.ts)
const PROJECT_ROOT = resolve(import.meta.dirname, "..")

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]) {
  let file = ".env.production"
  let ci = false
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--file" && argv[i + 1]) {
      file = argv[++i]
    } else if (a === "--ci") {
      ci = true
    }
  }
  return { file, ci }
}

// ---------------------------------------------------------------------------
// Minimal .env parser (no dotenv dependency — parse key=value lines)
// ---------------------------------------------------------------------------

function parseDotEnv(content: string): {
  vars: Record<string, string>
  skipped: string[]
} {
  const vars: Record<string, string> = {}
  const skipped: string[] = []
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith("#")) continue
    const eq = line.indexOf("=")
    if (eq <= 0) {
      skipped.push(line)
      continue
    }
    const key = line.slice(0, eq).trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      skipped.push(line)
      continue
    }
    let value = line.slice(eq + 1).trim()
    // Strip inline comments (KEY=value # comment) — keep URL-friendly '#'
    value = value.split(/\s+#/)[0].trim()
    // Strip surrounding quotes (single or double)
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    vars[key] = value
  }
  return { vars, skipped }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const { file, ci } = parseArgs(process.argv.slice(2))
  const fullPath = resolve(PROJECT_ROOT, file)

  let content: string
  try {
    content = readFileSync(fullPath, "utf-8")
  } catch (err) {
    console.error(`❌ Could not read ${file}: ${(err as Error).message}`)
    process.exit(1)
  }

  const { vars: fileEnv, skipped } = parseDotEnv(content)
  const schemaKeys = new Set(Object.keys(envSchema.shape))
  const parsed = envSchema.safeParse(fileEnv)

  if (!ci) {
    // Warnings (non-fatal): vars in the file not in the schema + unparsed lines
    const unknown = Object.keys(fileEnv).filter((k) => !schemaKeys.has(k))
    if (unknown.length) {
      console.warn(`⚠️  ${unknown.length} var(s) present but not in schema: ${unknown.join(", ")}`)
    }
    if (skipped.length) {
      console.warn(`⚠️  ${skipped.length} line(s) skipped by parser (no '=' or bad key):`)
      for (const s of skipped.slice(0, 5)) console.warn(`     ${s}`)
    }
  }

  if (parsed.success) {
    if (!ci) console.log(`✅ ${file}: all required env vars valid.`)
    process.exit(0)
  }

  // Classification by presence (not by zod error code — coerced numeric
  // fields produce invalid_type for bad VALUES, which are invalid, not missing)
  const flat = parsed.error.flatten()
  const missing: string[] = []
  const invalid: string[] = []

  for (const [key, errors] of Object.entries(flat.fieldErrors)) {
    for (const err of errors) {
      if (key in fileEnv) invalid.push(`${key}: ${err}`)
      else missing.push(key)
    }
  }

  if (!ci) {
    console.error(
      `❌ ${file}: ${flat.formErrors.length + missing.length + invalid.length} issue(s)`,
    )
    if (missing.length) console.error(`   Missing: ${missing.join(", ")}`)
    for (const msg of invalid) console.error(`   Invalid: ${msg}`)
    for (const msg of flat.formErrors) console.error(`   ${msg}`)
  }
  process.exit(1)
}

main()
