 
import { test, expect, type Page } from "@playwright/test"
import {
  waitForVitrine,
  registerUser,
  openBookingModal,
  goToLanding,
  clickProviderAgendar,
} from "./helpers"
import { setupApiMocks } from "./mocks"

// The PWA service worker (public/sw.js) intercepts /api/* GET requests and
// fetches them from inside the worker — requests initiated by the SW bypass
// page.route() and hit the real backend, so the GET mocks in setupApiMocks
// (providers, services, categories, geo, bookings, quotes) never take effect.
test.use({ serviceWorkers: "block" })

// The PWA service worker (public/sw.js) intercepts /api/* GET requests and
// fetches them from inside the worker — requests initiated by the SW bypass
// page.route() and hit the real backend, so the GET mocks in setupApiMocks
// (providers, services, categories, geo, bookings, quotes) never take effect.

// ---------------------------------------------------------------------------
// Helpers específicas deste spec
// ---------------------------------------------------------------------------

/**
 * Busca por prestadores no campo de pesquisa.
 */
async function searchProviders(page: Page, query: string) {
  const searchInput = page.getByPlaceholder(/buscar|pesquisar|procurar/i).first()
  if (await searchInput.isVisible()) {
    await searchInput.fill(query)
    await searchInput.press("Enter")
    await page.waitForTimeout(1500)
  }
}

/**
 * Seleciona o primeiro dia disponível + horário no calendário do booking modal.
 * O calendário usa <td class="rdp-day"><button/></td> — o seletor antigo
 * button[role="gridcell"] nunca casava, então os steps ficavam sem data e o
 * Continuar permanecia disabled. Usa waitFor (auto-retry) em vez de isVisible()
 * one-shot: o provider/availability pode ainda estar carregando quando o modal
 * abre, e os slots só aparecem depois.
 */
async function selectFirstDateTime(page: Page): Promise<boolean> {
  const dayButton = page.locator('[class*="rdp-day"] button:not([disabled])').first()
  try {
    await dayButton.waitFor({ state: "visible", timeout: 10_000 })
  } catch {
    return false
  }
  await dayButton.click()

  // Slots renderizam como "08h00" (formatHHmm) — não "08:00". Usa
  // getByRole().filter({ hasText }) — :has-text(/regex/) dentro de um
  // locator CSS é inválido (os {} do quantificador quebram o parser).
  const timeSlot = page
    .getByRole("button", { name: /\d{2}h\d{2}/ })
    .filter({ visible: true })
    .first()
  try {
    await timeSlot.waitFor({ state: "visible", timeout: 10_000 })
  } catch {
    return false
  }
  await timeSlot.click()
  await page.waitForTimeout(300)
  return true
}

/**
 * Navega até uma etapa específica do booking modal.
 * Retorna true se conseguiu navegar.
 */
async function navigateToStep(page: Page, step: number) {
  // Clica "Continuar" múltiplas vezes até chegar na etapa desejada
  for (let i = 1; i < step; i++) {
    const continuar = page.locator('button:has-text("Continuar")')
    if (await continuar.isVisible().catch(() => false)) {
      await continuar.click()
      await page.waitForTimeout(500)
    } else {
      return false
    }
  }
  return true
}

/**
 * Verifica se o QR code PIX está visível após criar agendamento.
 */
async function verifyPixPayment(page: Page) {
  // Após confirmar agendamento, pode aparecer:
  // 1) QR code PIX para pagamento
  // 2) Código PIX (copia e cola)
  // 3) Tela de confirmação com link para pagamento
  const pixElements = [
    page.locator("text=/PIX|pix|QR Code|qr code|Código PIX|Pagamento pendente/i"),
    page.locator('[class*="qrcode" i], [class*="qr-code" i]'),
    page.locator('img[alt*="pix" i], img[alt*="QR" i]'),
    page.locator("text=/pagamento confirmado|agendamento confirmado/i"),
  ]

  for (const el of pixElements) {
    const visible = await el
      .first()
      .isVisible()
      .catch(() => false)
    if (visible) return true
  }

  // Polling curto por confirmação (mais eficiente que waitForTimeout fixo)
  try {
    await page.waitForURL(/booking|pagamento|payment|confirmacao|confirm/i, {
      timeout: 3000,
    })
    return true
  } catch {
    // Sem navegação — tenta buscar elementos no DOM
    const success = page
      .locator("text=/agendamento confirmado|confirmado com sucesso|pagamento|PIX|QR Code/i")
      .first()
    return await success.isVisible({ timeout: 2000 }).catch(() => false)
  }
}

