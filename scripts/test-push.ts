#!/usr/bin/env bun
/**
 * Script de Teste de Push Notification — Severinno Marketplace
 *
 * Uso:
 *   bun scripts/test-push.ts --subscribe "{\"endpoint\":\"...\",\"p256dh\":\"...\",\"auth\":\"...\"}"
 *
 * Para obter os dados de subscription:
 *   1. Abra https://web-push-codelab.glitch.me/ no navegador
 *   2. Substitua a VAPID public key no campo "Application server keys"
 *   3. Clique em "Subscribe"
 *   4. Copie o JSON gerado e passe como argumento
 *
 * Ou gere uma subscription de teste vazia para simular:
 *   bun scripts/test-push.ts --dry-run
 */

import webpush from "web-push"

// ── Config ────────────────────────────────────────────────────────────────
// Use as mesmas VAPID keys do .env.production
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY
const VAPID_SUBJECT = process.env.VAPID_SUBJECT ?? "mailto:admin@severinno.com.br"

if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
  console.error(`
  ❌ VAPID keys nao encontradas no ambiente.
     Certifique-se de que .env contem:
       VAPID_PUBLIC_KEY=<sua-chave>
       VAPID_PRIVATE_KEY=<sua-chave-privada>
  `)
  process.exit(1)
}

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)

// ── Parse args ─────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
const subscribeIndex = args.indexOf("--subscribe")
const dryRun = args.includes("--dry-run")

if (dryRun) {
  console.log(`
  ╔══════════════════════════════════════════════════════════════╗
  ║   Teste de Push Notification — Severinno Marketplace        ║
  ╚══════════════════════════════════════════════════════════════╝

  ✅ Configuracao VAPID OK
  📌 Public Key:  ${VAPID_PUBLIC_KEY.slice(0, 40)}...
  📌 Private Key: ${VAPID_PRIVATE_KEY.slice(0, 10)}...

  Para testar uma notificacao real:

  1. Abra https://web-push-codelab.glitch.me/ no navegador
  2. Na seção "Application Server Keys", cole esta chave:
     ${VAPID_PUBLIC_KEY}
  3. Clique em "Subscribe"
  4. Copie o JSON gerado
  5. Execute:

     bun scripts/test-push.ts --subscribe 'SEU_JSON_AQUI'

  Ou, se o servidor estiver rodando com banco de dados:

  1. Faca login no app http://localhost:3000
  2. Clique no sino para ativar notificacoes
  3. Execute:

     curl -X POST http://localhost:3000/api/push/test
  `)
  process.exit(0)
}

if (subscribeIndex === -1) {
  console.error(`
  Uso: bun scripts/test-push.ts --subscribe '{"endpoint":"...","keys":{"p256dh":"...","auth":"..."}}'
  Ou:  bun scripts/test-push.ts --dry-run
  `)
  process.exit(1)
}

// ── Send push notification ────────────────────────────────────────────────
const subscriptionJson = args[subscribeIndex + 1]
if (!subscriptionJson) {
  console.error("❌ JSON da subscription nao fornecido apos --subscribe")
  process.exit(1)
}

let subscription: webpush.PushSubscription
try {
  subscription = JSON.parse(subscriptionJson)
} catch {
  console.error(
    '❌ JSON invalido. Use o formato: {"endpoint":"...","keys":{"p256dh":"...","auth":"..."}}',
  )
  process.exit(1)
}

if (!subscription.endpoint || !subscription.keys?.p256dh || !subscription.keys?.auth) {
  console.error("❌ Subscription invalida. Deve conter: endpoint, keys.p256dh, keys.auth")
  process.exit(1)
}

console.log(`
  ╔══════════════════════════════════════════════════════════════╗
  ║   Enviando Push Notification...                             ║
  ╚══════════════════════════════════════════════════════════════╝
  📡 Endpoint: ${subscription.endpoint.slice(0, 50)}...
`)

const payload = JSON.stringify({
  title: "🔔 Teste Severinno",
  body: "Notificacao push funcionando! ✅",
  url: "/",
  timestamp: new Date().toISOString(),
})

try {
  const result = await webpush.sendNotification(subscription, payload)
  console.log(`
  ✅ Push notification enviada com sucesso!
  📬 Status: ${result.statusCode}
  📝 Mensagem: "${payload}"
  `)
} catch (err: any) {
  if (err.statusCode === 410 || err.statusCode === 404) {
    console.error(`
    ❌ Subscription expirada ou invalida (HTTP ${err.statusCode}).
       A subscription pode ter sido removida pelo navegador.
       Inscreva-se novamente e tente de novo.
    `)
  } else if (err.statusCode === 429) {
    console.error(`
    ❌ Rate limited (HTTP 429). Aguarde alguns segundos e tente novamente.
    `)
  } else {
    console.error(`
    ❌ Erro ao enviar push notification:
       ${err.message || err}
    `)
  }
  process.exit(1)
}
