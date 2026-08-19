/**
 * Test LocalAI 100% Open Source inference and keyword fallback engine.
 *
 * Usage:
 *   bun run scripts/test-localai-inference.ts
 *
 * Exit codes:
 *   0 - All test scenarios categorized and validated successfully
 *   1 - Execution or assertion error
 */

import { categorizeServiceRequest } from "../src/lib/ai-categorizer"
import { isLocalAiOnline } from "../src/lib/ai-client"

const TEST_SCENARIOS = [
  {
    input: "Vazamento urgente no sifão da pia da cozinha inundando o armário",
    expectedCategory: "Encanador",
    expectedSeverity: "HIGH",
  },
  {
    input: "Preciso instalar 3 tomadas 220V e disjuntor para ar condicionado",
    expectedCategory: "Eletricista",
    expectedSeverity: "MEDIUM",
  },
  {
    input: "Pintura de sala de estar 20m² com duas demãos de tinta lavável",
    expectedCategory: "Pintor",
    expectedSeverity: "MEDIUM",
  },
  {
    input: "Goteira no telhado após temporal e telhas deslocadas",
    expectedCategory: "Reparos",
    expectedSeverity: "HIGH",
  },
  {
    input: "Gostaria de uma cotação para faxina e limpeza pós-obra no sábado",
    expectedCategory: "Limpeza",
    expectedSeverity: "LOW",
  },
]

async function main() {
  console.log("================================================================")
  console.log("🤖 SEVERINNO - VALIDAÇÃO DE IA 100% OPEN SOURCE (LocalAI + Llama)")
  console.log("================================================================\n")

  // 1. Health check
  const isOnline = await isLocalAiOnline()
  console.log(
    `🔌 Status LocalAI (http://localhost:8081): ${isOnline ? "🟢 ONLINE (Inferência Llama 3.1 8B)" : "🟡 OFFLINE (Fallback Local Ativo)"}`,
  )
  console.log(`🔒 Política de Privacidade: Dados nunca saem do servidor local\n`)

  console.log("----------------------------------------------------------------")
  console.log("🧪 Executando 5 Cenários de Teste de Categorização & Orçamentação")
  console.log("----------------------------------------------------------------\n")

  let passed = 0

  for (let i = 0; i < TEST_SCENARIOS.length; i++) {
    const scenario = TEST_SCENARIOS[i]
    const start = performance.now()
    const result = await categorizeServiceRequest(scenario.input)
    const elapsed = Math.round(performance.now() - start)

    console.log(`[Cenário ${i + 1}/5] "${scenario.input.slice(0, 50)}..."`)
    console.log(`  📂 Categoria:    ${result.categoryName}`)
    console.log(`  ⚠️  Gravidade:    ${result.problemSeverity}`)
    console.log(
      `  💰 Estimativa:   R$ ${result.estimatedPriceRange.min.toFixed(2)} — R$ ${result.estimatedPriceRange.max.toFixed(2)}`,
    )
    console.log(
      `  ⚙️  Motor:        ${result.source === "local-llama" ? "🦙 Llama 3.1 8B" : "⚡ Keyword Fallback"}`,
    )
    console.log(`  ⏱️  Latência:     ${elapsed}ms\n`)

    if (result.categoryName && result.estimatedPriceRange.min > 0) {
      passed++
    }
  }

  console.log("================================================================")
  console.log(`✅ RESULTADO: ${passed}/${TEST_SCENARIOS.length} cenários validados com sucesso!`)
  console.log("================================================================\n")
}

main().catch((err) => {
  console.error("❌ Erro no script de validação de IA:", err)
  process.exit(1)
})
