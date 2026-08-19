/**
 * contract-generator.ts — Service Agreement Generator with SHA-256 Cryptographic Hash
 *
 * Generates formalized legal service contracts for bookings in compliance with:
 * - Brazilian Civil Code (Lei 10.406/2002 - Arts. 593 a 609 - Prestação de Serviços)
 * - Consumer Protection Code (CDC Lei 8.078/1990 - Garantia legal de 90 dias)
 * - Brazilian Electronic Signature Framework (MP 2.200-2/2001 & Lei 14.063/2020)
 * - LGPD (Lei 13.709/2018)
 *
 * Cost: $0 — Pure Node/Web Crypto SHA-256 seal.
 */

import { createHash } from "crypto"

export interface ContractParty {
  name: string
  document: string // CPF or CNPJ
  email: string
  phone?: string
  address?: string
}

export interface ContractParams {
  bookingId: string
  client: ContractParty
  provider: ContractParty
  serviceTitle: string
  serviceDescription: string
  totalAmount: number
  paymentMethod: string
  scheduledDate: string
  locationAddress: string
  geoCoordinates?: { lat: number; lng: number }
  ipAddress?: string
}

export interface ServiceContract {
  contractId: string
  bookingId: string
  issuedAt: string
  sha256Seal: string
  verificationUrl: string
  summary: {
    clientName: string
    providerName: string
    serviceTitle: string
    totalAmount: number
    warrantyDays: number
  }
  legalText: string
  htmlContent: string
}

/**
 * Computes SHA-256 cryptographic seal of the contract agreement
 */
export function computeContractSeal(
  contractId: string,
  bookingId: string,
  totalAmount: number,
  clientDoc: string,
  providerDoc: string,
  timestamp: string,
  ipAddress: string = "127.0.0.1",
): string {
  const payload = `${contractId}|${bookingId}|${totalAmount.toFixed(2)}|${clientDoc}|${providerDoc}|${timestamp}|${ipAddress}`
  return createHash("sha256").update(payload, "utf8").digest("hex")
}

/**
 * Generates a complete service agreement with cryptographic integrity verification
 */
export function generateServiceContract(params: ContractParams): ServiceContract {
  const issuedAt = new Date().toISOString()
  const contractId = `CTR-${params.bookingId.slice(-8).toUpperCase()}-${Date.now().toString(36).toUpperCase()}`
  const sha256Seal = computeContractSeal(
    contractId,
    params.bookingId,
    params.totalAmount,
    params.client.document || params.client.email,
    params.provider.document || params.provider.email,
    issuedAt,
    params.ipAddress,
  )

  const verificationUrl = `https://severinno.com.br/verificar-contrato?id=${contractId}&seal=${sha256Seal.slice(0, 16)}`

  const legalText = `
CONTRATO DE PRESTAÇÃO DE SERVIÇOS RESIDENCIAIS / COMERCIAIS
Identificador: ${contractId} | Selo Criptográfico SHA-256: ${sha256Seal}

CONTRATANTE (CLIENTE):
Nome: ${params.client.name} | Doc: ${params.client.document || "Informado no cadastro"} | E-mail: ${params.client.email}

CONTRATADO (PRESTADOR DE SERVIÇOS):
Nome: ${params.provider.name} | Doc: ${params.provider.document || "Informado no cadastro"} | E-mail: ${params.provider.email}

INTERMEDIADORA E CUSTODIANTE:
Severinno Tecnologia & Marketplace Ltda.

CLÁUSULA 1ª - DO OBJETO:
O CONTRATADO obriga-se a prestar os serviços de "${params.serviceTitle}" no endereço: ${params.locationAddress}, conforme descrição detalhada: "${params.serviceDescription}".

CLÁUSULA 2ª - DO VALOR E PAGAMENTO EM CUSTÓDIA (ESCROW):
O valor total pactuado é de R$ ${params.totalAmount.toFixed(2)}, retido em custódia segura pela plataforma Severinno e liberado ao CONTRATADO exclusivamente após a conclusão satisfatória dos serviços e validação do PIN / QR Code pelo CONTRATANTE.

CLÁUSULA 3ª - DA GARANTIA LEGAL:
Nos termos do Art. 26, II, do Código de Defesa do Consumidor (Lei 8.078/1990), os serviços possuem garantia legal mínima de 90 (noventa) dias contra vícios ou defeitos de execução.

CLÁUSULA 4ª - DA VALIDADE DA ASSINATURA ELETRÔNICA:
As partes reconhecem a plena validade jurídica do presente contrato assinado eletronicamente por meio da plataforma Severinno, em conformidade com o Art. 10, § 2º da MP 2.200-2/2001 e Lei 14.063/2020.
`.trim()

  const htmlContent = `
<div style="font-family: system-ui, sans-serif; max-width: 750px; margin: auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px;">
  <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #059669; padding-bottom: 12px;">
    <h2 style="color: #059669; margin: 0;">Severinno — Contrato de Serviço</h2>
    <span style="font-size: 12px; background: #ecfdf5; color: #065f46; padding: 4px 8px; border-radius: 6px; font-weight: bold;">ID: ${contractId}</span>
  </div>
  <p style="font-size: 14px; color: #475569; margin-top: 16px;"><strong>Serviço:</strong> ${params.serviceTitle}</p>
  <p style="font-size: 14px; color: #475569;"><strong>Valor:</strong> R$ ${params.totalAmount.toFixed(2)} (Custódia Garantida)</p>
  <p style="font-size: 14px; color: #475569;"><strong>Contratante:</strong> ${params.client.name} | <strong>Prestador:</strong> ${params.provider.name}</p>
  <div style="background: #f8fafc; padding: 12px; border-radius: 8px; font-size: 11px; color: #64748b; margin-top: 20px; word-break: break-all;">
    <strong>Selo Digital SHA-256:</strong> ${sha256Seal}<br/>
    <strong>Emissão:</strong> ${issuedAt} | <strong>Verificação:</strong> <a href="${verificationUrl}" style="color: #059669;">${verificationUrl}</a>
  </div>
</div>
`.trim()

  return {
    contractId,
    bookingId: params.bookingId,
    issuedAt,
    sha256Seal,
    verificationUrl,
    summary: {
      clientName: params.client.name,
      providerName: params.provider.name,
      serviceTitle: params.serviceTitle,
      totalAmount: params.totalAmount,
      warrantyDays: 90,
    },
    legalText,
    htmlContent,
  }
}
