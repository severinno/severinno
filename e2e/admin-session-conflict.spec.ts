import { test, expect, type Page } from "@playwright/test"
import type { WebSocket as PlaywrightWebSocket } from "playwright"
import { realtimePort } from "./realtime-emit"

// =========================================================================
// Indicador de Conflito de Sessão — E2E (Admin + Realtime)
//
// Valida no browser o badge âmbar de CONFLITO de sessão do painel admin
// (GET /api/admin/realtime/sessions → OnlineSessionsCell) e o motivo do
// último kick no tooltip:
//
//   Fase 1 — 2 abas do MESMO provider → 2 sockets coexistem (o limite por
//   role do dev é PROVIDER=2 — REALTIME_MAX_SESSIONS_PER_ROLE='{"CLIENT":1,
//   "PROVIDER":2,"ADMIN":5}') → o admin vê o badge âmbar "2 sessões" na
//   linha do provider VIA REFRESH MANUAL (botão "Atualizar status online" —
//   sem esperar o refetchInterval de 30s).
//
//   Fase 2 — 3ª aba do provider → 3 sockets > limite 2 → o realtime derruba
//   o MAIS ANTIGO (socket A) com motivo "session_limit" → o badge continua
//   "2 sessões" (B e C permanecem) e o TOOLTIP do badge mostra o último
//   kick ("Último kick: limite de sessões (2ª aba derrubou a 1ª)") + o
//   histórico. É a mesma jornada que o realtime-session-limit.spec.ts prova
//   no client, agora observada PELA UI ADMIN.
//
// ISOLAMENTO COMPLETO: provider REGISTRADO VIA API no beforeAll com email
// único por run (conflito-<timestamp>@severinno.com) — os 6 providers do
// seed (carlos/ricardo/lima/fernanda/pedro/antonio) já pertencem a outros
// specs de realtime e, com o limite PROVIDER=2, um terceiro spec no MESMO
// provider derrubaria os sockets deles via session_limit. O provider novo é
// invisível para os demais specs → zero interferência em fullyParallel.
//
// CONFIG NECESSÁRIA: o realtime dev DEVE rodar com o limite por role ativo
// (exemplo do docker-compose.dev.yml + .env.local): REALTIME_MAX_SESSIONS_
// PER_ROLE='{"CLIENT":1,"PROVIDER":2,"ADMIN":5}'. Sem o override (limite 1),
// a 2ª aba derruba a 1ª na hora e o badge "2 sessões" nunca aparece.
//
// Credenciais do admin são estáveis no seed; o provider é criado no
// beforeAll — nada a atualizar após re-seed.
// =========================================================================

const ADMIN_EMAIL = "admin@severinno.com"
const ADMIN_PASSWORD = "admin123"

// Provider isolado: email único por run (registrado no beforeAll).
let PROVIDER_EMAIL = ""
const PROVIDER_PASSWORD = "provider123"
let PROVIDER_ID = ""

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
 * persiste o progresso server-side em /api/provider/onboarding — a rota usa
 * upsert no setting, então funciona também para o provider recém-registrado).
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
  await expect(page.locator('[aria-label="Notifications alt+T"]')).toBeAttached({
    timeout: 5000,
  })
}

/**
 * Abre UMA ABA ADICIONAL do dashboard no MESMO context (mesmo cookie →
 * mesmo userId → novo socket no realtime).
 */
