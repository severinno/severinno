import { describe, it, expect, vi, beforeEach } from "vitest"
import ServiceOgImage, {
  size as serviceSize,
  contentType as serviceContentType,
} from "../servicos/[servico]/opengraph-image"
import ProviderOgImage, {
  size as providerSize,
  contentType as providerContentType,
} from "../u/[slug]/opengraph-image"
import { db } from "@/lib/db"

vi.mock("next/og", () => {
  return {
    ImageResponse: class MockImageResponse extends Response {
      element: unknown
      options: unknown
      constructor(element: unknown, options: unknown) {
        super("mock-image-data", { headers: { "content-type": "image/png" } })
        this.element = element
        this.options = options
      }
    },
  }
})

vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findFirst: vi.fn(),
    },
  },
}))

describe("OpenGraph Image Generators", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("Serviços Landing Page OG Image", () => {
    it("gera card com título e metadados de serviço conhecido", async () => {
      const res = await ServiceOgImage({
        params: Promise.resolve({ servico: "diarista-governador-valadares" }),
      })

      expect(res).toBeDefined()
      expect(serviceSize.width).toBe(1200)
      expect(serviceSize.height).toBe(630)
      expect(serviceContentType).toBe("image/png")
    })

    it("gera card com fallback elegante para slug não listado", async () => {
      const res = await ServiceOgImage({
        params: Promise.resolve({ servico: "servico-generico" }),
      })

      expect(res).toBeDefined()
      expect(serviceSize.width).toBe(1200)
    })
  })

  describe("Perfil do Prestador OG Image", () => {
    it("gera card com dados reais do prestador cadastrado", async () => {
      vi.mocked(db.user.findFirst).mockResolvedValueOnce({
        name: "Carlos Silva",
        city: "Governador Valadares",
        state: "MG",
        verified: true,
        services: [{ title: "Eletricista Residencial" }],
        reviewsReceived: [{ rating: 5 }, { rating: 5 }, { rating: 4 }],
        _count: {
          reviewsReceived: 3,
          bookingsAsProvider: 15,
        },
      } as any)

      const res = await ProviderOgImage({
        params: Promise.resolve({ slug: "carlos-silva" }),
      })

      expect(res).toBeDefined()
      expect(providerSize.width).toBe(1200)
      expect(providerSize.height).toBe(630)
      expect(providerContentType).toBe("image/png")
      expect(db.user.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            OR: [{ slug: "carlos-silva" }, { id: "carlos-silva" }],
            role: "PROVIDER",
            active: true,
          },
        }),
      )
    })

    it("gera card com fallback gracioso quando o prestador não é encontrado ou banco falha", async () => {
      vi.mocked(db.user.findFirst).mockRejectedValueOnce(new Error("Database offline"))

      const res = await ProviderOgImage({
        params: Promise.resolve({ slug: "desconhecido" }),
      })

      expect(res).toBeDefined()
      expect(providerSize.width).toBe(1200)
    })
  })
})
