#!/usr/bin/env node
/**
 * audit_blob_crlf_history.mjs
 *
 * Usage:
 *   node scripts/audit_blob_crlf_history.mjs [--extensions ext1,ext2,... | --all-text]
 *
 * Exit codes:
 *   0 — success or clean report
 *   1 — offenders found in gate mode
 *   2 — error or missing configuration
 */
import { readFileSync, existsSync } from "node:fs"
import { spawnSync } from "node:child_process"

function globToRegex(glob, pathAnchored) {
  let out = ""
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === "*") {
      out += pathAnchored ? "[^/]*" : ".*"
    } else if (c === "?") {
      out += pathAnchored ? "[^/]" : "."
    } else if (c === "[") {
      const j = glob.indexOf("]", i + 1)
      if (j === -1) {
        out += "\\["
      } else {
        out += glob.slice(i, j + 1)
        i = j
      }
    } else if ("\\.[]{}()+?^$|".includes(c)) {
      out += "\\" + c
    } else {
      out += c
    }
  }
  return new RegExp("^" + out + "$", "i")
}

function buildMatchers(patterns) {
  return patterns.map((p) => ({
    anchored: p.includes("/"),
    rx: globToRegex(p, p.includes("/")),
  }))
}

function pathMatches(path, matchers) {
  for (const m of matchers) {
    const target = m.anchored ? path : path.split("/").pop()
    if (m.rx.test(target)) return true
  }
  return false
}

function loadAllTextPatterns(gitattributesPath = ".gitattributes") {
  if (!existsSync(gitattributesPath)) {
    throw new Error("FileNotFound")
  }
  const patterns = []
  const raw = readFileSync(gitattributesPath, "utf8")
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const parts = trimmed.split(/\s+/)
    if (parts.length < 3) continue
    const attrs = parts.slice(1)
    if (!attrs.includes("text") || !attrs.includes("eol=lf")) continue
    const pat = parts[0]
    if (!patterns.includes(pat)) patterns.push(pat)
  }
  if (!patterns.includes("*.bash")) patterns.push("*.bash")
  return patterns
}

function scanAll(patterns) {
  const revList = spawnSync("git", ["rev-list", "--all", "--objects"], {
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
  })
  if (revList.status !== 0) {
    process.stderr.write(revList.stderr || "")
    return { code: 2, offenders: [], scanned: 0 }
  }

  const matchers = buildMatchers(patterns)
  const blobs = new Map()

  for (const line of revList.stdout.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const spaceIdx = trimmed.indexOf(" ")
    if (spaceIdx === -1) continue
    const hash = trimmed.slice(0, spaceIdx)
    const path = trimmed.slice(spaceIdx + 1)
    if (pathMatches(path, matchers)) {
      if (!blobs.has(hash)) blobs.set(hash, path)
    }
  }

  if (blobs.size === 0) {
    return { code: 0, offenders: [], scanned: 0 }
  }

  const batchInput = Array.from(blobs.keys()).join("\n") + "\n"
  const catFile = spawnSync("git", ["cat-file", "--batch"], {
    input: Buffer.from(batchInput),
    maxBuffer: 100 * 1024 * 1024,
  })

  if (catFile.status !== 0) {
    process.stderr.write(catFile.stderr || "")
    return { code: 2, offenders: [], scanned: 0 }
  }

  const data = catFile.stdout
  const offenders = []
  let pos = 0
  const n = data.length
  let truncated = false

  while (pos < n) {
    const nl = data.indexOf(10, pos) // \n
    if (nl === -1) {
      truncated = true
      break
    }
    const header = data.subarray(pos, nl).toString("utf8")
    pos = nl + 1
    const parts = header.split(" ")
    if (parts.length !== 3 || parts[1] !== "blob") {
      truncated = true
      break
    }
    const oid = parts[0]
    const size = parseInt(parts[2], 10)
    if (pos + size > n) {
      truncated = true
      break
    }
    const body = data.subarray(pos, pos + size)
    pos += size
    if (pos < n && data[pos] === 10) {
      pos += 1
    }
    if (body.includes(13)) {
      // contains \r
      offenders.push([oid, blobs.get(oid) || oid])
    }
  }

  if (truncated) {
    process.stderr.write(
      "ERRO: stream do cat-file --batch truncado/corrupto — auditoria parcial ABORTADA.\n",
    )
    return { code: 2, offenders: [], scanned: 0 }
  }

  return { code: 0, offenders, scanned: blobs.size }
}

function main() {
  const args = process.argv.slice(2)
  let patterns = ["*.sh", "*.bash"]
  let label = ".sh,.bash"
  let reportOnly = false
  let i = 0

  while (i < args.length) {
    const a = args[i]
    if (a === "--extensions" && i + 1 < args.length) {
      const exts = args[i + 1]
        .split(",")
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean)
      patterns = exts.map((e) => `*${e}`)
      label = exts.join(",")
      i += 2
    } else if (a.startsWith("--extensions=")) {
      const val = a.split("=")[1] || ""
      const exts = val
        .split(",")
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean)
      patterns = exts.map((e) => `*${e}`)
      label = exts.join(",")
      i += 1
    } else if (a === "--all-text") {
      try {
        patterns = loadAllTextPatterns()
      } catch {
        process.stderr.write(
          "audit_blob_crlf_history.py: --all-text requer o .gitattributes na raiz\n",
        )
        process.exit(2)
      }
      label = patterns.join(",")
      reportOnly = true
      i += 1
    } else if (a === "-h" || a === "--help") {
      console.log("Usage: audit_blob_crlf_history.py [--extensions ext1,ext2,... | --all-text]")
      process.exit(0)
    } else {
      process.stderr.write(`audit_blob_crlf_history.py: argumento desconhecido: ${a}\n`)
      process.exit(2)
    }
  }

  if (!patterns.length) {
    process.stderr.write("audit_blob_crlf_history.py: --extensions vazio — nada a auditar\n")
    process.exit(2)
  }

  const { code, offenders, scanned } = scanAll(patterns)
  if (code !== 0) process.exit(code)

  for (const [blobHash, path] of offenders) {
    console.log(`${blobHash.slice(0, 12)}  ${path}`)
  }

  if (offenders.length > 0) {
    console.log(`\n${offenders.length} bloco(s) com CRLF no histórico (escopo: ${label}).`)
    if (reportOnly) {
      console.log("Modo REPORT (--all-text): CRLF em tipos benignos não quebra toolchain —")
      console.log("o gate de CI é o .sh/.bash (default). Correção retroativa: ver README.")
      process.exit(0)
    }
    console.log("Correção retroativa: ver README 'Auditoria histórica de blobs .sh'.")
    process.exit(1)
  }

  console.log(
    `OK — ${scanned} blobs únicos sem CRLF no histórico (rev-list --all; escopo: ${label}).`,
  )
  process.exit(0)
}

main()
