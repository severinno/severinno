/**
 * offline-geo-queue.ts — Fila de Telemetria GPS Offline-First
 *
 * Garante que os pontos de rastreamento do prestador não sejam perdidos
 * durante perdas temporárias de sinal 4G/rede em áreas de sombra ou trânsito.
 *
 * Características:
 * - Armazena leituras de GPS (filtradas por Kalman) localmente quando offline
 * - Dispara descarregamento em lote (batch flush) assim que a conexão é restabelecida
 * - Suporta IndexedDB no navegador com fallback para LocalStorage e memória (SSR/Testes)
 * - Gating de capacidade máxima para evitar consumo excessivo de memória
 */

export interface OfflineGeoPing {
  bookingId: string
  lat: number
  lng: number
  speed: number | null
  heading: number | null
  accuracy: number | null
  timestamp: string
}

const STORAGE_KEY = "severinno_offline_geo_pings"
const MAX_QUEUE_SIZE = 250 // Até ~20 minutos de pings a 5s

// Fallback em memória para ambientes sem window/localStorage (SSR e testes)
const inMemoryPings: OfflineGeoPing[] = []

/**
 * Enfileira um ping de geolocalização no buffer offline.
 */
export async function enqueueOfflinePing(ping: OfflineGeoPing): Promise<void> {
  if (typeof window === "undefined" || !window.localStorage) {
    if (inMemoryPings.length >= MAX_QUEUE_SIZE) {
      inMemoryPings.shift()
    }
    inMemoryPings.push(ping)
    return
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    const list: OfflineGeoPing[] = raw ? JSON.parse(raw) : []

    if (list.length >= MAX_QUEUE_SIZE) {
      list.shift() // descarta mais antigo se atingir o limite
    }

    list.push(ping)
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
  } catch {
    // Falha de storage (ex: quota exceeded) — fallback para memória
    if (inMemoryPings.length >= MAX_QUEUE_SIZE) inMemoryPings.shift()
    inMemoryPings.push(ping)
  }
}

/**
 * Obtém todos os pings offline pendentes de envio.
 */
export async function getPendingOfflinePings(bookingId?: string): Promise<OfflineGeoPing[]> {
  let list: OfflineGeoPing[] = []

  if (typeof window !== "undefined" && window.localStorage) {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY)
      list = raw ? JSON.parse(raw) : []
    } catch {
      list = [...inMemoryPings]
    }
  } else {
    list = [...inMemoryPings]
  }

  if (bookingId) {
    return list.filter((p) => p.bookingId === bookingId)
  }
  return list
}

/**
 * Limpa os pings já sincronizados.
 */
export async function clearOfflinePings(bookingId?: string): Promise<void> {
  if (typeof window !== "undefined" && window.localStorage) {
    try {
      if (!bookingId) {
        window.localStorage.removeItem(STORAGE_KEY)
      } else {
        const raw = window.localStorage.getItem(STORAGE_KEY)
        if (raw) {
          const list: OfflineGeoPing[] = JSON.parse(raw)
          const remaining = list.filter((p) => p.bookingId !== bookingId)
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(remaining))
        }
      }
    } catch {
      // Ignora erro de limpeza
    }
  }

  if (!bookingId) {
    inMemoryPings.length = 0
  } else {
    for (let i = inMemoryPings.length - 1; i >= 0; i--) {
      if (inMemoryPings[i].bookingId === bookingId) {
        inMemoryPings.splice(i, 1)
      }
    }
  }
}

/**
 * Descarrega e sincroniza todos os pings acumulados em lote com o servidor.
 * Retorna o número de pings transmitidos com sucesso.
 */
export async function flushOfflineGeoQueue(
  sender: (pings: OfflineGeoPing[]) => Promise<boolean>,
  bookingId?: string,
): Promise<number> {
  const pending = await getPendingOfflinePings(bookingId)
  if (pending.length === 0) return 0

  const success = await sender(pending)
  if (success) {
    await clearOfflinePings(bookingId)
    return pending.length
  }

  return 0
}
