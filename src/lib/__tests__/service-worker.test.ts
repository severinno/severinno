import { describe, it, expect } from "vitest"
import fs from "fs"
import path from "path"

describe("Auditoria do Service Worker & PWA Offline Cache (public/sw.js)", () => {
  const swPath = path.resolve(process.cwd(), "public/sw.js")
  let swContent: string

  it("verifica se public/sw.js existe e não está vazio", () => {
    expect(fs.existsSync(swPath)).toBe(true)
    swContent = fs.readFileSync(swPath, "utf-8")
    expect(swContent.length).toBeGreaterThan(1000)
  })

  it("garante que não há pré-cache em massa (scraping) de tiles OSM durante a instalação", () => {
    swContent = fs.readFileSync(swPath, "utf-8")
    // Extrai o bloco de ASSETS precacheados na instalação
    const assetsMatch = swContent.match(/const\s+ASSETS\s*=\s*\[([\s\S]*?)\]/)
    expect(assetsMatch).not.toBeNull()

    const assetsBlock = assetsMatch![1]
    // Não pode conter URLs externas ou tiles do OpenStreetMap
    expect(assetsBlock).not.toContain("tile.openstreetmap.org")
    expect(assetsBlock).not.toContain("openstreetmap")
    expect(assetsBlock).toContain('"/offline"')
    expect(assetsBlock).toContain('"/manifest.json"')
  })

  it("valida conformidade estrita com a Tile Usage Policy da OpenStreetMap Foundation (OSMF)", () => {
    swContent = fs.readFileSync(swPath, "utf-8")

    // 1. Confirma que tiles são interceptados sob demanda no evento fetch
    expect(swContent).toContain('url.hostname === "tile.openstreetmap.org"')
    expect(swContent).toContain("osmTileStrategy(event.request)")

    // 2. Confirma limite máximo de retenção no cache de tiles para não sobrecarregar armazenamento
    const maxTilesMatch = swContent.match(/const\s+MAX_OSM_TILES\s*=\s*(\d+)/)
    expect(maxTilesMatch).not.toBeNull()
    const maxTiles = parseInt(maxTilesMatch![1], 10)
    expect(maxTiles).toBeGreaterThan(0)
    expect(maxTiles).toBeLessThanOrEqual(500) // Limite razoável para PWA local

    // 3. Confirma presença de função de limpeza/pruning de cache de tiles
    expect(swContent).toContain("pruneTileCache")
  })

  it("garante fallback de tela offline (/offline) para navegação sem conexão", () => {
    swContent = fs.readFileSync(swPath, "utf-8")
    expect(swContent).toContain('caches.match("/offline")')
  })

  it("valida manipulador de sincronização em segundo plano (Background Sync)", () => {
    swContent = fs.readFileSync(swPath, "utf-8")
    expect(swContent).toContain('self.addEventListener("sync"')
    expect(swContent).toContain("syncOfflineActions")
    expect(swContent).toContain("OFFLINE_SYNC_COMPLETED")
  })

  it("valida notificações push com suporte a ações interativas e vibração", () => {
    swContent = fs.readFileSync(swPath, "utf-8")
    expect(swContent).toContain('self.addEventListener("push"')
    expect(swContent).toContain('self.addEventListener("notificationclick"')
    expect(swContent).toContain("showNotificationFromPayload")
    expect(swContent).toContain("PROVIDER_ARRIVED")
    expect(swContent).toContain("approve_escrow")
    expect(swContent).toContain("view_report")
    expect(swContent).toContain("view_tracking")
    expect(swContent).toContain("view_route")
  })

  it("valida cache dinâmico de imagens e fotos de portfólio (Stale-While-Revalidate)", () => {
    swContent = fs.readFileSync(swPath, "utf-8")
    expect(swContent).toContain("IMAGE_CACHE")
    expect(swContent).toContain("MAX_CACHED_IMAGES")
    // `event` é repassado para que a revalidação em background use event.waitUntil
    expect(swContent).toContain("imageStrategy(event.request, event)")
    expect(swContent).toContain("pruneImageCache")
    expect(swContent).toContain("OFFLINE_IMAGE_SVG")
    expect(swContent).toContain("image/svg+xml")
  })

  it("nunca cacheia respostas de APIs privadas/autenticadas", () => {
    swContent = fs.readFileSync(swPath, "utf-8")
    const excludedMatch = swContent.match(/const\s+isExcludedApi\s*=([\s\S]*?)\n\s*\n/)
    expect(excludedMatch).not.toBeNull()
    const excludedBlock = excludedMatch![1]
    for (const prefix of [
      "/api/auth/",
      "/api/admin/",
      "/api/users/me",
      "/api/provider/",
      "/api/client/",
      "/api/wallet",
      "/api/webhooks/",
      "/api/payments/",
    ]) {
      expect(excludedBlock).toContain(`"${prefix}"`)
    }
  })
})
