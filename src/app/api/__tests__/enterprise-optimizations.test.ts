import { describe, it, expect, beforeEach } from "vitest"
import {
  enqueueOfflineMutation,
  getPendingMutations,
  processSyncQueue,
  clearOfflineQueue,
} from "@/lib/offline-sync"
import {
  calculateProportionalDimensions,
  formatBytes,
  computeCompressionMetrics,
} from "@/lib/client-image-compressor"
import { generateServiceContract, computeContractSeal } from "@/lib/contract-generator"
import {
  removeAccents,
  trigramSimilarity,
  levenshteinDistance,
  fuzzySearchCatalog,
} from "@/lib/fuzzy-search"
import {
  escapeCSVField,
  generateFinancialCSV,
  computeFinancialSummary,
  TransactionRecord,
} from "@/lib/streaming-exporter"

describe("1. Offline-First & Background Sync Engine", () => {
  beforeEach(() => {
    clearOfflineQueue()
  })

  it("should enqueue mutations and retrieve pending items", () => {
    const mutation = enqueueOfflineMutation("CHECKIN", "booking-101", {
      lat: -23.55,
      lng: -46.63,
      checkedInAt: Date.now(),
    })

    expect(mutation.id).toBeDefined()
    expect(mutation.action).toBe("CHECKIN")
    expect(mutation.status).toBe("PENDING")

    const pending = getPendingMutations()
    expect(pending.length).toBe(1)
    expect(pending[0].id).toBe(mutation.id)
  })

  it("should process sync queue successfully with executor", async () => {
    enqueueOfflineMutation("SEND_MESSAGE", "booking-102", { text: "Cheguei no local" })
    enqueueOfflineMutation("STATUS_UPDATE", "booking-102", { status: "IN_PROGRESS" })

    const result = await processSyncQueue(async (m) => {
      expect(["SEND_MESSAGE", "STATUS_UPDATE"]).toContain(m.action)
      return true
    })

    expect(result.processed).toBe(2)
    expect(result.succeeded).toBe(2)
    expect(result.failed).toBe(0)
    expect(result.remaining).toBe(0)
  })
})

describe("2. Client-Side Image Compressor & WebP Optimizer", () => {
  it("should scale down dimensions while preserving aspect ratio", () => {
    const { width, height } = calculateProportionalDimensions(4000, 3000, 1920, 1920)
    expect(width).toBe(1920)
    expect(height).toBe(1440)
  })

  it("should format bytes into human readable KB and MB", () => {
    expect(formatBytes(500)).toBe("500 B")
    expect(formatBytes(1024 * 250)).toBe("250.0 KB")
    expect(formatBytes(1024 * 1024 * 4.5)).toBe("4.50 MB")
  })

  it("should compute realistic WebP compression metrics", () => {
    const metrics = computeCompressionMetrics(10 * 1024 * 1024, 4000, 3000)
    expect(metrics.originalSizeBytes).toBe(10 * 1024 * 1024)
    expect(metrics.compressedSizeBytes).toBeLessThan(1024 * 1024) // Sub-1MB
    expect(metrics.compressionRatioPercent).toBeGreaterThan(80)
  })
})

describe("3. Service Contract Generator with SHA-256 Crypto Seal", () => {
  it("should generate formal contract with cryptographic seal and verification URL", () => {
    const contract = generateServiceContract({
      bookingId: "book-xyz-987",
      client: { name: "Maria Oliveira", document: "111.222.333-44", email: "maria@gmail.com" },
      provider: {
        name: "Roberto Eletricista",
        document: "555.666.777-88",
        email: "roberto@severinno.com.br",
      },
      serviceTitle: "Instalação de Painel Solar",
      serviceDescription: "Instalação de 4 placas solares 550W com inversor",
      totalAmount: 3500.0,
      paymentMethod: "PIX",
      scheduledDate: "2026-08-20",
      locationAddress: "Rua Oscar Freire, 1200 - São Paulo/SP",
    })

    expect(contract.contractId).toContain("CTR-")
    expect(contract.sha256Seal.length).toBe(64)
    expect(contract.legalText).toContain("CLÁUSULA 1ª")
    expect(contract.legalText).toContain("CLÁUSULA 3ª - DA GARANTIA LEGAL")
    expect(contract.verificationUrl).toContain("verificar-contrato")
  })

  it("should compute deterministic SHA-256 seals", () => {
    const seal1 = computeContractSeal("CTR-1", "B-1", 500, "doc1", "doc2", "2026-08-14")
    const seal2 = computeContractSeal("CTR-1", "B-1", 500, "doc1", "doc2", "2026-08-14")
    expect(seal1).toBe(seal2)
    expect(seal1.length).toBe(64)
  })
})

