/**
 * Unit tests for POST /api/webhooks/evolution — Evolution API webhook.
 *
 * Covers os 4 níveis de roteamento de mensagens WhatsApp recebidas:
 *   1. Booking reference (#ref) — roteia para a outra parte do agendamento
 *   2. Quote reference (#ref)   — roteia para a outra parte do orçamento
 *   3. Último contato           — contraparte da mensagem mais recente
 *   4. Admin fallback           — primeiro admin ativo
 *
 * Também cobre:
 *   - Helpers extractNumber / findUserByPhone (via exports __testing__)
 *   - Gating: fromMe, sem texto (mídia), remetente não cadastrado,
 *     destinatário inativo, falha de persistência (best-effort 200)
 *   - Evento connection.update
 *
 * Mocks:
 *   - @/lib/db        — client Prisma completo (controla findUserByPhone via
 *                       user.findFirst, as lookups dos níveis 1-4 e a
 *                       persistência message.create)
 *   - @/lib/evolution — evolutionLogger silencioso
 *
 * NOTA sobre os helpers: vi.mock não intercepta chamadas internas do módulo
 * (o POST chama extractNumber/findUserByPhone dentro do próprio closure).
 * Por isso os testes de roteamento controlam extractNumber via o formato do
 * remoteJid no payload e findUserByPhone via o mock de db.user.findFirst —
 * e os helpers são testados diretamente via __testing__*.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

// ── Hoisted db mock (sobrevive ao hoisting do vi.mock) ───────────────────

const { db } = vi.hoisted(() => ({
  db: {
    user: { findFirst: vi.fn(), findUnique: vi.fn() },
    booking: { findFirst: vi.fn() },
    quoteRequest: { findFirst: vi.fn() },
    message: { findFirst: vi.fn(), create: vi.fn() },
    notification: { create: vi.fn() },
  },
}))

vi.mock("@/lib/db", () => ({ db }))

// Logger silencioso — evolutionLogger vira no-op (mock.calls disponível se
// algum teste quiser assertar logs).
vi.mock("@/lib/evolution", () => ({
  evolutionLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

import { POST, __testing__extractNumber, __testing__findUserByPhone } from "../route"

// ── Fixtures ─────────────────────────────────────────────────────────────

const SENDER = { id: "user-1", name: "Cliente" }
const JID = "5511999999999@s.whatsapp.net"

type DbOverrides = {
  sender?: { id: string; name: string } | null
  admin?: { id: string } | null
  booking?: { id: string; clientId: string; providerId: string } | null
  quote?: { id: string; clientId: string; providerId: string } | null
  lastContact?: { fromId: string; toId: string } | null
  recipientActive?: { active: boolean } | null
}

/** Configura os mocks do db com os valores desejados (defaults sensatos). */
function mockDbDefaults(overrides: DbOverrides = {}) {
  // findUserByPhone (where.whatsapp) vs. admin lookup (where.role === "ADMIN")
  db.user.findFirst.mockImplementation(({ where }: any) => {
    if (where?.role === "ADMIN") return Promise.resolve(overrides.admin ?? null)
    return Promise.resolve(overrides.sender === undefined ? SENDER : overrides.sender)
  })
  db.user.findUnique.mockResolvedValue(
    overrides.recipientActive === undefined ? { active: true } : overrides.recipientActive,
  )
  db.booking.findFirst.mockResolvedValue(overrides.booking ?? null)
  db.quoteRequest.findFirst.mockResolvedValue(overrides.quote ?? null)
  db.message.findFirst.mockResolvedValue(overrides.lastContact ?? null)
  db.message.create.mockResolvedValue({ id: "msg-1" })
  db.notification.create.mockResolvedValue({ id: "notif-1" })
}

/** Monta um payload de messages.upsert com overrides parciais. */
function buildPayload(overrides: Record<string, any> = {}) {
  return {
    event: "messages.upsert",
    instance: "instance-1",
    data: {
      key: { remoteJid: JID, fromMe: false },
      message: { conversation: "Olá" },
    },
    ...overrides,
  }
}

/** Dispara POST com o payload informado. */
async function post(payload: Record<string, any> = buildPayload()) {
  const req = new Request("http://localhost/api/webhooks/evolution", {
    method: "POST",
    body: JSON.stringify(payload),
    headers: { "Content-Type": "application/json" },
  })
  return POST(req)
}

// ===========================================================================
// Helpers (via exports __testing__)
// ===========================================================================

describe("__testing__extractNumber", () => {
  it("extrai o número de um JID válido", () => {
    expect(__testing__extractNumber("5511999999999@s.whatsapp.net")).toBe("5511999999999")
  })

  it("retorna null para JID sem prefixo numérico", () => {
    expect(__testing__extractNumber("grupogratis@g.us")).toBeNull()
    expect(__testing__extractNumber("")).toBeNull()
  })
})

describe("__testing__findUserByPhone", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    db.user.findFirst.mockResolvedValue(null)
  })

  it("gera candidatos com e sem DDI 55 para número de 13 dígitos", async () => {
    await __testing__findUserByPhone("5511999999999")

    expect(db.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          whatsapp: { in: expect.arrayContaining(["5511999999999", "11999999999"]) },
          active: true,
        }),
      }),
    )
  })

  it("adiciona DDI 55 para número de 11 dígitos", async () => {
    await __testing__findUserByPhone("11999999999")

    expect(db.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          whatsapp: { in: expect.arrayContaining(["5511999999999"]) },
        }),
      }),
    )
  })

  it("retorna o usuário encontrado", async () => {
    db.user.findFirst.mockResolvedValue(SENDER as any)
    const user = await __testing__findUserByPhone("5511999999999")
    expect(user).toEqual(SENDER)
  })

  it("retorna null quando nenhum usuário corresponde", async () => {
    const user = await __testing__findUserByPhone("5511999999999")
    expect(user).toBeNull()
  })
})

