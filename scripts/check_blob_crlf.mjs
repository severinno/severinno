#!/usr/bin/env node
/**
 * check_blob_crlf.mjs
 *
 * Usage:
 *   node scripts/check_blob_crlf.mjs [--fix]
 *
 * Exit codes:
 *   0 — clean or fixed
 *   1 — CRLF blobs found
 *   2 — error
 */
import { spawnSync } from "node:child_process"

function main() {
  const args = process.argv.slice(2)
  const fix = args.includes("--fix")

  const proc = spawnSync("git", ["ls-files", "--eol", "-z", "--", "*.sh", "*.bash"])
  if (proc.status !== 0) {
    process.stderr.write(proc.stderr || "")
    process.exit(2)
  }

  const raw = proc.stdout
  const records = []
  let start = 0
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === 0) {
      if (i > start) {
        records.push(raw.subarray(start, i))
      }
      start = i + 1
    }
  }

  const offenders = []
  for (const record of records) {
    const tabIdx = record.indexOf(9) // \t
    if (tabIdx === -1) continue
    const meta = record.subarray(0, tabIdx).toString("utf8")
    const path = record.subarray(tabIdx + 1).toString("utf8")

    const iField = meta.split(" ")[0] || ""
    const eol = iField.split("/")[1] || ""
    if (eol !== "lf") {
      offenders.push(path)
    }
  }

  if (fix && offenders.length > 0) {
    spawnSync("git", ["add", "--renormalize", "--", ...offenders])
  }

  for (const p of offenders) {
    process.stdout.write(p + "\n")
  }

  process.exit(fix ? 0 : offenders.length > 0 ? 1 : 0)
}

main()
