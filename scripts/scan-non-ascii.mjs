#!/usr/bin/env node
/**
 * scan-non-ascii.mjs — reusable non-ASCII byte scanner for encoding gates.
 *
 * WHY THIS EXISTS (read before you reach for a grep one-liner):
 *   `LC_ALL=C grep -n '[^ -~]' file` LOOKS correct but FAILS SILENTLY: the
 *   character-class RANGE `[ -~]` (space 0x20 → tilde 0x7E) is locale- and
 *   quoting-dependent, and through some tooling paths it stops matching
 *   entirely — a file can hold real non-ASCII bytes (em-dash, accents,
 *   emoji) while the scan reports zero hits. That exact failure slipped an
 *   em-dash into scripts/health-check.sh in this repo (2026-08) despite the
 *   gate. This module never builds a range and never depends on locale: it
 *   iterates raw BYTES and flags every byte >= 0x80. There is no pattern to
 *   break.
 *
 * API (importable — entry-point guarded):
 *   import { findNonAsciiOffsets, scanFile } from "./scan-non-ascii.mjs"
 *
 *   findNonAsciiOffsets(buf) -> number[]      byte offsets of every byte >= 0x80
 *   scanFile(path)          -> { path, nonAscii, hits }  hits = [{ offset, line, col }]
 *
 * CLI (what gates call):
 *   node scripts/scan-non-ascii.mjs <file...>
 *     prints `file:line:col` per non-ASCII byte; exit 1 if any found, else 0.
 *   node scripts/scan-non-ascii.mjs --report <file...>
 *     per-file verdict lines for BATCHED gates (one line per file, in
 *     argument order, TAB-separated so paths with spaces stay whole):
 *       ASCII-OK\t<path>
 *       VIOLATION\t<path>\t<line>:<col>   (first hit)
 *       ERROR\t<path>                       (read failure - never silent)
 *     exit 1 if any VIOLATION/ERROR, else 0. This lets a shell gate scan an
 *     entire section with ONE node spawn (was one per file - 39 spawns in
 *     this repo, the dominant cost of verify-ascii-proof.sh) while still
 *     reporting per-file verdicts.
 *
 * Exit codes: 0 = all files pure ASCII · 1 = at least one non-ASCII byte.
 */
import { readFileSync } from "node:fs"
import { pathToFileURL } from "node:url"

/**
 * Byte offsets (0-based) of every byte >= 0x80 in a Buffer.
 * Pure byte iteration — no regex, no locale, no character-class range.
 * @param {Buffer} buf
 * @returns {number[]}
 */
export function findNonAsciiOffsets(buf) {
  const offsets = []
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] >= 0x80) offsets.push(i)
  }
  return offsets
}

/** 1-based line/col for a byte offset, counting \n (CRLF-safe: \r is not a line break). */
function positionOf(buf, offset) {
  let line = 1
  let col = 1
  for (let i = 0; i < offset; i++) {
    if (buf[i] === 0x0a) {
      line++
      col = 1
    } else {
      col++
    }
  }
  return { line, col }
}

/**
 * Scan one file for non-ASCII bytes.
 * Returns { path, nonAscii, hits } — hits = [{ offset, line, col }], empty
 * when the file is pure ASCII. Throws on read errors (caller decides).
 * @param {string} filePath
 * @returns {{ path: string, nonAscii: boolean, hits: Array<{ offset: number, line: number, col: number }> }}
 */
export function scanFile(filePath) {
  const buf = readFileSync(filePath)
  const offsets = findNonAsciiOffsets(buf)
  return {
    path: filePath,
    nonAscii: offsets.length > 0,
    hits: offsets.map((offset) => ({ offset, ...positionOf(buf, offset) })),
  }
}

/**
 * Scan several files, preserving order.
 * @param {string[]} paths
 * @returns {Array<{ path: string, nonAscii: boolean, hits: Array<{ offset: number, line: number, col: number }> }>}
 */
export function scanFiles(paths) {
  return paths.map(scanFile)
}

const IS_MAIN = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href

if (IS_MAIN) {
  const report = process.argv.includes("--report")
  const files = process.argv.slice(2).filter((a) => !a.startsWith("--"))
  if (files.length === 0) {
    console.error("usage: node scripts/scan-non-ascii.mjs [--report] <file...>")
    process.exit(2)
  }
  if (report) {
    // Per-file verdicts for batched gates (see --report doc above). A read
    // failure is reported as ERROR per file - never a silent skip. TAB-
    // separated fields so a path containing spaces cannot be misparsed.
    let found = false
    for (const f of files) {
      try {
        const r = scanFile(f)
        if (!r.nonAscii) {
          console.log(`ASCII-OK\t${f}`)
          continue
        }
        found = true
        const h = r.hits[0]
        console.log(`VIOLATION\t${f}\t${h.line}:${h.col}`)
      } catch {
        found = true
        console.log(`ERROR\t${f}`)
      }
    }
    process.exit(found ? 1 : 0)
  }
  let found = false
  for (const r of scanFiles(files)) {
    if (!r.nonAscii) continue
    found = true
    for (const h of r.hits) {
      console.log(`${r.path}:${h.line}:${h.col}`)
    }
  }
  process.exit(found ? 1 : 0)
}
