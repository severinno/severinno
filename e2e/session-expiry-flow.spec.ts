import { createHmac } from "node:crypto"
import { test, expect } from "@playwright/test"
import { readEnv } from "./realtime-emit"

// =========================================================================
// Fluxo de Expiração da Sessão — E2E (Browser)
//
// Cenários: valida o fluxo completo de expiração/renovação da sessão do
// ponto de vista do browser, cobrindo os 3 contratos do delta
// SSR-SESSION-EXPIRY + o botão "Renovar" do aviso de sessão:
//
//   1. LOGIN REAL → /api/auth/me retorna expiresAt: o provider faz login via
//      API (cookie salvo no context) e o GET /api/auth/me devolve o expiry
//      EFETIVO do cookie (TTL do app numa sessão fresca — unix seconds). É
//      esse valor que alimenta o countdown "sua sessão expira em X dias".
//
//   2. PILL NO DROPDOWN: com o dashboard aberto, o dropdown do usuário
//      (`button[aria-label="Menu da conta"]`) mostra a pill informativa
//      `[data-testid="session-expiry-info"]` com o countdown — o paint inicial
//      vem do SSR (getSessionExpiresAt), sem flash antes do fetchMe resolver.
//
//   3. RENOVAR REEMITE O COOKIE (janela de rotação simulada): o spec FORJA
//      um cookie de sessão com TTL curto = TTL/4 do app (com o default 30d,
//      7.5d — sempre DENTRO da janela de rotação < TTL/2), assinado com o
//      MESMO HMAC do app (SESSION_SECRET — o app aceita e o getSession trata
//      remaining < ROTATION_THRESHOLD → reemite). O GET /api/auth/me (o MESMO
//      request que o botão "Renovar" dispara via renewSession) então:
//        - devolve expiresAt RENOVADO (≈ TTL fresco — saltou de TTL/4);
//        - emite Set-Cookie com o novo severinno_session (reemissão FÍSICA);
//        - e o dashboard reflete o novo countdown na pill.
//
// POR QUE forjar o cookie em vez de esperar o TTL: o mesmo padrão do
// realtime-renew-sweep.spec.ts — a rotação real só dispara quando remaining
// < metade do TTL. Um cookie real de TTL completo nunca entraria na janela
// durante a execução do spec; o cookie forjado entra determinísticamente e
// percorre o CAMINHO REAL do app (getSession → reissueSession → Set-Cookie).
//
// ISOLAMENTO COMPLETO: provider REGISTRADO via API no beforeAll (email único
// por run — mesmo padrão do realtime-role-limit.spec.ts). describe.serial
// porque os dois testes usam o MESMO provider e cada um fecha o próprio
// context no finally (nenhum socket realtime vaza de um teste para o outro).
//
// POR QUE NÃO CLICAR o botão "Renovar" da UI: o banner com o botão só
// renderiza com days ≤ 7 — estruturalmente INALCANÇÁVEL com a rotação ativa
// (qualquer /api/auth/me reemite o cookie em <15d, devolvendo ~30d; o SSR
// espelha a rotação no mesmo valor). O spec valida o MESMO request que o
// botão dispara (renewSession → GET /api/auth/me) e a reemissão FÍSICA via
// Set-Cookie — a validação do código do botão, no nível em que é testável
// sem reconfigurar o TTL do app.
//
// ⚠️ REQUISITO DE CONFIG: SESSION_SECRET precisa estar no env/.env.local do
// app E acessível ao spec via readEnv (o HMAC do cookie forjado tem que casar
// com o do servidor). Sem ele, o app rejeita o cookie forjado e o teste 2
// falha com mensagem clara. O TTL do cookie NÃO precisa ser o default — o
// helper cookieMaxAgeSeconds() lê SESSION_COOKIE_MAX_AGE_SECONDS e deriva as
// asserções de forma robusta (mesmo guard do app).
// =========================================================================

const PASSWORD = "provider123"
/** Default do TTL do cookie do app (30d) — fallback quando a env
 *  SESSION_COOKIE_MAX_AGE_SECONDS não está definida. */
const MAX_AGE_DEFAULT_S = 60 * 60 * 24 * 30
/** Fração do TTL usada no cookie forjado do teste 2: TTL/4 garante remaining
 *  < TTL/2 (janela de rotação) para QUALQUER TTL do app (com o default 30d,
 *  forja 7.5d). Se fosse fixo em 2d, um TTL de app < 4d (ex.: clamp 60s)
 *  deixaria 2d FORA da janela → sem reemissão → assert falharia pelo motivo
 *  errado (gap do reviewer). */
const FORGED_TTL_FRACTION = 1 / 4
const SESSION_COOKIE_NAME = "severinno_session"

let SESSION_SECRET = ""
let PROVIDER_EMAIL = ""
let PROVIDER_ID = ""

