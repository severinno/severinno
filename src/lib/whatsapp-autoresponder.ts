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
import { validateEscrowGeofence } from "@/lib/escrow-geofence"
import { notifyProviderArrived } from "@/lib/notifications"

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

export type LocationCheckinContext = {
  phone: string
  lat: number
  lng: number
  accuracy?: number | null
  isLiveLocation?: boolean
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
    `4️⃣ *4* ou *SUPORTE* — Falar com suporte humano\n` +
    `5️⃣ *5* ou *SERVICOS* — Catálogo de serviços em Governador Valadares\n\n` +
    `💡 _Dica: Digite *MENU* a qualquer momento para ver estas opções novamente._`
  )
}

/**
 * Catálogo resumido de serviços e profissionais em Governador Valadares
 */
export function getServicesCatalogText(): string {
  return (
    `📍 *Serviços em Governador Valadares (MG) - Severinno*\n\n` +
    `Encontre profissionais verificados nos bairros de GV com pagamento protegido (Escrow):\n\n` +
    `❄️ *Climatização* — Instalação e limpeza de ar split (Centro e Vila Bretas)\n` +
    `🧹 *Limpeza & Diarista* — Faxina residencial e pós-obra (Ilha dos Araújos)\n` +
    `⚡ *Eletricista* — Quadro, fiação e tomadas 220V (Centro)\n` +
    `🔧 *Hidráulica* — Caça-vazamentos, torneiras e registros (Vila Bretas)\n` +
    `🎨 *Pintura* — Grafiato, textura e cimento queimado (Grã-Duquesa)\n` +
    `🔨 *Pedreiro* — Reformas rápidas, alvenaria e pisos (São Pedro)\n` +
    `🪑 *Marcenaria* — Montagem de móveis e prateleiras (Esplanada)\n` +
    `🛋️ *Estofados* — Higienização a seco de sofás e colchões (Ilha dos Araújos)\n` +
    `🌿 *Jardinagem* — Poda de árvores e roçagem de lotes (Santa Rita)\n` +
    `🛠️ *Marido de Aluguel* — Pequenos reparos e instalações (Lourdes)\n\n` +
    `👉 Conheça a vitrine completa e agende online:\n` +
    `🔗 https://severinno.com.br`
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
 * Trata aprovação e liberação imediata de custódia (Escrow) pelo cliente via WhatsApp.
 */
export async function handleEscrowApproval(
  userId: string,
  explicitBookingId?: string,
): Promise<string> {
  try {
    const eligibleBookings = await db.booking.findMany({
      where: {
        clientId: userId,
        status: "COMPLETED",
        paymentStatus: "HELD",
        ...(explicitBookingId
          ? { OR: [{ id: explicitBookingId }, { id: { startsWith: explicitBookingId } }] }
          : {}),
      },
      orderBy: { updatedAt: "desc" },
      take: 2,
      include: {
        provider: { select: { id: true, name: true, whatsapp: true } },
        service: { select: { title: true } },
      },
    })

    if (!eligibleBookings.length) {
      return (
        `ℹ️ Não encontramos nenhum agendamento concluído aguardando aprovação de pagamento no momento.\n\n` +
        `Para visualizar seus agendamentos, digite *1* ou acesse: https://severinno.com`
      )
    }

    if (eligibleBookings.length > 1 && !explicitBookingId) {
      const list = eligibleBookings
        .map(
          (b) =>
            `• *#${b.id.slice(0, 8)}* — ${b.service?.title || "Serviço"} com ${b.provider.name}`,
        )
        .join("\n")
      return (
        `⚠️ Você possui mais de um serviço concluído aguardando liberação:\n\n${list}\n\n` +
        `Por favor, especifique qual deseja aprovar enviando: *APROVAR #CODIGO* (ex: *APROVAR #${eligibleBookings[0].id.slice(0, 8)}*).`
      )
    }

    const booking = eligibleBookings[0]
    const now = new Date()

    // Atualização atômica condicional para prevenir race conditions e dupla liberação
    const [bookingUpdateResult] = await db.$transaction([
      db.booking.updateMany({
        where: {
          id: booking.id,
          paymentStatus: "HELD",
        },
        data: {
          paymentStatus: "PAID",
          escrowReleasedAt: now,
        },
      }),
      db.payment.updateMany({
        where: {
          bookingId: booking.id,
          status: { not: "PAID" },
        },
        data: {
          status: "PAID",
          paidAt: now,
        },
      }),
    ])

    if (bookingUpdateResult.count === 0) {
      return (
        `ℹ️ O pagamento do agendamento *#${booking.id.slice(0, 8)}* já foi liberado ou não está mais sob custódia.\n\n` +
        `Acesse o app para consultar os detalhes: https://severinno.com`
      )
    }

    // Notifica o prestador via WhatsApp sobre a liberação imediata
    if (booking.provider.whatsapp) {
      await enqueueWhatsApp({
        to: booking.provider.whatsapp,
        text:
          `🎉 *Pagamento Liberado!*\n\n` +
          `O cliente aprovou a conclusão do serviço *${booking.service?.title || "Serviço"}* (#${booking.id.slice(0, 8)}).\n` +
          `O valor de R$ ${Number(booking.amount).toFixed(2)} foi liberado da custódia e está disponível para repasse na sua conta! 💰`,
        userId: booking.provider.id,
        context: `escrow:released:${booking.id}`,
      }).catch(() => {})
    }

    return (
      `✅ *Pagamento Liberado com Sucesso!*\n\n` +
      `Obrigado por confirmar! Os fundos do agendamento *#${booking.id.slice(0, 8)}* foram repassados com sucesso para o profissional *${booking.provider.name}*.\n\n` +
      `Avalie o serviço no app para ajudar outros clientes: https://severinno.com/?view=client.bookings`
    )
  } catch (error) {
    autoresponderLogger.error(
      { error, userId },
      "Erro ao processar aprovação de escrow via WhatsApp",
    )
    return "❌ Ocorreu um erro ao liberar o pagamento. Por favor, tente pelo aplicativo ou contate o suporte."
  }
}

/**
 * Trata contestação / reporte de problema no serviço pelo cliente via WhatsApp.
 */
export async function handleEscrowDispute(
  userId: string,
  explicitBookingId?: string,
): Promise<string> {
  try {
    const eligibleBookings = await db.booking.findMany({
      where: {
        clientId: userId,
        status: "COMPLETED",
        paymentStatus: "HELD",
        ...(explicitBookingId
          ? { OR: [{ id: explicitBookingId }, { id: { startsWith: explicitBookingId } }] }
          : {}),
      },
      orderBy: { updatedAt: "desc" },
      take: 2,
      include: {
        provider: { select: { id: true, name: true } },
        service: { select: { title: true } },
        disputes: { where: { status: "OPEN" } },
      },
    })

    if (!eligibleBookings.length) {
      return (
        `ℹ️ Não encontramos nenhum agendamento recente concluído com pagamento em custódia para contestar.\n\n` +
        `Digite *SUPORTE* para relatar um problema diretamente a nossa equipe humana.`
      )
    }

    if (eligibleBookings.length > 1 && !explicitBookingId) {
      const list = eligibleBookings
        .map(
          (b) =>
            `• *#${b.id.slice(0, 8)}* — ${b.service?.title || "Serviço"} com ${b.provider.name}`,
        )
        .join("\n")
      return (
        `⚠️ Você possui mais de um serviço elegível para contestação:\n\n${list}\n\n` +
        `Por favor, especifique qual deseja contestar enviando: *CONTESTAR #CODIGO* (ex: *CONTESTAR #${eligibleBookings[0].id.slice(0, 8)}*).`
      )
    }

    const booking = eligibleBookings[0]

    if (booking.disputes && booking.disputes.length > 0) {
      return `ℹ️ O agendamento *#${booking.id.slice(0, 8)}* já possui uma contestação aberta sob análise da nossa equipe.`
    }

    // Registra disputa formal e anota motivo no agendamento para suspender liberação de repasse
    await db.$transaction([
      db.dispute.create({
        data: {
          bookingId: booking.id,
          reason: "Contestação de serviço via WhatsApp",
          status: "OPEN",
        },
      }),
      db.booking.update({
        where: { id: booking.id },
        data: {
          escrowDisputeReason: "Contestação de serviço via WhatsApp",
        },
      }),
    ])

    // Registra notificação de contestação para o prestador
    await db.notification
      .create({
        data: {
          userId: booking.provider.id,
          title: "⚠️ Contestação de Serviço",
          body: `O cliente abriu um chamado sobre o agendamento #${booking.id.slice(0, 8)}. A liberação de custódia foi pausada para análise.`,
          type: "ESCROW_DISPUTE",
        },
      })
      .catch(() => {})

    return (
      `⚠️ *Contestação Registrada com Sucesso*\n\n` +
      `Os fundos do agendamento *#${booking.id.slice(0, 8)}* (*${booking.service?.title || "Serviço"}*) foram congelados em custódia segura.\n\n` +
      `Um atendente da equipe de mediação da Severinno entrará em contato em breve para entender o ocorrido e intermediar a solução.`
    )
  } catch (error) {
    autoresponderLogger.error({ error, userId }, "Erro ao registrar disputa de escrow via WhatsApp")
    return "❌ Erro ao registrar contestação. Entre em contato digitando *SUPORTE*."
  }
}

/**
 * Trata check-in presencial via compartilhamento de localização do WhatsApp pelo prestador.
 */
export async function processLocationCheckin(
  ctx: LocationCheckinContext,
): Promise<{ handled: boolean; replyText?: string }> {
  try {
    // 1. Busca agendamento ativo onde o usuário é o PRESTADOR
    const booking = await db.booking.findFirst({
      where: {
        providerId: ctx.user.id,
        status: { in: ["CONFIRMED", "IN_PROGRESS"] },
      },
      orderBy: { scheduledAt: "asc" },
      include: {
        client: { select: { id: true, name: true } },
        service: { select: { title: true } },
      },
    })

    if (!booking) {
      const replyText =
        `📍 Localização recebida (${ctx.lat.toFixed(4)}, ${ctx.lng.toFixed(4)}).\n\n` +
        `Não encontramos nenhum agendamento confirmado em andamento sob sua responsabilidade neste momento.`

      await enqueueWhatsApp({
        to: ctx.phone,
        text: replyText,
        userId: ctx.user.id,
        context: "checkin:no_active_booking",
      }).catch(() => {})

      return { handled: true, replyText }
    }

    // 1.5. Validação Anti-Fraude: Rejeita PIN estático arbitrário
    if (ctx.isLiveLocation === false) {
      const replyText =
        `⚠️ *Check-in Rejeitado (Localização Estática)*\n\n` +
        `Para garantir a segurança do cliente, o check-in presencial exige o envio de *Localização em Tempo Real (Live)* pelo WhatsApp ou a confirmação direta pelo aplicativo Severinno.\n\n` +
        `📲 No WhatsApp: toque em 📎 (anexo) > Localização > *Localização em tempo real*.`

      await enqueueWhatsApp({
        to: ctx.phone,
        text: replyText,
        userId: ctx.user.id,
        context: "checkin:static_location_rejected",
      }).catch(() => {})

      return { handled: true, replyText }
    }

    // 2. Valida a presença física usando o motor estrito de Geofence (STRICT: 50m)
    const geofenceResult = validateEscrowGeofence({
      providerLocation: {
        lat: ctx.lat,
        lng: ctx.lng,
        accuracyM: ctx.accuracy ?? 15,
      },
      serviceLocation: {
        lat: booking.lat,
        lng: booking.lng,
      },
      precisionTier: "STRICT",
      maxAllowedAccuracyMeters: 35,
      bookingId: booking.id,
    })

    if (geofenceResult.valid) {
      // 3. Atualiza o status do agendamento caso estivesse apenas CONFIRMED
      if (booking.status === "CONFIRMED") {
        await db.booking.update({
          where: { id: booking.id },
          data: { status: "IN_PROGRESS" },
        })
      }

      // 4. Dispara alerta multi-canal de chegada para o cliente (In-App + Push + WhatsApp)
      await notifyProviderArrived(
        booking.clientId,
        booking.id,
        ctx.user.name || "Prestador",
        booking.service?.title || "Serviço",
      ).catch((err) => {
        autoresponderLogger.warn({ err }, "Falha ao despachar notificação de chegada do prestador")
      })

      const distanceM = Math.round(geofenceResult.distanceKm * 1000)
      const replyText =
        `📍 *Check-in Presencial Confirmado!* 🛠️\n\n` +
        `Sua chegada ao local do agendamento *#${booking.id.slice(0, 8)}* foi validada com precisão de ${distanceM}m (limite: 50m).\n\n` +
        `O cliente (*${booking.client.name}*) já foi avisado da sua presença pelo WhatsApp e aplicativo. Bom atendimento!`

      await enqueueWhatsApp({
        to: ctx.phone,
        text: replyText,
        userId: ctx.user.id,
        context: `checkin:verified:${booking.id}`,
      }).catch(() => {})

      return { handled: true, replyText }
    } else {
      const distanceM = Math.round(geofenceResult.distanceKm * 1000)
      const replyText =
        `⚠️ *Check-in Não Validado*\n\n` +
        `Você está a *${distanceM}m* do endereço combinado (${booking.address}), mas o raio máximo de presença física é de *50m*.\n\n` +
        `Por favor, aproxime-se do local do cliente e compartilhe sua localização novamente.`

      await enqueueWhatsApp({
        to: ctx.phone,
        text: replyText,
        userId: ctx.user.id,
        context: `checkin:deviation:${booking.id}`,
      }).catch(() => {})

      return { handled: true, replyText }
    }
  } catch (error) {
    autoresponderLogger.error(
      { error, userId: ctx.user.id },
      "Erro ao processar checkin por localização",
    )
    return { handled: false }
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
  const refMatch = ctx.text.match(/#([a-zA-Z0-9]{6,12})/)
  const explicitRef = refMatch?.[1]

  let replyText: string | null = null

  // 1. Liberação de Escrow / Aprovação de Conclusão do Serviço (Exige intenção explícita — sem "SIM" genérico)
  if (
    normalized === "APROVAR" ||
    normalized === "LIBERAR" ||
    normalized === "CONFIRMAR PAGAMENTO" ||
    normalized === "PAGAR" ||
    normalized.startsWith("APROVAR ") ||
    normalized.startsWith("LIBERAR ") ||
    normalized.startsWith("CONFIRMAR PAGAMENTO ")
  ) {
    replyText = await handleEscrowApproval(ctx.user.id, explicitRef)
  }
  // 2. Contestação de Escrow / Abertura de Disputa
  else if (
    normalized === "CONTESTAR" ||
    normalized === "PROBLEMA" ||
    normalized === "RECLAMAR" ||
    normalized === "DISPUTA" ||
    normalized.startsWith("CONTESTAR ") ||
    normalized.startsWith("PROBLEMA ") ||
    normalized.startsWith("RECLAMAR ")
  ) {
    replyText = await handleEscrowDispute(ctx.user.id, explicitRef)
  }
  // 3. Menu e Ajuda
  else if (
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
  // 4. Agendamentos
  else if (
    normalized === "1" ||
    normalized === "AGENDAMENTO" ||
    normalized === "AGENDAMENTOS" ||
    normalized === "STATUS" ||
    normalized === "MEUS AGENDAMENTOS"
  ) {
    replyText = await getBookingsStatusText(ctx.user.id)
  }
  // 5. Orçamentos
  else if (
    normalized === "2" ||
    normalized === "ORCAMENTO" ||
    normalized === "ORCAMENTOS" ||
    normalized === "COTACAO" ||
    normalized === "MEUS ORCAMENTOS"
  ) {
    replyText = await getQuotesStatusText(ctx.user.id)
  }
  // 6. PIX e Pagamentos
  else if (
    normalized === "3" ||
    normalized === "PIX" ||
    normalized === "PAGAMENTO" ||
    normalized === "PAGAMENTOS" ||
    normalized === "COBRANCA"
  ) {
    replyText = await getPixHelpText(ctx.user.id)
  }
  // 7. Suporte Humano
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
  // 8. Catálogo de Serviços em Governador Valadares
  else if (
    normalized === "5" ||
    normalized === "SERVICO" ||
    normalized === "SERVICOS" ||
    normalized === "CATALOGO" ||
    normalized === "VALADARES" ||
    normalized === "GV" ||
    normalized === "PRESTADORES"
  ) {
    replyText = getServicesCatalogText()
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
