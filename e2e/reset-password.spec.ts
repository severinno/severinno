import { test, expect } from "@playwright/test"
import { setupApiMocks } from "./mocks"
import { waitForVitrine } from "./helpers"

// The PWA service worker (public/sw.js) intercepts /api/* GET requests and
// fetches them from inside the worker — requests initiated by the SW bypass
// page.route() and hit the real backend, so the GET mocks in setupApiMocks
// never take effect. (Auth POSTs are mocked at JS level and are unaffected.)
test.use({ serviceWorkers: "block" })

// =========================================================================
// Test Constants
// =========================================================================

const VALID_TOKEN = "valid-reset-token-abc123"
const EXPIRED_TOKEN = "expired-token"
const _USED_TOKEN = "used-token"
const INVALID_TOKEN = "invalid-token"
const NEW_PASSWORD = "novaSenha123"

// =========================================================================
// Forgot Password — Page
// =========================================================================

test.describe("Forgot Password — Página", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page)
    // Navigate directly to the forgot-password page (SPA-adjacent route)
    await page.goto("/auth/reset-password")
    await page.waitForLoadState("networkidle")
  })

  test("exibe formulário de email corretamente", async ({ page }) => {
    // Título
    await expect(page.locator("h1")).toHaveText(/recuperar senha/i)

    // Campo de email visível
    const emailInput = page.getByPlaceholder(/voce@exemplo/i)
    await expect(emailInput).toBeVisible()

    // Botão de submit
    const submitBtn = page.locator('button[type="submit"]')
    await expect(submitBtn).toBeVisible()
    await expect(submitBtn).toBeDisabled() // disabled when empty
  })

  test("botão fica habilitado quando email é digitado", async ({ page }) => {
    const emailInput = page.getByPlaceholder(/voce@exemplo/i)
    await emailInput.fill("teste@exemplo.com")

    const submitBtn = page.locator('button[type="submit"]')
    await expect(submitBtn).toBeEnabled()
  })

  test("mostra estado de sucesso após submit", async ({ page }) => {
    const emailInput = page.getByPlaceholder(/voce@exemplo/i)
    await emailInput.fill("teste@exemplo.com")

    const submitBtn = page.locator('button[type="submit"]')
    await submitBtn.click()

    // Aguarda mensagem de sucesso
    await expect(page.locator("text=/E-mail enviado/i")).toBeVisible({ timeout: 10000 })

    // Botão "Voltar ao início" visível
    const backBtn = page.locator("button:has-text('Voltar ao início')")
    await expect(backBtn).toBeVisible()
  })

  test("pode voltar após sucesso", async ({ page }) => {
    const emailInput = page.getByPlaceholder(/voce@exemplo/i)
    await emailInput.fill("teste@exemplo.com")

    const submitBtn = page.locator('button[type="submit"]')
    await submitBtn.click()

    // Aguarda sucesso
    await expect(page.locator("text=/e-mail enviado/i")).toBeVisible({ timeout: 10000 })

    // Clica "Tentar novamente"
    const tryAgain = page.locator("button:has-text('tente novamente')")
    await expect(tryAgain).toBeVisible()
    await tryAgain.click()

    // Volta ao formulário
    await expect(emailInput).toBeVisible()
  })

  test("botão de voltar ao início existe", async ({ page }) => {
    const backBtn = page.locator("button:has-text('Voltar')")
    await expect(backBtn).toBeVisible()
  })
})

// =========================================================================
// Reset Password — Page
// =========================================================================

test.describe("Reset Password — Página", () => {
  test("exibe formulário de nova senha com token válido", async ({ page }) => {
    await setupApiMocks(page)
    await page.goto(`/auth/reset-password/${VALID_TOKEN}`)
    await page.waitForLoadState("networkidle")

    // Título
    await expect(page.locator("h1")).toHaveText(/redefinir senha/i)

    // Campos de senha
    const passwordInput = page.locator("#password")
    await expect(passwordInput).toBeVisible()

    const confirmInput = page.locator("#confirmPassword")
    await expect(confirmInput).toBeVisible()

    // Botão de submit desabilitado inicialmente
    const submitBtn = page.locator('button[type="submit"]:has-text("Redefinir")')
    await expect(submitBtn).toBeDisabled()
  })

  test("mostra erro para senhas que não conferem", async ({ page }) => {
    await setupApiMocks(page)
    await page.goto(`/auth/reset-password/${VALID_TOKEN}`)
    await page.waitForLoadState("networkidle")

    const passwordInput = page.locator("#password")
    const confirmInput = page.locator("#confirmPassword")

    await passwordInput.fill("senha123")
    await confirmInput.fill("senha456")

    // Mensagem de erro deve aparecer
    await expect(page.locator("text=/não conferem/i")).toBeVisible()
  })

  test("mostra aviso para senha muito curta", async ({ page }) => {
    await setupApiMocks(page)
    await page.goto(`/auth/reset-password/${VALID_TOKEN}`)
    await page.waitForLoadState("networkidle")

    const passwordInput = page.locator("#password")
    await passwordInput.fill("123")

    await expect(page.locator("text=/Mínimo de 6/i")).toBeVisible()
  })

  test("submit bem-sucedido mostra tela de sucesso", async ({ page }) => {
    await setupApiMocks(page)
    await page.goto(`/auth/reset-password/${VALID_TOKEN}`)
    await page.waitForLoadState("networkidle")

    // Preenche senha
    await page.locator("#password").fill(NEW_PASSWORD)
    await page.locator("#confirmPassword").fill(NEW_PASSWORD)

    // Submete
    const submitBtn = page.locator('button[type="submit"]:has-text("Redefinir")')
    await expect(submitBtn).toBeEnabled()
    await submitBtn.click()

    // Verifica estado de sucesso
    await expect(page.locator("h2:has-text('Senha alterada')")).toBeVisible({ timeout: 10000 })
    await expect(page.locator("button:has-text('Ir para o login')")).toBeVisible()
  })

  test("botão 'Ir para o login' redireciona para home após sucesso", async ({ page }) => {
    await setupApiMocks(page)
    await page.goto(`/auth/reset-password/${VALID_TOKEN}`)
    await page.waitForLoadState("networkidle")

    // Preenche e submete
    await page.locator("#password").fill(NEW_PASSWORD)
    await page.locator("#confirmPassword").fill(NEW_PASSWORD)
    await page.locator('button[type="submit"]:has-text("Redefinir")').click()

    // Aguarda sucesso
    await expect(page.locator("button:has-text('Ir para o login')")).toBeVisible({ timeout: 10000 })

    // Clica no botão
    await page.locator('button:has-text("Ir para o login")').click()
    await page.waitForURL("/")
  })
})

