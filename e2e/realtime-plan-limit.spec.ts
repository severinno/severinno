import { test, expect, type Page, type APIRequestContext } from "@playwright/test"
import type { WebSocket as PlaywrightWebSocket } from "playwright"
import { Pool } from "pg"
import { realtimePort, readEnv } from "./realtime-emit"

// =========================================================================
// Limite de Sessões POR PLANO/TENANT — E2E (Realtime)
//
// Cenário: valida o limite por plano do realtime de ponta a ponta, com
// REALTIME_MAX_SESSIONS_PER_PLAN='{"PREMIUM":5}' ativo no dev:
//
//   1. PREMIUM (override por plano = 5): o mesmo provider abre o dashboard
//      em TRÊS abas. Como o plano PREMIUM VENCE o per-role PROVIDER=2, as
//      três abas COEXISTEM (5 > 3) — a 3ª aba NÃO derruba a 1ª.
//
//   2. FREE (sem override por plano → fallback ao per-role): o mesmo provider
//      abre em TRÊS abas. O plano FREE não está no env per-plan → cai no
//      per-role atual (PROVIDER=2): a 3ª aba derruba a MAIS ANTIGA (socket A)
//      com motivo session_limit — os 2 mais recentes (B e C) permanecem.
//
// O DIFERENCIAL (plano > role) é exatamente isso: MESMO role (PROVIDER),
// planos diferentes → limites diferentes (5 vs 2).
//
// ISOLAMENTO COMPLETO (providers próprios): cada spec E2E de realtime usa
// users DISTINTOS (fullyParallel + realtime casa sockets por userId). Os dois
// providers deste spec são REGISTRADOS via API no beforeAll (emails únicos
// por run); o provider PREMIUM tem o plano atualizado direto no banco via pg
// (DATABASE_URL do .env.local) — o register não aceita plano (billing é
// server-side, o client não se auto-assina premium).
//
// ⚠️ REQUISITO DE CONFIG: o realtime dev DEVE rodar com
// REALTIME_MAX_SESSIONS_PER_PLAN='{"PREMIUM":5}' E a coluna User.plan criada
// no banco dev (migration 20260817090000_add_user_plan — aplicada via
// prisma db execute). Sem a env, PREMIUM cai no per-role (2) e o teste 1
// quebra; sem a coluna, o UPDATE do beforeAll falha (o spec falha com
// mensagem clara). A config do .env.local usada em dev:
//   REALTIME_MAX_SESSIONS_PER_ROLE='{"CLIENT":1,"PROVIDER":2,"ADMIN":5}'
//   REALTIME_MAX_SESSIONS_PER_PLAN='{"PREMIUM":5}'
// =========================================================================

const PROVIDER_PASSWORD = "provider123"

// Preenchidos no beforeAll (registro via API com email único por run).
let PREMIUM_EMAIL = ""
let PREMIUM_ID = ""
let FREE_EMAIL = ""
let FREE_ID = ""

// =========================================================================
// Helpers (mesmo padrão do realtime-role-limit.spec.ts)
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
  expect(ok).toBeTruthy()
}

/** Coleta os websockets realtime (realtimePort) de uma página. */
function trackRealtimeSockets(page: Page): Array<{ url: string; ws: PlaywrightWebSocket }> {
  const list: Array<{ url: string; ws: PlaywrightWebSocket }> = []
  page.on("websocket", (ws) => {
    list.push({ url: ws.url(), ws })
  })
  return list
}

/** Filtra os websockets do realtime (por porta ou XTransformPort). */
function realtimeSocketsOf(
  list: Array<{ url: string; ws: PlaywrightWebSocket }>,
): Array<{ url: string; ws: PlaywrightWebSocket }> {
  return list.filter(
    (w) => w.url.includes(`:${realtimePort()}`) || w.url.includes("XTransformPort"),
  )
}

