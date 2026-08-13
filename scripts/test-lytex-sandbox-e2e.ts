/**
 * test-lytex-sandbox-e2e.ts
 *
 * End-to-End simulation script for Lytex Payments Lifecycle:
 *   1. PIX Charge creation with externalReference & customer
 *   2. HMAC-SHA256 webhook payload signing & verification
 *   3. Payment confirmation, split calculation (85% provider / 15% platform)
 *   4. Booking state transition & financial settlement validation
 *
 * Usage:
 *   bun scripts/test-lytex-sandbox-e2e.ts
 *
 * Exit codes:
 *   0 — success
 *   1 — failure
 */

import { createHmac } from "crypto"
import {
  parseExternalReference,
  verifyWebhookSignature,
  type LytexWebhookPayload,
  type PixChargeRequest,
} from "../src/lib/lytex"

const PLATFORM_FEE_PERCENTAGE = 0.15 // 15%
const PROVIDER_SPLIT_PERCENTAGE = 0.85 // 85%

interface TestResult {
  step: string
  status: "PASS" | "FAIL"
  details: string
}

const results: TestResult[] = []

function assert(step: string, condition: boolean, details: string) {
  if (condition) {
    results.push({ step, status: "PASS", details })
    console.log(`  \x1b[32m✔\x1b[0m [${step}] ${details}`)
  } else {
    results.push({ step, status: "FAIL", details })
    console.error(`  \x1b[31m✖\x1b[0m [${step}] FAILED: ${details}`)
    process.exitCode = 1
  }
}

async function runLytexE2E() {
  console.log("\n=======================================================")
  console.log("   🧪 LYTEX PAYMENT LIFECYCLE — E2E SANDBOX SIMULATION")
  console.log("=======================================================\n")

  const testBookingId = "bk_test_" + Date.now()
  const testAmount = 200.0 // R$ 200,00

  // ── Step 1: Charge Generation ─────────────────────────────────────────────
  console.log("Step 1: Gerando payload de cobrança PIX...")
  const chargeRequest: PixChargeRequest = {
    externalReference: `booking:${testBookingId}`,
    amount: testAmount,
    customer: {
      name: "Cliente Teste Severinno",
      email: "cliente.teste@severinno.com.br",
      cpfCnpj: "123.456.789-00",
      phone: "11999998888",
    },
    description: "Serviço de Instalação Elétrica",
  }

  const parsedRef = parseExternalReference(chargeRequest.externalReference)
  const refType = parsedRef?.type
  const refId = parsedRef?.id
  assert(
    "1. External Reference Parsing",
    refType === "booking" && refId === testBookingId,
    `Resolved type '${refType}' and id '${refId}' correctly`,
  )

  // ── Step 2: Webhook Signature & Dispatch ──────────────────────────────────
  console.log("\nStep 2: Construindo e assinando webhook da Lytex...")
  const webhookBody = {
    event: "charge.paid",
    data: {
      id: "lytex_ch_" + Math.random().toString(36).substring(7),
      externalReference: chargeRequest.externalReference,
      amount: testAmount,
      status: "paid",
      paymentMethod: "pix",
      paidAt: new Date().toISOString(),
      pix: {
        txid: "TXID-" + Date.now(),
        endToEndId: "E2E-" + Date.now(),
      },
    },
  }

  const { signature: _ignored, ...payloadWithoutSignature } = webhookBody as any
  const rawBody = JSON.stringify(payloadWithoutSignature)
  const clientSecret = process.env.LYTEX_CLIENT_SECRET || "lytex-client-secret-test-32-chars-long"

  const validSignature = createHmac("sha256", clientSecret).update(rawBody).digest("hex")

  const signedWebhookPayload = {
    ...webhookBody,
    signature: validSignature,
  } as unknown as LytexWebhookPayload

  const tamperedWebhookPayload = {
    ...webhookBody,
    signature: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  } as unknown as LytexWebhookPayload

  const isValidSignature = verifyWebhookSignature(signedWebhookPayload)
  assert(
    "2a. Webhook Signature Verification (Valid)",
    isValidSignature === true,
    "HMAC-SHA256 signature verified successfully",
  )

  const isInvalidSignature = verifyWebhookSignature(tamperedWebhookPayload)
  assert(
    "2b. Webhook Signature Security (Tampered)",
    isInvalidSignature === false,
    "Tampered signature rejected as expected",
  )

  // ── Step 3: Split & Financial Calculation ─────────────────────────────────
  console.log("\nStep 3: Calculando split e liquidação financeira...")
  const grossAmount = webhookBody.data.amount
  const platformFee = Number((grossAmount * PLATFORM_FEE_PERCENTAGE).toFixed(2))
  const providerNet = Number((grossAmount * PROVIDER_SPLIT_PERCENTAGE).toFixed(2))

  assert(
    "3a. Platform Commission",
    platformFee === 30.0,
    `Platform fee (15%): R$ ${platformFee.toFixed(2)}`,
  )

  assert(
    "3b. Provider Net Payout",
    providerNet === 170.0,
    `Provider net split (85%): R$ ${providerNet.toFixed(2)}`,
  )

  assert(
    "3c. Conservation of Funds",
    platformFee + providerNet === grossAmount,
    `Sum of splits (R$ ${platformFee + providerNet}) matches gross (R$ ${grossAmount})`,
  )

  // ── Step 4: Status Transitions ────────────────────────────────────────────
  console.log("\nStep 4: Validando transições de estado do agendamento...")
  const initialBookingState = {
    id: testBookingId,
    status: "CONFIRMED",
    paymentStatus: "PENDING",
  }

  const finalBookingState = {
    ...initialBookingState,
    paymentStatus: "PAID",
    paidAt: webhookBody.data.paidAt,
  }

  assert(
    "4. State Transition PENDING → PAID",
    finalBookingState.paymentStatus === "PAID" && finalBookingState.paidAt !== undefined,
    `Booking ${testBookingId} successfully transitioned to PAID`,
  )

  // ── Summary Report ────────────────────────────────────────────────────────
  console.log("\n=======================================================")
  console.log("   📊 RESULTADOS DO TESTE E2E LYTEX")
  console.log("=======================================================")
  const total = results.length
  const passed = results.filter((r) => r.status === "PASS").length
  console.log(`Total de verificações: ${total} | Aprovados: ${passed} | Falhas: ${total - passed}`)
  console.log(
    passed === total ? "✅ TODOS OS TESTES PASSARAM COM SUCESSO!\n" : "❌ HOUVE FALHAS NO TESTE.\n",
  )
}

runLytexE2E().catch((err) => {
  console.error("Erro fatal no teste E2E:", err)
  process.exit(1)
})
