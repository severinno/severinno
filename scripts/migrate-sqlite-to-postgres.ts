/* eslint-disable no-console, @typescript-eslint/no-explicit-any  */
/**
 * Script de migração: SQLite → PostgreSQL + PostGIS
 *
 * ATENÇÃO: O PrismaClient é gerado para o provider definido no schema.prisma.
 * Se o schema aponta para "postgresql", a mesma build NÃO consegue conectar
 * em SQLite. Para contornar, use um schema SQLITE separado:
 *
 *   # Gere um client para SQLite primeiro:
 *   PRISMA_SCHEMA_PATH=prisma/schema-sqlite.prisma npx prisma generate
 *   # Depois execute:
 *   DATABASE_URL_SQLITE="file:./prisma/dev.db" \
 *   DATABASE_URL_PG="postgresql://severinno:severinno@localhost:5432/severinno" \
 *   bun scripts/migrate-sqlite-to-postgres.ts
 *
 * Ou, mais simples: use um script SQL direto com sql.js para ler do SQLite.
 *
 * Uso alternativo (recomendado para migração real):
 *   # 1. Dump SQLite como SQL
 *   sqlite3 prisma/dev.db .dump > dump.sql
 *   # 2. Transformar sintaxe (manual) e importar no PostgreSQL
 *   psql -h localhost -U severinno -d severinno < dump_transformed.sql
 *   # 3. Rodar PostGIS migration
 *   psql -h localhost -U severinno -d severinno \
 *     -f prisma/migrations/XX_add_postgis/migration.sql
 *
 * Ordem de migração (respeitando FKs):
 *   1. Setting
 *   2. User
 *   3. Category
 *   4. Service
 *   5. ProviderAvailability
 *   6. QuoteRequest + QuoteItem
 *   7. Booking + Payment
 *   8. Review
 *   9. Favorite
 *   10. Message
 *   11. Notification
 *   12. SettlementPeriod + ProviderSettlement
 */

import { PrismaClient } from "@prisma/client"
import { execSync } from "child_process"

const SQLITE_URL = process.env.DATABASE_URL_SQLITE || "file:./prisma/dev.db"
const PG_URL = process.env.DATABASE_URL_PG

if (!PG_URL) {
  console.error("❌ DATABASE_URL_PG is required")
  console.error(
    '   Ex: DATABASE_URL_PG="postgresql://severinno:severinno@localhost:5432/severinno"',
  )
  process.exit(1)
}