describe("4. Portuguese Trigram & Fuzzy Search Engine", () => {
  it("should remove Brazilian accents properly", () => {
    expect(removeAccents("Instalação Elétrica")).toBe("instalacao eletrica")
    expect(removeAccents("Marcenaria & Móveis")).toBe("marcenaria & moveis")
  })

  it("should detect high similarity for misspelled query 'eletrecista'", () => {
    const score = trigramSimilarity("eletrecista", "Eletricista Residencial")
    expect(score).toBeGreaterThan(0.4)
  })

  it("should compute correct Levenshtein distance", () => {
    expect(levenshteinDistance("cano", "cano")).toBe(0)
    expect(levenshteinDistance("eletrecista", "eletricista")).toBe(1)
  })

  it("should rank relevant services for typo queries and tags", () => {
    const results = fuzzySearchCatalog("encanadô")
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].item.title).toContain("Encanador")

    const tagResults = fuzzySearchCatalog("chuveiro")
    expect(tagResults.length).toBeGreaterThan(0)
    expect(tagResults[0].item.title).toContain("Eletricista")
  })
})

describe("5. Streaming Financial BI & CSV Exporter", () => {
  const sampleTransactions: TransactionRecord[] = [
    {
      id: "tx-1",
      date: "14/08/2026",
      clientName: "Ana Silva",
      providerName: "Carlos Eletricista",
      serviceTitle: "Troca de Disjuntor",
      grossAmount: 300.0,
      platformFeeRate: 0.12,
      platformFeeAmount: 36.0,
      providerPayoutAmount: 264.0,
      paymentMethod: "PIX",
      paymentStatus: "PAID",
      bookingStatus: "COMPLETED",
    },
    {
      id: "tx-2",
      date: "14/08/2026",
      clientName: "João Santos",
      providerName: "Marcos Encanador",
      serviceTitle: "Reparo de Vazamento",
      grossAmount: 200.0,
      platformFeeRate: 0.12,
      platformFeeAmount: 24.0,
      providerPayoutAmount: 176.0,
      paymentMethod: "CARD",
      paymentStatus: "PAID",
      bookingStatus: "COMPLETED",
    },
  ]

  it("should escape CSV fields with quotes and semicolons correctly", () => {
    expect(escapeCSVField("Rua das Flores; 100", ";")).toBe('"Rua das Flores; 100"')
    expect(escapeCSVField('Serviço "Especial"', ";")).toBe('"Serviço ""Especial"""')
  })

  it("should generate CSV with UTF-8 BOM and valid structure", () => {
    const csv = generateFinancialCSV(sampleTransactions)
    expect(csv.startsWith("\uFEFF")).toBe(true)
    expect(csv).toContain("ID Transação;Data;Cliente")
    expect(csv).toContain("tx-1;14/08/2026;Ana Silva")
    expect(csv).toContain("300,00;12,0;36,00;264,00")
  })

  it("should compute summary metrics from transaction batches", () => {
    const summary = computeFinancialSummary(sampleTransactions)
    expect(summary.totalTransactions).toBe(2)
    expect(summary.totalGrossGMV).toBe(500.0)
    expect(summary.totalPlatformRevenue).toBe(60.0)
    expect(summary.totalProviderPayouts).toBe(440.0)
    expect(summary.averageTakeRatePercent).toBe(12.0)
  })
})
