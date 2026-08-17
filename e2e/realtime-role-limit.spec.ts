import { test, expect, type Page } from "@playwright/test"
import type { WebSocket as PlaywrightWebSocket } from "playwright"
import { realtimePort } from "./realtime-emit"

// =========================================================================
// Limite de Sessões POR ROLE — E2E (Realtime)
//
// Cenário: valida o limite por role do realtime de ponta a ponta, com
// REALTIME_MAX_SESSIONS_PER_ROLE='{"CLIENT":1,"PROVIDER":2,"ADMIN":5}':
//
//   1. PROVIDER (limite 2): o mesmo provider abre o dashboard em TRÊS abas
//      (mesmo browser context → mesmo cookie → mesma sessão). A 1ª e a 2ª
//      abas COEXISTEM (dentro do limite 2); a 3ª aba derruba a MAIS ANTIGA
//      (socket A) com motivo session_limit — os 2 mais recentes (B e C)
//      permanecem vivos.
//
//   2. CLIENT (limite 1): o mesmo client abre em DUAS abas. CLIENT não tem
//      override por role → usa o default global 1: a 2ª aba derruba a 1ª
//      (socket A) — prova que o limite por role vale para os DOIS perfis,
//      não só para o PROVIDER do cenário 1.
//
// ISOLAMENTO COMPLETO (provider E client próprios): cada spec E2E de
// realtime usa users DISTINTOS porque os specs rodam em paralelo
// (fullyParallel) e o realtime casa sockets por userId — sockets do MESMO
// usuário se derrubam quando o limite por role é excedido. Os users deste
// spec são REGISTRADOS via API no beforeAll (emails únicos por run) — nada
// de seed, nunca colide com os outros specs (carlos/ricardo/fernanda/
// pedro/antonio/lima e cliente/maria pertencem aos specs de realtime).
//
// ⚠️ REQUISITO DE CONFIG: este spec valida o comportamento com o limite por
// role ATIVO no dev — o mínimo é REALTIME_MAX_SESSIONS_PER_ROLE='{"PROVIDER":
// 2}' (a config completa do .env.local é {"CLIENT":1,"PROVIDER":2,"ADMIN":5}).
// Com PROVIDER=2, a 2ª aba NÃO derruba a 1ª (coexistem); a 3ª derruba a
// MAIS ANTIGA. A asserção CLIENT=1 (2ª aba derruba a 1ª) passa nas DUAS
// configs: CLIENT sem override por role cai no default global 1. Se o
// realtime rodar sem override E com default ≠ 1, o cenário muda e este spec
// quebra — rode com a config acima.
// =========================================================================

const PROVIDER_PASSWORD = "provider123"
const CLIENT_PASSWORD = "cliente123"

// Preenchidos no beforeAll (registro via API com email único por run).
let PROVIDER_EMAIL = ""
let PROVIDER_ID = ""
let CLIENT_EMAIL = ""
let CLIENT_ID = ""

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

/**
 * Coleta os websockets realtime (realtimePort) de uma página. O ÚLTIMO é o
 * socket ativo (o Next dev reseta o singleton do módulo ao navegar, criando
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

/** Filtra os websockets do realtime (por porta ou XTransformPort). */
function realtimeSocketsOf(
  list: Array<{ url: string; ws: PlaywrightWebSocket }>,
): Array<{ url: string; ws: PlaywrightWebSocket }> {
  return list.filter(
    (w) => w.url.includes(`:${realtimePort()}`) || w.url.includes("XTransformPort"),
  )
}

/** Aguarda o websocket realtime aparecer na página (join confirmado pela
 *  presença do socket — sem depender do bell do dashboard). */
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

/** Abre uma aba ADICIONAL do dashboard no MESMO context (mesmo cookie →
 *  mesmo userId → novo socket no realtime). */
async function openDashboardTab(page: Page) {
  await page.goto("/dashboard")
  await page.waitForTimeout(3000)
  await expect(page.locator('[aria-label="Notifications alt+T"]')).toBeAttached({
    timeout: 5000,
  })
}