async function openDashboardTab(page: Page) {
  await page.goto("/dashboard")
  await page.waitForTimeout(3000)
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
  // Timeout folgado: sob fullyParallel o dev server compila o painel admin sob
  // carga e o nav pode demorar (flake observado com 8s — ver C1 do
  // admin-online-card.spec.ts). 15s absorve a latência sem mascarar quebra.
  await expect(usuariosNav).toBeVisible({ timeout: 15000 })
  await usuariosNav.click()
  await adminPage.waitForTimeout(1500)
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

/**
 * Refresh MANUAL do indicador de sessões (botão "Atualizar status online" da
 * coluna Online) — força o refetch do /api/admin/realtime/sessions sem
 * esperar o refetchInterval de 30s.
 */
async function refreshOnlineStatus(adminPage: Page) {
  const refreshOnline = adminPage.getByRole("button", {
    name: "Atualizar status online",
  })
  await expect(refreshOnline).toBeVisible({ timeout: 8000 })
  await refreshOnline.click()
  await adminPage.waitForTimeout(500)
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
// Teste (serial: as fases dependem umas das outras — sockets vivos)
// =========================================================================

test.describe.serial("Indicador de Conflito de Sessão — Realtime", () => {
  // Fluxo pesado (3 abas + admin + refresh manual + tooltip): sob fullyParallel
  // o dev server compila sob carga e o global de 120s estoura (padrão do
  // realtime-ttl-sweep.spec.ts).
  test.setTimeout(180_000)

  test.beforeAll(async ({ request }) => {
    // ── Provider ISOLADO: registrado via API com email único por run ──
    PROVIDER_EMAIL = `conflito-${Date.now()}@severinno.com`
    const registerRes = await request.post("/api/auth/register", {
      data: {
        name: "Conflito E2E",
        email: PROVIDER_EMAIL,
        password: PROVIDER_PASSWORD,
        confirmPassword: PROVIDER_PASSWORD,
        role: "PROVIDER",
        // Campos obrigatórios do registerSchema para role=PROVIDER:
        // cpfCnpj (regex ^[\d.\-/]+$, min 11), whatsapp (min 10) e city.
        cpfCnpj: "123.456.789-00",
        whatsapp: "11999999999",
        city: "São Paulo",
        state: "SP",
        bio: "Provider isolado criado pelo spec de conflito de sessão",
        radiusKm: 10,
      },
    })
    expect(
      registerRes.ok(),
      `register do provider isolado falhou (HTTP ${registerRes.status()})`,
    ).toBeTruthy()
    const body = (await registerRes.json()) as { user?: { id?: string } }
    PROVIDER_ID = body.user?.id ?? ""
    expect(PROVIDER_ID, "provider isolado não retornou id no register").toBeTruthy()
    console.log(`✅ Provider isolado registrado: ${PROVIDER_ID} (${PROVIDER_EMAIL})`)
  })

  test("2 abas → badge âmbar '2 sessões' (refresh manual) + 3ª aba → session_limit no tooltip", async ({
    browser,
  }) => {
    const adminCtx = await browser.newContext()
    const adminPage = await adminCtx.newPage()
    await login(adminPage, ADMIN_EMAIL, ADMIN_PASSWORD)

    const providerCtx = await browser.newContext()
    const pageA = await providerCtx.newPage()
    const wsA = trackRealtimeSockets(pageA)

    try {
      // ── Admin na view Usuários (card + tabela) ───────────────────────
      await openAdminUsersView(adminPage)
      const row = await findProviderRow(adminPage, PROVIDER_EMAIL)
      console.log("✅ Admin na view Usuários — linha do provider isolado localizada")

      // ── Aba A: dashboard → socket A dá join em user:{providerId} ─────
      await openProviderDashboard(pageA, PROVIDER_EMAIL, PROVIDER_PASSWORD)
      console.log("✅ Aba A com dashboard aberto (socket A no realtime)")

      // ── Aba B (mesmo context): socket B → 2 sockets dentro do limite ─
      const pageB = await providerCtx.newPage()
      await openDashboardTab(pageB)
      console.log("✅ Aba B montada — 2 sockets coexistem (limite PROVIDER=2)")

      // ── FASE 1: badge âmbar "2 sessões" via REFRESH MANUAL ──────────
      await refreshOnlineStatus(adminPage)
      await expect(row.getByText(/2 sessões/)).toBeVisible({ timeout: 15000 })
      console.log("✅ Fase 1: badge âmbar '2 sessões' (conflito) visível na linha")

      // ── Aba C: 3ª socket → 3 > 2 → derruba o MAIS ANTIGO (A) ────────
      const pageC = await providerCtx.newPage()
      await openDashboardTab(pageC)
      console.log("✅ Aba C montada — 3 sockets > limite 2: o mais antigo (A) deve cair")

      // ── FASE 2: tooltip mostra o motivo do último kick (session_limit) ─
      await refreshOnlineStatus(adminPage)
      // Badge continua "2 sessões" (B e C permanecem — os 2 mais recentes).
      await expect(row.getByText(/2 sessões/)).toBeVisible({ timeout: 15000 })

      // Hover no badge → Radix Tooltip com "Último kick: limite de sessões".
      await row.getByText(/2 sessões/).hover()
      await expect(
        adminPage.getByText(/Último kick: limite de sessões \(2ª aba derrubou a 1ª\)/),
      ).toBeVisible({ timeout: 8000 })
      console.log("✅ Fase 2: tooltip mostra o último kick (session_limit)")

      // ── Sanidade: o socket da aba A (antigo) realmente fechou ────────
      const realtimeA = wsA.filter(
        (w) => w.url.includes(`:${realtimePort()}`) || w.url.includes("XTransformPort"),
      )
      if (realtimeA.length > 0) {
        const activeA = realtimeA[realtimeA.length - 1]
        const closedA = await waitForWsClose(activeA.ws, 10000, "aba A (mais antiga)")
        expect(closedA, "socket da aba A deve fechar (session_limit após a 3ª aba)").toBe(true)
        console.log("✅ Sanidade: socket da aba A fechado (session_limit)")
      } else {
        console.log("ℹ️ Nenhum websocket realtime observado na aba A — assert de close pulado")
      }

      await pageB.close()
      await pageC.close()
    } finally {
      await providerCtx.close()
      await adminCtx.close()
    }
  })
})
