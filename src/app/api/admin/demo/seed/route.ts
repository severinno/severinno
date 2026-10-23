export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireRole } from "@/lib/auth"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { withRoute } from "@/lib/api-route"
import { hashPassword } from "@/lib/crypto"
import { cacheInvalidate } from "@/lib/redis"

export const POST = withRoute("api.admin.demo.seed.POST", async (request) => {
  await assertRateLimit(request, RATE_LIMITS.admin)
  await requireRole("ADMIN")

  const defaultPassword = hashPassword("Demo@123")

  // 1. Prestadores Canônicos de Governador Valadares
  const carlos = await db.user.upsert({
    where: { email: "carlos.silva@eletricagv.com.br" },
    create: {
      name: "Carlos Silva — Eletricista Profissional",
      email: "carlos.silva@eletricagv.com.br",
      passwordHash: defaultPassword,
      role: "PROVIDER",
      verified: true,
      identityStatus: "VERIFIED",
      phone: "(33) 98877-1122",
      city: "Governador Valadares",
      state: "MG",
      lat: -18.852,
      lng: -41.942,
      avgRating: 4.9,
      reviewCount: 48,
      bio: "Eletricista residencial e predial com 12 anos de experiência em Governador Valadares e região.",
    },
    update: {
      verified: true,
      identityStatus: "VERIFIED",
      lat: -18.852,
      lng: -41.942,
      active: true,
    },
  })

  const mariana = await db.user.upsert({
    where: { email: "mariana.santos@limpezagv.com.br" },
    create: {
      name: "Mariana Santos — Limpeza & Pós-Obra",
      email: "mariana.santos@limpezagv.com.br",
      passwordHash: defaultPassword,
      role: "PROVIDER",
      verified: true,
      identityStatus: "VERIFIED",
      phone: "(33) 99122-3344",
      city: "Governador Valadares",
      state: "MG",
      lat: -18.856,
      lng: -41.948,
      avgRating: 5.0,
      reviewCount: 62,
      bio: "Especialista em higienização profunda, limpeza pós-obra e organização residencial.",
    },
    update: {
      verified: true,
      identityStatus: "VERIFIED",
      lat: -18.856,
      lng: -41.948,
      active: true,
    },
  })

  const marcos = await db.user.upsert({
    where: { email: "marcos.oliveira@hidraulicagv.com.br" },
    create: {
      name: "Marcos Oliveira — Encanador & Caça-Vazamentos",
      email: "marcos.oliveira@hidraulicagv.com.br",
      passwordHash: defaultPassword,
      role: "PROVIDER",
      verified: true,
      identityStatus: "VERIFIED",
      phone: "(33) 98433-5566",
      city: "Governador Valadares",
      state: "MG",
      lat: -18.854,
      lng: -41.954,
      avgRating: 4.8,
      reviewCount: 39,
      bio: "Localização eletrônica de vazamentos, troca de prumadas e reparos hidráulicos urgentes.",
    },
    update: {
      verified: true,
      identityStatus: "VERIFIED",
      lat: -18.854,
      lng: -41.954,
      active: true,
    },
  })

  const lucasKyc = await db.user.upsert({
    where: { email: "lucas.clima@gvtecnologia.com.br" },
    create: {
      name: "Lucas Mendes — Climatização Split",
      email: "lucas.clima@gvtecnologia.com.br",
      passwordHash: defaultPassword,
      role: "PROVIDER",
      verified: false,
      identityStatus: "PENDING", // PENDENTE KYC PARA DEMO
      phone: "(33) 99811-7788",
      city: "Governador Valadares",
      state: "MG",
      lat: -18.848,
      lng: -41.939,
      avgRating: 4.7,
      reviewCount: 14,
      bio: "Instalação técnica e higienização antibacteriana de ar-condicionado residencial.",
    },
    update: {
      identityStatus: "PENDING",
      verified: false,
      active: true,
    },
  })

  // 2. Clientes Exemplares
  const juliana = await db.user.upsert({
    where: { email: "juliana.prado.gv@gmail.com" },
    create: {
      name: "Dra. Juliana Prado",
      email: "juliana.prado.gv@gmail.com",
      passwordHash: defaultPassword,
      role: "CLIENT",
      verified: true,
      phone: "(33) 98711-2233",
      city: "Governador Valadares",
      state: "MG",
    },
    update: { active: true },
  })

  const thiago = await db.user.upsert({
    where: { email: "thiago.vasconcelos.gv@gmail.com" },
    create: {
      name: "Thiago Vasconcelos",
      email: "thiago.vasconcelos.gv@gmail.com",
      passwordHash: defaultPassword,
      role: "CLIENT",
      verified: true,
      phone: "(33) 99188-4455",
      city: "Governador Valadares",
      state: "MG",
    },
    update: { active: true },
  })

  // 3. Obter ou vincular categorias correspondentes
  const catEletrica = await db.category.findFirst({ where: { slug: "quadro-de-energia-eletrica" } })
  const catLimpeza = await db.category.findFirst({
    where: { slug: "diaria-residencial-limpeza-residencial" },
  })
  const catHidraulica = await db.category.findFirst({ where: { slug: "vazamentos-hidraulica" } })

  const fallbackCat = await db.category.findFirst({ where: { level: 0 } })
  const catId = (c: typeof catEletrica) => c?.id ?? fallbackCat?.id ?? "cat-reforma"

  // 4. Serviços cadastrados para cada prestador
  const srvCarlos = await db.service.upsert({
    where: { id: "srv-demo-gv-carlos-01" },
    create: {
      id: "srv-demo-gv-carlos-01",
      providerId: carlos.id,
      categoryId: catId(catEletrica),
      title: "Instalação e Manutenção de Quadro de Energia",
      description:
        "Dimensionamento de disjuntores, balanceamento de fases e fiação anti-chama em GV.",
      basePrice: 220,
      unit: "UNIDADE",
      active: true,
    },
    update: { active: true, basePrice: 220 },
  })

  const srvMariana = await db.service.upsert({
    where: { id: "srv-demo-gv-mariana-01" },
    create: {
      id: "srv-demo-gv-mariana-01",
      providerId: mariana.id,
      categoryId: catId(catLimpeza),
      title: "Diária Residencial Padrão & Organização",
      description:
        "Limpeza completa de ambientes com materiais profissionais e capricho nos detalhes.",
      basePrice: 160,
      unit: "UNIDADE",
      active: true,
    },
    update: { active: true, basePrice: 160 },
  })

  const srvMarcos = await db.service.upsert({
    where: { id: "srv-demo-gv-marcos-01" },
    create: {
      id: "srv-demo-gv-marcos-01",
      providerId: marcos.id,
      categoryId: catId(catHidraulica),
      title: "Detecção Eletrônica de Vazamento e Reparo",
      description: "Geofone digital, reparo sem quebra desnecessária e teste de pressão da rede.",
      basePrice: 180,
      unit: "UNIDADE",
      active: true,
    },
    update: { active: true, basePrice: 180 },
  })

  // 5. Agendamentos Operacionais do Cenário de Investidor
  const now = new Date()

  // Agendamento 1: EM ANDAMENTO NA ILHA DOS ARAÚJOS (Para ver na Torre de Controle)
  await db.booking.upsert({
    where: { id: "book-demo-gv-in-progress" },
    create: {
      id: "book-demo-gv-in-progress",
      clientId: juliana.id,
      providerId: carlos.id,
      serviceId: srvCarlos.id,
      scheduledAt: now,
      status: "IN_PROGRESS",
      paymentStatus: "PAID",
      paymentMethod: "PIX",
      amount: 220,
      quantity: 1,
      unit: "UNIDADE",
      address: "Rua 18, 142, Ilha dos Araújos, Governador Valadares",
      cep: "35020-000",
      lat: -18.8572,
      lng: -41.9515,
      escrowReleasedAt: null, // CUSTÓDIA RETIDA NO ESCROW
      notes: "Atendimento iniciado. Prestador com geofence confirmada a 12m do portão.",
    },
    update: {
      status: "IN_PROGRESS",
      paymentStatus: "PAID",
      escrowReleasedAt: null,
      lat: -18.8572,
      lng: -41.9515,
    },
  })

  // Agendamento 2: CONFIRMADO PARA HOJE À TARDE NO CENTRO
  await db.booking.upsert({
    where: { id: "book-demo-gv-confirmed" },
    create: {
      id: "book-demo-gv-confirmed",
      clientId: thiago.id,
      providerId: mariana.id,
      serviceId: srvMariana.id,
      scheduledAt: new Date(now.getTime() + 3 * 3600 * 1000), // Daqui 3 horas
      status: "CONFIRMED",
      paymentStatus: "PAID",
      paymentMethod: "PIX",
      amount: 160,
      quantity: 1,
      unit: "UNIDADE",
      address: "Rua Peçanha, 450, Centro, Governador Valadares",
      cep: "35010-000",
      lat: -18.8535,
      lng: -41.9452,
      escrowReleasedAt: null,
      notes: "Confirmação realizada. Notificação push de lembrete enviada ao prestador.",
    },
    update: {
      status: "CONFIRMED",
      paymentStatus: "PAID",
    },
  })

  // Agendamento 3: CONCLUÍDO COM CUSTÓDIA RETIDA (Pronto para Liberação Manual no Mapa pelo Gestor)
  const booking3 = await db.booking.upsert({
    where: { id: "book-demo-gv-ready-escrow" },
    create: {
      id: "book-demo-gv-ready-escrow",
      clientId: juliana.id,
      providerId: marcos.id,
      serviceId: srvMarcos.id,
      scheduledAt: new Date(now.getTime() - 2 * 3600 * 1000), // Concluído há 2h
      status: "COMPLETED",
      paymentStatus: "PAID",
      paymentMethod: "PIX",
      amount: 180,
      quantity: 1,
      unit: "UNIDADE",
      address: "Avenida Afonso Pena, 1850, Vila Bretas, Governador Valadares",
      cep: "35030-000",
      lat: -18.8495,
      lng: -41.9388,
      escrowReleasedAt: null, // Pronto para o admin clicar em "Liberar Custódia"
      completionNote: "Troca do registro e teste hidrostático concluído com foto de comprovação.",
    },
    update: {
      status: "COMPLETED",
      paymentStatus: "PAID",
      escrowReleasedAt: null,
    },
  })

  // Agendamento 4: CONCLUÍDO COM ESCROW JÁ PAGO (Gera receita comprovada)
  await db.booking.upsert({
    where: { id: "book-demo-gv-settled" },
    create: {
      id: "book-demo-gv-settled",
      clientId: thiago.id,
      providerId: carlos.id,
      serviceId: srvCarlos.id,
      scheduledAt: new Date(now.getTime() - 24 * 3600 * 1000), // Ontem
      status: "COMPLETED",
      paymentStatus: "PAID",
      paymentMethod: "PIX",
      amount: 350,
      quantity: 1,
      unit: "UNIDADE",
      address: "Rua Israel Pinheiro, 2100, Centro, Governador Valadares",
      cep: "35010-000",
      lat: -18.8542,
      lng: -41.9465,
      escrowReleasedAt: new Date(now.getTime() - 22 * 3600 * 1000),
      completionNote: "Instalação de circuito independente para ar-condicionado. Serviço aprovado.",
    },
    update: {
      status: "COMPLETED",
      paymentStatus: "PAID",
      escrowReleasedAt: new Date(now.getTime() - 22 * 3600 * 1000),
    },
  })

  // 6. Disputa de Demonstração (Mediação & Escrow)
  await db.dispute.upsert({
    where: { id: "disp-demo-gv-01" },
    create: {
      id: "disp-demo-gv-01",
      bookingId: booking3.id,
      reason: "Dúvida quanto à garantia da peça instalada pelo prestador.",
      status: "OPEN",
    },
    update: {
      status: "OPEN",
    },
  })

  // 7. Invalidação de Caches
  await Promise.all([
    cacheInvalidate("admin:*"),
    cacheInvalidate("categories:*"),
    cacheInvalidate("providers:*"),
  ])

  return NextResponse.json(
    {
      ok: true,
      message: "Cenário Piloto de Governador Valadares ativado com sucesso para demonstração!",
      city: "Governador Valadares (MG)",
      providers: [carlos.name, mariana.name, marcos.name, lucasKyc.name],
      bookingsSummary: {
        inProgress: 1,
        confirmedToday: 1,
        readyEscrowRelease: 1,
        settled: 1,
      },
      kycPending: lucasKyc.name,
      disputeOpen: 1,
      gvCoordinates: { lat: -18.8548, lng: -41.9482 },
    },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    },
  )
})
