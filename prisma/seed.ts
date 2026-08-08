/**
 * Severinno Marketplace — seed script (Fase 1 / MVP)
 * Run with: bun run db:seed  (or: bun prisma/seed.ts)
 *
 * Creates: 1 admin, 2 clients, 6 providers (Brazilian service businesses),
 * categories (3-level tree), services, availabilities, ~4 completed bookings
 * with reviews, and a few admin settings.
 */

import { PrismaClient } from "@prisma/client"
import { hashPassword } from "../src/lib/crypto"

const db = new PrismaClient()

// São Paulo downtown reference (-23.55, -46.63)
const SP_LAT = -23.55
const SP_LNG = -46.63

function jitter(base: number, delta: number): number {
  return Number((base + (Math.random() * 2 - 1) * delta).toFixed(5))
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

async function main() {
  console.log("🌱 Severinno seed — starting...")

  // --- wipe (order matters for FKs) -------------------------------
  console.log("   • wiping existing data...")
  await db.payment.deleteMany()
  await db.review.deleteMany()
  await db.message.deleteMany()
  await db.notification.deleteMany()
  await db.favorite.deleteMany()
  await db.quoteItem.deleteMany()
  await db.quoteRequest.deleteMany()
  await db.booking.deleteMany()
  await db.providerAvailability.deleteMany()
  await db.service.deleteMany()
  await db.setting.deleteMany()
  await db.category.deleteMany()
  await db.user.deleteMany()

  // --- USERS ------------------------------------------------------
  console.log("   • creating users...")
  const adminPw = await hashPassword("admin123")
  const clientPw = await hashPassword("cliente123")

  const admin = await db.user.create({
    data: {
      email: "admin@severinno.com",
      passwordHash: adminPw,
      name: "Administrador Severinno",
      role: "ADMIN",
      verified: true,
      active: true,
      phone: "(11) 4000-0000",
      whatsapp: "(11) 90000-0000",
      city: "São Paulo",
      state: "SP",
    },
  })

  const client1 = await db.user.create({
    data: {
      email: "cliente@severinno.com",
      passwordHash: clientPw,
      name: "João Cliente",
      role: "CLIENT",
      verified: true,
      active: true,
      cpfCnpj: "123.456.789-09",
      whatsapp: "(11) 98888-1111",
      phone: "(11) 3888-1111",
      cep: "01310-100",
      street: "Avenida Paulista",
      number: "1000",
      district: "Bela Vista",
      city: "São Paulo",
      state: "SP",
      lat: jitter(SP_LAT, 0.01),
      lng: jitter(SP_LNG, 0.01),
      avatarUrl: "https://i.pravatar.cc/150?img=12",
    },
  })

  const client2 = await db.user.create({
    data: {
      email: "maria@severinno.com",
      passwordHash: clientPw,
      name: "Maria Aparecida",
      role: "CLIENT",
      verified: true,
      active: true,
      cpfCnpj: "987.654.321-00",
      whatsapp: "(11) 97777-2222",
      phone: "(11) 3777-2222",
      cep: "04547-130",
      street: "Rua Funchal",
      number: "320",
      district: "Vila Olímpia",
      city: "São Paulo",
      state: "SP",
      lat: jitter(SP_LAT, 0.012),
      lng: jitter(SP_LNG, 0.012),
      avatarUrl: "https://i.pravatar.cc/150?img=5",
    },
  })

  // --- PROVIDERS --------------------------------------------------
  type ProviderSeed = {
    name: string
    email: string
    bio: string
    avatarImg: number
    coverSeed: string
    profession: string
    cep: string
    street: string
    district: string
    radiusKm: number
  }

  const providersData: ProviderSeed[] = [
    {
      name: "Carlos Encanador",
      email: "carlos@severinno.com",
      bio: "Encanador com 15 anos de experiência em reparos hidráulicos, desentupimento e instalação de caixas de descarga. Atendo toda a zona sul de São Paulo.",
      avatarImg: 11,
      coverSeed: "encanador",
      profession: "Encanador",
      cep: "04094-050",
      street: "Rua Joaquim Nabuco",
      district: "Brooklin",
      radiusKm: 12,
    },
    {
      name: "EletricaTech — Ricardo",
      email: "ricardo@severinno.com",
      bio: "Eletricista predial e residencial. Instalações elétricas, troca de quadros, manutenção preventiva e correção de curtos-circuitos. NR-10 atualizada.",
      avatarImg: 13,
      coverSeed: "eletricista",
      profession: "Eletricista",
      cep: "02012-000",
      street: "Rua Voluntários da Pátria",
      district: "Santana",
      radiusKm: 15,
    },
    {
      name: "Pinturas Lima",
      email: "lima@severinno.com",
      bio: "Pintor residencial e comercial. Pintura interna e externa, textura, grafiato e preparação de paredes. Orçamento sem compromisso.",
      avatarImg: 15,
      coverSeed: "pintor",
      profession: "Pintor",
      cep: "05407-002",
      street: "Rua Cardeal Arcoverde",
      district: "Pinheiros",
      radiusKm: 20,
    },
    {
      name: "Diarista Fernanda",
      email: "fernanda@severinno.com",
      bio: "Diarista com referências. Limpeza residencial, pós-obra e organização. Trabalho com produtos próprios. Atendo manhãs e tardes.",
      avatarImg: 16,
      coverSeed: "diarista",
      profession: "Diarista",
      cep: "03333-001",
      street: "Rua Tuiuti",
      district: "Tatuapé",
      radiusKm: 10,
    },
    {
      name: "Jardins Vida — Pedro",
      email: "pedro@severinno.com",
      bio: "Jardineiro especializado em paisagismo, poda de árvores, controle de pragas e manutenção de jardins residenciais e comerciais.",
      avatarImg: 17,
      coverSeed: "jardineiro",
      profession: "Jardineiro",
      cep: "05652-000",
      street: "Avenida Eliseu de Almeida",
      district: "Vila Sônia",
      radiusKm: 18,
    },
    {
      name: "Pedreiro Antônio",
      email: "antonio@severinno.com",
      bio: "Pedreiro experiente em alvenaria, revestimentos, contrapiso e pequenas reformas. Garantia de serviço e notas fiscais.",
      avatarImg: 18,
      coverSeed: "pedreiro",
      profession: "Pedreiro",
      cep: "02982-000",
      street: "Rua Parapuã",
      district: "Vila Anastácio",
      radiusKm: 25,
    },
  ]

  const providers: Record<string, Awaited<ReturnType<typeof db.user.create>>> = {}

  for (const p of providersData) {
    providers[p.profession] = await db.user.create({
      data: {
        email: p.email,
        passwordHash: await hashPassword("provider123"),
        name: p.name,
        // Páginas públicas /u/[slug] (ISR + generateStaticParams) dependem do
        // slug. Determinístico a partir do nome: "Carlos Encanador" →
        // "carlos-encanador" (usado pelo lighthouserc.json no CI).
        slug: slugify(p.name),
        role: "PROVIDER",
        verified: true,
        active: true,
        bio: p.bio,
        avatarUrl: `https://i.pravatar.cc/150?img=${p.avatarImg}`,
        coverUrl: `https://picsum.photos/seed/${p.coverSeed}/800/300`,
        cep: p.cep,
        street: p.street,
        number: String(Math.floor(Math.random() * 1500) + 100),
        district: p.district,
        city: "São Paulo",
        state: "SP",
        lat: jitter(SP_LAT, 0.03),
        lng: jitter(SP_LNG, 0.03),
        radiusKm: p.radiusKm,
        whatsapp: "(11) 9" + Math.floor(1000 + Math.random() * 8999) + "-" +
          Math.floor(1000 + Math.random() * 8999),
        phone: "(11) 3" + Math.floor(1000 + Math.random() * 8999) + "-" +
          Math.floor(1000 + Math.random() * 8999),
        cpfCnpj: "0" + String(Math.floor(100000000 + Math.random() * 89999999)) + "-" +
          String(Math.floor(10 + Math.random() * 89)),
      },
    })
  }

  // --- AVAILABILITY for each provider -----------------------------
  console.log("   • creating availabilities...")
  const daysMonToSat = [1, 2, 3, 4, 5, 6] // Mon-Fri 08-18, Sat 08-12
  for (const p of Object.values(providers)) {
    for (const dow of daysMonToSat) {
      const isSaturday = dow === 6
      await db.providerAvailability.create({
        data: {
          providerId: p.id,
          dayOfWeek: dow,
          startTime: "08:00",
          endTime: isSaturday ? "12:00" : "18:00",
          active: true,
        },
      })
    }
  }

  // --- CATEGORIES (3-level tree) ----------------------------------
  console.log("   • creating categories...")
  type CatInput = { name: string; parent?: string; level: number; icon?: string }
  const catSpec: CatInput[] = [
    // pais
    { name: "Reparos", level: 0, icon: "wrench" },
    { name: "Limpeza", level: 0, icon: "sparkles" },
    { name: "Reforma", level: 0, icon: "hammer" },
    // filhas
    { name: "Elétrica", parent: "Reparos", level: 1, icon: "zap" },
    { name: "Hidráulica", parent: "Reparos", level: 1, icon: "droplet" },
    { name: "Pintura", parent: "Reparos", level: 1, icon: "brush" },
    { name: "Residencial", parent: "Limpeza", level: 1, icon: "home" },
    { name: "Pós-Obra", parent: "Limpeza", level: 1, icon: "broom" },
    { name: "Pisos", parent: "Reforma", level: 1, icon: "square" },
    { name: "Alvenaria", parent: "Reforma", level: 1, icon: "brick" },
    // subcategorias (level 2)
    { name: "Tomadas e interruptores", parent: "Elétrica", level: 2 },
    { name: "Curto-circuito", parent: "Elétrica", level: 2 },
    { name: "Quadro elétrico", parent: "Elétrica", level: 2 },
    { name: "Desentupimento", parent: "Hidráulica", level: 2 },
    { name: "Vazamento", parent: "Hidráulica", level: 2 },
    { name: "Caixa de descarga", parent: "Hidráulica", level: 2 },
    { name: "Pintura interna", parent: "Pintura", level: 2 },
    { name: "Pintura externa", parent: "Pintura", level: 2 },
    { name: "Textura e grafiato", parent: "Pintura", level: 2 },
    { name: "Limpeza geral", parent: "Residencial", level: 2 },
    { name: "Organização", parent: "Residencial", level: 2 },
    { name: "Limpeza pós-obra", parent: "Pós-Obra", level: 2 },
    { name: "Assentamento de piso", parent: "Pisos", level: 2 },
    { name: "Rejunte", parent: "Pisos", level: 2 },
    { name: "Pequenas reformas", parent: "Alvenaria", level: 2 },
    { name: "Contrapiso", parent: "Alvenaria", level: 2 },
    { name: "Poda de árvores", parent: "Alvenaria", level: 2 }, // for jardineiro fallback
  ]

  const catByName: Record<string, { id: string }> = {}
  // sort so parents come first
  const sorted = [...catSpec].sort((a, b) => a.level - b.level)
  for (const c of sorted) {
    const parent = c.parent ? catByName[c.parent] : null
    const created = await db.category.create({
      data: {
        name: c.name,
        slug: slugify(c.name) + (c.parent ? "-" + slugify(c.parent) : ""),
        parentId: parent?.id ?? null,
        level: c.level,
        icon: c.icon ?? null,
        order: c.level === 0 ? ["Reparos", "Limpeza", "Reforma"].indexOf(c.name) : 0,
        active: true,
      },
    })
    catByName[c.name] = { id: created.id }
  }

  // --- SERVICES ---------------------------------------------------
  console.log("   • creating services...")
  type ServiceSeed = {
    providerKey: string
    subCat: string
    title: string
    description: string
    basePrice: number
    unit: string
    photoSeed: string
  }

  const servicesData: ServiceSeed[] = [
    {
      providerKey: "Encanador",
      subCat: "Desentupimento",
      title: "Desentupimento de ralo e pia",
      description:
        "Desentupimento de ralos, pias e vasos sanitários com equipamento profissional. Inclui diagnóstico e garantia de 30 dias.",
      basePrice: 120,
      unit: "UNIDADE",
      photoSeed: "service-1",
    },
    {
      providerKey: "Encanador",
      subCat: "Vazamento",
      title: "Localização e reparo de vazamento",
      description:
        "Detecção de vazamentos com equipamento acústico e reparo completo. Atendimento de emergência disponível.",
      basePrice: 200,
      unit: "UNIDADE",
      photoSeed: "service-2",
    },
    {
      providerKey: "Encanador",
      subCat: "Caixa de descarga",
      title: "Troca de caixa de descarga",
      description:
        "Substituição de caixa de descarga hidra ou de embutir. Inclui peça de qualidade e mão de obra.",
      basePrice: 180,
      unit: "UNIDADE",
      photoSeed: "service-3",
    },
    {
      providerKey: "Eletricista",
      subCat: "Tomadas e interruptores",
      title: "Troca de tomadas e interruptores",
      description:
        "Substituição de tomadas e interruptores com fiação revisada. Atende padrão novo (3 pinos).",
      basePrice: 25,
      unit: "UNIDADE",
      photoSeed: "service-4",
    },
    {
      providerKey: "Eletricista",
      subCat: "Curto-circuito",
      title: "Diagnóstico e reparo de curto-circuito",
      description:
        "Identificação da causa do curto, reparo da fiação e testes de segurança. Atendimento de emergência.",
      basePrice: 250,
      unit: "UNIDADE",
      photoSeed: "service-5",
    },
    {
      providerKey: "Eletricista",
      subCat: "Quadro elétrico",
      title: "Instalação de quadro de distribuição",
      description:
        "Montagem e instalação de quadro elétrico com disjuntores dimensionados conforme NBR 5410.",
      basePrice: 600,
      unit: "UNIDADE",
      photoSeed: "service-6",
    },
    {
      providerKey: "Pintor",
      subCat: "Pintura interna",
      title: "Pintura interna de parede",
      description:
        "Pintura de paredes internas com tinta acrílica de primeira linha. Preparo, massa corrida e 2 demãos.",
      basePrice: 35,
      unit: "METRO_QUADRADO",
      photoSeed: "service-7",
    },
    {
      providerKey: "Pintor",
      subCat: "Textura e grafiato",
      title: "Aplicação de textura e grafiato",
      description:
        "Aplicação de textura decorativa ou grafiato em paredes internas/externas. Material incluso.",
      basePrice: 55,
      unit: "METRO_QUADRADO",
      photoSeed: "service-8",
    },
    {
      providerKey: "Diarista",
      subCat: "Limpeza geral",
      title: "Diária de limpeza residencial",
      description:
        "Diária de 8 horas para limpeza geral de apartamentos e casas. Produtos de limpeza inclusos.",
      basePrice: 180,
      unit: "UNIDADE",
      photoSeed: "service-9",
    },
    {
      providerKey: "Diarista",
      subCat: "Limpeza pós-obra",
      title: "Limpeza pós-obra completa",
      description:
        "Limpeza profunda após reforma: remoção de resíduos, cimento, tinta e poeira. Até 100m².",
      basePrice: 650,
      unit: "UNIDADE",
      photoSeed: "service-10",
    },
    {
      providerKey: "Jardineiro",
      subCat: "Poda de árvores",
      title: "Poda de árvores e arbustos",
      description:
        "Poda de manutenção e limpeza de arbustos. Inclui remoção dos galhos. Orçamento por visita.",
      basePrice: 150,
      unit: "UNIDADE",
      photoSeed: "service-11",
    },
    {
      providerKey: "Pedreiro",
      subCat: "Assentamento de piso",
      title: "Assentamento de piso cerâmico",
      description:
        "Assentamento de pisos e azulejos cerâmicos porcelanatos. Inclui preparo do contrapiso.",
      basePrice: 45,
      unit: "METRO_QUADRADO",
      photoSeed: "service-12",
    },
    {
      providerKey: "Pedreiro",
      subCat: "Contrapiso",
      title: "Execução de contrapiso",
      description:
        "Preparo e execução de contrapiso nivelado para posterior assentamento de piso.",
      basePrice: 60,
      unit: "METRO_QUADRADO",
      photoSeed: "service-13",
    },
  ]

  const createdServices: { id: string; providerId: string }[] = []
  for (const s of servicesData) {
    const provider = providers[s.providerKey]
    const category = catByName[s.subCat]
    if (!provider || !category) {
      console.warn(`   ⚠ skipping service "${s.title}" — missing provider or category`)
      continue
    }
    const created = await db.service.create({
      data: {
        providerId: provider.id,
        categoryId: category.id,
        title: s.title,
        description: s.description,
        basePrice: s.basePrice,
        unit: s.unit,
        photos: [
          `https://picsum.photos/seed/${s.photoSeed}/800/600`,
          `https://picsum.photos/seed/${s.photoSeed}-2/800/600`,
        ],
        active: true,
      },
    })
    createdServices.push({ id: created.id, providerId: provider.id })
  }

  // --- BOOKINGS + REVIEWS -----------------------------------------
  console.log("   • creating bookings + reviews...")
  const encanador = providers["Encanador"]
  const eletricista = providers["Eletricista"]
  const encanadorServices = createdServices.filter(
    (s) => s.providerId === encanador.id,
  )
  const eletricistaServices = createdServices.filter(
    (s) => s.providerId === eletricista.id,
  )

  const now = Date.now()
  const daysAgo = (n: number) => new Date(now - n * 24 * 60 * 60 * 1000)

  const bookings = [
    {
      client: client1,
      provider: encanador,
      service: encanadorServices[0],
      scheduledAt: daysAgo(20),
      amount: 120,
      rating: 5,
      comment: "Excelente trabalho! Resolveu o vazamento rapidamente e ainda me deu dicas de manutenção.",
    },
    {
      client: client2,
      provider: encanador,
      service: encanadorServices[1],
      scheduledAt: daysAgo(15),
      amount: 220,
      rating: 4,
      comment: "Bom serviço, chegou um pouco atrasado mas resolveu tudo. Recomendo.",
    },
    {
      client: client1,
      provider: eletricista,
      service: eletricistaServices[0],
      scheduledAt: daysAgo(10),
      amount: 100,
      rating: 5,
      comment: "Profissional muito atencioso, trocou 4 tomadas em 1 hora. Super recomendado!",
    },
    {
      client: client2,
      provider: eletricista,
      service: eletricistaServices[1],
      scheduledAt: daysAgo(5),
      amount: 280,
      rating: 5,
      comment: "Curto-circuito resolvido na hora. Garantia de 90 dias fornecida.",
    },
  ]

  for (const b of bookings) {
    if (!b.service) continue
    const booking = await db.booking.create({
      data: {
        clientId: b.client.id,
        providerId: b.provider.id,
        serviceId: b.service.id,
        scheduledAt: b.scheduledAt,
        status: "COMPLETED",
        address: `${b.client.street ?? "Endereço"}, ${b.client.number ?? "s/n"}`,
        cep: b.client.cep ?? "00000-000",
        lat: b.client.lat ?? SP_LAT,
        lng: b.client.lng ?? SP_LNG,
        amount: b.amount,
        paymentMethod: "PIX",
        paymentStatus: "PAID",
        notes: "Serviço agendado via marketplace Severinno.",
      },
    })
    await db.payment.create({
      data: {
        bookingId: booking.id,
        amount: b.amount,
        method: "PIX",
        status: "PAID",
        transactionId: "TX" + booking.id.toUpperCase().slice(-10),
      },
    })
    await db.review.create({
      data: {
        bookingId: booking.id,
        clientId: b.client.id,
        providerId: b.provider.id,
        serviceId: b.service.id,
        rating: b.rating,
        comment: b.comment,
      },
    })
  }

  // --- FAVORITES --------------------------------------------------
  console.log("   • creating favorites...")
  await db.favorite.create({
    data: { clientId: client1.id, providerId: encanador.id },
  })
  await db.favorite.create({
    data: { clientId: client2.id, providerId: eletricista.id },
  })

  // --- NOTIFICATIONS (welcome) ------------------------------------
  for (const u of [admin, client1, client2, ...Object.values(providers)]) {
    await db.notification.create({
      data: {
        userId: u.id,
        type: "WELCOME",
        title: `Bem-vindo ao Severinno, ${u.name}!`,
        body: "Sua conta foi criada com sucesso. Comece a explorar o marketplace agora mesmo.",
        read: false,
      },
    })
  }

  // --- SETTINGS ---------------------------------------------------
  console.log("   • creating settings...")
  const settings = [
    { key: "site_name", value: "Severinno" },
    { key: "site_tagline", value: "Marketplace de serviços com geolocalização" },
    { key: "support_email", value: "suporte@severinno.com" },
    { key: "payment_pix_key", value: "suporte@severinno.com" },
    { key: "nominatim_enabled", value: "true" },
    { key: "viacep_enabled", value: "true" },
    { key: "default_search_radius_km", value: "15" },
    { key: "platform_fee_percent", value: "10" },
    { key: "quote_default_expiry_hours", value: "72" },
  ]
  for (const s of settings) {
    await db.setting.create({
      data: { key: s.key, value: s.value, updatedBy: admin.id },
    })
  }

  // ── Sync PostGIS location column (batch-inserted rows bypass trigger) ──
  console.log("   • syncing PostGIS location columns...")
  try {
    await db.$executeRawUnsafe(`
      UPDATE "User"
      SET location = ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography
      WHERE lat IS NOT NULL AND lng IS NOT NULL AND location IS NULL;
    `)
    await db.$executeRawUnsafe(`
      UPDATE "Booking"
      SET location = ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography
      WHERE lat IS NOT NULL AND lng IS NOT NULL AND location IS NULL;
    `)
    await db.$executeRawUnsafe(`
      UPDATE "QuoteRequest"
      SET location = ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography
      WHERE lat IS NOT NULL AND lng IS NOT NULL AND location IS NULL;
    `)
    console.log("   ✅ PostGIS locations synced")
  } catch (e) {
    // PostGIS may not be available (e.g. SQLite) — non-fatal
    console.log("   ⚠️  PostGIS sync skipped (extension not available)")
  }

  console.log("")
  console.log("✅ Seed completed successfully!")
  console.log(`   • Users:    1 admin + 2 clients + 6 providers`)
  console.log(`   • Categories: ${Object.keys(catByName).length} (3-level tree)`)
  console.log(`   • Services:  ${createdServices.length}`)
  console.log(`   • Bookings:  ${bookings.length} (all completed, with reviews)`)
  console.log(`   • Settings:  ${settings.length}`)
  console.log("")
  console.log("   🔑 Login credentials:")
  console.log("      admin@severinno.com   / admin123")
  console.log("      cliente@severinno.com / cliente123")
  console.log("      maria@severinno.com   / cliente123")
  console.log("      [provider]@severinno.com / provider123")
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e)
    process.exit(1)
  })
  .finally(async () => {
    await db.$disconnect()
  })
