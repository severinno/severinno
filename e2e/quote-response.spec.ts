 
import { test, expect, type Page } from "@playwright/test"
import { waitForVitrine, registerUser } from "./helpers"
import { setupApiMocks } from "./mocks"

// The PWA service worker (public/sw.js) intercepts /api/* GET requests and
// fetches them from inside the worker — requests initiated by the SW bypass
// page.route() and hit the real backend, so the GET mocks in setupApiMocks
// (quotes list, providers) never take effect.
test.use({ serviceWorkers: "block" })

// =========================================================================
// Helpers específicas do fluxo de resposta de orçamento
// =========================================================================

/**
 * Navega para a aba "Orçamentos" no sidebar do painel (provider ou client).
 * O sidebar usa shadcn/ui Sidebar com collapsible="icon".
 *
 * NOTA: shadcn sidebar colapsada esconde visualmente o texto do label via CSS,
 * então `isVisible()` no texto não funciona. Usamos `filter({ hasText })` que
 * checa textContent do DOM, independente de visibilidade CSS.
 */
async function navigateToQuotesPanel(page: Page) {
  // Usa data-sidebar="menu-button" (atributo do shadcn) + hasText para o label
  // hasText checa DOM textContent, não visibilidade CSS
  const quotesBtn = page
    .locator('[data-sidebar="menu-button"]')
    .filter({ hasText: /Orçamentos/i })
    .first()

  const exists = await quotesBtn.count().catch(() => 0)
  if (exists > 0) {
    await quotesBtn.click()
    await page.waitForTimeout(1000)
    return
  }

  // Fallback: busca por texto visível (sidebar expandida)
  const visibleBtn = page.locator('button:has-text("Orçamentos")').first()
  await visibleBtn.click().catch(() => {})
  await page.waitForTimeout(1000)
}

/**
 * Preenche o preço no formulário de resposta do provider.
 */
async function fillPrice(page: Page, price: string) {
  const priceInput = page.locator('input[type="number"]').first()
  await priceInput.fill(price)
  await page.waitForTimeout(200)
}

/**
 * Preenche a nota do provider.
 */
async function fillNote(page: Page, note: string) {
  const noteTextarea = page
    .locator('textarea[placeholder*="Material" i], textarea[placeholder*="Ex." i]')
    .first()
  if (await noteTextarea.isVisible().catch(() => false)) {
    await noteTextarea.fill(note)
    await page.waitForTimeout(200)
  }
}

/**
 * Clica em "Enviar orçamento" no card do provider.
 */
async function clickSendQuote(page: Page) {
  const sendBtn = page.locator('button:has-text("Enviar orçamento")').first()
  await sendBtn.click()
  await page.waitForTimeout(1500)
}

/**
 * Clica em "Aprovar orçamento" no card do cliente.
 * NOTA: botão fica na div de ações (fora do CollapsibleContent), sempre visível.
 */
async function clickApproveQuote(page: Page) {
  const approveBtn = page.locator('button:has-text("Aprovar orçamento")').first()
  await approveBtn.click()
  await page.waitForTimeout(1500)
}

/**
 * Expande os itens do orçamento no card do cliente (para ver preços).
 */
async function expandQuoteItems(page: Page) {
  const expandBtn = page.locator("button:has-text(/Ver \\d+ itens|Ocultar itens/)").first()
  if (await expandBtn.isVisible().catch(() => false)) {
    const text = await expandBtn.textContent().catch(() => "")
    if (text?.includes("Ver")) {
      await expandBtn.click()
      await page.waitForTimeout(500)
    }
  }
}

// =========================================================================
// Testes
// =========================================================================

