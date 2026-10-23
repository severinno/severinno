/**
 * recurring-subscription-engine.ts — Assinaturas Recorrentes & Severinno Prime (MRR)
 *
 * Transforma serviços avulsos em receita previsível recorrente mensal (MRR).
 * Oferece planos residenciais e corporativos com descontos de mão de obra,
 * isenção de taxas de urgência e chamadas inclusas.
 */

import { randomBytes } from "crypto"

export interface SubscriptionPlan {
  id: string
  name: string
  slug: string
  priceMonthly: number
  description: string
  discountPercent: number
  waiveEmergencyFee: boolean
  priorityLevel: number // 1 a 3
  includedServicesPerMonth: number
  features: string[]
}

export const SUBSCRIPTION_PLANS: SubscriptionPlan[] = [
  {
    id: "plan_prime_monthly",
    name: "Severinno Prime",
    slug: "prime-monthly",
    priceMonthly: 29.9,
    description: "Para quem quer economia contínua e prioridade nos atendimentos.",
    discountPercent: 10,
    waiveEmergencyFee: true,
    priorityLevel: 1,
    includedServicesPerMonth: 0,
    features: [
      "10% de desconto em todos os serviços",
      "Isenção total da taxa de urgência (Surge Pricing)",
      "Prioridade na fila de despacho de prestadores",
      "Garantia estendida de 90 dias sem custo extra",
    ],
  },
  {
    id: "plan_home_care_plus",
    name: "Home Care Residencial",
    slug: "home-care-plus",
    priceMonthly: 189.0,
    description: "Ideal para residências que precisam de manutenção preventiva e diarista regular.",
    discountPercent: 15,
    waiveEmergencyFee: true,
    priorityLevel: 2,
    includedServicesPerMonth: 2, // 2 serviços inclusos (ex: diarista ou faxina)
    features: [
      "2 diárias completas inclusas por mês",
      "1 checklist preventivo elétrico/hidráulico bimestral",
      "15% de desconto em qualquer serviço extra",
      "Prestador fixo preferencial garantido",
    ],
  },
  {
    id: "plan_commercial_enterprise",
    name: "Severinno Empresas & Condomínios",
    slug: "commercial-enterprise",
    priceMonthly: 399.0,
    description: "Para escritórios, clínicas e condomínios com suporte rápido.",
    discountPercent: 20,
    waiveEmergencyFee: true,
    priorityLevel: 3,
    includedServicesPerMonth: 4,
    features: [
      "4 visitas de manutenção preventiva por mês",
      "SLA garantido de chegada em até 45 min para panes emergenciais",
      "20% de desconto em obras e reparos estruturais",
      "Nota fiscal unificada consolidada mensal com split contábil",
    ],
  },
]

export interface UserSubscription {
  subscriptionId: string
  userId: string
  userEmail: string
  planId: string
  planName: string
  priceMonthly: number
  status: "ACTIVE" | "PAUSED" | "CANCELLED" | "PENDING_PAYMENT"
  paymentMethod: "PIX_RECURRENT" | "CREDIT_CARD"
  startedAt: string
  currentPeriodEnd: string
  servicesUsedThisMonth: number
  servicesQuotaTotal: number
}

// Armazenamento em memória (fallback ao banco de dados)
const subscriptionsStore = new Map<string, UserSubscription>()

/**
 * Retorna todos os planos disponíveis para contratação.
 */
export function listSubscriptionPlans(): SubscriptionPlan[] {
  return SUBSCRIPTION_PLANS
}

/**
 * Obtém plano pelo slug ou ID.
 */
export function getSubscriptionPlan(identifier: string): SubscriptionPlan | undefined {
  return SUBSCRIPTION_PLANS.find((p) => p.id === identifier || p.slug === identifier)
}

/**
 * Calcula desconto e economia de um plano sobre um serviço avulso.
 */
export function calculateSubscriptionDiscount(
  planId: string,
  baseServicePrice: number,
): {
  originalPrice: number
  discountPercent: number
  discountAmount: number
  finalPrice: number
  waiveEmergencyFee: boolean
} {
  const plan = getSubscriptionPlan(planId)
  if (!plan) {
    return {
      originalPrice: baseServicePrice,
      discountPercent: 0,
      discountAmount: 0,
      finalPrice: baseServicePrice,
      waiveEmergencyFee: false,
    }
  }

  const discountAmount = Math.round(baseServicePrice * (plan.discountPercent / 100) * 100) / 100
  const finalPrice = Math.max(0, Math.round((baseServicePrice - discountAmount) * 100) / 100)

  return {
    originalPrice: baseServicePrice,
    discountPercent: plan.discountPercent,
    discountAmount,
    finalPrice,
    waiveEmergencyFee: plan.waiveEmergencyFee,
  }
}

/**
 * Cria ou ativa uma nova assinatura para o usuário.
 */
export function createSubscription(params: {
  userId: string
  userEmail: string
  planId: string
  paymentMethod?: "PIX_RECURRENT" | "CREDIT_CARD"
  now?: number
}): UserSubscription {
  const { userId, userEmail, planId, paymentMethod = "PIX_RECURRENT", now = Date.now() } = params

  const plan = getSubscriptionPlan(planId)
  if (!plan) {
    throw new Error(`Plano de assinatura ${planId} não encontrado`)
  }

  const startDate = new Date(now)
  const endDate = new Date(now + 30 * 24 * 60 * 60 * 1000) // D+30

  const sub: UserSubscription = {
    subscriptionId: `sub_${Date.now()}_${randomBytes(4).toString("hex")}`,
    userId,
    userEmail,
    planId: plan.id,
    planName: plan.name,
    priceMonthly: plan.priceMonthly,
    status: "ACTIVE",
    paymentMethod,
    startedAt: startDate.toISOString(),
    currentPeriodEnd: endDate.toISOString(),
    servicesUsedThisMonth: 0,
    servicesQuotaTotal: plan.includedServicesPerMonth,
  }

  subscriptionsStore.set(userId, sub)
  return sub
}

/**
 * Obtém a assinatura ativa do usuário, se houver.
 */
export function getUserActiveSubscription(userId: string): UserSubscription | undefined {
  return subscriptionsStore.get(userId)
}

/**
 * Limpa assinaturas para testes.
 */
export function clearSubscriptionsForTesting(): void {
  subscriptionsStore.clear()
}
