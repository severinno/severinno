// =============================================================================
// check-setup-bun-common.mjs — helpers compartilhados dos guards de tier do
// setup-bun (check-tier1-fastpath.mjs e check-tier2-cache-restore.mjs).
//
// POR QUE EXISTE: a extração de duração de uma linha de log do act
// ([461.9667ms] / [10.9823953s] / [589.4µs]) é lógica não-trivial usada por
// TODOS os guards de tier. Centralizar aqui evita o drift de regras de parse
// entre os guards (cultura do repo: helpers compartilhados — ex.:
// scripts/seed-e2e-common.ts, scripts/run-encoding-guards.sh).
//
// Os guards re-exportam os helpers que usam (ex.: o tier-1 exporta
// extractDurationFromLine para manter o contrato público existente e o seu
// teste unitário), então a fonte única fica aqui sem quebrar importações.
//
// Usage:
//   NÃO é um CLI — módulo importado pelos guards de tier:
//     - scripts/check-tier1-fastpath.mjs
//     - scripts/check-tier2-cache-restore.mjs
//   Os testes unitários importam as funções puras diretamente
//   (src/lib/__tests__/check-tier1-fastpath.test.ts e
//   src/lib/__tests__/check-tier2-cache-restore.test.ts).
//
// Exit codes:
//   N/A — módulo sem entry point próprio; os exit codes pertencem aos
//   guards que o importam (0 = pass, 1 = fail, 2 = usage/infra).
// =============================================================================

/**
 * Converte a duração `[461.9667ms]` / `[10.9823953s]` / `[589.4µs]` de uma
 * linha de log do act para segundos. Retorna null se a linha não tiver
 * duração com uma das unidades suportadas.
 */
export function extractDurationFromLine(line) {
  const m = String(line).match(/\[([\d.]+)(ms|µs|s)\]/)
  if (!m) return null
  const value = parseFloat(m[1])
  if (!Number.isFinite(value)) return null
  switch (m[2]) {
    case "ms":
      return value / 1000
    case "µs":
      return value / 1_000_000
    default:
      return value
  }
}
