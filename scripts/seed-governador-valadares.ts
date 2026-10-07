/**
 * Seed Realista — Governador Valadares, MG
 *
 * Gera dados realistas para a cidade de Governador Valadares:
 * - 500 providers (com bairros reais)
 * - 5000 bookings
 * - 20000 reviews
 * - 2000 clientes
 *
 * Coordenadas approximadas de cada bairro.
 *
 * Usage:
 *   npx tsx scripts/seed-governador-valadares.ts
 *
 * Exit codes:
 *   0 — seed completed successfully
 *   1 — error during seed
 */

import { PrismaClient } from "@prisma/client"
import { backfillAvatars } from "./lib/backfill-avatars"

const prisma = new PrismaClient()

const BAIRROS = [
  { nome: "Centro", lat: -18.8566, lng: -41.9455 },
  { nome: "Boa Sorte", lat: -18.848, lng: -41.938 },
  { nome: "Cidade Nova", lat: -18.865, lng: -41.935 },
  { nome: "Alto Boa Sorte", lat: -18.84, lng: -41.93 },
  { nome: "Jardim Palácia", lat: -18.87, lng: -41.95 },
  { nome: "Eldorado", lat: -18.85, lng: -41.96 },
  { nome: "São José", lat: -18.862, lng: -41.925 },
  { nome: "Cidade dos Meninos", lat: -18.875, lng: -41.94 },
  { nome: "Nova Vista", lat: -18.855, lng: -41.92 },
  { nome: "Progresso", lat: -18.845, lng: -41.955 },
  { nome: "Belvedere", lat: -18.868, lng: -41.96 },
  { nome: "Castelo Branco", lat: -18.872, lng: -41.92 },
  { nome: "Vila Betânia", lat: -18.835, lng: -41.945 },
  { nome: "Santa Bárbara", lat: -18.88, lng: -41.955 },
  { nome: "Aeroporto", lat: -18.88, lng: -41.92 },
  { nome: "Morada do Sol", lat: -18.842, lng: -41.965 },
  { nome: "Vila Istanbul", lat: -18.858, lng: -41.97 },
  { nome: "Pousada do Sol", lat: -18.85, lng: -41.915 },
  { nome: "Bela Vista", lat: -18.863, lng: -41.945 },
  { nome: "Laranjeiras", lat: -18.87, lng: -41.93 },
]

const SERVICOS = [
  {
    titulo: "Limpeza Residencial",
    categoria: "Limpeza",
    slug: "limpeza-residencial",
    precoMin: 80,
    precoMax: 250,
  },
  {
    titulo: "Limpeza Pós-Obra",
    categoria: "Limpeza",
    slug: "limpeza-pos-obra",
    precoMin: 200,
    precoMax: 600,
  },
  { titulo: "Encanador", categoria: "Manutenção", slug: "encanador", precoMin: 100, precoMax: 400 },
  {
    titulo: "Eletricista",
    categoria: "Manutenção",
    slug: "eletricista",
    precoMin: 80,
    precoMax: 350,
  },
  { titulo: "Pintor", categoria: "Reforma", slug: "pintor", precoMin: 150, precoMax: 500 },
  { titulo: "Pedreiro", categoria: "Reforma", slug: "pedreiro", precoMin: 200, precoMax: 800 },
  { titulo: "Marceneiro", categoria: "Reforma", slug: "marceneiro", precoMin: 150, precoMax: 600 },
  { titulo: "Jardineiro", categoria: "Jardim", slug: "jardineiro", precoMin: 60, precoMax: 200 },
  { titulo: "Diarista", categoria: "Limpeza", slug: "diarista", precoMin: 60, precoMax: 150 },
  {
    titulo: "Técnico de Ar Condicionado",
    categoria: "Manutenção",
    slug: "tecnico-ar-condicionado",
    precoMin: 100,
    precoMax: 400,
  },
  { titulo: "Chaveiro", categoria: "Serviços", slug: "chaveiro", precoMin: 50, precoMax: 200 },
  {
    titulo: "Instalador de Piso",
    categoria: "Reforma",
    slug: "instalador-piso",
    precoMin: 30,
    precoMax: 100,
  },
  {
    titulo: "Motorista Particular",
    categoria: "Transporte",
    slug: "motorista-particular",
    precoMin: 150,
    precoMax: 500,
  },
  { titulo: "Babá", categoria: "Cuidados", slug: "baba", precoMin: 100, precoMax: 300 },
  {
    titulo: "Cuidador de Idosos",
    categoria: "Cuidados",
    slug: "cuidador-idosos",
    precoMin: 120,
    precoMax: 350,
  },
  {
    titulo: "Personal Trainer",
    categoria: "Saúde",
    slug: "personal-trainer",
    precoMin: 80,
    precoMax: 200,
  },
  { titulo: "Dentista", categoria: "Saúde", slug: "dentista", precoMin: 100, precoMax: 500 },
  {
    titulo: "Fisioterapeuta",
    categoria: "Saúde",
    slug: "fisioterapeuta",
    precoMin: 80,
    precoMax: 250,
  },
  {
    titulo: "Nutricionista",
    categoria: "Saúde",
    slug: "nutricionista",
    precoMin: 80,
    precoMax: 200,
  },
  {
    titulo: "Psalterista",
    categoria: "Serviços",
    slug: "psalterista",
    precoMin: 200,
    precoMax: 800,
  },
]

