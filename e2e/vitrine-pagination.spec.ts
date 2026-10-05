/**
 * vitrine-pagination.spec.ts — caminhada p1→p10 da vitrine por CLIQUE.
 *
 * O QUE GARANTE (o contrato do cursor da paginação, visto pelo usuário):
 *   1. Cada clique em "Próxima →" avança EXATAMENTE uma página: o contador
 *      "Página N de M" casa com o N esperado e a URL carrega `pagina=N`.
 *   2. Cada página mostra conteúdo DISTINTO: os 9 `data-provider-id` da
 *      listagem não repetem nenhum id de página anterior (nem dentro da
 *      própria página) — 10 páginas × 9 = 90 ids únicos no fim.
 *   3. A sequência é a global do dataset (sem buracos nem repetição): a
 *      caminhada é 1→10 na ordem, cada página com exatamente 9 cards
 *      (a seed tem 415 prestadores ⇒ 47 páginas completas até a 10ª).
 *
 * `[data-provider-id]` é seguro como identidade: o ProviderCard é o ÚNICO
 * componente que o grava, e o único importador dele é o VitrineResults —
 * nenhuma outra seção da home o emite.
 *
 * Custo: ~10 cliques em dev (:3100 warm) ≈ 30–60s. Prefetch no hover/focus
 * do botão deixa o pouso em cache na maioria das páginas — sem rede no caminho
 * crítico do clique.
 *
 * Rodar localmente (dev :3100 com a seed de 415 prestadores):
 *   BASE_URL=http://localhost:3100 bunx playwright test e2e/vitrine-pagination.spec.ts --project=chromium
 */
import { test, expect, type Page } from "@playwright/test"
import { waitForVitrine } from "./helpers"

const PAGINAS = 10
const PAGE_SIZE = 9

const NAV = 'nav[aria-label="Paginação de resultados"]'
const PROXIMA = `${NAV} button:has-text("Próxima")`
const STATUS = `${NAV} [role="status"]`

/** Os ids dos cards DA LISTAGEM principal, em ordem de render. */
async function idsDaPagina(page: Page): Promise<string[]> {
  return page
    .locator("[data-provider-id]")
    .evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.providerId ?? ""))
}

/** Contador "Página N de M" do rodapé da paginação. */
async function contadorDaPagina(page: Page): Promise<string> {
  return (await page.locator(STATUS).textContent()) ?? ""
}

test("caminhada p1→p10 por Próxima: páginas distintas, contagem e URL sequenciais", async ({
  page,
}) => {
  test.setTimeout(120_000)

  await page.goto("/")
  await waitForVitrine(page)

  // p1: 9 cards, ids únicos, contador em "Página 1 de ≥10", sem `pagina=` na URL.
  const vistos = new Set<string>()
  const porPagina: string[][] = []

  await expect(page.locator(STATUS)).toHaveText(/Página 1 de \d+/, { timeout: 30_000 })
  await expect
    .poll(() => idsDaPagina(page), { timeout: 30_000, intervals: [250, 500, 1_000] })
    .toHaveLength(PAGE_SIZE)

  const declaradas = await contadorDaPagina(page)
  expect(declaradas).toMatch(/^Página 1 de (\d+)$/)
  expect(Number(declaradas.replace(/\D+/g, ""))).toBeGreaterThanOrEqual(PAGINAS)

  for (let esperada = 1; esperada <= PAGINAS; esperada++) {
    if (esperada > 1) {
      await page.locator(PROXIMA).click()
      // O pouso assenta quando o CONTADOR declara a página esperada E a
      // listagem troca de conteúdo (poll: a re-query não crava render velho).
      await expect(page.locator(STATUS)).toHaveText(new RegExp(`^Página ${esperada} de \\d+$`), {
        timeout: 30_000,
      })
      await expect
        .poll(() => idsDaPagina(page), { timeout: 30_000, intervals: [250, 500, 1_000] })
        .not.toEqual(porPagina[esperada - 2])
      expect(page.url()).toContain(`pagina=${esperada}`)
    }

    const ids = await idsDaPagina(page)
    expect(ids, `p${esperada}: exatamente ${PAGE_SIZE} cards`).toHaveLength(PAGE_SIZE)
    expect(new Set(ids).size, `p${esperada}: ids únicos dentro da página`).toBe(PAGE_SIZE)
    const repetidos = ids.filter((id) => vistos.has(id))
    expect(repetidos, `p${esperada}: sem repetição de páginas anteriores`).toEqual([])
    for (const id of ids) vistos.add(id)
    porPagina.push(ids)
  }

  // Fechamento da caminhada: 10 × 9 ids, todos distintos.
  expect(vistos.size).toBe(PAGINAS * PAGE_SIZE)

  // Estado dos botões na p10 (o dataset não acabou: Próxima segue habilitado,
  // Anterior voltou a habilitar na p2 e segue).
  await expect(page.locator(PROXIMA)).toBeEnabled()
  await expect(page.locator(`${NAV} button:has-text("Anterior")`)).toBeEnabled()
})
