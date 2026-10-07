/**
 * seed-complete-flow.ts — Completes the financial flow for existing bookings.
 *
 * What it does:
 *   1. Creates Payment records for all PAID bookings (missing from initial seed)
 *   2. Creates WalletTransaction records for providers (income tracking)
 *   3. Adds random photos to ~30% of reviews
 *   4. Adds provider replies to ~40% of reviews
 *
 * Safe to run multiple times (idempotent — skips existing records).
 *
 * Usage:
 *   npx tsx scripts/seed-complete-flow.ts
 *
 * Exit codes:
 *   0 — success
 *   1 — failure
 */

import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()

const FEE_RATE = 0.15 // 15% platform commission

// Sample review photos (Unsplash placeholders)
const SAMPLE_PHOTOS = [
  "https://images.unsplash.com/photo-1581578731548-c64695cc6952?w=400",
  "https://images.unsplash.com/photo-1584622650111-993a426fbf0a?w=400",
  "https://images.unsplash.com/photo-1527515637462-cff94eecc1ac?w=400",
  "https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=400",
  "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400",
  "https://images.unsplash.com/photo-1562259929-b4e1fd3aef09?w=400",
  "https://images.unsplash.com/photo-1585704032915-c3400ca199e7?w=400",
  "https://images.unsplash.com/photo-1504307651254-35680f356dfd?w=400",
]

// Sample provider replies
const PROVIDER_REPLIES = [
  "Muito obrigado pela avaliação! Foi um prazer atender você. 😊",
  "Obrigado! Sempre buscamos entregar o melhor serviço possível.",
  "Agradeço pelas palavras positivas! Volte sempre que precisar.",
  "Fico feliz que tenha gostado do serviço! Até o próximo atendimento. 🙏",
  "Obrigado pela confiança! Trabalhamos com muito carinho em cada serviço.",
  "Valeu! Qualquer coisa, estou à disposição. 👍",
  "Agradecemos a avaliação! O feedback nos ajuda a melhorar cada vez mais.",
  "Obrigado! Espero que possamos atender você novamente em breve.",
]

