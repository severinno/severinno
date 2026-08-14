import logger from "@/lib/logger"

const aiLogger = logger.child({ module: "ai-client" })

function getLocalAiUrl(): string {
  return process.env.LOCALAI_URL || "http://localhost:8081/v1"
}

export type ChatMessage = {
  role: "system" | "user" | "assistant"
  content: string
}

export type ChatCompletionResponse = {
  id: string
  choices: Array<{
    message: {
      role: string
      content: string
    }
    finish_reason: string
  }>
}

/**
 * Check if LocalAI service is online and ready.
 */
export async function isLocalAiOnline(): Promise<boolean> {
  const baseUrl = getLocalAiUrl().replace(/\/v1$/, "")
  try {
    const res = await fetch(`${baseUrl}/readyz`, {
      method: "GET",
      signal: AbortSignal.timeout(2000),
    })
    return res.ok
  } catch {
    return false
  }
}

/**
 * Call LocalAI chat completions with Llama 3.1 8B (OpenAI compatible).
 */
export async function chatCompletion(
  messages: ChatMessage[],
  model = "llama-3.1-8b-instruct",
): Promise<string | null> {
  const url = `${getLocalAiUrl()}/chat/completions`

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.2,
        max_tokens: 600,
      }),
      signal: AbortSignal.timeout(30_000),
    })

    if (!res.ok) {
      aiLogger.warn({ status: res.status }, "LocalAI error response")
      return null
    }

    const data = (await res.json()) as ChatCompletionResponse
    return data.choices?.[0]?.message?.content ?? null
  } catch (err) {
    aiLogger.warn({ err: (err as Error).message }, "LocalAI request failed")
    return null
  }
}
