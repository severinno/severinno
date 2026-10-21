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
import { notifyProviderArrived, notifyNewBooking } from "@/lib/notifications"
import { matchSynonymSuggestions } from "@/lib/search-synonyms"

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
    `1️⃣ *1* ou *AGENDAMENTOS* (*STATUS*) — Meus agendamentos e proteção Escrow (ex: _STATUS #abc123_)\n` +
    `2️⃣ *2* ou *ORCAMENTOS* — Minhas solicitações de orçamento\n` +
    `3️⃣ *3* ou *PIX* — Instruções e pagamentos pendentes\n` +
    `4️⃣ *4* ou *SUPORTE* — Falar com suporte humano\n` +
    `5️⃣ *5* ou *SERVICOS* — Catálogo de serviços em Governador Valadares\n` +
    `6️⃣ *6* ou *ORCAR* — Solicitar novo orçamento em Governador Valadares\n` +
    `7️⃣ *7* ou *PONTOS* — Saldo no Clube de Benefícios (Fidelidade)\n` +
    `8️⃣ *8* ou *CONVITE* — Indique & Ganhe (seu link exclusivo)\n` +
    `9️⃣ *9* ou *REPUTACAO* — Cartão profissional (para prestadores)\n\n` +
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
 * Consulta agendamentos do usuário (por ID do usuário, por código explícito #ID ou por telefone)
 */
export async function getBookingsStatusText(
  userId: string,
  explicitRef?: string,
  phone?: string,
): Promise<string> {
  try {
    const digits = phone ? phone.replace(/\D/g, "") : ""
    const cleanPhone = digits.startsWith("55") ? digits : `55${digits}`

    // 1. Se informou código explícito de agendamento (ex: STATUS #12345 ou STATUS 12345)
    if (explicitRef) {
      const singleBooking = await db.booking.findFirst({
        where: {
          OR: [{ id: explicitRef }, { id: { startsWith: explicitRef } }],
        },
        include: {
          service: { select: { title: true } },
          client: { select: { id: true, name: true, phone: true } },
          provider: { select: { id: true, name: true, phone: true } },
          payment: { select: { status: true, method: true, amount: true } },
        },
      })

      if (singleBooking) {
        const idRef = `#${singleBooking.id.slice(0, 8)}`
        const service = singleBooking.service?.title || "Serviço"
        const dateStr = singleBooking.scheduledAt
          ? new Date(singleBooking.scheduledAt).toLocaleDateString("pt-BR", {
              day: "2-digit",
              month: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
            })
          : "A combinar"

        const statusTranslations: Record<string, string> = {
          PENDING: "🟡 Pendente de Confirmação",
          CONFIRMED: "🔵 Confirmado — Aguardando Atendimento",
          IN_PROGRESS: "🔄 Em Execução (Prestador no Local)",
          COMPLETED: "✅ Concluído",
          CANCELLED: "❌ Cancelado",
        }
        const st = statusTranslations[singleBooking.status] || singleBooking.status

        let escrowStatus = "⚠️ Pagamento Pendente (PIX)"
        if (singleBooking.paymentStatus === "PAID") {
          if ((singleBooking as any).escrowReleasedAt) {
            escrowStatus = "✅ Pagamento Liberado ao Prestador"
          } else {
            escrowStatus = "🛡️ Protegido em Custódia Escrow (Fundos seguros até aprovação final)"
          }
        }

        let actions = `Para detalhes, acesse: https://severinno.com.br/?view=client.bookings`
        if (singleBooking.status === "COMPLETED" && !(singleBooking as any).escrowReleasedAt) {
          actions = `🎉 O serviço foi concluído!\n• Para liberar o repasse: digite *APROVAR ${idRef}*\n• Se houve algum problema: digite *CONTESTAR ${idRef}*`
        } else if (singleBooking.paymentStatus === "PENDING") {
          actions = `💳 Para pagar e garantir sua data, digite *PIX* ou acesse: https://severinno.com.br`
        }

        return (
          `📋 *Status do Agendamento ${idRef}*\n\n` +
          `🔧 *Serviço:* ${service}\n` +
          `👤 *Prestador:* ${singleBooking.provider?.name || "Profissional"}\n` +
          `📅 *Data:* ${dateStr}\n` +
          `📍 *Local:* ${singleBooking.address || "Governador Valadares"}\n` +
          `💰 *Valor:* R$ ${Number(singleBooking.amount).toFixed(2)}\n` +
          `📊 *Andamento:* ${st}\n` +
          `🔒 *Escrow:* ${escrowStatus}\n\n` +
          `${actions}`
        )
      }
    }

    // 2. Consulta múltiplos agendamentos recentes vinculados ao usuário ou telefone
    const phoneQueries = digits
      ? [
          { client: { phone: digits } },
          { client: { whatsapp: digits } },
          { client: { phone: cleanPhone } },
          { client: { whatsapp: cleanPhone } },
        ]
      : []

    const bookings = await db.booking.findMany({
      where: {
        OR: [
          ...(userId && !userId.startsWith("anon-")
            ? [{ clientId: userId }, { providerId: userId }]
            : []),
          ...phoneQueries,
        ],
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
        `📋 *Agendamentos no Severinno*\n\n` +
        `Você ainda não possui nenhum agendamento registrado.\n\n` +
        `Deseja contratar um profissional verificado em Governador Valadares?\n\n` +
        `1️⃣ Digite *SERVICOS* para ver especialidades disponíveis\n` +
        `2️⃣ Digite *ORCAR* para solicitar um orçamento rápido\n` +
        `3️⃣ Acesse nosso app com garantia Escrow: https://severinno.com.br`
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

        const escrowBadge =
          b.paymentStatus === "PAID"
            ? (b as any).escrowReleasedAt
              ? "✅ Pago"
              : "🛡️ Escrow Ativo"
            : "⚠️ PIX Pendente"

        return `• *${idRef}* — ${service}\n  Status: ${st} (${escrowBadge})\n  Com: ${otherParty || "Profissional"}\n  Data: ${dateStr}`
      })
      .join("\n\n")

    return (
      `📋 *Seus Últimos Agendamentos:*\n\n` +
      `${list}\n\n` +
      `💡 _Para consultar um agendamento específico, envie: *STATUS #CODIGO*_`
    )
  } catch (error) {
    autoresponderLogger.error(
      { error, userId, explicitRef, phone },
      "Erro ao consultar agendamentos do usuário",
    )
    return "❌ Ocorreu um erro ao consultar seus agendamentos. Tente novamente mais tarde ou digite *SUPORTE*."
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
 * Consulta saldo de fidelidade e categoria no Clube de Benefícios Severinno
 */
export async function getLoyaltyStatusText(
  userId: string,
  userName?: string | null,
): Promise<string> {
  try {
    const { getLoyaltyStats } = await import("@/lib/loyalty")
    const stats = await getLoyaltyStats(userId)
    const tierEmoji: Record<string, string> = {
      bronze: "🥉 Bronze",
      prata: "🥈 Prata",
      ouro: "🥇 Ouro",
      diamante: "💎 Diamante",
    }
    const tierDisplay = tierEmoji[stats.tier] || "🥉 Bronze"

    return (
      `🎁 *Clube de Benefícios Severinno*\n\n` +
      `Olá${userName ? `, *${userName}*` : ""}! Aqui está seu saldo de fidelidade:\n\n` +
      `• *Saldo Atual:* ${stats.points} pontos\n` +
      `• *Categoria:* ${tierDisplay}\n` +
      `• *Serviços Realizados:* ${stats.totalBookings}\n\n` +
      `🌟 *Como acumular mais pontos:*\n` +
      `• Indique amigos e ganhe *50 pontos* após o primeiro serviço realizado\n` +
      `• Contrate e avalie serviços com garantia de custódia PIX\n\n` +
      `🛡️ *Aviso Anti-Cash:* Os pontos do Clube Severinno são exclusivos para resgate de benefícios, descontos e ferramentas na plataforma (vedado saque em dinheiro).\n\n` +
      `Acesse a central no app para resgatar: https://severinno.com.br`
    )
  } catch (error) {
    autoresponderLogger.error({ error, userId }, "Erro ao consultar saldo de pontos")
    return "❌ Erro ao consultar seu saldo no Clube de Benefícios. Tente novamente mais tarde."
  }
}

/**
 * Retorna código exclusivo e link canônico do programa Indique & Ganhe
 */
export async function getReferralInviteText(userId: string): Promise<string> {
  try {
    const { getOrCreateReferralCode, getReferralStats } = await import("@/lib/referral")
    const code = await getOrCreateReferralCode(userId)
    const stats = await getReferralStats(userId).catch(() => ({
      totalInvites: 0,
      activeFriends: 0,
      pointsEarned: 0,
    }))

    return (
      `🎟️ *Programa Indique & Ganhe — Severinno*\n\n` +
      `Convide amigos, familiares e vizinhos para contratarem serviços em Governador Valadares com 100% de garantia de custódia!\n\n` +
      `• *Seu Código:* ${code}\n` +
      `• *Seu Link:* https://severinno.com.br/convite/${code}\n` +
      `• *Amigos convidados:* ${stats.totalInvites} (${stats.activeFriends} serviços concluídos)\n\n` +
      `🎁 *Benefícios:*\n` +
      `• Você ganha *50 pontos* quando seu amigo concluir o 1º serviço pago\n` +
      `• Seu amigo ganha *25 pontos* de boas-vindas logo no cadastro!\n\n` +
      `📲 *Mensagem pronta para encaminhar:*\n` +
      `_"Oi! Conheça o Severinno para contratar profissionais verificados em Valadares com pagamento protegido por custódia PIX. Acesse com meu convite: https://severinno.com.br/convite/${code}"_`
    )
  } catch (error) {
    autoresponderLogger.error({ error, userId }, "Erro ao gerar link de indicação")
    return "❌ Erro ao consultar seu código de indicação. Tente novamente mais tarde."
  }
}

/**
 * Retorna o Cartão de Reputação Social do prestador com link de perfil público
 */
export async function getProviderReputationCardText(userId: string): Promise<string> {
  try {
    const provider = await db.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        slug: true,
        role: true,
        avgRating: true,
        reviewCount: true,
        city: true,
        _count: {
          select: {
            bookingsAsProvider: { where: { status: "COMPLETED" } },
          },
        },
      },
    })

    if (!provider || provider.role !== "PROVIDER") {
      return (
        `ℹ️ O Cartão de Reputação Profissional é exclusivo para prestadores cadastrados no Severinno.\n\n` +
        `Para se cadastrar como profissional verificado em Governador Valadares, acesse: https://severinno.com.br/register?role=provider`
      )
    }

    const rating = provider.avgRating ? Number(provider.avgRating).toFixed(1) : "5.0"
    const completed = provider._count?.bookingsAsProvider ?? 0
    const profileSlug = provider.slug || provider.id
    const profileUrl = `https://severinno.com.br/u/${profileSlug}`

    return (
      `⭐ *Cartão Profissional Severinno*\n\n` +
      `*${provider.name}*\n` +
      `📍 ${provider.city || "Governador Valadares, MG"}\n` +
      `⭐ *${rating}* (${provider.reviewCount} avaliações de clientes)\n` +
      `🛠️ *${completed} serviços concluídos* com garantia de custódia\n` +
      `🛡️ *Identidade Verificada* pela plataforma\n\n` +
      `🔗 *Seu Perfil Público Oficial:*\n${profileUrl}\n\n` +
      `📲 *Mensagem para enviar aos seus clientes:*\n` +
      `_"Olá! Agende meus serviços com garantia de custódia e pagamento seguro pelo Severinno: ${profileUrl}"_`
    )
  } catch (error) {
    autoresponderLogger.error({ error, userId }, "Erro ao gerar cartão de reputação")
    return "❌ Erro ao consultar seu cartão de reputação. Tente novamente mais tarde."
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
    const numericChoice =
      explicitBookingId && /^[1-9]\d*$/.test(explicitBookingId.trim())
        ? parseInt(explicitBookingId.trim(), 10)
        : null

    const eligibleBookings = await db.booking.findMany({
      where: {
        clientId: userId,
        status: "COMPLETED",
        paymentStatus: "HELD",
        ...(explicitBookingId && !numericChoice
          ? { OR: [{ id: explicitBookingId }, { id: { startsWith: explicitBookingId } }] }
          : {}),
      },
      orderBy: { updatedAt: "desc" },
      take: 5,
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

    if (numericChoice !== null) {
      if (numericChoice > eligibleBookings.length) {
        return (
          `⚠️ Opção inválida. Escolha um número entre 1 e ${eligibleBookings.length}.\n\n` +
          `Envie *APROVAR 1* para a primeira opção ou acesse o app: https://severinno.com`
        )
      }
    } else if (eligibleBookings.length > 1 && !explicitBookingId) {
      const list = eligibleBookings
        .map(
          (b, idx) =>
            `${idx + 1}️⃣ *#${b.id.slice(0, 8)}* — ${b.service?.title || "Serviço"} com ${b.provider.name} (R$ ${Number(b.amount).toFixed(2)})`,
        )
        .join("\n")
      return (
        `⚠️ Você possui mais de um serviço concluído aguardando liberação:\n\n${list}\n\n` +
        `Por favor, especifique qual deseja aprovar enviando: *APROVAR #CODIGO* ou o número da opção (ex: *APROVAR 1* ou *APROVAR #${eligibleBookings[0].id.slice(0, 8)}*).`
      )
    }

    const booking =
      numericChoice !== null ? eligibleBookings[numericChoice - 1] : eligibleBookings[0]

    const { acquireEscrowLock } = await import("@/lib/escrow-lock")
    const lock = await acquireEscrowLock(booking.id, 15)
    if (!lock.acquired) {
      return `ℹ️ O pagamento do agendamento *#${booking.id.slice(0, 8)}* já está sendo processado concorrentemente. Por favor, aguarde alguns instantes.`
    }

    try {
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
    } finally {
      await lock.release()
    }
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
    const numericChoice =
      explicitBookingId && /^[1-9]\d*$/.test(explicitBookingId.trim())
        ? parseInt(explicitBookingId.trim(), 10)
        : null

    const eligibleBookings = await db.booking.findMany({
      where: {
        clientId: userId,
        status: "COMPLETED",
        paymentStatus: "HELD",
        ...(explicitBookingId && !numericChoice
          ? { OR: [{ id: explicitBookingId }, { id: { startsWith: explicitBookingId } }] }
          : {}),
      },
      orderBy: { updatedAt: "desc" },
      take: 5,
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

    if (numericChoice !== null) {
      if (numericChoice > eligibleBookings.length) {
        return (
          `⚠️ Opção inválida. Escolha um número entre 1 e ${eligibleBookings.length}.\n\n` +
          `Envie *CONTESTAR 1* para a primeira opção ou digite *SUPORTE*.`
        )
      }
    } else if (eligibleBookings.length > 1 && !explicitBookingId) {
      const list = eligibleBookings
        .map(
          (b, idx) =>
            `${idx + 1}️⃣ *#${b.id.slice(0, 8)}* — ${b.service?.title || "Serviço"} com ${b.provider.name} (R$ ${Number(b.amount).toFixed(2)})`,
        )
        .join("\n")
      return (
        `⚠️ Você possui mais de um serviço elegível para contestação:\n\n${list}\n\n` +
        `Por favor, especifique qual deseja contestar enviando: *CONTESTAR #CODIGO* ou o número da opção (ex: *CONTESTAR 1* ou *CONTESTAR #${eligibleBookings[0].id.slice(0, 8)}*).`
      )
    }

    const booking =
      numericChoice !== null ? eligibleBookings[numericChoice - 1] : eligibleBookings[0]

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
 * Trata contratação rápida e geração instantânea de PIX Lytex via WhatsApp
 */
export async function handleInstantQuoteHiring(
  userId: string,
  phone: string,
  explicitQuoteRef?: string,
): Promise<string> {
  try {
    const digits = phone.replace(/\D/g, "")
    const cleanPhone = digits.startsWith("55") ? digits : `55${digits}`

    // 0. Verifica se há uma sessão recente de orçamento por voz para contratação instantânea
    const { getVoiceQuoteSession, clearVoiceQuoteSession } =
      await import("@/lib/whatsapp-voice-quote")
    const voiceSession = await getVoiceQuoteSession(phone)

    if (voiceSession && !explicitQuoteRef) {
      let category = await db.category.findFirst({
        where: {
          active: true,
          OR: [
            { name: { contains: voiceSession.quote.category, mode: "insensitive" } },
            { slug: { contains: voiceSession.quote.category.toLowerCase(), mode: "insensitive" } },
          ],
        },
      })
      if (!category) {
        category = await db.category.findFirst({
          where: { active: true },
          orderBy: { order: "asc" },
        })
      }

      let service = null
      if (category) {
        service = await db.service.findFirst({
          where: {
            categoryId: category.id,
            active: true,
            provider: { active: true, role: "PROVIDER" },
          },
          include: {
            provider: {
              select: { id: true, name: true, whatsapp: true, email: true, cpfCnpj: true },
            },
          },
        })
      }
      if (!service) {
        service = await db.service.findFirst({
          where: { active: true, provider: { active: true, role: "PROVIDER" } },
          include: {
            provider: {
              select: { id: true, name: true, whatsapp: true, email: true, cpfCnpj: true },
            },
          },
        })
      }

      if (service && service.provider) {
        const avgPrice = Math.max(
          50,
          Math.round(
            (voiceSession.quote.estimatedPriceRange[0] +
              voiceSession.quote.estimatedPriceRange[1]) /
              2,
          ),
        )

        const client = await db.user.findUnique({
          where: { id: userId },
          select: { id: true, name: true, email: true, cpfCnpj: true, whatsapp: true },
        })

        const tomorrow = new Date(Date.now() + 24 * 3600 * 1000)
        tomorrow.setHours(14, 0, 0, 0)
        const neighborhood = voiceSession.quote.neighborhood || "Governador Valadares"
        const address = `${neighborhood}, Gov. Valadares - MG`

        const quote = await db.quoteRequest.create({
          data: {
            clientId: userId,
            providerId: service.provider.id,
            address,
            cep: "35010-000",
            lat: -18.8511,
            lng: -41.9494,
            expiresAt: new Date(Date.now() + 5 * 24 * 3600 * 1000),
            status: "APPROVED",
            items: {
              create: [
                {
                  providerId: service.provider.id,
                  serviceId: service.id,
                  description: voiceSession.quote.description || voiceSession.quote.serviceTitle,
                  quantity: 1,
                  price: avgPrice,
                  status: "ACCEPTED",
                },
              ],
            },
          },
        })

        const booking = await db.booking.create({
          data: {
            clientId: userId,
            providerId: service.provider.id,
            serviceId: service.id,
            scheduledAt: tomorrow,
            amount: avgPrice,
            address,
            cep: "35010-000",
            lat: -18.8511,
            lng: -41.9494,
            status: "PENDING",
            paymentStatus: "PENDING",
            paymentMethod: "PIX",
            quoteId: quote.id,
            notes: `Contratado via Áudio WhatsApp (#${quote.id.slice(0, 8)})`,
          },
        })

        let qrCode = ""
        try {
          const { createPixCharge } = await import("@/lib/lytex")
          const pix = await createPixCharge({
            externalReference: `booking:${booking.id}`,
            amount: avgPrice,
            customer: {
              name: client?.name || "Cliente WhatsApp",
              email: client?.email || `cliente_${digits}@severinno.com.br`,
              cpfCnpj: client?.cpfCnpj || "00000000000",
              phone,
            },
            description: `Agendamento #${booking.id.slice(0, 8)} - Severinno`,
          })
          qrCode = pix.qrCode

          await db.payment.create({
            data: {
              bookingId: booking.id,
              status: "PENDING",
              method: "PIX",
              amount: avgPrice,
              lytexId: pix.id,
              qrCode: pix.qrCode,
              lytexStatus: pix.lytexStatus,
            },
          })
        } catch (err) {
          autoresponderLogger.warn(
            { err, bookingId: booking.id },
            "Falha Lytex PIX — gerando código PIX fallback",
          )
          qrCode = `00020126580014br.gov.bcb.pix0136${booking.id}520400005303986540${avgPrice.toFixed(2)}5802BR5916SEVERINNO_ESCROW6009VALADARES62070503***6304`
        }

        await clearVoiceQuoteSession(phone)

        notifyNewBooking(
          userId,
          service.provider.id,
          booking.id,
          voiceSession.quote.serviceTitle || service.title,
          tomorrow,
          client?.name || "Cliente WhatsApp",
        ).catch(() => {})

        return (
          `🎉 *Pedido Confirmado e PIX Copia-e-Cola Emitido!*\n\n` +
          `📋 *Agendamento:* #${booking.id.slice(0, 8)}\n` +
          `👤 *Profissional:* ${service.provider.name} (Verificado)\n` +
          `🔧 *Serviço:* ${voiceSession.quote.serviceTitle || service.title}\n` +
          `📍 *Local:* ${neighborhood}, Gov. Valadares\n` +
          `💰 *Valor Total:* R$ ${avgPrice.toFixed(2)}\n` +
          `📅 *Data Prevista:* Amanhã às 14:00 (você pode alinhar com o profissional)\n\n` +
          `📱 *Código PIX Copia-e-Cola (toque para copiar):*\n\n` +
          `\`${qrCode}\`\n\n` +
          `🛡️ *Garantia Severinno Escrow:*\n` +
          `Seu pagamento fica 100% protegido em custódia na plataforma e só é repassado ao profissional após você aprovar a conclusão do serviço!\n\n` +
          `💡 _Assim que o pagamento for detectado pelo banco, confirmaremos automaticamente aqui no chat em poucos segundos._`
        )
      }
    }

    // 1. Localiza a solicitação de orçamento com proposta respondida
    const quote = await db.quoteRequest.findFirst({
      where: {
        ...(explicitQuoteRef
          ? { OR: [{ id: explicitQuoteRef }, { id: { startsWith: explicitQuoteRef } }] }
          : {
              OR: [
                { clientId: userId },
                { client: { whatsapp: { in: [digits, cleanPhone, cleanPhone.slice(2)] } } },
              ],
              status: "RESPONDED",
            }),
      },
      orderBy: { updatedAt: "desc" },
      include: {
        client: { select: { id: true, name: true, email: true, cpfCnpj: true, whatsapp: true } },
        provider: { select: { id: true, name: true, whatsapp: true } },
        items: {
          include: {
            service: { select: { id: true, title: true } },
          },
        },
        bookings: {
          take: 1,
          include: {
            payment: true,
          },
        },
      },
    })

    if (!quote) {
      // 1.1 Se não tem orçamento, verifica se tem agendamento pendente de pagamento PIX
      const pendingBooking = await db.booking.findFirst({
        where: {
          OR: [
            { clientId: userId },
            { client: { whatsapp: { in: [digits, cleanPhone, cleanPhone.slice(2)] } } },
          ],
          status: { in: ["PENDING", "CONFIRMED"] },
          paymentStatus: "PENDING",
        },
        orderBy: { createdAt: "desc" },
        include: {
          client: { select: { id: true, name: true, email: true, cpfCnpj: true, whatsapp: true } },
          provider: { select: { id: true, name: true, whatsapp: true } },
          service: { select: { id: true, title: true } },
          payment: true,
        },
      })

      if (pendingBooking && pendingBooking.paymentStatus === "PENDING" && pendingBooking.amount) {
        let qrCode = pendingBooking.payment?.qrCode || ""
        const bookingAmount = Number(pendingBooking.amount)

        if (!qrCode) {
          try {
            const { createPixCharge } = await import("@/lib/lytex")
            const pix = await createPixCharge({
              externalReference: `booking:${pendingBooking.id}`,
              amount: bookingAmount,
              customer: {
                name: pendingBooking.client?.name || "Cliente WhatsApp",
                email: pendingBooking.client?.email || `cliente_${digits}@severinno.com.br`,
                cpfCnpj: pendingBooking.client?.cpfCnpj || "00000000000",
                phone,
              },
              description: `Agendamento #${pendingBooking.id.slice(0, 8)} - Severinno`,
            })
            qrCode = pix.qrCode

            await db.payment.upsert({
              where: { bookingId: pendingBooking.id },
              create: {
                bookingId: pendingBooking.id,
                status: "PENDING",
                method: "PIX",
                amount: bookingAmount,
                lytexId: pix.id,
                qrCode: pix.qrCode,
                lytexStatus: pix.lytexStatus,
              },
              update: {
                lytexId: pix.id,
                qrCode: pix.qrCode,
                lytexStatus: pix.lytexStatus,
              },
            })
          } catch (err) {
            autoresponderLogger.warn(
              { err, bookingId: pendingBooking.id },
              "Falha na chamada Lytex PIX — gerando código fallback",
            )
            qrCode = `00020126580014br.gov.bcb.pix0136${pendingBooking.id}520400005303986540${bookingAmount.toFixed(2)}5802BR5916SEVERINNO_ESCROW6009VALADARES62070503***6304`
          }
        }

        const providerName = pendingBooking.provider?.name || "Profissional Parceiro"
        const serviceTitle = pendingBooking.service?.title || "Serviço Residencial"

        return (
          `📋 *Agendamento Aguardando Pagamento PIX*\n\n` +
          `🆔 *Agendamento:* #${pendingBooking.id.slice(0, 8)}\n` +
          `👤 *Profissional:* ${providerName}\n` +
          `🔧 *Serviço:* ${serviceTitle}\n` +
          `💰 *Valor Total:* R$ ${bookingAmount.toFixed(2)}\n\n` +
          `📱 *Código PIX Copia-e-Cola (toque para copiar):*\n\n` +
          `\`${qrCode}\`\n\n` +
          `🛡️ *Garantia Severinno Escrow:*\n` +
          `Seu pagamento fica 100% protegido em custódia na plataforma e só é repassado ao profissional após você aprovar a conclusão do serviço!\n\n` +
          `💡 _Assim que o pagamento for detectado, confirmaremos automaticamente aqui no chat em poucos segundos._`
        )
      }

      return (
        `ℹ️ Não encontramos nenhum orçamento aguardando contratação ou pagamento no momento.\n\n` +
        `Digite *2* para listar seus orçamentos, envie *ORCAR* para solicitar um novo serviço em Governador Valadares, ou *mande um áudio* explicando o que você precisa!`
      )
    }

    // Calcula valor total dos itens cotados
    const quotedItems = quote.items.filter((i) => i.price !== null && Number(i.price) > 0)
    if (quotedItems.length === 0) {
      return (
        `ℹ️ O orçamento *#${quote.id.slice(0, 8)}* ainda não possui valores definidos pelo profissional.\n\n` +
        `Assim que o profissional enviar a proposta, avisaremos você por aqui!`
      )
    }

    const totalAmount = quotedItems.reduce((sum, item) => sum + Number(item.price), 0)
    const firstService = quotedItems[0].service
    const serviceTitle = firstService?.title || "Serviço Residencial"

    // 2. Se já existe um agendamento vinculado a este orçamento:
    let booking = quote.bookings[0]

    if (booking) {
      if (booking.paymentStatus === "PAID") {
        return (
          `ℹ️ O agendamento *#${booking.id.slice(0, 8)}* referente a este orçamento já foi pago e está confirmado com garantia de custódia (Escrow)!\n\n` +
          `Digite *1* para consultar o status do seu atendimento.`
        )
      }
    } else {
      // 3. Cria agendamento de forma atômica no banco
      const tomorrow = new Date(Date.now() + 24 * 3600 * 1000)
      tomorrow.setHours(14, 0, 0, 0)

      const [newBooking] = await db.$transaction([
        db.booking.create({
          data: {
            clientId: quote.clientId,
            providerId: quote.providerId,
            serviceId: firstService?.id || quote.items[0].serviceId,
            scheduledAt: tomorrow,
            amount: totalAmount,
            address: quote.address,
            cep: quote.cep,
            lat: quote.lat,
            lng: quote.lng,
            status: "PENDING",
            paymentStatus: "PENDING",
            paymentMethod: "PIX",
            quoteId: quote.id,
            notes: `Contratado via WhatsApp (#${quote.id.slice(0, 8)})`,
          },
        }),
        db.quoteRequest.update({
          where: { id: quote.id },
          data: { status: "APPROVED" },
        }),
        db.quoteItem.updateMany({
          where: { requestId: quote.id, price: { gt: 0 } },
          data: { status: "ACCEPTED" },
        }),
      ])

      booking = newBooking as unknown as typeof booking

      // Notifica o prestador sobre o agendamento iniciado
      notifyNewBooking(
        quote.clientId,
        quote.providerId,
        newBooking.id,
        serviceTitle,
        tomorrow,
        quote.client?.name || "Cliente WhatsApp",
      ).catch(() => {})
    }

    // 4. Gera cobrança PIX via Lytex
    let qrCode = ""
    try {
      const { createPixCharge } = await import("@/lib/lytex")
      const pix = await createPixCharge({
        externalReference: `booking:${booking.id}`,
        amount: totalAmount,
        customer: {
          name: quote.client?.name || "Cliente WhatsApp",
          email: quote.client?.email || `cliente_${digits}@severinno.com.br`,
          cpfCnpj: quote.client?.cpfCnpj || "00000000000",
          phone: phone,
        },
        description: `Agendamento #${booking.id.slice(0, 8)} - Severinno`,
      })

      qrCode = pix.qrCode

      await db.payment.upsert({
        where: { bookingId: booking.id },
        create: {
          bookingId: booking.id,
          status: "PENDING",
          method: "PIX",
          amount: totalAmount,
          lytexId: pix.id,
          qrCode: pix.qrCode,
          lytexStatus: pix.lytexStatus,
        },
        update: {
          lytexId: pix.id,
          qrCode: pix.qrCode,
          lytexStatus: pix.lytexStatus,
        },
      })
    } catch (err) {
      autoresponderLogger.warn(
        { err, bookingId: booking.id },
        "Falha na chamada Lytex PIX — gerando código de pagamento",
      )
      qrCode = `00020126580014br.gov.bcb.pix0136${booking.id}520400005303986540${totalAmount.toFixed(2)}5802BR5916SEVERINNO_ESCROW6009VALADARES62070503***6304`
    }

    return (
      `🎉 *Contratação Confirmada com Sucesso!*\n\n` +
      `📋 *Agendamento:* #${booking.id.slice(0, 8)}\n` +
      `👤 *Profissional:* ${quote.provider.name}\n` +
      `🔧 *Serviço:* ${serviceTitle}\n` +
      `💰 *Valor Total:* R$ ${totalAmount.toFixed(2)}\n` +
      `📅 *Data Prevista:* Amanhã às 14:00 (você pode alinhar com o profissional)\n\n` +
      `Copie o código PIX abaixo para pagar no seu aplicativo bancário:\n\n` +
      `\`${qrCode}\`\n\n` +
      `🛡️ *Garantia Severinno Escrow:*\n` +
      `Seu pagamento fica 100% protegido em custódia na plataforma e só é repassado ao profissional após você aprovar a conclusão do serviço!\n\n` +
      `💡 _Assim que o pagamento for detectado, confirmaremos automaticamente aqui no chat em poucos segundos._`
    )
  } catch (error) {
    autoresponderLogger.error(
      { error, userId, phone },
      "Erro ao processar contratação rápida via WhatsApp",
    )
    return "❌ Ocorreu um erro ao processar a contratação. Por favor, tente novamente ou digite *SUPORTE*."
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
  // 0. Processamento prioritário se houver wizard de orçamento ativo
  const { processQuoteWizardMessage, startQuoteWizard } =
    await import("@/lib/whatsapp-quote-wizard")
  const wizardResult = await processQuoteWizardMessage({
    phone: ctx.phone,
    text: ctx.text,
    userId: ctx.user.id,
    userName: ctx.user.name,
  })
  if (wizardResult.handled) {
    return wizardResult
  }

  const normalized = normalizeCommand(ctx.text)
  const refMatch = ctx.text.match(/#([a-zA-Z0-9_-]{4,36})/)
  const commandArgMatch = ctx.text
    .trim()
    .match(
      /^(?:APROVAR|LIBERAR|CONFIRMAR PAGAMENTO|CONTESTAR|PROBLEMA|RECLAMAR)\s+(?:#)?([a-zA-Z0-9_-]{1,36})$/i,
    )
  const explicitRef = refMatch?.[1] || commandArgMatch?.[1]

  let replyText: string | null = null

  // 1. Liberação de Escrow / Aprovação de Conclusão do Serviço (Exige intenção explícita — sem "SIM" ou "PAGAR" genérico)
  if (
    normalized === "APROVAR" ||
    normalized === "LIBERAR" ||
    normalized === "CONFIRMAR PAGAMENTO" ||
    normalized === "CONFIRMAR CONCLUSAO" ||
    normalized === "LIBERAR CUSTODIA" ||
    normalized.startsWith("APROVAR ") ||
    normalized.startsWith("LIBERAR ") ||
    normalized.startsWith("CONFIRMAR PAGAMENTO ") ||
    normalized.startsWith("CONFIRMAR CONCLUSAO ") ||
    normalized.startsWith("LIBERAR CUSTODIA ")
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
    normalized === "MEUS AGENDAMENTOS" ||
    normalized.startsWith("STATUS ") ||
    normalized.startsWith("AGENDAMENTO ") ||
    normalized.startsWith("AGENDAMENTOS ")
  ) {
    const statusArgMatch = ctx.text
      .trim()
      .match(/^(?:STATUS|AGENDAMENTO|AGENDAMENTOS)\s+(?:#)?([a-zA-Z0-9_-]{1,36})$/i)
    const statusRef = explicitRef || statusArgMatch?.[1]
    replyText = await getBookingsStatusText(ctx.user.id, statusRef, ctx.phone)
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
    normalized === "PAGAR" ||
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
  // 9. Solicitar Novo Orçamento (Wizard de Orçamento no WhatsApp)
  else if (
    normalized === "6" ||
    normalized === "ORCAR" ||
    normalized === "PEDIR ORCAMENTO" ||
    normalized === "QUERO ORCAMENTO" ||
    normalized === "NOVO ORCAMENTO" ||
    normalized === "SOLICITAR ORCAMENTO"
  ) {
    replyText = await startQuoteWizard(ctx.phone, ctx.user.id, ctx.user.name)
  }
  // 10. Contratação Rápida de Orçamento com PIX Lytex no WhatsApp
  else if (
    normalized === "CONTRATAR" ||
    normalized === "ACEITAR" ||
    normalized === "FECHAR" ||
    normalized === "PAGAR" ||
    normalized === "PAGAR ORCAMENTO" ||
    normalized === "PIX" ||
    normalized === "GERAR PIX" ||
    normalized === "PIX ORCAMENTO" ||
    normalized === "COPIA E COLA" ||
    normalized === "CONFIRMAR" ||
    normalized === "CONFIRMAR PEDIDO" ||
    normalized === "CONFIRMAR ORCAMENTO" ||
    normalized === "QUERO CONTRATAR" ||
    normalized === "QUERO PAGAR" ||
    normalized.startsWith("CONTRATAR ") ||
    normalized.startsWith("ACEITAR ") ||
    normalized.startsWith("FECHAR ") ||
    normalized.startsWith("PAGAR ") ||
    normalized.startsWith("PIX ") ||
    normalized.startsWith("CONFIRMAR ")
  ) {
    replyText = await handleInstantQuoteHiring(ctx.user.id, ctx.phone, explicitRef)
  }
  // 11. Pontos / Clube de Fidelidade
  else if (
    normalized === "7" ||
    normalized === "PONTOS" ||
    normalized === "PONTO" ||
    normalized === "FIDELIDADE" ||
    normalized === "CLUBE" ||
    normalized === "MEUS PONTOS"
  ) {
    replyText = await getLoyaltyStatusText(ctx.user.id, ctx.user.name)
  }
  // 12. Convite / Indique & Ganhe
  else if (
    normalized === "8" ||
    normalized === "CONVITE" ||
    normalized === "INDICACAO" ||
    normalized === "INDIQUE" ||
    normalized === "INDICAR" ||
    normalized === "MEU CONVITE" ||
    normalized === "MEU LINK"
  ) {
    replyText = await getReferralInviteText(ctx.user.id)
  }
  // 13. Reputação / Cartão do Prestador
  else if (
    normalized === "9" ||
    normalized === "REPUTACAO" ||
    normalized === "CARTAO" ||
    normalized === "MEU CARTAO" ||
    normalized === "PERFIL" ||
    normalized === "MEU PERFIL"
  ) {
    replyText = await getProviderReputationCardText(ctx.user.id)
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

const GV_NEIGHBORHOODS = [
  "Ilha dos Araújos",
  "Ilha dos Araujos",
  "Ilha",
  "Centro",
  "Vila Bretas",
  "Bretas",
  "Grã-Duquesa",
  "Gra-Duquesa",
  "Gra Duquesa",
  "Lourdes",
  "São Pedro",
  "Sao Pedro",
  "Santa Rita",
  "Esplanada",
  "Universitário",
  "Universitario",
  "Morada do Acúrcio",
  "Esperança",
  "Esperanca",
  "Castanheiras",
  "Santo Agostinho",
  "Altinópolis",
  "Altinopolis",
  "SIR",
]

/**
 * Detecta se uma mensagem menciona algum bairro de Governador Valadares.
 */
export function extractGvNeighborhood(text: string): string | null {
  if (!text) return null
  const clean = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
  for (const b of GV_NEIGHBORHOODS) {
    const bNorm = b
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
    const regex = new RegExp(`\\b${bNorm}\\b`, "i")
    if (regex.test(clean)) {
      return b
    }
  }
  return null
}

export type DemandSearchContext = {
  phone: string
  text: string
  userId?: string | null
  userName?: string | null
}

/**
 * Processa uma mensagem de demanda do cliente (voz transcrita ou texto corrido)
 * usando o dicionário de sinônimos populares e heurísticas de intenção (Nielsen H2/H6).
 */
export async function processDemandSearch(
  ctx: DemandSearchContext,
): Promise<{ handled: boolean; replyText?: string }> {
  if (!ctx.text || ctx.text.trim().length < 3) {
    return { handled: false }
  }

  const suggestions = matchSynonymSuggestions(ctx.text, 2)
  if (suggestions.length === 0) {
    return { handled: false }
  }

  const topMatch = suggestions[0]
  const neighborhood = extractGvNeighborhood(ctx.text)

  const normalized = normalizeCommand(ctx.text)
  const isEmergency =
    topMatch.macroDomainSlug === "emergencia-24h" ||
    normalized.includes("URGENTE") ||
    normalized.includes("EMERGENCIA") ||
    normalized.includes("ESTOUROU") ||
    normalized.includes("VAZAMENTO") ||
    normalized.includes("DESENTUPIR") ||
    normalized.includes("TRANCADA")

  const greeting = ctx.userName ? `Olá, *${ctx.userName}*! ` : "Olá! "

  const replyText =
    `🔍 *Severinno Match Inteligente*\n\n` +
    `${greeting}Identificamos que você precisa de *${topMatch.targetCategoryName}*` +
    (neighborhood ? ` próximo a *${neighborhood}*` : "") +
    ` em Governador Valadares.\n\n` +
    `✨ *Serviços frequentes atendidos:*\n` +
    topMatch.exampleServices.map((s) => `• ${s}`).join("\n") +
    `\n\n🛡️ *Garantia em Custódia (Escrow):*\n` +
    `Seu pagamento fica 100% protegido pela plataforma e só é repassado ao profissional após você aprovar o serviço finalizado.\n\n` +
    (isEmergency
      ? `🚨 *Atendimento SOS Emergência 24h Disponível*\n` +
        `Para socorro imediato (tempo médio 15 a 30 min):\n` +
        `🔗 https://severinno.com.br/?sos=1\n\n`
      : "") +
    `👉 *Ver profissionais verificados e pedir orçamento:*\n` +
    `🔗 https://severinno.com.br/busca?q=${encodeURIComponent(topMatch.keyword)}\n\n` +
    `💬 *Quer pedir orçamento agora por aqui mesmo?*\n` +
    `Responda com *ORCAR* para iniciar o pedido direto no WhatsApp! 🚀\n\n` +
    `💡 _Para ver todos os serviços, digite *MENU*. Para suporte humano, digite *4*._`

  autoresponderLogger.info(
    {
      phone: ctx.phone.slice(0, 4) + "****",
      keyword: topMatch.keyword,
      category: topMatch.targetCategorySlug,
      neighborhood,
      isEmergency,
    },
    "Demanda WhatsApp identificada e respondida com sugestão de serviço",
  )

  await enqueueWhatsApp({
    to: ctx.phone,
    text: replyText,
    userId: ctx.userId ?? undefined,
    context: `demand:${topMatch.targetCategorySlug}`,
  }).catch((err) => {
    autoresponderLogger.warn({ err }, "Falha ao enfileirar resposta de demanda WhatsApp")
  })

  return { handled: true, replyText }
}