const PRIMEIROS_NOMES_M = [
  "João",
  "Pedro",
  "Lucas",
  "Matheus",
  "Gabriel",
  "Rafael",
  "Felipe",
  "Bruno",
  "Gustavo",
  "Thiago",
  "Diego",
  "André",
  "Carlos",
  "Eduardo",
  "Marcos",
]
const PRIMEIROS_NOMES_F = [
  "Maria",
  "Ana",
  "Juliana",
  "Fernanda",
  "Patricia",
  "Camila",
  "Amanda",
  "Beatriz",
  "Larissa",
  "Letícia",
  "Mariana",
  "Raquel",
  "Vanessa",
  "Carla",
  "Adriana",
]
const SOBRENOMES = [
  "Silva",
  "Santos",
  "Oliveira",
  "Souza",
  "Pereira",
  "Costa",
  "Rodrigues",
  "Almeida",
  "Nascimento",
  "Lima",
  "Araújo",
  "Fernandes",
  "Carvalho",
  "Gomes",
  "Martins",
]
const RUA_NOMES = [
  "São Paulo",
  "Minas Gerais",
  "Getúlio Vargas",
  "Borges de Medeiros",
  "Marechal Deodoro",
  "Dom Pedro II",
  "Bahia",
  "Pará",
  "Tiradentes",
  "Castro Alves",
]
const REVIEW_TEXTS = [
  "Excelente profissional! Muito pontual e trabalha direitinho.",
  "Bom serviço, recomendo. Preço justo.",
  "Profissional competente, voltarei a contratar.",
  "Trabalho bem feito, pontual e educado.",
  "Ótimo atendimento, superou minhas expectativas.",
  "Muito bom! Chegou no horário e fez tudo perfeito.",
  "Recomendo! Preço justo e trabalho de qualidade.",
  "Profissional honesto e trabalhador.",
  "Serviço razoável, poderia ter sido mais rápido.",
  "Cumpriu o combinado, mas nada excepcional.",
  "Ótimo profissional, já contratei 3 vezes.",
  "Super recomendo! Melhor da região.",
  "Trabalho impecável, nota 10.",
  "Bom custo-benefício, profissional simpático.",
  "Atendeu bem mas demorou um pouco.",
]

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function randomDate(start: Date, end: Date): Date {
  return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()))
}

function genPhone(): string {
  return `(33) 9${randInt(1000, 9999)}-${randInt(1000, 9999)}`
}

function genCep(): string {
  return `${randInt(35000, 35999)}-${String(randInt(100, 999))}`
}

