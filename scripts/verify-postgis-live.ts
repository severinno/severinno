/**
 * verify-postgis-live.ts — prova que a pipeline PostGIS está viva no banco ativo.
 *
 * Chama as funções REAIS de src/lib/postgis.ts (não mocks):
 *   1. isPostGISAvailable()            → deve ser true
 *   2. findProvidersWithinRadius(lat,lng,radius) → usa ST_DWithin + GiST index
 *   3. getDistanceBetween(a, b)        → usa ST_Distance
 *
 * Uso: bun scripts/verify-postgis-live.ts
 */
import { PrismaClient } from "@prisma/client"
import {
  isPostGISAvailable,
  findProvidersWithinRadius,
  getDistanceBetween,
} from "@/lib/postgis"

const db = new PrismaClient()

async function main() {
  console.log("== Verificação ao vivo da pipeline PostGIS ==")

  // 1. Disponibilidade (mesma função usada pela rota /api/providers)
  const available = await isPostGISAvailable()
  console.log(`\n[1] isPostGISAvailable() = ${available} ${available ? "✅" : "❌"}`)

  // 2. Prova real do caminho PostGIS: ST_DWithin contra providers reais.
  //    Usa o centro dos providers do seed (SP) com raio generoso.
  const sample = await db.$queryRawUnsafe<Array<{ lat: number; lng: number }>>(
    `SELECT lat, lng FROM "User"
      WHERE role = 'PROVIDER' AND lat IS NOT NULL AND lng IS NOT NULL
      LIMIT 1`,
  )
  const center =
    sample[0] && Number.isFinite(sample[0].lat) && Number.isFinite(sample[0].lng)
      ? { lat: sample[0].lat, lng: sample[0].lng }
      : { lat: -23.5505, lng: -46.6333 } // fallback: São Paulo

  // Tenta 100km; se não achar nada, expande para 500km antes de concluir.
  let radius = 100
  let near = await findProvidersWithinRadius(center.lat, center.lng, radius)
  if (near.length === 0) {
    radius = 500
    near = await findProvidersWithinRadius(center.lat, center.lng, radius)
  }
  console.log(
    `\n[2] findProvidersWithinRadius(${center.lat.toFixed(4)}, ${center.lng.toFixed(4)}, ${radius}km) ` +
      `→ ${near.length} provider(s) via ST_DWithin${near.length ? " ✅" : " ❌ (nenhum provider no raio)"}`,
  )
  if (near.length) {
    console.log(`    exemplo: ${near[0].id} a ${near[0].distanceKm.toFixed(1)} km`)
  }

  // 3. ST_Distance entre dois providers reais
  const pair = await db.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id FROM "User"
      WHERE role = 'PROVIDER' AND location IS NOT NULL
      LIMIT 2`,
  )
  if (pair.length === 2) {
    const d = await getDistanceBetween(pair[0].id, pair[1].id)
    console.log(`\n[3] getDistanceBetween(providers) → ${d !== null ? d.toFixed(1) + " km ✅" : "null ❌"}`)
  } else {
    console.log("\n[3] menos de 2 providers com location — pulando teste de distância")
  }

  console.log("\nConclusão:", available ? "PostGIS disponível — rota /api/providers usará a pipeline espacial." : "PostGIS INDISPONÍVEL.")
}

main()
  .catch((e) => {
    console.error("Falha na verificação:", e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
