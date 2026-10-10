import "server-only"

/**
 * WhatsApp Interactive Auto-Responder & Command Parser
 *
 * Módulo inteligente para atendimento interativo e conversacional via WhatsApp.
 * Permite que clientes e profissionais consultem status, agendamentos, orçamentos,
 * ajuda e suporte digitando comandos rápidos ou palavras-chave (ex: "MENU", "STATUS", "AJUDA", "1", "2").
 *
 * Totalmente assíncrono: respostas são enviadas via RabbitMQ (`enqueueWhatsApp`)
 * para não bloquear o webhook da Evolution API e respeitar o rate-limit do Baileys.
 */

import { enqueueWhatsApp } from "@/lib/whatsapp-queue"
import { db } from "@/lib/db"
import logger from "@/lib/logger"

const autoresponderLogger = logger.child({ module: "whatsapp-autoresponder" })

export type AutoresponderContext = {
  phone: string
  text: string
  user: {
    id: string
    name: string | null
    role?: string | null
  }
}

/**
 * Normaliza o texto removendo acentos, espaços extras e colocando em maiúsculas.
 */
export function normalizeCommand(input: string): string {
  return input
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
}

/**
 * Menu principal interativo
 */
export function getMainMenuText(userName?: string | null): string {
  const greeting = userName ? `Olá, *${userName}*!` : "Olá!"
  return (
    `👋 ${greeting} Bem-vindo ao *Severinno Marketplace*.\n\n` +
    `Escolha uma das opções abaixo digitando o *número* ou a *palavra-chave* correspondente:\n\n` +
    `1️⃣ *1* ou *AGENDAMENTOS* — Meus agendamentos recentes\n` +
    `2️⃣ *2* ou *ORCAMENTOS* — Minhas solicitações de orçamento\n` +
    `3️⃣ *3* ou *PIX* — Instruções e pagamentos pendentes\n` +
    `4️⃣ *4* ou *SUPORTE* — Falar com suporte humano\n\n` +
    `💡 _Dica: Digite *MENU* a qualquer momento para ver estas opções novamente._`
  )
}

/**
 * Consulta últimos agendamentos do usuário (cliente ou prestador)
 */
export async function getBookingsStatusText(userId: string): Promise<string> {
  try {
    const bookings = await db.booking.findMany({
      where: {
        OR: [{ clientId: userId }, { providerId: userId }],
      },
      orderBy: { createdAt: "desc" },
      take: 3,
      include: {
        service: { select: { title: true } },
        client: { select: { name: true } },
        provider: { select: { name: true } },
      },
    })

    if (!bookings.length) {
      return (
        `📋 *Agendamentos*\n\n` +
        `Você ainda não possui nenhum agendamento registrado.\n\n` +
        `Acesse nosso app para encontrar profissionais qualificados:\n` +
        `🔗 https://severinno.com`
      )
    }

    const statusTranslations: Record<string, string> = {
      PENDING: "🟡 Pendente",
      CONFIRMED: "🔵 Confirmado",
      IN_PROGRESS: "🔄 Em Execução",
      COMPLETED: "✅ Concluído",
      CANCELLED: "❌ Cancelado",
    }

    const list = bookings
      .map((b) => {
        const idRef = `#${b.id.slice(0, 8)}`
        const st = statusTranslations[b.status] || b.status
        const service = b.service?.title || "Serviço"
        const otherParty = b.clientId === userId ? b.provider?.name : b.client?.name
        const dateStr = new Date(b.scheduledAt).toLocaleDateString("pt-BR", {
          day: "2-digit",
          month: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        })

        return `• *${idRef}* — ${service}\n  Status: ${st}\n  Com: ${otherParty || "Profissional"}\n  Data: ${dateStr}`
      })
      .join("\n\n")

    return (
      `📋 *Seus Últimos Agendamentos:*\n\n` +
      `${list}\n\n` +
      `Para mais detalhes ou gerenciar, acesse o app: https://severinno.com/?view=client.bookings`
    )
  } catch (error) {
    autoresponderLogger.error({ error, userId }, "Erro ao consultar agendamentos do usuário")
    return "❌ Ocorreu um erro ao consultar seus agendamentos. Tente novamente mais tarde."
  }
}

/**
 * Consulta orçamentos recentes
 */
export async function getQuotesStatusText(userId: string): Promise<string> {
  try {
    const quotes = await db.quoteRequest.findMany({
      where: {
        OR: [{ clientId: userId }, { providerId: userId }],
      },
      orderBy: { createdAt: "desc" },
      take: 3,
      include: {
        items: { select: { description: true, quantity: true } },
        provider: { select: { name: true } },
        client: { select: { name: true } },
      },
    })

    if (!quotes.length) {
      return (
        `📑 *Orçamentos*\n\n` +
        `Nenhuma solicitação de orçamento encontrada no momento.\n\n` +
        `Crie um novo pedido no app: https://severinno.com`
      )
    }

    const statusTranslations: Record<string, string> = {
      PENDING: "🟡 Aguardando Resposta",
      ACCEPTED: "✅ Aceito",
      REJECTED: "❌ Recusado",
      EXPIRED: "⌛ Expirado",
    }

    const list = quotes
      .map((q) => {
        const idRef = `#${q.id.slice(0, 8)}`
        const st = statusTranslations[q.status] || q.status
        const itemDesc = q.items[0]?.description || "Itens sob medida"
        const otherParty = q.clientId === userId ? q.provider?.name : q.client?.name

        return `• *${idRef}* — ${itemDesc}\n  Status: ${st}\n  Com: ${otherParty || "Usuário"}`
      })
      .join("\n\n")

    return (
      `📑 *Suas Solicitações de Orçamento:*\n\n` +
      `${list}\n\n` +
      `Acompanhe as propostas completas no app Severinno.`
    )
  } catch (error) {
    autoresponderLogger.error({ error, userId }, "Erro ao consultar orçamentos")
    return "❌ Ocorreu um erro ao consultar seus orçamentos. Tente novamente mais tarde."
  }
}

