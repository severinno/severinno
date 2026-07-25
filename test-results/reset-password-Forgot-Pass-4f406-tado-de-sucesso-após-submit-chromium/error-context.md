# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: reset-password.spec.ts >> Forgot Password — Página >> mostra estado de sucesso após submit
- Location: e2e\reset-password.spec.ts:49:7

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: locator.click: Test timeout of 30000ms exceeded.
Call log:
  - waiting for locator('button[type="submit"]')
    - locator resolved to <button type="submit" class="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 text-sm font-medium text-white transition-all hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50">Enviar instruções</button>
  - attempting click action
    2 × waiting for element to be visible, enabled and stable
      - element is visible, enabled and stable
      - scrolling into view if needed
      - done scrolling
      - <nextjs-portal></nextjs-portal> from <script data-nextjs-dev-overlay="true">…</script> subtree intercepts pointer events
    - retrying click action
    - waiting 20ms
    2 × waiting for element to be visible, enabled and stable
      - element is visible, enabled and stable
      - scrolling into view if needed
      - done scrolling
      - <nextjs-portal></nextjs-portal> from <script data-nextjs-dev-overlay="true">…</script> subtree intercepts pointer events
    - retrying click action
      - waiting 100ms
    33 × waiting for element to be visible, enabled and stable
       - element is visible, enabled and stable
       - scrolling into view if needed
       - done scrolling
       - <nextjs-portal></nextjs-portal> from <script data-nextjs-dev-overlay="true">…</script> subtree intercepts pointer events
     - retrying click action
       - waiting 500ms
    - waiting for element to be visible, enabled and stable

```

# Page snapshot

```yaml
- generic [ref=e1]:
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
          - textbox "Seu e-mail" [active] [ref=e14]:
            - /placeholder: voce@exemplo.com
            - text: teste@exemplo.com
      - button "Enviar instruções" [ref=e15]
      - button "Voltar para o início" [ref=e17]:
        - img [ref=e18]
        - text: Voltar para o início
  - region "Notifications alt+T"
  - generic:
    - generic [ref=e22]:
      - generic [ref=e23]:
        - generic [ref=e24]:
          - navigation [ref=e25]:
            - button "previous" [disabled] [ref=e26]:
              - img "previous" [ref=e27]
            - generic [ref=e29]:
              - generic [ref=e30]: 1/
              - text: "1"
            - button "next" [disabled] [ref=e31]:
              - img "next" [ref=e32]
          - img
        - generic [ref=e34]:
          - link "Next.js 16.1.3 (stale) Turbopack" [ref=e35] [cursor=pointer]:
            - /url: https://nextjs.org/docs/messages/version-staleness
            - img [ref=e36]
            - generic "There is a newer version (16.2.11) available, upgrade recommended!" [ref=e38]: Next.js 16.1.3 (stale)
            - generic [ref=e39]: Turbopack
          - img
      - dialog "Build Error" [ref=e41]:
        - generic [ref=e44]:
          - generic [ref=e45]:
            - generic [ref=e46]:
              - generic [ref=e48]: Build Error
              - generic [ref=e49]:
                - button "Copy Error Info" [ref=e50] [cursor=pointer]:
                  - img [ref=e51]
                - button "No related documentation found" [disabled] [ref=e53]:
                  - img [ref=e54]
                - button "Attach Node.js inspector" [ref=e56] [cursor=pointer]:
                  - img [ref=e57]
            - generic [ref=e66]: Reading source code for parsing failed
          - generic [ref=e68]:
            - generic [ref=e70]:
              - img [ref=e72]
              - generic [ref=e76]: ./.freebuff/worktrees/thmrzp9vv9y86o/src/lib/api-server.ts
              - button "Open in editor" [ref=e77] [cursor=pointer]:
                - img [ref=e79]
            - generic [ref=e83]: "Reading source code for parsing failed An unexpected error happened while trying to read the source code to parse: failed to convert rope into string Caused by: - invalid utf-8 sequence of 1 bytes from index 5415 Import trace: App Route: ./.freebuff/worktrees/thmrzp9vv9y86o/src/lib/api-server.ts ./.freebuff/worktrees/thmrzp9vv9y86o/src/app/api/auth/me/route.ts"
        - generic [ref=e84]: "1"
        - generic [ref=e85]: "2"
    - generic [ref=e90] [cursor=pointer]:
      - button "Open Next.js Dev Tools" [ref=e91]:
        - img [ref=e92]
      - button "Open issues overlay" [ref=e96]:
        - generic [ref=e97]:
          - generic [ref=e98]: "0"
          - generic [ref=e99]: "1"
        - generic [ref=e100]: Issue
  - alert [ref=e101]
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
  20  |   test.beforeEach(async ({ page }) => {
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
> 54  |     await submitBtn.click()
      |                     ^ Error: locator.click: Test timeout of 30000ms exceeded.
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
  121 | 
  122 |     await passwordInput.fill("senha123")
  123 |     await confirmInput.fill("senha456")
  124 | 
  125 |     // Mensagem de erro deve aparecer
  126 |     await expect(page.locator("text=/não conferem/i")).toBeVisible()
  127 |   })
  128 | 
  129 |   test("mostra aviso para senha muito curta", async ({ page }) => {
  130 |     await setupApiMocks(page)
  131 |     await page.goto(`/auth/reset-password/${VALID_TOKEN}`)
  132 |     await page.waitForLoadState("networkidle")
  133 | 
  134 |     const passwordInput = page.locator("#password")
  135 |     await passwordInput.fill("123")
  136 | 
  137 |     await expect(page.locator("text=/Mínimo de 6/i")).toBeVisible()
  138 |   })
  139 | 
  140 |   test("submit bem-sucedido mostra tela de sucesso", async ({ page }) => {
  141 |     await setupApiMocks(page)
  142 |     await page.goto(`/auth/reset-password/${VALID_TOKEN}`)
  143 |     await page.waitForLoadState("networkidle")
  144 | 
  145 |     // Preenche senha
  146 |     await page.locator("#password").fill(NEW_PASSWORD)
  147 |     await page.locator("#confirmPassword").fill(NEW_PASSWORD)
  148 | 
  149 |     // Submete
  150 |     const submitBtn = page.locator('button[type="submit"]:has-text("Redefinir")')
  151 |     await expect(submitBtn).toBeEnabled()
  152 |     await submitBtn.click()
  153 | 
  154 |     // Verifica estado de sucesso
```