#!/usr/bin/env node
// Usage: node scripts/validate-gist-model.mjs [--benchmark <path>]
// Exit code: 0 = success, 1 = validation error

/**
 * validate-gist-model.mjs
 *
 * Valida o modelo linear GiST contra as medições reais do
 * geo-benchmark.json, calculando métricas de erro:
 *   - RMSE (Root Mean Squared Error)
 *   - MAE  (Mean Absolute Error)
 *   - MAPE (Mean Absolute Percentage Error)
 *   - Erro sistemático (bias = média dos resíduos)
 *
 * Uso:
 *   node scripts/validate-gist-model.mjs
 *   node scripts/validate-gist-model.mjs --benchmark docs/benchmarks/geo-real-postgis.json
 *
 * O modelo: T(N) = (FIXED_US + PER_ROW_US × N) / 1000   (ms)
 *   FIXED_US    = 2000  µs  (overhead TCP + query parsing/plan)
 *   PER_ROW_US  = 22    µs  (ST_DWithin + ST_Distance por linha)
 *   N           = número de providers no full scan
 *
 * As medições reais vêm dos benchmarks "postgis_model_*" no
 * geo-benchmark.json. Cada provider count (100, 1000, 10000) tem
 * uma entrada com { mean, min, max } em microssegundos.
 */

// ===========================================================================
// Model constants (mirrors src/lib/geo-benchmark-model.ts)
// ===========================================================================

import { readFileSync } from "node:fs"

const POSTGIS_FIXED_US = 2000
const POSTGIS_PER_ROW_US = 22
const PROVIDER_COUNTS = [100, 500, 1000, 5000, 10000]

/** Modelo: T(N) em ms para full scan (s=1.0). */
function modelPostGISFullMs(n) {
  return (POSTGIS_FIXED_US + POSTGIS_PER_ROW_US * n) / 1000
}

// ===========================================================================
// Parsing helpers
// ===========================================================================

/** Carrega e parseia o JSON de benchmark do caminho especificado. */
function loadBenchmark(filePath) {
  const raw = readFileSync(filePath, "utf-8")
  return JSON.parse(raw)
}

/** Converte µs em ms, arredondando para 1 decimal (mesmo padrão do dashboard). */
function usToMs(us) {
  return Math.round((us / 1000) * 10) / 10
}

// ===========================================================================
// RMSE computation
// ===========================================================================

/**
 * Computa métricas de erro entre modelo e medição.
 *
 * @param {Array<{ n: number, measuredMs: number }>} points
 * @returns {{ rmse: number, mae: number, mape: number, bias: number, n: number, residuals: Array<{ n: number, modelMs: number, measuredMs: number, residualMs: number, pctErr: number }> }}
 */
function computeMetrics(points) {
  const residuals = points.map((p) => {
    const modelMs = modelPostGISFullMs(p.n)
    const residualMs = p.measuredMs - modelMs
    const pctErr = modelMs > 0 ? (residualMs / modelMs) * 100 : 0
    return {
      n: p.n,
      modelMs: +modelMs.toFixed(3),
      measuredMs: p.measuredMs,
      residualMs: +residualMs.toFixed(3),
      pctErr: +pctErr.toFixed(1),
    }
  })

  const n = residuals.length
  if (n === 0) return { rmse: 0, mae: 0, mape: 0, bias: 0, n: 0, residuals: [] }

  const sumSq = residuals.reduce((a, r) => a + r.residualMs ** 2, 0)
  const sumAbs = residuals.reduce((a, r) => a + Math.abs(r.residualMs), 0)
  const sumAbsPct = residuals.reduce(
    (a, r) => a + Math.abs(r.measuredMs > 0 ? (r.residualMs / r.measuredMs) * 100 : 0),
    0,
  )
  const sumResidual = residuals.reduce((a, r) => a + r.residualMs, 0)

  return {
    rmse: +Math.sqrt(sumSq / n).toFixed(3),
    mae: +(sumAbs / n).toFixed(3),
    mape: +(sumAbsPct / n).toFixed(2),
    bias: +(sumResidual / n).toFixed(3),
    n,
    residuals,
  }
}

// ===========================================================================
// Reporting
// ===========================================================================

function formatMs(ms) {
  if (Math.abs(ms) < 0.01) return `${ms.toFixed(3)}ms`
  if (Math.abs(ms) < 1) return `${ms.toFixed(2)}ms`
  return `${ms.toFixed(1)}ms`
}