// =========================================================================
// Helpers
// =========================================================================

/** Assina um cookie de sessão com o MESMO HMAC do app (src/lib/auth.ts):
 *  `${userId}.${role}.${expiresAt}.${signatureHex}`. */
function signSessionCookie(userId: string, role: string, expiresAtSec: number): string {
  const payload = `${userId}.${role}.${expiresAtSec}`
  const signature = createHmac("sha256", SESSION_SECRET).update(payload).digest("hex")
  return `${payload}.${signature}`
}

/** TTL EFETIVO do cookie do app (segundos) — espelha o guard do
 *  src/lib/auth.ts (resolveCookieMaxAgeSeconds): env SESSION_COOKIE_MAX_AGE_SECONDS
 *  com clamp mínimo 60s, fallback default 30d. As asserções de "expiresAt
 *  renovado ≈ TTL fresco" derivam DAQUI, então o spec é robusto a qualquer
 *  config (não exige o default 30d como o realtime-renew-sweep). */
function cookieMaxAgeSeconds(): number {
  const n = Number(readEnv("SESSION_COOKIE_MAX_AGE_SECONDS"))
  if (!Number.isFinite(n) || n === 0) return MAX_AGE_DEFAULT_S
  return Math.max(60, n)
}

/** Login via API — o Set-Cookie do response é salvo automaticamente no
 *  context (page.request compartilha o cookie jar com o browser). Timeout
 *  explícito: se o app aceitar TCP mas nunca responder, o request não
 *  pendura até o cap do teste (hardening do reviewer). */
async function loginViaApi(page: import("@playwright/test").Page, email: string, password: string) {
  const res = await page.request.post("/api/auth/login", {
    data: { email, password },
    timeout: 15_000,
  })
  expect(res.ok(), `login via API falhou (HTTP ${res.status()})`).toBeTruthy()
}

/** Marca o onboarding do provider como concluído via API (server-side). Um
 *  provider REGISTRADO via API cai no wizard "Complete seu perfil" ao abrir
 *  o /dashboard — e o shell (com o dropdown do usuário e a pill) só renderiza
 *  com o onboarding done. Mesmo helper do realtime-role-limit.spec.ts. */
async function skipOnboarding(page: import("@playwright/test").Page) {
  const ok = await page.evaluate(async () => {
    const res = await fetch("/api/provider/onboarding", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ step: 4, done: true }),
    })
    return res.ok
  })
  if (!ok) console.log(`❌ skipOnboarding falhou (fetch do browser)`)
  expect(ok, "skipOnboarding deve responder ok (PATCH /api/provider/onboarding)").toBeTruthy()
}

/** Registra um provider ISOLADO via API (email único por run). */
async function registerProvider(
  request: import("@playwright/test").APIRequestContext,
  prefix: string,
): Promise<{ email: string; id: string }> {
  const email = `${prefix}-${Date.now()}@severinno.com`
  const res = await request.post("/api/auth/register", {
    data: {
      name: `${prefix} Provider E2E`,
      email,
      password: PASSWORD,
      confirmPassword: PASSWORD,
      role: "PROVIDER",
      cpfCnpj: "123.456.789-00",
      whatsapp: "11999999999",
      city: "São Paulo",
      state: "SP",
      bio: `Provider isolado do spec de expiração de sessão (${prefix})`,
      radiusKm: 10,
    },
  })
  expect(res.ok(), `register do provider ${prefix} falhou (HTTP ${res.status()})`).toBeTruthy()
  const body = (await res.json()) as { user?: { id?: string } }
  const id = body.user?.id ?? ""
  expect(id, `provider ${prefix} não retornou id no register`).toBeTruthy()
  console.log(`✅ Provider ${prefix} registrado: ${id} (${email})`)
  return { email, id }
}

/** Abre o dashboard, abre o dropdown do usuário e devolve a pill do countdown
 *  (`[data-testid="session-expiry-info"]`) — pronta para asserts. Timeout
 *  explícito de navegação (30s) para falhar rápido em vez de esperar o cap.
 *
 * FLOW: aterrissa no "/" → pula o onboarding (provider recém-registrado via
 *  API SEMPRE cai no wizard — sem isso o shell/dropdown/pill nunca renderizam
 *  e o teste pendura até o cap; fix da rodada 5) → navega o /dashboard → abre
 *  o dropdown → devolve a pill. */
async function openUserDropdown(page: import("@playwright/test").Page) {
  await page.goto("/", { timeout: 30_000 })
  await skipOnboarding(page)
  await page.goto("/dashboard", { timeout: 30_000 })
  await expect(page.locator('button[aria-label="Menu da conta"]')).toBeVisible({
    timeout: 15_000,
  })
  await page.locator('button[aria-label="Menu da conta"]').click()
  const pill = page.locator('[data-testid="session-expiry-info"]')
  await expect(pill).toBeVisible({ timeout: 5_000 })
  return pill
}

