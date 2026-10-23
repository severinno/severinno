import { describe, it, expect } from "vitest"
import {
  calculateAspectDimensions,
  formatByteSize,
  compressImageFile,
  compressImageDetailed,
} from "../client-image-compression"

describe("client-image-compression", () => {
  describe("calculateAspectDimensions", () => {
    it("redimensiona foto 4K landscape (3840x2160) mantendo a proporção para max 1920x1080", () => {
      const result = calculateAspectDimensions(3840, 2160, 1920, 1080)
      expect(result.width).toBe(1920)
      expect(result.height).toBe(1080)
    })

    it("redimensiona foto vertical de celular (3000x4000) respeitando a altura máxima", () => {
      const result = calculateAspectDimensions(3000, 4000, 1920, 1080)
      expect(result.height).toBeLessThanOrEqual(1080)
      expect(result.width).toBeLessThanOrEqual(1920)
      expect(Math.round((result.width / result.height) * 100)).toBe(Math.round((3000 / 4000) * 100))
    })

    it("mantém dimensões originais se a foto for menor que os limites máximos", () => {
      const result = calculateAspectDimensions(800, 600, 1920, 1080)
      expect(result.width).toBe(800)
      expect(result.height).toBe(600)
    })
  })

  describe("formatByteSize", () => {
    it("formata bytes, KB e MB de maneira legível", () => {
      expect(formatByteSize(500)).toBe("500 B")
      expect(formatByteSize(150 * 1024)).toBe("150.0 KB")
      expect(formatByteSize(5 * 1024 * 1024)).toBe("5.00 MB")
    })
  })

  describe("compressImageDetailed", () => {
    it("retorna objeto analítico seguro em ambiente SSR sem Canvas nativo", async () => {
      const fakeBlob = new Blob(["fake-image-bytes"], { type: "image/jpeg" })

      const result = await compressImageDetailed(fakeBlob)

      expect(result.originalSizeBytes).toBe(fakeBlob.size)
      expect(result.file).toBe(fakeBlob)
      expect(result.savingsPercent).toBe(0)
    })
  })

  describe("compressImageFile", () => {
    it("retorna instância de File diretamente para retrocompatibilidade com formulários", async () => {
      const fakeFile = new File(["fake-image-data"], "foto-exemplo.jpg", { type: "image/jpeg" })

      const compressed = await compressImageFile(fakeFile, { maxDimension: 1200 })

      expect(compressed).toBeDefined()
      expect(compressed.name).toBe("foto-exemplo.jpg")
    })
  })
})