/** Abre o painel do client logado (RealtimeProvider conecta + join em
 *  user:{id} com role CLIENT — qualquer página autenticada basta). */
async function openClientPanel(page: Page, email: string, password: string) {
  await login(page, email, password)
  await page.goto("/")
  await page.waitForTimeout(3000)
}

// =========================================================================
// Testes (serial: os sockets vivos de um teste não podem vazar para o outro
// — cada teste fecha os próprios contexts no finally)
// =========================================================================

test.describe.serial("Limite de Sessões por Role — Realtime", () => {
  // Fluxo pesado (3 abas de provider + 2 abas de client + joins): sob
  // fullyParallel o dev server compila sob carga e o global de 120s estoura
  // (padrão do realtime-ttl-sweep.spec.ts).
  test.setTimeout(180_000)

  test.beforeAll(async ({ request }) => {
    // ── Provider ISOLADO: registrado via API (email único por run) ──
    PROVIDER_EMAIL = `role-limit-provider-${Date.now()}@severinno.com`
    const providerRes = await request.post("/api/auth/register", {
      data: {
        name: "Role Limit Provider E2E",
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
        bio: "Provider isolado criado pelo spec de limite por role",
        radiusKm: 10,
      },
    })
    expect(
      providerRes.ok(),
      `register do provider isolado falhou (HTTP ${providerRes.status()})`,
    ).toBeTruthy()
    const providerBody = (await providerRes.json()) as { user?: { id?: string } }
    PROVIDER_ID = providerBody.user?.id ?? ""
    expect(PROVIDER_ID, "provider isolado não retornou id no register").toBeTruthy()
    console.log(`✅ Provider isolado registrado: ${PROVIDER_ID} (${PROVIDER_EMAIL})`)

    // ── CLIENT ISOLADO: registrado via API (email único por run) ──
    CLIENT_EMAIL = `role-limit-client-${Date.now()}@severinno.com`
    const clientRes = await request.post("/api/auth/register", {
      data: {
        name: "Role Limit Client E2E",
        email: CLIENT_EMAIL,
        password: CLIENT_PASSWORD,
        confirmPassword: CLIENT_PASSWORD,
        role: "CLIENT",
        // CLIENT não exige cpfCnpj/whatsapp/city (refine é provider-only).
      },
    })
    expect(
      clientRes.ok(),
      `register do client isolado falhou (HTTP ${clientRes.status()})`,
    ).toBeTruthy()
    const clientBody = (await clientRes.json()) as { user?: { id?: string } }
    CLIENT_ID = clientBody.user?.id ?? ""
    expect(CLIENT_ID, "client isolado não retornou id no register").toBeTruthy()
    console.log(`✅ Client isolado registrado: ${CLIENT_ID} (${CLIENT_EMAIL})`)
  })

  test("PROVIDER=2: 3ª aba derruba a mais antiga (mantendo 2)", async ({ browser }) => {
    // ── Contexto do provider (mesmo cookie nas três abas) ──────────────
    const providerCtx = await browser.newContext()
    const pageA = await providerCtx.newPage()
    const wsA = trackRealtimeSockets(pageA)
    let activeA: PlaywrightWebSocket | null = null

    try {
      // ── Aba A: dashboard → socket A dá join em user:{providerId} ─────
      await openProviderDashboard(pageA, PROVIDER_EMAIL, PROVIDER_PASSWORD)
      activeA = await waitForRealtimeSocket(pageA, wsA)
      expect(activeA, "aba A deve ter websocket realtime (join)").not.toBeNull()

      // ── Aba B (mesmo context → mesma sessão): socket B dá join ───────
      const pageB = await providerCtx.newPage()
      const wsB = trackRealtimeSockets(pageB)
      await openDashboardTab(pageB)
      const activeB = await waitForRealtimeSocket(pageB, wsB)
      expect(activeB, "aba B deve ter websocket realtime (join)").not.toBeNull()
      console.log("✅ Aba B montada — 2 sockets dentro do limite PROVIDER=2 (coexistem)")

      // ── Com PROVIDER=2 a 2ª aba NÃO derruba a 1ª: socket A PERMANECE ──
      await pageA.waitForTimeout(1500)
      expect(
        activeA!.isClosed(),
        "socket da aba A (1ª) deve PERMANECER aberto — limite PROVIDER=2 permite 2 sockets",
      ).toBe(false)
      console.log("✅ Socket da aba A segue vivo (2 sockets dentro do limite)")

      // ── Aba C: socket C dá join → 3 sockets > 2 → derruba o MAIS ANTIGO (A) ──
      const pageC = await providerCtx.newPage()
      const wsC = trackRealtimeSockets(pageC)
      await openDashboardTab(pageC)
      const activeC = await waitForRealtimeSocket(pageC, wsC)
      expect(activeC, "aba C deve ter websocket realtime (join)").not.toBeNull()
      console.log("✅ Aba C montada — 3 sockets > limite 2: o mais antigo (A) deve cair")

      const closedA = await waitForWsClose(activeA!, 10000, "aba A (mais antiga)")
      expect(closedA, "socket da aba A (mais antigo) deve fechar após a 3ª aba assumir").toBe(true)
      console.log(`✅ Socket da aba A fechado (session_limit) — ${wsA.length} ws observado(s)`)

      // ── Sockets B e C (mais recentes) devem PERMANECER vivos ─────────
      expect(activeB!.isClosed(), "socket da aba B (recente) deve permanecer aberto").toBe(false)
      expect(activeC!.isClosed(), "socket da aba C (mais recente) deve permanecer aberto").toBe(
        false,
      )
      console.log("✅ Sockets das abas B e C permanecem abertos (os 2 mais recentes vencem)")

      await pageB.close()
      await pageC.close()
    } finally {
      await providerCtx.close()
    }
  })

  test("CLIENT=1: 2ª aba derruba a 1ª (default global — sem override por role)", async ({
    browser,
  }) => {
    // ── Contexto do client (mesmo cookie nas duas abas) ────────────────
    const clientCtx = await browser.newContext()
    const pageA = await clientCtx.newPage()
    const wsA = trackRealtimeSockets(pageA)
    let activeA: PlaywrightWebSocket | null = null

    try {
      // ── Aba A: painel do client → socket A dá join em user:{clientId} ──
      await openClientPanel(pageA, CLIENT_EMAIL, CLIENT_PASSWORD)
      activeA = await waitForRealtimeSocket(pageA, wsA)
      expect(activeA, "aba A deve ter websocket realtime (join CLIENT)").not.toBeNull()
      console.log("✅ Aba A do client montada — 1 socket dentro do limite CLIENT=1")

      // ── Aba B (mesmo context → mesma sessão): socket B dá join ───────
      const pageB = await clientCtx.newPage()
      const wsB = trackRealtimeSockets(pageB)
      await openClientPanel(pageB, CLIENT_EMAIL, CLIENT_PASSWORD)
      const activeB = await waitForRealtimeSocket(pageB, wsB)
      expect(activeB, "aba B deve ter websocket realtime (join CLIENT)").not.toBeNull()
      console.log("✅ Aba B do client montada — 2 sockets > limite 1: o mais antigo (A) deve cair")

      // ── CLIENT=1: a 2ª aba derruba a 1ª (socket A) — o default global ──
      const closedA = await waitForWsClose(activeA!, 10000, "aba A do client (mais antiga)")
      expect(closedA, "socket da aba A do client deve fechar — limite CLIENT é 1").toBe(true)
      console.log(`✅ Socket da aba A do client fechado (session_limit) — ${wsA.length} ws`)

      // ── Socket B (mais recente) deve PERMANECER vivo ─────────────────
      expect(activeB!.isClosed(), "socket da aba B do client deve permanecer aberto").toBe(false)
      console.log("✅ Socket da aba B do client permanece aberto (o mais recente vence)")

      await pageB.close()
    } finally {
      await clientCtx.close()
    }
  })
})
