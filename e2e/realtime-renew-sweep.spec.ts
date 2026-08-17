import { createHmac } from "node:crypto"
import { io, type Socket } from "socket.io-client"
import { test, expect } from "@playwright/test"
import { readEnv, realtimePort } from "./realtime-emit"

// =========================================================================
// Session Renew (cookie rotation) — smoke E2E (Realtime)
//
// Cenário: o app REEMITE o cookie de sessão (rotação deslizante — getSession
// reemite quando falta < metade do TTL) e PROPAGA o novo expiresAt ao
// realtime via bridge /emit (event session:renew). Os sockets fixam o
// expiresAt no HANDSHAKE, então SEM o renew o TTL sweep fecharia a sessão
// reemitida VÁLIDA quando o expiry ORIGINAL passar. Este smoke prova que,
// APÓS a rotação, o socket NÃO é derrubado pelo sweep.
//
// COMO o spec simula "cookie com expiry curto" (sem esperar 30d):
//   O spec FORJA o cookie HMAC (mesmo formato do app: `${userId}.${role}.
//   ${expiresAt}.${signatureHex}`, assinado com o MESMO SESSION_SECRET) com
//   expiresAt = agora + 15s. O app aceita esse cookie (assinatura válida) e,
//   como remaining 15s < ROTATION_THRESHOLD (metade do TTL — default 15d),
//   reemite NA PRÓXIMA REQUEST: um GET /api/auth/me com o cookie forjado
//   dispara getSession → reissueSession (novo expiresAt ≈ agora + 30d) →
//   propagateSessionRenewal → POST /emit session:renew → realtime estende o
//   socket (renewSessionSockets, EXTEND-ONLY). É o CAMINHO REAL do app, não
//   uma simulação do bridge.
//
// DIFERENCIAL (o coração do smoke): um SEGUNDO provider (controle) com o
// MESMO cookie forjado de 15s mas SEM reemissão. O sweep de TTL derruba o
// controle com session_expired — provando que o sweep ESTÁ ativo — enquanto
// o socket renovado sobrevive. Sem o controle, "o socket não caiu" poderia
// ser um falso positivo (sweep não rodando). O par prova os dois lados.
//
// POR QUE client socket.io NODE (não browser):
//   O cookie forjado precisa chegar ao handshake do socket como ele seria
//   fixado pelo realtime (extraHeaders.Cookie — idêntico ao que o browser
//   faria com o cookie httpOnly). Um browser com dashboard aberto usaria o
//   cookie REAL de 30d — o sweep nunca o tocaria, tornando o cenário inerte.
//   O client Node isola o caminho sweep+renew com o expiry forjado
//   determinístico (mesmo padrão do realtime-ttl-sweep.spec.ts).
//
// ISOLAMENTO COMPLETO: DOIS providers REGISTRADOS via API no beforeAll
// (emails únicos por run — mesmo padrão do realtime-role-limit.spec.ts).
// Nenhum user do seed; specs de realtime rodam fullyParallel e casam
// sockets por userId (users compartilhados se derrubariam entre specs).
//
// TIMING: a espera é derivada de REALTIME_TTL_SWEEP_MS (env ou .env.local;
// default 60s). Pior caso: TTL(15s) + sweep(60s) + close delay(0.5s) +
// margem(15s) ≈ 90s — dentro do timeout explícito de 180s. O controle cai
// no primeiro tick do sweep após o expiry original; o renovado fica vivo.
//
// ⚠️ REQUISITO DE CONFIG: SESSION_COOKIE_MAX_AGE_SECONDS default (30d) — a
// reemissão do app precisa gerar um expiresAt MUITO além da janela do sweep
// (~90s). Se a env for reduzida (clamp mínimo 60s), a asserção de
// reemissão falha rápido com mensagem clara (não flaky).
// =========================================================================

const PASSWORD = "provider123"

/** TTL do cookie forjado (segundos): curto p/ o spec terminar rápido, longo
 *  o suficiente para o handshake+join+reemissão nunca verem o cookie expirado. */
