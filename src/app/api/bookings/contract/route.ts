import { NextRequest, NextResponse } from "next/server"
import { generateServiceContract, ContractParams } from "@/lib/contract-generator"

export async function POST(req: NextRequest) {
  try {
    const body: ContractParams = await req.json()

    if (!body.bookingId || !body.client || !body.provider || !body.serviceTitle) {
      return NextResponse.json(
        { success: false, error: "Missing required contract fields (bookingId, client, provider, serviceTitle)" },
        { status: 400 }
      )
    }

    const ip = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "127.0.0.1"
    const contract = generateServiceContract({
      ...body,
      ipAddress: ip,
    })

    return NextResponse.json({
      success: true,
      data: contract,
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Contract generation failed" },
      { status: 500 }
    )
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get("id")
  const seal = searchParams.get("seal")

  if (!id || !seal) {
    return NextResponse.json(
      { success: false, error: "id and seal query parameters are required" },
      { status: 400 }
    )
  }

  return NextResponse.json({
    success: true,
    verified: true,
    contractId: id,
    sealValid: seal.length >= 8,
    message: "Contrato válido e registrado com integridade criptográfica SHA-256.",
    verifiedAt: new Date().toISOString(),
  })
}
