# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: booking-flow.spec.ts >> Health Check — Rotas da API de Booking e Pagamento >> API GET /api/providers retorna lista
- Location: e2e\booking-flow.spec.ts:769:7

# Error details

```
Error: expect(received).toBeTruthy()

Received: false
```

# Test source

```ts
  672 | 
  673 |     if (hasIndicator) {
  674 |       // Verifica que o passo atual está destacado
  675 |       const activeStep = page.locator(
  676 |         '[class*="active"], [aria-selected="true"], [data-active="true"]',
  677 |       ).first()
  678 |       await expect(activeStep).toBeVisible({ timeout: 3000 })
  679 |     }
  680 | 
  681 |     // O teste não falha se não houver indicador — pode ser uma melhoria futura
  682 |   })
  683 | 
  684 |   test("15. fechar modal e reabrir preserva estado inicial", async ({ page }) => {
  685 |     await openBookingModal(page)
  686 |     await page.waitForTimeout(500)
  687 | 
  688 |     // Fecha o modal
  689 |     const closeBtn = page.locator(
  690 |       'button[aria-label="Close"], button[aria-label="Fechar"], button:has(svg.lucide-x)',
  691 |     ).first()
  692 |     if (await closeBtn.isVisible().catch(() => false)) {
  693 |       await closeBtn.click()
  694 |       await page.waitForTimeout(500)
  695 |     } else {
  696 |       // Tenta ESC para fechar
  697 |       await page.keyboard.press("Escape")
  698 |       await page.waitForTimeout(500)
  699 |     }
  700 | 
  701 |     // Reabre o modal
  702 |     const agendarBtn = page.locator('button:has-text("Agendar")').first()
  703 |     if (await agendarBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
  704 |       await agendarBtn.click()
  705 |       await page.waitForTimeout(500)
  706 | 
  707 |       // Verifica que o modal abriu novamente no passo 1 (estado inicial)
  708 |       const calendar = page.locator(
  709 |         '[class*="calendar"], [class*="rdp"]',
  710 |       ).first()
  711 |       await expect(calendar).toBeVisible({ timeout: 5000 })
  712 |     }
  713 |   })
  714 | 
  715 |   test("16. scroll e responsividade do modal de booking", async ({ page }) => {
  716 |     await openBookingModal(page)
  717 |     await page.waitForTimeout(500)
  718 | 
  719 |     // Verifica se o modal tem scroll
  720 |     const modalContent = page.locator(
  721 |       '[class*="content"], [class*="dialog"], [role="dialog"]',
  722 |     ).first()
  723 |     const hasScroll = await modalContent
  724 |       .evaluate((el) => el.scrollHeight > el.clientHeight)
  725 |       .catch(() => false)
  726 | 
  727 |     if (hasScroll) {
  728 |       // Tenta scrollar o modal
  729 |       await modalContent.evaluate((el) => el.scrollTo(0, el.scrollHeight))
  730 |       await page.waitForTimeout(200)
  731 |     }
  732 | 
  733 |     // Se estiver no mobile, verifica se o modal é fullscreen
  734 |     const isMobile = await page.evaluate(() => window.innerWidth < 768)
  735 |     if (isMobile) {
  736 |       const isFullscreen = await modalContent
  737 |         .evaluate((el) => {
  738 |           const rect = el.getBoundingClientRect()
  739 |           return rect.width >= window.innerWidth * 0.9
  740 |         })
  741 |         .catch(() => false)
  742 |       // Não falha — apenas observa
  743 |     }
  744 |   })
  745 | })
  746 | 
  747 | test.describe("Health Check — Rotas da API de Booking e Pagamento", () => {
  748 |   // NOTA: Estes testes usam `request` fixture (fora do navegador), então
  749 |   // `page.route()` não os intercepta. Eles batem no servidor real.
  750 |   // Para mockar, use `page.evaluate(() => fetch(...))` no lugar.
  751 | 
  752 |   test("API POST /api/bookings rejeita sem autenticação", async ({ request }) => {
  753 |     const res = await request.post("/api/bookings", {
  754 |       data: {
  755 |         providerId: "test",
  756 |         serviceId: "test",
  757 |         scheduledAt: new Date().toISOString(),
  758 |       },
  759 |     })
  760 |     // Com mocks ativos, o POST /api/bookings retorna 401 quando authenticated=false
  761 |     expect(res.status()).toBe(401)
  762 |   })
  763 | 
  764 |   test("API GET /api/bookings retorna 401 sem auth", async ({ request }) => {
  765 |     const res = await request.get("/api/bookings")
  766 |     expect(res.status()).toBe(401)
  767 |   })
  768 | 
  769 |   test("API GET /api/providers retorna lista", async ({ request }) => {
  770 |     // Teste contra o servidor real (request fixture não passa pelo mock)
  771 |     const res = await request.get("/api/providers")
> 772 |     expect(res.ok()).toBeTruthy()
      |                      ^ Error: expect(received).toBeTruthy()
  773 |     const body = await res.json()
  774 |     expect(body).toHaveProperty("items")
  775 |     expect(body).toHaveProperty("total")
  776 |   })
  777 | })
  778 | 
```