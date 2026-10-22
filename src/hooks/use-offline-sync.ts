"use client"

import * as React from "react"
import {
  type OfflineEvidenceItem,
  type OfflineEvidenceType,
  type OfflineSyncBatchResult,
} from "@/lib/pwa-offline-sync-queue"

const DB_NAME = "severinno_offline_db"
const DB_VERSION = 1
const STORE_NAME = "offline_sync_queue"

export interface UseOfflineSyncReturn {
  isOnline: boolean
  isSyncing: boolean
  lastSyncAt: Date | null
  items: OfflineEvidenceItem[]
  pendingCount: number
  summary: {
    totalPending: number
    checkinsPending: number
    photosPending: number
    hasFailures: boolean
  }
  enqueueEvidence: (params: {
    bookingId: string
    providerId: string
    type: OfflineEvidenceType
    latitude?: number
    longitude?: number
    accuracy?: number
    photoBase64?: string
    notes?: string
  }) => Promise<OfflineEvidenceItem>
  syncNow: () => Promise<OfflineSyncBatchResult | null>
  clearCompleted: () => Promise<void>
}

// Armazenamento em memória para SSR ou navegadores sem IndexedDB
let memoryStorage: OfflineEvidenceItem[] = []

function openIndexedDB(): Promise<IDBDatabase | null> {
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

async function loadItemsFromStorage(): Promise<OfflineEvidenceItem[]> {
  const db = await openIndexedDB()
  if (!db) {
    return [...memoryStorage]
  }

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, "readonly")
      const store = tx.objectStore(STORE_NAME)
      const request = store.getAll()

      request.onsuccess = () => resolve(request.result || [])
      request.onerror = () => resolve([...memoryStorage])
    } catch {
      resolve([...memoryStorage])
    }
  })
}

async function saveItemToStorage(item: OfflineEvidenceItem): Promise<void> {
  const db = await openIndexedDB()
  if (!db) {
    const idx = memoryStorage.findIndex((i) => i.id === item.id)
    if (idx >= 0) memoryStorage[idx] = item
    else memoryStorage.push(item)
    return
  }

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, "readwrite")
      const store = tx.objectStore(STORE_NAME)
      store.put(item)
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
    } catch {
      resolve()
    }
  })
}

async function removeItemFromStorage(id: string): Promise<void> {
  const db = await openIndexedDB()
  if (!db) {
    memoryStorage = memoryStorage.filter((i) => i.id !== id)
    return
  }

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, "readwrite")
      const store = tx.objectStore(STORE_NAME)
      store.delete(id)
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
    } catch {
      resolve()
    }
  })
}

/**
 * useOfflineSync — React Hook para gerenciamento da fila de sincronização PWA
 *
 * Integra IndexedDB local com a API /api/sync/offline-batch e Service Worker
 * permitindo que prestadores tirem fotos e façam check-in sem conexão.
 */
