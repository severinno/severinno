#!/usr/bin/env node
/**
 * check_utf8.mjs
 *
 * Usage:
 *   node scripts/check_utf8.mjs [directory] [--fix] [--ci] [--dry-run]
 *
 * Exit codes:
 *   0 — all files are valid UTF-8
 *   1 — invalid UTF-8 found
 *   2 — error
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"

const BYTE_0x97 = 0x97
const EM_DASH = Buffer.from([0xe2, 0x80, 0x94])

function analyzeUtf8(data) {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(data)
    return { status: "ok", positions: [] }
  } catch {
    // Has invalid UTF-8
  }

  const pos0x97 = []
  let hasOther = false
  const n = data.length
  let i = 0

  while (i < n) {
    const b = data[i]
    if (b < 0x80) {
      i += 1
    } else if (0xc2 <= b && b <= 0xdf) {
      if (i + 1 < n && 0x80 <= data[i + 1] && data[i + 1] <= 0xbf) {
        i += 2
      } else {
        if (b === BYTE_0x97 || (i + 1 < n && data[i + 1] === BYTE_0x97)) {
          pos0x97.push(b === BYTE_0x97 ? i : i + 1)
        } else {
          hasOther = true
        }
        i += 1
      }
    } else if (0xe0 <= b && b <= 0xef) {
      if (
        i + 2 < n &&
        0x80 <= data[i + 1] &&
        data[i + 1] <= 0xbf &&
        0x80 <= data[i + 2] &&
        data[i + 2] <= 0xbf
      ) {
        i += 3
      } else {
        for (const j of [1, 2]) {
          if (i + j >= n || !(0x80 <= data[i + j] && data[i + j] <= 0xbf)) {
            if (data[i + j] === BYTE_0x97) pos0x97.push(i + j)
            else hasOther = true
          }
        }
        i += 1
      }
    } else if (0xf0 <= b && b <= 0xf4) {
      if (
        i + 3 < n &&
        0x80 <= data[i + 1] &&
        data[i + 1] <= 0xbf &&
        0x80 <= data[i + 2] &&
        data[i + 2] <= 0xbf &&
        0x80 <= data[i + 3] &&
        data[i + 3] <= 0xbf
      ) {
        i += 4
      } else {
        for (const j of [1, 2, 3]) {
          if (i + j >= n || !(0x80 <= data[i + j] && data[i + j] <= 0xbf)) {
            if (data[i + j] === BYTE_0x97) pos0x97.push(i + j)
            else hasOther = true
          }
        }
        i += 1
      }
    } else {
      if (b === BYTE_0x97) pos0x97.push(i)
      else hasOther = true
      i += 1
    }
  }

  if (pos0x97.length > 0 && !hasOther) return { status: "warn_0x97", positions: pos0x97 }
  if (pos0x97.length > 0 && hasOther) return { status: "mixed", positions: pos0x97 }
  if (hasOther) return { status: "other", positions: [] }
  return { status: "unknown", positions: [] }
}

function walkDir(dir, fileList = []) {
  try {
    const entries = readdirSync(dir)
    for (const entry of entries) {
      const fullPath = join(dir, entry)
      const st = statSync(fullPath)
      if (st.isDirectory()) {
        walkDir(fullPath, fileList)
      } else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) {
        fileList.push(fullPath)
      }
    }
  } catch {
    // ignore
  }
  return fileList
}

function main() {
  const args = process.argv.slice(2)
  const fixMode = args.includes("--fix")
  const ciMode = args.includes("--ci")
  const dryRun = args.includes("--dry-run")
  const searchDir = args.find((a) => !a.startsWith("--")) || "src"

  const files = walkDir(searchDir)
  const warnFiles = []
  const badFiles = []
  const fixedFiles = []

  for (const file of files) {
    const data = readFileSync(file)
    const { status } = analyzeUtf8(data)
    if (status === "ok") continue

    if (status === "warn_0x97") {
      if (dryRun) {
        console.log(`  WOULD FIX: ${file} (byte 0x97 -- Windows-1252 em dash)`)
        warnFiles.push(file)
      } else if (fixMode) {
        let modified = false
        const out = []
        for (let i = 0; i < data.length; i++) {
          if (data[i] === BYTE_0x97) {
            for (const b of EM_DASH) out.push(b)
            modified = true
          } else {
            out.push(data[i])
          }
        }
        if (modified) {
          writeFileSync(file, Buffer.from(out))
          console.log(`  FIXED:    ${file}`)
          fixedFiles.push(file)
        }
      } else {
        console.log(`  WARNING:  ${file} (byte 0x97 -- Windows-1252 em dash)`)
        warnFiles.push(file)
      }
    } else {
      badFiles.push(file)
      console.log(`  INVALID:  ${file}`)
    }
  }

  console.log()
  console.log("---")
  console.log(`  Scanned: ${files.length} .ts/.tsx files`)

  if (dryRun && warnFiles.length > 0) {
    console.log(`  Dry-run: ${warnFiles.length} file(s) would be fixed`)
  }

  const hasIssues =
    badFiles.length > 0 || (ciMode && warnFiles.length > 0) || (dryRun && warnFiles.length > 0)
  if (!hasIssues && fixedFiles.length === 0) {
    console.log("  Status:  OK -- all valid UTF-8")
    process.exit(0)
  }

  if (ciMode && warnFiles.length > 0) process.exit(1)
  if (badFiles.length > 0) process.exit(1)
  process.exit(0)
}

main()