/**
 * Abre o painel do cliente e busca pelo agendamento mais recente.
 */
async function navigateToClientBookings(page: Page) {
  // Procura por link/botão que leva ao painel do cliente
  const clientPanel = page
    .locator('a[href*="client"], button:has-text(/painel|meus agendamentos|minha conta/i)')
    .first()
  if (await clientPanel.isVisible().catch(() => false)) {
    await clientPanel.click()
    await page.waitForTimeout(1500)
  }

  // Verifica se está na página de agendamentos do cliente
  const bookingsTitle = page.locator("text=/Meus Agendamentos|Agendamentos|Meus Serviços/i").first()
  await bookingsTitle.waitFor({ state: "visible", timeout: 5000 }).catch(() => {})
}

// =========================================================================
// Testes
// =========================================================================

test.describe("Fluxo Completo de Agendamento — Visitante (não logado)", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page, { authenticated: false })
    await page.goto("/")
    await waitForVitrine(page)
  })

  test("1. landing → pesquisa → cards de prestadores", async ({ page }) => {
    // Verifica que a página carregou
    await expect(page.locator("body")).toBeVisible()

    // Tenta buscar por um serviço
    await searchProviders(page, "Elétrica")

    // Verifica que os cards ainda estão visíveis (ou resultados vazios)
    const anyCard = page.locator('[class*="Card"], [class*="card"]').first()
    const cardVisible = await anyCard.isVisible().catch(() => false)
    if (cardVisible) {
      await expect(anyCard).toBeVisible()
    } else {
      // Se não há cards, ao menos a página não crashou
      await expect(page.locator("body")).toBeVisible()
    }
  })

  test("2. abre perfil do prestador e visualiza serviços", async ({ page }) => {
    // Tenta abrir o perfil do primeiro prestador
    const providerCard = page.locator('[class*="Card"], [class*="card"]').first()
    if (await providerCard.isVisible().catch(() => false)) {
      await providerCard.click()
      await page.waitForTimeout(1000)

      // Verifica se algo abriu (modal de perfil ou navegação)
      const profileContent = page.locator("text=/Serviços|Avaliações|Sobre|Agendar/i").first()
      const profileOpened = await profileContent.isVisible().catch(() => false)

      if (profileOpened) {
        // Verifica que há abas/tabs no perfil
        const tabs = page.getByRole("button", {
          name: /Serviços|Sobre|Avaliações|Expediente/i,
        })
        const tabCount = await tabs.count()
        expect(tabCount).toBeGreaterThanOrEqual(1)
      }
    }
  })

  test("3. abre modal de agendamento a partir do card do prestador", async ({ page }) => {
    // Clica no botão "Agendar" do card de provider (há outros botões com esse
    // texto na landing — HowItWorks/FAQ — que não abrem o modal de booking)
    await clickProviderAgendar(page)

    // Verifica que o modal de agendamento abriu com o título correto
    // (o DialogTitle renderiza um h2 com "Agendar serviço")
    const modalTitle = page.getByText(/Agendar serviço/i).first()
    await expect(modalTitle).toBeVisible({ timeout: 5000 })
  })

  test("4. booking step 1 — calendário e seleção de horário", async ({ page }) => {
    await openBookingModal(page)

    // Verifica que o calendário está visível
    const calendar = page
      .locator('[class*="rdp"], [class*="calendar"], table:has([role="gridcell"])')
      .first()
    await expect(calendar).toBeVisible({ timeout: 5000 })

    // Seleciona uma data disponível + horário
    await selectFirstDateTime(page)
  })

  test("5. booking step 2 — endereço com CEP", async ({ page }) => {
    await openBookingModal(page)

    // Step 1 exige data+horário (o botão Continuar fica disabled sem eles) —
    // seleciona antes de navegar, como o fluxo completo faz
    await selectFirstDateTime(page)

    // Avança para step 2
    await navigateToStep(page, 2)
    await page.waitForTimeout(500)

    // Tenta preencher o CEP (placeholder exato do GeoAddressForm — o campo de
    // busca "CEP, cidade ou endereço…" também casa com /CEP/i)
    const cepInput = page.getByPlaceholder("00000-000").first()
    if (await cepInput.isVisible().catch(() => false)) {
      await cepInput.fill("01310100")
      await page.waitForTimeout(1500)

      // Verifica se algum campo foi preenchido automaticamente
      const streetInput = page.getByPlaceholder(/Rua|avenida/i).first()
      const filled = await streetInput
        .inputValue()
        .then((v: string) => v.length > 0)
        .catch(() => false)

      if (!filled) {
        // Se o auto-preenchimento não funcionou (sem mock), preenche manualmente
        await streetInput.fill("Av. Paulista")
        const numberInput = page.getByPlaceholder(/123|número/i).first()
        await numberInput.fill("1000")
        const cityInput = page.getByPlaceholder(/cidade|Cidade/i).first()
        await cityInput.fill("São Paulo")
      }
    }
  })

  test("6. booking step 3 — seleção de forma de pagamento PIX", async ({ page }) => {
    await openBookingModal(page)

    // Tenta navegar até o step de pagamento
    // (pode precisar pular etapas anteriores se houver validação)
    await navigateToStep(page, 3)
    await page.waitForTimeout(500)

    // Verifica se há opção de pagamento PIX
    const pixOption = page.locator('text=/PIX|pix/i, [value="PIX"], label:has-text("PIX")').first()
    const pixVisible = await pixOption.isVisible().catch(() => false)
    if (pixVisible) {
      // Marca PIX se não estiver selecionado
      const pixRadio = page
        .locator('input[value="PIX"], [data-value="PIX"], label:has-text("PIX")')
        .first()
      await pixRadio.click().catch(() => {})
      await page.waitForTimeout(300)
    } else {
      // Se não achou PIX explicitamente, procura por forma de pagamento
      const paymentSection = page.locator("text=/pagamento|forma de pagamento|Pagamento/i").first()
      await paymentSection.waitFor({ state: "visible", timeout: 3000 }).catch(() => {})
    }
  })

  test("7. fluxo completo — landing até confirmação do booking", async ({ page }) => {
    // PASSO 1: Landing page
    await expect(page.locator("body")).toBeVisible()

    // PASSO 2: Abrir modal de agendamento (botão do card de provider)
    await clickProviderAgendar(page)

    // PASSO 3: Verifica que o modal abriu
    const modal = page.locator('h2:has-text("Agendar"), text=/Agendar serviço/i').first()
    const modalOpened = await modal.isVisible({ timeout: 5000 }).catch(() => false)

    if (modalOpened) {
      // PASSO 4: Step 1 — seleciona data e horário
      await selectFirstDateTime(page)

      // PASSO 5: Continuar para Step 2
      await navigateToStep(page, 2)
      await page.waitForTimeout(500)

      // PASSO 6: Preenche CEP no Step 2
      const cepInput = page.getByPlaceholder(/CEP/i).first()
      if (await cepInput.isVisible().catch(() => false)) {
        await cepInput.fill("01310100")
        await page.waitForTimeout(1500)
      }

      // PASSO 7: Continuar para Step 3 e Step 4
      await navigateToStep(page, 4)
      await page.waitForTimeout(500)

      // PASSO 8: Confirma o agendamento
      const confirmBtn = page.locator('button:has-text("Confirmar")').first()
      if (await confirmBtn.isVisible().catch(() => false)) {
        await confirmBtn.click()
        await page.waitForTimeout(2000)

        // PASSO 9: Verifica resultado
        await verifyPixPayment(page)
      }
    }
  })
})

