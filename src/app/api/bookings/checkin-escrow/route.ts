export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import {
  validateGeoCheckin,
  generateEscrowPIN,
  validateEscrowRelease,
} from "@/lib/geo-checkin-escrow"
import { requireUser } from "@/lib/auth"

import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { checkinEscrowSchema } from "@/lib/validators"

import { withRoute } from "@/lib/api-route"

export const POST = withRoute("api.bookings.checkin-escrow.POST", async (req) => {
  await requireUser()
  await assertRateLimit(req, RATE_LIMITS.bookings)
  const body = await req.json()
  const parsed = checkinEscrowSchema.parse(body)

  switch (parsed.action) {
    case "checkin": {
      const result = validateGeoCheckin({
        bookingId: parsed.bookingId,
        providerId: parsed.providerId,
        providerLat: parsed.providerLat,
        providerLng: parsed.providerLng,
        clientAddressLat: parsed.clientAddressLat,
        clientAddressLng: parsed.clientAddressLng,
      })

      return NextResponse.json({ success: result.success, data: result })
    }

    case "generate-pin": {
      const pin = await generateEscrowPIN(parsed.bookingId)
      return NextResponse.json({ success: true, data: pin })
    }

    case "release-escrow": {
      const result = await validateEscrowRelease(parsed.bookingId, parsed.pin, parsed.escrowAmount)
      return NextResponse.json({ success: result.success, data: result })
    }
  }
})
