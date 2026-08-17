import { test, expect, type Page } from "@playwright/test"
import type { WebSocket as PlaywrightWebSocket } from "playwright"
import { realtimePort } from "./realtime-emit"

// =========================================================================
// Limite de Sessões — E2E (Realtime)
//
// Cenário: o mesmo usuário abre o dashboard em TRÊS abas (mesmo browser
// context → mesmo cookie → mesma sessão). Com o limite por role ativo no dev
// (REALTIME_MAX_SESSIONS_PER_ROLE='{"CLIENT":1,"PROVIDER":2,"ADMIN":5}'),
// o realtime mantém os 2 sockets MAIS RECENTES de um PROVIDER e derruba o
// antigo com motivo "session_limit":
//   1. Aba A abre o dashboard → socket A dá join em user:{providerId}.
//   2. Aba B abre o dashboard → socket B dá join; 2 sockets ficam DENTRO do
//      limite PROVIDER=2 → ambos coexistem (mesmo cenário do badge '2
//      sessões' no painel admin — o conflito NÃO derruba ninguém).
//   3. Aba C abre o dashboard → socket C dá join; 3 sockets > 2 → o servidor
//      detecta o excesso (sweep fetchSockets + selectSocketsToKickForSessionLimit)
//      e força o close do socket A (evento session:limit + close atrasado).
//   4. O client da aba A reseta o singleton (onSessionLimited) e NÃO
//      reconecta — o websocket fecha de verdade (sem loop join→kick→rejoin).
//   5. Os sockets B e C continuam vivos e recebem o toast de um novo booking —
//      prova que os "mais recentes vencem" e o canal não quebrou.
//
// ISOLAMENTO COMPLETO (provider E client próprios): cada spec E2E de realtime
// usa um provider E um client distinto porque os specs rodam em paralelo
// (fullyParallel) e o realtime casa sockets por userId — sockets do MESMO
// usuário se derrubam quando o limite por role é excedido. Mapa:
//
// ⚠️ REQUISITO DE CONFIG: este spec valida o comportamento com o limite por
// role ATIVO no dev — REALTIME_MAX_SESSIONS_PER_ROLE='{"CLIENT":1,
// "PROVIDER":2,"ADMIN":5}' (exemplo do docker-compose.dev.yml + .env.local).
// Com PROVIDER=2, a 2ª aba NÃO derruba a 1ª (coexistem — badge '2 sessões');
// a 3ª aba derruba a MAIS ANTIGA. Se o realtime rodar sem override (limite
// 1), o cenário muda (a 2ª aba já derruba a 1ª) e este spec quebra — rode
// com a config por role acima.
//   realtime-notification → carlos (provider) + cliente (client)
//   session-revocation    → ricardo (provider) + cliente (client)
//   session-limit         → fernanda (provider) + maria (client, 2º client
//                           do seed — password cliente123)
//   admin-session-conflict → provider isolado registrado via API (único por
//                           run — nunca colide com os do seed)
//   realtime-role-limit   → provider E client isolados registrados via API
//                           (emails únicos por run — nenhum user do seed)
//   realtime-plan-limit   → 2 providers isolados registrados via API (emails
//                           únicos por run); um deles sobe para PREMIUM via
//                           UPDATE no banco (pg) — nunca colide com o seed
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
  // Fluxo pesado (3 abas + booking + toasts): sob fullyParallel o dev server
  // compila sob carga e o global de 120s estoura (padrão do
  // realtime-ttl-sweep.spec.ts).
  test.setTimeout(180_000)

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

  test("3ª aba derruba o socket mais antigo (session_limit) — limite PROVIDER=2", async ({
    browser,
  }) => {
    // ── Contexto do provider (mesmo cookie nas três abas) ──────────────
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
      console.log("✅ Aba B montada — 2 sockets dentro do limite PROVIDER=2 (coexistem)")

      // ── Com PROVIDER=2 a 2ª aba NÃO derruba a 1ª: socket A PERMANECE ──
      const realtimeA = wsA.filter(
        (w) => w.url.includes(`:${realtimePort()}`) || w.url.includes("XTransformPort"),
      )
      const activeA = realtimeA.length > 0 ? realtimeA[realtimeA.length - 1] : null
      if (activeA) {
        await pageA.waitForTimeout(1500)
        expect(
          activeA.ws.isClosed(),
          "socket da aba A (1ª) deve PERMANECER aberto — limite PROVIDER=2 permite 2 sockets",
        ).toBe(false)
        console.log("✅ Socket da aba A segue vivo (2 sockets dentro do limite)")
      } else {
        console.log("ℹ️ Nenhum websocket realtime na aba A — assert de coexistência pulado")
      }

      // ── Aba C: socket C dá join → 3 sockets > 2 → derruba o MAIS ANTIGO (A) ──
      const pageC = await providerCtx.newPage()
      const wsC = trackRealtimeSockets(pageC)
      await pageC.goto("/dashboard")
      await pageC.waitForTimeout(3000)
      await expect(pageC.locator('[aria-label="Notifications alt+T"]')).toBeAttached({
        timeout: 5000,
      })
      console.log("✅ Aba C montada — 3 sockets > limite 2: o mais antigo (A) deve cair")

      if (activeA) {
        const closedA = await waitForWsClose(activeA.ws, 10000, "aba A (mais antiga)")
        expect(closedA, "socket da aba A (mais antigo) deve fechar após a 3ª aba assumir").toBe(
          true,
        )
        console.log(
          `✅ Socket da aba A fechado (session_limit) — ${realtimeA.length} ws observado(s)`,
        )
      }

      // ── Sockets B e C (mais recentes) devem PERMANECER vivos ─────────
      const realtimeB = wsB.filter(
        (w) => w.url.includes(`:${realtimePort()}`) || w.url.includes("XTransformPort"),
      )
      expect(realtimeB.length, "aba B deve ter websocket realtime").toBeGreaterThan(0)
      const activeB = realtimeB[realtimeB.length - 1]
      expect(activeB.ws.isClosed(), "socket da aba B (recente) deve permanecer aberto").toBe(false)

      const realtimeC = wsC.filter(
        (w) => w.url.includes(`:${realtimePort()}`) || w.url.includes("XTransformPort"),
      )
      expect(realtimeC.length, "aba C deve ter websocket realtime").toBeGreaterThan(0)
      const activeC = realtimeC[realtimeC.length - 1]
      expect(activeC.ws.isClosed(), "socket da aba C (mais recente) deve permanecer aberto").toBe(
        false,
      )
      console.log("✅ Sockets das abas B e C permanecem abertos (os 2 mais recentes vencem)")

      // ── Booking do cliente → toast nas abas vivas (B/C), NUNCA na A ──
      const clientCtx = await browser.newContext()
      const clientPage = await clientCtx.newPage()
      try {
        await login(clientPage, CLIENT_EMAIL, CLIENT_PASSWORD)
        await clientPage.goto("/")

        const booking = await createBooking(clientPage, 11)
        console.log(`✅ Booking criado: ${booking}`)

        // O toast chega nas abas com socket vivo (B e C — sala user:{id}).
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
      await pageC.close()
    } finally {
      await providerCtx.close()
    }
  })
})
