#!/usr/bin/env node
/**
 * run-mapped-fuzz.mjs - Gate 2 do pre-push (adocao da secao 11.11 do
 * gates-proofs.md, 2026-08-10): roda SO as suites fuzz cujos alvos foram
 * tocados no range do push, BATCHADAS numa unica invocacao vitest.
 *
 * WHY (medicao 11.11): o fuzz:ci rodava as 6 suites em 6 spawns (~40.4s) a
 * cada push - 71% do custo do pre-push. O mapeamento por diff (mesmo
 * escopo do Gate 3) + batching corta para ~6-14s tipico; ate o pior caso
 * (helper compartilhado = todas as suites) e 14.45s batched vs 40.4s -
 * o boot por-spawn dominava o custo. O CI continua rodando `bun run
 * fuzz:ci` (run-all-fuzz.mjs --json) em checkout fresco como AUTORIDADE -
 * este runner nunca mascara o CI, so corta o custo local.
 *
 * Semantica:
 *   --since <sha>   diff do push (reusa gitPushScopeFiles do
 *                   pre-commit-tests.mjs - o MESMO diff do Gate 3),
 *                   resolve alvos -> suites via fuzz-targets.mjs
 *                   (manifest + aresta shared-helper).
 *   zero suites mapeadas  -> skip com mensagem, exit 0 (fast path
 *                           docs/admin/ui - NAO o exit-2 do --only do
 *                           run-all-fuzz.mjs).
 *   --since ausente/zeros -> fallback para o fuzz COMPLETO (todas as
 *                           suites batched - primeira push de branch /
 *                           rodada manual; sem range = sem mapa).
 *   suites selecionadas   -> UMA invocacao vitest (config default, o mesmo
 *                           do run-all-fuzz: SEM --config), exit do vitest.
 *
 * Exit codes: 0 = passou ou skip; 1 = uma suite falhou / erro de spawn.
 * Env override: MAPPED_FUZZ_SCAN_ROOT aponta o ROOT do repo sintetico
 * (testes hermeticos do resolveFuzzPlan nao dependem dele - a logica pura
 * e exportada; o git diff corre so na CLI real). Saida ASCII pura.
 * Puro node, sem deps alem do vitest local (require.resolve).
 */
import { spawnSync } from "node:child_process"
import path from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import { gitPushScopeFiles, isValidSince } from "./pre-commit-tests.mjs"
import { allFuzzSuites, selectFuzzSuites } from "./fuzz-targets.mjs"

const require = createRequire(import.meta.url)
// Same pattern as pre-commit-tests.mjs: resolve vitest's real CLI entry
// from the local install - no `bun`/`npx` PATH dependency inside the hook.
const VITEST_BIN = require.resolve("vitest/vitest.mjs")

const ROOT = path.resolve(
  process.env.MAPPED_FUZZ_SCAN_ROOT || process.cwd(),
)

/** Parse `--since <sha>` (next-arg form, the same as pre-commit-tests). */
export function parseSince(argv) {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--since") return argv[i + 1] ?? ""
  }
  return ""
}

/**
 * Pure plan resolution (exported for the hermetic vitest suite - no git, no
 * fs): given the pushed surface and the full suite list, decide what to run.
 *   - since invalido (ausente / all-zeros = first push) -> { mode: "full" }
 *   - nenhuma suite mapeada -> { mode: "skip" }
 *   - caso contrario -> { mode: "mapped", suites } (ordem do manifest)
 */
export function resolveFuzzPlan({ since, touched, allSuites }) {
  if (!isValidSince(since)) return { mode: "full", suites: allSuites }
  const suites = selectFuzzSuites(touched)
  if (suites.length === 0) return { mode: "skip", suites: [] }
  return { mode: "mapped", suites }
}

function main() {
  const since = parseSince(process.argv.slice(2))
  const all = allFuzzSuites()

  // First push (no range) or manual run: no diff, no map -> touched [] and
  // resolveFuzzPlan returns the FULL branch (the tested pure logic, so the
  // hook follows the exact semantics the hermetic suite pins). Otherwise the
  // same diff union as the Gate 3 (staged + HEAD + <since>...HEAD).
  const touched = isValidSince(since) ? gitPushScopeFiles(since) : []
  const plan = resolveFuzzPlan({ since, touched, allSuites: all })

  if (plan.mode === "full") {
    console.log(
      `[fuzz] fallback: --since ausente/zeros (primeiro push ou rodada manual) -> fuzz COMPLETO batched (${plan.suites.length} suites, secao 11.11)`,
    )
    runBatched(plan.suites)
    return
  }

  if (plan.mode === "skip") {
    console.log("[fuzz] skip: nenhuma suite fuzz mapeada para as areas tocadas (secao 11.11)")
    return
  }

  console.log(
    `[fuzz] mapeado: ${plan.suites.length} suite(s) para o diff do push (secao 11.11):`,
  )
  for (const s of plan.suites) console.log(`  - ${s}`)
  runBatched(plan.suites)
}

/** One vitest invocation over the selected suites (the batching insight). */
function runBatched(suites) {
  const res = spawnSync(
    process.execPath,
    [VITEST_BIN, "run", ...suites],
    {
      cwd: ROOT,
      stdio: "inherit",
      env: process.env,
      timeout: 180_000,
    },
  )
  if (res.error) {
    console.error(`[fuzz] falha ao executar vitest: ${res.error.message}`)
    process.exit(1)
  }
  if (res.status !== 0) process.exit(res.status ?? 1)
}

// Entry-point guard: only run the CLI when executed directly (vitest
// imports the file for unit tests of resolveFuzzPlan without side effects).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
