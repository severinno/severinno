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
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"

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
  await assertRateLimit(request, RATE_LIMITS.webhookSentry)
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

        // ── Roteamento para o destinatário apropriado ────────────────
        // Estratégia (4 níveis):
        //   1. Booking  — se a mensagem contém #abc12345, extrai o ID
        //      e roteia para a outra parte do agendamento.
        //   2. Quote    — mesma lógica para solicitações de orçamento.
        //   3. Último   — último contato no sistema de mensagens.
        //      contato
        //   4. Admin    — primeiro admin ativo como fallback.
        // ──────────────────────────────────────────────────────────────

        const refMatch = text.match(/#([a-zA-Z0-9]{6,12})/)
        const ref = refMatch?.[1]
        let recipientId: string | null = null
        let bookingId: string | null = null

        // ── 1. Tentar referência de booking ─────────────────────────
        if (ref && !recipientId) {
          try {
            const booking = await db.booking.findFirst({
              where: {
                OR: [{ id: { startsWith: ref } }, { id: ref }],
              },
              select: { id: true, clientId: true, providerId: true },
            })

            if (booking) {
              bookingId = booking.id
              recipientId = booking.clientId === user.id ? booking.providerId : booking.clientId

              evolutionLogger.debug(
                { bookingId: booking.id, recipientId },
                "Webhook Evolution: destinatário via referência de booking",
              )
            }
          } catch {
            evolutionLogger.warn(
              { ref },
              "Webhook Evolution: erro ao buscar booking por referência",
            )
          }
        }

        // ── 2. Tentar referência de quote request ──────────────────
        if (ref && !recipientId) {
          try {
            const quote = await db.quoteRequest.findFirst({
              where: {
                OR: [{ id: { startsWith: ref } }, { id: ref }],
              },
              select: { id: true, clientId: true, providerId: true },
            })

            if (quote) {
              recipientId = quote.clientId === user.id ? quote.providerId : quote.clientId

              evolutionLogger.debug(
                { quoteId: quote.id, recipientId },
                "Webhook Evolution: destinatário via referência de quote",
              )
            }
          } catch {
            evolutionLogger.warn({ ref }, "Webhook Evolution: erro ao buscar quote por referência")
          }
        }

        // ── 3. Último contato no sistema de mensagens ──────────────
        if (!recipientId) {
          try {
            const lastMessage = await db.message.findFirst({
              where: {
                OR: [{ fromId: user.id }, { toId: user.id }],
              },
              orderBy: { createdAt: "desc" },
              select: { fromId: true, toId: true },
            })

            if (lastMessage) {
              recipientId = lastMessage.fromId === user.id ? lastMessage.toId : lastMessage.fromId

              evolutionLogger.debug(
                { recipientId },
                "Webhook Evolution: destinatário via último contato",
              )
            }
          } catch {
            evolutionLogger.warn(
              { userId: user.id },
              "Webhook Evolution: erro ao buscar último contato",
            )
          }
        }

        // ── 4. Fallback: admin disponível ──────────────────────────
        if (!recipientId) {
          try {
            const admin = await db.user.findFirst({
              where: { role: "ADMIN", active: true },
              select: { id: true },
              orderBy: { createdAt: "asc" },
            })

            if (admin) {
              recipientId = admin.id

              evolutionLogger.info(
                { recipientId },
                "Webhook Evolution: destinatário fallback — admin",
              )
            }
          } catch {
            evolutionLogger.warn(
              { userId: user.id },
              "Webhook Evolution: erro ao buscar admin para fallback",
            )
          }
        }

        // ── Se ainda não tem destinatário, abortar ──────────────────
        if (!recipientId) {
          evolutionLogger.warn(
            { userId: user.id },
            "Webhook Evolution: não foi possível determinar destinatário — sem booking, quote, contato anterior ou admin disponível",
          )
          break
        }

        // ── Validar que o destinatário está ativo ───────────────────
        try {
          const recipientActive = await db.user.findUnique({
            where: { id: recipientId },
            select: { active: true },
          })
          if (!recipientActive?.active) {
            evolutionLogger.warn(
              { recipientId },
              "Webhook Evolution: destinatário resolvido está inativo — mensagem descartada",
            )
            break
          }
        } catch {
          evolutionLogger.warn({ recipientId }, "Webhook Evolution: erro ao validar destinatário")
          break
        }

        // ── Persistir mensagem no banco ────────────────────────────
        try {
          await db.message.create({
            data: {
              fromId: user.id,
              toId: recipientId,
              content: text,
              bookingId,
              read: false,
            },
          })
        } catch {
          evolutionLogger.error(
            { userId: user.id, recipientId },
            "Webhook Evolution: falha ao persistir mensagem",
          )
          break
        }

        // ── Notificação in-app para o destinatário (best-effort) ───
        await db.notification
          .create({
            data: {
              userId: recipientId,
              type: "MESSAGE",
              title: `Nova mensagem de ${user.name}`,
              body: text.length > 80 ? text.slice(0, 80) + "…" : text,
              read: false,
            },
          })
          .catch(() => {
            /* ignore notification errors — best-effort */
          })

        evolutionLogger.info(
          {
            userId: user.id,
            recipientId,
            bookingId: bookingId ?? undefined,
            contentLength: text.length,
          },
          "Webhook Evolution: mensagem roteada e persistida com sucesso",
        )

        break
      }

      // ── Status da conexão ──
      case "connection.update": {
        const status = data?.instance?.status ?? "unknown"

        evolutionLogger.info({ instance, status }, "Webhook Evolution: atualização de conexão")

        if (status === "disconnected" || status === "error") {
          evolutionLogger.warn(
            { instance, status },
            "Webhook Evolution: instância desconectada! Reconecte via painel.",
          )
        }

        break
      }

      default:
        evolutionLogger.debug({ event }, "Webhook Evolution: evento não tratado")
    }

    return NextResponse.json({ received: true })
  } catch (e) {
    evolutionLogger.error({ err: e }, "Webhook Evolution: erro no processamento")
    return NextResponse.json({ received: true })
  }
}

// ---------------------------------------------------------------------------
// Testing exports (__testing__ prefix)
// ---------------------------------------------------------------------------
// Helpers internos exportados apenas para testes diretos — mesmo padrão do
// redis.ts (__testing__degradeTier). Não fazem parte da API pública; o POST
// continua chamando as funções internas (vi.mock não intercepta chamadas
// internas, então os testes de roteamento controlam o comportamento via
// payload e do mock do db).

export { extractNumber as __testing__extractNumber, findUserByPhone as __testing__findUserByPhone }