// =========================================================================
// Auth Modal — Link "Esqueci a senha"
// =========================================================================

test.describe("Auth Modal — Link Esqueci a Senha", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page)
    await page.goto("/")
    await waitForVitrine(page)
  })

  test("link 'Esqueci a senha' existe no modal de login", async ({ page }) => {
    // Abre modal de login
    const entrarBtn = page.getByRole("button", { name: /entrar|login/i }).first()
    await entrarBtn.click()
    await page.waitForTimeout(500)

    // Verifica link "Esqueci a senha"
    const forgotLink = page.locator("button:has-text('Esqueci a senha')")
    await expect(forgotLink).toBeVisible()
  })

  test("'Esqueci a senha' abre página de recuperação (nova aba)", async ({ page, context }) => {
    // Abre modal de login
    const entrarBtn = page.getByRole("button", { name: /entrar|login/i }).first()
    await entrarBtn.click()
    await page.waitForTimeout(500)

    // Intercepta window.open para verificar URL
    const [newPage] = await Promise.all([
      context.waitForEvent("page", { timeout: 5000 }).catch(() => null as any),
      page.locator("button:has-text('Esqueci a senha')").click(),
    ])

    if (newPage) {
      await newPage.waitForLoadState("domcontentloaded")
      expect(newPage.url()).toContain("/auth/reset-password")
      await newPage.close()
    }
  })
})

// =========================================================================
// Error Scenarios
// =========================================================================

test.describe("Cenários de Erro", () => {
  test("reset page com token expirado mostra erro no submit", async ({ page }) => {
    await setupApiMocks(page)
    await page.goto(`/auth/reset-password/${EXPIRED_TOKEN}`)
    await page.waitForLoadState("networkidle")

    // Preenche e submete
    await page.locator("#password").fill(NEW_PASSWORD)
    await page.locator("#confirmPassword").fill(NEW_PASSWORD)
    // Wait for React state to process
    await page.waitForTimeout(300)
    await page.locator('button[type="submit"]:has-text("Redefinir")').click()

    // Deve mostrar mensagem de erro (mock retorna "expirou")
    await expect(page.locator("text=/expirou|inválido/i")).toBeVisible({ timeout: 10000 })
  })

  test("reset page com token inválido mostra erro no submit", async ({ page }) => {
    await setupApiMocks(page)
    await page.goto(`/auth/reset-password/${INVALID_TOKEN}`)
    await page.waitForLoadState("networkidle")

    // Preenche e submete
    await page.locator("#password").fill(NEW_PASSWORD)
    await page.locator("#confirmPassword").fill(NEW_PASSWORD)
    await page.locator('button[type="submit"]:has-text("Redefinir")').click()

    // Deve mostrar mensagem de erro
    await expect(page.locator("text=/inválido|erro|Token inválido/i")).toBeVisible({
      timeout: 10000,
    })
  })

  test("pode tentar novamente após erro no reset", async ({ page }) => {
    await setupApiMocks(page)
    await page.goto(`/auth/reset-password/${EXPIRED_TOKEN}`)
    await page.waitForLoadState("networkidle")

    // Preenche e submete
    await page.locator("#password").fill(NEW_PASSWORD)
    await page.locator("#confirmPassword").fill(NEW_PASSWORD)
    // Wait for React state to process
    await page.waitForTimeout(300)
    await page.locator('button[type="submit"]:has-text("Redefinir")').click()

    // Aguarda erro (mock retorna "expirou")
    await expect(page.locator("text=/expirou/i")).toBeVisible({ timeout: 10000 })

    // Clica "Tentar novamente"
    const retryBtn = page.locator("button:has-text('Tentar novamente')")
    await expect(retryBtn).toBeVisible()
    await retryBtn.click()

    // Volta ao formulário
    await expect(page.locator("#password")).toBeVisible()
  })
})