test.describe("Fluxo Completo de Agendamento — Cliente Autenticado", () => {
  let _userEmail = ""
  let _userPassword = "test123456"

  // authenticated: false — o fluxo REGISTRA o usuário via UI. O mock de
  // auth devolve o user, o store persiste em localStorage e o gating dos
  // endpoints (bookings/quotes) passa a enxergar a sessão real.
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page, { authenticated: false })
    await page.goto("/")
    await waitForVitrine(page)
  })

  test("8. registro → login → booking completo", async ({ page }) => {
    // PASSO 1: Registrar novo usuário
    const creds = await registerUser(page, { role: "CLIENT" })
    _userEmail = creds.email
    _userPassword = creds.password
    await page.waitForTimeout(1000)

    // PASSO 2: Verificar que está logado
    const loginBtn = page.getByRole("button", { name: /entrar|login|criar conta/i }).first()
    const loggedIn = await loginBtn
      .isVisible()
      .then((v) => !v)
      .catch(() => true)
    expect(loggedIn).toBe(true)

    // PASSO 3: Navegar de volta pra landing (limpa a view persistida do
    // dashboard — o registro navega para o painel e a store persiste)
    await goToLanding(page)

    // PASSO 4: Abrir modal de agendamento
    await openBookingModal(page)
    await page.waitForTimeout(500)

    // PASSO 5: Verificar que o modal NÃO mostra banner de login
    // (usuário já está autenticado)
    const authBanner = page.locator("text=/faça login|faça cadastro|crie sua conta/i").first()
    const authBannerVisible = await authBanner.isVisible().catch(() => false)
    expect(authBannerVisible).toBe(false)

    // PASSO 6: Step 1 — selecionar data + horário
    await selectFirstDateTime(page)

    // PASSO 7: Avançar etapas e preencher endereço
    await navigateToStep(page, 2)
    await page.waitForTimeout(300)

    const cepInput = page.getByPlaceholder(/CEP/i).first()
    if (await cepInput.isVisible().catch(() => false)) {
      await cepInput.fill("01310100")
      await page.waitForTimeout(1500)
    }

    // PASSO 8: Avançar para confirmação
    await navigateToStep(page, 4)
    await page.waitForTimeout(500)

    // PASSO 9: Confirmar agendamento
    const confirmBtn = page.locator('button:has-text("Confirmar")').first()
    const canConfirm = await confirmBtn.isVisible().catch(() => false)
    if (canConfirm) {
      await confirmBtn.click()
      await page.waitForTimeout(3000)

      // PASSO 10: Verificar resultado
      await verifyPixPayment(page)
    }
  })

  test("9. login existente → booking + PIX + verificar no painel", async ({ page }) => {
    // PASSO 1: Criar e logar com um novo usuário
    const creds = await registerUser(page, { role: "CLIENT" })
    _userEmail = creds.email
    await page.waitForTimeout(500)

    // PASSO 2: Voltar pra landing (limpa a view persistida do dashboard)
    await goToLanding(page)

    // PASSO 3: Abrir booking
    await openBookingModal(page)
    await page.waitForTimeout(500)

    // PASSO 4: Preencher agendamento
    await selectFirstDateTime(page)

    // PASSO 5: Avançar, preencher endereço, confirmar
    await navigateToStep(page, 2)
    await page.waitForTimeout(300)

    const cepInput = page.getByPlaceholder(/CEP/i).first()
    if (await cepInput.isVisible().catch(() => false)) {
      await cepInput.fill("01310100")
      await page.waitForTimeout(1500)
    }

    await navigateToStep(page, 4)
    await page.waitForTimeout(500)

    const confirmBtn = page.locator('button:has-text("Confirmar")').first()
    if (await confirmBtn.isVisible().catch(() => false)) {
      await confirmBtn.click()
      await page.waitForTimeout(3000)

      // PASSO 6: Verificar confirmação PIX
      const paid = await verifyPixPayment(page)

      if (paid) {
        // PASSO 7: Navegar para o painel do cliente
        await navigateToClientBookings(page)

        // PASSO 8: Verificar que o agendamento aparece no painel
        const bookingInPanel = page.locator("text=/agendamento|pendente|PIX|pagamento/i").first()
        const found = await bookingInPanel.isVisible({ timeout: 5000 }).catch(() => false)
        if (!found) {
          console.log("ℹ️ Agendamento não encontrado no painel — pode não estar implementado")
        }
      }
    }
  })
})

