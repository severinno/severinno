# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: reset-password.spec.ts >> Cenários de Erro >> reset page com token expirado mostra erro no submit
- Location: e2e\reset-password.spec.ts:225:7

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: locator.click: Test timeout of 30000ms exceeded.
Call log:
  - waiting for locator('button[type="submit"]:has-text("Redefinir")')
    - locator resolved to <button type="submit" class="mt-2 flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 text-sm font-medium text-white transition-all hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50">Redefinir senha</button>
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
    22 × waiting for element to be visible, enabled and stable
       - element is visible, enabled and stable
       - scrolling into view if needed
       - done scrolling
       - <nextjs-portal></nextjs-portal> from <script data-nextjs-dev-overlay="true">…</script> subtree intercepts pointer events
     - retrying click action
       - waiting 500ms

```

# Page snapshot

```yaml
- generic [ref=e1]:
  - generic [ref=e3]:
    - generic [ref=e4]:
      - img [ref=e6]
      - heading "Redefinir senha" [level=1] [ref=e9]
      - paragraph [ref=e10]: Escolha uma nova senha para sua conta
    - generic [ref=e11]:
      - generic [ref=e12]:
        - text: Nova senha
        - generic [ref=e13]:
          - img
          - textbox "Nova senha" [ref=e14]:
            - /placeholder: Mínimo 6 caracteres
            - text: novaSenha123
          - button "Mostrar senha" [ref=e15]:
            - img [ref=e16]
      - generic [ref=e19]:
        - text: Confirmar senha
        - generic [ref=e20]:
          - img
          - textbox "Confirmar senha" [active] [ref=e21]:
            - /placeholder: Repita a senha
            - text: novaSenha123
      - button "Redefinir senha" [ref=e22]
  - region "Notifications alt+T"
  - generic:
    - generic [ref=e25]:
      - generic [ref=e26]:
        - generic [ref=e27]:
          - navigation [ref=e28]:
            - button "previous" [disabled] [ref=e29]:
              - img "previous" [ref=e30]
            - generic [ref=e32]:
              - generic [ref=e33]: 1/
              - text: "1"
            - button "next" [disabled] [ref=e34]:
              - img "next" [ref=e35]
          - img
        - generic [ref=e37]:
          - link "Next.js 16.1.3 (stale) Turbopack" [ref=e38] [cursor=pointer]:
            - /url: https://nextjs.org/docs/messages/version-staleness
            - img [ref=e39]
            - generic "There is a newer version (16.2.11) available, upgrade recommended!" [ref=e41]: Next.js 16.1.3 (stale)
            - generic [ref=e42]: Turbopack
          - img
      - dialog "Build Error" [ref=e44]:
        - generic [ref=e47]:
          - generic [ref=e48]:
            - generic [ref=e49]:
              - generic [ref=e51]: Build Error
              - generic [ref=e52]:
                - button "Copy Error Info" [ref=e53] [cursor=pointer]:
                  - img [ref=e54]
                - button "No related documentation found" [disabled] [ref=e56]:
                  - img [ref=e57]
                - button "Attach Node.js inspector" [ref=e59] [cursor=pointer]:
                  - img [ref=e60]
            - generic [ref=e69]: Reading source code for parsing failed
          - generic [ref=e71]:
            - generic [ref=e73]:
              - img [ref=e75]
              - generic [ref=e79]: ./.freebuff/worktrees/thmrzp9vv9y86o/src/lib/api-server.ts
              - button "Open in editor" [ref=e80] [cursor=pointer]:
                - img [ref=e82]
            - generic [ref=e86]: "Reading source code for parsing failed An unexpected error happened while trying to read the source code to parse: failed to convert rope into string Caused by: - invalid utf-8 sequence of 1 bytes from index 5415 Import trace: App Route: ./.freebuff/worktrees/thmrzp9vv9y86o/src/lib/api-server.ts ./.freebuff/worktrees/thmrzp9vv9y86o/src/app/api/auth/me/route.ts"
        - generic [ref=e87]: "1"
        - generic [ref=e88]: "2"
    - generic [ref=e93] [cursor=pointer]:
      - button "Open Next.js Dev Tools" [ref=e94]:
        - img [ref=e95]
      - button "Open issues overlay" [ref=e99]:
        - generic [ref=e100]:
          - generic [ref=e101]: "0"
          - generic [ref=e102]: "1"
        - generic [ref=e103]: Issue
  - alert [ref=e104]
```

# Test source

```ts
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
  183 |   test.beforeEach(async ({ page }) => {
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
> 235 |     await page.locator('button[type="submit"]:has-text("Redefinir")').click()
      |                                                                       ^ Error: locator.click: Test timeout of 30000ms exceeded.
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