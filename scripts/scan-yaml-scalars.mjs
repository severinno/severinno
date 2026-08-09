#!/usr/bin/env node
/**
 * scan-yaml-scalars.mjs — GitHub Actions YAML plain-scalar landmine scanner.
 *
 * WHY THIS EXISTS (read before you reach for a grep one-liner):
 *   A `name:` or `run:` value written as an UNQUOTED plain scalar must not
 *   contain `: ` (colon+space) or ` #` (space+hash) — both violate the YAML
 *   plain-scalar rules:
 *     - `: ` splits the line into a nested mapping -> js-yaml throws
 *       ("mapping values are not allowed in this context") -> the whole
 *       workflow fails to parse.
 *     - ` #` starts a comment -> the value is SILENTLY truncated at the '#'
 *       with NO parse error at all — the workflow stays green while the
 *       name/command is quietly shortened (e.g. `run: echo a # b` becomes
 *       just `echo a`).
 *   The 2026-08 Summary-step breakage in this repo was exactly the `: ` case
 *   (`name: strict: every ...` written as a plain scalar). A bare grep for
 *   `': '` is too noisy (URLs, times, Windows paths all carry colons); this
 *   module scopes the hunt to name/run VALUES that are plain scalars and
 *   flags only the two forbidden sequences.
 *
 * SAFE FORMS (never flagged):
 *   - quoted values ("..." / '...')
 *   - block scalars (`key: |` / `key: >` — their content lines are skipped)
 *   - colons NOT followed by space (12:30, http://host:8080, C:\path)
 *     — including a value ENDING in a bare ':' (`echo value:`), which is
 *     valid plain YAML (only ': ' splits a mapping)
 *   - `#` not preceded by space (# at value start is a comment)
 *
 * API (importable — entry-point guarded):
 *   import { findPlainScalarCandidates, scanYamlContent, scanYamlFiles } from "./scan-yaml-scalars.mjs"
 *
 *   findPlainScalarCandidates(content) -> Array<{ line, key, value, issues }>
 *   scanYamlContent(content)           -> { parseError: string|null, candidates }
 *   scanYamlFiles(paths)               -> Array<{ path, parseError, candidates }>
 *
 * CLI (what gates call):
 *   node scripts/scan-yaml-scalars.mjs [path...]
 *     default: every .yml under .github/workflows/ plus every action.yml
 *     under .github/actions/<name>/ (the glob "star slash" sequence is
 *     avoided in comments because it would close the block comment)
 *     prints `file:line: key 'value' -> issue` per candidate.
 *
 * Exit codes: 0 = clean · 1 = candidates found · 2 = hard YAML parse error.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import yaml from "js-yaml"

/** Leading-space indent of a line (tabs count as one column). */
function indentOf(line) {
  return /^[ \t]*/.exec(line)[0].length
}

/**
 * Block-scalar opener? `key: |`, `key: >`, with optional chomping (+/-) and
 * explicit-indentation (digit) modifiers in EITHER order (YAML allows both
 * `|2-` and `|-2`) plus an optional trailing comment. The modifier class is
 * deliberately loose (`[0-9+-]*`): over-accepting a malformed header merely
 * treats the following lines as block content (safe — no false candidate),
 * while under-accepting would scan real block content as plain scalars and
 * produce false positives. That bias is the whole point of the guard.
 * @param {string} trimmed
 * @returns {boolean}
 */
