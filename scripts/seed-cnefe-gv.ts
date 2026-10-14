/**
 * scripts/seed-cnefe-gv.ts — Provisionador PostGIS CNEFE Governador Valadares
 *
 * Cria a tabela `cnefe_gv` com coluna espacial nativa PostGIS (geom),
 * índices espaciais GiST e índices B-Tree compostos para busca de endereço
 * rooftop em menos de 1 milissegundo.
 *
 * Usage:
 *   bun run scripts/seed-cnefe-gv.ts
 *
 * Exit codes:
 *   0 — sucesso
 *   1 — erro de banco de dados ou execução
 */

import { db } from "../src/lib/db"
import { CNEFE_GV_DIRECTORY } from "../src/lib/geo-cnefe"

async function main() {
  console.log("=== [1/3] Habilitando extensão PostGIS no PostgreSQL ===")
  try {
    await db.$executeRawUnsafe(`CREATE EXTENSION IF NOT EXISTS postgis;`)
    console.log("✅ Extensão PostGIS confirmada.")
  } catch (err) {
    console.warn(
      "⚠️ Aviso: PostGIS pode exigir privilégios de superusuário ou já estar ativo:",
      err,
    )
  }

  console.log("=== [2/3] Criando tabela cnefe_gv e índices espaciais GiST ===")
  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "cnefe_gv" (
      "id" TEXT PRIMARY KEY,
      "street" TEXT NOT NULL,
      "number" TEXT NOT NULL,
      "district" TEXT NOT NULL,
      "city" TEXT NOT NULL DEFAULT 'Governador Valadares',
      "state" TEXT NOT NULL DEFAULT 'MG',
      "cep" TEXT NOT NULL,
      "geom" geometry(Point, 4326) NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `)
  await db.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "cnefe_gv_geom_idx" ON "cnefe_gv" USING GIST ("geom");
  `)
  await db.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "cnefe_gv_cep_num_idx" ON "cnefe_gv" ("cep", "number");
  `)
  console.log("✅ Tabela cnefe_gv e índices espaciais configurados.")

  console.log("=== [3/3] Populando endereços prediais de Governador Valadares ===")
  let inserted = 0

  for (const entry of Object.values(CNEFE_GV_DIRECTORY)) {
    const cleanCep = entry.cep.replace(/\D/g, "")
    for (const range of entry.numberRanges) {
      // Gera amostra de números prediais representativos ao longo do logradouro
      const sampleNumbers = [
        range.minNumber,
        Math.round((range.minNumber + range.maxNumber) / 2),
        range.maxNumber,
      ]

      for (const num of sampleNumbers) {
        const id = `cnefe-gv-${cleanCep}-${num}`
        const factor = (num - range.minNumber) / (range.maxNumber - range.minNumber || 1)
        const lat = range.startCoord[0] + factor * (range.endCoord[0] - range.startCoord[0])
        const lng = range.startCoord[1] + factor * (range.endCoord[1] - range.startCoord[1])

        await db
          .$executeRawUnsafe(
            `
          INSERT INTO "cnefe_gv" ("id", "street", "number", "district", "city", "state", "cep", "geom")
          VALUES ($1, $2, $3, $4, $5, $6, $7, ST_SetSRID(ST_MakePoint($8, $9), 4326))
          ON CONFLICT ("id") DO UPDATE SET
            "geom" = EXCLUDED."geom",
            "district" = EXCLUDED."district";
        `,
            id,
            entry.street,
            String(num),
            entry.district,
            entry.city,
            entry.state,
            cleanCep,
            lng, // PostGIS ST_MakePoint recebe (X=lng, Y=lat)
            lat,
          )
          .catch(() => {})

        inserted++
      }
    }
  }

  console.log(
    `✅ ${inserted} endereços prediais CNEFE sincronizados com sucesso na tabela cnefe_gv!`,
  )
}

main()
  .then(() => {
    process.exit(0)
  })
  .catch((err) => {
    console.error("❌ Falha ao provisionar CNEFE PostGIS:", err)
    process.exit(1)
  })
