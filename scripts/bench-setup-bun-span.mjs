#!/usr/bin/env node

// =============================================================================
// bench-setup-bun-span.mjs
//
// Lógica PURA de medição do span do step ./.github/actions/setup-bun a partir
// da jobs API do GitHub (repos/<owner>/<repo>/actions/runs/<id>/jobs).
//
// WHY: a lógica vivia inline no bench-setup-bun.sh (grep/cut + node -e), o que
// a tornava impossível de testar sem rede. Este módulo extrai a medição em
// funções puras — testadas em src/lib/__tests__/bench-setup-bun-span.test.ts —
// e expõe um modo CLI (stdin = array JSON de steps) que o .sh consome.
//
// CONTRATO de medição (fixes do review travados em teste):
//   1. Steps SKIPPED têm started_at/completed_at NULOS na jobs API — filtrar
//      com status == "completed" evita NaN no run cold (ex.: "Add cached Bun
//      to PATH" é skipped quando cache-hit != true).
//   2. O "tempo do setup-bun" é o span do 1º ao último sub-step RODADO do
//      action (started_at do 1º → completed_at do último), com precisão de ms
//      e saída em segundos com 2 decimais.
//   3. Sem steps relevantes rodados → span null (o caller reporta erro em vez
//      de imprimir NaN/N/A).
//
// Usage:
//   gh api "repos/$GH_REPO/actions/runs/$run_id/jobs" \
//     --jq '.jobs[0].steps' | node scripts/bench-setup-bun-span.mjs
//   → imprime o span em segundos (ex.: "9.80") ou sai com exit 1.
//
// Exit codes:
//   0 — span calculado e impresso em stdout
//   1 — sem steps relevantes rodados / timestamps ausentes / JSON inválido
// =============================================================================

/** Shape de um sub-step da jobs API (repos/<owner>/<repo>/actions/runs/<id>/jobs → .jobs[0].steps). */
/** @typedef {{ name?: string, status?: string, started_at?: string|null, completed_at?: string|null }} SetupBunStep */

/** Nomes de sub-steps do composite action que delimitam o span medido. */
export const SPAN_STEP_RE = /Bun version|pre-installed Bun|Bun release|bunx symlink|cached Bun/

/**
 * Filtra apenas steps RODADOS (status == "completed") — skipped têm null timestamps.
 * @param {SetupBunStep[]|undefined} steps
 * @returns {SetupBunStep[]}
 */
export function completedSteps(steps) {
  return (steps || []).filter((s) => s && s.status === "completed")
}

/**
 * Steps relevantes (nome casa SPAN_STEP_RE) dentre os completados, na ordem da API.
 * @param {SetupBunStep[]|undefined} steps
 * @returns {SetupBunStep[]}
 */
export function relevantSteps(steps) {
  return completedSteps(steps).filter((s) => SPAN_STEP_RE.test(s.name || ""))
}

/**
 * Span do setup-bun em segundos (2 decimais): started_at do 1º sub-step
 * relevante → completed_at do último, todos RODADOS. Retorna null quando não
 * há steps relevantes rodados ou quando um timestamp está ausente/vazio
 * (evita NaN — new Date("") = NaN).
 *
 * @param {SetupBunStep[]|undefined} steps
 * @returns {string|null} "9.80" (2 decimais) ou null
 */
export function computeSetupBunSpan(steps) {
  const rel = relevantSteps(steps)
  if (rel.length === 0) return null
  const startIso = rel[0].started_at
  const endIso = rel[rel.length - 1].completed_at
  if (!startIso || !endIso) return null
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime()
  if (Number.isNaN(ms)) return null
  // Timestamps fora de ordem (end < start, ex.: relógio do runner) — nunca
  // imprimir -5.00 na tabela comparativa; reportar como span inválido.
  if (ms < 0) return null
  return (ms / 1000).toFixed(2)
}

// ── modo CLI (consumido pelo bench-setup-bun.sh) ─────────────────────────────
// Só executa quando invocado diretamente (não quando importado pelo teste).
// Comparação por BASENAME — imune a separador de caminho (Windows \ vs POSIX
// /) e a argv[1] absoluto vs relativo (a comparação `fileURLToPath(import.meta.url)
// === argv[1]` falharia silenciosamente no Windows/Git Bash por causa da
// conversão MSYS de caminhos — o basename não sofre disso).
const isMain =
  !!process.argv[1] && process.argv[1].split(/[\\/]/).pop() === "bench-setup-bun-span.mjs"

if (isMain) {
  let input = ""
  process.stdin.setEncoding("utf8")
  process.stdin.on("data", (chunk) => {
    input += chunk
  })
  process.stdin.on("end", () => {
    try {
      const steps = JSON.parse(input || "[]")
      const span = computeSetupBunSpan(steps)
      if (span === null) {
        console.error(
          "bench-setup-bun-span: nenhum sub-step relevante RODADO (status=completed) encontrado — span null",
        )
        process.exit(1)
      }
      process.stdout.write(span + "\n")
    } catch (err) {
      console.error(`bench-setup-bun-span: JSON inválido no stdin — ${err.message}`)
      process.exit(1)
    }
  })
}