/** Aguarda o websocket realtime aparecer na página (join confirmado). */
async function waitForRealtimeSocket(
  page: Page,
  tracked: Array<{ url: string; ws: PlaywrightWebSocket }>,
  timeoutMs = 15000,
): Promise<PlaywrightWebSocket | null> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const list = realtimeSocketsOf(tracked)
    if (list.length > 0) return list[list.length - 1]!.ws
    await new Promise((r) => setTimeout(r, 300))
  }
  return null
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

/** Abre o dashboard do provider logado (socket dá join em user:{id}). */
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

/** Abre uma aba ADICIONAL do dashboard no MESMO context (mesmo cookie). */
async function openDashboardTab(page: Page) {
  await page.goto("/dashboard")
  await page.waitForTimeout(3000)
  await expect(page.locator('[aria-label="Notifications alt+T"]')).toBeAttached({
    timeout: 5000,
  })
}

/** Registra um provider isolado via API e retorna o id. */
async function registerProvider(request: APIRequestContext, email: string): Promise<string> {
  const res = await request.post("/api/auth/register", {
    data: {
      name: "Plan Limit Provider E2E",
      email,
      password: PROVIDER_PASSWORD,
      confirmPassword: PROVIDER_PASSWORD,
      role: "PROVIDER",
      cpfCnpj: "123.456.789-00",
      whatsapp: "11999999999",
      city: "São Paulo",
      state: "SP",
      bio: "Provider isolado criado pelo spec de limite por plano",
      radiusKm: 10,
    },
  })
  expect(res.ok(), `register falhou (HTTP ${res.status()})`).toBeTruthy()
  const body = (await res.json()) as { user?: { id?: string } }
  const id = body.user?.id ?? ""
  expect(id, "register não retornou id").toBeTruthy()
  return id
}

// =========================================================================
// Testes (serial: os sockets vivos de um teste não podem vazar para o outro)
// =========================================================================

