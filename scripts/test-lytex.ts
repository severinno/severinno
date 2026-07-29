// @ts-nocheck
/**
 * Lytex Pagamentos — Integration test
 *
 * Usage:
 *   bun run scripts/test-lytex.ts                # test both PIX & card
 *   bun run scripts/test-lytex.ts pix            # test only PIX
 *   bun run scripts/test-lytex.ts card           # test only card
 *   bun run scripts/test-lytex.ts split          # test PIX with split
 *
 * Prerequisites:
 *   .env with LYTEX_CLIENT_ID, LYTEX_CLIENT_SECRET, LYTEX_BASE_URL
 *   .env with TEST_RECIPIENT_ID for split tests (optional, has hardcoded fallback)
 */

import { createPixCharge } from "../src/lib/lytex"

const BASE = process.env.LYTEX_BASE_URL ?? "https://api-pay.lytex.com.br"
const CLIENT_ID = process.env.LYTEX_CLIENT_ID ?? ""
const CLIENT_SECRET = process.env.LYTEX_CLIENT_SECRET ?? ""
const TEST_CPF = "52998224725"
const TEST_CARDS: Record<string, string> = {
  visa: "4111111111111111",
  master: "5555666677778884",
  elo: "4000000000000010",
}

let accessToken = ""
let pass = 0
let fail = 0

function assert(condition: boolean, msg: string) {
  if (condition) {
    console.log(`  ✅ ${msg}`)
    pass++
  } else {
    console.log(`  ❌ ${msg}`)
    fail++
  }
}

async function auth(): Promise<string> {
  console.log("\n🔑 Auth /v2/auth/obtain_token")
  const res = await fetch(`${BASE}/v2/auth/obtain_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET }),
  })
  assert(res.status === 200 || res.status === 201, `status ${res.status}`)
  const data = await res.json()
  assert(!!data.accessToken, "accessToken returned")
  console.log(`   token: ${data.accessToken.slice(0, 20)}...`)
  return data.accessToken
}

async function testPix() {
  console.log("\n" + "=".repeat(50))
  console.log("💳 PIX FLOW")
  console.log("=".repeat(50))

  const dueDate = new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0]
  const referenceId = `pix-test-${Date.now()}`

  // 1. Create invoice with PIX enabled
  console.log("\n1️⃣  POST /v2/invoices (PIX)")
  const invRes = await fetch(`${BASE}/v2/invoices`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({
      client: { name: "Test PIX", email: "pix@test.com", cpfCnpj: TEST_CPF, type: "pf", cellphone: "11999999999" },
      items: [{ name: "Serviço de teste", quantity: 1, value: 1990 }],
      dueDate,
      paymentMethods: { pix: { enable: true }, boleto: { enable: false }, creditCard: { enable: false } },
      referenceId,
    }),
  })
  assert(invRes.status === 201, `invoice created (${invRes.status})`)
  const inv = await invRes.json()
  assert(!!inv._id, `_id: ${inv._id}`)
  assert(!!inv._hashId, `_hashId: ${inv._hashId}`)
  assert(inv.status === "waitingPayment", `status: ${inv.status}`)
  assert(!!inv.linkCheckout, `linkCheckout: ${inv.linkCheckout.slice(0, 50)}...`)

  const pix = inv.paymentMethods?.pix
  assert(!!pix?.qrcode, "QR code returned")
  assert(!!pix?.txId, `txId: ${pix?.txId}`)
  console.log(`   invoice: ${inv._id}`)
  console.log(`   hashId: ${inv._hashId}`)
  console.log(`   total: R$${(inv.totalValue / 100).toFixed(2)}`)
  console.log(`   QR code length: ${pix.qrcode.length} chars`)
  console.log(`   txId: ${pix.txId}`)

  // 2. Get invoice by ID
  console.log("\n2️⃣  GET /v2/invoices/{id}")
  const getRes = await fetch(`${BASE}/v2/invoices/${inv._id}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  assert(getRes.status === 200, `get invoice (${getRes.status})`)
  const got = await getRes.json()
  assert(got._id === inv._id, "same _id")
  assert(got.status === "waitingPayment", `still waiting payment`)

  // 3. Simulate PIX payment in sandbox (only works in sandbox)
  const isSandbox = BASE.includes("sandbox")
  if (isSandbox) {
    console.log("\n3️⃣  POST /v2/invoices/manual-liquidate (sandbox only)")
    const liqRes = await fetch(`${BASE}/v2/invoices/manual-liquidate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ _invoiceId: inv._id }),
    })
    if (liqRes.status === 200 || liqRes.status === 201) {
      assert(true, "manual liquidation OK")
      const liq = await liqRes.json()
      console.log(`   status: ${liq.status}`)
    } else {
      const err = await liqRes.text()
      console.log(`   ⚠️  manual liquidation: ${liqRes.status} — ${err.slice(0, 100)}`)
    }
  } else {
    console.log("\n3️⃣  Manual liquidation (skipped — production)")
  }

  console.log("")
}

async function testCard() {
  console.log("\n" + "=".repeat(50))
  console.log("💳 CARD FLOW")
  console.log("=".repeat(50))

  const dueDate = new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0]
  const referenceId = `card-test-${Date.now()}`

  // 1. Create invoice with creditCard enabled
  console.log("\n1️⃣  POST /v2/invoices (cartão)")
  const invRes = await fetch(`${BASE}/v2/invoices`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({
      client: { name: "Test Card", email: "card@test.com", cpfCnpj: TEST_CPF, type: "pf", cellphone: "11999999999" },
      items: [{ name: "Serviço de teste cartão", quantity: 1, value: 5000 }],
      dueDate,
      paymentMethods: { pix: { enable: false }, boleto: { enable: false }, creditCard: { enable: true } },
      referenceId,
    }),
  })
  assert(invRes.status === 201, `invoice created (${invRes.status})`)
  const inv = await invRes.json()
  assert(!!inv._clientId, `_clientId: ${inv._clientId}`)
  console.log(`   invoice: ${inv._id}, clientId: ${inv._clientId}`)

  // 2. Test card tokenization for each brand
  console.log("\n2️⃣  POST /v2/invoices/card_token")
  for (const [brand, number] of Object.entries(TEST_CARDS)) {
    const tokenRes = await fetch(`${BASE}/v2/invoices/card_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        _clientId: inv._clientId,
        cpfCnpj: TEST_CPF,
        number,
        holder: "TEST USER",
        expiry: "1230",
        cvc: "123",
      }),
    })

    if (tokenRes.status === 201) {
      const data = await tokenRes.json()
      assert(true, `${brand}: tokenized → ${data.cardToken.slice(0, 8)}...`)
      assert(data.brand.toLowerCase().includes(brand === "master" ? "master" : brand === "visa" ? "visa" : brand), `brand: ${data.brand}`)
      assert(data.status === "valid", `status: ${data.status}`)
      assert(data.cardNumber.endsWith(number.slice(-4)), `masked: ${data.cardNumber}`)
    } else {
      const err = await tokenRes.text()
      assert(false, `${brand}: ${tokenRes.status} — ${err.slice(0, 80)}`)
    }
  }

  // 3. Pay with card (first token)
  console.log("\n3️⃣  POST /v2/invoices/pay")
  const tokenRes = await fetch(`${BASE}/v2/invoices/card_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({
      _clientId: inv._clientId,
      cpfCnpj: TEST_CPF,
      number: TEST_CARDS.visa,
      holder: "TEST USER",
      expiry: "1230",
      cvc: "123",
    }),
  })
  const { cardToken } = await tokenRes.json()
  assert(!!cardToken, `cardToken: ${cardToken.slice(0, 8)}...`)

  const payRes = await fetch(`${BASE}/v2/invoices/pay`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({
      _invoiceId: inv._id,
      _cardTokenId: cardToken,
      parcels: 1,
    }),
  })
  assert(payRes.status === 200, `pay status ${payRes.status}`)
  const pay = await payRes.json()
  console.log(`   pay _id: ${pay._id}`)
  console.log(`   pay status: ${pay.status}`)
  console.log(`   paymentMethod: ${pay.paymentMethod}`)
  console.log(`   brand: ${pay.creditCard?.brand}`)
  console.log(`   tid: ${pay.creditCard?.tid}`)

  if (pay.status === "paid") {
    assert(true, "payment approved!")
  } else if (pay.status === "recused") {
    assert(true, `recused (expected for test cards): ${pay.creditCard?.reject?.reason}`)
  } else {
    assert(false, `unexpected status: ${pay.status}`)
  }

  // 4. Get pay transaction
  console.log("\n4️⃣  GET /v2/invoices/{id}")
  const getRes = await fetch(`${BASE}/v2/invoices/${inv._id}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  assert(getRes.status === 200, `get invoice (${getRes.status})`)

  console.log("")
}

