import { cookies } from "next/headers"
import { createHmac, timingSafeEqual } from "crypto"
import { db } from "@/lib/db"
import { cacheGet, cacheSet, cacheInvalidate } from "@/lib/redis"
import { isDemoAccountsEnabled, isDemoAccountEmail } from "@/lib/demo-accounts"
import { emitRealtime } from "@/lib/realtime-client"

/**
 * Lightweight HMAC-signed session cookie (no JWT lib).
 * Cookie format: `${userId}.${role}.${expiresAt}.${signatureHex}`
 */

const COOKIE_NAME = "severinno_session"

/** Default do TTL do cookie de sessão: 30 dias. */
const DEFAULT_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30

/** Clamp mínimo do TTL do cookie (1 minuto). */
const MIN_COOKIE_MAX_AGE_SECONDS = 60

/**
 * Resolve o TTL do cookie de sessão (segundos) a partir da env
 * `SESSION_COOKIE_MAX_AGE_SECONDS`. Guard pattern do repo (`Math.max(1,
 * Number(env) || default)`):
 *   - missing/empty/non-numeric (NaN) → default 30d
 *   - "0" (falsy) → default 30d
 *   - < 60s → clamped a 60s (um cookie de <1min quebraria login/renderização;
 *     o spec E2E de TTL usa cookie FORJADO com TTL curto, então o env do app
 *     não precisa ser curto para testar o sweep do realtime)
 * Pura — o módulo chama no boot (COOKIE_MAX_AGE_SECONDS) e os unit tests
 * exercitam a função diretamente com valores arbitrários.
 */
export function resolveCookieMaxAgeSeconds(
  envValue: string | undefined = process.env.SESSION_COOKIE_MAX_AGE_SECONDS,
): number {
  const n = Number(envValue)
  // Não-finito (ex.: "1e309" → Infinity quebraria o maxAge do cookie) ou
  // "0" (falsy — cookie sem TTL) → default 30d.
  if (!Number.isFinite(n) || n === 0) return DEFAULT_COOKIE_MAX_AGE_SECONDS
  return Math.max(MIN_COOKIE_MAX_AGE_SECONDS, n)
}

/**
 * Parse do TTL do cookie POR ROLE (env estruturada `SESSION_COOKIE_MAX_AGE_PER_ROLE`,
 * JSON de segundos — ex.: `{"CLIENT":1296000,"PROVIDER":2592000,"ADMIN":604800}`
 * para 15d/30d/7d). Mesmo padrão do parseMaxSessionsPerRole do realtime
 * (mini-services/realtime/security.ts): roles normalizadas UPPERCASE, entradas
 * inválidas descartadas (não-finito/'0'/negativo), valores clampados a >= 60s;
 * JSON inválido/vazio/{} → undefined (o caller cai no TTL global). Pura — o
 * módulo chama no boot (COOKIE_MAX_AGE_PER_ROLE) e os unit tests exercitam
 * diretamente com valores arbitrários.
 */
