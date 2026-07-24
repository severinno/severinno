/**
 * Webhook Evolution API
 *
 * Recebe eventos em tempo real da Evolution API:
 * - `messages.upsert` → nova mensagem recebida
 * - `connection.update` → status da conexão WhatsApp
 *
 * Configuração no servidor Evolution:
 *   POST /webhook/set/{instanceName}
 *   { "enabled": true, "url": "https://seudominio.com.br/api/webhooks/evolution", "events": ["messages.upsert", "connection.update"] }
 *
 * Ou configurar via painel Evolution no ambiente.
 */

import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { evolutionLogger } from "@/lib/evolution"

// ---------------------------------------------------------------------------
// Helper: extrair número do JID (remoteJid)
// ---------------------------------------------------------------------------

/**
 * Extrair número de telefone do formato JID do WhatsApp.
 * Ex: "5511999999999@s.whatsapp.net" → "5511999999999"
 */
function extractNumber(jid: string): string | null {
  const match = jid.match(/^(\d+)@/)
  return match ? match[1] : null
}

/**
 * Buscar usuário pelo número de WhatsApp.
 * Tenta match exato e com/sem DDI 55.
 */
async function findUserByPhone(phone: string): Promise<{ id: string; name: string } | null> {
  const digits = phone.replace(/\D/g, "")

  // Tenta várias combinações
  const candidates = [digits]
  if (digits.length === 13 && digits.startsWith("55")) {
    candidates.push(digits.slice(2)) // remove DDI
  }
  if (digits.length === 12 && digits.startsWith("55")) {
    candidates.push(digits.slice(2))
  }
  if (digits.length === 11) {
    candidates.push(`55${digits}`) // adiciona DDI
  }
  if (digits.length === 10) {
    candidates.push(`55${digits}`)
  }

  const user = await db.user.findFirst({
    where: {
      whatsapp: { in: candidates },
      active: true,
    },
    select: { id: true, name: true },
  })

  return user
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * POST /api/webhooks/evolution
 *
 * Recebe eventos da Evolution API.
 * Sempre retorna 200 para evitar reenvios.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json()

    evolutionLogger.debug(
      { event: body.event, instance: body.instance },
      "Webhook Evolution recebido",
    )

    const { event, data, instance } = body

    switch (event) {
      // ── Mensagem recebida ──
      case "messages.upsert": {
        const key = data?.key
        const message = data?.message

        if (!key || key.fromMe) {
          // Ignorar mensagens enviadas pelo próprio sistema
          break
        }

        const remoteJid = key.remoteJid
        if (!remoteJid) break

        // Extrair número do remetente
        const senderNumber = extractNumber(remoteJid)
        if (!senderNumber) break

        // Extrair texto da mensagem
        let text = ""
        if (message?.conversation) {
          text = message.conversation
        } else if (message?.extendedTextMessage?.text) {
          text = message.extendedTextMessage.text
        }

        if (!text) break // ignora mensagens sem texto (mídia, etc)

        // Buscar usuário pelo número
        const user = await findUserByPhone(senderNumber)
        if (!user) {
          evolutionLogger.info(
            { number: senderNumber.slice(0, 6) + "****" },
            "Webhook Evolution: mensagem de número não cadastrado",
          )
          break
        }

        evolutionLogger.info(
          { userId: user.id, event: "messages.upsert" },
          "Webhook Evolution: mensagem recebida de usuário cadastrado",
        )

        // TODO: rotear mensagem para o destinatário apropriado
        // Por enquanto, apenas logamos a mensagem recebida
        // No futuro: identificar destinatário via contexto da conversa
        // e rotear para o chat correto

        break
      }

      // ── Status da conexão ──
      case "connection.update": {
        const status = data?.instance?.status ?? "unknown"

        evolutionLogger.info(
          { instance, status },
          "Webhook Evolution: atualização de conexão",
        )

        if (status === "disconnected" || status === "error") {
          evolutionLogger.warn(
            { instance, status },
            "Webhook Evolution: instância desconectada! Reconecte via painel.",
          )
        }

        break
      }

      default:
        evolutionLogger.debug(
          { event },
          "Webhook Evolution: evento não tratado",
        )
    }

    return NextResponse.json({ received: true })
  } catch (e) {
    evolutionLogger.error({ err: e }, "Webhook Evolution: erro no processamento")
    return NextResponse.json({ received: true })
  }
}
