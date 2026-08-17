import { createHmac } from "node:crypto"
import { io, type Socket } from "socket.io-client"
import { test, expect } from "@playwright/test"
import { readEnv, realtimePort } from "./realtime-emit"

// =========================================================================
// TTL Sweep — E2E (Realtime)
//
// Cenário 1 — sessão expira por TTL e o socket morre: uma sessão cujo cookie
// expira por TTL (sem logout explícito) deve ser encerrada pelo SWEEP do
// realtime (mini-services/realtime/index.ts: a cada REALTIME_TTL_SWEEP_MS,
// force-close de sockets cuja sessão fixada no handshake passou do expiresAt)
// com o evento `session:revoked` + reason `session_expired` — o mesmo padrão
// do session:revoke, para o client resetar o singleton em vez de reconectar
// com cookie stale.
//
// Cenário 2 — session:renew × sweep (o gap da rotação deslizante): o app
// reemite o cookie em <15d (getSession) e PROPAGA o novo expiresAt ao
// realtime via bridge /emit (session:renew, Bearer-protected). Os sockets
// fixam expiresAt no HANDSHAKE, então sem o renew o sweep fecharia a sessão
// reemitida VÁLIDA quando o expiry ORIGINAL passasse. Este cenário prova o
// EXTEND-ONLY do renewSessionSockets ponta-a-ponta (só unit test hoje): um
// socket cujo session:renew chega ANTES do expiry ORIGINAL SOBREVIVE ao
// sweep — enquanto um CONTROLE (mesmo TTL, sem renew) cai com
// session_expired, provando que o sweep está ATIVO e o resultado não é sorte
// de timing. É o mesmo par renovado/controle do realtime-renew-sweep, mas com
// o emit DIRETO no bridge (server→server, isolando o caminho do realtime).
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
// ISOLAMENTO: o cenário 1 usa lima@severinno.com (Pinturas Lima) — não usado
// por nenhum outro spec de realtime. Com o limite REALTIME_MAX_SESSIONS_PER_USER
// (default 1), sockets do MESMO usuário se derrubam entre si; o join deste
// spec derruba qualquer socket stale de lima (self-healing) sem afetar os
// demais specs. O cenário 2 registra DOIS providers ISOLADOS via API (emails
// únicos por run — mesmo padrão do realtime-role-limit/realtime-renew-sweep):
// renovado e controle NUNCA colidem entre si nem com os outros specs (specs
// de realtime rodam fullyParallel e casam sockets por userId).
//
// TIMING: a espera do sweep é derivada de REALTIME_TTL_SWEEP_MS (env ou
// .env.local; default 60s). Com o default, o pior caso é TTL(15s) + sweep
// (60s) + close delay (0.5s) + margem (15s) ≈ 90s — dentro do timeout
// explícito de 180s deste spec. Para acelerar em dev/CI, configure
// REALTIME_TTL_SWEEP_MS baixo (ex.: 2000) no realtime — o spec adapta a
// espera automaticamente.
//
// ⚠️ REQUISITO DE CONFIG do cenário 2: REALTIME_EMIT_TOKEN no env/.env.local
// do realtime (Bearer do POST /emit) e SESSION_SECRET compartilhado — o
// cookie forjado precisa casar o HMAC do servidor.
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

// Cenário 2 — providers ISOLADOS registrados via API no beforeAll.
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

/** Registra um provider ISOLADO via API (email único por run) — mesmo padrão
 *  do realtime-role-limit/realtime-renew-sweep. Specs de realtime rodam
 *  fullyParallel e casam sockets por userId: users compartilhados se
 *  derrubariam entre specs. */
