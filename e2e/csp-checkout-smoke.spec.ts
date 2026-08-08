import { test, expect, type Page } from "@playwright/test"
import { waitForVitrine } from "./helpers"
import { setupApiMocks } from "./mocks"

// =============================================================================
// CSP Checkout Smoke Test — Lytex payment flow under the strict CSP
// =============================================================================
// Goal: navigate the Lytex checkout flow in a real browser and confirm the
// strict Content-Security-Policy does NOT block any script/iframe the flow
// needs. The deployed CSP is static (see next.config.ts design notes):
//   script-src 'self' 'unsafe-inline'   ← RSC flight payload is inline on
//                                         every page; nonce would kill ISR
//   frame-src 'none'                    ← strict: no iframes at all
// The Lytex integration is server-side (Node fetch → api.lytex.com.br), so
// the checkout UI must need ZERO external scripts and ZERO iframes.
//
// Authoritative "nothing blocked" proof: CSP violation reports POSTed to
// /api/csp-report (browsers send them when a directive blocks) + console
// violations. Blocked requests never reach the network, so the `external`
// tracker can only prove "no allowed external loads were attempted".
//
// Run (server on :3101 from a production build):
//   BASE_URL=http://localhost:3101 npx playwright test e2e/csp-checkout-smoke.spec.ts --project=chromium --reporter=line
// =============================================================================

// Catches Chrome's CSP block messages, including eval blocks
// ("Refused to evaluate a string as JavaScript ...") which the /load|execute/
// alternation alone would miss.
const CSP_ERROR_RE =
  /Content-Security-Policy|Refused to (load|execute|evaluate|connect|frame|run)|violates the following/i

/** Collect browser console errors + page errors that mention CSP. */
function collectCspViolations(page: Page): string[] {
  const violations: string[] = []
  page.on("console", (msg) => {
    if (CSP_ERROR_RE.test(msg.text())) {
      violations.push(`[console:${msg.type()}] ${msg.text()}`)
    }
  })
  page.on("pageerror", (err) => {
    const text = String(err)
    if (CSP_ERROR_RE.test(text)) violations.push(`[pageerror] ${text}`)
  })
  return violations
}

/** Collect ALL console messages (any type) for diagnosis. */
function collectAllConsole(page: Page): string[] {
  const msgs: string[] = []
  page.on("console", (msg) => {
    msgs.push(`[${msg.type()}] ${msg.text()}`)
  })
  return msgs
}

/**
 * Track requests that would be governed by CSP (scripts, styles, fonts,
 * frames, objects) to NON-self origins, plus any POST to /api/csp-report
 * (report-to csp-endpoint / legacy report-uri — browsers hit it exactly
 * when a directive blocks).
 *
 * Note: blocked requests are never issued, so `external` only proves "no
 * allowed external loads were attempted". The authoritative proof of "nothing
 * blocked" is the csp-reports + console violations.
 */
function trackCspRelevantRequests(page: Page, base: string) {
  const external: string[] = []
  const cspReports: string[] = []
  const selfOrigin = new URL(base).origin
  page.on("request", (req) => {
    if (req.url().includes("/api/csp-report")) {
      const body = req.postData() ?? ""
      cspReports.push(`${req.method()} ${req.url()} body=${body.slice(0, 1500)}`)
    }
    const type = req.resourceType()
    // iframe subframe documents report as resourceType "document" in
    // Playwright, so iframes are covered by the iframe-count assertion +
    // report tracking, not by this list.
    if (["script", "stylesheet", "font", "object"].includes(type)) {
      try {
        if (new URL(req.url()).origin !== selfOrigin) {
          external.push(`${type}: ${req.url()}`)
        }
      } catch {
        // ignore non-URL requests
      }
    }
  })
  return { external, cspReports }
}

/**
 * Open the booking modal by clicking the first "Agendar" button.
 *
 * HARD: the modal must actually open — otherwise the smoke test proves
 * nothing about the checkout flow. The modal title "Agendar serviço" is
 * present in BOTH the Dialog and Sheet variants (see booking-modal.tsx).
 *
 * Hydration timing (prod build): the button becomes visible in the DOM
 * seconds BEFORE React finishes attaching its delegated onClick listeners,
 * so a click right after visibility is silently dropped and no modal opens.
 * Give hydration a beat, then retry the click (up to 3 attempts) — the
 * retry always lands post-hydration.
 */