async function main() {
  console.log("🚀 Starting seed-complete-flow...\n")

  // ── 1. Create Payments for PAID bookings ──────────────────────────────
  console.log("📦 Step 1: Creating Payment records...")

  const paidBookings = await prisma.booking.findMany({
    where: { paymentStatus: "PAID" },
    select: {
      id: true,
      amount: true,
      paymentMethod: true,
      createdAt: true,
    },
  })

  const existingPayments = await prisma.payment.findMany({
    select: { bookingId: true },
  })
  const existingPaymentIds = new Set(existingPayments.map((p) => p.bookingId))

  const newPayments = paidBookings.filter((b) => !existingPaymentIds.has(b.id))
  console.log(`   Found ${paidBookings.length} paid bookings, ${newPayments.length} need payments`)

  // Batch insert payments (100 at a time)
  const PAYMENT_BATCH = 100
  let paymentCount = 0
  for (let i = 0; i < newPayments.length; i += PAYMENT_BATCH) {
    const batch = newPayments.slice(i, i + PAYMENT_BATCH)
    await prisma.payment.createMany({
      data: batch.map((b) => ({
        bookingId: b.id,
        amount: b.amount,
        method: b.paymentMethod,
        status: "PAID",
        createdAt: b.createdAt,
      })),
    })
    paymentCount += batch.length
    process.stdout.write(`   ✓ ${paymentCount}/${newPayments.length} payments created\r`)
  }
  console.log(`\n   ✅ ${paymentCount} payments created\n`)

  // ── 2. Create WalletTransactions for providers ────────────────────────
  console.log("💰 Step 2: Creating WalletTransactions...")

  // Get completed bookings with provider info
  const completedBookings = await prisma.booking.findMany({
    where: {
      status: "COMPLETED",
      paymentStatus: "PAID",
    },
    select: {
      id: true,
      providerId: true,
      amount: true,
      createdAt: true,
    },
  })

  const existingWallet = await prisma.walletTransaction.findMany({
    select: { id: true },
  })

  // Only create if wallet is empty
  if (existingWallet.length === 0 && completedBookings.length > 0) {
    // Group by provider
    const providerIncome = new Map<string, { total: number; bookings: typeof completedBookings }>()
    for (const b of completedBookings) {
      const existing = providerIncome.get(b.providerId) ?? { total: 0, bookings: [] }
      existing.total += Number(b.amount)
      existing.bookings.push(b)
      providerIncome.set(b.providerId, existing)
    }

    const walletData: Array<{
      providerId: string
      amount: number
      status: string
      description: string
      createdAt: Date
    }> = []

    for (const [providerId, data] of providerIncome) {
      const netAmount = Math.round(data.total * (1 - FEE_RATE) * 100) / 100
      walletData.push({
        providerId,
        amount: netAmount,
        status: "completed",
        description: `Receita de ${data.bookings.length} serviços concluídos`,
        createdAt: new Date(),
      })
    }

    await prisma.walletTransaction.createMany({ data: walletData })
    console.log(`   ✅ ${walletData.length} wallet transactions created\n`)
  } else {
    console.log(`   ⏭️  Wallet already has ${existingWallet.length} transactions, skipping\n`)
  }

  // ── 3. Add photos to ~30% of reviews ─────────────────────────────────
  console.log("📸 Step 3: Adding photos to reviews...")

  const reviewsWithoutPhotos = await prisma.$queryRaw<
    Array<{ id: string }>
  >`SELECT id FROM "Review" WHERE photos = '[]'::jsonb OR photos IS NULL LIMIT 300`

  let photoCount = 0
  for (const review of reviewsWithoutPhotos) {
    // 30% chance of getting photos
    if (Math.random() > 0.3) continue

    const numPhotos = Math.floor(Math.random() * 3) + 1 // 1-3 photos
    const photos: string[] = []
    for (let i = 0; i < numPhotos; i++) {
      photos.push(SAMPLE_PHOTOS[Math.floor(Math.random() * SAMPLE_PHOTOS.length)])
    }

    await prisma.$executeRawUnsafe(
      `UPDATE "Review" SET photos = $1::jsonb WHERE id = $2`,
      JSON.stringify(photos),
      review.id,
    )
    photoCount++
  }
  console.log(`   ✅ ${photoCount} reviews got photos\n`)

  // ── 4. Add provider replies to ~40% of reviews ───────────────────────
  console.log("💬 Step 4: Adding provider replies...")

  const reviewsWithoutReplies = await prisma.$queryRaw<
    Array<{ id: string; providerId: string }>
  >`SELECT id, "providerId" FROM "Review" WHERE "providerReply" IS NULL LIMIT 400`

  let replyCount = 0
  for (const review of reviewsWithoutReplies) {
    // 40% chance of getting a reply
    if (Math.random() > 0.4) continue

    const reply = PROVIDER_REPLIES[Math.floor(Math.random() * PROVIDER_REPLIES.length)]

    await prisma.review.update({
      where: { id: review.id },
      data: {
        providerReply: reply,
        providerReplyAt: new Date(),
      },
    })
    replyCount++
  }
  console.log(`   ✅ ${replyCount} reviews got provider replies\n`)

  // ── Summary ──────────────────────────────────────────────────────────
  const [bookingCount, paymentCount2, reviewCount, walletCount] = await Promise.all([
    prisma.booking.count(),
    prisma.payment.count(),
    prisma.review.count(),
    prisma.walletTransaction.count(),
  ])

  console.log("📊 Final counts:")
  console.log(`   Bookings:           ${bookingCount}`)
  console.log(`   Payments:           ${paymentCount2}`)
  console.log(`   Reviews:            ${reviewCount}`)
  console.log(`   WalletTransactions: ${walletCount}`)
  console.log("\n🎉 Done!")
}

main()
  .catch((e) => {
    console.error("❌ Error:", e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
