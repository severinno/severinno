import { test, expect, type Page } from "@playwright/test"
import { emitNotificationToRoom } from "./realtime-emit"

// =========================================================================
// Telemetria do Realtime — E2E (Admin + Realtime + Redis)
//
// Valida o fluxo COMPLETO da telemetria persistida (mini-services/realtime/
// redis-telemetry.ts → Redis → GET /api/admin/realtime/telemetry):
//
//   Cenário 1 — Emits > 0 na janela: o provider abre o dashboard (socket
//   conectado + join em user:{id}), o spec dispara um POST /emit
//   (notification:new) via bridge server→server e o admin autenticado lê a
//   rota /api/admin/realtime/telemetry até ver `emits["notification:new"]
//   >= 1` na janela. O realtime persiste os emitCounters em Redis a cada
//   REALTIME_TELEMETRY_INTERVAL_MS (default 30s) — o poll cobre o atraso.
//
//   Cenário 2 — Sinal multi no Redis: o provider abre o dashboard em DUAS
//   abas do mesmo context (2 sockets simultâneos, dentro do limite
//   PROVIDER=2) → o próximo persist grava o bucket `multi` com
//   usersWithMultipleSockets >= 1 e a flag `realtime:telemetry:multi:flag`
//   = "1" (TTL ≈ 2× intervalo). O admin vê `multi` + `flag` na mesma rota —
//   o sinal de socket órfão (sintoma do HMR leak) prova-se ponta a ponta.
//
// ISOLAMENTO COMPLETO: provider registrado via API no beforeAll com email
// único por run (conflito com NENHUM spec — os 6 providers do seed já
// pertencem a outros specs de realtime e, com o limite PROVIDER=2, um spec
// no MESMO provider derrubaria os sockets deles via session_limit).
//
// REQUISITOS DE CONFIG:
//   - Realtime 3003 no ar com REDIS_URL (a telemetria persiste em Redis —
//     sem Redis a rota responde { ok: false, available: false }).
//   - Limite por role ativo: REALTIME_MAX_SESSIONS_PER_ROLE='{"CLIENT":1,
//     "PROVIDER":2,"ADMIN":5}' (o mesmo do admin-session-conflict.spec.ts) —
//     com 2 abas o socket antigo NÃO é derrubado e o sinal multi aparece.
//   - REALTIME_EMIT_TOKEN no .env.local (lido via e2e/realtime-emit.ts).
//
// FLAKINESS (fullyParallel): a rota agrega a janela de minutos; outros specs
// podem emitir notification:new em paralelo — por isso o C1 assere `>= 1`
// (nunca igualdade exata) e o C2 usa o sinal multi por USER, imune aos
// demais (usersWithMultipleSockets conta usuários com >1 socket).
//
// Run:  bunx playwright test e2e/admin-realtime-telemetry.spec.ts --project=chromium
// =========================================================================

const ADMIN_EMAIL = "admin@severinno.com"
const ADMIN_PASSWORD = "admin123"

// Provider isolado: email único por run (registrado no beforeAll).
let PROVIDER_EMAIL = ""
const PROVIDER_PASSWORD = "provider123"
let PROVIDER_ID = ""

// Janela de leitura da rota admin (minutos) — folgada para o poll cobrir o
// atraso do persist (default 30s) e eventuais viradas de minuto.
const TELEMETRY_WINDOW_MINUTES = 60

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
 * Abre UMA ABA ADICIONAL do dashboard no MESMO context (mesmo cookie → mesmo
 * userId → novo socket no realtime — dentro do limite PROVIDER=2 coexistem).
 */
async function openDashboardTab(page: Page) {
  await page.goto("/dashboard")
  await page.waitForTimeout(3000)
  await expect(page.locator('[aria-label="Notifications alt+T"]')).toBeAttached({
    timeout: 5000,
  })
}

/** Forma da resposta da rota admin (os campos que o spec usa). */
interface TelemetryResponse {
  ok: boolean
  available: boolean
  minutes: number
  emits: Record<string, number>
  multi: Array<{
    bucket: number
    ts: number
    total: number
    usersWithMultipleSockets: number
    maxSocketsPerUser: number
  }>
  flag: boolean
}

/**
 * Lê a telemetria via rota ADMIN (cookie do adminPage). A rota requer
 * role ADMIN — o adminPage precisa estar logado (login() no test).
 */
async function readTelemetry(adminPage: Page, minutes = TELEMETRY_WINDOW_MINUTES) {
  const res = await adminPage.request.get(`/api/admin/realtime/telemetry?minutes=${minutes}`)
  expect(res.ok(), `GET /api/admin/realtime/telemetry HTTP ${res.status()}`).toBeTruthy()
  const body = (await res.json()) as TelemetryResponse
  expect(body.ok, `telemetria deve responder ok:true (available=${body.available})`).toBe(true)
  expect(body.available, "telemetria indisponível — o realtime precisa de REDIS_URL").toBe(true)
  return body
}

/**
 * Poll da telemetria até o predicado valer (o persist do realtime é
 * intervalado — default 30s — e o poll cobre o atraso sem flake de virada
 * de minuto). Diagnóstico no timeout com o último snapshot lido.
 */
