import { type Page } from "@playwright/test"

/**
 * Wait for the vitrine (app shell) to be fully loaded and hydrated.
 *
 * The app renders a "Carregando Severinno…" shell during SSR/hydration.
 * Waiting for the text to *disappear* is racy (if this runs before the text
 * is even in the DOM it resolves immediately with an empty page). Instead we:
 * 1. wait for the topbar's auth button ("Entrar"/"Cadastrar") or the avatar
 *    (post-hydration markers — only React renders them), and
 * 2. give the providers fetch a moment to land.
 *
 * Dev mode is slower than production, so timeout is generous.
 */
export async function waitForVitrine(page: Page) {
  // Post-hydration markers: the topbar shows auth buttons when logged out or
  // the user avatar when logged in. Either one means React has hydrated.
  await page
    .locator(
      "header button:has-text(/entrar|login|cadastrar/i), " +
        "button:has-text(/entrar|login|cadastrar/i), " +
        'header button[aria-haspopup="menu"]',
    )
    .first()
    .waitFor({ state: "visible", timeout: 30_000 })
    .catch(() => {})
  // The provider cards ("Agendar" buttons) are rendered by a lazily-loaded
  // section and can take several seconds to appear on the dev server, even
  // after the topbar hydrates. Wait for them on landing pages; on other
  // pages this resolves via the fallback selector below.
  await page
    .locator('button:has-text("Agendar"), [data-testid="provider-card"], [class*="provider-card"]')
    .first()
    .waitFor({ state: "visible", timeout: 30_000 })
    .catch(() => {})
}

/**
 * Fill in the CEP field in the address form (Step 2 - Details).
 * Uses a real CEP to trigger the auto-fill behavior.
 */
export async function fillCEP(page: Page, cep: string) {
  const cepInput = page.locator('input[placeholder*="CEP"], input[name*="cep"]').first()
  await cepInput.fill(cep)
  // Wait for address auto-fill (ViaCEP typically responds in < 500ms)
  await page.waitForTimeout(1000)
}

/**
 * Select a date in the calendar (Step 1 - Schedule).
 * Clicks a date cell that's not disabled.
 */
export async function selectDate(page: Page, day: number) {
  // The booking calendar renders <td class="rdp-day"><button/></td> — match
  // the day cell by its visible number and click the inner button.
  const dayButton = page
    .locator(`[class*="rdp-day"] button:not([disabled]):has-text("${day}")`)
    .first()
  await dayButton.click()
  await page.waitForTimeout(300)
}

/**
 * Select a time slot (Step 1 - Schedule).
 * Clicks a time button in the available slots.
 */
export async function selectTimeSlot(page: Page) {
  // Click the first available time slot (slots render as "08h00" via formatHHmm)
  const slot = page
    .getByRole("button")
    .filter({ hasText: /\d{2}h\d{2}/ })
    .first()
  await slot.click()
  await page.waitForTimeout(300)
}

/**
 * Click "Continuar" button to advance to the next booking step.
 */
export async function clickContinue(page: Page) {
  const btn = page.locator('button:has-text("Continuar")')
  await btn.click()
  await page.waitForTimeout(500)
}

/**
 * Click "Confirmar agendamento" button to submit the booking.
 */
export async function clickConfirmBooking(page: Page) {
  const btn = page.locator('button:has-text("Confirmar agendamento")')
  await btn.click()
  await page.waitForTimeout(1000)
}

/**
 * Register a new user via the auth modal.
 * Returns the generated email so it can be used for login later.
 */
export async function registerUser(page: Page, options: { role?: "CLIENT" | "PROVIDER" } = {}) {
  const { role = "CLIENT" } = options
  const email = `e2e-${Date.now()}@test.com`
  const password = "Test123456!"

  // Open auth modal if not already open — wait for the topbar "Entrar"
  // button (auto-retry; a one-shot isVisible() can miss it during hydration)
  const entrarBtn = page.getByRole("button", { name: /entrar|login|criar conta/i }).first()
  try {
    await entrarBtn.waitFor({ state: "visible", timeout: 10_000 })
    await entrarBtn.click()
    // Wait for dialog to appear after click — increase from 800ms to 2s
    await page.waitForTimeout(2000)
  } catch {
    // Already authenticated — no login button; skip opening the modal
  }

  // Switch to the register tab — role="tab" so we don't hit the topbar's
  // "Cadastrar" button that sits behind the modal overlay
  const dialog = page.getByRole("dialog")
  await dialog.waitFor({ state: "visible", timeout: 15_000 })
  const criarTab = dialog.getByRole("tab", { name: /cadastrar/i }).first()
  await criarTab.waitFor({ state: "visible", timeout: 10_000 })
  await criarTab.click()
  await page.waitForTimeout(300)

  // Scope to the visible form — login and register tabs both render an
  // E-mail field with the same placeholder; the hidden tab is display:none.
  const form = dialog.locator("form:visible")
  await form.waitFor({ state: "visible", timeout: 10_000 })

  // Fill the registration form. Labels work for fields without an icon
  // wrapper (Nome completo, CPF, WhatsApp, Cidade); for icon-wrapped fields
  // (E-mail, Senha, Confirmar senha) the FormControl Slot forwards the id to
  // the wrapping <div>, so use placeholders instead.
  await form.getByLabel("Nome completo", { exact: true }).fill(`Test User ${role}`)
  await form.getByPlaceholder("voce@exemplo.com").fill(email)
  await form.getByPlaceholder("Mínimo 6 caracteres").fill(password)
  await form.getByPlaceholder("Repita a senha").fill(password)

  // Select role — the toggle is a set of buttons ("Tipo de conta" cards)
  const roleBtn = form
    .getByRole("button", {
      name: role === "CLIENT" ? /cliente/i : /prestador/i,
    })
    .first()
  if (await roleBtn.isVisible().catch(() => false)) {
    await roleBtn.click()
    await page.waitForTimeout(200)
  }

  // For provider, fill additional required fields (labels work here — no icon wrapper)
  if (role === "PROVIDER") {
    await form.getByLabel("CPF / CNPJ", { exact: true }).fill("123.456.789-00")
    await form.getByLabel("WhatsApp", { exact: true }).fill("(11) 90000-0000")
    await form.getByLabel("Cidade", { exact: true }).fill("São Paulo")
    await form.getByLabel("UF", { exact: true }).fill("SP")
  }

  // Submit
  const submitBtn = form.getByRole("button", { name: /criar conta|cadastrar/i }).first()
  await submitBtn.click()
  await page.waitForTimeout(2000)

  return { email, password }
}

