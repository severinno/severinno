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
 */

import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()

const BAIRROS = [
  { nome: "Centro", lat: -18.8566, lng: -41.9455 },
  { nome: "Boa Sorte", lat: -18.8480, lng: -41.9380 },
  { nome: "Cidade Nova", lat: -18.8650, lng: -41.9350 },
  { nome: "Alto Boa Sorte", lat: -18.8400, lng: -41.9300 },
  { nome: "Jardim Palácia", lat: -18.8700, lng: -41.9500 },
  { nome: "Eldorado", lat: -18.8500, lng: -41.9600 },
  { nome: "São José", lat: -18.8620, lng: -41.9250 },
  { nome: "Cidade dos Meninos", lat: -18.8750, lng: -41.9400 },
  { nome: "Nova Vista", lat: -18.8550, lng: -41.9200 },
  { nome: "Progresso", lat: -18.8450, lng: -41.9550 },
  { nome: "Belvedere", lat: -18.8680, lng: -41.9600 },
  { nome: "Castelo Branco", lat: -18.8720, lng: -41.9200 },
  { nome: "Vila Betânia", lat: -18.8350, lng: -41.9450 },
  { nome: "Santa Bárbara", lat: -18.8800, lng: -41.9550 },
  { nome: "Aeroporto", lat: -18.8800, lng: -41.9200 },
  { nome: "Morada do Sol", lat: -18.8420, lng: -41.9650 },
  { nome: "Vila Istanbul", lat: -18.8580, lng: -41.9700 },
  { nome: "Pousada do Sol", lat: -18.8500, lng: -41.9150 },
  { nome: "Bela Vista", lat: -18.8630, lng: -41.9450 },
  { nome: "Laranjeiras", lat: -18.8700, lng: -41.9300 },
]

const SERVICOS = [
  { titulo: "Limpeza Residencial", categoria: "Limpeza", slug: "limpeza-residencial", precoMin: 80, precoMax: 250 },
  { titulo: "Limpeza Pós-Obra", categoria: "Limpeza", slug: "limpeza-pos-obra", precoMin: 200, precoMax: 600 },
  { titulo: "Encanador", categoria: "Manutenção", slug: "encanador", precoMin: 100, precoMax: 400 },
  { titulo: "Eletricista", categoria: "Manutenção", slug: "eletricista", precoMin: 80, precoMax: 350 },
  { titulo: "Pintor", categoria: "Reforma", slug: "pintor", precoMin: 150, precoMax: 500 },
  { titulo: "Pedreiro", categoria: "Reforma", slug: "pedreiro", precoMin: 200, precoMax: 800 },
  { titulo: "Marceneiro", categoria: "Reforma", slug: "marceneiro", precoMin: 150, precoMax: 600 },
  { titulo: "Jardineiro", categoria: "Jardim", slug: "jardineiro", precoMin: 60, precoMax: 200 },
  { titulo: "Diarista", categoria: "Limpeza", slug: "diarista", precoMin: 60, precoMax: 150 },
  { titulo: "Técnico de Ar Condicionado", categoria: "Manutenção", slug: "tecnico-ar-condicionado", precoMin: 100, precoMax: 400 },
  { titulo: "Chaveiro", categoria: "Serviços", slug: "chaveiro", precoMin: 50, precoMax: 200 },
  { titulo: "Instalador de Piso", categoria: "Reforma", slug: "instalador-piso", precoMin: 30, precoMax: 100 },
  { titulo: "Motorista Particular", categoria: "Transporte", slug: "motorista-particular", precoMin: 150, precoMax: 500 },
  { titulo: "Babá", categoria: "Cuidados", slug: "baba", precoMin: 100, precoMax: 300 },
  { titulo: "Cuidador de Idosos", categoria: "Cuidados", slug: "cuidador-idosos", precoMin: 120, precoMax: 350 },
  { titulo: "Personal Trainer", categoria: "Saúde", slug: "personal-trainer", precoMin: 80, precoMax: 200 },
  { titulo: "Dentista", categoria: "Saúde", slug: "dentista", precoMin: 100, precoMax: 500 },
  { titulo: "Fisioterapeuta", categoria: "Saúde", slug: "fisioterapeuta", precoMin: 80, precoMax: 250 },
  { titulo: "Nutricionista", categoria: "Saúde", slug: "nutricionista", precoMin: 80, precoMax: 200 },
  { titulo: "Psalterista", categoria: "Serviços", slug: "psalterista", precoMin: 200, precoMax: 800 },
]

