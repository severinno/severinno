import { z } from "zod"

import { withRoute } from "@/lib/api-route"
import logger from "@/lib/logger"

/**
 * POST /api/rum/vitrine
 *
 * Recebe beacons de RUM com as medidas User Timing da paginação da vitrine
 * (`vitrine:*` — baseline e limiares em docs/vitrine-pagination-baseline.md)
 * e as vira LOG ESTRUTURADO (mesmo destino do /api/web-vitals: Loki/Promtail).
 * Nada de banco: RUM leve é um log que qualquer agregador consome.
 *
 * SEM PII, POR CONSTRUÇÃO (duas camadas — a client está em src/lib/vitrine-rum.ts):
 *   1. o zod aqui é WHITELIST: campos fora do schema são DESCARTADOS no parse
 *      (o `parsed.data` logado só pode conter os campos declarados) e o corpo
 *      CRU nunca vai para o log — nem num payload inválido;
 *   2. a resposta é SEMPRE 204 sem corpo, e nenhum erro vaza: RUM é
 *      observabilidade, o endpoint não tem estado para proteger e não pode
 *      virar sinal de erro no cliente (sendBeacon nem lê a resposta).
 *
 * LIMITES de abuso (endpoint público sem auth): content-length tetoado,
 * `entries` entre 1 e 20 por request, durações até 60s. O custo de um flood
 * fica em linhas de log de tamanho máximo conhecido — não em queries.
 */

const RUM_NAMES = [
  "vitrine:pagina:render",
  "vitrine:walk:render",
  "vitrine:deeplink:render",
  "vitrine:popstate:render",
] as const

const entrySchema = z.object({
  name: z.enum(RUM_NAMES),
  duration: z.number().finite().min(0).max(60_000),
  target: z.number().int().min(1).max(500),
  direction: z.enum(["proxima", "anterior"]).optional(),
  warm: z.boolean().optional(),
  inFlight: z.boolean().optional(),
  walked: z.boolean().optional(),
})

const bodySchema = z.object({
  entries: z.array(entrySchema).min(1).max(20),
})

/** 16 KB bastam para o batch máximo (20 × ~120 bytes) com folga. */
const MAX_BODY_BYTES = 16_384

/** Resposta canônica do endpoint: 204 sem corpo — para o beacon tanto faz,
 *  e o custo da resposta é o mínimo do HTTP. */
const NO_CONTENT = new Response(null, { status: 204 })

export const POST = withRoute("api.rum.vitrine.POST", async (request) => {
  try {
    const declaredLength = Number(request.headers.get("content-length") ?? "0")
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
      return NO_CONTENT
    }

    const parsed = bodySchema.safeParse(await request.json())
    if (!parsed.success) {
      // Payload inválido NÃO é logado (o corpo cru é a única coisa que poderia
      // carregar algo inesperado — e é exatamente ele que fica de fora).
      return NO_CONTENT
    }

    logger.info(
      {
        rum: parsed.data.entries,
        count: parsed.data.entries.length,
      },
      `[VitrineRUM] ${parsed.data.entries.length} medida(s)`,
    )
  } catch {
    // JSON quebrado, body stream travado: beacon nunca vira erro.
  }
  return NO_CONTENT
})
