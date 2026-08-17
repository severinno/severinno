import { test, expect, type Page, type APIRequestContext } from "@playwright/test"
import type { WebSocket as PlaywrightWebSocket } from "playwright"
import { emitNotificationToRoom, realtimePort } from "./realtime-emit"

// =========================================================================
// Revogação pelo Admin — E2E (Realtime)
//
// Cobre no browser dois fluxos que hoje só têm unit tests
// (src/app/api/__tests__/admin-users-route.test.ts):
//
//   Cenário 1 — Desativar usuário com dashboard aberto derruba o socket
//   IMEDIATAMENTE: o admin faz PATCH /api/admin/users/{id} {active:false}
//   (mesmo endpoint do botão "Desativar"); a rota revoga os sockets via
//   session:revoke → o realtime força o close. O dashboard do provider
//   reage: socket resetado (sem rejoin) e nenhum toast chega.
//
//   NOTA sobre o "nenhum toast" do C1: NÃO usamos um booking real pós-
//   desativação — a API de bookings rejeita novos bookings de provider
//   inativo (active:false), comportamento correto do app. Para provar que
//   a sala user:{pedroId} está morta, emitimos notification:new DIRETO na
//   sala via POST /emit (mesmo caminho server→server que o backend usa):
//   se houvesse socket vivo, o toast apareceria.
//
//   Cenário 2 — Botão "Revogar sessões" (POST revoke-sessions) SEM
//   desativar: o admin clica no botão real da UI (view admin.users). O
//   socket do provider cai, MAS a conta continua ativa — a sessão cookie
//   permanece válida (/api/auth/me ainda retorna o usuário) e o usuário
//   pode continuar logado; apenas o socket morre.
//
//   Cenário 3 — MESMO fluxo do C2, mas na view admin.PROVIDERS: cobre o
//   gap de cobertura da UI onde o botão "Revogar sessões" e o indicador
//   Online existem nas DUAS views (admin.users e admin.providers) mas o
//   spec só exercitava a primeira. Navega pela nav "Prestadores", valida
//   o badge "Online · N" via refresh manual e revoga pelo ⋮ da linha —
//   com as mesmas asserções do C2 (socket cai, conta continua ativa,
//   nenhum toast após novo booking).
//
//   NOTA SOBRE O PROVIDER DO C3: reusa o ANTONIO (mesmo do C2), NÃO o
//   lima@severinno.com — o lima tem socket aberto por admin-online-card
//   E realtime-ttl-sweep (2 specs; limite de sockets por PROVIDER no
//   realtime é 2), então um terceiro spec com o lima derrubaria o socket
//   deles via session_limit. O antonio é usado SÓ neste arquivo, e o
//   describe.serial garante que o C3 roda DEPOIS do C2 — cujo fim deixa
//   exatamente a pré-condição que o C3 precisa: conta ativa + socket
//   morto (sem rejoin). O C3 abre um dashboard NOVO → socket novo dá
//   join → revoga pela view Prestadores.
//
// Providers ISOLADOS dos demais specs (carlos/ricardo/fernanda são usados
// por realtime-notification/session-revocation/realtime-session-limit;
// lima por admin-online-card/realtime-ttl-sweep):
//   pedro@severinno.com  (jardineiro)  → cenário 1 (desativação)
//   antonio@severinno.com (pedreiro)   → cenários 2 e 3 (serial no arquivo)
// Como os specs rodam fullyParallel e a revogação casa sockets por userId
// no realtime, providers distintos garantem isolamento total.
//
// Credenciais do seed (prisma/seed.ts) são estáveis entre re-seeds; os IDs
// são resolvidos dinamicamente no beforeAll — nada a atualizar após re-seed.
// =========================================================================

const CLIENT_EMAIL = "cliente@severinno.com"
const CLIENT_PASSWORD = "cliente123"
const ADMIN_EMAIL = "admin@severinno.com"
const ADMIN_PASSWORD = "admin123"

// Cenário 1 — desativação (pedro, jardineiro)
const PEDRO_EMAIL = "pedro@severinno.com"
const PEDRO_PASSWORD = "provider123"
const PEDRO_SERVICE_TITLE = "Poda de árvores e arbustos"