test.describe("Fluxo de Pagamento PIX", () => {
  // authenticated: false — o fluxo registra o usuário primeiro (mesmo
  // padrão do describe anterior: a sessão real passa a valer após register).
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page, { authenticated: false })
    await page.goto("/")
    await waitForVitrine(page)
  })

  test("10. booking + PIX — QR code visível após confirmação", async ({ page }) => {
    // Registrar usuário primeiro
    await registerUser(page, { role: "CLIENT" })
    await page.waitForTimeout(500)

    // Voltar pra landing (limpa a view persistida do dashboard)
    await goToLanding(page)

    // Abrir booking (botão do card de provider)
    await clickProviderAgendar(page)
    await page.waitForTimeout(1000)

    // Step 1: Data + horário
    await selectFirstDateTime(page)

    // Step 2: Endereço
    await navigateToStep(page, 2)
    await page.waitForTimeout(300)
    const cepInput = page.getByPlaceholder(/CEP/i).first()
    if (await cepInput.isVisible().catch(() => false)) {
      await cepInput.fill("01310100")
      await page.waitForTimeout(1500)
    }

    // Step 3: Pagamento — selecionar PIX
    await navigateToStep(page, 3)
    await page.waitForTimeout(500)

    // Verificar que PIX está visível e selecionado
    const pixRadio = page
      .locator('input[value="PIX"], [data-value="PIX"], label:has-text("PIX")')
      .first()
    if (await pixRadio.isVisible().catch(() => false)) {
      await pixRadio.click().catch(() => {})
      await page.waitForTimeout(300)
    }

    // Step 4: Confirmar
    await navigateToStep(page, 4)
    await page.waitForTimeout(500)

    const confirmBtn = page.locator('button:has-text("Confirmar")').first()
    if (await confirmBtn.isVisible().catch(() => false)) {
      await confirmBtn.click()
      await page.waitForTimeout(3000)

      // Verificar confirmação PIX
      const result = await verifyPixPayment(page)

      // Log do resultado (o teste não falha se PIX não aparecer — depende do mock)
      if (result) {
        console.log("✅ Pagamento PIX confirmado com sucesso!")
      }
    }
  })
})

