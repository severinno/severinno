const CACHE = "severinno-v4"
const ASSETS = [
  "/",
  "/manifest.json",
  "/sw.js",
  "/logo.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
]

// OSM tiles are immutable by URL — cache-first strategy
const OSM_TILE_CACHE = "severinno-osm-tiles-v1"

// API cache — stale-while-revalidate for public endpoints
const API_CACHE = "severinno-api-v1"

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => {
      // Cache each asset individually so a single failure doesn't block
      return Promise.allSettled(
        ASSETS.map((url) =>
          cache.add(url).catch(() => {
            console.warn(`[SW] Failed to cache ${url}`)
          }),
        ),
      )
    }),
  )
  self.skipWaiting()
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (k) => k !== CACHE && k !== OSM_TILE_CACHE && k !== API_CACHE,
            )
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting()
  }
})

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url)

  // ---- Skip non-GET and browser extensions ----------------------------
  if (event.request.method !== "GET") return
  if (url.protocol !== "http:" && url.protocol !== "https:") return

  // ---- OSM Map Tiles: cache-first, immutable ---------------------------
  if (url.hostname === "tile.openstreetmap.org") {
    event.respondWith(osmTileStrategy(event.request))
    return
  }

  // ---- API calls: network-first with stale fallback -------------------
  if (url.pathname.startsWith("/api/") && url.pathname !== "/api/notifications") {
    event.respondWith(apiStrategy(event.request))
    return
  }

  // ---- Next.js assets (_next/static): cache-first ---------------------
  if (url.pathname.startsWith("/_next/static")) {
    event.respondWith(cacheFirstStrategy(event.request))
    return
  }

  // ---- Static assets (icons, images, fonts): cache-first --------------
  if (
    url.pathname.startsWith("/icons/") ||
    url.pathname.startsWith("/fonts/") ||
    url.pathname === "/logo.svg"
  ) {
    event.respondWith(cacheFirstStrategy(event.request))
    return
  }

  // ---- App shell: network-first (offline fallback to cache) ------------
  event.respondWith(networkFirstStrategy(event.request))
})

// ---- Caching strategies ------------------------------------------------

/**
 * Cache-first: serve from cache if available, otherwise fetch and cache.
 * Ideal for immutable assets (build output, icons).
 */
async function cacheFirstStrategy(request) {
  const cached = await caches.match(request)
  if (cached) return cached

  try {
    const response = await fetch(request)
    if (response.ok) {
      const clone = response.clone()
      caches.open(CACHE).then((cache) => cache.put(request, clone)).catch(() => {})
    }
    return response
  } catch {
    return new Response(null, { status: 204 })
  }
}

/**
 * Network-first: try network, fall back to cache on failure.
 * Ideal for app shell, pages.
 */
async function networkFirstStrategy(request) {
  try {
    const response = await fetch(request)
    if (response.ok && response.type === "basic") {
      const clone = response.clone()
      caches.open(CACHE).then((cache) => cache.put(request, clone)).catch(() => {})
    }
    return response
  } catch {
    const cached = await caches.match(request)
    if (cached) return cached
    // Offline fallback: redirect to /offline if available
    const offlinePage = await caches.match("/offline")
    if (offlinePage) return offlinePage
    return new Response(null, { status: 204 })
  }
}

/**
 * API strategy: network-first with stale-while-revalidate.
 * Caches GET API responses (public endpoints only) for offline use.
 */
