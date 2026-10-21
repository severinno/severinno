export const dynamic = "force-dynamic"

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

import crypto from "node:crypto"
import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { evolutionLogger } from "@/lib/evolution"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { processInteractiveCommand, processDemandSearch } from "@/lib/whatsapp-autoresponder"
import { cacheGet, cacheSet } from "@/lib/redis"

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
async function findUserByPhone(
  phone: string,
): Promise<{ id: string; name: string; role: string } | null> {
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
    select: { id: true, name: true, role: true },
  })

  return user
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * Comparação em tempo constante para prevenir timing attacks.
 */
function safeCompare(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return crypto.timingSafeEqual(bufA, bufB)
}

/**
 * Verifica assinatura HMAC-SHA256 da Evolution API.
 * Suporta headers 'x-evolution-signature', 'x-hub-signature-256' ou 'x-webhook-signature'.
 */
function verifyEvolutionHmac(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
): boolean {
  if (!signatureHeader || !secret) return false
  const expectedSig = crypto.createHmac("sha256", secret).update(rawBody).digest("hex")
  const rawSig = signatureHeader.replace(/^sha256=/, "").trim()
  return safeCompare(rawSig, expectedSig)
}

/**
 * POST /api/webhooks/evolution
 *
 * Recebe eventos da Evolution API.
 * Sempre retorna 200 para evitar reenvios quando autenticado.
 */
