// Prova 62 cycle, step 1-2: backup byte-copy + mutate favorites/route.ts,
// reintroducing the old per-item haversineKm in-memory loop.
import { readFileSync, writeFileSync, copyFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"

const ROOT = process.cwd()
const target = join(ROOT, "src", "app", "api", "favorites", "route.ts")
const backupDir = join("C:", "tmp", "prova62")
mkdirSync(backupDir, { recursive: true })
const backup = join(backupDir, "favorites-route.bak.ts")

const src = readFileSync(target, "utf8")
const hasCrlf = src.includes("\r\n")
const text = src.replace(/\r\n/g, "\n")

// Backup byte-copy (the exact original bytes)
copyFileSync(target, backup)
console.log("backup: " + backup + " (" + readFileSync(target).length + " bytes)")

// Mutation: reintroduce the old per-item haversineKm loop right after the
// distanceMap block comment (before `let distanceMap`), the in-memory pattern
// the migration removed.
const anchor = "    // Distances: single PostGIS ST_Distance batch query (DB-first)."
if (!text.includes(anchor)) {
  console.error("ANCHOR NOT FOUND — aborting")
  process.exit(1)
}
const mutated = text.replace(
  anchor,
  `    // MUTADO (Prova 62): reintroduz o loop per-item em memoria removido na migracao
    const haversineKm = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
      const R = 6371
      const dLat = ((b.lat - a.lat) * Math.PI) / 180
      const dLng = ((b.lng - a.lng) * Math.PI) / 180
      const s =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos((a.lat * Math.PI) / 180) *
          Math.cos((b.lat * Math.PI) / 180) *
          Math.sin(dLng / 2) *
          Math.sin(dLng / 2)
      return 2 * R * Math.asin(Math.sqrt(s))
    }
    // Distances: single PostGIS ST_Distance batch query (DB-first).`,
)

writeFileSync(target, hasCrlf ? mutated.replace(/\n/g, "\r\n") : mutated)
console.log("mutated: haversineKm loop injected")
