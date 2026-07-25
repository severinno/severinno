import { NextResponse } from "next/server";
import { reverseGeocode } from "@/lib/geo";

// Public: reverse geocode lat/lng via Nominatim (OSM).
// Returns a flat object (UI: `apiGet<{ street?, district?, city?, state?, cep? }>`).
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const lat = Number(searchParams.get("lat"));
    const lng = Number(searchParams.get("lng"));
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return NextResponse.json({ error: "Lat/lng inválidos" }, { status: 400 });
    }
    const address = await reverseGeocode(lat, lng);
    // Flatten the address — UI expects street/district/city/state/cep at the
    // top level (not nested under an `address` key).
    return NextResponse.json({
      street: address.road ?? null,
      district: address.neighbourhood ?? null,
      city: address.city ?? null,
      state: address.state ?? null,
      cep: address.postcode ?? null,
      displayName: address.displayName,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erro ao geocodificar";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
