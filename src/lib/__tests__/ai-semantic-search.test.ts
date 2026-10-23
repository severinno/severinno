import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  normalizeSemanticText,
  normalizeL2Vector,
  generateDeterministicSemanticVector,
  cosineSimilarity,
  searchSemanticCatalog,
} from "../ai-semantic-search"
import { db } from "@/lib/db"

vi.mock("@/lib/db", () => ({
  db: {
    service: {
      findMany: vi.fn(),
    },
  },
}))

vi.mock("@/lib/redis", () => ({
  cacheGet: vi.fn().mockResolvedValue(null),
  cacheSet: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/ai-client", () => ({
  getLocalAiUrl: vi.fn().mockReturnValue("http://127.0.0.1:11434/v1"),
}))

describe("ai-semantic-search — Motor de Busca Semântica e Vetorização", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("normalizeSemanticText", () => {
    it("remove acentos, pontuações e colapsa espaços múltiplos", () => {
      const input = "  Instalação Elétrica! Chuveiro 220V...  Urgente!!  "
      const result = normalizeSemanticText(input)
      expect(result).toBe("instalacao eletrica chuveiro 220v urgente")
    })

    it("retorna string vazia para inputs nulos ou vazios", () => {
      expect(normalizeSemanticText("")).toBe("")
      expect(normalizeSemanticText(null as unknown as string)).toBe("")
    })
  })

  describe("normalizeL2Vector", () => {
    it("converte um vetor para norma euclidiana unitária (magnitude ~ 1.0)", () => {
      const vec = [3, 4, 0, 0] // magnitude = 5
      const normalized = normalizeL2Vector(vec)

      expect(normalized[0]).toBeCloseTo(0.6, 2)
      expect(normalized[1]).toBeCloseTo(0.8, 2)

      const magnitude = Math.sqrt(normalized.reduce((sum, val) => sum + val * val, 0))
      expect(magnitude).toBeCloseTo(1.0, 2)
    })

    it("lida graciosamente com vetores de magnitude zero", () => {
      const zeroVec = [0, 0, 0]
      expect(normalizeL2Vector(zeroVec)).toEqual([0, 0, 0])
    })
  })

  describe("cosineSimilarity", () => {
    it("retorna 1.0 para vetores idênticos", () => {
      const vecA = [0.6, 0.8, 0.0]
      expect(cosineSimilarity(vecA, vecA)).toBe(1.0)
    })

    it("retorna 0 para vetores ortogonais", () => {
      const vecA = [1.0, 0.0, 0.0]
      const vecB = [0.0, 1.0, 0.0]
      expect(cosineSimilarity(vecA, vecB)).toBe(0)
    })

    it("retorna 0 para vetores vazios ou com zeros", () => {
      expect(cosineSimilarity([], [1, 2])).toBe(0)
      expect(cosineSimilarity([0, 0], [0, 0])).toBe(0)
    })
  })

  describe("generateDeterministicSemanticVector — Alinhamento Semântico", () => {
    it("produz alta similaridade entre termos correlatos de hidráulica", () => {
      const query = generateDeterministicSemanticVector("conserto vazamento cano pia sifao")
      const hydraulicService = generateDeterministicSemanticVector(
        "Encanador Reparo Hidraulico Torneira Pia Vaza",
      )
      const electricalService = generateDeterministicSemanticVector(
        "Eletricista Troca Disjuntor Tomada Fio Curto",
      )

      const simHydraulic = cosineSimilarity(query, hydraulicService)
      const simElectrical = cosineSimilarity(query, electricalService)

      expect(simHydraulic).toBeGreaterThan(0.4)
      expect(simHydraulic).toBeGreaterThan(simElectrical)
    })

    it("produz alta similaridade entre termos correlatos de elétrica", () => {
      const query = generateDeterministicSemanticVector("disjuntor desarmando sem luz no quarto")
      const electricalService = generateDeterministicSemanticVector(
        "Eletricista Residencial Quadro de Energia Disjuntor",
      )
      const paintingService = generateDeterministicSemanticVector(
        "Pintor Parede Massa Corrida Tinta Textura",
      )

      const simElectrical = cosineSimilarity(query, electricalService)
      const simPainting = cosineSimilarity(query, paintingService)

      expect(simElectrical).toBeGreaterThan(0.4)
      expect(simElectrical).toBeGreaterThan(simPainting)
    })
  })

  describe("searchSemanticCatalog", () => {
    it("ranqueia e retorna serviços correspondentes com metadados", async () => {
      const mockServices = [
        {
          id: "svc-1",
          title: "Reparo de Vazamento e Desentupimento",
          description: "Troca de sifão, conserto de canos e reparos hidráulicos urgentes.",
          basePrice: 150.0,
          categoryId: "cat-hidraulica",
          category: { name: "Encanador" },
          providerId: "prov-1",
          provider: { name: "Marcos Encanador", avgRating: 4.9 },
        },
        {
          id: "svc-2",
          title: "Instalação de Chuveiro e Troca de Fiação",
          description: "Serviços elétricos em geral, instalação de disjuntores e tomadas.",
          basePrice: 120.0,
          categoryId: "cat-eletrica",
          category: { name: "Eletricista" },
          providerId: "prov-2",
          provider: { name: "Carlos Eletricista", avgRating: 4.8 },
        },
      ]

      vi.mocked(db.service.findMany).mockResolvedValue(mockServices as any)

      const results = await searchSemanticCatalog("minha pia tá com vazamento de água pelo cano", {
        limit: 5,
        minScore: 0.2,
      })

      expect(results.length).toBeGreaterThan(0)
      expect(results[0].serviceId).toBe("svc-1")
      expect(results[0].categoryName).toBe("Encanador")
      expect(results[0].similarityScore).toBeGreaterThan(0.3)
      expect(results[0].basePrice).toBe(150.0)
    })

    it("retorna array vazio para consultas vazias", async () => {
      const results = await searchSemanticCatalog("")
      expect(results).toEqual([])
    })
  })
})
