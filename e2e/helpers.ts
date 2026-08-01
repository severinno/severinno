import { type Page } from "@playwright/test"

/**
 * Wait for the vitrine (app shell) to be fully loaded and hydrated.
 * The app shows a "Carregando Severinno…" text during SSR/hydration.
 *
 * Dev mode is slower than production, so timeout is generous.
 */
export async function waitForVitrine(page: Page) {
  // Wait for the "Carregando" text to disappear (hydration complete)
  await page.waitForFunction(
    () => {
      const loadingEl = document.querySelector('[class*="animate-spin"]')
      const hasLoadingText = document.body?.innerText?.includes("Carregando")
      return !loadingEl && !hasLoadingText
    },
    { timeout: 30000 },
  )
  // Wait for a post-hydration element to confirm the app is interactive
  await page
    .locator('button:has-text(/entrar|login/i), [class*="Card"], [class*="search"], h1, h2')
    .first()
    .waitFor({ state: "visible", timeout: 10000 })
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
  // Find a day cell in the calendar that matches and is not disabled
  const dayButton = page
    .locator(
      `button[role="gridcell"]:not([disabled]) button:has-text("${day}"), button:not([disabled]):has-text("${day}")`,
    )
    .first()
  await dayButton.click()
  await page.waitForTimeout(300)
}

/**
 * Select a time slot (Step 1 - Schedule).
 * Clicks a time button in the available slots.
 */
export async function selectTimeSlot(page: Page) {
  // Click the first available time slot (buttons with HH:MM text pattern)
  const slot = page
    .getByRole("button")
    .filter({ hasText: /\d{2}:\d{2}/ })
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
  const password = "test123456"

  // Open auth modal if not already open
  const entrarBtn = page.getByRole("button", { name: /entrar|login|criar conta/i }).first()
  if (await entrarBtn.isVisible()) {
    await entrarBtn.click()
    await page.waitForTimeout(500)
  }

  // Switch to register tab if needed
  const criarBtn = page.getByRole("button", { name: /criar conta|cadastrar/i }).first()
  if (await criarBtn.isVisible()) {
    await criarBtn.click()
    await page.waitForTimeout(300)
  }

  // Fill the registration form
  const nameInput = page.getByPlaceholder(/nome/i).first()
  await nameInput.fill(`Test User ${role}`)

  const emailInput = page.getByPlaceholder(/email/i).first()
  await emailInput.fill(email)

  const passwordInput = page.getByPlaceholder(/senha/i).first()
  await passwordInput.fill(password)

  const confirmInput = page.getByPlaceholder(/confirmar/i).first()
  await confirmInput.fill(password)

  // Select role
  const roleRadio = page
    .locator(`label:has-text("${role === "CLIENT" ? "Cliente" : "Prestador"}")`)
    .first()
  if (await roleRadio.isVisible()) {
    await roleRadio.click()
  }

  // For provider, fill additional required fields
  if (role === "PROVIDER") {
    const cpfInput = page.getByPlaceholder(/cpf|cnpj/i).first()
    await cpfInput.fill("123.456.789-00")

    const whatsInput = page.getByPlaceholder(/whatsapp|telefone/i).first()
    await whatsInput.fill("11999999999")

    const cityInput = page.getByPlaceholder(/cidade/i).first()
    await cityInput.fill("São Paulo")
  }

  // Submit
  const submitBtn = page
    .locator('button[type="submit"]:has-text(/criar|cadastrar|registrar/i)')
    .first()
  await submitBtn.click()
  await page.waitForTimeout(2000)

  return { email, password }
}

/**
 * Login via the auth modal.
 */
export async function loginUser(page: Page, email: string, password: string) {
  const entrarBtn = page.getByRole("button", { name: /entrar|login/i }).first()
  if (await entrarBtn.isVisible()) {
    await entrarBtn.click()
    await page.waitForTimeout(500)
  }

  const emailInput = page.getByPlaceholder(/email/i).first()
  await emailInput.fill(email)

  const passwordInput = page.getByPlaceholder(/senha/i).first()
  await passwordInput.fill(password)

  const submitBtn = page.locator('button[type="submit"]:has-text(/entrar|login/i)').first()
  await submitBtn.click()
  await page.waitForTimeout(2000)
}

/**
 * Open the booking modal by clicking "Agendar" on the first provider card.
 */
export async function openBookingModal(page: Page) {
  // Click the first "Agendar" button visible on a provider card
  const agendarBtn = page.locator('button:has-text("Agendar")').first()
  await agendarBtn.click()
  await page.waitForTimeout(1000)

  // Check if booking modal opened
  const modalTitle = page
    .locator('h2:has-text("Agendar serviço"), h2:has-text("Agendar serviço")')
    .first()
  await modalTitle.waitFor({ state: "visible", timeout: 5000 }).catch(() => {})
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
  const dayButton = page.locator('button[role="gridcell"]:not([disabled])').first()
  await dayButton.click()
  await page.waitForTimeout(300)

  // Select first available time slot
  const timeSlot = page
    .getByRole("button")
    .filter({ hasText: /\d{2}:\d{2}/ })
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
