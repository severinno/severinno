import { test, expect, type Page } from "@playwright/test"
import type { WebSocket as PlaywrightWebSocket } from "playwright"

// =========================================================================
// Limite de Sessões — E2E (Realtime)
//
// Cenário: o mesmo usuário abre o dashboard em DUAS abas (mesmo browser
// context → mesmo cookie → mesma sessão). O realtime mantém apenas o socket
// MAIS RECENTE (REALTIME_MAX_SESSIONS_PER_USER, default 1) e derruba os
// antigos com motivo "session_limit":
//   1. Aba A abre o dashboard → socket A dá join em user:{providerId}.
//   2. Aba B abre o dashboard → socket B dá join; o servidor detecta o
//      excesso (sweep fetchSockets + selectSocketsToKickForSessionLimit) e
//      força o close do socket A (evento session:limit + close atrasado).
//   3. O client da aba A reseta o singleton (onSessionLimited) e NÃO
//      reconecta — o websocket fecha de verdade (sem loop join→kick→rejoin).
//   4. O socket B continua vivo e recebe o toast de um novo booking — prova
//      que o "mais recente vence" e o canal não quebrou.
//
// ISOLAMENTO COMPLETO (provider E client próprios): cada spec E2E de realtime
// usa um provider E um client distinto porque os specs rodam em paralelo
// (fullyParallel) e o realtime casa sockets por userId — com o limite
// REALTIME_MAX_SESSIONS_PER_USER (default 1), sockets do MESMO usuário se
// derrubam entre si. Mapa de isolamento:
//
// ⚠️ FOOTGUN: este spec assume PROVIDER limit = 1 (default). Se o ambiente
// dev setar REALTIME_MAX_SESSIONS_PER_ROLE com PROVIDER > 1 (ex.: JSON
// '{"PROVIDER":2}'), a 2ª aba NÃO derruba a 1ª e o spec quebra. Só rode com
// o limite por role = 1 para PROVIDER (ou sem override).
//   realtime-notification → carlos (provider) + cliente (client)
//   session-revocation    → ricardo (provider) + cliente (client)
//   session-limit         → fernanda (provider) + maria (client, 2º client
//                           do seed — password cliente123)
// =========================================================================

const CLIENT_EMAIL = "maria@severinno.com"
const CLIENT_PASSWORD = "cliente123"
const PROVIDER_EMAIL = "fernanda@severinno.com"
const PROVIDER_PASSWORD = "provider123"
const SERVICE_TITLE = "Diária de limpeza residencial"

// Preenchidos no beforeAll (não são constantes hardcoded).
let PROVIDER_ID = ""
let SERVICE_ID = ""

// =========================================================================
// Helpers
// =========================================================================

/** Login via API (cookie salvo automaticamente no context). */
async function login(page: Page, email: string, password: string) {
  const res = await page.request.post("/api/auth/login", {
    data: { email, password },
  })
  expect(res.ok()).toBeTruthy()
}

/** Marca onboarding do provider como concluído via API (server-side). */
async function skipOnboarding(page: Page) {
  const ok = await page.evaluate(async () => {
    const res = await fetch("/api/provider/onboarding", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ step: 4, done: true }),
    })
    return res.ok
  })
  if (!ok) console.log(`❌ skipOnboarding falhou (fetch do browser)`)
  expect(ok).toBeTruthy()
}

/** Cria um booking como cliente (amanhã, na hora indicada). Retorna o id. */
async function createBooking(page: Page, hour: number): Promise<string> {
  const amanhã = new Date()
  amanhã.setDate(amanhã.getDate() + 1)
  amanhã.setHours(hour, 0, 0, 0)

  const res = await page.request.post("/api/bookings", {
    data: {
      providerId: PROVIDER_ID,
      serviceId: SERVICE_ID,
      scheduledAt: amanhã.toISOString(),
      address: "Avenida Paulista, 1000 - Bela Vista, SP",
      cep: "01310-100",
      lat: -23.55918,
      lng: -46.63811,
      amount: 120,
      paymentMethod: "PIX",
      notes: "E2E session limit test",
    },
  })

  expect(res.ok()).toBeTruthy()
  const data = (await res.json()) as { booking?: { id?: string } }
  const bookingId = data.booking?.id
  expect(bookingId).toBeDefined()
  return bookingId!
}

/**
 * Coleta os websockets realtime (:3003) de uma página. O ÚLTIMO é o socket
 * ativo (o Next dev reseta o singleton do módulo ao navegar, criando
 * sockets órfãos — ver nota no session-revocation.spec.ts).
 */
function trackRealtimeSockets(page: Page): Array<{ url: string; ws: PlaywrightWebSocket }> {
  const list: Array<{ url: string; ws: PlaywrightWebSocket }> = []
  page.on("websocket", (ws) => {
    list.push({ url: ws.url(), ws })
    console.log(`[ws] ${page.url()} abriu: ${ws.url()}`)
  })
  return list
}

/** Aguarda o websocket fechar (poll com diagnóstico). */
async function waitForWsClose(
  ws: PlaywrightWebSocket,
  timeoutMs = 10000,
  label = "websocket",
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline && !ws.isClosed()) {
    await new Promise((r) => setTimeout(r, 300))
  }
  const closed = ws.isClosed()
  if (!closed) console.log(`[ws] diagnóstico: ${label} → isClosed=${ws.isClosed()}`)
  return closed
}

// =========================================================================
// Teste (serial: fases dependem umas das outras)
// =========================================================================

