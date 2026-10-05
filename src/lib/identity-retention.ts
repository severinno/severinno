import { db } from "@/lib/db"
import logger from "@/lib/logger"
import { deleteFromS3 } from "@/lib/s3"

/**
 * Retenção LGPD dos artefatos de verificação de identidade (KYC).
 *
 * A política, em três atos:
 *
 *  1. DECISÃO (aprovação automática via OCR ou admin): o documento e a selfie
 *     são removidos do MinIO e as URLs nuladas — o que fica é o ESTADO
 *     (`identityStatus` + `identityVerifiedAt`), que é o dado de negócio.
 *     Biometria não tem motivo para sobreviver à decisão que ela apoiou.
 *  2. PENDÊNCIA EXPIRADA: quem enviou e ficou `pending` há mais de
 *     `maxAgeDays` dias perde os artefatos e passa a `rejected` com motivo
 *     gravado no Redis (a reenvio é um clique).
 *  3. EXCLUSÃO DA CONTA: os artefatos seguem a mesma função do ato 1.
 *
 * O OCR em Redis já caduca sozinho (TTL 30d, gravado no upload).
 */

/** Campos do User que apontam para artefatos de biometria no MinIO. */
const IDENTITY_URL_FIELDS = ["identityDocUrl", "identitySelfieUrl"] as const

/**
 * A key do MinIO a partir da URL gravada (`uploadBuffer` devolve a URL
 * pública — path-style `{endpoint}/{bucket}/identity/...`). As keys deste
 * fluxo são namespaced em `identity/`, então o recorte é pela marca — sem
 * chute sobre o formato do host.
 *
 * @param url URL gravada em `identityDocUrl`/`identitySelfieUrl`
 * @returns a key (`identity/...`) ou null quando a URL não é do fluxo
 */
export function s3KeyFromUrl(url: string): string | null {
  const idx = url.indexOf("identity/")
  return idx >= 0 ? url.slice(idx) : null
}

/**
 * Remove os artefatos de biometria de um usuário (best-effort no S3, com o
 * log nomeando as keys) e nula as URLs no banco PRIMEIRO — o app para de
 * expor mesmo se o DeleteObject falhar (o objeto fica órfão, não alcançável
 * pela aplicação; a remoção definitiva cabe ao lifecycle do bucket).
 */
export async function deleteIdentityArtifacts(userId: string): Promise<{ deletedKeys: number }> {
  try {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { identityDocUrl: true, identitySelfieUrl: true },
    })
    if (!user) return { deletedKeys: 0 }

    const keys = IDENTITY_URL_FIELDS.map((f) => user[f])
      .filter((v): v is string => typeof v === "string" && v.length > 0)
      .map((u) => s3KeyFromUrl(u))
      .filter((k): k is string => k !== null)

    // Sem artefato no fluxo (biometria já removida ou nunca enviada): no-op
    // real — nem update de banco, nem chamada de bucket.
    if (keys.length === 0) return { deletedKeys: 0 }

    // 1) o app para de expor (mesmo com o S3 falhando, o dado não é servido)
    await db.user.update({
      where: { id: userId },
      data: { identityDocUrl: null, identitySelfieUrl: null },
    })

    // 2) o objeto sai do bucket (best-effort, um falho não cancela os demais;
    // o log do deleteFromS3 nomeia a key em falha)
    const resultados = await Promise.allSettled(keys.map((k) => deleteFromS3(k)))
    const deletados = resultados.filter((r) => r.status === "fulfilled").length

    logger.info({ userId, deletedKeys: deletados }, "lgpd: artefatos de identidade removidos")
    return { deletedKeys: deletados }
  } catch (err) {
    logger.error({ err, userId }, "lgpd: falha ao remover artefatos de identidade")
    return { deletedKeys: 0 }
  }
}

/**
 * O ato 2 da política: pendências expiradas perdem a biometria e viram
 * `rejected` com motivo gravado — o loop fecha sem cron novo (chamado pelo
 * endpoint admin de purge e disponível para o cron de drift).
 *
 * @returns quantas pendências foram purgadas
 */
export async function purgeStalePendingIdentities(maxAgeDays = 30): Promise<{ purged: number }> {
  const cutoff = new Date(Date.now() - maxAgeDays * 24 * 3600 * 1000)
  const pendentes = await db.user.findMany({
    where: { identityStatus: "pending", updatedAt: { lt: cutoff } },
    select: { id: true },
    take: 200,
  })

  let purged = 0
  for (const u of pendentes) {
    try {
      await deleteIdentityArtifacts(u.id)
      await db.user.update({
        where: { id: u.id },
        data: { identityStatus: "rejected", identityVerifiedAt: null },
      })
      try {
        const { getClient } = await import("@/lib/redis")
        const redis = getClient()
        if (redis) {
          await redis.set(
            `identity:reason:${u.id}`,
            `Verificação expirada (retenção LGPD — artefatos removidos após ${maxAgeDays} dias pendentes). Reenvie para nova análise.`,
            "EX",
            30 * 24 * 3600,
          )
        }
      } catch {
        // Redis é best-effort
      }
      purged += 1
    } catch (err) {
      logger.error({ err, userId: u.id }, "lgpd: falha ao purgar pendência expirada")
    }
  }

  if (purged > 0) logger.info({ purged, maxAgeDays }, "lgpd: varredura de retenção concluída")
  return { purged }
}