async function testSplit() {
  console.log("\n" + "=".repeat(50))
  console.log("🔀 SPLIT FLOW (PIX + split)")
  console.log("=".repeat(50))

  const recipientId = process.env.TEST_RECIPIENT_ID ?? "64f1a2b3c4d5e6f7a8b9c0d1"
  const referenceId = `split-test-${Date.now()}`
  const amount = 100
  const feePercent = 0.15
  const splitValue = Math.round(amount * 100 * feePercent)

  console.log(`\n1️⃣  Creating PIX charge with split`)
  console.log(`   recipient: ${recipientId}`)
  console.log(`   amount: R$${amount.toFixed(2)}`)
  console.log(`   split: ${(feePercent * 100)}% → R$${(splitValue / 100).toFixed(2)}`)

  const result = await createPixCharge({
    amount,
    externalId: referenceId,
    payer: { name: "Test Split", cpfCnpj: TEST_CPF, email: "split@test.com" },
    description: "Teste split PIX",
    split: {
      recipients: [
        { _recipientId: recipientId, value: splitValue },
      ],
    },
  })

  assert(!!result.id, `charge created: ${result.id}`)
  assert(!!result.qrCode, "QR code returned")
  console.log(`   charge id: ${result.id}`)
  console.log(`   status: ${result.status}`)
  console.log(`   amount: R$${result.amount.toFixed(2)}`)
  console.log(`   txId: ${result.txId}`)
  console.log(`   checkout: ${result.checkoutUrl}`)
  console.log(`   split recipients:`, JSON.stringify([{ _recipientId: recipientId, value: splitValue }], null, 2))

  console.log("")
}

async function main() {
  const mode = process.argv[2] ?? "all"

  if (!CLIENT_ID || !CLIENT_SECRET) {
    console.error("❌ LYTEX_CLIENT_ID and LYTEX_CLIENT_SECRET must be set in .env")
    process.exit(1)
  }

  console.log(`🌐 ${BASE}`)
  console.log(`📋 mode: ${mode}`)

  accessToken = await auth()

  if (mode === "all" || mode === "pix") await testPix()
  if (mode === "all" || mode === "card") await testCard()
  if (mode === "split") await testSplit()

  // Summary
  console.log("=".repeat(50))
  console.log(`📊 Results: ${pass} passed, ${fail} failed`)
  console.log("=".repeat(50))
  process.exit(fail > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error("💥", err)
  process.exit(1)
})