const FORGED_TTL_SECONDS = 15
const SWEEP_FALLBACK_MS = 60_000
const CLOSE_DELAY_MS = 500 // REVOKE_CLOSE_DELAY_MS do realtime

let SESSION_SECRET = ""
let EMIT_TOKEN = ""

// Preenchidos no beforeAll (registro via API com email único por run).
let RENEW_ID = ""
let CONTROL_ID = ""

// =========================================================================
// Helpers
// =========================================================================

/** Assina um cookie de sessão com o MESMO HMAC do app (src/lib/auth.ts). */
function signSessionCookie(userId: string, role: string, expiresAtSec: number): string {
  const payload = `${userId}.${role}.${expiresAtSec}`
  const signature = createHmac("sha256", SESSION_SECRET).update(payload).digest("hex")
  return `${payload}.${signature}`
}

/** Intervalo do sweep que o realtime usa (env ou fallback) — a espera do
 *  spec precisa cobrir o pior caso (TTL + 1 intervalo + close delay).
 *  FOOTGUN do deadline: NUNCA pode undershoot do default (mesmo guard do
 *  realtime-ttl-sweep.spec.ts — se o realtime rodar sem a env exportada, o
 *  processo usa 60s enquanto o spec assumiria 2s → deadline curto demais). */
function sweepIntervalMs(): number {
  return Math.max(
    SWEEP_FALLBACK_MS,
    Math.max(1000, Number(readEnv("REALTIME_TTL_SWEEP_MS")) || SWEEP_FALLBACK_MS),
  )
}

/** GET /sessions do realtime (Bearer) — presença ativa + kick audit. */
async function fetchSessions(): Promise<{
  sessions: Array<{ userId: string }>
  kicks: Record<string, { reason: string; count: number }>
}> {
  const res = await fetch(`http://localhost:${realtimePort()}/sessions`, {
    headers: { Authorization: `Bearer ${EMIT_TOKEN}` },
  })
  expect(res.ok, "GET /sessions deve aceitar o Bearer REALTIME_EMIT_TOKEN").toBeTruthy()
  return (await res.json()) as {
    sessions: Array<{ userId: string }>
    kicks: Record<string, { reason: string; count: number }>
  }
}

/** GET /health público — telemetria da rotação de cookie (renews por minuto
 *  + sockets com expiry estendido). Sem Bearer (dados agregados). Prova o
 *  WIRING ponta-a-ponta: o bump do contador acontece DENTRO do .then do
 *  fetchSockets do handleSessionRenew (microtask posterior ao auditEmit,
 *  que roda síncrono no handler do /emit) — então o poll tem deadline curto
 *  em vez de assert imediato (o recentEmits do gate pode aparecer antes do
 *  contador). */
async function fetchHealthPublic(): Promise<{
  renews?: { perMinute?: Record<string, number>; socketsWithExtendedExpiry?: number }
}> {
  const res = await fetch(`http://localhost:${realtimePort()}/health`)
  expect(res.ok, "GET /health deve responder 200").toBeTruthy()
  return (await res.json()) as {
    renews?: { perMinute?: Record<string, number>; socketsWithExtendedExpiry?: number }
  }
}

/** GET /health/detailed do realtime (Bearer) — recentEmits COMPLETO com
 *  userId/rooms (o /health público omite por privacidade). Usado como GATE:
 *  provar que o session:renew do app CHEGOU ao realtime ANTES de esperar o
 *  sweep — sem isso, "o socket não caiu" poderia ser sorte de timing. */
async function fetchHealthDetailed(): Promise<{
  recentEmits: Array<{ event: string; userId?: string }>
}> {
  const res = await fetch(`http://localhost:${realtimePort()}/health/detailed`, {
    headers: { Authorization: `Bearer ${EMIT_TOKEN}` },
  })
  expect(res.ok, "GET /health/detailed deve aceitar o Bearer").toBeTruthy()
  return (await res.json()) as { recentEmits: Array<{ event: string; userId?: string }> }
}

/** Aguarda o session:renew do userId aparecer no recentEmits do realtime
 *  (prova de que o bridge do app entregou o novo expiresAt ao serviço). */
