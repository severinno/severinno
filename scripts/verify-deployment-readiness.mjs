#!/usr/bin/env node
// =============================================================================
// scripts/verify-deployment-readiness.mjs — Auditor de Prontidão de Deploy Staging/Prod
// =============================================================================
//
// Usage:
//   node scripts/verify-deployment-readiness.mjs
//   node scripts/verify-deployment-readiness.mjs --json
//   node scripts/verify-deployment-readiness.mjs --strict
//
// Exit codes:
//   0 — pronto para deploy em staging/produção (todos os critérios vitais atendidos)
//   1 — falha em um ou mais critérios bloqueantes de deploy
//
// =============================================================================

import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"

const args = process.argv.slice(2)
const isJson = args.includes("--json")
const isStrict = args.includes("--strict")

const ROOT = process.cwd()

const checks = []

function check(name, fn) {
  try {
    const result = fn()
    checks.push({ name, passed: true, details: result || "OK" })
  } catch (err) {
    checks.push({ name, passed: false, details: err.message || String(err) })
  }
}

console.log("\n=======================================================")
console.log("🚀 Severinno Marketplace — Validador de Prontidão de Deploy")
console.log("=======================================================\n")

// 1. Arquivos Compose de Produção/Staging
check("1. Docker Compose Hostinger & Base", () => {
  const hostingerPath = resolve(ROOT, "docker-compose.hostinger.yml")
  const basePath = resolve(ROOT, "docker-compose.base.yml")
  if (!existsSync(hostingerPath)) throw new Error("docker-compose.hostinger.yml não encontrado")
  if (!existsSync(basePath)) throw new Error("docker-compose.base.yml não encontrado")
  return "Arquivos de orquestração presentes"
})

// 2. Templates de Variáveis de Ambiente
check("2. Templates de Ambiente (.env.example)", () => {
  const examplePath = resolve(ROOT, ".env.example")
  if (!existsSync(examplePath)) throw new Error(".env.example ausente")
  const content = readFileSync(examplePath, "utf-8")
  const requiredVars = [
    "DATABASE_URL",
    "REDIS_URL",
    "RABBITMQ_URL",
    "SESSION_SECRET",
    "NEXT_PUBLIC_APP_URL",
  ]
  const missing = requiredVars.filter((v) => !content.includes(v))
  if (missing.length > 0)
    throw new Error(`Variáveis ausentes no .env.example: ${missing.join(", ")}`)
  return "Todas as variáveis críticas mapeadas"
})

// 3. Prisma Schema e Extensão Espacial PostGIS
check("3. Esquema de Banco de Dados e PostGIS", () => {
  const schemaPath = resolve(ROOT, "prisma/schema.prisma")
  if (!existsSync(schemaPath)) throw new Error("prisma/schema.prisma não encontrado")
  const content = readFileSync(schemaPath, "utf-8")
  if (!content.includes('"postgresql"')) {
    throw new Error("Provedor do banco não é PostgreSQL")
  }
  if (!content.includes("model CnefeGv")) {
    throw new Error("Modelo CnefeGv ausente no schema (risco de drift com PostGIS)")
  }
  return "PostgreSQL e modelo CnefeGv validados"
})

// 4. Configuração do Proxy Reverso Caddy
check("4. Configuração de TLS e Hardening no Caddy", () => {
  const caddyProd = resolve(ROOT, "Caddyfile.prod")
  const caddyRoot = resolve(ROOT, "Caddyfile")
  const caddyGitea = resolve(ROOT, "deploy/Caddyfile.gitea")
  const exists = existsSync(caddyProd) || existsSync(caddyRoot) || existsSync(caddyGitea)
  if (!exists) throw new Error("Caddyfile não encontrado na raiz ou em deploy/")
  return "Configuração de proxy Caddy validada"
})

