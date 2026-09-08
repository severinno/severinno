#!/usr/bin/env bun
// =============================================================================
// scripts/verify-env.ts — Validador de Variáveis de Ambiente de Produção & Staging
// =============================================================================
//
// Inspeciona um arquivo .env ou process.env garantindo que todas as variáveis
// críticas existam, possuam formato válido e não contenham placeholders <MUDE_AQUI>.
//
// Uso:
//   bun run scripts/verify-env.ts .env.production.local
//   bun run scripts/verify-env.ts --env-file .env.staging
//   bun run scripts/verify-env.ts --check-current
//
// Exit code:
//   0 — Todas as variáveis obrigatórias estão presentes e válidas.
//   1 — Faltam variáveis ou existem placeholders não substituídos.
//   2 — Arquivo não encontrado ou erro de leitura.
// =============================================================================

import { readFileSync, existsSync } from "node:fs"
import { resolve } from "node:path"

export interface EnvRule {
  key: string
  required: boolean
  minLength?: number
  pattern?: RegExp
  description: string
  validate?: (val: string) => { valid: boolean; error?: string }
}

export const CRITICAL_ENV_RULES: EnvRule[] = [
  {
    key: "NODE_ENV",
    required: true,
    pattern: /^(production|staging|development|test)$/,
    description: "Ambiente de execução (production, staging, development, test)",
  },
  {
    key: "NEXT_PUBLIC_APP_URL",
    required: true,
    pattern: /^https?:\/\/.+/,
    description: "URL pública canônica da aplicação",
  },
  {
    key: "SESSION_SECRET",
    required: true,
    minLength: 32,
    description: "Chave secreta para criptografia de sessão (mínimo 32 caracteres)",
  },
  {
    key: "DATABASE_URL",
    required: true,
    pattern: /^postgres(ql)?:\/\/.+/,
    description: "String de conexão com o banco de dados (via PgBouncer ou direto)",
  },
  {
    key: "DIRECT_URL",
    required: true,
    pattern: /^postgres(ql)?:\/\/.+/,
    description: "String de conexão direta com PostgreSQL (para Prisma Migrate)",
  },
  {
    key: "REDIS_URL",
    required: true,
    pattern: /^rediss?:\/\/.+/,
    description: "URL de conexão com o Redis",
  },
  {
    key: "RABBITMQ_URL",
    required: true,
    pattern: /^amqps?:\/\/.+/,
    description: "URL de conexão com o RabbitMQ",
  },
  {
    key: "S3_ENDPOINT",
    required: true,
    pattern: /^https?:\/\/.+/,
    description: "Endpoint S3/MinIO para upload de mídias",
  },
  {
    key: "S3_BUCKET",
    required: true,
    minLength: 3,
    description: "Nome do bucket S3",
  },
  {
    key: "VAPID_PUBLIC_KEY",
    required: true,
    minLength: 20,
    description: "Chave pública VAPID para Web Push",
  },
  {
    key: "VAPID_PRIVATE_KEY",
    required: true,
    minLength: 20,
    description: "Chave privada VAPID para Web Push",
  },
  {
    key: "CRON_SECRET",
    required: true,
    minLength: 16,
    description: "Segredo de autorização para cron jobs (mínimo 16 caracteres)",
  },
]

export interface EnvValidationResult {
  valid: boolean
  totalChecked: number
  missingKeys: string[]
  unreplacedPlaceholders: Array<{ key: string; value: string }>
  formatErrors: Array<{ key: string; error: string }>
  warnings: string[]
}

/**
 * Faz o parse simples de conteúdo .env em um Record<string, string>
 */
export function parseEnvContent(content: string): Record<string, string> {
  const result: Record<string, string> = {}
  const lines = content.split(/\r?\n/)

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue

    const eqIdx = trimmed.indexOf("=")
    if (eqIdx <= 0) continue

    const key = trimmed.slice(0, eqIdx).trim()
    let val = trimmed.slice(eqIdx + 1).trim()

    // Remove aspas simples ou duplas externas
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }

    result[key] = val
  }

  return result
}

/**
 * Valida um mapa de variáveis contra as regras críticas
 */
