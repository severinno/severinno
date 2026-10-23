import "server-only"

/**
 * whatsapp-ai-triage.ts — Triagem Inteligente de WhatsApp com IA Híbrida
 *
 * Conecta o webhook da Evolution API (/api/webhooks/evolution) ao ai-client.ts,
 * utilizando arquitetura de 3 camadas:
 *   1. Nuvem Primária / Cache Semântico: Groq Cloud (Llama 3.3 / LPU) & Redis (< 300ms)
 *   2. IA Local Secundária na VPS: Ollama local (qwen2.5:0.5b / llama3.2:3b)
 *   3. Heurística Determinística de Domínio: Classificador baseado em regras locais
 *
 * Funcionalidades:
 *   - Autoatendimento Automatizado e empático para clientes em Governador Valadares
 *   - Classificação de intenções (busca de serviço, orçamento, status, escrow, suporte, FAQ)
 *   - Extração estruturada de entidades (categoria, bairro de GV, urgência)
 *   - Proteção anti-loop, cooldown por telefone e preservação de diálogo direto (cliente-prestador)
 *   - Integração assíncrona via RabbitMQ (`enqueueWhatsApp`)
 */

import { chatCompletionHybrid, type ChatMessage } from "@/lib/ai-client"
import { enqueueWhatsApp } from "@/lib/whatsapp-queue"
import { db } from "@/lib/db"
import logger from "@/lib/logger"
import { cacheGet, cacheSet } from "@/lib/redis"
import { extractGvNeighborhood } from "@/lib/whatsapp-autoresponder"

const triageLogger = logger.child({ module: "whatsapp-ai-triage" })

export type TriageIntent =
  | "SERVICE_SEARCH" // Cliente buscando profissional / especialidade
  | "QUOTE_ESTIMATION" // Cliente quer estimativa de preço ou pedir orçamento
  | "STATUS_INQUIRY" // Cliente perguntando sobre status de serviço ou agendamento
  | "ESCROW_PAYMENT" // Dúvidas sobre pagamento, segurança, PIX ou custódia
  | "SUPPORT_COMPLAINT" // Reclamação, insatisfação ou pedido de atendente humano
  | "PLATFORM_INFO" // Dúvidas sobre o funcionamento do marketplace Severinno
  | "DIRECT_INTERACTION" // Mensagem operacional direta entre cliente e prestador (não interceptar)
  | "UNKNOWN"

export interface StructuredAiTriage {
  intent: TriageIntent
  category?: string | null
  neighborhood?: string | null
  urgency: "NORMAL" | "HIGH" | "EMERGENCY"
  confidence: number
  explanation?: string
  suggestedReply?: string | null
}

export interface AiTriageContext {
  phone: string
  text: string
  user: {
    id: string
    name: string | null
    role?: string | null
  } | null
  remoteJid?: string
}

export interface AiTriageResult {
  handled: boolean
  replyText?: string
  intent?: TriageIntent
  category?: string | null
  neighborhood?: string | null
  engineUsed?: string
  latencyMs?: number
}

// ---------------------------------------------------------------------------
// Cooldown & Rate Limit Anti-Loop
// ---------------------------------------------------------------------------

const COOLDOWN_SECONDS = 6
const HOURLY_LIMIT = 20

/**
 * Verifica se o número está em cooldown para prevenir loop de respostas automatizadas.
 */
async function isPhoneRateLimited(phone: string): Promise<boolean> {
  const clean = phone.replace(/\D/g, "")
  const cooldownKey = `whatsapp:triage:cd:${clean}`
  const hourlyKey = `whatsapp:triage:count:${clean}`

  try {
    const inCooldown = await cacheGet<string>(cooldownKey)
    if (inCooldown) {
      triageLogger.debug({ phone: clean.slice(0, 4) + "****" }, "Triagem IA suprimida por cooldown")
      return true
    }

    const currentCount = (await cacheGet<number>(hourlyKey)) || 0
    if (currentCount >= HOURLY_LIMIT) {
      triageLogger.warn(
        { phone: clean.slice(0, 4) + "****", currentCount },
        "Triagem IA bloqueada por limite horário",
      )
      return true
    }

    // Registra cooldown e incrementa contador
    await cacheSet(cooldownKey, "1", COOLDOWN_SECONDS)
    await cacheSet(hourlyKey, currentCount + 1, 3600)
    return false
  } catch {
    return false // Fail-open se Redis estiver inacessível
  }
}