/**
 * Login via the auth modal.
 */
export async function loginUser(page: Page, email: string, password: string) {
  const entrarBtn = page.getByRole("button", { name: /entrar|login/i }).first()
  try {
    await entrarBtn.waitFor({ state: "visible", timeout: 10_000 })
    await entrarBtn.click()
    await page.waitForTimeout(500)
  } catch {
    // Already authenticated — skip opening the modal
  }

  const dialog = page.getByRole("dialog")
  await dialog.waitFor({ state: "visible", timeout: 10_000 })

  // Same placeholder-based approach as registerUser — the E-mail/Senha fields
  // have icon wrappers, so the label's id lands on the <div>, not the input.
  const form = dialog.locator("form:visible")
  await form.getByPlaceholder("voce@exemplo.com").fill(email)
  await form.getByPlaceholder("••••••").fill(password)

  const submitBtn = form.getByRole("button", { name: /entrar|login/i }).first()
  await submitBtn.click()
  await page.waitForTimeout(2000)
}

/**
 * Click the "Agendar" button inside a provider card. The landing page has
 * several other "Agendar"-labeled buttons (HowItWorks CTA "Agendar agora",
 * FAQ accordions) that do NOT open the booking modal — only the provider
 * card's footer button does. Scope the lookup to [data-slot="card"] to stay
 * deterministic under load (when lazy sections hydrate at different times).
 */
export async function clickProviderAgendar(page: Page) {
  const btn = page
    .locator('[data-slot="card"] button:has-text("Agendar")')
    .filter({ visible: true })
    .first()
  await btn.waitFor({ state: "visible", timeout: 15_000 })
  await btn.click()
  await page.waitForTimeout(1000)
}

/**
 * Navigate back to the vitrine landing page, clearing the persisted view
 * store first. After register/login the app navigates to the dashboard and
 * persists the view ("severinno:view"), so a plain page.goto("/") would
 * restore the dashboard instead of the landing.
 */
export async function goToLanding(page: Page) {
  await page.evaluate(() => {
    try {
      localStorage.removeItem("severinno:view")
    } catch {}
  })
  await page.goto("/")
  await waitForVitrine(page)
}

/**
 * Open the booking modal by clicking "Agendar" on the first provider card.
 */
export async function openBookingModal(page: Page) {
  await clickProviderAgendar(page)

  // Check if booking modal opened
  const modalTitle = page
    .locator('h2:has-text("Agendar serviço"), h2:has-text("Agendar serviço")')
    .first()
  await modalTitle.waitFor({ state: "visible", timeout: 5000 }).catch(() => {})

  // Disable pointer events on sticky footer so calendar/slots are clickable
  await page.evaluate(() => {
    document.querySelectorAll('[class*="sticky bottom-0"]').forEach(el => {
      (el as HTMLElement).style.pointerEvents = 'none'
    })
  })
}

/**
 * Complete the full booking flow:
 * Step 1: Select date + time
 * Step 2: Set quantity + address
 * Step 3: Select PIX
 * Step 4: Confirm
 * Returns true if the booking was successfully created.
 */
export async function completeBookingFlow(page: Page) {
  // Step 1 - Schedule: select first available date and time
  const dayButton = page.locator('[class*="rdp-day"] button:not([disabled])').first()
  await dayButton.click()
  await page.waitForTimeout(300)

  // Select first available time slot (slots render as "08h00" via formatHHmm)
  const timeSlot = page
    .getByRole("button")
    .filter({ hasText: /\d{2}h\d{2}/ })
    .first()
  await timeSlot.click()
  await page.waitForTimeout(300)

  // Click Continue
  await clickContinue(page)

  // Step 2 - Details: fill CEP to trigger address lookup
  const cepInput = page.getByPlaceholder(/CEP/i).first()
  if (await cepInput.isVisible()) {
    await cepInput.fill("01310100")
    await page.waitForTimeout(1500)
  }

  // Click Continue
  await clickContinue(page)

  // Step 3 - Payment: PIX is selected by default, just Continue
  await clickContinue(page)

  // Step 4 - Confirmation: click Confirmar agendamento
  await clickConfirmBooking(page)

  // Wait for success toast or navigation
  await page.waitForTimeout(2000)

  // Check if we got redirected or saw a success message
  const success = page
    .locator("text=/agendamento confirmado|confirmado com sucesso|Agendamento criado/i")
    .first()
  return await success.isVisible().catch(() => false)
}
