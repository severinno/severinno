/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { describe, it, expect, vi, beforeEach } from "vitest"

const { mockConsume, mockClose, mockSetupGracefulShutdown, mockHandleNotification } = vi.hoisted(
  () => ({
    mockConsume: vi.fn().mockResolvedValue(undefined),
    mockClose: vi.fn().mockResolvedValue(undefined),
    mockSetupGracefulShutdown: vi.fn(),
    mockHandleNotification: vi.fn(),
  }),
)

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

vi.mock("../../lib/notification-queue", () => ({
  handleNotification: mockHandleNotification,
}))

import "../consumer"

describe("notification worker (consumer.ts)", () => {
  // NOTE: no beforeEach(clearAllMocks) — main() runs at import time,
  // so mock calls are set before any test executes.

  it("calls consume with notifications queue configuration", () => {
    expect(mockConsume).toHaveBeenCalledTimes(1)
    expect(mockConsume).toHaveBeenCalledWith({
      queue: "notifications",
      routingKey: "notification",
      handler: mockHandleNotification,
      prefetch: 10,
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