// Cenários 2 e 3 — revogar sem desativar (antonio, pedreiro). O C2 usa a
// view admin.users; o C3 reusa o MESMO provider na view admin.providers
// (serial no arquivo; após o C2 o socket está morto e a conta ativa).
const ANTONIO_EMAIL = "antonio@severinno.com"
const ANTONIO_PASSWORD = "provider123"
const ANTONIO_SERVICE_TITLE = "Assentamento de piso cerâmico"

// Preenchidos no beforeAll (não são constantes hardcoded).
let PEDRO_ID = ""
let PEDRO_SERVICE_ID = ""
let ANTONIO_ID = ""
let ANTONIO_SERVICE_ID = ""

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
 * session-revocation.spec.ts (proxy dev desyncroniza body em keep-alive).
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
async function createBooking(
  page: Page,
  providerId: string,
  serviceId: string,
  hour: number,
): Promise<string> {
  const amanhã = new Date()
  amanhã.setDate(amanhã.getDate() + 1)
  amanhã.setHours(hour, 0, 0, 0)

  const res = await page.request.post("/api/bookings", {
    data: {
      providerId,
      serviceId,
      scheduledAt: amanhã.toISOString(),
      address: "Avenida Paulista, 1000 - Bela Vista, SP",
      cep: "01310-100",
      lat: -23.55918,
      lng: -46.63811,
      amount: 120,
      paymentMethod: "PIX",
      notes: "E2E admin revocation test",
    },
  })

  expect(res.ok()).toBeTruthy()
  const data = (await res.json()) as { booking?: { id?: string } }
  const bookingId = data.booking?.id
  expect(bookingId).toBeDefined()
  return bookingId!
}

/**
 * Abre o dashboard do provider logado com o socket joined na sala
 * user:{providerId} e rastreia os websockets da página. Retorna a lista.
 */
async function openProviderDashboard(
  page: Page,
  email: string,
  password: string,
): Promise<Array<{ url: string; ws: PlaywrightWebSocket }>> {
  const wsList: Array<{ url: string; ws: PlaywrightWebSocket }> = []
  page.on("websocket", (ws) => {
    wsList.push({ url: ws.url(), ws })
    console.log(`[ws] abriu: ${ws.url()}`)
  })

  await login(page, email, password)
  // Navega para "/" — o RealtimeProvider conecta o Socket.io AGORA com o
  // cookie já setado (sessão válida no handshake — revogável).
  await page.goto("/")
  await skipOnboarding(page)
  await page.goto("/dashboard")
  await page.waitForTimeout(3000)

  // sonner Toaster montado (onde o toast aparecerá)
  await expect(page.locator('[aria-label="Notifications alt+T"]')).toBeAttached({
    timeout: 5000,
  })
  return wsList
}

/**
 * Espera o websocket realtime ATIVO (o último criado — o do /dashboard,
 * pós-HMR) fechar. Poll manual com diagnóstico; falha com dump do estado.
 */
async function expectActiveSocketClosed(
  providerPage: Page,
  wsList: Array<{ url: string; ws: PlaywrightWebSocket }>,
  label: string,
): Promise<void> {
  const realtimeWs = wsList.filter(
    (w) => w.url.includes(`:${realtimePort()}`) || w.url.includes("XTransformPort"),
  )
  if (realtimeWs.length === 0) {
    console.log(`ℹ️ [${label}] Nenhum websocket realtime observado — assert de close pulado`)
    return
  }

  // Último websocket realtime = o socket ativo do dashboard (pós-HMR).
  const activeWs = realtimeWs[realtimeWs.length - 1]
  let closed = false
  const deadline = Date.now() + 10000
  while (Date.now() < deadline && !closed) {
    closed = activeWs.ws.isClosed()
    if (!closed) await providerPage.waitForTimeout(300)
  }
  if (!closed) {
    for (const w of realtimeWs) {
      console.log(`[ws] diagnóstico [${label}]: ${w.url} → isClosed=${w.ws.isClosed()}`)
    }
  }
  expect(closed, `[${label}] websocket ativo do provider deve fechar após a revogação`).toBe(true)
  console.log(`✅ [${label}] Socket resetado (${realtimeWs.length} websocket(s) observado(s))`)
}

/**
 * Pré-condição do C1: garante o provider ATIVO (best-effort). Uma rodada
 * anterior interrompida no meio (ex.: worker morto por timeout) pode ter
 * deixado active:false persistido — o login falharia na rodada seguinte.
 * Self-heal: o admin reativa antes de o cenário começar.
 */
