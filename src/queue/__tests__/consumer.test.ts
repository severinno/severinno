import { describe, it, expect, vi } from "vitest"

const {
  mockConsume,
  mockClose,
  mockSetupGracefulShutdown,
  mockHandleNotification,
  mockHandleWhatsAppMessage,
} = vi.hoisted(() => ({
  mockConsume: vi.fn().mockResolvedValue(undefined),
  mockClose: vi.fn().mockResolvedValue(undefined),
  mockSetupGracefulShutdown: vi.fn(),
  mockHandleNotification: vi.fn(),
  mockHandleWhatsAppMessage: vi.fn(),
}))

vi.mock("../../lib/logger", () => {
  const mockLogger: any = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }
  mockLogger.child = vi.fn(() => mockLogger)
  return {
    default: mockLogger,
    logger: mockLogger,
  }
})

vi.mock("../../lib/queue", () => ({
  consume: mockConsume,
  close: mockClose,
}))

vi.mock("../../lib/graceful-shutdown", () => ({
  setupGracefulShutdown: mockSetupGracefulShutdown,
}))

vi.mock("../../lib/notification-queue", () => ({
  handleNotification: mockHandleNotification,
}))

vi.mock("../../lib/whatsapp-queue", () => ({
  handleWhatsAppMessage: mockHandleWhatsAppMessage,
}))

import "../consumer"

describe("notification worker (consumer.ts)", () => {
  // NOTE: no beforeEach(clearAllMocks) — main() runs at import time,
  // so mock calls are set before any test executes.

  it("calls consume with notifications and whatsapp queue configurations", () => {
    expect(mockConsume).toHaveBeenCalledTimes(2)
    expect(mockConsume).toHaveBeenCalledWith({
      queue: "notifications",
      routingKey: "notification",
      handler: mockHandleNotification,
      prefetch: 10,
    })
    expect(mockConsume).toHaveBeenCalledWith({
      queue: "whatsapp",
      routingKey: "whatsapp.message",
      handler: mockHandleWhatsAppMessage,
      prefetch: 5,
    })
  })

  it("registers a graceful shutdown handler", () => {
    expect(mockSetupGracefulShutdown).toHaveBeenCalledTimes(1)
    expect(mockSetupGracefulShutdown).toHaveBeenCalledWith(expect.any(Function))
  })

  it("shutdown handler closes the queue connection", async () => {
    const shutdownFn = mockSetupGracefulShutdown.mock.calls[0][0]
    await shutdownFn()
    expect(mockClose).toHaveBeenCalledTimes(1)
  })
})
