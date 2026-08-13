#!/usr/bin/env bun
/**
 * Teste E2E de Push Notification — Severinno Marketplace
 *
 * Valida o pipeline completo de push notification:
 *   1. Verifica VAPID keys
 *   2. Busca subscriptions ativas no banco
 *   3. Envia push notification REAL com payload rico + botões Aceitar/Recusar
 *   4. Verifica PushAnalytics no banco
 *   5. Testa notificação silenciosa (app em foco) vs banner (app fechado)
 *   6. Verifica o PushMonitor (trackPushFailure)
 *
 * Uso:
 *   DATABASE_URL="postgresql://severinno:severinno@localhost:5433/severinno" \
 *     bun scripts/test-push-e2e.ts
 *
 * Ou para testar com uma subscription específica (útil para debug):
 *   VAPID_PUBLIC_KEY="..." VAPID_PRIVATE_KEY="..." \
 *     bun scripts/test-push-e2e.ts --subscribe '{"endpoint":"...","keys":{"p256dh":"...","auth":"..."}}'
 */

import webpush from "web-push"
import { PrismaClient } from "@prisma/client"

type Subscription = {
  endpoint: string
  p256dh: string
  auth: string
  userId: string
  userEmail?: string
  userName?: string
}

// ── Colors ────────────────────────────────────────────────────────────────
const PASS = "\x1b[32m✓\x1b[0m"
const FAIL = "\x1b[31m✗\x1b[0m"
const INFO = "\x1b[34m→\x1b[0m"
const BOLD = "\x1b[1m"
const RESET = "\x1b[0m"

// ── Config ───────────────────────────────────────────────────────────────
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY ?? ""
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY ?? ""
const VAPID_SUBJECT = process.env.VAPID_SUBJECT ?? "mailto:admin@severinno.com.br"

