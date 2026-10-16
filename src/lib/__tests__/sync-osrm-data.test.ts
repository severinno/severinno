import { describe, it, expect } from "vitest"
import path from "node:path"
import { validateOsrmDataset, syncOsrmData } from "../../../scripts/sync-osrm-data"

describe("OSRM Road Network Synchronization & Validation (scripts/sync-osrm-data.ts)", () => {
  const realDataDir = path.resolve(process.cwd(), "osrm-data")

  it("validates the real compiled MLD dataset in osrm-data", () => {
    const validation = validateOsrmDataset(realDataDir, "governador-valadares")

    expect(validation).toBeDefined()
    expect(validation.valid).toBe(true)
    expect(validation.mldReady).toBe(true)
    expect(validation.region).toBe("governador-valadares")
    expect(validation.filesFound.length).toBeGreaterThanOrEqual(8)
    expect(validation.totalSizeBytes).toBeGreaterThan(1_000_000)
    expect(validation.missingFiles).toHaveLength(0)
    expect(validation.lastModified).toBeDefined()
  })

  it("detects missing or invalid files when pointing to an empty directory", () => {
    const emptyDir = path.resolve(process.cwd(), "src")
    const validation = validateOsrmDataset(emptyDir, "fake-city")

    expect(validation.valid).toBe(false)
    expect(validation.mldReady).toBe(false)
    expect(validation.filesFound).toHaveLength(0)
    expect(validation.missingFiles.length).toBeGreaterThan(0)
  })

  it("performs check-only sync without mutating disk", async () => {
    const result = await syncOsrmData({
      dataDir: realDataDir,
      region: "governador-valadares",
      checkOnly: true,
    })

    expect(result.success).toBe(true)
    expect(result.action).toBe("CHECKED")
    expect(result.validation.valid).toBe(true)
    expect(result.message).toContain("íntegra")
  })

  it("supports dry-run mode safely", async () => {
    const result = await syncOsrmData({
      dataDir: realDataDir,
      region: "governador-valadares",
      dryRun: true,
    })

    expect(result.success).toBe(true)
    expect(result.action).toBe("DRY_RUN_OK")
    expect(result.message).toContain("[DRY-RUN]")
  })

  it("skips compilation when dataset is already fresh", async () => {
    const result = await syncOsrmData({
      dataDir: realDataDir,
      region: "governador-valadares",
      force: false,
    })

    expect(result.success).toBe(true)
    expect(result.action).toBe("SKIPPED_FRESH")
    expect(result.message).toContain("já está atualizada")
  })
})
