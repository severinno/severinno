/**
 * Severinno Marketplace — seed push subscriptions for testing
 *
 * Run: DATABASE_URL="postgresql://severinno:severinno@localhost:5433/severinno" bun scripts/seed-push-test.ts
 *
 * Creates mock PushSubscription entries for the admin user and 3 providers
 * so the Admin Push Dashboard has data to display during local testing.
 */

import { PrismaClient } from "@prisma/client"

const db = new PrismaClient()

/** Generate a fake Web Push subscription object */
function fakeSubscription() {
  return {
    endpoint: `https://fcm.googleapis.com/fcm/send/test-${crypto.randomUUID().slice(0, 8)}`,
    p256dh: Array.from({ length: 43 }, () => "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"[Math.floor(Math.random() * 64)]).join(""),
    auth: Array.from({ length: 22 }, () => "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"[Math.floor(Math.random() * 64)]).join(""),
  }
}

async function main() {
  console.log("📡 Seeding push subscriptions for testing...")

  // Get users by email
  const admin = await db.user.findUnique({ where: { email: "admin@severinno.com" } })
  const cliente1 = await db.user.findUnique({ where: { email: "cliente@severinno.com" } })
  const maria = await db.user.findUnique({ where: { email: "maria@severinno.com" } })
  const carlos = await db.user.findUnique({ where: { email: "carlos@severinno.com" } })
  const ricardo = await db.user.findUnique({ where: { email: "ricardo@severinno.com" } })

  const users = [admin, cliente1, maria, carlos, ricardo].filter(Boolean)

  for (const user of users) {
    if (!user) continue

    // Create 1-3 subscriptions per user (simulating multiple devices/browsers)
    const count = user.role === "ADMIN" ? 3 : Math.ceil(Math.random() * 2) + 1

    for (let i = 0; i < count; i++) {
      const sub = fakeSubscription()
      try {
        await db.pushSubscription.create({
          data: {
            userId: user.id,
            endpoint: sub.endpoint,
            p256dh: sub.p256dh,
            auth: sub.auth,
            userAgent:
              i === 0
                ? "Mozilla/5.0 Chrome/120.0.0.0"
                : i === 1
                  ? "Mozilla/5.0 Firefox/121.0"
                  : "Mozilla/5.0 Edge/120.0.0.0",
          },
        })
        console.log(`   ✅ ${user.name} — subscription ${i + 1}/${count}`)
      } catch (e: any) {
        // Skip duplicates silently
        if (e?.code === "P2002") continue
        console.warn(`   ⚠️  ${user.name} — error: ${e?.message ?? e}`)
      }
    }
  }

  // Also create some Notification records so the in-app notification tab has data
  const notificationTypes = ["BOOKING_CONFIRMED", "QUOTE_RECEIVED", "MESSAGE", "PROMOTION"]
  for (const user of users) {
    if (!user || user.role === "ADMIN") continue
    for (let i = 0; i < 3; i++) {
      const type = notificationTypes[Math.floor(Math.random() * notificationTypes.length)]
      await db.notification.create({
        data: {
          userId: user.id,
          type,
          title: type === "BOOKING_CONFIRMED" ? "Serviço confirmado!" : type === "QUOTE_RECEIVED" ? "Novo orçamento recebido" : type === "MESSAGE" ? "Nova mensagem" : "Oferta especial",
          body: type === "PROMOTION" ? "Confira os novos profissionais na sua região!" : "Clique para mais detalhes.",
          read: Math.random() > 0.5,
        },
      })
    }
  }

  const totalSubs = await db.pushSubscription.count()
  const totalUsers = await db.pushSubscription.findMany({
    select: { userId: true },
    distinct: ["userId"],
  })
  const totalNotifs = await db.notification.count()

  console.log("")
  console.log("✅ Test data created!")
  console.log(`   • Push subscriptions: ${totalSubs} (${totalUsers.length} users)`)
  console.log(`   • Notifications: ${totalNotifs}`)
  console.log("")
  console.log("   🔑 Admin login: admin@severinno.com / admin123")
}

main()
  .catch((e) => {
    console.error("❌ Failed:", e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