async function apiStrategy(request) {
  try {
    const response = await fetch(request)
    if (response.ok) {
      const clone = response.clone()
      caches.open(API_CACHE).then((cache) => cache.put(request, clone)).catch(() => {})
    }
    return response
  } catch {
    const cached = await caches.match(request)
    return cached ?? new Response(JSON.stringify({ error: "offline" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    })
  }
}

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

// ---- Push Notifications — rich payload with actions ---------------------
// Payload format from src/lib/push.ts:
// {
//   title, body, url, icon, badge, image, tag, timestamp,
//   actions: [{ action, title, icon }],
//   data: { url, bookingId, notificationType }
// }
//
// Focus-aware behavior:
//   - App in focus → silent update: sends message to client + updates app badge
//   - App in background → shows notification banner as normal

/** Check if any window client is currently focused (user is actively using the app) */
async function hasFocusedClient() {
  const clientsList = await self.clients.matchAll({ type: "window", includeUncontrolled: true })
  return clientsList.some((client) => client.focused)
}

/**
 * Notify all window clients about a new notification without showing a banner.
 * The client-side code will invalidate the notifications query and update the
 * favicon / app badge accordingly.
 */
async function notifyClientsSilently(data, notificationId) {
  const clientsList = await self.clients.matchAll({ type: "window", includeUncontrolled: true })
  for (const client of clientsList) {
    client.postMessage({
      type: "silent-notification",
      title: data.title || "Severinno",
      body: data.body || "",
      tag: data.tag || null,
      notificationId: notificationId || null,
      timestamp: data.timestamp || new Date().toISOString(),
    })
  }

  // Also update the OS-level app badge (supported in Chrome/Edge on desktop + Android)
  try {
    // Use a simple approach: set badge to 1 to indicate "unread"
    // The exact count will be synced when the client queries /api/notifications
    if ("setAppBadge" in navigator) {
      await navigator.setAppBadge(1)
    }
  } catch {
    // App badge not supported — silent degrade
  }
}

/** Extract notificationId from any payload shape */
function extractNotificationId(data) {
  if (data.notificationId) return data.notificationId
  if (data.data?.notificationId) return data.data.notificationId
  return null
}

self.addEventListener("push", (event) => {
  if (!event.data) return

  event.waitUntil(
    (async () => {
      try {
        const data = event.data.json()
        const notificationId = extractNotificationId(data)
        const isFocused = await hasFocusedClient()

        // ── App in focus: silent update (no banner) ───────────────────
        if (isFocused) {
          await notifyClientsSilently(data, notificationId)
          return
        }

        // ── App in background: show notification banner ───────────────
        // Signal-only pattern: payload stored server-side
        if (data._signal && data.payloadId) {
          const origin = data._baseUrl || self.location.origin
          const fetchUrl = `${origin}/api/push/payload/${data.payloadId}`

          try {
            const res = await fetch(fetchUrl)
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            const fullPayload = await res.json()
            await showNotificationFromPayload(fullPayload)
          } catch {
            // Fallback: show the compact signal data as-is
            await showNotificationFromPayload(data)
          }
          return
        }

        // Inline payload (fits within 4KB)
        await showNotificationFromPayload(data)
      } catch {
        // Fallback for plain text push messages
        await self.registration.showNotification("Severinno", {
          body: event.data.text(),
          icon: "/icon-192.png",
          badge: "/icon-192.png",
        })
      }
    })(),
  )
})

/**
 * Build and show a notification from a payload object.
 * Used both for inline payloads and fetched rich payloads.
 */
function showNotificationFromPayload(data) {
  const title = data.title || "Severinno"
  const body = data.body || ""

  const options = {
    body,
    icon: data.icon || "/icon-192.png",
    badge: data.badge || "/icon-192.png",
    vibrate: [200, 100, 200],
    data: data.data || { url: data.url || "/" },
    tag: data.tag,
    renotify: true,
    requireInteraction: !!(data.actions && data.actions.length > 0),
    actions: data.actions || [],
  }

  // Large image (e.g. service photo, map thumbnail)
  if (data.image) {
    options.image = data.image
  }

  // Timestamp for proper ordering in notification center
  if (data.timestamp) {
    options.timestamp = new Date(data.timestamp).getTime()
  }

  return self.registration.showNotification(title, options)
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close()

  const data = event.notification.data || {}
  const action = event.action
  const baseUrl = data.url || "/"
  const bookingId = data.bookingId
  const _notifType = data.notificationType
  const notificationId = data.notificationId

  // ── Report click to server (fire-and-forget) ─────────────────────────
  if (notificationId) {
    fetch("/api/push/click", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notificationId }),
    }).catch(() => {})
  }

  // ── Handle action buttons ────────────────────────────────────────────
  if (action && bookingId) {
    let actionUrl
    switch (action) {
      case "accept":
        actionUrl = `/dashboard?tab=bookings&booking=${bookingId}&action=confirm`
        break
      case "reject":
        actionUrl = `/dashboard?tab=bookings&booking=${bookingId}&action=cancel`
        break
      default:
        actionUrl = baseUrl
    }
    event.waitUntil(openOrFocusUrl(actionUrl))
    return
  }

  // ── Default: open the deep link URL ──────────────────────────────────
  event.waitUntil(openOrFocusUrl(baseUrl))
})

/** Open or focus a window with the given URL */
async function openOrFocusUrl(url) {
  const clientsList = await clients.matchAll({ type: "window", includeUncontrolled: true })
  // Try to find an existing client with matching URL and focus it
  for (const client of clientsList) {
    if (client.url.includes(url.split("?")[0]) && "focus" in client) {
      client.navigate(url)
      return client.focus()
    }
  }
  // No matching client — open a new window
  if (clients.openWindow) {
    return clients.openWindow(url)
  }
}


// ---- Background Sync — queue actions when offline -------------------------
const SYNC_QUEUE = "severinno-sync-v1"

self.addEventListener("sync", (event) => {
  if (event.tag === "sync-offline-actions") {
    event.waitUntil(syncOfflineActions())
  }
})

async function syncOfflineActions() {
  const cache = await caches.open(SYNC_QUEUE)
  const keys = await cache.keys()
  for (const request of keys) {
    try {
      const body = await request.clone().text()
      const response = await fetch(request, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      })
      if (response.ok) {
        await cache.delete(request)
      }
    } catch {
      // Will retry on next sync
    }
  }
}

// ---- Max cache size enforcement -------------------------------------------
async function enforceMaxEntries(cacheName, max) {
  const cache = await caches.open(cacheName)
  const keys = await cache.keys()
  if (keys.length > max) {
    await Promise.all(keys.slice(0, keys.length - max).map(k => cache.delete(k)))
  }
}
