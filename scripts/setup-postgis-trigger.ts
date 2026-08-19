import { PrismaClient } from "@prisma/client"

async function main() {
  const prisma = new PrismaClient()
  console.log("Connecting to database...")
  await prisma.$connect()
  console.log("Connected successfully. Running PostGIS setup...")

  const sqlCommands = [
    `CREATE EXTENSION IF NOT EXISTS postgis;`,
    `CREATE EXTENSION IF NOT EXISTS postgis_topology;`,
    // Ensure the location column has the correct type
    `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS location geometry(Point, 4326);`,
    // Sync existing coordinates to the location point
    `UPDATE "User"
     SET location = ST_SetSRID(ST_MakePoint(lng, lat), 4326)
     WHERE lat IS NOT NULL AND lng IS NOT NULL AND location IS NULL;`,
    // Create GiST spatial index
    `CREATE INDEX IF NOT EXISTS idx_user_location_gist ON "User" USING gist(location);`,
    // Create trigger function
    `CREATE OR REPLACE FUNCTION sync_user_location()
     RETURNS TRIGGER AS $$
     BEGIN
       IF NEW.lat IS NOT NULL AND NEW.lng IS NOT NULL THEN
         NEW.location := ST_SetSRID(ST_MakePoint(NEW.lng, NEW.lat), 4326);
       ELSE
         NEW.location := NULL;
       END IF;
       RETURN NEW;
     END;
     $$ LANGUAGE plpgsql;`,
    // Drop existing trigger if exists
    `DROP TRIGGER IF EXISTS trg_sync_user_location ON "User";`,
    // Create trigger
    `CREATE TRIGGER trg_sync_user_location
     BEFORE INSERT OR UPDATE OF lat, lng ON "User"
     FOR EACH ROW
     EXECUTE FUNCTION sync_user_location();`,
  ]

  for (const cmd of sqlCommands) {
    try {
      console.log(`Executing: ${cmd.split("\n")[0]}...`)
      await prisma.$executeRawUnsafe(cmd)
    } catch (err) {
      console.error(`Failed executing command:`, err)
      throw err
    }
  }

  console.log("✅ PostGIS spatial setup completed successfully!")
  await prisma.$disconnect()
}

main().catch((err) => {
  console.error("Setup failed:", err)
  process.exit(1)
})
