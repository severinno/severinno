#!/usr/bin/env node

// =============================================================================
// check-seed-hooks.mjs
//
// CI guard que falha se os hooks de TESTE do seed (SEED_SPEC_PATCH e
// PROD_SEED_ALLOW_DEV) aparecerem em workflows de PRODUÇÃO (ex.: deploy.yml,
// release-deploy.yml) ou em QUALQUER workflow fora do allowlist de teste.
//
// Por que existe: SEED_SPEC_PATCH é o hook de cenários de update/rename usado
// pelos E2Es de seed (test-seed-{prod,dev}-e2e.ts) e PROD_SEED_ALLOW_DEV é o
// override que permite o seed-prod rodar fora de produção (banco efêmero/CI).
// Ambos são TEST-ONLY: se vazarem para um deploy, o seed de produção pode
// rodar com um spec patchado ou com o guard de produção contornado — exatamente
// o tipo de vazamento que o docs/SECURITY.md proíbe.
//
// Fail-closed: os hooks só são permitidos nos workflows de teste listados em
// ALLOWED_SEED_TEST_WORKFLOWS. Qualquer outro workflow (deploy.yml,
// release-deploy.yml, ou um workflow NOVO criado por engano) que os referencie
// falha o guard — um workflow novo de teste legítimo deve ser adicionado ao
// allowlist EXPLICITAMENTE (com review), nunca silenciosamente.
//
// Linhas de comentário (#) e linhas em branco são ignoradas — a intenção é
// detectar CHAMADAS reais de seed (env:, run:), não documentação.
//
// Usage:
//   node scripts/check-seed-hooks.mjs
//
// Exit codes:
//   0 — nenhum hook de teste em workflow fora do allowlist (pass)
//   1 — pelo menos um hook de teste encontrado em workflow de produção (fail)
// =============================================================================

import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

// ---------------------------------------------------------------------------
// Config — hooks de teste e allowlist fail-closed
// ---------------------------------------------------------------------------

/** Hooks TEST-ONLY do seed — nunca em produção. */
const TEST_HOOKS = ["SEED_SPEC_PATCH", "PROD_SEED_ALLOW_DEV"]

/** Regex de word-boundary — evita casar substrings tipo SEED_SPEC_PATCH2. */
const TEST_HOOK_RE = new RegExp(`\\b(?:${TEST_HOOKS.join("|")})\\b`)

/**
 * Workflows onde os hooks de teste são LEGÍTIMOS — os que executam os E2Es de
 * seed contra banco efêmero, ou pipelines de CI (não produção). Qualquer
 * outro arquivo .yml em .github/workflows/ NÃO pode referenciar os hooks.
 */
const ALLOWED_SEED_TEST_WORKFLOWS = new Set([
  "ci.yml", // pipeline de CI (lint/typecheck/test/build) — nunca toca produção
  "pr-check.yml", // PR check — roda seed-guards (prod + dev E2E em PostGIS efêmero)
  "seed-guards.yml", // reusable workflow dos E2Es de seed (prod + dev)
  "benchmark-weekly.yml", // cron semanal — chama seed-guards contra banco efêmero
])

// ---------------------------------------------------------------------------
// Funções puras (exportadas para teste unitário)
// ---------------------------------------------------------------------------

/**
 * Retorna as linhas de `content` (não-comentadas, não-vazias) que mencionam
 * um dos TEST_HOOKS.
 *
 * @param {string} content  conteúdo do workflow
 * @returns {{ line: number, hook: string, text: string }[]}
 */
export function findSeedHookUses(content) {
  const uses = []
  const lines = content.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const match = trimmed.match(TEST_HOOK_RE)
    if (match) {
      uses.push({ line: i + 1, hook: match[0], text: trimmed })
    }
  }
  return uses
}

/**
 * Verifica UM arquivo de workflow. Retorna vazio se o arquivo está no
 * allowlist de teste; caso contrário, lista os usos de hooks encontrados.
 *
 * @param {string} name     nome do arquivo (ex.: "deploy.yml")
 * @param {string} content  conteúdo do arquivo
 * @returns {{ file: string, line: number, hook: string, text: string }[]}
 */
export function checkWorkflowFile(name, content) {
  if (ALLOWED_SEED_TEST_WORKFLOWS.has(name)) return []
  return findSeedHookUses(content).map((u) => ({ file: name, ...u }))
}

/**
 * Escaneia um conjunto de arquivos de workflow de uma vez.
 *
 * @param {{ name: string, content: string }[]} files
 * @returns {{ file: string, line: number, hook: string, text: string }[]}
 */
export function scanWorkflows(files) {
  return files.flatMap((f) => checkWorkflowFile(f.name, f.content))
}

// ---------------------------------------------------------------------------
// Main — varre .github/workflows/*.yml
// ---------------------------------------------------------------------------

function main() {
  const dir = join(process.cwd(), ".github", "workflows")

  let names
  try {
    names = readdirSync(dir)
      .filter((f) => f.endsWith(".yml"))
      .sort()
  } catch (e) {
    console.error(`❌ Não foi possível ler ${dir}: ${e.message}`)
    process.exit(1)
  }

  const files = names.map((n) => ({ name: n, content: readFileSync(join(dir, n), "utf8") }))
  const violations = scanWorkflows(files)

  if (violations.length > 0) {
    console.error(`❌ Hook(s) de teste do seed encontrados em workflow(s) fora do allowlist:\n`)
    for (const v of violations) {
      console.error(`   - ${v.file}:${v.line}  ${v.hook}  →  ${v.text}`)
    }
    console.error(
      `\n   SEED_SPEC_PATCH / PROD_SEED_ALLOW_DEV são TEST-ONLY (E2Es de seed).\n` +
        `   Eles NUNCA devem aparecer em workflows de produção (deploy/release).\n` +
        `   Ação: remova a referência OU, se o workflow é de teste legítimo, adicione-o\n` +
        `   ao ALLOWED_SEED_TEST_WORKFLOWS em scripts/check-seed-hooks.mjs (com review).`,
    )
    process.exit(1)
  }

  console.log("✅ Nenhum hook de teste do seed em workflows fora do allowlist.")
  process.exit(0)
}

// True apenas quando executado diretamente (node ...) — permite importar as
// funções puras em testes unitários sem disparar o scan.
const IS_DIRECT_RUN =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (IS_DIRECT_RUN) main()