test.describe.serial("Limite de Sessões — Realtime", () => {
  // Resolve os IDs dinamicamente: provider por email (login + /api/auth/me)
  // e serviço por título (/api/services, público). Re-seed não quebra o spec.
  test.beforeAll(async ({ request }) => {
    const loginRes = await request.post("/api/auth/login", {
      data: { email: PROVIDER_EMAIL, password: PROVIDER_PASSWORD },
    })
    expect(loginRes.ok(), `login do provider ${PROVIDER_EMAIL} falhou`).toBeTruthy()
    const me = (await (await request.get("/api/auth/me")).json()) as { user?: { id?: string } }
    PROVIDER_ID = me.user?.id ?? ""
    expect(PROVIDER_ID, `provider ${PROVIDER_EMAIL} não encontrado via /api/auth/me`).toBeTruthy()

    const servicesRes = await request.get(`/api/services?q=${encodeURIComponent(SERVICE_TITLE)}`)
    expect(servicesRes.ok()).toBeTruthy()
    const services = (await servicesRes.json()) as Array<{
      id: string
      title: string
      provider?: { id?: string } | null
    }>
    const service = services.find((s) => s.title === SERVICE_TITLE)
    expect(service, `serviço "${SERVICE_TITLE}" não encontrado via /api/services`).toBeDefined()
    SERVICE_ID = service!.id
    // Sanity check: o serviço pertence ao provider resolvido (mesmo seed).
    if (service!.provider?.id) {
      expect(service!.provider.id).toBe(PROVIDER_ID)
    }
    console.log(`✅ Fixtures dinâmicas: provider=${PROVIDER_ID} service=${SERVICE_ID}`)
  })

  test("segunda aba assume e derruba o socket mais antigo (session_limit)", async ({ browser }) => {
    // ── Contexto do provider (mesmo cookie nas duas abas) ──────────────
    const providerCtx = await browser.newContext()
    const pageA = await providerCtx.newPage()
    await login(pageA, PROVIDER_EMAIL, PROVIDER_PASSWORD)
    const wsA = trackRealtimeSockets(pageA)

    try {
      // ── Aba A: dashboard → socket A dá join em user:{providerId} ─────
      await pageA.goto("/")
      await skipOnboarding(pageA)
      await pageA.goto("/dashboard")
      await pageA.waitForTimeout(3000)
      await expect(pageA.locator('[aria-label="Notifications alt+T"]')).toBeAttached({
        timeout: 5000,
      })

      // ── Aba B (mesmo context → mesma sessão): socket B dá join ───────
      const pageB = await providerCtx.newPage()
      const wsB = trackRealtimeSockets(pageB)
      await pageB.goto("/dashboard")
      await pageB.waitForTimeout(3000)
      await expect(pageB.locator('[aria-label="Notifications alt+T"]')).toBeAttached({
        timeout: 5000,
      })
      console.log("✅ Aba B montada — socket B deve ter assumido, socket A deve cair")

      // ── Socket A (antigo) deve FECHAR (kicked com session_limit) ─────
      const realtimeA = wsA.filter(
        (w) => w.url.includes(":3003") || w.url.includes("XTransformPort"),
      )
      if (realtimeA.length === 0) {
        console.log("ℹ️ Nenhum websocket realtime na aba A — assert de close pulado")
      } else {
        const activeA = realtimeA[realtimeA.length - 1]
        const closedA = await waitForWsClose(activeA.ws, 10000, "aba A (antiga)")
        expect(closedA, "socket da aba A (mais antigo) deve fechar após a 2ª aba assumir").toBe(
          true,
        )
        console.log(
          `✅ Socket da aba A fechado (session_limit) — ${realtimeA.length} ws observado(s)`,
        )
      }

      // ── Socket B (novo) deve PERMANECER vivo ─────────────────────────
      const realtimeB = wsB.filter(
        (w) => w.url.includes(":3003") || w.url.includes("XTransformPort"),
      )
      expect(realtimeB.length, "aba B deve ter websocket realtime").toBeGreaterThan(0)
      const activeB = realtimeB[realtimeB.length - 1]
      expect(activeB.ws.isClosed(), "socket da aba B (mais recente) deve permanecer aberto").toBe(
        false,
      )
      console.log("✅ Socket da aba B permanece aberto (mais recente vence)")

      // ── Booking do cliente → toast SOMENTE na aba B ──────────────────
      const clientCtx = await browser.newContext()
      const clientPage = await clientCtx.newPage()
      try {
        await login(clientPage, CLIENT_EMAIL, CLIENT_PASSWORD)
        await clientPage.goto("/")

        const booking = await createBooking(clientPage, 11)
        console.log(`✅ Booking criado: ${booking}`)

        // O toast chega na aba B (socket vivo, sala user:{providerId}).
        const toastB = pageB.locator("[data-sonner-toast]").first()
        await expect(toastB).toBeVisible({ timeout: 10000 })
        const textoB = (await toastB.textContent()) ?? ""
        console.log(`✅ Toast na aba B (socket vivo): "${textoB.trim()}"`)

        // Janela de observação: a aba A (socket morto) NÃO pode receber toast.
        await pageA.waitForTimeout(3000)
        const toastCountA = await pageA.locator("[data-sonner-toast]").count()
        expect(toastCountA, "nenhum toast deve aparecer na aba A (socket derrubado)").toBe(0)
        console.log("✅ Nenhum toast na aba A — socket antigo realmente sem canal")
      } finally {
        await clientCtx.close()
      }

      await pageB.close()
    } finally {
      await providerCtx.close()
    }
  })
})
