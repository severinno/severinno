import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest"

const { mockConsume, mockClose, mockSetupGracefulShutdown, mockSendMail } = vi.hoisted(() => ({
  mockConsume: vi.fn().mockResolvedValue(undefined),
  mockClose: vi.fn().mockResolvedValue(undefined),
  mockSetupGracefulShutdown: vi.fn(),
  mockSendMail: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("../../lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock("../../lib/queue", () => ({
  consume: mockConsume,
  close: mockClose,
}))

vi.mock("../../lib/graceful-shutdown", () => ({
  setupGracefulShutdown: mockSetupGracefulShutdown,
}))

vi.mock("../../lib/mail", () => ({
  sendMail: mockSendMail,
}))

import "../email-consumer"

describe("email worker (email-consumer.ts)", () => {
  // NOTE: no top-level beforeEach(clearAllMocks) — main() runs at import
  // time, so mock calls are set before any test executes.

  it("calls consume with emails queue configuration", () => {
    expect(mockConsume).toHaveBeenCalledTimes(1)
    expect(mockConsume).toHaveBeenCalledWith({
      queue: "emails",
      routingKey: "email",
      handler: expect.any(Function),
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

  describe("handleEmail (consumer handler)", () => {
    let handler: (msg: Record<string, unknown>) => Promise<void>

    beforeAll(() => {
      // Capture handler reference once — it's set at import time
      handler = mockConsume.mock.calls[0][0].handler
    })

    beforeEach(() => {
      vi.clearAllMocks()
    })

    it("sends email for valid payload", async () => {
      await handler({ to: "user@example.com", subject: "Test", html: "<p>Hi</p>" })

      expect(mockSendMail).toHaveBeenCalledTimes(1)
      expect(mockSendMail).toHaveBeenCalledWith({
        to: "user@example.com",
        subject: "Test",
        html: "<p>Hi</p>",
      })
    })

    it("skips payload with missing to", async () => {
      await handler({ subject: "Test", html: "<p>Hi</p>" })
      expect(mockSendMail).not.toHaveBeenCalled()
    })

    it("skips payload with missing subject", async () => {
      await handler({ to: "user@example.com", html: "<p>Hi</p>" })
      expect(mockSendMail).not.toHaveBeenCalled()
    })

    it("skips payload with missing html", async () => {
      await handler({ to: "user@example.com", subject: "Test" })
      expect(mockSendMail).not.toHaveBeenCalled()
    })

    it("skips payload with empty to field", async () => {
      await handler({ to: "", subject: "Subject", html: "<p>Body</p>" })
      expect(mockSendMail).not.toHaveBeenCalled()
    })

    it("skips payload with empty subject", async () => {
      await handler({ to: "user@example.com", subject: "", html: "<p>Body</p>" })
      expect(mockSendMail).not.toHaveBeenCalled()
    })

    it("skips payload with empty html", async () => {
      await handler({ to: "user@example.com", subject: "Test", html: "" })
      expect(mockSendMail).not.toHaveBeenCalled()
    })

    it("does not throw when sendMail fails", async () => {
      mockSendMail.mockRejectedValueOnce(new Error("SMTP error"))

      await expect(
        handler({ to: "user@example.com", subject: "Test", html: "<p>Hi</p>" }),
      ).resolves.toBeUndefined()
    })
  })
})