async function waitForRenewLanded(userId: string, timeoutMs = 10_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const detailed = await fetchHealthDetailed()
    if (detailed.recentEmits.some((e) => e.event === "session:renew" && e.userId === userId)) {
      return true
    }
    await new Promise((r) => setTimeout(r, 400))
  }
  return false
}

/** Aguarda a TELEMETRIA do /health refletir o renew aplicado (wiring
 *  ponta-a-ponta): bucket perMinute ≥ 1 E socketsWithExtendedExpiry ≥ 1. O
 *  bump roda na microtask do .then do fetchSockets — poll com deadline
 *  curto (default 5s — a espera do sweep é ~90s, então margem extra não
 *  custa nada e elimina flake teórico em dev carregado) em vez de assert
 *  imediato. */
async function waitForRenewTelemetry(timeoutMs = 5_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const health = await fetchHealthPublic()
    const perMinute = health.renews?.perMinute ?? {}
    const bucketsWithRenews = Object.values(perMinute).filter((n) => n >= 1).length
    if (bucketsWithRenews >= 1 && (health.renews?.socketsWithExtendedExpiry ?? 0) >= 1) {
      return true
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  return false
}

/** Conecta um client socket.io NODE com o cookie forjado (websocket puro —
 *  polling não envia extraHeaders). O handshake fixa expiresAt no realtime. */
async function connectSocket(cookie: string): Promise<Socket> {
  const socket: Socket = io(`http://localhost:${realtimePort()}`, {
    transports: ["websocket"],
    reconnection: false,
    timeout: 5000,
    extraHeaders: {
      Cookie: `severinno_session=${cookie}`,
      Origin: "http://localhost:3000",
    },
  })
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("timeout esperando o connect do socket.io")),
      10_000,
    )
    socket.on("connect", () => {
      clearTimeout(timer)
      resolve()
    })
    socket.on("connect_error", (err) => {
      clearTimeout(timer)
      reject(new Error(`connect_error: ${err.message}`))
    })
  })
  return socket
}

/** Registra um provider ISOLADO via API (email único por run). */
async function registerProvider(
  request: import("@playwright/test").APIRequestContext,
  prefix: string,
): Promise<{ email: string; id: string }> {
  const email = `${prefix}-${Date.now()}@severinno.com`
  const res = await request.post("/api/auth/register", {
    data: {
      name: `${prefix} Provider E2E`,
      email,
      password: PASSWORD,
      confirmPassword: PASSWORD,
      role: "PROVIDER",
      cpfCnpj: "123.456.789-00",
      whatsapp: "11999999999",
      city: "São Paulo",
      state: "SP",
      bio: `Provider isolado do smoke de renew (${prefix})`,
      radiusKm: 10,
    },
  })
  expect(res.ok(), `register do provider ${prefix} falhou (HTTP ${res.status()})`).toBeTruthy()
  const body = (await res.json()) as { user?: { id?: string } }
  const id = body.user?.id ?? ""
  expect(id, `provider ${prefix} não retornou id no register`).toBeTruthy()
  console.log(`✅ Provider ${prefix} registrado: ${id} (${email})`)
  return { email, id }
}

// =========================================================================
// Teste (serial: fases dependem umas das outras)
// =========================================================================

