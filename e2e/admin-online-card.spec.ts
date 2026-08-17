import { test, expect, type Page } from "@playwright/test"

// =========================================================================
// Card "Usuários online" — E2E (admin panel + realtime)
//
// Cobre no browser o indicador de sessões ativas do painel admin
// (GET /api/admin/realtime/sessions → card do OnlineUsersKpiCard):
//
//   Cenário 1 — O contador do card sobe quando um provider abre o dashboard:
//   o admin logado vê o card em "Usuários" com N online; o provider faz
//   login e navega para o /dashboard (o RealtimeProvider conecta o
//   Socket.io e dá join na sala user:{id}); o card passa a refletir o novo
//   provider (contador maior + badge "Online" na linha dele).
//
//   Cenário 2 — Refresh manual: o botão "Atualizar status online" (coluna
//   "Online" da tabela) força o refetch imediato do /sessions — sem esperar
//   o refetchInterval de 30s. O provider fecha o dashboard (socket morre);
//   o clique no refresh derruba o badge "Online" da linha imediatamente.
//
// FLAKINESS (fullyParallel): o contador GLOBAL do card pode mudar por outros
// specs abrindo/fechando dashboards de providers em paralelo — por isso as
// asserções PRIMÁRIAS são por LINHA do provider (badge "Online · N" — casa
// por userId no realtime, imune aos demais); o contador global entra como
// sanidade secundária com limite >= (nunca igualdade exata).
//
// Provider ISOLADO: lima@severinno.com (Pinturas Lima) — não é usado por
// nenhum outro spec de realtime (carlos/ricardo/fernanda/pedro/antonio já
// pertencem a realtime-notification/session-limit/session-revocation).
//
// SELF-HEAL: no beforeAll o admin revoga as sessões do lima (POST
// revoke-sessions) — uma rodada anterior interrompida pode ter deixado um
// socket órfão contando no baseline (o session_limit derrubaria o órfão no
// novo join, e o contador não subiria). Partida sempre offline.
//
// Run:  bunx playwright test e2e/admin-online-card.spec.ts --project=chromium
// UI:   bunx playwright test --ui
// =========================================================================

const ADMIN_EMAIL = "admin@severinno.com"
const ADMIN_PASSWORD = "admin123"

// Cenário: lima (Pinturas Lima) — isolado dos demais specs de realtime.
const LIMA_EMAIL = "lima@severinno.com"
const LIMA_PASSWORD = "provider123"
const LIMA_SERVICE_TITLE = "Pintura interna de parede"

// Preenchidos no beforeAll (não são constantes hardcoded).
let LIMA_ID = ""

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
 * Usa fetch do navegador pelo mesmo motivo do session-revocation.spec.ts
 * (proxy dev desyncroniza body em keep-alive). Exige página navegada.
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

/**
 * Abre o dashboard do provider logado — o RealtimeProvider conecta o
 * Socket.io e dá join na sala user:{providerId} (presença ativa no realtime).
 */
async function openProviderDashboard(page: Page, email: string, password: string) {
  await login(page, email, password)
  await page.goto("/")
  await skipOnboarding(page)
  await page.goto("/dashboard")
  await page.waitForTimeout(3000)
  // sonner Toaster montado = o RealtimeProvider (que conecta) está ativo.
  await expect(page.locator('[aria-label="Notifications alt+T"]')).toBeAttached({
    timeout: 5000,
  })
}

/**
 * Navega o admin até a view Usuários (onde o card + a tabela vivem).
 */
async function openAdminUsersView(adminPage: Page) {
  await adminPage.goto("/dashboard")
  await adminPage.waitForTimeout(2000)
  const usuariosNav = adminPage.getByRole("button", { name: /Usuários/ }).first()
  // Timeout folgado: sob fullyParallel o dev server compila o painel admin
  // sob carga e o nav pode demorar (flake observado com 8s — C1 falhou 2x na
  // rodada paralela). 15s absorve a latência sem mascarar quebra.
  await expect(usuariosNav).toBeVisible({ timeout: 15000 })
  await usuariosNav.click()
  await adminPage.waitForTimeout(1500)
}