function printReport(metrics, meta) {
  const { residuals, rmse, mae, mape, bias, n } = metrics

  console.log("")
  console.log("╔══════════════════════════════════════════════════════════════╗")
  console.log("║     Validação do Modelo GiST — Dados Reais                 ║")
  console.log("╚══════════════════════════════════════════════════════════════╝")
  console.log("")

  if (meta) {
    console.log(`  Plataforma : ${meta.platform} ${meta.arch}`)
    console.log(`  Node.js    : ${meta.nodeVersion}`)
    console.log(`  Timestamp  : ${meta.timestamp}`)
    console.log(`  Centro     : ${meta.centerLabel}`)
    console.log("")
  }

  console.log("  Constantes do modelo:")
  console.log(`    POSTGIS_FIXED_US   = ${POSTGIS_FIXED_US} µs`)
  console.log(`    POSTGIS_PER_ROW_US = ${POSTGIS_PER_ROW_US} µs`)
  console.log(`    T(N) = (${POSTGIS_FIXED_US} + ${POSTGIS_PER_ROW_US} × N) / 1000 ms`)
  console.log("")

  console.log("  ┌────────────┬────────────┬────────────┬────────────┬────────────┐")
  console.log("  │ Providers  │  Modelo    │  Medido    │  Resíduo   │  Erro %    │")
  console.log("  ├────────────┼────────────┼────────────┼────────────┼────────────┤")

  for (const r of residuals) {
    const nStr = String(r.n).padStart(8)
    const modelStr = formatMs(r.modelMs).padStart(10)
    const measStr = formatMs(r.measuredMs).padStart(10)
    const resStr = (r.residualMs >= 0 ? "+" : "") + formatMs(r.residualMs)
    const resPadded = resStr.padStart(10)
    const pctStr = `${r.pctErr >= 0 ? "+" : ""}${r.pctErr}%`
    const pctPadded = pctStr.padStart(10)

    const marker = Math.abs(r.pctErr) > 20 ? " ⚠" : "   "
    console.log(`  │ ${nStr} │ ${modelStr} │ ${measStr} │ ${resPadded} │ ${pctPadded}${marker} │`)
  }

  console.log("  └────────────┴────────────┴────────────┴────────────┴────────────┘")
  console.log("")

  const rmseColor = rmse > 50 ? "\x1b[31m" : rmse > 10 ? "\x1b[33m" : "\x1b[32m"
  const mapeColor = mape > 20 ? "\x1b[31m" : mape > 5 ? "\x1b[33m" : "\x1b[32m"
  const biasColor = Math.abs(bias) > 10 ? "\x1b[31m" : Math.abs(bias) > 2 ? "\x1b[33m" : "\x1b[32m"

  console.log(`  Métricas Agregadas (${n} pontos):`)
  console.log(`    RMSE  : ${rmseColor}${rmse.toFixed(2)}ms\x1b[0m    (Root Mean Squared Error)`)
  console.log(`    MAE   : ${mae.toFixed(2)}ms    (Mean Absolute Error)`)
  console.log(
    `    MAPE  : ${mapeColor}${mape.toFixed(1)}%\x1b[0m      (Mean Absolute Percentage Error)`,
  )
  console.log(
    `    Bias  : ${biasColor}${bias >= 0 ? "+" : ""}${bias.toFixed(2)}ms\x1b[0m   (Erro sistemático — média dos resíduos)`,
  )
  console.log("")

  // Interpretation
  console.log("  Interpretação:")
  if (Math.abs(bias) < mae * 0.3) {
    console.log("    ✅ Os erros são bem distribuídos (pouco bias sistemático).")
  } else if (bias > 0) {
    console.log("    ⚠️  O modelo SUBestima sistematicamente (bias positivo = real > modelo).")
    console.log("        Considere aumentar POSTGIS_FIXED_US ou POSTGIS_PER_ROW_US.")
  } else {
    console.log("    ⚠️  O modelo SUPERestima sistematicamente (bias negativo = real < modelo).")
    console.log("        Considere reduzir POSTGIS_FIXED_US ou POSTGIS_PER_ROW_US.")
  }

  if (mape > 20) {
    console.log("    ⚠️  MAPE > 20%: o modelo tem baixa precisão para os dados atuais.")
    console.log("        Recalibre as constantes com base nas medições mais recentes.")
  } else if (mape > 5) {
    console.log("    ⚡ MAPE entre 5% e 20%: precisão moderada.")
    console.log("        Pode ser aceitável para estimativas de ordem de grandeza.")
  } else {
    console.log("    ✅ MAPE < 5%: excelente aderência do modelo aos dados reais.")
  }

  console.log("")
}

// ===========================================================================
// Main
// ===========================================================================

async function main() {
  const args = process.argv.slice(2)
  const benchIdx = args.indexOf("--benchmark")
  const filePath =
    benchIdx >= 0 && benchIdx + 1 < args.length
      ? args[benchIdx + 1]
      : "docs/benchmarks/geo-benchmark.json"

  let data
  try {
    data = await loadBenchmark(filePath)
  } catch (err) {
    console.error(`❌ Erro ao ler ${filePath}: ${err.message}`)
    process.exit(1)
  }

  const benchmarks = data.benchmarks ?? []
  const meta = data.meta ?? null

  // Extrai as medições PostGIS reais (postgis_model_*)
  const points = PROVIDER_COUNTS.map((n) => {
    const label = `postgis_model_${n}`
    const entry = benchmarks.find((b) => b.label === label)
    if (!entry) return null

    return {
      n,
      measuredMs: usToMs(entry.mean),
      measuredMinMs: usToMs(entry.min),
      measuredMaxMs: usToMs(entry.max),
    }
  }).filter(Boolean)

  if (points.length === 0) {
    console.error("❌ Nenhum benchmark postgis_model_* encontrado no arquivo.")
    console.error("   Esperava encontrar labels: postgis_model_100, postgis_model_1000, ...")
    console.error(`   Labels disponíveis: ${benchmarks.map((b) => b.label).join(", ")}`)
    process.exit(1)
  }

  // Report missing provider counts
  const missingCounts = PROVIDER_COUNTS.filter(
    (n) => !benchmarks.find((b) => b.label === `postgis_model_${n}`),
  )
  if (missingCounts.length > 0) {
    console.log(`  ℹ️  Aviso: ${missingCounts.length} escala(s) sem medição:`)
    for (const n of missingCounts) {
      console.log(`       postgis_model_${n} — não encontrado no benchmark`)
    }
    console.log("")
  }

  const metrics = computeMetrics(points)
  printReport(metrics, meta)
}

main().catch((err) => {
  console.error("Erro fatal:", err)
  process.exit(1)
})
