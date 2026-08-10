#!/usr/bin/env node
/**
 * scan-non-ascii.mjs - reusable non-ASCII byte scanner for encoding gates.
 *
 * WHY THIS EXISTS (read before you reach for a grep one-liner):
 *   `LC_ALL=C grep -n '[^ -~]' file` LOOKS correct but FAILS SILENTLY: the
 *   character-class RANGE `[ -~]` (space 0x20 -> tilde 0x7E) is locale- and
 *   quoting-dependent, and through some tooling paths it stops matching
 *   entirely - a file can hold real non-ASCII bytes (em-dash, accents,
 *   emoji) while the scan reports zero hits. That exact failure slipped an
 *   em-dash into scripts/health-check.sh in this repo (2026-08) despite the
 *   gate. This module never builds a range and never depends on locale: it
 *   iterates raw BYTES and flags every byte >= 0x80. There is no pattern to
 *   break.
 *
 * API (importable - entry-point guarded):
 *   import {
 *     findNonAsciiOffsets, scanFile, firstInvalidUtf8Offset, scanFileUtf8,
 *   } from "./scan-non-ascii.mjs"
 *
 *   findNonAsciiOffsets(buf) -> number[]      byte offsets of every byte >= 0x80
 *   scanFile(path)          -> { path, nonAscii, hits }  hits = [{ offset, line, col }]
 *   firstInvalidUtf8Offset(buf) -> number      offset of the first INVALID UTF-8
 *                                              sequence, or -1 when fully valid
 *   scanFileUtf8(path)      -> { path, validUtf8, hits }  (corruption scan:
 *                            well-formedness only - legit accents PASS)
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
 *   node scripts/scan-non-ascii.mjs --utf8 [--report] <file...>
 *     UTF-8 WELL-FORMEDNESS scan - the CORRUPTION alert (not the accent
 *     presence scan above). Flags only INVALID sequences (stray continuation,
 *     truncated, overlong, UTF-16 surrogates, > U+10FFFF); legit accents and
 *     em-dashes PASS. exit 1 if any invalid file, else 0. With --report:
 *       UTF8-OK\t<path>
 *       INVALID-UTF8\t<path>\t<line>:<col>   (first invalid sequence)
 *       ERROR\t<path>
 *     This is what pr-check.yml's informational docs-encoding job runs over
 *     the docs surface (git ls-files '*.md' '*.css' '*.html') - it alerts on
 *     corruption WITHOUT blocking and WITHOUT tripping on legit accents.
 *
 * Exit codes: 0 = clean - 1 = at least one offending byte/file.
 */
import { readFileSync } from "node:fs"
import { pathToFileURL } from "node:url"

/**
 * Byte offsets (0-based) of every byte >= 0x80 in a Buffer.
 * Pure byte iteration - no regex, no locale, no character-class range.
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
 * Returns { path, nonAscii, hits } - hits = [{ offset, line, col }], empty
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

/**
 * Offset of the first INVALID UTF-8 sequence, or -1 when the whole buffer is
 * valid UTF-8. Validates WELL-FORMEDNESS only: legit multi-byte accents pass;
 * corruption (stray continuation / invalid lead bytes 0x80-0xC1 and
 * 0xF5-0xFF, truncated sequences, overlong encodings, UTF-16 surrogates
 * U+D800-U+DFFF, code points > U+10FFFF) is flagged at its first byte. Pure
 * byte iteration - the same no-pattern, no-locale promise as
 * findNonAsciiOffsets (LC_ALL cannot change the verdict).
 * @param {Buffer} buf
 * @returns {number}
 */
export function firstInvalidUtf8Offset(buf) {
  let i = 0
  while (i < buf.length) {
    const b = buf[i]
    if (b < 0x80) {
      i++
      continue
    }
    let len
    if (b >= 0xc2 && b <= 0xdf) len = 2
    else if (b >= 0xe0 && b <= 0xef) len = 3
    else if (b >= 0xf0 && b <= 0xf4) len = 4
    else return i // stray continuation byte or invalid lead
    if (i + len > buf.length) return i // truncated sequence
    for (let j = 1; j < len; j++) {
      if ((buf[i + j] & 0xc0) !== 0x80) return i // not a continuation byte
    }
    if (len === 3) {
      const c1 = buf[i + 1]
      // Overlong 3-byte (U+0000-U+07FF) or UTF-16 surrogate (U+D800-U+DFFF).
      if ((b === 0xe0 && c1 < 0xa0) || (b === 0xed && c1 >= 0xa0)) return i
    }
    if (len === 4) {
      const c1 = buf[i + 1]
      // Overlong 4-byte (U+0000-U+FFFF) or code point > U+10FFFF.
      if ((b === 0xf0 && c1 < 0x90) || (b === 0xf4 && c1 >= 0x90)) return i
    }
    i += len
  }
  return -1
}

/**
 * UTF-8 well-formedness scan of one file (corruption detection - NOT the
 * non-ASCII presence scan scanFile performs). Returns the first invalid
 * sequence position, or an empty hits list when the file is valid UTF-8
 * (accents and em-dashes are valid and PASS). Throws on read errors (caller
 * decides).
 * @param {string} filePath
 * @returns {{ path: string, validUtf8: boolean, hits: Array<{ offset: number, line: number, col: number }> }}
 */
export function scanFileUtf8(filePath) {
  const buf = readFileSync(filePath)
  const offset = firstInvalidUtf8Offset(buf)
  return {
    path: filePath,
    validUtf8: offset < 0,
    hits: offset < 0 ? [] : [{ offset, ...positionOf(buf, offset) }],
  }
}

const IS_MAIN = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href

if (IS_MAIN) {
  const report = process.argv.includes("--report")
  const utf8 = process.argv.includes("--utf8")
  const files = process.argv.slice(2).filter((a) => !a.startsWith("--"))
  if (files.length === 0) {
    console.error("usage: node scripts/scan-non-ascii.mjs [--utf8] [--report] <file...>")
    process.exit(2)
  }
  if (utf8) {
    // UTF-8 well-formedness mode: the CORRUPTION alert. Flags only INVALID
    // sequences (legit accents pass) - per-file verdicts for the batched
    // docs-encoding job; a read failure is ERROR per file, never silent.
    let found = false
    for (const f of files) {
      try {
        const r = scanFileUtf8(f)
        if (r.validUtf8) {
          if (report) console.log(`UTF8-OK\t${f}`)
          continue
        }
        found = true
        const h = r.hits[0]
        if (report) console.log(`INVALID-UTF8\t${f}\t${h.line}:${h.col}`)
        else console.log(`${f}:${h.line}:${h.col}`)
      } catch {
        found = true
        if (report) console.log(`ERROR\t${f}`)
        else console.log(`${f}: read error`)
      }
    }
    process.exit(found ? 1 : 0)
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
