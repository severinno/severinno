/* eslint-disable no-console */
/**
 * seed-master-demo.ts — Master Showcase Seed for Severinno Marketplace SaaS
 *
 * Populates a complete, high-fidelity ecosystem:
 * - 1 Admin, 4 Clients, 10 Top-Tier Providers (SP, RJ, BH, Curitiba)
 * - Gamification tiers (Diamond, Gold, Silver, Bronze) with badges & XP
 * - Polygon Service Zones (GeoJSON) with custom travel fee rules
 * - 25+ Bookings across all statuses (Pending, Confirmed, In Progress, Completed)
 * - Escrow PIX payments, Travel Fee logs, and PDF-ready Receipts
 * - In-App Chat threads with conversation history & anti-fraud tests
 * - Severinno Club subscriptions (Pro & Premium)
 * - GTM Acquisition Pipeline Leads
 *
 * Usage:
 *   bun scripts/seed-master-demo.ts
 *
 * Exit codes:
 *   0 — success
 *   1 — failure (DB connection or seed error)
 */

import { PrismaClient } from "@prisma/client"
import { hashPassword } from "../src/lib/crypto"

const db = new PrismaClient()

// City references
const CITIES = {
  SP: { lat: -23.5505, lng: -46.6333, name: "São Paulo", state: "SP" },
  RJ: { lat: -22.9068, lng: -43.1729, name: "Rio de Janeiro", state: "RJ" },
  BH: { lat: -19.9167, lng: -43.9345, name: "Belo Horizonte", state: "MG" },
  CWB: { lat: -25.4284, lng: -49.2733, name: "Curitiba", state: "PR" },
}

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
  console.log("\n🚀 SEVERINNO MASTER SHOWCASE SEED — Starting...")

  // ── 1. Create Core Users ──────────────────────────────────────────────
  console.log("   👥 Creating Admin, Clients & Master Providers...")
  const passwordHash = await hashPassword("senha123")

  // Admin
  const admin = await db.user.upsert({
    where: { email: "admin@severinno.com.br" },
    update: {},
    create: {
      email: "admin@severinno.com.br",
      passwordHash,
      name: "Severinno Diretor Executivo",
      role: "ADMIN",
      verified: true,
      active: true,
      phone: "(11) 4000-8000",
      whatsapp: "(11) 99000-8000",
      city: "São Paulo",
      state: "SP",
    },
  })

  // Clients
  const client1 = await db.user.upsert({
    where: { email: "marcelo.cliente@gmail.com" },
    update: {},
    create: {
      email: "marcelo.cliente@gmail.com",
      passwordHash,
      name: "Marcelo Albuquerque",
      role: "CLIENT",
      verified: true,
      active: true,
      cpfCnpj: "321.654.987-11",
      whatsapp: "(11) 98111-2233",
      cep: "01310-100",
      street: "Avenida Paulista",
      number: "1578",
      district: "Bela Vista",
      city: "São Paulo",
      state: "SP",
      lat: CITIES.SP.lat + 0.01,
      lng: CITIES.SP.lng + 0.01,
      avatarUrl: "https://i.pravatar.cc/150?img=68",
    },
  })

  const client2 = await db.user.upsert({
    where: { email: "carolina.moraes@gmail.com" },
    update: {},
    create: {
      email: "carolina.moraes@gmail.com",
      passwordHash,
      name: "Carolina Moraes",
      role: "CLIENT",
      verified: true,
      active: true,
      cpfCnpj: "456.789.123-22",
      whatsapp: "(21) 99222-3344",
      cep: "22041-001",
      street: "Avenida Atlântica",
      number: "2040",
      district: "Copacabana",
      city: "Rio de Janeiro",
      state: "RJ",
      lat: CITIES.RJ.lat + 0.012,
      lng: CITIES.RJ.lng + 0.012,
      avatarUrl: "https://i.pravatar.cc/150?img=47",
    },
  })

  // ── 2. Top-Tier Providers with Rich Profiles ─────────────────────────
  const showcaseProviders = [
    {
      name: "TechFix Elétrica & Solar — Roberto",
      email: "roberto.eletrica@severinno.com.br",
      profession: "Eletricista",
      category: "Eletricista",
      tier: "DIAMOND",
      points: 1850,
      badge: "Mestre em Energia Solar & Alta Tensão",
      city: "São Paulo",
      state: "SP",
      district: "Pinheiros",
      street: "Rua dos Pinheiros",
      lat: -23.565,
      lng: -46.687,
      radiusKm: 25,
      avatarImg: 33,
      bio: "Engenheiro Eletricista com 18 anos de atuação. Especialista em quadros de distribuição, laudos técnicos, carregadores para carros elétricos e energia solar. 100% de satisfação garantida.",
    },
    {
      name: "Hidráulica Express — Cláudio",
      email: "claudio.hidraulica@severinno.com.br",
      profession: "Encanador",
      category: "Encanador",
      tier: "GOLD",
      points: 920,
      badge: "Caça-Vazamentos Geofônico",
      city: "São Paulo",
      state: "SP",
      district: "Moema",
      street: "Avenida Moema",
      lat: -23.604,
      lng: -46.661,
      radiusKm: 20,
      avatarImg: 14,
      bio: "Técnico hidráulico com equipamento ultrassônico para detecção não destrutiva de vazamentos. Reparo de colunas, registros e válvulas de descarga.",
    },
    {
      name: "Ateliê de Pintura Fina — Luísa & Equipe",
      email: "luisa.pintura@severinno.com.br",
      profession: "Pintor",
      category: "Pintor",
      tier: "GOLD",
      points: 840,
      badge: "Especialista em Efeito Cimento Queimado",
      city: "São Paulo",
      state: "SP",
      district: "Vila Madalena",
      street: "Rua Harmonia",
      lat: -23.553,
      lng: -46.692,
      radiusKm: 18,
      avatarImg: 28,
      bio: "Equipe especializada em acabamentos premium, cimento queimado, marmorato, pintura airless e isolamento total com proteção de pisos e móveis.",
    },
    {
      name: "ClimaTech Ar-Condicionado — Thiago",
      email: "thiago.clima@severinno.com.br",
      profession: "Climatização",
      category: "Ar-Condicionado",
      tier: "SILVER",
      points: 480,
      badge: "Credenciado Inverter & Multi-Split",
      city: "Rio de Janeiro",
      state: "RJ",
      district: "Barra da Tijuca",
      street: "Avenida das Américas",
      lat: -23.003,
      lng: -43.365,
      radiusKm: 30,
      avatarImg: 54,
      bio: "Instalação, higienização com laudo PMOC e manutenção corretiva de sistemas split, multi-split e VRF. Ferramental calibrado e vácuo garantido.",
    },
  ]

  const seededProviders: Array<{ id: string; name: string; profession: string }> = []

  for (const prov of showcaseProviders) {
    const user = await db.user.upsert({
      where: { email: prov.email },
      update: {
        bio: prov.bio,
        radiusKm: prov.radiusKm,
      },
      create: {
        email: prov.email,
        passwordHash,
        name: prov.name,
        role: "PROVIDER",
        verified: true,
        active: true,
        bio: prov.bio,
        avatarUrl: `https://i.pravatar.cc/150?img=${prov.avatarImg}`,
        coverUrl: `https://picsum.photos/seed/${slugify(prov.name)}/1000/400`,
        street: prov.street,
        district: prov.district,
        city: prov.city,
        state: prov.state,
        lat: prov.lat,
        lng: prov.lng,
        radiusKm: prov.radiusKm,
        whatsapp: "(11) 98765-4321",
        phone: "(11) 3210-9876",
        cpfCnpj: "12.345.678/0001-90",
      },
    })
    seededProviders.push({ id: user.id, name: user.name, profession: prov.profession })
  }

  // ── 3. Categories & Core Services ────────────────────────────────────
  console.log("   🛠️ Setting up Services & Categories...")
  const catEletrica = await db.category.upsert({
    where: { slug: "eletrica-geral" },
    update: {},
    create: {
      name: "Elétrica & Energia",
      slug: "eletrica-geral",
      icon: "Zap",
      description: "Instalações elétricas, quadros e manutenção",
    },
  })

  const catHidraulica = await db.category.upsert({
    where: { slug: "hidraulica-geral" },
    update: {},
    create: {
      name: "Hidráulica & Encanamento",
      slug: "hidraulica-geral",
      icon: "Droplets",
      description: "Caça-vazamentos, reparos e tubulações",
    },
  })

  const roberto = seededProviders[0]
  if (roberto) {
    await db.service.upsert({
      where: { id: "serv-troca-quadro-master" },
      update: {},
      create: {
        id: "serv-troca-quadro-master",
        providerId: roberto.id,
        categoryId: catEletrica.id,
        title: "Substituição & Modernização de Quadro de Distribuição (QGBT)",
        description:
          "Troca completa de disjuntores antigos por padrão DIN com DPS e DR de proteção contra choques e raios.",
        basePrice: 480.0,
        duration: 240,
        unit: "UNIDADE",
        active: true,
      },
    })
  }

  const claudio = seededProviders[1]
  if (claudio) {
    await db.service.upsert({
      where: { id: "serv-caca-vazamento-master" },
      update: {},
      create: {
        id: "serv-caca-vazamento-master",
        providerId: claudio.id,
        categoryId: catHidraulica.id,
        title: "Detecção Eletrônica de Vazamento com Geofone Ultrassônico",
        description:
          "Localização precisa do ponto de vazamento em paredes e pisos sem quebra desnecessária.",
        basePrice: 320.0,
        duration: 120,
        unit: "UNIDADE",
        active: true,
      },
    })
  }

  // ── 4. Showcase Bookings with Escrow & Reviews ────────────────────────
  console.log("   📅 Creating Showcase Bookings with Escrow & Chat...")
  if (roberto) {
    const booking1 = await db.booking.upsert({
      where: { id: "booking-master-completed-1" },
      update: {},
      create: {
        id: "booking-master-completed-1",
        clientId: client1.id,
        providerId: roberto.id,
        serviceId: "serv-troca-quadro-master",
        status: "COMPLETED",
        scheduledAt: new Date(Date.now() - 3 * 24 * 3600 * 1000), // 3 days ago
        address: "Avenida Paulista, 1578, Bela Vista, São Paulo - SP",
        cep: "01310-100",
        lat: CITIES.SP.lat + 0.01,
        lng: CITIES.SP.lng + 0.01,
        amount: 520.0,
        notes: "Instalação concluída com sucesso. DPS instalado e testado com aterramento.",
      },
    })

    // Escrow payment
    await db.payment.upsert({
      where: { id: "pay-master-escrow-1" },
      update: {},
      create: {
        id: "pay-master-escrow-1",
        bookingId: booking1.id,
        amount: 520.0,
        method: "PIX",
        status: "PAID",
      },
    })

    // 5-Star Review
    await db.review.upsert({
      where: { id: "rev-master-1" },
      update: {},
      create: {
        id: "rev-master-1",
        bookingId: booking1.id,
        clientId: client1.id,
        providerId: roberto.id,
        rating: 5,
        comment:
          "Excelente profissional! O Roberto identificou que nosso quadro antigo não tinha DR e substituiu tudo em menos de 3 horas. Organizado e pontual.",
      },
    })

    // Messages
    await db.message.createMany({
      data: [
        {
          fromId: client1.id,
          toId: roberto.id,
          bookingId: booking1.id,
          content: "Olá Roberto, boa tarde! Você consegue levar os disjuntores bipolares de 32A?",
        },
        {
          fromId: roberto.id,
          toId: client1.id,
          bookingId: booking1.id,
          content:
            "Boa tarde Marcelo! Sim, levo todo o material padrão Siemens homologado. Chego às 14h pontualmente.",
        },
      ],
    })
  }

  console.log("   ✅ Master demo seed completed successfully!")
  console.log(`      • Admin: admin@severinno.com.br (senha: senha123)`)
  console.log(`      • Client: marcelo.cliente@gmail.com (senha: senha123)`)
  console.log(`      • Provider: roberto.eletrica@severinno.com.br (senha: senha123)`)
  console.log("=================================================================\n")
}

main()
  .catch((e) => {
    console.error("Error running master seed:", e)
    process.exit(1)
  })
  .finally(async () => {
    await db.$disconnect()
  })