async function pollTelemetryUntil(
  adminPage: Page,
  label: string,
  predicate: (t: TelemetryResponse) => boolean,
  timeoutMs = 150_000,
  stepMs = 3_000,
): Promise<TelemetryResponse> {
  const deadline = Date.now() + timeoutMs
  let last: TelemetryResponse | null = null
  while (Date.now() < deadline) {
    last = await readTelemetry(adminPage)
    if (predicate(last)) return last
    await new Promise((r) => setTimeout(r, stepMs))
  }
  const summary = last
    ? `emits=${JSON.stringify(last.emits)} multi=${last.multi
        .map((m) => m.usersWithMultipleSockets)
        .join(",")} flag=${last.flag}`
    : "sem resposta"
  throw new Error(`⏱️ timeout aguardando ${label} — último snapshot: ${summary}`)
}

// =========================================================================
// Testes (serial: C1 e C2 usam o mesmo provider isolado)
// =========================================================================

test.describe.serial("Telemetria do Realtime — Admin (GET /api/admin/realtime/telemetry)", () => {
  // Polls longos (persist default 30s + 2 abas + login admin): sob
  // fullyParallel o dev server compila sob carga e o global de 120s estoura
  // (padrão do realtime-ttl-sweep.spec.ts).
  test.setTimeout(180_000)

  test.beforeAll(async ({ request }) => {
    // ── Provider ISOLADO: registrado via API com email único por run ──
    PROVIDER_EMAIL = `telemetria-${Date.now()}@severinno.com`
    const registerRes = await request.post("/api/auth/register", {
      data: {
        name: "Telemetria E2E",
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
        bio: "Provider isolado criado pelo spec de telemetria do realtime",
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

  test("C1 — emit disparado → emits > 0 na janela da telemetria", async ({ browser }) => {
    const adminCtx = await browser.newContext()
    const adminPage = await adminCtx.newPage()
    await login(adminPage, ADMIN_EMAIL, ADMIN_PASSWORD)

    const providerCtx = await browser.newContext()
    const providerPage = await providerCtx.newPage()

    try {
      // ── Provider: dashboard aberto → socket real conectado + join ───
      await openProviderDashboard(providerPage, PROVIDER_EMAIL, PROVIDER_PASSWORD)
      console.log(`✅ Provider com dashboard aberto (socket joined em user:${PROVIDER_ID})`)

      // ── Emit via bridge server→server (Bearer REALTIME_EMIT_TOKEN) ──
      const emitted = await emitNotificationToRoom(PROVIDER_ID)
      expect(emitted, "POST /emit deve responder ok (Bearer válido)").toBe(true)
      console.log("✅ POST /emit notification:new disparado")

      // ── Admin autenticado lê a telemetria até o emit aparecer ────────
      //    (o realtime persiste os emitCounters em Redis a cada intervalo;
      //    o poll espera o primeiro ciclo pós-emit sem flake de minuto).
      const snap = await pollTelemetryUntil(
        adminPage,
        "emits['notification:new'] >= 1 na janela",
        (t) => (t.emits["notification:new"] ?? 0) >= 1,
      )
      const total = Object.values(snap.emits).reduce((a, b) => a + b, 0)
      expect(total, "total de emits na janela deve ser > 0").toBeGreaterThan(0)
      expect(
        snap.emits["notification:new"],
        "notification:new deve contar >= 1",
      ).toBeGreaterThanOrEqual(1)
      console.log(
        `✅ Telemetria: emits[notification:new]=${snap.emits["notification:new"]} total=${total}`,
      )
    } finally {
      await providerCtx.close()
      await adminCtx.close()
    }
  })

  test("C2 — 2 sockets do mesmo provider → sinal multi + flag no Redis", async ({ browser }) => {
    const adminCtx = await browser.newContext()
    const adminPage = await adminCtx.newPage()
    await login(adminPage, ADMIN_EMAIL, ADMIN_PASSWORD)

    const providerCtx = await browser.newContext()
    const pageA = await providerCtx.newPage()

    try {
      // ── Aba A: dashboard → socket A dá join em user:{providerId} ─────
      await openProviderDashboard(pageA, PROVIDER_EMAIL, PROVIDER_PASSWORD)
      console.log(`✅ Aba A com dashboard aberto (socket A em user:${PROVIDER_ID})`)

      // ── Aba B (mesmo context): socket B → 2 sockets dentro do limite
      //    PROVIDER=2 → coexistem (o antigo NÃO é derrubado) ────────────
      const pageB = await providerCtx.newPage()
      await openDashboardTab(pageB)
      console.log("✅ Aba B montada — 2 sockets simultâneos (limite PROVIDER=2)")

      // ── Admin lê a telemetria até o sinal MULTI aparecer: o bucket do
      //    minuto registra usersWithMultipleSockets >= 1 (GET+compare+SET
      //    mantém o MÁXIMO do minuto) e a flag = "1" (TTL ≈ 2× intervalo).
      const snap = await pollTelemetryUntil(
        adminPage,
        "sinal multi (usersWithMultipleSockets >= 1) + flag ativa",
        (t) => t.multi.some((m) => m.usersWithMultipleSockets >= 1) && t.flag,
      )
      const multiEntry = snap.multi.find((m) => m.usersWithMultipleSockets >= 1)
      expect(
        multiEntry,
        "deve existir bucket multi com usersWithMultipleSockets >= 1",
      ).toBeDefined()
      expect(snap.flag, 'flag realtime:telemetry:multi:flag deve estar ativa ("1")').toBe(true)
      console.log(
        `✅ Sinal multi: usersWithMultipleSockets=${multiEntry!.usersWithMultipleSockets} ` +
          `maxSocketsPerUser=${multiEntry!.maxSocketsPerUser} flag=${snap.flag}`,
      )

      await pageB.close()
    } finally {
      await providerCtx.close()
      await adminCtx.close()
    }
  })
})