// ---------------------------------------------------------------------------
// Heurística de Fallback (Camada 3)
// ---------------------------------------------------------------------------

const SERVICE_PATTERNS: Array<{ category: string; regex: RegExp }> = [
  {
    category: "Eletricista",
    regex:
      /\b(eletric|chuveiro|tomada|disjuntor|fiação|fiacao|curto|sem luz|padrao de energia|lampada|220v|110v)\b/i,
  },
  {
    category: "Encanador",
    regex:
      /\b(encanador|vazamento|pia|cano|torneira|caixa d'agua|esgoto|desentup|infiltracao|valvula|hidraulic)\b/i,
  },
  {
    category: "Pintor",
    regex:
      /\b(pintor|pintura|pintar|tinta|emassar|massa corrida|grafiato|textura|verniz|parede|teto)\b/i,
  },
  {
    category: "Climatização",
    regex:
      /\b(ar[- ]?condicionado|split|climatiz|refrigerac|gas do ar|higienizacao ar|filtro ar)\b/i,
  },
  {
    category: "Diarista & Faxina",
    regex: /\b(faxina|diarista|limpeza|lavar|passar roupa|faxineira|pos obra|limpeza pesada)\b/i,
  },
  {
    category: "Marido de Aluguel",
    regex:
      /\b(marido de aluguel|pequenos reparos|instalar.*suporte|suporte.*tv|furar parede|montar cortina|prateleira)\b/i,
  },
  {
    category: "Montador de Móveis",
    regex: /\b(montador|moveis|armario|guarda roupa|painel de tv|estante|mesa)\b/i,
  },
  {
    category: "Chaveiro",
    regex: /\b(chaveiro|trancad|abrir porta|fechadura|trocar segredo|copia de chave)\b/i,
  },
  {
    category: "Frete & Carreto",
    regex: /\b(frete|carreto|mudanca|transporte|pequena carga)\b/i,
  },
  {
    category: "Pedreiro",
    regex: /\b(pedreiro|reforma|piso|ceramica|porcelanato|reboco|alvenaria|contra piso)\b/i,
  },
]

export function classifyIntentHeuristic(text: string): {
  intent: TriageIntent
  category: string | null
  urgency: "NORMAL" | "HIGH" | "EMERGENCY"
} {
  const norm = text.toLowerCase()

  // 1. Emergência e Urgência
  const isEmergency =
    /\b(urgente|emergencia|socorro|estourou|alagando|inundando|fogo|fumaca|curto-circuito|trancado para fora)\b/i.test(
      norm,
    )
  const urgency = isEmergency ? "EMERGENCY" : "NORMAL"

  // 2. Interação direta entre usuários para agendamento em andamento
  if (
    /\b(ja cheguei|estou descendo|pode subir|abrir o portao|interfone|comprei o material|onde voce ta|to na porta)\b/i.test(
      norm,
    )
  ) {
    return { intent: "DIRECT_INTERACTION", category: null, urgency: "NORMAL" }
  }

  // 3. Status de agendamento
  if (
    /\b(cade o prestador|que horas|quando chega|meu agendamento|status do pedido|meu pedido)\b/i.test(
      norm,
    )
  ) {
    return { intent: "STATUS_INQUIRY", category: null, urgency: "NORMAL" }
  }

  // 4. Pagamento e Escrow
  if (
    /\b(como funciona o pagamento|pix|e seguro|garantia|dinheiro|liberar pagamento|custodia|escrow)\b/i.test(
      norm,
    )
  ) {
    return { intent: "ESCROW_PAYMENT", category: null, urgency: "NORMAL" }
  }

  // 5. Suporte humano e reclamações
  if (
    /\b(falar com pessoa|atendente humano|reclamar|nao gostei|cancelar servico|problema com servico|golpe)\b/i.test(
      norm,
    )
  ) {
    return { intent: "SUPPORT_COMPLAINT", category: null, urgency: "HIGH" }
  }

  // 6. Dúvidas sobre o Severinno
  if (
    /\b(o que e o severinno|como funciona|atendem em valadares|e confiavel|quem sao voces)\b/i.test(
      norm,
    )
  ) {
    return { intent: "PLATFORM_INFO", category: null, urgency: "NORMAL" }
  }

  // 7. Busca de Serviço
  for (const { category, regex } of SERVICE_PATTERNS) {
    if (regex.test(norm)) {
      return { intent: "SERVICE_SEARCH", category, urgency }
    }
  }

  // 8. Orçamento genérico
  if (/\b(orcamento|cotacao|quanto custa|qual o valor|preco|tabela)\b/i.test(norm)) {
    return { intent: "QUOTE_ESTIMATION", category: null, urgency: "NORMAL" }
  }

  return { intent: "UNKNOWN", category: null, urgency: "NORMAL" }
}

// ---------------------------------------------------------------------------
// Prompt do Assistente de Triagem com IA
// ---------------------------------------------------------------------------

const TRIAGE_SYSTEM_PROMPT = `Você é o assistente inteligente de triagem do Severinno Marketplace em Governador Valadares (MG).
Sua missão é entender com precisão a intenção do cliente via WhatsApp e classificar em JSON.

INTENÇÕES PERMITIDAS:
- "SERVICE_SEARCH": Cliente busca profissional ou serviço residencial/comercial.
- "QUOTE_ESTIMATION": Cliente pede orçamento ou estimativa de preço.
- "STATUS_INQUIRY": Cliente pergunta sobre agendamento em andamento ou paradeiro do profissional.
- "ESCROW_PAYMENT": Dúvidas sobre PIX, forma de pagamento, segurança ou garantia de custódia.
- "SUPPORT_COMPLAINT": Reclamação, insatisfação, pedido de cancelamento ou atendente humano.
- "PLATFORM_INFO": Dúvidas sobre o que é o Severinno, cobertura em GV ou como funciona.
- "DIRECT_INTERACTION": Mensagem operacional entre cliente e prestador (ex: "estou no portão", "o interfone é 102").
- "UNKNOWN": Mensagens aleatórias sem sentido claro.

CATEGORIAS PADRONIZADAS DE GV:
"Eletricista", "Encanador", "Pintor", "Climatização", "Diarista & Faxina", "Marido de Aluguel", "Montador de Móveis", "Chaveiro", "Frete & Carreto", "Pedreiro", "Geral".

URGÊNCIAS:
- "EMERGENCY": Vazamentos intensos, sem energia elétrica geral, chaves trancadas para fora, risco.
- "HIGH": Necessidade para hoje ou amanhã cedo.
- "NORMAL": Planejado / orçamentos normais.

Responda ESTRITAMENTE em JSON puro, sem blocos de markdown e sem texto adicional:
{
  "intent": "SERVICE_SEARCH" | "QUOTE_ESTIMATION" | "STATUS_INQUIRY" | "ESCROW_PAYMENT" | "SUPPORT_COMPLAINT" | "PLATFORM_INFO" | "DIRECT_INTERACTION" | "UNKNOWN",
  "category": string ou null,
  "neighborhood": string ou null,
  "urgency": "NORMAL" | "HIGH" | "EMERGENCY",
  "confidence": number entre 0.0 e 1.0,
  "suggestedReply": string concisa em português brasileiro (com emojis e negrito WhatsApp *texto*) ou null se DIRECT_INTERACTION
}`

// ---------------------------------------------------------------------------
// Construtores de Respostas Especializadas
// ---------------------------------------------------------------------------

/**
 * Constrói resposta contextual de busca de serviço com link preditivo e Escrow.
 */
function buildServiceSearchReply(
  category: string,
  neighborhood: string | null,
  urgency: string,
  userName?: string | null,
): string {
  const greeting = userName ? `Olá, *${userName}*!` : "Olá!"
  const neighborhoodStr = neighborhood ? ` na região de *${neighborhood}*` : ""
  const isEmergency = urgency === "EMERGENCY"

  return (
    `🤖 *Severinno Match Inteligente*\n\n` +
    `${greeting} Localizamos profissionais verificados de *${category}*${neighborhoodStr} em Governador Valadares.\n\n` +
    `🛡️ *Pagamento Protegido por Custódia (Escrow):*\n` +
    `Seu dinheiro não vai direto para o profissional. Ele fica retido com segurança na plataforma e só é liberado após o serviço concluído e aprovado por você!\n\n` +
    (isEmergency
      ? `🚨 *Atendimento SOS Emergência 24h Disponível:*\n` +
        `Para socorro imediato:\n` +
        `🔗 https://severinno.com.br/?sos=1\n\n`
      : "") +
    `👉 *Ver profissionais disponíveis e avaliações:*\n` +
    `🔗 https://severinno.com.br/busca?q=${encodeURIComponent(category)}\n\n` +
    `💬 *Quer pedir orçamento agora por aqui mesmo?*\n` +
    `Responda com *ORCAR* para iniciar o pedido direto no WhatsApp! 🚀\n\n` +
    `💡 _Para ver todos os serviços, digite *MENU*._`
  )
}

/**
 * Constrói resposta sobre agendamentos ativos consultando o banco.
 */
async function buildStatusInquiryReply(
  userId: string | undefined,
  userName?: string | null,
): Promise<string> {
  const greeting = userName ? `Olá, *${userName}*!` : "Olá!"

  if (!userId || userId.startsWith("anon-")) {
    return (
      `📋 *Consulta de Agendamento - Severinno*\n\n` +
      `${greeting} Para consultar o status do seu pedido em tempo real, acesse:\n` +
      `🔗 https://severinno.com.br/?view=client.bookings\n\n` +
      `Se você possui o código do serviço, digite com a hashtag (ex: *#abc12345*).`
    )
  }

  try {
    const booking = await db.booking.findFirst({
      where: {
        OR: [{ clientId: userId }, { providerId: userId }],
        status: { in: ["PENDING", "CONFIRMED", "IN_PROGRESS"] },
      },
      orderBy: { scheduledAt: "asc" },
      include: {
        service: { select: { title: true } },
        provider: { select: { name: true, phone: true } },
        client: { select: { name: true } },
      },
    })

    if (!booking) {
      return (
        `📋 *Agendamentos Severinno*\n\n` +
        `${greeting} Não identificamos nenhum serviço em andamento no momento para o seu número.\n\n` +
        `Para agendar com profissionais verificados de Governador Valadares, acesse:\n` +
        `🔗 https://severinno.com.br`
      )
    }

    const isClient = booking.clientId === userId
    const otherParty = isClient
      ? `Profissional: *${booking.provider.name}*`
      : `Cliente: *${booking.client.name}*`
    const dateFormatted = new Date(booking.scheduledAt).toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })

    const statusMap: Record<string, string> = {
      PENDING: "🟡 Aguardando confirmação",
      CONFIRMED: "🔵 Confirmado — aguardando chegada",
      IN_PROGRESS: "🔄 Em execução presencial",
    }

    return (
      `📋 *Status do seu Agendamento Ativo*\n\n` +
      `• *Código:* #${booking.id.slice(0, 8)}\n` +
      `• *Serviço:* ${booking.service?.title || "Serviço Residencial"}\n` +
      `• ${otherParty}\n` +
      `• *Data/Hora:* ${dateFormatted}\n` +
      `• *Status:* ${statusMap[booking.status] || booking.status}\n\n` +
      `📍 O profissional fará check-in via GPS ao chegar no seu endereço.\n` +
      `Acompanhe ao vivo pelo app: https://severinno.com.br/?view=client.bookings`
    )
  } catch (err) {
    triageLogger.error({ err, userId }, "Erro ao consultar status para triagem WhatsApp")
    return (
      `📋 *Consulta de Agendamento - Severinno*\n\n` +
      `Consulte seus agendamentos diretamente no app: https://severinno.com.br/?view=client.bookings`
    )
  }
}