export function parseCookieMaxAgePerRole(
  raw: string | undefined,
): Record<string, number> | undefined {
  if (!raw) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined
  const out: Record<string, number> = {}
  for (const [role, value] of Object.entries(parsed as Record<string, unknown>)) {
    const n = typeof value === "number" ? value : Number(value)
    if (!Number.isFinite(n) || n <= 0) continue
    out[role.toUpperCase()] = Math.max(MIN_COOKIE_MAX_AGE_SECONDS, n)
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/**
 * Resolve o TTL do cookie (segundos) para uma role: o override por role quando
 * presente (case-insensitive), senão o fallback global (SESSION_COOKIE_MAX_AGE_SECONDS).
 * Sempre >= 60s — uma misconfig nunca quebra a sessão. Pura.
 *
 * NOTA (semântica de overrides < 60s): o parser (parseCookieMaxAgePerRole)
 * CLAMPA valores sub-minute para 60s, então um mapa vindo do env nunca
 * carrega < 60; aqui, porém, um override < 60 construído à mão é tratado como
 * AUSENTE (cai no fallback global) — divergência defensiva: quem setar um TTL
 * menor que 1 minuto provavelmente errou, e o cookie global seguro vence.
 */
export function resolveCookieMaxAgeForRole(
  role: string | undefined,
  perRole: Record<string, number> | undefined,
  fallback: number,
): number {
  if (perRole && role) {
    const n = perRole[role.toUpperCase()]
    if (typeof n === "number" && n >= MIN_COOKIE_MAX_AGE_SECONDS) return n
  }
  return Number.isFinite(fallback)
    ? Math.max(MIN_COOKIE_MAX_AGE_SECONDS, fallback)
    : DEFAULT_COOKIE_MAX_AGE_SECONDS
}

const COOKIE_MAX_AGE_SECONDS = resolveCookieMaxAgeSeconds()
// TTLs distintos por role (ex.: clientes 15d, providers 30d, admins 7d) via
// env estruturada; role sem override (ou env inválida) cai no global acima.
// O realtime NÃO lê estas envs — o sweep de TTL respeita o expiresAt EMBUTIDO
// e assinado no cookie de cada socket, então variar o TTL por role nunca
// dessincroniza os dois lados.
const COOKIE_MAX_AGE_PER_ROLE = parseCookieMaxAgePerRole(
  process.env.SESSION_COOKIE_MAX_AGE_PER_ROLE,
)
if (process.env.SESSION_COOKIE_MAX_AGE_PER_ROLE && !COOKIE_MAX_AGE_PER_ROLE) {
  console.warn("[auth] ⚠️ SESSION_COOKIE_MAX_AGE_PER_ROLE inválido — usando o TTL global")
}

/** TTL efetivo do cookie para uma role (override por role → fallback global). */
function cookieMaxAgeForRole(role: string | undefined): number {
  return resolveCookieMaxAgeForRole(role, COOKIE_MAX_AGE_PER_ROLE, COOKIE_MAX_AGE_SECONDS)
}

/** Threshold de rotação do cookie para uma role — metade do TTL EFETIVO da
 *  role (o cookie carrega a role, então o getSession sabe qual threshold usar;
 *  um CLIENT com TTL 15d roda a 7.5d, um PROVIDER com 30d roda a 15d). */
function rotationThresholdSeconds(role: string | undefined): number {
  return cookieMaxAgeForRole(role) / 2
}

function getSecret(): string {
  const secret = process.env.SESSION_SECRET
  if (!secret) throw new Error("SESSION_SECRET environment variable is not set")
  return secret
}

function sign(payload: string): string {
  return createHmac("sha256", getSecret()).update(payload).digest("hex")
}

export type SessionPayload = {
  userId: string
  role: "CLIENT" | "PROVIDER" | "ADMIN"
  /** Unix seconds — expiry EFETIVO do cookie (o NOVO quando reemitido).
   *  Exposto ao client via /api/auth/me para exibir "sessão expira em X dias"
   *  e disparar renovação proativa (qualquer request já reemite <15d). */
  expiresAt?: number
}

/**
 * Create a signed session cookie and set it on the response.
 */
export async function createSession(userId: string, role: SessionPayload["role"]) {
  // TTL POR ROLE (override do env estruturado; sem override → global): o
  // expiresAt assinado no cookie é o que o realtime respeita no sweep.
  const maxAge = cookieMaxAgeForRole(role)
  const expiresAt = Math.floor(Date.now() / 1000) + maxAge
  const payload = `${userId}.${role}.${expiresAt}`
  const signature = sign(payload)
  const value = `${payload}.${signature}`

  const store = await cookies()
  store.set(COOKIE_NAME, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  })

  return { userId, role, expiresAt }
}

/**
 * Reissue the session cookie with a new expiry (sliding extension).
 * Used when the session is past the rotation threshold.
 * Returns the newly-issued session (incl. the fresh expiresAt) so callers
 * can propagate the new expiry to the realtime mini-service.
 */
async function reissueSession(userId: string, role: SessionPayload["role"]) {
  return createSession(userId, role)
}

/**
 * Parse + HMAC-verify a session cookie value, SEM side effects (não reemite
 * cookie, não dispara revoke/renew, não escreve nada). Puro e síncrono —
 * seguro para chamar de Server Components (RSC), onde `cookies().set()` é
 * proibido e lançaria.
 *
 * Retorna o payload decodificado ou null (formato inválido, assinatura
 * adulterada, expiresAt não-finito). A expiração TEMPORAL NÃO é checada
 * aqui — o chamador decide (getSession trata TTL-expired com revoke;
 * getSessionExpiresAt trata como null).
 */
export function verifySessionCookieValue(
  value: string,
): { userId: string; role: string; expiresAt: number } | null {
  const parts = value.split(".")
  if (parts.length !== 4) return null
  const [userId, role, expiresAtStr, signature] = parts
  if (!userId || !role || !expiresAtStr || !signature) return null

  const payload = `${userId}.${role}.${expiresAtStr}`
  const expected = sign(payload)

  const a = Buffer.from(signature, "hex")
  const b = Buffer.from(expected, "hex")
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null

  const expiresAt = Number(expiresAtStr)
  if (!Number.isFinite(expiresAt)) return null
  return { userId, role, expiresAt }
}

/**
 * Read & verify the session cookie. Returns the session payload or null.
 * Automatically rotates (reissues) the cookie if past the rotation threshold.
 */
export async function getSession(): Promise<SessionPayload | null> {
  try {
    const store = await cookies()
    const cookie = store.get(COOKIE_NAME)
    if (!cookie?.value) return null

    const parsed = verifySessionCookieValue(cookie.value)
    if (!parsed) return null
    const { userId, role, expiresAt } = parsed
    if (expiresAt * 1000 < Date.now()) {
      // Sessão expirou por TTL (sem logout explícito): os sockets realtime do
      // usuário ficariam vivos até o próximo logout. Dispara a revogação a
      // partir da própria checagem de expiração do cookie — best-effort,
      // deduplicado e NUNCA bloqueia o request (fire-and-forget). O sweep de
      // TTL no realtime (selectExpiredSessionSockets) cobre o gap de sockets
      // ociosos que nunca disparam outro request pelo app.
      void revokeExpiredSessionSockets(userId)
      return null
    }

    const remaining = expiresAt - Math.floor(Date.now() / 1000)
    let effectiveExpiresAt = expiresAt
    // Threshold de rotação POR ROLE (metade do TTL efetivo da role) — um
    // cookie de CLIENT com TTL 15d roda a 7.5d, de ADMIN com 7d a 3.5d.
    if (remaining < rotationThresholdSeconds(role)) {
      // Rotação do cookie (janela = metade do TTL EFETIVO da role — 15d no
      // default global 30d; menos para roles com TTL menor): o novo expiresAt
      // precisa chegar ao realtime — os sockets fixam expiresAt no HANDSHAKE,
      // então sem isso o sweep de TTL fecharia a sessão reemitida VÁLIDA
      // quando o expiry ORIGINAL passar. Best-effort, deduplicado, NUNCA
      // bloqueia o request.
      const renewed = await reissueSession(userId, role as SessionPayload["role"])
      effectiveExpiresAt = renewed.expiresAt
      void propagateSessionRenewal(userId, renewed.expiresAt)
    }

    return {
      userId,
      role: role as SessionPayload["role"],
      // Expiry efetivo (pós-rotação) — o client usa para o countdown da sessão.
      expiresAt: effectiveExpiresAt,
    }
  } catch {
    return null
  }
}

/**
 * Lê o expiresAt EFETIVO do cookie para consumo em Server Components (RSC) —
 * o countdown inicial do dashboard sem flash de carregamento antes do
 * fetchMe resolver.
 *
 * Diferente do getSession: NUNCA escreve cookie. A rotação (<15d) do
 * getSession reemite via `cookies().set()`, que é PROIBIDO em RSC e
 * lançaria. Aqui a rotação é ESPELHADA aritmeticamente (expiry novo = now +
 * COOKIE_MAX_AGE) sem reemitir — o valor inicial já é o que o client verá
 * após o fetchMe, evitando o salto "10 dias" → "30 dias" no primeiro paint.
 * O reissue real acontece no primeiro /api/auth/me (fetchMe) — nenhuma
 * renovação é perdida, apenas o paint inicial usa o valor calculado.
 *
 * Sem cookies() → null. Cookie expirado/adulterado → null.
 */
export async function getSessionExpiresAt(): Promise<number | null> {
  try {
    const store = await cookies()
    const cookie = store.get(COOKIE_NAME)
    if (!cookie?.value) return null

    const parsed = verifySessionCookieValue(cookie.value)
    if (!parsed) return null
    if (parsed.expiresAt * 1000 < Date.now()) return null

    const remaining = parsed.expiresAt - Math.floor(Date.now() / 1000)
    if (remaining < rotationThresholdSeconds(parsed.role)) {
      // Espelho da rotação: sem reemitir o cookie (RSC), o valor inicial já
      // é o refresh do TTL DA ROLE — igual ao que o getSession devolveria ao
      // reemitir na janela de rotação (o countdown SSR nunca salta).
      return Math.floor(Date.now() / 1000) + cookieMaxAgeForRole(parsed.role)
    }
    return parsed.expiresAt
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// TTL-expiry realtime revocation (sessão expirou, sem logout explícito)
// ---------------------------------------------------------------------------
// Quando o cookie expira por TTL (assinatura VÁLIDA, prazo passado), o
// getSession acima dispara session:revoke para o userId — sockets antigos
// morrem mesmo sem ação do usuário. Deduplicado em duas camadas para o
// navegador não martelar o bridge /emit a cada request com o mesmo cookie
// expirado:
//   - Map em memória (por processo): janela de 1h; com poda para não crescer
//     sem limite;
//   - chave Redis `realtime:revoked:expired:{userId}` (TTL 1h): dedupe
//     cross-instância quando o app roda em múltiplas réplicas.
const EXPIRED_REVOKE_DEDUPE_WINDOW_MS = 60 * 60 * 1000 // 1h
const EXPIRED_REVOKE_DEDUPE_KEY_TTL_S = 60 * 60 // 1h (segundos)
const expiredRevokeEmittedAt = new Map<string, number>()

async function revokeExpiredSessionSockets(userId: string): Promise<void> {
  const now = Date.now()
  // Poda oportunística: remove entradas antigas quando o Map cresce
  // (bound no tamanho — uma entrada por usuário expirado por janela).
  if (expiredRevokeEmittedAt.size > 1000) {
    for (const [id, t] of expiredRevokeEmittedAt) {
      if (now - t > EXPIRED_REVOKE_DEDUPE_WINDOW_MS) expiredRevokeEmittedAt.delete(id)
    }
  }
  const last = expiredRevokeEmittedAt.get(userId)
  if (last !== undefined && now - last < EXPIRED_REVOKE_DEDUPE_WINDOW_MS) return

  // Guard in-process (in-flight + janela 1h) setado SÍNCRONO logo após o
  // check — ANTES de qualquer await (in-flight guard para requests
  // concorrentes no mesmo processo; mesmo padrão do renew). Rollback em
  // falha: uma revogação que não entregou NÃO pode travar esta réplica por
  // 1h — o próximo request (ou outra réplica) retenta.
  expiredRevokeEmittedAt.set(userId, now)

  let alreadyRevoked = false
  try {
    const dedupeKey = `realtime:revoked:expired:${userId}`
    const cached = await cacheGet<number>(dedupeKey)
    if (cached) alreadyRevoked = true
  } catch {
    // Redis/cache indisponível → cai para o emit mesmo assim (a revogação é
    // idempotente: sockets já mortos são no-op). Nunca bloqueia o request.
  }
  if (alreadyRevoked) return
  try {
    // Mesmo padrão do renew: revogar é idempotente (primeiro entrega vence),
    // então a chave Redis só é reivindicada APÓS a entrega confirmada — uma
    // falha de emit de uma réplica não suprime a revogação das outras.
    const delivered = await revokeUserSessions(userId)
    if (!delivered) {
      // Falha de entrega → rollback do guard in-process. A chave Redis NÃO é
      // reivindicada: outra réplica (ou esta, no próximo request) retenta.
      expiredRevokeEmittedAt.delete(userId)
      return
    }
    try {
      await cacheSet(`realtime:revoked:expired:${userId}`, now, EXPIRED_REVOKE_DEDUPE_KEY_TTL_S)
    } catch {
      // Redis fora no momento do claim → Map cobre esta réplica. Não bloqueia.
    }
  } catch {
    // Simetria com o renew: revokeUserSessions nunca lança (emitRealtime
    // captura erros e devolve boolean), então este catch é defensivo — mas se
    // um dia lançar, o guard in-process não pode ficar setado por 1h
    // suprimindo retries desta réplica (mesmo rollback do caminho renew).
    expiredRevokeEmittedAt.delete(userId)
  }
}

// ---------------------------------------------------------------------------
// Cookie-rotation realtime propagation (reissue <15d → session:renew)
// ---------------------------------------------------------------------------
// Quando o getSession reemite o cookie (rotação deslizante, janela <15d), o
// NOVO expiresAt é propagado ao realtime via bridge /emit (session:renew,
// Bearer-protected) para o sweep de TTL nunca fechar uma sessão reemitida
// VÁLIDA (os sockets fixam expiresAt no handshake). Deduplicado em duas
// camadas — Map 1h (por processo) + chave Redis `realtime:renewed:{userId}`
// TTL 1h (compartilhada entre réplicas) — porque o getSession roda em TODO
// request passado o threshold: sem dedupe, cada request martelaria o bridge
// /emit com o mesmo renew.
//
// ORDERING MULTI-RÉPLICA (por que a chave é reivindicada SÓ após o emit OK):
// o renew é idempotente (EXTEND-ONLY no realtime), então o happy path não
// perde nada — a primeira réplica a emitir reivindica a chave compartilhada
// e as demais pulam. MAS se a chave fosse reivindicada ANTES do emit (como
// antes), um emit que FALHA (realtime fora/timeout/HTTP não-2xx — o
// emitRealtime retorna false em vez de throw) deixaria a chave setada por 1h
// suprimindo retries de TODAS as réplicas: a sessão reemitida VÁLIDA morreria
// no sweep do expiry ORIGINAL. Reivindicar apenas pós-entrega garantida
// (emitRealtime → res.ok) + rollback do Map in-process faz a falha de uma
// réplica NÃO silenciar as outras — quem chegar depois retenta e entrega.
const RENEW_DEDUPE_WINDOW_MS = 60 * 60 * 1000 // 1h
const RENEW_DEDUPE_KEY_TTL_S = 60 * 60 // 1h (segundos)
const sessionRenewedAt = new Map<string, number>()

async function propagateSessionRenewal(userId: string, expiresAt: number): Promise<void> {
  const now = Date.now()
  // Poda oportunística idêntica à do revoke por TTL.
  if (sessionRenewedAt.size > 1000) {
    for (const [id, t] of sessionRenewedAt) {
      if (now - t > RENEW_DEDUPE_WINDOW_MS) sessionRenewedAt.delete(id)
    }
  }
  const last = sessionRenewedAt.get(userId)
  if (last !== undefined && now - last < RENEW_DEDUPE_WINDOW_MS) return

  // Guard in-process (in-flight + janela 1h) setado SÍNCRONO logo após o
  // check — ANTES de qualquer await — para que requests CONCORRENTES no
  // mesmo processo vejam a entrada e retornem cedo (in-flight guard): sem
  // isso, dois requests paralelos passariam ambos pelo check do Redis e
  // emitiriam em duplicata (o hammering que o dedupe evita). Rollback em
  // falha: um emit que não entregou NÃO pode travar esta réplica por 1h — o
  // próximo request (ou outra réplica) retenta. O Map é por processo; a
  // chave Redis é a fronteira compartilhada entre réplicas.
  sessionRenewedAt.set(userId, now)

  // Dedupe cross-instância: checa a chave ANTES de emitir. Se outra réplica
  // já ENTREGOU o renew na última 1h (chave presente), pula — o renew é
  // idempotente, então o primeiro que entrega vence. Checar não reivindica.
  let alreadyRenewed = false
  try {
    const dedupeKey = `realtime:renewed:${userId}`
    const cached = await cacheGet<number>(dedupeKey)
    if (cached) alreadyRenewed = true
  } catch {
    // Redis/cache indisponível → segue para o emit mesmo assim (renew é
    // idempotente e EXTEND-ONLY no realtime — um renew repetido é no-op).
  }
  if (alreadyRenewed) return

  let delivered = false
  try {
    // emitRealtime devolve res.ok — a ENTREGA CONFIRMADA (não throw).
    delivered = await emitRealtime("session:renew", { userId, expiresAt })
  } catch {
    // Best-effort: consumido com `void` — nunca pode rejeitar.
    delivered = false
  }
  if (!delivered) {
    // Falha de entrega → rollback do guard in-process. A chave Redis NÃO é
    // reivindicada: outra réplica (ou esta, no próximo request) retenta e
    // entrega. Antes, a chave era setada pre-emit e a falha silenciava TODAS
    // as réplicas por 1h (sessão reemitida válida morria no sweep do expiry
    // ORIGINAL) — o caso multi-réplica que este fix fecha.
    sessionRenewedAt.delete(userId)
    return
  }
  try {
    // Entrega CONFIRMADA → só agora reivindica a chave compartilhada (TTL
    // 1h): as demais réplicas veem a chave e pulam — dedupe correto, sem
    // perder renews quando réplicas diferentes reemitem em momentos distintos.
    await cacheSet(`realtime:renewed:${userId}`, now, RENEW_DEDUPE_KEY_TTL_S)
  } catch {
    // Redis fora de novo no momento do claim → o Map cobre esta réplica;
    // outra réplica pode re-emitir (idempotente). Não bloqueia.
  }
}

/**
 * Revoke a user's realtime sockets (logout in any tab, or an admin
 * deactivation/delete). Server-side bridge (Bearer-protected). Non-blocking:
 * emitRealtime catches network errors, so a down realtime service never
 * breaks the calling flow. Returns `true` only when the realtime CONFIRMED
 * the delivery (HTTP 2xx) — callers use it to claim the cross-replica dedupe
 * key only after a successful revoke (a failed emit of one replica must not
 * suppress the revoke of the others).
 */
export async function revokeUserSessions(userId: string): Promise<boolean> {
  return emitRealtime("session:revoke", { userId })
}

/**
 * Clear the session cookie (logout) and revoke the user's realtime sockets.
 * The userId is captured from the session BEFORE the cookie is deleted so
 * the realtime mini-service can disconnect active sockets in user:{id}.
 */
export async function destroySession() {
  const store = await cookies()
  const session = await getSession()
  store.delete(COOKIE_NAME)
  if (session?.userId) {
    await revokeUserSessions(session.userId)
  }
}

/**
 * Check whether a user is active, using Redis cache to avoid DB lookups.
 * Returns true if active, false otherwise. Caches the result for 5 minutes.
 */
async function verifyUserActive(userId: string): Promise<boolean> {
  const cacheKey = `user:active:${userId}`
  const cached = await cacheGet<{ active: boolean; role: string }>(cacheKey)

  if (cached !== null) return cached.active

  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, active: true, email: true },
  })

  // 🛡️ Defense-in-depth: contas demo são dev/staging only. Mesmo que uma
  // sessão exista (criada antes do deploy, banco clonado, etc.), em produção
  // a conta é tratada como inativa — invalida sessões demo de forma retroativa.
  const demoBlocked = !isDemoAccountsEnabled() && isDemoAccountEmail(user?.email ?? null)

  const active = !!user?.active && !demoBlocked
  await cacheSet(cacheKey, { active, role: user?.role ?? "" }, 300)
  return active
}

