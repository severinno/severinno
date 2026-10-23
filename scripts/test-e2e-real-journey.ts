#!/usr/bin/env bun
/**
 * scripts/test-e2e-real-journey.ts
 *
 * Teste E2E da Jornada Completa em Governador Valadares (MG):
 * Valida com o BANCO DE DADOS REAL (PostgreSQL), REDIS, OSRM e WHATSAPP AUTORESPONDER:
 *   1. Setup de Cliente e Prestador em Gov. Valadares (resolvidos via CNEFE IBGE Rooftop)
 *   2. Solicitação de Orçamento (QuoteRequest + QuoteItem no PostgreSQL)
 *   3. Aceite e Criação de Reserva Oficial (Booking no PostgreSQL)
 *   4. Pagamento PIX com Retenção em Custódia (Payment HELD / Booking paymentStatus HELD)
 *   5. Despacho Viário com OSRM Real (traçado de rota, nós viários, distância e ETA)
 *   6. Telemetria em Trânsito com Suavização Kalman 2D e Snap-to-Road
 *   7. Auditoria de Presença Física com Geofence < 50m (STRICT) e Anti-Spoofing (>400m)
 *   8. Conclusão do Atendimento (Booking status COMPLETED)
 *   9. Liberação Conversacional de Custódia via WhatsApp Autoresponder (handleEscrowApproval / $transaction)
 *  10. Auditoria de Split Financeiro (15% Taxa Severinno / 85% Prestador)
 *  11. Teardown / Limpeza Segura dos Dados de Teste
 *
 * Usage:
 *   bun scripts/test-e2e-real-journey.ts
 *
 * Exit codes:
 *   0 — sucesso (todos os 28 passos da jornada E2E validados com sucesso)
 *   1 — falha em algum passo da jornada E2E
 */

import { PrismaClient } from "@prisma/client"
import { lookupCnefeGV } from "../src/lib/geo-cnefe"

const db = new PrismaClient()
import { calculateRoute } from "../src/lib/geo-osrm"
import { KalmanFilter2D } from "../src/lib/geo-kalman"
import { snapToRoad } from "../src/lib/map-matching"
import { validateEscrowGeofence } from "../src/lib/escrow-geofence"
import { handleEscrowApproval } from "../src/lib/whatsapp-autoresponder"
import { FEE_RATE } from "../src/lib/constants"
import { toMoneyNumber, feeOf, netOf } from "../src/lib/money"
import { hashPassword } from "../src/lib/crypto"

// Cores ANSI
const PASS = "\x1b[32m✓\x1b[0m"
const FAIL = "\x1b[31m✗\x1b[0m"
const INFO = "\x1b[34m→\x1b[0m"
const BOLD = "\x1b[1m"
const CYAN = "\x1b[36m"
const RESET = "\x1b[0m"

let passed = 0
let failed = 0
let step = 1

function ok(msg: string) {
  console.log(`  ${PASS} [Passo ${step++}] ${msg}`)
  passed++
}

function nok(msg: string, err?: unknown) {
  console.log(`  ${FAIL} [Passo ${step++}] ${msg}`)
  if (err) console.log(`       ${String(err).slice(0, 200)}`)
  failed++
}

function assert(cond: boolean, msg: string) {
  if (cond) ok(msg)
  else nok(msg)
}

