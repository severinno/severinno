# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: auth.spec.ts >> Autenticação >> abre modal de login com botão 'Entrar'
- Location: e2e\auth.spec.ts:10:7

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('button', { name: /entrar|login/i }).first()
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for getByRole('button', { name: /entrar|login/i }).first()

```

```yaml
- banner
- main:
  - complementary
- contentinfo
- region "Notifications alt+T"
- alert
```

# Test source

```ts
  1  | import { test, expect } from "@playwright/test"
  2  | import { waitForVitrine, registerUser, loginUser } from "./helpers"
  3  | 
  4  | test.describe("Autenticação", () => {
  5  |   test.beforeEach(async ({ page }) => {
  6  |     await page.goto("/")
  7  |     await waitForVitrine(page)
  8  |   })
  9  | 
  10 |   test("abre modal de login com botão 'Entrar'", async ({ page }) => {
  11 |     const entrarBtn = page.getByRole("button", { name: /entrar|login/i }).first()
> 12 |     await expect(entrarBtn).toBeVisible()
     |                             ^ Error: expect(locator).toBeVisible() failed
  13 |     await entrarBtn.click()
  14 |     await page.waitForTimeout(500)
  15 | 
  16 |     // Verifica se o modal de auth abriu
  17 |     const emailInput = page.getByPlaceholder(/email/i).first()
  18 |     await expect(emailInput).toBeVisible({ timeout: 5000 })
  19 |   })
  20 | 
  21 |   test("pode alternar entre login e cadastro no modal", async ({ page }) => {
  22 |     // Abre o modal de login
  23 |     const entrarBtn = page.getByRole("button", { name: /entrar|login/i }).first()
  24 |     await entrarBtn.click()
  25 |     await page.waitForTimeout(500)
  26 | 
  27 |     // Muda para cadastro
  28 |     const criarBtn = page.getByRole("button", { name: /criar conta|cadastrar/i }).first()
  29 |     if (await criarBtn.isVisible()) {
  30 |       await criarBtn.click()
  31 |       await page.waitForTimeout(300)
  32 | 
  33 |       // Verifica que mostra formulário de cadastro
  34 |       const nameInput = page.getByPlaceholder(/nome/i).first()
  35 |       await expect(nameInput).toBeVisible({ timeout: 3000 })
  36 |     }
  37 |   })
  38 | 
  39 |   test("login com credenciais inválidas mostra erro", async ({ page }) => {
  40 |     await loginUser(page, "invalido@test.com", "senha_errada")
  41 | 
  42 |     // Deve mostrar mensagem de erro ou permanecer no modal
  43 |     const errorMsg = page.locator('text=/inválido|erro|incorreto|não encontrado/i').first()
  44 |     const stillOnModal = page.getByPlaceholder(/email/i).first()
  45 | 
  46 |     const hasError = await errorMsg.isVisible().catch(() => false)
  47 |     const modalStillOpen = await stillOnModal.isVisible().catch(() => false)
  48 | 
  49 |     expect(hasError || modalStillOpen).toBe(true)
  50 |   })
  51 | 
  52 |   test("registro de novo cliente é bem-sucedido", async ({ page }) => {
  53 |     await registerUser(page, { role: "CLIENT" })
  54 |     await page.waitForTimeout(1000)
  55 | 
  56 |     // Após registro bem-sucedido, verifica se o usuário está autenticado
  57 |     // (pode esconder o botão Entrar ou mostrar o nome do usuário)
  58 |     const entrarBtn = page.getByRole("button", { name: /entrar|login|criar conta/i }).first()
  59 |     const btnHidden = await entrarBtn.isVisible().then(v => !v).catch(() => true)
  60 | 
  61 |     const userName = page.locator('text=/Test User/i').first()
  62 |     const nameVisible = await userName.isVisible().catch(() => false)
  63 | 
  64 |     expect(btnHidden || nameVisible).toBe(true)
  65 |   })
  66 | 
  67 |   test("registro de prestador mostra campos extras", async ({ page }) => {
  68 |     // Abre o modal de auth
  69 |     const entrarBtn = page.getByRole("button", { name: /entrar|login/i }).first()
  70 |     await entrarBtn.click()
  71 |     await page.waitForTimeout(500)
  72 | 
  73 |     // Muda para cadastro
  74 |     const criarBtn = page.getByRole("button", { name: /criar conta|cadastrar/i }).first()
  75 |     if (await criarBtn.isVisible()) {
  76 |       await criarBtn.click()
  77 |       await page.waitForTimeout(300)
  78 |     }
  79 | 
  80 |     // Seleciona papel de Prestador
  81 |     const providerRadio = page.locator('label:has-text("Prestador")').first()
  82 |     if (await providerRadio.isVisible()) {
  83 |       await providerRadio.click()
  84 |       await page.waitForTimeout(300)
  85 |     }
  86 | 
  87 |     // Verifica campos extras do prestador
  88 |     const cpfInput = page.getByPlaceholder(/cpf|cnpj/i).first()
  89 |     if (await cpfInput.isVisible().catch(() => false)) {
  90 |       await expect(cpfInput).toBeVisible()
  91 |     }
  92 |   })
  93 | })
  94 | 
```