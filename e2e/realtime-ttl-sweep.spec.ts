import { readFileSync } from "node:fs"
import { join } from "node:path"
import { createHmac } from "node:crypto"
import { io, type Socket } from "socket.io-client"
import { test, expect } from "@playwright/test"

// =========================================================================
// TTL Sweep — E2E (Realtime)
//
// Cenário: uma sessão cujo cookie expira por TTL (sem logout explícito)
// deve ser encerrada pelo SWEEP do realtime (mini-services/realtime/index.ts:
// a cada REALTIME_TTL_SWEEP_MS, force-close de sockets cuja sessão fixada no
// handshake passou do expiresAt) com o evento `session:revoked` +
// reason `session_expired` — o mesmo padrão do session:revoke, para o client
// resetar o singleton em vez de reconectar com cookie stale.
//
// COMO o spec cria uma "sessão com TTL curto":
//   O spec FORJA o cookie HMAC (mesmo formato do app: `${userId}.${role}.
//   ${expiresAt}.${signatureHex}`, assinado com o MESMO SESSION_SECRET) com
//   expiresAt = agora + 15s e o envia no handshake de um client socket.io
//   (extraHeaders.Cookie — idêntico ao que o navegador faria com o cookie
//   httpOnly). O realtime valida a assinatura e fixa expiresAt na sessão do
//   socket (verifySessionCookie); o sweep então o encerra quando o prazo
//   passa. Funciona com QUALQUER TTL configurado no app — a janela do sweep
//   segue o valor EMBUTIDO no cookie, não a env do servidor do app.
//
// POR QUE client socket.io NODE em vez do browser/dashboard:
//   O app (src/lib/auth.ts getSession) também dispara session:revoke ao ver
//   o cookie expirado no PRÓXIMO request — e o dashboard polla /api/
//   notifications a cada 30s. No browser, essa corrida (poll vs sweep) faz o
//   motivo registrado oscilar entre "revoke" (app) e "session_expired"
//   (sweep). Um client Node que NÃO faz requests ao app isola o caminho do
//   sweep: só o realtime pode encerrar o socket → reason determinística.
//   A reação do client browser ao session:revoked (reset do singleton) já é
//   coberta pelos specs session-revocation / admin-session-revocation.
//
// ISOLAMENTO: lima@severinno.com (Pinturas Lima) — não usado por nenhum
// outro spec de realtime (carlos/ricardo/fernanda/pedro/antonio). Com o
// limite REALTIME_MAX_SESSIONS_PER_USER (default 1), sockets do MESMO
// usuário se derrubam entre si; o join deste spec derruba qualquer socket
// stale de lima (self-healing) sem afetar os demais specs.
//
// TIMING: a espera do sweep é derivada de REALTIME_TTL_SWEEP_MS (env ou
// .env.local; default 60s). Com o default, o pior caso é TTL(15s) + sweep
// (60s) + close delay (0.5s) + margem (15s) ≈ 90s — dentro do timeout
// explícito de 180s deste spec. Para acelerar em dev/CI, configure
// REALTIME_TTL_SWEEP_MS baixo (ex.: 2000) no realtime — o spec adapta a
// espera automaticamente.
// =========================================================================

const PROVIDER_EMAIL = "lima@severinno.com"
const PROVIDER_PASSWORD = "provider123"

/** TTL do cookie forjado (segundos): curto p/ o spec terminar rápido, longo
 *  o suficiente para o handshake+join nunca ver o cookie já expirado. */
const FORGED_TTL_SECONDS = 15
const SWEEP_FALLBACK_MS = 60_000
const CLOSE_DELAY_MS = 500 // REVOKE_CLOSE_DELAY_MS do realtime

let PROVIDER_ID = ""
let PROVIDER_ROLE = "PROVIDER"
let SESSION_SECRET = ""
let EMIT_TOKEN = ""

// =========================================================================
// Helpers
// =========================================================================

/** Lê uma env var do processo ou do .env.local (mesmo padrão do
 *  readEmitToken no admin-session-revocation.spec.ts). */
function readEnv(name: string): string | undefined {
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

/** Assina um cookie de sessão com o MESMO HMAC do app (src/lib/auth.ts). */
function signSessionCookie(userId: string, role: string, expiresAtSec: number): string {
  const payload = `${userId}.${role}.${expiresAtSec}`
  const signature = createHmac("sha256", SESSION_SECRET).update(payload).digest("hex")
  return `${payload}.${signature}`
}

/** Intervalo do sweep que o realtime usa (env ou fallback) — a espera do
 *  spec precisa cobrir o pior caso (TTL + 1 intervalo + close delay).
 *
 *  FOOTGUN do deadline (fix do reviewer): NUNCA pode undershoot do default.
 *  O realtime lê a env no SEU boot (shell do compose/processo); se o
 *  operador setou REALTIME_TTL_SWEEP_MS no .env.local mas o realtime foi
 *  iniciado sem ela exportada, o processo usa 60s enquanto o spec assumiria
 *  2s → deadline curto demais → falha intermitente. Como o loop de espera
 *  termina cedo no disconnect, o deadline só precisa ser um LIMITE SUPERIOR
 *  — clamp a pelo menos o fallback cobre qualquer configuração válida. */
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
  const res = await fetch("http://localhost:3003/sessions", {
    headers: { Authorization: `Bearer ${EMIT_TOKEN}` },
  })
  expect(res.ok, "GET /sessions deve aceitar o Bearer REALTIME_EMIT_TOKEN").toBeTruthy()
  return (await res.json()) as {
    sessions: Array<{ userId: string }>
    kicks: Record<string, { reason: string; count: number }>
  }
}