/**
 * Lê o número do card "Usuários online" (o <p> do KpiCard com o valor).
 * O card é identificado pela label "Usuários online" — o valor é o <p>
 * imediatamente anterior (estrutura do KpiCard: p.valor → p.label → p.sub).
 */
async function readOnlineCardValue(page: Page): Promise<number> {
  const label = page.getByText("Usuários online", { exact: true }).first()
  await expect(label).toBeVisible({ timeout: 8000 })
  const valueEl = label.locator("xpath=preceding-sibling::p[1]")
  const raw = (await valueEl.textContent()) ?? "0"
  const n = Number(raw.trim())
  expect(Number.isFinite(n), `valor do card deve ser numérico (recebido "${raw}")`).toBe(true)
  return n
}

/**
 * Localiza a linha do provider na tabela de usuários (busca por e-mail).
 */
async function findProviderRow(adminPage: Page, email: string) {
  const search = adminPage.getByPlaceholder("Buscar por nome, e-mail ou cidade")
  await expect(search).toBeVisible({ timeout: 15000 })
  await search.fill(email)
  await adminPage.waitForTimeout(800)
  const row = adminPage.locator("tr").filter({ hasText: email }).first()
  // 15s: a busca + render da tabela sob fullyParallel com dev server
  // compilando pode passar de 8s (flake observado na rodada paralela).
  await expect(row).toBeVisible({ timeout: 15000 })
  return row
}

// =========================================================================
// Testes (serial: ambos os cenários usam o mesmo provider isolado)
// =========================================================================

