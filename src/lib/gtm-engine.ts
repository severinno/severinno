/**
 * gtm-engine.ts — Go-To-Market Lead Pipeline & Outreach Automation Engine
 *
 * Powers the acquisition of the first 50 providers:
 * - In-Memory Lead Store with fallback/persistence
 * - Lead stages: NEW -> CONTACTED -> DEMO_SCHEDULED -> ONBOARDED -> FIRST_SERVICE -> REJECTED
 * - Personalized WhatsApp Script Generator with UTM campaign tags
 * - Funnel velocity and CAC metrics
 */

export type LeadStatus =
  | "NEW"
  | "CONTACTED"
  | "DEMO_SCHEDULED"
  | "ONBOARDED"
  | "FIRST_SERVICE"
  | "REJECTED"

export interface GTMLead {
  id: string
  name: string
  profession: string
  phone: string
  city: string
  state: string
  district?: string
  status: LeadStatus
  source: "WHATSAPP_SCRAPING" | "INSTAGRAM_OUTREACH" | "STORE_PARTNERSHIP" | "ORGANIC_LANDING" | "REFERRAL"
  notes?: string
  lastContactAt?: string
  onboardedAt?: string
  createdAt: string
  updatedAt: string
}

export interface FunnelMetrics {
  target: number
  totalLeads: number
  byStatus: Record<LeadStatus, number>
  conversionRate: number // % onboarded from total
  activeInFunnel: number
  onboardedCount: number
  firstServiceCount: number
  progressPct: number
}

// In-Memory storage initialized with realistic initial pipeline
let leadsStore: GTMLead[] = [
  {
    id: "lead-1",
    name: "Marcos Vinícius Eletricista",
    profession: "Eletricista",
    phone: "11987654321",
    city: "São Paulo",
    state: "SP",
    district: "Pinheiros",
    status: "ONBOARDED",
    source: "INSTAGRAM_OUTREACH",
    notes: "Perfil verificado no Instagram com 4.5k seguidores. Excelente portfólio de quadros de disjuntores.",
    createdAt: new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 1 * 24 * 3600 * 1000).toISOString(),
    onboardedAt: new Date(Date.now() - 1 * 24 * 3600 * 1000).toISOString(),
  },
  {
    id: "lead-2",
    name: "Valter Encanamento & Gás",
    profession: "Encanador",
    phone: "11976543210",
    city: "São Paulo",
    state: "SP",
    district: "Moema",
    status: "DEMO_SCHEDULED",
    source: "STORE_PARTNERSHIP",
    notes: "Indicação da loja C&C Moema. Quer entender como funciona o recebimento garantido via PIX.",
    createdAt: new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 12 * 3600 * 1000).toISOString(),
  },
  {
    id: "lead-3",
    name: "Ana Cláudia Diarista & Pós-Obra",
    profession: "Diarista",
    phone: "11965432109",
    city: "São Paulo",
    state: "SP",
    district: "Tatuapé",
    status: "CONTACTED",
    source: "ORGANIC_LANDING",
    notes: "Cadastrou-se pela calculadora de faturamento da landing page. Estimou ganhos de R$ 4.200/mês.",
    createdAt: new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 6 * 3600 * 1000).toISOString(),
  },
  {
    id: "lead-4",
    name: "Lucas Pintura Airless",
    profession: "Pintor",
    phone: "11954321098",
    city: "São Paulo",
    state: "SP",
    district: "Vila Mariana",
    status: "NEW",
    source: "WHATSAPP_SCRAPING",
    notes: "Contato coletado em grupo regional da Zona Sul de profissionais da construção civil.",
    createdAt: new Date(Date.now() - 1 * 24 * 3600 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 1 * 24 * 3600 * 1000).toISOString(),
  },
  {
    id: "lead-5",
    name: "Rodrigo Chaveiro 24h",
    profession: "Chaveiro",
    phone: "11943210987",
    city: "São Paulo",
    state: "SP",
    district: "Bela Vista",
    status: "FIRST_SERVICE",
    source: "REFERRAL",
    notes: "Primeiro serviço concluído com sucesso e nota 5 estrelas! Recebeu pagamento via PIX em 5 minutos.",
    createdAt: new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
    onboardedAt: new Date(Date.now() - 4 * 24 * 3600 * 1000).toISOString(),
  },
]

/**
 * Generates an individualized WhatsApp direct outreach link with pre-filled message
 */