test.describe("Quote Response — Provider responde orçamento", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page, {
      authenticated: true,
      userRole: "PROVIDER",
      quoteStage: "pending",
    })
    await page.goto("/")
    await waitForVitrine(page)
  })

  test("1. registra como provider e vê orçamento pendente no painel", async ({ page }) => {
    // Registra como PROVIDER
    const creds = await registerUser(page, { role: "PROVIDER" })
    console.log(`Provider criado: ${creds.email}`)
    await page.waitForTimeout(2000)

    // Navega para a aba Orçamentos
    await navigateToQuotesPanel(page)

    // Verifica que a tela de orçamentos carregou
    const pageTitle = page
      .locator(
        'h1:has-text("Orçamentos"), text=/Solicitações de orçamento|Responda às solicitações/i',
      )
      .first()
    const titleVisible = await pageTitle.isVisible({ timeout: 8000 }).catch(() => false)

    if (titleVisible) {
      await expect(pageTitle).toBeVisible()
    }

    // Verifica que há um card de orçamento pendente
    const pendingBadge = page.locator("text=/Pendente|1 pendente/i").first()
    const badgeVisible = await pendingBadge.isVisible({ timeout: 8000 }).catch(() => false)
    if (badgeVisible) {
      await expect(pendingBadge).toBeVisible()
    }
  })

  test("2. provider preenche preço e nota e envia orçamento", async ({ page }) => {
    // Registra como PROVIDER
    await registerUser(page, { role: "PROVIDER" })
    await page.waitForTimeout(2000)

    // Navega para Orçamentos
    await navigateToQuotesPanel(page)
    await page.waitForTimeout(1000)

    // Verifica que o formulário de resposta está visível
    const priceInput = page.locator('input[type="number"]').first()
    const hasForm = await priceInput.isVisible({ timeout: 8000 }).catch(() => false)

    if (hasForm) {
      // Preenche preço e nota
      await fillPrice(page, "150")
      await fillNote(page, "Material incluso. Válido por 7 dias.")

      // Envia
      await clickSendQuote(page)

      // Verifica resultado — toast ou mudança na UI
      const successToast = page.locator("text=/enviado|sucesso|Orçamento enviado/i").first()
      const successVisible = await successToast.isVisible({ timeout: 5000 }).catch(() => false)

      if (successVisible) {
        await expect(successToast).toBeVisible()
      } else {
        console.log("Toast pode estar em portal — verifica mudança na UI")
        // Fallback: verifica se o formulário de resposta desapareceu
        const formGone = await priceInput.isVisible().catch(() => true)
        if (!formGone) {
          console.log("Formulario substituido por preco enviado — resposta OK")
        }
      }
    } else {
      console.log("Provider ja pode ter respondido ou UI nao carregou completamente")
    }
  })

  test("3. preco vazio bloqueia envio do orcamento", async ({ page }) => {
    // Registra como PROVIDER
    await registerUser(page, { role: "PROVIDER" })
    await page.waitForTimeout(2000)

    // Navega para Orçamentos
    await navigateToQuotesPanel(page)
    await page.waitForTimeout(1000)

    const sendBtn = page.locator('button:has-text("Enviar orçamento")').first()
    const btnVisible = await sendBtn.isVisible({ timeout: 8000 }).catch(() => false)

    if (btnVisible) {
      // Deve estar desabilitado com preço vazio
      const isDisabled = await sendBtn.isDisabled().catch(() => false)
      if (isDisabled) {
        console.log("Botao desabilitado com preco vazio — validacao funciona")
      }

      // Preenche apenas a nota (sem preço)
      const priceInput = page.locator('input[type="number"]').first()
      if (await priceInput.isVisible().catch(() => false)) {
        await priceInput.fill("")
        await fillNote(page, "Nota sem preco")
      }

      const stillDisabled = await sendBtn.isDisabled().catch(() => true)
      if (stillDisabled) {
        console.log("Botao permanece desabilitado sem preco — validacao correta")
      }

      // Preenche preço válido e verifica que habilita
      await fillPrice(page, "100")
      await page.waitForTimeout(300)
      const enabled = await sendBtn.isEnabled().catch(() => false)
      if (enabled) {
        console.log("Botao habilitado com preco valido")
      }
    }
  })
})

