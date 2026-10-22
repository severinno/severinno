import "server-only"

/**
 * offline-evidence-sync.ts — destino durável do lote offline do PWA.
 *
 * O prestador trabalha sem sinal e enfileira evidências (check-in, fotos
 * antes/depois, assinatura) no IndexedDB. Ao reconectar, o hook
 * `useOfflineSync` envia o lote para POST /api/sync/offline-batch.
 *
 * ANTES esta rota apenas ecoava `{ success: true, processed, synced }` sem
 * gravar nada — e o hook ainda lia `syncedIds` (campo que a resposta não
 * tinha), então a fila local nunca era limpa: perda silenciosa de prova de
 * campo. Este módulo é a gravação real:
 *
 *   - ownership: o booking precisa pertencer ao prestador autenticado;
 *   - idempotência: `externalId` (id gerado no cliente) é único; retry do
 *     mesmo lote não duplica evidência;
 *   - foto: base64 → storage (S3/MinIO) e guarda a URL + digest;
 *   - falha por item vira `errors[]` (o lote não morre inteiro por um item).
 */

import { z } from "zod"

import { db } from "./db"
import { uploadBase64, type UploadOptions } from "./s3"
import { sanitizeText } from "./sanitize"
import logger from "./logger"

export const OFFLINE_EVIDENCE_TYPES = [
  "CHECKIN",
  "BEFORE_PHOTO",
  "AFTER_PHOTO",
  "SIGNATURE",
] as const

/** Limite de itens por lote — espelha o max do corpo (1 MB) do proxy. */
export const OFFLINE_EVIDENCE_MAX_ITEMS = 20

/** Limite do base64 por foto (~500 KB de imagem). */
export const OFFLINE_EVIDENCE_MAX_PHOTO_CHARS = 700_000

const isIsoDate = (value: string) => Number.isFinite(Date.parse(value))

/**
 * Item do lote. Campos extras do cliente (providerId, status, attempts,
 * photoDigestSha256…) são ignorados, não rejeitados: o cliente envia o item
 * inteiro da fila, e o servidor deriva identidade/estado do contexto
 * autenticado — nunca do payload.
 */
export const offlineEvidenceItemSchema = z.object({
  id: z.string().trim().min(8).max(128),
  bookingId: z.string().trim().min(1).max(64),
  type: z.enum(OFFLINE_EVIDENCE_TYPES),
  latitude: z.number().finite().min(-90).max(90).optional(),
  longitude: z.number().finite().min(-180).max(180).optional(),
  accuracy: z.number().finite().nonnegative().max(100_000).optional(),
  photoBase64: z.string().max(OFFLINE_EVIDENCE_MAX_PHOTO_CHARS).optional(),
  photoDigestSha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/i)
    .optional(),
  notes: z.string().max(2_000).optional(),
  recordedAt: z.string().refine(isIsoDate, "recordedAt deve ser uma data ISO válida"),
})

export type OfflineEvidenceInput = z.infer<typeof offlineEvidenceItemSchema>

export const offlineEvidenceBatchSchema = z.object({
  items: z
    .array(offlineEvidenceItemSchema)
    .min(1, "Envie pelo menos 1 item")
    .max(OFFLINE_EVIDENCE_MAX_ITEMS, `Máximo de ${OFFLINE_EVIDENCE_MAX_ITEMS} itens por lote`),
})

export type OfflineSyncBatchResult = {
  processed: number
  succeeded: number
  failed: number
  remainingPending: number
  syncedIds: string[]
  errors: Array<{ id: string; error: string }>
}

/** Injeção do upload em testes (produção: `uploadBase64`). */
export type EvidenceUploader = (dataUrl: string, options: UploadOptions) => Promise<{ url: string }>

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002"
  )
}

/**
 * Aplica um lote de evidências offline do prestador autenticado.
 *
 * Nunca confia em `providerId` do payload: a identidade vem do caller
 * (sessão), e cada booking é conferido contra ela.
 */
export async function applyOfflineEvidenceBatch(params: {
  providerId: string
  items: OfflineEvidenceInput[]
  upload?: EvidenceUploader
}): Promise<OfflineSyncBatchResult> {
  const { providerId, items, upload = uploadBase64 } = params

  const result: OfflineSyncBatchResult = {
    processed: items.length,
    succeeded: 0,
    failed: 0,
    remainingPending: 0,
    syncedIds: [],
    errors: [],
  }

  if (items.length === 0) return result

  const bookingIds = [...new Set(items.map((item) => item.bookingId))]
  const externalIds = items.map((item) => item.id)

  const [bookings, alreadyStored] = await Promise.all([
    db.booking.findMany({
      where: { id: { in: bookingIds } },
      select: { id: true, providerId: true },
    }),
    db.offlineEvidence.findMany({
      where: { externalId: { in: externalIds } },
      select: { externalId: true },
    }),
  ])

  const bookingById = new Map(bookings.map((booking) => [booking.id, booking]))
  const storedIds = new Set(alreadyStored.map((row) => row.externalId))

  for (const item of items) {
    const booking = bookingById.get(item.bookingId)

    if (!booking) {
      result.failed++
      result.errors.push({ id: item.id, error: "Agendamento não encontrado" })
      continue
    }
    if (booking.providerId !== providerId) {
      result.failed++
      result.errors.push({ id: item.id, error: "Agendamento não pertence ao prestador" })
      continue
    }

    // Retry do mesmo lote: já gravado = sucesso idempotente.
    if (storedIds.has(item.id)) {
      result.succeeded++
      result.syncedIds.push(item.id)
      continue
    }

    let photoUrl: string | undefined
    if (item.photoBase64) {
      try {
        const uploaded = await upload(item.photoBase64, {
          prefix: `offline-evidence/${item.bookingId}/`,
        })
        photoUrl = uploaded.url
      } catch (err) {
        const message = err instanceof Error ? err.message : "Falha no upload da foto"
        result.failed++
        result.errors.push({ id: item.id, error: message })
        continue
      }
    }

    try {
      await db.offlineEvidence.create({
        data: {
          externalId: item.id,
          bookingId: item.bookingId,
          providerId,
          type: item.type,
          latitude: item.latitude ?? null,
          longitude: item.longitude ?? null,
          accuracy: item.accuracy ?? null,
          photoUrl: photoUrl ?? null,
          photoDigest: item.photoDigestSha256 ?? null,
          notes: item.notes ? sanitizeText(item.notes) : null,
          recordedAt: new Date(item.recordedAt),
        },
      })
      result.succeeded++
      result.syncedIds.push(item.id)
    } catch (err) {
      // Corrida entre dois envios do mesmo lote: o unique decide; o segundo
      // vira sucesso idempotente em vez de erro para o cliente.
      if (isUniqueViolation(err)) {
        result.succeeded++
        result.syncedIds.push(item.id)
        continue
      }
      const message = err instanceof Error ? err.message : "Falha ao gravar evidência"
      logger.warn({ err, evidenceId: item.id }, "offline evidence persist failed")
      result.failed++
      result.errors.push({ id: item.id, error: message })
    }
  }

  logger.info(
    {
      providerId,
      processed: result.processed,
      succeeded: result.succeeded,
      failed: result.failed,
    },
    "offline evidence batch applied",
  )

  return result
}
