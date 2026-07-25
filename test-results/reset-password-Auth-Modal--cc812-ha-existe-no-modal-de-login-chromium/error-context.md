# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: reset-password.spec.ts >> Auth Modal — Link Esqueci a Senha >> link 'Esqueci a senha' existe no modal de login
- Location: e2e\reset-password.spec.ts:189:7

# Error details

```
Test timeout of 30000ms exceeded while running "beforeEach" hook.
```

# Page snapshot

```yaml
- generic [ref=e1]:
  - generic [ref=e2]:
    - banner [ref=e3]
    - main [ref=e10]:
      - complementary [ref=e22]
    - contentinfo [ref=e45]
  - region "Notifications alt+T"
  - generic [active]:
    - generic [ref=e69]:
      - generic [ref=e70]:
        - generic [ref=e71]:
          - navigation [ref=e72]:
            - button "previous" [disabled] [ref=e73]:
              - img "previous" [ref=e74]
            - generic [ref=e76]:
              - generic [ref=e77]: 1/
              - text: "1"
            - button "next" [disabled] [ref=e78]:
              - img "next" [ref=e79]
          - img
        - generic [ref=e81]:
          - link "Next.js 16.1.3 (stale) Turbopack" [ref=e82] [cursor=pointer]:
            - /url: https://nextjs.org/docs/messages/version-staleness
            - img [ref=e83]
            - generic "There is a newer version (16.2.11) available, upgrade recommended!" [ref=e85]: Next.js 16.1.3 (stale)
            - generic [ref=e86]: Turbopack
          - img
      - dialog "Build Error" [ref=e88]:
        - generic [ref=e91]:
          - generic [ref=e92]:
            - generic [ref=e93]:
              - generic [ref=e95]: Build Error
              - generic [ref=e96]:
                - button "Copy Error Info" [ref=e97] [cursor=pointer]:
                  - img [ref=e98]
                - button "No related documentation found" [disabled] [ref=e100]:
                  - img [ref=e101]
                - button "Attach Node.js inspector" [ref=e103] [cursor=pointer]:
                  - img [ref=e104]
            - generic [ref=e113]: Reading source code for parsing failed
          - generic [ref=e115]:
            - generic [ref=e117]:
              - img [ref=e119]
              - generic [ref=e123]: ./.freebuff/worktrees/thmrzp9vv9y86o/src/lib/api-server.ts
              - button "Open in editor" [ref=e124] [cursor=pointer]:
                - img [ref=e126]
            - generic [ref=e130]: "Reading source code for parsing failed An unexpected error happened while trying to read the source code to parse: failed to convert rope into string Caused by: - invalid utf-8 sequence of 1 bytes from index 5415 Import trace: App Route: ./.freebuff/worktrees/thmrzp9vv9y86o/src/lib/api-server.ts ./.freebuff/worktrees/thmrzp9vv9y86o/src/app/api/auth/me/route.ts"
        - generic [ref=e131]: "1"
        - generic [ref=e132]: "2"
    - generic [ref=e137] [cursor=pointer]:
      - button "Open Next.js Dev Tools" [ref=e138]:
        - img [ref=e139]
      - button "Open issues overlay" [ref=e143]:
        - generic [ref=e144]:
          - generic [ref=e145]: "0"
          - generic [ref=e146]: "1"
        - generic [ref=e147]: Issue
  - alert [ref=e148]
```

# Test source

