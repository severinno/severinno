/**
 * e2e/realtime-emit.ts
 *
 * Helpers compartilhados entre os E2Es de realtime — elimina o espelhamento
 * verbatim do client HTTP de emissão (POST /emit) e da leitura de envs do
 * .env.local:
 *   - e2e/admin-session-revocation.spec.ts  (readEmitToken + emitNotificationToRoom)
 *   - e2e/realtime-ttl-sweep.spec.ts        (readEnv genérico)
 *
 * Centraliza:
 *   - readEnv — lê uma env var do processo OU do .env.local (padrão único;
 *     o CI injeta via env, o dev lê do arquivo local)
 *   - readEmitToken — readEnv("REALTIME_EMIT_TOKEN") com erro se ausente
 *     (o backend usa o MESMO token no POST /emit — src/lib/realtime-client.ts;
 *     aqui o spec reproduz o caminho server→server)
 *   - emitNotificationToRoom — POST /emit (Bearer) na sala user:{providerId}
 *     com evento notification:new — independe do provider estar ativo: se a
 *     sala tiver socket vivo, o dashboard mostra o toast
 *
 * Usage:
 *   Este módulo NÃO é um spec nem script executável — é um helper importado
 *   pelos specs E2E (import { readEmitToken, emitNotificationToRoom } from
 *   "./realtime-emit"). Entry points: bunx playwright test e2e/*.spec.ts
 *
 * Exit codes:
 *   N/A — sem exit code próprio; readEmitToken lança Error se a env faltar
 *   (os specs decidem o exit final).
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"

/** Lê uma env var do processo ou do .env.local. */
export function readEnv(name: string): string | undefined {
  const fromEnv = process.env[name]
  if (fromEnv) return fromEnv
  try {
    const content = readFileSync(join(process.cwd(), ".env.local"), "utf8")
    const match = content.match(new RegExp(`^${name}=(.+)$`, "m"))
    if (match) return match[1].replace(/^"|"$/g, "")
  } catch {
    /* sem .env.local — CI injeta via env */
  }
  return undefined
}

/** Lê o REALTIME_EMIT_TOKEN (env ou .env.local) — usado pelo emit direto
 *  nas salas. Lança erro se ausente. */
export function readEmitToken(): string {
  const token = readEnv("REALTIME_EMIT_TOKEN")
  if (token) return token
  throw new Error("REALTIME_EMIT_TOKEN não encontrado (env ou .env.local)")
}

/** Porta do realtime mini-service (env ou .env.local; fallback 3003). Os
 *  specs usam para montar URLs diretas (POST /emit, /sessions, io()) e para
 *  filtrar websockets do realtime (:3003) — parametrizar permite rodar o
 *  realtime em porta alternativa (isolamento / smoke de boot). */
export function realtimePort(): string {
  return readEnv("REALTIME_PORT") ?? "3003"
}

/**
 * Emite notification:new DIRETO na sala user:{providerId} via POST /emit
 * do realtime (Bearer REALTIME_EMIT_TOKEN). Independe do provider estar
 * ativo — se a sala tiver socket vivo, o dashboard mostra o toast.
 */
export async function emitNotificationToRoom(providerId: string): Promise<boolean> {
  const token = readEmitToken()
  const res = await fetch(`http://localhost:${realtimePort()}/emit`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      event: "notification:new",
      data: {
        toId: providerId,
        notification: {
          id: `emit-${Date.now()}`,
          type: "BOOKING_CREATED",
          title: "📅 Novo agendamento: E2E",
          body: "E2E admin revocation test",
          read: false,
          createdAt: new Date().toISOString(),
        },
      },
    }),
  })
  return res.ok
}