/**
 * Require an authenticated user. Throws a Next.js-friendly error if absent.
 * Uses Redis cache (5min TTL) to avoid hitting PostgreSQL on every request.
 */
export async function requireUser(): Promise<SessionPayload> {
  const session = await getSession()
  if (!session) {
    throw new Error("UNAUTHORIZED")
  }

  const active = await verifyUserActive(session.userId)
  if (!active) throw new Error("UNAUTHORIZED")

  return session
}

/**
 * Invalidate cached user status (call after user update/deactivation).
 */
export async function invalidateUserCache(userId: string): Promise<void> {
  await cacheInvalidate(`user:active:${userId}`)
}

/**
 * Require a user with a specific role.
 */
export async function requireRole(role: SessionPayload["role"]): Promise<SessionPayload> {
  const session = await requireUser()
  if (session.role !== role) {
    throw new Error("FORBIDDEN")
  }
  return session
}

/**
 * Soft variant: returns the session or null (no throw). Useful for SSR
 * pages that show different content for guests.
 * Uses the same Redis cache as requireUser to avoid redundant DB hits.
 */
export async function getOptionalSession(): Promise<SessionPayload | null> {
  const session = await getSession()
  if (!session) return null
  try {
    const active = await verifyUserActive(session.userId)
    if (!active) return null
    return session
  } catch {
    return null
  }
}

export const SESSION_COOKIE_NAME = COOKIE_NAME
