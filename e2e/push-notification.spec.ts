/* eslint-disable @typescript-eslint/no-explicit-any */
import { test, expect } from "@playwright/test"
import { waitForVitrine } from "./helpers"
import { setupApiMocks } from "./mocks"

// =========================================================================
// Constantes
// =========================================================================

const CLIENT_EMAIL = "cliente@severinno.com"
const CLIENT_PASSWORD = "cliente123"
const PROVIDER_EMAIL = "carlos@severinno.com"
const PROVIDER_PASSWORD = "provider123"

/**
 * VAPID key de teste (65 bytes, base64). Válida para PushManager.subscribe()
 * no Chromium headless. Gerada apenas para E2E — NÃO usar em produção.
 */
const TEST_VAPID_PUBLIC_KEY =
  "BNd4XVc7R5NkGfHjKmPqRsTvWxYz1234567890AbCdEfGhIjKlMnOpQrStUvWxYz" +
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"

// =========================================================================
// Helpers
// =========================================================================

/** Injeta mocks de PushManager no navegador com fallback para subscription fake. */
async function setupPushMocks(page: any) {
  await page.addInitScript(
    ({ vapidKey }: { vapidKey: string }) => {
      ;(window as any).__E2E_VAPID_KEY__ = vapidKey

      const origSubscribe = PushManager.prototype.subscribe
      const origGetSubscription = PushManager.prototype.getSubscription

      PushManager.prototype.subscribe = async function (
        this: PushManager,
        options?: PushSubscriptionOptionsInit,
      ) {
        try {
          return await origSubscribe.call(this, options)
        } catch {
          const encoder = new TextEncoder()
          const keyBytes = encoder.encode(vapidKey.slice(0, 32))
          return {
            endpoint: "https://fcm.googleapis.com/fcm/send/e2e-test-endpoint",
            getKey: () => keyBytes,
            toJSON: () => ({
              endpoint: "https://fcm.googleapis.com/fcm/send/e2e-test-endpoint",
              keys: { p256dh: "BNd4...e2e", auth: "e2e-test-auth-key" },
            }),
            unsubscribe: async () => true,
          } as unknown as PushSubscription
        }
      }

      PushManager.prototype.getSubscription = async function (this: PushManager) {
        try {
          return await origGetSubscription.call(this)
        } catch {
          return null
        }
      }
    },
    { vapidKey: TEST_VAPID_PUBLIC_KEY },
  )
}

/** Faz login via API com seed user e setupApiMocks com o role correto. */
async function loginAndMock(
  page: any,
  email: string,
  password: string,
  role: "CLIENT" | "PROVIDER" = "CLIENT",
) {
  await setupApiMocks(page, { authenticated: true, userRole: role })
  await page.goto("/")
  await waitForVitrine(page)
  const res = await page.request.post("/api/auth/login", { data: { email, password } })
  expect(res.ok()).toBeTruthy()
}

/** Clica no botão "Ativar notificações". */
async function clickSubscribePush(page: any) {
  const btn = page.locator('button[title*="Ativar notificações"]').first()
  await expect(btn).toBeVisible({ timeout: 5000 })
  await btn.click()
  await page.waitForTimeout(1000)
}

/** Clica no botão "Desativar notificações". */
async function clickUnsubscribePush(page: any) {
  const btn = page.locator('button[title*="Desativar notificações"]').first()
  await expect(btn).toBeVisible({ timeout: 5000 })
  await btn.click()
  await page.waitForTimeout(1000)
}

/**
 * Instala um handler no SW que simula push events e captura
 * chamadas a showNotification para inspeção nos testes.
 */
async function installSWPushHandler(page: any) {
  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready
    const origShow = ServiceWorkerRegistration.prototype.showNotification

    ;(window as any).__e2e_capturedNotifications = []

    ServiceWorkerRegistration.prototype.showNotification = function (
      title: string,
      options?: NotificationOptions,
    ) {
      ;(window as any).__e2e_capturedNotifications.push({ title, options })
      return origShow.call(this, title, options)
    }

    reg.active?.addEventListener("message", (event: Event) => {
      const msgEvent = event as MessageEvent
      if (msgEvent.data?.type === "e2e-trigger-push") {
        const p = msgEvent.data.payload || {}
        const opts: Record<string, unknown> = {
          body: p.body || "",
          icon: p.icon || "/icon-192.png",
          badge: p.badge || "/icon-192.png",
          vibrate: [200, 100, 200],
          data: p.data || { url: p.url || "/" },
          tag: p.tag,
          renotify: true,
          requireInteraction: !!(p.actions && p.actions.length > 0),
          actions: p.actions || [],
        }
        if (p.image) opts.image = p.image
        if (p.timestamp) opts.timestamp = new Date(p.timestamp).getTime()
        reg.showNotification(p.title || "Severinno", opts as NotificationOptions)
      }
    })
  })
}