async function migrate() {
  console.log("🔄 Starting SQLite → PostgreSQL migration...")

  // Step 1: Push schema to PostgreSQL
  console.log("📦 Pushing schema to PostgreSQL...")
  execSync(`DATABASE_URL="${PG_URL}" bunx prisma db push --accept-data-loss`, {
    stdio: "inherit",
  })

  // Step 2: Run manual PostGIS migration SQL
  console.log("🗺️  Applying PostGIS migration...")
  try {
    execSync(
      `PGPASSWORD=severinno psql -h localhost -U severinno -d severinno ` +
        `-f prisma/migrations/XX_add_postgis/migration.sql`,
      { stdio: "inherit" },
    )
  } catch {
    console.log("   ⚠️  psql not available — PostGIS migration must be run manually")
    console.log(
      "       Run: psql -h localhost -U severinno -d severinno -f prisma/migrations/XX_add_postgis/migration.sql",
    )
  }

  // Step 3: Connect to PostgreSQL
  const pg = new PrismaClient({
    datasources: { db: { url: PG_URL } },
  })

  try {
    // Attempt to connect to SQLite using PrismaClient
    // NOTE: Both construction AND $connect() can throw if the Prisma client
    // was generated for PostgreSQL (schema.prisma has provider = "postgresql").
    // In that case, use the sqlite3 + psql approach documented below.
    let sqlite: PrismaClient | null = null
    try {
      sqlite = new PrismaClient({
        datasources: { db: { url: SQLITE_URL } },
      })
      await sqlite.$connect()
      console.log(`📋 Connected to SQLite at ${SQLITE_URL}`)
    } catch (e) {
      console.error("❌ Could not connect to SQLite.")
      console.error("   If the Prisma client was generated for PostgreSQL, the constructor")
      console.error("   itself may reject a SQLite connection URL.")
      console.error("")
      console.error("   🔧 Quick fix (recommended):")
      console.error("   $ sqlite3 prisma/dev.db .dump > /tmp/dump.sql")
      console.error("   $ psql -h localhost -U severinno -d severinno < /tmp/dump.sql")
      console.error("   $ psql -h localhost -U severinno -d severinno \\")
      console.error("       -f prisma/migrations/XX_add_postgis/migration.sql")
      console.error("")
      console.error("   🔧 Alternate (Prisma + separate SQLite schema):")
      console.error("   $ cp prisma/schema.prisma prisma/schema-sqlite.prisma")
      console.error("   $ # Edit schema-sqlite.prisma: change provider to 'sqlite'")
      console.error("   $ PRISMA_SCHEMA_PATH=prisma/schema-sqlite.prisma npx prisma generate")
      throw e
    }

    // --- Settings (no dependencies) ---
    console.log("📋 Migrating settings...")
    const settings = await sqlite.setting.findMany()
    if (settings.length > 0) {
      await pg.setting.createMany({ data: settings as any })
      console.log(`  ✅ ${settings.length} settings migrated`)
    }

    // --- Users (location synced automatically by trigger from lat/lng) ---
    console.log("📋 Migrating users...")
    const users = await sqlite.user.findMany()
    for (const user of users) {
      await pg.user.create({ data: user as any })
    }
    console.log(`  ✅ ${users.length} users migrated`)

    // --- Categories ---
    console.log("📋 Migrating categories...")
    const categories = await sqlite.category.findMany()
    if (categories.length > 0) {
      await pg.category.createMany({ data: categories as any })
      console.log(`  ✅ ${categories.length} categories migrated`)
    }

    // --- Services ---
    console.log("📋 Migrating services...")
    const services = await sqlite.service.findMany()
    for (const svc of services) {
      await pg.service.create({ data: svc as any })
    }
    console.log(`  ✅ ${services.length} services migrated`)

    // --- Provider Availability ---
    console.log("📋 Migrating provider availability...")
    const availabilities = await sqlite.providerAvailability.findMany()
    if (availabilities.length > 0) {
      await pg.providerAvailability.createMany({ data: availabilities as any })
      console.log(`  ✅ ${availabilities.length} availabilities migrated`)
    }

    // --- Quote Requests + Items ---
    console.log("📋 Migrating quote requests...")
    const quotes = await sqlite.quoteRequest.findMany({ include: { items: true } })
    for (const quote of quotes) {
      const { items, ...quoteData } = quote
      await pg.quoteRequest.create({
        data: {
          ...quoteData,
          items: { createMany: { data: items as any } },
        } as any,
      })
    }
    console.log(`  ✅ ${quotes.length} quote requests migrated`)

    // --- Bookings + Payments (location synced by trigger) ---
    console.log("📋 Migrating bookings...")
    const bookings = await sqlite.booking.findMany({ include: { payment: true } })
    for (const booking of bookings) {
      const { payment, ...bookingData } = booking
      await pg.booking.create({
        data: {
          ...bookingData,
          payment: payment ? { create: payment as any } : undefined,
        } as any,
      })
    }
    console.log(`  ✅ ${bookings.length} bookings migrated`)

    // --- Reviews ---
    console.log("📋 Migrating reviews...")
    const reviews = await sqlite.review.findMany()
    if (reviews.length > 0) {
      await pg.review.createMany({ data: reviews as any })
      console.log(`  ✅ ${reviews.length} reviews migrated`)
    }

    // --- Favorites ---
    console.log("📋 Migrating favorites...")
    const favorites = await sqlite.favorite.findMany()
    if (favorites.length > 0) {
      await pg.favorite.createMany({ data: favorites as any })
      console.log(`  ✅ ${favorites.length} favorites migrated`)
    }

    // --- Messages ---
    console.log("📋 Migrating messages...")
    const messages = await sqlite.message.findMany()
    if (messages.length > 0) {
      await pg.message.createMany({ data: messages as any })
      console.log(`  ✅ ${messages.length} messages migrated`)
    }

    // --- Notifications ---
    console.log("📋 Migrating notifications...")
    const notifications = await sqlite.notification.findMany()
    if (notifications.length > 0) {
      await pg.notification.createMany({ data: notifications as any })
      console.log(`  ✅ ${notifications.length} notifications migrated`)
    }

    // --- SettlementPeriod + ProviderSettlement ---
    console.log("📋 Migrating settlement periods...")
    const periods = await sqlite.settlementPeriod.findMany({
      include: { providers: true },
    })
    for (const period of periods) {
      const { providers, ...periodData } = period
      await pg.settlementPeriod.create({
        data: {
          ...periodData,
          providers: { createMany: { data: providers as any } },
        } as any,
      })
    }
    console.log(`  ✅ ${periods.length} settlement periods migrated`)

    await sqlite.$disconnect()
    console.log("\n✅ Migration completed successfully!")
  } finally {
    await pg.$disconnect()
  }
}

migrate().catch((err) => {
  console.error("❌ Migration failed:", err)
  process.exit(1)
})
