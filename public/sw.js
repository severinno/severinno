const CACHE = "severinno-v5"
const ASSETS = [
  "/",
  "/offline",
  "/manifest.json",
  "/sw.js",
  "/brand-icon.png",
  "/brand-wordmark-black.png",
  "/brand-wordmark-white.png",
  "/logo.svg",
  "/logo.png",
  "/favicon.ico",
  "/favicon.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
]

// OSM tiles are immutable by URL — cache-first strategy
const OSM_TILE_CACHE = "severinno-osm-tiles-v1"

// API cache — stale-while-revalidate for public endpoints
// v2: purges responses from private routes (/api/users/me, /api/client/*,
// /api/provider/*, /api/wallet) cached before they were excluded.
const API_CACHE = "severinno-api-v2"

// Image cache — stale-while-revalidate for services, portfolio, and avatars
const IMAGE_CACHE = "severinno-images-v1"
const MAX_CACHED_IMAGES = 120

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => {
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
              (k) => k !== CACHE && k !== OSM_TILE_CACHE && k !== API_CACHE && k !== IMAGE_CACHE,
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
  } else if (event.data && event.data.type === "TRIGGER_OFFLINE_SYNC") {
    event.waitUntil(syncOfflineActions())
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

  // ---- API calls: network-first with stale fallback (public endpoints only) --
  const isExcludedApi =
    url.pathname.startsWith("/api/auth/") ||
    url.pathname.startsWith("/api/admin/") ||
    url.pathname.startsWith("/api/users/me") ||
    url.pathname.startsWith("/api/provider/") ||
    url.pathname.startsWith("/api/client/") ||
    url.pathname.startsWith("/api/wallet") ||
    url.pathname.startsWith("/api/webhooks/") ||
    url.pathname.startsWith("/api/payments/") ||
    url.pathname.startsWith("/api/bookings/") ||
    url.pathname.startsWith("/api/cron/") ||
    url.pathname === "/api/notifications"

  if (url.pathname.startsWith("/api/") && !isExcludedApi) {
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
    url.pathname === "/brand-icon.png" ||
    url.pathname === "/brand-wordmark-black.png" ||
    url.pathname === "/brand-wordmark-white.png" ||
    url.pathname === "/logo.svg" ||
    url.pathname === "/logo.png"
  ) {
    event.respondWith(cacheFirstStrategy(event.request))
    return
  }

  // ---- Dynamic Service & Portfolio Images: stale-while-revalidate -----
  if (
    event.request.destination === "image" ||
    url.pathname.startsWith("/_next/image") ||
    url.pathname.startsWith("/uploads/") ||
    /\.(png|jpg|jpeg|webp|avif|gif|svg)$/i.test(url.pathname)
  ) {
    event.respondWith(imageStrategy(event.request, event))
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
      caches
        .open(CACHE)
        .then((cache) => cache.put(request, clone))
        .catch(() => {})
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
      caches
        .open(CACHE)
        .then((cache) => cache.put(request, clone))
        .catch(() => {})
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
      caches
        .open(API_CACHE)
        .then((cache) => cache.put(request, clone))
        .catch(() => {})
    }
    return response
  } catch {
    const cached = await caches.match(request)
    return (
      cached ??
      new Response(JSON.stringify({ error: "offline" }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      })
    )
  }
}

const MAX_OSM_TILES = 100

async function pruneTileCache(cache) {
  try {
    const keys = await cache.keys()
    if (keys.length > MAX_OSM_TILES) {
      const excess = keys.length - MAX_OSM_TILES
      for (let i = 0; i < excess; i++) {
        await cache.delete(keys[i])
      }
    }
  } catch {
    // Best-effort
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
      cache
        .put(request, clone)
        .then(() => pruneTileCache(cache))
        .catch(() => {})
    }
    return response
  } catch {
    // Offline and not in cache — return a blank tile
    return new Response(null, { status: 204 })
  }
}

/**
 * LRU cache pruning for images (max MAX_CACHED_IMAGES entries)
 */
async function pruneImageCache(cache) {
  try {
    const keys = await cache.keys()
    if (keys.length > MAX_CACHED_IMAGES) {
      const excess = keys.length - MAX_CACHED_IMAGES
      for (let i = 0; i < excess; i++) {
        await cache.delete(keys[i])
      }
    }
  } catch {
    // Best-effort
  }
}

// Fallback offline SVG placeholder when network fails and image is not cached
const OFFLINE_IMAGE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300" fill="none">
  <rect width="400" height="300" fill="#f1f5f9"/>
  <path d="M160 130a20 20 0 1 0 0-40 20 20 0 0 0 0 40zm-40 80h160l-50-65-35 45-25-30-50 50z" fill="#94a3b8"/>
  <text x="200" y="240" font-family="-apple-system, sans-serif" font-size="13" fill="#64748b" text-anchor="middle" font-weight="500">Severinno (Modo Offline)</text>
