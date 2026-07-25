# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: reset-password.spec.ts >> Forgot Password — Página >> exibe formulário de email corretamente
- Location: e2e\reset-password.spec.ts:27:7

# Error details

```
Test timeout of 30000ms exceeded while running "beforeEach" hook.
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [ref=e3]:
    - generic [ref=e4]:
      - img [ref=e6]
      - heading "Recuperar senha" [level=1] [ref=e9]
      - paragraph [ref=e10]: Digite seu e-mail cadastrado e enviaremos instruções para redefinir sua senha.
    - generic [ref=e11]:
      - generic [ref=e12]:
        - text: Seu e-mail
        - generic [ref=e13]:
          - img
          - textbox "Seu e-mail" [ref=e14]:
            - /placeholder: voce@exemplo.com
      - button "Enviar instruções" [disabled] [ref=e15]
      - button "Voltar para o início" [ref=e17]:
        - img [ref=e18]
        - text: Voltar para o início
  - region "Notifications alt+T"
```

# Test source

```ts
  1   | import { test, expect } from "@playwright/test"
  2   | import { setupApiMocks } from "./mocks"
  3   | import { waitForVitrine } from "./helpers"
  4   | 
  5   | // =========================================================================
  6   | // Test Constants
  7   | // =========================================================================
  8   | 
  9   | const VALID_TOKEN = "valid-reset-token-abc123"
  10  | const EXPIRED_TOKEN = "expired-token"
  11  | const USED_TOKEN = "used-token"
  12  | const INVALID_TOKEN = "invalid-token"
  13  | const NEW_PASSWORD = "novaSenha123"
  14  | 
  15  | // =========================================================================
  16  | // Forgot Password — Page
  17  | // =========================================================================
  18  | 
  19  | test.describe("Forgot Password — Página", () => {
> 20  |   test.beforeEach(async ({ page }) => {
      |        ^ Test timeout of 30000ms exceeded while running "beforeEach" hook.
  21  |     await setupApiMocks(page)
  22  |     // Navigate directly to the forgot-password page (SPA-adjacent route)
  23  |     await page.goto("/auth/reset-password")
  24  |     await page.waitForLoadState("networkidle")
  25  |   })
  26  | 
  27  |   test("exibe formulário de email corretamente", async ({ page }) => {
  28  |     // Título
  29  |     await expect(page.locator("h1")).toHaveText(/recuperar senha/i)
  30  | 
  31  |     // Campo de email visível
  32  |     const emailInput = page.getByPlaceholder(/voce@exemplo/i)
  33  |     await expect(emailInput).toBeVisible()
  34  | 
  35  |     // Botão de submit
  36  |     const submitBtn = page.locator('button[type="submit"]')
  37  |     await expect(submitBtn).toBeVisible()
  38  |     await expect(submitBtn).toBeDisabled() // disabled when empty
  39  |   })
  40  | 
  41  |   test("botão fica habilitado quando email é digitado", async ({ page }) => {
  42  |     const emailInput = page.getByPlaceholder(/voce@exemplo/i)
  43  |     await emailInput.fill("teste@exemplo.com")
  44  | 
  45  |     const submitBtn = page.locator('button[type="submit"]')
  46  |     await expect(submitBtn).toBeEnabled()
  47  |   })
  48  | 
  49  |   test("mostra estado de sucesso após submit", async ({ page }) => {
  50  |     const emailInput = page.getByPlaceholder(/voce@exemplo/i)
  51  |     await emailInput.fill("teste@exemplo.com")
  52  | 
  53  |     const submitBtn = page.locator('button[type="submit"]')
  54  |     await submitBtn.click()
  55  | 
  56  |     // Aguarda mensagem de sucesso
  57  |     await expect(page.locator("text=/E-mail enviado/i")).toBeVisible({ timeout: 10000 })
  58  | 
  59  |     // Botão "Voltar ao início" visível
  60  |     const backBtn = page.locator("button:has-text('Voltar ao início')")
  61  |     await expect(backBtn).toBeVisible()
  62  |   })
  63  | 
  64  |   test("pode voltar após sucesso", async ({ page }) => {
  65  |     const emailInput = page.getByPlaceholder(/voce@exemplo/i)
  66  |     await emailInput.fill("teste@exemplo.com")
  67  | 
  68  |     const submitBtn = page.locator('button[type="submit"]')
  69  |     await submitBtn.click()
  70  | 
  71  |     // Aguarda sucesso
  72  |     await expect(page.locator("text=/e-mail enviado/i")).toBeVisible({ timeout: 10000 })
  73  | 
  74  |     // Clica "Tentar novamente"
  75  |     const tryAgain = page.locator("button:has-text('tente novamente')")
  76  |     await expect(tryAgain).toBeVisible()
  77  |     await tryAgain.click()
  78  | 
  79  |     // Volta ao formulário
  80  |     await expect(emailInput).toBeVisible()
  81  |   })
  82  | 
  83  |   test("botão de voltar ao início existe", async ({ page }) => {
  84  |     const backBtn = page.locator("button:has-text('Voltar')")
  85  |     await expect(backBtn).toBeVisible()
  86  |   })
  87  | })
  88  | 
  89  | // =========================================================================
  90  | // Reset Password — Page
  91  | // =========================================================================
  92  | 
  93  | test.describe("Reset Password — Página", () => {
  94  |   test("exibe formulário de nova senha com token válido", async ({ page }) => {
  95  |     await setupApiMocks(page)
  96  |     await page.goto(`/auth/reset-password/${VALID_TOKEN}`)
  97  |     await page.waitForLoadState("networkidle")
  98  | 
  99  |     // Título
  100 |     await expect(page.locator("h1")).toHaveText(/redefinir senha/i)
  101 | 
  102 |     // Campos de senha
  103 |     const passwordInput = page.locator("#password")
  104 |     await expect(passwordInput).toBeVisible()
  105 | 
  106 |     const confirmInput = page.locator("#confirmPassword")
  107 |     await expect(confirmInput).toBeVisible()
  108 | 
  109 |     // Botão de submit desabilitado inicialmente
  110 |     const submitBtn = page.locator('button[type="submit"]:has-text("Redefinir")')
  111 |     await expect(submitBtn).toBeDisabled()
  112 |   })
  113 | 
  114 |   test("mostra erro para senhas que não conferem", async ({ page }) => {
  115 |     await setupApiMocks(page)
  116 |     await page.goto(`/auth/reset-password/${VALID_TOKEN}`)
  117 |     await page.waitForLoadState("networkidle")
  118 | 
  119 |     const passwordInput = page.locator("#password")
  120 |     const confirmInput = page.locator("#confirmPassword")
```