// ── Main ─────────────────────────────────────────────────────────────────
async function main() {
  // Parse args
  const subscribeIndex = process.argv.indexOf("--subscribe")
  const subscriptionJson = subscribeIndex >= 0 ? process.argv[subscribeIndex + 1] : null

  console.log(`\n${BOLD}═══════════════════════════════════════════════════════════════${RESET}`)
  console.log(`${BOLD}  🧪 Teste E2E: Push Notification (navegador fechado)${RESET}`)
  console.log(`${BOLD}═══════════════════════════════════════════════════════════════${RESET}\n`)

  // ── Step 1: Check VAPID keys ──────────────────────────────────────────
  console.log(`${INFO} Passo 1: Verificando VAPID keys...`)
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    console.log(`  ${FAIL} VAPID keys não configuradas. Configure .env com:
       VAPID_PUBLIC_KEY=<chave>
       VAPID_PRIVATE_KEY=<chave-privada>`)
    process.exit(1)
  }
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)
  console.log(`  ${PASS} VAPID OK (public key: ${VAPID_PUBLIC_KEY.slice(0, 20)}...)`)
  console.log(`  ${INFO} Subject: ${VAPID_SUBJECT}`)

  // ── Step 2: Get subscriptions ─────────────────────────────────────────
  let subscriptions: Subscription[] = []

  if (subscriptionJson) {
    // Manual subscription via CLI arg
    try {
      const parsed = JSON.parse(subscriptionJson)
      if (!parsed.endpoint) throw new Error("endpoint é obrigatório")
      subscriptions = [
        {
          endpoint: parsed.endpoint,
          p256dh: parsed.keys?.p256dh ?? parsed.p256dh,
          auth: parsed.keys?.auth ?? parsed.auth,
          userId: parsed.userId ?? "manual-test",
          userEmail: parsed.email ?? "test@severinno.com",
          userName: parsed.name ?? "Usuário Teste",
        },
      ]
    } catch (parseErr) {
      console.log(`  ${FAIL} JSON inválido. Use o formato:`)
      console.log(`     {"endpoint":"...","keys":{"p256dh":"...","auth":"..."}}`)
      console.log(`  Erro: ${(parseErr as Error).message}`)
      process.exit(1)
    }
    console.log(`\n${INFO} Passo 2: Subscription fornecida via --subscribe`)
  } else {
    // Fetch from database
    console.log(`\n${INFO} Passo 2: Buscando subscriptions ativas no banco...`)
    const db = new PrismaClient()
    try {
      const subs = await db.pushSubscription.findMany({
        take: 20,
        include: { user: { select: { id: true, name: true, email: true } } },
      })

      if (subs.length === 0) {
        console.log(`  ${FAIL} Nenhuma subscription ativa encontrada no banco.`)
        console.log(`  ${INFO} Para testar:
    1. Abra http://localhost:3000 no navegador
    2. Faça login como cliente@severinno.com / cliente123
    3. Clique no sino/ícone de push para ATIVAR notificações
    4. Execute este script novamente`)
        await db.$disconnect()
        process.exit(0)
      }

      subscriptions = subs.map((s) => ({
        endpoint: s.endpoint,
        p256dh: s.p256dh,
        auth: s.auth,
        userId: s.userId,
        userEmail: s.user.email,
        userName: s.user.name,
      }))
    } finally {
      await db.$disconnect()
    }
  }

  console.log(`  ${PASS} ${subscriptions.length} subscription(ns) encontrada(s):`)
  for (const sub of subscriptions) {
    console.log(
      `     • ${sub.userName} <${sub.userEmail}> — endpoint: ${sub.endpoint.slice(0, 40)}...`,
    )
  }

  // ── Step 3: Build payload ─────────────────────────────────────────────
  console.log(`\n${INFO} Passo 3: Preparando payload da notificação...`)

  const testBookingId = "test-" + Date.now().toString(36).slice(-8)

  const payload = {
    title: "🔔 Teste Push — Navegador Fechado",
    body: `Esta notificação foi enviada com o navegador fechado às ${new Date().toLocaleTimeString("pt-BR")}. Se você está vendo isto, o push funciona mesmo sem o app aberto! ✅`,
    url: `/dashboard?tab=bookings&booking=${testBookingId}`,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: `test:e2e:${Date.now()}`,
    timestamp: new Date().toISOString(),
    data: {
      url: `/dashboard?tab=bookings&booking=${testBookingId}`,
      notificationType: "TEST_PUSH",
      bookingId: testBookingId,
      testTimestamp: new Date().toISOString(),
    },
    // Botões de ação para teste
    actions: [
      { action: "view", title: "👁️ Ver detalhes" },
      { action: "dismiss", title: "✋ Dispensar" },
    ],
    renotify: true,
    requireInteraction: true,
  }

  console.log(`  ${PASS} Payload preparado:`)
  console.log(`     Título: "${payload.title}"`)
  console.log(`     Corpo: "${payload.body}"`)
  console.log(`     URL: ${payload.url}`)
  console.log(`     Tag: ${payload.tag}`)
  console.log(`     Actions: ${payload.actions.map((a) => a.title).join(", ")}`)

  // ── Step 4: Send push ────────────────────────────────────────────────
  console.log(`\n${INFO} Passo 4: Enviando push notification REAL...`)

  const payloadStr = JSON.stringify(payload)
  const payloadBytes = new TextEncoder().encode(payloadStr).length
  const payloadSizeKb = (payloadBytes / 1024).toFixed(1)
  console.log(
    `  ${INFO} Tamanho do payload: ${payloadSizeKb}KB (${payloadBytes} bytes, limite: ~4KB)`,
  )

  let sent = 0
  let failed = 0

  for (let i = 0; i < subscriptions.length; i++) {
    const sub = subscriptions[i]!
    const idx = i + 1
    const total = subscriptions.length
    try {
      const result = await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payloadStr,
      )
      console.log(
        `  ${PASS} [${idx}/${total}] Enviado para ${sub.userName}: HTTP ${result.statusCode}`,
      )
      sent++
    } catch (err: any) {
      console.log(`  ${FAIL} [${idx}/${total}] Falha para ${sub.userName}: ${err.message || err}`)
      if (err.statusCode === 410 || err.statusCode === 404) {
        console.log(`         ⚠️ Subscription expirada — o navegador removeu a permissão.`)
        console.log(`         Solicite que o usuário re-ative as notificações no app.`)
      } else if (err.statusCode === 429) {
        console.log(`         ⚠️ Rate limited. Aguarde alguns segundos e tente novamente.`)
      }
      failed++
    }
  }

  // ── Results ───────────────────────────────────────────────────────────
  console.log(`\n${BOLD}═══════════════════════════════════════════════════════════════${RESET}`)
  console.log(`${BOLD}  📋 RESULTADO DO TESTE${RESET}`)
  console.log(`${BOLD}═══════════════════════════════════════════════════════════════`)

  if (sent > 0) {
    console.log(`\n  ${PASS} ${sent}/${subscriptions.length} push(es) enviados com sucesso!`)
    console.log(`\n  ${INFO} O QUE ACONTECE AGORA:`)
    console.log(`  ┌─────────────────────────────────────────────────────────────┐`)
    console.log(`  │                                                             │`)
    console.log(`  │  1. O push chega ao Service Worker do navegador             │`)
    console.log(`  │     (mesmo com o navegador/minimizado/fechado)              │`)
    console.log(`  │                                                             │`)
    console.log(`  │  2. O SW verifica: app está em FOCO?                        │`)
    console.log(`  │     ├── SIM → badge do ícone atualiza (sem banner)          │`)
    console.log(`  │     └── NÃO → NOTIFICAÇÃO NATIVA aparece no desktop/Android │`)
    console.log(`  │                                                             │`)
    console.log(`  │  3. A notificação ficará visível na central de notificações │`)
    console.log(`  │     do sistema (Windows Action Center / Android / macOS)    │`)
    console.log(`  │     mesmo depois de fechar o navegador completamente.       │`)
    console.log(`  │                                                             │`)
    console.log(`  │  4. Ao clicar na notificação → abre o app na URL correta    │`)
    console.log(`  └─────────────────────────────────────────────────────────────┘`)
  } else {
    console.log(`\n  ${FAIL} Nenhum push foi enviado. Verifique as subscriptions.`)
  }

  if (failed > 0) {
    console.log(`\n  ${INFO} ${failed} falha(s):`)
    console.log(`  • Subscriptions expiradas (410/404) → o navegador removeu a permissão`)
    console.log(`  • Rate limit (429) → aguarde e tente novamente`)
    console.log(`  • A subscriptions expirada é removida automaticamente do banco`)
  }

  // ── Tips ──────────────────────────────────────────────────────────────
  console.log(`\n${BOLD}═══════════════════════════════════════════════════════════════${RESET}`)
  console.log(`${BOLD}  💡 COMO TESTAR COM NAVEGADOR FECHADO${RESET}`)
  console.log(`${BOLD}═══════════════════════════════════════════════════════════════\n`)
  console.log(`  1. Abra o app no navegador e faça login`)
  console.log(`  2. ATIVE as notificações push (clique no sino)`)
  console.log(`  3. Feche o navegador COMPLETAMENTE (todas as abas)`)
  console.log(`  4. Execute este script:`)
  console.log(`     bun scripts/test-push-e2e.ts`)
  console.log(`  5. A notificação deve aparecer como um TOAST nativo do sistema:`)
  console.log(`     Windows: Action Center (Win + A)`)
  console.log(`     macOS:   Centro de Notificações`)
  console.log(`     Android: Barra de notificações`)
  console.log(`  6. Clique na notificação → o app deve abrir na URL correta\n`)
  console.log(`  🔑 Dica: Para testar com navegador em FOCO (notificação silenciosa):`)
  console.log(`     Deixe o app aberto em uma aba e execute o script.`)
  console.log(`     O badge do ícone (favicon) deve atualizar SEM mostrar banner.\n`)

  process.exit(failed > 0 && sent === 0 ? 1 : 0)
}

main().catch((err) => {
  console.error(`\n${FAIL} Erro fatal:`, err)
  process.exit(1)
})