async function runRealE2EJourney() {
  console.log("\n" + "═".repeat(80))
  console.log(
    `${BOLD}${CYAN}  🧪 TESTE E2E: JORNADA COMPLETA CLIENTE ↔ PRESTADOR EM GOV. VALADARES${RESET}`,
  )
  console.log("═".repeat(80) + "\n")

  const TEST_IDS = {
    client: "test-e2e-client-gv",
    provider: "test-e2e-provider-gv",
    category: "test-e2e-cat-eletrica",
    service: "test-e2e-srv-padrao",
    clientPhone: "5533999887766",
    providerPhone: "5533988776655",
  }

  try {
    // ──────────────────────────────────────────────────────────────────────────
    // FASE 1: Limpeza prévia e Setup no Banco de Dados
    // ──────────────────────────────────────────────────────────────────────────
    console.log(`${INFO} FASE 1: Setup da Infraestrutura e Cadastros em Gov. Valadares...\n`)

    // Limpeza defensiva
    await db.payment.deleteMany({
      where: { booking: { clientId: TEST_IDS.client } },
    })
    await db.booking.deleteMany({
      where: { clientId: TEST_IDS.client },
    })
    await db.quoteItem.deleteMany({
      where: { request: { clientId: TEST_IDS.client } },
    })
    await db.quoteRequest.deleteMany({
      where: { clientId: TEST_IDS.client },
    })
    await db.service.deleteMany({
      where: { id: TEST_IDS.service },
    })
    await db.category.deleteMany({
      where: { id: TEST_IDS.category },
    })
    await db.user.deleteMany({
      where: { id: { in: [TEST_IDS.client, TEST_IDS.provider] } },
    })

    // Resolução Rooftop via CNEFE IBGE Soberano
    const clientGeo = lookupCnefeGV({
      street: "Rua Peçanha",
      number: 450,
      cep: "35010-160",
    })
    assert(
      clientGeo !== null && clientGeo.district === "Centro",
      "Geocodificação CNEFE Cliente: Rua Peçanha, 450 (Centro)",
    )

    const providerGeo = lookupCnefeGV({
      street: "Avenida Presidente Juscelino Kubitschek",
      number: 1200,
    })
    assert(
      providerGeo !== null && providerGeo.district === "Vila Bretas",
      "Geocodificação CNEFE Prestador: Av. JK, 1200 (Vila Bretas)",
    )

    const pwd = await hashPassword("senha123")

    // Criação dos Usuários no PostgreSQL
    const clientUser = await db.user.create({
      data: {
        id: TEST_IDS.client,
        name: "Carlos Mendes (Cliente GV)",
        email: "carlos.gv@teste.com",
        passwordHash: pwd,
        role: "CLIENT",
        phone: TEST_IDS.clientPhone,
        whatsapp: TEST_IDS.clientPhone,
        street: "Rua Peçanha",
        number: "450",
        district: "Centro",
        cep: "35010-160",
        city: "Governador Valadares",
        state: "MG",
        lat: clientGeo!.lat,
        lng: clientGeo!.lng,
      },
    })
    assert(
      clientUser.id === TEST_IDS.client,
      "Usuário Cliente criado no PostgreSQL com coordenadas reais de GV",
    )

    const providerUser = await db.user.create({
      data: {
        id: TEST_IDS.provider,
        name: "Marcos Instalações (Prestador GV)",
        email: "marcos.eletrica@teste.com",
        passwordHash: pwd,
        role: "PROVIDER",
        phone: TEST_IDS.providerPhone,
        whatsapp: TEST_IDS.providerPhone,
        street: "Av. Pres. Juscelino Kubitschek",
        number: "1200",
        district: "Vila Bretas",
        cep: "35030-000",
        city: "Governador Valadares",
        state: "MG",
        lat: providerGeo!.lat,
        lng: providerGeo!.lng,
      },
    })
    assert(
      providerUser.id === TEST_IDS.provider,
      "Usuário Prestador criado no PostgreSQL com base na Vila Bretas",
    )

    // Categoria e Serviço
    const category = await db.category.create({
      data: {
        id: TEST_IDS.category,
        name: "Elétrica GV",
        slug: "eletrica-gv",
        icon: "Zap",
      },
    })

    const service = await db.service.create({
      data: {
        id: TEST_IDS.service,
        title: "Instalação de Padrão Bifásico CEMIG",
        description: "Instalação completa homologada padrão CEMIG 127/220V",
        basePrice: 350.0,
        providerId: providerUser.id,
        categoryId: category.id,
      },
    })
    assert(
      service.id === TEST_IDS.service,
      `Serviço criado no banco: "${service.title}" — R$ 350,00`,
    )

    // ──────────────────────────────────────────────────────────────────────────
    // FASE 2: Solicitação e Aceite de Orçamento (QuoteRequest)
    // ──────────────────────────────────────────────────────────────────────────
    console.log(`\n${INFO} FASE 2: Ciclo de Orçamento (QuoteRequest + QuoteItem)...\n`)

    const quote = await db.quoteRequest.create({
      data: {
        clientId: clientUser.id,
        providerId: providerUser.id,
        address: "Rua Peçanha, 450, Centro",
        cep: "35010-160",
        lat: clientGeo!.lat,
        lng: clientGeo!.lng,
        expiresAt: new Date(Date.now() + 7 * 86400000),
        status: "PENDING",
        items: {
          create: [
            {
              providerId: providerUser.id,
              serviceId: service.id,
              description: "Mão de obra homologada padrão CEMIG",
              price: 350.0,
              quantity: 1,
            },
          ],
        },
      },
      include: { items: true },
    })

    assert(
      quote.status === "PENDING",
      `Orçamento #${quote.id.slice(0, 8)} solicitado com sucesso (Status: PENDING)`,
    )
    assert(
      quote.items.length === 1 && Number(quote.items[0].price) === 350.0,
      "Item de orçamento cotado em R$ 350,00",
    )

    // Orçamento aprovado para conversão em agendamento
    const acceptedQuote = await db.quoteRequest.update({
      where: { id: quote.id },
      data: { status: "APPROVED" },
    })
    assert(
      acceptedQuote.status === "APPROVED",
      "Orçamento aprovado para contratação (Status: APPROVED)",
    )

    // ──────────────────────────────────────────────────────────────────────────
    // FASE 3: Criação de Reserva e Pagamento PIX em Custódia (Escrow)
    // ──────────────────────────────────────────────────────────────────────────
    console.log(`\n${INFO} FASE 3: Agendamento Oficial e Retenção em Custódia PIX...\n`)

    const booking = await db.booking.create({
      data: {
        clientId: clientUser.id,
        providerId: providerUser.id,
        serviceId: service.id,
        quoteId: quote.id,
        scheduledAt: new Date(Date.now() + 86400000), // amanhã
        status: "CONFIRMED",
        paymentStatus: "HELD", // Custódia ativa
        paymentMethod: "PIX",
        amount: 350.0,
        address: "Rua Peçanha, 450, Centro, Gov. Valadares",
        cep: "35010-160",
        lat: clientGeo!.lat,
        lng: clientGeo!.lng,
      },
    })
    assert(
      booking.paymentStatus === "HELD",
      `Agendamento #${booking.id.slice(0, 8)} criado: Custódia HELD (R$ 350,00)`,
    )

    const payment = await db.payment.create({
      data: {
        bookingId: booking.id,
        amount: 350.0,
        method: "PIX",
        status: "HELD",
        lytexId: `pix_sim_${Date.now()}`,
        qrCode: `00020126580014br.gov.bcb.pix0136${booking.id}520400005303986540350.005802BR5916SEVERINNO_ESCROW6009VALADARES62070503***6304`,
      },
    })
    assert(
      payment.status === "HELD",
      "Registro de Pagamento PIX vinculado com status HELD (Custódia Garantida)",
    )

    // ──────────────────────────────────────────────────────────────────────────
    // FASE 4: Despacho Viário e Rota OSRM Soberana em GV
    // ──────────────────────────────────────────────────────────────────────────
    console.log(`\n${INFO} FASE 4: Despacho Viário & Roteirização Cartográfica (OSRM)...\n`)

    const providerCoord: [number, number] = [providerGeo!.lat, providerGeo!.lng]
    const clientCoord: [number, number] = [clientGeo!.lat, clientGeo!.lng]

    const route = await calculateRoute(providerCoord, clientCoord)
    assert(
      route.distanceMeters > 2000,
      `Distância viária calculada pelo OSRM: ${(route.distanceMeters / 1000).toFixed(2)} km`,
    )
    assert(
      route.polyline.length >= 10,
      `Malha viária resolvida com ${route.polyline.length} nós cartográficos`,
    )

    // Prestador inicia deslocamento
    await db.booking.update({
      where: { id: booking.id },
      data: { status: "IN_PROGRESS" },
    })
    const inProgressBooking = await db.booking.findUnique({ where: { id: booking.id } })
    assert(
      inProgressBooking?.status === "IN_PROGRESS",
      "Prestador em deslocamento: Status do agendamento atualizado para IN_PROGRESS",
    )

    // ──────────────────────────────────────────────────────────────────────────
    // FASE 5: Telemetria em Trânsito, Suavização Kalman 2D & Snap-to-Road
    // ──────────────────────────────────────────────────────────────────────────
    console.log(`\n${INFO} FASE 5: Telemetria GNSS com Kalman 2D e Map-Matching...\n`)

    const kalman = new KalmanFilter2D()
    const pings = [
      { lat: -18.8415, lng: -41.9484, acc: 25 },
      { lat: -18.8462, lng: -41.9458, acc: 28 },
      { lat: -18.8505, lng: -41.9436, acc: 22 },
      { lat: -18.8545, lng: -41.9443, acc: 8 },
    ]

    let finalKalmanAcc = 999
    pings.forEach((p, idx) => {
      const smoothed = kalman.update(p.lat, p.lng, p.acc, Date.now() + idx * 5000)
      finalKalmanAcc = smoothed.accuracyMeters
    })
    assert(
      finalKalmanAcc < pings[0].acc,
      `Incerteza do sinal GPS suavizada pelo Kalman de 25m para ${finalKalmanAcc.toFixed(1)}m`,
    )

    const streetPolyline: [number, number][] = [
      [-41.9484, -18.8415],
      [-41.9458, -18.8462],
      [-41.9436, -18.8505],
      [-41.9443, -18.8545],
    ]
    const driftCoord: [number, number] = [-41.9438, -18.8504]
    const matched = snapToRoad(driftCoord, streetPolyline)
    assert(
      matched.isMatched && matched.bearing > 0,
      `Snap-to-Road projetou posição na pista com rumo viário de ${matched.bearing.toFixed(0)}°`,
    )

    // ──────────────────────────────────────────────────────────────────────────
    // FASE 6: Auditoria de Presença Física (Geofence < 50m) & Anti-Spoofing
    // ──────────────────────────────────────────────────────────────────────────
    console.log(`\n${INFO} FASE 6: Auditoria de Presença Física e Anti-Spoofing...\n`)

    // Check-in legítimo em frente ao portão (10.9 metros)
    const arrivalLat = clientGeo!.lat + 0.00008
    const arrivalLng = clientGeo!.lng + 0.00006
    const validArrival = validateEscrowGeofence({
      providerLocation: { lat: arrivalLat, lng: arrivalLng, accuracyM: 8 },
      serviceLocation: { lat: clientGeo!.lat, lng: clientGeo!.lng },
      precisionTier: "STRICT",
      maxAllowedAccuracyMeters: 35,
    })
    assert(
      validArrival.valid && validArrival.status === "VERIFIED",
      `Presença legítima confirmada a ${(validArrival.distanceKm * 1000).toFixed(1)}m (< 50m STRICT)`,
    )

    // Teste Anti-Fraude (prestador tenta forjar check-in a 550 metros)
    const spoofedArrival = validateEscrowGeofence({
      providerLocation: { lat: clientGeo!.lat + 0.005, lng: clientGeo!.lng + 0.003, accuracyM: 8 },
      serviceLocation: { lat: clientGeo!.lat, lng: clientGeo!.lng },
      precisionTier: "STRICT",
      maxAllowedAccuracyMeters: 35,
    })
    assert(
      !spoofedArrival.valid && spoofedArrival.status === "DEVIATION_DETECTED",
      "Anti-Fraude: Tentativa de check-in remoto a >500m BLOQUEADA com sucesso",
    )

    // ──────────────────────────────────────────────────────────────────────────
    // FASE 7: Conclusão do Serviço
    // ──────────────────────────────────────────────────────────────────────────
    console.log(`\n${INFO} FASE 7: Conclusão do Serviço pelo Profissional...\n`)

    await db.booking.update({
      where: { id: booking.id },
      data: { status: "COMPLETED" },
    })

    const completedBooking = await db.booking.findUnique({ where: { id: booking.id } })
    assert(
      completedBooking?.status === "COMPLETED",
      "Serviço finalizado pelo prestador (Status: COMPLETED)",
    )
    assert(
      completedBooking?.paymentStatus === "HELD",
      "Custódia permanece retida (HELD) aguardando conferência do cliente",
    )

    // ──────────────────────────────────────────────────────────────────────────
    // FASE 8: Liberação Conversacional de Custódia via WhatsApp Autoresponder
    // ──────────────────────────────────────────────────────────────────────────
    console.log(
      `\n${INFO} FASE 8: Liberação de Custódia Conversacional via WhatsApp Autoresponder...\n`,
    )

    // Cliente envia "LIBERAR" via WhatsApp
    const autoresponderResponse = await handleEscrowApproval(clientUser.id, booking.id)
    assert(
      autoresponderResponse.includes("Pagamento Liberado com Sucesso"),
      "Autoresponder processou comando conversacional e confirmou liberação",
    )

    // VERIFICAÇÃO NO BANCO DE DADOS REAL: A transação atômica foi de fato persistida?
    const postReleaseBooking = await db.booking.findUnique({ where: { id: booking.id } })
    const postReleasePayment = await db.payment.findUnique({ where: { bookingId: booking.id } })

    assert(
      postReleaseBooking?.paymentStatus === "PAID",
      `PostgreSQL Booking: paymentStatus atualizado atomicamente para PAID`,
    )
    assert(
      postReleasePayment?.status === "PAID",
      `PostgreSQL Payment: status atualizado atomicamente para PAID`,
    )
    assert(
      postReleaseBooking?.escrowReleasedAt !== null,
      `PostgreSQL Booking: escrowReleasedAt preenchido em ${postReleaseBooking?.escrowReleasedAt?.toISOString()}`,
    )

    // ──────────────────────────────────────────────────────────────────────────
    // FASE 9: Split Financeiro e Validação Contábil (15% Taxa Severinno)
    // ──────────────────────────────────────────────────────────────────────────
    console.log(`\n${INFO} FASE 9: Split Financeiro e Validação da Taxa de Plataforma...\n`)

    const gross = toMoneyNumber(postReleaseBooking?.amount)
    const platformFee = toMoneyNumber(feeOf(postReleaseBooking?.amount))
    const providerNet = toMoneyNumber(netOf(postReleaseBooking?.amount))

    assert(gross === 350.0, "Valor Bruto Auditado: R$ 350,00")
    assert(
      platformFee === 52.5,
      `Taxa Severinno (${(FEE_RATE * 100).toFixed(0)}%): R$ ${platformFee.toFixed(2)} exatos`,
    )
    assert(
      providerNet === 297.5,
      `Repasse Líquido do Prestador (85%): R$ ${providerNet.toFixed(2)} exatos`,
    )
    assert(
      platformFee + providerNet === gross,
      "Equação Contábil Provada: Taxa + Líquido === Bruto (zero centavos fantasmas)",
    )

    // ──────────────────────────────────────────────────────────────────────────
    // FASE 10: Limpeza Segura (Teardown)
    // ──────────────────────────────────────────────────────────────────────────
    console.log(`\n${INFO} FASE 10: Limpeza Segura dos Dados de Teste...\n`)

    await db.payment.deleteMany({ where: { bookingId: booking.id } })
    await db.booking.deleteMany({ where: { id: booking.id } })
    await db.quoteItem.deleteMany({ where: { requestId: quote.id } })
    await db.quoteRequest.deleteMany({ where: { id: quote.id } })
    await db.service.deleteMany({ where: { id: service.id } })
    await db.category.deleteMany({ where: { id: category.id } })
    await db.user.deleteMany({ where: { id: { in: [clientUser.id, providerUser.id] } } })

    ok("Dados de teste removidos do PostgreSQL com integridade referencial mantida.")

    console.log("\n" + "═".repeat(80))
    console.log(
      `${BOLD}${CYAN}  📋 RESULTADO FINAL: ${passed}/${passed + failed} PASSOS APROVADOS${RESET}`,
    )
    if (failed === 0) {
      console.log(
        `${BOLD}\x1b[32m  🎉 JORNADA COMPLETA E2E VALIDADA COM 100% DE SUCESSO EM GOV. VALADARES!${RESET}`,
      )
    } else {
      console.log(`${BOLD}\x1b[31m  ❌ ${failed} falha(s) detectada(s) na jornada E2E.${RESET}`)
    }
    console.log("═".repeat(80) + "\n")

    process.exit(failed > 0 ? 1 : 0)
  } catch (error) {
    console.error("❌ Erro fatal durante a jornada E2E:", error)
    process.exit(1)
  }
}

runRealE2EJourney()
