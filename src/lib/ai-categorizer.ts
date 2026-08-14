import { db } from "@/lib/db"
import { chatCompletion, isLocalAiOnline } from "@/lib/ai-client"
import logger from "@/lib/logger"

const aiLogger = logger.child({ module: "ai-categorizer" })

export type AiCategorizationResult = {
  categoryId?: string
  categoryName: string
  suggestedTitle: string
  problemSeverity: "LOW" | "MEDIUM" | "HIGH"
  estimatedPriceRange: {
    min: number
    max: number
  }
  suggestedDescription: string
  confidenceScore: number
  source: "local-llama" | "keyword-fallback"
}

/**
 * Categorize a client service request using LocalAI + Llama 3.1 8B,
 * with graceful database keyword fallback.
 */
export async function categorizeServiceRequest(
  description: string,
): Promise<AiCategorizationResult> {
  // 1. Fetch available platform subcategories for context
  const categories = await db.category.findMany({
    where: { active: true, level: { in: [1, 2] } },
    select: { id: true, name: true, slug: true },
    take: 30,
  })

  const categoryNames = categories.map((c) => c.name).join(", ")

  // 2. Check if LocalAI is reachable
  const online = await isLocalAiOnline()

  if (online) {
    const prompt = `Você é o assistente inteligente do Severinno Marketplace de Serviços Residenciais e Comerciais no Brasil.
Analise o pedido do cliente e categorize no formato JSON estrito.

Categorias disponíveis:
${categoryNames}

Pedido do cliente:
"${description}"

Responda APENAS um objeto JSON com o seguinte formato, sem texto adicional:
{
  "categoryName": "nome exato de uma das categorias acima",
  "suggestedTitle": "Título claro e conciso para o serviço",
  "problemSeverity": "LOW" | "MEDIUM" | "HIGH",
  "estimatedMinPrice": 100,
  "estimatedMaxPrice": 300,
  "suggestedDescription": "Descrição técnica formatada e clara para o prestador",
  "confidence": 0.95
}`

    try {
      const reply = await chatCompletion([
        {
          role: "system",
          content: "Você é um assistente de orçamentos que responde apenas JSON válido.",
        },
        { role: "user", content: prompt },
      ])

      if (reply) {
        // Extract JSON from reply
        const jsonMatch = reply.match(/\{[\s\S]*\}/)
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0])
          const matchedCategory = categories.find(
            (c) =>
              c.name.toLowerCase() === String(parsed.categoryName || "").toLowerCase() ||
              description.toLowerCase().includes(c.name.toLowerCase()),
          )

          return {
            categoryId: matchedCategory?.id,
            categoryName: matchedCategory?.name || parsed.categoryName || "Serviços Gerais",
            suggestedTitle: parsed.suggestedTitle || "Solicitação de Serviço",
            problemSeverity: ["LOW", "MEDIUM", "HIGH"].includes(parsed.problemSeverity)
              ? parsed.problemSeverity
              : "MEDIUM",
            estimatedPriceRange: {
              min: Number(parsed.estimatedMinPrice) || 80,
              max: Number(parsed.estimatedMaxPrice) || 250,
            },
            suggestedDescription: parsed.suggestedDescription || description,
            confidenceScore: Number(parsed.confidence) || 0.9,
            source: "local-llama",
          }
        }
      }
    } catch (e) {
      aiLogger.warn({ err: (e as Error).message }, "Llama parsing failed, using fallback")
    }
  }

  // 3. Fallback: Intelligent Keyword Matching
  const lowerDesc = description.toLowerCase()
  let matchedCat = categories[0]
  let maxScore = 0

  for (const cat of categories) {
    const catNameLower = cat.name.toLowerCase()
    if (lowerDesc.includes(catNameLower)) {
      matchedCat = cat
      maxScore = 0.8
      break
    }
  }

  // Severity heuristic
  const isHigh = /urgente|vazando|curto|queimou|inundando|fogo|choque|emergência/i.test(lowerDesc)
  const isLow = /orçamento|ideia|quando puder|planejar|cotação/i.test(lowerDesc)
  const severity = isHigh ? "HIGH" : isLow ? "LOW" : "MEDIUM"

  return {
    categoryId: matchedCat?.id,
    categoryName: matchedCat?.name || "Serviços Gerais",
    suggestedTitle: `Reparo/Serviço de ${matchedCat?.name || "Geral"}`,
    problemSeverity: severity,
    estimatedPriceRange: {
      min: severity === "HIGH" ? 120 : 80,
      max: severity === "HIGH" ? 350 : 200,
    },
    suggestedDescription: description.trim(),
    confidenceScore: maxScore || 0.6,
    source: "keyword-fallback",
  }
}
