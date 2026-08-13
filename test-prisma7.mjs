/* eslint-disable no-console */
import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "./src/generated/prisma/client.js"

async function main() {
  const url = process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/severinno"
  console.log("Connecting to:", url.replace(/:[^:@]+@/, ":****@"))
  const adapter = new PrismaPg({ connectionString: url })
  const client = new PrismaClient({ adapter })
  await client.$connect()
  console.log("Connected!")
  const count = await client.user.count()
  console.log("User count:", count)
  await client.$disconnect()
  console.log("Done")
}

main().catch((e) => {
  console.error("Error:", e.message)
  console.error(e.stack)
  process.exit(1)
})
