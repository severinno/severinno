#!/usr/bin/env node
/**
 * check_crlf.mjs
 *
 * Usage:
 *   node scripts/check_crlf.mjs [--fix] <path>...
 *
 * Exit codes:
 *   0 — clean or fixed
 *   1 — CRLF found
 *   2 — error
 */
import { readFileSync, writeFileSync } from "node:fs"

function main() {
  const args = process.argv.slice(2)
  const fix = args.includes("--fix")
  const paths = args.filter((a) => a !== "--fix")

  const offenders = []
  for (const p of paths) {
    try {
      const data = readFileSync(p)
      if (data.includes(13)) {
        // 13 is byte 0x0D (\r)
        offenders.push(p)
        if (fix) {
          const buf = Buffer.alloc(data.length)
          let j = 0
          for (let i = 0; i < data.length; i++) {
            if (data[i] === 13) {
              if (i + 1 < data.length && data[i + 1] === 10) {
                // skip \r before \n
                continue
              }
              // lone \r -> \n
              buf[j++] = 10
            } else {
              buf[j++] = data[i]
            }
          }
          writeFileSync(p, buf.subarray(0, j))
        }
      }
    } catch {
      // ignore files that cannot be read
    }
  }

  for (const p of offenders) {
    process.stdout.write(p + "\n")
  }

  process.exit(fix ? 0 : offenders.length > 0 ? 1 : 0)
}

main()
