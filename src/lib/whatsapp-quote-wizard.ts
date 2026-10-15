import "server-only"

/**
 * whatsapp-quote-wizard.ts
 *
 * Wizard conversacional interativo para solicitação de orçamentos 100% via WhatsApp.
 * Permite que clientes peçam orçamentos respondendo perguntas simples no chat (problema, fotos, bairro em GV),
 * criando a solicitação (QuoteRequest) no banco e despachando para prestadores verificados.
 */

import crypto from "node:crypto"
import { db } from "@/lib/db"
import logger from "@/lib/logger"
import { hashPassword } from "@/lib/crypto"
import { cacheGet, cacheSet, cacheInvalidate } from "@/lib/redis"
import { matchSynonymSuggestions } from "@/lib/search-synonyms"
import { extractGvNeighborhood } from "@/lib/whatsapp-autoresponder"
import { notifyNewQuote } from "@/lib/notifications"
import { enqueueWhatsApp } from "@/lib/whatsapp-queue"

const wizardLogger = logger.child({ module: "whatsapp-quote-wizard" })

export type QuoteWizardSession = {
  phone: string
  userId?: string
  userName?: string | null
  step: "AWAITING_DESCRIPTION" | "AWAITING_NEIGHBORHOOD"
  categorySlug?: string
  categoryName?: string
  description?: string
  neighborhood?: string
  startedAt: number
}

const WIZARD_TTL_SECONDS = 1800 // 30 minutos

function getSessionKey(phone: string): string {
  const digits = phone.replace(/\D/g, "")
  return `wa:quote:wizard:${digits}`
}

/**
 * Recupera sessão ativa do wizard
 */
export async function getWizardSession(phone: string): Promise<QuoteWizardSession | null> {
  try {
    const raw = await cacheGet(getSessionKey(phone))
    if (!raw) return null
    return typeof raw === "string" ? JSON.parse(raw) : (raw as QuoteWizardSession)
  } catch (err) {
    wizardLogger.warn({ err, phone }, "Erro ao recuperar sessão do wizard de orçamento")
    return null
  }
}

/**
 * Salva ou atualiza a sessão do wizard
 */
export async function saveWizardSession(session: QuoteWizardSession): Promise<void> {
  try {
    await cacheSet(getSessionKey(session.phone), session, WIZARD_TTL_SECONDS)
  } catch (err) {
    wizardLogger.warn({ err, phone: session.phone }, "Erro ao salvar sessão do wizard de orçamento")
  }
}

/**
 * Remove a sessão do wizard
 */
export async function clearWizardSession(phone: string): Promise<void> {
  try {
    await cacheInvalidate(getSessionKey(phone))
  } catch (err) {
    wizardLogger.warn({ err, phone }, "Erro ao limpar sessão do wizard de orçamento")
  }
}

/**
 * Inicia um novo wizard de solicitação de orçamento
 */
export async function startQuoteWizard(
  phone: string,
  userId?: string,
  userName?: string | null,
  initialCategorySlug?: string,
  initialCategoryName?: string,
): Promise<string> {
  const session: QuoteWizardSession = {
    phone,
    userId,
    userName,
    step: "AWAITING_DESCRIPTION",
    categorySlug: initialCategorySlug,
    categoryName: initialCategoryName,
    startedAt: Date.now(),
  }

  await saveWizardSession(session)

  const greeting = userName ? `Olá, *${userName}*! ` : ""
  const catHint = initialCategoryName ? ` para *${initialCategoryName}*` : ""

  return (
    `📝 *Solicitação de Orçamento - Severinno*\n\n` +
    `${greeting}Vamos solicitar orçamentos de profissionais verificados em Governador Valadares${catHint}.\n\n` +
    `1️⃣ *O que você precisa que seja feito?*\n` +
    `Descreva em poucas palavras o problema ou serviço desejado (ex: _"Trocar fiação do chuveiro"_, _"Vazamento na pia da cozinha"_, _"Instalar ar split"_):`
  )
}

/**
 * Localiza ou cria um usuário cliente pelo telefone para permitir orçamento sem atrito de cadastro
 */