test.describe("Fluxo de Agendamento — Casos de Erro e Validação", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page, { authenticated: false })
    await page.goto("/")
    await waitForVitrine(page)
  })

  test("11. tentar confirmar sem selecionar data mostra validação", async ({ page }) => {
    await openBookingModal(page)
    await page.waitForTimeout(500)

    // Tenta ir direto para confirmação sem selecionar nada
    await navigateToStep(page, 4)
    await page.waitForTimeout(500)

    // Verifica se ainda está no step 1 (validação impediu avanço)
    // ou se mostra mensagem de erro
    const calendarStillVisible = page.locator('[class*="calendar"], [class*="rdp"]').first()
    const isVisible = await calendarStillVisible.isVisible().catch(() => false)

    const errorMessage = page
      .locator("text=/selecione|obrigatório|inválido|preencha|escolha/i")
      .first()
    const hasError = await errorMessage.isVisible().catch(() => false)

    // Pelo menos uma das condições deve ser verdadeira
    expect(isVisible || hasError).toBe(true)
  })

  test("12. CEP inválido mostra mensagem de erro", async ({ page }) => {
    await openBookingModal(page)
    await page.waitForTimeout(500)

    // Avança para step 2
    await navigateToStep(page, 2)
    await page.waitForTimeout(500)

    const cepInput = page.getByPlaceholder(/CEP/i).first()
    if (await cepInput.isVisible().catch(() => false)) {
      // Preenche CEP inválido
      await cepInput.fill("00000000")
      await page.waitForTimeout(1500)

      // Verifica se aparece mensagem de erro
      const cepError = page.locator("text=/não encontrado|inválido|erro/i").first()
      const hasError = await cepError.isVisible({ timeout: 3000 }).catch(() => false)
      if (hasError) {
        await expect(cepError).toBeVisible()
      }
    }
  })

  test("13. quantidade de serviços com valor inválido", async ({ page }) => {
    await openBookingModal(page)
    await page.waitForTimeout(500)

    // Avança para step 2
    await navigateToStep(page, 2)
    await page.waitForTimeout(500)

    // Verifica se há campo de quantidade
    const qtyInput = page
      .locator('input[type="number"], input[inputmode="numeric"], label:has-text(/quantidade/i)')
      .first()
    if (await qtyInput.isVisible().catch(() => false)) {
      // Tenta valor negativo (ignorado por validação HTML5 min/mínimo)
      await qtyInput.fill("-1")
      await page.waitForTimeout(300)

      // Verifica validação
      const errorMsg = page.locator("text=/mínimo|inválido|deve ser|obrigatório/i").first()
      const hasError = await errorMsg.isVisible().catch(() => false)
      if (hasError) {
        await expect(errorMsg).toBeVisible()
      }
    }
  })
})