async function openBookingModal(page: Page) {
  const agendar = page.locator('button:has-text("Agendar")').first()
  const title = page.getByText("Agendar serviço", { exact: false }).first()
  await expect(agendar).toBeVisible({ timeout: 20000 })
  // Let hydration finish wiring event handlers before the first attempt.
  await page.waitForTimeout(1500)
  for (let attempt = 1; attempt <= 3; attempt++) {
    // If the modal is already open (title found), don't click again — a
    // redundant click on the Radix overlay would burn the actionability wait.
    if (await title.isVisible().catch(() => false)) return
    await agendar.click({ timeout: 5000 }).catch(() => {})
    try {
      await expect(title).toBeVisible({ timeout: 8000 })
      return
    } catch {
      // click was probably lost during hydration — retry
    }
  }
  throw new Error("booking modal did not open after 3 click attempts")
}

/**
 * Step 1 — pick an available date + time slot.
 *
 * Two hard-won facts encoded here:
 * 1. react-day-picker v9 puts role="gridcell" on the <td>, NOT the day <button>
 *    (see CalendarDayButton in ui/calendar.tsx — the button has data-day). The
 *    old 'button[role="gridcell"]' selector matched nothing → step 1 could
 *    never complete. Scope to the visible dialog to avoid grabbing day cells
 *    from another mounted modal (modals-host mounts BookingModal + QuoteModal
 *    together).
 * 2. The mock provider's availability is Mon–Fri only. On a weekend run the
 *    FIRST enabled day has no slots, so loop over the next few enabled days
 *    until a day with time slots is found (removes the weekday dependency).
 * 3. The modal's sticky footer can intercept the day click — scroll the day
 *    to the center of its scroll container before clicking.
 */
async function selectSchedule(page: Page) {
  const dialog = page.locator("[role='dialog']:visible").first()
  const days = dialog.locator('button[data-day]:not([disabled])')
  const dayCount = await days.count().catch(() => 0)
  for (let i = 0; i < Math.min(dayCount, 7); i++) {
    const day = days.nth(i)
    await day
      .evaluate((el) => el.scrollIntoView({ block: "center" }))
      .catch(() => {})
    await day.click({ timeout: 4000 }).catch(() => {})
    // NOTE: slot labels go through formatHHmm() → "08h00" (not "08:00"), so
    // the regex must match the 'h' separator (see src/lib/format.ts).
    const slot = dialog
      .getByRole("button")
      .filter({ hasText: /^\d{2}h\d{2}$/ })
      .first()
    const slotVisible = await slot.isVisible({ timeout: 2500 }).catch(() => false)
    if (slotVisible) {
      await slot.click()
      await page.waitForTimeout(300)
      return
    }
  }
}

/**
 * Click "Continuar" if present. click() auto-waits for the enabled state,
 * bounded by a 4s timeout so a step-1 selection race can't hang the whole
 * test — a silent bail keeps the flow moving.
 */
async function clickContinue(page: Page) {
  const btn = page.locator('button:has-text("Continuar")').first()
  if (await btn.isVisible({ timeout: 1000 }).catch(() => false)) {
    await btn.click({ timeout: 4000 }).catch(() => {})
    await page.waitForTimeout(600)
  }
}

/**
 * Fill the step-2 address form so "Continuar" un-disables.
 * validSteps[2] requires CEP (8 digits) + street + number + city + state
 * (see booking-modal.tsx). The mocked /api/geo/cep auto-fills street,
 * district, city and state; only the number field needs a manual value.
 */
async function fillAddress(page: Page) {
  // Scope to the VISIBLE dialog: modals-host keeps QuoteModal + BookingModal
  // mounted, and both use AddressForm — an unscoped .first() could hit the
  // hidden quote-modal's CEP field (invisible → silent bail → flow stuck on
  // the disabled Continuar, the exact failure this helper was meant to fix).
  const dialog = page.locator("[role='dialog']:visible").first()
  const cep = dialog.locator('input[id*="-cep"], input[placeholder*="00000"]').first()
  if (!(await cep.isVisible({ timeout: 2000 }).catch(() => false))) return
  await cep.fill("01310100")
  // wait for the mocked ViaCEP-style auto-fill (street/district/city/state)
  await page.waitForTimeout(1500)
  const street = dialog.locator('input[id*="-street"]').first()
  const autoFilled = await street
    .inputValue()
    .then((v) => v.length > 0)
    .catch(() => false)
  if (!autoFilled) {
    await street.fill("Av. Paulista")
  }
  const number = dialog.locator('input[placeholder="123"]').first()
  if (await number.isVisible().catch(() => false)) {
    await number.fill("1000")
  }
  await page.waitForTimeout(400)
}

