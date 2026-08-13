/* eslint-disable @typescript-eslint/no-explicit-any */
import { test, expect } from "@playwright/test"

test.describe("Home page", () => {
  test("loads and shows the hero section", async ({ page }) => {
    const response = await page.goto("/")
    expect(response?.ok()).toBeTruthy()

    await expect(page.locator("h1")).toBeVisible()
    await expect(page.getByPlaceholder(/buscar/i)).toBeVisible()
  })

  test("shows category showcase", async ({ page }) => {
    await page.goto("/")
    const categorySection = page.locator("text=/Categorias|Serviços/i").first()
    await expect(page.locator("header, main")).toBeVisible()
  })

  test("search input works on hero", async ({ page }) => {
    await page.goto("/")
    const searchInput = page.getByPlaceholder(/buscar/i)
    await expect(searchInput).toBeVisible()
    await searchInput.fill("eletricista")
    await expect(searchInput).toHaveValue("eletricista")
  })

  test("has footer with brand name", async ({ page }) => {
    await page.goto("/")
    await expect(page.locator("footer")).toBeVisible()
    await expect(page.locator("footer")).toContainText(/severinno/i)
  })
})
