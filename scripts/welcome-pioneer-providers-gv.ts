/**
 * scripts/welcome-pioneer-providers-gv.ts — Notificação e Boas-Vindas aos 20 Prestadores Pioneiros de GV
 *
 * Envia mensagens personalizadas de boas-vindas pelo WhatsApp (Evolution API)
 * para os 20 prestadores pioneiros de Governador Valadares, apresentando seus links
 * de vitrine pública e serviços homologados.
 *
 * Usage:
 *   bun run scripts/welcome-pioneer-providers-gv.ts [--dry-run] [--send]
 *
 * Exit codes:
 *   0 — Sucesso
 *   1 — Falha
 */

export {}

// Mock server-only when running as standalone script in Bun
if (typeof (globalThis as Record<string, unknown>).Bun !== "undefined") {
  try {
    const bunTestModule = "bun:test"
    const { mock } = (await import(bunTestModule)) as {
      mock: { module: (name: string, fn: () => Record<string, unknown>) => void }
    }
    mock.module("server-only", () => ({}))
  } catch {}
}

import { PrismaClient } from "@prisma/client"

const db = new PrismaClient()

const IS_DRY_RUN = !process.argv.includes("--send")
const EVOLUTION_URL = process.env.EVOLUTION_API_URL || "http://127.0.0.1:8080"
const EVOLUTION_KEY = process.env.EVOLUTION_API_KEY || ""
const EVOLUTION_INSTANCE = process.env.EVOLUTION_INSTANCE || "severinno"

async function runWelcomeBroadcast() {
  console.log("================================================================================")
  console.log("📲 DISPARO DE BOAS-VINDAS — FROTA PIONEIRA DE GOVERNADOR VALADARES (MG)")
  console.log(
    `   • Modo: ${IS_DRY_RUN ? "🔍 SIMULAÇÃO / DRY-RUN (Nenhuma mensagem externa enviada)" : "🚀 DISPARO REAL VIA WHATSAPP (Evolution API)"}`,
  )
  console.log("================================================================================\n")

  const providers = await db.user.findMany({
    where: {
      id: { startsWith: "prov-gv-" },
      role: "PROVIDER",
    },
    include: {
      services: {
        where: { active: true },
        select: { title: true, basePrice: true, unit: true },
      },
    },
    orderBy: { district: "asc" },
  })

  console.log(
    `📋 Encontrados ${providers.length} prestadores pioneiros cadastrados no banco de dados.\n`,
  )

  let successCount = 0
  let skippedCount = 0

  for (const [index, p] of providers.entries()) {
    const firstName = p.name.split(" — ")[0].split(" ")[0]
    const specialty = p.name.split(" — ")[1] || "Profissional Verificado"
    const profileUrl = `https://severinno.com/prestador/${p.slug}`

    const servicesSummary = p.services
      .slice(0, 3)
      .map(
        (s) => `  • *${s.title}* — R$ ${Number(s.basePrice).toFixed(2)} (${s.unit.toLowerCase()})`,
      )
      .join("\n")

    const messageText = `Olá, *${firstName}*! 🚀

Seja muito bem-vindo à *Frota Pioneira de Prestadores de Governador Valadares* no Severinno Marketplace!

⭐ *Seu perfil profissional de ${specialty} já está verificado e publicado na vitrine:*
👉 ${profileUrl}

📍 *Bairro de Base:* ${p.district} (Cobertura: 15 km em GV)
🛠️ *Seus Serviços Ativos:*
${servicesSummary}

A partir de agora, clientes de Governador Valadares podem solicitar agendamentos diretamente pelo marketplace ou via WhatsApp com pagamento Pix sob custódia garantida.

A nossa Torre de Controle está 100% à sua disposição!`

    console.log(`[${(index + 1).toString().padStart(2, "0")}/${providers.length}] 👤 ${p.name}`)
    console.log(`    📍 Bairro: ${p.district} | WhatsApp: ${p.whatsapp}`)
    console.log(`    🔗 Link Vitrine: ${profileUrl}`)

    if (IS_DRY_RUN) {
      console.log(
        `    📝 Mensagem formatada com sucesso (${messageText.length} caracteres) [DRY-RUN]`,
      )
      skippedCount++
    } else {
      // Disparo real via Evolution API
      const cleanPhone = (p.whatsapp || p.phone || "").replace(/\D/g, "")
      try {
        const response = await fetch(`${EVOLUTION_URL}/message/sendText/${EVOLUTION_INSTANCE}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: EVOLUTION_KEY,
          },
          body: JSON.stringify({
            number: cleanPhone,
            text: messageText,
          }),
        })

        if (response.ok) {
          console.log(`    ✅ Mensagem WhatsApp enviada com sucesso!`)
          successCount++
        } else {
          const errData = await response.text()
          console.log(`    ⚠️ Falha no envio Evolution API: ${errData}`)
          skippedCount++
        }
      } catch (err: unknown) {
        console.log(`    ❌ Erro de conexão Evolution API: ${String(err)}`)
        skippedCount++
      }
    }
    console.log("────────────────────────────────────────────────────────────────────────────────")
  }

  console.log("\n================================================================================")
  console.log("📊 RESUMO DO DISPARO:")
  console.log(`   • Total de Prestadores na Frota: ${providers.length}`)
  console.log(`   • Mensagens Enviadas com Sucesso: ${successCount}`)
  console.log(`   • Mensagens em Simulação / Pendentes: ${skippedCount}`)
  if (IS_DRY_RUN) {
    console.log("💡 Para disparar de verdade após escanear o QR Code da Evolution API, execute:")
    console.log("   bun run scripts/welcome-pioneer-providers-gv.ts --send")
  }
  console.log("================================================================================\n")
}

runWelcomeBroadcast()
  .catch((err) => {
    console.error("Erro fatal no disparo de boas-vindas:", err)
    process.exit(1)
  })
  .finally(async () => {
    await db.$disconnect()
  })
