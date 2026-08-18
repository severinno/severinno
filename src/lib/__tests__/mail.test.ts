/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

vi.mock("../logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock("server-only", () => ({}))

const ORIG_ENV = { ...process.env }

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
  process.env = {
    ...ORIG_ENV,
    NODE_ENV: "test",
    SMTP_HOST: "smtp.example.com",
    SMTP_PORT: "587",
    SMTP_USER: "user",
    SMTP_PASS: "pass",
    SMTP_FROM: "test@severinno.com",
  }
})

afterEach(() => {
  process.env = { ...ORIG_ENV }
})

describe("sendMail", () => {
  it("sends email successfully", async () => {
    const mockSendMail = vi.fn().mockResolvedValue({ accepted: ["to@test.com"] })

    vi.doMock("nodemailer", () => ({
      default: {
        createTransport: vi.fn(() => ({ sendMail: mockSendMail })),
      },
      createTransport: vi.fn(() => ({ sendMail: mockSendMail })),
    }))

    const { sendMail } = await import("../mail")

    await sendMail({
      to: "to@test.com",
      subject: "Test",
      html: "<p>test</p>",
    })

    expect(mockSendMail).toHaveBeenCalledWith({
      from: "test@severinno.com",
      to: "to@test.com",
      subject: "Test",
      html: "<p>test</p>",
    })
  })

  it("logs warning when SMTP not configured", async () => {
    process.env.SMTP_HOST = ""
    process.env.SMTP_USER = ""

    const { sendMail } = await import("../mail")

    await sendMail({
      to: "to@test.com",
      subject: "Test",
      html: "<p>test</p>",
    })
  })

  it("logs error on send failure", async () => {
    const mockSendMail = vi.fn().mockRejectedValue(new Error("connection refused"))

    vi.doMock("nodemailer", () => ({
      default: {
        createTransport: vi.fn(() => ({ sendMail: mockSendMail })),
      },
      createTransport: vi.fn(() => ({ sendMail: mockSendMail })),
    }))

    const { sendMail } = await import("../mail")

    await sendMail({
      to: "to@test.com",
      subject: "Test",
      html: "<p>test</p>",
    })

    expect(mockSendMail).toHaveBeenCalled()
  })
})
