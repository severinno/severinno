import { NextResponse } from "next/server"
import { fullTextSearch } from "@/lib/search"
import { handleError } from "@/lib/api-server"

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const q = searchParams.get("q")?.trim() ?? ""

    if (!q || q.length < 2) {
      return NextResponse.json({ items: [], q })
    }

    const items = await fullTextSearch(q)
    return NextResponse.json({ items, q })
  } catch (e) {
    return handleError(e)
  }
}
