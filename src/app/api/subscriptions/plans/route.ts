import { NextResponse } from "next/server"
import { withRoute } from "@/lib/api-route"
import { listSubscriptionPlans } from "@/lib/recurring-subscription-engine"

export const GET = withRoute("api.subscriptions.plans.GET", async () => {
  const plans = listSubscriptionPlans()
  return NextResponse.json({
    success: true,
    plans,
  })
})
