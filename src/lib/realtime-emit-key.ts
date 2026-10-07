import "server-only"
import { readFileSync } from "node:fs"

/**
 * Chave do bridge /emit do realtime (REALTIME_EMIT_API_KEY) — fail-closed.
 *
 * FONTE DA CHAVE (por prioridade):
 *   1. REALTIME_EMIT_API_KEY_FILE → arquivo montado de um Docker Secret
 *      (/run/secrets/realtime_emit_api_key nos composes de produção; o
 *      docker-entrypoint.sh também exporta /run/secrets/* como env — a env
 *      tem precedência sobre o secret no entrypoint, mas aqui o _FILE vem
 *      primeiro para o valor nunca precisar existir em environment).
 *   2. REALTIME_EMIT_API_KEY (env direta) — dev/staging, composes
 *      monolíticos que leem do .env.
 *
 * REGRA DE OURO: se *_FILE está configurado e o arquivo NÃO pôde ser lido, a
 * função LANÇA — não há fallback silencioso para a env. O operador declarou
 * o caminho do secret; cair para a env (ou pior, seguir sem chave) esconderia
 * um mount quebrado atrás de um emit que "funciona" contra a chave errada.
 *
 * O mini-service (mini-services/realtime/index.ts) tem uma cópia desta
 * regra — a imagem dele não contém src/, então os dois lados duplicam de
 * propósito; o guard check-realtime-emit-key-source.mjs prende o desenho
 * (secret + _FILE) nos composes de produção.
 */
export function readRealtimeEmitKey(
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  const filePath = env.REALTIME_EMIT_API_KEY_FILE
  if (filePath) {
    let fromFile: string
    try {
      fromFile = readFileSync(filePath, "utf8").trim()
    } catch (err) {
      throw new Error(
        `[realtime] REALTIME_EMIT_API_KEY_FILE aponta para '${filePath}' mas o arquivo não pôde ser lido — ` +
          `o Docker Secret realtime_emit_api_key não está montado neste container. ` +
          `Fail-closed: sem fallback para a env direta. ` +
          `Verifique o bloco secrets: do serviço no compose de produção.`,
        { cause: err },
      )
    }
    if (fromFile) return fromFile
  }
  const direct = env.REALTIME_EMIT_API_KEY
  return direct && direct.trim() ? direct.trim() : undefined
}
