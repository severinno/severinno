/**
 * check-postgis-state.ts — inspeciona o estado do PostGIS no banco ativo.
 *
 * Verifica (sem modificar nada):
 *   1. Extensão `postgis` habilitada (pg_extension)
 *   2. Coluna `location` geography(Point,4326) em User/Booking/QuoteRequest
 *   3. GiST indexes (idx_user_location_gist, etc.)
 *   4. Triggers de sync (trg_sync_*)
 *   5. Amostra de dados: quantos usuários com lat/lng e quantos com location
 *
 * Uso: bun scripts/check-postgis-state.ts
 */
import { PrismaClient } from "@prisma/client"

const db = new PrismaClient()

async function query<T>(sql: string): Promise<T> {
  return db.$queryRawUnsafe<T>(sql)
}

async function main() {
  console.log("== PostGIS state check ==")

  // 1. Extension
  const ext = await query<Array<{ extname: string; extversion: string | null }>>(
    `SELECT e.extname, e.extversion
       FROM pg_extension e
      WHERE e.extname = 'postgis'`,
  )
  console.log(`\n[1] Extensão postgis: ${ext.length ? `SIM (v${ext[0].extversion})` : "NÃO habilitada"}`)

  // 2. Columns
  const cols = await query<Array<{ table_name: string; column_name: string; udt_name: string }>>(
    `SELECT c.table_name, c.column_name, c.udt_name
       FROM information_schema.columns c
      WHERE c.column_name = 'location'
        AND c.table_schema = 'public'
      ORDER BY c.table_name`,
  )
  console.log("\n[2] Coluna 'location':")
  if (!cols.length) console.log("    (nenhuma)")
  for (const c of cols) console.log(`    ${c.table_name}.${c.column_name} (${c.udt_name})`)

  // 3. Indexes
  const idx = await query<Array<{ indexname: string; tablename: string; indexdef: string }>>(
    `SELECT i.indexname, i.tablename, i.indexdef
       FROM pg_indexes i
      WHERE i.schemaname = 'public'
        AND i.indexname ILIKE '%location%'
      ORDER BY i.tablename`,
  )
  console.log("\n[3] GiST indexes (location):")
  if (!idx.length) console.log("    (nenhum)")
  for (const i of idx) console.log(`    ${i.tablename}: ${i.indexname}`)

  // 4. Triggers
  const trg = await query<Array<{ tgname: string; relname: string }>>(
    `SELECT t.tgname, c.relname
       FROM pg_trigger t
       JOIN pg_class c ON c.oid = t.tgrelid
      WHERE t.tgname ILIKE 'trg_sync_%location%'
        AND NOT t.tgisinternal
      ORDER BY c.relname`,
  )
  console.log("\n[4] Triggers de sync:")
  if (!trg.length) console.log("    (nenhum)")
  for (const t of trg) console.log(`    ${t.relname}: ${t.tgname}`)

  // 5. Data sample — how many users have lat/lng vs location
  const data = await query<Array<{ total: string; with_lat_lng: string; with_location: string }>>(
    `SELECT COUNT(*)::text AS total,
            COUNT(*) FILTER (WHERE lat IS NOT NULL AND lng IS NOT NULL)::text AS with_lat_lng,
            COUNT(*) FILTER (WHERE location IS NOT NULL)::text AS with_location
       FROM "User"`,
  )
  console.log("\n[5] User data:")
  if (data[0]) {
    console.log(`    total: ${data[0].total} | com lat/lng: ${data[0].with_lat_lng} | com location: ${data[0].with_location}`)
  }

  // 6. PostGIS functions actually usable? (sanity: ST_MakePoint works)
  try {
    const probe = await query<Array<{ ok: boolean }>>(
      `SELECT ST_DWithin(
         ST_SetSRID(ST_MakePoint(-46.6333, -23.5505), 4326)::geography,
         ST_SetSRID(ST_MakePoint(-46.6433, -23.5605), 4326)::geography,
         5000
       ) AS ok`,
    )
    console.log(`\n[6] ST_DWithin funciona: ${probe[0]?.ok === true ? "SIM" : "NÃO"}`)
  } catch (e) {
    console.log(`\n[6] ST_DWithin falhou: ${(e as Error).message}`)
  }
}

main()
  .catch((e) => {
    console.error("Falha na inspeção:", e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