test.describe.serial("Card Usuários Online — Realtime", () => {
  // Dois cenários com dashboard + admin: sob fullyParallel o dev server
  // compila sob carga e o global de 120s estoura (padrão do
  // realtime-ttl-sweep.spec.ts).
  test.setTimeout(180_000)

  test.beforeAll(async ({ request }) => {
    // ── Fixture dinâmica: lima por email (login + /api/auth/me) ─────────
    const loginRes = await request.post("/api/auth/login", {
      data: { email: LIMA_EMAIL, password: LIMA_PASSWORD },
    })
    expect(loginRes.ok(), `login do provider ${LIMA_EMAIL} falhou`).toBeTruthy()
    const me = (await (await request.get("/api/auth/me")).json()) as { user?: { id?: string } }
    LIMA_ID = me.user?.id ?? ""
    expect(LIMA_ID, `provider ${LIMA_EMAIL} não encontrado via /api/auth/me`).toBeTruthy()
    console.log(`✅ Fixture dinâmica: lima=${LIMA_ID}`)

    // ── Self-heal: revoga sessões do lima (partida SEMPRE offline). Uma
    //    rodada anterior interrompida pode ter deixado um socket órfão que
    //    já conta no baseline (o novo join derrubaria o órfão via
    //    session_limit e o contador não subiria) — o revoke limpa tudo.
    const adminLogin = await request.post("/api/auth/login", {
      data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    })
    expect(adminLogin.ok()).toBeTruthy()
    const revokeRes = await request.post(`/api/admin/users/${LIMA_ID}/revoke-sessions`)
    if (!revokeRes.ok()) {
      console.log(`⚠️ self-heal: revoke-sessions do lima falhou (${revokeRes.status()})`)
    }
    console.log("✅ Self-heal: sessões do lima revogadas — baseline limpo")
  })

  test("C1 — contador do card sobe quando o provider abre o dashboard", async ({ browser }) => {
    const adminCtx = await browser.newContext()
    const adminPage = await adminCtx.newPage()
    await login(adminPage, ADMIN_EMAIL, ADMIN_PASSWORD)

    const providerCtx = await browser.newContext()
    const providerPage = await providerCtx.newPage()

    try {
      // ── Admin: view Usuários com o card de usuários online ──────────
      await openAdminUsersView(adminPage)
      const baseline = await readOnlineCardValue(adminPage)
      console.log(`✅ C1 baseline do card: ${baseline} usuário(s) online`)

      // ── Provider: login + dashboard (socket joined em user:{limaId}) ──
      await openProviderDashboard(providerPage, LIMA_EMAIL, LIMA_PASSWORD)
      console.log("✅ C1 provider com dashboard aberto (socket joined)")

      // ── Asserção PRIMÁRIA (determinística): badge "Online" na linha do
      //    lima — imune aos outros specs (presença casa por userId). O
      //    /sessions tem staleTime 15s + refetchInterval 30s; o refresh
      //    manual adianta e o expect com timeout cobre o refetch sozinho.
      const row = await findProviderRow(adminPage, LIMA_EMAIL)
      await expect(row.getByText(/Online · \d+/)).toBeVisible({ timeout: 30000 })
      console.log("✅ C1 badge 'Online' na linha do lima (indicador realtime)")

      // ── Sanidade secundária: contador GLOBAL subiu (>= baseline+1 —
      //    nunca igualdade exata: outros specs podem adicionar online).
      const after = await readOnlineCardValue(adminPage)
      expect(after, `contador deve subir (baseline ${baseline} → ${after})`).toBeGreaterThanOrEqual(
        baseline + 1,
      )
      console.log(`✅ C1 card atualizado: ${baseline} → ${after}`)
    } finally {
      await providerCtx.close()
      await adminCtx.close()
    }
  })

  test("C2 — refresh manual atualiza o card imediatamente quando o provider sai", async ({
    browser,
  }) => {
    const adminCtx = await browser.newContext()
    const adminPage = await adminCtx.newPage()
    await login(adminPage, ADMIN_EMAIL, ADMIN_PASSWORD)

    const providerCtx = await browser.newContext()
    const providerPage = await providerCtx.newPage()

    try {
      // ── Admin na view Usuários ───────────────────────────────────────
      await openAdminUsersView(adminPage)
      const baseline = await readOnlineCardValue(adminPage)

      // ── Provider entra (socket joined) → badge Online na linha ──────
      await openProviderDashboard(providerPage, LIMA_EMAIL, LIMA_PASSWORD)
      const row = await findProviderRow(adminPage, LIMA_EMAIL)
      await expect(row.getByText(/Online · \d+/)).toBeVisible({ timeout: 30000 })
      console.log(`✅ C2 provider online (baseline do card: ${baseline})`)

      // ── Provider FECHA o dashboard (socket morre) ───────────────────
      await providerPage.goto("about:blank")
      await providerPage.waitForTimeout(1500)
      console.log("✅ C2 provider fechou o dashboard — socket desconectado")

      // ── Refresh MANUAL da coluna Online → badge cai IMEDIATAMENTE ──
      //    (sem esperar o refetchInterval de 30s). O clique força o refetch
      //    do /sessions e a linha deixa de mostrar "Online".
      const refreshOnline = adminPage.getByRole("button", {
        name: "Atualizar status online",
      })
      await expect(refreshOnline).toBeVisible({ timeout: 8000 })
      await refreshOnline.click()

      await expect(row.getByText(/Online · \d+/)).not.toBeVisible({ timeout: 15000 })
      console.log("✅ C2 refresh manual: badge 'Online' removido imediatamente")

      // ── Sanidade secundária: contador GLOBAL <= baseline (o provider
      //    saiu; outros specs podem ter entrado, por isso <= e não ==). ──
      const after = await readOnlineCardValue(adminPage)
      expect(after, `contador não deve subir com o lima offline (${after})`).toBeLessThanOrEqual(
        baseline,
      )
      console.log(`✅ C2 card após refresh: ${after} (baseline ${baseline})`)
    } finally {
      await providerCtx.close()
      await adminCtx.close()
    }
  })
})