test.describe.serial("Limite de Sessões por Plano — Realtime", () => {
  test.setTimeout(180_000)

  test.beforeAll(async ({ request }) => {
    // ── Provider PREMIUM: registrado via API + plano atualizado no banco ──
    PREMIUM_EMAIL = `plan-limit-premium-${Date.now()}@severinno.com`
    PREMIUM_ID = await registerProvider(request, PREMIUM_EMAIL)

    // ── Provider FREE: registrado via API (plano default FREE) ──────────
    FREE_EMAIL = `plan-limit-free-${Date.now()}@severinno.com`
    FREE_ID = await registerProvider(request, FREE_EMAIL)

    // ── Upgrade do plano do PREMIUM direto no banco (billing server-side) ─
    const databaseUrl = readEnv("DATABASE_URL")
    expect(
      databaseUrl,
      "DATABASE_URL necessário para subir o plano do provider para PREMIUM (env ou .env.local)",
    ).toBeTruthy()
    const pool = new Pool({ connectionString: databaseUrl, max: 1 })
    try {
      const r = await pool.query(`UPDATE "User" SET "plan" = 'PREMIUM' WHERE id = $1`, [PREMIUM_ID])
      expect(
        r.rowCount,
        `UPDATE do plano PREMIUM em ${PREMIUM_ID} falhou — coluna User.plan existe?`,
      ).toBe(1)
      console.log(`✅ Plano do provider PREMIUM atualizado no banco: ${PREMIUM_ID}`)
    } finally {
      await pool.end()
    }

    console.log(
      `✅ Providers isolados: PREMIUM=${PREMIUM_ID} (${PREMIUM_EMAIL}) · FREE=${FREE_ID} (${FREE_EMAIL})`,
    )
  })

  test("PREMIUM=5: 3ª aba NÃO derruba a 1ª (plano vence o per-role PROVIDER=2)", async ({
    browser,
  }) => {
    const ctx = await browser.newContext()
    const pageA = await ctx.newPage()
    const wsA = trackRealtimeSockets(pageA)
    let activeA: PlaywrightWebSocket | null = null

    try {
      // ── Aba A: dashboard → socket A dá join em user:{premiumId} ───────
      await openProviderDashboard(pageA, PREMIUM_EMAIL, PROVIDER_PASSWORD)
      activeA = await waitForRealtimeSocket(pageA, wsA)
      expect(activeA, "aba A deve ter websocket realtime (join)").not.toBeNull()

      // ── Aba B ─────────────────────────────────────────────────────────
      const pageB = await ctx.newPage()
      const wsB = trackRealtimeSockets(pageB)
      await openDashboardTab(pageB)
      const activeB = await waitForRealtimeSocket(pageB, wsB)
      expect(activeB, "aba B deve ter websocket realtime (join)").not.toBeNull()

      // ── Aba C: 3 sockets do MESMO provider — PREMIUM=5 permite os 3 ───
      const pageC = await ctx.newPage()
      const wsC = trackRealtimeSockets(pageC)
      await openDashboardTab(pageC)
      const activeC = await waitForRealtimeSocket(pageC, wsC)
      expect(activeC, "aba C deve ter websocket realtime (join)").not.toBeNull()

      // A 3ª aba NÃO derruba ninguém (5 > 3): socket A PERMANECE aberto.
      await pageA.waitForTimeout(1500)
      expect(
        activeA!.isClosed(),
        "socket da aba A deve PERMANECER aberto — PREMIUM=5 permite 3 sockets (plano vence PROVIDER=2)",
      ).toBe(false)
      expect(activeB!.isClosed(), "socket da aba B deve permanecer aberto").toBe(false)
      expect(activeC!.isClosed(), "socket da aba C deve permanecer aberto").toBe(false)
      console.log("✅ PREMIUM: 3 abas coexistem (limite 5 do plano vence o per-role PROVIDER=2)")

      await pageB.close()
      await pageC.close()
    } finally {
      await ctx.close()
    }
  })

  test("FREE: 3ª aba derruba a mais antiga (sem override por plano → per-role PROVIDER=2)", async ({
    browser,
  }) => {
    const ctx = await browser.newContext()
    const pageA = await ctx.newPage()
    const wsA = trackRealtimeSockets(pageA)
    let activeA: PlaywrightWebSocket | null = null

    try {
      // ── Aba A: dashboard → socket A dá join em user:{freeId} ──────────
      await openProviderDashboard(pageA, FREE_EMAIL, PROVIDER_PASSWORD)
      activeA = await waitForRealtimeSocket(pageA, wsA)
      expect(activeA, "aba A deve ter websocket realtime (join)").not.toBeNull()

      // ── Aba B ─────────────────────────────────────────────────────────
      const pageB = await ctx.newPage()
      const wsB = trackRealtimeSockets(pageB)
      await openDashboardTab(pageB)
      const activeB = await waitForRealtimeSocket(pageB, wsB)
      expect(activeB, "aba B deve ter websocket realtime (join)").not.toBeNull()

      // ── Aba C: 3 sockets → FREE sem override → per-role PROVIDER=2 ────
      const pageC = await ctx.newPage()
      const wsC = trackRealtimeSockets(pageC)
      await openDashboardTab(pageC)
      const activeC = await waitForRealtimeSocket(pageC, wsC)
      expect(activeC, "aba C deve ter websocket realtime (join)").not.toBeNull()

      // O plano FREE não está no env per-plan → cai no per-role PROVIDER=2:
      // a 3ª aba derruba a MAIS ANTIGA (A) — sockets B e C permanecem.
      const closedA = await waitForWsClose(activeA!, 10000, "aba A do FREE (mais antiga)")
      expect(
        closedA,
        "socket da aba A do FREE deve fechar — fallback ao per-role PROVIDER=2 (limite 2)",
      ).toBe(true)
      expect(activeB!.isClosed(), "socket da aba B deve permanecer aberto").toBe(false)
      expect(activeC!.isClosed(), "socket da aba C deve permanecer aberto").toBe(false)
      console.log("✅ FREE: 3ª aba derrubou a mais antiga (fallback ao per-role PROVIDER=2)")

      await pageB.close()
      await pageC.close()
    } finally {
      await ctx.close()
    }
  })
})