/**
 * Constrói resposta informativa sobre a Garantia Escrow e Pagamentos.
 */
function buildEscrowPaymentReply(userName?: string | null): string {
  const greeting = userName ? `Olá, *${userName}*! ` : "Olá! "

  return (
    `🛡️ *Garantia Severinno Escrow & Pagamentos*\n\n` +
    `${greeting}No Severinno, seu pagamento é *100% seguro*:\n\n` +
    `1️⃣ *Como funciona?* Você paga via PIX ou Cartão no app, mas o valor *NÃO* vai direto ao profissional.\n` +
    `2️⃣ *Custódia Segura:* O dinheiro fica retido na plataforma durante toda a realização do serviço.\n` +
    `3️⃣ *Liberação:* Você só autoriza a transferência após conferir o serviço pronto e aprovado!\n` +
    `4️⃣ *Mediação:* Se algo der errado, nossa equipe intervém ou devolve o seu dinheiro.\n\n` +
    `💳 Para pagar um agendamento pendente, digite *3* ou acesse:\n` +
    `🔗 https://severinno.com.br/?view=client.bookings`
  )
}

/**
 * Constrói resposta para Suporte e Reclamações.
 */
function buildSupportComplaintReply(userName?: string | null): string {
  const greeting = userName ? `Olá, *${userName}*. ` : "Olá. "

  return (
    `👨‍💼 *Suporte & Atendimento Humano - Severinno*\n\n` +
    `${greeting}Lamentamos qualquer inconveniente. Sua solicitação foi priorizada para a nossa equipe de mediação em Governador Valadares.\n\n` +
    `• Digite *SUPORTE* ou *4* para transferir para um atendente humano.\n` +
    `• Se houver um serviço com problema, envie *CONTESTAR #CODIGO* para congelar o pagamento imediatamente em custódia.\n\n` +
    `Nossa prioridade é garantir a qualidade e a sua segurança!`
  )
}

