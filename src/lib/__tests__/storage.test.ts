import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// Shared mock for S3Client.send — mutable per test
const mockS3Send = vi.hoisted(() => vi.fn())

vi.mock("../logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock("@aws-sdk/client-s3", () => ({
  // Vitest 4: implementations must be function/class (NOT arrow) — the
  // production code instantiates via `new S3Client(...)` / `new PutObjectCommand(...)`.
  S3Client: vi.fn(function () {
    return { send: mockS3Send }
  }),
  PutObjectCommand: vi.fn(function (args: unknown) {
    return args
  }),
}))

const ORIG_ENV = { ...process.env }

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
  process.env = {
    ...ORIG_ENV,
    NODE_ENV: "test",
    S3_PUBLIC_URL: "",
    S3_ENDPOINT: "https://s3.example.com",
    S3_REGION: "us-east-1",
    S3_ACCESS_KEY: "ak",
    S3_SECRET_KEY: "sk",
    S3_BUCKET: "test-bucket",
  }
})

afterEach(() => {
  process.env = { ...ORIG_ENV }
})

describe("uploadFile", () => {
  it("uploads file and returns URL", async () => {
    mockS3Send.mockResolvedValue({ ETag: '"abc123"' })

    const { uploadFile } = await import("../storage")
    const url = await uploadFile(Buffer.from("test-content"), "photos/test.jpg", "image/jpeg")

    expect(url).toBe("https://s3.example.com/test-bucket/photos/test.jpg")
  })

  it("returns null and warns when S3 not configured", async () => {
    process.env.S3_ENDPOINT = ""
    process.env.S3_ACCESS_KEY = ""

    const { uploadFile } = await import("../storage")
    const result = await uploadFile(Buffer.from("x"), "key", "text/plain")

    expect(result).toBeNull()
  })

  it("uses PUBLIC_URL when available", async () => {
    process.env.S3_PUBLIC_URL = "https://cdn.severinno.com"
    mockS3Send.mockResolvedValue({ ETag: '"abc"' })

    const { uploadFile } = await import("../storage")
    const url = await uploadFile(Buffer.from("x"), "photos/img.jpg", "image/jpeg")

    expect(url).toBe("https://cdn.severinno.com/photos/img.jpg")
  })

  it("returns null on upload error", async () => {
    mockS3Send.mockRejectedValue(new Error("network error"))

    const { uploadFile } = await import("../storage")
    const result = await uploadFile(Buffer.from("x"), "key", "text/plain")

    expect(result).toBeNull()
  })
})