async function ensureProviderActive(adminPage: Page, providerId: string) {
  const res = await adminPage.request.patch(`/api/admin/users/${providerId}`, {
    data: { active: true },
  })
  if (!res.ok()) console.log(`⚠️ ensureProviderActive: PATCH active:true falhou (${res.status()})`)
  return res.ok()
}

/** Resolve provider por email (login + /api/auth/me) e serviço por título. */
async function resolveFixtures(
  request: APIRequestContext,
  providerEmail: string,
  providerPassword: string,
  serviceTitle: string,
): Promise<{ providerId: string; serviceId: string }> {
  const loginRes = await request.post("/api/auth/login", {
    data: { email: providerEmail, password: providerPassword },
  })
  expect(loginRes.ok(), `login do provider ${providerEmail} falhou`).toBeTruthy()
  const me = (await (await request.get("/api/auth/me")).json()) as { user?: { id?: string } }
  const providerId = me.user?.id ?? ""
  expect(providerId, `provider ${providerEmail} não encontrado via /api/auth/me`).toBeTruthy()

  const servicesRes = await request.get(`/api/services?q=${encodeURIComponent(serviceTitle)}`)
  expect(servicesRes.ok()).toBeTruthy()
  const services = (await servicesRes.json()) as Array<{
    id: string
    title: string
    provider?: { id?: string } | null
  }>
  const service = services.find((s) => s.title === serviceTitle)
  expect(service, `serviço "${serviceTitle}" não encontrado via /api/services`).toBeDefined()
  if (service!.provider?.id) {
    expect(service!.provider.id).toBe(providerId)
  }
  return { providerId, serviceId: service!.id }
}

// =========================================================================
// Testes (serial: cada cenário usa seu próprio provider — isolados)
// =========================================================================