export function generateWhatsAppOutreachLink(lead: GTMLead, appUrl: string = "https://severinno.com.br"): string {
  const cleanPhone = lead.phone.replace(/\D/g, "")
  const fullPhone = cleanPhone.startsWith("55") ? cleanPhone : `55${cleanPhone}`

  const message = `Olá ${lead.name.split(" ")[0]}! Tudo bem?

Vi que você realiza serviços de *${lead.profession}* com muita qualidade na região de *${lead.city}/${lead.state}*.

Sou da equipe do *Severinno* (a nova plataforma de serviços com recebimento garantido via PIX e sem taxa mensal).

Estamos selecionando os primeiros ${lead.profession}s verificados da sua região com benefícios exclusivos:
✅ 0% de mensalidade fixa
✅ Pagamento garantido na conta no mesmo dia
✅ Clientes qualificados no seu bairro com cálculo de deslocamento

Você pode simular seus ganhos e ativar seu perfil verificado em menos de 2 minutos aqui:
👉 ${appUrl}/?view=provider.register&utm_source=gtm_wa&utm_campaign=first50&lead=${lead.id}

Podemos bater um papo rápido de 3 minutos hoje?`

  return `https://wa.me/${fullPhone}?text=${encodeURIComponent(message)}`
}

/**
 * Lead Repository Operations
 */
export const GTMEngine = {
  listLeads(filter?: { status?: LeadStatus; city?: string; search?: string }): GTMLead[] {
    let result = [...leadsStore]

    if (filter?.status) {
      result = result.filter((l) => l.status === filter.status)
    }

    if (filter?.city) {
      result = result.filter((l) => l.city.toLowerCase().includes(filter.city!.toLowerCase()))
    }

    if (filter?.search) {
      const q = filter.search.toLowerCase()
      result = result.filter(
        (l) =>
          l.name.toLowerCase().includes(q) ||
          l.profession.toLowerCase().includes(q) ||
          l.phone.includes(q) ||
          (l.district && l.district.toLowerCase().includes(q))
      )
    }

    return result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  },

  createLead(data: Omit<GTMLead, "id" | "createdAt" | "updatedAt">): GTMLead {
    const newLead: GTMLead = {
      ...data,
      id: `lead-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    leadsStore.unshift(newLead)
    return newLead
  },

  updateLeadStatus(id: string, status: LeadStatus, notes?: string): GTMLead | null {
    const idx = leadsStore.findIndex((l) => l.id === id)
    if (idx === -1) return null

    const lead = leadsStore[idx]
    const updated: GTMLead = {
      ...lead,
      status,
      notes: notes !== undefined ? notes : lead.notes,
      updatedAt: new Date().toISOString(),
      onboardedAt: status === "ONBOARDED" && !lead.onboardedAt ? new Date().toISOString() : lead.onboardedAt,
      lastContactAt: status === "CONTACTED" ? new Date().toISOString() : lead.lastContactAt,
    }

    leadsStore[idx] = updated
    return updated
  },

  deleteLead(id: string): boolean {
    const initialLen = leadsStore.length
    leadsStore = leadsStore.filter((l) => l.id !== id)
    return leadsStore.length < initialLen
  },

  getFunnelMetrics(): FunnelMetrics {
    const target = 50
    const byStatus: Record<LeadStatus, number> = {
      NEW: 0,
      CONTACTED: 0,
      DEMO_SCHEDULED: 0,
      ONBOARDED: 0,
      FIRST_SERVICE: 0,
      REJECTED: 0,
    }

    for (const lead of leadsStore) {
      if (byStatus[lead.status] !== undefined) {
        byStatus[lead.status]++
      }
    }

    const totalLeads = leadsStore.length
    const onboardedCount = byStatus.ONBOARDED + byStatus.FIRST_SERVICE
    const firstServiceCount = byStatus.FIRST_SERVICE
    const activeInFunnel = byStatus.NEW + byStatus.CONTACTED + byStatus.DEMO_SCHEDULED
    const conversionRate = totalLeads > 0 ? Number(((onboardedCount / totalLeads) * 100).toFixed(1)) : 0
    const progressPct = Number(Math.min(100, (onboardedCount / target) * 100).toFixed(1))

    return {
      target,
      totalLeads,
      byStatus,
      conversionRate,
      activeInFunnel,
      onboardedCount,
      firstServiceCount,
      progressPct,
    }
  },
}
