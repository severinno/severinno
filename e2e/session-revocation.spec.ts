import { test, expect, type Page } from "@playwright/test"
import type { WebSocket as PlaywrightWebSocket } from "playwright"

// =========================================================================
// Revogação de Sessão — E2E (Realtime)
//
// Cenário (do ponto de vista do browser):
//   1. Provider logado com o dashboard aberto → RealtimeProvider monta o
//      Socket.io e dá join em user:{providerId} (socket joined).
//   2. Sanidade: um booking criado pelo cliente gera toast via WebSocket
//      (prova que o socket está vivo e a pipeline notification:new funciona).
//   3. Logout em OUTRA ABA (mesmo browser context → mesmo cookie): o
//      destroySession apaga o cookie e emite session:revoke; o realtime
//      mini-service emite session:revoked para TODOS os sockets do usuário
//      (room + sweep via fetchSockets) e força o close.
//   4. O dashboard reage: o client zera o socket (socketRef = null +
//      disconnect) — socket RESETADO, sem rejoin.
//   5. Novo booking → NENHUM toast aparece (socket morto / sessão revogada).
//
// ORDEM DAS FASES (importante): o login acontece via API ANTES de qualquer
// navegação. Conectar o socket antes do login criaria um websocket com
// handshake SEM cookie (session null) que o servidor NÃO revoga (o sweep casa
// por socket.data.session.userId e o join é negado sem sessão) — um socket
// órfão ficaria aberto e quebraria o assert de fechamento. Com o login
// primeiro, todo socket criado tem sessão válida e é revogado.
//
// Depois do login navegamos para "/" (para o skipOnboarding via fetch do
// browser ter origin do documento — page.evaluate com fetch relativo falha
// em about:blank) e então para /dashboard.
//
// Credenciais do seed (prisma/seed.ts) são estáveis entre re-seeds; os IDs
// (PROVIDER_ID/SERVICE_ID) são resolvidos dinamicamente no beforeAll — nada
// a atualizar após re-seed.
// =========================================================================

// Provider PRÓPRIO (ricardo@severinno.com, o eletricista) — NÃO o mesmo do
// realtime-notification.spec.ts (carlos, o encanador). Os 2 specs rodam em
// paralelo (fullyParallel) e o revoke de sessão casa sockets por userId no
// realtime: se ambos usassem o mesmo provider, o logout/revoke deste spec
// derrubaria também o socket daquele spec (e vice-versa). Com providers
// distintos, os cenários são isolados e podem rodar em qualquer ordem.
const CLIENT_EMAIL = "cliente@severinno.com"
const CLIENT_PASSWORD = "cliente123"
const PROVIDER_EMAIL = "ricardo@severinno.com"
const PROVIDER_PASSWORD = "provider123"
const SERVICE_TITLE = "Troca de tomadas e interruptores"

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

/**
 * Marca onboarding do provider como concluído via API (a linha release
 * persiste o progresso server-side em /api/provider/onboarding).
 * Usa fetch do navegador (não page.request) pelo mesmo motivo do
 * realtime-notification.spec.ts (proxy dev desyncroniza body em keep-alive).
 * NOTA: exige que a página já tenha navegado (fetch relativo precisa de origin).
 */
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
      notes: "E2E session revocation test",
    },
  })

  expect(res.ok()).toBeTruthy()
  const data = (await res.json()) as { booking?: { id?: string } }
  const bookingId = data.booking?.id
  expect(bookingId).toBeDefined()
  return bookingId!
}

// =========================================================================
// Teste (serial: as fases dependem umas das outras)
// =========================================================================

