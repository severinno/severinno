/* Debug: o que torna a home instável / trava fullPage screenshot */
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
      memberSince: new Date().toISOString(),
      services: [{ id: "svc-1", title: "Encanador", basePrice: 120, unit: "UNIDADE", photos: [] }],
      completedBookings: 156,
    },
  ],
  total: 1,
  page: 1,
  pageSize: 20,
  totalPages: 1,
}
const MOCK_CATEGORIES = [
  { id: "cat-1", name: "Limpeza", slug: "limpeza", icon: "Sparkles", serviceCount: 15 },
]

;(async () => {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  await page.route("**/api/providers**", (r) =>
    r.fulfill({ status: 500, json: { error: "Internal Server Error" } }),
  )
  await page.route("**/api/categories**", (r) => r.fulfill({ json: MOCK_CATEGORIES }))
  await page.route("**/api/search**", (r) => r.fulfill({ json: MOCK_PROVIDERS }))
  await page.route("**/api/geo/**", (r) =>
    r.fulfill({ json: { lat: -18.8566, lng: -41.9455, city: "Governador Valadares" } }),
  )
  await page.goto("http://localhost:3000", { waitUntil: "networkidle" }).catch(() => {})
  await page.waitForTimeout(3000)

  const info = await page.evaluate(async () => {
    const out = { height: 0, scrollHeight: 0, runningAnimations: 0, intervals: 0, animDetails: [] }
    out.scrollHeight = document.body.scrollHeight
    out.height = window.innerHeight
    const anims = document.getAnimations()
    out.runningAnimations = anims.filter((a) => a.playState === "running").length
    // detalhes das animações em running
    for (const a of anims) {
      if (a.playState !== "running") continue
      const el = a.effect?.target
      const name = a.animationName || a.effect?.getComputedTiming?.().direction || "?"
      out.animDetails.push({
        name: String(name).slice(0, 40),
        cls: el?.className ? String(el.className).slice(0, 60) : el?.tagName,
        dur: a.effect?.getComputedTiming?.()?.duration || 0,
      })
    }
    return out
  })
  console.log("HEIGHT:", info.height, "SCROLL:", info.scrollHeight)
  console.log("RUNNING ANIMS:", info.runningAnimations)
  for (const d of info.animDetails.slice(0, 15)) console.log("  anim:", JSON.stringify(d))
  const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 200))
  console.log("BODY TEXT:", JSON.stringify(bodyText))

  // Aplica masks (como no teste desktop full page)
  for (const sel of ["[data-testid='timestamp']", "time"]) {
    await page
      .locator(sel)
      .evaluate((el) => {
        el.style.visibility = "hidden"
      })
      .catch(() => {})
  }
  console.log("masks aplicados")

  // Replica o pre-load scroll do takeStableScreenshot
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
  const h2 = await page.evaluate(() => document.body.scrollHeight)
  console.log("SCROLL após pre-load:", h2)

  // Pausa TODAS as animações via WAAPI (fix proposto)
  await page.evaluate(() => {
    document.getAnimations().forEach((a) => a.pause())
  })
  await page.waitForTimeout(200)
  const s1 = await page.screenshot()
  await page.waitForTimeout(500)
  const s2 = await page.screenshot()
  console.log("S1==S2 bytes (com pause):", s1.length === s2.length, s1.length, s2.length)

  // Verifica se fullPage completa em tempo razoável
  const t0 = Date.now()
  const fp = await page
    .screenshot({ fullPage: true, animations: "disabled" })
    .catch((e) => "ERR:" + e.message)
  console.log(
    "fullPage em",
    Date.now() - t0,
    "ms, bytes:",
    typeof fp === "string" ? fp.slice(0, 80) : fp.length,
  )

  await browser.close()
})().catch((e) => {
  console.error("FATAL:", e.message)
  process.exit(1)
})
