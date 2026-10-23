/**
 * offline-bookings-store.ts — Armazenamento Offline-First para Agendamentos Ativos
 *
 * Permite que clientes e prestadores acessem detalhes do serviço, endereço,
 * telefone de emergência para ligação direta e PIN de conclusão mesmo sem conexão
 * (em garagens subterrâneas, elevadores, zonas rurais ou oscilações de 4G).
 *
 * Utiliza IndexedDB com fallback transparente para LocalStorage e Memória.
 */

export interface OfflineBooking {
  id: string
  code: string
  serviceTitle: string
  scheduledAt: string
  status: "CONFIRMED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED"
  amount: number
  address: string
  neighborhood: string
  city: string
  contactName: string
  contactPhone: string
  contactRole: "CLIENT" | "PROVIDER"
  completionPin: string | null
  notes?: string | null
  cachedAt: number
}

const DB_NAME = "severinno_offline_db"
const DB_VERSION = 1
const STORE_NAME = "active_bookings"
const LOCAL_STORAGE_KEY = "severinno_offline_bookings_cache_v1"

let memoryBookings: OfflineBooking[] = []

/**
 * Abre conexão com o IndexedDB do navegador.
 */
function openIndexedDb(): Promise<IDBDatabase | null> {
  if (typeof window === "undefined" || !window.indexedDB) {
    return Promise.resolve(null)
  }

  return new Promise((resolve) => {
    try {
      const request = window.indexedDB.open(DB_NAME, DB_VERSION)

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: "id" })
        }
      }

      request.onsuccess = () => resolve(request.result)
      request.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

/**
 * Salva agendamentos ativos no cache local para uso offline.
 */
export async function saveOfflineBookings(bookings: OfflineBooking[]): Promise<void> {
  memoryBookings = [...bookings]

  // Tenta persistir no IndexedDB
  const db = await openIndexedDb()
  if (db) {
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite")
        const store = tx.objectStore(STORE_NAME)

        // Limpa registros antigos
        store.clear()

        for (const booking of bookings) {
          store.put(booking)
        }

        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      })
      return
    } catch {
      // Fallback para LocalStorage se o IndexedDB falhar
    }
  }

  // Fallback LocalStorage
  if (typeof window !== "undefined" && window.localStorage) {
    try {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(bookings))
    } catch {
      // Quota excedida ou restrição de privacidade
    }
  }
}

/**
 * Recupera todos os agendamentos ativos armazenados localmente.
 */
export async function getOfflineBookings(): Promise<OfflineBooking[]> {
  const db = await openIndexedDb()
  if (db) {
    try {
      const bookings = await new Promise<OfflineBooking[]>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readonly")
        const store = tx.objectStore(STORE_NAME)
        const request = store.getAll()

        request.onsuccess = () => resolve(request.result || [])
        request.onerror = () => reject(request.error)
      })

      if (bookings && bookings.length > 0) {
        memoryBookings = bookings
        return bookings
      }
    } catch {
      // Fallback
    }
  }

  // Fallback LocalStorage
  if (typeof window !== "undefined" && window.localStorage) {
    try {
      const stored = localStorage.getItem(LOCAL_STORAGE_KEY)
      if (stored) {
        const parsed = JSON.parse(stored) as OfflineBooking[]
        if (Array.isArray(parsed)) {
          memoryBookings = parsed
          return parsed
        }
      }
    } catch {
      // Parse error
    }
  }

  return memoryBookings
}

/**
 * Recupera um agendamento específico pelo ID.
 */
export async function getOfflineBookingById(id: string): Promise<OfflineBooking | null> {
  const all = await getOfflineBookings()
  return all.find((b) => b.id === id) || null
}

/**
 * Atualiza o status de um agendamento no cache local.
 */
export async function updateOfflineBookingStatus(
  id: string,
  status: OfflineBooking["status"],
): Promise<boolean> {
  const all = await getOfflineBookings()
  const idx = all.findIndex((b) => b.id === id)
  if (idx === -1) return false

  all[idx] = {
    ...all[idx],
    status,
    cachedAt: Date.now(),
  }

  await saveOfflineBookings(all)
  return true
}

/**
 * Limpa todos os agendamentos offline (ex: no logout).
 */
export async function clearOfflineBookings(): Promise<void> {
  memoryBookings = []

  const db = await openIndexedDb()
  if (db) {
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite")
        const store = tx.objectStore(STORE_NAME)
        store.clear()
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      })
    } catch {
      // Fallback
    }
  }

  if (typeof window !== "undefined" && window.localStorage) {
    try {
      localStorage.removeItem(LOCAL_STORAGE_KEY)
    } catch {
      // Ignore
    }
  }
}
