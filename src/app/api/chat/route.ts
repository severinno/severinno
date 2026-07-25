import { NextRequest, NextResponse } from "next/server";
import ZAI from "z-ai-web-dev-sdk";
import { logger } from "@/lib/logger";

/**
 * POST /api/chat
 *
 * AI assistant for the Severinno Marketplace.
 * Uses z-ai-web-dev-sdk LLM to help users find services, answer questions,
 * and guide them through the platform.
 *
 * Body: { message: string, history?: Array<{role: string, content: string}> }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const message = body.message as string | undefined;
    const history = body.history as Array<{ role: string; content: string }> | undefined;

    if (!message?.trim()) {
      return NextResponse.json({ error: "Mensagem é obrigatória." }, { status: 400 });
    }

    // Limit history to last 10 messages to keep context manageable
    const trimmedHistory = (history ?? []).slice(-10);

    const systemPrompt = `Você é o assistente virtual do Severinno Marketplace, uma plataforma brasileira de serviços verificados com geolocalização.

Seu papel é:
1. Ajudar usuários a encontrar prestadores de serviço adequados (encanador, eletricista, pintor, etc.)
2. Explicar como funciona a plataforma (cadastro, orçamento, agendamento, pagamento)
3. Esclarecer dúvidas sobre segurança, verificações e garantias
4. Sugerir categorias de serviços baseado na necessidade do usuário
5. Orientar sobre preços médios e como solicitar orçamento

Regras:
- Responda sempre em português brasileiro, de forma amigável e profissional
- Seja conciso mas útil (máximo 3-4 parágrafos)
- Se não souber algo específico, sugira que o usuário explore a plataforma ou entre em contato com o suporte
- Use emojis moderadamente para tornar a conversa mais amigável
- Nunca invente preços exatos — sugira sempre que o usuário peça orçamento
- Destaque que os prestadores são verificados e as avaliações são reais

Categorias disponíveis: Alvenaria, Elétrica, Hidráulica, Pintura, Pisos, Pós-Obra, Residencial
Serviços populares: Encanador, Eletricista, Pintor, Diarista, Pedreiro, Jardineiro`;

    const zai = await ZAI.create();

    const messages = [
      { role: "assistant" as const, content: systemPrompt },
      ...trimmedHistory.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
      { role: "user" as const, content: message },
    ];

    const completion = await zai.chat.completions.create({
      messages,
      thinking: { type: "disabled" },
    });

    const response = completion.choices[0]?.message?.content;

    if (!response) {
      return NextResponse.json({ error: "Sem resposta do assistente." }, { status: 500 });
    }

    return NextResponse.json({ response });
  } catch (err) {
    logger.error("POST /api/chat failed", undefined, err);
    return NextResponse.json({ error: "Erro interno. Tente novamente." }, { status: 500 });
  }
}