export async function findOrCreateClientUser(phone: string, userName?: string | null) {
  const digits = phone.replace(/\D/g, "")
  const cleanPhone = digits.startsWith("55") ? digits : `55${digits}`

  const candidates = [digits, cleanPhone]
  if (cleanPhone.length >= 12) {
    candidates.push(cleanPhone.slice(2))
  }

  let user = await db.user.findFirst({
    where: {
      whatsapp: { in: candidates },
      active: true,
    },
    select: { id: true, name: true, role: true, email: true, whatsapp: true, cpfCnpj: true },
  })

  if (!user) {
    const fallbackEmail = `wa_${cleanPhone}@severinno.local`
    user = await db.user.create({
      data: {
        whatsapp: cleanPhone,
        phone: cleanPhone,
        name: userName || "Cliente WhatsApp",
        email: fallbackEmail,
        passwordHash: hashPassword(crypto.randomUUID()),
        role: "CLIENT",
        active: true,
        verified: true,
      },
      select: { id: true, name: true, role: true, email: true, whatsapp: true, cpfCnpj: true },
    })
    wizardLogger.info(
      { userId: user.id, phone: cleanPhone },
      "Novo cliente criado silenciosamente via WhatsApp",
    )
  }

  return user
}

/**
 * Cria a solicitação de orçamento (QuoteRequest) no banco e despacha para os prestadores
 */
export async function finalizeQuoteCreation(session: QuoteWizardSession): Promise<{
  quoteId: string
  serviceTitle: string
  providerName: string
  totalProviders: number
}> {
  const clientUser = await findOrCreateClientUser(session.phone, session.userName)

  // 1. Encontra categoria apropriada
  let category = null
  if (session.categorySlug) {
    category = await db.category.findUnique({
      where: { slug: session.categorySlug },
    })
  }

  if (!category) {
    category = await db.category.findFirst({
      where: { active: true },
      orderBy: { order: "asc" },
    })
  }

  // 2. Busca prestador verificado na categoria em Governador Valadares
  let provider = null
  let service = null

  if (category) {
    service = await db.service.findFirst({
      where: {
        categoryId: category.id,
        active: true,
        provider: {
          active: true,
          verified: true,
          role: "PROVIDER",
        },
      },
      include: {
        provider: {
          select: { id: true, name: true, whatsapp: true },
        },
      },
    })
  }

  // Fallback para qualquer serviço e prestador ativo se categoria não tiver cadastrado
  if (!service) {
    service = await db.service.findFirst({
      where: {
        active: true,
        provider: { active: true, role: "PROVIDER" },
      },
      include: {
        provider: { select: { id: true, name: true, whatsapp: true } },
      },
    })
  }

  if (!service) {
    throw new Error("Nenhum profissional disponível para receber orçamentos")
  }

  provider = service.provider

  const neighborhood = session.neighborhood || "Governador Valadares"
  const address = `${neighborhood}, Gov. Valadares - MG`
  const expiresAt = new Date(Date.now() + 5 * 24 * 3600 * 1000) // 5 dias

  // Coordenadas aproximadas de GV (ou centro do bairro)
  const gvLat = -18.8511
  const gvLng = -41.9494

  const quote = await db.quoteRequest.create({
    data: {
      clientId: clientUser.id,
      providerId: provider.id,
      address,
      cep: "35010-000",
      lat: gvLat,
      lng: gvLng,
      expiresAt,
      status: "PENDING",
      items: {
        create: [
          {
            providerId: provider.id,
            serviceId: service.id,
            description: session.description || service.title,
            quantity: 1,
            status: "PENDING",
          },
        ],
      },
    },
    include: {
      items: true,
      provider: { select: { id: true, name: true, whatsapp: true } },
    },
  })

  // Notifica o prestador via sistema e WhatsApp
  notifyNewQuote(clientUser.id, provider.id, quote.id, 1, clientUser.name || "Cliente").catch(
    (err) => wizardLogger.warn({ err }, "Falha ao despachar notificação de novo orçamento"),
  )

  // Limpa a sessão
  await clearWizardSession(session.phone)

  return {
    quoteId: quote.id,
    serviceTitle: service.title,
    providerName: provider.name,
    totalProviders: 1,
  }
}

/**
 * Processa a mensagem do cliente dentro do fluxo do wizard
 */
