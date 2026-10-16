import { describe, it, expect, beforeEach } from "vitest"
import {
  enqueuePendingMessage,
  getPendingMessages,
  removePendingMessage,
  clearPendingMessages,
  getPendingCount,
} from "../realtime-offline-queue"

describe("realtime-offline-queue — Fila de Mensagens Offline", () => {
  beforeEach(() => {
    clearPendingMessages()
  })

  it("inicia vazia", () => {
    expect(getPendingMessages()).toEqual([])
    expect(getPendingCount()).toBe(0)
  })

  it("enfileira mensagem e gera clientMessageId único", () => {
    const entry = enqueuePendingMessage({
      fromId: "user-1",
      toId: "prov-1",
      content: "Olá, cheguei no endereço!",
      bookingId: "b-100",
    })

    expect(entry.clientMessageId).toBeDefined()
    expect(entry.fromId).toBe("user-1")
    expect(entry.toId).toBe("prov-1")
    expect(entry.content).toBe("Olá, cheguei no endereço!")
    expect(entry.bookingId).toBe("b-100")
    expect(getPendingCount()).toBe(1)

    const pending = getPendingMessages()
    expect(pending).toHaveLength(1)
    expect(pending[0].clientMessageId).toBe(entry.clientMessageId)
  })

  it("não duplica mensagem com o mesmo clientMessageId", () => {
    const entry1 = enqueuePendingMessage({
      fromId: "user-1",
      toId: "prov-1",
      content: "Mensagem teste",
      clientMessageId: "fixed-uuid-123",
    })

    const entry2 = enqueuePendingMessage({
      fromId: "user-1",
      toId: "prov-1",
      content: "Mensagem teste duplicada",
      clientMessageId: "fixed-uuid-123",
    })

    expect(entry1.clientMessageId).toBe("fixed-uuid-123")
    expect(entry2.clientMessageId).toBe("fixed-uuid-123")
    expect(getPendingCount()).toBe(1)
    expect(getPendingMessages()[0].content).toBe("Mensagem teste")
  })

  it("remove mensagem específica da fila", () => {
    const m1 = enqueuePendingMessage({ fromId: "u1", toId: "u2", content: "msg1" })
    const m2 = enqueuePendingMessage({ fromId: "u1", toId: "u2", content: "msg2" })

    expect(getPendingCount()).toBe(2)
    removePendingMessage(m1.clientMessageId)

    expect(getPendingCount()).toBe(1)
    expect(getPendingMessages()[0].clientMessageId).toBe(m2.clientMessageId)
  })

  it("limpa todas as mensagens da fila", () => {
    enqueuePendingMessage({ fromId: "u1", toId: "u2", content: "msg1" })
    enqueuePendingMessage({ fromId: "u1", toId: "u2", content: "msg2" })
    expect(getPendingCount()).toBe(2)

    clearPendingMessages()
    expect(getPendingCount()).toBe(0)
    expect(getPendingMessages()).toEqual([])
  })
})