/**
 * Constrói resposta para apresentação institucional / FAQ da plataforma.
 */
function buildPlatformInfoReply(): string {
  return (
    `👋 *Bem-vindo ao Severinno Marketplace!*\n\n` +
    `Somos a plataforma oficial de contratação de serviços em *Governador Valadares (MG)*.\n\n` +
    `✨ *Diferenciais Severinno:*\n` +
    `• *Profissionais Verificados:* Eletricistas, Encanadores, Pintores, Diaristas, Chaveiros e Fretes.\n` +
    `• *Pagamento Protegido:* Sistema Escrow — o profissional só recebe quando você aprovar o serviço.\n` +
    `• *Geolocalização:* Encontre os profissionais mais próximos do seu bairro.\n\n` +
    `📱 *Como usar:*\n` +
    `• Digite o que você precisa (ex: _"preciso de eletricista na Ilha"_, _"vazamento de água Centro"_)\n` +
    `• Digite *ORCAR* para pedir um orçamento rápido\n` +
    `• Digite *MENU* para ver todas as opções interativas\n` +
    `• Ou acesse a vitrine: https://severinno.com.br`
  )
}

// ---------------------------------------------------------------------------
// Orquestrador Principal de Triagem Inteligente
// ---------------------------------------------------------------------------

/**
 * Processa a mensagem com IA Híbrida (Groq Nuvem / Ollama Local na VPS / Fallback).
 *
 * Retorna `{ handled: true }` se a IA gerou autoatendimento e despachou a resposta via fila.
 * Retorna `{ handled: false }` se for interação direta cliente-prestador ou se não for tratável.
 */
