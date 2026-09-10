/* Replica o fluxo exato do teste "home page — full page screenshot" e loga cada passo */
const { chromium } = require("@playwright/test")

const MOCK_PROVIDERS = {
  items: [
    {
      id: "vr-prov-1",
      name: "Carlos Silva",
      avatarUrl: null,
      coverUrl: null,
      bio: "Encanador há 10 anos",
      rating: 4.9,
      reviewCount: 87,
      verified: true,
      city: "Governador Valadares",
      distanceKm: 1.5,
      radiusKm: 25,
      lat: -18.8566,
      lng: -41.9455,
      memberSince: new Date(Date.now() - 300000).toISOString(),
      services: [
        { id: "svc-1", title: "Encanador", basePrice: 120, unit: "UNIDADE", photos: [] },
        { id: "svc-2", title: "Hidráulica", basePrice: 180, unit: "UNIDADE", photos: [] },
      ],
      completedBookings: 156,
    },
    {
      id: "vr-prov-2",
      name: "Maria Santos",
      avatarUrl: null,
      coverUrl: null,
      bio: "Diarista profissional",
      rating: 4.7,
      reviewCount: 52,
      verified: true,
      city: "Governador Valadares",
      distanceKm: 3.2,
      radiusKm: 20,
      lat: -18.86,
      lng: -41.95,
      memberSince: new Date(Date.now() - 3600000).toISOString(),
      services: [{ id: "svc-3", title: "Diarista", basePrice: 80, unit: "UNIDADE", photos: [] }],
      completedBookings: 203,
    },
  ],
  total: 2,
  page: 1,
  pageSize: 20,
  totalPages: 1,
}
const MOCK_CATEGORIES = [
  { id: "cat-1", name: "Limpeza", slug: "limpeza", icon: "Sparkles", serviceCount: 15 },
  { id: "cat-2", name: "Manutenção", slug: "manutencao", icon: "Wrench", serviceCount: 22 },
]

async function freezeAnimations(page) {
  await page.evaluate(() => {
    document.getAnimations().forEach((a) => a.pause())
    const style = document.createElement("style")
    style.id = "vr-freeze-animations"
    style.textContent = `
      *, *::before, *::after {
        animation: none !important;
        animation-play-state: paused !important;
        transition: none !important;
        scroll-behavior: auto !important;
      }
    `
    document.head.appendChild(style)
  })
  await page.evaluate(() => new Promise(requestAnimationFrame))
}

;(async () => {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  page.on("crash", () => console.log("[!!] PAGE CRASHED"))
  page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 150)))

  await page.route("**/api/providers**", (r) => r.fulfill({ json: MOCK_PROVIDERS }))
  await page.route("**/api/categories**", (r) => r.fulfill({ json: MOCK_CATEGORIES }))
  await page.route("**/api/search**", (r) => r.fulfill({ json: MOCK_PROVIDERS }))
  await page.route("**/api/geo/**", (r) =>
    r.fulfill({ json: { lat: -18.8566, lng: -41.9455, city: "Governador Valadares" } }),
  )

  const step = (s) => console.log("[step]", s, "@", Date.now() % 100000)
  step("goto")
  await page.goto("http://localhost:3000", { waitUntil: "networkidle" }).catch(() => {})
  await page.waitForTimeout(1500)
  step("fonts")
  await page
    .waitForFunction(() => document.fonts.ready.then(() => true), { timeout: 5000 })
    .catch(() => {})
  step("freeze1")
  await freezeAnimations(page)

  step("scroll pre-load")
  await page.evaluate(async () => {
    const height = () => document.body.scrollHeight
    let prev = -1
    for (let i = 0; i < 12 && prev !== height(); i++) {
      prev = height()
      window.scrollTo(0, prev)
      await new Promise((r) => setTimeout(r, 400))
    }
    window.scrollTo(0, 0)
  })
  await page.waitForTimeout(1200)
  step("freeze2")
  await freezeAnimations(page)

  step("masks")
  for (const sel of ["[data-testid='timestamp']", "time"]) {
    await page
      .locator(sel)
      .evaluate((el) => {
        el.style.visibility = "hidden"
      })
      .catch(() => {})
  }
  step("screenshot start")
  const h = await page
    .evaluate(() => document.body.scrollHeight)
    .catch((e) => "ERR:" + e.message.split("\n")[0])
  console.log("[step] height =", h)
  step("toHaveScreenshot-style shot")
  try {
    const shot = await page.screenshot({ fullPage: true, animations: "disabled", timeout: 60000 })
    console.log("[step] screenshot OK", shot.length, "bytes @", Date.now() % 100000)
  } catch (e) {
    console.log("[step] screenshot FALHOU:", e.message.split("\n")[0])
  }
  await browser.close()
})().catch((e) => {
  console.error("FATAL:", e.message.split("\n")[0])
  process.exit(1)
})