// =========================================================================
// Teste (serial: fases dependem umas das outras)
// =========================================================================

test.describe.serial("TTL Sweep — sessão com TTL curto expira e o socket morre", () => {
  test.beforeAll(async ({ request }) => {
    SESSION_SECRET = readEnv("SESSION_SECRET") ?? ""
    EMIT_TOKEN = readEnv("REALTIME_EMIT_TOKEN") ?? ""
    expect(SESSION_SECRET, "SESSION_SECRET não encontrado (env ou .env.local)").toBeTruthy()
    expect(EMIT_TOKEN, "REALTIME_EMIT_TOKEN não encontrado (env ou .env.local)").toBeTruthy()

    // Resolve o provider por email (IDs dinâmicos — re-seed não quebra).
    const loginRes = await request.post("/api/auth/login", {
      data: { email: PROVIDER_EMAIL, password: PROVIDER_PASSWORD },
    })
    expect(loginRes.ok(), `login do provider ${PROVIDER_EMAIL} falhou`).toBeTruthy()
    const me = (await (await request.get("/api/auth/me")).json()) as {
      user?: { id?: string; role?: string }
    }
    PROVIDER_ID = me.user?.id ?? ""
    PROVIDER_ROLE = me.user?.role ?? "PROVIDER"
    expect(PROVIDER_ID, `provider ${PROVIDER_EMAIL} não encontrado via /api/auth/me`).toBeTruthy()
    console.log(
      `✅ Fixture: provider=${PROVIDER_ID} role=${PROVIDER_ROLE} ` +
        `sweep=${sweepIntervalMs()}ms ttl=${FORGED_TTL_SECONDS}s`,
    )
  })

  test("cookie forjado com TTL curto → sweep de TTL fecha o socket com session_expired", async () => {
    test.setTimeout(180_000)

    // ── Forja o cookie com TTL curto e conecta o client socket.io ───────
    const expiresAtSec = Math.floor(Date.now() / 1000) + FORGED_TTL_SECONDS
    const cookie = signSessionCookie(PROVIDER_ID, PROVIDER_ROLE, expiresAtSec)

    let revokedReason: string | null = null
    let disconnected = false

    const socket: Socket = io("http://localhost:3003", {
      transports: ["websocket"],
      reconnection: false,
      timeout: 5000,
      extraHeaders: {
        Cookie: `severinno_session=${cookie}`,
        Origin: "http://localhost:3000",
      },
    })

    // Conecta (o handshake com cookie VALIDO é o que fixa a sessão).
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

    // ── Sanidade 1: o cookie forjado foi VERIFICADO no handshake → join ──
    const joinOk = await new Promise<boolean>((resolve) => {
      socket.emit(
        "join",
        { userId: PROVIDER_ID, role: PROVIDER_ROLE.toLowerCase() },
        (res: { ok: boolean }) => resolve(!!res?.ok),
      )
    })
    expect(joinOk, "join com cookie forjado TTL curto deve ser aceito (sessão verificada)").toBe(
      true,
    )

    // ── Sanidade 2: /sessions confirma o provider ONLINE (socket vivo) ──
    const before = await fetchSessions()
    expect(
      before.sessions.some((s) => s.userId === PROVIDER_ID),
      "provider deve aparecer como online em /sessions antes do expiry",
    ).toBe(true)
    console.log("✅ Socket conectado + join aceito + /sessions confirma online")

    // Escuta a revogação (sweep → session:revoked com reason session_expired).
    socket.on("session:revoked", (data: { userId: string; reason?: string }) => {
      if (data?.userId === PROVIDER_ID) revokedReason = data.reason ?? null
    })
    socket.on("disconnect", () => {
      disconnected = true
    })

    // ── Espera o sweep: TTL + 1 intervalo do sweep + close delay + margem ──
    const deadline =
      Date.now() + FORGED_TTL_SECONDS * 1000 + sweepIntervalMs() + CLOSE_DELAY_MS + 15_000
    while (Date.now() < deadline && !disconnected) {
      await new Promise((r) => setTimeout(r, 500))
    }

    expect(disconnected, "socket deve ser fechado pelo sweep de TTL").toBe(true)
    expect(revokedReason, "evento session:revoked deve carregar reason=session_expired").toBe(
      "session_expired",
    )
    expect(socket.disconnected).toBe(true)
    console.log("✅ Socket fechado com reason=session_expired (evento recebido antes do close)")

    // ── Cross-check server-side: audit do kick + usuário fora do online ──
    const after = await fetchSessions()
    expect(
      after.sessions.some((s) => s.userId === PROVIDER_ID),
      "provider não deve estar mais online em /sessions após o sweep",
    ).toBe(false)
    expect(after.kicks[PROVIDER_ID]?.reason, "kick audit deve registrar session_expired").toBe(
      "session_expired",
    )
    console.log(
      `✅ Audit /sessions: kicks[${PROVIDER_ID}].reason=session_expired (count=${after.kicks[PROVIDER_ID]?.count})`,
    )

    socket.close()
  })
})
