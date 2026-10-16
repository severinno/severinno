import { NextResponse } from "next/server"
import { listSubscriptionPlans } from "@/lib/recurring-subscription-engine"

export async function GET() {
  const plans = listSubscriptionPlans()
  return NextResponse.json({
    success: true,
    plans,
  })
}