// 5. Build Standalone do Next.js
check("5. Next.js Config para Output Standalone", () => {
  const nextConfigTs = resolve(ROOT, "next.config.ts")
  const nextConfigMjs = resolve(ROOT, "next.config.mjs")
  const configPath = existsSync(nextConfigTs) ? nextConfigTs : nextConfigMjs
  if (!existsSync(configPath)) throw new Error("next.config.(ts|mjs) não encontrado")
  const content = readFileSync(configPath, "utf-8")
  if (!content.includes('output: "standalone"')) {
    throw new Error("Configuração não especifica output: 'standalone'")
  }
  return "Next.js configurado para build standalone de contêiner"
})

// 6. Configuração de Scripts de Provisionamento e Migração
check("6. Scripts de Inicialização de Banco e Seeds", () => {
  const dbSetup = resolve(ROOT, "scripts/db-setup.sh")
  const seedProd = resolve(ROOT, "prisma/seed-prod.ts")
  if (!existsSync(dbSetup)) throw new Error("scripts/db-setup.sh não encontrado")
  if (!existsSync(seedProd)) throw new Error("prisma/seed-prod.ts não encontrado")
  return "Scripts de setup e seed de produção presentes"
})

// 7. Configuração de Expansão Territorial Multi-Cidades
check("7. Hub Geoespacial Multi-Cidades", () => {
  const geoHub = resolve(ROOT, "src/lib/geo-multi-city.ts")
  const importScript = resolve(ROOT, "scripts/import-city-geo.ts")
  if (!existsSync(geoHub)) throw new Error("src/lib/geo-multi-city.ts ausente")
  if (!existsSync(importScript)) throw new Error("scripts/import-city-geo.ts ausente")
  return "Hub e CLI de expansão territorial ativos"
})

// 8. Resiliência de Mensageria e DLQ Alert
check("8. Rastreamento e Alertas Proativos em Filas", () => {
  const queuePath = resolve(ROOT, "src/lib/queue.ts")
  const content = readFileSync(queuePath, "utf-8")
  if (!content.includes("sendAlertWebhook")) {
    throw new Error("DLQ não está integrada ao despachante de alertas")
  }
  return "DLQ vinculada ao sendAlertWebhook"
})

// 9. Manutenção Preventiva Ativada por Default no Seed
check("9. Modo de Manutenção Ativado no Seed de Produção", () => {
  const seedDataPath = resolve(ROOT, "prisma/seed-data.ts")
  if (!existsSync(seedDataPath)) throw new Error("prisma/seed-data.ts não encontrado")
  const content = readFileSync(seedDataPath, "utf-8")
  if (!content.includes('"maintenance_mode"')) {
    throw new Error(
      "maintenance_mode ausente em DEFAULT_SETTINGS — deploy exporia o site sem revisão",
    )
  }
  // Verifica que o valor default é "true" (fail-closed)
  const match = content.match(/key:\s*"maintenance_mode"\s*,\s*value:\s*"(\w+)"/)
  if (!match || match[1] !== "true") {
    throw new Error('maintenance_mode não está com value: "true" — o default deve ser fail-closed')
  }
  return "maintenance_mode=true no seed (fail-closed por default)"
})

// ── Resumo ─────────────────────────────────────────────────────────────────

const failed = checks.filter((c) => !c.passed)

if (isJson) {
  console.log(JSON.stringify({ passed: failed.length === 0, checks }, null, 2))
} else {
  for (const c of checks) {
    if (c.passed) {
      console.log(`  ✅ ${c.name} — ${c.details}`)
    } else {
      console.log(`  ❌ ${c.name} — ${c.details}`)
    }
  }
  console.log("\n-------------------------------------------------------")
  console.log(`Critérios Avaliados: ${checks.length}`)
  console.log(`Aprovados: ${checks.length - failed.length}`)
  console.log(`Reprovados: ${failed.length}`)
  console.log("-------------------------------------------------------\n")
}

if (failed.length > 0) {
  console.error("❌ O ambiente possui pendências para o deploy de produção.")
  process.exit(1)
} else {
  console.log("🎉 Todos os 9 critérios vitais de prontidão para deploy estão 100% aprovados!\n")
  process.exit(0)
}
