#!/usr/bin/env node
/**
 * Verify secret rotation status — Severinno
 *
 * Compares the LAST LEAKED value of each secret (from git history) against the
 * CURRENT value in the local env files (.env.production / .env), reporting only
 * a status + an 8-char sha256 prefix — NEVER the values themselves.
 *
 *   ✅ ROTACIONADO — current value differs from the leaked one
 *   ❌ IGUAL       — current value is still the leaked one (rotation pending)
 *   ⚠️  N/D        — key missing on one side (nothing to compare on this machine)
 *
 * Evidence basis: this machine's env files vs the git history. The live
 * server / CI secret store must be confirmed manually (see the checklist).
 *
 * Usage:
 *   node scripts/verify-secret-rotation.mjs
 */
import { spawnSync } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"

const ROOT = process.cwd()
const hash8 = (v) => crypto.createHash("sha256").update(v, "utf8").digest("hex").slice(0, 8)

/** Parse KEY=VALUE lines from an env file string; returns { key: value } (no export=). */
function parseEnv(text) {
  const out = {}
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith("#")) continue
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (!m) continue
    let v = m[2]
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1)
    }
    out[m[1]] = v
  }
  return out
}

/** Last commit in history whose tree still contains `file`, or null. */
function lastCommitWith(file) {
  const log = spawnSync("git", ["log", "--format=%H", "--all", "--", file], { encoding: "utf8" })
  if (log.status !== 0) return null
  for (const c of log.stdout.split(/\r?\n/).filter(Boolean)) {
    const show = spawnSync("git", ["cat-file", "-e", `${c}:${file}`], { encoding: "utf8" })
    if (show.status === 0) return c
  }
  return null
}

/** File content at commit, or null. */
function atCommit(commit, file) {
  const r = spawnSync("git", ["show", `${commit}:${file}`], { encoding: "utf8", maxBuffer: 1 << 24 })
  return r.status === 0 ? r.stdout : null
}

// (key, service, file that carries it in the checklist)
const CHECKS = [
  ["DB_PASSWORD", "Postgres", ".env.production"],
  ["POSTGRES_PASSWORD", "Postgres", ".env.production"],
  ["DATABASE_URL", "Prisma (Postgres)", ".env.production"],
  ["DIRECT_URL", "Prisma (Postgres)", ".env.production"],
  ["REDIS_URL", "Redis", ".env.production"],
  ["RABBITMQ_PASS", "RabbitMQ", ".env.production"],
  ["RABBITMQ_URL", "RabbitMQ", ".env.production"],
  ["OPENSEARCH_PASSWORD", "OpenSearch", ".env.production"],
  ["OPENSEARCH_URL", "OpenSearch", ".env.production"],
  ["S3_ACCESS_KEY", "S3/MinIO", ".env.production"],
  ["S3_SECRET_KEY", "S3/MinIO", ".env.production"],
  ["SESSION_SECRET", "Auth (sessão)", ".env.production"],
  ["CRON_SECRET", "Jobs agendados", ".env.production"],
  ["PAYMENT_WEBHOOK_SECRET", "Webhooks Lytex", ".env.production"],
  ["LYTEX_CLIENT_SECRET", "Integração Lytex", ".env.production"],
  ["SMTP_PASS", "E-mail transacional", ".env.production"],
  ["VAPID_PRIVATE_KEY", "Push (web-push)", ".env.production"],
  ["EVOLUTION_API_KEY", "Evolução/WhatsApp (prod)", ".env.production"],
  ["SENTRY_AUTH_TOKEN", "Sentry source maps", ".env.production"],
  ["SENTRY_DSN", "Sentry (DSN)", ".env.production"],
  ["NEXT_PUBLIC_SENTRY_DSN", "Sentry (DSN público)", ".env.production"],
  ["GLITCHTIP_DSN", "GlitchTip (DSN)", ".env.production"],
  ["NEXT_PUBLIC_GLITCHTIP_DSN", "GlitchTip (DSN público)", ".env.production"],
  ["GROQ_API_KEY", "LLM (dev)", ".env"],
  ["WHATSAPP_API_KEY", "Evolução/WhatsApp (dev)", ".env"],
  ["GLITCHTIP_SECRET", "GlitchTip (dev)", ".env"],
]

const leakFile = { ".env.production": ".env.production", ".env": ".env" }
const leaked = {}
for (const f of Object.keys(leakFile)) {
  const c = lastCommitWith(f)
  leaked[f] = c ? { commit: c, env: parseEnv(atCommit(c, f) || "") } : { commit: null, env: {} }
}

const current = {}
for (const f of Object.keys(leakFile)) {
  const p = path.join(ROOT, f)
  current[f] = fs.existsSync(p) ? parseEnv(fs.readFileSync(p, "utf8")) : {}
}

let changed = 0
let same = 0
let empty = 0
let unknown = 0
for (const [key, service, file] of CHECKS) {
  const L = leaked[file].env[key]
  const C = current[file][key]
  let status, note
  if (L === undefined) {
    status = "⚠️  N/D"
    note = "não estava no último valor vazado desse arquivo"
    unknown++
  } else if (C === undefined) {
    status = "⚠️  N/D"
    note = "ausente no env local atual (não verificável nesta máquina)"
    unknown++
  } else if (C === "") {
    status = "⚠️  VAZIO"
    note = "valor atual é vazio — nada a rotacionar na cópia local; confirmar prod/CI"
    empty++
  } else if (C === L) {
    status = "❌ IGUAL"
    note = "valor atual ainda é o vazado — rotação pendente"
    same++
  } else {
    status = "✅ ROTACIONADO"
    note = "valor atual difere do vazado"
    changed++
  }
  const curHash = C === undefined ? "—" : hash8(C)
  const leakHash = L === undefined ? "—" : hash8(L)
  console.log(
    `${status.padEnd(14)} ${key.padEnd(28)} ${service.padEnd(22)} ` +
      `atual#${curHash} vazado#${leakHash} ${note}`,
  )
}

console.log(
  `\nResumo: ${changed} ✅ rotacionado(s) | ${same} ❌ igual(is) | ${empty} ⚠️ vazio(s) | ` +
    `${unknown} ⚠️ não verificável(is)`,
)
console.log(
  `Fonte do vazado: .env.production@${leaked[".env.production"].commit || "?"} e ` +
    `.env@${leaked[".env"].commit || "?"} (últimos commits com o arquivo).`,
)