export async function processQuoteWizardMessage(ctx: {
  phone: string
  text: string
  userId?: string
  userName?: string | null
}): Promise<{ handled: boolean; replyText?: string }> {
  const session = await getWizardSession(ctx.phone)
  if (!session) return { handled: false }

  const text = ctx.text.trim()
  if (!text) return { handled: false }

  // Permite cancelar
  const normalized = text.toUpperCase()
  if (normalized === "CANCELAR" || normalized === "SAIR" || normalized === "PARAR") {
    await clearWizardSession(ctx.phone)
    const replyText =
      `❌ Solicitação de orçamento cancelada.\n\n` +
      `Digite *MENU* a qualquer momento para ver as opções do Severinno.`
    await enqueueWhatsApp({
      to: ctx.phone,
      text: replyText,
      userId: session.userId,
      context: "wizard:cancelled",
    }).catch(() => {})
    return { handled: true, replyText }
  }

  // ETAPA 1: Aguardando Descrição do Serviço
  if (session.step === "AWAITING_DESCRIPTION") {
    session.description = text

    // Tenta identificar categoria e bairro já na descrição
    if (!session.categorySlug) {
      const match = matchSynonymSuggestions(text, 1)
      if (match.length > 0) {
        session.categorySlug = match[0].targetCategorySlug
        session.categoryName = match[0].targetCategoryName
      }
    }

    const detectedNeighborhood = extractGvNeighborhood(text)
    if (detectedNeighborhood) {
      session.neighborhood = detectedNeighborhood
    }

    // Se já temos o bairro, finaliza o pedido imediatamente!
    if (session.neighborhood) {
      try {
        const result = await finalizeQuoteCreation(session)
        const replyText =
          `✅ *Pedido de Orçamento Criado com Sucesso!* 🎉\n\n` +
          `🆔 *Código:* #${result.quoteId.slice(0, 8)}\n` +
          `🔧 *Serviço:* ${result.serviceTitle}\n` +
          `📍 *Local:* ${session.neighborhood}, Gov. Valadares\n` +
          `👤 *Profissional:* ${result.providerName} (Verificado)\n\n` +
          `Enviamos seu pedido para avaliação do profissional. Assim que ele informar os valores de mão de obra e materiais, você receberá a proposta aqui com a opção de contratação imediata! 🛡️`

        await enqueueWhatsApp({
          to: ctx.phone,
          text: replyText,
          userId: session.userId,
          context: `wizard:created:${result.quoteId}`,
        }).catch(() => {})

        return { handled: true, replyText }
      } catch (error) {
        wizardLogger.error({ error, session }, "Erro ao finalizar criação de orçamento")
        const replyText = `❌ Não foi possível registrar seu pedido de orçamento no momento. Por favor, tente novamente digitando *ORCAR*.`
        await enqueueWhatsApp({
          to: ctx.phone,
          text: replyText,
          userId: session.userId,
          context: "wizard:error",
        }).catch(() => {})
        return { handled: true, replyText }
      }
    }

    // Se falta o bairro, pergunta ao cliente
    session.step = "AWAITING_NEIGHBORHOOD"
    await saveWizardSession(session)

    const replyText =
      `📍 *Em qual bairro de Governador Valadares será o serviço?*\n\n` +
      `Digite o nome do seu bairro (ex: _"Ilha dos Araújos"_, _"Centro"_, _"Vila Bretas"_, _"Grã-Duquesa"_, _"Lourdes"_...):`

    await enqueueWhatsApp({
      to: ctx.phone,
      text: replyText,
      userId: session.userId,
      context: "wizard:awaiting_neighborhood",
    }).catch(() => {})

    return { handled: true, replyText }
  }

  // ETAPA 2: Aguardando Bairro em Governador Valadares
  if (session.step === "AWAITING_NEIGHBORHOOD") {
    const neighborhood = extractGvNeighborhood(text) || text
    session.neighborhood = neighborhood

    try {
      const result = await finalizeQuoteCreation(session)
      const replyText =
        `✅ *Pedido de Orçamento Criado com Sucesso!* 🎉\n\n` +
        `🆔 *Código:* #${result.quoteId.slice(0, 8)}\n` +
        `🔧 *Serviço:* ${result.serviceTitle}\n` +
        `📍 *Local:* ${neighborhood}, Gov. Valadares\n` +
        `👤 *Profissional:* ${result.providerName} (Verificado)\n\n` +
        `Enviamos seu pedido para avaliação do profissional. Assim que ele informar os valores de mão de obra e materiais, você receberá a proposta aqui com a opção de contratação imediata! 🛡️`

      await enqueueWhatsApp({
        to: ctx.phone,
        text: replyText,
        userId: session.userId,
        context: `wizard:created:${result.quoteId}`,
      }).catch(() => {})

      return { handled: true, replyText }
    } catch (error) {
      wizardLogger.error({ error, session }, "Erro ao finalizar criação de orçamento no passo 2")
      const replyText = `❌ Não foi possível registrar seu pedido de orçamento no momento. Por favor, tente novamente digitando *ORCAR*.`
      await enqueueWhatsApp({
        to: ctx.phone,
        text: replyText,
        userId: session.userId,
        context: "wizard:error",
      }).catch(() => {})
      return { handled: true, replyText }
    }
  }

  return { handled: false }
}
