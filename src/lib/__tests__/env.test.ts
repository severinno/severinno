import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const ORIG_ENV = { ...process.env }

beforeEach(() => {
  vi.resetModules()
  process.env = { ...ORIG_ENV }
})

afterEach(() => {
  process.env = { ...ORIG_ENV }
})

describe("env validation", () => {
  it("parses valid env successfully", async () => {
    process.env = {
      ...ORIG_ENV,
      NODE_ENV: "test",
      NEXT_PUBLIC_APP_URL: "https://severinno.com.br",
      SESSION_SECRET: "a".repeat(32),
      LOG_LEVEL: "info",
      DATABASE_URL: "postgresql://localhost:5432/test",
      REDIS_URL: "redis://localhost:6379",
      RABBITMQ_URL: "amqp://localhost:5672",
    }

    const _env = await import("../env")
    expect(_env.env!.NODE_ENV).toBe("test")
    expect(_env.env!.SESSION_SECRET).toBe("a".repeat(32))
  })

  it("applies defaults for optional fields", async () => {
    process.env = {
      ...ORIG_ENV,
      NODE_ENV: "test",
      NEXT_PUBLIC_APP_URL: "https://severinno.com.br",
      SESSION_SECRET: "a".repeat(32),
      DATABASE_URL: "postgresql://localhost:5432/test",
      REDIS_URL: "redis://localhost:6379",
      RABBITMQ_URL: "amqp://localhost:5672",
    }

    const _env = await import("../env")
    expect(_env.env!.LOG_LEVEL).toBe("info")
    expect(_env.env!.REALTIME_URL).toBe("http://localhost:3003")
  })

  it("rejects short SESSION_SECRET returning undefined env", async () => {
    process.env = {
      ...ORIG_ENV,
      NODE_ENV: "test",
      NEXT_PUBLIC_APP_URL: "https://severinno.com.br",
      SESSION_SECRET: "short",
      DATABASE_URL: "postgresql://localhost:5432/test",
      REDIS_URL: "redis://localhost:6379",
      RABBITMQ_URL: "amqp://localhost:5672",
    }

    const _env = await import("../env")
    expect(_env.env).toBeUndefined()
  })

  it("rejects invalid NODE_ENV by throwing", async () => {
    process.env = {
      ...ORIG_ENV,
      NODE_ENV: "staging" as "production",
      NEXT_PUBLIC_APP_URL: "https://severinno.com.br",
      SESSION_SECRET: "a".repeat(32),
      DATABASE_URL: "postgresql://localhost:5432/test",
      REDIS_URL: "redis://localhost:6379",
      RABBITMQ_URL: "amqp://localhost:5672",
    }

    await expect(import("../env")).rejects.toThrow("Invalid environment variables")
  })

  it("rejects non-url APP_URL returning undefined env", async () => {
    process.env = {
      ...ORIG_ENV,
      NODE_ENV: "test",
      NEXT_PUBLIC_APP_URL: "not-a-url",
      SESSION_SECRET: "a".repeat(32),
      DATABASE_URL: "postgresql://localhost:5432/test",
      REDIS_URL: "redis://localhost:6379",
      RABBITMQ_URL: "amqp://localhost:5672",
    }

    const _env = await import("../env")
    expect(_env.env).toBeUndefined()
  })
})
