/* Replica exatamente takeStableScreenshot (waitForStable + scroll pre-load)
 * com mocks e loga altura/memória por iteração pra achar onde o renderer morre. */
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
async function freezeAnimations(page) {
  await page.evaluate(() => {
    document.getAnimations().forEach((a) => a.pause())
    const style = document.createElement("style")
    style.id = "vr-freeze-animations"
    style.textContent = `*, *::before, *::after { animation: none !important; transition: none !important; }`
    document.head.appendChild(style)
  })
  await page.evaluate(() => new Promise(requestAnimationFrame))
}

;(async () => {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  page.on("crash", () => console.log("[!!] PAGE CRASHED"))
  page.on("close", () => console.log("[!!] PAGE CLOSED"))
  page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 150)))
  let errCount = 0
  page.on("console", (m) => {
    if (m.type() === "error" && m.text().includes("401")) {
      errCount++
      if (errCount % 5 === 0 || errCount <= 3)
        console.log(`[401 x${errCount}]`, m.text().slice(0, 90))
    }
  })
  await page.route("**/api/providers**", (r) => r.fulfill({ json: MOCK_PROVIDERS }))
  await page.route("**/api/categories**", (r) => r.fulfill({ json: MOCK_CATEGORIES }))
  await page.route("**/api/search**", (r) => r.fulfill({ json: MOCK_PROVIDERS }))
  await page.route("**/api/geo/**", (r) =>
    r.fulfill({ json: { lat: -18.8566, lng: -41.9455, city: "Governador Valadares" } }),
  )

  console.log("[step] goto")
  await page.goto("http://localhost:3000", { waitUntil: "networkidle" }).catch(() => {})
  await page.waitForTimeout(1500)
  await page
    .waitForFunction(() => document.fonts.ready.then(() => true), { timeout: 5000 })
    .catch(() => {})
  await freezeAnimations(page)

  console.log("[step] scroll pre-load")
  const snap = () =>
    page.evaluate(() => ({
      h: document.body.scrollHeight,
      nodes: document.querySelectorAll("*").length,
      canv: document.querySelectorAll("canvas").length,
      // @ts-ignore
      jsHeap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : -1,
      url: location.href,
    }))
  let prev = -1
  for (let i = 0; i < 12 && prev !== (await snap()).h; i++) {
    const s = await snap()
    prev = s.h
    console.log(
      `[scroll ${i}] h=${s.h} nodes=${s.nodes} canv=${s.canv} jsHeap=${s.jsHeap}MB url=${s.url.slice(0, 40)}`,
    )
    await page.evaluate((y) => window.scrollTo(0, y), prev)
    await page.waitForTimeout(400)
    if (page.isClosed()) {
      console.log("[!!] page morreu durante scroll")
      break
    }
  }
  console.log("[step] final snap")
  console.log(await snap())
  await page
    .evaluate(() => window.scrollTo(0, 0))
    .catch((e) => console.log("[evaluate err]", e.message.split("\n")[0]))
  await page.waitForTimeout(1200)
  await freezeAnimations(page)
  console.log("[step] shot")
  try {
    const shot = await page.screenshot({ fullPage: true, animations: "disabled", timeout: 90000 })
    console.log("[step] screenshot OK", shot.length, "bytes")
  } catch (e) {
    console.log("[step] screenshot FALHOU:", e.message.split("\n")[0])
  }
  await browser.close()
})().catch((e) => {
  console.error("FATAL:", e.message.split("\n")[0])
  process.exit(1)
})