const PRIMEIROS_NOMES_M = ["João", "Pedro", "Lucas", "Matheus", "Gabriel", "Rafael", "Felipe", "Bruno", "Gustavo", "Thiago", "Diego", "André", "Carlos", "Eduardo", "Marcos"]
const PRIMEIROS_NOMES_F = ["Maria", "Ana", "Juliana", "Fernanda", "Patricia", "Camila", "Amanda", "Beatriz", "Larissa", "Letícia", "Mariana", "Raquel", "Vanessa", "Carla", "Adriana"]
const SOBRENOMES = ["Silva", "Santos", "Oliveira", "Souza", "Pereira", "Costa", "Rodrigues", "Almeida", "Nascimento", "Lima", "Araújo", "Fernandes", "Carvalho", "Gomes", "Martins"]
const RUA_NOMES = ["São Paulo", "Minas Gerais", "Getúlio Vargas", "Borges de Medeiros", "Marechal Deodoro", "Dom Pedro II", "Bahia", "Pará", "Tiradentes", "Castro Alves"]
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

  // 3. Categories (ensure they exist)
  console.log("📂 Criando categorias...")
  const categorias = ["Limpeza", "Manutenção", "Reforma", "Jardim", "Serviços", "Transporte", "Cuidados", "Saúde"]
  for (const cat of categorias) {
    const slug = cat.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
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
  const statuses: Array<"PENDING" | "CONFIRMED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED"> = ["PENDING", "CONFIRMED", "IN_PROGRESS", "COMPLETED", "CANCELLED"]
  const weights = [0.1, 0.15, 0.05, 0.65, 0.05]

  const bookingData = []
  for (let i = 0; i < 5000; i++) {
    const cliente = pick(clientes)
    const provider = pick(providers)
    const providerServicos = servicos.filter((s) => s.providerId === provider.id)
    const servico = providerServicos.length > 0 ? pick(providerServicos) : pick(servicos)
    const bairro = pick(BAIRROS)
    const createdAt = randomDate(sixMonthsAgo, now)

    let rand = Math.random()
    let cumWeight = 0
    let status: "PENDING" | "CONFIRMED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED" = "COMPLETED"
    for (let j = 0; j < statuses.length; j++) {
      cumWeight += weights[j]
      if (rand <= cumWeight) { status = statuses[j]; break }
    }

    bookingData.push({
      clientId: cliente.id,
      providerId: provider.id,
      serviceId: servico.id,
      status,
      amount: servico.basePrice + randInt(-20, 50),
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

  // Summary
  console.log("📊 Resumo:")
  console.log(`  👤 Clientes:   ${await prisma.user.count({ where: { role: "CLIENT" } })}`)
  console.log(`  🔧 Providers:  ${await prisma.user.count({ where: { role: "PROVIDER" } })}`)
  console.log(`  📋 Serviços:   ${await prisma.service.count()}`)
  console.log(`  📅 Bookings:   ${await prisma.booking.count()}`)
  console.log(`  ⭐ Reviews:    ${await prisma.review.count()}`)
  console.log(`  📂 Categorias: ${await prisma.category.count()}`)
  console.log("\n✅ Seed Governador Valadares concluído!")
}

seed().catch((e) => { console.error("❌ Erro:", e); process.exit(1) }).finally(() => prisma.$disconnect())
