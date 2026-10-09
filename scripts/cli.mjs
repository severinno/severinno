#!/usr/bin/env node
/**
 * Severinno Marketplace — CLI Unificado de Operações e Engenharia
 *
 * Centraliza e orquestra os mais de 370 scripts internos da plataforma em comandos
 * padronizados, com tratamento de erros, validação de flags e documentação interativa.
 *
 * Usage:
 *   node scripts/cli.mjs <comando> [subcomando] [opções]
 *   bun run cli <comando> [subcomando]
 *
 * Exit codes:
 *   0 — success
 *   1 — general failure (invalid command, sub-process error)
 *   2 — pre-commit gate violation (CRLF, UTF-8, bun-mirror, or PII)
 */

import { spawnSync } from "node:child_process"
import { writeFileSync, chmodSync } from "node:fs"
import { join } from "node:path"
import process from "node:process"

const [, , command, subcommand, ...extraArgs] = process.argv

const HELP_TEXT = `
Severinno CLI — Orquestrador Unificado de Ferramentas

Comandos Disponíveis:
  precommit           Executa verificação ultrarrápida pré-commit (CRLF, UTF-8, Bun-mirror, PII)
  hook <ação>         Gerencia Git hooks locais:
                        - install  (instala .git/hooks/pre-commit apontando para cli precommit)
  guard               Executa todos os encoding guards (CRLF, UTF-8, blob audit)
  doctor              Executa diagnóstico do ecossistema e integridade das forjas
  db <ação>          Gerencia o banco de dados PostgreSQL / PostGIS:
                        - setup    (aplica migrations, seed e search index)
                        - seed     (popula dados de desenvolvimento)
                        - migrate  (aplica migrations pendentes via directUrl)
                        - push     (sincroniza schema sem migrations)
  check <tipo>       Executa verificações estritas:
                        - pii      (gate de proteção contra vazamento de PII)
                        - crlf     (validação de line endings LF)
                        - utf8     (validação de escopo UTF-8)
                        - deps     (auditoria de dependências não utilizadas)
                        - mirror   (validação da versão única do Bun)
  bench <tipo>       Executa testes de benchmark e performance:
                        - geo      (benchmark de consultas geoespaciais PostGIS)
                        - cache    (benchmark de latência e throughput do Redis)
                        - all      (bateria completa com comparação de baseline)
  docs               Gera a especificação OpenAPI 3.1 do catálogo em public/openapi.json
  qa                 Executa esteira completa de validação de PR (lint, types, testes)

Exemplos:
  bun run cli precommit
  bun run cli hook install
  bun run cli guard
  bun run cli check pii
`

function runCommand(bin, args) {
  const result = spawnSync(bin, args, {
    stdio: "inherit",
    env: process.env,
  })
  if (result.error) {
    console.error(`[CLI ERROR] Falha ao executar ${bin}:`, result.error.message)
    process.exit(1)
  }
  process.exit(result.status ?? 0)
}

function runSequential(commands) {
  for (const [bin, args] of commands) {
    const res = spawnSync(bin, args, {
      stdio: "inherit",
      env: process.env,
    })
    if (res.error || (res.status ?? 0) !== 0) {
      console.error(`\n❌ Falha na etapa: ${bin} ${args.join(" ")}`)
      process.exit(res.status || 1)
    }
  }
  console.log("\n✅ Todas as verificações pré-commit foram aprovadas com sucesso.")
  process.exit(0)
}

switch (command) {
  case "precommit":
    console.log("🔍 Executando verificações pré-commit do Severinno...")
    runSequential([
      ["bash", ["scripts/check-crlf.sh", "--ci"]],
      ["node", ["scripts/check-utf8-scope.mjs"]],
      ["node", ["scripts/check-bun-mirror.mjs"]],
      ["node", ["scripts/verify-pii-gate.mjs"]],
    ])
    break

  case "hook":
    if (subcommand === "install") {
      try {
        const hookPath = join(process.cwd(), ".git", "hooks", "pre-commit")
        const hookScript = `#!/usr/bin/env bash\n# Severinno Pre-commit Guard Hook\nset -e\nnode scripts/cli.mjs precommit\n`
        writeFileSync(hookPath, hookScript, { encoding: "utf8" })
        chmodSync(hookPath, 0o755)
        console.log(`✅ Git pre-commit hook instalado com sucesso em ${hookPath}`)
        process.exit(0)
      } catch (err) {
        if (err.code === "EROFS" || err.code === "EACCES") {
          console.warn("⚠️  A pasta .git/hooks está em modo somente-leitura (comum em sandboxes).")
          console.log("   Para ativar no seu terminal local, execute: bun run cli hook install")
          process.exit(0)
        }
        console.error("❌ Falha ao instalar git pre-commit hook:", err.message)
        process.exit(1)
      }
    } else {
      console.error("Subcomando de hook inválido. Use: bun run cli hook install")
      process.exit(1)
    }
    break

  case "guard":
    runCommand("bash", ["scripts/run-encoding-guards.sh", ...extraArgs])
    break

  case "doctor":
    runCommand("node", ["scripts/forge-doctor.mjs", ...extraArgs])
    break

  case "docs":
    runCommand("bun", ["scripts/generate-openapi.ts", ...extraArgs])
    break

  case "qa":
    runCommand("node", ["scripts/qa.mjs", ...extraArgs])
    break

  case "db":
    switch (subcommand) {
      case "setup":
        runCommand("bash", ["scripts/db-setup.sh", ...extraArgs])
        break
      case "seed":
        runCommand("bun", ["prisma/seed.ts", ...extraArgs])
        break
      case "migrate":
        runCommand("bunx", ["prisma", "migrate", "deploy", ...extraArgs])
        break
      case "push":
        runCommand("bunx", ["prisma", "db", "push", ...extraArgs])
        break
      default:
        console.error("Subcomando de banco inválido. Opções: setup, seed, migrate, push")
        process.exit(1)
    }
    break

  case "check":
    switch (subcommand) {
      case "pii":
        runCommand("node", ["scripts/verify-pii-gate.mjs", ...extraArgs])
        break
      case "crlf":
        runCommand("bash", ["scripts/check-crlf.sh", "--ci", ...extraArgs])
        break
      case "utf8":
        runCommand("node", ["scripts/check-utf8-scope.mjs", ...extraArgs])
        break
      case "deps":
        runCommand("node", ["scripts/check-unused-deps.mjs", ...extraArgs])
        break
      case "mirror":
        runCommand("node", ["scripts/check-bun-mirror.mjs", ...extraArgs])
        break
      default:
        console.error("Subcomando de check inválido. Opções: pii, crlf, utf8, deps, mirror")
        process.exit(1)
    }
    break

  case "bench":
    switch (subcommand) {
      case "geo":
        runCommand("node", ["scripts/run-benchmark.mjs", "--type", "geo", ...extraArgs])
        break
      case "cache":
        runCommand("node", ["scripts/run-benchmark.mjs", "--type", "cache", ...extraArgs])
        break
      case "all":
        runCommand("node", ["scripts/run-benchmark.mjs", "--type", "all", ...extraArgs])
        break
      default:
        runCommand("node", ["scripts/run-benchmark.mjs", ...extraArgs])
        break
    }
    break

  case "-h":
  case "--help":
  case "help":
  default:
    console.log(HELP_TEXT)
    if (!command || command === "help" || command === "--help" || command === "-h") {
      process.exit(0)
    }
    process.exit(1)
}
