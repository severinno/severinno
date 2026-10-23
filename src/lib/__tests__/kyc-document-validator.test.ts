import { describe, it, expect } from "vitest"
import { validateKycDocuments } from "@/lib/kyc-document-validator"

describe("KYC Document Validator & Documentoscopy", () => {
  it("aprova automaticamente documentos válidos com selfie e RG/CNH", async () => {
    const res = await validateKycDocuments({
      docUrl: "https://cdn.severinno.com/docs/cnh-frente-verso.jpg",
      selfieUrl: "https://cdn.severinno.com/docs/selfie-rosto.jpg",
      docType: "CNH",
      cpfCnpj: "123.456.789-00",
      fullName: "Carlos da Silva Prestador",
    })

    expect(res.isValid).toBe(true)
    expect(res.autoApprove).toBe(true)
    expect(res.verdict).toBe("APPROVED")
    expect(res.detectedDocumentType).toBe("CNH")
    expect(res.confidenceScore).toBeGreaterThanOrEqual(0.85)
    expect(res.faceMatchScore).toBeGreaterThanOrEqual(0.85)
    expect(res.riskLevel).toBe("LOW")
    expect(res.flags.length).toBe(0)
  })

  it("rejeita quando a mesma imagem é enviada para documento e selfie", async () => {
    const res = await validateKycDocuments({
      docUrl: "https://cdn.severinno.com/docs/foto-repetida.jpg",
      selfieUrl: "https://cdn.severinno.com/docs/foto-repetida.jpg",
    })

    expect(res.isValid).toBe(false)
    expect(res.autoApprove).toBe(false)
    expect(res.verdict).toBe("REJECTED")
    expect(res.flags).toContain("A imagem da selfie não pode ser idêntica à do documento")
  })

  it("rejeita URLs vazias ou nulas", async () => {
    const res = await validateKycDocuments({
      docUrl: "",
      selfieUrl: "",
    })

    expect(res.isValid).toBe(false)
    expect(res.verdict).toBe("REJECTED")
  })

  it("encaminha para análise manual quando o formato é desconhecido ou CPF diverge", async () => {
    const res = await validateKycDocuments({
      docUrl: "https://cdn.severinno.com/docs/documento-sem-extensao",
      selfieUrl: "https://cdn.severinno.com/docs/selfie-sem-extensao",
      cpfCnpj: "123", // CPF inválido
    })

    expect(res.isValid).toBe(true)
    expect(res.autoApprove).toBe(false)
    expect(res.verdict).toBe("MANUAL_REVIEW_REQUIRED")
    expect(res.riskLevel).toBe("MEDIUM")
    expect(res.flags.length).toBeGreaterThan(0)
  })
})
