import { NextRequest, NextResponse } from "next/server"
import {
  validateGeoCheckin,
  generateEscrowPIN,
  validateEscrowRelease,
} from "@/lib/geo-checkin-escrow"

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { action } = body

    switch (action) {
      case "checkin": {
        const {
          bookingId,
          providerId,
          providerLat,
          providerLng,
          clientAddressLat,
          clientAddressLng,
        } = body
        if (!bookingId || typeof providerLat !== "number" || typeof clientAddressLat !== "number") {
          return NextResponse.json(
            { success: false, error: "Missing checkin parameters" },
            { status: 400 },
          )
        }

        const result = validateGeoCheckin({
          bookingId,
          providerId: providerId || "unknown",
          providerLat,
          providerLng,
          clientAddressLat,
          clientAddressLng,
        })

        return NextResponse.json({ success: result.success, data: result })
      }

      case "generate-pin": {
        const { bookingId } = body
        if (!bookingId) {
          return NextResponse.json(
            { success: false, error: "bookingId is required" },
            { status: 400 },
          )
        }

        const pin = generateEscrowPIN(bookingId)
        return NextResponse.json({ success: true, data: pin })
      }

      case "release-escrow": {
        const { bookingId, pin, escrowAmount } = body
        if (!bookingId || !pin || typeof escrowAmount !== "number") {
          return NextResponse.json(
            { success: false, error: "bookingId, pin and escrowAmount required" },
            { status: 400 },
          )
        }

        const result = validateEscrowRelease(bookingId, pin, escrowAmount)
        return NextResponse.json({ success: result.success, data: result })
      }

      default:
        return NextResponse.json(
          { success: false, error: "Invalid action. Use: checkin, generate-pin, release-escrow" },
          { status: 400 },
        )
    }
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Escrow operation failed" },
      { status: 500 },
    )
  }
}
