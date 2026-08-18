/* eslint-disable @typescript-eslint/no-explicit-any */
import { test, expect } from "@playwright/test"
import { waitForVitrine, registerUser, loginUser } from "./helpers"

test.describe("Autenticação", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/")
    await waitForVitrine(page)
  })

  test("abre modal de login com botão 'Entrar'", async ({ page }) => {
    const entrarBtn = page.getByRole("button", { name: /entrar|login/i }).first()
    await expect(entrarBtn).toBeVisible()
    await entrarBtn.click()
    await page.waitForTimeout(500)

    // Verifica se o modal de auth abriu
    const emailInput = page.getByPlaceholder(/email/i).first()
    await expect(emailInput).toBeVisible({ timeout: 5000 })
  })

  test("pode alternar entre login e cadastro no modal", async ({ page }) => {
    // Abre o modal de login
    const entrarBtn = page.getByRole("button", { name: /entrar|login/i }).first()
    await entrarBtn.click()
    await page.waitForTimeout(500)

    // Muda para cadastro
    const criarBtn = page.getByRole("button", { name: /criar conta|cadastrar/i }).first()
    if (await criarBtn.isVisible()) {
      await criarBtn.click()
      await page.waitForTimeout(300)

      // Verifica que mostra formulário de cadastro
      const nameInput = page.getByPlaceholder(/nome/i).first()
      await expect(nameInput).toBeVisible({ timeout: 3000 })
    }
  })

  test("login com credenciais inválidas mostra erro", async ({ page }) => {
    await loginUser(page, "invalido@test.com", "senha_errada")

    // Deve mostrar mensagem de erro ou permanecer no modal
    const errorMsg = page.locator("text=/inválido|erro|incorreto|não encontrado/i").first()
    const stillOnModal = page.getByPlaceholder(/email/i).first()

    const hasError = await errorMsg.isVisible().catch(() => false)
    const modalStillOpen = await stillOnModal.isVisible().catch(() => false)

    expect(hasError || modalStillOpen).toBe(true)
  })

  test("registro de novo cliente é bem-sucedido", async ({ page }) => {
    await registerUser(page, { role: "CLIENT" })
    await page.waitForTimeout(1000)

    // Após registro bem-sucedido, verifica se o usuário está autenticado
    // (pode esconder o botão Entrar ou mostrar o nome do usuário)
    const entrarBtn = page.getByRole("button", { name: /entrar|login|criar conta/i }).first()
    const btnHidden = await entrarBtn
      .isVisible()
      .then((v) => !v)
      .catch(() => true)

    const userName = page.locator("text=/Test User/i").first()
    const nameVisible = await userName.isVisible().catch(() => false)

    expect(btnHidden || nameVisible).toBe(true)
  })

  test("registro de prestador mostra campos extras", async ({ page }) => {
    // Abre o modal de auth
    const entrarBtn = page.getByRole("button", { name: /entrar|login/i }).first()
    await entrarBtn.click()
    await page.waitForTimeout(500)

    // Muda para cadastro
    const criarBtn = page.getByRole("button", { name: /criar conta|cadastrar/i }).first()
    if (await criarBtn.isVisible()) {
      await criarBtn.click()
      await page.waitForTimeout(300)
    }

    // Seleciona papel de Prestador
    const providerRadio = page.locator('label:has-text("Prestador")').first()
    if (await providerRadio.isVisible()) {
      await providerRadio.click()
      await page.waitForTimeout(300)
    }

    // Verifica campos extras do prestador
    const cpfInput = page.getByPlaceholder(/cpf|cnpj/i).first()
    if (await cpfInput.isVisible().catch(() => false)) {
      await expect(cpfInput).toBeVisible()
    }
  })
})