async function seed() {
  console.log("🇧🇷 Seed realista — Governador Valadares, MG\n")

  // 1. Clientes
  console.log("👤 Criando 2.000 clientes...")
  const clienteData = []
  for (let i = 0; i < 2000; i++) {
    const nome = pick([...PRIMEIROS_NOMES_M, ...PRIMEIROS_NOMES_F])
    const sobrenome = pick(SOBRENOMES)
    const bairro = pick(BAIRROS)
    clienteData.push({
      email: `cliente.${i}.${nome.toLowerCase()}@gmail.com`,
      passwordHash: "$2b$10$placeholder",
      name: `${nome} ${sobrenome}`,
      role: "CLIENT" as const,
      phone: genPhone(),
      lat: bairro.lat + (Math.random() - 0.5) * 0.01,
      lng: bairro.lng + (Math.random() - 0.5) * 0.01,
      city: "Governador Valadares",
    })
  }
  // Batch insert
  const clientes = []
  for (let i = 0; i < clienteData.length; i += 500) {
    const batch = clienteData.slice(i, i + 500)
    const result = await prisma.$transaction(batch.map((d) => prisma.user.create({ data: d })))
    clientes.push(...result)
  }
  console.log(`  ✅ ${clientes.length} clientes\n`)

  // 2. Providers
  console.log("🔧 Criando 500 providers...")
  const providerData = []
  for (let i = 0; i < 500; i++) {
    const nome = pick(PRIMEIROS_NOMES_M)
    const sobrenome = pick(SOBRENOMES)
    const bairro = pick(BAIRROS)
    providerData.push({
      email: `provider.${i}.${nome.toLowerCase()}@gmail.com`,
      passwordHash: "$2b$10$placeholder",
      name: `${nome} ${sobrenome}`,
      role: "PROVIDER" as const,
      phone: genPhone(),
      lat: bairro.lat + (Math.random() - 0.5) * 0.01,
      lng: bairro.lng + (Math.random() - 0.5) * 0.01,
      city: "Governador Valadares",
      verified: Math.random() > 0.2,
      active: true,
      bio: `Profissional de serviços em ${bairro.nome}. ${randInt(1, 15)} anos de experiência.`,
      radiusKm: randInt(5, 30),
    })
  }
  const providers = []
  for (let i = 0; i < providerData.length; i += 100) {
    const batch = providerData.slice(i, i + 100)
    const result = await prisma.$transaction(batch.map((d) => prisma.user.create({ data: d })))
    providers.push(...result)
  }
  console.log(`  ✅ ${providers.length} providers\n`)

  // 2b. Provider Availability (horários de trabalho)
  console.log("🕐 Criando horários de disponibilidade...")
  const availabilityData: Array<{
    providerId: string
    dayOfWeek: number
    startTime: string
    endTime: string
    active: boolean
  }> = []

  // Horários padrão com variação pra parecer real
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

  // Batch insert availability
  for (let i = 0; i < availabilityData.length; i += 500) {
    const batch = availabilityData.slice(i, i + 500)
    await prisma.$transaction(batch.map((d) => prisma.providerAvailability.create({ data: d })))
  }
  console.log(`  ✅ ${availabilityData.length} horários criados\n`)

  // 3. Categories (ensure they exist)
  console.log("📂 Criando categorias...")
  const categorias = [
    "Limpeza",
    "Manutenção",
    "Reforma",
    "Jardim",
    "Serviços",
    "Transporte",
    "Cuidados",
    "Saúde",
  ]
  for (const cat of categorias) {
    const slug = cat
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
    await prisma.category.upsert({
      where: { slug },
      update: {},
      create: { name: cat, slug },
    })
  }
  const allCategories = await prisma.category.findMany()
  console.log(`  ✅ ${allCategories.length} categorias\n`)

  // 4. Services
  console.log("📋 Criando serviços...")
  const servicoData = []
  for (const provider of providers) {
    const numServicos = randInt(1, 3)
    const chosen = Array.from({ length: numServicos }, () => pick(SERVICOS))
    for (const s of chosen) {
      const cat = allCategories.find((c) => c.name === s.categoria) ?? pick(allCategories)
      servicoData.push({
        providerId: provider.id,
        categoryId: cat.id,
        title: s.titulo,
        description: `${s.titulo} profissional em Governador Valadares.`,
        basePrice: randInt(s.precoMin, s.precoMax),
        active: true,
      })
    }
  }
  const servicos = []
  for (let i = 0; i < servicoData.length; i += 200) {
    const batch = servicoData.slice(i, i + 200)
    const result = await prisma.$transaction(batch.map((d) => prisma.service.create({ data: d })))
    servicos.push(...result)
  }
  console.log(`  ✅ ${servicos.length} serviços\n`)

  // 5. Bookings
  console.log("📅 Criando 5.000 bookings...")
  const now = new Date()
  const sixMonthsAgo = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000)
  const statuses: Array<"PENDING" | "CONFIRMED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED"> = [
    "PENDING",
    "CONFIRMED",
    "IN_PROGRESS",
    "COMPLETED",
    "CANCELLED",
  ]
  const weights = [0.1, 0.15, 0.05, 0.65, 0.05]

  const bookingData = []
  for (let i = 0; i < 5000; i++) {
    const cliente = pick(clientes)
    const provider = pick(providers)
    const providerServicos = servicos.filter((s) => s.providerId === provider.id)
    const servico = providerServicos.length > 0 ? pick(providerServicos) : pick(servicos)
    const bairro = pick(BAIRROS)
    const createdAt = randomDate(sixMonthsAgo, now)

    const rand = Math.random()
    let cumWeight = 0
    let status: "PENDING" | "CONFIRMED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED" = "COMPLETED"
    for (let j = 0; j < statuses.length; j++) {
      cumWeight += weights[j]
      if (rand <= cumWeight) {
        status = statuses[j]
        break
      }
    }

    bookingData.push({
      clientId: cliente.id,
      providerId: provider.id,
      serviceId: servico.id,
      status,
      amount: Number(servico.basePrice) + randInt(-20, 50),
      scheduledAt: randomDate(createdAt, new Date(createdAt.getTime() + 30 * 24 * 60 * 60 * 1000)),
      address: `Rua ${pick(RUA_NOMES)}, ${randInt(1, 500)} - ${bairro.nome}, GV - MG`,
      cep: genCep(),
      lat: bairro.lat + (Math.random() - 0.5) * 0.01,
      lng: bairro.lng + (Math.random() - 0.5) * 0.01,
      paymentMethod: pick(["CARD", "PIX"] as const),
      paymentStatus: "PAID" as const,
      createdAt,
    })
  }
  const bookings = []
  for (let i = 0; i < bookingData.length; i += 200) {
    const batch = bookingData.slice(i, i + 200)
    const result = await prisma.$transaction(batch.map((d) => prisma.booking.create({ data: d })))
    bookings.push(...result)
  }
  console.log(`  ✅ ${bookings.length} bookings\n`)

  // 6. Reviews
  console.log("⭐ Criando reviews...")
  const completed = bookings.filter((b) => b.status === "COMPLETED")
  const reviewData = []
  for (const booking of completed) {
    if (Math.random() > 0.3) continue // 70% have reviews
    reviewData.push({
      bookingId: booking.id,
      clientId: booking.clientId,
      providerId: booking.providerId,
      rating: randInt(1, 5),
      comment: pick(REVIEW_TEXTS),
      createdAt: randomDate(booking.createdAt, now),
    })
  }
  let totalReviews = 0
  for (let i = 0; i < reviewData.length; i += 500) {
    const batch = reviewData.slice(i, i + 500)
    const result = await prisma.$transaction(batch.map((d) => prisma.review.create({ data: d })))
    totalReviews += result.length
    process.stdout.write(`\r  ⭐ ${totalReviews}/${reviewData.length}...`)
  }
  console.log(`\n  ✅ ${totalReviews} reviews\n`)

  // Avatares: etapa automática final do seed — mesma convenção dos cards
  // (pravatar determinístico por userId), idempotente (ignora quem já tem).
  const avatarsBackfilled = await backfillAvatars(prisma)
  console.log(`  🖼️  Avatares: ${avatarsBackfilled} preenchidos nesta execução\n`)

  // Summary
  console.log("📊 Resumo:")
  console.log(`  👤 Clientes:   ${await prisma.user.count({ where: { role: "CLIENT" } })}`)
  console.log(`  🔧 Providers:  ${await prisma.user.count({ where: { role: "PROVIDER" } })}`)
  console.log(`  📋 Serviços:   ${await prisma.service.count()}`)
  console.log(`  🕐 Horários:   ${await prisma.providerAvailability.count()}`)
  console.log(`  📅 Bookings:   ${await prisma.booking.count()}`)
  console.log(`  ⭐ Reviews:    ${await prisma.review.count()}`)
  console.log(`  📂 Categorias: ${await prisma.category.count()}`)
  console.log("\n✅ Seed Governador Valadares concluído!")
}

seed()
  .catch((e) => {
    console.error("❌ Erro:", e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