```ts
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
  155 |     await expect(page.locator("h2:has-text('Senha alterada')")).toBeVisible({ timeout: 10000 })
  156 |     await expect(page.locator("button:has-text('Ir para o login')")).toBeVisible()
  157 |   })
  158 | 
  159 |   test("botão 'Ir para o login' redireciona para home após sucesso", async ({ page }) => {
  160 |     await setupApiMocks(page)
  161 |     await page.goto(`/auth/reset-password/${VALID_TOKEN}`)
  162 |     await page.waitForLoadState("networkidle")
  163 | 
  164 |     // Preenche e submete
  165 |     await page.locator("#password").fill(NEW_PASSWORD)
  166 |     await page.locator("#confirmPassword").fill(NEW_PASSWORD)
  167 |     await page.locator('button[type="submit"]:has-text("Redefinir")').click()
  168 | 
  169 |     // Aguarda sucesso
  170 |     await expect(page.locator("button:has-text('Ir para o login')")).toBeVisible({ timeout: 10000 })
  171 | 
  172 |     // Clica no botão
  173 |     await page.locator('button:has-text("Ir para o login")').click()
  174 |     await page.waitForURL("/")
  175 |   })
  176 | })
  177 | 
  178 | // =========================================================================
  179 | // Auth Modal — Link "Esqueci a senha"
  180 | // =========================================================================
  181 | 
  182 | test.describe("Auth Modal — Link Esqueci a Senha", () => {
> 183 |   test.beforeEach(async ({ page }) => {
      |        ^ Test timeout of 30000ms exceeded while running "beforeEach" hook.
  184 |     await setupApiMocks(page)
  185 |     await page.goto("/")
  186 |     await waitForVitrine(page)
  187 |   })
  188 | 
  189 |   test("link 'Esqueci a senha' existe no modal de login", async ({ page }) => {
  190 |     // Abre modal de login
  191 |     const entrarBtn = page.getByRole("button", { name: /entrar|login/i }).first()
  192 |     await entrarBtn.click()
  193 |     await page.waitForTimeout(500)
  194 | 
  195 |     // Verifica link "Esqueci a senha"
  196 |     const forgotLink = page.locator("button:has-text('Esqueci a senha')")
  197 |     await expect(forgotLink).toBeVisible()
  198 |   })
  199 | 
  200 |   test("'Esqueci a senha' abre página de recuperação (nova aba)", async ({ page, context }) => {
  201 |     // Abre modal de login
  202 |     const entrarBtn = page.getByRole("button", { name: /entrar|login/i }).first()
  203 |     await entrarBtn.click()
  204 |     await page.waitForTimeout(500)
  205 | 
  206 |     // Intercepta window.open para verificar URL
  207 |     const [newPage] = await Promise.all([
  208 |       context.waitForEvent("page", { timeout: 5000 }).catch(() => null as any),
  209 |       page.locator("button:has-text('Esqueci a senha')").click(),
  210 |     ])
  211 | 
  212 |     if (newPage) {
  213 |       await newPage.waitForLoadState("domcontentloaded")
  214 |       expect(newPage.url()).toContain("/auth/reset-password")
  215 |       await newPage.close()
  216 |     }
  217 |   })
  218 | })
  219 | 
  220 | // =========================================================================
  221 | // Error Scenarios
  222 | // =========================================================================
  223 | 
  224 | test.describe("Cenários de Erro", () => {
  225 |   test("reset page com token expirado mostra erro no submit", async ({ page }) => {
  226 |     await setupApiMocks(page)
  227 |     await page.goto(`/auth/reset-password/${EXPIRED_TOKEN}`)
  228 |     await page.waitForLoadState("networkidle")
  229 | 
  230 |     // Preenche e submete
  231 |     await page.locator("#password").fill(NEW_PASSWORD)
  232 |     await page.locator("#confirmPassword").fill(NEW_PASSWORD)
  233 |     // Wait for React state to process
  234 |     await page.waitForTimeout(300)
  235 |     await page.locator('button[type="submit"]:has-text("Redefinir")').click()
  236 | 
  237 |     // Deve mostrar mensagem de erro (mock retorna "expirou")
  238 |     await expect(page.locator("text=/expirou|inválido/i")).toBeVisible({ timeout: 10000 })
  239 |   })
  240 | 
  241 |   test("reset page com token inválido mostra erro no submit", async ({ page }) => {
  242 |     await setupApiMocks(page)
  243 |     await page.goto(`/auth/reset-password/${INVALID_TOKEN}`)
  244 |     await page.waitForLoadState("networkidle")
  245 | 
  246 |     // Preenche e submete
  247 |     await page.locator("#password").fill(NEW_PASSWORD)
  248 |     await page.locator("#confirmPassword").fill(NEW_PASSWORD)
  249 |     await page.locator('button[type="submit"]:has-text("Redefinir")').click()
  250 | 
  251 |     // Deve mostrar mensagem de erro
  252 |     await expect(page.locator("text=/inválido|erro|Token inválido/i")).toBeVisible({ timeout: 10000 })
  253 |   })
  254 | 
  255 |   test("pode tentar novamente após erro no reset", async ({ page }) => {
  256 |     await setupApiMocks(page)
  257 |     await page.goto(`/auth/reset-password/${EXPIRED_TOKEN}`)
  258 |     await page.waitForLoadState("networkidle")
  259 | 
  260 |     // Preenche e submete
  261 |     await page.locator("#password").fill(NEW_PASSWORD)
  262 |     await page.locator("#confirmPassword").fill(NEW_PASSWORD)
  263 |     // Wait for React state to process
  264 |     await page.waitForTimeout(300)
  265 |     await page.locator('button[type="submit"]:has-text("Redefinir")').click()
  266 | 
  267 |     // Aguarda erro (mock retorna "expirou")
  268 |     await expect(page.locator("text=/expirou/i")).toBeVisible({ timeout: 10000 })
  269 | 
  270 |     // Clica "Tentar novamente"
  271 |     const retryBtn = page.locator("button:has-text('Tentar novamente')")
  272 |     await expect(retryBtn).toBeVisible()
  273 |     await retryBtn.click()
  274 | 
  275 |     // Volta ao formulário
  276 |     await expect(page.locator("#password")).toBeVisible()
  277 |   })
  278 | })
  279 | 
```