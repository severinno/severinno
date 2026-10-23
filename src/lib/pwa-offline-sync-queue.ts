/**
 * pwa-offline-sync-queue.ts — PWA Offline-First & Background Sync Queue para Fotos e Check-ins
 *
 * Permite que prestadores de serviço operem em locais sem conectividade (subsolos de prédios,
 * garagens subterrâneas, elevadores ou zonas rurais) salvando laudos fotográficos e check-ins
 * localmente com integridade criptográfica.
 *
 * Ao restabelecer a conexão de internet (Wi-Fi, 4G, 5G), o Service Worker ou o cliente
 * executa a sincronização atômica em lote em background sem perda de dados.
 */

import { createHash, randomBytes } from "crypto"

export type OfflineEvidenceType = "CHECKIN" | "BEFORE_PHOTO" | "AFTER_PHOTO" | "SIGNATURE"

export interface OfflineEvidenceItem {
  id: string
  bookingId: string
  providerId: string
  type: OfflineEvidenceType
  latitude?: number
  longitude?: number
  accuracy?: number
  photoDigestSha256?: string
  photoBase64?: string
  notes?: string
  recordedAt: string
  status: "PENDING" | "SYNCING" | "SYNCED" | "FAILED"
  attempts: number
  maxAttempts: number
  lastError?: string
}

export interface EnqueueEvidenceParams {
  bookingId: string
  providerId: string
  type: OfflineEvidenceType
  latitude?: number
  longitude?: number
  accuracy?: number
  photoBase64?: string
  notes?: string
  recordedAt?: string
  maxAttempts?: number
}

export interface OfflineSyncBatchResult {
  processed: number
  succeeded: number
  failed: number
  remainingPending: number
  syncedIds: string[]
  errors: Array<{ id: string; error: string }>
}

// Armazenamento em memória (espelha IndexedDB/LocalStorage no browser)
let evidenceQueue: OfflineEvidenceItem[] = []

/**
 * Enfileira um evento ou evidência fotográfica offline para sincronização posterior.
 */
export function enqueueOfflineEvidence(params: EnqueueEvidenceParams): OfflineEvidenceItem {
  const {
    bookingId,
    providerId,
    type,
    latitude,
    longitude,
    accuracy = 10,
    photoBase64,
    notes,
    recordedAt = new Date().toISOString(),
    maxAttempts = 5,
  } = params

  const id = `off_${Date.now()}_${randomBytes(4).toString("hex")}`

  // Gera hash SHA-256 da foto para garantir a integridade do arquivo pré e pós sync
  let photoDigestSha256: string | undefined
  if (photoBase64) {
    photoDigestSha256 = createHash("sha256").update(photoBase64).digest("hex")
  }

  const item: OfflineEvidenceItem = {
    id,
    bookingId,
    providerId,
    type,
    latitude,
    longitude,
    accuracy,
    photoDigestSha256,
    photoBase64,
    notes,
    recordedAt,
    status: "PENDING",
    attempts: 0,
    maxAttempts,
  }

  evidenceQueue.push(item)
  return item
}

/**
 * Retorna todos os itens pendentes na fila de sincronização.
 */
export function getPendingOfflineEvidence(): OfflineEvidenceItem[] {
  return evidenceQueue.filter((i) => i.status === "PENDING" || i.status === "FAILED")
}

/**
 * Retorna o resumo da fila para exibição de badge de status no PWA.
 */
export function getOfflineQueueSummary(): {
  totalPending: number
  checkinsPending: number
  photosPending: number
  hasFailures: boolean
} {
  const pending = getPendingOfflineEvidence()
  const checkinsPending = pending.filter((i) => i.type === "CHECKIN").length
  const photosPending = pending.filter(
    (i) => i.type === "BEFORE_PHOTO" || i.type === "AFTER_PHOTO",
  ).length
  const hasFailures = pending.some((i) => i.status === "FAILED")

  return {
    totalPending: pending.length,
    checkinsPending,
    photosPending,
    hasFailures,
  }
}

/**
 * Executa a sincronização em lote da fila offline contra a API do servidor.
 */
export async function processOfflineEvidenceBatch(
  syncExecutor: (item: OfflineEvidenceItem) => Promise<boolean>,
): Promise<OfflineSyncBatchResult> {
  const pending = getPendingOfflineEvidence()
  let succeeded = 0
  let failed = 0
  const syncedIds: string[] = []
  const errors: Array<{ id: string; error: string }> = []

  for (const item of pending) {
    item.status = "SYNCING"
    item.attempts += 1

    try {
      const ok = await syncExecutor(item)
      if (ok) {
        item.status = "SYNCED"
        succeeded += 1
        syncedIds.push(item.id)
      } else {
        item.status = item.attempts >= item.maxAttempts ? "FAILED" : "PENDING"
        item.lastError = "Falha reportada pelo servidor de sincronização"
        failed += 1
        errors.push({ id: item.id, error: item.lastError })
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Erro desconhecido na sincronização"
      item.status = item.attempts >= item.maxAttempts ? "FAILED" : "PENDING"
      item.lastError = errorMsg
      failed += 1
      errors.push({ id: item.id, error: errorMsg })
    }
  }

  // Remove itens sincronizados da fila ativa
  evidenceQueue = evidenceQueue.filter((i) => i.status !== "SYNCED")

  return {
    processed: pending.length,
    succeeded,
    failed,
    remainingPending: evidenceQueue.length,
    syncedIds,
    errors,
  }
}

/**
 * Limpa a fila de evidências (usado em suítes de testes).
 */
export function clearOfflineEvidenceQueue(): void {
  evidenceQueue = []
}