export function useOfflineSync(): UseOfflineSyncReturn {
  const [isOnline, setIsOnline] = React.useState<boolean>(() => {
    if (typeof navigator !== "undefined" && typeof navigator.onLine === "boolean") {
      return navigator.onLine
    }
    return true
  })

  const [items, setItems] = React.useState<OfflineEvidenceItem[]>([])
  const [isSyncing, setIsSyncing] = React.useState<boolean>(false)
  const [lastSyncAt, setLastSyncAt] = React.useState<Date | null>(null)

  const reloadItems = React.useCallback(async () => {
    const stored = await loadItemsFromStorage()
    setItems(stored)
  }, [])

  // Sincroniza a fila pendente com o servidor
  const syncNow = React.useCallback(async (): Promise<OfflineSyncBatchResult | null> => {
    if (typeof window === "undefined" || !navigator.onLine) {
      return null
    }

    const currentItems = await loadItemsFromStorage()
    const pending = currentItems.filter((i) => i.status === "PENDING" || i.status === "FAILED")
    if (pending.length === 0) {
      return null
    }

    setIsSyncing(true)
    try {
      const response = await fetch("/api/sync/offline-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: pending }),
      })

      if (!response.ok) {
        throw new Error(`Servidor respondeu com status ${response.status}`)
      }

      const result: OfflineSyncBatchResult = await response.json()

      // O contrato é o do servidor (src/lib/offline-evidence-sync.ts). Validar
      // a forma evita o bug anterior: a resposta antiga não tinha `syncedIds`,
      // o `for` estourava e o catch deixava a fila PENDING para sempre.
      if (!Array.isArray(result?.syncedIds)) {
        throw new Error("Resposta de sincronização inválida")
      }

      // Remove itens sincronizados do armazenamento local
      for (const id of result.syncedIds) {
        await removeItemFromStorage(id)
      }

      // Itens que o servidor recusou (booking de outro prestador, upload
      // falhou) voltam com erro: marca a tentativa em vez de reenviar cego.
      if (Array.isArray(result.errors) && result.errors.length > 0) {
        const errorById = new Map(result.errors.map((e) => [e.id, e.error]))
        for (const item of currentItems) {
          const error = errorById.get(item.id)
          if (!error) continue
          const attempts = item.attempts + 1
          await saveItemToStorage({
            ...item,
            attempts,
            status: attempts >= item.maxAttempts ? "FAILED" : "PENDING",
            lastError: error,
          })
        }
      }

      setLastSyncAt(new Date())
      await reloadItems()
      return result
    } catch {
      // Falha na sincronização: os itens continuam no IndexedDB para retry
      await reloadItems()
      return null
    } finally {
      setIsSyncing(false)
    }
  }, [reloadItems])

  // Carrega itens na montagem do hook via callback assíncrono
  React.useEffect(() => {
    let active = true
    loadItemsFromStorage()
      .then((stored) => {
        if (active) {
          setItems(stored)
        }
      })
      .catch(() => {})

    return () => {
      active = false
    }
  }, [])

  // Escuta status de conectividade de rede
  React.useEffect(() => {
    if (typeof window === "undefined") return

    const handleOnline = () => {
      setIsOnline(true)
      void syncNow()
    }

    const handleOffline = () => {
      setIsOnline(false)
    }

    const handleMessage = (event: MessageEvent) => {
      if (event.data && event.data.type === "OFFLINE_SYNC_COMPLETED") {
        setLastSyncAt(new Date())
        void reloadItems()
      }
    }

    window.addEventListener("online", handleOnline)
    window.addEventListener("offline", handleOffline)
    navigator.serviceWorker?.addEventListener("message", handleMessage)

    return () => {
      window.removeEventListener("online", handleOnline)
      window.removeEventListener("offline", handleOffline)
      navigator.serviceWorker?.removeEventListener("message", handleMessage)
    }
  }, [reloadItems, syncNow])

  // Enfileira nova evidência offline
  const enqueueEvidence = React.useCallback(
    async (params: {
      bookingId: string
      providerId: string
      type: OfflineEvidenceType
      latitude?: number
      longitude?: number
      accuracy?: number
      photoBase64?: string
      notes?: string
    }): Promise<OfflineEvidenceItem> => {
      const id = `cli_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`

      const newItem: OfflineEvidenceItem = {
        id,
        bookingId: params.bookingId,
        providerId: params.providerId,
        type: params.type,
        latitude: params.latitude,
        longitude: params.longitude,
        accuracy: params.accuracy ?? 10,
        photoBase64: params.photoBase64,
        notes: params.notes,
        recordedAt: new Date().toISOString(),
        status: "PENDING",
        attempts: 0,
        maxAttempts: 5,
      }

      await saveItemToStorage(newItem)
      await reloadItems()

      // Tenta registrar Background Sync no Service Worker se suportado pelo navegador
      if (typeof window !== "undefined" && "serviceWorker" in navigator) {
        try {
          const reg = await navigator.serviceWorker.ready
          if ("sync" in reg) {
            // @ts-expect-error - Background Sync API
            await reg.sync.register("sync-offline-batch")
          }
        } catch {
          // Background sync não suportado; fallback nativo online listener
        }
      }

      // Se já estiver online, tenta enviar imediatamente
      if (navigator.onLine) {
        void syncNow()
      }

      return newItem
    },
    [reloadItems, syncNow],
  )

  const clearCompleted = React.useCallback(async () => {
    const currentItems = await loadItemsFromStorage()
    const synced = currentItems.filter((i) => i.status === "SYNCED")
    for (const item of synced) {
      await removeItemFromStorage(item.id)
    }
    await reloadItems()
  }, [reloadItems])

  const pendingItems = items.filter((i) => i.status === "PENDING" || i.status === "FAILED")

  const summary = {
    totalPending: pendingItems.length,
    checkinsPending: pendingItems.filter((i) => i.type === "CHECKIN").length,
    photosPending: pendingItems.filter((i) => i.type === "BEFORE_PHOTO" || i.type === "AFTER_PHOTO")
      .length,
    hasFailures: pendingItems.some((i) => i.status === "FAILED"),
  }

  return {
    isOnline,
    isSyncing,
    lastSyncAt,
    items,
    pendingCount: pendingItems.length,
    summary,
    enqueueEvidence,
    syncNow,
    clearCompleted,
  }
}