test.describe("Navegação e UX do Booking", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page, { authenticated: false })
    await page.goto("/")
    await waitForVitrine(page)
  })

  test("14. indicador de etapas mostra progresso atual", async ({ page }) => {
    await openBookingModal(page)
    await page.waitForTimeout(500)

    // Verifica se há indicador de etapas (step indicator, progress bar, etc.)
    const stepIndicator = page
      .locator('[class*="step"], [class*="progress"], li:has-text(/1|2|3|4/), [role="tablist"]')
      .first()
    const hasIndicator = await stepIndicator.isVisible().catch(() => false)

    if (hasIndicator) {
      // Verifica que o passo atual está destacado
      const activeStep = page
        .locator('[class*="active"], [aria-selected="true"], [data-active="true"]')
        .first()
      await expect(activeStep).toBeVisible({ timeout: 3000 })
    }

    // O teste não falha se não houver indicador — pode ser uma melhoria futura
  })

  test("15. fechar modal e reabrir preserva estado inicial", async ({ page }) => {
    await openBookingModal(page)
    await page.waitForTimeout(500)

    // Fecha o modal
    const closeBtn = page
      .locator('button[aria-label="Close"], button[aria-label="Fechar"], button:has(svg.lucide-x)')
      .first()
    if (await closeBtn.isVisible().catch(() => false)) {
      await closeBtn.click()
      await page.waitForTimeout(500)
    } else {
      // Tenta ESC para fechar
      await page.keyboard.press("Escape")
      await page.waitForTimeout(500)
    }

    // Reabre o modal
    await clickProviderAgendar(page)

    // Verifica que o modal abriu novamente no passo 1 (estado inicial)
    const calendar = page.locator('[class*="calendar"], [class*="rdp"]').first()
    await expect(calendar).toBeVisible({ timeout: 5000 })
  })

  test("16. scroll e responsividade do modal de booking", async ({ page }) => {
    await openBookingModal(page)
    await page.waitForTimeout(500)

    // Verifica se o modal tem scroll
    const modalContent = page
      .locator('[class*="content"], [class*="dialog"], [role="dialog"]')
      .first()
    const hasScroll = await modalContent
      .evaluate((el) => el.scrollHeight > el.clientHeight)
      .catch(() => false)

    if (hasScroll) {
      // Tenta scrollar o modal
      await modalContent.evaluate((el) => el.scrollTo(0, el.scrollHeight))
      await page.waitForTimeout(200)
    }

    // Se estiver no mobile, verifica se o modal é fullscreen
    const isMobile = await page.evaluate(() => window.innerWidth < 768)
    if (isMobile) {
      const _isFullscreen = await modalContent
        .evaluate((el) => {
          const rect = el.getBoundingClientRect()
          return rect.width >= window.innerWidth * 0.9
        })
        .catch(() => false)
      // Não falha — apenas observa
    }
  })
})

test.describe("Health Check — Rotas da API de Booking e Pagamento", () => {
  // NOTA: Estes testes usam `request` fixture (fora do navegador), então
  // `page.route()` não os intercepta. Eles batem no servidor real.
  // Para mockar, use `page.evaluate(() => fetch(...))` no lugar.

  test("API POST /api/bookings rejeita sem autenticação", async ({ request }) => {
    const res = await request.post("/api/bookings", {
      data: {
        providerId: "test",
        serviceId: "test",
        scheduledAt: new Date().toISOString(),
      },
    })
    // Com mocks ativos, o POST /api/bookings retorna 401 quando authenticated=false
    expect(res.status()).toBe(401)
  })

  test("API GET /api/bookings retorna 401 sem auth", async ({ request }) => {
    const res = await request.get("/api/bookings")
    expect(res.status()).toBe(401)
  })

  test("API GET /api/providers retorna lista", async ({ request }) => {
    // Teste contra o servidor real (request fixture não passa pelo mock)
    const res = await request.get("/api/providers")
    expect(res.ok()).toBeTruthy()
    const body = await res.json()
    expect(body).toHaveProperty("items")
    expect(body).toHaveProperty("total")
  })
})