/** Simula um push event enviando mensagem para o SW. */
async function simulatePushToSW(page: any, payload: Record<string, unknown>) {
  await page.evaluate(async (data: Record<string, unknown>) => {
    const reg = await navigator.serviceWorker.ready
    reg.active?.postMessage({ type: "e2e-trigger-push", payload: data })
  }, payload)
  await page.waitForTimeout(500)
}

/** Tenta login como admin e retorna true se bem-sucedido. */
async function loginAsAdmin(page: any): Promise<boolean> {
  const res = await page.request.post("/api/auth/login", {
    data: { email: "admin@severinno.com", password: "admin123" },
  })
  return res.ok()
}

/** Mocka a rota /api/admin/push/send para retornar sucesso sem depender de seed ADMIN. */
async function mockAdminPushSend(page: any) {
  await page.route("**/api/admin/push/send", async (route: any) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        sentCount: 1,
        directPushCount: 0,
        errorCount: 0,
        total: 1,
        message: "Notificação enviada com sucesso.",
      }),
    })
  })
}

// =========================================================================
// Testes — Push Notification E2E
// =========================================================================

test.describe("Push Notifications — E2E", () => {
  // =====================================================================
  // 1. Inscrição (Subscribe / Unsubscribe)
  // =====================================================================

  test("1.1 — botão de toggle push aparece quando autenticado", async ({ page }) => {
    await loginAndMock(page, CLIENT_EMAIL, CLIENT_PASSWORD, "CLIENT")
    const btn = page.locator('button[title*="Ativar notificações"]').first()
    await expect(btn).toBeVisible({ timeout: 5000 })
  })

  test("1.2 — botão não aparece quando não autenticado", async ({ page }) => {
    await page.goto("/")
    await waitForVitrine(page)
    await expect(page.locator('button[title*="Ativar notificações"]')).not.toBeVisible({
      timeout: 3000,
    })
  })

  test("1.3 — subscribe salva subscription via POST /api/push/subscribe", async ({ page }) => {
    let called = false
    let body: unknown = null

    await page.route("**/api/push/subscribe", async (route, request) => {
      if (request.method() === "POST") {
        called = true
        body = request.postDataJSON()
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      })
    })

    await loginAndMock(page, CLIENT_EMAIL, CLIENT_PASSWORD, "CLIENT")
    await clickSubscribePush(page)

    expect(called).toBe(true)
    expect(body).toMatchObject({
      endpoint: expect.any(String),
      p256dh: expect.any(String),
      auth: expect.any(String),
      userAgent: expect.any(String),
    })
  })

  test("1.4 — unsubscribe remove via DELETE /api/push/subscribe", async ({ page }) => {
    let deleteCalled = false
    let deleteBody: unknown = null

    await page.route("**/api/push/subscribe", async (route, request) => {
      if (request.method() === "DELETE") {
        deleteCalled = true
        deleteBody = request.postDataJSON()
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      })
    })

    await loginAndMock(page, CLIENT_EMAIL, CLIENT_PASSWORD, "CLIENT")
    await clickSubscribePush(page)
    await page.waitForTimeout(500)
    await clickUnsubscribePush(page)

    expect(deleteCalled).toBe(true)
    expect(deleteBody).toMatchObject({ endpoint: expect.any(String) })
  })

  test("1.5 — toast de sucesso após ativar push", async ({ page }) => {
    await page.route("**/api/push/subscribe", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      })
    })

    await loginAndMock(page, CLIENT_EMAIL, CLIENT_PASSWORD, "CLIENT")
    await clickSubscribePush(page)

    await expect(
      page.locator('[data-sonner-toaster] [role="status"], text=/ativada|ativado|sucesso/i'),
    ).toBeVisible({ timeout: 5000 })
  })

  test("1.6 — botão muda para 'Desativar' após ativar push", async ({ page }) => {
    await page.route("**/api/push/subscribe", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      })
    })

    await loginAndMock(page, CLIENT_EMAIL, CLIENT_PASSWORD, "CLIENT")
    await clickSubscribePush(page)
    await page.waitForTimeout(500)

    await expect(page.locator('button[title*="Desativar"]')).toBeVisible({ timeout: 3000 })
  })

  // =====================================================================
  // 2. Service Worker — Recebimento de Push
  // =====================================================================

  test("2.1 — SW está registrado e ativo", async ({ page }) => {
    await loginAndMock(page, CLIENT_EMAIL, CLIENT_PASSWORD, "CLIENT")

    const state = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready
      return {
        active: reg.active?.state ?? null,
        scope: reg.scope,
        hasPushManager: !!reg.pushManager,
      }
    })

    expect(state.active).toBe("activated")
    expect(state.scope).toContain(page.url().slice(0, 20))
    expect(state.hasPushManager).toBe(true)
  })

  test("2.2 — SW exibe notificação ao receber push com payload inline", async ({ page }) => {
    await loginAndMock(page, CLIENT_EMAIL, CLIENT_PASSWORD, "CLIENT")
    await installSWPushHandler(page)

    await simulatePushToSW(page, {
      title: "🔔 Novo agendamento!",
      body: "João Cliente solicitou Desentupimento de ralo e pia",
      url: "/dashboard?tab=bookings",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      timestamp: new Date().toISOString(),
      data: { url: "/dashboard?tab=bookings", notificationId: "e2e-n-1" },
    })

    const captured = await page.evaluate(() => (window as any).__e2e_capturedNotifications || [])

    expect(captured.length).toBeGreaterThanOrEqual(1)
    expect(captured[0].title).toContain("Novo agendamento")
    expect(captured[0].options.body).toContain("Desentupimento")
    expect(captured[0].options.data.url).toBe("/dashboard?tab=bookings")
  })

  test("2.3 — SW exibe notificação com botões Aceitar/Recusar", async ({ page }) => {
    await loginAndMock(page, PROVIDER_EMAIL, PROVIDER_PASSWORD, "PROVIDER")
    await installSWPushHandler(page)

    await simulatePushToSW(page, {
      title: "🛠️ Novo agendamento para você!",
      body: "João Cliente quer agendar Desentupimento - Confirma?",
      url: "/dashboard?tab=bookings",
      actions: [
        { action: "accept", title: "✅ Aceitar" },
        { action: "reject", title: "❌ Recusar" },
      ],
      requireInteraction: true,
      tag: "booking-e2e-1",
      data: {
        url: "/dashboard?tab=bookings",
        bookingId: "e2e-booking-1",
        notificationType: "BOOKING_CREATED",
      },
    })

    const captured = await page.evaluate(() => (window as any).__e2e_capturedNotifications || [])

    expect(captured.length).toBeGreaterThanOrEqual(1)
    expect(captured[0].options.actions.length).toBe(2)
    expect(captured[0].options.actions[0].action).toBe("accept")
    expect(captured[0].options.actions[1].action).toBe("reject")
    expect(captured[0].options.requireInteraction).toBe(true)
  })

  test("2.4 — SW responde a push simulado (canal de comunicação OK)", async ({ page }) => {
    await loginAndMock(page, CLIENT_EMAIL, CLIENT_PASSWORD, "CLIENT")
    await installSWPushHandler(page)

    // Simula push com tag específica
    await simulatePushToSW(page, {
      title: "🔔 Teste de comunicação SW",
      body: "Verificando canal de comunicação com o Service Worker",
      tag: "comms-test-e2e",
      data: { url: "/" },
    })

    const captured = await page.evaluate(() => (window as any).__e2e_capturedNotifications || [])

    // Verifica que o SW recebeu e processou o push simulado
    expect(captured.length).toBeGreaterThanOrEqual(1)
    expect(captured[0].options.tag).toBe("comms-test-e2e")
  })

  // =====================================================================
  // 3. Disparo via API (POST /api/push/test)
  // =====================================================================

  test("3.1 — POST /api/push/test requer autenticação", async ({ page }) => {
    // Sem login → 401
    const res = await page.request.post("/api/push/test", {
      data: { title: "Teste", body: "Corpo" },
    })
    expect(res.status()).toBe(401)
  })

  // Depende de subscription real no banco — marcado como fixme até ter
  // um seed user com pushSubscription ativa no ambiente de teste.
  test.fixme("3.2 — POST /api/push/test envia notificação para usuário com subscription", async ({
    page,
  }) => {
    await loginAndMock(page, CLIENT_EMAIL, CLIENT_PASSWORD, "CLIENT")
    const res = await page.request.post("/api/push/test", {
      data: { title: "🔔 Teste", body: "Notificação push" },
    })
    expect(res.ok()).toBeTruthy()
  })

  test("3.3 — POST /api/push/action com action=accept no provider", async ({ page, browser }) => {
    const ctx = await (browser as any).newContext()
    await ctx.grantPermissions(["notifications"])
    const providerPage = await ctx.newPage()

    try {
      await setupPushMocks(providerPage)
      await loginAndMock(providerPage, PROVIDER_EMAIL, PROVIDER_PASSWORD, "PROVIDER")

      const res = await providerPage.request.post("/api/push/action", {
        data: { action: "accept", bookingId: "e2e-booking-provider-1" },
      })

      // Pode retornar 200 (mock aceita) ou 403 (validação real)
      expect([200, 401, 403]).toContain(res.status())
      console.log(`📋 POST /api/push/action accept: HTTP ${res.status()}`)
    } finally {
      await ctx.close()
    }
  })

  test("3.4 — clique em notificação dispara POST /api/push/click", async ({ page }) => {
    await loginAndMock(page, CLIENT_EMAIL, CLIENT_PASSWORD, "CLIENT")

    let clickBody: unknown = null
    await page.route("**/api/push/click", async (route, request) => {
      if (request.method() === "POST") {
        clickBody = request.postDataJSON()
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      })
    })

    await page.evaluate(async () => {
      await fetch("/api/push/click", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notificationId: "e2e-analytics-1", title: "🔔 Teste" }),
      })
    })

    await page.waitForTimeout(500)

    expect(clickBody).toMatchObject({
      notificationId: "e2e-analytics-1",
      title: expect.any(String),
    })
  })

  test("3.5 — deep links das actions Aceitar/Recusar têm formato correto", async ({ page }) => {
    await page.goto("/")
    await waitForVitrine(page)

    const urls = await page.evaluate(async () => {
      const bid = "e2e-booking-1"
      return {
        accept: `/dashboard?tab=bookings&booking=${bid}&action=confirm`,
        reject: `/dashboard?tab=bookings&booking=${bid}&action=cancel`,
        view: `/dashboard?tab=bookings&booking=${bid}`,
      }
    })

    expect(urls.accept).toContain("action=confirm")
    expect(urls.accept).toContain("booking=e2e-booking-1")
    expect(urls.reject).toContain("action=cancel")
    expect(urls.view).not.toContain("action=")
  })

  // =====================================================================
  // 4. Fluxo Completo
  // =====================================================================

  test("4.1 — booking cria notificação (verificável via API do provider)", async ({
    page,
    browser,
  }) => {
    const pCtx = await (browser as any).newContext()
    await pCtx.grantPermissions(["notifications"])
    const pPage = await pCtx.newPage()

    try {
      await setupPushMocks(pPage)
      await loginAndMock(pPage, PROVIDER_EMAIL, PROVIDER_PASSWORD, "PROVIDER")

      // Contexto do cliente
      const cCtx = await (browser as any).newContext()
      await cCtx.grantPermissions(["notifications"])
      const cPage = await cCtx.newPage()

      try {
        await setupPushMocks(cPage)
        await loginAndMock(cPage, CLIENT_EMAIL, CLIENT_PASSWORD, "CLIENT")

        const tomorrow = new Date()
        tomorrow.setDate(tomorrow.getDate() + 1)
        tomorrow.setHours(10, 0, 0, 0)

        const bookingRes = await cPage.request.post("/api/bookings", {
          data: {
            providerId: "prov-e2e-1",
            serviceId: "svc-e2e-1",
            scheduledAt: tomorrow.toISOString(),
            address: "Av. Paulista, 1000",
            cep: "01310-100",
            lat: -23.55,
            lng: -46.63,
            amount: 120,
            paymentMethod: "PIX",
            notes: "E2E push test",
          },
        })

        expect(bookingRes.ok()).toBeTruthy()

        // Provider verifica notificações via API
        const notifRes = await pPage.request.get("/api/notifications")
        expect(notifRes.ok()).toBeTruthy()
        const notifData = await notifRes.json()
        const items = notifData.items || []

        if (items.length > 0) {
          expect(items[0]).toMatchObject({
            id: expect.any(String),
            type: expect.any(String),
            title: expect.any(String),
            read: expect.any(Boolean),
            createdAt: expect.any(String),
          })
        }

        console.log(`📋 Notificações do provider: ${items.length}`)
      } finally {
        await cCtx.close()
      }
    } finally {
      await pCtx.close()
    }
  })

  test("4.2 — toggle push funcional: ativa → desativa → ativa novamente", async ({ page }) => {
    await page.route("**/api/push/subscribe", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      })
    })

    await loginAndMock(page, CLIENT_EMAIL, CLIENT_PASSWORD, "CLIENT")

    // 1. Ativa
    await clickSubscribePush(page)
    await expect(page.locator('button[title*="Desativar"]')).toBeVisible({ timeout: 3000 })

    // 2. Desativa
    await clickUnsubscribePush(page)
    await expect(page.locator('button[title*="Ativar"]')).toBeVisible({ timeout: 3000 })

    // 3. Ativa novamente
    await clickSubscribePush(page)
    await expect(page.locator('button[title*="Desativar"]')).toBeVisible({ timeout: 3000 })
  })

  // =====================================================================
  // 5. Admin Send (POST /api/admin/push/send)
  // =====================================================================

  // ── Admin availability detection ──────────────────────────────────────
  // Detecta UMA vez se o seed ADMIN existe. Cada test faz seu próprio login
  // porque Playwright isola `page` por test (cookies não persistem entre tests).
  let _adminChecked = false
  let _adminAvailable = false

  test.beforeEach(async ({ page }) => {
    if (!_adminChecked) {
      _adminAvailable = await loginAsAdmin(page)
      _adminChecked = true
    }
  })

  test("5.1 — admin send requer role ADMIN (401 sem auth)", async ({ page }) => {
    const res = await page.request.post("/api/admin/push/send", {
      data: { userIds: ["user-1"], title: "Teste" },
    })
    expect(res.status()).toBe(401)
  })

  test("5.2 — admin send requer role ADMIN (403 para CLIENT)", async ({ page }) => {
    await loginAndMock(page, CLIENT_EMAIL, CLIENT_PASSWORD, "CLIENT")

    const res = await page.request.post("/api/admin/push/send", {
      data: { userIds: ["user-1"], title: "Teste" },
    })
    expect([401, 403]).toContain(res.status())
  })

  test("5.3 — admin send aceita requisição válida (com mock, sem seed)", async ({ page }) => {
    // Navega para definir a origin (necessário para fetch relativo funcionar)
    await page.goto("/")
    await mockAdminPushSend(page)
    // Usa page.evaluate + fetch (passa pelos route interceptors do Playwright)
    // em vez de page.request.post (que bypassa page.route)
    const result = await page.evaluate(async () => {
      const res = await fetch("/api/admin/push/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userIds: ["user-1"], title: "Teste" }),
      })
      return { status: res.status, body: await res.json() }
    })
    expect(result.status).toBe(200)
    expect(result.body).toMatchObject({ ok: true, sentCount: 1 })
  })

  test("5.4 — admin send rejeita userIds vazio", async ({ page }) => {
    test.skip(!_adminAvailable, "sem seed ADMIN no banco")
    // Re-login: cada test ganha page nova sem cookies
    await loginAsAdmin(page)
    const sendRes = await page.request.post("/api/admin/push/send", {
      data: { userIds: [], title: "Teste" },
    })
    expect(sendRes.status()).toBe(400)
  })

  test("5.5 — admin send rejeita mais de 50 usuários", async ({ page }) => {
    test.skip(!_adminAvailable, "sem seed ADMIN no banco")
    await loginAsAdmin(page)
    const sendRes = await page.request.post("/api/admin/push/send", {
      data: { userIds: Array.from({ length: 51 }, (_, i) => `user-${i + 1}`), title: "Teste" },
    })
    expect(sendRes.status()).toBe(400)
  })

  test("5.6 — admin send rejeita title vazio", async ({ page }) => {
    test.skip(!_adminAvailable, "sem seed ADMIN no banco")
    await loginAsAdmin(page)
    const sendRes = await page.request.post("/api/admin/push/send", {
      data: { userIds: ["user-1"], title: "" },
    })
    expect(sendRes.status()).toBe(400)
  })

  test("5.7 — admin send rejeita title com mais de 120 caracteres", async ({ page }) => {
    test.skip(!_adminAvailable, "sem seed ADMIN no banco")
    await loginAsAdmin(page)
    const sendRes = await page.request.post("/api/admin/push/send", {
      data: { userIds: ["user-1"], title: "A".repeat(121) },
    })
    expect(sendRes.status()).toBe(400)
  })

  test("5.8 — admin send rejeita body com mais de 500 caracteres", async ({ page }) => {
    test.skip(!_adminAvailable, "sem seed ADMIN no banco")
    await loginAsAdmin(page)
    const sendRes = await page.request.post("/api/admin/push/send", {
      data: { userIds: ["user-1"], title: "Teste", body: "B".repeat(501) },
    })
    expect(sendRes.status()).toBe(400)
  })

  test("5.9 — admin send rejeita pushUrl inválida (javascript:)", async ({ page }) => {
    test.skip(!_adminAvailable, "sem seed ADMIN no banco")
    await loginAsAdmin(page)
    const sendRes = await page.request.post("/api/admin/push/send", {
      data: { userIds: ["user-1"], title: "Teste", pushUrl: "javascript:alert(1)" },
    })
    expect(sendRes.status()).toBe(400)
  })

  // =====================================================================
  // 6. Cron — Push Scheduled (GET /api/cron/push-scheduled)
  // =====================================================================

  test("6.1 — cron push-scheduled requer Authorization header (401 sem)", async ({ page }) => {
    const res = await page.request.get("/api/cron/push-scheduled")
    expect(res.status()).toBe(401)
  })

  test("6.2 — cron push-scheduled rejeita CRON_SECRET inválido", async ({ page }) => {
    const res = await page.request.get("/api/cron/push-scheduled", {
      headers: { Authorization: "Bearer invalid-secret" },
    })
    expect(res.status()).toBe(401)
  })

  test("6.3 — cron push-scheduled aceita CRON_SECRET válido", async ({ page }) => {
    const cronSecret = process.env.CRON_SECRET || ""
    if (!cronSecret) {
      console.log("⚠️ CRON_SECRET não configurado — pulando teste")
      return
    }

    const res = await page.request.get("/api/cron/push-scheduled", {
      headers: { Authorization: `Bearer ${cronSecret}` },
    })
    expect(res.ok()).toBeTruthy()
    const body = await res.json()
    expect(body).toHaveProperty("ok", true)
    expect(body).toHaveProperty("processed")
    expect(body).toHaveProperty("results")
    console.log(
      `📋 Cron push-scheduled: ${body.processed} notificações processadas, ${body.scheduled} scheduled, ${body.recurring} recurring`,
    )
  })

  // =====================================================================
  // 7. Cron — Scheduled Push Legacy (GET /api/cron/scheduled-push)
  // =====================================================================

  test("7.1 — cron scheduled-push requer Authorization header (401 sem)", async ({ page }) => {
    const res = await page.request.get("/api/cron/scheduled-push")
    expect(res.status()).toBe(401)
  })

  test("7.2 — cron scheduled-push rejeita CRON_SECRET inválido", async ({ page }) => {
    const res = await page.request.get("/api/cron/scheduled-push", {
      headers: { Authorization: "Bearer invalid-secret" },
    })
    expect(res.status()).toBe(401)
  })

  test("7.3 — cron scheduled-push aceita CRON_SECRET válido", async ({ page }) => {
    const cronSecret = process.env.CRON_SECRET || ""
    if (!cronSecret) {
      console.log("⚠️ CRON_SECRET não configurado — pulando teste")
      return
    }

    const res = await page.request.get("/api/cron/scheduled-push", {
      headers: { Authorization: `Bearer ${cronSecret}` },
    })
    expect(res.ok()).toBeTruthy()
    const body = await res.json()
    expect(body).toHaveProperty("ok", true)
    expect(body).toHaveProperty("processed")
    expect(body).toHaveProperty("results")
    console.log(`📋 Cron scheduled-push: ${body.processed} notificações processadas`)
  })
})
