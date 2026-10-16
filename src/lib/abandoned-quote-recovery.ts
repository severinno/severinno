/**
 * abandoned-quote-recovery.ts — Recuperação Ativa de Cotações Abandonadas no WhatsApp
 *
 * Motor automatizado para resgatar cotações pendentes:
 * 1. Identifica orçamentos solicitados há mais de 15 minutos sem agendamento correspondente.
 * 2. Aplica filtro anti-spam estrito: máximo de 1 mensagem de recuperação por cliente a cada 7 dias.
 * 3. Envia mensagem personalizada e persuasiva com link direto de 1 clique para finalizar a contratação.
 * 4. Registra histórico completo no WhatsAppMessageLog para auditoria e controle de frequência.
 */

import { db } from "@/lib/db"
import { sendText } from "@/lib/evolution"
import logger from "@/lib/logger"

export interface QuoteRecoveryOptions {
  minAgeMinutes?: number // Mínimo de tempo após a criação (default: 15 min)
  maxAgeHours?: number // Máximo de tempo após a criação (default: 24h)
  antiSpamDays?: number // Janela de proteção anti-spam (default: 7 dias)
  dryRun?: boolean // Se verdadeiro, simula sem enviar
}

export type RecoveryItemStatus =
  "RECOVERED" | "SKIPPED_SPAM" | "SKIPPED_NO_PHONE" | "SKIPPED_ALREADY_BOOKED" | "FAILED"

export interface QuoteRecoveryDetail {
  quoteId: string
  clientId: string
  clientName: string
  phone: string
  serviceTitle: string
  status: RecoveryItemStatus
  reason?: string
}

export interface QuoteRecoveryResult {
  id: string
  executedAt: string
  totalEligible: number
  recoveredCount: number
  skippedSpamCount: number
  skippedNoPhoneCount: number
  skippedAlreadyBookedCount: number
  failedCount: number
  details: QuoteRecoveryDetail[]
}

/**
 * Normaliza o número de telefone para o padrão do WhatsApp (55 + DDD + Número)
 */
export function formatWhatsAppNumber(phone: string): string {
  const digits = phone.replace(/\D/g, "")
  if (!digits) return ""
  if (digits.startsWith("55") && digits.length >= 12) return digits
  if (digits.length >= 10 && digits.length <= 11) return `55${digits}`
  return digits
}

/**
 * Gera o texto personalizado e amigável da mensagem de recuperação
 */
export function buildRecoveryMessage(params: {
  clientName: string
  serviceTitle: string
  providerName: string
  quoteId: string
  appUrl?: string
}): string {
  const firstName = params.clientName.trim().split(" ")[0] || "Cliente"
  const baseUrl = params.appUrl || process.env.NEXT_PUBLIC_APP_URL || "https://severinno.com"
  const quoteUrl = `${baseUrl.replace(/\/$/, "")}/?view=client.quotes&quoteId=${encodeURIComponent(params.quoteId)}`

  return (
    `Olá, ${firstName}! 👋\n\n` +
    `Notamos que você solicitou um orçamento para *${params.serviceTitle}* com o profissional ${params.providerName} no Severinno, mas ainda não concluiu seu agendamento.\n\n` +
    `Ficou com alguma dúvida ou precisa de ajuda com data e horário?\n\n` +
    `👉 *Acesse seu orçamento e confirme em 1 minuto* com garantia de pagamento seguro (custódia escrow):\n` +
    `${quoteUrl}\n\n` +
    `Se precisar de suporte, basta responder a esta mensagem!`
  )
}

/**
 * Executa a rotina de recuperação ativa de cotações abandonadas
 */
