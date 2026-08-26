#!/usr/bin/env node

// =============================================================================
// check-setup-bun-warm.mjs
//
// Guard PERIÓDICO (semanal) do tier-2 do setup-bun — o cache REAL do GitHub.
// O job `setup-bun-warm` do benchmark-scheduled.yml roda `bench-setup-bun.sh`
// (cold→warm: run #1 = cache frio, run #2 = cache quente) e salva o JSON de
// medição. Este guard lê esse JSON e FALHA se o run WARM (cache quente) levar
// mais que o limiar (default 10s).
//
// POR QUE: se o tier-2 regredir silenciosamente (cache key quebrada, restore
// lento, cache nunca salvo → o warm volta a baixar o release no tier-3), o
// setup-bun continua FUNCIONANDO — só fica mais lento (~5-10s vs ~1-2s). O
// pr-check mede correção, não performance — não percebe a regressão. Este
// guard é a rede de segurança periódica contra a degradação silenciosa do
// tier-2.
//
// Entrada (JSON do bench-setup-bun.sh com --json):
//   {
//     "repo": "owner/repo",
//     "ref": "main",
//     "bun_version": "1.3.14",
//     "runs": [
//       { "run": 1, "duration_s": 9.8,  "tier": "tier-3 (cold download)", "conclusion": "success", "run_id": "..." },
//       { "run": 2, "duration_s": 1.25, "tier": "tier-2 (cache hit)",     "conclusion": "success", "run_id": "..." }
//     ]
//   }
//
// O run WARM é o ÚLTIMO do array: no ciclo --runs 2 é o run #2; com
// --runs N é o run N — o mais cacheado (estado steady-state), que é o
// número representativo do tier-2 em produção.
//
// Usage:
//   node scripts/check-setup-bun-warm.mjs --json /tmp/bench.json
//   node scripts/check-setup-bun-warm.mjs --json /tmp/bench.json --max 5
//
// Exit codes:
//   0 — warm cache dentro do limiar (PASS)
//   1 — regressão do tier-2: warm > limiar, ou warm run não concluiu com
//       success, ou sem run warm (JSON inválido/insuficiente)
//   2 — uso inválido (--json ausente / arquivo não lê / JSON malformado)
// =============================================================================

import { readFileSync, existsSync } from "node:fs"

/** Limiar padrão do warm cache (segundos) — o esperado é ~1-2s. */
export const DEFAULT_WARM_MAX_S = 10

/**
 * Extrai o run WARM (o último do array) de um JSON de medição do
 * bench-setup-bun.sh. Retorna null se o JSON não tiver um array `runs`
 * com ao menos 2 entradas (ciclo cold→warm) ou se o último run não
 * tiver duração.
 *
 * @param {any} data
 * @returns {{ run: number, duration_s: number|null, tier: string, conclusion: string, run_id: string }|null}
 */
export function extractWarmRun(data) {
  if (!data || !Array.isArray(data.runs) || data.runs.length < 2) return null
  const warm = data.runs[data.runs.length - 1]
  if (!warm || typeof warm.duration_s !== "number" || !Number.isFinite(warm.duration_s)) {
    return null
  }
  return warm
}

/**
 * Valida o warm cache contra o limiar. Retorna lista de violações
 * (vazia = PASS).
 *
 * @param {any} data            JSON de medição do bench-setup-bun.sh
 * @param {number} maxS         limiar em segundos (default 10)
 * @returns {string[]}
 */
export function checkWarmCache(data, maxS = DEFAULT_WARM_MAX_S) {
  const warm = extractWarmRun(data)
  if (!warm) {
    return [
      "sem run WARM válido no JSON de medição (esperado array runs com ao menos 2 entradas, última com duration_s numérica)",
    ]
  }
  if (warm.conclusion !== "success") {
    return [`run WARM não concluiu com success (conclusion=${warm.conclusion}, run=${warm.run_id})`]
  }
  if (warm.duration_s > maxS) {
    return [
      `regressão do tier-2: warm cache = ${warm.duration_s}s > limiar ${maxS}s ` +
        `(esperado ~1-2s com cache REAL do GitHub; >${maxS}s sugere que o warm voltou a baixar no tier-3)`,
    ]
  }
  return []
}

// ── modo CLI (consumido pelo benchmark-scheduled.yml) ─────────────────────────
// Só executa quando invocado diretamente (não quando importado pelo teste).
const isMain =
  !!process.argv[1] && process.argv[1].split(/[\\/]/).pop() === "check-setup-bun-warm.mjs"

if (isMain) {
  const args = process.argv.slice(2)
  let jsonPath = ""
  let maxS = DEFAULT_WARM_MAX_S

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--json") jsonPath = args[i + 1] || ""
    if (args[i] === "--max") maxS = Number(args[i + 1] || DEFAULT_WARM_MAX_S)
  }

  if (!jsonPath) {
    console.error("check-setup-bun-warm: uso inválido — falta --json <arquivo>")
    console.error("  Uso: node scripts/check-setup-bun-warm.mjs --json FILE [--max S]")
    process.exit(2)
  }
  if (!existsSync(jsonPath)) {
    console.error(`check-setup-bun-warm: arquivo não encontrado: ${jsonPath}`)
    process.exit(2)
  }

  let data
  try {
    data = JSON.parse(readFileSync(jsonPath, "utf8"))
  } catch (err) {
    console.error(`check-setup-bun-warm: JSON inválido em ${jsonPath} — ${err.message}`)
    process.exit(2)
  }

  const violations = checkWarmCache(data, maxS)
  if (violations.length > 0) {
    for (const v of violations) console.error(`check-setup-bun-warm: ❌ ${v}`)
    process.exit(1)
  }

  const warm = extractWarmRun(data)
  console.log(
    `check-setup-bun-warm: ✅ warm cache ${warm.duration_s}s <= ${maxS}s ` +
      `(${warm.tier}, run=${warm.run_id})`,
  )
  process.exit(0)
}