</svg>`

/**
 * Image strategy: Stale-While-Revalidate with offline fallback SVG.
 * Returns cached image instantly (0ms) and updates cache in background.
 */
async function imageStrategy(request, event) {
  const cache = await caches.open(IMAGE_CACHE)
  const cached = await cache.match(request)

  const fetchPromise = fetch(request)
    .then((response) => {
      if (response && response.status === 200) {
        const clone = response.clone()
        cache
          .put(request, clone)
          .then(() => pruneImageCache(cache))
          .catch(() => {})
      }
      return response
    })
    .catch(() => {
      // Network failed
      return null
    })

  // Stale-While-Revalidate: Return cached response immediately if available,
  // keeping the SW event alive to guarantee background revalidation completes.
  if (cached) {
    if (event && event.waitUntil) {
      event.waitUntil(fetchPromise)
    }
    return cached
  }

  // If not in cache, wait for fetch
  const networkResponse = await fetchPromise
  if (networkResponse) {
    return networkResponse
  }

  // If both network and cache failed, return the offline SVG placeholder
  return new Response(OFFLINE_IMAGE_SVG, {
    status: 200,
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "public, max-age=86400",
    },
  })
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
          icon: "/icons/icon-192.png",
          badge: "/icons/icon-192.png",
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
  const isMessage =
    data.type === "message" ||
    data.notificationType === "message" ||
    !!(data.data && (data.data.peerId || data.data.senderId))

  const isArrival =
    data.type === "PROVIDER_ARRIVED" ||
    data.notificationType === "PROVIDER_ARRIVED" ||
    (data.data && data.data.notificationType === "PROVIDER_ARRIVED")

  const isNewJob =
    data.type === "NEW_BOOKING" ||
    data.type === "NEW_JOB" ||
    data.notificationType === "NEW_BOOKING" ||
    data.notificationType === "NEW_JOB" ||
    (data.data &&
      (data.data.notificationType === "NEW_BOOKING" || data.data.notificationType === "NEW_JOB"))

  const isCompletionReady =
    data.type === "ESCROW_RELEASE" ||
    data.type === "SERVICE_COMPLETED" ||
    data.notificationType === "ESCROW_RELEASE" ||
    data.notificationType === "SERVICE_COMPLETED" ||
    (data.data &&
      (data.data.notificationType === "ESCROW_RELEASE" ||
        data.data.notificationType === "SERVICE_COMPLETED"))

  let actions = []
  if (data.actions && data.actions.length > 0) {
    actions = data.actions
  } else if (isArrival) {
    actions = [
      { action: "view_tracking", title: "📍 Ver Localização" },
      { action: "open_chat", title: "💬 Mensagem" },
    ]
  } else if (isCompletionReady) {
    actions = [
      { action: "approve_escrow", title: "🛡️ Liberar Pagamento" },
      { action: "view_report", title: "📷 Ver Laudo/Fotos" },
    ]
  } else if (isNewJob) {
    actions = [
      { action: "view_job", title: "⚡ Ver Chamado" },
      { action: "view_route", title: "🗺️ Ver Rota" },
    ]
  } else if (isMessage) {
    actions = [{ action: "open_chat", title: "💬 Responder" }]
  }

  const options = {
    body: data.body || "",
    icon: data.icon || "/icons/icon-192.png",
    badge: data.badge || "/icons/icon-192.png",
    vibrate: isNewJob
      ? [250, 100, 250, 100, 500]
      : isArrival
        ? [300, 100, 300, 100, 300]
        : [200, 100, 200],
    data: data.data || { url: data.url || "/" },
    tag: data.tag,
    renotify: true,
    requireInteraction: isArrival || isNewJob || isCompletionReady || actions.length > 0,
    actions,
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
  const peerId = data.peerId || data.senderId || (data.data && data.data.peerId)

  if (action === "approve_escrow" && bookingId) {
    const escrowUrl = `/client?view=client.bookings&bookingId=${bookingId}&action=approve_escrow`
    event.waitUntil(openOrFocusUrl(escrowUrl))
    return
  }

  if (action === "view_report" && bookingId) {
    const reportUrl = `/client?view=client.bookings&bookingId=${bookingId}&action=view_report`
    event.waitUntil(openOrFocusUrl(reportUrl))
    return
  }

  if (action === "view_tracking" && bookingId) {
    const trackUrl = `/client?view=client.bookings&bookingId=${bookingId}&action=track`
    event.waitUntil(openOrFocusUrl(trackUrl))
    return
  }

  if (action === "view_route" && bookingId) {
    const routeUrl = `/provider?view=provider.routes&bookingId=${bookingId}`
    event.waitUntil(openOrFocusUrl(routeUrl))
    return
  }

  if (action === "view_job") {
    const jobUrl = bookingId
      ? `/provider?view=provider.bookings&bookingId=${bookingId}`
      : "/provider?view=provider.bookings"
    event.waitUntil(openOrFocusUrl(jobUrl))
    return
  }

  if (action === "open_chat" || (peerId && !bookingId && action !== "reject")) {
    const chatUrl = `/dashboard?tab=messages&peer=${peerId || ""}`
    event.waitUntil(openOrFocusUrl(chatUrl))
    return
  }

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
  if (event.tag === "sync-offline-actions" || event.tag === "sync-offline-batch") {
    event.waitUntil(syncOfflineActions())
  }
})

async function syncOfflineActions() {
  const cache = await caches.open(SYNC_QUEUE)
  const keys = await cache.keys()
  let syncedCount = 0

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
        syncedCount++
      }
    } catch {
      // Will retry on next sync event
    }
  }

  // Notify active window clients that sync has completed
  const clientsList = await clients.matchAll({ type: "window", includeUncontrolled: true })
  for (const client of clientsList) {
    client.postMessage({
      type: "OFFLINE_SYNC_COMPLETED",
      syncedCount,
      timestamp: Date.now(),
    })
  }
}