// =========================================================================
// Testes (serial: mesmo provider; cada teste fecha o próprio context)
// =========================================================================

test.describe.serial("Fluxo de expiração da sessão — /api/auth/me + pill + Renovar", () => {
  // Fluxo com múltiplas navegações (goto "/" + skipOnboarding + goto
  // "/dashboard" + dropdown): a SOMA dos timeouts bounded por passo pode
  // chegar a ~145s num dev server frio — acima do cap default de 120s.
  // 180s (padrão do realtime-role-limit.spec.ts, mesma classe de fluxo)
  // faz falhas de passo específico aparecerem em vez do cap enganoso
  // "test timeout of 120000ms exceeded".
  test.setTimeout(180_000)

  test.beforeAll(async ({ request }) => {
    SESSION_SECRET = readEnv("SESSION_SECRET") ?? ""
    expect(SESSION_SECRET, "SESSION_SECRET não encontrado (env ou .env.local)").toBeTruthy()
    const provider = await registerProvider(request, "expiry-flow")
    PROVIDER_EMAIL = provider.email
    PROVIDER_ID = provider.id
  })

  test("login real → /api/auth/me retorna expiresAt → pill no dropdown", async ({ browser }) => {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    try {
      // ── 1. Login REAL via API (cookie de sessão salvo no context) ─────
      await loginViaApi(page, PROVIDER_EMAIL, PASSWORD)
      console.log("✅ Login via API — cookie de sessão salvo no context")

      // ── 2. GET /api/auth/me devolve o expiresAt EFETIVO do cookie ────
      // (timeout explícito — falha rápido em vez de pendurar até o cap)
      const meRes = await page.request.get("/api/auth/me", { timeout: 15_000 })
      expect(meRes.ok(), `GET /api/auth/me falhou (HTTP ${meRes.status()})`).toBeTruthy()
      const me = (await meRes.json()) as { user?: { id?: string }; expiresAt?: number | null }
      expect(me.user?.id, "/api/auth/me deve devolver o provider logado").toBe(PROVIDER_ID)
      expect(me.expiresAt, "/api/auth/me deve devolver expiresAt (unix seconds)").toBeTruthy()
      const nowSec = Math.floor(Date.now() / 1000)
      const maxAge = cookieMaxAgeSeconds()
      expect(
        me.expiresAt!,
        `expiresAt deve ser ~ TTL fresco (${maxAge / 86_400}d) numa sessão fresca — recebido: ${me.expiresAt ?? "null"}`,
      ).toBeGreaterThan(nowSec + maxAge - 3600)
      console.log(
        `✅ /api/auth/me expiresAt=${me.expiresAt} (agora+${(me.expiresAt ?? 0) - nowSec}s, TTL=${maxAge / 86_400}d)`,
      )

      // ── 3. Pill no dropdown do usuário (countdown da sessão) ──────────
      const pill = await openUserDropdown(page)
      // Dias esperados DERIVADOS do TTL do app (ceil do daysLeft, mesmo cálculo
      // do componente) — não hardcoded em 30d: com env SESSION_COOKIE_MAX_AGE_SECONDS
      // diferente, a pill mostra o valor certo e o assert acompanha (gap do
      // reviewer rodada 2). TTL < 24h → 1 ("1 dia" singular).
      const expectedDays = Math.max(1, Math.ceil(maxAge / 86_400))
      await expect(pill).toContainText(/Sessão expira em/)
      const pillText = (await pill.textContent())?.trim() ?? ""
      expect(
        pillText,
        `pill deve mostrar ${expectedDays} dia(s) — TTL=${maxAge / 86_400}d; recebido: "${pillText}"`,
      ).toContain(String(expectedDays))
      console.log(`✅ Pill do dropdown: "${pillText}"`)

      // ── Janela 8–15d: sessão FRESCA (>15d) NÃO oferece o botão na pill ──
      // (o servidor ainda não reemite fora da janela de rotação — renovar
      // seria no-op). O caso POSITIVO (botão a 8-15d) é coberto pelos unit
      // tests do SessionExpiryInfo (mock direto do sessionExpiresAt), pois no
      // browser o SSR espelha a rotação (getSessionExpiresAt) e o fetchMe
      // reemite — qualquer sessão <15d aparece como ~TTL fresco na UI.
      await expect(pill.getByRole("button", { name: /Renovar/ })).toHaveCount(0)
    } finally {
      await ctx.close()
    }
  })

  test("Renovar reemite o cookie no <15d simulado (renewSession → /api/auth/me)", async ({
    browser,
  }) => {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    try {
      // ── Sessão válida: login real primeiro ────────────────────────────
      await loginViaApi(page, PROVIDER_EMAIL, PASSWORD)

      // ── Forja cookie com TTL curto = TTL/4 (sempre na janela < TTL/2) ─
      const maxAge = cookieMaxAgeSeconds()
      const forgedTtlSec = Math.max(60, Math.floor(maxAge * FORGED_TTL_FRACTION))
      const forgedExpiresAt = Math.floor(Date.now() / 1000) + forgedTtlSec
      const forged = signSessionCookie(PROVIDER_ID, "PROVIDER", forgedExpiresAt)
      await ctx.addCookies([
        { name: SESSION_COOKIE_NAME, value: forged, url: "http://localhost:3000" },
      ])
      // Sanidade: o cookie forjado REALMENTE substituiu o real no context
      // (hardening do reviewer — se o addCookies não substituiu, o request
      // abaixo mandaria o cookie fresco e o assert de reemissão passaria
      // pelo MOTIVO ERRADO; aqui o erro aponta a causa exata).
      const ctxCookies = await ctx.cookies()
      const session = ctxCookies.find((c) => c.name === SESSION_COOKIE_NAME)
      expect(
        session?.value,
        "o cookie forjado deve substituir o real no context (check ctx.cookies())",
      ).toBe(forged)
      // Guard do cenário: o TTL forjado TEM que cair na janela < TTL/2 do app
      // (sem isso — config de TTL minúscula + clamp de 60s — o request abaixo
      // não reemitiria e o assert de expiresAt passaria pelo MOTIVO ERRADO;
      // este expect falha rápido apontando a config, gap do reviewer).
      expect(
        forgedTtlSec,
        `cookie forjado (${forgedTtlSec / 86_400}d) precisa cair na janela < TTL/2 (${maxAge / 86_400 / 2}d) — confira SESSION_COOKIE_MAX_AGE_SECONDS`,
      ).toBeLessThan(maxAge / 2)
      console.log(`✅ Cookie forjado com TTL de ${forgedTtlSec / 86_400}d no context`)

      // ── O MESMO request que o botão "Renovar" dispara ─────────────────
      // (renewSession → GET /api/auth/me): remaining < TTL/2 → o getSession
      // REEMITE o cookie e devolve o novo expiresAt (TTL fresco). Timeout
      // explícito — falha rápido em vez de pendurar até o cap do teste.
      const meRes = await page.request.get("/api/auth/me", { timeout: 15_000 })
      expect(meRes.ok(), `GET /api/auth/me falhou (HTTP ${meRes.status()})`).toBeTruthy()
      const me = (await meRes.json()) as { expiresAt?: number | null }
      const nowSec = Math.floor(Date.now() / 1000)
      expect(me.expiresAt, "/api/auth/me deve devolver o expiresAt renovado").toBeTruthy()
      expect(
        me.expiresAt!,
        `expiresAt deve ser REEMITIDO (~TTL fresco ${maxAge / 86_400}d) — remaining forjado era ${forgedTtlSec / 86_400}d; recebido: ${me.expiresAt ?? "null"}`,
      ).toBeGreaterThan(nowSec + maxAge - 3600)
      console.log(
        `✅ /api/auth/me reemitiu o cookie: expiresAt=${me.expiresAt} ` +
          `(era ${forgedExpiresAt} — agora+${(me.expiresAt ?? 0) - nowSec}s)`,
      )

      // ── Reemissão FÍSICA: Set-Cookie com o novo severinno_session ─────
      // headersArray() em vez de headers()["set-cookie"] — o Playwright
      // merge duplicatas em headers() e o set-cookie é a API mais robusta.
      const setCookies = meRes
        .headersArray()
        .filter((h) => h.name.toLowerCase() === "set-cookie")
        .map((h) => h.value)
      expect(
        setCookies.some((v) => v.includes(`${SESSION_COOKIE_NAME}=`)),
        "o /api/auth/me deve reemitir o cookie (Set-Cookie)",
      ).toBe(true)
      console.log("✅ Set-Cookie do /api/auth/me contém o novo severinno_session")

      // ── UI: dashboard com a sessão renovada → pill com o novo countdown ─
      const pill = await openUserDropdown(page)
      const expectedDays = Math.max(1, Math.ceil(maxAge / 86_400))
      await expect(pill).toContainText(/Sessão expira em/)
      const pillText = (await pill.textContent())?.trim() ?? ""
      expect(
        pillText,
        `pill deve mostrar ${expectedDays} dia(s) após renovar — TTL=${maxAge / 86_400}d; recebido: "${pillText}"`,
      ).toContain(String(expectedDays))
      console.log(`✅ Pill reflete o countdown renovado: "${pillText}"`)
      // Pós-renovação a sessão voltou ao TTL fresco (>15d) → sem botão na pill.
      await expect(pill.getByRole("button", { name: /Renovar/ })).toHaveCount(0)
    } finally {
      await ctx.close()
    }
  })
})