function isBlockOpener(trimmed) {
  return /^(?:-\s+)?[A-Za-z0-9_.-]+\s*:\s*[|>][0-9+-]*\s*(#.*)?$/.test(trimmed)
}

/**
 * Plain-scalar landmines in a YAML string: `name:`/`run:` values that are
 * unquoted plain scalars containing `: ` or ` #`.
 * Line numbers are 1-based (CRLF-tolerant: split on /\\r?\\n/).
 * @param {string} content
 * @returns {Array<{ line: number, key: string, value: string, issues: string[] }>}
 */
export function findPlainScalarCandidates(content) {
  const lines = content.split(/\r?\n/)
  const candidates = []
  let inBlock = false
  let blockIndent = -1

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const trimmed = raw.trim()

    if (inBlock) {
      // Content of a block scalar: blank lines and anything more indented
      // than the opener are literal — a `: ` or ` #` there is SAFE.
      if (trimmed === "" || indentOf(raw) > blockIndent) continue
      inBlock = false
    }

    if (trimmed === "" || trimmed.startsWith("#")) continue

    if (isBlockOpener(trimmed)) {
      inBlock = true
      blockIndent = indentOf(raw)
      continue
    }

    const kv = /^(?:-\s+)?(name|run)\s*:\s*(.*)$/.exec(trimmed)
    if (!kv) continue

    const key = kv[1]
    const value = kv[2].trim()
    // Empty value, quoted value, or a value that is a comment -> safe.
    if (value === "" || /^["'#]/.test(value)) continue

    const issues = []
    // Only `: ` (colon+space) is the landmine: a plain scalar ending in a
    // bare `:` (`run: echo hi:`) is VALID YAML in block context (the spec
    // only excludes `:` followed by space or `#`), so a trailing colon must
    // NOT be flagged.
    if (/:\s/.test(value)) {
      issues.push("': ' (colon+space) would split into a nested mapping (hard parse break)")
    }
    if (/\s#/.test(value)) {
      issues.push("' #' (space+hash) would silently truncate the value at the comment")
    }
    if (issues.length > 0) {
      candidates.push({ line: i + 1, key, value, issues })
    }
  }
  return candidates
}

/**
 * Parse + scan one YAML string. parseError is the first line of the js-yaml
 * message when the file fails to parse at all (the `: ` hard-break class).
 * @param {string} content
 * @returns {{ parseError: string|null, candidates: Array<{ line: number, key: string, value: string, issues: string[] }> }}
 */
export function scanYamlContent(content) {
  let parseError = null
  try {
    yaml.load(content)
  } catch (e) {
    parseError = (e.message || String(e)).split("\n")[0]
  }
  return { parseError, candidates: findPlainScalarCandidates(content) }
}

/**
 * Scan one YAML file.
 * @param {string} filePath
 * @returns {{ path: string, parseError: string|null, candidates: Array<{ line: number, key: string, value: string, issues: string[] }> }}
 */
export function scanYamlFile(filePath) {
  return { path: filePath, ...scanYamlContent(readFileSync(filePath, "utf8")) }
}

/**
 * Scan several YAML files, preserving order.
 * @param {string[]} paths
 * @returns {Array<{ path: string, parseError: string|null, candidates: Array<{ line: number, key: string, value: string, issues: string[] }> }>}
 */
export function scanYamlFiles(paths) {
  return paths.map(scanYamlFile)
}

/**
 * Default scan surface: every workflow + local composite action in the repo.
 * @returns {string[]}
 */
export function defaultYamlPaths() {
  const paths = []
  const wfDir = resolve(process.cwd(), ".github", "workflows")
  const actDir = resolve(process.cwd(), ".github", "actions")
  if (existsSync(wfDir)) {
    for (const f of readdirSync(wfDir)) {
      if (/\.ya?ml$/.test(f)) paths.push(resolve(wfDir, f))
    }
  }
  if (existsSync(actDir)) {
    for (const dir of readdirSync(actDir)) {
      const action = resolve(actDir, dir, "action.yml")
      if (existsSync(action)) paths.push(action)
    }
  }
  return paths.sort()
}

const IS_MAIN = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href

if (IS_MAIN) {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"))
  const paths = args.length > 0 ? args : defaultYamlPaths()
  if (paths.length === 0) {
    console.error("usage: node scripts/scan-yaml-scalars.mjs [path...]")
    process.exit(2)
  }
  let hardBreaks = 0
  let candidates = 0
  for (const r of scanYamlFiles(paths)) {
    if (r.parseError) {
      hardBreaks++
      console.log(`${r.path}: PARSE ERROR — ${r.parseError}`)
    }
    for (const c of r.candidates) {
      candidates++
      for (const issue of c.issues) {
        console.log(`${r.path}:${c.line}: ${c.key} '${c.value}' -> ${issue}`)
      }
    }
  }
  console.log(`\n${paths.length} files · ${hardBreaks} parse errors · ${candidates} plain-scalar candidates`)
  process.exit(hardBreaks > 0 ? 2 : candidates > 0 ? 1 : 0)
}