async function registerProvider(
  request: import("@playwright/test").APIRequestContext,
  prefix: string,
): Promise<{ email: string; id: string }> {
  const email = `${prefix}-${Date.now()}@severinno.com`
  const res = await request.post("/api/auth/register", {
    data: {
      name: `${prefix} Provider E2E`,
      email,
      password: "provider123",
      confirmPassword: "provider123",
      role: "PROVIDER",
      cpfCnpj: "123.456.789-00",
      whatsapp: "11999999999",
      city: "São Paulo",
      state: "SP",
      bio: `Provider isolado do smoke renew×sweep (${prefix})`,
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

/** POST /emit (Bearer) com o session:renew — o MESMO bridge que o app usa
 *  (src/lib/realtime-client.ts) para propagar o novo expiresAt da rotação
 *  deslizante do cookie ao realtime. Retorna res.ok (entrega confirmada). */
async function emitSessionRenew(userId: string, expiresAtSec: number): Promise<boolean> {
  const res = await fetch(`http://localhost:${realtimePort()}/emit`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${EMIT_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ event: "session:renew", data: { userId, expiresAt: expiresAtSec } }),
  })
  return res.ok
}

/** GET /health/detailed do realtime (Bearer) — recentEmits COMPLETO com
 *  userId (o /health público omite por privacidade). Usado como GATE do
 *  cenário 2: provar que o session:renew CHEGOU ao realtime ANTES de esperar
 *  o sweep — sem isso, "o socket sobreviveu" poderia ser sorte de timing. */
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
 *  (prova de que o bridge entregou o novo expiresAt ao serviço). */
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

    // ── Cenário 2: dois providers ISOLADOS (renovado + controle) ─────────
    // Registrados via API com email único por run — nunca colidem com os
    // outros specs de realtime nem entre si (limite de sessões por user).
    const renew = await registerProvider(request, "ttl-renew")
    RENEW_ID = renew.id
    const control = await registerProvider(request, "ttl-control")
    CONTROL_ID = control.id
    console.log(
      `✅ Fixture: provider=${PROVIDER_ID} role=${PROVIDER_ROLE} ` +
        `renew=${RENEW_ID} control=${CONTROL_ID} ` +
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

    const socket: Socket = io(`http://localhost:${realtimePort()}`, {
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

  // =======================================================================
  // Cenário 2 — session:renew × sweep (gap da rotação deslizante)
  //
  // Prova o EXTEND-ONLY do renewSessionSockets ponta-a-ponta (só unit test
  // hoje): o app reemite o cookie em <15d e propaga o NOVO expiresAt via
  // bridge /emit (session:renew). O socket renovado fixa o expiry ORIGINAL
  // no handshake, então SEM o renew o sweep o fecharia quando o prazo
  // original passar. O par renovado/controle isola o caminho:
  //   - RENOVADO: recebe session:renew ANTES do expiry → SOBREVIVE ao sweep;
  //   - CONTROLE: mesmo TTL, SEM renew → cai com session_expired (prova que
  //     o sweep ESTÁ ativo — o resultado do renovado não é sorte de timing).
  // =======================================================================
  test("session:renew ANTES do expiry impede o sweep — renovado sobrevive, controle cai", async () => {
    test.setTimeout(180_000)

    // ── Forja cookies com o MESMO TTL curto para os DOIS providers ──────
    const expiresAtSec = Math.floor(Date.now() / 1000) + FORGED_TTL_SECONDS
    const renewCookie = signSessionCookie(RENEW_ID, "PROVIDER", expiresAtSec)
    const controlCookie = signSessionCookie(CONTROL_ID, "PROVIDER", expiresAtSec)

    // ── Conecta os dois sockets (handshake fixa o expiry de cada um) ────
    const socketRenew = await connectSocket(renewCookie)
    const socketControl = await connectSocket(controlCookie)

    // Listeners registrados IMEDIATAMENTE apos o connect (hardening do
    // reviewer — janela de revogacao coberta por construcao).
    let renewRevokedReason: string | null = null
    let renewDisconnected = false
    let controlRevokedReason: string | null = null
    let controlDisconnected = false
    socketRenew.on("session:revoked", (data: { reason?: string }) => {
      renewRevokedReason = data?.reason ?? null
    })
    socketRenew.on("disconnect", () => {
      renewDisconnected = true
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
      console.log("✅ Ambos os sockets conectados + joins aceitos")

      // ── EMIT do session:renew ANTES do expiry (o caminho do app) ──────
      // Novo expiresAt BEM além da janela do sweep: o EXTEND-ONLY do
      // renewSessionSockets exige expiresAt > o fixado no handshake; se o
      // emit chegar atrasado (após o expiry), o sweep já teria varrido.
      const renewedExpiresAt = Math.floor(Date.now() / 1000) + FORGED_TTL_SECONDS * 60
      const emitOk = await emitSessionRenew(RENEW_ID, renewedExpiresAt)
      expect(
        emitOk,
        "POST /emit session:renew deve aceitar o Bearer REALTIME_EMIT_TOKEN e responder 2xx",
      ).toBe(true)
      console.log(
        `✅ session:renew emitido ANTES do expiry (novo expiresAt=+${FORGED_TTL_SECONDS * 60}s)`,
      )

      // ── GATE: o renew CHEGOU ao realtime (bridge /emit processou) ─────
      const renewLanded = await waitForRenewLanded(RENEW_ID, 10_000)
      expect(
        renewLanded,
        "o realtime deve ter recebido session:renew (ver /health/detailed recentEmits) — se falhar, confira REALTIME_EMIT_TOKEN no realtime",
      ).toBe(true)
      console.log("✅ session:renew recebido pelo realtime (recentEmits /health/detailed)")

      // ── Espera o sweep: TTL + 1 intervalo + close delay + margem ──────
      // O loop termina cedo quando o CONTROLE cai; o renovado precisa
      // sobreviver a janela INTEIRA (deadline completo).
      const deadline =
        Date.now() + FORGED_TTL_SECONDS * 1000 + sweepIntervalMs() + CLOSE_DELAY_MS + 15_000
      while (Date.now() < deadline && !controlDisconnected) {
        await new Promise((r) => setTimeout(r, 500))
      }

      // ── Asserts do DIFERENCIAL ────────────────────────────────────────
      // 1. O CONTROLE (sem renew) caiu pelo sweep — prova que o sweep está
      //    ATIVO com o expiry original de 15s (sem isso, "o renovado
      //    sobreviveu" poderia ser falso positivo de sweep não rodando).
      expect(
        controlDisconnected,
        "socket CONTROLE (sem renew) deve cair pelo TTL sweep com session_expired",
      ).toBe(true)
      expect(controlRevokedReason, "controle deve carregar reason=session_expired").toBe(
        "session_expired",
      )
      console.log("✅ Controle derrubado pelo sweep (session_expired) — sweep ativo")

      // 2. O RENOVADO PERMANECE — o renew impediu o sweep de fechar a
      //    sessão reemitida VÁLIDA quando o expiry ORIGINAL passou.
      expect(
        renewRevokedReason,
        "socket renovado NÃO deve receber session:revoked após o renew",
      ).toBeNull()
      expect(renewDisconnected, "socket renovado deve continuar conectado").toBe(false)
      expect(socketRenew.disconnected, "socket renovado deve continuar conectado").toBe(false)
      console.log("✅ Socket renovado sobreviveu ao sweep (EXTEND-ONLY aplicado)")

      // 3. Cross-check server-side: renovado online; controle fora; kick
      //    audit: controle=session_expired, renovado SEM kick de TTL.
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