export async function processAiTriage(ctx: AiTriageContext): Promise<AiTriageResult> {
  const text = (ctx.text || "").trim()

  // 1. Validações preliminares
  if (!text || text.length < 2) {
    return { handled: false }
  }

  // Ignora mensagens de grupos do WhatsApp (@g.us) ou status/broadcast
  if (ctx.remoteJid && (ctx.remoteJid.endsWith("@g.us") || ctx.remoteJid.includes("broadcast"))) {
    triageLogger.debug({ jid: ctx.remoteJid }, "Ignorando mensagem de grupo/broadcast")
    return { handled: false }
  }

  // 2. Proteção Anti-Loop & Rate Limit por telefone
  if (await isPhoneRateLimited(ctx.phone)) {
    return { handled: false }
  }

  const start = performance.now()
  let triage: StructuredAiTriage | null = null
  let engineUsed = "fallback"

  // 3. Tenta classificação com IA Híbrida (Groq Nuvem primária, Ollama VPS secundária)
  try {
    const messages: ChatMessage[] = [
      { role: "system", content: TRIAGE_SYSTEM_PROMPT },
      {
        role: "user",
        content: `Mensagem recebida: "${text}"\nRemetente: ${ctx.user?.name || "Cliente WhatsApp"}\nCadastrado: ${ctx.user ? "Sim" : "Não"}`,
      },
    ]

    const aiRes = await chatCompletionHybrid(messages, {
      temperature: 0.15,
      maxTokens: 400,
      localModel: process.env.WHATSAPP_AI_MODEL || process.env.LOCAL_AI_MODEL || "qwen2.5:0.5b",
      timeoutMs: 4500,
      useCache: true,
      cacheTtlSeconds: 1800,
    })

    engineUsed = aiRes.engine

    if (aiRes.content) {
      const jsonMatch = aiRes.content.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as StructuredAiTriage
        if (parsed.intent) {
          triage = {
            intent: parsed.intent,
            category: parsed.category || null,
            neighborhood: parsed.neighborhood || extractGvNeighborhood(text),
            urgency: ["NORMAL", "HIGH", "EMERGENCY"].includes(parsed.urgency)
              ? parsed.urgency
              : "NORMAL",
            confidence: Number(parsed.confidence) || 0.85,
            suggestedReply: parsed.suggestedReply || null,
          }
        }
      }
    }
  } catch (err) {
    triageLogger.warn(
      { err: (err as Error).message },
      "Falha na IA Híbrida para triagem — aplicando contingência determinística",
    )
  }

  // 4. Contingência determinística (Camada 3) caso a IA não tenha retornado JSON válido
  if (!triage) {
    const heuristic = classifyIntentHeuristic(text)
    triage = {
      intent: heuristic.intent,
      category: heuristic.category,
      neighborhood: extractGvNeighborhood(text),
      urgency: heuristic.urgency,
      confidence: 0.7,
    }
    engineUsed = "heuristic_fallback"
  }

  // 5. Se a intenção for DIRECT_INTERACTION entre as partes, NÃO INTERCEPTAR!
  // Deixa o webhook seguir para a persistência em db.message e notificação da contraparte.
  if (triage.intent === "DIRECT_INTERACTION") {
    triageLogger.info(
      { phone: ctx.phone.slice(0, 4) + "****", intent: triage.intent },
      "Mensagem identificada como interação direta — liberando para roteamento humano",
    )
    return { handled: false, intent: "DIRECT_INTERACTION" }
  }

  // 6. Construção da resposta contextual baseada na intenção
  let replyText = ""

  switch (triage.intent) {
    case "SERVICE_SEARCH": {
      const cat = triage.category || "Serviço Geral"
      replyText = buildServiceSearchReply(
        cat,
        triage.neighborhood || null,
        triage.urgency,
        ctx.user?.name,
      )
      break
    }

    case "QUOTE_ESTIMATION": {
      const cat = triage.category || "Serviços em Geral"
      const greeting = ctx.user?.name ? `Olá, *${ctx.user.name}*!` : "Olá!"
      replyText =
        `📑 *Solicitação de Orçamento - Severinno*\n\n` +
        `${greeting} No Severinno você recebe orçamentos gratuitos de profissionais verificados em Governador Valadares com preço justo e garantia Escrow!\n\n` +
        `🔧 *Categoria:* ${cat}\n` +
        (triage.neighborhood ? `📍 *Bairro:* ${triage.neighborhood}\n` : "") +
        `🛡️ *Garantia:* O valor só é transferido após você conferir o serviço finalizado.\n\n` +
        `🚀 *Para cotar agora direto no WhatsApp, responda com:*\n` +
        `👉 *ORCAR*\n\n` +
        `Ou veja a lista de prestadores e avaliações no app: https://severinno.com.br`
      break
    }

    case "STATUS_INQUIRY": {
      replyText = await buildStatusInquiryReply(ctx.user?.id, ctx.user?.name)
      break
    }

    case "ESCROW_PAYMENT": {
      replyText = buildEscrowPaymentReply(ctx.user?.name)
      break
    }

    case "SUPPORT_COMPLAINT": {
      replyText = buildSupportComplaintReply(ctx.user?.name)
      break
    }

    case "PLATFORM_INFO": {
      replyText = buildPlatformInfoReply()
      break
    }

    default: {
      // Se a IA gerou uma resposta sugerida de boa qualidade com confiança aceitável, usa ela
      if (triage.suggestedReply && triage.confidence >= 0.75) {
        replyText = triage.suggestedReply
      } else {
        // Mensagem indeterminada — apresenta guia amigável de autoatendimento
        replyText = buildPlatformInfoReply()
      }
      break
    }
  }

  const latencyMs = Math.round(performance.now() - start)

  // 7. Despacho assíncrono via fila RabbitMQ (não trava o webhook)
  await enqueueWhatsApp({
    to: ctx.phone,
    text: replyText,
    userId: ctx.user?.id,
    context: `ai:triage:${triage.intent.toLowerCase()}`,
  }).catch((err) => {
    triageLogger.warn({ err }, "Falha ao enfileirar resposta de triagem IA WhatsApp")
  })

  triageLogger.info(
    {
      phone: ctx.phone.slice(0, 4) + "****",
      intent: triage.intent,
      category: triage.category,
      neighborhood: triage.neighborhood,
      engine: engineUsed,
      latencyMs,
    },
    "Triagem Inteligente de WhatsApp processada com sucesso",
  )

  return {
    handled: true,
    replyText,
    intent: triage.intent,
    category: triage.category,
    neighborhood: triage.neighborhood,
    engineUsed,
    latencyMs,
  }
}
