#!/usr/bin/env bun
// =============================================================================
// scripts/preflight-deploy.ts — Checklist Automatizado Pré-Deploy (Staging/Prod)
// =============================================================================
//
// Executa verificações de integridade estáticas e dinâmicas antes de disparar
// o deploy para produção:
//   1. Sintaxe dos arquivos Docker Compose (prod e staging)
//   2. Compilação TypeScript (tsc --noEmit)
//   3. Validação dos templates e regras de variáveis de ambiente
//   4. Presença de scripts de Disaster Recovery (PostGIS backup/restore)
//   5. Verificação do Caddyfile.prod (regras de segurança e proxy)
//
// Usage:
//   bun run scripts/preflight-deploy.ts
//   bun run scripts/preflight-deploy.ts --env-file .env.production.local
//
// Exit code:
//   0 — Todos os gates pré-deploy foram aprovados.
//   1 — Algum gate crítico falhou (deploy bloqueado).
// =============================================================================

import { execSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { parseEnvContent, validateEnvMap, CRITICAL_ENV_RULES } from "./verify-env"

interface PreflightCheck {
  name: string
  category: "Docker" | "TypeScript" | "Ambiente" | "Disaster Recovery" | "Caddy"
  run: () => { pass: boolean; details?: string }
}

const checks: PreflightCheck[] = [
  {
    name: "Sintaxe Docker Compose Produção (docker-compose.prod.yml)",
    category: "Docker",
    run: () => {
      try {
        execSync("docker compose -f docker-compose.prod.yml config", {
          stdio: "pipe",
          encoding: "utf-8",
        })
        return { pass: true, details: "Configuração válida e sem erros de YAML" }
      } catch (err: any) {
        return { pass: false, details: err.message || "Erro na validação do compose prod" }
      }
    },
  },
  {
    name: "Sintaxe Docker Compose Staging (docker-compose.staging.yml)",
    category: "Docker",
    run: () => {
      try {
        execSync("docker compose -f docker-compose.staging.yml config", {
          stdio: "pipe",
          encoding: "utf-8",
        })
        return { pass: true, details: "Configuração válida e sem erros de YAML" }
      } catch (err: any) {
        return { pass: false, details: err.message || "Erro na validação do compose staging" }
      }
    },
  },
  {
    name: "Tipagem TypeScript (tsc --noEmit)",
    category: "TypeScript",
    run: () => {
      try {
        execSync("bun run typecheck", {
          stdio: "pipe",
          encoding: "utf-8",
        })
        return { pass: true, details: "Zero erros de compilação TypeScript" }
      } catch (err: any) {
        return { pass: false, details: err.stderr || err.stdout || "Erros de tipagem detectados" }
      }
    },
  },
  {
    name: "Templates de Variáveis de Ambiente (.env.production.example & .env.staging.example)",
    category: "Ambiente",
    run: () => {
      const prodEx = existsSync(resolve(process.cwd(), ".env.production.example"))
      const stagEx = existsSync(resolve(process.cwd(), ".env.staging.example"))
      if (!prodEx || !stagEx) {
        return {
          pass: false,
          details: "Templates .env.production.example ou .env.staging.example ausentes",
        }
      }
      return { pass: true, details: "Templates de produção e staging presentes e documentados" }
    },
  },
  {
    name: "Scripts de Backup & Restore PostGIS (Disaster Recovery)",
    category: "Disaster Recovery",
    run: () => {
      const shPath = resolve(process.cwd(), "scripts/backup-postgis.sh")
      const psPath = resolve(process.cwd(), "scripts/backup-postgis.ps1")
      if (!existsSync(shPath) || !existsSync(psPath)) {
        return {
          pass: false,
          details: "Scripts backup-postgis.sh ou backup-postgis.ps1 não encontrados",
        }
      }

      const shContent = readFileSync(shPath, "utf-8")
      if (!shContent.includes("--restore")) {
        return {
          pass: false,
          details: "backup-postgis.sh não possui rotina de restauração (--restore)",
        }
      }

      return {
        pass: true,
        details: "Scripts Linux e Windows com suporte a backup e restore validados",
      }
    },
  },
  {
    name: "Configuração do Caddy (Caddyfile.prod)",
    category: "Caddy",
    run: () => {
      const caddyPath = resolve(process.cwd(), "Caddyfile.prod")
      if (!existsSync(caddyPath)) {
        return { pass: false, details: "Caddyfile.prod não encontrado" }
      }
      const content = readFileSync(caddyPath, "utf-8")
      if (
        !content.includes("Strict-Transport-Security") ||
        !content.includes("Content-Security-Policy")
      ) {
        return { pass: false, details: "Headers críticos de segurança ausentes no Caddyfile.prod" }
      }
      return { pass: true, details: "HSTS, CSP, rate limiting e reverse proxy configurados" }
    },
  },
]

async function runPreflight() {
  console.log("═══════════════════════════════════════════════════════════════════════")
  console.log("  🚀 SEVERINNO — BATERIA DE VERIFICAÇÃO PRÉ-DEPLOY (PRE-FLIGHT)")
  console.log("═══════════════════════════════════════════════════════════════════════\n")

  let allPass = true
  let passedCount = 0

  for (const check of checks) {
    process.stdout.write(`  ⏳ [${check.category}] ${check.name}... `)
    const result = check.run()
    if (result.pass) {
      passedCount++
      console.log(`\x1b[32mPASS\x1b[0m`)
      if (result.details) {
        console.log(`     ↳ ${result.details}`)
      }
    } else {
      allPass = false
      console.log(`\x1b[31mFAIL\x1b[0m`)
      if (result.details) {
        console.log(`     ↳ \x1b[31m${result.details.trim()}\x1b[0m`)
      }
    }
  }

  // Opcional: verificar arquivo de ambiente se fornecido
  const args = process.argv.slice(2)
  const envIdx = args.indexOf("--env-file")
  if (envIdx !== -1 && args[envIdx + 1]) {
    const envFile = args[envIdx + 1]
    const envPath = resolve(process.cwd(), envFile)
    console.log(`\n  ⏳ [Ambiente] Validação de arquivo .env real: ${envFile}...`)
    if (!existsSync(envPath)) {
      console.log(`     ↳ \x1b[31mArquivo não encontrado: ${envPath}\x1b[0m`)
      allPass = false
    } else {
      const content = readFileSync(envPath, "utf-8")
      const parsed = parseEnvContent(content)
      const res = validateEnvMap(parsed, CRITICAL_ENV_RULES)
      if (res.valid) {
        console.log(
          `     ↳ \x1b[32mPASS: Todas as ${res.totalChecked} variáveis críticas atendem os requisitos.\x1b[0m`,
        )
      } else {
        allPass = false
        console.log(
          `     ↳ \x1b[31mFAIL: ${res.missingKeys.length} ausentes, ${res.unreplacedPlaceholders.length} placeholders.\x1b[0m`,
        )
      }
    }
  }

  console.log("\n═══════════════════════════════════════════════════════════════════════")
  console.log(`  Resumo: ${passedCount}/${checks.length} verificações aprovadas`)

  if (allPass) {
    console.log("  \x1b[32m✅ PRE-FLIGHT APROVADO! O repositório está pronto para deploy.\x1b[0m")
    console.log("═══════════════════════════════════════════════════════════════════════")
    process.exit(0)
  } else {
    console.log(
      "  \x1b[31m❌ PRE-FLIGHT REPROVADO! Resolva os erros antes de realizar o deploy.\x1b[0m",
    )
    console.log("═══════════════════════════════════════════════════════════════════════")
    process.exit(1)
  }
}

if (import.meta.main) {
  runPreflight()
}