export async function runAbandonedQuoteRecovery(
  options: QuoteRecoveryOptions = {},
): Promise<QuoteRecoveryResult> {
  const minAgeMinutes = options.minAgeMinutes ?? 15
  const maxAgeHours = options.maxAgeHours ?? 24
  const antiSpamDays = options.antiSpamDays ?? 7
  const dryRun = options.dryRun ?? false

  const now = new Date()
  const executedAt = now.toISOString()
  const minCreatedAt = new Date(now.getTime() - minAgeMinutes * 60 * 1000)
  const maxCreatedAt = new Date(now.getTime() - maxAgeHours * 60 * 60 * 1000)
  const spamThreshold = new Date(now.getTime() - antiSpamDays * 24 * 60 * 60 * 1000)

  logger.info(
    { minAgeMinutes, maxAgeHours, antiSpamDays, dryRun },
    "[quote-recovery] Iniciando varredura de cotações abandonadas",
  )

  // 1. Busca cotações elegíveis (pendentes na janela de tempo e sem reservas ativas)
  const eligibleQuotes = await db.quoteRequest.findMany({
    where: {
      status: "PENDING",
      createdAt: {
        lte: minCreatedAt,
        gte: maxCreatedAt,
      },
    },
    include: {
      client: {
        select: {
          id: true,
          name: true,
          whatsapp: true,
          phone: true,
        },
      },
      provider: {
        select: {
          id: true,
          name: true,
        },
      },
      items: {
        include: {
          service: {
            select: {
              title: true,
            },
          },
        },
        take: 1,
      },
      bookings: {
        select: {
          id: true,
          status: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 100, // Limite por lote para execução previsível
  })

  const details: QuoteRecoveryDetail[] = []
  let recoveredCount = 0
  let skippedSpamCount = 0
  let skippedNoPhoneCount = 0
  let skippedAlreadyBookedCount = 0
  let failedCount = 0

  for (const quote of eligibleQuotes) {
    const rawPhone = quote.client.whatsapp || quote.client.phone
    const phone = rawPhone ? formatWhatsAppNumber(rawPhone) : ""
    const serviceTitle = quote.items[0]?.service?.title || "Serviço Residencial"

    // Verificação 1: Já possui agendamento gerado para esta cotação?
    if (quote.bookings && quote.bookings.length > 0) {
      skippedAlreadyBookedCount++
      details.push({
        quoteId: quote.id,
        clientId: quote.clientId,
        clientName: quote.client.name,
        phone,
        serviceTitle,
        status: "SKIPPED_ALREADY_BOOKED",
        reason: "Cotação já convertida em agendamento",
      })
      continue
    }

    // Verificação 2: Possui telefone cadastrado?
    if (!phone) {
      skippedNoPhoneCount++
      details.push({
        quoteId: quote.id,
        clientId: quote.clientId,
        clientName: quote.client.name,
        phone: "",
        serviceTitle,
        status: "SKIPPED_NO_PHONE",
        reason: "Cliente não possui telefone ou WhatsApp cadastrado",
      })
      continue
    }

    // Verificação 3: Anti-spam — já recebeu mensagem de recuperação nos últimos 7 dias?
    const recentRecoveryLog = await db.whatsAppMessageLog.findFirst({
      where: {
        OR: [{ userId: quote.clientId }, { phone }],
        context: "quote:recovery",
        createdAt: { gte: spamThreshold },
      },
    })

    if (recentRecoveryLog) {
      skippedSpamCount++
      details.push({
        quoteId: quote.id,
        clientId: quote.clientId,
        clientName: quote.client.name,
        phone,
        serviceTitle,
        status: "SKIPPED_SPAM",
        reason: `Cliente já recebeu recuperação recente em ${recentRecoveryLog.createdAt.toISOString()}`,
      })
      continue
    }

    // Preparar mensagem
    const messageText = buildRecoveryMessage({
      clientName: quote.client.name,
      serviceTitle,
      providerName: quote.provider.name,
      quoteId: quote.id,
    })

    if (dryRun) {
      recoveredCount++
      details.push({
        quoteId: quote.id,
        clientId: quote.clientId,
        clientName: quote.client.name,
        phone,
        serviceTitle,
        status: "RECOVERED",
        reason: "[Simulação] Mensagem qualificada para envio",
      })
      continue
    }

    // Enviar mensagem real
    try {
      await sendText(phone, messageText)

      // Registrar log para controle e auditoria
      await db.whatsAppMessageLog.create({
        data: {
          phone,
          text: messageText,
          userId: quote.clientId,
          context: "quote:recovery",
          status: "SENT",
          sentAt: new Date(),
          metadata: {
            quoteId: quote.id,
            providerId: quote.providerId,
            serviceTitle,
          },
        },
      })

      recoveredCount++
      details.push({
        quoteId: quote.id,
        clientId: quote.clientId,
        clientName: quote.client.name,
        phone,
        serviceTitle,
        status: "RECOVERED",
      })

      logger.info(
        { quoteId: quote.id, clientId: quote.clientId, phone },
        "[quote-recovery] Mensagem de recuperação enviada com sucesso",
      )
    } catch (err) {
      failedCount++
      const errorMsg = err instanceof Error ? err.message : String(err)
      details.push({
        quoteId: quote.id,
        clientId: quote.clientId,
        clientName: quote.client.name,
        phone,
        serviceTitle,
        status: "FAILED",
        reason: errorMsg,
      })

      logger.error(
        { err: errorMsg, quoteId: quote.id, clientId: quote.clientId },
        "[quote-recovery] Falha ao enviar mensagem de recuperação via WhatsApp",
      )
    }
  }

  const result: QuoteRecoveryResult = {
    id: `recov_${Date.now()}`,
    executedAt,
    totalEligible: eligibleQuotes.length,
    recoveredCount,
    skippedSpamCount,
    skippedNoPhoneCount,
    skippedAlreadyBookedCount,
    failedCount,
    details,
  }

  logger.info(
    {
      totalEligible: result.totalEligible,
      recovered: result.recoveredCount,
      skippedSpam: result.skippedSpamCount,
      skippedNoPhone: result.skippedNoPhoneCount,
    },
    "[quote-recovery] Varredura de cotações concluída",
  )

  return result
}
