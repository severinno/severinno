/**
 * whatsapp-pix-checkout.ts — WhatsApp Conversational Commerce com Pix Copia-e-Cola Nativo
 *
 * Elimina o atrito do checkout enviando o código Pix Copia-e-Cola puro diretamente
 * no chat do WhatsApp da Evolution API.
 *
 * Estratégia de Envio em Três Etapas:
 * 1. Mensagem de Resumo: Detalha o serviço, valor e a garantia do escrow protegido.
 * 2. Mensagem Exclusiva de Pix: Contém RIGOROSAMENTE apenas a chave/código Copia-e-Cola
 *    (sem títulos, emojis ou espaços extras), permitindo que o cliente toque e copie no celular com 1 toque.
 * 3. Imagem do QR Code: Imagem direta no WhatsApp para pagamento rápido em segundo aparelho.
 */

export interface WhatsAppPixCheckoutParams {
  bookingId: string
  clientName: string
  clientPhone: string
  providerName: string
  serviceTitle: string
  amount: number
  pixCopyPaste: string
  qrCodeBase64?: string
  qrCodeUrl?: string
}

export interface WhatsAppMessagePayload {
  recipientPhone: string
  messageType: "TEXT" | "MEDIA"
  content: string
  mediaBase64?: string
  mediaUrl?: string
  caption?: string
}

export interface WhatsAppPixCheckoutBundle {
  bookingId: string
  clientPhone: string
  summaryMessage: WhatsAppMessagePayload
  pixCodeOnlyMessage: WhatsAppMessagePayload
  qrCodeMessage?: WhatsAppMessagePayload
  totalAmount: number
}

/**
 * Normaliza número de telefone para o padrão WhatsApp internacional (DDI + DDD + número).
 */
export function normalizeWhatsAppNumber(phone: string): string {
  const digits = phone.replace(/\D/g, "")
  if (digits.length === 10 || digits.length === 11) {
    return `55${digits}`
  }
  return digits
}

/**
 * Gera o pacote completo de mensagens para checkout nativo no WhatsApp.
 */
export function generateWhatsAppPixCheckoutBundle(
  params: WhatsAppPixCheckoutParams,
): WhatsAppPixCheckoutBundle {
  const {
    bookingId,
    clientName,
    clientPhone,
    providerName,
    serviceTitle,
    amount,
    pixCopyPaste,
    qrCodeBase64,
    qrCodeUrl,
  } = params

  const recipientPhone = normalizeWhatsAppNumber(clientPhone)
  const formattedAmount = amount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })

  // 1. Mensagem de Resumo e Garantia
  const summaryText =
    `🧾 *SEVERINNO — Pagamento Seguro Protegido*\n\n` +
    `Olá, *${clientName}*! Seu agendamento para *${serviceTitle}* com o prestador *${providerName}* está pronto.\n\n` +
    `💰 *Valor Total:* ${formattedAmount}\n` +
    `🔒 *Garantia Escrow:* O valor fica em custódia segura e só é liberado para o prestador após a conclusão do serviço e a sua aprovação!\n\n` +
    `👇 *Copie o código Pix na mensagem abaixo:*`

  const summaryMessage: WhatsAppMessagePayload = {
    recipientPhone,
    messageType: "TEXT",
    content: summaryText,
  }

  // 2. Mensagem Exclusiva do Pix (apenas o código puro para cópia rápida com 1 toque)
  const cleanPixCode = pixCopyPaste.trim()
  const pixCodeOnlyMessage: WhatsAppMessagePayload = {
    recipientPhone,
    messageType: "TEXT",
    content: cleanPixCode,
  }

  // 3. Imagem do QR Code (opcional se fornecida)
  let qrCodeMessage: WhatsAppMessagePayload | undefined
  if (qrCodeBase64 || qrCodeUrl) {
    qrCodeMessage = {
      recipientPhone,
      messageType: "MEDIA",
      content: "QR Code Pix",
      caption: `📸 Escaneie este QR Code para pagar ${formattedAmount} via Pix`,
      mediaBase64: qrCodeBase64,
      mediaUrl: qrCodeUrl,
    }
  }

  return {
    bookingId,
    clientPhone: recipientPhone,
    summaryMessage,
    pixCodeOnlyMessage,
    qrCodeMessage,
    totalAmount: amount,
  }
}

/**
 * Formata o recibo digital imediato de confirmação de pagamento para WhatsApp.
 */
export function formatWhatsAppPixPaymentReceipt(params: {
  bookingId: string
  clientName: string
  providerName: string
  amount: number
  scheduledAt?: string
  trackingUrl?: string
}): string {
  const { bookingId, clientName, providerName, amount, scheduledAt, trackingUrl } = params
  const formattedAmount = amount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
  const scheduleText = scheduledAt ? `\n⏰ *Horário:* ${scheduledAt}` : ""
  const mapText = trackingUrl ? `\n🗺️ *Acompanhar Prestador:* ${trackingUrl}` : ""

  return (
    `✅ *PAGAMENTO CONFIRMADO COM SUCESSO!*\n\n` +
    `Olá *${clientName}*, confirmamos o recebimento do seu Pix de *${formattedAmount}* para o serviço #${bookingId.slice(-6)}.\n\n` +
    `👨‍🔧 *Prestador:* ${providerName}${scheduleText}\n` +
    `🔒 *Status:* Valor retido com segurança na Custódia Severinno.${mapText}\n\n` +
    `O prestador já foi avisado e iniciará o deslocamento. Obrigado por confiar no Severinno!`
  )
}
