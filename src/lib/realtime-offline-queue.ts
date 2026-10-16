/**
 * realtime-offline-queue.ts — Fila de Mensagens Offline com Replay Automático
 *
 * Persiste mensagens enviadas durante instabilidade de rede (4G/5G oscilando em GV)
 * em localStorage (com fallback em memória). Permite replay FIFO assim que a
 * conexão Socket.IO for restabelecida, garantindo integridade e idempotência.
 */

import { randomUUID } from "crypto"

export interface OfflineRealtimeMessage {
  clientMessageId: string
  fromId: string
  toId: string
  content: string
  bookingId?: string
  enqueuedAt: number
}

const STORAGE_KEY = "severinno:realtime:pending-messages"
const MAX_QUEUE_SIZE = 50

// Fallback in-memory quando localStorage não está disponível (SSR / testes / cookies restritos)
const memoryQueue: OfflineRealtimeMessage[] = []

function isStorageAvailable(): boolean {
  if (typeof window === "undefined" || !window.localStorage) return false
  try {
    const testKey = "__test_storage__"
    window.localStorage.setItem(testKey, "1")
    window.localStorage.removeItem(testKey)
    return true
  } catch {
    return false
  }
}

/**
 * Retorna as mensagens pendentes na fila (FIFO).
 */
export function getPendingMessages(): OfflineRealtimeMessage[] {
  if (!isStorageAvailable()) {
    return [...memoryQueue]
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/**
 * Salva a fila de mensagens no storage apropriado.
 */
function persistQueue(queue: OfflineRealtimeMessage[]): void {
  const boundedQueue = queue.slice(-MAX_QUEUE_SIZE)

  if (!isStorageAvailable()) {
    memoryQueue.length = 0
    memoryQueue.push(...boundedQueue)
    return
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(boundedQueue))
  } catch {
    memoryQueue.length = 0
    memoryQueue.push(...boundedQueue)
  }
}

/**
 * Enfileira uma mensagem para envio posterior.
 */
export function enqueuePendingMessage(payload: {
  fromId: string
  toId: string
  content: string
  bookingId?: string
  clientMessageId?: string
}): OfflineRealtimeMessage {
  const queue = getPendingMessages()

  const clientMessageId =
    payload.clientMessageId ||
    (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : randomUUID())

  // Evita duplicatas se o clientMessageId já existir na fila
  const existing = queue.find((m) => m.clientMessageId === clientMessageId)
  if (existing) return existing

  const entry: OfflineRealtimeMessage = {
    clientMessageId,
    fromId: payload.fromId,
    toId: payload.toId,
    content: payload.content,
    bookingId: payload.bookingId,
    enqueuedAt: Date.now(),
  }

  queue.push(entry)
  persistQueue(queue)
  return entry
}

/**
 * Remove uma mensagem da fila pelo seu clientMessageId.
 */
export function removePendingMessage(clientMessageId: string): void {
  const queue = getPendingMessages().filter((m) => m.clientMessageId !== clientMessageId)
  persistQueue(queue)
}

/**
 * Limpa toda a fila de mensagens pendentes.
 */
export function clearPendingMessages(): void {
  if (isStorageAvailable()) {
    try {
      window.localStorage.removeItem(STORAGE_KEY)
    } catch {
      // ignore
    }
  }
  memoryQueue.length = 0
}

/**
 * Retorna a quantidade atual de mensagens pendentes na fila.
 */
export function getPendingCount(): number {
  return getPendingMessages().length
}