export function validateEnvMap(
  envMap: Record<string, string | undefined>,
  rules: EnvRule[] = CRITICAL_ENV_RULES,
): EnvValidationResult {
  const missingKeys: string[] = []
  const unreplacedPlaceholders: Array<{ key: string; value: string }> = []
  const formatErrors: Array<{ key: string; error: string }> = []
  const warnings: string[] = []

  const placeholderRegex = /<MUDE_AQUI[_\w]*>|<SEU_VALOR[_\w]*>|<PLACEHOLDER[_\w]*>/i

  for (const rule of rules) {
    const val = envMap[rule.key]?.trim()

    if (!val) {
      if (rule.required) {
        missingKeys.push(rule.key)
      }
      continue
    }

    // Verificar placeholders
    if (placeholderRegex.test(val)) {
      unreplacedPlaceholders.push({ key: rule.key, value: val })
      continue
    }

    // Verificar tamanho mínimo
    if (rule.minLength && val.length < rule.minLength) {
      formatErrors.push({
        key: rule.key,
        error: `Tamanho insuficiente (${val.length} chars, esperado mín. ${rule.minLength})`,
      })
      continue
    }

    // Verificar regex pattern
    if (rule.pattern && !rule.pattern.test(val)) {
      formatErrors.push({
        key: rule.key,
        error: `Formato inválido para ${rule.description}`,
      })
      continue
    }

    // Validador customizado
    if (rule.validate) {
      const res = rule.validate(val)
      if (!res.valid) {
        formatErrors.push({
          key: rule.key,
          error: res.error || "Falha na validação customizada",
        })
      }
    }
  }

  const valid =
    missingKeys.length === 0 && unreplacedPlaceholders.length === 0 && formatErrors.length === 0

  return {
    valid,
    totalChecked: rules.length,
    missingKeys,
    unreplacedPlaceholders,
    formatErrors,
    warnings,
  }
}

// ── Execução CLI ────────────────────────────────────────────────────────────
if (import.meta.main) {
  const args = process.argv.slice(2)
  let targetFile: string | null = null
  let checkCurrent = false

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--check-current") {
      checkCurrent = true
    } else if (args[i] === "--env-file" && args[i + 1]) {
      targetFile = args[++i]
    } else if (!args[i].startsWith("-")) {
      targetFile = args[i]
    }
  }

  let envMap: Record<string, string | undefined> = {}

  if (checkCurrent) {
    console.log("🔍 Validando variáveis do ambiente atual (process.env)...")
    envMap = process.env
  } else {
    const fileToRead = targetFile || ".env.production.local"
    const resolvedPath = resolve(process.cwd(), fileToRead)

    if (!existsSync(resolvedPath)) {
      console.error(`❌ Arquivo não encontrado: ${resolvedPath}`)
      console.log(`Dica: crie o arquivo a partir de .env.production.example`)
      process.exit(2)
    }

    console.log(`🔍 Validando arquivo de ambiente: ${fileToRead}`)
    const content = readFileSync(resolvedPath, "utf-8")
    envMap = parseEnvContent(content)
  }

  const result = validateEnvMap(envMap)

  console.log("═══════════════════════════════════════════════════════════════")
  console.log(`  Regras verificadas: ${result.totalChecked}`)

  if (result.valid) {
    console.log("  ✅ Todas as variáveis críticas estão configuradas e válidas!")
    console.log("═══════════════════════════════════════════════════════════════")
    process.exit(0)
  }

  console.log("  ❌ Foram encontrados problemas na configuração:")

  if (result.missingKeys.length > 0) {
    console.log("\n  🔴 Variáveis ausentes:")
    result.missingKeys.forEach((k) => console.log(`     - ${k}`))
  }

  if (result.unreplacedPlaceholders.length > 0) {
    console.log("\n  🟡 Placeholders não substituídos:")
    result.unreplacedPlaceholders.forEach((p) => console.log(`     - ${p.key}: ${p.value}`))
  }

  if (result.formatErrors.length > 0) {
    console.log("\n  🟠 Erros de formato/validação:")
    result.formatErrors.forEach((f) => console.log(`     - ${f.key}: ${f.error}`))
  }

  console.log("═══════════════════════════════════════════════════════════════")
  process.exit(1)
}