export async function POST(request: Request) {
  try {
    // ── Autenticação Mandatória Fail-Closed da Evolution API ───────────────
    const evolutionSecret = process.env.EVOLUTION_WEBHOOK_SECRET || process.env.EVOLUTION_API_KEY
    const isProduction = process.env.NODE_ENV === "production"

    if (isProduction && !evolutionSecret) {
      evolutionLogger.error(
        "Webhook Evolution: EVOLUTION_WEBHOOK_SECRET ou EVOLUTION_API_KEY não configurado — rejeitando fail-closed em produção",
      )
      return NextResponse.json({ error: "Webhook authentication unconfigured" }, { status: 500 })
    }

    // ── Ler body BRUTO para validação HMAC e depois parsear ─────────────
    const rawBody = await request.text()
    let body: any
    try {
      body = JSON.parse(rawBody)
    } catch {
      evolutionLogger.warn("Webhook Evolution: corpo JSON inválido — descartando graciosamente")
      return NextResponse.json({ received: true })
    }

    if (evolutionSecret) {
      const authHeader = request.headers.get("authorization")
      const apiKey = request.headers.get("apikey")
      const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : apiKey || ""

      const hmacHeader =
        request.headers.get("x-evolution-signature") ||
        request.headers.get("x-hub-signature-256") ||
        request.headers.get("x-webhook-signature")

      const isTokenValid = token ? safeCompare(token, evolutionSecret) : false
      const isHmacValid = hmacHeader
        ? verifyEvolutionHmac(rawBody, hmacHeader, evolutionSecret)
        : false

      if (!isTokenValid && !isHmacValid) {
        evolutionLogger.warn(
          "Webhook Evolution: autenticação inválida ou ausente (HMAC/Token falhou)",
        )
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
      }

      // Prevenção contra replay attacks quando timestamp é fornecido
      const timestampHeader =
        request.headers.get("x-evolution-timestamp") || request.headers.get("x-webhook-timestamp")
      if (timestampHeader) {
        const ts = new Date(timestampHeader).getTime()
        if (!isNaN(ts) && Math.abs(Date.now() - ts) > 10 * 60 * 1000) {
          evolutionLogger.warn(
            { timestampHeader },
            "Webhook Evolution: timestamp expirado (> 10min)",
          )
          return NextResponse.json({ error: "Timestamp expirado" }, { status: 401 })
        }
      }
    }

    // 🛡️ Rate limit dedicado para chamadas autenticadas da Evolution API (evita DoS de terceiros)
    await assertRateLimit(request, RATE_LIMITS.webhookEvolution)

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

        // 🛡️ Deduplicação idempotente de mensagens recebidas (evita double-reply em retries da Evolution)
        const messageId = key.id
        if (messageId) {
          const dedupKey = `evo:msg:${messageId}`
          try {
            const seen = await cacheGet(dedupKey)
            if (seen) {
              evolutionLogger.info(
                { messageId },
                "Webhook Evolution: mensagem duplicada ignorada (dedup)",
              )
              return NextResponse.json({ ok: true, deduplicated: true })
            }
            await cacheSet(dedupKey, 1, 3600)
          } catch (err) {
            evolutionLogger.warn(
              { err, messageId },
              "Webhook Evolution: falha no check de dedup (prosseguindo)",
            )
          }
        }

        const remoteJid = key.remoteJid
        if (!remoteJid) break

        // Extrair número do remetente
        const senderNumber = extractNumber(remoteJid)
        if (!senderNumber) break

        // Ignora mídias sem legenda ou mensagens vazias antes de bater no banco de dados
        const hasContent = Boolean(
          message?.conversation ||
          message?.extendedTextMessage?.text ||
          message?.audioMessage ||
          message?.voiceMessage ||
          message?.locationMessage ||
          message?.liveLocationMessage,
        )
        if (!hasContent) break

        // Buscar usuário pelo número
        const user = await findUserByPhone(senderNumber)
        if (user) {
          evolutionLogger.info(
            { userId: user.id, event: "messages.upsert" },
            "Webhook Evolution: mensagem recebida de usuário cadastrado",
          )
        }

        // ── 0. Verificar se a mensagem é um compartilhamento de localização (Check-in GPS) ──
        const isLive = Boolean(message?.liveLocationMessage)
        const locMsg = message?.liveLocationMessage || message?.locationMessage
        if (
          user &&
          locMsg &&
          typeof locMsg.degreesLatitude === "number" &&
          typeof locMsg.degreesLongitude === "number"
        ) {
          const { processLocationCheckin } = await import("@/lib/whatsapp-autoresponder")
          const locResult = await processLocationCheckin({
            phone: senderNumber,
            lat: locMsg.degreesLatitude,
            lng: locMsg.degreesLongitude,
            accuracy: locMsg.accuracyInMeters ?? null,
            isLiveLocation: isLive,
            user: {
              id: user.id,
              name: user.name,
              role: user.role,
            },
          })

          if (locResult.handled) {
            evolutionLogger.info(
              { userId: user.id, lat: locMsg.degreesLatitude, lng: locMsg.degreesLongitude },
              "Webhook Evolution: check-in por localização WhatsApp processado com sucesso",
            )
            break
          }
        }

        // Extrair texto ou transcrição de áudio da mensagem
        let text = ""
        const isAudio = Boolean(message?.audioMessage || message?.voiceMessage)
        if (message?.conversation) {
          text = message.conversation
        } else if (message?.extendedTextMessage?.text) {
          text = message.extendedTextMessage.text
        } else if (isAudio) {
          // Transcrição de áudio se disponível nos campos da Evolution API
          text =
            message.audioMessage?.text ||
            message.audioMessage?.caption ||
            message.voiceMessage?.text ||
            ""

          // Se o áudio já possui texto transcrito pela Evolution API, processa com Voice-to-Quote inteligente
          if (text) {
            try {
              const { processVoiceQuote } = await import("@/lib/whatsapp-voice-quote")
              const voiceResult = await processVoiceQuote(text, undefined, senderNumber)
              const { enqueueWhatsApp } = await import("@/lib/whatsapp-queue")
              await enqueueWhatsApp({
                to: senderNumber,
                text: voiceResult.formattedReply,
                userId: user?.id,
                context: "audio:smart-voice-quote",
              })
              break
            } catch (err) {
              evolutionLogger.warn(
                { err: (err as Error).message },
                "Webhook Evolution: falha no processamento smart voice quote",
              )
            }
          } else {
            // Se o áudio não tem transcrição de texto prévia, tenta transcrever o payload de áudio via Whisper
            const base64Audio =
              message.audioMessage?.base64 ||
              message.voiceMessage?.base64 ||
              data?.base64 ||
              data?.message?.base64
            const audioUrl = message.audioMessage?.url || message.voiceMessage?.url

            if (
              base64Audio ||
              (audioUrl && typeof audioUrl === "string" && audioUrl.startsWith("http"))
            ) {
              try {
                let buffer: Buffer | null = null
                if (base64Audio) {
                  buffer = Buffer.from(base64Audio, "base64")
                } else if (audioUrl) {
                  const audioRes = await fetch(audioUrl, { signal: AbortSignal.timeout(10_000) })
                  if (audioRes.ok) {
                    const arrBuf = await audioRes.arrayBuffer()
                    buffer = Buffer.from(arrBuf)
                  }
                }

                if (buffer && buffer.length > 0) {
                  const { processVoiceQuote } = await import("@/lib/whatsapp-voice-quote")
                  const voiceResult = await processVoiceQuote(buffer, undefined, senderNumber)
                  const { enqueueWhatsApp } = await import("@/lib/whatsapp-queue")
                  await enqueueWhatsApp({
                    to: senderNumber,
                    text: voiceResult.formattedReply,
                    userId: user?.id,
                    context: "audio:whisper-voice-quote",
                  })
                  break
                }
              } catch (audioErr) {
                evolutionLogger.warn(
                  { err: (audioErr as Error).message },
                  "Webhook Evolution: falha na transcrição de áudio via Whisper, acionando fallback",
                )
              }
            }
          }
        }

        // Se for áudio sem transcrição direta de texto e sem sucesso no Whisper:
        if (isAudio && !text) {
          const { enqueueWhatsApp } = await import("@/lib/whatsapp-queue")
          const audioReply =
            `🎙️ *Áudio Recebido no Severinno!*\n\n` +
            `Olá! Recebemos sua mensagem de voz.\n\n` +
            `Para localizarmos o melhor profissional verificado em Governador Valadares (Eletricista, Encanador, Chaveiro 24h, Faxina ou Frete):\n\n` +
            `1️⃣ Digite em poucas palavras o que precisa (ex: _"trocar chuveiro na Ilha"_, _"vazamento pia"_, _"chaveiro urgente"_)\n` +
            `2️⃣ Digite *MENU* para ver as opções interativas\n` +
            `3️⃣ Ou acesse a vitrine direta com garantia Escrow: https://severinno.com.br\n\n` +
            `🚨 Para emergência imediata: https://severinno.com.br/?sos=1`

          await enqueueWhatsApp({
            to: senderNumber,
            text: audioReply,
            userId: user?.id,
            context: "audio:auto-guidance",
          }).catch(() => {})
          break
        }

        if (!text) break // ignora mensagens sem texto e sem localização tratada

        // ── 1. Verificar se a mensagem é um comando interativo / autoresponder ──
        // Comandos como APROVAR, CONTESTAR, MENU, AGENDAMENTOS, PIX etc.
        const interactiveResult = await processInteractiveCommand({
          phone: senderNumber,
          text,
          user: user ?? {
            id: `anon-${senderNumber}`,
            name: null,
            role: "CLIENT",
          },
        })

        if (interactiveResult.handled) {
          evolutionLogger.info(
            { userId: user?.id, phone: senderNumber.slice(0, 4) + "****" },
            "Webhook Evolution: mensagem respondida automaticamente pelo autoresponder",
          )
          break
        }

        // ── 1b. Transcrição / Parsing de Demanda de Serviços (Sugestão 4) ──
        // Mapeia termos cotidianos ("chuveiro queimado", "chaveiro urgente") para especialidades e bairros de GV
        const demandResult = await processDemandSearch({
          phone: senderNumber,
          text,
          userId: user?.id,
          userName: user?.name,
        })

        if (demandResult.handled) {
          evolutionLogger.info(
            { userId: user?.id, phone: senderNumber.slice(0, 4) + "****" },
            "Webhook Evolution: demanda de serviço identificada e atendida automaticamente",
          )
          break
        }

        // ── 1c. Triagem Inteligente de WhatsApp com IA Híbrida (Ollama Local / Groq / Fallback) ──
        const { processAiTriage } = await import("@/lib/whatsapp-ai-triage")
        const aiTriageResult = await processAiTriage({
          phone: senderNumber,
          text,
          user: user ?? null,
          remoteJid,
        })

        if (aiTriageResult.handled) {
          evolutionLogger.info(
            {
              userId: user?.id,
              phone: senderNumber.slice(0, 4) + "****",
              intent: aiTriageResult.intent,
              category: aiTriageResult.category,
              engine: aiTriageResult.engineUsed,
            },
            "Webhook Evolution: mensagem triada e respondida com IA híbrida",
          )
          break
        }

        // Se o usuário não está cadastrado e a mensagem não foi tratada por comando, demanda ou IA:
        if (!user) {
          evolutionLogger.info(
            { number: senderNumber.slice(0, 6) + "****" },
            "Webhook Evolution: mensagem de número não cadastrado não tratada por autoresponder",
          )
          break
        }

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

      // ── Status de Entrega da Mensagem (Receipts / ACKs) ──
      case "messages.update": {
        // Formato Evolution v2:
        // data pode ser array de updates ou objeto com key e status / ack
        // status numérico ou string: 2 / "DELIVERY_ACK", 3 / 4 / "READ"
        const updates = Array.isArray(data) ? data : [data]

        for (const item of updates) {
          const messageId = item?.key?.id ?? item?.id
          const rawStatus = item?.status ?? item?.update?.status ?? item?.ack

          if (!messageId) continue

          let nextStatus: "SENT" | "DELIVERED" | "READ" | "FAILED" | null = null

          if (
            rawStatus === 2 ||
            rawStatus === "DELIVERY_ACK" ||
            rawStatus === "delivered" ||
            rawStatus === "DELIVERED"
          ) {
            nextStatus = "DELIVERED"
          } else if (
            rawStatus === 3 ||
            rawStatus === 4 ||
            rawStatus === "READ" ||
            rawStatus === "read" ||
            rawStatus === "PLAYED"
          ) {
            nextStatus = "READ"
          } else if (rawStatus === "FAILED" || rawStatus === "ERROR" || rawStatus === 0) {
            nextStatus = "FAILED"
          }

          if (nextStatus) {
            try {
              const updated = await db.whatsAppMessageLog.updateMany({
                where: { messageId },
                data: {
                  status: nextStatus,
                  ...(nextStatus === "DELIVERED" ? { deliveredAt: new Date() } : {}),
                  ...(nextStatus === "READ" ? { readAt: new Date() } : {}),
                },
              })

              if (updated.count > 0) {
                evolutionLogger.debug(
                  { messageId, nextStatus, count: updated.count },
                  "Webhook Evolution: status de mensagem atualizado no banco",
                )
              }
            } catch (err) {
              evolutionLogger.warn(
                { err, messageId },
                "Webhook Evolution: erro ao atualizar status do log no banco",
              )
            }
          }
        }

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