/**
 * Informações de PIX e pagamentos
 */
export async function getPixHelpText(userId: string): Promise<string> {
  try {
    const pendingBooking = await db.booking.findFirst({
      where: {
        clientId: userId,
        paymentStatus: "PENDING",
        status: { not: "CANCELLED" },
      },
      orderBy: { createdAt: "desc" },
      include: {
        service: { select: { title: true } },
      },
    })

    if (pendingBooking) {
      return (
        `💳 *Pagamento PIX Pendente*\n\n` +
        `Identificamos um agendamento aguardando pagamento:\n` +
        `• Agendamento: *#${pendingBooking.id.slice(0, 8)}* (${pendingBooking.service?.title || "Serviço"})\n` +
        `• Valor: *R$ ${Number(pendingBooking.amount).toFixed(2)}*\n\n` +
        `🛡️ Seus fundos ficam em custódia segura (*Severinno Escrow*) e só são liberados após o término do serviço.\n\n` +
        `Acesse o app para gerar ou copiar a chave PIX: https://severinno.com/?view=client.bookings`
      )
    }

    return (
      `💳 *Pagamentos e PIX - Severinno*\n\n` +
      `Você não possui nenhum pagamento pendente no momento! 🎉\n\n` +
      `Todos os pagamentos realizados no Severinno contam com garantia de custódia (Escrow) e confirmação instantânea via PIX.`
    )
  } catch (error) {
    autoresponderLogger.error({ error, userId }, "Erro ao consultar pendências PIX")
    return "❌ Erro ao consultar pendências financeiras. Acesse o painel pelo aplicativo."
  }
}

/**
 * Processa uma mensagem de texto e retorna se foi tratada por um comando interativo.
 * Se reconhecer o comando, despacha a resposta via fila RabbitMQ (`enqueueWhatsApp`)
 * e retorna `true`. Se for uma mensagem conversacional comum, retorna `false` (para que
 * o fluxo normal de roteamento entre clientes e profissionais persista a mensagem).
 */
export async function processInteractiveCommand(
  ctx: AutoresponderContext,
): Promise<{ handled: boolean; replyText?: string }> {
  const normalized = normalizeCommand(ctx.text)

  let replyText: string | null = null

  // 1. Menu e Ajuda
  if (
    normalized === "MENU" ||
    normalized === "AJUDA" ||
    normalized === "HELP" ||
    normalized === "OLA" ||
    normalized === "OI" ||
    normalized === "BOM DIA" ||
    normalized === "BOA TARDE" ||
    normalized === "BOA NOITE" ||
    normalized === "INICIO" ||
    normalized === "0"
  ) {
    replyText = getMainMenuText(ctx.user.name)
  }
  // 2. Agendamentos
  else if (
    normalized === "1" ||
    normalized === "AGENDAMENTO" ||
    normalized === "AGENDAMENTOS" ||
    normalized === "STATUS" ||
    normalized === "MEUS AGENDAMENTOS"
  ) {
    replyText = await getBookingsStatusText(ctx.user.id)
  }
  // 3. Orçamentos
  else if (
    normalized === "2" ||
    normalized === "ORCAMENTO" ||
    normalized === "ORCAMENTOS" ||
    normalized === "COTACAO" ||
    normalized === "MEUS ORCAMENTOS"
  ) {
    replyText = await getQuotesStatusText(ctx.user.id)
  }
  // 4. PIX e Pagamentos
  else if (
    normalized === "3" ||
    normalized === "PIX" ||
    normalized === "PAGAMENTO" ||
    normalized === "PAGAMENTOS" ||
    normalized === "COBRANCA"
  ) {
    replyText = await getPixHelpText(ctx.user.id)
  }
  // 5. Suporte Humano
  else if (
    normalized === "4" ||
    normalized === "SUPORTE" ||
    normalized === "HUMANO" ||
    normalized === "ATENDENTE" ||
    normalized === "FALAR COM ATENDENTE"
  ) {
    replyText =
      `👨‍💼 *Suporte Humano - Severinno*\n\n` +
      `Sua solicitação de atendimento foi registrada! Nossa equipe entrará em contato por aqui ou pelo aplicativo em instantes.\n\n` +
      `Caso prefira, envie uma mensagem detalhada com o que precisa.`
  }

  if (replyText) {
    autoresponderLogger.info(
      { phone: ctx.phone.slice(0, 4) + "****", command: normalized, userId: ctx.user.id },
      "Comando interativo WhatsApp processado com sucesso",
    )

    // Envia resposta assíncrona via RabbitMQ com contexto para rastreio
    await enqueueWhatsApp({
      to: ctx.phone,
      text: replyText,
      userId: ctx.user.id,
      context: `autoresponder:${normalized}`,
    }).catch((err) => {
      autoresponderLogger.warn({ err }, "Falha ao enfileirar resposta do autoresponder")
    })

    return { handled: true, replyText }
  }

  return { handled: false }
}
