import { describe, it, expect, beforeEach } from "vitest"
import {
  listSubscriptionPlans,
  getSubscriptionPlan,
  calculateSubscriptionDiscount,
  createSubscription,
  getUserActiveSubscription,
  clearSubscriptionsForTesting,
} from "../recurring-subscription-engine"

describe("recurring-subscription-engine", () => {
  beforeEach(() => {
    clearSubscriptionsForTesting()
  })

  it("lista os planos configurados e busca por slug", () => {
    const plans = listSubscriptionPlans()
    expect(plans.length).toBeGreaterThanOrEqual(3)

    const prime = getSubscriptionPlan("prime-monthly")
    expect(prime).toBeDefined()
    expect(prime?.discountPercent).toBe(10)
    expect(prime?.waiveEmergencyFee).toBe(true)
  })

  it("calcula o desconto de 10% do Severinno Prime sobre um serviço avulso", () => {
    const calc = calculateSubscriptionDiscount("plan_prime_monthly", 250.0)

    expect(calc.originalPrice).toBe(250.0)
    expect(calc.discountPercent).toBe(10)
    expect(calc.discountAmount).toBe(25.0)
    expect(calc.finalPrice).toBe(225.0)
    expect(calc.waiveEmergencyFee).toBe(true)
  })

  it("cria assinatura ativa para o usuário e calcula período de 30 dias", () => {
    const fixedNow = 1760000000000
    const sub = createSubscription({
      userId: "user-client-1",
      userEmail: "cliente@severinno.com",
      planId: "plan_home_care_plus",
      now: fixedNow,
    })

    expect(sub.subscriptionId).toMatch(/^sub_/)
    expect(sub.status).toBe("ACTIVE")
    expect(sub.priceMonthly).toBe(189.0)
    expect(sub.servicesQuotaTotal).toBe(2)

    const retrieved = getUserActiveSubscription("user-client-1")
    expect(retrieved).toBeDefined()
    expect(retrieved?.subscriptionId).toBe(sub.subscriptionId)
  })

  it("rejeita plano inexistente", () => {
    expect(() =>
      createSubscription({
        userId: "user-x",
        userEmail: "x@x.com",
        planId: "plano_invalido",
      }),
    ).toThrow()
  })
})
