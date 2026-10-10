import "server-only"

/**
 * Fila assíncrona de WhatsApp via RabbitMQ para o Severinno Marketplace.
 *
 * Desacopla os disparos de mensagens WhatsApp (Evolution API / Baileys)
 * das requisições HTTP do Next.js, garantindo:
 *  - Latência zero no caminho crítico da API (bookings, pagamentos, webhooks).
 *  - Retries automáticos com backoff exponencial pelo RabbitMQ.
 *  - Dead-Letter Queue (DLQ) para mensagens que excedam tentativas.
 *  - Proteção contra throttling e rate limiting da Meta/WhatsApp.
 */

import { publish } from "./queue"
import { sendText, formatPhone, isValidWhatsApp } from "./evolution"
import logger from "./logger"

const whatsappLogger = logger.child({ module: "whatsapp-queue" })

export type WhatsAppQueuePayload = {
  /** Telefone de destino (com ou sem DDI 55) */
  to: string
  /** Texto da mensagem a ser enviada */
  text: string
  /** ID do usuário associado (opcional, para correlação/auditoria) */
  userId?: string
  /** Contexto do disparo (ex.: "booking:123:pix", "quote:456:response") */
  context?: string
  /** Timestamp de publicação */
  timestamp?: string
}

/**
 * Enfileira uma mensagem WhatsApp para envio assíncrono via RabbitMQ.
 * Retorna imediatamente (<3ms), sem bloquear a resposta HTTP.
 */
export async function enqueueWhatsApp(payload: {
  to: string
  text: string
  userId?: string
  context?: string
}): Promise<void> {
  const formatted = formatPhone(payload.to)

  if (!isValidWhatsApp(formatted)) {
    whatsappLogger.warn(
      { to: payload.to, context: payload.context, userId: payload.userId },
      "WhatsApp inválido ignorado antes de enfileirar",
    )
    return
  }

  await publish({
    routingKey: "whatsapp.message",
    payload: {
      to: formatted,
      text: payload.text,
      userId: payload.userId,
      context: payload.context,
      timestamp: new Date().toISOString(),
    },
  })

  whatsappLogger.debug(
    { to: formatted.slice(0, 4) + "****", context: payload.context },
    "Mensagem WhatsApp enfileirada no RabbitMQ",
  )
}

/**
 * Consumer do RabbitMQ: processa mensagens da fila 'whatsapp'.
 * Chamado pelo worker de background (notification-worker).
 */
export async function handleWhatsAppMessage(msg: Record<string, unknown>): Promise<void> {
  const { to, text, userId, context } = msg as unknown as WhatsAppQueuePayload

  if (!to || !text) {
    whatsappLogger.warn({ msg }, "Payload de WhatsApp inválido recebido da fila — ignorando")
    return
  }

  whatsappLogger.info(
    { to: to.slice(0, 4) + "****", userId, context },
    "Disparando mensagem de WhatsApp via fila",
  )

  try {
    const res = await sendText(to, text)
    whatsappLogger.info(
      { to: to.slice(0, 4) + "****", messageId: res.key?.id, context },
      "WhatsApp entregue com sucesso via Evolution API",
    )
  } catch (error) {
    whatsappLogger.error(
      { err: error, to: to.slice(0, 4) + "****", context },
      "Falha no envio de WhatsApp — mensagem será reenviada pelo RabbitMQ",
    )
    // Relança o erro para que o amqplib aplique nack e acione retries/DLQ
    throw error
  }
}