// ===========================================================================
// Roteamento — 4 níveis
// ===========================================================================

describe("POST /api/webhooks/evolution — roteamento", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDbDefaults()
  })

  async function expectCreatedWith(toId: string, bookingId: string | null = null) {
    expect(db.message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ fromId: "user-1", toId, bookingId }),
      }),
    )
  }

  it("nível 1: roteia via referência de booking (#ref)", async () => {
    mockDbDefaults({ booking: { id: "abc12345", clientId: "user-1", providerId: "provider-9" } })

    const res = await post(
      buildPayload({
        data: {
          key: { remoteJid: JID, fromMe: false },
          message: { conversation: "Olá, sobre o agendamento #abc12345" },
        },
      }),
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ received: true })

    expect(db.booking.findFirst).toHaveBeenCalled()
    // Sender é o client (user-1) → destinatário é o provider
    expectCreatedWith("provider-9", "abc12345")
    // Níveis seguintes não são consultados
    expect(db.quoteRequest.findFirst).not.toHaveBeenCalled()
    expect(db.message.findFirst).not.toHaveBeenCalled()
  })

  it("nível 2: roteia via referência de quote quando não há booking", async () => {
    mockDbDefaults({ quote: { id: "quote99", clientId: "user-1", providerId: "provider-9" } })

    await post(
      buildPayload({
        data: {
          key: { remoteJid: JID, fromMe: false },
          message: { conversation: "Orçamento #quote99 por favor" },
        },
      }),
    )

    expect(db.booking.findFirst).toHaveBeenCalled()
    expect(db.quoteRequest.findFirst).toHaveBeenCalled()
    expectCreatedWith("provider-9")
  })

  it("nível 3: roteia para o último contato quando não há referência", async () => {
    mockDbDefaults({ lastContact: { fromId: "provider-9", toId: "user-1" } })

    await post()

    expect(db.message.findFirst).toHaveBeenCalled()
    // lastMessage.fromId (provider-9) !== user.id → destinatário = fromId
    expectCreatedWith("provider-9")
  })

  it("nível 4: roteia para o primeiro admin ativo como fallback", async () => {
    mockDbDefaults({ admin: { id: "admin-1" } })

    await post()

    expect(db.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { role: "ADMIN", active: true } }),
    )
    expectCreatedWith("admin-1")
  })

  it("descarta a mensagem quando nenhum nível resolve um destinatário", async () => {
    await post()

    expect(db.message.create).not.toHaveBeenCalled()
  })

  // ── Gating ─────────────────────────────────────────────────────────────

  it("ignora mensagens enviadas pelo próprio sistema (fromMe)", async () => {
    await post(
      buildPayload({
        data: { key: { remoteJid: JID, fromMe: true }, message: { conversation: "ok" } },
      }),
    )

    expect(db.message.create).not.toHaveBeenCalled()
  })

  it("ignora mensagens sem texto (mídia)", async () => {
    await post(
      buildPayload({
        data: { key: { remoteJid: JID, fromMe: false }, message: { imageMessage: {} } },
      }),
    )

    expect(db.message.create).not.toHaveBeenCalled()
  })

  it("extrai texto de extendedTextMessage", async () => {
    mockDbDefaults({ booking: { id: "abc12345", clientId: "user-1", providerId: "provider-9" } })

    await post(
      buildPayload({
        data: {
          key: { remoteJid: JID, fromMe: false },
          message: { extendedTextMessage: { text: "Detalhes #abc12345" } },
        },
      }),
    )

    expect(db.message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ content: "Detalhes #abc12345" }),
      }),
    )
  })

  it("descarta mensagem de número não cadastrado", async () => {
    mockDbDefaults({ sender: null })

    await post()

    expect(db.message.create).not.toHaveBeenCalled()
  })

  it("descarta mensagem quando o JID não contém número (extractNumber → null)", async () => {
    await post(
      buildPayload({
        data: { key: { remoteJid: "grupo@g.us", fromMe: false }, message: { conversation: "Oi" } },
      }),
    )

    // Caminho `if (!senderNumber) break` do handler
    expect(db.message.create).not.toHaveBeenCalled()
    expect(db.user.findFirst).not.toHaveBeenCalled()
  })

  it("descarta quando o destinatário resolvido está inativo", async () => {
    mockDbDefaults({
      booking: { id: "abc12345", clientId: "user-1", providerId: "provider-9" },
      recipientActive: { active: false },
    })

    await post(
      buildPayload({
        data: {
          key: { remoteJid: JID, fromMe: false },
          message: { conversation: "Olá #abc12345" },
        },
      }),
    )

    expect(db.message.create).not.toHaveBeenCalled()
  })

  it("retorna 200 mesmo quando a persistência falha (best-effort, sem throw)", async () => {
    mockDbDefaults({ admin: { id: "admin-1" } })
    db.message.create.mockRejectedValue(new Error("db down"))

    const res = await post()

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ received: true })
  })

  // ── Outros eventos ─────────────────────────────────────────────────────

  it("trata evento connection.update (inclusive disconnected)", async () => {
    const res = await post(
      buildPayload({
        event: "connection.update",
        data: { instance: { status: "disconnected" } },
      }),
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ received: true })
  })

  it("retorna 200 para JSON malformado (sem throw)", async () => {
    const req = new Request("http://localhost/api/webhooks/evolution", {
      method: "POST",
      body: "{not-json",
      headers: { "Content-Type": "application/json" },
    })

    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ received: true })
  })
})
