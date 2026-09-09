import { describe, it, expect, vi, beforeEach } from "vitest"

const mockSend = vi.fn()
vi.mock("@aws-sdk/client-s3", () => ({
  // Vitest 4: implementation must be function/class (NOT arrow) — the
  // production code instantiates via `new S3Client(...)`.
  S3Client: vi.fn(function () {
    return { send: mockSend }
  }),
  PutObjectCommand: vi.fn(),
  DeleteObjectCommand: vi.fn(),
  ListObjectsV2Command: vi.fn(),
  GetObjectCommand: vi.fn(),
}))

vi.mock("../logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { uploadToS3, uploadBase64 } from "../s3"

describe("uploadToS3", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.S3_ACCESS_KEY = "test-key"
    process.env.S3_SECRET_KEY = "test-secret"
    process.env.S3_BUCKET = "test-bucket"
    process.env.S3_ENDPOINT = "https://test.r2.cloudflarestorage.com"
  })

  it("faz upload e retorna key e url", async () => {
    mockSend.mockResolvedValue({ ETag: '"abc123"' })
    const result = await uploadToS3(Buffer.from("test data"), "foto.jpg")
    expect(result).toHaveProperty("key")
    expect(result).toHaveProperty("url")
    expect(result.etag).toBe('"abc123"')
    expect(result.key).toContain("uploads/")
  })

  it("usa prefixo customizado", async () => {
    mockSend.mockResolvedValue({ ETag: "etag" })
    const result = await uploadToS3(Buffer.from("test"), "file.pdf", {
      prefix: "servicos/",
    })
    expect(result.key).toContain("servicos/")
  })
})

describe("uploadBase64", () => {
  it("faz upload de data URL válida", async () => {
    mockSend.mockResolvedValue({ ETag: "etag" })
    const dataUrl = "data:image/png;base64,iVBORw0KGgo="
    const result = await uploadBase64(dataUrl)
    expect(result).toHaveProperty("key")
  })

  it("lança erro para data URL inválida", async () => {
    await expect(uploadBase64("not-a-data-url")).rejects.toThrow("Invalid data URL")
  })
})
