export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { z } from "zod"
import { requireRole } from "@/lib/auth"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { withRoute } from "@/lib/api-route"
import { db } from "@/lib/db"
import {
  fetchInstance,
  getConnectionStatus,
  connectInstance,
  restartInstance,
  logoutInstance,
  getWebhook,
  setWebhook,
  sendText,
  formatPhone,
  isValidWhatsApp,
  evolutionLogger,
} from "@/lib/evolution"

const ActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("test_message"),
    phone: z.string().min(8, "Número de telefone inválido"),
    message: z.string().min(1, "Mensagem não pode ser vazia").max(1000),
  }),
  z.object({
    action: z.literal("connect"),
  }),
  z.object({
    action: z.literal("restart"),
  }),
  z.object({
    action: z.literal("disconnect"),
  }),
  z.object({
    action: z.literal("sync_webhook"),
  }),
])

/**
 * GET /api/admin/whatsapp
 *
 * Retorna o status consolidado da Evolution API:
 * - Estado da conexão (open, connecting, close)
 * - Perfil e telefone pareado
 * - QR code atualizado (quando em connecting ou close)
 * - Configuração de webhook
 * - Métricas da instância
 */
export const GET = withRoute("api.admin.whatsapp.GET", async (request) => {
  await requireRole("ADMIN")
  await assertRateLimit(request, RATE_LIMITS.admin)

  try {
    const instance = await fetchInstance()
    let connectionState = "disconnected"
    let qrData: { base64?: string; code?: string; count?: number } | null = null

    try {
      const conn = await getConnectionStatus()
      connectionState = conn.instance?.status ?? instance?.connectionStatus ?? "disconnected"
    } catch {
      connectionState = instance?.connectionStatus ?? "disconnected"
    }

    // Se estiver conectando ou desconectado, busca o QR code ativo
    if (connectionState !== "open" && connectionState !== "connected") {
      try {
        const connectRes = await connectInstance()
        if (connectRes.base64 || connectRes.code) {
          qrData = {
            base64: connectRes.base64,
            code: connectRes.code,
            count: connectRes.count,
          }
        }
      } catch (qrErr) {
        evolutionLogger.warn({ qrErr }, "Não foi possível obter QR code ativo")
      }
    }

    const webhook = await getWebhook()

    // Buscar últimos 25 disparos de mensagens para auditoria
    const logs = await db.whatsAppMessageLog.findMany({
      take: 25,
      orderBy: { createdAt: "desc" },
      include: {
        user: {
          select: { id: true, name: true, email: true },
        },
      },
    })

    return NextResponse.json({
      instance: {
        name: instance?.name ?? process.env.EVOLUTION_INSTANCE ?? "severinno",
        id: instance?.id ?? null,
        status: connectionState,
        number: instance?.number ?? null,
        profileName: instance?.profileName ?? null,
        profilePicUrl: instance?.profilePicUrl ?? null,
        integration: instance?.integration ?? "WHATSAPP-BAILEYS",
        counts: instance?._count ?? { Message: 0, Contact: 0, Chat: 0 },
      },
      qrcode: qrData,
      webhook: {
        enabled: webhook?.enabled ?? false,
        url: webhook?.url ?? null,
        events: webhook?.events ?? [],
      },
      server: {
        url: process.env.EVOLUTION_API_URL ?? "https://whatsapp.severinno.com",
        version: "v2.3.7",
      },
      logs,
    })
  } catch (error) {
    evolutionLogger.error({ error }, "Falha ao consultar status do WhatsApp")
    return NextResponse.json(
      {
        error: "Falha ao conectar com o serviço Evolution API",
        details: error instanceof Error ? error.message : "Erro desconhecido",
      },
      { status: 502 },
    )
  }
})

/**
 * POST /api/admin/whatsapp
 *
 * Executa ações administrativas no WhatsApp:
 * - test_message: Envia mensagem de teste para um número
 * - connect: Solicita nova sessão/QR code
 * - restart: Reinicia a instância
 * - disconnect: Desconecta o aparelho (logout)
 * - sync_webhook: Sincroniza o webhook da aplicação
 */
export const POST = withRoute("api.admin.whatsapp.POST", async (request) => {
  const auth = await requireRole("ADMIN")
  await assertRateLimit(request, RATE_LIMITS.admin)

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 })
  }

  const parsed = ActionSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Ação ou parâmetros inválidos", issues: parsed.error.issues },
      { status: 400 },
    )
  }

  const data = parsed.data

  try {
    switch (data.action) {
      case "test_message": {
        const formatted = formatPhone(data.phone)
        if (!isValidWhatsApp(formatted)) {
          return NextResponse.json(
            { error: "Número de telefone informado não é um WhatsApp válido" },
            { status: 400 },
          )
        }

        const res = await sendText(formatted, data.message)
        const messageId = res.key?.id ?? null

        // Auditoria: salvar log do disparo de teste
        try {
          await db.whatsAppMessageLog.create({
            data: {
              phone: formatted,
              text: data.message,
              context: "admin:test",
              status: "SENT",
              messageId,
              userId: auth.userId,
              sentAt: new Date(),
            },
          })
        } catch (logErr) {
          evolutionLogger.warn({ logErr }, "Falha ao gravar WhatsAppMessageLog de teste")
        }

        return NextResponse.json({
          success: true,
          message: "Mensagem enviada com sucesso",
          messageId,
          recipient: formatted,
        })
      }

      case "connect": {
        const res = await connectInstance()
        return NextResponse.json({
          success: true,
          qrcode: {
            base64: res.base64,
            code: res.code,
            count: res.count,
          },
        })
      }

      case "restart": {
        await restartInstance()
        return NextResponse.json({
          success: true,
          message: "Instância reiniciada com sucesso",
        })
      }

      case "disconnect": {
        await logoutInstance()
        return NextResponse.json({
          success: true,
          message: "Instância desconectada com sucesso",
        })
      }

      case "sync_webhook": {
        const appUrl = process.env.NEXTAUTH_URL ?? "https://severinno.com"
        const webhookUrl = `${appUrl.replace(/\/$/, "")}/api/webhooks/evolution`
        await setWebhook({
          enabled: true,
          url: webhookUrl,
          events: ["MESSAGES_UPSERT", "MESSAGES_UPDATE", "CONNECTION_UPDATE", "QRCODE_UPDATED"],
        })
        return NextResponse.json({
          success: true,
          message: "Webhook reconfigurado com sucesso",
          url: webhookUrl,
        })
      }
    }
  } catch (error) {
    evolutionLogger.error({ error, action: data.action }, "Erro ao executar ação administrativa")
    return NextResponse.json(
      {
        error: `Falha ao executar ação '${data.action}'`,
        details: error instanceof Error ? error.message : "Erro desconhecido",
      },
      { status: 500 },
    )
  }
})
