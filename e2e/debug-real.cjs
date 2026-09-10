/* Mede a home REAL (sem mocks) e o comportamento do fullPage */
const { chromium } = require("@playwright/test")

;(async () => {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  page.on("crash", () => console.log("[!!] PAGE CRASHED"))
  page.on("console", (m) => {
    if (m.type() === "error") console.log("[console.error]", m.text().slice(0, 100))
  })
  await page.goto("http://localhost:3000", { waitUntil: "networkidle" }).catch(() => {})
  await page.waitForTimeout(3000)

  const h = await page.evaluate(() => document.body.scrollHeight)
  console.log("SCROLL HEIGHT (real):", h)
  const nodes = await page.evaluate(() => document.querySelectorAll("*").length)
  console.log("DOM nodes:", nodes)
  const canvas = await page.evaluate(() => document.querySelectorAll("canvas").length)
  console.log("canvases:", canvas)

  // tenta fullPage com timeout curto
  const t0 = Date.now()
  try {
    await page.evaluate(() => {
      document.getAnimations().forEach((a) => a.pause())
    })
    const shot = await page.screenshot({
      fullPage: true,
      animations: "disabled",
      timeout: 60000,
    })
    console.log("fullPage OK em", Date.now() - t0, "ms bytes:", shot.length)
  } catch (e) {
    console.log("fullPage FALHOU em", Date.now() - t0, "ms:", e.message.split("\n")[0])
  }
  await browser.close()
})().catch((e) => {
  console.error("FATAL:", e.message.split("\n")[0])
  process.exit(1)
})
