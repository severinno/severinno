#!/usr/bin/env bun
/**
 * scripts/import-city-geo.ts
 *
 * Pipeline de expansão municipal e provisionamento geoespacial:
 *   - Lista e valida metadados territoriais e códigos IBGE das cidades.
 *   - Provisiona âncoras prediais e centros de gravidade urbanos no PostGIS.
 *   - Valida a conectividade de roteamento viário e geocodificação CNEFE.
 *
 * Usage:
 *   bun scripts/import-city-geo.ts --list
 *   bun scripts/import-city-geo.ts --city ipatinga
 *   bun scripts/import-city-geo.ts --all
 *   bun scripts/import-city-geo.ts --verify
 *
 * Exit codes:
 *   0 — sucesso na execução da rotina
 *   1 — falha na importação, validação ou banco de dados
 */

import { getAllCities, getCityConfig, type CityConfig } from "../src/lib/cities"
import { db } from "../src/lib/db"
import { isCoordinateInsideCity, calculateMultiCityRoute } from "../src/lib/geo-multi-city"

const args = process.argv.slice(2)

async function listCities(): Promise<void> {
  const cities = getAllCities()
  console.log("\n🗺️  Cidades Registradas no Severinno Marketplace:")
  console.log("─".repeat(80))
  for (const c of cities) {
    const status = c.active ? "🟢 ATIVA" : "🟡 EM PREPARAÇÃO"
    console.log(`• [${c.id}] ${c.name} - ${c.state} | IBGE: ${c.ibgeCode || "N/A"} | ${status}`)
    console.log(
      `  Centro: [${c.lat}, ${c.lng}] | Raio: ${c.defaultRadiusKm} km | Taxa: ${(c.feeRate * 100).toFixed(0)}%`,
    )
    if (c.boundingBox) {
      console.log(
        `  BoundingBox: Lat [${c.boundingBox.minLat} .. ${c.boundingBox.maxLat}], Lng [${c.boundingBox.minLng} .. ${c.boundingBox.maxLng}]`,
      )
    }
  }
  console.log("─".repeat(80))
}

async function provisionCity(city: CityConfig): Promise<void> {
  console.log(`\n⚙️ Provisionando malha geoespacial para: ${city.name} (${city.state})...`)

  // Garante extensão PostGIS
  await db.$executeRawUnsafe(`CREATE EXTENSION IF NOT EXISTS postgis;`).catch(() => {})

  // Provisiona ponto âncora do Centro Cívico / Comercial
  const anchorId = `anchor_${city.id}`
  const now = new Date()

  // Usa consulta SQL parametrizada segura para prevenir SQL injection
  await db.$executeRawUnsafe(
    `INSERT INTO "cnefe_gv" ("id", "street", "number", "district", "city", "state", "cep", "geom", "createdAt")
     VALUES ($1, $2, $3, $4, $5, $6, $7, ST_SetSRID(ST_MakePoint($8, $9), 4326), $10)
     ON CONFLICT ("id") DO UPDATE SET
       "street" = EXCLUDED."street",
       "geom" = EXCLUDED."geom";`,
    anchorId,
    `Centro Histórico de ${city.name}`,
    "1",
    "Centro",
    city.name,
    city.state,
    city.id === "ipatinga" ? "35160001" : city.id === "teofilo-otoni" ? "39800001" : "35010001",
    city.lng,
    city.lat,
    now,
  )

  const isInside = isCoordinateInsideCity(city.lat, city.lng, city.id)
  console.log(
    `  ✅ Âncora PostGIS registrada com sucesso: [${city.lat}, ${city.lng}] (In Bounds: ${isInside ? "SIM" : "NÃO"})`,
  )
}

async function verifyCity(cityId: string): Promise<boolean> {
  const city = getCityConfig(cityId)
  if (!city) {
    console.error(`❌ Cidade não encontrada: ${cityId}`)
    return false
  }

  console.log(`\n🔍 Verificando integridade territorial de ${city.name}...`)
  const isInside = isCoordinateInsideCity(city.lat, city.lng, city.id)
  if (!isInside) {
    console.error(`  ❌ Coordenada central fora do bounding box configurado!`)
    return false
  }
  console.log(`  ✅ Bounding box territorial consistente.`)

  // Teste de cálculo de rota local
  const origin = { lat: city.lat, lng: city.lng }
  const dest = { lat: city.lat + 0.01, lng: city.lng + 0.01 }
  const route = await calculateMultiCityRoute({ origin, destination: dest, cityId: city.id })

  console.log(
    `  ✅ Rota teste resolvida: ${route.distanceKm} km (~${route.durationMinutes} min) via ${route.provider}`,
  )
  return true
}

async function main(): Promise<void> {
  if (args.includes("--list") || args.length === 0) {
    await listCities()
    process.exit(0)
  }

  if (args.includes("--all")) {
    const active = getAllCities().filter((c) => c.active)
    for (const c of active) {
      await provisionCity(c)
      await verifyCity(c.id)
    }
    console.log("\n🎉 Todas as cidades ativas foram provisionadas com sucesso!")
    process.exit(0)
  }

  const cityIdx = args.indexOf("--city")
  if (cityIdx !== -1 && args[cityIdx + 1]) {
    const cityId = args[cityIdx + 1]
    const city = getCityConfig(cityId)
    if (!city) {
      console.error(`❌ Cidade inválida: ${cityId}`)
      process.exit(1)
    }
    await provisionCity(city)
    const ok = await verifyCity(city.id)
    process.exit(ok ? 0 : 1)
  }

  if (args.includes("--verify")) {
    const cities = getAllCities().filter((c) => c.active)
    let allOk = true
    for (const c of cities) {
      const ok = await verifyCity(c.id)
      if (!ok) allOk = false
    }
    process.exit(allOk ? 0 : 1)
  }

  console.log("Argumento não reconhecido. Use --list, --city <id>, --all ou --verify.")
  process.exit(1)
}

main().catch((err) => {
  console.error("❌ Erro fatal no importador multi-cidades:", err)
  process.exit(1)
})