test.describe.serial("Revogação pelo Admin — Realtime", () => {
  test.beforeAll(async ({ request }) => {
    const pedro = await resolveFixtures(request, PEDRO_EMAIL, PEDRO_PASSWORD, PEDRO_SERVICE_TITLE)
    PEDRO_ID = pedro.providerId
    PEDRO_SERVICE_ID = pedro.serviceId

    const antonio = await resolveFixtures(
      request,
      ANTONIO_EMAIL,
      ANTONIO_PASSWORD,
      ANTONIO_SERVICE_TITLE,
    )
    ANTONIO_ID = antonio.providerId
    ANTONIO_SERVICE_ID = antonio.serviceId

    console.log(
      `✅ Fixtures dinâmicas: pedro=${PEDRO_ID} antonio=${ANTONIO_ID} ` +
        `pedroSvc=${PEDRO_SERVICE_ID} antonioSvc=${ANTONIO_SERVICE_ID}`,
    )
  })

  test("C1 — admin desativa usuário com dashboard aberto: socket derruba imediatamente", async ({
    browser,
  }) => {
    const providerCtx = await browser.newContext()
    const providerPage = await providerCtx.newPage()
    const wsList = await openProviderDashboard(providerPage, PEDRO_EMAIL, PEDRO_PASSWORD)

    const clientCtx = await browser.newContext()
    const clientPage = await clientCtx.newPage()
    await login(clientPage, CLIENT_EMAIL, CLIENT_PASSWORD)
    await clientPage.goto("/")

    const adminCtx = await browser.newContext()
    const adminPage = await adminCtx.newPage()
    await login(adminPage, ADMIN_EMAIL, ADMIN_PASSWORD)

    try {
      // Self-heal: garante o pedro ativo (rodada anterior interrompida pode
      // ter deixado active:false) — o cenário parte de estado limpo.
      await ensureProviderActive(adminPage, PEDRO_ID)

      // ── Sanidade: booking do cliente → toast via WebSocket ──────────
      // (prova que o socket está vivo e a pipeline notification:new funciona)
      const bookingSanity = await createBooking(clientPage, PEDRO_ID, PEDRO_SERVICE_ID, 9)
      console.log(`✅ C1 booking de sanidade criado: ${bookingSanity}`)

      const toast = providerPage.locator("[data-sonner-toast]").first()
      await expect(toast).toBeVisible({ timeout: 10000 })
      console.log(`✅ C1 sanidade: toast via WebSocket antes da desativação`)

      // Aguarda o auto-dismiss do toast (sonner duration 5s) para que a
      // fase "nenhum toast" parta de uma tela limpa
      await expect(providerPage.locator("[data-sonner-toast]")).toHaveCount(0, {
        timeout: 10000,
      })

      // ── Admin desativa o usuário (mesmo endpoint do botão "Desativar") ──
      const patchRes = await adminPage.request.patch(`/api/admin/users/${PEDRO_ID}`, {
        data: { active: false },
      })
      expect(patchRes.ok(), `PATCH active:false falhou (HTTP ${patchRes.status()})`).toBeTruthy()
      console.log("✅ C1 usuário desativado pelo admin (active:false → revoke imediato)")

      // ── Socket derrubado IMEDIATAMENTE ──────────────────────────────
      await expectActiveSocketClosed(providerPage, wsList, "C1-desativação")

      // ── NENHUM toast após a desativação ─────────────────────────────
      // Não usamos um booking real aqui: a API de bookings rejeita novos
      // bookings de provider inativo (active:false). Emitimos o evento
      // notification:new DIRETO na sala user:{pedroId} via POST /emit —
      // se o socket estivesse vivo (ou reconectasse), o toast apareceria.
      const emitted = await emitNotificationToRoom(PEDRO_ID)
      expect(emitted, "emit direto na sala deve ser aceito pelo realtime").toBeTruthy()
      console.log("✅ C1 notification:new emitido direto na sala user:{pedroId}")

      // Janela de observação: com o socket vivo, o toast chegaria em <2s e
      // duraria 5s — 8s é folga suficiente para detectar (e falhar) se algo
      // vazar pela sala user:{pedroId}
      await providerPage.waitForTimeout(8000)

      const toastCount = await providerPage.locator("[data-sonner-toast]").count()
      expect(toastCount, "nenhum toast deve aparecer após a desativação").toBe(0)
      console.log("✅ C1 nenhum toast após a desativação — cenário validado")
    } finally {
      // Cleanup: reativa o usuário para não poluir o seed dev (o login do
      // pedro falharia em rodadas futuras com active:false persistido).
      try {
        await adminPage.request.patch(`/api/admin/users/${PEDRO_ID}`, { data: { active: true } })
        console.log("✅ C1 cleanup: pedro reativado (active:true)")
      } catch {
        /* best-effort — o re-seed restaura */
      }
      await adminCtx.close()
      await clientCtx.close()
      await providerCtx.close()
    }
  })

  test("C2 — botão 'Revogar sessões' derruba o socket SEM desativar a conta", async ({
    browser,
  }) => {
    const providerCtx = await browser.newContext()
    const providerPage = await providerCtx.newPage()
    const wsList = await openProviderDashboard(providerPage, ANTONIO_EMAIL, ANTONIO_PASSWORD)

    const clientCtx = await browser.newContext()
    const clientPage = await clientCtx.newPage()
    await login(clientPage, CLIENT_EMAIL, CLIENT_PASSWORD)
    await clientPage.goto("/")

    const adminCtx = await browser.newContext()
    const adminPage = await adminCtx.newPage()
    await login(adminPage, ADMIN_EMAIL, ADMIN_PASSWORD)

    try {
      // ── Sanidade: booking do cliente → toast (prova socket vivo) ────
      const bookingSanity = await createBooking(clientPage, ANTONIO_ID, ANTONIO_SERVICE_ID, 10)
      console.log(`✅ C2 booking de sanidade criado: ${bookingSanity}`)

      const toast = providerPage.locator("[data-sonner-toast]").first()
      await expect(toast).toBeVisible({ timeout: 10000 })
      console.log("✅ C2 sanidade: toast via WebSocket antes da revogação")

      await expect(providerPage.locator("[data-sonner-toast]")).toHaveCount(0, {
        timeout: 10000,
      })

      // ── Admin navega até a view Usuários e clica no botão real ──────
      await adminPage.goto("/dashboard")
      await adminPage.waitForTimeout(2000)

      // Nav lateral (DashboardShell) → "Usuários" (view admin.users)
      const usuariosNav = adminPage.getByRole("button", { name: /Usuários/ }).first()
      await expect(usuariosNav).toBeVisible({ timeout: 8000 })
      await usuariosNav.click()
      await adminPage.waitForTimeout(1500)

      // Filtra a tabela pelo e-mail do provider (search com debounce)
      const search = adminPage.getByPlaceholder("Buscar por nome, e-mail ou cidade")
      await expect(search).toBeVisible({ timeout: 8000 })
      await search.fill(ANTONIO_EMAIL)
      await adminPage.waitForTimeout(800)

      // Linha do provider (por e-mail)
      const row = adminPage.locator("tr").filter({ hasText: ANTONIO_EMAIL }).first()
      await expect(row).toBeVisible({ timeout: 8000 })

      // O botão "Revogar sessões" SÓ habilita quando o provider está ONLINE
      // (sessão realtime com join na sala user:{id}). O indicador vem de
      // /api/admin/realtime/sessions (staleTime 15s) — força o refresh
      // manual e espera o badge "Online" na linha antes de abrir o dropdown.
      const refreshOnline = adminPage.getByRole("button", {
        name: "Atualizar status online",
      })
      await expect(refreshOnline).toBeVisible({ timeout: 8000 })
      await refreshOnline.click()
      // Badge de sessão ativa: "Online · 1" (contador de sessões por usuário
      // — >1 vira badge âmbar de conflito). Regex específica evita match
      // acidental se a linha ganhar outro texto com "Online".
      await expect(row.getByText(/Online · \d+/)).toBeVisible({ timeout: 15000 })
      console.log("✅ C2 provider ONLINE no painel admin (indicador realtime)")

      // Abre o dropdown ⋮ e clica em "Revogar sessões"
      await row.getByRole("button", { name: "Mais ações" }).click()
      const revokeItem = adminPage.getByRole("menuitem", { name: "Revogar sessões" })
      await expect(revokeItem).toBeEnabled({ timeout: 5000 })
      await revokeItem.click()

      // Toast de sucesso no painel admin (confirma o fluxo do botão)
      const adminToast = adminPage.locator("[data-sonner-toast]").first()
      await expect(adminToast).toBeVisible({ timeout: 8000 })
      const adminToastText = (await adminToast.textContent()) ?? ""
      console.log(`✅ C2 toast do admin: "${adminToastText.trim()}"`)

      // ── Socket derrubado ─────────────────────────────────────────────
      await expectActiveSocketClosed(providerPage, wsList, "C2-revogar-sem-desativar")

      // ── SEM desativar: a sessão do provider continua válida ─────────
      // O revoke mata apenas os sockets; o cookie de sessão permanece e a
      // conta continua ativa → /api/auth/me ainda retorna o usuário.
      const me = await providerPage.request.get("/api/auth/me")
      const meBody = (await me.json()) as { user?: { email?: string } | null }
      expect(meBody.user?.email, "sessão deve continuar válida (conta ativa)").toBe(ANTONIO_EMAIL)
      console.log("✅ C2 conta continua ATIVA — /api/auth/me ainda retorna o usuário")

      // ── Novo booking → NENHUM toast (socket morto, sem rejoin) ──────
      const booking2 = await createBooking(clientPage, ANTONIO_ID, ANTONIO_SERVICE_ID, 17)
      console.log(`✅ C2 booking pós-revogação criado: ${booking2}`)

      await providerPage.waitForTimeout(8000)
      const toastCount = await providerPage.locator("[data-sonner-toast]").count()
      expect(toastCount, "nenhum toast deve aparecer após a revogação").toBe(0)
      console.log("✅ C2 nenhum toast após a revogação — cenário validado")
    } finally {
      await adminCtx.close()
      await clientCtx.close()
      await providerCtx.close()
    }
  })

  test("C3 — view Prestadores: botão 'Revogar sessões' + indicador Online (mesmo fluxo do admin.users)", async ({
    browser,
  }) => {
    const providerCtx = await browser.newContext()
    const providerPage = await providerCtx.newPage()
    // Reusa o ANTONIO (mesmo do C2): o describe.serial garante que o C2
    // terminou — conta ativa + socket morto. Abrir o dashboard de novo
    // cria um socket NOVO que dá join na sala user:{antonioId}.
    const wsList = await openProviderDashboard(providerPage, ANTONIO_EMAIL, ANTONIO_PASSWORD)

    const clientCtx = await browser.newContext()
    const clientPage = await clientCtx.newPage()
    await login(clientPage, CLIENT_EMAIL, CLIENT_PASSWORD)
    await clientPage.goto("/")

    const adminCtx = await browser.newContext()
    const adminPage = await adminCtx.newPage()
    await login(adminPage, ADMIN_EMAIL, ADMIN_PASSWORD)

    try {
      // ── Sanidade: booking do cliente → toast (prova socket vivo) ────
      const bookingSanity = await createBooking(clientPage, ANTONIO_ID, ANTONIO_SERVICE_ID, 11)
      console.log(`✅ C3 booking de sanidade criado: ${bookingSanity}`)

      const toast = providerPage.locator("[data-sonner-toast]").first()
      await expect(toast).toBeVisible({ timeout: 10000 })
      console.log("✅ C3 sanidade: toast via WebSocket antes da revogação")

      await expect(providerPage.locator("[data-sonner-toast]")).toHaveCount(0, {
        timeout: 10000,
      })

      // ── Admin navega até a view PRESTADORES (não Usuários) ─────────
      await adminPage.goto("/dashboard")
      await adminPage.waitForTimeout(2000)

      // Nav lateral (DashboardShell) → "Prestadores" (view admin.providers)
      const prestadoresNav = adminPage.getByRole("button", { name: /Prestadores/ }).first()
      await expect(prestadoresNav).toBeVisible({ timeout: 8000 })
      await prestadoresNav.click()
      await adminPage.waitForTimeout(1500)

      // Filtra a tabela pelo e-mail do provider (search com debounce)
      const search = adminPage.getByPlaceholder("Buscar por nome, e-mail ou cidade")
      await expect(search).toBeVisible({ timeout: 8000 })
      await search.fill(ANTONIO_EMAIL)
      await adminPage.waitForTimeout(800)

      // Linha do provider (por e-mail)
      const row = adminPage.locator("tr").filter({ hasText: ANTONIO_EMAIL }).first()
      await expect(row).toBeVisible({ timeout: 8000 })

      // O indicador Online vem de /api/admin/realtime/sessions (staleTime
      // 15s) — força o refresh manual e espera o badge "Online · 1" na
      // linha antes de abrir o dropdown (mesmo seletor do C2).
      const refreshOnline = adminPage.getByRole("button", {
        name: "Atualizar status online",
      })
      await expect(refreshOnline).toBeVisible({ timeout: 8000 })
      await refreshOnline.click()
      await expect(row.getByText(/Online · \d+/)).toBeVisible({ timeout: 15000 })
      console.log("✅ C3 provider ONLINE na view Prestadores (indicador realtime)")

      // Abre o dropdown ⋮ e clica em "Revogar sessões" (view Prestadores)
      await row.getByRole("button", { name: "Mais ações" }).click()
      const revokeItem = adminPage.getByRole("menuitem", { name: "Revogar sessões" })
      await expect(revokeItem).toBeEnabled({ timeout: 5000 })
      await revokeItem.click()

      // Toast de sucesso no painel admin (confirma o fluxo do botão)
      const adminToast = adminPage.locator("[data-sonner-toast]").first()
      await expect(adminToast).toBeVisible({ timeout: 8000 })
      const adminToastText = (await adminToast.textContent()) ?? ""
      console.log(`✅ C3 toast do admin: "${adminToastText.trim()}"`)

      // ── Socket derrubado ─────────────────────────────────────────────
      await expectActiveSocketClosed(providerPage, wsList, "C3-view-prestadores")

      // ── SEM desativar: a sessão do provider continua válida ─────────
      const me = await providerPage.request.get("/api/auth/me")
      const meBody = (await me.json()) as { user?: { email?: string } | null }
      expect(meBody.user?.email, "sessão deve continuar válida (conta ativa)").toBe(ANTONIO_EMAIL)
      console.log("✅ C3 conta continua ATIVA — /api/auth/me ainda retorna o usuário")

      // ── Novo booking → NENHUM toast (socket morto, sem rejoin) ──────
      const booking2 = await createBooking(clientPage, ANTONIO_ID, ANTONIO_SERVICE_ID, 18)
      console.log(`✅ C3 booking pós-revogação criado: ${booking2}`)

      await providerPage.waitForTimeout(8000)
      const toastCount = await providerPage.locator("[data-sonner-toast]").count()
      expect(toastCount, "nenhum toast deve aparecer após a revogação").toBe(0)
      console.log("✅ C3 nenhum toast após a revogação — cenário validado")
    } finally {
      await adminCtx.close()
      await clientCtx.close()
      await providerCtx.close()
    }
  })
})
