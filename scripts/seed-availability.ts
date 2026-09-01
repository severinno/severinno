/**
 * Seed rápido — Provider Availability
 *
 * Adiciona horários de trabalho pra todos os providers existentes
 * que não têm disponibilidade configurada.
 *
 * Usage:
 *   npx tsx scripts/seed-availability.ts
 *
 * Exit codes:
 *   0 — success
 *   1 — failure
 */

import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()

const SHIFT_PATTERNS = [
  // Seg-Sex 8h-17h (padrão)
  [1, 2, 3, 4, 5].map((d) => ({ day: d, start: "08:00", end: "17:00" })),
  // Seg-Sex 7h-16h
  [1, 2, 3, 4, 5].map((d) => ({ day: d, start: "07:00", end: "16:00" })),
  // Seg-Sex 9h-18h
  [1, 2, 3, 4, 5].map((d) => ({ day: d, start: "09:00", end: "18:00" })),
  // Seg-Sáb 8h-17h
  [1, 2, 3, 4, 5, 6].map((d) => ({ day: d, start: "08:00", end: "17:00" })),
  // Seg-Qua-Sex 8h-17h
  [1, 3, 5].map((d) => ({ day: d, start: "08:00", end: "17:00" })),
  // Ter-Qui-Sáb 8h-17h
  [2, 4, 6].map((d) => ({ day: d, start: "08:00", end: "17:00" })),
  // Seg-Sex 8h-12h (meio período)
  [1, 2, 3, 4, 5].map((d) => ({ day: d, start: "08:00", end: "12:00" })),
]

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

async function main() {
  // Find providers without availability
  const providers = await prisma.user.findMany({
    where: {
      role: "PROVIDER",
      availability: { none: {} },
    },
    select: { id: true },
  })

  if (providers.length === 0) {
    console.log("✅ Todos os providers já têm horários configurados!")
    return
  }

  console.log(`🕐 Adicionando horários pra ${providers.length} providers...`)

  const availabilityData: Array<{
    providerId: string
    dayOfWeek: number
    startTime: string
    endTime: string
    active: boolean
  }> = []

  for (const provider of providers) {
    const pattern = pick(SHIFT_PATTERNS)
    for (const shift of pattern) {
      availabilityData.push({
        providerId: provider.id,
        dayOfWeek: shift.day,
        startTime: shift.start,
        endTime: shift.end,
        active: true,
      })
    }
  }

  // Batch insert
  let created = 0
  for (let i = 0; i < availabilityData.length; i += 500) {
    const batch = availabilityData.slice(i, i + 500)
    const result = await prisma.$transaction(
      batch.map((d) => prisma.providerAvailability.create({ data: d })),
    )
    created += result.length
    process.stdout.write(`\r  🕐 ${created}/${availabilityData.length}...`)
  }

  console.log(`\n  ✅ ${created} horários criados`)
  console.log(`  📊 Total horários no banco: ${await prisma.providerAvailability.count()}`)
}

main()
  .catch((e) => {
    console.error("❌ Erro:", e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
