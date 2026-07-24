const CACHE = "severinno-v2"
const ASSETS = ["/", "/manifest.json"]

// OSM tiles are immutable by URL — cache-first strategy
const OSM_TILE_CACHE = "severinno-osm-tiles-v1"

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)))
  self.skipWaiting()
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE && k !== OSM_TILE_CACHE).map((k) => caches.delete(k))),
    ).then(() => self.clients.claim()),
  )
})

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url)

  // ---- OSM Map Tiles: cache-first, immutable ---------------------------
  if (url.hostname === "tile.openstreetmap.org") {
    event.respondWith(osmTileStrategy(event.request))
    return
  }

  // ---- App shell: network-first (offline fallback to cache) ------------
  event.respondWith(
    caches.match(event.request).then((cached) => cached ?? fetch(event.request)),
  )
})

async function osmTileStrategy(request) {
  const cache = await caches.open(OSM_TILE_CACHE)
  const cached = await cache.match(request)
  if (cached) return cached

  try {
    const response = await fetch(request)
    if (response.ok) {
      // Clone before caching since response can only be consumed once
      const clone = response.clone()
      // Store without time limit (tiles are immutable)
      cache.put(request, clone).catch(() => {})
    }
    return response
  } catch {
    // Offline and not in cache — return a blank tile
    return new Response(null, { status: 204 })
  }
}

// ---- Push Notifications (unchanged) -----------------------------------
self.addEventListener("push", (event) => {
  if (!event.data) return
  try {
    const data = event.data.json()
    const title = data.title || "Severinno"
    const body = data.body || ""
    const url = data.url || "/"

    event.waitUntil(
      self.registration.showNotification(title, {
        body,
        icon: "/icon-192.png",
        badge: "/icon-192.png",
        vibrate: [200, 100, 200],
        data: { url },
      }),
    )
  } catch {
    event.waitUntil(
      self.registration.showNotification("Severinno", {
        body: event.data.text(),
        icon: "/icon-192.png",
      }),
    )
  }
})

self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  const urlToOpen = event.notification.data?.url || "/"
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientsList) => {
      const client = clientsList.find((c) => c.url === urlToOpen && "focus" in c)
      if (client) return client.focus()
      if (clients.openWindow) return clients.openWindow(urlToOpen)
    }),
  )
})