test.describe("CSP — checkout Lytex", () => {
  // The PIX flow drives the whole booking modal (schedule → address →
  // payment → confirm) with generous hydration waits against a prod build,
  // so the default 30s test timeout is too tight.
  test.setTimeout(120_000)
  const BASE = process.env.BASE_URL || "http://localhost:3000"

  test("header CSP nas rotas do checkout: script-src 'self' + frame-src 'none'", async ({
    request,
  }) => {
    const res = await request.get(`${BASE}/`)
    expect(res.status()).toBe(200)
    const csp = res.headers()["content-security-policy"] ?? ""
    expect(csp).toContain("script-src 'self'")
    // Documented tradeoff: RSC flight payload is inline on every page
    expect(csp).toContain("'unsafe-inline'")
    expect(csp).toContain("frame-src 'none'")
    expect(csp).toContain("frame-ancestors 'none'")
    // CSP3 Reporting API: report-to + Reporting-Endpoints header is the
    // modern path; report-uri is the LEGACY fallback (browsers that support
    // both prefer report-to and ignore report-uri).
    expect(csp).toContain("report-to csp-endpoint")
    expect(csp).toContain("report-uri /api/csp-report")
    const reportingEndpoints =
      res.headers()["reporting-endpoints"] ?? ""
    expect(reportingEndpoints).toContain(
      'csp-endpoint="/api/csp-report"',
    )
  })

  test("fluxo PIX (modal de booking) sem violações CSP nem scripts/iframes externos", async ({
    page,
  }) => {
    await setupApiMocks(page, { authenticated: true })
    const violations = collectCspViolations(page)
    const consoleLog = collectAllConsole(page)
    const { external, cspReports } = trackCspRelevantRequests(page, BASE)

    await page.goto("/")
    await waitForVitrine(page)

    // ── Drive the checkout flow ────────────────────────────────────────────
    await openBookingModal(page)
    await selectSchedule(page)
    await clickContinue(page) // step 1 → 2 (address)
    await fillAddress(page) // step 2: address (un-disables Continuar)
    await clickContinue(page) // step 2 → 3 (payment)

    // Payment step: PIX is the DEFAULT paymentMethod (segmented control, not
    // radio inputs). HARD assertion here — step 3 is the CSP-critical zone
    // where the zod JIT used to fire `new Function` on the payment schema.
    // (Specific texts from the PIX payment block in booking-modal.tsx —
    // deliberately no bare "QR" which could false-match incidental text.)
    await expect(
      page
        .locator('text=/Pague com PIX|Chave PIX|Copiar chave PIX/i')
        .first(),
    ).toBeVisible({ timeout: 8000 })

    await clickContinue(page) // step 3 → 4 (review)
    // NOTE: match ONLY the enabled footer submit. The StepWizard header has
    // its own disabled "Confirmar" step-indicator button (shortLabel), and the
    // wizard renders a second submitLabel button — an unscoped has-text match
    // resolved a disabled button in an earlier run.
    const confirm = page
      .locator('button:has-text("Confirmar agendamento"):not([disabled])')
      .first()
    if (await confirm.isVisible().catch(() => false)) {
      await confirm.click()
      // handleSubmit success → toast + modal closes + navigate to client
      // panel; wait for the modal to actually close.
      // Scope to :visible — closed-but-mounted modals (modals-host) would
      // otherwise keep [role='dialog'] in the DOM and inflate the count.
      await expect(page.locator("[role='dialog']:visible")).toHaveCount(0, {
        timeout: 8000,
      }).catch(() => {})
    }

    // ── Assertions: the strict CSP must not have blocked anything ─────────
    const iframes = await page.locator("iframe").count()
    expect(iframes, `zero iframes (frame-src 'none') — found ${iframes}`).toBe(0)
    expect(external, `zero external script/style/font requests — ${JSON.stringify(external)}`).toHaveLength(0)
    expect(cspReports, `zero CSP violation reports POSTed — ${JSON.stringify(cspReports)}`).toHaveLength(0)
    expect(violations, `zero CSP console violations — ${JSON.stringify(violations)}`).toHaveLength(0)
  })

  test("zero iframes e zero scripts externos em toda a navegação (home → modal)", async ({
    page,
  }) => {
    await setupApiMocks(page, { authenticated: true })
    const violations = collectCspViolations(page)
    const { external } = trackCspRelevantRequests(page, BASE)

    await page.goto("/")
    await waitForVitrine(page)
    await openBookingModal(page)
    await page.waitForTimeout(1500)

    expect(await page.locator("iframe").count()).toBe(0)
    expect(external).toHaveLength(0)
    expect(violations).toHaveLength(0)
  })
})