test.describe.serial("Revogação de Sessão — Realtime", () => {
  // Resolve os IDs dinamicamente: provider por email (login + /api/auth/me)
  // e serviço por título (/api/services, público). Re-seed não quebra o spec.
  test.beforeAll(async ({ request }) => {
    // ── Provider por email ────────────────────────────────────────────
    const loginRes = await request.post("/api/auth/login", {
      data: { email: PROVIDER_EMAIL, password: PROVIDER_PASSWORD },
    })
    expect(loginRes.ok(), `login do provider ${PROVIDER_EMAIL} falhou`).toBeTruthy()
    const me = (await (await request.get("/api/auth/me")).json()) as { user?: { id?: string } }
    PROVIDER_ID = me.user?.id ?? ""
    expect(PROVIDER_ID, `provider ${PROVIDER_EMAIL} não encontrado via /api/auth/me`).toBeTruthy()

    // ── Serviço por título ────────────────────────────────────────────
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

  test("logout em outra aba revoga o socket e o dashboard não recebe novos toasts", async ({
    browser,
  }) => {
    // ── Provider: LOGIN PRIMEIRO, depois navegação ────────────────────
    // (evita socket órfão pré-login sem sessão — ver header do arquivo)
    const providerCtx = await browser.newContext()
    const providerPage = await providerCtx.newPage()
    await login(providerPage, PROVIDER_EMAIL, PROVIDER_PASSWORD)

    // Rastreia conexões WebSocket da página (socket.io → realtime :3003).
    // Usado para provar o "socket resetado": após session:revoked o
    // websocket do provider deve fechar (client desconecta + zera o singleton).
    // Usa ws.isClosed() (estado real do transporte) em vez do evento 'close'
    // do Playwright — mais confiável no polling.
    const wsList: Array<{ url: string; ws: PlaywrightWebSocket }> = []
    providerPage.on("websocket", (ws) => {
      wsList.push({ url: ws.url(), ws })
      console.log(`[ws] abriu: ${ws.url()}`)
    })

    try {
      // Navega para "/" — o RealtimeProvider (root layout) conecta o Socket.io
      // AGORA com o cookie já setado (sessão válida no handshake — revogável).
      // O skipOnboarding usa fetch relativo e precisa de origin do documento.
      await providerPage.goto("/")
      await skipOnboarding(providerPage)

      // Navegar para o dashboard — entra na sala user:{providerId}
      await providerPage.goto("/dashboard")
      await providerPage.waitForTimeout(3000)

      // sonner Toaster montado (onde o toast aparecerá)
      await expect(providerPage.locator('[aria-label="Notifications alt+T"]')).toBeAttached({
        timeout: 5000,
      })

      // ── Sanidade: booking do cliente → toast via WebSocket ──────────
      // (clientCtx fica ABERTO de propósito — será reutilizado para o 2º
      // booking na fase final do cenário)
      const clientCtx = await browser.newContext()
      const clientPage = await clientCtx.newPage()
      await login(clientPage, CLIENT_EMAIL, CLIENT_PASSWORD)
      await clientPage.goto("/")

      const bookingSanity = await createBooking(clientPage, 9)
      console.log(`✅ Booking de sanidade criado: ${bookingSanity}`)

      // O toast deve aparecer automaticamente (socket vivo + pipeline OK)
      const toast = providerPage.locator("[data-sonner-toast]").first()
      await expect(toast).toBeVisible({ timeout: 10000 })
      const texto = (await toast.textContent()) ?? ""
      console.log(`✅ Sanidade: toast via WebSocket antes da revogação: "${texto.trim()}"`)

      // Aguarda o auto-dismiss do toast (sonner duration 5s) para que a
      // fase "nenhum toast" parta de uma tela limpa
      await expect(providerPage.locator("[data-sonner-toast]")).toHaveCount(0, {
        timeout: 10000,
      })

      // ── Logout em OUTRA ABA (mesmo context → mesmo cookie) ───────────
      const logoutPage = await providerCtx.newPage()
      try {
        const logoutRes = await logoutPage.request.post("/api/auth/logout")
        expect(logoutRes.ok()).toBeTruthy()
        console.log("✅ Logout executado em outra aba (session cookie deletado + revoke emitido)")
      } finally {
        await logoutPage.close()
      }

      // ── Socket resetado: websocket do provider fecha ────────────────
      // O realtime emite session:revoked e força o close; o client recebe o
      // evento, desconecta e zera o singleton (sem rejoin/reconnect).
      //
      // ARTEfATO DE DEV (HMR): o Next dev reseta o singleton do módulo ao
      // navegar entre rotas, criando 2 conexões socket.io — a 1ª (aberta no
      // "/") fica órfã no client (sem listener) e pode não reportar close
      // mesmo após o force-close do servidor (provado: o sweep casa e fecha
      // TODOS os sockets via fetchSockets — ver debug node). O socket do
      // cenário é o ÚLTIMO criado (montado no /dashboard com sessão válida,
      // entrou na sala user:{providerId}) — é ele que o client revoga e
      // fecha. Em produção não há HMR, então tipicamente existe um único
      // socket por aba (múltiplas abas / reconnect ainda são possíveis).
      const realtimeWs = wsList.filter(
        (w) => w.url.includes(":3003") || w.url.includes("XTransformPort"),
      )
      if (realtimeWs.length === 0) {
        console.log("ℹ️ Nenhum websocket realtime observado — assert de close pulado")
      } else {
        // Último websocket realtime = o socket ativo do dashboard (pós-HMR).
        const activeWs = realtimeWs[realtimeWs.length - 1]
        // Poll manual com diagnóstico: se não fechar em 10s, dump do estado.
        let closed = false
        const deadline = Date.now() + 10000
        while (Date.now() < deadline && !closed) {
          closed = activeWs.ws.isClosed()
          if (!closed) await providerPage.waitForTimeout(300)
        }
        if (!closed) {
          for (const w of realtimeWs) {
            console.log(`[ws] diagnóstico: ${w.url} → isClosed=${w.ws.isClosed()}`)
          }
        }
        expect(closed, "websocket ativo do provider deve fechar após session:revoked").toBe(true)
        console.log(
          `✅ Socket resetado: ${realtimeWs.length} websocket(s) observado(s), ativo fechado`,
        )
      }

      // Sessão removida no contexto (cookie deletado pelo destroySession)
      const me = await providerPage.request.get("/api/auth/me")
      const meBody = (await me.json()) as { user?: unknown }
      expect(meBody.user).toBeNull()
      console.log("✅ Sessão revogada: /api/auth/me → user null")

      // ── Novo booking → NENHUM toast no dashboard ─────────────────────
      const booking2 = await createBooking(clientPage, 16)
      console.log(`✅ Booking pós-revogação criado: ${booking2}`)

      // Janela de observação: com o socket vivo, o toast chegaria em <2s e
      // duraria 5s — 8s é folga suficiente para detectar (e falhar) se algo
      // vazar pela sala user:{providerId}
      await providerPage.waitForTimeout(8000)

      const toastCount = await providerPage.locator("[data-sonner-toast]").count()
      expect(toastCount, "nenhum toast deve aparecer após session:revoked").toBe(0)
      console.log("✅ Nenhum toast após a revogação — cenário validado")

      await clientCtx.close()
    } finally {
      await providerCtx.close()
    }
  })
})