test.describe.serial("Session Renew — cookie reemitido NÃO é derrubado pelo TTL sweep", () => {
  // Fluxo pesado (2 sockets + reemissão + janela de sweep ~90s): timeout
  // explícito como no realtime-ttl-sweep.spec.ts.
  test.setTimeout(180_000)

  test.beforeAll(async ({ request }) => {
    SESSION_SECRET = readEnv("SESSION_SECRET") ?? ""
    EMIT_TOKEN = readEnv("REALTIME_EMIT_TOKEN") ?? ""
    expect(SESSION_SECRET, "SESSION_SECRET não encontrado (env ou .env.local)").toBeTruthy()
    expect(EMIT_TOKEN, "REALTIME_EMIT_TOKEN não encontrado (env ou .env.local)").toBeTruthy()

    // ── Dois providers ISOLADOS: um é RENOVADO, o outro é o CONTROLE ──
    const renew = await registerProvider(request, "renew-smoke")
    RENEW_ID = renew.id
    const control = await registerProvider(request, "renew-control")
    CONTROL_ID = control.id
    console.log(
      `✅ Fixtures: renew=${RENEW_ID} control=${CONTROL_ID} ` +
        `sweep=${sweepIntervalMs()}ms ttl=${FORGED_TTL_SECONDS}s`,
    )
  })

  test("reemissão do app estende o socket — o TTL sweep NÃO o derruba (controle cai)", async ({
    playwright,
  }) => {
    // ── Forja cookies com TTL curto para os DOIS providers ─────────────
    const expiresAtSec = Math.floor(Date.now() / 1000) + FORGED_TTL_SECONDS
    const renewCookie = signSessionCookie(RENEW_ID, "PROVIDER", expiresAtSec)
    const controlCookie = signSessionCookie(CONTROL_ID, "PROVIDER", expiresAtSec)

    // ── Conecta os dois sockets (handshake fixa o expiry de cada um) ───
    const socketRenew = await connectSocket(renewCookie)
    const socketControl = await connectSocket(controlCookie)

    // Listeners registrados IMEDIATAMENTE apos o connect (hardening do
    // reviewer): se o sweep rodar com intervalo curto (env 2000ms), o
    // controle expira em 15s e pode ser varrido enquanto o /api/auth/me +
    // gate ainda rodam — registrar depois perderia o disconnect. Aqui a
    // janela some por construção: qualquer revogacao/disconnect apos o
    // handshake e capturada.
    let controlRevokedReason: string | null = null
    let renewRevokedReason: string | null = null
    let controlDisconnected = false
    socketRenew.on("session:revoked", (data: { reason?: string }) => {
      renewRevokedReason = data?.reason ?? null
    })
    socketControl.on("session:revoked", (data: { reason?: string }) => {
      controlRevokedReason = data?.reason ?? null
    })
    socketControl.on("disconnect", () => {
      controlDisconnected = true
    })

    try {
      // ── Join de ambos (sanidade: sessão verificada + presença) ────────
      const joinRenew = await new Promise<boolean>((resolve) => {
        socketRenew.emit("join", { userId: RENEW_ID, role: "provider" }, (res: { ok: boolean }) =>
          resolve(!!res?.ok),
        )
      })
      expect(joinRenew, "join do provider renovado deve ser aceito").toBe(true)
      const joinControl = await new Promise<boolean>((resolve) => {
        socketControl.emit(
          "join",
          { userId: CONTROL_ID, role: "provider" },
          (res: { ok: boolean }) => resolve(!!res?.ok),
        )
      })
      expect(joinControl, "join do provider controle deve ser aceito").toBe(true)

      // Sanidade server-side: os DOIS online antes do expiry.
      const before = await fetchSessions()
      expect(before.sessions.some((s) => s.userId === RENEW_ID)).toBe(true)
      expect(before.sessions.some((s) => s.userId === CONTROL_ID)).toBe(true)
      console.log("✅ Ambos os sockets conectados + joins aceitos + /sessions confirma online")

      // ── REEMISSÃO REAL do app: GET /api/auth/me com o cookie forjado ──
      // remaining (15s) < ROTATION_THRESHOLD (metade do TTL) → o app reemite
      // o cookie (novo ~30d) e propaga session:renew ao realtime. Contexto
      // NOVO (sem cookies de outras chamadas) p/ o Cookie header ser o único.
      const ctx = await playwright.request.newContext({
        baseURL: "http://localhost:3000",
      })
      try {
        const meRes = await ctx.get("/api/auth/me", {
          headers: { Cookie: `severinno_session=${renewCookie}` },
        })
        expect(
          meRes.ok(),
          `GET /api/auth/me com o cookie forjado deve responder (HTTP ${meRes.status()})`,
        ).toBeTruthy()
        const me = (await meRes.json()) as { expiresAt?: number | null }
        const nowSec = Math.floor(Date.now() / 1000)
        expect(
          me.expiresAt && me.expiresAt > nowSec + 60,
          `expiresAt do /api/auth/me deve ser REEMITIDO (muito além do expiry forjado de 15s) — recebido: ${me.expiresAt ?? "null"}`,
        ).toBeTruthy()
        console.log(
          `✅ App reemitiu o cookie: expiresAt=${me.expiresAt} (agora+${(me.expiresAt ?? 0) - nowSec}s)`,
        )
      } finally {
        await ctx.dispose()
      }

      // ── GATE: o session:renew CHEGOU ao realtime (bridge /emit) ──────
      const renewLanded = await waitForRenewLanded(RENEW_ID, 10_000)
      expect(
        renewLanded,
        "o realtime deve ter recebido session:renew do app (ver /health/detailed recentEmits) — se falhar, confira REALTIME_EMIT_TOKEN no app",
      ).toBe(true)
      console.log("✅ session:renew recebido pelo realtime (recentEmits /health/detailed)")

      // Wiring da TELEMETRIA (delta RT-HEALTH-RENEWS): o /health público
      // precisa refletir o renew APLICADO (bucket por minuto + sockets com
      // expiry estendido) — o mesmo snapshot que ops monitora em produção.
      const renewTelemetry = await waitForRenewTelemetry(5_000)
      expect(
        renewTelemetry,
        "o /health deve expor renews.perMinute ≥ 1 e socketsWithExtendedExpiry ≥ 1 após o renew (ver getHealthSnapshot)",
      ).toBe(true)
      console.log("✅ /health expõe renews.perMinute + socketsWithExtendedExpiry (telemetria ok)")

      // ── Espera o sweep: TTL + 1 intervalo + close delay + margem ──────
      const deadline =
        Date.now() + FORGED_TTL_SECONDS * 1000 + sweepIntervalMs() + CLOSE_DELAY_MS + 15_000
      while (Date.now() < deadline && !controlDisconnected) {
        await new Promise((r) => setTimeout(r, 500))
      }

      // ── Asserts do DIFERENCIAL ────────────────────────────────────────
      // 1. O CONTROLE (sem reemissão) foi derrubado pelo sweep — prova que o
      //    sweep está ATIVO com o expiry original de 15s.
      expect(
        controlDisconnected,
        "socket CONTROLE (sem reemissão) deve cair pelo TTL sweep com session_expired",
      ).toBe(true)
      expect(controlRevokedReason, "controle deve carregar reason=session_expired").toBe(
        "session_expired",
      )
      console.log("✅ Controle derrubado pelo sweep (session_expired) — sweep ativo")

      // 2. O RENOVADO (cookie reemitido) PERMANECE — o renew impediu o sweep.
      expect(
        renewRevokedReason,
        "socket RENOVADO não deve receber session:revoked após a rotação",
      ).toBeNull()
      expect(socketRenew.disconnected, "socket renovado deve continuar conectado").toBe(false)
      console.log("✅ Socket renovado segue vivo após a janela do sweep")

      // 3. Cross-check server-side: renovado ainda online; controle fora;
      //    kick audit: controle=session_expired, renovado SEM kick de TTL.
      const after = await fetchSessions()
      expect(
        after.sessions.some((s) => s.userId === RENEW_ID),
        "provider renovado deve continuar online em /sessions",
      ).toBe(true)
      expect(
        after.sessions.some((s) => s.userId === CONTROL_ID),
        "provider controle não deve estar online em /sessions",
      ).toBe(false)
      expect(after.kicks[CONTROL_ID]?.reason, "kick audit do controle = session_expired").toBe(
        "session_expired",
      )
      expect(
        after.kicks[RENEW_ID]?.reason,
        "kick audit do renovado NÃO deve ser session_expired",
      ).not.toBe("session_expired")
      console.log(
        `✅ Cross-check /sessions: renovado online, controle fora; kicks: ` +
          `control=${after.kicks[CONTROL_ID]?.reason} renew=${after.kicks[RENEW_ID]?.reason ?? "nenhum"}`,
      )
    } finally {
      socketRenew.close()
      socketControl.close()
    }
  })
})