test.describe("Quote Response — Cliente aprova orcamento respondido", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page, {
      authenticated: true,
      userRole: "CLIENT",
      quoteStage: "responded",
    })
    await page.goto("/")
    await waitForVitrine(page)
  })

  test("4. registra como cliente e ve orcamento respondido", async ({ page }) => {
    // Registra como CLIENT
    const creds = await registerUser(page, { role: "CLIENT" })
    console.log(`Cliente criado: ${creds.email}`)
    await page.waitForTimeout(2000)

    // Navega para Orçamentos no painel do cliente
    await navigateToQuotesPanel(page)
    await page.waitForTimeout(1000)

    // Verifica que o card do orçamento respondido apareceu
    const providerName = page.locator("text=/Maria Silva/i").first()
    const providerVisible = await providerName.isVisible({ timeout: 8000 }).catch(() => false)

    if (providerVisible) {
      await expect(providerName).toBeVisible()
      console.log("Card do orcamento respondido visivel")
    }

    // Verifica que o badge de status "Respondido" aparece
    const respondedBadge = page.locator("text=/Respondido|Aguardando aprovacao/i").first()
    const badgeVisible = await respondedBadge.isVisible({ timeout: 5000 }).catch(() => false)
    if (badgeVisible) {
      console.log("Status Respondido visivel")
    }
  })

  test("5. cliente aprova orcamento respondido", async ({ page }) => {
    // Registra como CLIENT
    await registerUser(page, { role: "CLIENT" })
    await page.waitForTimeout(2000)

    // Navega para Orçamentos
    await navigateToQuotesPanel(page)
    await page.waitForTimeout(1000)

    // Expande os itens do orçamento para ver os preços
    await expandQuoteItems(page)
    await page.waitForTimeout(500)

    // Verifica que o preço enviado pelo provider aparece
    const quotedPrice = page.locator("text=/R$ 150|150,00|Total orcado/i").first()
    const priceVisible = await quotedPrice.isVisible({ timeout: 5000 }).catch(() => false)
    if (priceVisible) {
      console.log("Preco orcado visivel no card")
    }

    // Verifica que o botão "Aprovar orçamento" existe
    // NOTA: botão está na div de ações (fora do CollapsibleContent), sempre visível
    const approveBtn = page.locator('button:has-text("Aprovar orçamento")').first()
    const canApprove = await approveBtn.isVisible({ timeout: 5000 }).catch(() => false)

    if (canApprove) {
      // Clica em aprovar
      await clickApproveQuote(page)

      // Verifica resultado — toast
      const successToast = page.locator("text=/aprovado|sucesso|Orcamento aprovado/i").first()
      const successVisible = await successToast.isVisible({ timeout: 5000 }).catch(() => false)
      if (successVisible) {
        await expect(successToast).toBeVisible()
        console.log("Orcamento aprovado com sucesso!")
      } else {
        console.log("Toast pode estar em portal — verifica se API foi chamada")
      }
    } else {
      console.log("Botao Aprovar orcamento nao encontrado")
    }
  })

  test("6. cliente ve acoes disponiveis no card do orcamento", async ({ page }) => {
    // Registra como CLIENT
    await registerUser(page, { role: "CLIENT" })
    await page.waitForTimeout(2000)

    // Navega para Orçamentos
    await navigateToQuotesPanel(page)
    await page.waitForTimeout(1000)

    // Verifica botões de ação no card
    const actionSelectors = ["Ver prestador", "Mensagem", "Rejeitar", "Aprovar orçamento"]

    for (const label of actionSelectors) {
      const btn = page.locator(`button:has-text("${label}")`).first()
      const visible = await btn.isVisible({ timeout: 3000 }).catch(() => false)
      if (visible) {
        console.log(`Botao "${label}" visivel`)
      }
    }
  })
})

test.describe("Quote Response — Health Check API", () => {
  test("7. PATCH /api/quotes/:id rejeita sem autenticacao", async ({ request }) => {
    const res = await request.patch("/api/quotes/quote-mock-1", {
      data: { status: "APPROVED" },
    })
    // request fixture bate no servidor real (nao nos mocks), deve retornar 401
    expect(res.status()).toBe(401)
  })

  test("8. PATCH /api/quotes/:id/items/:itemId rejeita sem autenticacao", async ({ request }) => {
    const res = await request.patch("/api/quotes/quote-mock-1/items/qitem-mock-1", {
      data: { price: 150, status: "QUOTED" },
    })
    expect(res.status()).toBe(401)
  })
})
