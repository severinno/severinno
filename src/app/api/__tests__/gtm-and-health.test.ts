import { describe, it, expect, beforeEach } from "vitest"
import { GTMEngine, generateWhatsAppOutreachLink } from "@/lib/gtm-engine"
import { AlertingService } from "@/lib/alerting-service"

describe("Go-To-Market Engine & Lead Pipeline", () => {
  beforeEach(() => {
    // Reset test leads if needed
  })

  it("should create a new lead and list it with filters", () => {
    const lead = GTMEngine.createLead({
      name: "João Teste Eletricista",
      profession: "Eletricista",
      phone: "11999998888",
      city: "São Paulo",
      state: "SP",
      district: "Moema",
      status: "NEW",
      source: "WHATSAPP_SCRAPING",
      notes: "Lead criado para teste automatizado",
    })

    expect(lead.id).toBeDefined()
    expect(lead.name).toBe("João Teste Eletricista")
    expect(lead.status).toBe("NEW")

    const filtered = GTMEngine.listLeads({ status: "NEW" })
    const found = filtered.find((l) => l.id === lead.id)
    expect(found).toBeDefined()
  })

  it("should update lead status through the funnel stages", () => {
    const lead = GTMEngine.createLead({
      name: "Maria Encanadora",
      profession: "Encanador",
      phone: "11988887777",
      city: "São Paulo",
      state: "SP",
      status: "NEW",
      source: "ORGANIC_LANDING",
    })

    const updated = GTMEngine.updateLeadStatus(lead.id, "ONBOARDED", "Completou onboarding")
    expect(updated).not.toBeNull()
    expect(updated?.status).toBe("ONBOARDED")
    expect(updated?.onboardedAt).toBeDefined()
  })

  it("should calculate accurate funnel conversion metrics", () => {
    const metrics = GTMEngine.getFunnelMetrics()
    expect(metrics.target).toBe(50)
    expect(metrics.totalLeads).toBeGreaterThanOrEqual(5)
    expect(metrics.onboardedCount).toBeGreaterThanOrEqual(1)
    expect(typeof metrics.conversionRate).toBe("number")
    expect(metrics.progressPct).toBeGreaterThanOrEqual(0)
  })

  it("should generate a valid WhatsApp outreach link with encoded text", () => {
    const lead = GTMEngine.createLead({
      name: "Roberto Solar",
      profession: "Eletricista",
      phone: "(11) 98765-4321",
      city: "São Paulo",
      state: "SP",
      status: "NEW",
      source: "INSTAGRAM_OUTREACH",
    })

    const link = generateWhatsAppOutreachLink(lead, "https://severinno.com.br")
    expect(link).toContain("https://wa.me/5511987654321")
    const decoded = decodeURIComponent(link)
    expect(decoded).toContain("Roberto")
    expect(decoded).toContain("Eletricista")
    expect(decoded).toContain("utm_source=gtm_wa")
  })
})

describe("Alerting Service & Incident Reporting", () => {
  it("should format and dispatch an incident alert without throwing", async () => {
    const result = await AlertingService.sendAlert({
      title: "Test Alert",
      message: "Automated unit test alert dispatch",
      severity: "INFO",
      source: "VitestSuite",
      metadata: { testId: "vitest-01" },
    })

    expect(result).toBe(true)
  })

  it("should report latency spike breaches", async () => {
    const result = await AlertingService.reportLatencySpike("/api/search/bbox", 280, 200)
    expect(result).toBe(true)
  })

  it("should report fraud attempt warnings", async () => {
    const result = await AlertingService.reportFraudAttempt("booking-99", "user-123", [
      "pix fora",
      "whatsapp direto",
    ])
    expect(result).toBe(true)
  })
})
