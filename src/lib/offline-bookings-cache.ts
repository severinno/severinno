/**
 * offline-bookings-cache.ts
 *
 * Cache resiliente em IndexedDB (com fallback em localStorage / memória) para
 * agendamentos e ordens de serviço do prestador.
 *
 * Permite que prestadores em trânsito ou atendendo em áreas de sombra de sinal
 * (garagens subterrâneas, subsolos, áreas rurais ou encostas de GV como Penha e Santa Rita)
 * acessem imediatamente a lista de clientes, endereços, horários e instruções de serviço.
 */

export interface CachedBookingSummary {
  id: string
  scheduledAt: string | Date
  status: string
  paymentStatus: string
  paymentMethod: string
  amount: number
  quantity: number
  unit: string
  address: string
  notes?: string | null
  client: {
    id: string
    name: string
    avatarUrl?: string | null
    phone?: string | null
  }
  service: {
    id: string
    title: string
    basePrice: number
  }
  cachedAt: number
}

const DB_NAME = "severinno_offline_bookings_v1"
const DB_VERSION = 1
const STORE_NAME = "cached_bookings"
const META_STORE = "cache_metadata"
const LOCAL_STORAGE_KEY = "severinno_offline_bookings_backup_v1"
const LOCAL_STORAGE_META_KEY = "severinno_offline_bookings_meta_v1"

let memoryCache: CachedBookingSummary[] = []
let memoryLastCachedAt = 0

/**
 * Abre a conexão com o banco IndexedDB
 */
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || !window.indexedDB) {
      return reject(new Error("IndexedDB indisponível neste ambiente"))
    }

    const req = window.indexedDB.open(DB_NAME, DB_VERSION)

    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" })
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: "key" })
      }
    }

    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/**
 * Salva a lista de agendamentos mais recente no cache offline
 */
export async function cacheOfflineBookings(
  bookings: Array<Partial<CachedBookingSummary> & { id: string }>,
): Promise<void> {
  const now = Date.now()
  const formatted: CachedBookingSummary[] = bookings.map((b) => ({
    id: b.id,
    scheduledAt: b.scheduledAt ?? new Date(),
    status: b.status ?? "PENDING",
    paymentStatus: b.paymentStatus ?? "PENDING",
    paymentMethod: b.paymentMethod ?? "PIX",
    amount: b.amount ?? 0,
    quantity: b.quantity ?? 1,
    unit: b.unit ?? "serviço",
    address: b.address ?? "Endereço não informado",
    notes: b.notes ?? null,
    client: {
      id: b.client?.id ?? "unknown",
      name: b.client?.name ?? "Cliente",
      avatarUrl: b.client?.avatarUrl ?? null,
      phone: b.client?.phone ?? null,
    },
    service: {
      id: b.service?.id ?? "unknown",
      title: b.service?.title ?? "Serviço",
      basePrice: b.service?.basePrice ?? 0,
    },
    cachedAt: now,
  }))

  memoryCache = formatted
  memoryLastCachedAt = now

  // 1. Tenta salvar no IndexedDB
  try {
    const db = await openDB()
    const tx = db.transaction([STORE_NAME, META_STORE], "readwrite")
    const store = tx.objectStore(STORE_NAME)
    const meta = tx.objectStore(META_STORE)

    store.clear()
    for (const b of formatted) {
      store.put(b)
    }
    meta.put({ key: "last_sync", timestamp: now, count: formatted.length })

    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch {
    // 2. Fallback para localStorage
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(formatted))
        window.localStorage.setItem(
          LOCAL_STORAGE_META_KEY,
          JSON.stringify({ timestamp: now, count: formatted.length }),
        )
      }
    } catch {
      // Ignora erro de quota do localStorage
    }
  }
}

/**
 * Recupera os agendamentos armazenados em cache offline
 */
export async function getCachedOfflineBookings(): Promise<{
  items: CachedBookingSummary[]
  lastSyncAt: number
  source: "indexeddb" | "localStorage" | "memory" | "empty"
}> {
  // 1. Tenta recuperar do IndexedDB
  try {
    const db = await openDB()
    const tx = db.transaction([STORE_NAME, META_STORE], "readonly")
    const store = tx.objectStore(STORE_NAME)
    const metaStore = tx.objectStore(META_STORE)

    const itemsReq = store.getAll()
    const metaReq = metaStore.get("last_sync")

    const [items, meta] = await Promise.all([
      new Promise<CachedBookingSummary[]>((resolve, reject) => {
        itemsReq.onsuccess = () => resolve(itemsReq.result as CachedBookingSummary[])
        itemsReq.onerror = () => reject(itemsReq.error)
      }),
      new Promise<{ timestamp: number } | undefined>((resolve, reject) => {
        metaReq.onsuccess = () => resolve(metaReq.result)
        metaReq.onerror = () => reject(metaReq.error)
      }),
    ])

    if (items && items.length > 0) {
      return {
        items,
        lastSyncAt: meta?.timestamp ?? items[0]?.cachedAt ?? Date.now(),
        source: "indexeddb",
      }
    }
  } catch {
    // Continua para fallback
  }

  // 2. Fallback para localStorage
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY)
      const metaRaw = window.localStorage.getItem(LOCAL_STORAGE_META_KEY)
      if (raw) {
        const items = JSON.parse(raw) as CachedBookingSummary[]
        const meta = metaRaw ? JSON.parse(metaRaw) : null
        if (Array.isArray(items) && items.length > 0) {
          return {
            items,
            lastSyncAt: meta?.timestamp ?? items[0]?.cachedAt ?? Date.now(),
            source: "localStorage",
          }
        }
      }
    }
  } catch {
    // Continua para fallback
  }

  // 3. Fallback em memória
  if (memoryCache.length > 0) {
    return {
      items: memoryCache,
      lastSyncAt: memoryLastCachedAt,
      source: "memory",
    }
  }

  return {
    items: [],
    lastSyncAt: 0,
    source: "empty",
  }
}

/**
 * Limpa o cache de agendamentos offline (ex.: ao deslogar)
 */
export async function clearOfflineBookingsCache(): Promise<void> {
  memoryCache = []
  memoryLastCachedAt = 0

  try {
    const db = await openDB()
    const tx = db.transaction([STORE_NAME, META_STORE], "readwrite")
    tx.objectStore(STORE_NAME).clear()
    tx.objectStore(META_STORE).clear()
  } catch {}

  try {
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.removeItem(LOCAL_STORAGE_KEY)
      window.localStorage.removeItem(LOCAL_STORAGE_META_KEY)
    }
  } catch {}
}
